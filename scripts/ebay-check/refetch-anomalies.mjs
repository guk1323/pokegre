// 이상 목록에 걸린 카드들을 저쪽에서 다시 받는다 — 합치기 방식이라 러너 줄은 안 다친다.
// 지워졌던 25주년 복각 줄이 되살아나 「· 25주년 복각」 곁 카드로 들어간다.
import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
const 뿌리 = new URL('../..', import.meta.url).pathname
const 이상 = JSON.parse(readFileSync(path.join(뿌리, 'data', 'ebay-check-anomalies.json'), 'utf8'))
const ids = [...new Set([
  ...이상.map((x) => String(x.id).replace(/-(1st|lang|rev|25th|auto)$/, '')),
  '89166', '90153', '106999', '42382', '84572', '89163', // 표본에서 다룬 것들
])]
const 적기 = (s) => { console.log(s); try { appendFileSync(path.join(뿌리, 'data', 'ebay-check-refetch.log'), s + '\n') } catch {} }
적기(`[이상 카드 다시받기] ${ids.length}장 · ${new Date().toISOString()}`)
let 함 = 0, 실패 = 0
const 줄 = [...ids]
await Promise.all(Array.from({ length: 4 }, async () => {
  while (줄.length) {
    const id = 줄.shift()
    if (!id) break
    let 됨 = false
    for (let 시도 = 1; 시도 <= 3 && !됨; 시도++) {
      try {
        const r = await fetch('http://127.0.0.1:5173/api/local/ebay-check', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
        })
        if (r.ok) { 함++; 됨 = true; break }
        const 글 = await r.text()
        if (글.includes('429')) { await new Promise((x) => setTimeout(x, 30000)); continue }
        await new Promise((x) => setTimeout(x, 2500))
      } catch { await new Promise((x) => setTimeout(x, 2500)) }
    }
    if (!됨) 실패++
    if (함 % 100 === 0 && 함 > 0) 적기(`  …${함}장`)
    await new Promise((x) => setTimeout(x, 700))
  }
}))
적기(`[다시받기 끝] 함 ${함} · 실패 ${실패} · ${new Date().toISOString()}`)
