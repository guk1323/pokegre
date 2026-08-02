// 세트 카드명 점검: public/sets(+packsim)의 카드 이름을 화면에 나오는 그대로 변환해
// ① 일본어·한자가 남은 것 ② 가타카나인데 공식 한글명이 아닌 것(=음역으로 깨진 것)
// ④ 히라가나 낱말이 뜻이 아니라 소리로 옮겨진 것을 찾는다.
//
// 왜 필요한가: 옛 세트(e시리즈·PCG·neo)는 원본 DB(TCGdex)의 "일본어" 칸이 오염돼 있다.
// 정식 일본명 대신 영어명을 가타카나로 음차한 값이 들어있어(デンリュウ가 아니라
// アンファロス=Ampharos) 사전이 못 잡고 "안파로스"처럼 음역된다. 그런 것들을
// src/data/pokemonNameAliases.json에 모아 잡는다.
//
// 실행: npx tsx scripts/card-name-audit.mts [--list] [--limit=200]
//   기본     요약만
//   --list   아직 안 고친 이름 목록(오래된 세트 순)
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { koreanizeTitle, STRUCTURAL_TERMS, EXACT_TITLES } from '../src/lib/koreanizeTitle.ts'
import { kanaToHangul } from '../src/lib/kanaToHangul.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import pokemonNameAliases from '../src/data/pokemonNameAliases.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIST = process.argv.includes('--list')
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 120)

const CJK = /[぀-ヿ一-鿿]/ // 히라가나·가타카나·한자
const KATA_ONLY = /^[ァ-ヶー・]{2,10}$/ // 포켓몬 이름 후보(트레이너는 보통 の·한자가 섞인다)
const koNames = (pokemonNames as { ko: string }[]).map((p) => p.ko)
const koSet = new Set(koNames)
// 이미 손으로 확인해 통짜로 등록해 둔 이름(굿즈·트레이너)은 "안 고친 것"이 아니다.
// 빼주지 않으면 고칠수록 숫자가 안 줄어 남은 일이 얼마인지 알 수 없다.
const reviewed = new Set([
  ...STRUCTURAL_TERMS.filter(([ja]) => KATA_ONLY.test(ja)).map(([ja]) => ja),
  ...EXACT_TITLES.keys(), // 소리와 정식명이 같아 결과가 안 바뀌는 이름도 '확인함'이다
])

// 화면에 나오는 그대로 변환한다(일본판은 일본어 변환 후 영어 변환기까지 태운다).
const render = (ed: string, name: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name)

const idx: { slug: string; releaseDate?: string }[] = JSON.parse(
  readFileSync(join(ROOT, 'public/sets/index.json'), 'utf8'),
)
const yearOf = new Map(idx.map((s) => [s.slug, +(s.releaseDate ?? '2005').slice(0, 4)]))

// ③ 포켓몬코리아 공식 카드명과의 대조. ko-official-card-names.json은 공식 카드검색
// (pokemoncard.co.kr)에서 받아 둔 "세트 → 번호 → 정식 한글명"이다. 한국판은 서포트·굿즈
// 번호를 한글 가나다순으로 다시 매기므로 번호끼리 맞추면 안 되고, 세트 안에 그 이름이
// 있는지만 본다(있으면 우리 번역이 공식과 같다는 뜻).
// 이 파일은 공식 사이트에서 받아 둔 참고자료라 레포에 두지 않는다. 있으면 ③검사를 하고
// 없으면 건너뛴다(다시 받으려면 CLAUDE.md의 "카드명 번역 점검" 참고).
let official: Record<string, Record<string, string>> = {}
try {
  official = JSON.parse(readFileSync(join(ROOT, 'scripts/ko-official-card-names.json'), 'utf8'))
} catch {
  /* 없으면 ③ 검사 생략 */
}
const officialBySet = new Map(
  Object.entries(official).map(([code, byNum]) => [code, new Set(Object.values(byNum).map((v) => v.replace(/\s/g, '')))]),
)

type Row = { n: number; got: string; year: number; set: string }
const cjkLeft = new Map<string, Row>()
const kataLeft = new Map<string, Row>()
// ④ 히라가나가 뜻이 아니라 소리로 남은 것. 히라가나는 일본어 낱말이라 번역해야 하고
// (가타카나는 이름·외래어라 음역이 맞다), 변환 결과가 음역기와 똑같으면 사전에 없다는 뜻이다.
// 실제로 'おねがい'가 '오네가이'로, 오거폰 가면 셋이 '카마도노멘'처럼 나가고 있었다.
const kanaLeft = new Map<string, Row>()
const dirtySets = new Set<string>()
// ⑤용: 오염되지 않은 세트의 일본어 카드명만 모은다.
const cleanNames: [string, string][] = []
const aliases = (pokemonNameAliases as { ja: string; ko: string }[]).filter((a) => a.ja.length <= 4)
let total = 0
const officialOk = new Set<string>()
const officialNg = new Map<string, number>()

for (const dir of ['public/sets', 'public/packsim']) {
  let files: string[]
  try {
    files = readdirSync(join(ROOT, dir))
  } catch {
    continue // packsim은 없을 수도 있다
  }
  for (const f of files) {
    if (!f.endsWith('.json') || f === 'index.json') continue
    const slug = f.replace('.json', '')
    let d: { ed?: string; cards?: { name?: string }[] }
    try {
      d = JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8'))
    } catch {
      continue
    }
    const ed = d.ed ?? (slug.startsWith('ja') ? 'ja' : 'en')
    const year = yearOf.get(slug) ?? 2005
    // 옛 세트 일부는 원본(TCGdex)의 일본어 칸이 영어 카드명을 기계번역한 것으로 오염돼 있다.
    // 'Slowpoke'가 'ゆっくり'(느릿), 'Weedle'이 'おしっこ'(오줌), 'Mr. Mime'이 'マイムさん'.
    // 알아보는 법: 일본어 세트인데 알파벳 카드명이 섞여 있다('vileplume', 'lileep', 'k').
    // 이건 우리 번역기 잘못이 아니라 원본이 틀린 것이라 ④에서 뺀다 — 안 빼면 매번 뜬다.
    // 'Meowth（デルタ種）'처럼 뒤에 괄호가 붙은 것도 같은 오염이다.
    const dirty =
      ed === 'ja' && (d.cards ?? []).some((c) => /^[A-Za-z][A-Za-z'. -]*(（[^）]*）)?$/.test(c.name ?? 'x'))
    if (dirty) dirtySets.add(slug)
    for (const c of d.cards ?? []) {
      if (!c.name) continue
      total++
      if (ed === 'ja' && !dirty) cleanNames.push([c.name, slug])
      const got = render(ed, c.name)
      if (CJK.test(got)) {
        const cur = cjkLeft.get(c.name) ?? { n: 0, got, year, set: slug }
        cur.n++
        cjkLeft.set(c.name, cur)
      }
      // ③ 공식 카드명 대조(한국 발매 세트만). 포켓몬 카드는 이미 정식 사전으로 잡히므로 뺀다.
      const off = officialBySet.get(slug.replace(/^ja-/, ''))
      if (ed === 'ja' && off && !koNames.some((k) => got.includes(k))) {
        if (off.has(got.replace(/\s/g, ''))) officialOk.add(got)
        else officialNg.set(got, (officialNg.get(got) ?? 0) + 1)
      }

      // ④ 히라가나 낱말이 뜻이 아니라 소리로 옮겨졌는지. 변환 결과가 음역기와 똑같으면
      // 사전에 없다는 뜻이다("おねがい"가 "부탁"이 아니라 "오네가이"로 나간 게 이 경우다).
      if (ed === 'ja' && !dirty) {
        for (const run of c.name.match(/[ぁ-ん]{2,}/g) ?? []) {
          const ko = koreanizeTitle(run)
          if (ko !== kanaToHangul(run)) continue // 사전에 있어 뜻으로 옮겨졌다
          if (!/^[가-힣]+$/.test(ko) || !got.includes(ko)) continue
          const cur = kanaLeft.get(run) ?? { n: 0, got, year, set: slug }
          cur.n++
          cur.year = Math.min(cur.year, year)
          cur.got = got
          kanaLeft.set(run, cur)
        }
      }

      // 가타카나만으로 된 이름인데 공식 한글명이 안 들어있다 = 음역으로 깨진 것
      if (ed === 'ja' && KATA_ONLY.test(c.name) && !reviewed.has(c.name) && !koNames.some((k) => got.includes(k))) {
        const cur = kataLeft.get(c.name) ?? { n: 0, got, year, set: slug }
        cur.n++
        cur.year = Math.min(cur.year, year)
        kataLeft.set(c.name, cur)
      }
    }
  }
}

// ⑤ 짧은 오염 별칭이 멀쩡한 카드명 속에 끼어드는지.
// 별칭(pokemonNameAliases)은 옛 세트의 잘못된 표기를 잡으려고 넣은 것이라, 짧으면 다른
// 카드명 안에 그대로 들어가 엉뚱하게 바뀐다. 실제로 'ベリー'(캐이시) 때문에 'シトラスベリー'가
// '시토라스캐이시'가, 'ルチア'(라이츄) 때문에 최신 세트의 '루티아의 어필'이 '라이츄의 아피루'가
// 됐다. 카드명 안에 정식 포켓몬 이름이 들어 있으면 그게 먼저 잡히므로 안전하다 — 그런 건 뺀다.
const jaOfficial = (pokemonNames as { ja: string }[]).map((p) => p.ja).filter((j) => j.length >= 3)
const aliasHits = new Map<string, string[]>()
for (const [name, slug] of cleanNames) {
  for (const a of aliases) {
    if (name === a.ja || !name.includes(a.ja)) continue
    if (jaOfficial.some((j) => j.length > a.ja.length && name.includes(j))) continue
    const arr = aliasHits.get(a.ja) ?? []
    if (arr.length < 4) arr.push(`${name} [${slug}]`)
    aliasHits.set(a.ja, arr)
  }
}

// ⑥ 짧은 "뜻" 규칙이 더 긴 가타카나 낱말을 잘라 먹는지.
// 치환은 낱말 경계를 안 보고 갈아끼우기만 한다. 두 글자짜리 이름이 더 긴 외래어
// 한가운데 걸리면 그 자리를 잘라 먹는다 — 'カイ'(주혜) 때문에 スカイフィールド가
// "스주혜피루도"가, 'ジム'(체육관) 때문에 ダメージムーバー가 "다메체육관바"가 됐다.
//
// ⑤(별칭)와 달리 여기는 STRUCTURAL_TERMS와 포켓몬 정식 이름까지 본다. 다만
// 'ボール'→'볼'처럼 소리를 그대로 옮긴 규칙은 낱말 안에 들어가도 맞는 결과가 나오므로
// 뺀다. 소리인지 뜻인지는 첫 글자의 첫소리로 가른다(보루/볼은 ㅂ으로 같고,
// 지무/체육관은 ㅈ↔ㅊ으로 다르다).
const firstJamo = (s: string) => {
  const c = s.trim().charCodeAt(0)
  return c >= 0xac00 && c <= 0xd7a3 ? Math.floor((c - 0xac00) / 588) : -1
}
const isSoundRule = (ja: string, ko: string) => firstJamo(kanaToHangul(ja)) === firstJamo(ko)
const KATA = /[ァ-ヶー]/
const KATA_KEY = /^[ァ-ヶー]{1,3}$/
const meaningRules: [string, string][] = []
for (const [ja, ko] of STRUCTURAL_TERMS) if (KATA_KEY.test(ja) && !isSoundRule(ja, ko)) meaningRules.push([ja, ko])
for (const p of pokemonNames as { ja: string; ko: string }[])
  if (KATA_KEY.test(p.ja) && !isSoundRule(p.ja, p.ko)) meaningRules.push([p.ja, p.ko])
for (const a of pokemonNameAliases as { ja: string; ko: string }[])
  if (KATA_KEY.test(a.ja) && !isSoundRule(a.ja, a.ko)) meaningRules.push([a.ja, a.ko])

const bleedHits = new Map<string, { ko: string; ex: string[] }>()
for (const [name, slug] of cleanNames) {
  for (const [ja, ko] of meaningRules) {
    if (name === ja) continue
    let i = name.indexOf(ja)
    let cut = false
    while (i >= 0) {
      const b = name[i - 1]
      const a = name[i + ja.length]
      if ((b && KATA.test(b)) || (a && KATA.test(a))) {
        cut = true
        break
      }
      i = name.indexOf(ja, i + 1)
    }
    // 결과에 그 규칙의 값이 실제로 박혔을 때만 사고다(더 긴 규칙이 먼저 잡았으면 무사하다).
    if (!cut) continue
    const got = koreanizeTitle(name)
    if (!got.includes(ko.trim())) continue
    const e = bleedHits.get(ja) ?? { ko, ex: [] }
    if (e.ex.length < 4) e.ex.push(`${name} → ${got} [${slug}]`)
    bleedHits.set(ja, e)
  }
}

const sum = (m: Map<string, Row>) => [...m.values()].reduce((s, v) => s + v.n, 0)
console.log(`카드명 ${total}건 검사`)
console.log(`  ① 일본어·한자 잔여: ${cjkLeft.size}종 / ${sum(cjkLeft)}건`)
console.log(`  ② 음역으로 깨진 이름: ${kataLeft.size}종 / ${sum(kataLeft)}건`)
console.log(`  (공식 한글명 사전: ${koSet.size}종)`)
console.log(`  ③ 포켓몬코리아 공식 카드명과 대조: 일치 ${officialOk.size}종 / 불일치 ${officialNg.size}종`)
console.log(`  ④ 히라가나가 뜻 없이 소리로 남음: ${kanaLeft.size}종 / ${sum(kanaLeft)}건`)
console.log(`  ⑤ 짧은 별칭이 멀쩡한 카드명에 끼어듦: ${aliasHits.size}종`)
console.log(`  ⑥ 짧은 뜻 규칙이 긴 가타카나 낱말을 잘라 먹음: ${bleedHits.size}종`)
console.log(`  (원본 일본어 칸이 오염된 옛 세트 ${dirtySets.size}개는 ④에서 뺐다: ${[...dirtySets].join(' ')})`)

if (cjkLeft.size) {
  console.log('\n① 일본어·한자가 남은 것:')
  for (const [ja, v] of cjkLeft) console.log(`   ${v.n}건  "${v.got}"  ← ${ja}  [${v.set}]`)
}

// ④는 건수가 적고 하나하나가 오역이라 --list 없이도 다 보여준다.
if (kanaLeft.size) {
  console.log('\n④ 히라가나가 뜻 없이 소리로 남은 것 (오래된 세트 순):')
  ;[...kanaLeft]
    .sort((a, b) => a[1].year - b[1].year || b[1].n - a[1].n)
    .forEach(([ja, v], i) =>
      console.log(`  ${String(i + 1).padStart(3)} ${ja.padEnd(12)} → "${koreanizeTitle(ja)}"  ${v.n}건  예: ${v.got} [${v.set}]`),
    )
  console.log('\n히라가나는 일본어 낱말이다. 소리로 옮기면 뜻이 사라진다("おねがい"→"오네가이").')
  console.log('뜻을 STRUCTURAL_TERMS에 넣되, 공식 한글 카드명을 먼저 확인할 것.')
}

if (aliasHits.size) {
  console.log('\n⑤ 짧은 별칭이 멀쩡한 카드명에 끼어든다 (src/data/pokemonNameAliases.json):')
  for (const [ja, ex] of aliasHits) {
    const ko = aliases.find((a) => a.ja === ja)?.ko
    console.log(`   ${ja} → ${ko} :  ${ex.join(', ')}`)
  }
  console.log('\n고치는 법: 그 별칭을 지우거나(잘못 넣은 것이면), 카드명 전체가 그 이름일 때만')
  console.log('바꾸도록 koreanizeTitle.ts의 EXACT_ONLY_ALIASES에 넣는다.')
}

// ⑥은 건수가 적고 하나하나가 오역이라 --list 없이도 다 보여준다.
if (bleedHits.size) {
  console.log('\n⑥ 짧은 뜻 규칙이 긴 가타카나 낱말을 잘라 먹는다:')
  for (const [ja, v] of bleedHits) {
    console.log(`   ${ja} → ${v.ko}`)
    for (const ex of v.ex) console.log(`       ${ex}`)
  }
  console.log('\n고치는 법: 잘린 쪽 낱말 전체를 STRUCTURAL_TERMS 맨 앞에 적는다(긴 것이 먼저 잡힌다).')
}

if (LIST && kataLeft.size) {
  console.log(`\n② 음역으로 깨진 이름 (오래된 세트 순, 상위 ${LIMIT}):`)
  ;[...kataLeft]
    .sort((a, b) => a[1].year - b[1].year || b[1].n - a[1].n)
    .slice(0, LIMIT)
    .forEach(([ja, v], i) =>
      console.log(`  ${String(i + 1).padStart(3)} ${ja.padEnd(13)} "${v.got}"  ${v.n}건 [${v.set} ${v.year}]`),
    )
  console.log('\n포켓몬이면 src/data/pokemonNameAliases.json에, 굿즈·트레이너면')
  console.log('src/lib/koreanizeTitle.ts의 STRUCTURAL_TERMS에 넣는다.')
  console.log('⚠️ 별칭은 3글자 이상만 — 2글자는 다른 이름 안에 끼어든다(グリ가 スグリ를 깨뜨린 적 있음).')
}

if (LIST && officialNg.size) {
  console.log('\n③ 공식 카드명과 다른 것(같은 세트의 공식 목록에 그 이름이 없음):')
  ;[...officialNg].sort((a, b) => b[1] - a[1]).forEach(([ko, n]) => console.log(`   ${n}건  ${ko}`))
}

if (!LIST) {
  console.log('\n목록은 --list 로 본다.')
}
