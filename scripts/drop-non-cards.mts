/**
 * **카드가 아닌 것을 도감에서 뺀다** (사장님 지시 2026-08-11: "우리는 포켓몬 tcg카드만
 * 취급하니까 다른건 다 제외하자 … 카드 아닌건 다 빼").
 *
 * | 무엇 | 장수 | 왜 빼나 |
 * |---|---|---|
 * | `Code Card - …` | 794 | 온라인 게임 코드일 뿐 실물 카드로 아무 뜻이 없다. **794장 전부 값이 0원**이고, 전부 저쪽 번호를 갖고 있어 **검색 결과와 84개 세트 목록에 그대로 뜬다**. 카드 뽑기에는 원래 안 나온다(레어도 `Code Card`가 확률표에 없다). |
 * | `Energy Sticker` | 7 | 팩에 든 스티커. 게임에 못 쓴다 |
 * | `Energy Coin` | 6 | 팩에 든 코인. 게임에 못 쓴다 |
 * | `VSTAR Token` | 1 | 마커지 카드가 아니다 |
 *
 * ⚠️⚠️ **이름에 든 낱말만 보고 빼면 진짜 카드가 날아간다.** 처음에 `coin|sticker|token|
 *    counter|dice`로 훑었더니 **「Counter Catcher」·「Counter Gain」·「Counter Energy」
 *    (실제 트레이너·에너지 카드 40여 장)·「Amulet Coin」(부적금화)·「Greedy Dice」·
 *    「Trick Coin」·「Jumbo Ice Cream」**까지 걸렸다. 전부 멀쩡한 카드다.
 *    그래서 **이름이 그것으로 시작하는 것만** 뺀다(뒤에 괄호 변형만 허용).
 *
 * ```
 * npx tsx scripts/drop-non-cards.mts          무엇이 빠지는지만 본다
 * npx tsx scripts/drop-non-cards.mts --write  실제로 뺀다
 * ```
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const 쓰기 = process.argv.includes('--write')
const 뿌리 = path.resolve(import.meta.dirname, '..')
const 세트경로 = (p: string) => path.join(뿌리, 'public/sets', p)

type 카드 = { n?: string; name?: string; en?: string; r?: string; [k: string]: unknown }

/** ⚠️ **이름이 이것으로 시작할 때만** 뺀다. 괄호 변형(`(Poke Ball Pattern)`)은 허용한다. */
const 뺄것: [string, RegExp][] = [
  ['코드 카드', /^code card\b/i],
  ['에너지 스티커', /^energy sticker\b/i],
  ['에너지 코인', /^energy coin\b/i],
  ['VSTAR 토큰', /^vstar token\b/i],
]

const idx = JSON.parse(readFileSync(세트경로('index.json'), 'utf-8')) as { slug: string; name?: string; count?: number }[]

const 갈래셈 = new Map<string, number>()
let 총뺌 = 0
const 세트별: { slug: string; 이름: string; 전: number; 후: number }[] = []
const 빈세트: string[] = []

for (const s of idx) {
  const 파일 = 세트경로(`${s.slug}.json`)
  let j: { cards?: 카드[] }
  try {
    j = JSON.parse(readFileSync(파일, 'utf-8'))
  } catch {
    continue
  }
  const cards = j.cards ?? []
  const 남길: 카드[] = []
  let 뺀수 = 0
  for (const c of cards) {
    const 이름 = String(c.en || c.name || '')
    const 걸린 = 뺄것.find(([, re]) => re.test(이름))
    if (걸린) {
      갈래셈.set(걸린[0], (갈래셈.get(걸린[0]) ?? 0) + 1)
      뺀수++
      continue
    }
    남길.push(c)
  }
  if (!뺀수) continue
  총뺌 += 뺀수
  세트별.push({ slug: s.slug, 이름: String(s.name ?? ''), 전: cards.length, 후: 남길.length })
  // ⚠️ 세트가 통째로 비면 목록에 빈 세트가 남는다 — 그런 세트가 있으면 알린다.
  if (!남길.length) 빈세트.push(s.slug)
  if (쓰기) {
    j.cards = 남길
    writeFileSync(파일, JSON.stringify(j))
  }
}

console.log(`카드가 아닌 것 **${총뺌.toLocaleString()}장**을 세트 ${세트별.length}개에서 ${쓰기 ? '뺐습니다' : '뺄 수 있습니다'}`)
for (const [k, n] of [...갈래셈].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}장  ${k}`)
console.log('\n제일 많이 빠지는 세트:')
for (const r of 세트별.sort((a, b) => b.전 - b.후 - (a.전 - a.후)).slice(0, 8))
  console.log(`   ${String(r.전 - r.후).padStart(3)}장  ${r.slug.padEnd(30)} ${r.전}→${r.후}  ${r.이름.slice(0, 30)}`)
if (빈세트.length) console.log(`\n⚠️ 통째로 비는 세트 ${빈세트.length}개: ${빈세트.join(', ')}`)

// ⚠️ 세트 머리글의 「N종」은 index.json의 `count`에서 온다 — 같이 맞춘다(다시 돌려도 안전).
let 셈고침 = 0
for (const s of idx) {
  let 장수 = 0
  try {
    장수 = (JSON.parse(readFileSync(세트경로(`${s.slug}.json`), 'utf-8')).cards ?? []).length
  } catch {
    continue
  }
  if (s.count !== 장수) {
    if (쓰기) s.count = 장수
    셈고침++
  }
}
if (셈고침) console.log(`\n세트 목록의 「N종」이 실제와 다른 곳 ${셈고침}개${쓰기 ? ' — 맞췄습니다' : ''}`)
if (쓰기 && 셈고침) writeFileSync(세트경로('index.json'), JSON.stringify(idx))
console.log(쓰기 ? '\n→ 도감을 고쳤습니다. gen-pokedex와 자동완성도 다시 돌리세요.' : '\n→ 미리보기입니다. 실제로 빼려면 --write')
