// 홈 배너 기준(SAR·SIR 이상 또는 갓팩)을 넘는 팩·박스가 얼마나 자주 나오는지,
// 실제 뽑기 로직을 그대로 돌려 센다.
// ⚠️ 시세는 빼고 등급만 본다 — 시세는 세트마다 있고 없고가 갈려 재현이 안 된다.
//    실제로는 시세 $50 이상도 기준에 들어가므로 여기 숫자는 "최소한 이만큼"이다.
// 실행: npx tsx scripts/banner-rate.mts
import { readFile } from 'node:fs/promises'
import { drawPack, drawBox, usableCards, RARITY_RANK, type PackCard } from '../src/lib/packDraw.ts'
import { livePacks } from '../src/lib/packSets.ts'

const HIGHLIGHT_RANK = 6
const PACK_TRIALS = 4000
const BOX_TRIALS = 300

console.log(`배너 기준: SR·UR 이상 또는 갓팩 (팩 ${PACK_TRIALS}회 · 박스 ${BOX_TRIALS}회)\n`)
for (const p of livePacks()) {
  const raw = JSON.parse(await readFile(`public/sets/${p.slug}.json`, 'utf8')) as { cards?: PackCard[] }
  const cards = usableCards(raw.cards ?? [])
  if (!cards.length) {
    console.log(`  ${p.slug} 카드 없음`)
    continue
  }
  const hit = (cs: PackCard[]) => cs.some((c) => (RARITY_RANK[c.r ?? ''] ?? 0) >= HIGHLIGHT_RANK)

  let packHit = 0
  for (let i = 0; i < PACK_TRIALS; i++) {
    const d = drawPack(cards, p.profile, p.godRate ?? 0, p.mirror)
    if (d.god || hit(d.cards)) packHit++
  }
  let boxHit = 0
  for (let i = 0; i < BOX_TRIALS; i++) {
    const b = drawBox(cards, p.profile, {
      packs: p.boxPacks ?? 0,
      guarantee: p.guarantee ?? null,
      godRate: p.godRate ?? 0,
      mirror: p.mirror,
    })
    if (b.god || hit(b.packs.flatMap((x) => x.cards))) boxHit++
  }
  const per = packHit ? Math.round(PACK_TRIALS / packHit) : 0
  console.log(
    `  ${p.label.padEnd(24)} 팩 ${((packHit / PACK_TRIALS) * 100).toFixed(1).padStart(4)}%` +
      ` (${per ? `${per}팩에 1번` : '안 나옴'})` +
      ` · 박스 ${p.boxPacks}팩이면 ${((boxHit / BOX_TRIALS) * 100).toFixed(0).padStart(3)}%`,
  )
}
