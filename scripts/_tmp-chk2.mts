import { koName } from '../src/lib/koCardName.ts'
import { readdirSync, readFileSync } from 'node:fs'

const 찾을것 = /Rapid Strike Energy|Ancient Booster Energy|Black Belt's Training|Professor Sada's Vitality|Technical Machine: |Larry's Staraptor|Larry's Komala|Zinnia's Resolve/
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json')) continue
  let d: any
  try {
    d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf-8'))
  } catch {
    continue
  }
  const cards = Array.isArray(d) ? d : d?.cards
  if (!Array.isArray(cards)) continue
  const ed = f.startsWith('ja-') ? 'ja' : 'en'
  for (const c of cards) {
    const n = c?.name
    if (typeof n !== 'string' || !찾을것.test(n)) continue
    console.log(`${koName(ed, n).padEnd(46)} ← ${n}`)
  }
}
