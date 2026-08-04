// 세트 목록 썸네일로 "실제 박스(팩) 상품 사진"을 붙인다.
// 스니덩크(일본 마켓)에서 세트 일본어 이름으로 검색해 박스 카테고리(6/26) 상품 이미지를 쓴다.
// 배경 제거된 깔끔한 webp라 썸네일로 딱 맞다. 북미판(en)은 스니덩크에 없어 건너뛴다(기존 로고 유지).
//
// ⚠️ 검색어는 반드시 일본어여야 한다. index.json의 name은 한글로 바뀌었으므로 그대로
//    넣으면 스니덩크가 0건을 준다(2026-08-05 확인: 일본판 6세트가 이래서 비어 있었고,
//    빈 자리는 화면에서 limitless 로고로 대체되는데 그게 그림이 아니라 "sv1S" 같은
//    세트코드 글자판이라 상점 표지가 까만 판때기로 나왔다).
//    아래 JP_NAME에 일본어 이름을 적어 두고, 없으면 그 세트는 건너뛴다.
// ⚠️ 검색 결과에는 다른 세트가 섞여 나온다("スカーレットex"를 찾으면 テラスタルフェス가
//    같이 온다). 반드시 상품 제목에 그 세트 이름이 들어 있는 것만 인정한다 —
//    엉뚱한 박스를 붙이느니 빈칸이 낫다.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 일본판 세트의 검색용 일본어 이름. 새 세트를 넣을 때 여기에도 한 줄 추가한다.
const JP_NAME = {
  'ja-SV1S': 'スカーレットex',
  'ja-SV1V': 'バイオレットex',
  'ja-SV2D': 'クレイバースト',
  'ja-SV2P': 'スノーハザード',
  'ja-SV3a': 'レイジングサーフ',
  'ja-SV10': 'ロケット団の栄光',
}

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
    const all = (d.search?.products?.length ? d.search.products : d.search?.rankingProducts ?? []).filter((p) => p.imageUrl)
    // ⚠️ 제목에 그 세트 이름이 실제로 든 것만 남긴다. 이 줄이 없으면 검색어와 상관없는
    //    인기 상품이 1등으로 와서 엉뚱한 박스가 붙는다.
    const prods = all.filter((p) => p.title.includes(name))
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
  const skipped = []
  for (const entry of targets) {
    // 일본판은 일본어 이름이 있어야 찾는다(한글로는 0건). 없으면 건너뛰고 끝에 알린다.
    const jp = JP_NAME[entry.slug]
    if (entry.ed === 'ja' && !jp) {
      skipped.push(`${entry.slug} ${entry.name}`)
      continue
    }
    const img = entry.ed === 'ja' ? await searchBox(jp) : await searchEnBox(entry.name)
    if (img) {
      entry.boxImg = img
      hit++
    }
    done++
    if (done % 20 === 0) console.log(`  ${done}/${targets.length} (박스사진 ${hit})`)
    await sleep(500)
  }
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`박스 사진 붙임: ${hit}/${done}`)
  // ⚠️ 건너뛴 것을 조용히 넘기면 "다 됐다"로 읽힌다. 반드시 목록으로 남긴다.
  if (skipped.length) {
    console.log(`\n일본어 이름이 없어 건너뛴 세트 ${skipped.length}개 — JP_NAME에 추가해야 합니다:`)
    for (const s of skipped) console.log(`  ${s}`)
  }
}

main()
