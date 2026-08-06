// 세트 데이터가 잃은 **카드 이름 접미사**를 작가 데이터에서 채운다.
//
// 왜: en-dp4에 디아루가가 두 장(16·105번)인데 세트 데이터는 둘 다 "Dialga"다. 실제로
// 105번은 "Dialga LV.X"로 다른 카드다. 그러면 세트별 목록에서 구분이 안 되고, 눌렀을 때
// 검색어도 "디아루가"로 나가 LV.X 카드를 못 찾는다(2026-08-07 발견).
//
// 작가 데이터는 다른 소스(pokemontcg.io)라 접미사를 갖고 있다. 원본에 직접 물어
// 확인했다 — swshp-SWSH135는 원본도 "Zacian LV.X"라고 답한다.
//
// ⚠️ **작가 쪽 이름이 세트 쪽 이름을 통째로 품고 뒤에만 더 붙은 경우**만 채운다.
//    글자가 서로 다른 것은 손대지 않는다 — 어느 쪽이 옳은지 알 수 없다.
// ⚠️ 돌린 뒤 도감을 다시 만들고, 전체 카드 이름을 떠서 diff할 것.
//
// 쓰는 법: npx tsx scripts/fill-set-name-suffix.mts [--write]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const 번호열쇠 = (n: string) => String(n).replace(/^0+(?=[0-9])/, '').toLowerCase()
const 다듬 = (s: string) => String(s).replace(/[\s\-–—]/g, '').toLowerCase()

// 작가 데이터에서 "세트|번호 → 이름"을 모은다.
const 작가이름 = new Map<string, string>()
for (const f of readdirSync(path.join(ROOT, 'public/artists'))) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'by-card.json') continue
  const d = JSON.parse(readFileSync(path.join(ROOT, 'public/artists', f), 'utf-8')) as any
  for (const c of d.cards ?? []) {
    if (!c.s) continue
    작가이름.set(`${c.s}|${번호열쇠(c.number)}`, String(c.name))
  }
}

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
let 고침 = 0
const 표: string[] = []
for (const s of idx) {
  const p = path.join(ROOT, 'public/sets', `${s.slug}.json`)
  let d: any
  try {
    d = JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    continue
  }
  let 바뀜 = false
  for (const c of d.cards ?? []) {
    const 작가쪽 = 작가이름.get(`${s.slug}|${번호열쇠(c.n)}`)
    if (!작가쪽) continue
    const 세트쪽 = String(c.name)
    if (다듬(세트쪽) === 다듬(작가쪽)) continue
    // 세트 이름을 통째로 품고 뒤에만 더 붙은 경우만.
    if (!다듬(작가쪽).startsWith(다듬(세트쪽))) continue
    표.push(`${s.id} ${String(c.n).padEnd(8)} "${세트쪽}" → "${작가쪽}"`)
    c.name = 작가쪽
    바뀜 = true
    고침++
  }
  if (WRITE && 바뀜) writeFileSync(p, JSON.stringify(d))
}
console.log(`\n  접미사를 채울 카드 ${고침}장\n`)
표.slice(0, 20).forEach((e) => console.log(`      ${e}`))
if (표.length > 20) console.log(`      … 그 밖 ${표.length - 20}장`)
console.log(WRITE ? '\n  저장했다. 도감을 다시 만들고 이름을 diff할 것.\n' : '\n  (미리보기 — --write 로 저장)\n')
