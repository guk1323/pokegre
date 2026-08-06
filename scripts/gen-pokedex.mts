// 포켓몬별 카드 목록을 미리 만들어 public/pokedex/에 저장한다.
//
// 왜 미리 만드나: 카드가 40,489장이고, 어느 포켓몬 카드인지 가려내려면 이름 1,025개와
// 맞춰 봐야 한다. 이걸 브라우저에서 하면 세트 파일 371개를 통째로 받아야 한다(수 MB).
// 미리 만들어 두면 검색은 목록 파일 하나(작다)로 하고, 고른 포켓몬 것만 따로 받는다.
// 작가 화면(public/artists/by-card.json)이 같은 방식이다.
//
// ⚠️ 이름 대조는 **번역 전 원문**으로 한다. 일본판은 일본어, 북미판은 영어와 맞춘다.
//    한글로 옮긴 뒤에 맞추면 번역이 틀린 카드는 통째로 빠진다.
// ⚠️ 긴 이름부터 맞춘다. "리자몽"을 먼저 맞추면 "메가리자몽"이 리자몽으로 잡힌다.
//    실제로는 메가리자몽도 리자몽 카드가 맞지만, 진화 전후를 섞지 않으려면 긴 쪽이 맞다.
//
// 쓰는 법: npx tsx scripts/gen-pokedex.mts
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

type Pokemon = { id: number; ko: string; ja: string; en: string }
type SetMeta = { slug: string; ed: 'ja' | 'en'; name: string; releaseDate?: string; serie?: string }
type Card = { n: string; name: string; img?: string; r?: string }

/** 한 장. 화면이 쓰는 것만 담는다 — 파일이 커지면 첫 화면이 느려진다. */
type Entry = {
  /** 카드 이름(번역 전 원문). 화면이 우리 사전으로 한글로 만든다. */
  name: string
  /** 세트 슬러그. 눌러서 세트 화면으로 갈 때 쓴다. */
  s: string
  /** 카드 번호 */
  n: string
  /** 그림 */
  img?: string
  /** 등급 */
  r?: string
}

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'pokedex')

const list = pokemonNames as Pokemon[]
// 긴 이름부터 — 짧은 이름이 긴 이름 안에 들어 있는 경우를 먼저 가로채지 않게.
const byJa = [...list].sort((a, b) => b.ja.length - a.ja.length)
const byEn = [...list].sort((a, b) => b.en.length - a.en.length)

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as SetMeta[]
const meta = new Map(idx.map((s) => [s.slug, s]))

/** 포켓몬 id → 그 포켓몬 카드들 */
const buckets = new Map<number, (Entry & { date: string })[]>()

// 트레이너·에너지 카드. 포켓몬처럼 이름표(ja/en/ko 대조표)가 없으므로 **한글 카드
// 이름**으로 묶는다 — 일본판 「博士の研究」와 북미판 「Professor's Research」가 둘 다
// "박사의 연구"가 되어 한 무더기가 된다(운영자 지시 2026-08-06).
// ⚠️ 그래서 여기만은 번역을 거친다. 포켓몬 쪽은 원문으로 맞추는 것과 반대인데,
//    이유가 다르다 — 포켓몬은 대조표가 있어 원문이 더 정확하고, 트레이너는 판을
//    묶어 줄 열쇠가 한글 이름밖에 없다.
const trainers = new Map<string, (Entry & { date: string; ko: string })[]>()
const koCardName = (ed: 'ja' | 'en', n: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(n)) : koreanizeEnglishCardName(n)

for (const f of readdirSync(path.join(ROOT, 'public/sets'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const slug = f.replace('.json', '')
  const m = meta.get(slug)
  if (!m) continue
  const d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', f), 'utf-8')) as { ed: 'ja' | 'en'; cards?: Card[] }
  const pool = d.ed === 'ja' ? byJa : byEn
  for (const c of d.cards ?? []) {
    const nm = c.name ?? ''
    if (!nm) continue
    const 한장 = { name: nm, s: slug, n: c.n, img: c.img || undefined, r: c.r || undefined, date: m.releaseDate ?? '' }
    const hit = pool.find((p) => nm.includes(d.ed === 'ja' ? p.ja : p.en))
    if (hit) {
      const arr = buckets.get(hit.id) ?? []
      arr.push(한장)
      buckets.set(hit.id, arr)
    } else {
      // 포켓몬이 아니면 트레이너·에너지다. 한글 이름으로 묶는다.
      const ko = koCardName(d.ed, nm)
      if (!ko) continue
      // ⚠️ 띄어쓰기·가운뎃점만 다른 것은 같은 카드다. 그대로 두면 "체육관배지 16장"과
      //    "체육관 배지 8장"이 따로 서 있어, 찾는 사람은 둘 다 눌러 봐야 한다
      //    (운영자 지적 2026-08-06). 묶는 열쇠에서만 빼고, 보여줄 이름은 그대로 쓴다.
      const key = ko.replace(/[\s·]/g, '')
      const arr = trainers.get(key) ?? []
      arr.push({ ...한장, ko })
      trainers.set(key, arr)
    }
  }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// 발매일이 빈 세트는 맨 뒤로(9로 시작하는 문자열은 어떤 날짜보다 크다).
const 발매순 = (a: { date: string; s: string; n: string }, b: { date: string; s: string; n: string }) =>
  (a.date || '9').localeCompare(b.date || '9') || a.s.localeCompare(b.s) || a.n.localeCompare(b.n)

// 목록 파일. 검색창이 이것만 받아 이름을 찾는다.
// t: 'p'=포켓몬 · 't'=트레이너·에너지. 화면이 어느 쪽인지 표시하는 데 쓴다.
type Row = { id: number; ko: string; en: string; c: number; t: 'p' | 't' }
const index: Row[] = list
  .filter((p) => (buckets.get(p.id)?.length ?? 0) > 0)
  .map((p) => ({ id: p.id, ko: p.ko, en: p.en, c: buckets.get(p.id)!.length, t: 'p' }))

// ⚠️ 트레이너 번호는 10000부터 준다. 포켓몬 도감번호(1~1025)와 겹치면 파일이 덮인다.
//    포켓몬이 늘어도(새 세대) 10000까지는 한참 남는다.
const TRAINER_ID_BASE = 10000
const 트레이너목록 = [...trainers.entries()].sort((a, b) => b[1].length - a[1].length)
트레이너목록.forEach(([, arr], i) => {
  const id = TRAINER_ID_BASE + i
  // 영어 이름은 북미판 카드가 있으면 그 원문을 쓴다(검색을 영어로도 되게).
  const en = arr.find((c) => !c.s.startsWith('ja-'))?.name ?? ''
  // ⚠️ 보여줄 이름은 **띄어쓰기가 있는 쪽**을 고른다. 열쇠에서 띄어쓰기를 뺐더니
  //    "체육관배지"처럼 붙은 이름이 대표가 되는 일이 생겼다. 사람이 읽기엔 띄어 쓴
  //    쪽이 낫고, 붙여 쓴 것도 검색에 걸린다(찾을 때도 띄어쓰기를 무시하므로).
  const 이름들 = [...new Set(arr.map((c) => c.ko))]
  const ko = 이름들.sort((a, b) => (b.match(/[\s·]/g)?.length ?? 0) - (a.match(/[\s·]/g)?.length ?? 0))[0]
  index.push({ id, ko, en, c: arr.length, t: 't' })
})
writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index))

// 하나씩. 발매 순으로 세워 둔다 — 화면에서 다시 세울 필요가 없다.
let 총장수 = 0
for (const [id, arr] of buckets) {
  arr.sort(발매순)
  총장수 += arr.length
  writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(arr))
}
트레이너목록.forEach(([, arr], i) => {
  arr.sort(발매순)
  총장수 += arr.length
  writeFileSync(path.join(OUT, `${TRAINER_ID_BASE + i}.json`), JSON.stringify(arr))
})

const size = readdirSync(OUT).reduce((n, f) => n + readFileSync(path.join(OUT, f)).length, 0)
console.log(
  `도감 ${index.length}종(포켓몬 ${index.filter((r) => r.t === 'p').length} · 트레이너 ${index.filter((r) => r.t === 't').length}) · 카드 ${총장수.toLocaleString()}장 · 파일 ${readdirSync(OUT).length}개 · ` +
    `${(size / 1024 / 1024).toFixed(1)}MB (목록 ${(readFileSync(path.join(OUT, 'index.json')).length / 1024).toFixed(0)}KB)`,
)
