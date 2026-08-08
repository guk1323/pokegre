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
const 영문나온곳 = path.join(ROOT, 'src/data/cardNamesEn.json')

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf8')) as {
  slug: string
  ed: 'ja' | 'en'
  id?: string
  name?: string
  serie?: string
}[]

const 이름들 = new Set<string>()
// ── 영문 이름 ────────────────────────────────────────────────────────────────
// ⚠️ **영문으로 치는 사람에게 목록이 통째로 비어 있었다.** 아래 한글 걸러내기 때문에
//    "Charizard"·"pikachu"·"Mega"를 치면 우리 사전에서 한 줄도 안 나왔고, 그 자리를
//    스니커덩크가 메우고 있었다. 그런데 실제 인기 검색어 2~5위가 Pikachu XY95 ·
//    Pikachu · Charizard 136 · Charizard다. 방문자가 친 말 952가지로 재 보니
//    **치는 도중 16.1%가 영문**이었다(2026-08-08 실측).
//    영문판 세트의 원래 이름을 그대로 담는다 — 4,651가지·69KB뿐이다.
// ⚠️ 일본판 세트의 name은 일본어라 안 담는다(영문으로 치는 사람에게 쓸모가 없다).
// 영문 이름은 **몇 개 세트에 나왔는지**를 같이 센다. 아래에서 표기가 갈릴 때 쓴다.
const 영문세트수 = new Map<string, Set<string>>()
for (const s of idx) {
  const d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf8')) as {
    cards?: { name: string }[]
  }
  for (const c of d.cards ?? []) {
    const n = koName(s.ed, c.name)
    // 한글이 하나도 없는 이름(번역이 안 된 것)은 **한글 목록에는** 넣지 않는다 —
    // 한글로 치는 사람에게 안 잡히고, 한글 목록에 영문만 뜨면 어긋나 보인다.
    if (n && /[가-힣]/.test(n)) 이름들.add(n)
    if (s.ed === 'en' && c.name && /[A-Za-z]/.test(c.name)) {
      let 것 = 영문세트수.get(c.name)
      if (!것) 영문세트수.set(c.name, (것 = new Set()))
      것.add(s.slug)
    }
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
// (운영 인기 검색어에 "제크로무 ex SR"이 20회 올라 있다).
//
// ⚠️ 재료는 **저쪽(PPT) 덤프에서 뽑은 대조표**(src/data/rarityByName.json)다.
//    우리 세트 자료로 만들면 안 된다 — 두 자료가 같은 카드를 다르게 부른다.
//      메가리자몽Xex M2 116/080 : 우리 "Ultra Rare" ↔ 저쪽 "Mega Ultra Rare"(MUR)
//    그래서 예전엔 "리자몽 MUR"이 자동완성에 안 떴다(2026-08-08에 고침).
//    대조표를 다시 만들려면 scripts/gen-rarity-from-dump.mts 를 볼 것.
const 레어도표 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/rarityByName.json'), 'utf8')) as Record<
  string,
  string[]
>
const 레어도짝 = new Set<string>()
for (const [이름, codes] of Object.entries(레어도표)) {
  for (const code of codes) 레어도짝.add(`${이름} ${code}`)
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

// ── 영문 세트 이름·시리즈·세트 코드 ─────────────────────────────────────────
// ⚠️ **영문으로 세트를 찾는 사람이 있다.** 방문자가 친 영문 검색어 260번을 훑어 보니
//    "25th Anniversary"·"XY Promos"·"crown zenith"·"pitch black"처럼 **세트 이름**이
//    적지 않았고, 우리 사전에는 한글 팩 이름만 있어 목록이 통째로 비었다.
//    넣으면 빈 목록 100번 중 12번이 메워진다(2026-08-08 실측).
// ⚠️ 세트 코드도 넣는다("bw3"·"sv-p"처럼 코드로 치는 사람이 있다). 두 글자짜리는
//    아무 데나 걸리므로 **세 글자부터**만 담는다.
// ⚠️ 시리즈 이름(Mega Evolution)도 담는다 — 세트가 아니라 묶음으로 찾는 사람이 있다.
// ⚠️ **판으로 가르면 안 된다.** "25th Anniversary"는 **일본판(S8a) 세트인데 이름이 영어**다.
//    영문판만 담았더니 정작 세 번이나 검색된 이 이름이 빠졌다. 글자로 가른다 —
//    한글도 일본어도 안 섞인 이름이면 담는다.
// ⚠️ **이미 담긴 이름을 덮지 않는다.** 카드 이름과 세트 이름이 같을 수 있는데
//    (예: "Pitch Black"), 덮어쓰면 "몇 개 세트에 나왔나"가 1로 줄어 아래 표기 고르기가
//    엉뚱해진다.
const 일본글자 = /[ぁ-んァ-ヶ一-龯]/
for (const s of idx) {
  const 담기 = (t?: string) => {
    const v = (t ?? '').trim()
    if (v.length < 3 || !/[A-Za-z]/.test(v) || /[가-힣]/.test(v) || 일본글자.test(v)) return
    const 것 = 영문세트수.get(v)
    if (것) 것.add(s.slug)
    else 영문세트수.set(v, new Set([s.slug]))
  }
  담기(s.name)
  담기(s.serie)
  // "SV: Scarlet & Violet 151"처럼 앞머리가 붙은 이름은 뒤쪽만 치는 사람이 많다.
  담기(s.name?.split(/\s*:\s*/).pop())
  // 세트 코드는 판을 안 가린다(일본판도 "sv1a"로 친다). 대소문자는 찾을 때 안 가린다.
  담기(s.id)
}

// ⚠️ **영문도 띄어쓰기·붙임표만 다른 짝을 합친다.** 같은 카드가 세트마다 다르게 적혀
//    있다 — "Pikachu EX" ↔ "Pikachu-EX", "Ho Oh" ↔ "Ho-Oh". 목록에 둘 다 뜨면 고장 난
//    것처럼 보인다(2026-08-08 점검에서 잡음).
//    ⚠️ **한글처럼 "띄어쓰기가 있는 쪽"을 남기면 안 된다.** 영문은 붙임표가 정식인
//       이름이 많다(Ho-Oh · Porygon-Z · Jangmo-o). 그 규칙이면 11개 세트가 쓰는
//       "Ho-Oh"를 버리고 1개 세트에만 있는 "Ho Oh"를 남긴다.
//       → **더 많은 세트에 나온 표기**를 남긴다. 그게 곧 흔히 쓰는 표기다.
//       같은 수면 붙임표가 있는 쪽(공식 표기가 그런 경우가 많다), 그다음 짧은 쪽.
//    ⚠️⚠️ **대소문자는 절대 합치지 말 것.** "Ho-oh ↔ Ho-Oh"가 나란히 떠서 합치고
//       싶어지는데, 대소문자만 다른 짝 93무리를 전수로 봤더니 **진짜 오타는 그 하나뿐**이고
//       나머지 92무리는 **서로 다른 카드**였다(2026-08-08 확인):
//         Absol ex(2023 요즘) ↔ Absol EX(2004)  ·  Mew ex(8세트) ↔ Mew-EX(2013, 2세트)
//       합치면 이 92쌍 중 한쪽이 목록에서 통째로 사라진다. 오타 하나를 고치려다
//       멀쩡한 카드 92종을 잃는 것이라, **그냥 둔다.**
const 영문대표 = new Map<string, string>()
for (const [이름, 세트들] of 영문세트수) {
  const k = 이름.replace(/[\s-]/g, '')
  const 이전 = 영문대표.get(k)
  if (!이전) {
    영문대표.set(k, 이름)
    continue
  }
  const a = 세트들.size
  const b = 영문세트수.get(이전)!.size
  const 붙임 = (t: string) => (t.includes('-') ? 1 : 0)
  if (a > b || (a === b && 붙임(이름) > 붙임(이전)) || (a === b && 붙임(이름) === 붙임(이전) && 이름.length < 이전.length)) {
    영문대표.set(k, 이름)
  }
}
// 영문도 **짧은 것부터**. 이유는 위 한글과 같다(앞에서 잘라 보여 주므로 순서가 곧 목록이다).
const 영문목록 = [...영문대표.values()].sort((a, b) => a.length - b.length || a.localeCompare(b, 'en'))
writeFileSync(영문나온곳, JSON.stringify(영문목록))
const 영문KB = (Buffer.byteLength(JSON.stringify(영문목록)) / 1024).toFixed(0)
console.log(`영문 이름 ${영문목록.length.toLocaleString()}가지를 ${path.relative(ROOT, 영문나온곳)}에 적었습니다 (${영문KB}KB).`)
