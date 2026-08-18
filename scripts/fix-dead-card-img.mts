// 막힌 그림 주소를 살아 있는 곳으로 갈아 끼운다.
//
// ⚠️ **두드려 본 것만 바꾼다.** 새 주소가 실제로 200으로 열리는지 확인하고, 열리는
//    것만 파일에 쓴다. 규칙으로 주소를 만들어 놓고 확인을 안 하면, 오늘 M4 120번처럼
//    "있다고 적혀 있는데 안 열리는" 카드가 생긴다(2026-08-11에 실제로 그랬다).
import { readFileSync, writeFileSync } from 'node:fs'

const 세트 = process.argv[2] // 예: ja-SVM
const 코드 = process.argv[3] // Limitless 세트 코드, 예: SVM
if (!세트 || !코드) {
  console.log('쓰는 법: npx tsx scripts/_tmp-fiximg.mts <세트슬러그> <Limitless코드>')
  process.exit(1)
}

const 열리나 = async (u: string) => {
  try {
    const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(12000) })
    return r.status === 200
  } catch {
    return false
  }
}

const 길 = `public/sets/${세트}.json`
const j = JSON.parse(readFileSync(길, 'utf-8')) as { cards: { n: string; img?: string; name?: string }[] }

let 바꿈 = 0
let 그대로 = 0
let 못찾음 = 0
for (const c of j.cards) {
  const 지금 = (c.img ?? '').trim()
  if (!지금 || !지금.includes('tcgplayer')) continue
  // 지금 주소가 살아 있으면 손대지 않는다.
  if (await 열리나(지금)) {
    그대로++
    continue
  }
  const 번호 = String(c.n).split('~')[0]
  if (!/^\d+$/.test(번호)) {
    못찾음++
    continue
  }
  const 새 = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/${코드}/${코드}_${Number(번호)}_R_JP_SM.png`
  if (await 열리나(새)) {
    c.img = 새
    바꿈++
  } else {
    못찾음++
  }
}
writeFileSync(길, JSON.stringify(j))
console.log(`${세트}: 갈아 끼움 ${바꿈}장 · 원래 멀쩡 ${그대로}장 · 못 찾음 ${못찾음}장`)
