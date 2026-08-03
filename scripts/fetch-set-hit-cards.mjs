// 세트별 "힛카드"(값이 제일 높은 카드) 목록을 PPT에서 받아 파일로 저장한다.
//
// 왜 파일로 저장하나: 서버가 매일 받으면 366세트 × 200크레딧 ≈ 73,000이라 하루 예산
// 20,000을 훨씬 넘는다. 힛카드는 매일 바뀔 이유가 없으니 한 번 받아 두고 가끔 갱신한다.
//
// ⚠️ PPT는 값 순 정렬을 지원하지 않는다(sortBy를 넣으면 에러). 세트 전체를 받아
//    우리가 골라야 한다. 그래서 세트 하나에 카드 수만큼 크레딧이 든다.
// ⚠️ 한 번에 200행까지만 준다. 그보다 큰 세트는 offset으로 이어받는다.
//
// 예산: 쓴 크레딧을 직접 센다. 헤더(x-ratelimit-daily-remaining)가 안 올 수도 있어서
//       그것만 믿으면 안 된다. 상한에 닿거나 429·403을 만나면 그 자리에서 멈춘다.
//
// 쓰기: node scripts/fetch-set-hit-cards.mjs            (받아만 보고 저장 안 함)
//       node scripts/fetch-set-hit-cards.mjs --write    (저장)
//       node scripts/fetch-set-hit-cards.mjs --budget 5000 --write
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PPT_SET_NAMES } from '../src/lib/packSets.ts'
// PPT가 세트를 뭐라고 부르는지. packSets.ts에는 뽑기에 쓰는 23개만 있어서, 나머지는
// PPT의 /sets 목록(1크레딧)과 우리 세트 코드를 맞춰 따로 적어 뒀다.
// ⚠️ 2026-08-02에 여기를 안 보고 돌려서 이미 값이 있는 23개를 그대로 다시 받았다.
//    8,500크레딧을 헛썼다. 받기 전에 "이미 있는 것"을 반드시 빼야 한다.
import EXTRA_SET_NAMES from '../src/data/pptSetNames.json' with { type: 'json' }
import { assertFloor, noteLeft } from './ppt-floor.mjs'

const ROOT = process.cwd()
const OUT = path.resolve(ROOT, 'src/data/setHitCards.json')
const WRITE = process.argv.includes('--write')
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
// 내가 쓸 수 있는 최대 크레딧. 방문자 몫은 남긴다.
const BUDGET = argOf('--budget', 7000)
const TOP = argOf('--top', 8)
const PAGE = 200
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const key = (await readFile(path.resolve(ROOT, '.env'), 'utf8'))
  .split('\n')
  .find((l) => l.startsWith('POKEMON_PRICE_TRACKER_API_KEY='))
  ?.split('=')
  .slice(1)
  .join('=')
  .trim()
  .replace(/^["']|["']$/g, '')
if (!key) {
  console.log('PPT 키를 못 찾았다(.env)')
  process.exit(1)
}

let spent = 0
let stop = ''

// 한 번 부르고 쓴 크레딧을 센다. limit=N이 곧 N크레딧이다.
async function ask(url, cost) {
  // 크레딧 바닥선. 예산(--budget)과 별개로, 남은 양이 5,000 밑으로 갈 일은 아예 안 한다.
  if (!assertFloor(cost)) { stop = '크레딧 바닥선'; return null }
  spent += cost
  const r = await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${key}` } })
  const left = noteLeft(r.headers.get('x-ratelimit-daily-remaining'))
  if (r.status === 429 && Number.isFinite(left) && left > 2000) {
    // 하루치가 넉넉히 남았으면 분당 한도다. 한 번만 기다렸다 다시 해 본다.
    console.log(`    (분당 한도 — 70초 쉬고 다시)`)
    await sleep(70_000)
    const again = await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${key}` } })
    spent += cost
    if (again.ok) return { json: await again.json(), left: Number(again.headers.get('x-ratelimit-daily-remaining')) }
    stop = `${again.status} — 다시 해도 막힌다(남은 ${left})`
    return null
  }
  if (r.status === 429 || r.status === 403) {
    stop = `${r.status} — 한도에 걸렸다(남은 ${Number.isFinite(left) ? left : '?'})`
    return null
  }
  if (!r.ok) return null
  return { json: await r.json(), left }
}

const index = JSON.parse(await readFile(path.resolve(ROOT, 'public/sets/index.json'), 'utf8'))
let saved = {}
try {
  saved = JSON.parse(await readFile(OUT, 'utf8'))
} catch {
  /* 처음 만드는 것 */
}

// 최신 발매 순으로 돈다(사람들이 최신을 많이 찾는다). 이미 받아 둔 세트는 건너뛴다.
const NAMES = { ...PPT_SET_NAMES, ...EXTRA_SET_NAMES }
const targets = index
  .filter((s) => NAMES[s.slug] && !saved[s.slug])
  .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))

console.log(`PPT 이름을 아는 세트 ${Object.keys(NAMES).length}개 / 아직 안 받은 것 ${targets.length}개`)
console.log(`예산 ${BUDGET} 크레딧\n`)

for (const s of targets) {
  if (stop) break
  const total = s.count || PAGE
  const need = Math.ceil(total / PAGE) * PAGE
  if (spent + need > BUDGET) {
    stop = `예산에 닿았다(다음 세트에 ${need} 필요, 남은 ${BUDGET - spent})`
    break
  }
  const lang = s.ed === 'ja' ? 'japanese' : 'english'
  const setName = encodeURIComponent(NAMES[s.slug])
  const rows = []
  for (let offset = 0; offset < total + PAGE; offset += PAGE) {
    const got = await ask(
      `https://www.pokemonpricetracker.com/api/v2/cards?language=${lang}&setName=${setName}&limit=${PAGE}&offset=${offset}`,
      PAGE,
    )
    if (!got) break
    const data = got.json?.data ?? []
    rows.push(...data)
    if (data.length < PAGE) break
    await sleep(5000) // 분당 60번이라지만 limit=200은 더 무겁게 센다. 1.2초에선 429가 났다
  }
  if (stop) break
  // 이름 뒤에 "- 138/106"처럼 번호가 붙어 온다. 번호만 떼어 우리 세트 파일과 맞춘다.
  const cards = rows
    .map((c) => {
      const m = String(c.name ?? '').match(/-\s*([0-9A-Za-z/]+)\s*$/)
      const n = m ? m[1].split('/')[0] : null
      const usd = c?.prices?.market
      return n && typeof usd === 'number' && usd > 0 ? { n: n.padStart(3, '0'), usd: Math.round(usd * 100) / 100 } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.usd - a.usd)
  // 같은 번호가 여러 인쇄본으로 오면 제일 비싼 것 하나만
  const seen = new Set()
  const top = []
  for (const c of cards) {
    if (seen.has(c.n)) continue
    seen.add(c.n)
    top.push(c)
    if (top.length === TOP) break
  }
  if (top.length) {
    saved[s.slug] = { at: Date.now(), cards: top }
    console.log(`  ${s.slug.padEnd(12)} ${String(rows.length).padStart(4)}장 받음 → 상위 ${top.length}장 (최고 $${top[0].usd})  누적 ${spent}`)
  } else {
    console.log(`  ${s.slug.padEnd(12)} ${String(rows.length).padStart(4)}장 받았지만 값이 있는 카드가 없다  누적 ${spent}`)
  }
  // ⚠️ 세트 하나 받을 때마다 저장한다. 예전엔 다 끝나고 한 번만 썼는데, 80세트를
  //    받는 데 10분이 넘게 걸린다. 중간에 끊기면 그때까지 쓴 크레딧이 통째로 날아가고,
  //    다음에 돌리면 같은 세트를 처음부터 다시 받는다.
  if (WRITE) await writeFile(OUT, JSON.stringify(saved, null, 2))
  await sleep(5000)
}

if (WRITE) await writeFile(OUT, JSON.stringify(saved, null, 2))
console.log(`\n쓴 크레딧 ${spent} / 예산 ${BUDGET}`)
console.log(`받아 둔 세트 ${Object.keys(saved).length}개`)
if (stop) console.log(`멈춘 이유: ${stop}`)
if (!WRITE) console.log('\n저장하려면 --write')
