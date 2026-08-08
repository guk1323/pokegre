/**
 * 작가 자료(public/artists/*.json)의 카드가 **정말 그 세트에 있는 카드인지** 본다.
 *
 * 작가 화면은 "이 작가가 그린 카드"를 죽 보여준다. 한 장이라도 딴 카드가 끼면
 * 그 작가가 안 그린 카드를 그린 것처럼 보인다 — 화면만 봐서는 못 찾는다.
 *
 * **2026-08-08 결과: 깨끗하다.** 20,352장 중
 *   · 세트 슬러그가 없는 것 2장
 *   · 그 세트에 번호가 없는 것 98장 — 대개 대체 아트("143a") 등 우리가 안 가진 카드다
 *   · 이름이 다른 것 25장 — 전부 철자 차이다("Gliscor 4" ↔ "Gliscor E4")
 * 번호가 NaN이던 6장은 이름으로 진짜 번호를 찾아 고쳤다(en-xya 24a·28a…).
 * 원인은 merge-illustrators가 중복을 셀 때 번호를 Number()로 바꾼 것이다 —
 * "24a"와 "24b"가 둘 다 NaN이 되어 다른 카드가 같은 것으로 묶였다.
 *
 * 실행: node --experimental-strip-types scripts/check-artist-cards.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const 세트폴더 = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const 벗김 = (s: string) => String(s).replace(/[^A-Za-z0-9]/g, '').toLowerCase()

const 세트 = new Map<string, Map<string, string>>()
for (const f of readdirSync(세트폴더)) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'ko-index.json') continue
  const m = new Map<string, string>()
  for (const c of (JSON.parse(readFileSync(join(세트폴더, f), 'utf8')).cards ?? []) as { n?: string; name?: string }[])
    m.set(String(c.n).replace(/^0+(?=.)/, ''), String(c.name ?? ''))
  세트.set(f.replace('.json', ''), m)
}

let 총 = 0
const 문제: string[] = []
let 없는세트 = 0
let 없는번호 = 0
let 이름다름 = 0
let 나쁜번호 = 0
for (const f of readdirSync(join(ROOT, 'public/artists'))) {
  if (!f.endsWith('.json') || f === 'index.json' || f === '_counts.json') continue
  const j = JSON.parse(readFileSync(join(ROOT, 'public/artists', f), 'utf8')) as {
    cards?: { name?: string; number?: string; s?: string }[]
  }
  for (const c of j.cards ?? []) {
    총++
    const 번호 = String(c.number ?? '')
    if (!번호.trim() || 번호 === 'NaN' || 번호 === 'undefined') {
      나쁜번호++
      문제.push(`번호가 이상하다: ${f.replace('.json', '')} ${c.s} "${c.name}" → "${번호}"`)
      continue
    }
    const m = 세트.get(String(c.s ?? ''))
    if (!m) { 없는세트++; continue }
    const 이름 = m.get(번호.replace(/^0+(?=.)/, ''))
    if (이름 === undefined) { 없는번호++; continue }
    if (/^[A-Za-z]/.test(이름) && /^[A-Za-z]/.test(String(c.name ?? ''))) {
      const a = 벗김(이름)
      const b = 벗김(String(c.name))
      if (a !== b && !a.includes(b) && !b.includes(a)) 이름다름++
    }
  }
}
console.log(`작가 자료 카드 ${총.toLocaleString()}장`)
console.log(`  번호가 이상함 ${나쁜번호} · 세트 슬러그 없음 ${없는세트} · 그 세트에 번호 없음 ${없는번호} · 이름 다름 ${이름다름}`)
for (const x of 문제.slice(0, 20)) console.log('  ' + x)
