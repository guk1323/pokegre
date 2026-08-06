// 도감·세트 화면에 **일본어가 그대로 나오는 카드**가 몇 장인지 센다.
//
// 왜: 이름을 한글로 바꾸는 사전이 못 잡은 카드는 화면에 「リザードン」처럼 일본어로
// 뜬다. 한 장씩 눌러 보면 언제 다 보나 — 세어 두면 어느 세트를 손봐야 하는지 바로 안다.
// 시세 검색에도 영향이 있다: PPT에 한글 대신 일본어가 나가면 대체로 0건이 된다.
//
// ⚠️ 세는 것은 화면이 실제로 쓰는 변환기(koreanizeTitle → koreanizeEnglishCardName)를
//    거친 뒤의 글자다. 원본을 세면 일본판 전부가 걸린다.
//
// 쓰는 법: npx tsx scripts/check-remaining-japanese.mts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  ed: 'ja' | 'en'
  name: string
  serie?: string
  releaseDate?: string
}[]
const meta = new Map(index.map((s) => [s.slug, s]))
const ko = (ed: 'ja' | 'en', n: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(n)) : koreanizeEnglishCardName(n)

// 히라가나·가타카나·한자. 한자는 카드 이름에 드물게 정상으로 쓰이기도 해서 따로 센다.
const 가나 = /[ぁ-んァ-ヶ]/
const 한자 = /[一-鿿]/

let 총 = 0
const 세트별 = new Map<string, { 가나: number; 한자: number; 예: string[] }>()
for (const f of readdirSync(path.join(ROOT, 'public/sets'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const m = meta.get(f.replace('.json', ''))
  if (!m || (m.serie ?? '').includes('Pocket')) continue
  const d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', f), 'utf-8')) as {
    cards?: { n: string; name: string }[]
  }
  for (const c of d.cards ?? []) {
    총++
    const 이름 = ko(m.ed, c.name)
    const g = 가나.test(이름)
    const h = !g && 한자.test(이름)
    if (!g && !h) continue
    const cur = 세트별.get(m.slug) ?? { 가나: 0, 한자: 0, 예: [] }
    if (g) cur.가나++
    else cur.한자++
    if (cur.예.length < 3) cur.예.push(`${c.n} ${c.name} → ${이름}`)
    세트별.set(m.slug, cur)
  }
}

const 가나총 = [...세트별.values()].reduce((a, b) => a + b.가나, 0)
const 한자총 = [...세트별.values()].reduce((a, b) => a + b.한자, 0)
console.log(`\n  실물 카드 ${총.toLocaleString()}장 (모바일 포켓 제외)\n`)
console.log(`  ${가나총 ? '✗' : '✓'} 히라가나·가타카나가 남음   ${가나총.toLocaleString()}장`)
console.log(`  ${한자총 ? '△' : '✓'} 한자가 남음               ${한자총.toLocaleString()}장 (정상인 것도 있다)`)
console.log(`\n  [손볼 세트 — 가나가 남은 장수 많은 순]`)
for (const [slug, v] of [...세트별].sort((a, b) => b[1].가나 - a[1].가나).slice(0, 12)) {
  if (!v.가나) continue
  const m = meta.get(slug)!
  console.log(`   ${String(v.가나).padStart(4)}장  ${slug.padEnd(12)} ${m.name.slice(0, 22).padEnd(24)} ${m.releaseDate ?? ''}`)
  for (const e of v.예.slice(0, 2)) console.log(`         ${e}`)
}
console.log('')
