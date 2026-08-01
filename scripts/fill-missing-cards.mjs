// 세트 안에 빠져 있는 카드를 limitless에서 받아 채운다.
//
// 세트 파일에 카드가 다 안 들어 있는 경우가 있다 — 번호가 1~100인데 49장만 있는 식이다.
// 빠진 구간은 대개 뒤쪽 시크릿(SR·SAR·UR)이라, 값나가는 카드가 통째로 안 보인다.
// (원본 TCGdex가 그 구간을 안 주거나, 예전에 받을 때 없었던 것들이다.)
//
// ⚠️ 이미 있는 카드는 절대 건드리지 않는다. 번호가 없는 것만 새로 넣는다.
//
// 쓰기: node scripts/fill-missing-cards.mjs ja-SV5K            (몇 장 채워지는지만)
//       node scripts/fill-missing-cards.mjs ja-SV5K --write    (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// TCGdex 코드와 limitless 코드가 다른 세트. 다른 스크립트와 같은 표다.
const CODE_MAP = {
  XY8b: 'XY8r', XY8a: 'XY8b', XY11b: 'XY11r', XY11a: 'XY11b',
  XY5a: 'XY5g', XY5b: 'XY5t', sn10a: 'SM10a', sn11: 'SM11',
  XY1a: 'XY1x', XY1b: 'XY1y',
  'SM1+': 'SM1p', 'sm2+': 'SM2p', 'SM3+': 'SM3p', 'SM4+': 'SM4p', 'SM5+': 'SM5p',
}
const llCode = (id) => CODE_MAP[id] ?? id

const RARITY = {
  Common: 'Common', Uncommon: 'Uncommon', Rare: 'Rare',
  'Holo Rare': 'Rare', 'Character Holo Rare': 'Rare',
  'Double Rare': 'Double rare', 'Triple Rare': 'Double rare',
  'ACE SPEC Rare': 'ACE SPEC Rare',
  'Radiant Rare': 'Shiny rare', 'Shiny Rare': 'Shiny rare',
  'Shiny Ultra Rare': 'Shiny Ultra Rare',
  'Art Rare': 'Illustration rare', 'Character Super Rare': 'Illustration rare',
  'Special Art Rare': 'Special illustration rare',
  'Amazing Rare': 'Ultra Rare', 'Ultra Rare': 'Ultra Rare',
  'Secret Rare': 'Secret Rare', 'Hyper Rare': 'Hyper rare',
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (r.ok) return await r.text()
    } catch {
      /* 재시도 */
    }
    await sleep(1500 + i * 1500)
  }
  return null
}

for (const slug of process.argv.filter((a) => a.startsWith('ja-'))) {
  const file = path.join(OUT, `${slug}.json`)
  let d
  try {
    d = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    console.log(`  ${slug}: 파일 없음`)
    continue
  }
  const html = await get(`https://limitlesstcg.com/cards/jp/${llCode(d.id)}?display=list`)
  if (!html) {
    console.log(`  ${slug}: 받기 실패`)
    continue
  }
  const have = new Set((d.cards ?? []).map((c) => c.n))
  const add = []
  for (const [, hover, body] of html.matchAll(/<tr data-hover="([^"]+)">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, name, , rarity] = td
    if (!n || !name) continue
    const num = String(n).padStart(3, '0')
    if (have.has(num)) continue
    have.add(num)
    const card = { n: num, name, img: hover.replace('_XS.png', '_SM.png') }
    const r = RARITY[rarity]
    if (r) card.r = r
    add.push(card)
  }
  if (add.length) {
    d.cards = [...(d.cards ?? []), ...add].sort((a, b) => Number(a.n) - Number(b.n) || a.n.localeCompare(b.n))
    if (WRITE) await writeFile(file, JSON.stringify(d))
  }
  console.log(`  ${slug}: ${add.length}장 채움 → ${d.cards.length}장`)
  await sleep(600)
}
if (!WRITE) console.log('\n저장하려면 --write')
