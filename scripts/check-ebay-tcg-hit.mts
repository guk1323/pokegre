// 이베이·TCGplayer에서 **카드를 눌렀을 때 실제로 값이 나오는지** 잰다.
//
// 왜: 스니커덩크(무료)는 여러 번 쟀는데, 이베이·TCGplayer는 PPT(유료)를 거쳐서
// 크레딧이 없는 날에는 한 번도 못 봤다(2026-08-06~07 하루치 소진). 그래서
// "일본판 카드가 이베이에서 몇 %나 걸리는지"를 우리는 모르고 있었다.
//
// 재는 것 세 가지:
//   ① 값이 나오는 비율
//   ② 결과에 **그 카드**(번호 일치)가 들어 있는 비율 — 엉뚱한 카드 위험
//   ③ 세트 이름 대응표(setName)를 못 찾는 카드
//
// ⚠️ **크레딧은 limit의 3배다.** 우리 서버가 PPT를 부를 때 includeHistory와 includeEbay를
//    늘 함께 켜기 때문이다(등급별 시세 그래프의 재료라 필요하다). PPT는 카드마다
//    기본 1 + 히스토리 1 + 이베이 1을 매긴다.
//    2026-08-07에 이걸 1배로 세어 "1,200크레딧"이라 말하고 돌렸다가 실제로 3,600을 썼고,
//    그날 하루치 20,000을 다 태워 방문자에게 시세가 안 나갔다.
//    기본 25장 × 4조합 × 12 × 3 = 3,600크레딧.
//
// 쓰는 법: npx tsx scripts/check-ebay-tcg-hit.mts [조합당장수]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/cardCatalog.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import { pptSetName } from '../src/lib/pokedexRoute.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASE = process.env.PG_BASE ?? 'http://localhost:8787'
const 조합당 = Number(process.argv[2] ?? 25)
// 429로 끊겼을 때 남은 조합만 이어 돌리려고 이름 일부로 고를 수 있게 한다.
const 고른것 = process.argv[3] ?? ''
const PAGE = 12

const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 세트 = new Map(sidx.map((s) => [s.slug, s]))

/** 마켓에 보낼 때만 쓰는 다듬기(pokedexRoute의 기호뗌과 같은 규칙). */
const 기호뗌 = (s: string) => String(s).replace(/[★☆◆◇●○♢♦]/g, ' ').replace(/\s+/g, ' ').trim()
// ⚠️ PPT는 번호를 "104/110" 꼴로 준다. 슬래시 앞만 견줘야 우리 "104"와 맞는다.
const 자름 = (n: string) => String(n).split('/')[0].trim().replace(/^0+/, '').toUpperCase()

type 뽑 = { slug: string; ed: 'ja' | 'en'; n: string; raw: string; ko: string; setName: string }
const 고르기 = (ed: 'ja' | 'en', n: number): 뽑[] => {
  const 후보: 뽑[] = []
  for (const s of sidx) {
    if (s.ed !== ed) continue
    let d: any
    try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
    for (const c of d.cards ?? []) 후보.push({ slug: s.slug, ed, n: String(c.n), raw: String(c.name ?? ''), ko: koName(ed, String(c.name ?? '')), setName: s.name })
  }
  // 고르게 흩어 뽑는다(한 세트에 몰리면 세트별 차이를 못 본다).
  const 걸음 = Math.max(1, Math.floor(후보.length / n))
  return 후보.filter((_, i) => i % 걸음 === 0).slice(0, n)
}

const 조합 = [
  { 이름: '이베이(일본판)', ed: 'ja' as const, language: 'japanese', have: '' },
  { 이름: '이베이(영문판)', ed: 'en' as const, language: 'english', have: '' },
  { 이름: 'TCGplayer(일본판)', ed: 'ja' as const, language: 'japanese', have: 'tcgplayer' },
  { 이름: 'TCGplayer(영문판)', ed: 'en' as const, language: 'english', have: 'tcgplayer' },
]

let 쓴크레딧 = 0
for (const c of 조합) {
  if (고른것 && !c.이름.includes(고른것)) continue
  const 뽑음 = 고르기(c.ed, 조합당)
  let 값있음 = 0, 결과없음 = 0, 그카드있음 = 0, 번호모름 = 0, 세트못찾음 = 0, 막힘 = 0, 실패 = 0
  // ⚠️ 실패를 숫자 하나로 뭉치면 "왜 안 됐는지"를 못 본다. 상태코드별로 센다.
  const 실패내역: Record<string, number> = {}
  const 엉뚱: string[] = []
  for (let ti = 0; ti < 뽑음.length; ti++) {
    const t = 뽑음[ti]
    // 앱과 같은 순서: 도감검색어(영문 우선) → 영어 사전으로 한 번 더
    const 원 = 기호뗌(t.ed === 'en' ? t.raw : t.ko)
    const search = translateSearchQueryToEnglish(원, c.language as any)
    // pptSetName은 카드 정보를 통째로 받는다(대응표에 없으면 우리 세트 이름을 써 보되
    // 한글이 섞였으면 안 보낸다). 여기서 필요한 칸만 채워 넘긴다.
    const setName = pptSetName({ slug: t.slug, setName: t.setName, ko: t.ko, en: '', raw: t.raw, speciesEn: '', setCode: '', setNameKo: '', num: t.n, jp: t.ed !== 'en' })
    if (!setName) 세트못찾음++
    const p = new URLSearchParams({ language: c.language, search, includeEbay: 'true', limit: String(PAGE), offset: '0', sortBy: 'price', sortOrder: 'desc' })
    if (c.have) p.set('have', c.have)
    if (setName) p.set('setName', setName)
    let j: any
    try {
      const r = await fetch(`${BASE}/api/local/card-prices?${p}`, { signal: AbortSignal.timeout(30000) })
      if (r.status === 429) {
        // 분당 한도다. 예전엔 여기서 통째로 멈춰 TCGplayer 두 조합을 아예 못 쟀다
        // (2026-08-07). 잠깐 쉬었다 같은 카드를 다시 친다. 세 번 이어지면 이 조합만 접는다.
        막힘++
        if (막힘 >= 3) break
        await new Promise((x) => setTimeout(x, 70000))
        ti--
        continue
      }
      막힘 = 0
      if (!r.ok) { 실패++; 실패내역[r.status] = (실패내역[r.status] ?? 0) + 1; continue }
      // 크레딧은 실제로 받아온 것만, 그리고 **3배로** 센다(위 머리말 참고).
      쓴크레딧 += PAGE * 3
      j = await r.json()
    } catch { 실패++; 실패내역['throw'] = (실패내역['throw'] ?? 0) + 1; continue }
    const cards = j?.cards ?? []
    if (!cards.length) { 결과없음++; continue }
    값있음++
    // 결과에 그 번호 카드가 있나
    // ⚠️ PPT가 번호를 안 주는 카드가 있다. 그걸 "다른 카드"로 세면 안 된다 —
    //    델빌을 찾아 Houndour(=델빌)가 왔는데 번호가 없어 엉뚱한 카드로 셌다(2026-08-07).
    const 번호있는것 = cards.filter((x: any) => String(x.cardNumber ?? x.number ?? '').trim())
    if (!번호있는것.length) { 번호모름++; continue }
    const 맞음 = 번호있는것.some((x: any) => 자름(String(x.cardNumber ?? x.number)) === 자름(t.n))
    if (맞음) 그카드있음++
    else if (엉뚱.length < 6) 엉뚱.push(`${t.slug} ${t.n} "${t.ko}" → 맨 위 "${cards[0]?.name ?? '?'}" (${cards[0]?.cardNumber ?? '?'})`)
    await new Promise((r) => setTimeout(r, 1500))
  }
  const 본것 = 값있음 + 결과없음
  console.log(`\n  [${c.이름}]  ${본것}장 봄${막힘 ? ` · 한도로 멈춤` : ''}${실패 ? ` · 실패 ${실패}` : ''}`)
  if (본것) {
    console.log(`     결과 있음        ${값있음}장 (${Math.round((값있음 / 본것) * 100)}%)`)
    console.log(`     결과 없음        ${결과없음}장 (${Math.round((결과없음 / 본것) * 100)}%)`)
    const 판정됨 = 값있음 - 번호모름
    console.log(`     그중 번호까지 맞음 ${그카드있음}장 (번호를 아는 ${판정됨}장 중 ${판정됨 ? Math.round((그카드있음 / 판정됨) * 100) : 0}%)`)
    if (번호모름) console.log(`     번호를 안 줘서 판정 못 함 ${번호모름}장`)
  }
  console.log(`     세트 대응표 못 찾음 ${세트못찾음}장`)
  if (Object.keys(실패내역).length) console.log(`     실패 내역: ${JSON.stringify(실패내역)}`)
  엉뚱.forEach((e) => console.log(`       ↳ ${e}`))
  if (막힘) break
}
console.log(`\n  쓴 크레딧 약 ${쓴크레딧.toLocaleString()}\n`)
