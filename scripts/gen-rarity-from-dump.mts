// PPT 카드 통째 받기(cards)에서 **저쪽 표기 그대로의 레어도**를 뽑아
// src/data/rarityByName.json 으로 적는다. 자동완성이 이걸 재료로 쓴다.
//
// 왜 필요한가: 자동완성 레어도를 **우리 세트 자료**로 만들고 있었는데, 두 자료가 같은
// 카드를 다르게 부른다 —
//   메가리자몽Xex M2 116/080 : 우리 "Ultra Rare"  ↔  저쪽 "Mega Ultra Rare"(MUR)
// 그래서 MUR·CSR·CHR처럼 **저쪽에만 있는 코드는 만들 수가 없었다.** "리자몽"을 쳐도
// "리자몽 MUR"이 안 떴다(2026-08-08 지적). 검색은 되는데 추천이 안 됐다.
//
// 덤프는 레포에 안 넣는다(푼 것 6.7MB). 여기서 **작은 대조표만 뽑아** 넣는다.
//
// 쓰기: ① scratchpad의 pull-cards로 덤프를 받아 cards.csv 를 만든 뒤
//       ② node --experimental-strip-types scripts/gen-rarity-from-dump.mts <cards.csv 경로>
//       ③ node --experimental-strip-types scripts/gen-card-name-suggestions.mts
// ⚠️ 통째 받기는 하루 2번뿐이다. 서버가 매일 자동으로 받으므로, 이 스크립트는
//    **새 세트가 왕창 나왔을 때만** 다시 돌리면 된다(레어도는 그때만 늘어난다).

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/koCardName.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 들어온곳 = process.argv[2]
if (!들어온곳) {
  console.error('cards.csv 경로를 주세요.')
  process.exit(1)
}

/** 따옴표 안의 쉼표를 지켜 자른다("Team Rocket's Mewtwo, ex"). */
function 줄자르기(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"'
        i++
      } else q = !q
    } else if (ch === ',' && !q) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

// 사람들이 실제로 치는 짧은 코드. 저쪽 표기 → 코드.
// ⚠️ 여기에 없는 레어도는 안 만든다. "Common"·"Rare" 같은 건 좁히는 데 도움이 안 된다.
const 코드 = new Map<string, string>([
  ['Special Art Rare', 'SAR'],
  ['Special Illustration Rare', 'SAR'],
  ['Art Rare', 'AR'],
  ['Illustration Rare', 'AR'],
  ['Super Rare', 'SR'],
  ['Secret Rare', 'SR'],
  ['Double Rare', 'RR'],
  ['Triple Rare', 'RRR'],
  ['Ultra Rare', 'UR'],
  ['Hyper Rare', 'HR'],
  ['Shiny Rare', 'S'],
  ['Shiny Secret Rare', 'SSR'],
  ['Shiny Holo Rare', 'S'],
  ['Character Rare', 'CHR'],
  ['Character Super Rare', 'CSR'],
  ['Mega Ultra Rare', 'MUR'],
  ['Mega Hyper Rare', 'MHR'],
  ['Mega Attack Rare', 'MAR'],
  ['ACE SPEC Rare', 'ACE'],
  ['Prism Rare', 'PR'],
  ['Promo', '프로모'],
  ['Radiant Rare', '찬란'],
])

// ⚠️ 짧은 이름은 다른 이름 속에 끼어든다("뮤"가 "뮤츠"에, "삐"가 "삐삐"에).
//    그렇다고 두 글자를 통째로 빼면 **뮤츠·팬텀·후딘·핫삼·럭키·윈디가 통째로 빠진다.**
//    그래서 길이가 아니라 **끼어드는지**로 가른다(2026-08-08에 고침. 그전엔 길이로 잘라
//    "뮤츠 U"를 쳐도 아무것도 안 떴다. 넓혀 보니 200가지가 늘고 깨진 것은 0가지였다).
// ⚠️ server/api.ts의 레어도포켓몬과 **같은 규칙이어야 한다.** 한쪽만 고치면 손으로 만든
//    목록과 서버가 매일 만드는 목록이 어긋난다.
const 전체이름 = (
  JSON.parse(readFileSync(path.join(ROOT, 'src/data/pokemonNames.json'), 'utf8')) as { ko: string }[]
)
  .map((p) => p.ko)
  .filter(Boolean)
const 포켓몬이름들 = 전체이름.filter(
  (n) => n.length >= 3 || !전체이름.some((m) => m !== n && m.includes(n)),
)

// ⚠️ **고르는 방법까지 server/api.ts의 속포켓몬과 똑같아야 한다.** 예전엔 여기서
//    "전부 훑어 가장 긴 것"을 골랐는데, 길이가 같을 때 고르는 쪽이 서버와 달라
//    3가지가 어긋났다("토게피 & 삐 & 푸푸린 GX"를 서버는 토게피로, 여기선 푸푸린으로).
//    이름을 긴 조각부터 잘라 보는 방식이면 **먼저 나온 쪽**으로 자연히 통일된다.
const 이름집합 = new Set(포켓몬이름들)
const 이름최대 = Math.max(...포켓몬이름들.map((n) => n.length))
const 이름최소 = Math.min(...포켓몬이름들.map((n) => n.length))
function 속포켓몬(ko: string): string | null {
  const 끝 = Math.min(ko.length, 이름최대)
  for (let len = 끝; len >= 이름최소; len--) {
    for (let i = 0; i + len <= ko.length; i++) {
      const 조각 = ko.slice(i, i + len)
      if (이름집합.has(조각)) return 조각
    }
  }
  return null
}

const 줄 = readFileSync(들어온곳, 'utf8').split('\n')
const 머리 = 줄자르기(줄[0])
const I = Object.fromEntries(머리.map((k, i) => [k.trim(), i])) as Record<string, number>
for (const k of ['name', 'rarity', 'language']) {
  if (I[k] === undefined) {
    console.error(`열 "${k}"가 없습니다. 열 이름: ${머리.join(', ')}`)
    process.exit(1)
  }
}

const 짝 = new Map<string, Set<string>>()
let 본것 = 0
for (let i = 1; i < 줄.length; i++) {
  if (!줄[i].trim()) continue
  const c = 줄자르기(줄[i])
  const code = 코드.get(String(c[I.rarity] ?? '').trim())
  if (!code) continue
  본것++
  const ed = String(c[I.language] ?? '').trim() === 'japanese' ? 'ja' : 'en'
  const ko = koName(ed, String(c[I.name] ?? ''))
  // ⚠️ **이름 안에 든 포켓몬**에 붙인다. 정확히 같은 것만 보면 MUR이 하나도 안 붙는다 —
  //    MUR 카드는 "메가리자몽 X ex"이지 "리자몽"이 아니기 때문이다(2026-08-08).
  //    검색은 이름이 들어 있기만 하면 찾으므로("리자몽 MUR" → 메가리자몽 X ex 1장),
  //    포함으로 잡는 게 맞다.
  // ⚠️ **가장 긴 것 하나만** 고른다. "리자드"와 "리자몽"이 둘 다 걸리는 이름에서
  //    짧은 쪽에 붙이면 엉뚱한 추천이 된다.
  const 기본 = 속포켓몬(ko)
  if (!기본) continue
  if (!짝.has(기본)) 짝.set(기본, new Set())
  짝.get(기본)!.add(code)
}

const 결과: Record<string, string[]> = {}
for (const [ko, codes] of [...짝.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
  결과[ko] = [...codes].sort()
}
const 나온곳 = path.join(ROOT, 'src/data/rarityByName.json')
writeFileSync(나온곳, JSON.stringify(결과))
const 총 = Object.values(결과).reduce((a, v) => a + v.length, 0)
console.log(`레어도가 있는 줄 ${본것.toLocaleString()}개에서`)
console.log(`  포켓몬 ${Object.keys(결과).length.toLocaleString()}종 · "이름 + 코드" ${총.toLocaleString()}가지`)
console.log(`  ${path.relative(ROOT, 나온곳)} (${(Buffer.byteLength(JSON.stringify(결과)) / 1024).toFixed(0)}KB)`)
for (const q of ['리자몽', '피카츄', '블래키']) {
  if (결과[q]) console.log(`    ${q} → ${결과[q].join(' · ')}`)
}
