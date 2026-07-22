// 전체 카드(약 82페이지)를 끝까지 확실히 훑어 작가별 카드 수를 센다.
// 기존 생성 스크립트는 한 페이지라도 실패하면 그 자리에서 멈춰 뒤쪽 작가를 통째로
// 놓쳤다(신지 칸다 등). 여기서는 실패한 페이지를 여러 번 재시도하고, 끝까지 못 받은
// 페이지는 목록에 남겨 마지막에 알려준다(끊긴 채 조용히 넘어가지 않게).
// 결과(다음 생성 단계가 읽는다):
//   public/artists/_counts.json = { "이름": 카드수, ... }
//   public/artists/_eras.json   = { "이름": { min: 1999, max: 2022 }, ... }  활동 연도
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/artists/_counts.json')
const ERAS = path.resolve(process.cwd(), 'public/artists/_eras.json')
const KEY = process.env.POKEMONTCG_API_KEY || ''
const HEADERS = KEY ? { 'User-Agent': 'pokegre', 'X-Api-Key': KEY } : { 'User-Agent': 'pokegre' }
const PAGE_SIZE = 250
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPage(page, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(
        `https://api.pokemontcg.io/v2/cards?pageSize=${PAGE_SIZE}&page=${page}&select=artist,set`,
        { headers: HEADERS },
      )
      const j = await r.json()
      if (Array.isArray(j.data)) return j
    } catch {
      /* 재시도 */
    }
    await sleep(3000 + i * 3000)
  }
  return null
}

async function main() {
  // 총 페이지 수를 먼저 알아낸다.
  const head = await fetchPage(1)
  const total = head?.totalCount ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)
  console.log(`총 카드 ${total} · ${pages}페이지`)

  const count = {}
  const eras = {}
  const failed = []
  const tally = (data) => {
    for (const c of data) {
      const a = (c.artist || '').trim()
      if (!a) continue
      count[a] = (count[a] || 0) + 1
      const y = Number((c.set?.releaseDate || '').slice(0, 4))
      if (y) {
        const e = (eras[a] ??= { min: y, max: y })
        if (y < e.min) e.min = y
        if (y > e.max) e.max = y
      }
    }
  }
  tally(head.data)
  console.log(`page 1/${pages} · 작가 ${Object.keys(count).length}`)

  for (let page = 2; page <= pages; page++) {
    const j = await fetchPage(page)
    if (!j) {
      failed.push(page)
      console.log(`page ${page}/${pages} · 실패(건너뜀)`)
      continue
    }
    tally(j.data)
    console.log(`page ${page}/${pages} · 작가 ${Object.keys(count).length}`)
    await sleep(300)
  }

  writeFileSync(OUT, JSON.stringify(count))
  writeFileSync(ERAS, JSON.stringify(eras))
  const vals = Object.entries(count).sort((a, b) => b[1] - a[1])
  const ge = (n) => vals.filter(([, c]) => c >= n).length
  console.log(`\n완료 — 작가 ${vals.length}명 저장`)
  console.log(`5장+ ${ge(5)} · 8장+ ${ge(8)} · 10장+ ${ge(10)} · 12장+ ${ge(12)} · 20장+ ${ge(20)}`)
  console.log('신지 칸다:', count['Shinji Kanda'] ?? 0, '장')
  if (failed.length) console.log('※ 못 받은 페이지:', failed.join(', '))
}

main()
