// TCGdex에 카드 이미지가 없는 일본판 세트를 LimitlessTCG로 채운다.
// 세트 페이지(limitlesstcg.com/cards/jp/<id>) HTML에 카드별 이미지 CDN 주소가
// 전부 박혀 있어서(…/tpc/M5/M5_1_R_JP_SM.png), 페이지 한 장만 읽으면 그 세트의
// 정확한 이미지 주소를 다 얻는다. 카드 번호로 TCGdex 목록과 맞춘다.
// 이미 이미지가 있는 카드는 건드리지 않는다.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')

// 기본 에너지 카드는 번호가 숫자가 아니라 문자다(우리 데이터는 GRA·FIR…, Limitless는
// G·R…). 표준 타입 약자라 표로 이어 준다. 이게 없으면 세트마다 에너지 8장이 빈칸으로
// 남는다(스타트 덱 100이 그랬다).
const ENERGY_CODE = {
  GRA: 'G', // 풀
  FIR: 'R', // 불꽃
  WAT: 'W', // 물
  LIG: 'L', // 번개
  PSY: 'P', // 초
  FIG: 'F', // 투
  DAR: 'D', // 악
  MET: 'M', // 강철
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchLimitlessImages(setId) {
  try {
    const r = await fetch(`https://limitlesstcg.com/cards/jp/${setId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' },
    })
    if (!r.ok) return null
    const html = await r.text()
    // 예: limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/M5/M5_1_R_JP_SM.png
    // 번호는 숫자(1, 23…)거나 에너지 타입 문자(G, R, W…)다.
    const re = new RegExp(`limitlesstcg\\.nyc3[^"\\s)]+/tpc/${setId}/${setId}_([A-Za-z0-9]+)_[^"\\s)]+\\.png`, 'g')
    const map = new Map()
    let m
    while ((m = re.exec(html))) {
      const key = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1].toUpperCase()
      map.set(key, 'https://' + m[0])
    }
    return map.size ? map : null
  } catch {
    return null
  }
}

async function main() {
  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
  const ja = index.filter((x) => x.ed === 'ja')
  let setsFilled = 0
  let cardsFilled = 0
  const misses = []
  for (const s of ja) {
    const file = path.join(OUT, `${s.slug}.json`)
    const d = JSON.parse(await readFile(file, 'utf8'))
    const missing = d.cards.filter((c) => !c.img).length
    if (missing === 0) continue
    const map = await fetchLimitlessImages(s.id)
    await sleep(700)
    if (!map) {
      misses.push(`${s.id}(${missing})`)
      continue
    }
    let filled = 0
    for (const c of d.cards) {
      if (c.img) continue
      const n = parseInt(c.n, 10)
      // 숫자 번호면 그대로, 아니면 에너지 약자로 바꿔 찾는다.
      const key = Number.isFinite(n) ? n : ENERGY_CODE[c.n?.toUpperCase()]
      if (key !== undefined && map.has(key)) {
        c.img = map.get(key)
        filled++
      }
    }
    if (filled > 0) {
      await writeFile(file, JSON.stringify(d))
      setsFilled++
      cardsFilled += filled
      console.log(`${s.id}: ${filled}/${missing} 채움`)
    } else {
      misses.push(`${s.id}(${missing})`)
    }
  }
  console.log(`\n완료 — 세트 ${setsFilled}개, 카드 ${cardsFilled}장 채움`)
  if (misses.length) console.log(`못 채운 세트: ${misses.join(' ')}`)
}

main()
