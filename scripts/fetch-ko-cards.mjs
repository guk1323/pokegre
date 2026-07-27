// 포켓몬코리아 공식 카드검색에서 한글판 카드 이름·번호·이미지 주소를 받아 둔다.
//
// 왜 필요한가: 우리 카탈로그(public/sets)는 TCGdex 기반이라 일본판·북미판 이미지뿐이다.
// 한글판 이미지는 포켓몬코리아에만 있고, 주소 규칙이 정해져 있다:
//   https://cards.image.pokemonkorea.co.kr/data/wmimages/<시리즈>/<세트>/<세트>_<번호3자리>.png
// ⚠️ wmimages = 워터마크가 박힌 이미지다. 그게 공개된 형태라 그대로 쓴다.
//
// ⚠️ 번호를 그대로 믿으면 안 된다: 한국판은 서포트·굿즈 블록을 한글 가나다순으로 다시
// 매긴다. 예) M5 075는 일본판 カスミの元気, 한글판 글라디오의 결전(일본판 076).
// 그래서 이름까지 같이 받아 두고, 짝은 match-ko-cards.mjs가 이름으로 맞춘다.
//
// ⚠️ 목록 페이지의 GoodsName 필터는 GET으로 안 먹는다(무슨 세트를 넣어도 최신 세트만 준다).
// 대신 상세 주소가 "BS<연도><그 해 몇 번째 세트 3자리>" + "카드번호 3자리"로 이어져 있어,
// 각 접두사의 001번만 열어 보면 어느 세트인지 알 수 있다. 그렇게 훑어서 표를 만든다.
//
// 사용법:
//   node scripts/fetch-ko-cards.mjs --scan            접두사 → 세트코드 표 만들기
//   node scripts/fetch-ko-cards.mjs M5 M4 M3          세트코드로 받기
//   node scripts/fetch-ko-cards.mjs --all             표에 있는 세트 전부
//
// 받은 건 scripts/ko-cards/<세트코드>.json 에 쌓인다(한 번 받으면 다시 안 받는다).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT_DIR = path.resolve('scripts/ko-cards')
const UA = { 'User-Agent': 'Mozilla/5.0 (pokegre card-name sync)' }
// 공식 사이트에 부담을 주지 않으려고 한 장씩 쉬어 간다. 급하지 않은 작업이다.
const DELAY_MS = 250
const MISS_STOP = 6 // 이만큼 연속으로 없으면 그 세트는 끝난 것으로 본다

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) return null
  return res.text()
}

const MAP_FILE = path.join(OUT_DIR, '_prefixes.json')

// 접두사를 훑어 "BS2026004 = MEGA/M5" 같은 표를 만든다. 새 세트가 나오면 다시 돌리면 된다.
async function scan(fromYear = 2023, toYear = new Date().getFullYear()) {
  const found = {}
  for (let year = toYear; year >= fromYear; year--) {
    // 한 해에 20개를 넘는 경우는 아직 없었다. 연속으로 몇 번 비면 그 해는 끝난 것으로 본다.
    let miss = 0
    for (let i = 1; i <= 24 && miss < 4; i++) {
      const prefix = `BS${year}${String(i).padStart(3, '0')}`
      const html = await get(`https://pokemoncard.co.kr/cards/detail/${prefix}001`)
      const img = html?.match(/wmimages\/([^/]+)\/([^/]+)\//)
      if (!img) {
        miss++
      } else {
        miss = 0
        found[img[2]] = { prefix, series: img[1], code: img[2] }
        console.log(`  ${prefix} → ${img[1]}/${img[2]}`)
      }
      await sleep(DELAY_MS)
    }
  }
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(MAP_FILE, JSON.stringify(found, null, 1))
  console.log(`\n세트 ${Object.keys(found).length}개 → ${path.relative('.', MAP_FILE)}`)
  return found
}

async function loadMap() {
  const raw = await readFile(MAP_FILE, 'utf-8').catch(() => null)
  if (!raw) throw new Error('먼저 --scan 으로 접두사 표를 만드세요.')
  return JSON.parse(raw)
}

async function fetchCard(prefix, n) {
  const html = await get(`https://pokemoncard.co.kr/cards/detail/${prefix}${String(n).padStart(3, '0')}`)
  if (!html) return null
  const name = html.match(/card-hp title[^>]*>\s*([^<]+)/)
  const num = html.match(/class="p_num"[^>]*>\s*([^<]+)/)
  const img = html.match(/(https:\/\/cards\.image\.pokemonkorea\.co\.kr\/data\/wmimages\/[^"?]+)/)
  if (!name || !num) return null
  return {
    // 한글판 카드 번호(예: "075/081"에서 앞부분).
    n: num[1].trim().split('/')[0].trim(),
    name: name[1].trim(),
    img: img ? img[1] : '',
  }
}

async function fetchSet(info) {
  const file = path.join(OUT_DIR, `${info.code}.json`)
  const already = await readFile(file, 'utf-8').catch(() => null)
  if (already) {
    console.log(`  이미 있음 — ${info.code} (${JSON.parse(already).cards.length}장)`)
    return
  }

  const cards = []
  let miss = 0
  // 상한은 넉넉하게. 예전에 400으로 뒀다가 스타트덱(카드 774장)이 조용히 잘렸다.
  for (let i = 1; i <= 1200 && miss < MISS_STOP; i++) {
    const card = await fetchCard(info.prefix, i)
    if (!card) {
      miss++
    } else {
      miss = 0
      cards.push(card)
    }
    await sleep(DELAY_MS)
  }

  if (cards.length === 0) {
    console.log(`  건너뜀 — 카드를 못 받음: ${info.code}`)
    return
  }
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(file, JSON.stringify({ series: info.series, code: info.code, cards }, null, 1))
  console.log(`  받음 — ${info.code} ${cards.length}장 → ${path.relative('.', file)}`)
}

const args = process.argv.slice(2)

if (args[0] === '--scan') {
  await scan()
} else if (args[0] === '--all') {
  const map = await loadMap()
  for (const info of Object.values(map)) await fetchSet(info)
} else if (args.length) {
  const map = await loadMap()
  for (const code of args) {
    const info = map[code]
    if (!info) console.log(`  모르는 세트코드: ${code} (--scan 을 먼저 돌리세요)`)
    else await fetchSet(info)
  }
} else {
  console.log('사용법: node scripts/fetch-ko-cards.mjs --scan | --all | <세트코드…>')
}
