// 자동완성 재료 만들기 — 우리가 가진 **실제 카드 이름**을 뽑아 한 파일로 모은다.
//
// 왜 필요한가: 자동완성이 포켓몬 이름·팩 이름·일부 카드명 사전만 재료로 써서 너무
// 얇았다. "블래키"를 치면 우리 목록은 **1가지**뿐이었고(블래키 ex), 그 자리를 스니커덩크
// 자동완성(사람들이 친 검색어)이 메우고 있었다. 그쪽 목록에는 "MUR"·"구뒷면" 같은 그
// 마켓 말과 "블래키vmax sa" 같은 오타가 섞여 있다(2026-08-07 실측).
// 정작 우리는 40,489장의 카드 이름을 이미 갖고 있다 — 그걸 쓰면 우리 것이 더 낫다.
//
// 결과: public/sets/*.json 전체 → 서로 다른 한글 이름 약 5,600가지(약 100KB).
// 이 파일은 검색창을 누를 때만 받는다(localSuggestions가 동적 import 대상이다).
//
// 다시 만들기:  node --experimental-strip-types scripts/gen-card-name-suggestions.mts
// ⚠️ 세트를 추가하면 다시 돌릴 것. 안 돌리면 새 세트 카드가 자동완성에 안 뜬다.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/koCardName.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 나온곳 = path.join(ROOT, 'src/data/cardNamesKo.json')

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf8')) as {
  slug: string
  ed: 'ja' | 'en'
}[]

const 이름들 = new Set<string>()
for (const s of idx) {
  const d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf8')) as {
    cards?: { name: string }[]
  }
  for (const c of d.cards ?? []) {
    const n = koName(s.ed, c.name)
    // 한글이 하나도 없는 이름(번역이 안 된 것)은 넣지 않는다 — 한글로 치는 사람에게
    // 안 잡히고, 목록에 영문만 뜨면 우리 사전이 부실해 보인다.
    if (n && /[가-힣]/.test(n)) 이름들.add(n)
  }
}

// ⚠️ **띄어쓰기·붙임표만 다른 짝을 합친다.** 같은 카드 이름이 세트마다 다르게 적혀
//    있어서("개굴닌자BREAK" ↔ "개굴닌자 BREAK", "블래키-GX" ↔ "블래키 GX") 목록에
//    둘 다 뜨면 고장 난 것처럼 보인다. 251무리·254가지가 그렇다(2026-08-07 실측).
//    ⚠️ **대소문자는 합치지 않는다** — "블래키 ex"(요즘)와 "블래키 EX"(2000년대)는
//       진짜 다른 카드다.
//    남길 쪽은 **띄어쓰기가 있는 것**을 고른다. 사람이 읽기 쉽고 검색도 잘 된다.
const 열쇠 = (s: string) => s.replace(/[\s-]/g, '')
const 대표: Map<string, string> = new Map()
for (const n of 이름들) {
  const k = 열쇠(n)
  const 이전 = 대표.get(k)
  if (!이전) {
    대표.set(k, n)
    continue
  }
  const 띈수 = (t: string) => (t.match(/\s/g) ?? []).length
  if (띈수(n) > 띈수(이전) || (띈수(n) === 띈수(이전) && n.length < 이전.length)) 대표.set(k, n)
}

// ⚠️ **짧은 것부터** 담는다. 자동완성은 앞에서 잘라 8개만 보여주므로, 순서가 곧
//    "무엇을 보여줄지"다. "블래키 V"가 "블래키 & 다크라이 GX"보다 먼저 와야 한다
//    — 사람이 찾는 건 대개 짧고 흔한 쪽이다.
const 이름목록 = [...대표.values()].sort((a, b) => a.length - b.length || a.localeCompare(b, 'ko'))

// ── "포켓몬 + 레어도" ────────────────────────────────────────────────────────
// 사람들은 카드 이름을 정확히 모르는 채로 "리자몽 SAR"처럼 **레어도로 좁혀서** 찾는다
// (운영 인기 검색어에 "제크로무 ex SR"이 20회 올라 있다). 우리는 카드마다 레어도를
// 갖고 있으면서 짧은 코드로 바꾸는 표가 없어 못 만들고 있었다 — 그 자리를 스니커덩크
// 자동완성이 메우고 있었다.
// ⚠️ **기본 포켓몬 이름일 때만** 붙인다. "리자몽 V RR"까지 넣으면 4,374가지가 되어
//    목록 여덟 칸을 조합이 다 차지하고 진짜 카드 이름이 밀려난다. 지금은 1,390가지다.
// ⚠️ 이 코드들은 **세 마켓에 다 통한다**(2026-08-08 실측: Charizard SAR → PPT 7장,
//    스니커덩크도 좁혀진다). 마켓 하나에서만 통하는 말(MUR·구뒷면)은 안 만든다.
const 레어도코드 = new Map([
  ['Special illustration rare', 'SAR'],
  ['Illustration rare', 'AR'],
  ['Secret Rare', 'SR'],
  ['Double rare', 'RR'],
  ['Hyper rare', 'UR'],
  ['Shiny Ultra Rare', 'SSR'],
  ['Shiny rare', 'S'],
  ['ACE SPEC Rare', 'ACE'],
  ['Promo', '프로모'],
])
const 포켓몬이름 = new Set(
  (JSON.parse(readFileSync(path.join(ROOT, 'src/data/pokemonNames.json'), 'utf8')) as { ko: string }[]).map((p) => p.ko),
)
const 레어도짝 = new Set<string>()
for (const s of idx) {
  const d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf8')) as {
    cards?: { name: string; r?: string }[]
  }
  for (const c of d.cards ?? []) {
    const code = c.r ? 레어도코드.get(c.r) : undefined
    if (!code) continue
    const n = koName(s.ed, c.name)
    if (!포켓몬이름.has(n)) continue
    레어도짝.add(`${n} ${code}`)
  }
}
// ⚠️ **카드 이름 뒤에 붙인다.** 앞에 두면 "리자몽 AR"이 "리자몽 V"보다 먼저 뜬다 —
//    사람이 먼저 찾는 건 카드 이름이다.
const 목록 = [
  ...이름목록,
  ...[...레어도짝].sort((a, b) => a.length - b.length || a.localeCompare(b, 'ko')),
]

writeFileSync(나온곳, JSON.stringify(목록))
const KB = (Buffer.byteLength(JSON.stringify(목록)) / 1024).toFixed(0)
console.log(`카드 이름 ${목록.length.toLocaleString()}가지를 ${path.relative(ROOT, 나온곳)}에 적었습니다 (${KB}KB).`)
