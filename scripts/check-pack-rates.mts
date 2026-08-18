/**
 * **뽑기 확률 검증** — 확률표대로 실제로 나오는지 **직접 뽑아서** 센다. 크레딧 0.
 *
 * ⚠️ 확률표만 읽어서는 못 잡는 버그가 있다. 2026-08-11에 등급 이름 대소문자가 안 맞아
 *    **영문판 15개 세트에서 상위 등급이 통째로 안 나오고 있었다** — 표는 멀쩡했다.
 *    그래서 이 도구는 **서버가 쓰는 그 함수(drawPack)로 실제로 뽑는다.**
 *
 * 실행: npm run 뽑기검증
 */
import { readFileSync, existsSync } from 'node:fs'
import { PACK_SETS, DAILY_BUDGET } from '../src/lib/packSets.ts'
import { drawPack, usableCards, rankOf } from '../src/lib/packDraw.ts'

const N = Number(process.argv.find((a) => /^\d+$/.test(a))) || 5000
const 카드읽기 = (src: string) => {
  const rel = src.replace(/^\//, '')
  for (const b of ['public', 'dist']) if (existsSync(`${b}/${rel}`)) return JSON.parse(readFileSync(`${b}/${rel}`, 'utf-8'))
  return null
}

let 검사 = 0
let 나쁨 = 0
let 빠진카드 = 0
console.log(`팩 세트 ${PACK_SETS.length}개 · 세트당 ${N.toLocaleString()}팩\n`)
for (const s of PACK_SETS) {
  const raw = 카드읽기(s.src)
  if (!raw) { console.log(`  ? ${s.slug} 카드 파일 없음`); continue }
  const 전부 = (raw.cards ?? raw).map((c: { r?: string }) => ({ ...c, r: s.rarityAlias?.[c.r ?? ''] ?? c.r }))
  const cards = usableCards(전부)
  // ⚠️ 순위표에 없어 통째로 빠지는 카드가 있나.
  //    **일부러 빼는 등급은 뺀다** — 뽑기 대상이 아닌 것들이라 경고가 아니다:
  //      코드 카드(실물 카드가 아님) · 프로모(팩에 안 들어감) ·
  //      Holo Rare(en-sv10.5b의 볼 패턴 변형 — 미러로 따로 처리) ·
  //      Black White Rare(en-sv10.5w 전용 등급, 확률표에 자리가 없다)
  const 제외해도되는 = /code card|promo|holo rare|black white rare/i
  const 빠짐 = 전부.filter((c: { r?: string }) => !cards.includes(c) && !제외해도되는.test(String(c.r ?? '')))
  if (빠짐.length) { 빠진카드 += 빠짐.length; console.log(`  ✗ ${s.slug} 뽑기에서 빠진 카드 ${빠짐.length}장: ${[...new Set(빠짐.map((c: { r?: string }) => c.r))].join(', ')}`) }

  const 셈 = new Map<string, number>()
  for (let i = 0; i < N; i++)
    for (const c of drawPack(cards, s.profile, s.godRate ?? 0, s.mirror).cards) {
      const k = String(c.r ?? '').toLowerCase()
      셈.set(k, (셈.get(k) ?? 0) + 1)
    }
  for (const [등급, 기대] of s.profile.slots.flatMap((x) => x.rolls ?? [])) {
    if (!cards.some((c: { r?: string }) => String(c.r ?? '').toLowerCase() === 등급.toLowerCase())) continue
    검사++
    const 실제 = (셈.get(등급.toLowerCase()) ?? 0) / N
    // 표본오차를 감안해 넉넉히 본다 — 0이거나 절반 이상 어긋나면 진짜 문제다.
    if (실제 === 0 || Math.abs(실제 - 기대) > Math.max(기대 * 0.5, 0.004)) {
      나쁨++
      console.log(`  ✗ ${s.slug} ${등급}: 기대 ${(기대 * 100).toFixed(2)}% · 실제 ${(실제 * 100).toFixed(2)}%`)
    }
  }
}
console.log(`\n확률 자리 ${검사}개 · 어긋남 ${나쁨}개 · 뽑기에서 빠진 카드 ${빠진카드}장`)

// 사람 체감: 하루 예산으로 30일 하면 최상위를 보나
console.log(`\n30일 체감 (하루 ${DAILY_BUDGET.toLocaleString()} GP)`)
for (const s of PACK_SETS.slice(0, 4)) {
  const raw = 카드읽기(s.src)
  if (!raw) continue
  const cards = usableCards((raw.cards ?? raw).map((c: { r?: string }) => ({ ...c, r: s.rarityAlias?.[c.r ?? ''] ?? c.r })))
  const 하루팩 = Math.floor(DAILY_BUDGET / s.price)
  let 최상 = 0
  for (let d = 0; d < 30 * 하루팩; d++) for (const c of drawPack(cards, s.profile, s.godRate ?? 0, s.mirror).cards) if (rankOf(c.r) >= 8) 최상++
  console.log(`  ${s.slug.padEnd(12)} 하루 ${String(하루팩).padStart(2)}팩 → 30일에 최상위 ${최상}장`)
}
process.exit(나쁨 || 빠진카드 ? 1 : 0)
