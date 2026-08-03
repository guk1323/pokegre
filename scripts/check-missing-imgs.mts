// 그림이 빈 카드를 무료 출처 세 곳에서 다시 찾아본다. 크레딧을 한 푼도 안 쓴다.
//
// 왜 필요한가: 새로 나온 세트는 상위 등급(AR·SR·UR) 카드 그림이 며칠~몇 주 늦게
// 올라온다. 2026-08-03 기준 스톰에메랄드(7/31 발매)가 77번부터 37장이 비어 있었다.
// 한 번 "없다"고 확인하고 끝내면 영영 안 채워지므로, 주기적으로 다시 물어본다.
//
// 출처(전부 무료):
//   ① TCGdex        — 우리가 세트 데이터를 받아 오는 원본
//   ② limitless     — 발매 직후 제일 빨리 올라온다
//   ③ pokemontcg.io — 무료 키 사용. 500을 자주 내므로 재시도한다
//
// ⚠️ 번호와 이름이 둘 다 맞을 때만 채운다(리포 원칙: 틀린 것보다 빈칸).
// ⚠️ 스니커덩크 사진은 안 쓴다. 판매자가 찍은 실물이라 슬랩·손·책상이 같이 나온다.
//
// 쓰기: npx tsx scripts/check-missing-imgs.mts           (찾을 수 있는 게 있나만)
//       npx tsx scripts/check-missing-imgs.mts --write   (찾으면 바로 채운다)
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const usable = (u?: string) => !!u && !!u.trim()
const pad = (n: string) => String(n).padStart(3, '0')
// 이름 비교는 표기 차이를 지우고 한다("Mr. Mime" / "Mr Mime").
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-鿿]/g, '')
const unescapeHtml = (s: string) =>
  s.replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const strip = (s: string) => unescapeHtml(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

const KEY =
  (await readFile('.env', 'utf8')).split('\n').find((l) => l.startsWith('POKEMONTCG_API_KEY='))?.split('=')[1]?.trim().replace(/["']/g, '') ??
  ''

// ⚠️ pokemontcg.io도 limitless도 멀쩡한 요청에 5xx를 낸다. 한 번 실패했다고 포기하면
//    "없다"고 잘못 보고한다(2026-08-03에 실제로 세트 목록을 0개로 읽고 있었다).
async function get(u: string, h: Record<string, string> = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', ...h } })
      if (r.ok) return r
      if (r.status < 500) return null
    } catch {
      /* 재시도 */
    }
    await sleep(900 + i * 900)
  }
  return null
}

type Found = Map<string, { name: string; img: string }>

async function fromTcgdex(id: string, ja: boolean): Promise<Found> {
  const out: Found = new Map()
  const r = await get(`https://api.tcgdex.net/v2/${ja ? 'ja' : 'en'}/sets/${id}`)
  if (!r) return out
  const j = (await r.json()) as { cards?: { localId: string; name: string; image?: string }[] }
  for (const c of j.cards ?? []) if (c.image) out.set(pad(c.localId), { name: c.name, img: `${c.image}/high.webp` })
  return out
}

async function fromLimitless(id: string, ja: boolean): Promise<Found> {
  const out: Found = new Map()
  const r = await get(`https://limitlesstcg.com/cards/${ja ? 'jp/' : ''}${id}?display=list`)
  if (!r) return out
  const html = await r.text()
  for (const [, hover, body] of html.matchAll(/<tr data-hover="([^"]+)">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, name] = td
    if (!n || !name || !hover) continue
    out.set(pad(n), { name, img: hover.replace('_XS.png', '_SM.png') })
  }
  return out
}

async function fromPokemontcg(id: string): Promise<Found> {
  const out: Found = new Map()
  if (!KEY) return out
  const r = await get(`https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(id)}&pageSize=250`, { 'X-Api-Key': KEY })
  if (!r) return out
  const j = (await r.json()) as { data?: { number: string; name: string; images?: { large?: string } }[] }
  for (const c of j.data ?? []) if (c.images?.large) out.set(pad(c.number), { name: c.name, img: c.images.large })
  return out
}

const files = only.length
  ? only.map((s) => `${s}.json`)
  : (await readdir(OUT)).filter((f) => f.endsWith('.json') && f !== 'index.json')

let totalBlank = 0
let totalFound = 0
const lines: string[] = []
for (const f of files) {
  const slug = f.replace('.json', '')
  let d: { id: string; name: string; cards?: { n: string; name: string; img?: string }[] }
  try {
    d = JSON.parse(await readFile(path.join(OUT, f), 'utf8'))
  } catch {
    continue
  }
  const blanks = (d.cards ?? []).filter((c) => !usable(c.img))
  if (!blanks.length) continue
  totalBlank += blanks.length
  const ja = slug.startsWith('ja-')

  // 원본(TCGdex)을 먼저 본다 — 우리 데이터와 같은 곳이라 이름·번호가 제일 잘 맞는다.
  const srcs: [string, Found][] = [
    ['TCGdex', await fromTcgdex(d.id, ja)],
    ['limitless', await fromLimitless(d.id, ja)],
    ['pokemontcg', await fromPokemontcg(d.id)],
  ]
  await sleep(500)

  let filled = 0
  const used = new Set<string>()
  for (const c of blanks) {
    for (const [name, m] of srcs) {
      const hit = m.get(pad(c.n))
      if (!hit || norm(c.name) !== norm(hit.name)) continue
      c.img = hit.img
      filled++
      used.add(name)
      break
    }
  }
  totalFound += filled
  if (filled) {
    lines.push(`  ${slug.padEnd(15)} 빈칸 ${String(blanks.length).padStart(3)}장 중 ${String(filled).padStart(3)}장 찾음  (${[...used].join(', ')})`)
    if (WRITE) await writeFile(path.join(OUT, f), JSON.stringify(d))
  }
}

console.log(`그림이 빈 카드 ${totalBlank}장 · 이번에 찾은 것 ${totalFound}장\n`)
if (lines.length) lines.forEach((l) => console.log(l))
else console.log('  새로 찾은 그림이 없습니다. 원본에 아직 안 올라온 것들입니다.')
if (totalFound && !WRITE) console.log('\n저장하려면 --write')
if (totalFound && WRITE) console.log('\n저장했습니다. 표지도 다시 고르려면: npx tsx scripts/pick-set-covers.mts --write')
