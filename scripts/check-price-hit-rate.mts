// 카드를 눌렀을 때 **값이 실제로 나오는 비율**을 잰다.
//
// 왜: 지금까지 검사는 "검색어가 맞나", "다른 카드가 나오지 않나"를 봤다. 그런데 정작
// 사용자가 겪는 것은 "눌렀는데 값이 안 나온다"이다. 무작위로 26장을 두드려 보니 스니커덩크에
// 값이 있는 것이 하나도 없었다(2026-08-07). 얼마나 심한지 숫자로 알아야 손볼 곳이 보인다.
//
// 무엇을 세나: 일본판 카드를 무작위로 뽑아 스니커덩크에 물어
//   ① 카탈로그에 아예 없음  ② 있는데 매물이 없어 값이 0  ③ 값이 있음
// ③의 비율이 곧 "첫 마켓에서 바로 값을 보는 비율"이다. ①②는 다음 마켓(이베이·TCGplayer)으로
// 넘어가는데, 그쪽은 PPT 크레딧이 있어야 잴 수 있다.
//
// ⚠️ 값은 **검색 결과의 `salePrice`**를 본다. 카드 상세(`/v1/apparels/{id}`)의 `minPrice`는
//    화면이 쓰는 값이 아니다 — 그걸로 재다가 "값 있는 카드 0%"라는 틀린 결론을 낼 뻔했다
//    (2026-08-07). 실제로는 화면에 ￥1,480·매물 6개로 잘 뜨는 카드였다.
//    **검사 도구는 반드시 화면이 쓰는 값을 봐야 한다.**
//
// ⚠️ 스니커덩크는 무료다 — PPT 크레딧을 쓰지 않는다.
//
// 쓰는 법: npx tsx scripts/check-price-hit-rate.mts [표본수(기본 120)]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const 표본수 = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 120
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))
const 서버 = process.env.POKEGRE_ORIGIN ?? 'http://localhost:3000'

// 회차마다 다른 카드를 보되, 다시 돌려 견줄 수 있게 씨앗을 찍어 둔다.
let seed = Number(process.env.SEED) || 20260807
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]

const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 일본 = sidx.filter((s) => s.ed === 'ja' && !(s.serie ?? '').includes('Pocket'))

let 없음 = 0
let 값0 = 0
let 값있음 = 0
const 시대별 = new Map<string, { 봄: number; 값: number }>()
const 값있는예: string[] = []

console.log(`\n  일본판 카드 ${표본수}장을 무작위로 눌러 본다 (스니커덩크는 무료 · ${Math.ceil(표본수 * 1.4 / 60)}분쯤)\n`)

for (let i = 0; i < 표본수; i++) {
  const s = pick(일본)
  let d: any
  try {
    d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', `${s.slug}.json`), 'utf-8'))
  } catch {
    i--
    continue
  }
  const cs = (d.cards ?? []).filter((c: any) => c.img)
  if (!cs.length) {
    i--
    continue
  }
  const c = pick(cs)
  const 해 = String(s.releaseDate ?? '').slice(0, 4) || '?'
  const 시대 = 해 === '?' ? '?' : Number(해) >= 2020 ? '2020년대' : Number(해) >= 2010 ? '2010년대' : '2000년대 이전'
  const v = 시대별.get(시대) ?? { 봄: 0, 값: 0 }
  v.봄++

  let 결과: 'none' | 'zero' | 'priced' = 'none'
  try {
    const j: any = await fetch(
      `${서버}/api/snkrdunk/v3/search?func=all&refId=search&keyword=${encodeURIComponent(`${s.id} ${c.n}`)}` +
        `&sortKey=default&cardVersion=2&brandIds=pokemon&perPage=4&page=1`,
    ).then((r) => r.json())
    const ps = j?.search?.rankingProducts ?? []
    const re = new RegExp(`\\[${s.id}[-\\s](?:No\\.)?0*${Number(c.n)}(?:[/\\]]|\\s)`, 'i')
    const 맞 = ps.filter((p: any) => re.test(p.title))
    if (맞.length) {
      const 값 = Number(맞[0].salePrice ?? 0)
      const 매물 = Number(맞[0].stockFromGeneralUsers ?? 0)
      if (값 > 0) {
        결과 = 'priced'
        if (값있는예.length < 8)
          값있는예.push(`${s.id} ${c.n} ${맞[0].title.slice(0, 38)} — ￥${값.toLocaleString()} · 매물 ${매물}개`)
      } else 결과 = 'zero'
    }
  } catch {
    /* 못 받으면 없음으로 둔다 */
  }
  await nap(600)

  if (결과 === 'priced') {
    값있음++
    v.값++
  } else if (결과 === 'zero') 값0++
  else 없음++
  시대별.set(시대, v)
  if ((i + 1) % 10 === 0)
    process.stdout.write(`\r  ${i + 1}/${표본수}장 · 값 있음 ${값있음} · 매물 0 ${값0} · 카탈로그에 없음 ${없음}    `)
}

const 총 = 값있음 + 값0 + 없음
console.log(`\n\n  본 카드 ${총}장 (씨앗 ${process.env.SEED || 20260807})`)
console.log(`  ✓ 값이 있음            ${값있음}장 (${((값있음 / 총) * 100).toFixed(0)}%)`)
console.log(`  · 카드는 있는데 매물 0    ${값0}장 (${((값0 / 총) * 100).toFixed(0)}%)`)
console.log(`  · 카탈로그에 아예 없음    ${없음}장 (${((없음 / 총) * 100).toFixed(0)}%)\n`)
console.log(`  발매 시기별로 값이 있는 비율:`)
for (const [시대, v] of [...시대별].sort()) console.log(`      ${시대.padEnd(14)} ${v.값}/${v.봄}장 (${((v.값 / v.봄) * 100).toFixed(0)}%)`)
if (값있는예.length) {
  console.log(`\n  값이 있던 카드:`)
  for (const e of 값있는예) console.log(`      ${e}`)
}
console.log('')
