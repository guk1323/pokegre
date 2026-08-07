// 카드 그림이 빈 자리를 PPT에서 채운다. limitless·pokemontcg.io에 없는 세트용이다.
//
// ⚠️ PPT는 유료다(limit=N이 곧 N크레딧). 예산을 넘길 것 같으면 그 세트를 통째로
//    건너뛴다. 429·403을 받으면 그 자리에서 전부 멈춘다(키 정지 방지).
// ⚠️ 번호와 이름이 둘 다 맞을 때만 채운다(리포 원칙: 틀린 것보다 빈칸).
//    PPT는 이름 뒤에 "- 012/030"처럼 번호를 붙여 주므로 떼고 비교한다.
// ⚠️ 세트 이름이 우리와 PPT가 다르다("SM trainer Kit (Lycanroc)" ↔ "SM Trainer Kit:
//    Lycanroc & Alolan Raichu"). 짝은 아래 표에 손으로 적는다 — 추측으로 맞추면
//    엉뚱한 세트 그림이 들어간다.
//
// 쓰기: npx tsx scripts/fill-card-imgs-ppt.mts --budget 1000            (몇 장인지만)
//       npx tsx scripts/fill-card-imgs-ppt.mts --budget 1000 --write    (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertFloor, noteLeft } from './ppt-floor.mjs'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

// ⚠️ 주소가 있다고 그림이 있는 게 아니다. 넣기 전에 하나씩 열어 본다
//    (pokemontcg.io는 주소만 주고 실제 파일이 없는 세트가 있었다 — 2026-08-04).
const aliveCache = new Map<string, boolean>()
async function imageAlive(url: string): Promise<boolean> {
  const known = aliveCache.get(url)
  if (known !== undefined) return known
  let ok = false
  try {
    ok = (await fetch(url, { method: 'HEAD' })).ok
  } catch {
    ok = false
  }
  aliveCache.set(url, ok)
  return ok
}

// 우리 세트 → PPT 세트 이름. PPT /sets 목록에서 확인한 정확한 이름이다(2026-08-03).
const PAIRS: [string, string][] = [
  // ⚠️ 이 표는 **빈칸이 있는 세트 전부**여야 한다. 예전엔 여덟 개만 적혀 있어서
  //    나머지 세트는 아무리 돌려도 그대로였다(2026-08-07). 아래로 다시 뽑으려면:
  //    public/sets/*.json에서 img가 빈 카드가 있고 pptSetNames.json에 짝이 있는 세트.
  ["en-exu", "EX Unseen Forces"],  // 빈칸 28장
  ["en-2018sm", "McDonald's Promos 2018"],  // 빈칸 12장
  ["en-2017sm", "McDonald's Promos 2017"],  // 빈칸 12장
  ["en-2015xy", "McDonald's Promos 2015"],  // 빈칸 12장
  ["en-2014xy", "McDonald's Promos 2014"],  // 빈칸 12장
  ["en-ecard2", "Aquapolis"],  // 빈칸 8장
  ["en-mfb", "My First Battle"],  // 빈칸 6장
  ["en-svp", "SV: Scarlet & Violet Promo Cards"],  // 빈칸 4장
  ["ja-VS1", "Pokemon VS"],  // 빈칸 3장
  ["ja-M1L", "m1L: Mega Brave"],  // 빈칸 1장
  ["en-swshp", "SWSH: Sword & Shield Promo Cards"],  // 빈칸 1장
  ["ja-SM11b", "SM11b: Dream League"],  // 빈칸 1장
  ["ja-SM10b", "SM10b: Sky Legend"],  // 빈칸 1장
  ["en-hgssp", "HGSS Promos"],  // 빈칸 1장
  ["ja-neo4", "Darkness, and to Light..."],  // 빈칸 1장
  ["ja-neo2", "Neo Premium File 2"],  // 빈칸 1장
  ["ja-PMCG6", "Challenge from the Darkness"],  // 빈칸 1장
]

const argOf = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const BUDGET = argOf('--budget', 1000)
const WRITE = process.argv.includes('--write')
const OUT = path.resolve(process.cwd(), 'public/sets')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const key = (await readFile('.env', 'utf8'))
  .split('\n')
  .find((l) => l.startsWith('POKEMON_PRICE_TRACKER_API_KEY='))
  ?.split('=')
  .slice(1)
  .join('=')
  .trim()
  .replace(/^["']|["']$/g, '')
if (!key) {
  console.log('PPT 키를 못 찾았습니다(.env)')
  process.exit(1)
}

// 같은 카드인데 이름 표기가 달라 자동으로는 안 맞는 짝. 하나씩 뜻을 확인하고 적었다.
// ⚠️ 여기 적는 순간 "번호가 같으면 같은 카드"로 믿는 것이므로, 반드시 뜻이 통하는지
//    직접 보고 적을 것. 예를 들어 ja-M6 079는 우리가 ブーバーン(마그마번)인데 PPT는
//    Magmar(마그마)라 서로 다른 포켓몬이다 — 그런 건 절대 넣지 않는다(빈칸으로 둔다).
const NAME_PAIRS: Record<string, string> = {
  ヒートロトムex: 'Heat Rotom ex',
  ぼうけんのランタン: 'Adventuring Lantern', // ぼうけん=모험, ランタン=랜턴
  とくちゅうチョッキ: 'Custom Vest', // 特注=주문제작, チョッキ=조끼
  'MCの盛り上げ': "Emcee's Hype", // MC=사회자, 盛り上げ=분위기 띄우기
  ギリー: 'Aarune', // 트레이너 아룬의 일본명
  ヒガナの信頼: "Zinnia's Trust", // ヒガナ=지나(Zinnia)
  フウとランの修行: "Tate & Liza's Training", // フウ·ラン=풍·란(Tate & Liza)
  グロウ草エネルギー: 'Growing Grass Energy',
  ニトロ炎エネルギー: 'Nitro Fire Energy',
}

const PAGE = 200
let spent = 0
let stop = ''
// 이름 비교는 표기 차이를 지우고 한다("Mr. Mime" / "Mr Mime").
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
// 한글까지 남기는 비교용(일본판 세트에 쓴다).
const normKo = (s: string) => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
// 일본판은 우리 이름이 일본어, PPT 이름이 영어다. 둘 다 화면에 나오는 한글로 옮겨
// 견줘야 짝이 맞는다. 그냥 글자로 비교하면 하나도 안 맞아 전부 건너뛴다.
const sameCard = (ours: string, theirsRaw: string) => {
  const theirs = stripDeckTag(theirsRaw)
  return (
    norm(ours) === norm(theirs) ||
    (NAME_PAIRS[ours.trim()] !== undefined && norm(NAME_PAIRS[ours.trim()]) === norm(theirs)) ||
    normKo(koreanizeEnglishCardName(koreanizeTitle(ours))) === normKo(koreanizeEnglishCardName(theirs))
  )
}
const stripNo = (s: string) => s.replace(/\s*-\s*[\dA-Za-z]+\/[\dA-Za-z]+\s*$/, '').trim()
// ⚠️ PPT는 **테마덱 카드에 꼬리표**를 붙인다. 이름이 아니라 "어느 덱의 몇 번"을 적은 것이다.
//     Tierno      ↔ Tierno (20 - Pikachu Libre Deck)
//     Great Ball  ↔ Great Ball (#21, Alolan Ninetales Half-Deck)
//     Lycanroc    ↔ 루가루암 (#30 Holofoil)
//    이걸 안 떼서 en-tk-* 테마덱이 통째로 "이름이 달라 건너뜀"이 됐다(2026-08-07).
//    ⚠️ 떼고도 이름이 다르면 **진짜 다른 카드다** — 그런 건 그대로 건너뛴다
//       (16 Lycanroc ≠ Grubbin: 테마덱은 번호 체계가 우리와 달라 실제로 어긋난다).
//    ⚠️ 꼬리표가 **둘씩 붙는 것**도 있다: "Hau (#19) (Lycanroc Half-Deck)".
//       한 번만 떼면 "Hau (#19)"가 남아 여전히 안 맞는다. 더 안 떨어질 때까지 돈다.
const stripDeckTag = (s: string) => {
  let out = s.trim()
  for (;;) {
    const 다음 = out
      .replace(/\s*\((?:#\s*)?\d+[^)]*\)\s*$/, '')
      .replace(/\s*\([^)]*(?:Deck|Half-Deck)\)\s*$/i, '')
      // "Pikachu - 225 (World Championship 2025) [Winner]"처럼 대괄호·대회 이름도 붙는다.
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .replace(/\s*\((?:Illustration Contest|World Championship|Winner|Finalist)[^)]*\)\s*$/i, '')
      // "Pikachu - 214" 처럼 번호만 꼬리에 붙는 것도 뗀다(번호는 이미 따로 맞춘다).
      .replace(/\s*-\s*\d+\s*$/, '')
      .trim()
    if (다음 === out) return out
    out = 다음
  }
}

type Row = { cardNumber?: string; name?: string; imageCdnUrl?: unknown }

async function fetchPage(setName: string, offset: number, lang = 'english'): Promise<Row[] | null> {
  // 크레딧 바닥선(5,000). 예산과 별개로 여기를 넘어서는 절대 안 부른다.
  if (!assertFloor(PAGE)) return null
  spent += PAGE
  const u =
    `https://www.pokemonpricetracker.com/api/v2/cards?language=${lang}` +
    `&setName=${encodeURIComponent(setName)}&limit=${PAGE}&offset=${offset}`
  const r = await fetch(u, { headers: { accept: 'application/json', authorization: `Bearer ${key}` } })
  const left = noteLeft(r.headers.get('x-ratelimit-daily-remaining')) ?? NaN
  if (r.status === 429 || r.status === 403) {
    if (r.status === 429 && Number.isFinite(left) && left > 1000) {
      console.log('    (분당 한도 — 70초 쉬고 다시)')
      await sleep(70_000)
      spent += PAGE
      const again = await fetch(u, { headers: { accept: 'application/json', authorization: `Bearer ${key}` } })
      if (again.ok) {
        const j2 = (await again.json()) as { data?: Row[] }
        return Array.isArray(j2.data) ? j2.data : []
      }
      stop = `${again.status} — 쉬었다 다시 해도 막힙니다(남은 ${left})`
      return null
    }
    stop = `${r.status} — 한도에 걸렸습니다(남은 ${Number.isFinite(left) ? left : '?'})`
    return null
  }
  if (!r.ok) return null
  const j = (await r.json()) as { data?: Row[] }
  return Array.isArray(j.data) ? j.data : []
}

// PPT 이미지 주소는 200/400/800 세 크기가 온다. 큰 것을 쓴다(프록시가 알아서 줄인다).
const pickImg = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['800', 'large', '400', 'medium', '200', 'small']) if (typeof o[k] === 'string') return o[k] as string
    const first = Object.values(o).find((x) => typeof x === 'string')
    if (typeof first === 'string') return first
  }
  return ''
}

console.log(`PPT로 카드 그림 채우기 — 세트 ${PAIRS.length}개 · 예산 ${BUDGET.toLocaleString()}크레딧\n`)
let total = 0
for (const [slug, setName] of PAIRS) {
  if (stop) break
  const file = path.join(OUT, `${slug}.json`)
  let d: { cards?: { n: string; name: string; img?: string }[] }
  try {
    d = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    console.log(`  ${slug.padEnd(14)} 파일 없음`)
    continue
  }
  const blanks = (d.cards ?? []).filter((c) => !(c.img ?? '').trim())
  if (!blanks.length) {
    console.log(`  ${slug.padEnd(14)} 빈칸 없음 — 건너뜀`)
    continue
  }
  if (spent + PAGE > BUDGET) {
    stop = `예산에 닿았습니다(다음 세트에 ${PAGE} 필요, 남은 ${BUDGET - spent})`
    break
  }

  const src = new Map<string, { name: string; img: string }>()
  // ⚠️ 테마덱(en-tk-*)은 **번호 체계가 우리와 아예 다르다** — 우리 16번이 루가루암인데
  //    저쪽 16번은 턱지충이다. 번호로만 찾으면 전부 "이름이 달라 건너뜀"이 된다.
  //    그래서 이름으로도 찾을 표를 같이 만든다(옛 일본판에 쓴 것과 같은 방식).
  //    **양쪽 모두 그 이름이 딱 한 장일 때만** 쓴다 — 여럿이면 어느 것인지 못 가린다.
  const 이름별 = new Map<string, { name: string; img: string }[]>()
  for (let p = 0; p < 3; p++) {
    if (spent + PAGE > BUDGET) break
    const list = await fetchPage(setName, p * PAGE, slug.startsWith('ja-') ? 'japanese' : 'english')
    if (list === null) break
    for (const c of list) {
      const num = String(c.cardNumber ?? '').split('/')[0].replace(/^0+/, '') || '0'
      const img = pickImg(c.imageCdnUrl)
      if (!num || !img) continue
      const 것 = { name: stripNo(String(c.name ?? '')), img }
      if (!src.has(num)) src.set(num, 것)
      const 열쇠 = normKo(koreanizeEnglishCardName(stripDeckTag(것.name)))
      if (열쇠) 이름별.set(열쇠, [...(이름별.get(열쇠) ?? []), 것])
    }
    if (list.length < PAGE) break
    await sleep(5000)
  }

  let filled = 0
  let dead = 0
  const skipped: string[] = []
  // 우리 쪽에서도 같은 이름이 여럿이면 이름으로 못 가린다. 미리 세어 둔다.
  const 우리이름수 = new Map<string, number>()
  for (const c of d.cards ?? []) {
    const k = normKo(koreanizeEnglishCardName(koreanizeTitle(c.name)))
    if (k) 우리이름수.set(k, (우리이름수.get(k) ?? 0) + 1)
  }
  for (const c of blanks) {
    let hit = src.get(String(Number(c.n)))
    // 번호로 찾은 게 다른 카드면, 이름으로 다시 찾아본다(테마덱용).
    if (!hit || !sameCard(c.name, hit.name)) {
      const k = normKo(koreanizeEnglishCardName(koreanizeTitle(c.name)))
      const 후보 = k ? 이름별.get(k) : undefined
      if (k && 후보?.length === 1 && 우리이름수.get(k) === 1) hit = 후보[0]
    }
    if (!hit) continue
    if (!sameCard(c.name, hit.name)) {
      if (skipped.length < 40) skipped.push(`\n        ${c.n} ${c.name} ≠ ${hit.name}  (우리:${koreanizeEnglishCardName(koreanizeTitle(c.name))} / PPT:${koreanizeEnglishCardName(hit.name)})`)
      continue
    }
    if (!(await imageAlive(hit.img))) {
      dead++
      continue
    }
    c.img = hit.img
    filled++
  }
  total += filled
  console.log(
    `  ${slug.padEnd(14)} PPT ${String(src.size).padStart(3)}장 · 빈칸 ${String(blanks.length).padStart(3)}장 중 ${String(filled).padStart(3)}장 채움  누적 ${spent}` +
      (dead ? ` · 그림이 없어 건너뜀 ${dead}장` : '') +
      (skipped.length ? `\n      (이름이 달라 건너뜀: ${skipped.join(', ')})` : ''),
  )
  if (WRITE && filled) await writeFile(file, JSON.stringify(d))
  await sleep(5000)
}
console.log(`\n합계 ${total}장 · 쓴 크레딧 ${spent} / 예산 ${BUDGET}`)
if (stop) console.log(`멈춘 이유: ${stop}`)
if (!WRITE) console.log('저장하려면 --write')
