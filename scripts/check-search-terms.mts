// 카드를 눌렀을 때 **각 마켓에 실제로 나가는 검색어**를 전수로 계산해 본다.
//
// 왜: 화면에서 눌러 보는 검사는 크레딧을 쓰고 한 번에 세 장뿐이다. 검색어를 만드는
// 규칙(lib/pokedexRoute.ts)은 카드 정보만 있으면 계산할 수 있으므로, 40,489장 전부를
// 돌려 이상한 것이 몇 장인지 공짜로 셀 수 있다.
//
// 무엇이 이상한가:
//  · 스니커덩크에 이름만 나감 — 세트코드가 없어 "M6 113" 대신 "리자몽"으로 찾게 된다
//  · PPT에 한글이 나감 — 번역기가 받아 주긴 하지만, 사전에 없으면 그대로 나가 0건이 된다
//  · 세트로 못 좁힘 — PPT 대응표에 없고 우리 이름이 한글이라 setName을 못 보낸다
//
// 쓰는 법: npx tsx scripts/check-search-terms.mts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { 도감검색어, 마켓순서, pptSetName, type 도감카드정보 } from '../src/lib/pokedexRoute.ts'
import { koName } from '../src/lib/cardCatalog.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  ed: 'ja' | 'en'
  id: string
  name: string
  serie?: string
}[]
const meta = new Map(index.map((s) => [s.slug, s]))
// ⚠️ 화면과 같은 함수로 센다(2026-08-06).
const ko = koName

let 총 = 0
const 스니커덩크이름만: string[] = []
const PPT한글: string[] = []
const 세트못좁힘 = new Map<string, number>()

for (const f of readdirSync(path.join(ROOT, 'public/sets'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const m = meta.get(f.replace('.json', ''))
  if (!m || (m.serie ?? '').includes('Pocket')) continue
  const d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', f), 'utf-8')) as {
    cards?: { n: string; name: string }[]
  }
  for (const c of d.cards ?? []) {
    총++
    const 한장: 도감카드정보 = {
      ko: ko(m.ed, c.name),
      en: m.ed === 'en' ? c.name : '',
      raw: c.name,
      speciesEn: '',
      slug: m.slug,
      setCode: m.id,
      setName: m.name,
      setNameKo: m.name,
      num: c.n,
      jp: m.ed !== 'en',
    }
    for (const 마켓 of 마켓순서(한장.jp)) {
      const q = 도감검색어(한장, 마켓)
      if (마켓.source === 'snkrdunk' && !/\s/.test(q)) {
        if (스니커덩크이름만.length < 6) 스니커덩크이름만.push(`${m.slug} ${c.n} ${c.name} → "${q}"`)
      }
      if (마켓.source !== 'snkrdunk' && /[가-힣]/.test(q)) {
        if (PPT한글.length < 6) PPT한글.push(`${m.slug} ${c.n} ${c.name} → "${q}"`)
      }
    }
    if (!pptSetName(한장)) 세트못좁힘.set(m.slug, (세트못좁힘.get(m.slug) ?? 0) + 1)
  }
}

const 못좁힌장수 = [...세트못좁힘.values()].reduce((a, b) => a + b, 0)
console.log(`\n  실물 카드 ${총.toLocaleString()}장 (모바일 포켓 제외)\n`)
console.log(`  ${스니커덩크이름만.length ? '✗' : '✓'} 스니커덩크에 이름만 나감  ${스니커덩크이름만.length}장`)
for (const e of 스니커덩크이름만) console.log(`      ${e}`)
console.log(`  ${PPT한글.length ? '△' : '✓'} PPT에 한글이 나감        ${PPT한글.length}장 (번역기가 받는다)`)
for (const e of PPT한글) console.log(`      ${e}`)
console.log(`  ${못좁힌장수 ? '△' : '✓'} 세트로 못 좁힘           ${못좁힌장수.toLocaleString()}장 · 세트 ${세트못좁힘.size}개`)
for (const [slug, n] of [...세트못좁힘].sort((a, b) => b[1] - a[1]).slice(0, 10))
  console.log(`      ${String(n).padStart(4)}장  ${slug.padEnd(12)} ${meta.get(slug)?.name ?? ''}`)
console.log('')
