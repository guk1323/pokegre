// 작가별 카드 목록을 pokemontcg.io에서 긁어 public/artists/에 저장한다.
// 스니커덩크엔 일러스트레이터 정보가 없어서, 작가 정보가 있는 이 무료 DB(영어판 기준)로
// "이 작가가 그린 카드들"을 모은다. 카드 아트는 일본판도 같은 작가라, 클릭하면 우리
// 사이트에서 그 카드 이름으로 검색해 시세를 볼 수 있다.
//
// 1단계: 전체 카드를 훑어 작가명과 빈도를 모은다(작가 목록 API가 없어서 직접 집계).
// 2단계: 카드 많은 순(=유명·다작 순) 상위 TOP_N 작가의 카드를 받아 파일로 저장.
// API 키 없이 쓰면 레이트 리밋이 빡세서 실패하면 길게 쉬고 재시도한다. 일회성 스크립트다.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/artists')
const TOP_N = 80 // 유명·다작 순 상위 몇 명까지 넣을지
const MIN_CARDS = 12 // 이보다 적으면(일회성 참여) 목록에서 뺀다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// pokemontcg.io API 키(선택). .env에 POKEMONTCG_API_KEY=... 를 넣고
//   node --env-file-if-exists=.env scripts/gen-artists.mjs
// 로 실행하면 하루 한도가 20,000회로 늘고 훨씬 빨라진다. 없으면 키 없이(느리게) 돈다.
const API_KEY = process.env.POKEMONTCG_API_KEY || ''
const HEADERS = API_KEY ? { 'User-Agent': 'pokegre', 'X-Api-Key': API_KEY } : { 'User-Agent': 'pokegre' }
// 키가 있으면 한도가 넉넉하니 대기를 확 줄인다.
const PAGE_GAP = API_KEY ? 400 : 6500
const ARTIST_GAP = API_KEY ? 400 : 7000
console.log(API_KEY ? 'API 키 사용 — 빠른 모드' : 'API 키 없음 — 느린 모드(레이트 리밋 대비)')

// 자신 있는 일본 작가만 한글 병기. 나머지는 원문만 보여준다(어설픈 음역보다 낫다).
const KO = {
  'Mitsuhiro Arita': '아리타 미츠히로',
  'Ken Sugimori': '스기모리 켄',
  'Atsuko Nishida': '니시다 아츠코',
  'Kagemaru Himeno': '히메노 카게마루',
  'Masakazu Fukuda': '후쿠다 마사카즈',
  'Naoyo Kimura': '키무라 나오요',
  kawayoo: '카와요',
  'Hitoshi Ariga': '아리가 히토시',
  'Saya Tsuruta': '츠루타 사야',
  'Yuka Morii': '모리이 유카',
  'Souichirou Gunjima': '군지마 소이치로',
  'Akira Egawa': '에가와 아키라',
  'Ryota Murayama': '무라야마 료타',
  'Shinji Kanda': '칸다 신지',
  'Tomokazu Komiya': '코미야 토모카즈',
  'Aya Kusube': '쿠스베 아야',
  'Midori Harada': '하라다 미도리',
  'Kanako Eo': '에오 카나코',
  'Naoki Saito': '사이토 나오키',
  'Hideki Ishikawa': '이시카와 히데키',
  'Shin Nagasawa': '나가사와 신',
  'Sanosuke Sakuma': '사쿠마 사노스케',
  'Naoki Ohashi': '오하시 나오키',
  'Kouki Saitou': '사이토 코우키',
  'Motofumi Fujiwara': '후지와라 모토후미',
  'Sanryu': '산류',
  'Kyoko Umemoto': '우메모토 쿄코',
  'Ryuta Fuse': '후세 류타',
  'Yuu Nishida': '니시다 유우',
  'Tika Matsuno': '마츠노 티카',
}

// 유명 소개문(있으면 목록에 한 줄). 한 줄에 들어가게 짧게. 확실한 작가만.
const NOTE = {
  'Mitsuhiro Arita': '초판 리자몽을 그린 레전드',
  'Ken Sugimori': '포켓몬 디자인 총괄',
  'Atsuko Nishida': '피카츄를 디자인한 작가',
  'Naoki Saito': '릴리에·마리 등 고가 카드 일러스트',
  kawayoo: '유화 같은 질감의 디지털 화풍',
  '5ban Graphics': '기계·강철 카드 CG 명가',
  'Yuka Morii': '점토로 빚어 찍는 작가',
  'Kagemaru Himeno': 'e카드·DP 시대 대표 작가',
  'Hitoshi Ariga': '포켓몬 만화가 출신',
  'Masakazu Fukuda': '초창기부터 활동한 베테랑',
  'Midori Harada': '아름다운 풍경 일러스트',
  'Toyste Beach': '해외 출신 일러스트레이터',
  PLANETA: 'CG 일러스트 스튜디오',
  'PLANETA Mochizuki': 'CG 스튜디오 PLANETA',
  'PLANETA Tsuji': 'CG 스튜디오 PLANETA',
}

function slugify(en) {
  return en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function fetchJson(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS })
      const j = await r.json()
      if (Array.isArray(j.data)) return j
    } catch {
      // 재시도
    }
    await sleep(11000 + i * 6000)
  }
  return null
}

// 1단계: 전체 카드를 훑어 작가 빈도 집계
async function collectArtists() {
  const count = {}
  let page = 1
  for (;;) {
    const j = await fetchJson(`https://api.pokemontcg.io/v2/cards?pageSize=250&page=${page}&select=artist`)
    if (!j || j.data.length === 0) break
    for (const c of j.data) {
      const a = (c.artist || '').trim()
      if (a) count[a] = (count[a] || 0) + 1
    }
    process.stderr.write(`1단계 page ${page} · 누적 작가 ${Object.keys(count).length}\n`)
    if (j.data.length < 250) break
    page++
    await sleep(PAGE_GAP)
  }
  return count
}

// 2단계: 한 작가의 카드(최대 500장)
async function fetchArtistCards(en) {
  const q = encodeURIComponent(`artist:"${en}"`)
  const cards = []
  for (let page = 1; page <= 2; page++) {
    const j = await fetchJson(`https://api.pokemontcg.io/v2/cards?pageSize=250&page=${page}&orderBy=-set.releaseDate&q=${q}&select=name,number,images,set`)
    if (!j || j.data.length === 0) break
    for (const c of j.data) {
      const img = c.images?.small
      if (img) cards.push({ name: c.name, number: c.number ?? '', set: c.set?.name ?? '', img })
    }
    if (j.data.length < 250) break
    await sleep(PAGE_GAP)
  }
  return cards
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const count = await collectArtists()
  const ranked = Object.entries(count)
    .filter(([, n]) => n >= MIN_CARDS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
  console.log(`\n작가 후보 ${ranked.length}명 (카드 ${MIN_CARDS}장 이상, 상위 ${TOP_N}). 2단계 시작…`)

  const index = []
  for (const [en] of ranked) {
    process.stdout.write(`  ${en} ... `)
    const cards = await fetchArtistCards(en)
    if (cards.length === 0) {
      console.log('0장 — 건너뜀')
      await sleep(ARTIST_GAP)
      continue
    }
    const slug = slugify(en)
    const ko = KO[en] ?? ''
    const note = NOTE[en] ?? ''
    await writeFile(path.join(OUT, `${slug}.json`), JSON.stringify({ en, ko, note, cards }))
    index.push({ slug, ko, en, note, count: cards.length, cover: cards[0].img })
    console.log(`${cards.length}장`)
    await sleep(ARTIST_GAP)
  }
  index.sort((a, b) => b.count - a.count)
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`\n완료 — 작가 ${index.length}명`)
}

main()
