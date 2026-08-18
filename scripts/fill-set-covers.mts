// 세트 목록에서 표지(cover)가 빈 세트를 그 세트의 카드 그림으로 채운다.
//
// 왜: 표지가 없으면 세트 목록에 카드 뒷면(「이미지 준비 중」)이 뜬다. 사장님이
// 「언신 포시즈 안농 컬렉션은 카드 다 있는데 썸네일만 없다」고 지적해 찾았다
// (2026-08-12). 카드 28장은 멀쩡한데 세트 표지 칸만 비어 있었다.
//
// 왜 비었나: 표지는 TCGdex에서 받아 오는데, 본편의 **부록 세트**(안농 컬렉션·
// 트레이너킷)는 TCGdex에 세트로 안 잡혀 있어 받아 올 것이 없었다.
//
// ⚠️ 고르는 기준은 본편과 같게 — **등급이 높은 카드**를 표지로 쓴다. 1번 카드는
//    대개 평범한 카드라 세트를 알아보는 데 도움이 안 된다(SetsView 설명과 같은 이유).
// ⚠️ 그림이 **실제로 열리는지 두드려 보고** 넣는다. 규칙으로 주소만 만들어 두면
//    나중에 깨진 그림이 나온다(2026-08-11에 M4 120번이 그랬다).
//
// 쓰는 법: npx tsx scripts/fill-set-covers.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import { usable } from '../src/lib/cardImg.ts'

const 쓰기 = process.argv.includes('--write')

// 등급 순위. 뒤로 갈수록 좋다(SetsView의 rarityRank와 같은 뜻).
const 등급순 = [
  'Common', 'Uncommon', 'Rare', 'Rare Holo', 'Double Rare', 'Ultra Rare',
  'Art Rare', 'Special Art Rare', 'Super Rare', 'Secret Rare', 'Hyper Rare',
]
const 점수 = (r?: string) => {
  const i = 등급순.findIndex((x) => x.toLowerCase() === String(r ?? '').toLowerCase())
  return i < 0 ? 0 : i + 1
}

const 열리나 = async (u: string) => {
  try {
    const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(12000) })
    return r.status === 200
  } catch {
    return false
  }
}

const 길 = 'public/sets/index.json'
const idx = JSON.parse(readFileSync(길, 'utf-8'))
const sets: any[] = Array.isArray(idx) ? idx : (idx.sets ?? [])

let 채움 = 0
let 못채움 = 0
for (const s of sets) {
  if (String(s.cover ?? '').trim()) continue
  let cards: any[] = []
  try {
    cards = JSON.parse(readFileSync(`public/sets/${s.slug}.json`, 'utf-8')).cards ?? []
  } catch {
    /* 세트 파일이 없으면 넘어간다 */
  }
  // ⚠️⚠️ **안이 다 채워진 세트에만 표지를 넣는다**(사장님 지시 2026-08-12).
  //    표지만 예쁘게 걸어 놓고 눌러 보면 안이 「이미지 준비 중」 투성이면 더 나쁘다.
  //    SM 트레이너킷이 그랬다 — 37장 중 5장만 살아 있었다. 그런 세트는 표지도 안 넣는다.
  const 그림있음 = cards.filter((c) => usable(c?.img))
  if (!cards.length || 그림있음.length !== cards.length) {
    console.log(`    ${s.slug.padEnd(16)} ${String(s.name).slice(0, 34).padEnd(34)} 주소가 빈 카드가 있다 (${그림있음.length}/${cards.length})`)
    못채움++
    continue
  }
  // 주소가 다 적혀 있어도 **실제로 열리는지**는 두드려 봐야 안다.
  const 살아있나 = await Promise.all(그림있음.map((c) => 열리나(String(c.img))))
  const 산것 = 살아있나.filter(Boolean).length
  if (산것 !== cards.length) {
    console.log(`    ${s.slug.padEnd(16)} ${String(s.name).slice(0, 34).padEnd(34)} 안 열리는 카드가 있다 (${산것}/${cards.length})`)
    못채움++
    continue
  }
  // 여기까지 왔으면 그 세트는 카드가 다 나온다. 등급 높은 카드를 표지로 쓴다
  // (1번 카드는 대개 평범해서 세트를 알아보는 데 도움이 안 된다 — SetsView와 같은 이유).
  const 고른것 = [...cards].sort((a, b) => 점수(b?.r) - 점수(a?.r) || Number(b?.n) - Number(a?.n))[0]
  console.log(`  ✔ ${s.slug.padEnd(16)} ${String(s.name).slice(0, 34).padEnd(34)} 카드 ${cards.length}장 다 나옴 ← ${String(고른것.img).slice(-34)}`)
  s.cover = String(고른것.img)
  채움++
}

if (쓰기 && 채움) writeFileSync(길, JSON.stringify(idx))
console.log(`\n${쓰기 ? '채워 넣었습니다' : '미리보기(파일은 안 건드림)'} — 채움 ${채움}개 · 못 채움 ${못채움}개`)
if (!쓰기 && 채움) console.log('실제로 넣으려면 --write 를 붙여 다시 돌린다.')
