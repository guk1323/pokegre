// 세트 목록에 보이는 표지 그림이 실제로 열리는지 표본으로 본다.
//
// 왜: 세트 목록은 371칸이 전부 그림이다. 하나가 죽으면 그 칸만 빈 상자가 되는데,
// 목록을 끝까지 내려 보지 않으면 모른다. 표지는 세 겹으로 정해진다 —
// boxImg(스니커덩크 상품 사진) → logo(팩 로고) → cover(첫 카드). 화면이 고르는 것과
// 같은 순서로 골라서 그 주소를 두드린다.
//
// 쓰는 법: npx tsx scripts/check-set-covers.mts [표본수]
import { readFileSync } from 'node:fs'
import path from 'node:path'
// ⚠️ 화면이 쓰는 것과 같은 변환기를 태워야 진짜 주소가 나온다. tcgdex는 화질 접미사를
//    붙여야 열린다(2026-08-06에 이걸 빠뜨려 멀쩡한 표지를 죽었다고 셌다).
import { cardImg, usable } from '../src/lib/cardImg.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 표본수 = Number(process.argv[2] ?? 30)
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))

type S = { slug: string; name: string; boxImg?: string; logo?: string; cover?: string; serie?: string }
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as S[]

// ⚠️ 화면(SetsView)이 고르는 것과 같아야 한다. 목록 표지는 boxImg·logo가 아니라
//    **cover**(첫 카드)를 쓰고, 시세를 받아 둔 세트는 서버가 준 "값 높은 카드"로
//    바뀐다. 서버 것은 여기서 알 수 없으므로 cover만 본다.
const 표지 = (s: S) => (usable(s.cover) ? cardImg(s.cover!) : '')

const 없음 = index.filter((s) => !표지(s))
const 있음 = index.filter((s) => 표지(s))
console.log(`\n  세트 ${index.length}개 · 표지 주소 없음 ${없음.length}개`)
for (const s of 없음.slice(0, 6)) console.log(`      ${s.slug.padEnd(14)} ${s.name}`)

// 골고루 뽑는다.
const step = Math.max(1, Math.floor(있음.length / 표본수))
const 표본: S[] = []
for (let i = 0; i < 있음.length && 표본.length < 표본수; i += step) 표본.push(있음[i])

let 살아있음 = 0
const 죽은것: string[] = []
for (const s of 표본) {
  const u = 표지(s)
  let ok = false
  // ⚠️ 한 번 실패했다고 죽었다고 하면 안 된다(2026-08-06에 그렇게 잘못 셌다).
  for (let i = 0; i < 3 && !ok; i++) {
    try {
      const r = await fetch(u, { method: 'HEAD' })
      if (r.ok) ok = true
      else if (r.status < 500) break
    } catch {
      /* 다시 본다 */
    }
    if (!ok) await nap(400 * (i + 1))
  }
  if (ok) 살아있음++
  else 죽은것.push(`${s.slug.padEnd(14)} ${s.name.slice(0, 20).padEnd(22)} ${u.slice(0, 60)}`)
  await nap(120)
}
console.log(`\n  ${죽은것.length ? '✗' : '✓'} 표지가 안 열림   ${죽은것.length}/${표본.length} (표본)`)
for (const d of 죽은것.slice(0, 8)) console.log(`      ${d}`)
console.log('')
