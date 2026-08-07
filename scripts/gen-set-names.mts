// 세트 이름 사전 두 개를 만든다: 영문판 "한글→영어", 일본판 "한글→일본어".
//
// 왜 필요한가: 영문판 세트는 원래 이름이 영어인데, 화면에는 한글로 보여준다
// ("Perfect Order" → "퍼펙트 오더"). 그런데 이베이·TCGplayer로 검색할 때 그 한글을
// 다시 영어로 되돌리지 못해 한글 그대로 나갔다(2026-08-03 기준 213개 중 177개).
// 영어 이름은 public/sets/index.json에 그대로 있으므로 추측할 필요가 전혀 없다 —
// 화면에 쓰는 것과 똑같은 규칙(koSet)으로 한글을 만들어 짝지어 두면 된다.
//
// ⚠️ 일본판 세트는 넣지 않는다. 그쪽 name은 일본어라 영어 검색어로 쓸 수 없다
//    (일본판 세트의 영문명은 translateQueryToEnglish.ts의 PACK_KO_EN에 손으로 적는다).
//
// 세트가 늘거나 한글 이름 규칙(setNameKo.ts)을 고치면 다시 돌린다:
//   npx tsx scripts/gen-set-names.mts
import { readFileSync, writeFileSync } from 'node:fs'
import { koSet } from '../src/lib/cardCatalog.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'

type S = { slug: string; name: string; ed?: 'ja' | 'en' }
const idx = JSON.parse(readFileSync('public/sets/index.json', 'utf8')) as S[]

const out: Record<string, string> = {}
const clash: string[] = []
for (const s of idx) {
  const ed = s.ed ?? (s.slug.startsWith('ja-') ? 'ja' : 'en')
  if (ed !== 'en' || !s.name) continue
  const ko = koSet('en', s.name)
  // 한글이 하나도 없으면(이름이 원래 영어 그대로면) 넣을 이유가 없다.
  if (!/[가-힣]/.test(ko)) continue
  // 같은 한글이 서로 다른 영어를 가리키면 넣지 않는다 — 둘 중 하나로 잘못 보내느니
  // 안 바꾸는 게 낫다(리포 원칙: 틀린 것보다 빈칸).
  if (out[ko] && out[ko] !== s.name) {
    clash.push(`${ko} ← ${out[ko]} / ${s.name}`)
    delete out[ko]
    continue
  }
  if (!clash.some((c) => c.startsWith(`${ko} ←`))) out[ko] = s.name
}

const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])))
writeFileSync('src/data/setNameKoEn.json', `${JSON.stringify(sorted, null, 2)}\n`)
console.log(`영문판 세트 한글→영어 ${Object.keys(sorted).length}개를 src/data/setNameKoEn.json에 저장했습니다.`)
if (clash.length) {
  console.log(`\n한글 이름이 겹쳐서 뺀 것 ${clash.length}개:`)
  clash.forEach((c) => console.log(`  ${c}`))
}

// ── 일본판 세트: 화면에 쓰는 한글 이름 → 일본어 이름 ──────────────────────────
//
// 팩 사전(packNames.json)에 일본어 이름이 있는데도 스니커덩크 검색이 빗나가는 세트가
// 있다. 팩 사전은 **한글 이름으로** 짝을 짓는데 그 한글이 화면에 쓰는 이름과 다르기
// 때문이다("스노해저드" vs 팩 사전 "스칼렛&바이올렛 : 스노우해저드" — 우 한 글자 차이).
// 이름 대신 **세트 코드**로 이으면 표기가 어떻든 정확히 짝지어진다.
const packs = JSON.parse(readFileSync('src/data/packNames.json', 'utf8')) as {
  code: string
  ja: string
  ko: string
}[]
const byCode = new Map(packs.filter((p) => p.code && p.ja).map((p) => [p.code.toLowerCase(), p.ja]))

const jaOut: Record<string, string> = {}
const noJa: string[] = []
for (const s of idx) {
  const ed = s.ed ?? (s.slug.startsWith('ja-') ? 'ja' : 'en')
  if (ed !== 'ja' || !s.name) continue
  const ko = koSet('ja', s.name)
  if (!/[가-힣]/.test(ko)) continue
  const ja = byCode.get(s.slug.replace(/^ja-/, '').toLowerCase())
  if (!ja) {
    // 코드가 안 맞아도 다른 경로(팩 이름 사전·손으로 적은 보정)로 이미 되는 세트가
    // 많다. 실제로 한글이 남는 것만 물어볼 목록에 넣는다 — 안 그러면 65개가 뜨는데
    // 그중 47개는 멀쩡하다.
    if (/[가-힣]/.test(translateSearchQuery(ko))) noJa.push(`${s.slug} "${ko}"`)
    continue
  }
  if (jaOut[ko] && jaOut[ko] !== ja) {
    delete jaOut[ko]
    continue
  }
  jaOut[ko] = ja
}
// ⚠️ 팩 사전의 일본어 이름이 스니커덩크가 쓰는 이름과 다를 때가 있다. M-P가 그랬다 —
//    팩 사전은 "メガシンカ プロモ"인데 스니커덩크에서 0건이고, 우리가 쓰던
//    "メガ プロモカード"가 24건이었다. 그대로 넣었으면 되던 검색이 깨졌다.
//    그래서 넣기 전에 스니커덩크에 한 번씩 물어보고, 결과가 없는 이름은 뺀다.
//    (무료라 크레딧과 무관하다. 한 번 돌 때 100번 안팎이라 넉넉히 쉬어 가며 부른다.)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function snkrHits(keyword: string): Promise<number> {
  const u =
    'https://snkrdunk.com/v3/search?func=all&refId=search&sortKey=default&cardVersion=2' +
    `&brandIds=pokemon&perPage=24&page=1&keyword=${encodeURIComponent(keyword)}`
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!r.ok) return -1 // 못 물어봤으면 판단 보류(빼지 않는다)
    const j = (await r.json()) as { search?: { products?: unknown[]; rankingProducts?: unknown[] } }
    const p = j.search?.products?.length ? j.search.products : (j.search?.rankingProducts ?? [])
    return p.length
  } catch {
    return -1
  }
}

const dropped: string[] = []
if (!process.argv.includes('--no-verify')) {
  console.log(`\n스니커덩크에 ${Object.keys(jaOut).length}개를 확인합니다(무료, 1~2분)…`)
  for (const [ko, ja] of Object.entries(jaOut)) {
    const n = await snkrHits(ja)
    if (n === 0) {
      dropped.push(`${ko} → ${ja}`)
      delete jaOut[ko]
    }
    await sleep(400)
  }
}

const jaSorted = Object.fromEntries(Object.entries(jaOut).sort((a, b) => a[0].localeCompare(b[0])))
writeFileSync('src/data/setNameKoJa.json', `${JSON.stringify(jaSorted, null, 2)}\n`)
console.log(`\n일본판 세트 한글→일본어 ${Object.keys(jaSorted).length}개를 src/data/setNameKoJa.json에 저장했습니다.`)
if (dropped.length) {
  console.log(`\n스니커덩크에 그 이름으로 상품이 없어 뺀 것 ${dropped.length}개:`)
  dropped.forEach((d) => console.log(`  ${d}`))
}
if (noJa.length) {
  console.log(`\n⚠️ 팩 사전에 일본어 이름이 없어 못 넣은 세트 ${noJa.length}개 (사용자에게 물어볼 것):`)
  noJa.forEach((n) => console.log(`  ${n}`))
}
