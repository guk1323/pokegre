/**
 * **자기 PPT 번호를 아는데 그림만 빈 카드**를 채운다. 크레딧 0.
 *
 * 카드가 `tcg` 칸(저쪽 번호)을 이미 들고 있으면 그림 주소는 정해져 있다 —
 * `https://tcgplayer-cdn.tcgplayer.com/product/<번호>_in_400x400.jpg`.
 * 짝짓기 추측이 아니라 **그 카드 자신의 번호**라 틀릴 자리가 없다.
 * (남는 빈칸은 PPT에 아예 없는 카드들 — 이 방법으로는 못 채운다.)
 *
 * 실행: npx tsx scripts/fill-imgs-from-own-tcg.mts --write
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const WRITE = process.argv.includes('--write')
const idx = JSON.parse(readFileSync(path.resolve('public/sets/index.json'), 'utf-8')) as { slug: string }[]
let 채움 = 0
for (const s of idx) {
  const 곳 = path.resolve('public/sets', `${s.slug}.json`)
  const j = JSON.parse(readFileSync(곳, 'utf-8')) as { cards?: { tcg?: string; img?: string }[] }
  let 바뀜 = false
  for (const c of j.cards ?? []) {
    if (!c.tcg || c.img) continue
    c.img = `https://tcgplayer-cdn.tcgplayer.com/product/${c.tcg}_in_400x400.jpg`
    채움++
    바뀜 = true
  }
  if (바뀜 && WRITE) writeFileSync(곳, JSON.stringify(j) + '\n')
}
console.log(`그림 채움 ${채움}장${WRITE ? ' (적음)' : ' (--write를 주면 적습니다)'}`)
