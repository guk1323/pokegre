// 아직 이미지가 없는 옛 일본판 세트(PCG·E·web 등)를 스니덩크 싱글카드 상품 사진으로 채운다.
// 스니덩크 상품명에는 세트코드+번호가 박혀 있어서([PCG9 014/068], [e1 101/128])
// 번호 매칭이 곧 검증이다 — 상품명이 그 카드라는 걸 스니덩크가 보증한다.
// PSA 감정품은 슬랩(케이스) 사진이라 제외하고 일반 카드 사진을 우선한다.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// TCGdex 세트 id → 스니덩크 상품명에 쓰는 세트코드(대소문자 무시)
const CODE = {
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

async function collect(setName, code) {
  // 세트 이름으로 검색해 상품명에서 [코드 번호/총수]를 뽑는다. 여러 페이지를 훑는다.
  const byNum = new Map()
  const re = new RegExp(`\\[${code.replace(/[-]/g, '\\-')}[ -]?0*(\\d+)\\s*/`, 'i')
  for (let page = 1; page <= 8; page++) {
    const d = await search(setName, page)
    await sleep(600)
    const prods = d?.search?.products ?? []
    if (!prods.length) break
    for (const p of prods) {
      if (!p.imageUrl) continue
      const m = p.title.match(re)
      if (!m) continue
      const num = Number(m[1])
      const graded = /PSA|BGS|ARS|鑑定/i.test(p.title)
      const cur = byNum.get(num)
      // 일반(비감정) 상품 사진을 우선. 이미 일반 사진이 있으면 유지.
      if (!cur || (cur.graded && !graded)) byNum.set(num, { url: p.imageUrl, graded })
    }
  }
  return byNum
}

async function main() {
  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
  let setsFilled = 0
  let cardsFilled = 0
  for (const s of index.filter((x) => x.ed === 'ja')) {
    const code = CODE[s.id]
    if (!code) continue
    const file = path.join(OUT, `${s.slug}.json`)
    const d = JSON.parse(await readFile(file, 'utf8'))
    const missing = d.cards.filter((c) => !c.img).length
    if (!missing) continue
    // 세트 이름 + 코드 검색을 합쳐 커버리지를 높인다
    const byNum = await collect(s.name, code)
    const more = await collect(code, code)
    for (const [k, v] of more) if (!byNum.has(k) || (byNum.get(k).graded && !v.graded)) byNum.set(k, v)
    let filled = 0
    for (const c of d.cards) {
      if (c.img) continue
      const n = parseInt(c.n, 10)
      if (Number.isFinite(n) && byNum.has(n)) {
        c.img = byNum.get(n).url
        filled++
      }
    }
    if (filled) {
      await writeFile(file, JSON.stringify(d))
      setsFilled++
      cardsFilled += filled
    }
    console.log(`${s.id}: ${filled}/${missing} 채움 (스니덩크 매칭 ${byNum.size}종)`)
  }
  console.log(`\n완료 — 세트 ${setsFilled}개, 카드 ${cardsFilled}장 채움`)
}

main()
