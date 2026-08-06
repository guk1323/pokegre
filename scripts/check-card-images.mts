// 카드 그림 주소가 실제로 열리는지 표본으로 확인한다.
//
// 왜: 주소가 적혀 있다고 그림이 있는 게 아니다. pokemontcg.io는 카드 데이터가 있는데
// 이미지 파일이 404인 세트가 있었다(맥도날드 — 2026-08-06 실측). 죽은 주소는 화면에서
// 카드 뒷면으로 바뀌어 표시되므로, 눈으로 보면 "그림이 원래 없는 카드"와 구별되지
// 않는다. 어느 **호스트**가 죽었는지 알아야 채울 방법을 찾을 수 있다.
//
// 40,489장을 다 두드리면 상대 서버에 민폐이므로 호스트마다 표본만 본다.
//
// 쓰는 법: npx tsx scripts/check-card-images.mts [표본수]
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
// ⚠️ 세트 파일에 적힌 주소는 **그대로 열리지 않는 것이 있다**. tcgdex는 화질 접미사를
//    붙여야 한다("…/SV1S/105" → "…/SV1S/105/high.webp"). 화면이 쓰는 것과 같은
//    변환기를 태워야 진짜 주소가 나온다 — 안 그러면 멀쩡한 2만 5천 장을 죽었다고
//    잘못 세게 된다(2026-08-06에 내가 그렇게 만들었다).
import { cardImg, usable } from '../src/lib/cardImg.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 표본수 = Number(process.argv[2] ?? 8)
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 호스트 → 그 호스트를 쓰는 카드 주소들 */
const 호스트별 = new Map<string, string[]>()
let 총 = 0
let 빈칸 = 0
for (const f of readdirSync(path.join(ROOT, 'public/sets'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', f), 'utf-8')) as {
    cards?: { img?: string }[]
  }
  for (const c of d.cards ?? []) {
    총++
    const 원본 = (c.img ?? '').trim()
    if (!원본 || !usable(원본)) {
      빈칸++
      continue
    }
    const u = cardImg(원본)
    let h = ''
    try {
      h = new URL(u).host
    } catch {
      h = '(주소가 이상함)'
    }
    const arr = 호스트별.get(h) ?? []
    arr.push(u)
    호스트별.set(h, arr)
  }
}

console.log(`\n  세트 카드 ${총.toLocaleString()}장 · 그림 주소 없음 ${빈칸}장 · 호스트 ${호스트별.size}곳\n`)

for (const [host, list] of [...호스트별].sort((a, b) => b[1].length - a[1].length)) {
  // 골고루 뽑는다 — 앞쪽만 보면 한 세트만 확인하는 꼴이 된다.
  const step = Math.max(1, Math.floor(list.length / 표본수))
  const 표본: string[] = []
  for (let i = 0; i < list.length && 표본.length < 표본수; i += step) 표본.push(list[i])
  let 살아있음 = 0
  const 죽은것: string[] = []
  for (const u of 표본) {
    // ⚠️ 한 번 실패했다고 죽었다고 하면 안 된다. 실제로 200인 주소가 통신 사정으로
    //    한 번 튕기는 일이 있다(2026-08-06에 두 장을 그렇게 잘못 셌다). 두 번 더 본다.
    let ok = false
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        const r = await fetch(u, { method: 'HEAD' })
        if (r.ok) ok = true
        else if (r.status < 500) {
          죽은것.push(`${r.status} ${u.slice(0, 74)}`)
          break
        }
      } catch {
        /* 통신 실패는 다시 본다 */
      }
      if (!ok) await nap(400 * (i + 1))
    }
    if (ok) 살아있음++
    else if (!죽은것.some((d) => d.includes(u.slice(0, 40)))) 죽은것.push(`못 열림 ${u.slice(0, 68)}`)
    await nap(150)
  }
  const 표 = 살아있음 === 표본.length ? '✓' : 살아있음 === 0 ? '✗' : '△'
  console.log(`  ${표} ${host.padEnd(42)} ${String(list.length).padStart(6)}장 · 표본 ${살아있음}/${표본.length} 살아있음`)
  for (const d of 죽은것.slice(0, 3)) console.log(`      ${d}`)
}
console.log('')
