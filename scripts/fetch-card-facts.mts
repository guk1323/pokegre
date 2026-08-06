// 카드의 **종류**(포켓몬·트레이너·에너지)와 **도감 번호**를 원본에서 통째로 받아 둔다.
//
// 왜 두 가지가 다 필요한가:
//  ① 종류 — 도감(포켓몬명 목록)이 이름만 보고 짐작해서, "빛나는 리자몽"이나 "피카츄 ex"
//     같은 멀쩡한 포켓몬 카드가 "트레이너·에너지"로 표시된다. 340개가 그렇다.
//  ② 도감 번호 — 옛 세트는 원본의 이름 칸이 오염돼 있다. 포켓몬 영어 이름을 일반 단어로
//     번역해 버려서 화면에 "헌터"(Haunter=고우스트), "실"(Seel=쥬쥬), "울음소리"
//     (Growlithe=가디)로 뜬다. 이름으로는 손쓸 방법이 없지만 도감 번호는 정확하다
//     — 93번이면 고우스트다(2026-08-07 확인).
//
// 어떻게: 카드마다 상세를 부르면 38,000번(4시간)이지만, GraphQL로는 한 번에 수백 장씩
// 받는다. 몇 분이면 끝난다. 세트 단위 REST 필터(`?set=`)는 세트에 따라 0건을 주므로
// 쓰지 않는다 — 87세트가 그렇게 빠졌다.
//
// ⚠️ **GraphQL은 북미판 카드만 준다**(세트 코드가 base1·swsh10 꼴이고, 일본판 E1·neo4·
//    SM9a는 안 온다 — 2026-08-07 확인). 일본판은 세트 단위 REST(fetch-card-categories)로
//    따로 받아야 한다. 두 갈래를 합쳐야 전체가 덮인다.
//
// ⚠️ 무료다 — PPT 크레딧을 쓰지 않는다.
//
// 쓰는 법: npx tsx scripts/fetch-card-facts.mts [--write]
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))
const 쪽당 = 500

async function 물어보기(category: string, page: number): Promise<any[] | null> {
  const q = `{ cards(filters: {category: "${category}"}, pagination: {page: ${page}, itemsPerPage: ${쪽당}}) { id dexId } }`
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch('https://api.tcgdex.net/v2/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'pokegre' },
        body: JSON.stringify({ query: q }),
      })
      if (r.ok) {
        const j: any = await r.json()
        if (j?.errors) return null
        return j?.data?.cards ?? []
      }
      if (r.status < 500) return null
    } catch {
      /* 다시 본다 */
    }
    await nap(1000 * (i + 1))
  }
  return null
}

/** { "세트id-번호": { c: 종류, d: 도감번호 } } — 카드 id를 그대로 열쇠로 쓴다. */
const 결과: Record<string, { c: 'p' | 't' | 'e'; d?: number }> = {}
const 셈 = { p: 0, t: 0, e: 0 }

for (const [category, 표] of [
  ['Pokemon', 'p'],
  ['Trainer', 't'],
  ['Energy', 'e'],
] as const) {
  let page = 1
  for (;;) {
    const rows = await 물어보기(category, page)
    if (rows === null) {
      console.log(`\n  ⚠️ ${category} ${page}쪽을 못 받았다 — 여기서 멈춘다`)
      break
    }
    if (!rows.length) break
    for (const c of rows) {
      const id = String(c.id ?? '')
      if (!id) continue
      const dex = Array.isArray(c.dexId) && c.dexId.length ? Number(c.dexId[0]) : undefined
      결과[id] = dex ? { c: 표, d: dex } : { c: 표 }
      셈[표]++
    }
    process.stdout.write(`\r  ${category} ${page}쪽 · 포켓몬 ${셈.p} · 트레이너 ${셈.t} · 에너지 ${셈.e}      `)
    if (rows.length < 쪽당) break
    page++
    await nap(250)
  }
}

const 도감있음 = Object.values(결과).filter((v) => v.d).length
console.log(`\n\n  카드 ${Object.keys(결과).length.toLocaleString()}장`)
console.log(`  포켓몬 ${셈.p.toLocaleString()} · 트레이너 ${셈.t.toLocaleString()} · 에너지 ${셈.e.toLocaleString()}`)
console.log(`  도감 번호를 아는 카드 ${도감있음.toLocaleString()}장`)

if (WRITE) {
  writeFileSync(path.join(ROOT, 'src/data/cardFacts.json'), JSON.stringify(결과))
  console.log(`\n  src/data/cardFacts.json 에 저장했다.`)
} else {
  console.log(`\n  (미리보기 — --write 로 저장)`)
}
console.log('')
