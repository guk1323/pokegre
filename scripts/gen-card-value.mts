/**
 * 카드 **값 순위표**를 만든다. `src/data/cardValue.json` (크레딧 0)
 *
 * 왜 — 검색 결과를 무엇으로 앞에 둘지 정하려면 값을 알아야 하는데, 운영 서버에는 덤프가
 * 없다(하루 쓰고 지운다). 그렇다고 값을 알자고 PPT를 부르면 크레딧이 든다.
 * 값 자체가 아니라 **순서**만 필요하므로, 덤프의 값을 미리 넣어 둔다 —
 * "어느 리자몽이 비싼가"는 하루 이틀에 안 바뀐다.
 *
 * ⚠️ **화면에 이 값을 쓰면 안 된다.** 묵은 값이다. 오직 검색 결과 **정렬**에만 쓴다.
 * ⚠️ 1달러 밑은 안 담는다 — 파일만 커지고 순서에 영향이 없다.
 *
 * 실행: npx tsx scripts/gen-card-value.mts <덤프.csv>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [CSV] = process.argv.slice(2)
if (!CSV || !existsSync(CSV)) {
  console.log('덤프 csv 경로를 주세요')
  process.exit(1)
}
const 줄가르기 = (s: string) => {
  const o: string[] = []
  let c = ''
  let q = false
  for (const ch of s) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) {
      o.push(c)
      c = ''
    } else c += ch
  }
  o.push(c)
  return o
}
const L = readFileSync(CSV, 'utf8').split('\n')
const H = 줄가르기(L[0])
const [ID, MP] = ['tcgPlayerId', 'marketPrice'].map((n) => H.indexOf(n))
const 값 = new Map<string, number>()
for (let i = 1; i < L.length; i++) {
  if (!L[i]) continue
  const f = 줄가르기(L[i])
  if (!f[ID]) continue
  const v = Number(f[MP]) || 0
  if (v > (값.get(f[ID]) ?? 0)) 값.set(f[ID], v)
}
// 1달러 밑은 뺀다. 순서에 영향이 없고 파일만 커진다.
const out: Record<string, number> = {}
for (const [id, v] of 값) if (v >= 1) out[id] = Math.round(v)
const 곳 = join(ROOT, 'src/data/cardValue.json')
writeFileSync(곳, JSON.stringify(out) + '\n')
console.log(`카드 ${값.size.toLocaleString()}장 중 1달러 이상 **${Object.keys(out).length.toLocaleString()}장**을 적었습니다`)
console.log(`   ${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)}KB`)
