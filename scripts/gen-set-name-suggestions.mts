/**
 * **세트 이름 한글 목록**을 만든다(자동완성·검색용). `src/data/setNamesKo.json`
 *
 * 왜 — 카드 이름은 한글로 찾히는데 **세트 이름은 안 찾혔다**(「프론티어」·「메갈로」 0건).
 * 방문자가 닿는 곳은 전부 한글로 되어야 한다는 원칙에 어긋난다(2026-08-09 사장님 지적).
 *
 * ⚠️ 세트 이름은 카드 이름과 달리 **고르면 그 세트로 가야** 뜻이 있다. 그래서 이름만이
 *    아니라 **주소(slug)를 같이** 담는다 — 화면이 그걸 보고 세트 화면으로 보낸다.
 * ⚠️ 세트를 새로 넣은 뒤에는 `gen-card-name-suggestions.mts`와 **같이** 다시 돌릴 것.
 *
 * 실행: npx tsx scripts/gen-set-name-suggestions.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koSet } from '../src/lib/koCardName.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const idx = JSON.parse(readFileSync(join(ROOT, 'public/sets/index.json'), 'utf8')) as {
  slug: string
  ed?: string
  name?: string
  count?: number
}[]

const 목록: { ko: string; slug: string }[] = []
const 본이름 = new Set<string>()
let 한글못됨 = 0
for (const s of idx) {
  const ko = koSet(s.ed === 'ja' ? 'ja' : 'en', String(s.name ?? '')).trim()
  if (!ko) continue
  // ⚠️ 같은 한글 이름이 둘이면 **카드가 많은 쪽**을 남긴다(방문자가 찾을 확률이 높다).
  const 있 = 목록.findIndex((x) => x.ko === ko)
  if (있 >= 0) {
    const 옛 = idx.find((x) => x.slug === 목록[있].slug)
    if ((s.count ?? 0) > (옛?.count ?? 0)) 목록[있] = { ko, slug: s.slug }
    continue
  }
  목록.push({ ko, slug: s.slug })
  본이름.add(ko)
  if (!/[가-힣]/.test(ko)) 한글못됨++
}
목록.sort((a, b) => a.ko.localeCompare(b.ko))
const 곳 = join(ROOT, 'src/data/setNamesKo.json')
writeFileSync(곳, JSON.stringify(목록) + '\n')
console.log(`세트 이름 ${목록.length}가지를 ${곳.replace(ROOT + '/', '')}에 적었습니다 (${(Buffer.byteLength(JSON.stringify(목록)) / 1024).toFixed(0)}KB)`)
console.log(`한글이 하나도 없는 이름 ${한글못됨}개${한글못됨 ? ' — SET_KO에 넣어야 합니다' : ''}`)
if (한글못됨) {
  console.log('   ' + 목록.filter((x) => !/[가-힣]/.test(x.ko)).slice(0, 20).map((x) => x.ko).join(' · '))
}
