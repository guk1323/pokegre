// 그림이 빈 카드를 어디서 받을 수 있는지 출처별로 조사한다(전부 무료 확인).
//   ① TCGdex — 우리가 이미 쓰는 원본
//   ② limitless — 무료
//   ③ pokemontcg.io — 무료 키
import { readFileSync, readdirSync } from 'node:fs'
const KEY = readFileSync('.env', 'utf8').split('\n')
  .find((l) => l.startsWith('POKEMONTCG_API_KEY='))?.split('=')[1]?.trim().replace(/["']/g, '') ?? ''
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const usable = (u?: string) => !!u && !!u.trim()
const pad = (n: string) => String(n).padStart(3, '0')

type Row = { slug: string; id: string; name: string; blanks: { n: string; name: string }[] }
const rows: Row[] = []
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as {
    id: string; name: string; cards?: { n: string; name: string; img?: string }[]
  }
  const blanks = (d.cards ?? []).filter((c) => !usable(c.img)).map((c) => ({ n: c.n, name: c.name }))
  if (blanks.length) rows.push({ slug: f.replace('.json', ''), id: d.id, name: d.name, blanks })
}
rows.sort((a, b) => b.blanks.length - a.blanks.length)

const get = async (u: string, h: Record<string, string> = {}) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', ...h } })
      if (r.ok) return r
      if (r.status < 500) return null
    } catch { /* 재시도 */ }
    await sleep(800 + i * 800)
  }
  return null
}

console.log('| 세트 | 빈 카드 | TCGdex | limitless | pokemontcg.io |')
console.log('|---|---|---|---|---|')
for (const r of rows) {
  const want = new Set(r.blanks.map((b) => pad(b.n)))
  // ① TCGdex
  let a = 0
  const res = await get(`https://api.tcgdex.net/v2/${r.slug.startsWith('ja-') ? 'ja' : 'en'}/sets/${r.id}`)
  if (res) {
    const j = (await res.json()) as { cards?: { localId: string; image?: string }[] }
    for (const c of j.cards ?? []) if (c.image && want.has(pad(c.localId))) a++
  }
  await sleep(400)
  // ② limitless
  let b = 0
  const lang = r.slug.startsWith('ja-') ? 'jp/' : ''
  const lr = await get(`https://limitlesstcg.com/cards/${lang}${r.id}?display=list`)
  if (lr) {
    const html = await lr.text()
    for (const [, hover, body] of html.matchAll(/<tr data-hover="([^"]+)">(.*?)<\/tr>/gs)) {
      const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())
      if (hover && td[1] && want.has(pad(td[1]))) b++
    }
  }
  await sleep(400)
  // ③ pokemontcg.io
  let c = 0
  const pr = await get(`https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(r.id)}&pageSize=250`, { 'X-Api-Key': KEY })
  if (pr) {
    const j = (await pr.json()) as { data?: { number: string; images?: { large?: string } }[] }
    for (const x of j.data ?? []) if (x.images?.large && want.has(pad(x.number))) c++
  }
  await sleep(400)
  const mark = (n: number) => (n ? `**${n}장**` : '—')
  console.log(`| ${r.slug} (${r.name.slice(0, 22)}) | ${r.blanks.length} | ${mark(a)} | ${mark(b)} | ${mark(c)} |`)
}
