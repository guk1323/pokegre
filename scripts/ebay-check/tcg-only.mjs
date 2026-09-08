// 【TCGplayer 추이만 받기】 이베이 낙찰은 건드리지 않고 **그래프만** 채운다.
//
// 왜 따로 있나: 이베이는 하루 이틀 사이에 거의 안 바뀌는데(저쪽이 최근 1~2일 낙찰을
//   아직 안 갖고 있다) TCG 그래프만 묵는 일이 잦다. 그때 그래프만 받는 길이다.
//
// ⚠️⚠️ **장당 2크레딧이다 — 예전 주석의 「1크레딧」은 틀렸다**(2026-08-29 실측:
//    남은 크레딧을 세 번 재서 매번 정확히 2가 줄었다). 값은 **기본 1 + 히스토리 1**이다.
//    그래서 셈이 이렇게 뒤집힌다 — 2만 장 기준:
//      · 이베이와 **같이**(full-run + 히스토리) = 장당 3 → **6만**
//      · **따로** 두 번(이베이 2 + 여기 2)      = 장당 4 → **8만**
//    **둘 다 받을 거면 같이 받는 쪽이 싸다.** 이 길은 「그래프만 필요할 때」 쓰는 것이지
//    크레딧을 아끼려고 쪼개는 길이 아니다.
//
// ⚠️ **이베이 검수 파일(`/data/ebay-check`)은 한 글자도 안 건드린다.** 우리가 고쳐 놓은
//    판정 결과·가짜값 딱지가 그대로 살아 있어야 한다. 이 스크립트는 화면 저장소
//    (`/data/card-history`)의 `tcg` 칸만 갈아 끼운다.
// ⚠️ 이미 오늘 받은 카드는 건너뛴다 — 끊겨도 다시 켜면 이어서 한다.
//
// 쓰는 법: 개발 서버(localhost:5173)를 켜 둔 채
//   node scripts/ebay-check/tcg-only.mjs            아직 없는 것만
//   REFRESH=1 node scripts/ebay-check/tcg-only.mjs  묵은 것도 다시(기본 7일)
import { readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const 뿌리 = new URL('../..', import.meta.url).pathname
const 서버 = 'http://127.0.0.1:5173/api/local/tcg-history'
const 로그파일 = path.join(뿌리, 'data', 'tcg-only.log')
const 묵은날 = Number(process.env.DAYS || 7)

const 색인 = JSON.parse(readFileSync(path.join(뿌리, 'card-index.json'), 'utf8'))
const 등급들 = JSON.parse(readFileSync(path.join(뿌리, 'data', 'ebay-grades.json'), 'utf8'))

// 대상: 이베이 낙찰 자료가 있는 카드(= 우리가 시세를 매기는 카드)
const 값표 = new Map()
for (const [id, 칸들] of Object.entries(등급들)) {
  let m = 0
  for (const v of Object.values(칸들 ?? {})) {
    const x = Number(v?.med ?? v?.avg ?? 0)
    if (x > m) m = x
  }
  값표.set(id, m)
}

const 기록폴더 = path.join(뿌리, 'data', 'card-history')
const 있는파일 = new Set(existsSync(기록폴더) ? readdirSync(기록폴더).filter((f) => f.endsWith('.json')) : [])
const 이레전 = Date.now() - 묵은날 * 24 * 60 * 60 * 1000

const 대상 = []
for (const r of 색인.rows) {
  const id = String(r[7] ?? '')
  if (!id || !/^\d+$/.test(id)) continue
  if (!등급들[id]) continue // 이베이 자료 없는 카드는 그래프도 거의 없다
  const 판 = String(r[0]).startsWith('ja-') ? 'japanese' : 'english'
  // 이미 싱싱한 것은 건너뛴다
  if (있는파일.has(`${id}.json`)) {
    try {
      const j = JSON.parse(readFileSync(path.join(기록폴더, `${id}.json`), 'utf8'))
      const 점 = j?.tcg?.h ? Object.keys(j.tcg.h).length : 0
      if (점 > 0 && !process.env.REFRESH) continue
      if (점 > 0 && Number(j.at) > 이레전) continue
    } catch { /* 깨진 파일이면 그냥 받는다 */ }
  }
  대상.push({ id, 판, 값: 값표.get(id) ?? 0, 이름: String(r[2] ?? '') })
}
대상.sort((a, b) => b.값 - a.값) // 비싼 카드부터

const 적기 = (s) => { console.log(s); try { appendFileSync(로그파일, s + '\n') } catch {} }
적기(`[TCG 추이] 받을 카드 ${대상.length.toLocaleString()}장 · ${new Date().toISOString()}`)

const 쉼 = (ms) => new Promise((r) => setTimeout(r, ms))
let 함 = 0, 빔 = 0, 실패 = 0
const 줄 = [...대상]

// 분당 한도(500) 밑으로. 4장씩 나란히 · 한 장마다 조금 쉰다 = 초당 5장쯤.
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (줄.length) {
      const c = 줄.shift()
      if (!c) break
      let 됐나 = false
      for (let 판 = 0; 판 < 3 && !됐나; 판++) {
        try {
          const r = await fetch(서버, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: c.id, lang: c.판 }),
          })
          if (r.status === 429) { await 쉼(30_000); continue }
          if (!r.ok) { await 쉼(2_500); continue }
          const j = await r.json()
          if (j.점 > 0) 함++; else 빔++
          됐나 = true
        } catch { await 쉼(2_500) }
      }
      if (!됐나) 실패++
      if ((함 + 빔 + 실패) % 1000 === 0) 적기(`  …${(함 + 빔 + 실패).toLocaleString()}장 (채움 ${함.toLocaleString()} · 빔 ${빔.toLocaleString()} · 실패 ${실패})`)
      await 쉼(180)
    }
  }),
)
적기(`[TCG 추이 끝] 채움 ${함.toLocaleString()} · 그래프 없음 ${빔.toLocaleString()} · 실패 ${실패} · ${new Date().toISOString()}`)
