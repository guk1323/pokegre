import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'
const enNames = new Set<string>(); const jaNames = new Set<string>()
const rows: {ko:string;orig:string;got:string;set:string;n:string}[] = []
const jrows: {ko:string;orig:string;got:string;set:string;n:string}[] = []
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json')||f==='index.json') continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  for (const c of d.cards ?? []) { if(!c.name)continue; if(f.startsWith('en-'))enNames.add(c.name); else jaNames.add(c.name) }
}
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json')||f==='index.json') continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  const isJa = f.startsWith('ja-')
  for (const c of d.cards ?? []) {
    if (!c.name) continue
    const ko = isJa ? koreanizeEnglishCardName(koreanizeTitle(c.name)) : koreanizeEnglishCardName(c.name)
    if (!/[가-힣]/.test(ko)) continue
    if (isJa) { const g=translateSearchQuery(ko); if(!jaNames.has(g)) jrows.push({ko,orig:c.name,got:g,set:d.id??f,n:c.n}) }
    else { const g=translateSearchQueryToEnglish(ko,'english'); if(!enNames.has(g)) rows.push({ko,orig:c.name,got:g,set:d.id??f,n:c.n}) }
  }
}
const rocket = rows.filter(r=>r.got.startsWith("Team Rocket's") && enNames.has(r.got.replace(/^Team /,'')))
console.log(`북미판: "로켓단의 X"를 Team Rocket's로 보내는데 실제 카드명은 Rocket's인 것 ${rocket.length}장`)
for (const r of rocket.slice(0,8)) console.log(`   [${r.set} ${r.n}] "${r.ko}" → ${r.got}  (실제 ${r.orig})`)
// 일본판 세트인데 원본이 영어인 카드가 화면·검색에서 어떻게 되나
const eng = jrows.filter(r=>!/[ぁ-んァ-ヶ一-鿿]/.test(r.orig))
console.log(`\n일본판 세트인데 원본이 영어 → 검색어가 우리 일본판 카드목록에 없는 것 ${eng.length}장`)
for (const r of eng.filter(x=>/^SV|^M/.test(x.set)).slice(0,12)) console.log(`   [${r.set} ${r.n}] 화면 "${r.ko}" → 검색 "${r.got}"  (원본 ${r.orig})`)
console.log(`\n일본판 전체: 번역 결과가 우리 일본판 카드명 목록에 없는 것 ${jrows.length}장 / 북미판 ${rows.length}장`)
