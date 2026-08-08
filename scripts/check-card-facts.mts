/**
 * cardFacts.json이 카드의 **갈래(포켓몬·트레이너·에너지)를 맞게 적고 있는지** 본다.
 *
 * 갈래가 틀리면 도감 화면에서 트레이너 카드가 포켓몬 밑에 걸리거나, 포켓몬 카드가
 * 도감에서 통째로 빠진다. 화면만 봐서는 못 찾는다 — 그 카드가 원래 거기 있어야 하는지
 * 아무도 모르기 때문이다.
 *
 * ⚠️ **도감번호(d)는 재지 않는다.** 이 표에서 실제로 읽히는 것은 갈래(c)뿐이다
 *    (gen-pokedex.mts가 `북미표[...]?.c`만 본다). d를 재 보면 346개가 어긋나 보이는데,
 *    아무 데도 안 쓰이는 값이라 화면과 상관이 없다. 안 쓰는 값을 고치겠다고 멀쩡한
 *    자료를 건드리면 안 된다.
 *
 * **2026-08-08 결과: 이 표는 깨끗하다.** 21,446장을 대조해 어긋난 것이 사실상 없었다.
 * 처음엔 346개(도감번호)와 134개(갈래)가 어긋난 것처럼 보였는데 **전부 검사기 탓**이었다:
 *   · ja-SVP와 en-svp를 한 칸으로 묶어 엉뚱한 카드와 견줬다
 *   · "마그마단의 둔타"에서 "마그마"(126)를 포켓몬으로 읽었다
 *   · 한 글자 이름(뮤·삐)을 빼 놔서 뮤 카드 134장이 "포켓몬이 아니다"가 됐다
 * 지금 남는 줄은 이름만으로는 못 가르는 것들이다(로토무 자전거·소울링크는 트레이너가
 * 맞고, 오리진디아르가·뮤☆는 포켓몬이 맞다). **줄이 몇 개 보인다고 표를 고치지 말 것.**
 *
 * 실행: node --experimental-strip-types scripts/check-card-facts.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import cardFacts from '../src/data/cardFacts.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const 모두 = (pokemonNames as { id: number; ko: string }[]).filter((p) => p.ko)
const 긴순 = [...모두].filter((p) => p.ko.length >= 2).sort((a, b) => b.ko.length - a.ko.length)
// ⚠️ **한 글자 이름(뮤·삐·단·웅)을 빼면 안 된다.** 처음에 빼 놨더니 뮤 카드 134장이
//    "포켓몬이 아니다"로 나왔다(표는 맞았다). 다만 한 글자를 아무 데나 넣으면 "뮤츠"
//    안에서 "뮤"가 걸리므로, **꾸밈말과 접미사를 뗀 알맹이가 통째로 같을 때만** 본다.
const 껍질 = /(^(빛나는|고대|알로라|가라르|히스이|팔데아)\s+)|([\s-]*(ex|EX|GX|V|VMAX|VSTAR|LV\.?X|δ|\(델타종\)|BREAK|Prime|LEGEND|Star|★)\s*)+$/g
const 한글자 = new Map(모두.filter((p) => p.ko.length === 1).map((p) => [p.ko, p]))
const 찾기 = (s: string) => {
  const 긴 = 긴순.find((p) => s.includes(p.ko))
  if (긴) return 긴
  const 알맹 = s.replace(껍질, '').trim()
  return 한글자.get(알맹)
}

const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')

// ⚠️ **열쇠는 세트 코드(소문자) + 번호다**(TCGdex 카드 id). 도감을 만드는 쪽도 같은 꼴로
//    찾는다. 다만 같은 코드가 일본판·북미판 양쪽에 있는 경우가 있어(svp), 그런 열쇠는
//    어느 카드인지 알 수 없으므로 대조에서 뺀다 — 안 빼면 엉뚱한 카드와 견주게 된다.
const 이름 = new Map<string, { ed: 'ja' | 'en'; name: string }>()
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const slug = f.replace('.json', '')
  const ed: 'ja' | 'en' = slug.startsWith('ja-') ? 'ja' : 'en'
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { cards?: { n?: string; name?: string }[] }
  const code = slug.replace(/^(ja|en)-/, '').toLowerCase()
  for (const c of j.cards ?? []) {
    const 열쇠 = `${code}-${String(c.n)}`
    if (이름.has(열쇠)) 이름.set(열쇠, { ed, name: '' }) // 겹치면 못 쓴다는 표시
    else 이름.set(열쇠, { ed, name: String(c.name ?? '') })
  }
}

// ⚠️ "마그마단의 둔타"에서 "마그마"(126)를 포켓몬으로 읽으면 안 된다 — 단체 이름이다.
const 단체 = /(마그마|아쿠아|로켓|플라스마|갤럭시|플레어|스컬|에테르|스타)단/g
const 에너지말 = /(에너지|Energy)\s*$/

let 봄 = 0
let 맞음 = 0
const 나쁨: string[] = []
for (const [열쇠, v] of Object.entries(cardFacts as Record<string, { c?: string }>)) {
  const 카드 = 이름.get(열쇠.toLowerCase()) ?? 이름.get(decodeURIComponent(열쇠).toLowerCase())
  if (!카드 || !카드.name || !v.c) continue
  const ko =
    카드.ed === 'ja'
      ? koreanizeEnglishCardName(koreanizeTitle(카드.name))
      : koreanizeEnglishCardName(카드.name)
  const p = 찾기(ko.replace(단체, ''))
  봄++
  const 있어야 = 에너지말.test(ko) ? 'e' : p ? 'p' : 't'
  if (v.c === 있어야) {
    맞음++
    continue
  }
  // 트레이너 ↔ 에너지는 이름만으로 못 가른다(굿즈 이름에 "에너지"가 들어가기도 한다).
  if ((있어야 === 't' && v.c === 'e') || (있어야 === 'e' && v.c === 't')) {
    맞음++
    continue
  }
  나쁨.push(`  ${열쇠.padEnd(16)} "${카드.name}" → "${ko}"   표 ${v.c}  ↔  이름으로는 ${있어야}${p ? '(' + p.ko + ')' : ''}`)
}
console.log(`대조한 카드 ${봄.toLocaleString()}장 · 갈래 맞음 ${맞음.toLocaleString()}`)
console.log(`갈래가 어긋난 것: ${나쁨.length}개\n`)
// 도감을 더럽히는 쪽(트레이너인데 포켓몬으로 적힌 것)만 보여준다. 반대쪽은 이름만으로
// 못 가르는 것이 많아 시끄럽기만 하다.
const 위험 = 나쁨.filter((b) => b.includes('표 p '))
console.log(`그중 도감을 더럽힐 수 있는 쪽(표 p): ${위험.length}개`)
for (const b of 위험.slice(0, 25)) console.log(b)
