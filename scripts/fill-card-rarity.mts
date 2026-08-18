/**
 * 카드마다 빠진 **레어도(`r`)를 채운다.** 재료는 TCGdex — **크레딧 0**.
 *
 * 왜 — 도감 59,798장 중 **10,961장(18%)에 레어도가 없다.** 그래서 「저지맨 SR」·「리자몽 SAR」
 * 처럼 레어도를 붙여 찾으면 그 카드들이 안 나온다(사장님 지적 2026-08-12: "지금 검색하는데
 * 데이터가 안나온다는데"). 프로모·샤이니·하이클래스 세트에 몰려 있다.
 *
 * ⚠️ **저쪽(PPT)으로는 못 채운다.** 빠진 것의 89%가 저쪽 번호를 갖고 있는데, 실시간으로
 *    물어봐도 레어도를 **빈 문자열**로 준다(2026-08-12에 6장으로 확인). 우리가 안 받아온
 *    게 아니라 저쪽이 모른다.
 *
 * ⚠️⚠️ **번호와 이름이 둘 다 맞을 때만 넣는다.** 이 리포의 원칙이다 — 「틀린 것보다 빈칸」.
 *    번호만 맞춰 넣으면 같은 번호의 다른 인쇄(미러 홀로 등)에 엉뚱한 레어도가 붙는다.
 *    ⚠️ 이름은 **영문/일본어 원본끼리** 견준다. 우리 도감의 `name`이 그 원본이다.
 *    ⚠️ 번호는 앞의 0을 떼고, 우리 쪽 꼬리(`11~602979`)도 떼고 견준다.
 *
 * ⚠️ 이미 레어도가 있는 카드는 **안 건드린다.** 덮어쓰면 우리가 손본 것이 날아간다.
 *
 * 쓰는 법: npx tsx scripts/fill-card-rarity.mts [--write] [세트슬러그 ...]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const 고른세트 = process.argv.slice(2).filter((a) => !a.startsWith('--'))

const SETS = path.resolve('public/sets')
type 세트줄 = { slug: string; ed?: string; id?: string; name?: string }
const 목록 = JSON.parse(readFileSync(path.join(SETS, 'index.json'), 'utf-8')) as 세트줄[]
const 세트표 = new Map(목록.map((s) => [s.slug, s]))

const 번호열쇠 = (n: unknown) =>
  String(n ?? '')
    .split('~')[0]
    .split('/')[0]
    .trim()
    .replace(/^0+(?=[0-9])/, '')
    .toUpperCase()
// 이름은 **글자만** 남겨 견준다. 저쪽과 우리가 공백·기호를 다르게 적는 일이 흔하다
// ("Mega Charizard X ex" ↔ "Mega Charizard X-ex"). 글자를 바꾸지는 않는다.
const 이름열쇠 = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿가-힯]/g, '')

/** 여럿을 한꺼번에, 다만 예의 있게(동시 6개). */
async function 나눠서<T, R>(것들: T[], 몇개: number, 하나: (x: T) => Promise<R>): Promise<R[]> {
  const 답: R[] = []
  for (let i = 0; i < 것들.length; i += 몇개) 답.push(...(await Promise.all(것들.slice(i, i + 몇개).map(하나))))
  return 답
}

const 받기 = async (u: string) => {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

type 카드줄 = { id?: string; localId?: string; name?: string }

/**
 * 세트 목록(카드 id·번호·이름). 레어도는 여기 안 온다 — 낱장을 받아야 나온다.
 *
 * ⚠️⚠️ **판을 넘나들지 않는다.** 일본 세트면 일본판만, 영문 세트면 영문판만 본다.
 *    처음엔 「일본판에 없으면 영문판이라도」로 짜 놨는데, 사장님이 막으셨다
 *    (2026-08-12: "영문 일판 레어도가 다를수도 있으니까 정확한거 아니면 니가 유추해서 넣지마").
 *    같은 카드라도 판에 따라 레어도가 다를 수 있다 — 넘겨짚어 넣으면 그게 틀린 값이다.
 *    ⚠️ 다른 세트를 채우려고 이 함수를 손볼 때도 **폴백을 되살리지 말 것.**
 */
const 세트목록 = async (id: string, ed: string): Promise<{ lang: string; cards: 카드줄[] } | null> => {
  const lang = ed === 'ja' ? 'ja' : 'en'
  const j = (await 받기(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(id)}`)) as {
    cards?: 카드줄[]
  } | null
  return j?.cards?.length ? { lang, cards: j.cards } : null
}

const 낱장 = async (lang: string, id: string) =>
  (await 받기(`https://api.tcgdex.net/v2/${lang}/cards/${encodeURIComponent(id)}`)) as {
    localId?: string
    name?: string
    rarity?: string
  } | null

const 쓸만한레어도 = (r: unknown) => {
  const s = String(r ?? '').trim()
  return s && s !== 'None' ? s : ''
}

async function main() {
  // 레어도가 빠진 카드가 있는 세트만 훑는다.
  const 파일들 = readdirSync(SETS).filter((f) => f.endsWith('.json') && !['index.json', 'ko-index.json'].includes(f))
  const 할것: { slug: string; 빈수: number }[] = []
  for (const f of 파일들) {
    const slug = f.slice(0, -5)
    if (고른세트.length && !고른세트.includes(slug)) continue
    let j: { cards?: { r?: string }[] }
    try {
      j = JSON.parse(readFileSync(path.join(SETS, f), 'utf-8'))
    } catch {
      continue
    }
    const 빈수 = (j.cards ?? []).filter((c) => !c.r || c.r === 'None').length
    if (!빈수) continue
    const m = 세트표.get(slug)
    // ppt-* 아이디는 저쪽이 지어낸 것이라 TCGdex에 없다.
    if (!m?.id || /^ppt-/.test(String(m.id))) continue
    할것.push({ slug, 빈수 })
  }
  할것.sort((a, b) => b.빈수 - a.빈수)
  console.log(`레어도가 빠진 세트 ${할것.length}개 (빈 카드 ${할것.reduce((s, x) => s + x.빈수, 0).toLocaleString()}장)\n`)

  let 채움 = 0
  let 이름안맞음 = 0
  let 못찾음 = 0
  const 못채운세트: { slug: string; 빈수: number; 까닭: string }[] = []

  for (const [i, { slug, 빈수 }] of 할것.entries()) {
    const m = 세트표.get(slug)!
    const 앞머리 = `  ${String(i + 1).padStart(3)}/${할것.length} ${slug.padEnd(26)}`
    const 목록2 = await 세트목록(String(m.id), String(m.ed ?? 'en'))
    if (!목록2) {
      못채운세트.push({ slug, 빈수, 까닭: 'TCGdex에 그 세트가 없음' })
      console.log(`${앞머리} ✗ 세트 없음 (빈 ${빈수}장)`)
      continue
    }
    // ⚠️ **먼저 3장만 찔러 본다.** 세트 하나가 카드 수백 장이라, 레어도가 없는 세트까지
    //    전부 받으면 요청이 십수만 건이 된다. 일본판 프로모·샤이니는 대개 「None」이다.
    const 찔러본것 = await 나눠서(목록2.cards.slice(0, 3), 3, (c) => 낱장(목록2.lang, String(c.id)))
    if (!찔러본것.some((c) => 쓸만한레어도(c?.rarity))) {
      못채운세트.push({ slug, 빈수, 까닭: 'TCGdex도 레어도를 「None」으로 줌' })
      console.log(`${앞머리} · 그쪽도 레어도 없음 (빈 ${빈수}장)`)
      continue
    }

    // 여기까지 왔으면 그 세트는 레어도를 갖고 있다 — 통째로 받는다.
    const 것들 = await 나눠서(목록2.cards, 6, (c) => 낱장(목록2.lang, String(c.id)))
    const 표 = new Map<string, { r: string; name: string }>()
    for (const [k, c] of 것들.entries()) {
      const 레어 = 쓸만한레어도(c?.rarity)
      if (!레어) continue
      표.set(번호열쇠(c?.localId ?? 목록2.cards[k]?.localId), { r: 레어, name: String(c?.name ?? '') })
    }

    const 곳 = path.join(SETS, `${slug}.json`)
    const j = JSON.parse(readFileSync(곳, 'utf-8')) as { cards?: { n?: string; name?: string; r?: string }[] }
    let 이세트 = 0
    for (const c of j.cards ?? []) {
      if (c.r && c.r !== 'None') continue
      const 것 = 표.get(번호열쇠(c.n))
      if (!것) {
        못찾음++
        continue
      }
      // ⚠️ 이름이 다르면 **넣지 않는다.** 번호만 같은 다른 카드일 수 있다.
      if (이름열쇠(것.name) !== 이름열쇠(c.name)) {
        이름안맞음++
        continue
      }
      c.r = 것.r
      이세트++
      채움++
    }
    if (이세트 && WRITE) writeFileSync(곳, JSON.stringify(j))
    if (이세트 < 빈수) 못채운세트.push({ slug, 빈수: 빈수 - 이세트, 까닭: '번호·이름이 안 맞거나 그쪽에 없음' })
    console.log(`${앞머리} ${이세트 ? '✔' : '·'} 채움 ${String(이세트).padStart(4)}/${빈수}장`)
  }

  console.log(`\n${WRITE ? '적었습니다' : '미리보기(파일은 안 건드림)'}`)
  console.log(`  채운 카드      ${채움.toLocaleString()}장`)
  console.log(`  이름이 달라 건너뜀 ${이름안맞음.toLocaleString()}장   ← 틀린 것보다 빈칸`)
  console.log(`  저쪽에 그 번호가 없음 ${못찾음.toLocaleString()}장`)
  console.log()
  console.log(`  ── 못 채운 곳 (${못채운세트.reduce((a, b) => a + b.빈수, 0).toLocaleString()}장) ──`)
  const 까닭별: Record<string, number> = {}
  for (const x of 못채운세트) 까닭별[x.까닭] = (까닭별[x.까닭] ?? 0) + x.빈수
  for (const [k, v] of Object.entries(까닭별).sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(v).toLocaleString().padStart(6)}장  ${k}`)
  console.log()
  console.log('  못 채운 세트 (많은 순 20개)')
  for (const x of 못채운세트.sort((a, b) => b.빈수 - a.빈수).slice(0, 20))
    console.log(`     ${String(x.빈수).padStart(4)}장  ${x.slug.padEnd(30)}${x.까닭}`)
  if (!WRITE) console.log('\n  실제로 적으려면 --write 를 붙여 다시 돌린다.')
  else console.log('\n  ⚠️ 이어서 `npx tsx scripts/gen-card-index.mts` 를 꼭 돌릴 것(색인에 반영).')
}

await main()
