// 카드 **사진 주소가 실제로 살아 있는지** 세트마다 몇 장씩 눌러 본다.
//
// 왜: 주소에 적힌 세트·번호가 맞아도 그 파일이 없으면 화면엔 뒷면("이미지 준비 중")이
// 뜬다. 소스가 세트를 통째로 내리거나 경로를 바꾸면 그 세트가 다 깨지는데, 지금은
// 그걸 알 방법이 없었다(2026-08-07).
//
// 세트마다 앞·중간·뒤 세 장만 본다 — 한 세트의 사진은 같은 소스·같은 경로 규칙이라
// 세 장이 살아 있으면 나머지도 대체로 산다. 전수로 4만 장을 두드리는 건 상대에게 실례다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cardImg, usable } from '../src/lib/cardImg.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 볼장수 = Number(process.env.PER_SET ?? 3)

let 봄 = 0, 살음 = 0
const 죽은세트: { slug: string; 이름: string; 죽음: number; 봄: number; 예: string }[] = []
for (const s of sidx) {
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  const 있는것 = (d.cards ?? []).filter((c: any) => usable(c.img))
  if (!있는것.length) continue
  const 뽑음 = [0, 0.5, 0.99].slice(0, 볼장수).map((p) => 있는것[Math.floor((있는것.length - 1) * p)])
  let 죽음 = 0
  let 예 = ''
  for (const c of 뽑음) {
    const url = cardImg(String(c.img))
    봄++
    try {
      const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
      if (r.ok) { 살음++; continue }
      죽음++
      if (!예) 예 = `${c.n} → ${r.status} ${url.slice(0, 72)}`
    } catch {
      죽음++
      if (!예) 예 = `${c.n} → 못 받음 ${url.slice(0, 72)}`
    }
    await new Promise((x) => setTimeout(x, 120))
  }
  if (죽음) 죽은세트.push({ slug: s.slug, 이름: s.name, 죽음, 봄: 뽑음.length, 예 })
}
console.log(`\n  눌러 본 사진 ${봄.toLocaleString()}장 · 살아 있음 ${살음.toLocaleString()}장`)
console.log(`  ${죽은세트.length ? '✗' : '✓'} 사진이 죽은 세트 ${죽은세트.length}개\n`)
죽은세트.sort((a, b) => b.죽음 / b.봄 - a.죽음 / a.봄)
죽은세트.slice(0, 25).forEach((x) => console.log(`      ${x.slug.padEnd(14)} ${x.죽음}/${x.봄}장 죽음  ${x.이름}\n         ${x.예}`))
console.log('')
