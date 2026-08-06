// 작가별 카드 목록을 pokemontcg.io에서 긁어 public/artists/에 저장한다.
//
// ⚠️ 이걸 다시 돌렸으면 **반드시 `npx tsx scripts/fill-artist-slugs.mts --write`도
//    이어서 돌릴 것.** 여기서 받는 데이터에는 세트 슬러그가 없어서, 카드를 눌러도
//    그 한 장으로 좁히지 못하고 이름으로만 찾게 된다(2026-08-06).
// 스니커덩크엔 일러스트레이터 정보가 없어서, 작가 정보가 있는 이 무료 DB(영어판 기준)로
// "이 작가가 그린 카드들"을 모은다. 카드 아트는 일본판도 같은 작가라, 클릭하면 우리
// 사이트에서 그 카드 이름으로 검색해 시세를 볼 수 있다.
//
// 작가 명단·카드 수·활동 연도는 먼저 scripts/scan-artists.mjs가 전체 카드를 끝까지
// 훑어 _counts.json / _eras.json 에 저장해 둔 걸 읽는다(예전엔 여기서 직접 훑다가 중간에
// 멈춰 뒤쪽 작가를 놓쳤다). 이 스크립트는 그 명단에서 카드가 MIN_CARDS장 이상인 작가만
// 골라, 각자의 카드 목록을 받아 파일로 저장한다.
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/artists')
const MIN_CARDS = 1 // 있는 데이터는 다 넣는다(카드 1장짜리 게스트까지). 검색으로 찾으면 됨.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const API_KEY = process.env.POKEMONTCG_API_KEY || ''
const HEADERS = API_KEY ? { 'User-Agent': 'pokegre', 'X-Api-Key': API_KEY } : { 'User-Agent': 'pokegre' }
const GAP = API_KEY ? 350 : 7000
console.log(API_KEY ? 'API 키 사용 — 빠른 모드' : 'API 키 없음 — 느린 모드(레이트 리밋 대비)')

// 자신 있는 일본 작가만 한글 병기(성-이름 순). 나머지는 원문만. 한글 읽는 법은 카드를
// 다시 안 긁고도 나중에 index/파일에 덧입힐 수 있어서, 여기선 확실한 것만 둔다.
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
  'Shinji Kanda': '칸다 신지',
  'Akira Egawa': '에가와 아키라',
  'Ryota Murayama': '무라야마 료타',
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
  'Kyoko Umemoto': '우메모토 쿄코',
  'Ryuta Fuse': '후세 류타',
  'Yuu Nishida': '니시다 유우',
  'Tika Matsuno': '마츠노 티카',
}

// 유명 소개문(있으면 프로필에 한 줄). 짧게, 확실한 작가만.
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

function eraStr(e) {
  if (!e || !e.min) return ''
  return e.min === e.max ? `${e.min}` : `${e.min}~${e.max}`
}

async function fetchJson(url, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS })
      const j = await r.json()
      if (Array.isArray(j.data)) return j
    } catch {
      /* 재시도 */
    }
    await sleep(4000 + i * 4000)
  }
  return null
}

// 한 작가의 카드(최대 500장). 최신 발매 순으로 받는다.
async function fetchArtistCards(en) {
  const q = encodeURIComponent(`artist:"${en}"`)
  const cards = []
  for (let page = 1; page <= 2; page++) {
    const j = await fetchJson(
      `https://api.pokemontcg.io/v2/cards?pageSize=250&page=${page}&orderBy=-set.releaseDate&q=${q}&select=name,number,images,set,artist`,
    )
    if (!j || j.data.length === 0) break
    for (const c of j.data) {
      // artist:"nagano" 검색이 "Tsuyoshi Nagano"처럼 그 단어가 든 작가까지 잡아 오므로,
      // 작가명이 정확히 일치하는 카드만 남긴다(남의 카드 섞임 방지).
      if ((c.artist || '').trim() !== en) continue
      const img = c.images?.small
      if (img) cards.push({ name: c.name, number: c.number ?? '', set: c.set?.name ?? '', img })
    }
    if (j.data.length < 250) break
    await sleep(GAP)
  }
  return cards
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const counts = JSON.parse(await readFile(path.join(OUT, '_counts.json'), 'utf8'))
  const eras = JSON.parse(await readFile(path.join(OUT, '_eras.json'), 'utf8'))
  const ranked = Object.entries(counts)
    .filter(([, n]) => n >= MIN_CARDS)
    .sort((a, b) => b[1] - a[1])
  console.log(`작가 ${ranked.length}명(카드 ${MIN_CARDS}장 이상). 카드 목록 받는 중…`)

  const index = []
  let done = 0
  for (const [en] of ranked) {
    const cards = await fetchArtistCards(en)
    done++
    if (cards.length === 0) {
      console.log(`  (${done}/${ranked.length}) ${en} — 0장, 건너뜀`)
      await sleep(GAP)
      continue
    }
    const slug = slugify(en)
    const ko = KO[en] ?? ''
    const note = NOTE[en] ?? ''
    const era = eraStr(eras[en])
    // 카드 수는 전체 스캔에서 센 실제 총량을 쓴다(카드 목록은 최대 500장까지만 담지만,
    // "카드 N종"은 실제 수가 정확하다). 혹시 스캔에 없으면 받은 개수로 대체.
    const total = counts[en] ?? cards.length
    await writeFile(path.join(OUT, `${slug}.json`), JSON.stringify({ en, ko, note, era, count: total, cards }))
    index.push({ slug, ko, en, note, era, count: total, cover: cards[0].img })
    if (done % 20 === 0) console.log(`  (${done}/${ranked.length}) …`)
    await sleep(GAP)
  }
  index.sort((a, b) => b.count - a.count)
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`\n완료 — 작가 ${index.length}명 저장`)
}

main()
