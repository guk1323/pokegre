// 레어도 순위표(src/lib/cardCatalog.ts의 RARITY_ORDER)에 빠진 게 없는지 센다.
//
// ⚠️ 왜 필요한가: 표에 없는 레어도는 조용히 -1이 되어 「주요 카드」 후보에서 통째로
//    빠진다. 화면에는 아무 오류도 안 뜨고 **커먼 카드가 세트 간판으로 올라갈 뿐**이라
//    눈으로는 못 잡는다(2026-08-16에 61%만 잡히고 있던 것을 이렇게 찾았다).
//    새 팩이 나오면 새 레어도가 같이 온다 — 30주년의 FUR가 그랬다.
//
// 「분모 넘는 비율」도 같이 낸다. 새 레어도를 표 어디에 넣을지 짐작하지 않으려는 것이다:
//   85%를 넘으면 시크릿 구간, 30%를 밑돌면 본세트 구간이다.
//
// 사용법: npx tsx scripts/check-rarity-order.mts
import { readFileSync, readdirSync } from 'node:fs'
import { rarityRank } from '../src/lib/cardCatalog.ts'

type S = { slug: string; denom?: number }
const idx = JSON.parse(readFileSync('public/sets/index.json', 'utf8')) as S[]
const denom = new Map(idx.map((s) => [s.slug, Number(s.denom || 0)]))

const 통 = new Map<string, { 총: number; 넘음: number; 잴수있음: number; 어디: string }>()
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const slug = f.slice(0, -5)
  const j = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8'))
  const cards: { n: string; r?: string }[] = Array.isArray(j) ? j : (j.cards ?? [])
  const d = denom.get(slug) ?? 0
  for (const c of cards) {
    const r = (c.r ?? '').trim()
    if (!r) continue
    const t = 통.get(r) ?? { 총: 0, 넘음: 0, 잴수있음: 0, 어디: slug }
    t.총++
    const n = Number(String(c.n).split('~')[0])
    if (d && Number.isFinite(n) && n > 0) {
      t.잴수있음++
      if (n > d) t.넘음++
    }
    통.set(r, t)
  }
}

// 「없는 것」이 정답인 레어도. 등급이 아니라 상태·분류라서 순위를 매길 수 없다.
const 일부러안넣음 = new Set(['None', 'Unconfirmed', 'Promo', 'Classic Collection'])

const 빠진것 = [...통]
  .filter(([r]) => rarityRank(r) < 0 && !일부러안넣음.has(r))
  .sort((a, b) => b[1].총 - a[1].총)

// ⚠️ 「일부러 안 넣은 것」은 분모에서 뺀다. 안 빼면 등급이 아닌 것(None·Promo) 1만 4천 장
//    때문에 비율이 늘 76%쯤에 머물러, **정말 빠진 게 있는지 없는지 알 수 없다.**
let 잡힘 = 0
let 잴것 = 0
let 뺀것 = 0
for (const [r, t] of 통) {
  if (일부러안넣음.has(r)) {
    뺀것 += t.총
    continue
  }
  잴것 += t.총
  if (rarityRank(r) >= 0) 잡힘 += t.총
}
console.log(`등급이 있는 카드 ${잴것.toLocaleString()}장 · 순위가 잡히는 것 ${잡힘.toLocaleString()}장 (${((100 * 잡힘) / 잴것).toFixed(1)}%)`)
console.log(`등급이 아니라 뺀 것 ${뺀것.toLocaleString()}장: ${[...일부러안넣음].join(', ')}`)

if (!빠진것.length) {
  console.log('\n표에 빠진 레어도 없음.')
  process.exit(0)
}

console.log(`\n⚠️ 표에 없는 레어도 ${빠진것.length}가지 — RARITY_ORDER에 넣어야 「주요 카드」에 나온다:\n`)
console.log('   장수  분모넘는비율   넣을 곳          레어도 (예: 세트)')
for (const [r, t] of 빠진것) {
  const pct = t.잴수있음 ? (100 * t.넘음) / t.잴수있음 : NaN
  const 어디 = !t.잴수있음 ? '분모를 몰라 못 잼' : pct >= 85 ? '시크릿 구간' : pct <= 30 ? '본세트 구간' : '애매 — 눈으로 볼 것'
  console.log(
    String(t.총).padStart(7),
    (t.잴수있음 ? pct.toFixed(0) + '%' : '-').padStart(12),
    '  ' + 어디.padEnd(16),
    r + '  (' + t.어디 + ')',
  )
}
process.exit(1)
