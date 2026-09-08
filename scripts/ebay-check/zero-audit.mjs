// 【0건 카드 판정 점검】 저쪽은 주는데 우리가 버리는 것인지, 저쪽이 안 주는 것인지 가른다.
// ⚠️ 크레딧을 쓴다(장당 3). 쓰기 전에 남은 양을 확인할 것.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
const 후보 = JSON.parse(readFileSync('data/시세없음후보.json', 'utf8'))
const 서버 = 'http://127.0.0.1:5173/api/local/ebay-check'
const 쉼 = (ms) => new Promise((r) => setTimeout(r, ms))
const 결과 = []
let 한것 = 0
for (const c of 후보) {
  for (let 시도 = 1; 시도 <= 3; 시도++) {
    try {
      const r = await fetch(서버, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id }) })
      if (r.ok) {
        const j = await r.json()
        결과.push({ id: c.id, name: c.name, slug: c.slug, no: c.no, v: c.v,
          받음: j.받음 ?? 0, 애매: j.지운애매 ?? 0, 딴카드: j.지운딴카드 ?? 0, 판매자: j.지운판매자 ?? 0,
          남음: j.부모요약?.받음 ?? 0, 첫판: j.첫판수 ?? 0, 기타언어: j.기타언어수 ?? 0 })
        break
      }
      if (r.status === 404) { 결과.push({ id: c.id, name: c.name, slug: c.slug, no: c.no, v: c.v, 받음: -1 }); break }
      await 쉼(2500)
    } catch { await 쉼(2500) }
  }
  한것++
  if (한것 % 100 === 0) {
    writeFileSync('data/0건점검.json', JSON.stringify(결과))
    appendFileSync('data/0건점검.log', `${한것}/${후보.length}\n`)
  }
  await 쉼(120)
}
writeFileSync('data/0건점검.json', JSON.stringify(결과))
appendFileSync('data/0건점검.log', `[끝] ${한것}장\n`)
console.log('끝: ' + 결과.length + '장')
