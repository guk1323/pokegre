// 한글 카드명 → 일본어 카드명 사전을 만든다(스니커덩크 검색용).
//
// 왜 필요한가: 검색어 번역은 낱말 규칙으로 돌아가는데, 사전에 없는 낱말이 하나라도 있으면
// "스타단의 조무래기 → 스타단のしたっぱ"처럼 한글과 일본어가 섞여 나간다. 섞인 검색어는
// 스니커덩크에서 0건이다. 그런데 우리는 같은 카드의 일본어 원문을 이미 들고 있다
// (public/sets/*.json). 규칙이 못 옮긴 것만 원문으로 바로 대준다.
//
// 세트 이름 쪽에는 이미 같은 짝(src/data/setNameKoJa.json)이 있다. 이건 카드 이름 판이다.
//
// ⚠️ 규칙으로 이미 잘 되는 것은 넣지 않는다. 파일이 커지면 첫 화면이 그만큼 느려지고,
//    규칙이 좋아졌는데 낡은 표가 덮어써 버리는 사고도 막을 수 있다.
// ⚠️ 통짜(검색어 전체가 그대로 일치)일 때만 쓴다. 부분 치환하면 짧은 이름이 긴 이름
//    안에 끼어들어 다른 카드를 깨뜨린다(전에 여러 번 겪음).
//
// 실행: npx tsx scripts/gen-ko-ja-cards.mts [--write]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SETS = join(ROOT, 'public/sets')
const OUT = join(ROOT, 'src/data/cardNameKoJa.json')
const WRITE = process.argv.includes('--write')

// ⚠️ translateQuery는 이 파일이 만든 표를 읽는다. 그냥 부르면 "이미 다 된다"고 나와
// 결과가 1종으로 쪼그라든다(실제로 한 번 그랬다). 재기 전에 표를 비우고 불러온 뒤
// 원래대로 돌려놓는다. 그래야 "규칙만으로 되는가"를 정직하게 잰다.
const backup = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null
writeFileSync(OUT, '{}\n')
let translateSearchQuery: (q: string) => string
try {
  ;({ translateSearchQuery } = await import('../src/lib/translateQuery.ts'))
} finally {
  if (backup !== null) writeFileSync(OUT, backup)
}

const isJa = (s: string) => /[ぁ-んァ-ヶ一-鿿]/.test(s)
const hasKo = (s: string) => /[가-힣]/.test(s)

// 같은 한글 이름에 일본어가 여럿 붙을 때 검색에 쓸 쪽을 고른다. translateQuery.ts의
// betterForSearch와 같은 기준이다 — ①한자 없는 쪽 ②그다음 짧은 쪽.
// (스니커덩크는 가나로 치면 한자도 걸리지만 그 반대는 아니다.)
const hasKanji = (s: string) => /[一-鿿]/.test(s)
const better = (next: string, prev: string) =>
  hasKanji(next) !== hasKanji(prev) ? !hasKanji(next) : next.length < prev.length

const koToJa = new Map<string, string>()
let cards = 0

for (const f of readdirSync(SETS).filter((f) => f.endsWith('.json') && f !== 'index.json').sort()) {
  for (const c of JSON.parse(readFileSync(join(SETS, f), 'utf8')).cards ?? []) {
    const ja = String(c.name ?? '').trim()
    cards++
    // 원본이 영어인 옛 오염 세트는 일본어 원문 자체가 없다 — 여기서 줄 게 없다.
    if (!ja || !isJa(ja)) continue
    const ko = koreanizeEnglishCardName(koreanizeTitle(ja))
    // 한글로 다 안 옮겨진 이름은 검색어로도 안 쓰인다(화면에 일본어가 그대로 보이는 카드).
    if (!ko || isJa(ko) || !hasKo(ko)) continue
    // 규칙만으로 이미 온전히 일본어가 되는 것은 뺀다.
    if (!hasKo(translateSearchQuery(ko))) continue
    const prev = koToJa.get(ko)
    if (prev === undefined || better(ja, prev)) koToJa.set(ko, ja)
  }
}

const out = Object.fromEntries([...koToJa].sort((a, b) => a[0].localeCompare(b[0], 'ko')))
const kb = (JSON.stringify(out, null, 1).length / 1024).toFixed(1)
console.log(`카드 ${cards.toLocaleString()}장 → 규칙이 못 옮기는 이름 ${koToJa.size}종 (${kb} KB)`)
for (const [ko, ja] of [...koToJa].slice(0, 15)) console.log(`  ${ko}  →  ${ja}`)
if (koToJa.size > 15) console.log(`  … 그 밖 ${koToJa.size - 15}종`)

if (WRITE) {
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
  console.log(`\n${OUT.replace(ROOT + '/', '')} 저장`)
} else {
  console.log('\n(--write 를 붙이면 저장한다)')
}
