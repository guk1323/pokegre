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

// 우리 세트 → PPT 세트 이름. PPT /sets 목록에서 확인한 정확한 이름이다(2026-08-03).
const PAIRS: [string, string][] = [
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

const PAGE = 200
let spent = 0
let stop = ''
// 이름 비교는 표기 차이를 지우고 한다("Mr. Mime" / "Mr Mime").
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const stripNo = (s: string) => s.replace(/\s*-\s*[\dA-Za-z]+\/[\dA-Za-z]+\s*$/, '').trim()

type Row = { cardNumber?: string; name?: string; imageCdnUrl?: unknown }

async function fetchPage(setName: string, offset: number): Promise<Row[] | null> {
  // 크레딧 바닥선(5,000). 예산과 별개로 여기를 넘어서는 절대 안 부른다.
  if (!assertFloor(PAGE)) return null
  spent += PAGE
  const u =
    `https://www.pokemonpricetracker.com/api/v2/cards?language=english` +
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
    const list = await fetchPage(setName, p * PAGE)
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
  const skipped: string[] = []
  for (const c of blanks) {
    const hit = src.get(String(Number(c.n)))
    if (!hit) continue
    if (norm(c.name) !== norm(hit.name)) {
      if (skipped.length < 3) skipped.push(`${c.n} ${c.name}≠${hit.name}`)
      continue
    }
    c.img = hit.img
    filled++
  }
  total += filled
  console.log(
    `  ${slug.padEnd(14)} PPT ${String(src.size).padStart(3)}장 · 빈칸 ${String(blanks.length).padStart(3)}장 중 ${String(filled).padStart(3)}장 채움  누적 ${spent}` +
      (skipped.length ? `\n      (이름이 달라 건너뜀: ${skipped.join(', ')})` : ''),
  )
  if (WRITE && filled) await writeFile(file, JSON.stringify(d))
  await sleep(5000)
}
console.log(`\n합계 ${total}장 · 쓴 크레딧 ${spent} / 예산 ${BUDGET}`)
if (stop) console.log(`멈춘 이유: ${stop}`)
if (!WRITE) console.log('저장하려면 --write')
