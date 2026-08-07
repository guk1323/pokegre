// PPT가 **번호를 안 주는 세트**의 카드를, 이름으로 짝지어 번호 표를 만든다.
//
// 왜: 옛 일본판(PMCG·neo)과 몇몇 세트는 PPT에 시세가 멀쩡히 있는데 cardNumber 칸이
// 비어 있다. 번호가 없으면 "이 시세가 그 카드 것"이라고 붙일 수 없어, 화면엔
// '찾지 못해 같은 이름의 다른 카드를 보여 드립니다'가 뜬다(2026-08-07 덤프 대조).
//
// 어떻게: 우리 카드 이름(일본어)을 포켓몬 이름 사전으로 영문으로 바꾸고, PPT 쪽
// 번호 없는 카드의 이름과 견준다. **양쪽 모두 그 이름이 딱 한 장일 때만** 짝짓는다 —
// 같은 이름이 여러 장이면 어느 것인지 가릴 수 없고, 틀린 값을 붙이느니 빈칸이 낫다.
//
// ⚠️ 트레이너·굿즈는 사전이 없어 짝지을 수 없다(683장). 포켓몬만 다룬다.
// ⚠️ PPT 쪽 "번호"는 실제 번호가 아니라 **이름 그 자체**를 열쇠로 쓴다(NAME: 접두사).
//    번호가 없는 데이터라 다른 방법이 없다.
//
// 쓰는 법: npx tsx scripts/gen-set-card-number-alias.mts <cards.csv> [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '..')
const CSV = process.argv.find((a) => a.endsWith('.csv') || a.endsWith('.gz'))
const WRITE = process.argv.includes('--write')
if (!CSV) { console.log('  cards.csv(.gz) 경로를 주세요'); process.exit(1) }

const split = (l: string) => {
  const o: string[] = []
  let c = ''
  let q = false
  for (let i = 0; i < l.length; i++) {
    const ch = l[i]
    if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i++ } else if (ch === '"') q = false; else c += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { o.push(c); c = '' }
    else c += ch
  }
  o.push(c)
  return o
}
const 열쇠 = (s: string) => String(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')
const 자름 = (n: string) => String(n).split('/')[0].trim().replace(/^0+/, '') || '0'
const 몬 = (pokemonNames as { ja: string; en: string }[]).filter((p) => p.ja && p.en).sort((a, b) => b.ja.length - a.ja.length)
const 일영 = (s: string) => { for (const p of 몬) if (s.includes(p.ja)) return p.en; return '' }

const raw = readFileSync(CSV)
const text = CSV.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
const 줄 = text.split('\n')
const h = split(줄[0])
const I = Object.fromEntries(h.map((k, i) => [k.trim(), i])) as Record<string, number>

const 번호있음 = new Map<string, Set<string>>()
const 무번호 = new Map<string, Map<string, string[]>>()
for (let i = 1; i < 줄.length; i++) {
  if (!줄[i].trim()) continue
  const c = split(줄[i])
  const set = c[I.setName]
  if (!set) continue
  const n = String(c[I.cardNumber] ?? '').trim()
  if (n) {
    const s2 = 번호있음.get(set) ?? new Set<string>()
    s2.add(자름(n)); 번호있음.set(set, s2)
  } else {
    const k = 열쇠(String(c[I.name] ?? ''))
    if (!k) continue
    const m = 무번호.get(set) ?? new Map<string, string[]>()
    m.set(k, [...(m.get(k) ?? []), String(c[I.name])]); 무번호.set(set, m)
  }
}

const 표 = pptSetNames as Record<string, string>
const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 기존 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/setCardNumberAlias.json'), 'utf-8')) as Record<string, Record<string, string>>
const 새표: Record<string, Record<string, string>> = { ...기존 }
let 만든것 = 0
for (const s of sidx) {
  const ppt = 표[s.slug]
  const 저 = ppt ? 무번호.get(ppt) : null
  if (!저 || !저.size) continue
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  const 번호쪽 = 번호있음.get(ppt) ?? new Set<string>()
  const 이름열쇠 = (c: any) => {
    const raw2 = String(c.name ?? '')
    if (s.ed === 'en') return 열쇠(raw2)
    const en = 일영(raw2)
    return en ? 열쇠(en) : ''
  }
  const 우리수 = new Map<string, number>()
  for (const c of d.cards ?? []) { const k = 이름열쇠(c); if (k) 우리수.set(k, (우리수.get(k) ?? 0) + 1) }
  const t: Record<string, string> = { ...(새표[s.slug] ?? {}) }
  let n = 0
  for (const c of d.cards ?? []) {
    if (번호쪽.has(자름(String(c.n)))) continue
    const k = 이름열쇠(c)
    if (!k) continue
    const 저것 = 저.get(k)
    // 양쪽 모두 딱 한 장일 때만. 하나라도 여럿이면 가릴 수 없다.
    if (!저것 || 저것.length !== 1 || 우리수.get(k) !== 1) continue
    t[String(c.n)] = `NAME:${저것[0]}`
    n++
  }
  if (n) { 새표[s.slug] = t; 만든것 += n }
}
console.log(`\n  이름으로 짝지은 카드 ${만든것}장`)
if (WRITE) {
  writeFileSync(path.join(ROOT, 'src/data/setCardNumberAlias.json'), JSON.stringify(새표, null, 2) + '\n')
  console.log('  src/data/setCardNumberAlias.json 저장했다')
} else {
  console.log('  (--write 로 저장)')
}
console.log('')
