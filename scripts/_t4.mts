import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'
const norm = (s: string) => s.replace(/[\s・･·'’"”“\-—–.,!?()（）【】「」]/g, '').toLowerCase()
const rows: {ko:string;orig:string;got:string;set:string;n:string}[] = []
for (const f of readdirSync('public/sets')) {
  if (!f.startsWith('ja-') || !f.endsWith('.json')) continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as { id?: string; cards?: { n: string; name: string }[] }
  for (const c of d.cards ?? []) {
    if (!c.name) continue
    const ko = koreanizeEnglishCardName(koreanizeTitle(c.name))
    if (!/[가-힣]/.test(ko)) continue
    const got = translateSearchQuery(ko)
    if (norm(got) !== norm(c.orig ?? c.name)) rows.push({ko, orig:c.name, got, set:d.id??f, n:c.n})
  }
}
// 옛 세트(원본 오염) 제외 — SV/S/SM/XY/M/BW/SWSH 계열 최근만
const modern = rows.filter(r => /^(SV|sv|S[0-9PVMPa-z]|SM|M[0-9]|SP|S[0-9])/.test(r.set) && !/^(SM P|)$/.test(r.set))
console.log(`전체 불일치 ${rows.length}종 / 최근 세트(SV·S·SM·M…) ${modern.length}종\n`)
// 에너지 계열
const en = rows.filter(r => r.ko.includes('에너지'))
console.log(`"에너지"가 든 이름 중 불일치 ${en.length}종:`)
for (const r of en.slice(0,25)) console.log(`  [${r.set} ${r.n}] "${r.ko}" → ${r.got}  (실제 ${r.orig})`)
console.log('\n최근 세트 불일치 표본 45:')
const seen = new Set<string>()
for (const r of modern) { if (seen.has(r.ko)) continue; seen.add(r.ko); if (seen.size>45) break; console.log(`  [${r.set} ${r.n}] "${r.ko}" → ${r.got}  (실제 ${r.orig})`) }
