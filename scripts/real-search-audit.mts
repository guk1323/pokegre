// 방문자가 실제로 친 검색어가 "결과를 내는지" 스니커덩크에 직접 물어본다.
//
// 왜 필요한가: 검색어가 일본어로 잘 번역되는지(search-check.mts)와, 그 번역된 말로
// 실제 카드가 나오는지는 다른 문제다. 번역이 완벽해도 스니커덩크에 그 조합이 없으면
// 방문자는 0건을 본다. 이게 방문자가 겪는 진짜 결과다.
//
// ⚠️ 스니커덩크는 공짜다. 짧은 시간에 많이 부르면 막힌다 — 2026-08-04에 실제로 막혀서
//    측정이 통째로 무효가 됐다(멀쩡한 카드까지 0건으로 나왔다). 그래서:
//    ① 한 번에 하나씩, 사이를 넉넉히 둔다(기본 2초)
//    ② 응답이 JSON이 아니면(=막힌 것) 그 자리에서 멈춘다. 계속 두드리면 더 오래 막힌다
//    ③ 중간 결과를 그때그때 파일에 남긴다. 멈춰도 지금까지 잰 건 안 잃는다
//
// 검색어는 /data/search-counts.json 에서 받는다(공짜):
//   fly ssh console -a pokegre -C "cat /data/search-counts.json" > /tmp/searchcounts.json
//
// 실행: npx tsx scripts/real-search-audit.mts [--gap 2000] [--limit 100]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'

const SRC = '/tmp/searchcounts.json'
const OUT = '/tmp/real-search-audit.json'
const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : dflt
}
const GAP = arg('gap', 2000)
const LIMIT = arg('limit', 0)

if (!existsSync(SRC)) throw new Error(`${SRC} 가 없다 — 위 설명의 fly ssh 명령으로 먼저 받아 둘 것`)

// 날짜별 { 검색어: 횟수 } → 검색어별 누적
const byDay = JSON.parse(readFileSync(SRC, 'utf8')) as Record<string, Record<string, number>>
const total = new Map<string, number>()
for (const terms of Object.values(byDay)) {
  for (const [t, c] of Object.entries(terms)) total.set(t, (total.get(t) ?? 0) + c)
}
// 한글이 든 것만 본다(영어로 친 건 그대로 나가므로 번역 문제가 아니다).
let terms = [...total.entries()]
  .filter(([t]) => /[가-힣]/.test(t))
  .sort((a, b) => b[1] - a[1])
if (LIMIT) terms = terms.slice(0, LIMIT)

// 이미 잰 건 건너뛴다(멈췄다 이어서 돌릴 수 있게).
type Row = { ko: string; ja: string; count: number; hits: number }
const done: Record<string, Row> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}

const url = (q: string) =>
  'https://snkrdunk.com/v3/search?func=all&refId=search&sortKey=default&cardVersion=2' +
  `&brandIds=pokemon&perPage=24&page=1&keyword=${encodeURIComponent(q)}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let asked = 0

console.log(`검색어 ${terms.length}종 (이미 잰 것 ${Object.keys(done).length}종) · ${GAP}ms 간격`)

for (const [ko, count] of terms) {
  if (done[ko]) continue
  const ja = translateSearchQuery(ko)
  let hits = -1
  try {
    const r = await fetch(url(ja), { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } })
    const text = await r.text()
    try {
      hits = (JSON.parse(text) as { search?: { products?: unknown[] } }).search?.products?.length ?? 0
    } catch {
      // JSON이 아니면 막힌 것이다. 더 두드리지 않고 여기서 끝낸다.
      console.log(`\n⚠️ 스니커덩크가 막았습니다(${asked}종째). 지금까지 잰 것만 저장하고 멈춥니다.`)
      console.log('   한참 뒤에 --gap 을 더 크게 줘서 다시 돌리면 이어서 잽니다.')
      break
    }
  } catch {
    hits = -1 // 통신 실패 — 이번엔 건너뛰고 다음에 다시 잰다
  }
  if (hits >= 0) done[ko] = { ko, ja, count, hits }
  asked++
  if (asked % 20 === 0) {
    writeJson()
    console.log(`  ${asked}종 잼 (누적 ${Object.keys(done).length}종)`)
  }
  await sleep(GAP)
}
writeJson()

function writeJson() {
  writeFileSync(OUT, JSON.stringify(done, null, 1))
}

// ── 결과 ────────────────────────────────────────────────────────────────
const rows = Object.values(done)
const searches = rows.reduce((s, r) => s + r.count, 0)
const okSearches = rows.filter((r) => r.hits > 0).reduce((s, r) => s + r.count, 0)
const zeros = rows.filter((r) => r.hits === 0).sort((a, b) => b.count - a.count)
console.log(`\n잰 검색어 ${rows.length}종 · 누적 검색 ${searches}번`)
console.log(`  결과가 나옴  ${okSearches}번 (${((okSearches / searches) * 100).toFixed(1)}%)`)
console.log(`  0건         ${searches - okSearches}번 · ${zeros.length}종`)
if (zeros.length) {
  console.log('\n0건인 검색어 (많이 친 순):')
  for (const z of zeros.slice(0, 60)) console.log(`  ${String(z.count).padStart(3)}번  ${z.ko.padEnd(24)} → ${z.ja}`)
  if (zeros.length > 60) console.log(`  …외 ${zeros.length - 60}종`)
}
console.log(`\n자세한 건 ${OUT}`)
