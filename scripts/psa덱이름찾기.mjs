/**
 * 월드 챔피언십 덱 — **선수 이름 ↔ PSA 덱 이름**을 자료에서 스스로 찾아낸다.
 *
 * 어떻게: 그 해 카드 중 **① 그 번호를 가진 선수가 우리 쪽에 한 명뿐이고
 * ② PSA 줄도 그 번호에 하나뿐인** 번호만 앵커로 쓴다. 앵커가 가리키는 덱 이름을 모아
 * **한 선수가 한 덱만 가리킬 때만** 표에 넣는다(둘 이상 가리키면 사람이 봐야 한다).
 *
 *   node scripts/psa덱이름찾기.mjs <연도> <줄파일>            → 찾은 것만 보여 준다
 *   node scripts/psa덱이름찾기.mjs <연도> <줄파일> --적기      → data/psa덱이름.json 에 넣는다
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { 줄읽기 } from './psa대조.mjs'
import { 풀기, 씻기 } from './psa검증.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const [연도, 줄파일] = process.argv.slice(2)
const 줄 = 줄읽기(readFileSync(줄파일, 'utf8'))
const idx = JSON.parse(readFileSync(path.join(ROOT, 'card-index.json'), 'utf8'))

const 우리 = idx.rows.filter((r) => r[0] === 'en-world-championship-decks' && String(r[2]).includes(`- ${연도} (`))
const 번호별 = {}
for (const r of 우리) {
  const n = String(r[1]).split('~')[0].replace(/[^0-9]/g, '').replace(/^0+/, '')
  const p = String(r[2]).match(/-\s*\d{4}\s*\(([^)]+)\)\s*$/)
  if (!n || !p) continue
  ;(번호별[n] = 번호별[n] || []).push({ 사람: p[1].trim(), 이름: String(r[2]) })
}

const 셈 = {}
for (const [n, 것들] of Object.entries(번호별)) {
  if (것들.length !== 1) continue
  const rs = 줄.filter((x) => String(x.번호).replace(/^0+/, '') === n)
  if (rs.length !== 1) continue
  // 줄 이름에서 「카드 영어 이름」을 떼면 남는 것이 덱 이름이다.
  const 후보 = 풀기(것들[0].이름).후보
  let 덱 = rs[0].이름
  for (const en of 후보.sort((a, b) => b.length - a.length))
    if (씻기(덱).startsWith(씻기(en))) { 덱 = 덱.slice(en.length).trim(); break }
  덱 = 덱.replace(/^[-·\s]+/, '').replace(/\s*Deck$/i, '').trim()
  if (!덱 || 덱 === rs[0].이름) continue
  const k = 것들[0].사람
  ;(셈[k] = 셈[k] || {})[덱] = (셈[k][덱] || 0) + 1
}

const 표 = {}
for (const [사람, c] of Object.entries(셈)) {
  const e = Object.entries(c).sort((a, b) => b[1] - a[1])
  const 줄임 = `${연도} ${사람}`
  if (e.length === 1) { 표[줄임] = e[0][0]; console.log(`  ✔ ${줄임.padEnd(30)} ${e[0][0]}  (앵커 ${e[0][1]}개)`) }
  else console.log(`  ✖ ${줄임.padEnd(30)} 갈림: ${e.map((x) => x[0] + '×' + x[1]).join(' / ')}`)
}
if (process.argv.includes('--적기')) {
  const p = path.join(ROOT, 'data/psa덱이름.json')
  const j = JSON.parse(readFileSync(p, 'utf8'))
  Object.assign(j.표, 표)
  writeFileSync(p, JSON.stringify(j, null, 1))
  console.log(`  덱이름표 ${Object.keys(j.표).length}개`)
}
