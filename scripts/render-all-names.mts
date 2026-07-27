// 모든 카드명을 화면에 나오는 그대로 찍는다. 사전을 고치기 전후로 한 번씩 떠서 diff하면
// 새 규칙이 엉뚱한 이름을 깨뜨렸는지 바로 보인다(예전에 'デンジ'가 'デンジャラス'를 깼다).
//
//   npx tsx scripts/render-all-names.mts > /tmp/before.txt
//   (사전 수정)
//   npx tsx scripts/render-all-names.mts > /tmp/after.txt
//   diff /tmp/before.txt /tmp/after.txt
import {readFileSync,readdirSync} from 'fs'
import {koreanizeTitle} from '../src/lib/koreanizeTitle.ts'
import {koreanizeEnglishCardName as en} from '../src/lib/koreanizeEnglishTitle.ts'
const out:string[]=[]
for(const dir of ['public/sets','public/packsim']){
  let fs2:string[]; try{fs2=readdirSync(dir)}catch{continue}
  for(const f of fs2.sort()){ if(!f.endsWith('.json')||f==='index.json')continue
    const slug=f.replace('.json','')
    let d:any; try{d=JSON.parse(readFileSync(dir+'/'+f,'utf8'))}catch{continue}
    const ed=d.ed??(slug.startsWith('ja')?'ja':'en')
    for(const c of d.cards??[]){ if(!c.name)continue
      out.push(`${slug} ${c.n} | ${c.name} | ${ed==='ja'?en(koreanizeTitle(c.name)):en(c.name)}`)}}}
console.log(out.join('\n'))
