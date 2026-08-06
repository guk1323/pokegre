// 세트 카드를 **번호 순**으로 다시 줄 세운다.
//
// 왜: 프로모 세트는 번호가 "SM1"·"SM10"·"SM100" 꼴이라 글자로 견주면
// SM1 → SM10 → SM100 → SM101 … → SM11 순이 된다. SM11을 찾는 사람은 한참을 훑어야
// 한다(2026-08-07 발견, 세트 7개). 접두사가 같으면 **숫자로** 견줘야 한다.
//
// ⚠️ 접두사가 다르면 원래 순서를 지킨다 — 어느 쪽이 먼저인지 우리가 정할 일이 아니다.
// ⚠️ 돌린 뒤 카드 수가 그대로인지, 도감이 흔들리지 않는지 확인할 것.
//
// 쓰는 법: npx tsx scripts/fix-card-order.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')

/** "SM110a" → { 앞:"SM", 숫자:110, 뒤:"a" } · "042" → { 앞:"", 숫자:42, 뒤:"" } */
const 쪼개기 = (n: string) => {
  const m = String(n).match(/^([A-Za-z-]*)0*(\d+)([a-z]?)$/i)
  return m ? { 앞: m[1].toUpperCase(), 숫자: Number(m[2]), 뒤: m[3] } : null
}

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
let 고친세트 = 0
let 고친장수 = 0
for (const s of idx) {
  const p = path.join(ROOT, 'public/sets', `${s.slug}.json`)
  let d: any
  try {
    d = JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    continue
  }
  const cs = d.cards ?? []
  if (cs.length < 2) continue
  // 원래 자리를 기억해 두고, 접두사가 같은 것끼리만 숫자로 다시 세운다.
  const 원래 = cs.map((c: any, i: number) => ({ c, i, k: 쪼개기(c.n) }))
  // ⚠️ **접두사가 있는 번호만** 다시 세운다. 숫자만인 번호("042")는 이미 잘 서 있고,
  //    괜히 건드리면 원본이 정한 순서(특별 카드를 뒤에 두는 것 등)를 흐트러뜨린다.
  const 접두사있음 = 원래.some((x) => x.k && x.k.앞)
  if (!접두사있음) continue
  const 새것 = [...원래].sort((a, b) => {
    if (!a.k || !b.k) return a.i - b.i
    if (!a.k.앞 || !b.k.앞) return a.i - b.i // 한쪽만 접두사가 있으면 원래 순서
    if (a.k.앞 !== b.k.앞) return a.i - b.i // 접두사가 다르면 원래 순서
    return a.k.숫자 - b.k.숫자 || a.k.뒤.localeCompare(b.k.뒤) || a.i - b.i
  })
  const 바뀜 = 새것.some((x, i) => x.i !== i)
  if (!바뀜) continue
  고친세트++
  고친장수 += cs.length
  console.log(`  ${s.slug.padEnd(13)} ${cs.length}장 · 앞부분 ${새것.slice(0, 8).map((x) => x.c.n).join(', ')}`)
  d.cards = 새것.map((x) => x.c)
  if (WRITE) writeFileSync(p, JSON.stringify(d))
}
console.log(`\n  세트 ${고친세트}개 · 카드 ${고친장수.toLocaleString()}장${WRITE ? ' 다시 세워 저장했다' : ' (미리보기 — --write 로 저장)'}\n`)
