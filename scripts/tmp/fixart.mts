// 안 열리는 작가 표지를 그 작가의 다른 카드로 바꾼다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const IDX = 'public/artists/index.json'
const arts = JSON.parse(readFileSync(IDX, 'utf8')) as { slug: string; en: string; cover?: string }[]
const target = arts.find((a) => a.slug === 'miranda-branley')!
console.log(`  ${target.en} — 지금 표지: ${target.cover}`)

// 그 작가 파일에서 다른 카드를 찾는다.
let cands: string[] = []
try {
  const d = JSON.parse(readFileSync(`public/artists/${target.slug}.json`, 'utf8')) as { cards?: { img?: string }[] }
  cands = (d.cards ?? []).map((c) => c.img ?? '').filter((u) => u && u !== target.cover)
} catch {
  console.log('  작가 파일이 없습니다')
}
console.log(`  후보 ${cands.length}장`)
const alive = async (u: string) => {
  try {
    const r = await fetch(u, { headers: { Range: 'bytes=0-0' } })
    return r.ok
  } catch { return false }
}
let picked = ''
for (const u of cands.slice(0, 20)) if (await alive(u)) { picked = u; break }
if (picked) {
  console.log(`  → 바꿀 표지: ${picked}`)
  if (process.argv.includes('--write')) {
    target.cover = picked
    writeFileSync(IDX, JSON.stringify(arts))
    console.log('  저장했습니다')
  } else console.log('  저장하려면 --write')
} else {
  console.log('  열리는 카드를 못 찾았습니다')
}
