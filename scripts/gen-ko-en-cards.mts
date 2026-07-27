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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'scripts/en-card-names.json')
const OUT = join(ROOT, 'src/data/cardNameKoEn.json')
const WRITE = process.argv.includes('--write')
// 세트를 믿을지 정하는 기준. 번호가 어긋난 세트는 10%대로 떨어지고 맞는 세트는 85% 위다.
const MIN_MATCH = 0.7
const MIN_SAMPLE = 10

if (!existsSync(SRC)) throw new Error('scripts/en-card-names.json이 없다 — fetch-en-card-names.mjs 먼저')
const enBySet: Record<string, Record<string, string>> = JSON.parse(readFileSync(SRC, 'utf8'))

const norm = (s: string) => s.replace(/[\s·]/g, '')
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
    const k = ko(c.name)
    // 한글이 안 남았으면 이미 영문으로 잘 나가는 카드다.
    if (!/[가-힣]/.test(k)) continue
    // 포켓몬 이름은 별도 사전(pokemonNames)이 이미 양방향으로 처리한다. 여기서 또 넣으면
    // "리자몽 ex" 같은 조합까지 통째로 굳어 버려 다른 접미사가 붙은 카드를 못 찾는다.
    if (CARD_NAME_KO_TO_EN.has(k)) continue
    const prev = pairs.get(k)
    if (prev && prev !== e) continue // 같은 한글에 영문이 둘이면 애매하니 안 넣는다
    pairs.set(k, e)
  }
}

console.log(`세트 ${kept}개 채택 · ${dropped.length}개 버림${dropped.length ? ' (' + dropped.join(' ') + ')' : ''}`)
console.log(`한글 → 영문 ${pairs.size}쌍`)
for (const [k, v] of [...pairs].slice(0, 12)) console.log(`   ${k}  →  ${v}`)

if (WRITE) {
  writeFileSync(OUT, JSON.stringify(Object.fromEntries([...pairs].sort()), null, 1) + '\n')
  console.log(`\n→ ${OUT}`)
} else {
  console.log('\n저장하려면 --write')
}
