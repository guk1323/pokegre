import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'

const hasKo = (s: string) => /[가-힣]/.test(s)
type Row = { ko: string; orig: string; got: string; set: string; n: string }
const jaRows: Row[] = []
const enRows: Row[] = []
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as { id?: string; cards?: { n: string; name: string }[] }
  const isJa = f.startsWith('ja-')
  for (const c of d.cards ?? []) {
    if (!c.name) continue
    const ko = isJa ? koreanizeEnglishCardName(koreanizeTitle(c.name)) : koreanizeEnglishCardName(c.name)
    if (!hasKo(ko)) continue
    if (isJa) jaRows.push({ ko, orig: c.name, got: translateSearchQuery(ko), set: d.id ?? f, n: c.n })
    else enRows.push({ ko, orig: c.name, got: translateSearchQueryToEnglish(ko, 'english'), set: d.id ?? f, n: c.n })
  }
}
const norm = (s: string) => s.replace(/[\s・･·'’"”“\-—–.,!?()（）【】「」]/g, '').toLowerCase()
function tally(rows: Row[], label: string) {
  let ok = 0, leftover = 0, silent = 0
  const silentEx: Row[] = []
  const leftEx: Row[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.ko)) continue
    seen.add(r.ko)
    if (norm(r.got) === norm(r.orig)) { ok++; continue }
    if (hasKo(r.got)) { leftover++; leftEx.push(r); continue }
    silent++; silentEx.push(r)
  }
  console.log(`\n== ${label} · 고유 카드명 ${seen.size}종 ==`)
  console.log(`  원문과 정확히 일치        ${ok}`)
  console.log(`  한글이 남음(=확실히 0건)  ${leftover}`)
  console.log(`  한글은 없는데 원문과 다름 ${silent}  ← 조용한 실패`)
  return { silentEx, leftEx }
}
const ja = tally(jaRows, '일본판 → 스니커덩크(일본어)')
const en = tally(enRows, '북미판 → 이베이/TCGplayer(영어)')
console.log('\n--- 일본어: 조용한 실패 표본 30 ---')
for (const r of ja.silentEx.slice(0, 30)) console.log(`  [${r.set} ${r.n}] "${r.ko}" → ${r.got}   (원문 ${r.orig})`)
console.log('\n--- 영어: 조용한 실패 표본 30 ---')
for (const r of en.silentEx.slice(0, 30)) console.log(`  [${r.set} ${r.n}] "${r.ko}" → ${r.got}   (원문 ${r.orig})`)
