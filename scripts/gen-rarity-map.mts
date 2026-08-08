/**
 * **저쪽(PPT) 레어도 → 우리 레어도** 대응표를 실제 카드로 세어서 만든다.
 *
 * 왜 필요한가 — 우리 카드 40,489장 중 **11,169장(27.6%)에 레어도가 없다.** 원본
 * 자료가 안 준 것이다. 덤프에는 그중 8,233장의 레어도가 있는데, 저쪽 표기가 우리와
 * 달라서(“Art Rare” ↔ “Illustration rare”) 그대로 넣으면 안 된다.
 *
 * ⚠️ **대응을 지어내지 않는다.** 양쪽 다 레어도가 있는 카드를 세어, 저쪽 이름마다 우리
 *    이름이 무엇이었는지 본다. 100%로 갈리는 것만 믿는다 — 아래 MIN_확신.
 *    확신이 낮은 것은 진짜로 여러 등급에 걸쳐 있다는 뜻이다("Hyper Rare"는 우리 자료에서
 *    Rare 46%·Secret Rare·Ultra Rare로 갈린다). 그런 건 채우면 안 된다.
 *
 * 실행: node --experimental-strip-types scripts/gen-rarity-map.mts <cards.csv>
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2] ?? '/data/export-cards.csv'
// 이보다 덜 한쪽으로 쏠리면 안 믿는다. 실제로 100%인 것과 40%대인 것이 뚜렷이 갈린다.
const MIN_확신 = 0.95
const MIN_표본 = 20

function 칸(줄: string): string[] {
  const r: string[] = []
  let c = ''
  let q = false
  for (let i = 0; i < 줄.length; i++) {
    const ch = 줄[i]
    if (ch === '"') { if (q && 줄[i + 1] === '"') { c += ch; i++ } else q = !q }
    else if (ch === ',' && !q) { r.push(c); c = '' } else c += ch
  }
  r.push(c)
  return r
}

const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const H = 칸(줄들[0])
const I = { set: H.indexOf('setName'), num: H.indexOf('cardNumber'), rar: H.indexOf('rarity') }
const 이름to = new Map(Object.entries(pptSetNames as Record<string, string>).map(([k, v]) => [v, k]))
const 저쪽 = new Map<string, string>()
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸(줄들[i])
  const slug = 이름to.get(f[I.set])
  if (!slug) continue
  const n = String(f[I.num] ?? '').split('/')[0].replace(/^0+(?=.)/, '')
  if (!n) continue
  const k = `${slug}|${n}`
  if (!저쪽.has(k) && f[I.rar]) 저쪽.set(k, f[I.rar])
}

const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const 짝 = new Map<string, Map<string, number>>()
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'ko-index.json') continue
  const slug = f.replace('.json', '')
  for (const c of (JSON.parse(readFileSync(join(dir, f), 'utf8')).cards ?? []) as { n: string; r?: string }[]) {
    if (!c.r || c.r === 'None') continue
    const r = 저쪽.get(`${slug}|${String(c.n).replace(/^0+(?=.)/, '')}`)
    if (!r || r === 'None') continue
    const m = 짝.get(r) ?? new Map<string, number>()
    m.set(c.r, (m.get(c.r) ?? 0) + 1)
    짝.set(r, m)
  }
}

const 표: Record<string, string> = {}
const 못믿음: string[] = []
for (const [저, m] of 짝) {
  const 합 = [...m.values()].reduce((a, b) => a + b, 0)
  const [우리, n] = [...m].sort((a, b) => b[1] - a[1])[0]
  if (합 >= MIN_표본 && n / 합 >= MIN_확신) 표[저] = 우리
  else 못믿음.push(`${저} → ${우리} ${(((n / 합) * 100) | 0)}% (${n}/${합})`)
}
writeFileSync(join(ROOT, 'src/data/rarityPptToOurs.json'), JSON.stringify(표, null, 0) + '\n')
console.log(`믿을 만한 대응 ${Object.keys(표).length}가지를 src/data/rarityPptToOurs.json에 적었습니다.`)
for (const [a, b] of Object.entries(표)) console.log(`   ${a.padEnd(28)}→ ${b}`)
console.log(`\n확신이 낮아 뺀 것 ${못믿음.length}가지 — 진짜로 여러 등급에 걸쳐 있다:`)
for (const x of 못믿음) console.log(`   ${x}`)
