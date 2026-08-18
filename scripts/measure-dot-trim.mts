// 도트 그림의 **빈 여백**을 재서 `src/data/dotTrim.json`에 적는다.
//
// ⚠️⚠️ 왜 필요한가: PokéAPI 도트는 전부 96×96인데 **포켓몬이 차지하는 자리가 제각각**이다.
//    캐터피는 위쪽 34%가 통째로 비어 있고 잠만보는 거의 꽉 찬다. 그래서 화면에서
//    ①체력 바가 작은 포켓몬 위에만 붕 뜨고 ②같은 56px로 그려도 큰 놈은 크고 작은 놈은
//    더 작아 보인다. **여백을 알면 둘 다 고쳐진다.**
//
// ⚠️ 꾸러미를 안 깐다 — PNG는 zlib(노드 기본)만 있으면 읽힌다. 우리 도트는 전부
//    **팔레트 PNG(색 타입 3)**에 깊이 8 또는 4다. 다른 꼴이 들어오면 그 파일만 건너뛴다.
// ⚠️ **다시 돌려도 안전하다.** 값만 다시 재서 덮어쓴다.
//
// 사용법: npx tsx scripts/measure-dot-trim.mts

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'

const 도트칸 = 'public/dot'
const 낼곳 = 'src/data/dotTrim.json'

/** 팔레트 PNG 한 장에서 **알파가 있는 칸의 테두리**를 찾는다. 못 읽으면 null. */
function 여백재기(버퍼: Buffer): { 위: number; 아래: number; 왼: number; 오른: number } | null {
  if (버퍼.readUInt32BE(0) !== 0x89504e47) return null
  const 폭 = 버퍼.readUInt32BE(16)
  const 높이 = 버퍼.readUInt32BE(20)
  const 깊이 = 버퍼[24]
  const 색 = 버퍼[25]
  // 인터레이스(Adam7)는 줄 차례가 달라 이 셈이 안 맞는다.
  if (색 !== 3 || 버퍼[28] !== 0) return null
  if (깊이 !== 8 && 깊이 !== 4 && 깊이 !== 2 && 깊이 !== 1) return null

  // ── 덩어리(chunk) 훑기 ────────────────────────────────────────────────────
  let 알파: Uint8Array | null = null
  const 자료: Buffer[] = []
  let i = 8
  while (i + 8 <= 버퍼.length) {
    const 길이 = 버퍼.readUInt32BE(i)
    const 이름 = 버퍼.toString('latin1', i + 4, i + 8)
    const 몸 = 버퍼.subarray(i + 8, i + 8 + 길이)
    if (이름 === 'tRNS') 알파 = new Uint8Array(몸)
    else if (이름 === 'IDAT') 자료.push(몸)
    else if (이름 === 'IEND') break
    i += 12 + 길이
  }
  // tRNS가 없으면 **투명한 칸이 하나도 없다** — 여백이 0이다.
  if (!알파) return { 위: 0, 아래: 0, 왼: 0, 오른: 0 }
  if (!자료.length) return null

  const 편 = inflateSync(Buffer.concat(자료))
  // ⚠️ 팔레트는 한 칸이 1채널이라 **바이트당 여러 칸**이 들어간다(깊이 4면 두 칸).
  //    필터가 보는 「앞 칸까지의 바이트 수」는 그래도 최소 1이다.
  const 줄바이트 = Math.ceil((폭 * 깊이) / 8)
  const bpp = 1
  const 앞줄 = new Uint8Array(줄바이트)
  const 이줄 = new Uint8Array(줄바이트)

  let 위 = -1
  let 아래 = -1
  let 왼 = 폭
  let 오른 = -1
  const 칸당 = 8 / 깊이
  const 마스크 = (1 << 깊이) - 1

  for (let y = 0; y < 높이; y++) {
    const 시작 = y * (줄바이트 + 1)
    if (시작 + 줄바이트 >= 편.length + 1) break
    const 필터 = 편[시작]
    for (let x = 0; x < 줄바이트; x++) {
      const 값 = 편[시작 + 1 + x]
      const a = x >= bpp ? 이줄[x - bpp] : 0
      const b = 앞줄[x]
      const c = x >= bpp ? 앞줄[x - bpp] : 0
      let 원: number
      if (필터 === 0) 원 = 값
      else if (필터 === 1) 원 = 값 + a
      else if (필터 === 2) 원 = 값 + b
      else if (필터 === 3) 원 = 값 + ((a + b) >> 1)
      else {
        // Paeth
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        원 = 값 + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      이줄[x] = 원 & 255
    }
    // 이 줄에서 **알파가 살아 있는 칸**을 찾는다.
    for (let x = 0; x < 폭; x++) {
      const 바이트 = 이줄[(x / 칸당) | 0]
      const 밀기 = 8 - 깊이 * ((x % 칸당) + 1)
      const 색번호 = (바이트 >> 밀기) & 마스크
      // tRNS에 없는 번호는 **불투명**이다(짧게 올 수 있다).
      const a = 색번호 < 알파.length ? 알파[색번호] : 255
      if (a > 8) {
        if (위 < 0) 위 = y
        아래 = y
        if (x < 왼) 왼 = x
        if (x > 오른) 오른 = x
      }
    }
    앞줄.set(이줄)
  }
  if (위 < 0) return null
  return {
    위: 위 / 높이,
    아래: (높이 - 1 - 아래) / 높이,
    왼: 왼 / 폭,
    오른: (폭 - 1 - 오른) / 폭,
  }
}

const 표: Record<string, [number, number, number, number]> = {}
let 못읽음 = 0
const 파일들 = readdirSync(도트칸).filter((f) => f.endsWith('.png')).sort((a, b) => parseInt(a) - parseInt(b))
for (const f of 파일들) {
  const r = 여백재기(readFileSync(join(도트칸, f)))
  if (!r) { 못읽음++; continue }
  const 둥 = (v: number) => Math.round(v * 1000) / 1000
  표[f.replace('.png', '')] = [둥(r.위), 둥(r.아래), 둥(r.왼), 둥(r.오른)]
}

writeFileSync(낼곳, JSON.stringify(표) + '\n')

const 위들 = Object.values(표).map((v) => v[0]).sort((a, b) => a - b)
console.log(`${Object.keys(표).length}장 쟀습니다 (못 읽음 ${못읽음}) → ${낼곳}`)
console.log(`위 여백: 가장 적음 ${(위들[0] * 100).toFixed(0)}% · 가운데 ${(위들[(위들.length / 2) | 0] * 100).toFixed(0)}% · 가장 많음 ${(위들.at(-1)! * 100).toFixed(0)}%`)
