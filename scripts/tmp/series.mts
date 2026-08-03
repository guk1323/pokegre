import { readFileSync } from 'node:fs'
import { koSet } from '../../src/lib/cardCatalog.ts'
const src = readFileSync('src/components/SetsView.tsx', 'utf8')
const block = src.slice(src.indexOf('const SERIE_LABEL'), src.indexOf('const koSerie'))
const SERIE_LABEL: Record<string, string> = {}
for (const m of block.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z]\w*)):\s*'([^']+)',/gm))
  SERIE_LABEL[m[1] ?? m[2] ?? m[3]] = m[4]
const koSerie = (ed: 'ja' | 'en', s: string) => SERIE_LABEL[s] ?? koSet(ed, s)

type E = { slug: string; ed: 'ja' | 'en'; serie?: string; releaseDate?: string }
const idx = JSON.parse(readFileSync('public/sets/index.json', 'utf8')) as E[]
const g = new Map<string, { ed: 'ja' | 'en'; n: number; from: string; to: string; tab: string }>()
for (const s of idx) {
  const key = s.serie || '기타'
  const tab = s.slug.startsWith('ja-') ? '일본판' : /pocket/i.test(s.serie ?? '') ? '포켓' : '북미판'
  const c = g.get(key), d = s.releaseDate ?? ''
  if (!c) g.set(key, { ed: s.ed, n: 1, from: d, to: d, tab })
  else { c.n++; if (d && (!c.from || d < c.from)) c.from = d; if (d && d > c.to) c.to = d }
}
const rows = [...g].map(([serie, v]) => ({ serie, ko: koSerie(v.ed, serie), ...v }))
rows.sort((a, b) => a.tab.localeCompare(b.tab) || (a.from < b.from ? -1 : 1))
console.log(`사전에 못 박은 것 ${Object.keys(SERIE_LABEL).length}개 / 시리즈 ${rows.length}개\n`)
let tab = ''
for (const r of rows) {
  if (r.tab !== tab) { tab = r.tab; console.log(`\n■ ${tab}`) }
  console.log(`| ${r.ko.padEnd(22)} | ${r.serie} |`)
}
