// 같은 세트의 힛카드를 두 기준으로 뽑아 나란히 비교한다.
//
//   왼쪽 = TCGplayer(미국 마켓가) — 지금 화면이 쓰는 값. /data/pack-prices.json.
//   오른쪽 = 스니커덩크(일본 실거래) — 그 자리에서 받아 온다.
//
// 왜 필요한가: 일본판 카드를 미국 마켓가로 줄 세우는 게 맞느냐를 눈으로 확인하려는 것이다.
// 스톰에메랄드에서는 제일 비싼 MUR이 미국에 낙찰가가 없어 1등이 통째로 빠졌다. 그건
// "값이 없는" 경우고, 이 스크립트는 "값은 둘 다 있는데 순위가 다른" 경우를 본다.
//
// 크레딧이 안 든다(스니커덩크는 무료, PPT는 이미 받아 둔 파일만 읽는다).
//
// 쓰기: node scripts/compare-hit-cards.mjs ja-M4
//       node scripts/compare-hit-cards.mjs ja-M4 ja-M3 ja-M2
// ⚠️ 번호를 Number()로 바꾸면 RC5·TG01이 NaN 한 칸에 뭉친다(src/lib/cardNo.ts).
import { 번호열쇠 } from '../src/lib/cardNo.ts';
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const HOST = 'https://snkrdunk.com'
const UA = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!slugs.length) {
  console.error('세트 슬러그를 주세요. 예: node scripts/compare-hit-cards.mjs ja-M4')
  process.exit(1)
}

// 값이 높게 나오는 등급만 본다(커먼까지 훑으면 시간만 걸린다).
const HIT_RARITY = new Set([
  'Double rare', 'Illustration rare', 'Ultra Rare',
  'Special illustration rare', 'Hyper rare', 'Mega Ultra Rare', 'Mega Hyper Rare', 'ACE SPEC Rare',
])

async function search(keyword) {
  const p = new URLSearchParams({ func:'all', refId:'search', keyword, sortKey:'default',
    cardVersion:'2', brandIds:'pokemon', perPage:'24', page:'1' })
  const r = await fetch(`${HOST}/v3/search?${p}`, { headers: UA })
  if (!r.ok) return []
  const d = await r.json()
  return (d.search?.products?.length ? d.search.products : (d.search?.rankingProducts ?? [])).filter((x) => x.link)
}

// 실거래 최근 5건의 중앙값. 1건만 쓰면 싸게 넘긴 한 건에 순위가 흔들린다.
async function tradedJpy(apparelId) {
  const a = await fetch(`${HOST}/v1/apparels/${apparelId}`, { headers: UA })
  if (!a.ok) return null
  const pid = (await a.json()).productCatalogId
  if (!pid) return null
  await sleep(350)
  const t = await fetch(`${HOST}/v3/products/${pid}/trading-history?range=all`, { headers: UA })
  if (!t.ok) return null
  const prices = ((await t.json()).trades ?? []).map((x) => Number(x.price))
    .filter((n) => Number.isFinite(n) && n > 0).slice(0, 5)
  if (!prices.length) return null
  prices.sort((x, y) => x - y)
  return prices[Math.floor(prices.length / 2)]
}

async function main() {
  const ppt = JSON.parse(await readFile('/tmp/pp_full.json', 'utf8').catch(() => '{}'))
  const fx = await fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY').then((r) => r.json()).catch(() => null)
  const usdJpy = fx?.rates?.JPY ?? 0
  if (!usdJpy) { console.error('환율을 못 받았습니다.'); process.exit(1) }

  for (const slug of slugs) {
    const set = JSON.parse(await readFile(path.resolve(ROOT, `public/sets/${slug}.json`), 'utf8'))
    const code = slug.replace(/^ja-/, '')
    const targets = (set.cards ?? []).filter((c) => HIT_RARITY.has(c.r))

    // ── 왼쪽: TCGplayer(이미 받아 둔 값)
    const pptPrices = ppt[slug]?.prices ?? {}
    const tcg = Object.entries(pptPrices)
      .filter(([n]) => !n.includes('~'))
      .map(([n, usd]) => ({ n: String(Number(n)), jpy: Math.round(Number(usd) * usdJpy) }))
      .filter((r) => r.jpy > 0)
      .sort((a, b) => b.jpy - a.jpy)

    // ── 오른쪽: 스니커덩크(실거래)
    const found = new Map()
    for (const kw of [set.name, code]) {
      if (!kw) continue
      for (const p of await search(kw)) {
        const m = p.title.match(new RegExp(`\\[${code}\\s+(\\d+)/`))
        if (m) found.set(String(Number(m[1])), p.link.match(/apparels\/(\d+)/)?.[1])
      }
      await sleep(600)
    }
    for (const c of targets) {
      const key = 번호열쇠(c.n)
      if (found.has(key)) continue
      for (const p of await search(c.name)) {
        const m = p.title.match(new RegExp(`\\[${code}\\s+(\\d+)/`))
        if (m && String(Number(m[1])) === key) { found.set(key, p.link.match(/apparels\/(\d+)/)?.[1]); break }
      }
      await sleep(600)
    }
    const sd = []
    for (const c of targets) {
      const id = found.get(번호열쇠(c.n))
      if (!id) continue
      const jpy = await tradedJpy(id)
      await sleep(600)
      if (jpy) sd.push({ n: 번호열쇠(c.n), jpy })
    }
    sd.sort((a, b) => b.jpy - a.jpy)

    // ── 나란히 찍기
    const nameOf = new Map((set.cards ?? []).map((c) => [번호열쇠(c.n), c.name]))
    const man = (jpy) => `${(jpy / 10000).toFixed(1)}만엔`
    console.log(`\n■ ${set.name ?? slug} (${slug})`)
    console.log(`  ${'순위'.padEnd(4)} ${'TCGplayer(미국)'.padEnd(30)} ${'스니커덩크(일본 실거래)'.padEnd(30)}`)
    const rows = Math.max(Math.min(tcg.length, 5), Math.min(sd.length, 5))
    for (let i = 0; i < rows; i++) {
      const a = tcg[i], b = sd[i]
      const L = a ? `${a.n}번 ${String(nameOf.get(a.n) ?? '').slice(0, 12)} ${man(a.jpy)}` : '—'
      const R = b ? `${b.n}번 ${String(nameOf.get(b.n) ?? '').slice(0, 12)} ${man(b.jpy)}` : '—'
      const same = a && b && a.n === b.n ? '  ' : '≠ '
      console.log(`  ${String(i + 1).padEnd(4)} ${L.padEnd(30)} ${same}${R}`)
    }
    const topSame = tcg[0] && sd[0] && tcg[0].n === sd[0].n
    const t5 = tcg.slice(0, 5).map((r) => r.n), s5 = sd.slice(0, 5).map((r) => r.n)
    const 겹침 = t5.filter((n) => s5.includes(n)).length
    console.log(`  → 1등 ${topSame ? '같음' : '다름'} · 상위 5장 중 ${겹침}장 겹침`)
  }
}

main()
