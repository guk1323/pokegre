// 모든 작가에게 소개 한 줄을 채운다. 유명 작가는 손으로 쓴 소개(NOTE)를 유지하고,
// 나머지는 그 작가 카드가 걸쳐 있는 연도(활동 시기)를 데이터에서 뽑아 넣는다.
// 지어내지 않고 사실(발매 연도)만 쓴다. .env의 POKEMONTCG_API_KEY로 빠르게.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/artists')
const API_KEY = process.env.POKEMONTCG_API_KEY || ''
const HEADERS = API_KEY ? { 'User-Agent': 'pokegre', 'X-Api-Key': API_KEY } : { 'User-Agent': 'pokegre' }
const GAP = API_KEY ? 400 : 6500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 손으로 쓴 소개(확실한 작가만). 있으면 활동 시기 대신 이걸 쓴다.
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

async function fetchJson(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS })
      const j = await r.json()
      if (Array.isArray(j.data)) return j
    } catch {
      /* 재시도 */
    }
    await sleep(11000 + i * 6000)
  }
  return null
}

// 전체 카드를 한 번 훑어 작가별 최소/최대 발매 연도를 모은다.
async function collectYears() {
  const min = {}
  const max = {}
  let page = 1
  for (;;) {
    const j = await fetchJson(`https://api.pokemontcg.io/v2/cards?pageSize=250&page=${page}&select=artist,set`)
    if (!j || j.data.length === 0) break
    for (const c of j.data) {
      const a = (c.artist || '').trim()
      const d = c.set?.releaseDate // "YYYY/MM/DD"
      if (!a || !d) continue
      const y = Number(d.slice(0, 4))
      if (!y) continue
      if (min[a] === undefined || y < min[a]) min[a] = y
      if (max[a] === undefined || y > max[a]) max[a] = y
    }
    process.stderr.write(`page ${page}\n`)
    if (j.data.length < 250) break
    page++
    await sleep(GAP)
  }
  return { min, max }
}

function eraStr(en, min, max) {
  const lo = min[en]
  const hi = max[en]
  if (!lo) return ''
  return lo === hi ? `${lo}년` : `${lo}~${hi}`
}

async function main() {
  const { min, max } = await collectYears()
  const idx = JSON.parse(readFileSync(path.join(OUT, 'index.json'), 'utf8'))
  let withEra = 0
  for (const a of idx) {
    a.note = NOTE[a.en] ?? '' // 소개는 확실한 작가만(bio)
    a.era = eraStr(a.en, min, max) // 활동 시기는 전원
    if (a.era) withEra++
    const fp = path.join(OUT, `${a.slug}.json`)
    if (existsSync(fp)) {
      const d = JSON.parse(readFileSync(fp, 'utf8'))
      d.note = a.note
      d.era = a.era
      writeFileSync(fp, JSON.stringify(d))
    }
  }
  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(idx))
  console.log(`\n활동시기 채운 작가: ${withEra}/${idx.length}명`)
  idx.slice(0, 12).forEach((a) => console.log(`  ${a.en} — 소개:${a.note||'-'} / 활동:${a.era||'-'}`))
}

main()
