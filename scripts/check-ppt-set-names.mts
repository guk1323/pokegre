// PPT 세트 이름 대응표(src/data/pptSetNames.json)가 엉뚱한 세트를 가리키는지 검사한다.
//
// 왜: 이 표가 틀리면 **엉뚱한 세트로 정확히 좁혀진다**. 화면은 "그 카드를 찾았다"고
// 믿고 아무 말 없이 열어 버린다. 실제로 en-ex5.5(Poké Card Creator Pack)가
// "Kids WB Promos"로 적혀 있어서, 나무지기 1번을 눌렀더니 다른 세트의 41만원짜리
// 카드가 열렸다(운영자 점검 중 발견 2026-08-06). 번호가 우연히 1/5로 맞아떨어져
// 화면 쪽 안전장치로는 못 잡는 종류다.
//
// 검사 방법은 판에 따라 다르다:
//  · 북미판 — 우리 이름도 저쪽 이름도 영문이라 글자로 견준다.
//  · 일본판 — 우리 이름이 한글이라 견줄 수 없다. 대신 저쪽 이름에 **우리 세트코드**가
//    들어 있는지 본다(PPT는 "SV10: …", "XY5-Bg: …"처럼 코드를 앞에 붙이는 일이 많다).
//
// ⚠️ 여기 걸린다고 다 틀린 건 아니다. "Sun & Moon"↔"SM Base Set"처럼 표기만 다른 것이
//    훨씬 많다. **사람이 봐야 하는 목록**을 뽑아 주는 도구다.
//
// 쓰는 법: npx tsx scripts/check-ppt-set-names.mts
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const map = JSON.parse(readFileSync(path.join(ROOT, 'src/data/pptSetNames.json'), 'utf-8')) as Record<string, string>
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  ed: 'ja' | 'en'
  id: string
  name: string
}[]
const meta = new Map(index.map((s) => [s.slug, s]))

const 다듬 = (s: string) =>
  s
    .toLowerCase()
    .replace(/^[a-z0-9.\-]{1,8}\s*:\s*/, '') // "SV03: " 같은 접두 제거
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** 두 글자열이 얼마나 닮았나(0~1). 짧은 쪽이 긴 쪽에 들어 있으면 1로 본다. */
function 닮음(a: string, b: string): number {
  if (!a || !b) return 0
  if (a.includes(b) || b.includes(a)) return 1
  const A = new Set(a.split(' ').filter(Boolean))
  const B = new Set(b.split(' ').filter(Boolean))
  const 겹침 = [...A].filter((w) => B.has(w)).length
  return 겹침 / Math.max(A.size, B.size)
}

const 볼것: string[] = []
let 검사 = 0
for (const [slug, ppt] of Object.entries(map)) {
  const s = meta.get(slug)
  if (!s) {
    볼것.push(`  ? ${slug.padEnd(14)} (우리 세트 목록에 없는 슬러그) → ${ppt}`)
    continue
  }
  검사++
  if (s.ed === 'en') {
    const r = 닮음(다듬(s.name), 다듬(ppt))
    if (r < 0.4) 볼것.push(`  ? ${slug.padEnd(14)} 우리: ${s.name.slice(0, 32).padEnd(34)} → PPT: ${ppt}`)
  } else {
    const code = s.id.toLowerCase().replace(/[-+ ]/g, '')
    const p = ppt.toLowerCase().replace(/[-+ ]/g, '')
    if (code && !p.includes(code)) 볼것.push(`  ? ${slug.padEnd(14)} 코드 ${s.id.padEnd(8)} ${s.name.slice(0, 20).padEnd(22)} → PPT: ${ppt}`)
  }
}

console.log(`  대응표 ${Object.keys(map).length}개(우리 세트와 짝지어진 것 ${검사}개) · 사람이 봐야 할 것 ${볼것.length}개\n`)
for (const l of 볼것) console.log(l)
console.log(
  `\n  ⚠️ 여기 걸린 것이 다 틀린 건 아니다. 표기만 다른 것(Sun & Moon ↔ SM Base Set)이 대부분이다.\n` +
    `     정말 다른 세트를 가리키는 것만 골라 지운다 — 틀린 것보다 빈칸이 낫다.`,
)
