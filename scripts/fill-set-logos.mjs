// 세트 로고가 없는 세트를 limitless에서 채운다 → public/sets/index.json의 logo
//
// 왜 필요한가: "오늘의 상점"과 세트 목록은 박스 사진(boxImg)이나 로고(logo)를 쓴다.
// 둘 다 없으면 그 자리가 비어 보인다 — 사이버저지·나이트원더러가 그랬다.
// limitless는 세트 코드로 로고를 준다(s3.limitlesstcg.com/sets/jp/<코드>.png).
//
// ⚠️ 실제로 받아지는 것만 넣는다(404면 건너뛴다). 없는 주소를 적어 두면 화면에서
//    깨진 이미지가 되고, 그건 빈칸보다 나쁘다.
//
// 쓰기: node scripts/fill-set-logos.mjs          (몇 개 채워지는지만)
//       node scripts/fill-set-logos.mjs --write  (저장)
import { readFile, writeFile } from 'node:fs/promises'

const WRITE = process.argv.includes('--write')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const file = 'public/sets/index.json'
const idx = JSON.parse(await readFile(file, 'utf8'))
const targets = idx.filter((s) => !s.logo && !s.boxImg && s.id)

console.log(`로고·박스사진이 둘 다 없는 세트 ${targets.length}개`)
let filled = 0
for (const s of targets) {
  const lang = s.ed === 'ja' || s.slug.startsWith('ja-') ? 'jp' : 'en'
  const url = `https://s3.limitlesstcg.com/sets/${lang}/${s.id}.png`
  let ok = false
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } })
    ok = r.ok
  } catch {
    /* 못 받으면 건너뛴다 */
  }
  if (ok) {
    s.logo = url
    filled++
    console.log(`  ${s.slug.padEnd(14)} ${s.name}`)
  }
  await sleep(200)
}
console.log(`\n${filled}개 채움`)
if (WRITE && filled) {
  await writeFile(file, JSON.stringify(idx))
  console.log('저장했다')
} else if (!WRITE) {
  console.log('저장하려면 --write')
}
