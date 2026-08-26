// 전종 재분류 — 크레딧 0. 저장된 것을 지금 규칙으로 다시 가른다(부모 파일만 돌면 곁은 따라온다).
import { readdirSync, appendFileSync } from 'node:fs'
import path from 'node:path'
const 뿌리 = new URL('../..', import.meta.url).pathname
const 로그 = path.join(뿌리, 'data', 'ebay-check-redo.log')
const ids = readdirSync(path.join(뿌리, 'data', 'ebay-check'))
  .filter((f) => f.endsWith('.json') && !/-(1st|lang|rev|25th|auto)\.json$/.test(f))
  .map((f) => f.replace('.json', ''))
const 적기 = (s) => { console.log(s); try { appendFileSync(로그, s + '\n') } catch {} }
적기(`[재분류] ${ids.length}장 · ${new Date().toISOString()}`)
let 함 = 0, 실패 = 0
const 줄 = [...ids]
await Promise.all(Array.from({ length: 6 }, async () => {
  while (줄.length) {
    const id = 줄.shift()
    if (!id) break
    try {
      const r = await fetch('http://127.0.0.1:5173/api/local/ebay-check', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, redo: 1 }),
      })
      if (r.ok) 함++
      else 실패++
    } catch { 실패++ }
    if (함 % 2000 === 0 && 함 > 0) 적기(`  …${함}장`)
  }
}))
적기(`[재분류 끝] 함 ${함} · 실패 ${실패} · ${new Date().toISOString()}`)
