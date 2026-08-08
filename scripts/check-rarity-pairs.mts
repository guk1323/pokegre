/**
 * 우리 세트 자료의 레어도와 저쪽(PPT) 레어도가 **같은 코드로 이어지는지** 본다.
 *
 * 둘은 같은 레어도를 다르게 부른다(일본판 "Art Rare" ↔ 영문판 "Illustration Rare").
 * 그래서 이름이 다른 것 자체는 문제가 아니다. 문제는 **한쪽만 코드표에 있는 것**이다 —
 * 그러면 그 레어도로 거를 때 한쪽 탭에서만 카드가 나온다.
 *
 * **2026-08-08 결과: 카드가 섞인 것은 아니다.** 두 자료가 같은 레어도를 다르게
 * 부르는 것이다. 다만 우리 코드표가 양쪽 말을 서로 다른 코드로 잇는 곳이 있다:
 *     맞춰본 카드 25,675장 · 코드가 갈리는 것 882장 · 한쪽만 코드가 있는 것 812장
 *     보기: 우리 "Double rare"(RR) ↔ 저쪽 "Ultra Rare"(UR)  250장
 * 그래서 레어도로 거를 때 세트 화면과 시세 화면의 결과가 갈릴 수 있다.
 *
 * ⚠️ **어느 쪽이 맞다고 함부로 정하지 말 것.** 우리 자료(TCGdex)는 시대와 상관없이
 *    "Double rare"로 통일해 적는다 — 2023년 스칼렛&바이올렛 전 세트에도 1,029장이
 *    그렇게 적혀 있다. 저쪽은 그 시절 표기("Ultra Rare")를 쓴다. 둘 다 나름의 규칙이라
 *    무엇을 우리 기준으로 삼을지는 사람이 정해야 한다.
 *
 * 실행: node --experimental-strip-types scripts/check-rarity-pairs.mts <cards.csv>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PPT레어도별코드 } from '../src/lib/rarityCode.ts'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2] ?? '/data/export-cards.csv'
// ⚠️ PPT레어도별코드는 **Map**이다(레어도이름 → 코드). Object.entries로 읽으면 빈 것이
//    되어 "0장"이 나온다 — 처음에 그렇게 헛것을 봤다.
const 코드표 = new Map<string, string>()
for (const [이름, 코드] of PPT레어도별코드) 코드표.set(String(이름).toLowerCase(), 코드)
const 코드 = (r: string) => 코드표.get(String(r).trim().toLowerCase()) ?? ''

function 칸쪼개기(줄: string): string[] {
  const 칸: string[] = []
  let 지금 = ''
  let q = false
  for (let i = 0; i < 줄.length; i++) {
    const c = 줄[i]
    if (c === '"') { if (q && 줄[i + 1] === '"') { 지금 += c; i++ } else q = !q }
    else if (c === ',' && !q) { 칸.push(지금); 지금 = '' } else 지금 += c
  }
  칸.push(지금)
  return 칸
}

const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const 머리 = 칸쪼개기(줄들[0])
const I = { set: 머리.indexOf('setName'), num: 머리.indexOf('cardNumber'), rar: 머리.indexOf('rarity') }
const 이름to = new Map(Object.entries(pptSetNames as Record<string, string>).map(([k, v]) => [v, k]))
const 저쪽 = new Map<string, string>()
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸쪼개기(줄들[i])
  const slug = 이름to.get(f[I.set])
  if (!slug) continue
  const n = String(f[I.num] ?? '').split('/')[0].replace(/^0+/, '') || '0'
  const k = `${slug}|${n}`
  if (!저쪽.has(k)) 저쪽.set(k, f[I.rar] ?? '')
}

const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
let 잼 = 0, 같은코드 = 0
const 한쪽만 = new Map<string, number>()
const 코드다름 = new Map<string, number>()
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'ko-index.json') continue
  const slug = f.replace('.json', '')
  const cards = (JSON.parse(readFileSync(join(dir, f), 'utf8')).cards ?? []) as { n?: string; r?: string }[]
  for (const c of cards) {
    const 우리 = String(c.r ?? '')
    const 저 = 저쪽.get(`${slug}|${String(c.n).replace(/^0+/, '')}`)
    if (!우리 || !저 || 우리 === 'None' || 저 === 'None') continue
    잼++
    const a = 코드(우리), b = 코드(저)
    if (a && b && a === b) 같은코드++
    else if (a && !b) 한쪽만.set(`저쪽 "${저}"가 코드표에 없다 (우리 "${우리}"=${a})`, (한쪽만.get(`저쪽 "${저}"가 코드표에 없다 (우리 "${우리}"=${a})`) ?? 0) + 1)
    else if (!a && b) 한쪽만.set(`우리 "${우리}"가 코드표에 없다 (저쪽 "${저}"=${b})`, (한쪽만.get(`우리 "${우리}"가 코드표에 없다 (저쪽 "${저}"=${b})`) ?? 0) + 1)
    else if (a && b) 코드다름.set(`${우리}(${a}) ↔ ${저}(${b})`, (코드다름.get(`${우리}(${a}) ↔ ${저}(${b})`) ?? 0) + 1)
  }
}
console.log(`맞춰본 카드 ${잼.toLocaleString()}장 · 같은 코드 ${같은코드.toLocaleString()}`)
console.log(`\n[코드가 서로 다름 — 거를 때 결과가 갈린다] ${[...코드다름.values()].reduce((a, b) => a + b, 0)}장`)
for (const [k, v] of [...코드다름].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(v).padStart(5)}장  ${k}`)
console.log(`\n[한쪽만 코드표에 있음] ${[...한쪽만.values()].reduce((a, b) => a + b, 0)}장`)
for (const [k, v] of [...한쪽만].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(v).padStart(5)}장  ${k}`)
