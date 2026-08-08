/**
 * **별칭이 가리키는 저쪽 카드를, 우리 세트의 다른 카드가 더 잘 맞나** 본다.
 *
 * 이름 뜻만 견주면(`check-alias-meaning.mts`) 번역 낱말이 다른 것까지 다 걸려서
 * ("Item Finder" 아이템탐지기 ↔ ダウジングマシーン 다우징머신 — 같은 카드다)
 * 진짜 섞임이 묻힌다. 여기서는 다르게 묻는다:
 *
 *     "저쪽 이름과 **똑같은** 우리 카드가 그 세트에 따로 있는가?"
 *
 * 있으면 별칭이 딴 카드를 가리키는 것이다 — 값이 통째로 바뀐다.
 * 2026-08-08에 이걸로 ja-MC에서 3장을 찾았다:
 *     051 アイアント(아이앤트)      → "Durant ex"          (진짜는 052 アイアントex)
 *     275 カイデン(찌리비)          → "Iono's Wattrel"     (진짜는 278 ナンジャモのカイデン)
 *     276 タイカイデン(찌리비크)     → "Iono's Kilowattrel" (진짜는 279)
 * 셋 다 **맨몸 카드가 ex·서포트 붙은 비싼 카드의 값**을 받고 있었다.
 *
 * 실행: npx tsx scripts/check-alias-better-match.mts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 별칭 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/setCardNumberAlias.json'), 'utf8')) as Record<
  string,
  Record<string, string>
>
// 같은 이름을 가르려고 저쪽이 붙이는 꼬리. 뜻과 상관없다.
const 꼬리떼기 = (s: string) =>
  s.replace(/\s*\((Lv\.\d+|[UCR]|Holo|Non ?Holo|Reverse|Mirror Holo|Cosmos Holo|\d{4} Unnumbered)\)\s*$/i, '')
    .replace(/\s*-\s*[A-Za-z]*\d+\s*$/, '')
    .trim()
const 벗 = (s: string) => s.replace(/[\s·'’\-—()]/g, '').toLowerCase()

const 문제: string[] = []
let 잼 = 0
for (const [slug, 표] of Object.entries(별칭)) {
  let cards: { n?: string; name?: string }[] = []
  try {
    cards = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${slug}.json`), 'utf8')).cards ?? []
  } catch {
    continue
  }
  // 세트 안 모든 카드의 한글 이름을 미리 만들어 둔다.
  const 한글 = cards.map((c) => ({ n: String(c.n ?? ''), 원: String(c.name ?? ''), ko: 벗(koreanizeEnglishCardName(koreanizeTitle(String(c.name ?? '')))) }))
  for (const [n, v] of Object.entries(표)) {
    if (!String(v).startsWith('NAME:')) continue
    const 저 = 꼬리떼기(String(v).slice(5))
    const 저ko = 벗(koreanizeEnglishCardName(저))
    if (!/[가-힣]/.test(저ko)) continue
    const 이것 = 한글.find((x) => x.n === n)
    if (!이것 || !이것.ko) continue
    잼++
    if (이것.ko === 저ko) continue // 이미 딱 맞는다
    // 저쪽 이름과 **똑같은** 우리 카드가 따로 있나?
    const 더맞음 = 한글.filter((x) => x.n !== n && x.ko === 저ko)
    if (!더맞음.length) continue
    문제.push(
      `  ${slug.padEnd(9)} ${n.padEnd(5)} "${이것.원}"  ←  저쪽 "${저}"\n` +
        `${' '.repeat(19)}그런데 저쪽 이름과 똑같은 우리 카드가 있다: ${더맞음.map((x) => `${x.n} "${x.원}"`).join(' · ')}`,
    )
  }
}
console.log(`이름으로 짝지은 별칭 ${잼}개를 봤다 · 딴 카드를 가리키는 것 ${문제.length}개`)
for (const x of 문제) console.log(x)
