// 한글 카드명 → 영문 카드명 사전을 만든다(검색 통일용).
//
// 사용자는 한글로 검색하는데, 스니커덩크(한글→일본어)는 사전이 촘촘하고 eBay·TCGplayer
// (한글→영어)는 성겨서 같은 검색어인데 화면마다 결과가 달랐다. 여기서 그 격차를 메운다.
//
// 만드는 법: 우리 일본어 카드명을 화면에 나오는 한글로 바꾸고(koreanizeTitle), 같은 카드의
// 영문명을 scripts/en-card-names.json(PPT에서 받아 둔 것)에서 번호로 찾아 짝짓는다.
//
// ⚠️ 세트마다 번호 체계가 어긋날 수 있어(PPT의 'SV6'이 다른 세트를 주기도 했다) 그대로
// 믿으면 안 된다. 세트별로 "이미 양쪽 다 아는 카드"의 한글이 서로 같은지를 세어, 일치율이
// 낮은 세트는 통째로 버린다.
//
// 실행: npx tsx scripts/gen-ko-en-cards.mts [--write]
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName, CARD_NAME_KO_TO_EN } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 재료는 두 곳을 합친다. 덤프 쪽이 훨씬 넓다(36세트 → 157세트) — 먼저 쓰고,
// 덤프에 없는 세트만 예전 파일로 메운다.
const SRC = join(ROOT, 'scripts/en-card-names.json')
const SRC_DUMP = join(ROOT, 'scripts/en-card-names-dump.json')
const OUT = join(ROOT, 'src/data/cardNameKoEn.json')
const WRITE = process.argv.includes('--write')
// 세트를 믿을지 정하는 기준. 번호가 어긋난 세트는 10%대로 떨어지고 맞는 세트는 85% 위다.
const MIN_MATCH = 0.7
const MIN_SAMPLE = 10

if (!existsSync(SRC)) throw new Error('scripts/en-card-names.json이 없다 — fetch-en-card-names.mjs 먼저')
const enBySet: Record<string, Record<string, string>> = JSON.parse(readFileSync(SRC, 'utf8'))
if (existsSync(SRC_DUMP)) {
  const 덤프: Record<string, Record<string, string>> = JSON.parse(readFileSync(SRC_DUMP, 'utf8'))
  let 더함 = 0
  for (const [code, byNo] of Object.entries(덤프)) {
    const 있 = (enBySet[code] ??= {})
    for (const [n, en] of Object.entries(byNo)) if (!있[n]) { 있[n] = en; 더함++ }
  }
  console.log(`덤프에서 ${더함.toLocaleString()}장을 재료에 더했다(세트 ${Object.keys(덤프).length}개).`)
}

const norm = (s: string) => s.replace(/[\s·]/g, '')

// PPT 이름에는 인쇄 변종이 괄호로 붙어 온다("Magneton (Mirror Holofoil)"). 같은 카드의
// 다른 인쇄일 뿐이라 검색어로 쓰면 오히려 안 걸린다 — 떼어 낸다.
// 이름 안에 든 포켓몬을 찾는다. 굿즈·트레이너는 아무것도 안 나온다.
// 긴 이름부터 봐야 '리자드'가 '리자몽' 안에서 먼저 걸리지 않는다.
const KO_POKEMON = (pokemonNames as { ko: string }[])
  .map((p) => p.ko)
  .filter((k) => k.length >= 2)
  .sort((a, b) => b.length - a.length)
const pokemonIn = (s: string) => KO_POKEMON.find((k) => s.includes(k)) ?? ''

// ⚠️⚠️ **반쪽만 옮겨진 이름은 사전에 넣지 않는다.** 한글 이름 안에 영어 낱말이 남아
//    있으면 그건 한글 이름이 아니다 — 아무도 그렇게 안 친다. 게다가 이 사전은
//    **거꾸로도 쓰인다**(영문 → 한글 표시). 그래서 반쪽짜리를 넣으면 손으로 적어 둔
//    정답을 덮어 버린다. 2026-08-08에 실제로 그랬다:
//        koreanizeEnglishTitle에 "Team Rocket's Archer" → "로켓단의 아폴로"가 있는데
//        사전이 "Team Rocket's Archer" → "Team 로켓단의 Archer"로 덮었다.
//    카드 이름에 원래 영어로 남는 것(ex·V·VSTAR·N·AZ…)만 통과시킨다.
//    한 글자짜리는 그냥 둔다 — "폴리곤Z"·"포켓바이털A"처럼 한글 이름에 원래 붙는다.
// ⚠️⚠️ **메가·ex 같은 표시가 한쪽에만 있으면 다른 카드다.** 덤프로 재료를 넓히자
//    이런 짝이 생겼다(2026-08-08):
//        "M강철톤 EX" → "Steelix"      (메가도 EX도 없는 그냥 강철톤)
//        "M나무킹 EX" → "Sceptile"
//    안쪽 포켓몬 이름이 같아서 기존 검사(pokemonIn)로는 안 걸린다. 표시를 따로 센다.
const 표시들 = (s: string) => {
  const t = s.toLowerCase()
  return [
    /(^|\s)(m|메가|mega)(\s|[가-힣a-z])/.test(t) ? 'mega' : '',
    /(^|\s)(ex)(\s|$)/.test(t) ? 'ex' : '',
    /(^|\s)(v)(\s|$)/.test(t) ? 'v' : '',
    /vmax/.test(t) ? 'vmax' : '',
    /vstar/.test(t) ? 'vstar' : '',
    /(^|\s)(gx)(\s|$)/.test(t) ? 'gx' : '',
    /break/.test(t) ? 'break' : '',
  ].filter(Boolean).join('+')
}
const 표시가다른가 = (ko: string, en: string) => 표시들(ko) !== 표시들(en)

// ⚠️ **문장으로 끝나는 것은 카드 이름이 아니다.** 옛 e카드 시절 트레이너 카드는 이름이
//    문장 꼴이라("エネルギーを高めます"), 번호가 어긋나 요즘 카드의 영문명과 잘못
//    짝지어지면 "에너지를 높입니다 → Boost Energy" 같은 것이 생긴다(2026-08-08).
const 문장인가 = (ko: string) => /(습니다|합니다|입니다|하세요|해요|한다|된다|이다)$/.test(ko.trim())

const 남아도되는말 = /^([A-Za-z]|ex|EX|VMAX|VSTAR|VUNION|GX|BREAK|LV|AZ|MC|PRO|TM|SP|FA|SR|UR)$/
const 반쪽인가 = (ko: string) =>
  (ko.match(/[A-Za-z]+/g) ?? []).some((w) => !남아도되는말.test(w))

// ⚠️ **"… Pattern)"도 떼야 한다.** 안 떼면 그 포켓몬의 **한글 이름 전체**가 그 변종
//    하나에 묶인다 — 사전은 "한글 이름 → 영문 이름" 한 줄뿐이기 때문이다.
//    실제로 17장이 그랬고, 검색이 이렇게 나갔다(2026-08-08 실측):
//        레쿠쟈    → "Rayquaza (Friend Ball Pattern)"     1장   (제대로면 10장)
//        테라파고스 → "Terapagos (Energy Symbol Pattern)"  **0장** (제대로면 5장)
//    받아 둔 이름 4,740개 중 301개에 Pattern이 붙어 있다.
const VARIANT =
  /\s*\((?:Mirror |Reverse |Cosmos |Poke Ball |Master Ball )?(?:Holofoil|Holo|Foil|Non ?-?Holo(?:foil)?)\)|\s*\([A-Za-z' ]+Pattern\)/gi
const cleanVariant = (s: string) => s.replace(VARIANT, '').trim()
const ko = (ja: string) => koreanizeEnglishCardName(koreanizeTitle(ja))

const pairs = new Map<string, string>()
const dropped: string[] = []
let kept = 0

for (const [code, byNo] of Object.entries(enBySet)) {
  const file = join(ROOT, `public/sets/ja-${code}.json`)
  if (!existsSync(file) || !Object.keys(byNo).length) continue
  const cards: { n: string; name: string }[] = JSON.parse(readFileSync(file, 'utf8')).cards ?? []

  // ① 세트가 믿을 만한지 본다. 양쪽 다 한글로 옮겨지는 카드(=이미 아는 카드)만 비교한다.
  let same = 0
  let cmp = 0
  for (const c of cards) {
    const e = byNo[c.n]
    if (!e) continue
    const a = ko(c.name)
    const b = koreanizeEnglishCardName(e)
    if (!/[가-힣]/.test(a) || !/[가-힣]/.test(b)) continue
    cmp++
    if (norm(a) === norm(b)) same++
  }
  if (cmp < MIN_SAMPLE || same / cmp < MIN_MATCH) {
    dropped.push(`${code}(${same}/${cmp})`)
    continue
  }
  kept++

  // ② 아직 영문명을 모르는 한글 카드명만 담는다.
  for (const c of cards) {
    const e = byNo[c.n]
    if (!e) continue
    const e2 = cleanVariant(e)
    if (!e2) continue
    const k = ko(c.name)
    // 한글이 안 남았으면 이미 영문으로 잘 나가는 카드다.
    if (!/[가-힣]/.test(k)) continue
    // 번호가 어긋난 카드를 걸러낸다. 세트 전체 일치율만 보면 개별 카드가 틀려도 통과한다
    // (실제로 '버프론 ex'에 'Herdier'가 붙었다).
    // ⚠️ 한글이 다르다고 무조건 버리면 안 된다. 같은 카드인데 두 경로의 표기가 다른 경우가
    // 많다("오기조끼"(공식) vs "반격의 조끼"(영문 사전)) — 그건 정상이고 오히려 우리가
    // 채워야 할 쌍이다. 포켓몬 이름이 서로 다를 때만 다른 카드로 본다.
    const back = koreanizeEnglishCardName(e2)
    const p1 = pokemonIn(k)
    const p2 = pokemonIn(back)
    if (p1 && p2 && p1 !== p2) continue
    // 포켓몬 이름은 별도 사전(pokemonNames)이 이미 양방향으로 처리한다. 여기서 또 넣으면
    // "리자몽 ex" 같은 조합까지 통째로 굳어 버려 다른 접미사가 붙은 카드를 못 찾는다.
    if (CARD_NAME_KO_TO_EN.has(k)) continue
    if (반쪽인가(k) || 문장인가(k) || 표시가다른가(k, e2)) continue
    const prev = pairs.get(k)
    if (prev && prev !== e2) continue // 같은 한글에 영문이 둘이면 애매하니 안 넣는다
    pairs.set(k, e2)
  }
}

console.log(`세트 ${kept}개 채택 · ${dropped.length}개 버림${dropped.length ? ' (' + dropped.join(' ') + ')' : ''}`)
console.log(`한글 → 영문 ${pairs.size}쌍`)
for (const [k, v] of [...pairs].slice(0, 12)) console.log(`   ${k}  →  ${v}`)

if (WRITE) {
  // 이미 있는 사전과 합친다. PPT 하루 한도 때문에 세트를 나눠 받는데, 그냥 덮어쓰면
  // 이번에 못 받은 세트의 쌍이 통째로 사라진다(실제로 M3가 그렇게 날아갔다).
  // 이번에 새로 검증한 쪽을 우선하고, 없는 것만 예전 값으로 채운다.
  // 이어받는 쌍에도 지금 기준을 다시 적용한다. 예전 사전에는 검사가 없던 시절의 오류가
  // 들어 있다("고오스 → Gastly (Mirror Holofoil)", "버프론 ex → Herdier").
  // 그대로 이어받으면 고쳐 놓고도 되살아난다.
  const prev: Record<string, string> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
  let carried = 0
  let rejected = 0
  for (const [k, raw] of Object.entries(prev)) {
    if (pairs.has(k)) continue
    const v = cleanVariant(raw)
    const back = koreanizeEnglishCardName(v)
    const p1 = pokemonIn(k)
    const p2 = pokemonIn(back)
    if (!v || 반쪽인가(k) || 문장인가(k) || 표시가다른가(k, v) || (p1 && p2 && p1 !== p2)) {
      rejected++
      continue
    }
    pairs.set(k, v)
    carried++
  }
  if (carried) console.log(`이전 사전에서 ${carried}쌍 이어받음(이번에 못 받은 세트)`)
  if (rejected) console.log(`이전 사전의 ${rejected}쌍은 지금 기준에 안 맞아 버림`)
  writeFileSync(OUT, JSON.stringify(Object.fromEntries([...pairs].sort()), null, 1) + '\n')
  console.log(`\n→ ${OUT}`)
} else {
  console.log('\n저장하려면 --write')
}
