import { readFileSync, readdirSync } from 'node:fs'
import { koName } from '../src/lib/cardCatalog.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'
const jaNames=new Set<string>()
const files=readdirSync('public/sets').filter(f=>f.startsWith('ja-')&&f.endsWith('.json'))
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {cards?:{name:string}[]}
  for(const c of d.cards??[]) if(c.name) jaNames.add(c.name)}
type R={ko:string;orig:string;got:string;set:string;n:string}
const bad:R[]=[]
for(const f of files){const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  for(const c of d.cards??[]){if(!c.name)continue
    const ko=koName('ja',c.name); if(!/[가-힣]/.test(ko))continue
    const g=translateSearchQuery(ko); if(!jaNames.has(g)) bad.push({ko,orig:c.name,got:g,set:d.id??f,n:c.n})}}
const u=new Map<string,R>(); for(const r of bad) if(!u.has(r.ko))u.set(r.ko,r)
const rows=[...u.values()]
// 유형별
const spaceOnly=rows.filter(r=>r.got.replace(/\s/g,'')===r.orig.replace(/\s/g,'') && r.got!==r.orig)
const energy=rows.filter(r=>r.got.includes('エナジー')&&r.orig.includes('エネルギー'))
const hikaru=rows.filter(r=>r.got.includes('ヒカル')&&r.orig.includes('ひかる'))
console.log(`검색어가 우리 일본판 카드명에 없는 화면이름 ${rows.length}종`)
console.log(`  ① 공백 위치만 다름            ${spaceOnly.length}종`)
console.log(`  ② エナジー(실제 エネルギー)   ${energy.length}종`)
console.log(`  ③ ヒカル(실제 ひかる)          ${hikaru.length}종`)
const pref=(p:string)=>spaceOnly.filter(r=>r.ko.startsWith(p)).length
for(const p of ['히스이 ','가라르 ','알로라 ','팔데아 ','찬란한 ']) console.log(`     ${p.trim()}: ${pref(p)}종`)
console.log('\n공백 유형 최신세트 표본:')
for(const r of spaceOnly.filter(r=>/^(M|SV|S1)/.test(r.set)).slice(0,10)) console.log(`  [${r.set} ${r.n}] "${r.ko}" → "${r.got}"  (실제 "${r.orig}")`)
console.log('\nエナジー 유형 전부:'); for(const r of energy) console.log(`  [${r.set} ${r.n}] "${r.ko}" → "${r.got}"  (실제 "${r.orig}")`)
console.log('\nヒカル 유형 전부:'); for(const r of hikaru) console.log(`  [${r.set} ${r.n}] "${r.ko}" → "${r.got}"  (실제 "${r.orig}")`)
