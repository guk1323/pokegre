// 【TCG 추이 씨앗 만들기】 맥북에 쌓인 TCGplayer 날짜별 추이를 배포용 한 파일로 접는다.
//
// 왜 필요한가: TCG 추이는 **덤프에 없어서** 카드를 한 장씩 물어야 나온다(크레딧 4만/2만 장).
//   그런데 그 자료가 사는 곳은 화면 저장소(`/data/card-history`)라 **씨앗에 안 담겨 있었고**,
//   맥북에서 아무리 받아도 운영으로 갈 배가 없었다(2026-08-27에 4만 크레딧을 그렇게 흘렸다).
//
// ⚠️⚠️ **`card-history` 폴더를 통째로 씨앗에 넣지 않는다.** 그 폴더에는 승격이 굽는
//    등급 시세(`gx`)·낱개(`s`)·그래프(`h`)가 같이 산다. 통째로 실어 보내면 **운영이 구운
//    값을 맥북 것으로 덮어쓴다** — 맥북은 승격을 안 하므로 그 칸들이 비어 있다.
//    그래서 **`tcg` 칸만** 뽑아 따로 담는다(9.8MB → 압축 1.4MB).
//
// 쓰기: node scripts/ebay-check/make-tcg-seed.mjs
//   → seed/tcg-history.json.gz
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const 뿌리 = new URL('../..', import.meta.url).pathname
const 기록폴더 = path.join(뿌리, 'data', 'card-history')
const 나갈곳 = path.join(뿌리, 'seed', 'tcg-history.json.gz')

const 통 = {}
let 봄 = 0
let 담음 = 0
for (const f of readdirSync(기록폴더).filter((x) => x.endsWith('.json'))) {
  봄++
  let j
  try {
    j = JSON.parse(readFileSync(path.join(기록폴더, f), 'utf8'))
  } catch {
    continue
  }
  const t = j?.tcg
  if (!t?.h || !Object.keys(t.h).length) continue
  통[f.replace('.json', '')] = t
  담음++
}

mkdirSync(path.dirname(나갈곳), { recursive: true })
const 덩이 = gzipSync(Buffer.from(JSON.stringify(통)), { level: 9 })
writeFileSync(나갈곳, 덩이)
console.log(
  `[TCG 씨앗] 카드 ${봄.toLocaleString()}장을 훑어 추이 있는 ${담음.toLocaleString()}장을 담았습니다 · ` +
    `${(덩이.length / 1024 / 1024).toFixed(1)}MB → seed/tcg-history.json.gz`,
)
