/**
 * **홈 「최신 발매 박스 시세」에 걸 팩 목록을 만든다.** → `src/data/boxSets.json`
 *
 * 왜 스크립트로 미리 만드나 — 서버는 한글 세트 이름을 일본어로 못 옮긴다.
 * 번역기(`src/lib/translateQuery.ts`)가 JSON을 `with { type: 'json' }` 없이 불러와서,
 * Vite는 되지만 **서버(node가 .ts를 그대로 도는 자리)에서는 못 불러온다**(실측).
 * 그래서 「어떤 팩을 어떤 일본어로 물을지」는 여기서 정해 두고, **값만 서버가 매일 받는다.**
 *
 * ⚠️ **새 팩이 나오면 다시 돌린다.** 안 돌리면 새 팩이 홈에 안 걸린다(값은 계속 갱신된다).
 * ⚠️ 여기서 스니커덩크에 한 번 물어 **슈링크 있는 박스가 실제로 있는 팩만** 담는다.
 *    없는 팩을 담아 두면 서버가 매일 헛물을 켠다.
 *
 * 실행:  npx tsx scripts/gen-box-sets.mts          훑기만
 *        npx tsx scripts/gen-box-sets.mts --write  src/data/boxSets.json 에 적기
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { translateSearchQuery, 팩앞머리 } from '../src/lib/translateQuery.ts'
import setNamesKo from '../src/data/setNamesKo.json' with { type: 'json' }

const WRITE = process.argv.includes('--write')
const UA = 'Mozilla/5.0 (compatible; pokemon-card-price-tracker/0.1; personal use)'
/** 홈에 놓을 칸 수. 늘리려면 여기와 화면 쪽 grid 를 같이 본다. */
const 담을수 = 6
/** 이보다 옛 팩은 「최신 발매」가 아니다. 헛물 켜는 요청을 줄이는 몫도 한다. */
const 언제부터 = '2025-01-01'

type 세트 = { slug: string; ed: string; id?: string; name: string; releaseDate?: string; boxImg?: string }
const idx = JSON.parse(readFileSync('public/sets/index.json', 'utf8')) as 세트[]
const 한글이름 = new Map((setNamesKo as { ko: string; slug: string }[]).map((s) => [s.slug, s.ko]))

/** 세트 이름에서 그 세트의 코드를 뗀다. **App.tsx의 `세트검색말`과 같은 규칙**이어야 한다. */
function 검색말(ko: string, id: string): string {
  if (!id) return ko
  const 뗀 = ko.replace(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*`, 'i'), '').trim()
  return 뗀 || ko
}
/** 검색창과 **같은 길**로 일본어를 만든다(앞머리 찾기까지). 못 옮기면 null. */
function 일본말(q: string): string | null {
  const j = translateSearchQuery(q)
  if (!/[가-힣]/.test(j)) return j
  return 팩앞머리(q)
}
const 쉬기 = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function 물어(kw: string) {
  const p = new URLSearchParams({
    func: 'all', refId: 'search', keyword: kw, sortKey: 'default',
    cardVersion: '2', brandIds: 'pokemon', perPage: '24', page: '1',
  })
  const r = await fetch(`https://snkrdunk.com/v3/search?${p}`, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw new Error(`스니커덩크 ${r.status}`)
  return ((await r.json()) as { search?: { products?: any[] } }).search?.products ?? []
}

/**
 * **그 팩의 슈링크 있는 박스** 하나.
 * ⚠️ 「シュリンクなし」(비닐 뜯긴 것)는 20~30% 싸다 — 스톰에메랄다 13,300엔 ↔ 9,500엔.
 *    섞으면 같은 자리에 다른 물건 값이 들어가 값이 튄다.
 * ⚠️ 「セット」는 박스가 아니라 묶음 상품이다(프리미엄 덱 세트 등).
 */
export function 박스고르기(products: any[]) {
  return products.find((p) => {
    const t = String(p?.title ?? '')
    return p?.supershipLog?.categoryId === '6/26'
      && t.includes('ボックス') && !t.includes('シュリンクなし') && !t.includes('セット')
      && Number(p?.salePrice) > 0
  })
}

// 발매일이 최근인 것부터. 영문판 전용 세트는 일본 마켓에 없어 **일본어로 못 옮기는 데서** 걸러진다.
// ⚠️ 30주년은 우리 도감에 `en-ME`로만 있다(일본판 M6a는 아직 목록이 안 열렸다). 그래도
//    스니커덩크에는 일본판 박스가 올라와 있어서, 판을 안 가리고 이름으로 찾는다.
const 후보 = idx
  .filter((s) => s.releaseDate && String(s.releaseDate) >= 언제부터)
  .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))

const 담은것: { slug: string; ko: string; q: string; ja: string; img: string; releaseDate: string }[] = []
const 버린것: string[] = []
for (const s of 후보) {
  if (담은것.length >= 담을수) break
  const ko = 한글이름.get(s.slug)
  if (!ko) { 버린것.push(`${s.slug} 한글 이름 없음`); continue }
  const q = 검색말(ko, s.id ?? '')
  const ja = 일본말(q)
  if (!ja) { 버린것.push(`${s.slug} 일본어로 못 옮김(${ko})`); continue }
  if (담은것.some((x) => x.ja === ja)) { 버린것.push(`${s.slug} 같은 팩이 이미 있음(${ja})`); continue }
  let ps: any[]
  try { ps = await 물어(ja) } catch (e) { 버린것.push(`${s.slug} ${(e as Error).message}`); continue }
  await 쉬기(700) // 스니커덩크에 부담을 덜 준다(예전에 조사하던 컴퓨터가 차단당했다).
  const box = 박스고르기(ps)
  if (!box) { 버린것.push(`${s.slug} 슈링크 있는 박스 없음(${ja})`); continue }
  담은것.push({ slug: s.slug, ko, q, ja, img: String(box.imageUrl ?? s.boxImg ?? ''), releaseDate: String(s.releaseDate) })
  console.log(`  ○ ${ko.padEnd(24)} ${ja.padEnd(20)} ${Number(box.salePrice).toLocaleString()}엔`)
}

console.log(`\n담은 팩 ${담은것.length}개`)
if (버린것.length) console.log('버린 것:\n  ' + 버린것.slice(0, 10).join('\n  '))
if (담은것.length < 3) { console.log('\n3개도 못 채웠습니다 — 파일을 안 건드립니다.'); process.exit(1) }
if (WRITE) {
  writeFileSync('src/data/boxSets.json', JSON.stringify(담은것, null, 1) + '\n')
  console.log('\nsrc/data/boxSets.json 에 적었습니다.')
} else {
  console.log('\n(훑기만 했습니다. 적으려면 --write)')
}
