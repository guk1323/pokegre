// 스니덩크로 채운 카드 이미지 정리.
// 1) 같은 번호에 더 깨끗한 사진이 있으면 교체한다. 우선순위: 배경제거(upload_bg_removed)
//    일반 카드 > 배경제거 아닌 생사진 > 감정품(PSA 등, 케이스에 든 슬랩 사진) > 한국어판.
// 2) 세트 대표 카드(cover)도 깨끗한 소스 우선으로 다시 뽑는다:
//    비-스니덩크(공식 스캔) > 스니덩크 배경제거 > 아무거나.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TARGETS = {
  PCG1: 'PCG1', PCG2: 'PCG2', PCG3: 'PCG3', PCG4: 'PCG4', PCG5: 'PCG5',
  PCG6: 'PCG6', PCG7: 'PCG7', PCG8: 'PCG8', PCG9: 'PCG9',
  E1: 'e1', E3: 'e3', E4: 'e4', E5: 'e5',
  web1: 'web',
  'M-P': 'M-P',
}

async function search(keyword, page) {
  const p = new URLSearchParams({
    func: 'all', refId: 'search', keyword, sortKey: 'default',
    cardVersion: '2', brandIds: 'pokemon', perPage: '100', page: String(page),
  })
  try {
    const r = await fetch(`https://snkrdunk.com/v3/search?${p.toString()}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// 사진 품질 점수(낮을수록 좋음)
function score(p) {
  let s = 0
  if (!/upload_bg_removed/.test(p.imageUrl)) s += 2
  if (/PSA|BGS|ARS|鑑定/i.test(p.title)) s += 4
  if (/韓国語/.test(p.title)) s += 1
  return s
}

async function collect(keyword, res) {
  const byNum = new Map()
  for (let page = 1; page <= 8; page++) {
    const d = await search(keyword, page)
    await sleep(600)
    const prods = d?.search?.products ?? []
    if (!prods.length) break
    for (const p of prods) {
      if (!p.imageUrl) continue
      let num = null
      for (const re of res) {
        const m = p.title.match(re)
        if (m) { num = Number(m[1]); break }
      }
      if (num === null) continue
      const sc = score(p)
      const cur = byNum.get(num)
      if (!cur || sc < cur.sc) byNum.set(num, { url: p.imageUrl, sc })
    }
  }
  return byNum
}

async function main() {
  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))

  for (const s of index.filter((x) => x.ed === 'ja')) {
    const code = TARGETS[s.id]
    if (!code) continue
    const file = path.join(OUT, `${s.slug}.json`)
    const d = JSON.parse(await readFile(file, 'utf8'))
    const res =
      s.id === 'M-P'
        ? [/\[M-P[ -]?0*(\d+)\]/i, /\[0*(\d+)\/M-P\]/i]
        : [new RegExp(`\\[${code}[ -]?0*(\\d+)\\s*/`, 'i')]
    const byNum = await collect(s.name, res)
    const more = await collect(code, res)
    for (const [k, v] of more) if (!byNum.has(k) || v.sc < byNum.get(k).sc) byNum.set(k, v)
    let swapped = 0
    for (const c of d.cards) {
      const n = parseInt(c.n, 10)
      if (!Number.isFinite(n) || !byNum.has(n)) continue
      const best = byNum.get(n).url
      // 스니덩크 이미지만 교체 대상(공식 스캔은 건드리지 않음)
      if (c.img && !c.img.includes('snkrdunk')) continue
      if (c.img !== best) { c.img = best; swapped++ }
    }
    await writeFile(file, JSON.stringify(d))
    const clean = d.cards.filter((c) => c.img && c.img.includes('snkrdunk') && c.img.includes('upload_bg_removed')).length
    const dirty = d.cards.filter((c) => c.img && c.img.includes('snkrdunk') && !c.img.includes('upload_bg_removed')).length
    console.log(`${s.id}: ${swapped}장 교체 → 배경제거 ${clean} · 생사진 ${dirty}`)
  }

  // 커버 다시 뽑기(전 세트)
  let coverFixed = 0
  for (const s of index) {
    const f = JSON.parse(await readFile(path.join(OUT, `${s.slug}.json`), 'utf8'))
    const officialFirst = f.cards.find((c) => c.img && !c.img.includes('snkrdunk'))
    const bgRemoved = f.cards.find((c) => c.img && c.img.includes('upload_bg_removed'))
    const any = f.cards.find((c) => c.img)
    const cover = (officialFirst ?? bgRemoved ?? any)?.img ?? ''
    if (cover && cover !== s.cover) { s.cover = cover; coverFixed++ }
  }
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`\n커버 교체: ${coverFixed}개 세트`)
}

main()
