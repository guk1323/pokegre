// 카드 이름에 HTML 기호가 글자 그대로 남아 있는 것을 고친다.
//
// 원본(TCGdex)에서 받을 때 "&"가 "&amp;"로 들어온 카드가 있다. 화면은 이걸 기호로
// 되돌리지 않으므로 "리자몽&amp;테일나 GX"라고 그대로 보이고, 검색도 안 잡힌다.
// TAG TEAM 카드가 대부분이라 인기 카드에 몰려 있었다.
//
// 쓰기: node scripts/fix-html-entities.mjs          (몇 장인지만)
//       node scripts/fix-html-entities.mjs --write  (저장)
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
// &amp;amp; 처럼 두 번 걸린 것도 있어서 더 바뀌지 않을 때까지 되돌린다.
const decode = (s) => {
  let out = s
  for (let i = 0; i < 5; i++) {
    const next = out
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENTITIES[n])
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    if (next === out) break
    out = next
  }
  return out
}

let total = 0
for (const dir of ['public/sets', 'public/packsim']) {
  for (const f of await readdir(dir)) {
    if (f === 'index.json') continue
    const file = path.join(dir, f)
    const d = JSON.parse(await readFile(file, 'utf8'))
    let n = 0
    for (const c of d.cards ?? []) {
      const fixed = decode(c.name ?? '')
      if (fixed !== c.name) {
        if (n === 0) console.log(`  ${f}`)
        if (n < 3) console.log(`     ${c.n}  ${c.name}  →  ${fixed}`)
        c.name = fixed
        n++
      }
    }
    if (n) {
      total += n
      if (n > 3) console.log(`     …외 ${n - 3}장`)
      if (WRITE) await writeFile(file, JSON.stringify(d))
    }
  }
}
console.log(`\n합계 ${total}장`)
if (!WRITE) console.log('저장하려면 --write')
