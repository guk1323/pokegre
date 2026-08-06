// 작가별 목록의 카드를 **최신 발매 순**으로 다시 세운다.
//
// 왜: 500장에서 잘린 작가의 나머지를 받아 목록 끝에 이어 붙였더니(fill-artist-rest),
// 앞부분은 최신→옛날로 내려가다가 경계에서 다시 최신으로 튀어 오른다. 켄 스기모리는
// 11번째에서 2001년 → 2021년으로 튄다. 원본 순서 자체가 어긋난 작가도 있어 모두 19명이다
// (2026-08-07 발견).
//
// 규칙은 지금 목록이 이미 따르고 있는 것을 그대로 쓴다(3,983개 묶음 중 97%):
//   ① 발매일이 늦은 세트 먼저   ② 같은 세트 안에서는 번호가 큰 것 먼저(희귀 카드가 앞)
//
// ⚠️ 카드 내용은 하나도 건드리지 않는다. 자리만 바꾼다.
//
// 쓰는 법: npx tsx scripts/fix-artist-card-order.mts [--write]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 발매 = new Map(sidx.map((s) => [s.slug, String(s.releaseDate ?? '')]))

const 쪼개기 = (n: string) => {
  const m = String(n).match(/^([A-Za-z-]*)0*(\d+)([a-z]?)$/i)
  return m ? { 앞: m[1].toUpperCase(), 숫자: Number(m[2]), 뒤: m[3] } : null
}

let 고친작가 = 0
let 고친장수 = 0
for (const f of readdirSync(path.join(ROOT, 'public/artists'))) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'by-card.json') continue
  const p = path.join(ROOT, 'public/artists', f)
  const d = JSON.parse(readFileSync(p, 'utf-8')) as any
  const cs = d.cards ?? []
  if (cs.length < 2) continue
  const 원래 = cs.map((c: any, i: number) => ({ c, i }))
  const 새것 = [...원래].sort((a, b) => {
    const 날a = 발매.get(a.c.s) ?? ''
    const 날b = 발매.get(b.c.s) ?? ''
    // 발매일을 모르는 카드는 맨 뒤로.
    if (날a !== 날b) return (날b || '0').localeCompare(날a || '0')
    if (a.c.s !== b.c.s) return String(a.c.s).localeCompare(String(b.c.s))
    const A = 쪼개기(a.c.number)
    const B = 쪼개기(b.c.number)
    if (!A || !B || A.앞 !== B.앞) return String(b.c.number).localeCompare(String(a.c.number))
    return B.숫자 - A.숫자 || B.뒤.localeCompare(A.뒤) || a.i - b.i
  })
  if (!새것.some((x, i) => x.i !== i)) continue
  고친작가++
  고친장수 += cs.length
  d.cards = 새것.map((x) => x.c)
  if (WRITE) writeFileSync(p, JSON.stringify(d))
}
console.log(`\n  작가 ${고친작가}명 · 카드 ${고친장수.toLocaleString()}장${WRITE ? ' 다시 세워 저장했다' : ' (미리보기 — --write 로 저장)'}\n`)
