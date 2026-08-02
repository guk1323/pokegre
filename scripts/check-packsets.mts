// 뽑기 세트 점검 — 확률표가 굴리는 등급이 실제 데이터에 있는지 본다.
//
// 왜 필요한가: 확률표에 있는 등급이 세트에 한 장도 없으면 "나올 수 있다"고 광고만 하고
// 실제로는 절대 안 나온다. 반대로 세트에 있는 상위 등급이 확률표에 없으면 그 카드는
// 영원히 안 뽑힌다(fallback 풀은 커먼·언커먼·일반레어뿐이라 상위 등급은 갈 곳이 없다).
// 원본 자료가 같은 자리를 세트마다 다르게 적어 둔 곳이 있어서(북미 메가 시리즈의
// 최상위가 me01만 'Mega Hyper Rare', 나머지는 'Secret Rare') 이 검사가 없으면 못 잡는다.
//
// 실행: npx tsx scripts/check-packsets.mts
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { PACK_SETS, PPT_SET_NAMES } from '../src/lib/packSets.ts'
import { RARITY_RANK } from '../src/lib/packDraw.ts'

const ROOT = process.cwd()
let bad = 0

for (const p of PACK_SETS) {
  const file = path.resolve(ROOT, 'public', p.src.replace(/^\//, ''))
  if (!existsSync(file)) {
    console.log(`✗ ${p.slug}: 데이터 파일 없음 (${p.src})`)
    bad++
    continue
  }
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { cards?: { r?: string }[] }
  const alias = p.rarityAlias
  const have = new Map<string, number>()
  for (const c of raw.cards ?? []) {
    const r = (alias && c.r && alias[c.r]) || c.r
    if (!r) continue
    have.set(r, (have.get(r) ?? 0) + 1)
  }

  const msgs: string[] = []
  // ① 확률표가 굴리는데 세트에 없는 등급
  for (const slot of p.profile.slots) {
    for (const [tier] of slot.rolls) {
      if (!have.has(tier)) msgs.push(`확률표엔 있는데 세트에 0장: ${tier}`)
    }
  }
  // ② 세트엔 있는데 확률표가 안 굴리는 상위 등급(레어 이상은 fallback으로 못 간다)
  const rolled = new Set(p.profile.slots.flatMap((s) => s.rolls.map(([t]) => t)))
  for (const [tier, n] of have) {
    const rank = RARITY_RANK[tier] ?? -1
    if (rank < 0) {
      msgs.push(`뽑기가 모르는 등급 ${n}장: ${tier}`)
      continue
    }
    if (rank >= 3 && !rolled.has(tier)) msgs.push(`세트엔 ${n}장 있는데 확률표가 안 굴림: ${tier}`)
  }
  // ③ 커먼·언커먼 슬롯을 채울 카드가 있는지
  if (!have.has('Common')) msgs.push('커먼이 0장')
  if (p.profile.uncommons > 0 && !have.has('Uncommon')) msgs.push('언커먼이 0장')
  // ④ 앨범 시세를 받을 이름이 있는지(없으면 뽑기는 되지만 값이 안 뜬다)
  if (!PPT_SET_NAMES[p.slug]) msgs.push('PPT 세트 이름 없음 — 앨범 시세가 안 뜬다')

  if (msgs.length) {
    console.log(`✗ ${p.slug.padEnd(12)} ${p.label}`)
    for (const m of msgs) console.log(`     ${m}`)
    bad++
  } else {
    const top = [...have.entries()]
      .filter(([t]) => (RARITY_RANK[t] ?? 0) >= 8)
      .map(([t, n]) => `${t} ${n}`)
      .join(', ')
    console.log(`✓ ${p.slug.padEnd(12)} ${String(raw.cards?.length ?? 0).padStart(4)}장  최상위 ${top || '없음'}`)
  }
}

console.log(`\n세트 ${PACK_SETS.length}개 — 문제 ${bad}개`)
if (bad) process.exit(1)
