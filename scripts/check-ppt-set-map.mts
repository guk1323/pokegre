// PPT 세트 대응표에 적힌 이름이 **실제로 PPT에서 통하는지** 잰다.
//
// 왜: 대응표가 331개인데, 적어 놓고 통하는지 확인한 적이 없다. 이름이 틀리면
// 세트를 걸어도 0건이라 그 세트 카드는 값이 통째로 안 뜬다 — 그런데 화면에는
// "이 마켓에 값이 없습니다"로만 보여서, 틀린 대응표와 원래 값이 없는 카드를
// 가릴 수 없다(2026-08-07).
//
// 재는 법: **search를 안 보내고 setName만 걸어** 조회한다. 그 세트에 카드가 있으면
// 값이 높은 순으로 돌아온다.
//
// ⚠️ 처음엔 세트마다 카드 한 장을 골라 이름으로 찾았는데, 30개 중 18개가 0건이었다.
//    원인은 대응표가 아니라 **고른 카드가 흔한 코먼이라 PPT에 시세가 없던 것**이었다
//    (Skarmory·Abra·Bagon…). 세트만 걸면 그 세트에서 제일 비싼 카드가 오므로
//    "이름이 통하는가"만 깨끗하게 가려진다(2026-08-07).
//
// ⚠️ 크레딧은 limit에 매겨진다. limit=3이면 세트당 3크레딧이라 331개 전수가 1,000 안쪽이다.
//
// 쓰는 법: npx tsx scripts/check-ppt-set-map.mts [개수]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '..')
const BASE = process.env.PG_BASE ?? 'http://localhost:8787'
const 볼개수 = Number(process.argv[2] ?? 400)
const PAGE = Number(process.env.PAGE ?? 3)
// 한도에 걸려 끊기면 이미 본 것을 또 보지 않게 시작 자리를 준다.
const 시작 = Number(process.argv[3] ?? 0)
const 다듬 = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 표 = pptSetNames as Record<string, string>
// 대응표에 있고 우리 카드도 있는 세트만. 고르게 흩어 뽑는다.
const 후보 = sidx.filter((s) => 표[s.slug] && (s.count ?? 0) > 0)
const 걸음 = Math.max(1, Math.floor(후보.length / 볼개수))
const 뽑음 = 후보.filter((_, i) => i % 걸음 === 0).slice(시작, 시작 + 볼개수)
console.log(`  ${후보.length}개 중 ${시작}번째부터 ${뽑음.length}개를 본다`)

let 통함 = 0, 다른세트 = 0, 영건 = 0, 실패 = 0, 막힘 = 0
const 영건목록: string[] = []
const 다른것: string[] = []
for (let i = 0; i < 뽑음.length; i++) {
  const s = 뽑음[i]
  const setName = 표[s.slug]
  const en = s.ed === 'en'
  const p = new URLSearchParams({ language: en ? 'english' : 'japanese', includeEbay: 'false', limit: String(PAGE), offset: '0', sortBy: 'price', sortOrder: 'desc', setName })
  try {
    const r = await fetch(`${BASE}/api/local/card-prices?${p}`, { signal: AbortSignal.timeout(30000) })
    if (r.status === 429) { 막힘++; if (막힘 >= 3) break; await new Promise((x) => setTimeout(x, 70000)); i--; continue }
    막힘 = 0
    if (!r.ok) { 실패++; continue }
    const j = (await r.json()) as any
    const cs = j.cards ?? []
    // ⚠️ **cards가 아니라 rawCount를 봐야 한다.** 우리 서버는 이베이 낙찰 기록이 있는
    //    카드만 남기므로(shapeEbayCards), 세트는 멀쩡한데 cards가 0이 될 수 있다.
    //    limit=3으로 재다가 S2a·PCG9 같은 멀쩡한 세트를 "이름이 틀렸다"고 셌다
    //    (2026-08-07). rawCount는 거르기 전 개수라 "PPT가 이 세트를 아는가"를 곧장 말해 준다.
    if (!(j.rawCount ?? 0)) { 영건++; 영건목록.push(`${s.slug.padEnd(14)} ${String(s.count).padStart(4)}장  "${setName}"`); continue }
    if (!cs.length) { 통함++; continue }
    // 돌려준 카드의 setName이 우리가 보낸 것과 같은가.
    // ⚠️ **앞부분만 같아도 통하는 것으로 본다.** PPT는 부분 일치라 하위 세트를 함께 주고
    //    (Crown Zenith → Crown Zenith: Galarian Gallery), 값 높은 순이라 하위 쪽이 위에
    //    온다. 그래도 번호 체계가 달라(001~ vs GG01~) 앱이 번호로 그 카드를 고르므로
    //    문제가 아니다 — 전수로 세어 겹치는 번호가 0장인 것을 확인했다(2026-08-07).
    if (cs.some((x: any) => 다듬(String(x.setName ?? '')).startsWith(다듬(setName)))) 통함++
    else { 다른세트++; 다른것.push(`${s.slug.padEnd(14)} 보낸 것 "${setName}" ↔ 온 것 "${cs[0]?.setName}"`) }
  } catch { 실패++ }
  await new Promise((x) => setTimeout(x, 1500))
}
const 본것 = 통함 + 다른세트 + 영건
console.log(`\n  대응표 ${후보.length}개 중 ${본것}개를 봄${실패 ? ` · 실패 ${실패}` : ''}${막힘 >= 3 ? ' · 한도로 멈춤' : ''}`)
console.log(`  ✓ 이름이 통함        ${통함}개`)
console.log(`  ✗ 0건 — 이 이름으로는 PPT에 그 세트가 없다  ${영건}개`)
console.log(`  ✗ 다른 세트가 옴     ${다른세트}개\n`)
if (다른것.length) { console.log('  [다른 세트가 온 것]'); 다른것.forEach((l) => console.log(`      ${l}`)) }
if (영건목록.length) {
  console.log('\n  [0건 — 고쳐야 할 것]')
  영건목록.forEach((l) => console.log(`      ${l}`))
}
console.log('')
