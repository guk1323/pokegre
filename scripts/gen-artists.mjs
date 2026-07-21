// 작가별 카드 목록을 pokemontcg.io에서 한 번 긁어 public/artists/에 저장한다.
// 스니커덩크엔 일러스트레이터 정보가 없어서, 작가 정보가 있는 이 무료 DB(영어판 기준)로
// "이 작가가 그린 카드들"을 모은다. 카드 아트는 일본판과 같은 작가라 클릭하면 우리
// 사이트에서 그 카드 이름으로 검색해 일본판 시세를 볼 수 있다.
// API 키 없이 쓰면 레이트 리밋이 빡세서, 실패하면 길게 쉬고 재시도한다. 일회성 스크립트다.
// 새 카드가 나와 갱신하고 싶으면 다시 실행하면 된다("작가 데이터 갱신").
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// [영어 작가명(pokemontcg.io 표기), 한글 표시명, 한 줄 소개]
const ARTISTS = [
  ['Mitsuhiro Arita', '아리타 미츠히로', '초판 리자몽·기라 카드로 유명한 레전드'],
  ['Ken Sugimori', '스기모리 켄', '포켓몬 디자인 총괄'],
  ['Atsuko Nishida', '니시다 아츠코', '피카츄를 디자인한 일러스트레이터'],
  ['kawayoo', '카와요', 'GX·V 시대 인기 일러스트'],
  ['5ban Graphics', '5ban Graphics', 'EX·기계 카드 CG 명가'],
  ['Naoki Saito', '사이토 나오키', ''],
  ['Hitoshi Ariga', '아리가 히토시', ''],
  ['Saya Tsuruta', '츠루타 사야', ''],
  ['kirisAki', 'kirisAki', ''],
  ['Eske Yoshinob', 'Eske Yoshinob', ''],
  ['PLANETA Tsuji', 'PLANETA 츠지', ''],
  ['PLANETA Mochizuki', 'PLANETA 모치즈키', ''],
  ['Yuka Morii', '모리이 유카', '점토로 빚어 찍은 카드'],
  ['sowsow', 'sowsow', ''],
  ['Souichirou Gunjima', '군지마 소이치로', ''],
  ['Akira Egawa', '에가와 아키라', ''],
  ['Ryota Murayama', '무라야마 료타', ''],
  ['saccho', 'saccho', ''],
]

const OUT = path.resolve(process.cwd(), 'public/artists')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function slugify(en) {
  return en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function fetchJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'pokegre' } })
      const j = await r.json()
      // 레이트 리밋이면 data가 아예 없거나 count 0인데 실제로는 있을 수 있다. 200+data면 성공.
      if (Array.isArray(j.data)) return j
    } catch {
      // 아래에서 재시도
    }
    await sleep(12000 + i * 6000)
  }
  return null
}

async function fetchArtistCards(en) {
  const q = encodeURIComponent(`artist:"${en}"`)
  const cards = []
  for (let page = 1; page <= 2; page++) {
    const url = `https://api.pokemontcg.io/v2/cards?pageSize=250&page=${page}&orderBy=-set.releaseDate&q=${q}&select=name,number,images,set`
    const j = await fetchJson(url)
    if (!j || j.data.length === 0) break
    for (const c of j.data) {
      const img = c.images?.small
      if (!img) continue
      cards.push({ name: c.name, number: c.number ?? '', set: c.set?.name ?? '', img })
    }
    if (j.data.length < 250) break
    await sleep(9000)
  }
  return cards
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const index = []
  for (const [en, ko, note] of ARTISTS) {
    process.stdout.write(`긁는 중: ${ko} (${en}) ... `)
    const cards = await fetchArtistCards(en)
    if (cards.length === 0) {
      console.log('0장 — 건너뜀')
      await sleep(9000)
      continue
    }
    const slug = slugify(en)
    await writeFile(path.join(OUT, `${slug}.json`), JSON.stringify({ en, ko, note, cards }))
    index.push({ slug, ko, en, note, count: cards.length, cover: cards[0].img })
    console.log(`${cards.length}장 저장`)
    await sleep(9000)
  }
  index.sort((a, b) => b.count - a.count)
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`\n완료 — 작가 ${index.length}명, index.json 저장`)
}

main()
