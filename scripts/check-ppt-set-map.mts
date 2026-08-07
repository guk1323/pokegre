// PPT 세트 대응표에 적힌 이름이 **실제로 PPT에서 통하는지** 잰다.
//
// 왜: 대응표가 331개인데, 적어 놓고 통하는지 확인한 적이 없다. 이름이 틀리면
// 세트를 걸어도 0건이라 그 세트 카드는 값이 통째로 안 뜬다 — 그런데 화면에는
// "이 마켓에 값이 없습니다"로만 보여서, 틀린 대응표와 원래 값이 없는 카드를
// 가릴 수 없다(2026-08-07).
//
// 재는 법: 세트마다 카드 한 장을 골라 **세트를 걸고** 찾는다. 결과가 있고 그 setName이
// 우리가 보낸 것과 같으면 통하는 것이다. 0건이면 대응표가 틀렸거나 그 카드가 PPT에
// 없는 것이라, 0건인 세트만 나중에 따로 본다.
//
// ⚠️ 카드 1장에 12크레딧이다. 기본 30개 = 360크레딧.
//
// 쓰는 법: npx tsx scripts/check-ppt-set-map.mts [개수]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/cardCatalog.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '..')
const BASE = process.env.PG_BASE ?? 'http://localhost:8787'
const 볼개수 = Number(process.argv[2] ?? 30)
const 다듬 = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 표 = pptSetNames as Record<string, string>
// 대응표에 있고 우리 카드도 있는 세트만. 고르게 흩어 뽑는다.
const 후보 = sidx.filter((s) => 표[s.slug] && (s.count ?? 0) > 0)
const 걸음 = Math.max(1, Math.floor(후보.length / 볼개수))
const 뽑음 = 후보.filter((_, i) => i % 걸음 === 0).slice(0, 볼개수)

let 통함 = 0, 다른세트 = 0, 영건 = 0, 실패 = 0, 막힘 = 0
const 영건목록: string[] = []
const 다른것: string[] = []
for (let i = 0; i < 뽑음.length; i++) {
  const s = 뽑음[i]
  const setName = 표[s.slug]
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  // 가운데쯤 카드 한 장. 첫 장은 프로모·에너지일 때가 있다.
  const c = d.cards?.[Math.floor((d.cards.length - 1) * 0.5)]
  if (!c) continue
  const en = s.ed === 'en'
  const q = en ? String(c.name) : translateSearchQueryToEnglish(koName('ja', String(c.name)), 'japanese')
  const p = new URLSearchParams({ language: en ? 'english' : 'japanese', search: q, includeEbay: 'false', limit: '12', offset: '0', sortBy: 'price', sortOrder: 'desc', setName })
  try {
    const r = await fetch(`${BASE}/api/local/card-prices?${p}`, { signal: AbortSignal.timeout(30000) })
    if (r.status === 429) { 막힘++; if (막힘 >= 3) break; await new Promise((x) => setTimeout(x, 70000)); i--; continue }
    막힘 = 0
    if (!r.ok) { 실패++; continue }
    const j = (await r.json()) as any
    const cs = j.cards ?? []
    if (!cs.length) { 영건++; 영건목록.push(`${s.slug.padEnd(14)} "${setName}"  (찾은 말: ${q})`); continue }
    // 돌려준 카드의 setName이 우리가 보낸 것과 같은가
    if (cs.some((x: any) => 다듬(String(x.setName ?? '')) === 다듬(setName))) 통함++
    else { 다른세트++; 다른것.push(`${s.slug.padEnd(14)} 보낸 것 "${setName}" ↔ 온 것 "${cs[0]?.setName}"`) }
  } catch { 실패++ }
  await new Promise((x) => setTimeout(x, 1500))
}
const 본것 = 통함 + 다른세트 + 영건
console.log(`\n  대응표 ${후보.length}개 중 ${본것}개를 봄${실패 ? ` · 실패 ${실패}` : ''}${막힘 >= 3 ? ' · 한도로 멈춤' : ''}`)
console.log(`  ✓ 이름이 통함        ${통함}개`)
console.log(`  △ 0건 (이름이 틀렸거나 그 카드가 PPT에 없음) ${영건}개`)
console.log(`  ✗ 다른 세트가 옴     ${다른세트}개\n`)
if (다른것.length) { console.log('  [다른 세트가 온 것]'); 다른것.forEach((l) => console.log(`      ${l}`)) }
if (영건목록.length) { console.log('\n  [0건]'); 영건목록.slice(0, 20).forEach((l) => console.log(`      ${l}`)) }
console.log('')
