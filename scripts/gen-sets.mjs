// 세트(발매 패키지)별 수록 카드 목록을 TCGdex에서 긁어 public/sets/에 저장한다.
// 일본판(ja)·영문판(en) 둘 다. 카드 이름은 원어(일본어/영어)로 저장하고, 화면에서
// 우리 변환기로 한글화한다. 이미지는 {image}/low.webp를 붙여 쓴다.
// 결과: public/sets/index.json(세트 목록) + public/sets/<ed>-<id>.json(카드 목록)
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const EDITIONS = ['ja', 'en']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'pokegre' } })
      if (r.ok) return await r.json()
    } catch {
      /* 재시도 */
    }
    await sleep(2000 + i * 2000)
  }
  return null
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const index = []
  for (const ed of EDITIONS) {
    const list = await fetchJson(`https://api.tcgdex.net/v2/${ed}/sets`)
    if (!Array.isArray(list)) {
      console.log(`${ed}: 목록 실패`)
      continue
    }
    console.log(`${ed}: 세트 ${list.length}개`)
    let done = 0
    for (const s of list) {
      // TCGdex는 요청이 몰리면 cardCount는 주면서 cards는 빈 배열을 준다(throttle).
      // 카드가 있어야 정상인 세트인데 비어 오면 몇 번 더(천천히) 재시도한다.
      let d = null
      for (let attempt = 0; attempt < 2; attempt++) {
        d = await fetchJson(`https://api.tcgdex.net/v2/${ed}/sets/${s.id}`)
        const hasCards = d && Array.isArray(d.cards) && d.cards.length > 0
        const shouldHave = (d?.cardCount?.total ?? 0) > 0
        if (hasCards || !shouldHave) break // 채워졌거나, 원래 카드 없는 세트면 그만
        await sleep(2000 + attempt * 2000) // 비었으면 쉬었다 재시도
      }
      done++
      const rawCards = d && Array.isArray(d.cards) ? d.cards : []
      const cards = rawCards
        .map((c) => ({ n: c.localId ?? '', name: c.name ?? '', img: c.image ?? '' }))
        .filter((c) => c.name)
      const slug = `${ed}-${s.id}`
      // 카드가 있는 세트만 저장·수록한다. 배지 종수 = 실제 카드 수(전종=그리드).
      if (cards.length > 0) {
        await writeFile(path.join(OUT, `${slug}.json`), JSON.stringify({ ed, id: s.id, name: d.name, cards }))
        index.push({
          slug,
          ed,
          id: s.id,
          name: d.name,
          count: cards.length,
          releaseDate: d.releaseDate ?? '',
          serie: d.serie?.name ?? '',
          logo: s.logo ?? '',
          cover: cards[0]?.img ?? '',
        })
      }
      if (done % 30 === 0) console.log(`  ${ed} ${done}/${list.length} (수록 ${index.filter((x) => x.ed === ed).length})`)
      await sleep(300)
    }
  }
  // 최신 발매 순(발매일 내림차순). 발매일 없으면 뒤로.
  index.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`\n완료 — 세트 ${index.length}개 저장 (ja ${index.filter((x) => x.ed === 'ja').length} · en ${index.filter((x) => x.ed === 'en').length})`)
}

main()
