// 일본판 세트의 힛카드를 스니커덩크 실거래가로 받는다.
//
// 왜 필요한가: 힛카드는 지금까지 PPT(미국 마켓) 시세로만 뽑았다. 그런데 일본판 신상은
// 일본에서 먼저·훨씬 많이 거래되므로, PPT에는 제일 비싼 카드의 실거래가 아직 없다.
// 실제로 스톰에메랄드(ja-M6)의 MUR 메가레쿠쟈(113/076)는 PPT에 낙찰가가 없어서
// 힛카드에서 통째로 빠졌고, 2등 카드가 1등처럼 보였다(2026-08-05 확인).
// 같은 카드가 스니커덩크에는 실거래 20건에 ￥205,000 안팎으로 쌓여 있었다.
//
// 크레딧이 안 든다(스니커덩크는 무료). 대신 카드마다 상품 조회 + 거래이력 조회가
// 필요해 시간이 걸린다. 그래서 세트 전체가 아니라 "힛카드가 될 만한 카드"만 본다 —
// 값이 높은 건 특별 등급(SR·SAR·UR·MUR 등)이라 뒷번호에 몰려 있다.
//
// ⚠️ 스니커덩크는 10분에 600번 제한이 있다(server/api.ts SNKRDUNK_RATE_LIMIT).
//    카드당 2번씩 부르므로 사이를 띄운다.
//
// 쓰기: node scripts/fetch-hit-cards-snkrdunk.mjs ja-M6          (받아만 보고 저장 안 함)
//       node scripts/fetch-hit-cards-snkrdunk.mjs ja-M6 --write  (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const OUT = path.resolve(ROOT, 'src/data/setHitCards.json')
const HOST = 'https://snkrdunk.com'
const UA = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const slug = process.argv[2]
const WRITE = process.argv.includes('--write')
if (!slug || !slug.startsWith('ja-')) {
  console.error('일본판 세트 슬러그를 주세요. 예: node scripts/fetch-hit-cards-snkrdunk.mjs ja-M6')
  process.exit(1)
}

// 값이 높은 카드는 특별 등급이다. 커먼·언커먼까지 훑으면 시간만 걸리고 힛카드에는
// 못 든다. 이 등급만 후보로 본다.
const HIT_RARITY = new Set([
  'Double rare',
  'Illustration rare',
  'Ultra Rare',
  'Special illustration rare',
  'Hyper rare',
  'Mega Ultra Rare',
  'Mega Hyper Rare',
  'ACE SPEC Rare',
])

async function search(keyword) {
  const params = new URLSearchParams({
    func: 'all', refId: 'search', keyword, sortKey: 'default',
    cardVersion: '2', brandIds: 'pokemon', perPage: '24', page: '1',
  })
  const r = await fetch(`${HOST}/v3/search?${params}`, { headers: UA })
  if (!r.ok) return []
  const d = await r.json()
  return (d.search?.products?.length ? d.search.products : (d.search?.rankingProducts ?? [])).filter((p) => p.link)
}

// 실거래가. 거래 이력의 최근 5건 중앙값을 쓴다 —
// ⚠️ 최근 1건만 쓰면 안 된다. 어쩌다 싸게 넘긴 한 건에 순위가 통째로 흔들린다.
//    반대로 전체 평균은 발매 직후 고가에 끌려간다. 최근 몇 건의 중앙값이 가장 안정적이다.
async function tradedPrice(apparelId) {
  const a = await fetch(`${HOST}/v1/apparels/${apparelId}`, { headers: UA })
  if (!a.ok) return null
  const pid = (await a.json()).productCatalogId
  if (!pid) return null
  await sleep(400)
  const t = await fetch(`${HOST}/v3/products/${pid}/trading-history?range=all`, { headers: UA })
  if (!t.ok) return null
  const trades = (await t.json()).trades ?? []
  const prices = trades.map((x) => Number(x.price)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 5)
  if (!prices.length) return null
  prices.sort((a2, b2) => a2 - b2)
  return { jpy: prices[Math.floor(prices.length / 2)], n: trades.length }
}

async function main() {
  const set = JSON.parse(await readFile(path.resolve(ROOT, `public/sets/${slug}.json`), 'utf8'))
  const code = slug.replace(/^ja-/, '')
  const targets = (set.cards ?? []).filter((c) => HIT_RARITY.has(c.r))
  console.log(`${slug} — 카드 ${set.cards.length}장 중 힛카드 후보 ${targets.length}장`)

  // 세트 이름으로 한 번 검색해 두면 그 세트 상품이 한꺼번에 온다. 카드마다 검색하는
  // 것보다 요청이 훨씬 적다.
  const found = new Map() // 카드번호 → { apparelId, title }
  for (const kw of [set.name, code]) {
    if (!kw) continue
    for (const p of await search(kw)) {
      const m = p.title.match(new RegExp(`\\[${code}\\s+(\\d+)/`))
      if (m) found.set(String(Number(m[1])), { id: p.link.match(/apparels\/(\d+)/)?.[1], title: p.title })
    }
    await sleep(700)
  }
  // 못 찾은 카드는 이름으로 한 장씩 찾는다.
  for (const c of targets) {
    const key = String(Number(c.n))
    if (found.has(key)) continue
    for (const p of await search(c.name)) {
      const m = p.title.match(new RegExp(`\\[${code}\\s+(\\d+)/`))
      if (m && String(Number(m[1])) === key) { found.set(key, { id: p.link.match(/apparels\/(\d+)/)?.[1], title: p.title }); break }
    }
    await sleep(700)
  }
  console.log(`  스니커덩크에서 찾은 카드: ${found.size}장`)

  const rows = []
  let i = 0
  for (const c of targets) {
    const key = String(Number(c.n))
    const hit = found.get(key)
    i++
    if (!hit?.id) continue
    const t = await tradedPrice(hit.id)
    await sleep(700)
    if (!t) continue
    rows.push({ n: c.n, jpy: t.jpy, trades: t.n, name: c.name, title: hit.title })
    if (i % 10 === 0) console.log(`  ${i}/${targets.length} 확인 중…`)
  }

  rows.sort((a, b) => b.jpy - a.jpy)
  console.log(`\n실거래가 있는 카드 ${rows.length}장 — 값 높은 순 상위 10장:`)
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${String(r.n).padStart(4)}번  ￥${r.jpy.toLocaleString().padStart(9)}  (거래 ${r.trades}건)  ${r.title.slice(0, 46)}`)
  }
  if (!WRITE) { console.log('\n--write 를 붙이면 저장합니다.'); return }

  // setHitCards.json은 usd 기준이다. 환율은 서버가 화면에서 원화로 바꿀 때 쓰는 것과
  // 같은 곳(유럽중앙은행)에서 받아 쓴다.
  const fx = await fetch('https://api.frankfurter.app/latest?from=USD&to=JPY').then((r) => r.json()).catch(() => null)
  const usdJpy = fx?.rates?.JPY
  if (!usdJpy) { console.error('환율을 못 받아 저장하지 않습니다.'); process.exit(1) }
  const file = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'))
  file[slug] = {
    at: Date.now(),
    src: 'snkrdunk',
    cards: rows.slice(0, 12).map((r) => ({ n: r.n, usd: Math.round((r.jpy / usdJpy) * 100) / 100 })),
  }
  await writeFile(OUT, JSON.stringify(file, null, 0))
  console.log(`\n저장했습니다: ${slug} 힛카드 ${Math.min(12, rows.length)}장 (환율 1달러=${usdJpy}엔)`)
}

main()
