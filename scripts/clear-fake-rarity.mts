// 저쪽(PPT)이 **지어낸 레어도**를 바로잡는다. (2026-08-13)
//
// ⚠️⚠️⚠️ **판단 근거는 「카드에 찍힌 것」이다 — 그림을 눈으로 본다.**
//    일본 카드는 왼쪽(옛 카드는 오른쪽) 아래에 레어도가 **글자로 찍혀 있다**
//    (C·U·R·RR·AR·SR·SAR·UR·MUR…). 사장님이 짚어 주신 방법이고, 실제로 읽힌다.
//    검증(ja-M2, 답을 아는 세트): C·U·RR·R·AR·SR·SAR **7가지가 저쪽 값과 그대로 일치**.
//    → 그래서 아래 목록은 추측이 아니라 **본 것**이다. 더할 때도 반드시 그림을 보고 적는다.
//    ⚠️ 그림은 **커야 읽힌다.** 포켓몬코리아 868×1212 · tcgplayer `_in_800x800` 은 읽히고,
//       limitless 274×381 과 tcgplayer 기본 `_in_400x400` 은 **못 읽는다**.
//       (도감에 박힌 주소는 400×400이라 `_in_800x800`으로 바꿔서 봐야 한다.)
//
// ⚠️⚠️ **틀린 것보다 빈칸이다.** 이 리포의 오래된 원칙이고, 레어도에서는 특히 그렇다 —
//    2천 달러짜리 금박 카드에 「커먼」이라 적히면 방문자가 값을 의심하게 된다
//    (사장님 지적 2026-08-13: 「메가리자몽 Y ex … 커먼 … 약 287만원」).
//
// **무엇이 문제였나 — 저쪽이 세트 하나를 통째로 한 레어도로 적는다.**
// 「스타트 덱 100 배틀 컬렉션」(ja-MC)은 **742장이 전부 Common**이다. 세 군데를 다 봤다:
//
//   | 어디 | 뭐라고 하나 |
//   |---|---|
//   | **PPT** | `"rarity":"Common"` — 낱장으로 물어봐도 그렇다(2026-08-13 실측, tcg 669812) |
//   | **TCGdex** | 전부 `"None"` — 아예 없다 |
//   | **포켓몬코리아**(공식) | 번호 옆 레어도 칸이 **비어 있다**(085/742 · 743/742 둘 다) |
//
// 다른 세트에서는 저쪽이 제대로 준다(ja-M2: Common 39·Uncommon 25·Super Rare 16·
// Art Rare 12 …). 그러니 「저쪽 레어도를 못 믿는다」가 아니라 **이 세트만 지어낸 것**이다.
// 공식이 비워 둔 것을 우리가 「커먼」이라 적을 근거는 없다.
//
// ⚠️ **넘겨짚어 채우지 않는다.** 비우기만 한다(사장님 지시: "정확한거 아니면 니가 유추해서
//    넣지마"). 나중에 공식이 레어도를 밝히면 그때 채운다.
// ⚠️ 검색은 안 나빠진다 — 지금도 「메가리자몽 SAR」은 0건이다(레어도가 SAR이 아니라
//    Common으로 적혀 있어서). 비운다고 되던 것이 깨지지 않는다.
// ⚠️ 돌린 뒤 **`npx tsx scripts/gen-card-index.mts`를 꼭 다시** 돌린다. 색인의 10번째 칸이
//    레어도라, 안 돌리면 화면에는 그대로 「커먼」이 나온다.
//
//   npx tsx scripts/clear-fake-rarity.mts           무엇이 바뀌는지만 본다
//   npx tsx scripts/clear-fake-rarity.mts --write   실제로 비운다
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 레어도를 비울 세트.
 *
 * ⚠️ **여기에 세트를 더하려면 근거를 같이 적을 것.** 「이상해 보인다」는 근거가 아니다 —
 *    공식(포켓몬코리아)이나 TCGdex가 **뭐라고 하는지 직접 확인**하고 적는다.
 */
const 지어낸것: { slug: string; 근거: string }[] = [
  {
    slug: 'ja-MC',
    근거: '742장 전부 Common. 포켓몬코리아 공식은 레어도 칸이 비어 있고 TCGdex도 None.',
  },
]

/**
 * **프로모인데 「커먼」이라 적힌 세트.** 저쪽이 판에 따라 다르게 부른다 — 영문 프로모
 * 세트(en-xyp·en-smp)는 전부 `Promo`로 주면서, 같은 성격의 일본 프로모 세트는
 * 상당수를 `Common`으로 준다. 그래서 5,399달러짜리 마리오 피카츄가 「커먼」이었다.
 *
 * ⚠️ **카드 그림을 보고 넣었다.** 세트마다 3~6장을 뽑아 아래를 눈으로 확인했다 —
 *    모두 프로모 표시가 있고 **글자 레어도가 없다**. 18+9장 전수 일치.
 * ⚠️ **`Common`인 것만 바꾼다.** `Holo Rare`·`Prism Rare`처럼 저쪽이 제대로 준 것은
 *    안 건드린다(ja-SVP에 그런 게 5장 있다).
 * ⚠️ **빈칸은 안 채운다.** ja-XYP 162장 · ja-SMP 361장이 비어 있는데, 그건 틀린 게
 *    아니라 없는 것이다. 안 본 카드를 세트 이름만 보고 채우면 그게 추측이다.
 */
const 프로모인데커먼: { slug: string; 근거: string }[] = [
  { slug: 'ja-XYP', 근거: '6장 확인 — 오른쪽 아래 프로모 별표 + `001/XY-P` 꼴. 글자 레어도 없음.' },
  { slug: 'ja-SP', 근거: '6장 확인 — 왼쪽 아래 `PROMO` 도장. 옆 글자(C·D·E·F)는 레귤레이션 마크다.' },
  { slug: 'ja-SVP', 근거: '6장 확인 — 왼쪽 아래 `PROMO` 도장.' },
  { slug: 'ja-L-P', 근거: '3장 확인 — 오른쪽 아래 프로모 별표 + `001/L-P` 꼴.' },
  { slug: 'ja-SMP', 근거: '3장 확인 — 왼쪽 아래 `PROMO` 도장.' },
]

/**
 * **세트 전체가 아니라 「커먼」만 지어낸 세트.**
 *
 * 하이클래스팩(ja-M2a)은 SR·AR·SAR 같은 윗 등급은 카드에 제대로 찍혀 있는데,
 * **밑 등급 카드에는 레어도를 아예 안 찍는다.** 그런데 저쪽은 그 카드들에 `Common`을
 * 붙인다 — 세트를 통째로 비우면 멀쩡한 윗 등급까지 날아가므로 `Common`만 지운다.
 *
 * ⚠️ 근거는 **카드 그림**이다(`read-rarity-from-image.mts --check --only`).
 *    ja-M2a에서 「커먼」인 카드 12장을 뽑아 그림으로 물으니 **12장 전부 NONE**이었고,
 *    그중 3장은 내가 눈으로 확인했다(010/193 · 103/193 · 104/193 — 번호 뒤에 아무것도 없다).
 *    같은 세트의 빈칸 카드 5장도 눈으로 확인했는데 역시 표기가 없었다.
 */
const 커먼만지어냄: { slug: string; 근거: string }[] = [
  {
    slug: 'ja-M2a',
    근거: '「커먼」 12장을 그림으로 물으니 12장 전부 NONE. 눈으로 3장 확인(010·103·104/193 모두 번호 뒤 빈칸).',
  },
]

const 쓰기 = process.argv.includes('--write')

for (const { slug, 근거 } of 지어낸것) {
  const 파일 = path.resolve('public/sets', `${slug}.json`)
  const j = JSON.parse(await readFile(파일, 'utf-8')) as { cards?: { n: string; name?: string; r?: string }[] }
  const cards = j.cards ?? []
  const 셈: Record<string, number> = {}
  let 비운수 = 0
  for (const c of cards) {
    if (!c.r) continue
    셈[c.r] = (셈[c.r] ?? 0) + 1
    delete c.r
    비운수++
  }
  console.log(`${slug} — ${cards.length}장 중 ${비운수}장 비움  ${JSON.stringify(셈)}`)
  console.log(`  근거: ${근거}`)
  if (쓰기) {
    await writeFile(파일, `${JSON.stringify(j, null, 0)}\n`, 'utf-8')
    console.log('  → 적었습니다.')
  }
}
for (const { slug, 근거 } of 커먼만지어냄) {
  const 파일 = path.resolve('public/sets', `${slug}.json`)
  const j = JSON.parse(await readFile(파일, 'utf-8')) as { cards?: { n: string; r?: string }[] }
  const cards = j.cards ?? []
  let 비운수 = 0
  for (const c of cards) {
    if (c.r !== 'Common') continue
    delete c.r
    비운수++
  }
  console.log(`${slug} — 「커먼」 ${비운수}장만 비움(윗 등급은 그대로)`)
  console.log(`  근거: ${근거}`)
  if (쓰기) {
    await writeFile(파일, `${JSON.stringify(j, null, 0)}\n`, 'utf-8')
    console.log('  → 적었습니다.')
  }
}

for (const { slug, 근거 } of 프로모인데커먼) {
  const 파일 = path.resolve('public/sets', `${slug}.json`)
  const j = JSON.parse(await readFile(파일, 'utf-8')) as { cards?: { n: string; r?: string }[] }
  const cards = j.cards ?? []
  let 바꾼수 = 0
  for (const c of cards) {
    if (c.r !== 'Common') continue
    c.r = 'Promo'
    바꾼수++
  }
  console.log(`${slug} — 커먼 ${바꾼수}장을 프로모로`)
  console.log(`  근거: ${근거}`)
  if (쓰기) {
    await writeFile(파일, `${JSON.stringify(j, null, 0)}\n`, 'utf-8')
    console.log('  → 적었습니다.')
  }
}

if (!쓰기) console.log('\n(보기만 했습니다. 실제로 고치려면 --write)')
