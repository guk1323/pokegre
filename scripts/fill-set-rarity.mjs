// 세트 카드에 레어도(r)를 채운다. limitless 목록 화면에 있는 값을 쓴다.
//
// 왜 필요한가: 세트 화면 위쪽의 "주요 카드" 여덟 장은 레어도가 높은 순으로 고른다
// (SetsView의 topCards). 레어도가 없으면 한 장도 못 골라 그 묶음이 통째로 안 나온다.
// 새로 붙인 82개 세트가 그랬다 — 이름·그림은 받았는데 레어도를 안 받았다.
//
// 표기는 TCGdex 것을 따른다(cardCatalog의 RARITY_ORDER가 그 표기를 본다).
// limitless 표기가 달라서 아래 표로 옮긴다.
//
// 쓰기: node scripts/fill-set-rarity.mjs           (몇 장 채워지는지만 보여줌)
//       node scripts/fill-set-rarity.mjs --write   (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// limitless 표기 → TCGdex 표기(우리 RARITY_ORDER가 아는 말).
// 82개 세트에 실제로 나오는 표기 16가지를 다 확인해 적었다(빠뜨리면 그 카드는
// 레어도 없이 남아 "주요 카드"에서 빠진다).
// ⚠️ 오른쪽은 우리 RARITY_ORDER(cardCatalog.ts)에 있는 말이어야 한다. 없는 말을 적으면
//    -1로 밀려 아무 효과가 없다.
const MAP = {
  Common: 'Common',
  Uncommon: 'Uncommon',
  Rare: 'Rare',
  'Holo Rare': 'Rare',
  'Character Holo Rare': 'Rare',
  'Double Rare': 'Double rare',
  'Triple Rare': 'Double rare',
  'ACE SPEC Rare': 'ACE SPEC Rare',
  'Radiant Rare': 'Shiny rare',
  'Shiny Rare': 'Shiny rare',
  'Shiny Ultra Rare': 'Shiny Ultra Rare',
  'Art Rare': 'Illustration rare',
  'Character Super Rare': 'Illustration rare',
  'Special Art Rare': 'Special illustration rare',
  'Amazing Rare': 'Ultra Rare',
  'Ultra Rare': 'Ultra Rare',
  'Secret Rare': 'Secret Rare',
  'Hyper Rare': 'Hyper rare',
}


// ⚠️ TCGdex 코드와 limitless 코드가 다른 세트가 있다. add-missing-sets.mjs와 같은 표다.
// 이게 없으면 13개가 "받기 실패"로 조용히 빠진다(2026-08-01에 실제로 그랬다).
const CODE_MAP = {
  XY8b: 'XY8r', XY8a: 'XY8b', XY11b: 'XY11r', XY11a: 'XY11b',
  XY5a: 'XY5g', XY5b: 'XY5t', sn10a: 'SM10a', sn11: 'SM11',
  XY1a: 'XY1x', XY1b: 'XY1y',
  'SM1+': 'SM1p', 'sm2+': 'SM2p', 'SM3+': 'SM3p', 'SM4+': 'SM4p', 'SM5+': 'SM5p',
}
const llCode = (id) => CODE_MAP[id] ?? id

// 북미판은 limitless가 완전히 다른 코드를 쓴다(우리 sv08 ↔ limitless SCR).
// 이름으로 맞추면 틀리기 쉬워서 발매일+장수로 하나로 좁혀지는 것만 적었다
// (scripts/en-limitless-map.json). 한 코드에 우리 세트가 둘 이상 붙는 것은 뺐다 —
// 본세트와 트레이너갤러리처럼 같은 날 나온 것들이라 섞이면 엉뚱한 카드가 들어간다.
import enMapRaw from './en-limitless-map.json' with { type: 'json' }
const EN_MAP = enMapRaw

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

// 카드 번호 → 레어도
function parseRarity(html) {
  const out = new Map()
  for (const [, body] of html.matchAll(/<tr data-hover="[^"]+">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, , , rarity] = td
    if (!n || !rarity) continue
    const mapped = MAP[rarity]
    if (mapped) out.set(String(n).padStart(3, '0'), mapped)
  }
  return out
}

const slugs = process.argv.filter((a) => a.startsWith('ja-') || a.startsWith('en-'))
if (!slugs.length) {
  console.log('세트 슬러그를 하나 이상 적어라 (예: node scripts/fill-set-rarity.mjs ja-S4a en-sv08 --write)')
  process.exit(1)
}

let filledTotal = 0
for (const slug of slugs) {
  const file = path.join(OUT, `${slug}.json`)
  let d
  try {
    d = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    console.log(`  ${slug}: 파일 없음`)
    continue
  }
  // 일본판은 /cards/jp/<코드>, 북미판은 /cards/<코드>다.
  const url =
    d.ed === 'en'
      ? EN_MAP[d.id] && `https://limitlesstcg.com/cards/${EN_MAP[d.id]}?display=list`
      : `https://limitlesstcg.com/cards/jp/${llCode(d.id)}?display=list`
  if (!url) {
    console.log(`  ${slug}: limitless 짝이 없어 건너뜀`)
    continue
  }
  const html = await get(url)
  if (!html) {
    console.log(`  ${slug}: 받기 실패`)
    continue
  }
  const rmap = parseRarity(html)
  let filled = 0
  for (const c of d.cards ?? []) {
    if (c.r) continue
    const r = rmap.get(c.n)
    if (r) {
      c.r = r
      filled++
    }
  }
  filledTotal += filled
  console.log(`  ${slug}: ${filled}/${(d.cards ?? []).length}장 채움`)
  if (WRITE && filled) await writeFile(file, JSON.stringify(d))
  await sleep(600)
}
console.log(`\n합계 ${filledTotal}장`)
if (!WRITE) console.log('저장하려면 --write')
