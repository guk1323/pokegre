import { readFileSync, readdirSync } from 'node:fs'
import { koName } from '../src/lib/cardCatalog.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
const files=readdirSync('public/sets').filter(f=>f.endsWith('.json')&&f!=='index.json')
const left:{ko:string;got:string;set:string;n:string;ed:string}[]=[]
const seen=new Set<string>()
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  const ed:'ja'|'en'=f.startsWith('ja-')?'ja':'en'
  for(const c of d.cards??[]){if(!c.name)continue
    const ko=koName(ed,c.name); if(!/[가-힣]/.test(ko)||seen.has(ko))continue; seen.add(ko)
    const g=translateSearchQueryToEnglish(ko, ed==='ja'?'japanese':'english')
    if(/[가-힣]/.test(g)) left.push({ko,got:g,set:d.id??f,n:c.n,ed})}}
console.log(`화면 이름 ${seen.size}종 중, 이베이/TCGplayer로 나갈 때 한글이 남는 것 ${left.length}종 (=확실히 0건)`)
const byEd = (e:string)=>left.filter(r=>r.ed===e)
console.log(`  일본판 ${byEd('ja').length}종 / 북미판 ${byEd('en').length}종`)
const modern = byEd('ja').filter(r=>/^(SV|sv|M[0-9A-Z]|MC|S[0-9])/.test(r.set))
console.log(`  그중 최근(SV·M·S) 세트 ${modern.length}종. 표본 30:`)
for(const r of modern.slice(0,30)) console.log(`    [${r.set} ${r.n}] "${r.ko}" → ${r.got}`)
