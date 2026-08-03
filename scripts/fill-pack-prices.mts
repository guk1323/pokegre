// 앨범 시세(/data/pack-prices.json)에서 아직 비어 있는 세트를 직접 채운다.
//
// 왜 필요한가: 서버가 30분마다 두 개씩 알아서 채우지만, 방문자 몫(8,000)을 지키는
// 안전장치에 걸리면 그날은 더 안 받는다. 그래서 새로 넣은 팩의 시세가 며칠씩 비어
// 앨범에서 "시세 준비 중"만 뜨는 일이 생긴다. 급할 때 이걸로 바로 채운다.
//
// ⚠️ 서버(server/api.ts의 getSetPrices)와 **똑같은 규칙**으로 만들어야 한다. 모양이
//    다르면 서버가 못 읽거나 값이 틀린다. 아래 규칙은 그쪽에서 그대로 옮긴 것이다:
//      · PPT는 한 번에 200행까지 → offset으로 이어받는다
//      · 같은 번호가 여러 줄로 온다(기본판/마스터볼/포켓볼/리버스) → 기본판 우선,
//        변형판은 ~m ~p ~r 꼬리를 붙여 따로 담는다
//      · 번호 앞의 0은 뗀다(012 → 12)
//
// ⚠️ 예산을 반드시 지킨다. limit=200 한 번이 200크레딧이다. 넘길 것 같으면 그 세트를
//    통째로 건너뛴다(반만 받으면 앞번호가 빠진 채 굳는다).
//
// 쓰기: npx tsx scripts/fill-pack-prices.mts --budget 2500 <파일>            (받아만 봄)
//       npx tsx scripts/fill-pack-prices.mts --budget 2500 --write <파일>    (파일에 씀)
//   <파일>은 운영 서버에서 내려받은 pack-prices.json이다:
//       fly ssh console -a pokegre -C "cat /data/pack-prices.json" > pp.json
//   다 쓰고 나면 올리고 서버를 재시작해야 반영된다(서버가 메모리에 들고 있다).
import { readFile, writeFile } from 'node:fs/promises'
import { PPT_SET_NAMES } from '../src/lib/packSets.ts'

const argOf = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const BUDGET = argOf('--budget', 2000)
const WRITE = process.argv.includes('--write')
const FILE = process.argv.slice(2).find((a) => a.endsWith('.json') && !a.startsWith('--'))
if (!FILE) {
  console.log('pack-prices.json 경로를 적어 주세요.')
  process.exit(1)
}

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stripZeros = (n: string) => n.replace(/^0+/, '') || '0'

let spent = 0
let stop = ''

type Row = { cardNumber?: string; name?: string; prices?: { market?: number } }

async function fetchPage(setName: string, lang: string, offset: number): Promise<Row[] | null> {
  spent += PAGE
  const u =
    `https://www.pokemonpricetracker.com/api/v2/cards?language=${lang}` +
    `&setName=${encodeURIComponent(setName)}&limit=${PAGE}&offset=${offset}`
  const r = await fetch(u, { headers: { accept: 'application/json', authorization: `Bearer ${key}` } })
  const left = Number(r.headers.get('x-ratelimit-daily-remaining'))
  if (r.status === 429 || r.status === 403) {
    // ⚠️ 429는 두 가지다. 하루치가 남아 있으면 **분당 한도**(요청 60번)이므로 한 번은
    //    기다렸다 다시 해 본다 — 서버 미리받기와 부딪히면 흔히 난다.
    //    하루치가 바닥났거나 다시 해도 막히면 그 자리에서 통째로 멈춘다(키 정지 방지).
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

const store = JSON.parse(await readFile(FILE, 'utf8').then((s) => s.slice(s.indexOf('{')))) as Record<
  string,
  { at: number; prices?: Record<string, number>; names?: Record<string, string>; partial?: boolean; triedAt?: number }
>

const targets = Object.keys(PPT_SET_NAMES).filter(
  (s) => !Object.keys(store[s]?.prices ?? {}).length,
)
console.log(`시세가 빈 세트 ${targets.length}개 · 예산 ${BUDGET.toLocaleString()} 크레딧\n`)

for (const slug of targets) {
  if (stop) break
  if (spent + PAGE > BUDGET) {
    stop = `예산에 닿았습니다(다음 세트에 ${PAGE} 필요, 남은 ${BUDGET - spent})`
    break
  }
  const lang = slug.startsWith('ja-') ? 'japanese' : 'english'
  const setName = PPT_SET_NAMES[slug]
  const prices: Record<string, number> = {}
  const names: Record<string, string> = {}
  const basePriced = new Set<string>()
  let complete = false
  let rows = 0

  for (let p = 0; p < 5; p++) {
    if (spent + PAGE > BUDGET) break
    const list = await fetchPage(setName, lang, p * PAGE)
    if (list === null) break
    rows += list.length
    for (const c of list) {
      const rawNum = String(c.cardNumber ?? '') || (String(c.name ?? '').match(/ (\d+)\/\d+$/)?.[1] ?? '')
      const num = stripZeros(rawNum.split('/')[0])
      const market = c.prices?.market ?? 0
      if (!num || market <= 0) continue
      const nm = String(c.name ?? '')
      const isBase = !nm.includes('(')
      if (nm && (isBase || !names[num])) names[num] = nm.replace(/\s*-\s*\d+\/\d+\s*$/, '').trim()
      if (isBase) {
        prices[num] = basePriced.has(num) ? Math.min(prices[num], market) : market
        basePriced.add(num)
      } else {
        const vk = nm.includes('Master Ball') ? '~m' : nm.includes('Poke Ball') ? '~p' : nm.includes('Reverse') ? '~r' : null
        if (vk) prices[num + vk] = Math.min(prices[num + vk] ?? Infinity, market)
        else if (!basePriced.has(num)) prices[num] = Math.min(prices[num] ?? Infinity, market)
      }
    }
    if (list.length < PAGE) {
      complete = true
      break
    }
    await sleep(5000)
  }

  const n = Object.keys(prices).length
  if (n) {
    store[slug] = {
      at: Date.now(),
      triedAt: Date.now(),
      prices,
      names,
      ...(complete ? {} : { partial: true }),
    }
    console.log(`  ${slug.padEnd(12)} ${String(rows).padStart(4)}행 → 시세 ${String(n).padStart(3)}개  누적 ${spent}`)
  } else {
    console.log(`  ${slug.padEnd(12)} 값이 있는 카드가 없습니다  누적 ${spent}`)
  }
  if (WRITE) await writeFile(FILE, JSON.stringify(store))
  await sleep(5000)
}

console.log(`\n쓴 크레딧 ${spent} / 예산 ${BUDGET}`)
console.log(`시세가 든 세트 ${Object.values(store).filter((v) => Object.keys(v.prices ?? {}).length).length}개`)
if (stop) console.log(`멈춘 이유: ${stop}`)
if (!WRITE) console.log('\n파일에 쓰려면 --write')
