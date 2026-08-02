// 북미판 세트의 "한글 이름 → 원래 영어 이름" 사전을 만든다.
//
// 왜 필요한가: 북미판 세트는 원래 이름이 영어인데, 화면에는 한글로 보여준다
// ("Perfect Order" → "퍼펙트 오더"). 그런데 이베이·TCGplayer로 검색할 때 그 한글을
// 다시 영어로 되돌리지 못해 한글 그대로 나갔다(2026-08-03 기준 213개 중 177개).
// 영어 이름은 public/sets/index.json에 그대로 있으므로 추측할 필요가 전혀 없다 —
// 화면에 쓰는 것과 똑같은 규칙(koSet)으로 한글을 만들어 짝지어 두면 된다.
//
// ⚠️ 일본판 세트는 넣지 않는다. 그쪽 name은 일본어라 영어 검색어로 쓸 수 없다
//    (일본판 세트의 영문명은 translateQueryToEnglish.ts의 PACK_KO_EN에 손으로 적는다).
//
// 세트가 늘거나 한글 이름 규칙(setNameKo.ts)을 고치면 다시 돌린다:
//   npx tsx scripts/gen-set-name-ko-en.mts
import { readFileSync, writeFileSync } from 'node:fs'
import { koSet } from '../src/lib/cardCatalog.ts'

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
console.log(`북미판 세트 한글→영어 ${Object.keys(sorted).length}개를 src/data/setNameKoEn.json에 저장했습니다.`)
if (clash.length) {
  console.log(`\n한글 이름이 겹쳐서 뺀 것 ${clash.length}개:`)
  clash.forEach((c) => console.log(`  ${c}`))
}
