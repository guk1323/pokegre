import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
const enNames = new Set<string>()
for (const f of readdirSync('public/sets')) {
  if(!f.startsWith('en-')||!f.endsWith('.json'))continue
  const d=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {cards?:{name:string}[]}
  for(const c of d.cards??[]) if(c.name) enNames.add(c.name)
}
for (const n of ['Iron Defender','Iron X Defense','N\'s Plot','N\'s Plan','Larry\'s Skill','Larry\'s Professionalism','Uncanny Clock','Strange Timepiece','Fight Gong','Fighting Gong','Super Rod MAX','Fishing Rod MAX'])
  console.log(`  ${enNames.has(n)?'있음':'없음'}  ${n}`)
console.log('\n--- SV10 화면 이름 ---')
const d=JSON.parse(readFileSync('public/sets/ja-SV10.json','utf8')) as {name?:string;cards?:{n:string;name:string}[]}
console.log('세트이름:', d.name)
let k=0
for(const c of d.cards??[]) if(!/[ぁ-んァ-ヶ一-鿿]/.test(c.name)){ if(k++<6) console.log(`  ${c.n} 원본 "${c.name}" → 화면 "${koreanizeEnglishCardName(c.name)}"`) }
console.log(`  … SV10에서 원본이 영어인 카드 ${k}장`)
// きずぐすり
const cnt:Record<string,number>={}
for (const f of readdirSync('public/sets')) { if(!f.startsWith('ja-'))continue
  const s=JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {cards?:{name:string}[]}
  for(const c of s.cards??[]) for(const key of ['きずぐすり','キズぐすり','キズぐすり']) if(c.name?.includes(key)) cnt[key]=(cnt[key]??0)+1 }
console.log('\nきずぐすり', cnt['きずぐすり']??0, '장 / キズぐすり', cnt['キズぐすり']??0, '장')
