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
  // 2026-07-31 발매. 시크릿 레어 37장이 무료 소스 세 곳 모두에 아직 없다(2026-08-04).
  ['ja-M6', 'M6: Storm Emeralda'],
  ['en-2023sv', "McDonald's Promos 2023"],
  ['en-2024sv', "McDonald's Promos 2024"],
  ['en-tk-sm-l', 'SM Trainer Kit: Lycanroc & Alolan Raichu'],
  ['en-tk-sm-r', 'SM Trainer Kit: Alolan Sandslash & Alolan Ninetales'],
  ['en-mfb', 'My First Battle'],
  ['en-tk-xy-p', 'XY Trainer Kit: Pikachu Libre & Suicune'],
  ['en-tk-xy-su', 'XY Trainer Kit: Pikachu Libre & Suicune'],
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
const sameCard = (ours: string, theirs: string) =>
  norm(ours) === norm(theirs) ||
  (NAME_PAIRS[ours.trim()] !== undefined && norm(NAME_PAIRS[ours.trim()]) === norm(theirs)) ||
  normKo(koreanizeEnglishCardName(koreanizeTitle(ours))) === normKo(koreanizeEnglishCardName(theirs))
const stripNo = (s: string) => s.replace(/\s*-\s*[\dA-Za-z]+\/[\dA-Za-z]+\s*$/, '').trim()

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
  for (let p = 0; p < 3; p++) {
    if (spent + PAGE > BUDGET) break
    const list = await fetchPage(setName, p * PAGE, slug.startsWith('ja-') ? 'japanese' : 'english')
    if (list === null) break
    for (const c of list) {
      const num = String(c.cardNumber ?? '').split('/')[0].replace(/^0+/, '') || '0'
      const img = pickImg(c.imageCdnUrl)
      if (!num || !img) continue
      if (!src.has(num)) src.set(num, { name: stripNo(String(c.name ?? '')), img })
    }
    if (list.length < PAGE) break
    await sleep(5000)
  }

  let filled = 0
  let dead = 0
  const skipped: string[] = []
  for (const c of blanks) {
    const hit = src.get(String(Number(c.n)))
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
