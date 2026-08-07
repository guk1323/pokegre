// 이름 대조표(setCardNumberAlias.json)가 제대로 작동하는지 본다.
//
// 왜: 옛 일본판(PMCG·neo)과 몇몇 프로모 세트는 저쪽(PPT)에 시세는 있는데 카드 번호
// 칸이 비어 있거나 우리와 번호 체계가 다르다. 그래서 **이름**으로 짝지어 뒀는데,
// 이 표가 조용히 깨지면 화면엔 "찾지 못해 같은 이름의 다른 카드를 보여 드립니다"가
// 뜬다. 값이 틀린 게 아니라 아예 안 붙는 거라 눈에 잘 안 띈다.
//
// 두 가지를 본다.
//   ① 표를 넣은 세트에서, 저쪽 카드가 우리 번호로 제대로 되돌려지는가
//   ② 한 저쪽 카드에 우리 번호가 둘 이상 붙지는 않는가(겹치면 어느 것인지 못 가린다)
//
// ⚠️ 앞자리 0은 비교 전에 떨어진다(우리 "092" ↔ 저쪽 "92"). 앱도 양쪽 모두
//    같은 함수를 통과시키므로, 여기서도 **양쪽을 다 정규화해서** 견줘야 한다.
//    한쪽만 정규화해 놓고 "8개 틀렸다"고 잘못 읽은 적이 있다(2026-08-07).
//
// 쓰는 법: npx tsx scripts/check-card-number-alias.mts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { 저쪽번호를우리번호로 } from '../src/lib/pokedexRoute.ts'
import setCardNumberAlias from '../src/data/setCardNumberAlias.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '..')
const 표 = setCardNumberAlias as Record<string, Record<string, string>>

const 번호열쇠 = (slug: string, s: string, 이름?: string) =>
  저쪽번호를우리번호로(slug, String(s), 이름).split('/')[0].trim().toUpperCase().replace(/^0+(?=[0-9])/, '')

let 봄 = 0
let 틀림 = 0
let 겹침 = 0
let 없는번호 = 0

for (const [slug, t] of Object.entries(표)) {
  // ② 겹침: 서로 다른 우리 번호가 같은 저쪽 카드를 가리키면 안 된다
  const 거꾸로 = new Map<string, string[]>()
  for (const [우리, 저쪽] of Object.entries(t)) 거꾸로.set(저쪽, [...(거꾸로.get(저쪽) ?? []), 우리])
  for (const [저쪽, 우리들] of 거꾸로) {
    if (우리들.length > 1) {
      겹침++
      console.log(`  ✗ ${slug} "${저쪽}" ← 우리 번호 ${우리들.join(', ')} (어느 것인지 못 가린다)`)
    }
  }

  // 우리 세트에 그 번호가 실제로 있는지
  let 카드: { n: string }[] = []
  try {
    카드 = (JSON.parse(readFileSync(path.join(ROOT, `public/sets/${slug}.json`), 'utf-8')).cards ?? []) as { n: string }[]
  } catch {
    console.log(`  ⚠ ${slug} 세트 파일을 못 읽었다 — 건너뛴다`)
    continue
  }
  const 있는번호 = new Set(카드.map((c) => String(c.n)))

  for (const [우리, 저쪽] of Object.entries(t)) {
    봄++
    if (!있는번호.has(우리)) {
      없는번호++
      console.log(`  ✗ ${slug} ${우리} — 우리 세트에 그 번호가 없다`)
      continue
    }
    // ① 되돌리기: 저쪽 카드(번호·이름)를 넣으면 우리 번호가 나와야 한다
    const 이름 = 저쪽.startsWith('NAME:') ? 저쪽.slice(5) : undefined
    const 번호 = 저쪽.startsWith('NAME:') ? '' : 저쪽
    const 나온것 = 번호열쇠(slug, 번호, 이름)
    const 우리것 = 번호열쇠(slug, 우리)
    if (나온것 !== 우리것) {
      틀림++
      console.log(`  ✗ ${slug} ${우리} "${이름 ?? 번호}" → ${나온것} (우리 ${우리것}여야 한다)`)
    }
  }
}

console.log(`\n  대조표 ${봄}건 · 세트 ${Object.keys(표).length}개`)
console.log(`  되돌리기 틀림 ${틀림}건 · 겹침 ${겹침}건 · 우리에 없는 번호 ${없는번호}건`)
if (틀림 || 겹침 || 없는번호) {
  console.log('\n  고쳐야 한다.\n')
  process.exit(1)
}
console.log('  모두 통과\n')
