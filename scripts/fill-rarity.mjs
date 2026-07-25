// 카드 뽑기(PackSim)에 쓸 레어도를 public/sets/*.json에 채운다.
//
// 왜 따로 받아야 하나: TCGdex는 세트 목록 응답(/sets/<id>)에 레어도를 안 준다.
// 카드 상세(/cards/<세트>-<번호>)에만 rarity가 있어서 카드 한 장씩 받아야 한다.
// 뽑기는 레어도가 없으면 아예 못 돌리므로, 뽑기에 넣을 세트만 골라서 채운다.
//
// 실행: node scripts/fill-rarity.mjs [세트슬러그 ...]
//   인자를 안 주면 아래 PACKSIM_SETS(뽑기에 넣을 인기 세트)를 전부 채운다.
//   이미 r이 채워진 카드는 건너뛰므로 중간에 끊겨도 다시 돌리면 이어서 받는다.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SETS_DIR = path.resolve(process.cwd(), 'public/sets')

// 뽑기에 넣을 인기 세트. 일본판은 5장팩, 북미판은 10장팩이다.
export const PACKSIM_SETS = [
  // 일본판
  'ja-SV2a', 'ja-SV3', 'ja-SV4a', 'ja-SV6', 'ja-SV7', 'ja-SV8', 'ja-SV8a',
  'ja-SV9', 'ja-SV10', 'ja-SV11B', 'ja-SV11W', 'ja-M1L', 'ja-M1S', 'ja-M2a',
  'ja-M3', 'ja-M4', 'ja-M5',
  // 북미판
  'en-sv03', 'en-sv03.5', 'en-sv04.5', 'en-sv06', 'en-sv07', 'en-sv08',
  'en-sv08.5', 'en-sv09', 'en-sv10', 'en-me01',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchCard(ed, setId, localId) {
  const url = `https://api.tcgdex.net/v2/${ed}/cards/${setId}-${localId}`
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'pokegre' } })
      if (r.ok) return await r.json()
      if (r.status === 404) return null // 세트에 없는 번호(프로모 등)는 그냥 건너뛴다
    } catch {
      /* 재시도 */
    }
    await sleep(500 + i * 700)
  }
  return null
}

// 동시에 여러 장을 받되 한 번에 CONCURRENCY장만. 너무 몰아치면 TCGdex가 빈 응답을 준다.
const CONCURRENCY = 8
async function mapLimit(items, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

async function fillSet(slug) {
  const file = path.join(SETS_DIR, `${slug}.json`)
  const data = JSON.parse(await readFile(file, 'utf8'))
  const ed = data.ed ?? (slug.startsWith('ja') ? 'ja' : 'en')
  const setId = data.id ?? slug.replace(/^(ja|en)-/, '')
  const todo = (data.cards ?? []).filter((c) => c.n && !c.r)
  if (todo.length === 0) {
    console.log(`${slug}: 이미 다 채워짐 (${data.cards?.length ?? 0}장)`)
    return
  }
  let done = 0
  await mapLimit(todo, async (card) => {
    const d = await fetchCard(ed, setId, card.n)
    if (d?.rarity) card.r = d.rarity
    if (++done % 50 === 0) console.log(`  ${slug} ${done}/${todo.length}`)
  })
  const filled = data.cards.filter((c) => c.r).length
  await writeFile(file, JSON.stringify(data))
  console.log(`${slug}: ${filled}/${data.cards.length}장 레어도 채움`)
}

const args = process.argv.slice(2)
const targets = args.length ? args : PACKSIM_SETS
for (const slug of targets) {
  try {
    await fillSet(slug)
  } catch (e) {
    console.log(`${slug}: 실패 — ${e.message}`)
  }
}
console.log('끝')
