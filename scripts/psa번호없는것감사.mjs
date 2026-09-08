/**
 * **번호 없는 카드(#로 시작)가 여러 세트에서 다르게 걸리는지** 훑어 본다.
 * (짝으로 등록된 줄파일만 본다 — 아무 파일이나 보면 엉뚱한 ✖가 뜬다.)
 *
 * 왜: 이런 카드는 이름만으로 맞춘 것이라, 다른 덱·세트에도 같은 이름 줄이 있으면
 * 엉뚱한 값을 쓴다(체육관 덱의 디펜더·만병통치제·돌풍이 그랬다).
 * 여기서 ✖로 나오면 **짝지어 둔 줄파일이 맞는지 사람이 보고**, 못 가리면 출처를 떼어 둔다.
 * ⚠️ 짝으로 등록되지 않은 줄파일까지 훑기 때문에, 엉뚱한 파일이 끼어 ✖가 뜰 수도 있다.
 *    지금 출처가 「제대로 짝지은 파일」에서 온 것이면 그대로 두면 된다.
 *
 *   node scripts/psa번호없는것감사.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { 대조, 줄읽기 } from './psa대조.mjs'
import path from 'node:path'
const ROOT = path.resolve(import.meta.dirname, '..') + '/'
const 크기표=JSON.parse(readFileSync(ROOT+'data/psa크기표.json','utf8'))
const 표=JSON.parse(readFileSync(ROOT+'src/data/psaPopFix.json','utf8'))
const idx=JSON.parse(readFileSync(ROOT+'card-index.json','utf8'))
const 짝=JSON.parse(readFileSync(ROOT+'data/psa짝목록.json','utf8'))
const 슬러그들=[...new Set(idx.rows.filter(r=>r[7]&&표[String(r[7])]&&/\/#/.test(표[String(r[7])].출처||'')).map(r=>r[0]))]
console.log('번호없는 카드가 확인된 슬러그: '+슬러그들.join(', '))
for(const 슬러그 of 슬러그들){
  const 모음=new Map()
  const 쓸짝=짝.filter(x=>x[0]===슬러그)
  for(const [,파일,,줄에,우리이름에] of 쓸짝){
    const f=파일+'.txt'
    let 줄=줄읽기(readFileSync(ROOT+'data/psa줄/'+f,'utf8'))
    if(줄에) 줄=줄.filter(r=>r.이름.toLowerCase().includes(String(줄에).toLowerCase()))
    // ⚠️ 짝에 「우리이름에」 조건이 있으면 그대로 건다(2010·2011 플레이! 포켓몬이 섞이지 않게).
    const R=대조(슬러그, 줄, {세트크기:크기표[슬러그+'|'+파일], 우리이름에})
    for(const x of [...R.같음,...R.다름]){
      if(!/^#/.test(String(x.n)))continue
      if(!모음.has(x.tcg))모음.set(x.tcg,[])
      모음.get(x.tcg).push({파일,값:x.psa.join('/'),줄:x.줄이름,이름:x.이름})
    }
  }
  for(const [tcg,들] of 모음){
    const 다름=new Set(들.map(x=>x.값+'|'+x.줄))
    if(다름.size>1)console.log(`  ✖ ${슬러그} ${들[0].이름} — ${들.map(x=>x.파일+':'+x.값).join(' / ')}  (지금 출처 ${표[tcg]?.출처||'-'})`)
  }
}
console.log('감사 끝')
