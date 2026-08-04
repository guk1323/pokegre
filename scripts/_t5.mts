import { readFileSync, readdirSync } from 'node:fs'
// 일본판 세트인데 원본 카드명이 영어(라틴문자만)인 것 세기
let tot=0, latin=0
const per: Record<string, number> = {}
for (const f of readdirSync('public/sets')) {
  if (!f.startsWith('ja-') || !f.endsWith('.json')) continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {id?:string;cards?:{n:string;name:string}[]}
  for (const c of d.cards ?? []) {
    if (!c.name) continue
    tot++
    if (!/[ぁ-んァ-ヶ一-鿿]/.test(c.name)) { latin++; per[d.id ?? f] = (per[d.id ?? f]??0)+1 }
  }
}
console.log(`일본판 카드 ${tot}장 중 원본이 일본어가 아닌 것 ${latin}장`)
const top = Object.entries(per).sort((a,b)=>b[1]-a[1]).slice(0,15)
for (const [s,n] of top) console.log(`  ${s}: ${n}장`)
