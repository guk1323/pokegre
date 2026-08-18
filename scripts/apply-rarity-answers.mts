/**
 * 사장님이 채워 주신 레어도를 도감에 넣는다. 크레딧 0.
 *
 * 왜 손으로 받나 — 일본판 프로모·특전 카드는 **어느 DB에도 레어도가 없다**(PPT·TCGdex 둘 다
 * 빈 값). 실물에는 찍혀 있는데 자료가 없는 것이라, 사람이 확인해 주는 수밖에 없다
 * ([[pokegre-card-name-lookup-ask-user]]와 같은 방식 — 내가 뒤지면 너무 느리다).
 *
 * ⚠️⚠️ **순번으로 짚되 이름이 맞을 때만 넣는다.** 표는 `레어도-값비싼149장.md`를 만든
 *    그 차례(값 높은 순) 그대로다. 그래도 이름을 한 번 더 대 본다 — 표가 어긋나 있으면
 *    엉뚱한 카드에 레어도가 붙고, 그건 빈칸보다 나쁘다(사장님 지적 2026-08-12:
 *    "여기서 레어도가 틀리면 검색이 안되지 않아?").
 *
 * ⚠️ 넣은 카드에는 **`rSrc: 'hand'`**를 같이 적는다. 나중에 저쪽 자료가 생겼을 때
 *    「어느 것이 손으로 넣은 것인지」 가려 되돌릴 수 있어야 한다.
 *
 * ⚠️ 이미 레어도가 있는 카드는 안 건드린다.
 *
 * 쓰는 법: npx tsx scripts/apply-rarity-answers.mts <답표.tsv> [--write]
 *   답표 한 줄:  <순번>\t<이름>\t<레어도>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const 인자 = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const 답표길 = 인자[0]
// 표를 만들 때 쓴 값 구간. 1차는 100 이상, 2차는 50~99 였다 — 그 구간으로 다시 만들어야
// 순번이 맞는다. ⚠️ 여기가 어긋나면 전부 딴 카드에 붙는다.
const 낮은값 = Number(인자[1] ?? 100)
const 높은값 = Number(인자[2] ?? Infinity)
if (!답표길) {
  console.log('답표 파일을 주세요: npx tsx scripts/apply-rarity-answers.mts <답표.tsv> [--write]')
  process.exit(1)
}

const SETS = path.resolve('public/sets')
const idx = JSON.parse(readFileSync(path.resolve('card-index.json'), 'utf-8')) as {
  sets: Record<string, [string, string, string]>
  rows: string[][]
}
const 인쇄 = JSON.parse(readFileSync(path.resolve('data/printing-prices.json'), 'utf-8')) as Record<
  string,
  Record<string, { m: number }>
>
const 값 = (t: string) => {
  let m = 0
  for (const v of Object.values(인쇄[t] ?? {})) if (v.m > m) m = v.m
  return m
}

// ⚠️ **표를 만들 때와 똑같은 차례로 다시 만든다.** 여기가 어긋나면 전부 딴 카드에 붙는다.
const 표: { slug: string; n: string; ko: string; v: number }[] = []
for (const r of idx.rows) {
  if (r[9] && r[9] !== 'None') continue
  if (!r[7]) continue
  const v = 값(r[7])
  if (v < 낮은값 || v >= 높은값) continue
  표.push({ slug: r[0], n: r[1], ko: r[2], v })
}
표.sort((a, b) => b.v - a.v)
console.log(`표를 다시 만들었습니다 — ${표.length}장 (값 ${낮은값}~${높은값 === Infinity ? '위' : 높은값 - 1} · 표에 적힌 것과 같아야 한다)`)

const 이름열쇠 = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9ぁ-ヿ一-鿿가-힯]/g, '')

const 답 = readFileSync(path.resolve(답표길), 'utf-8')
  .split('\n')
  .map((l) => l.split('\t'))
  .filter((c) => c.length >= 3 && /^\d+$/.test(c[0].trim()))
  .map((c) => ({ i: Number(c[0].trim()), 이름: c[1].trim(), r: c[2].trim() }))
console.log(`답표 ${답.length}줄`)

// 세트 파일을 한 번만 읽고 한 번만 쓴다.
const 연것 = new Map<string, { cards: Record<string, unknown>[] }>()
const 열기 = (slug: string) => {
  let j = 연것.get(slug)
  if (!j) {
    j = JSON.parse(readFileSync(path.join(SETS, `${slug}.json`), 'utf-8'))
    연것.set(slug, j!)
  }
  return j!
}

let 넣음 = 0
const 어긋남: string[] = []
const 못찾음: string[] = []
for (const a of 답) {
  const t = 표[a.i - 1]
  if (!t) {
    어긋남.push(`#${a.i} — 표에 그 순번이 없다`)
    continue
  }
  // ⚠️ 이름이 다르면 **표가 어긋난 것**이다. 넣지 않는다.
  if (이름열쇠(t.ko) !== 이름열쇠(a.이름)) {
    어긋남.push(`#${a.i} — 표에는 「${t.ko}」인데 답에는 「${a.이름}」`)
    continue
  }
  const j = 열기(t.slug)
  const c = (j.cards ?? []).find((x) => String(x.n) === t.n)
  if (!c) {
    못찾음.push(`#${a.i} ${t.slug} n=${t.n} ${t.ko}`)
    continue
  }
  if (c.r && c.r !== 'None') continue // 이미 있으면 안 건드린다
  c.r = a.r
  c.rSrc = 'hand' // 손으로 넣었다는 표시 — 나중에 가려낼 수 있게
  넣음++
}

if (WRITE) for (const [slug, j] of 연것) writeFileSync(path.join(SETS, `${slug}.json`), JSON.stringify(j))

console.log()
console.log(WRITE ? '=== 넣었습니다 ===' : '=== 미리보기(파일은 안 건드림) ===')
console.log(`  넣은 카드      ${넣음}장`)
console.log(`  이름이 어긋나 건너뜀 ${어긋남.length}장`)
for (const x of 어긋남.slice(0, 10)) console.log(`     ${x}`)
console.log(`  세트 파일에서 못 찾음 ${못찾음.length}장`)
for (const x of 못찾음.slice(0, 10)) console.log(`     ${x}`)
if (!WRITE) console.log('\n  실제로 넣으려면 --write 를 붙여 다시 돌린다.')
else console.log('\n  ⚠️ 이어서 gen-card-index · gen-pokedex · gen-card-name-suggestions 를 다시 돌릴 것.')
