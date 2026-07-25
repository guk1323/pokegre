// 카드 뽑기(PackSim)용 일본판 세트 데이터를 만든다 → public/packsim/ja-<세트>.json
//
// 왜 TCGdex를 안 쓰나: TCGdex의 일본판은 시크릿(AR·SAR·SR·UR)의 레어도를 안 주고,
// 세트에 따라 시크릿 카드 자체가 빠져 있다(예: SV8 106장만 있고 실제는 138장).
// 뽑기는 시크릿이 없으면 재미가 없으므로, 세트 목록 한 페이지에 번호·이름·레어도가
// 다 들어 있는 limitless의 리스트 뷰에서 받는다(세트당 요청 1번).
//
// 실행: node scripts/gen-packsim.mjs [세트코드 ...]   예) node scripts/gen-packsim.mjs SV8 M3
//   인자를 안 주면 JP_SETS를 전부 받는다.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/packsim')

// 뽑기에 넣을 일본판 인기 세트(최신·인기 위주).
export const JP_SETS = [
  'SV2a', 'SV3', 'SV4a', 'SV6', 'SV7', 'SV8', 'SV8a', 'SV9', 'SV10',
  'SV11B', 'SV11W', 'M1L', 'M1S', 'M2a', 'M3', 'M4', 'M5',
]

// limitless 표기 → 우리 RARITY 키(PackSim.tsx). 일본판 SR(풀아트)를 'Ultra Rare',
// 금박 UR을 'Hyper rare'로 맞춘 건 기존 packsim 데이터와 같은 규칙이다.
const RARITY_MAP = {
  Common: 'Common',
  Uncommon: 'Uncommon',
  Rare: 'Rare',
  'Double Rare': 'Double rare',
  'Art Rare': 'Illustration rare',
  'Special Art Rare': 'Special illustration rare',
  'Secret Rare': 'Ultra Rare',
  'Ultra Rare': 'Hyper rare',
  'ACE SPEC Rare': 'ACE SPEC Rare',
  Promo: 'Rare',
}

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

async function fetchSet(code) {
  const url = `https://limitlesstcg.com/cards/jp/${code}?display=list`
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (r.ok) return await r.text()
    await new Promise((s) => setTimeout(s, 1500 + i * 1500))
  }
  return null
}

async function genSet(code) {
  const html = await fetchSet(code)
  if (!html) return console.log(`${code}: 받기 실패`)
  const name = strip(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? '').replace(/\s*–\s*Limitless$/, '')
  const cards = []
  for (const [, hover, body] of html.matchAll(/<tr data-hover="([^"]+)">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, cardName, , rarity] = td
    if (!n || !cardName) continue
    const r = RARITY_MAP[rarity]
    // 레어도를 모르는 카드는 넣지 않는다 — 뽑기 확률 계산이 어긋난다.
    if (!r) continue
    cards.push({ n: String(n).padStart(3, '0'), name: cardName, img: hover.replace('_XS.png', '_SM.png'), r })
  }
  if (cards.length === 0) return console.log(`${code}: 카드 0장 — 세트 코드 확인 필요`)
  await mkdir(OUT, { recursive: true })
  await writeFile(path.join(OUT, `ja-${code}.json`), JSON.stringify({ ed: 'ja', id: code, name, cards }))
  const byR = cards.reduce((a, c) => ((a[c.r] = (a[c.r] ?? 0) + 1), a), {})
  console.log(`ja-${code}: ${cards.length}장 — ${Object.entries(byR).map(([k, v]) => `${k} ${v}`).join(', ')}`)
}

const args = process.argv.slice(2)
for (const code of args.length ? args : JP_SETS) {
  await genSet(code)
  await new Promise((s) => setTimeout(s, 600))
}
console.log('끝')
