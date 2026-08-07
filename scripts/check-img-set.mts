// 카드 **사진 주소에 적힌 세트**가 우리 세트와 맞는지 전수로 본다.
//
// 왜: 번호가 맞아도 세트가 다르면 딴 카드 사진이다(SV8 001과 SV8a 001은 다른 카드다).
// 번호 검사(check-img-number)만으로는 그걸 못 잡는다.
//
// 주소 꼴마다 세트가 있는 자리가 다르다:
//   assets.tcgdex.net/ja/SV/SV8/001            → 끝에서 두 번째
//   limitless…/tpc/M2a/M2a_1_R_JP_SM.png       → tpc 다음
//   den-cards.pokellector.com/…/Oddish.NEO1.1… → 이름 다음
//   images.pokemontcg.io/sv3pt5/173.png        → 파일 앞
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 열쇠 = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

function 주소세트(url: string): string | null {
  const u = decodeURIComponent(String(url ?? ''))
  if (!u) return null
  let m: RegExpMatchArray | null
  if (/assets\.tcgdex\.net/.test(u)) {
    m = u.match(/\/([^/]+)\/[^/]+?(?:\/(?:high|low)\.\w+)?$/)
    return m ? m[1] : null
  }
  if (/limitlesstcg/.test(u)) {
    m = u.match(/\/tpc\/([^/]+)\//)
    return m ? m[1] : null
  }
  if (/den-cards\.pokellector\.com/.test(u)) {
    m = u.match(/\/[^/]*?\.([A-Za-z0-9-]+)\.[A-Za-z0-9]+\.\d+\.thumb/)
    return m ? m[1] : null
  }
  if (/images\.pokemontcg\.io/.test(u)) {
    m = u.match(/\/([A-Za-z0-9.]+)\/[A-Za-z0-9]+\.(?:png|jpg|webp)$/i)
    return m ? m[1] : null
  }
  return null
}

// 사진을 주는 곳이 우리와 **다르게 부르는 세트**들. 전부 확인해 둔 짝이다
// (2026-08-07). 여기 없는 짝이 새로 뜨면 그때 확인하면 된다 — 그게 이 검사의 목적이다.
//  · limitless는 색으로 부른다: 푸른 충격=XY8b(blue) · 붉은 섬광=XY8r(red).
//    우리 XY8b(붉은 섬광)와 저쪽 XY8b(푸른 충격)가 이름만 같고 다른 세트라 헷갈리는데,
//    사진을 내려받아 확인했다(우리 XY11a 001 도토링 ↔ XY11b_1도 도토링 001/054).
//  · pokellector는 옛 세트를 EC1·B02·EXP처럼 부른다. 이 869장은 사진 이름으로도
//    전부 대조해 맞는 것을 확인했다(check-photo-vs-name).
const 아는짝 = new Set([
  'en-2011bw|mcd11', 'en-2012bw|mcd12', 'en-2016xy|mcd16', 'en-2019sm|mcd19',
  'en-2021swsh|mcd21', 'en-2022swsh|mcd22', 'en-bog|bp', 'en-hgssp|hsp',
  'en-swsh9.5tg|swsh9tg', 'en-swsh10.5tg|swsh10tg', 'en-swsh11.5tg|swsh11tg',
  'en-swsh12.5tg|swsh12tg', 'en-swsh12.5gg|swsh12pt5gg',
  'ja-E2|EC1', 'ja-PMCG1|EXP', 'ja-PMCG2|B02', 'ja-PMCG3|B03', 'ja-PMCG4|B04',
  'ja-PMCG5|B05', 'ja-PMCG6|B06', 'ja-VS1|VS',
  'ja-SM1+|SM1p', 'ja-sm2+|SM2p', 'ja-SM3+|SM3p', 'ja-SM4+|SM4p', 'ja-SM5+|SM5p',
  'ja-sn10a|SM10a', 'ja-sn11|SM11',
  'ja-XY1a|XY1x', 'ja-XY1b|XY1y', 'ja-XY5a|XY5g', 'ja-XY5b|XY5t',
  'ja-XY8a|XY8b', 'ja-XY8b|XY8r', 'ja-XY11a|XY11b', 'ja-XY11b|XY11r',
].map((x) => x.toLowerCase()))

let 봄 = 0, 맞음 = 0, 아는것 = 0
const 짝 = new Map<string, { n: number; 예: string }>()
for (const s of sidx) {
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  // 우리 세트 코드는 slug에서 판 접두사를 뗀 것이다(ja-SV8 → SV8).
  const 우리 = 열쇠(String(s.slug).replace(/^(ja|en)-/, ''))
  for (const c of d.cards ?? []) {
    const 저 = 주소세트(String(c.img ?? ''))
    if (저 === null) continue
    봄++
    if (열쇠(저) === 우리) { 맞음++; continue }
    if (아는짝.has(`${s.slug}|${저}`.toLowerCase())) { 아는것++; continue }
    const k = `${s.slug} ↔ ${저}`
    const v = 짝.get(k) ?? { n: 0, 예: `${c.n} "${c.name}"` }
    v.n++
    짝.set(k, v)
  }
}
console.log(`\n  세트를 견줄 수 있는 카드 ${봄.toLocaleString()}장`)
console.log(`  ✓ 주소 세트가 우리와 같음  ${맞음.toLocaleString()}장`)
console.log(`  · 우리와 다르게 부르지만 확인해 둔 짝  ${아는것.toLocaleString()}장`)
console.log(`  ${짝.size ? '✗' : '✓'} 처음 보는 짝              ${(봄 - 맞음 - 아는것).toLocaleString()}장 (${짝.size}가지)\n`)
if (짝.size) console.log('  [처음 보는 짝 — 진짜 딴 세트 사진인지 확인할 것]')
;[...짝.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log(`      ${String(v.n).padStart(4)}장  ${k.padEnd(30)} 예: ${v.예}`))
console.log('')
