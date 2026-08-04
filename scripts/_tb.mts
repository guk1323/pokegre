import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { koName } from '../src/lib/cardCatalog.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'
const jaNames=new Set<string>()
const files=readdirSync('public/sets').filter(f=>f.startsWith('ja-')&&f.endsWith('.json'))
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {cards?:{name:string}[]}
  for(const c of d.cards??[]) if(c.name) jaNames.add(c.name)}
const out:{ko:string;got:string;orig:string;set:string;n:string}[]=[]
const seen=new Set<string>()
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  for(const c of d.cards??[]){if(!c.name)continue
    const ko=koName('ja',c.name); if(!/[가-힣]/.test(ko)||seen.has(ko))continue
    const g=translateSearchQuery(ko); if(jaNames.has(g))continue
    seen.add(ko); out.push({ko,got:g,orig:c.name,set:d.id??f,n:c.n})}}
writeFileSync('/tmp/mismatch.json', JSON.stringify(out))
console.log(out.length)
