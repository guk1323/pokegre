import { readFileSync, readdirSync } from 'node:fs'
import { koName } from '../src/lib/cardCatalog.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
const enNames=new Set<string>()
const files=readdirSync('public/sets').filter(f=>f.startsWith('en-')&&f.endsWith('.json'))
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {cards?:{name:string}[]}
  for(const c of d.cards??[]) if(c.name) enNames.add(c.name)}
// PPT 표기 정규화(악센트·성별기호·따옴표)를 똑같이 적용해 비교
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').normalize('NFC')
  .replace(/\s*♀/g,' F').replace(/\s*♂/g,' M').replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim()
const normSet=new Set([...enNames].map(norm))
const bad:{ko:string;got:string;orig:string;set:string;n:string}[]=[]
const seen=new Set<string>()
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  for(const c of d.cards??[]){if(!c.name)continue
    const ko=koName('en',c.name); if(!/[가-힣]/.test(ko)||seen.has(ko))continue; seen.add(ko)
    const g=translateSearchQueryToEnglish(ko,'english')
    if(!normSet.has(norm(g))) bad.push({ko,got:g,orig:c.name,set:d.id??f,n:c.n})}}
console.log(`북미판 화면 이름 ${seen.size}종 중, 영문 검색어가 북미판 카드목록에 없는 것 ${bad.length}종`)
for(const r of bad) console.log(`  [${r.set} ${r.n}] "${r.ko}" → "${r.got}"   (실제 "${r.orig}")`)
