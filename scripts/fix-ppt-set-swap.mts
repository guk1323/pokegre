// PPT 세트 대응표에서 **짝이 뒤바뀐 것**을 맞바꾼다.
//
// 왜: XY 시리즈의 a/b 네 쌍이 서로 뒤바뀌어 있었다(2026-08-07 발견).
//   ja-XY1a "컬렉션X"  → "Collection Y"    (X인데 Y)
//   ja-XY8a "푸른 충격" → "Red Flash"       (파랑인데 빨강)
// 그 세트 카드를 누르면 PPT에 남의 세트 이름이 나가 엉뚱한 카드를 찾거나 0건이 된다.
//
// ⚠️ 두 슬러그의 값을 **맞바꾸기만** 한다. 새 이름을 지어내지 않으므로, 대응표에 이미
//    있던(=PPT에 실재하는) 이름만 쓰인다.
//
// 쓰는 법: npx tsx scripts/fix-ppt-set-swap.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const p = path.join(ROOT, 'src/data/pptSetNames.json')
const map = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, string>
const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 이름 = new Map(idx.map((s) => [s.slug, s.name]))

/** 서로 값이 뒤바뀐 짝 */
const 맞바꿀짝: [string, string][] = [
  ['ja-XY1a', 'ja-XY1b'],
  ['ja-XY5a', 'ja-XY5b'],
  ['ja-XY8a', 'ja-XY8b'],
  ['ja-XY11a', 'ja-XY11b'],
]

let 고침 = 0
for (const [a, b] of 맞바꿀짝) {
  if (!map[a] || !map[b]) {
    console.log(`  ⚠️ ${a} 또는 ${b}가 대응표에 없다 — 건너뛴다`)
    continue
  }
  console.log(`  ${a} "${이름.get(a)}"  "${map[a]}" → "${map[b]}"`)
  console.log(`  ${b} "${이름.get(b)}"  "${map[b]}" → "${map[a]}"`)
  const t = map[a]
  map[a] = map[b]
  map[b] = t
  고침 += 2
}
if (WRITE && 고침) writeFileSync(p, JSON.stringify(map, null, 2) + '\n')
console.log(`\n  ${고침}개${WRITE ? ' 맞바꿔 저장했다' : ' (미리보기 — --write 로 저장)'}\n`)
