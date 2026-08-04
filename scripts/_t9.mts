import { readFileSync, readdirSync } from 'node:fs'
import { koName } from '../src/lib/cardCatalog.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
const enNames=new Set<string>(), jaNames=new Set<string>()
type R={ko:string;orig:string;got:string;set:string;n:string}
const jr:R[]=[], er:R[]=[]
const files=readdirSync('public/sets').filter(f=>f.endsWith('.json')&&f!=='index.json')
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {cards?:{name:string}[]}
  for(const c of d.cards??[]) if(c.name){ if(f.startsWith('en-'))enNames.add(c.name); else jaNames.add(c.name) }}
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  const ed:'ja'|'en'=f.startsWith('ja-')?'ja':'en'
  for(const c of d.cards??[]){ if(!c.name)continue
    const ko=koName(ed,c.name); if(!/[가-힣]/.test(ko))continue
    if(ed==='ja'){const g=translateSearchQuery(ko); if(!jaNames.has(g))jr.push({ko,orig:c.name,got:g,set:d.id??f,n:c.n})}
    else{const g=translateSearchQueryToEnglish(ko,'english'); if(!enNames.has(g))er.push({ko,orig:c.name,got:g,set:d.id??f,n:c.n})}}}
const uniq=(a:R[])=>{const s=new Set<string>();return a.filter(r=>!s.has(r.ko)&&s.add(r.ko))}
const ju=uniq(jr), eu=uniq(er)
console.log(`일본판: 화면 이름 → 스니커덩크 검색어가 우리 일본판 카드명에 하나도 없는 것 ${ju.length}종`)
console.log(`북미판: 화면 이름 → 영문 검색어가 우리 북미판 카드명에 하나도 없는 것 ${eu.length}종`)
const modern=(r:R)=>/^(SV|sv|SM|S[0-9]|S[A-Z]|M[0-9A-Z]|MC)/.test(r.set)
console.log('\n[일본판·최근세트] 표본 40')
for(const r of ju.filter(modern).slice(0,40)) console.log(`  [${r.set} ${r.n}] "${r.ko}" → ${r.got}   (실제 ${r.orig})`)
console.log('\n[북미판] 표본 30')
for(const r of eu.slice(0,30)) console.log(`  [${r.set} ${r.n}] "${r.ko}" → ${r.got}   (실제 ${r.orig})`)
