/**
 * **printings 전환 회귀 검증** — 새 2단 파서가 옛 파서와 같은 답을 내는지, 그리고
 * printings를 먹였을 때 값이 좋아지기만 하는지 본다. **크레딧 0**(받아 둔 파일로만).
 *
 * ⚠️ 서버와 **같은 함수**(loadPricesFromCsv의 시험 입구)를 쓴다.
 *
 * 실행:
 *   npx tsx scripts/check-printings-switch.mts <cards.csv> <옛 pack-prices.json>          회귀(같아야 함)
 *   npx tsx scripts/check-printings-switch.mts <cards.csv> <옛.json> <printings.csv>      전환까지(내일)
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const 임시 = mkdtempSync(path.join(tmpdir(), 'pokegre-printings-'))
process.env.POKEGRE_DATA_DIR = 임시
const { loadPricesFromCsv } = await import('../server/api.ts')

const [cardsCsv, 옛출력, printingsCsv] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!cardsCsv || !옛출력) {
  console.log('쓰기: npx tsx scripts/check-printings-switch.mts <cards.csv> <옛 pack-prices.json> [printings.csv]')
  process.exit(1)
}

type 팩값 = Record<string, { prices: Record<string, number> }>
const 읽기 = (p2: string): 팩값 => JSON.parse(readFileSync(p2, 'utf-8'))

// ── ① cards를 새 파서로 → 옛 출력과 전수 비교 ────────────────────────────────
console.log('① cards 덤프를 새 파서에 태워 옛 결과와 비교')
await loadPricesFromCsv('', 'cards', readFileSync(cardsCsv, 'utf-8'))
const 새것 = 읽기(path.join(임시, 'pack-prices.json'))
const 옛것 = 읽기(옛출력)
let 같음 = 0, 다름 = 0, 새로생김 = 0, 사라짐 = 0
const 다른예: string[] = []
for (const [slug, 옛s] of Object.entries(옛것)) {
  for (const [num, v] of Object.entries(옛s.prices ?? {})) {
    const 새v = 새것[slug]?.prices?.[num]
    if (새v === undefined) { 사라짐++; if (다른예.length < 8) 다른예.push(`사라짐 ${slug} ${num} (옛 $${v})`) }
    else if (Math.abs(새v - v) > 0.005) { 다름++; if (다른예.length < 8) 다른예.push(`다름 ${slug} ${num}: 옛 $${v} → 새 $${새v}`) }
    else 같음++
  }
}
for (const [slug, 새s] of Object.entries(새것))
  for (const num of Object.keys(새s.prices ?? {})) if (옛것[slug]?.prices?.[num] === undefined) 새로생김++
console.log(`   같음 ${같음.toLocaleString()} · 다름 ${다름} · 사라짐 ${사라짐} · 새로 생김 ${새로생김}`)
다른예.forEach((x) => console.log('   ✗ ' + x))
const 회귀통과 = 다름 === 0 && 사라짐 === 0
console.log(회귀통과 ? '   ○ 회귀 통과 — 새 파서는 cards에서 옛 파서와 완전히 같다' : '   ✗ 회귀 실패')

// 대표 인쇄판을 배웠는지
const 대표표 = path.join(임시, 'printing-primary.json')
console.log(`   대표 인쇄판 배움: ${existsSync(대표표) ? Object.keys(JSON.parse(readFileSync(대표표, 'utf-8'))).length.toLocaleString() + '장' : '파일 없음 ✗'}`)

// ── ② printings를 먹이면 (내일 실물로) ──────────────────────────────────────
if (printingsCsv) {
  console.log('\n② printings 덤프를 태워 "좋아지기만 했는지" 비교')
  await loadPricesFromCsv('', 'printings', readFileSync(printingsCsv, 'utf-8'))
  const 전환 = 읽기(path.join(임시, 'pack-prices.json'))
  let 유지 = 0, 바뀜 = 0, 채워짐 = 0, 잃음 = 0
  const 바뀐예: string[] = []
  for (const [slug, 새s] of Object.entries(새것)) {
    for (const [num, v] of Object.entries(새s.prices ?? {})) {
      const t = 전환[slug]?.prices?.[num]
      if (t === undefined) { 잃음++; if (바뀐예.length < 10) 바뀐예.push(`잃음 ${slug} ${num} (cards $${v})`) }
      else if (Math.abs(t - v) / Math.max(v, 0.01) > 0.25 && Math.abs(t - v) > 2) { 바뀜++; if (바뀐예.length < 10) 바뀐예.push(`바뀜 ${slug} ${num}: $${v} → $${t}`) }
      else 유지++
    }
  }
  for (const [slug, ts] of Object.entries(전환))
    for (const num of Object.keys(ts.prices ?? {})) if (새것[slug]?.prices?.[num] === undefined) 채워짐++
  console.log(`   유지 ${유지.toLocaleString()} · 크게 바뀜(25%+) ${바뀜} · 새로 채워짐 ${채워짐} · 잃음 ${잃음}`)
  바뀐예.forEach((x) => console.log('   · ' + x))
  const 인쇄 = path.join(임시, 'printing-prices.json')
  if (existsSync(인쇄)) {
    const j = JSON.parse(readFileSync(인쇄, 'utf-8')) as Record<string, Record<string, { c?: number[] }>>
    const 카드수 = Object.keys(j).length
    let 상태있음 = 0, 여러판 = 0
    for (const v of Object.values(j)) { if (Object.keys(v).length > 1) 여러판++; if (Object.values(v).some((x) => x.c)) 상태있음++ }
    console.log(`   인쇄판별 시세: 카드 ${카드수.toLocaleString()}장 · 인쇄판 여럿 ${여러판.toLocaleString()}장 · 상태별 5칸 ${상태있음.toLocaleString()}장`)
  }
}

rmSync(임시, { recursive: true, force: true })
process.exit(회귀통과 ? 0 : 1)
