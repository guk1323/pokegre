// 화면이 실제로 부르는 주소를 그대로 만들어 목록으로 낸다(cardImg + usable).
import { cardImg, usable } from '../src/lib/cardImg.ts'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
const 줄: string[] = []
let 빈칸 = 0, 막힘 = 0
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'ko-index.json') continue
  let j: any
  try { j = JSON.parse(readFileSync(`public/sets/${f}`, 'utf-8')) } catch { continue }
  const cards = (Array.isArray(j) ? j : j?.cards) ?? []
  for (const c of cards) {
    const raw = (c?.img ?? '').trim()
    if (!raw) { 빈칸++; continue }
    if (!usable(raw)) { 막힘++; continue }
    줄.push(`${f.slice(0, -5)}\t${cardImg(raw)}`)
  }
}
writeFileSync(process.argv[2], 줄.join('\n'))
console.log(`부를 주소 ${줄.length}개 · 주소 빈칸 ${빈칸}장 · 일부러 막은 것 ${막힘}장`)
