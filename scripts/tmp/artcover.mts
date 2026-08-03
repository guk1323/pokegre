// 작가별 목록 표지가 실제로 열리는지 확인한다.
import { readFileSync } from 'node:fs'
const a = JSON.parse(readFileSync('public/artists/index.json', 'utf8')) as { slug: string; en: string; cover?: string }[]
const list = a.filter((x) => (x.cover ?? '').trim())
const bad: { slug: string; en: string; cover: string }[] = []
let i = 0
async function worker() {
  while (i < list.length) {
    const x = list[i++]
    try {
      const r = await fetch(x.cover!, { headers: { Range: 'bytes=0-0' } })
      if (!r.ok) bad.push({ slug: x.slug, en: x.en, cover: x.cover! })
    } catch { bad.push({ slug: x.slug, en: x.en, cover: x.cover! }) }
  }
}
await Promise.all(Array.from({ length: 16 }, worker))
console.log(`작가 표지 ${list.length}개 중 안 열리는 것 ${bad.length}개`)
bad.slice(0, 15).forEach((x) => console.log(`  ${x.slug.padEnd(22)} ${x.en.slice(0, 20).padEnd(22)} ${x.cover.slice(0, 50)}`))
if (bad.length > 15) console.log(`  … 그 밖 ${bad.length - 15}명`)
