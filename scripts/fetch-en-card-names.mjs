// 일본판 카드의 "영문 카드명"을 PPT에서 받아 둔다.
//
// 왜 필요한가: 사용자는 한글로 검색하는데, 스니커덩크는 한글→일본어 사전이 촘촘하고
// eBay·TCGplayer는 한글→영어 사전이 성겨서 같은 검색어인데 화면마다 결과가 달랐다.
// PPT는 일본판 DB도 영문 카드명으로 색인해 두므로(setName에 세트 코드가 그대로 들어간다)
// 카드 번호로 우리 일본어 카드명과 짝지으면 "일본어 → 영문" 대응을 통째로 얻는다.
//
// 실행: node scripts/fetch-en-card-names.mjs [세트코드…]
//   결과: scripts/en-card-names.json  { "SV4K": { "063": "Defiance Vest", … }, … }
//   이미 받아 둔 세트는 건너뛴다(다시 받으려면 그 세트 항목을 지운다).
//
// ⚠️ PPT는 rate limit이 빡빡하다(연속 호출이면 429). 세트마다 쉬어 가며 받는다.
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'scripts/en-card-names.json')
const PAUSE_MS = 2500
const PAGE = 200
// 한 번 부를 때 limit만큼 크레딧이 나간다. 세트가 95장인데 200을 부르면 105를 버리는
// 셈이라, 세트 크기에 맞춰 받는다(일일 20,000이고 세트가 39개다).

const key = (readFileSync(join(ROOT, '.env'), 'utf8').match(/POKEMON_PRICE_TRACKER_API_KEY=(.+)/) ?? [])[1]
  ?.trim()
  .replace(/^["']|["']$/g, '')
if (!key) throw new Error('.env에 POKEMON_PRICE_TRACKER_API_KEY가 없다')

const idx = JSON.parse(readFileSync(join(ROOT, 'public/sets/index.json'), 'utf8'))
const want = process.argv.slice(2)
const sets = idx
  .filter((s) => s.slug.startsWith('ja-'))
  .filter((s) => (want.length ? want.includes(s.id) : (s.releaseDate ?? '') >= '2022'))
  .map((s) => ({ code: s.id, count: s.count ?? PAGE }))

// PPT가 우리와 다른 이름으로 갖고 있는 세트. 코드를 그대로 물으면 엉뚱한 세트가 온다
// (setName=MC로 물으면 2017년 'smC: Tapu Bulu-GX'가 온다). 우리 세트의 한글 이름을
// 보고 PPT 쪽 이름을 찾아 적어 둔다.
const SET_ALIAS = {
  MC: 'Start Deck 100 Battle Collection', // 스타트 덱 100 배틀컬렉션
  SVK: 'SV: Stellar Miracle Deck Build Box', // 덱 빌드 BOX 스텔라미라클
}

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// "Roaring Moon ex - 093/066"처럼 같은 이름을 구분하려고 번호를 덧붙여 준다. 사전에는
// 이름만 필요하므로 떼어 낸다.
const cleanName = (n) => String(n ?? '').replace(/\s*-\s*\d+[a-z]?\/\d+.*$/i, '').trim()

// ⚠️ 이 스크립트가 쓰는 크레딧은 사이트 방문자가 쓸 몫과 같은 통이다. 2026-07-27에
// 세트를 몰아 받다가 하루치(20,000)를 다 써서, 그날 밤 내내 eBay·TCGplayer 시세가
// "조회 한도 초과"로 안 나왔다. 방문자 몫을 남겨 두고 멈춘다.
const KEEP_FOR_VISITORS = 8000
let remaining = Infinity

for (const { code, count } of sets) {
  if (remaining < KEEP_FOR_VISITORS) {
    console.log(`\n남은 크레딧 ${remaining} — 방문자 몫(${KEEP_FOR_VISITORS})을 남기고 멈춘다.`)
    console.log('한국시간 오전 9시에 초기화되니 그 뒤에 다시 돌리면 이어받는다.')
    break
  }
  if (out[code]) {
    console.log(`  ${code} 건너뜀(이미 있음, ${Object.keys(out[code]).length}장)`)
    continue
  }
  const byNo = {}
  // 프로모·특전으로 실제 장수가 목록보다 많은 세트가 있어 조금 여유를 둔다.
  const page = Math.min(PAGE, Math.max(50, Math.ceil((count * 1.3) / 50) * 50))
  for (let offset = 0; ; offset += page) {
    const url = `https://www.pokemonpricetracker.com/api/v2/cards?language=japanese&setName=${encodeURIComponent(SET_ALIAS[code] ?? code)}&limit=${page}&offset=${offset}`
    // 429는 "잠깐 쉬라"는 뜻이다. 분당 한도(60요청)는 1분이면 풀리므로 몇 번 더 기다려
    // 본다. 예전엔 한 번만 재시도해서, 검증 작업으로 분당 한도를 쓴 직후에 돌리면
    // 세트 일곱 개가 통째로 빈손으로 끝났다.
    let r
    for (let tries = 0; ; tries++) {
      r = await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${key}` } })
      if (r.status !== 429 || tries >= 3) break
      const wait = (Number(r.headers.get('retry-after')) || 30) + 3
      console.log(`  ${code} 한도 — ${wait}초 쉬고 다시(${tries + 1}/3)`)
      await sleep(wait * 1000)
    }
    // 남은 크레딧은 헤더로만 알 수 있다. 다음 세트로 넘어갈지 여기서 판단한다.
    const left = Number(r.headers.get('x-ratelimit-daily-remaining'))
    if (Number.isFinite(left)) remaining = left
    if (!r.ok) {
      console.log(`  ${code} 실패 ${r.status}`)
      break
    }
    const j = await r.json()
    const rows = Array.isArray(j.data) ? j.data : []
    for (const c of rows) {
      // setName은 "SV4K: Ancient Roar" 꼴. setName=SV6으로 물으면 SV6a 같은 다른 세트도
      // 섞여 오므로(그대로 쓰면 번호가 통째로 어긋난다) 코드가 정확히 맞는 것만 받는다.
      // 세트 코드는 대소문자가 섞여 온다(우리 M1L ↔ PPT m1L). 별칭으로 부른 세트는
      // 코드가 아예 없으므로 이름 전체로 견준다.
      const want = SET_ALIAS[code] ?? code
      const full = String(c.setName ?? '')
      const same = SET_ALIAS[code]
        ? full.toLowerCase().startsWith(want.toLowerCase())
        : full.split(':')[0].trim().toLowerCase() === want.toLowerCase()
      if (full && !same) continue
      // cardNumber는 "063/066" 꼴. 우리 세트 JSON의 n은 "063"이라 앞쪽만 쓴다.
      const no = String(c.cardNumber ?? '').split('/')[0]
      const name = cleanName(c.name)
      if (no && name) byNo[no] = name
    }
    if (!j.metadata?.hasMore) break
    await sleep(PAUSE_MS)
  }
  // 빈 결과는 저장하지 않는다. 저장하면 다음 실행에서 "이미 있음"으로 건너뛰어 버린다.
  if (!Object.keys(byNo).length) {
    console.log(`  ${code} 0장 — 다음에 다시`)
    continue
  }
  out[code] = byNo
  console.log(`  ${code} ${Object.keys(byNo).length}장`)
  writeFileSync(OUT, JSON.stringify(out, null, 1))
  await sleep(PAUSE_MS)
}
console.log(`\n${Object.keys(out).length}개 세트 → scripts/en-card-names.json`)
