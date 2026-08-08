/**
 * 카드 뽑기(PackSim)에서 **아예 안 나오는 카드**를 찾는다.
 *
 * 뽑기는 레어도로 칸을 굴린다. 세트에 있는 레어도인데 확률표에 없으면 그 카드는
 * 몇 번을 뽑아도 안 나온다 — 화면에는 세트에 있는 것처럼 보이는데도.
 *
 * **2026-08-08 결과: 236장이 안 나온다.** 그중 226장이 일본판 SR(ex 풀아트)이다.
 *   우리 세트 자료는 SR을 "Secret Rare"로 적는데, 확률표에는 그 등급이 없다.
 *   일본판 29개 팩이 해당한다(ja-SV2a 16장 · ja-M2 17장 …).
 *   ⚠️ **확률은 사장님이 정하실 일이라 손대지 않았다.** 뽑기 확률표는 사용자가 준
 *      실측표다(2026-07-26). 없는 등급을 내가 지어 넣으면 뽑기가 통째로 달라진다.
 *      "None"·"Black White Rare" 10장은 등급 자체가 정상이 아니라 따로 봐야 한다.
 *
 * 실행: npx tsx scripts/check-pack-pools.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { PACK_SETS, GOD_TIERS } from '../src/lib/packSets.ts'
import { RARITY_RANK } from '../src/lib/packDraw.ts'

const src = readFileSync('src/lib/packSets.ts', 'utf8')
// 확률표에 실제로 적힌 레어도(굴림 대상)
const 굴리는것 = new Set<string>([...src.matchAll(/\[\s*'([^']+)'\s*,\s*[\d.]+\s*\]/g)].map((m) => m[1]))
for (const t of GOD_TIERS as string[]) 굴리는것.add(t)
console.log('확률표에 있는 레어도:', [...굴리는것].join(' · '))

let 총 = 0
let 못나옴 = 0
const 갈래 = new Map<string, number>()
const 세트별: [string, number, number][] = []
for (const p of PACK_SETS as { slug: string }[]) {
  const f = `public/sets/${p.slug}.json`
  if (!existsSync(f)) continue
  const cards = (JSON.parse(readFileSync(f, 'utf8')).cards ?? []) as { r?: string }[]
  let n = 0
  for (const c of cards) {
    총++
    const r = c.r ?? ''
    // Common·Uncommon·Rare는 칸이 따로 있어 굴림 목록에 없어도 나온다.
    if (!r || r === 'Common' || r === 'Uncommon' || r === 'Rare' || 굴리는것.has(r)) continue
    못나옴++
    n++
    갈래.set(r, (갈래.get(r) ?? 0) + 1)
  }
  if (n) 세트별.push([p.slug, n, cards.length])
}
console.log(`\n팩 세트 카드 ${총.toLocaleString()}장 중 **아예 안 나오는** 카드 ${못나옴}장`)
for (const [k, v] of [...갈래].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)}장  "${k}"  ← 확률표에 없다`)
console.log(`\n그런 팩 ${세트별.length}개:`)
for (const [s, n, all] of 세트별.sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${s.padEnd(12)} ${String(n).padStart(3)}/${all}장`)
console.log('\n※ RARITY_RANK에만 있고 확률표에 없는 것도 못 나온다 — 둘 다 있어야 나온다.')
console.log('   RARITY_RANK:', Object.keys(RARITY_RANK).join(' · '))
