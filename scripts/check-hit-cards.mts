/**
 * 세트 화면의 **힛카드**가 진짜 그 세트 카드를 가리키는지 본다.
 *
 * 힛카드 번호는 저쪽(PPT) 자료나 스니커덩크에서 온다 — 우리 세트에 **없는 번호**가
 * 섞일 수 있다. 2026-08-08에 VMAX 클라이맥스에 284번이 들어 있었는데 그 세트는
 * 277번까지다. 이름을 못 찾아 **빈 카드에 $51.23**만 붙어 나갔고, 여덟 자리 중
 * 하나를 차지해 진짜 8등이 밀려났다.
 *
 * 보는 것:
 *   ① 세트가 실제로 있나  ② 번호가 그 세트에 있나  ③ 값이 0보다 큰가
 *   ④ 값이 내림차순인가(1등이 진짜 1등인가)
 *
 * ⚠️ 서버(`topPricedCards`)도 읽을 때 없는 번호를 버린다. 여기서 0이어도
 *    운영 `/data/hit-snkrdunk.json`에는 새 값이 쌓이므로 **서버 쪽 거르기가 본진**이고
 *    이 검사는 배포에 딸려가는 파일을 보는 것이다.
 *
 * 실행: node --experimental-strip-types scripts/check-hit-cards.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 번호열쇠 } from '../src/lib/cardNo.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const 힛 = JSON.parse(readFileSync(join(ROOT, 'src/data/setHitCards.json'), 'utf8')) as Record<
  string,
  { cards?: { n: string; usd: number }[] } | { n: string; usd: number }[]
>
const 있는세트 = new Set(
  (JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { slug: string }[]).map((s) => s.slug),
)

const 문제: string[] = []
let 세트 = 0
let 카드 = 0
for (const [slug, v] of Object.entries(힛)) {
  세트++
  if (!있는세트.has(slug)) {
    문제.push(`세트가 목록에 없다: ${slug}`)
    continue
  }
  let cards: { n?: string }[] = []
  try {
    cards = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8')).cards ?? []
  } catch {
    문제.push(`세트 파일을 못 읽는다: ${slug}`)
    continue
  }
  const 번호 = new Set(cards.map((c) => 번호열쇠(c.n)))
  const list = Array.isArray(v) ? v : (v.cards ?? [])
  for (const c of list) {
    카드++
    if (!번호.has(번호열쇠(c.n))) 문제.push(`번호가 그 세트에 없다: ${slug} ${c.n} ($${c.usd})`)
    else if (!(Number(c.usd) > 0)) 문제.push(`값이 0 이하다: ${slug} ${c.n} = ${c.usd}`)
  }
  const u = list.map((x) => Number(x.usd))
  for (let i = 1; i < u.length; i++) {
    if (u[i] > u[i - 1]) {
      문제.push(`값 차례가 뒤집혔다: ${slug} ${u.join(' > ')}`)
      break
    }
  }
}
console.log(`힛카드 파일: 세트 ${세트}개 · 카드 ${카드}장 · 문제 ${문제.length}개`)
for (const x of 문제.slice(0, 30)) console.log('  ' + x)
