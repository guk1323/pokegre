// 세트 카드명 점검: public/sets(+packsim)의 카드 이름을 화면에 나오는 그대로 변환해
// ① 일본어·한자가 남은 것 ② 가타카나인데 공식 한글명이 아닌 것(=음역으로 깨진 것)을 찾는다.
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
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIST = process.argv.includes('--list')
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 120)

const CJK = /[぀-ヿ一-鿿]/ // 히라가나·가타카나·한자
const KATA_ONLY = /^[ァ-ヶー・]{2,10}$/ // 포켓몬 이름 후보(트레이너는 보통 の·한자가 섞인다)
const koNames = (pokemonNames as { ko: string }[]).map((p) => p.ko)
const koSet = new Set(koNames)

// 화면에 나오는 그대로 변환한다(일본판은 일본어 변환 후 영어 변환기까지 태운다).
const render = (ed: string, name: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name)

const idx: { slug: string; releaseDate?: string }[] = JSON.parse(
  readFileSync(join(ROOT, 'public/sets/index.json'), 'utf8'),
)
const yearOf = new Map(idx.map((s) => [s.slug, +(s.releaseDate ?? '2005').slice(0, 4)]))

type Row = { n: number; got: string; year: number; set: string }
const cjkLeft = new Map<string, Row>()
const kataLeft = new Map<string, Row>()
let total = 0

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
    for (const c of d.cards ?? []) {
      if (!c.name) continue
      total++
      const got = render(ed, c.name)
      if (CJK.test(got)) {
        const cur = cjkLeft.get(c.name) ?? { n: 0, got, year, set: slug }
        cur.n++
        cjkLeft.set(c.name, cur)
      }
      // 가타카나만으로 된 이름인데 공식 한글명이 안 들어있다 = 음역으로 깨진 것
      if (ed === 'ja' && KATA_ONLY.test(c.name) && !koNames.some((k) => got.includes(k))) {
        const cur = kataLeft.get(c.name) ?? { n: 0, got, year, set: slug }
        cur.n++
        cur.year = Math.min(cur.year, year)
        kataLeft.set(c.name, cur)
      }
    }
  }
}

const sum = (m: Map<string, Row>) => [...m.values()].reduce((s, v) => s + v.n, 0)
console.log(`카드명 ${total}건 검사`)
console.log(`  ① 일본어·한자 잔여: ${cjkLeft.size}종 / ${sum(cjkLeft)}건`)
console.log(`  ② 음역으로 깨진 이름: ${kataLeft.size}종 / ${sum(kataLeft)}건`)
console.log(`  (공식 한글명 사전: ${koSet.size}종)`)

if (cjkLeft.size) {
  console.log('\n① 일본어·한자가 남은 것:')
  for (const [ja, v] of cjkLeft) console.log(`   ${v.n}건  "${v.got}"  ← ${ja}  [${v.set}]`)
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
} else if (!LIST) {
  console.log('\n목록은 --list 로 본다.')
}
