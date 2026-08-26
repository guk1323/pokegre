// 일본판 세트의 빈 그림을 **limitless**에서 메운다.
//
// ⚠️ 왜: tcgplayer가 지운 그림 가운데 **요즘 일본판 세트**는 limitless에 살아 있다.
//    주소가 `tpc/<세트코드>/<코드>_<번호>_R_JP_SM.png`로 규칙이 뚜렷하다.
// ⚠️⚠️ **세트 코드는 대문자·하이픈 없이**다. 처음에 우리 슬러그 그대로 `smG`·`M-P`로
//    두드려 「없다」고 결론냈는데, 실제로는 `SMG`·`MP`였다(2026-08-22). 없다고 적기 전에
//    대문자·하이픈 뺀 꼴을 반드시 같이 두드릴 것.
// ⚠️ 없는 번호에는 저쪽이 **403**을 준다(200으로 헛것을 주지 않는다 — 실측 확인).
//    그래서 「200이면 있다」로 봐도 된다.
// ⚠️⚠️ **이름은 일본판이라 낱말이 다르다.** Ultra Ball=ハイパーボール · Rare Candy=ふしぎなアメ ·
//    Acro Bike=ダートじてんしゃ. 로마자로 견주면 다 틀린 것처럼 보인다 —
//    포켓몬 이름만 `pokemonNames.json`(ja↔en)으로 자동 대조하고, 트레이너·에너지는
//    카드쪽(`limitlesstcg.com/cards/jp/<코드>/<번호>`) 제목을 뽑아 **사람이 한 번 본다.**
//    2026-08-22에 76장을 그렇게 확인하고 넣었다.
//
// 사용법:
//   npx tsx scripts/fill-imgs-limitless-jp.mts            보기만
//   npx tsx scripts/fill-imgs-limitless-jp.mts --write    public/sets에 쓴다
// ⚠️ --write 뒤에는 `npx tsx scripts/gen-card-index.mts`를 다시 돌린다.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const SETS = path.resolve('public/sets')
const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc'

/** 우리 세트 → limitless 세트 코드. 대문자·하이픈 없는 꼴이다. */
const 짝 = [['ja-smG', 'SMG'], ['ja-M-P', 'MP'], ['ja-SVP', 'SVP'], ['ja-smK', 'SMK']] as const

interface 카드 { n: string; name?: string; img?: string; [k: string]: unknown }

async function 살아있나(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'user-agent': 'pokegre-img/0.1' } })
    return r.ok
  } catch { return false }
}

let 메움 = 0, 없음 = 0
const 세트별: [string, number, number][] = []
for (const [slug, code] of 짝) {
  const 길 = path.join(SETS, slug + '.json')
  const j = JSON.parse(await readFile(길, 'utf-8')) as { cards: 카드[] }
  let 이세트 = 0, 이세트없음 = 0
  for (const c of j.cards) {
    if ((c.img ?? '').trim()) continue
    const num = String(c.n ?? '').split('~')[0].replace(/^#/, '').replace(/^0+(?=\d)/, '')
    if (!/^\d+$/.test(num)) { 이세트없음++; continue }
    const url = `${CDN}/${code}/${code}_${num}_R_JP_SM.png`
    if (!(await 살아있나(url))) { 이세트없음++; continue }
    c.img = url
    메움++; 이세트++
    await new Promise((r) => setTimeout(r, 120)) // 살살 두드린다
  }
  없음 += 이세트없음
  세트별.push([slug, 이세트, 이세트없음])
  if (이세트 && WRITE) await writeFile(길, JSON.stringify(j))
}
console.log((WRITE ? '메웠습니다' : '메울 수 있습니다') + ` — ${메움}장`)
console.log(`저쪽에도 없어 그대로 둔 것 — ${없음}장`)
for (const [s, n, m] of 세트별) console.log('  ' + String(n).padStart(4) + '장 (없음 ' + m + ')  ' + s)
if (!WRITE) console.log('\n실제로 쓰려면 --write 를 붙이세요.')
