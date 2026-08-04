import { readFileSync, readdirSync } from 'node:fs'
import { STRUCTURAL_TERMS, COMPOUND_TERMS } from '../src/lib/koreanizeTitle.ts'
const cnt: Record<string, number> = {}
const keys = ['エネルギー','エナジー','ひかる','ヒカル','光る','ポリゴンZ','ポリゴンＺ','ポリゴン2','ポリゴン２']
for (const f of readdirSync('public/sets')) {
  if (!f.startsWith('ja-')||!f.endsWith('.json')) continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`,'utf8')) as {cards?:{name:string}[]}
  for (const c of d.cards ?? []) for (const k of keys) if (c.name?.includes(k)) cnt[k]=(cnt[k]??0)+1
}
console.log('일본판 카드명에 그 표기가 든 카드 수:')
for (const k of keys) console.log(`  ${k}: ${cnt[k]??0}장`)

// 역변환 사전이 실제로 무엇을 골랐나 재현
const hasKanji=(s:string)=>/[一-鿿]/.test(s)
const better=(n:string,p:string)=>hasKanji(n)!==hasKanji(p)?!hasKanji(n):n.length<p.length
const rev=new Map<string,string>()
for (const [ja,ko] of [...COMPOUND_TERMS,...STRUCTURAL_TERMS]) {
  if(!/[ぁ-んァ-ヶ一-鿿]/.test(ja))continue
  if(/^ヴ/.test(ja))continue
  const p=rev.get(ko); if(p===undefined||better(ja,p))rev.set(ko,ja)
  const t=ko.trim(); const pt=rev.get(t)
  if(t!==ko&&t&&(pt===undefined||better(ja,pt)))rev.set(t,ja)
}
for (const k of ['에너지','빛나는','찬란한','상처약','에너지 ']) console.log(`  역변환 "${k}" → ${rev.get(k) ?? '(없음)'}`)
