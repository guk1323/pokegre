// 서로 다른 세트가 화면에 똑같은 한글 이름으로 뜨면 어느 게 어느 건지 모른다.
import { readFileSync } from 'node:fs'
import { koSet } from '../../src/lib/cardCatalog.ts'
type S = { slug: string; name: string; ed?: 'ja' | 'en'; serie?: string }
const idx = JSON.parse(readFileSync('public/sets/index.json', 'utf8')) as S[]
const ed = (s: S) => s.ed ?? (s.slug.startsWith('ja-') ? 'ja' : 'en')
const by = new Map<string, S[]>()
for (const s of idx) {
  const k = `${ed(s)}\t${koSet(ed(s), s.name)}`
  by.set(k, [...(by.get(k) ?? []), s])
}
const dup = [...by].filter(([, v]) => v.length > 1)
console.log(`같은 판 안에서 이름이 똑같은 묶음 ${dup.length}건`)
for (const [k, v] of dup) {
  const [e, name] = k.split('\t')
  console.log(`  [${e}] "${name}"  ← ${v.map((s) => `${s.slug}(${s.name})`).join(' / ')}`)
}
