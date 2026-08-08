/**
 * 운영 서버를 통해 **아무 카드나 골라** 낙찰 자료가 성한지 본다.
 *
 * 왜: 규칙을 고칠 때마다 한두 장으로만 확인하면 다른 데가 깨진 걸 모른다
 * (사장님 지시 2026-08-08 "카드들 랜덤으로 골라서 계속 확인해봐야해").
 *
 * ⚠️ **배포하지 않고 본다.** 저쪽(PPT) 원본을 받아 **서버가 쓰는 그 함수(shapeEbayCards)**
 *    를 그대로 돌린다. 예전엔 운영 서버를 거쳐야만 볼 수 있어서 확인하려고 배포를 여섯 번
 *    했다 — 배포마다 방문자가 7초 멈춘다(2026-08-08 사장님 지적).
 *
 * ⚠️⚠️ **제목을 읽는 규칙은 서버와 같은 한 벌(src/lib/listingTitle.ts)만 쓴다.**
 *    따로 적었다가 세 번 헛발을 짚었다(2026-08-08):
 *      · 카드 번호 "232/091"과 제목 "232/91"을 그대로 견줘 멀쩡한 낙찰 386건이 걸렸다
 *      · BGS 부점수 "9/9/9.5"를 카드 번호로 읽었다
 *      · "PSA 6 Card"의 "6 Card"를 묶음 판매로 읽었다
 *
 * 보는 것:
 *   ① 갈라진 카드 — 저쪽이 한 칸에 묶어 둔 것을 우리가 번호로 가른 것
 *   ② 번호 다름 — 카드 번호와 다른 번호가 제목에 적힌 낙찰이 남았나
 *   ③ 변형 다름 — 마스터볼·몬스터볼이 어긋났나
 *   ④ 미감정에 등급 — 감정 카드가 미감정 칸에 남았나
 *   ⑤ 묶음 판매 — 여러 장을 한꺼번에 판 것
 *   ⑥ (참고) 값 벌어짐 — 섞임이라기보다 시장 편차일 때가 많다
 *
 * 실행: npx tsx scripts/spot-check-ebay.mts [세트수] [세트당 카드수]
 */
import { readFileSync } from 'node:fs'
import { 제목번호들, 제목등급칸, 묶음인가, 번호맞추기 } from '../src/lib/listingTitle.ts'
import { shapeEbayCards } from '../server/api.ts'

const key = (readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^POKEMON_PRICE_TRACKER_API_KEY=(.*)$/m) ?? [])[1]?.trim()
if (!key) { console.log('.env에 PPT 키가 없습니다'); process.exit(1) }

const 세트: [string, string][] = [
  ['japanese', 'Expansion Pack'], ['english', 'Base Set'], ['japanese', 'VMAX Climax'],
  ['english', 'Evolving Skies'], ['japanese', 'Shiny Treasure ex'], ['english', 'Crown Zenith'],
  ['japanese', 'Pokemon Card 151'], ['english', 'Obsidian Flames'], ['japanese', 'Terastal Festival ex'],
  ['english', 'Surging Sparks'], ['japanese', 'Wild Force'], ['english', 'Paldean Fates'],
  ['english', 'Neo Genesis'], ['english', 'Team Rocket'], ['japanese', 'Star Birth'],
  ['english', 'Lost Origin'], ['japanese', 'Clay Burst'], ['english', 'Silver Tempest'],
  ['japanese', 'Snow Hazard'], ['english', 'Astral Radiance'], ['japanese', 'Raging Surf'],
  ['english', 'Brilliant Stars'], ['japanese', 'Battle Partners'], ['english', 'Prismatic Evolutions'],
  // ⚠️ **번호 없는 프로모 칸도 넣는다.** 저쪽이 이름만으로 여러 카드를 묶어 두는 곳이라
  //    "갈라 담기"가 실제로 도는 유일한 자리다. 안 넣으면 그 길이 한 번도 시험되지 않는다.
  ['japanese', 'Unnumbered Promotional cards'], ['english', 'Unnumbered Promotional cards'],
]

type 낙찰 = { price: number; date: string; url: string; auction: boolean; title?: string }
type 등급 = { grade: string; count: number; minPrice: number; maxPrice: number; sales?: 낙찰[] }
type 카드 = {
  tcgPlayerId: string
  name: string
  cardNumber: string | null
  imageUrl?: string
  rarity?: string
  tcgplayer?: unknown
  grades?: 등급[]
}

const N = Number(process.argv[2] ?? 6)
const M = Number(process.argv[3] ?? 8)
const 변형표: [string, RegExp][] = [['마스터볼', /master\s*ball/i], ['몬스터볼', /pok[eé]\s*ball/i]]

const 고른세트 = [...세트].sort(() => Math.random() - 0.5).slice(0, N)
let 카드수 = 0
let 갈린것 = 0
const 문제: string[] = []
const 의심: string[] = []

for (const [lang, set] of 고른세트) {
  const p = new URLSearchParams({ language: lang, setName: set, limit: String(M), includeEbay: 'true', sortBy: 'price', sortOrder: 'desc' })
  const r = await fetch(`https://www.pokemonpricetracker.com/api/v2/cards?${p}`, { headers: { authorization: `Bearer ${key}` } })
  if (!r.ok) {
    문제.push(`  [${set}] 저쪽 ${r.status}`)
    continue
  }
  // 서버가 쓰는 그 함수를 그대로 돌린다 — 배포 없이 실제로 나갈 값을 본다.
  for (const c of shapeEbayCards(await r.json(), 'ebay') as unknown as 카드[]) {
    카드수++
    // ⚠️ **갈라 담은 카드는 원래 카드 것을 물려받으면 안 된다.** 사진·레어도·TCGplayer 값은
    //    묶인 칸 하나의 것이라, 물려주면 갈라 놓은 카드가 **전부 같은 값**을 달고 나온다
    //    (2026-08-08에 아홉 장이 같은 사진·같은 $50이었다).
    if (String(c.tcgPlayerId).includes('~')) {
      갈린것++
      if (c.imageUrl) 문제.push(`  [갈라진 카드에 남의 사진] ${c.name}  ${String(c.imageUrl).slice(-30)}`)
      if (c.tcgplayer) 문제.push(`  [갈라진 카드에 남의 TCGplayer 값] ${c.name}`)
      if (c.rarity) 문제.push(`  [갈라진 카드에 남의 레어도] ${c.name}  "${c.rarity}"`)
    }
    // 카드 번호도 제목과 **같은 규칙**으로 맞춘 뒤 견준다.
    const m = String(c.cardNumber ?? '').match(/(\d{1,4})\s*\/\s*(\d{1,3})/)
    const 내번호 = m ? 번호맞추기(m[1], m[2]) : ''
    const 내변형 = 변형표.filter(([, re]) => re.test(String(c.name))).map(([k]) => k)
    for (const g of c.grades ?? []) {
      // ⚠️ **셈에 들어가는 낙찰만** 값 벌어짐을 잰다. 범위 밖은 목록에만 보이고 이미
      //    평균·중앙값에서 빠져 있다.
      const 값 = (g.sales ?? [])
        .map((s) => s.price)
        .filter((v) => v > 0 && v >= (g.minPrice ?? 0) * 0.999 && v <= (g.maxPrice ?? Infinity) * 1.001)
      if (값.length >= 3 && Math.max(...값) / Math.min(...값) > 50)
        의심.push(`  [값 벌어짐] ${c.name} ${g.grade}  $${Math.min(...값)} ~ $${Math.max(...값)}`)
      for (const s of g.sales ?? []) {
        const t = String(s.title ?? '')
        if (!t) continue
        if (g.grade === 'ungraded' && 제목등급칸(t)) 문제.push(`  [미감정에 등급] ${c.name}  ${t.slice(0, 60)}`)
        if (묶음인가(t)) 문제.push(`  [묶음 판매] ${c.name} ${g.grade} $${s.price}  ${t.slice(0, 54)}`)
        const 딴변형 = 변형표.filter(([, re]) => re.test(t)).map(([k]) => k).filter((k) => !내변형.includes(k))
        if (딴변형.length) 문제.push(`  [변형 다름] ${c.name} ← ${딴변형.join(',')}  ${t.slice(0, 54)}`)
        if (!내번호) continue
        const ns = 제목번호들(t)
        if (ns.length && !ns.includes(내번호)) 문제.push(`  [번호 다름] ${c.name}(${내번호}) ← ${ns.join(',')}  ${t.slice(0, 54)}`)
      }
    }
  }
}

console.log(`세트 ${고른세트.length}개 · 카드 ${카드수}장 · 그중 갈라진 것 ${갈린것}장`)
console.log(고른세트.map(([l, s]) => `${s}(${l[0]})`).join(' · '))
console.log(문제.length ? `\n⚠️ 확실한 섞임 ${문제.length}개` : '\n확실한 섞임: 없음')
for (const x of 문제.slice(0, 25)) console.log(x)
console.log(의심.length ? `\n· 봐야 할 것(값이 크게 벌어짐) ${의심.length}개` : '\n· 봐야 할 것: 없음')
for (const x of 의심.slice(0, 12)) console.log(x)
