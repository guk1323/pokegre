/**
 * **번호 별칭표가 가리키는 저쪽 카드가 정말 그 카드인지** 뜻으로 견준다.
 *
 * 왜 따로 필요한가 — 기존 `check-number-alias.mts`는 "별칭이 가리키는 번호가 저쪽에
 * 있나"만 본다. 있기만 하면 통과라, **엉뚱한 카드를 가리켜도 726/726 다 맞다고 나온다.**
 * 여기서는 양쪽 이름을 한글로 옮겨 **뜻이 같은지**를 본다.
 *
 * 별칭표는 옛 일본판(PMCG·neo)처럼 저쪽에 번호가 없는 세트를 **이름으로** 짝지은 것이라
 * 위험이 크다. 짝짓는 코드(`gen-set-card-number-alias.mts`의 `일영`)는 카드 이름 안에
 * 포켓몬 이름이 들었는지로 찾는데, 이름이 다른 이름 안에 통째로 드는 일이 있다:
 *     ラッキーメット(행운의헬멧) ⊃ ラッキー(럭키)   ルアーボール(루어볼) ⊃ アーボ(아보)
 * 도감에서 같은 방식으로 카드 31장이 딴 포켓몬 밑에 걸려 있었다(2026-08-08).
 *
 * ⚠️ **저쪽 이름 뒤 괄호는 떼고 본다** — "(Lv.16)"·"(U)"·"(C)"는 같은 이름 카드를
 *    가르려고 저쪽이 붙인 꼬리다. 안 떼면 멀쩡한 짝이 다 틀린 것처럼 보인다.
 * ⚠️ 한쪽이라도 한글로 안 옮겨지면 건너뛴다 — 견줄 수가 없다(다른 검사가 본다).
 *
 * 실행: npx tsx scripts/check-alias-meaning.mts
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 별칭 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/setCardNumberAlias.json'), 'utf8')) as Record<
  string,
  Record<string, string>
>
// 저쪽이 같은 이름을 가르려고 붙이는 꼬리. 뜻과 상관없다.
const 꼬리떼기 = (s: string) => s.replace(/\s*\((Lv\.\d+|[UCR]|Holo|Non ?Holo|Reverse)\)\s*$/i, '').trim()
const 벗 = (s: string) => s.replace(/[\s·'’\-—()]/g, '').toLowerCase()

let 잼 = 0
let 못잼 = 0
const 갈림: string[] = []
for (const [slug, 표] of Object.entries(별칭)) {
  let cards: { n?: string; name?: string }[] = []
  try {
    cards = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${slug}.json`), 'utf8')).cards ?? []
  } catch {
    갈림.push(`  ${slug} — 세트 파일이 없다`)
    continue
  }
  const 번호별 = new Map(cards.map((c) => [String(c.n ?? ''), String(c.name ?? '')]))
  for (const [n, v] of Object.entries(표)) {
    if (!String(v).startsWith('NAME:')) continue
    const 원 = 번호별.get(n) ?? ''
    const 저 = 꼬리떼기(String(v).slice(5))
    if (!원) {
      갈림.push(`  ${slug} ${n} — 우리 세트에 그 번호가 없다(별칭이 남았다) → "${저}"`)
      continue
    }
    const 우리 = koreanizeEnglishCardName(koreanizeTitle(원))
    const 저쪽 = koreanizeEnglishCardName(저)
    if (!/[가-힣]/.test(우리) || !/[가-힣]/.test(저쪽)) {
      못잼++
      continue
    }
    잼++
    if (벗(우리) !== 벗(저쪽)) 갈림.push(`  ${slug.padEnd(10)} ${n.padEnd(5)} "${원}" → "${우리}"   ≠   "${저}" → "${저쪽}"`)
  }
}
console.log(`이름으로 짝지은 별칭 중 뜻을 잰 것 ${잼}개(못 잰 것 ${못잼}개) · 뜻이 갈리는 것 ${갈림.length}개`)
for (const x of 갈림) console.log(x)
