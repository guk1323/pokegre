// 【검수 전종 돌리기】 이베이 기록이 있는 카드 전부를 저쪽(PPT)에서 받아 규칙으로 검사한다.
//
// 쓰는 법: 개발 서버(localhost:5173)를 켜 둔 채  node scripts/ebay-check/full-run.mjs
//
// ⚠️ **포켓몬별로 돈다**(사장님 지시 2026-08-20: 「리자몽 → 피카츄 → 팬텀 이런 식으로,
//    중간에 끊겨도 보기 편하게」). 포켓몬 묶음을 값 높은 순으로 세우고, 묶음 안에서도 값 순.
// ⚠️ **이어하기**: 이미 검수 파일이 있는 카드는 건너뛴다 — 끊겨도 다시 켜면 이어서 한다.
// ⚠️ **막히면 2~3초 쉬고 재시도**(사장님 경험담 2026-08-20). 429는 30초 쉰다.
// ⚠️ 분당 500요청 한도 밑으로 가게 일부러 느리게 돈다(초당 5장쯤).

import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'

const 뿌리 = new URL('../..', import.meta.url).pathname
const 서버 = 'http://127.0.0.1:5173/api/local/ebay-check'
const 로그파일 = path.join(뿌리, 'data', 'ebay-check-fullrun.log')

const 등급들 = JSON.parse(readFileSync(path.join(뿌리, 'data', 'ebay-grades.json'), 'utf8'))
const 색인 = JSON.parse(readFileSync(path.join(뿌리, 'card-index.json'), 'utf8'))

// 카드값: 등급칸 중 제일 큰 중앙값(없으면 평균)
const 값표 = new Map()
for (const [id, 칸들] of Object.entries(등급들)) {
  let m = 0
  for (const v of Object.values(칸들 ?? {})) {
    const x = Number(v?.med ?? v?.avg ?? 0)
    if (x > m) m = x
  }
  값표.set(id, m)
}

// 포켓몬 기본 이름 — 수식어를 떼서 「리자몽 V (얼터네이트 풀아트)」도 「메가리자몽 X ex」도
// 다 「리자몽」 묶음으로 간다. 완벽할 필요는 없다 — 묶음이 틀려도 검사 자체는 똑같다.
const 뒤수식 = new Set(['V', 'VMAX', 'VSTAR', 'ex', 'EX', 'GX', 'BREAK', 'LV.X', 'Lv.X', 'X', 'Y', 'G', 'C', '☆', '스타', '프라임'])
function 기본이름(이름) {
  let s = String(이름 ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/^\S+의\s+/, '') // 「강연의 리자몽」 → 「리자몽」
  s = s.replace(/^(나쁜|빛나는|어둠의|원시|리버스)\s*/, '')
  s = s.replace(/^메가\s*/, '').replace(/^메가(?=\S)/, '') // 「메가리자몽」 붙은 꼴
  let t = s.split(' ').filter(Boolean)
  while (t.length > 1 && 뒤수식.has(t[t.length - 1])) t.pop()
  return t.join(' ') || String(이름 ?? '?')
}

// 대상: 이베이 기록이 있고 도감에 있는 카드. 포켓몬 묶음으로.
const 묶음들 = new Map() // 기본이름 → { 값: 최고값, 카드들: [{id, 이름, 값}] }
let 대상수 = 0
for (const r of 색인.rows) {
  const id = r[7]
  // ⚠️ 곁 카드(~lang·~1st)는 건너뛴다 — 부모와 같은 저쪽 번호라 두 번 받게 된다(2026-08-22 재수집에서 발견).
  if (!id || String(id).includes('~') || !값표.has(String(id))) continue
  const v = 값표.get(String(id).split('~')[0]) ?? 0
  const 묶 = 기본이름(r[2])
  if (!묶음들.has(묶)) 묶음들.set(묶, { 값: 0, 카드들: [] })
  const g = 묶음들.get(묶)
  g.카드들.push({ id, 이름: r[2], 값: v })
  if (v > g.값) g.값 = v
  대상수++
}
const 차례 = [...묶음들.entries()].sort((a, b) => b[1].값 - a[1].값)
for (const [, g] of 차례) g.카드들.sort((a, b) => b.값 - a.값)

const 적기 = (줄) => {
  console.log(줄)
  try { appendFileSync(로그파일, 줄 + '\n') } catch { /* 로그 못 써도 계속 */ }
}
적기(`[전종 검사] 대상 ${대상수.toLocaleString()}장 · 포켓몬 ${차례.length}묶음 · ${new Date().toISOString()}`)

const 쉼 = (ms) => new Promise((r) => setTimeout(r, ms))
let 함 = 0, 건너뜀 = 0, 실패 = 0
const 실패목록 = []

async function 한장(id) {
  // ⚠️ REFRESH=1 이면 있는 카드도 다시 받는다(저쪽 것을 합치는 재수집 — 주 1회, 약 4만 크레딧).
  //    없으면 예전처럼 이어하기(있는 카드는 건너뜀).
  if (!process.env.REFRESH && existsSync(path.join(뿌리, 'data', 'ebay-check', `${id}.json`))) { 건너뜀++; return }
  for (let 시도 = 1; 시도 <= 4; 시도++) {
    try {
      const r = await fetch(서버, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (r.ok) { 함++; return }
      const 글 = await r.text()
      if (글.includes('429')) { 적기(`  429 — 30초 쉼 (${id})`); await 쉼(30000); continue }
      if (r.status === 404) { 실패++; 실패목록.push(id + ':저쪽에없음'); return } // 저쪽에 없는 카드
      await 쉼(2500) // 사장님 경험담: 2~3초 쉬면 풀린다
    } catch {
      await 쉼(2500)
    }
  }
  실패++
  실패목록.push(id)
}

for (const [이름, g] of 차례) {
  const 시작함 = 함
  // 묶음 안에서 4장씩 나란히 — 분당 한도 밑으로 가게 한 장마다 조금 쉰다.
  const 줄 = [...g.카드들]
  const 일꾼 = Array.from({ length: 4 }, async () => {
    while (줄.length) {
      const c = 줄.shift()
      if (!c) break
      await 한장(String(c.id).split('~')[0])
      await 쉼(700)
    }
  })
  await Promise.all(일꾼)
  적기(`${이름} — ${g.카드들.length}장 (새로 ${함 - 시작함} · 누적 ${함}함/${건너뜀}건너뜀/${실패}실패)`)
}

적기(`[전종 검사 끝] 함 ${함} · 건너뜀 ${건너뜀} · 실패 ${실패} · ${new Date().toISOString()}`)
if (실패목록.length) 적기('실패 목록: ' + 실패목록.slice(0, 50).join(' '))
