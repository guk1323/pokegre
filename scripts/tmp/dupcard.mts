// 원본이 다른 카드인데 화면에서 같은 이름이 되면, 번호까지 봐야 구별된다.
// 한 세트 안에서 그런 게 많으면 사전이 서로 다른 이름을 하나로 뭉갠 것이다.
import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeTitle } from '../../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../../src/lib/koreanizeEnglishTitle.ts'
const rows: [number, string][] = []
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const ja = f.startsWith('ja-')
  const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as { cards?: { n: string; name: string }[] }
  const by = new Map<string, Set<string>>()
  for (const c of d.cards ?? []) {
    if (!c.name) continue
    const ko = ja ? koreanizeEnglishCardName(koreanizeTitle(c.name)) : koreanizeEnglishCardName(c.name)
    if (!by.has(ko)) by.set(ko, new Set())
    by.get(ko)!.add(c.name)
  }
  for (const [ko, origs] of by) {
    if (origs.size > 1) rows.push([origs.size, `  ${f.replace('.json', '').padEnd(12)} "${ko}"  ← ${[...origs].join(' / ')}`])
  }
}
rows.sort((a, b) => b[0] - a[0])
console.log(`원본이 다른데 화면에서 같은 이름이 되는 경우 ${rows.length}건`)
rows.slice(0, 25).forEach(([, r]) => console.log(r))
