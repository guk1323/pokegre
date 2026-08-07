// 우리 카드 데이터를 **PPT 전체 시세 덤프(CSV)와 통째로 대조**한다.
//
// 왜: /export는 58,000장을 한 파일로 준다(Business). 크레딧을 더 안 쓰고 우리 데이터
// 전부를 견줄 수 있다 — 우리에게 있는 카드가 저쪽에도 있는지, 번호가 서로 맞는지,
// 우리만 있거나 저쪽만 있는 카드가 어디에 몰려 있는지.
//
// 쓰는 법: npx tsx scripts/check-vs-ppt-dump.mts <cards.csv 경로>
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '..')
const CSV = process.argv[2]
if (!CSV) { console.log('  cards.csv(.gz) 경로를 주세요'); process.exit(1) }

const splitCsvLine = (line: string): string[] => {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}
const 자름 = (n: string) => String(n).split('/')[0].trim().replace(/^0+/, '') || '0'

const raw = readFileSync(CSV)
const text = CSV.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
const lines = text.split('\n')
const head = splitCsvLine(lines[0])
const I = Object.fromEntries(head.map((k, i) => [k.trim(), i])) as Record<string, number>

// PPT 쪽: 세트이름 → (번호 → 이름)
const 저쪽 = new Map<string, Map<string, string>>()
for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue
  const c = splitCsvLine(lines[i])
  const set = c[I.setName]
  const num = 자름(String(c[I.cardNumber] ?? ''))
  if (!set || !num) continue
  const m = 저쪽.get(set) ?? new Map<string, string>()
  if (!m.has(num)) m.set(num, String(c[I.name] ?? ''))
  저쪽.set(set, m)
}

const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 표 = pptSetNames as Record<string, string>
let 대조한세트 = 0, 우리카드 = 0, 저쪽에있음 = 0
const 없는것: { slug: string; 없음: number; 총: number }[] = []
for (const s of sidx) {
  const ppt = 표[s.slug]
  if (!ppt || !저쪽.has(ppt)) continue
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  const 저 = 저쪽.get(ppt)!
  대조한세트++
  let 없음 = 0
  const cs = d.cards ?? []
  for (const c of cs) {
    우리카드++
    if (저.has(자름(String(c.n)))) 저쪽에있음++
    else 없음++
  }
  if (없음) 없는것.push({ slug: s.slug, 없음, 총: cs.length })
}
console.log(`\n  대조한 세트 ${대조한세트}개 · 우리 카드 ${우리카드.toLocaleString()}장`)
console.log(`  ✓ PPT에도 있음  ${저쪽에있음.toLocaleString()}장 (${((저쪽에있음 / 우리카드) * 100).toFixed(1)}%)`)
console.log(`  △ PPT에 없음    ${(우리카드 - 저쪽에있음).toLocaleString()}장\n`)
console.log('  [PPT에 없는 카드가 많은 세트 — 그 세트는 시세가 통째로 안 뜬다]')
없는것.sort((a, b) => b.없음 / b.총 - a.없음 / a.총)
없는것.slice(0, 15).forEach((x) => console.log(`      ${x.slug.padEnd(14)} ${x.없음}/${x.총}장 없음 (${Math.round((x.없음 / x.총) * 100)}%)`))
console.log('')
