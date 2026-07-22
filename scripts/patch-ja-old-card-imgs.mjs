// LimitlessTCG에도 없는 옛 일본판 세트(1996~2006: PMCG·neo·E·VS·web·PCG)의 카드
// 이미지를 jp.pokellector.com에서 채운다.
//
// 안전장치(핵심): 사이트마다 카드 번호 매기는 방식이 다를 수 있어서, 번호만 믿고
// 붙이면 엉뚱한 카드 사진이 붙는다. 그래서 pokemonNames.json(일↔영 이름 사전)으로
// "우리 n번 카드 이름"과 "포켈렉터 n번 카드 이름"을 대조해, 검증 가능한 카드의
// 90% 이상이 일치하는 세트만 번호로 채운다. 불일치 세트는 건너뛰고 보고한다.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' }

// TCGdex 세트 id → 포켈렉터 영어 세트명 후보(여러 개 적으면 순서대로 찾아본다)
// 주의: 포켈렉터에 PCG 시대(2004~06)·E1·E3~E5·web은 아예 없다(확인함). 넣어봐야 못 찾는다.
const SET_TITLES = {
  PMCG1: ['Expansion Pack'],
  PMCG2: ['Pokemon Jungle'],
  PMCG3: ['Mystery of the Fossils'],
  PMCG4: ['Rocket Gang'],
  PMCG5: ["Leader's Stadium"],
  PMCG6: ['Challenge from the Darkness'],
  neo1: ['Gold, Silver, to a New World'],
  neo2: ['Crossing the Ruins'],
  neo3: ['Awakening Legends'],
  neo4: ['Darkness and to Light'],
  E2: ['The Town on No Map'],
  VS1: ['Pokemon VS'],
  // 최신 세트의 시크릿 레어(공식 종수 뒤 번호)도 포켈렉터에는 있어서 마저 채운다.
  M5: ['Abyss Eye'],
  SM12a: ['Tag Team GX All Stars'],
  SM12: ['Alter Genesis'],
  SM11b: ['Dream League'],
  SM10: ['Double Blaze'],
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function fetchText(url) {
  try {
    const r = await fetch(url, { headers: UA })
    return r.ok ? await r.text() : ''
  } catch {
    return ''
  }
}

async function main() {
  // 일→영 포켓몬 이름 사전
  const names = JSON.parse(await readFile(path.resolve(process.cwd(), 'src/data/pokemonNames.json'), 'utf8'))
  const jaToEn = new Map(names.filter((n) => n.ja && n.en).map((n) => [n.ja, norm(n.en)]))

  // 포켈렉터 세트 목록: 슬러그 ↔ 영어 세트명
  const listHtml = await fetchText('https://jp.pokellector.com/sets')
  const slugByTitle = new Map()
  const re = /href="(\/[^"]+-Expansion\/)" title="([^"]+?)(?: Set)?"/g
  let m
  while ((m = re.exec(listHtml))) slugByTitle.set(norm(m[2]), m[1])
  console.log(`포켈렉터 세트 ${slugByTitle.size}개 파악`)

  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
  let setsFilled = 0
  let cardsFilled = 0
  const report = []

  for (const s of index.filter((x) => x.ed === 'ja')) {
    const file = path.join(OUT, `${s.slug}.json`)
    const d = JSON.parse(await readFile(file, 'utf8'))
    if (!d.cards.some((c) => !c.img)) continue
    const titles = SET_TITLES[s.id]
    if (!titles) {
      report.push(`${s.id}: 매핑 없음`)
      continue
    }
    const slug = titles.map((t) => slugByTitle.get(norm(t))).find(Boolean)
    if (!slug) {
      report.push(`${s.id}: 포켈렉터에서 못 찾음 (${titles[0]})`)
      continue
    }
    const html = await fetchText(`https://jp.pokellector.com${slug}`)
    await sleep(700)
    // 카드 이미지: den-cards.pokellector.com/<n>/<Name>.<CODE>.<num>[.<id>].thumb.png
    const cardRe = /https:\/\/den-cards\.pokellector\.com\/\d+\/([A-Za-z0-9-]+)\.[A-Z0-9]+\.(\d+)(?:\.\d+)?\.thumb\.png/g
    const byNum = new Map()
    while ((m = cardRe.exec(html))) {
      const num = Number(m[2])
      if (!byNum.has(num)) byNum.set(num, { name: norm(m[1]), url: m[0] })
    }
    if (!byNum.size) {
      report.push(`${s.id}: 페이지에 카드 이미지 없음`)
      continue
    }
    // 이름 대조 검증 — 사전으로 영어명을 알 수 있는 카드만 표본으로 쓴다.
    // "わるいリザードン"(Dark Charizard)나 "タケシのオニックス"(Brock's Onix)처럼
    // 수식어가 붙은 이름은 기본 이름을 부분 일치로 확인한다.
    let checked = 0
    let matched = 0
    for (const c of d.cards) {
      const n = parseInt(c.n, 10)
      if (!Number.isFinite(n) || !byNum.has(n)) continue
      const raw = c.name.trim()
      const pk = byNum.get(n).name
      // 후보: ① 이름 전체 사전 매칭 ② "~の" 뒤(소유 포켓몬) ③ 수식어 뗀 꼬리 ④ 이름 속 영문 단어
      const cands = []
      const exact = jaToEn.get(raw)
      if (exact) cands.push(exact)
      const afterNo = raw.split('の').pop().trim()
      const tail = jaToEn.get(afterNo)
      if (tail) cands.push(tail)
      for (const [ja, en] of jaToEn) if (ja.length >= 3 && raw.endsWith(ja)) cands.push(en)
      const latin = (raw.match(/[A-Za-z]{4,}/) || [])[0]
      if (latin) cands.push(norm(latin))
      if (!cands.length) continue
      checked++
      if (cands.some((en) => pk === en || pk.includes(en))) matched++
    }
    const rate = checked ? matched / checked : 0
    if (checked < 3 || rate < 0.9) {
      report.push(`${s.id}: 번호 불일치로 건너뜀 (표본 ${checked}장 중 ${matched}장 일치)`)
      continue
    }
    let filled = 0
    for (const c of d.cards) {
      if (c.img) continue
      const n = parseInt(c.n, 10)
      if (Number.isFinite(n) && byNum.has(n)) {
        c.img = byNum.get(n).url
        filled++
      }
    }
    await writeFile(file, JSON.stringify(d))
    setsFilled++
    cardsFilled += filled
    console.log(`${s.id}: ${filled}장 채움 (검증 ${matched}/${checked} 일치)`)
  }

  console.log(`\n완료 — 세트 ${setsFilled}개, 카드 ${cardsFilled}장 채움`)
  if (report.length) console.log('보고:\n  ' + report.join('\n  '))
}

main()
