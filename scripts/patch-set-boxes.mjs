// 세트 목록 썸네일로 "실제 박스(팩) 상품 사진"을 붙인다.
// 스니덩크(일본 마켓)에서 세트 일본어 이름으로 검색해 박스 카테고리(6/26) 상품 이미지를 쓴다.
// 배경 제거된 깔끔한 webp라 썸네일로 딱 맞다. 북미판(en)은 스니덩크에 없어 건너뛴다(기존 로고 유지).
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function searchBox(name) {
  const params = new URLSearchParams({
    func: 'all',
    refId: 'search',
    keyword: name,
    sortKey: 'default',
    cardVersion: '2',
    brandIds: 'pokemon',
    perPage: '24',
    page: '1',
  })
  try {
    const r = await fetch(`https://snkrdunk.com/v3/search?${params.toString()}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' },
    })
    if (!r.ok) return ''
    const d = await r.json()
    const prods = (d.search?.products?.length ? d.search.products : d.search?.rankingProducts ?? []).filter((p) => p.imageUrl)
    if (!prods.length) return ''
    const boxes = prods.filter((p) => p.supershipLog?.categoryId === '6/26')
    // 우선순위: 박스(ボックス, 미개봉 아님) → 박스 아무거나 → 팩(パック) → 그냥 첫 상품(옛 세트는
    // 미개봉이 없어 싱글 카드라도 잡는다). 빈칸보다 실제 상품 사진이 낫다.
    const pick =
      boxes.find((p) => /ボックス/.test(p.title) && !/シュリンクなし/.test(p.title)) ||
      boxes.find((p) => /ボックス/.test(p.title)) ||
      boxes.sort((a, b) => (b.stockFromGeneralUsers ?? 0) - (a.stockFromGeneralUsers ?? 0))[0] ||
      prods.find((p) => /パック/.test(p.title)) ||
      prods[0]
    return pick?.imageUrl ?? ''
  } catch {
    return ''
  }
}

// 북미판: 스니덩크의 영어판(英語版) 박스 상품을 찾는다. 영어 세트명으로 검색하면
// 같은 이름의 일본판이 섞여 나올 수 있어서, 제목에 「英語版」이 있는 것만 인정한다.
async function searchEnBox(name) {
  const params = new URLSearchParams({
    func: 'all',
    refId: 'search',
    keyword: name,
    sortKey: 'default',
    cardVersion: '2',
    brandIds: 'pokemon',
    perPage: '24',
    page: '1',
  })
  try {
    const r = await fetch(`https://snkrdunk.com/v3/search?${params.toString()}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' },
    })
    if (!r.ok) return ''
    const d = await r.json()
    const prods = (d.search?.products?.length ? d.search.products : d.search?.rankingProducts ?? [])
      .filter((p) => p.imageUrl && p.supershipLog?.categoryId === '6/26' && /英語版/.test(p.title))
    if (!prods.length) return ''
    const pick =
      prods.find((p) => /ボックス|ディスプレイ/.test(p.title) && !/シュリンクなし/.test(p.title)) ||
      prods[0]
    return pick?.imageUrl ?? ''
  } catch {
    return ''
  }
}

async function main() {
  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
  let hit = 0
  let done = 0
  const targets = index.filter((x) => !x.boxImg)
  for (const entry of targets) {
    const img = entry.ed === 'ja' ? await searchBox(entry.name) : await searchEnBox(entry.name)
    entry.boxImg = img
    if (img) hit++
    done++
    if (done % 20 === 0) console.log(`  ${done}/${targets.length} (박스사진 ${hit})`)
    await sleep(500)
  }
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`박스 사진 붙임: ${hit}/${targets.length}`)
}

main()
