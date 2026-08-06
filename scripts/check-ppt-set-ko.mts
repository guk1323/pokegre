// 시세 화면에 뜨는 세트 이름이 한글로 바뀌는지 전수로 센다.
//
// 왜: PPT가 주는 세트 이름은 영문이다("Start Deck 100 Battle Collection"). 목록에서는
// 한글로 보다가 상세에서 영문을 보면 같은 세트인지도 헷갈린다(점검 중 발견 2026-08-06).
// 지금은 slug↔PPT 이름 대응표를 거꾸로 써서 한글로 바꾸는데, 대응표에 없는 세트는
// 여전히 영문으로 나간다. 몇 개나 되는지 알아야 손볼 곳이 보인다.
//
// 쓰는 법: npx tsx scripts/check-ppt-set-ko.mts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { koSet } from '../src/lib/cardCatalog.ts'
import { koSetName } from '../src/lib/setNameKo.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const map = JSON.parse(readFileSync(path.join(ROOT, 'src/data/pptSetNames.json'), 'utf-8')) as Record<string, string>
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  ed: 'ja' | 'en'
  name: string
  serie?: string
}[]
const bySlug = new Map(index.map((s) => [s.slug, s]))

// 화면이 하는 것과 같은 순서: 대응표로 먼저, 없으면 영문 세트명 사전.
const 역방향 = new Map<string, string>()
for (const [slug, ppt] of Object.entries(map)) {
  const s = bySlug.get(slug)
  if (s) 역방향.set(ppt.toLowerCase(), koSet(s.ed, s.name))
}
const 한글로 = (ppt: string) => 역방향.get(ppt.toLowerCase()) || koSetName(ppt)

let 대응표로 = 0
let 사전으로 = 0
const 영문그대로: string[] = []
for (const ppt of new Set(Object.values(map))) {
  const ko = 한글로(ppt)
  if (역방향.has(ppt.toLowerCase())) 대응표로++
  else if (/[가-힣]/.test(ko)) 사전으로++
  else 영문그대로.push(`${ppt}  →  ${ko}`)
}

const 총 = new Set(Object.values(map)).size
console.log(`\n  PPT가 쓰는 세트 이름 ${총}가지\n`)
console.log(`  ✓ 대응표로 한글화        ${대응표로}가지`)
console.log(`  ✓ 영문 사전으로 한글화    ${사전으로}가지`)
console.log(`  ${영문그대로.length ? '△' : '✓'} 영문 그대로 나감        ${영문그대로.length}가지`)
for (const e of 영문그대로.slice(0, 12)) console.log(`      ${e}`)
if (영문그대로.length > 12) console.log(`      … 그 밖 ${영문그대로.length - 12}가지`)
console.log('')
