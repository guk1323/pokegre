// "이 포켓몬을 누가 그렸나"를 찾기 위한 거꾸로 된 목록을 만든다.
//
// 지금은 작가 파일이 389개(2.9MB)라, 이걸 알려면 전부 열어야 한다. 그래서 미리
// { 카드이름: [작가번호, …] } 하나로 뒤집어 둔다. 작가번호는 index.json의 순서다
// (슬러그를 그대로 담으면 크기가 2.5배가 된다 — 262KB vs 102KB).
//
// ⚠️ 카드 이름은 영어다(pokemontcg.io에서 긁은 데이터). 화면에서 한글로 치면
//    cardNameKoEn 사전으로 영어로 바꿔 찾는다. 얼마나 덮이는지는 아래에서 같이 잰다.
// ⚠️ 이 파일은 작가 화면에 들어갈 때만 받는다. 홈 첫 화면과는 상관없다.
//
// 실행: npx tsx scripts/gen-artist-by-card.mts [--write]
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const DIR = path.resolve(process.cwd(), 'public/artists')
const OUT = path.join(DIR, 'by-card.json')
const WRITE = process.argv.includes('--write')

interface IndexEntry {
  slug: string
  ko: string
  en: string
}
interface ArtistFile {
  cards?: { name?: string }[]
}

const index = JSON.parse(await readFile(path.join(DIR, 'index.json'), 'utf8')) as IndexEntry[]
const order = new Map(index.map((a, i) => [a.slug, i]))

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && !['index.json', '_counts.json', 'by-card.json'].includes(f))

const by = new Map<string, Set<number>>()
let cards = 0
let orphan = 0
for (const f of files) {
  const slug = f.slice(0, -5)
  const at = order.get(slug)
  if (at === undefined) {
    // index.json에 없는 작가 파일. 화면이 index를 기준으로 그리므로 넣어 봐야 못 쓴다.
    orphan++
    continue
  }
  const d = JSON.parse(await readFile(path.join(DIR, f), 'utf8')) as ArtistFile
  for (const c of d.cards ?? []) {
    const n = (c.name ?? '').trim()
    if (!n) continue
    cards++
    if (!by.has(n)) by.set(n, new Set())
    by.get(n)!.add(at)
  }
}

// 이름순으로 담아 파일이 매번 같은 모양으로 나오게 한다(쓸데없는 diff 방지).
const out: Record<string, number[]> = {}
for (const name of [...by.keys()].sort()) out[name] = [...by.get(name)!].sort((a, b) => a - b)

// ⚠️ 한글 → 영어 대조표를 이 파일에 같이 담는다.
//    화면에서 CARD_NAME_KO_TO_EN을 쓰려 했는데 안 됐다 — 그건 "카드명" 사전이라
//    "피카츄 ★"는 있어도 그냥 "피카츄"가 없다(1,524개 중 0개, 2026-08-04 확인).
//    포켓몬 이름은 pokemonNames.json에 있는데, 그걸 화면이 통째로 받으면 67KB가 는다.
//    여기서 "실제로 결과가 나오는 이름"만 골라 담으면 그 문제가 없고,
//    목록과 대조표가 늘 같은 시점의 것이라 어긋날 일도 없다.
const pokemonNamesForMap = JSON.parse(
  await readFile(path.resolve(process.cwd(), 'src/data/pokemonNames.json'), 'utf8'),
) as { ko: string; en: string }[]
const normForMap = (s: string) => s.toLowerCase().replace(/[‘’ʼ`´]/g, "'")
const allNames = Object.keys(out).map(normForMap)
const koToEn: Record<string, string> = {}
for (const p of pokemonNamesForMap) {
  if (!p.ko || !p.en) continue
  const q = normForMap(p.en)
  if (allNames.some((n) => n === q || n.includes(q))) koToEn[p.ko] = p.en
}

const json = JSON.stringify({ c: out, k: koToEn })
console.log(`작가 ${files.length}명 · 카드 ${cards.toLocaleString()}장 · 이름 ${Object.keys(out).length.toLocaleString()}개`)
if (orphan) console.log(`  (index.json에 없는 작가 파일 ${orphan}개는 건너뜀)`)
console.log(`  파일 ${(json.length / 1024).toFixed(0)}KB · gzip ${(gzipSync(json).length / 1024).toFixed(0)}KB`)
console.log(`  한글 대조표 ${Object.keys(koToEn).length.toLocaleString()}개 같이 담음`)

// 여러 명이 그린 이름이 많아야 이 기능이 쓸모 있다. 몇 개인지 같이 찍는다.
const multi = Object.values(out).filter((v) => v.length > 1).length
console.log(`  작가가 2명 이상인 이름 ${multi.toLocaleString()}개`)

// ── 한글로 얼마나 찾아지나 ────────────────────────────────────────────────
// 화면은 한글 입력을 영어로 바꿔 이 목록을 뒤진다. 그 반대 방향(영어 이름 → 한글)이
// 사전에 있어야 사람이 한글로 칠 수 있다. 덮이는 비율을 재 둔다.
// ⚠️ 통째로 같은지 보면 안 된다. 카드 이름에는 변형이 붙는다 —
//    "Aegislash V" · "Absol-EX" · "Pikachu VMAX". 사람이 "피카츄"를 치면 그것들도
//    다 나와야 맞다. 그래서 "포함"으로 찾는다(화면도 같은 방식을 쓴다).
// 재는 방향도 뒤집는다. "카드 이름 중 몇 %가 사전에 있나"가 아니라
// "사람이 포켓몬 이름을 쳤을 때 결과가 나오나"가 진짜 물음이다.
const pokemonNames = JSON.parse(
  await readFile(path.resolve(process.cwd(), 'src/data/pokemonNames.json'), 'utf8'),
) as { ko: string; en: string }[]
// ⚠️ 아포스트로피가 두 종류다. 우리 사전은 Farfetch’d(U+2019), 작가 데이터는
//    Farfetch'd(U+0027)를 쓴다. 안 맞추면 파오리·창파나이트가 통째로 안 나온다
//    (실측 2026-08-04). 화면도 같은 정리를 거친다.
const norm = (s: string) => s.toLowerCase().replace(/[‘’ʼ`´]/g, "'")
const names = Object.keys(out)
const lower = names.map(norm)
const hit = (en: string) => {
  const q = norm(en)
  return lower.some((n) => n === q || n.includes(q))
}
const askable = pokemonNames.filter((p) => p.ko && p.en)
const found = askable.filter((p) => hit(p.en))
console.log(
  `\n포켓몬 한글 이름 ${askable.length.toLocaleString()}개 중 ` +
    `결과가 나오는 것 ${found.length.toLocaleString()}개 (${((found.length / askable.length) * 100).toFixed(1)}%)`,
)
const none = askable.filter((p) => !hit(p.en)).slice(0, 12)
console.log(`안 나오는 표본: ${none.map((p) => `${p.ko}(${p.en})`).join(' · ')}`)
// 실제로 몇 명이나 나오는지도 몇 개 찍어 본다.
for (const ko of ['피카츄', '리자몽', '이브이', '뮤츠', '잠만보']) {
  const p = askable.find((x) => x.ko === ko)
  if (!p) continue
  const q = norm(p.en)
  const artists = new Set<number>()
  for (let i = 0; i < names.length; i++) if (lower[i] === q || lower[i].includes(q)) out[names[i]].forEach((a) => artists.add(a))
  console.log(`  ${ko}: 작가 ${artists.size}명`)
}

if (WRITE) {
  await writeFile(OUT, json)
  console.log(`\n${OUT} 저장했습니다.`)
} else {
  console.log('\n저장하려면 --write')
}
