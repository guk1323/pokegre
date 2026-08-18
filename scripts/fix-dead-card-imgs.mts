// 저쪽(tcgplayer) CDN에서 **죽은 그림**을 같은 카드의 다른 인쇄판 그림으로 메운다.
//
// ⚠️ 왜: tcgplayer 그림의 **4.3%(약 2,300장)가 403**이다 — 저쪽에 그 파일이 아예 없다.
//    지금은 카드 뒷면이 나온다. 특히 **무늬 변종**(마스터볼·몬스터볼 미러)에 몰려 있어,
//    사장님이 「마스터볼 미러가 비어 보인다」고 하신 게 이것이었다(2026-08-16).
//
// ⚠️⚠️ **그림이 다른 카드를 그 카드인 척 보여 주는 것이므로 반드시 밝혀야 한다.**
//    마스터볼 미러는 **그림 자체가 값어치**라, 일반판 그림을 말없이 보여 주면 사는 사람이
//    헷갈린다. 그래서 `imgBase: true`를 같이 적고 화면이 「일반판 그림입니다」를 겹쳐 적는다.
//    사장님 지시(2026-08-16): "일반 카드 이미지는 쓰되 마스터볼 미러라고 명시는 제대로".
//
// ⚠️ **같은 세트·같은 밑번호**일 때만 빌려 온다. 밑번호가 같으면 같은 카드의 다른 인쇄다
//    (「13」과 「13~MasterBallPattern.131」). 다른 카드 그림을 끌어오면 그게 새 거짓말이다.
// ⚠️ 빌려 줄 그림도 **살아 있어야** 한다 — 죽은 것끼리 바꿔 봐야 그대로 뒷면이다.
//
// 사용법:
//   npx tsx scripts/fix-dead-card-imgs.mts <죽은목록.json>            무엇이 바뀌는지 보기만
//   npx tsx scripts/fix-dead-card-imgs.mts <죽은목록.json> --write    실제로 public/sets에 쓴다
// ⚠️ --write 뒤에는 `npx tsx scripts/gen-card-index.mts`를 다시 돌린다(색인에도 그림이 있다).

import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const 목록길 = process.argv[2]
if (!목록길) { console.log('죽은 그림 목록 파일을 넘겨 주세요.'); process.exit(1) }

interface 카드 { n: string; name?: string; img?: string; imgBase?: boolean; [k: string]: unknown }
const 죽음 = JSON.parse(await readFile(목록길, 'utf-8')) as { slug: string; n: string; img: string }[]
const 죽은주소 = new Set(죽음.map((x) => x.img))
console.log('죽은 그림 ' + 죽음.length + '장')

const 밑번호 = (n: string) => String(n).split('~')[0].replace(/^0+(?=\d)/, '')
const SETS = path.resolve('public/sets')
const 세트별죽음 = new Map<string, Set<string>>()
for (const x of 죽음) {
  if (!세트별죽음.has(x.slug)) 세트별죽음.set(x.slug, new Set())
  세트별죽음.get(x.slug)!.add(String(x.n))
}

let 메움 = 0
let 못메움 = 0
const 못메운예: string[] = []
const 세트별메움: [string, number][] = []

for (const f of await readdir(SETS)) {
  if (!f.endsWith('.json') || ['index.json', 'ko-index.json'].includes(f)) continue
  const slug = f.slice(0, -5)
  const 죽은것 = 세트별죽음.get(slug)
  if (!죽은것) continue
  const raw = await readFile(path.join(SETS, f), 'utf-8')
  const j = JSON.parse(raw) as 카드[] | { cards?: 카드[] }
  const cards: 카드[] = Array.isArray(j) ? j : (j.cards ?? [])

  // 밑번호 → 살아 있는 그림을 가진 카드들
  const 살아있는 = new Map<string, 카드[]>()
  for (const c of cards) {
    if (!c.img || 죽은주소.has(c.img)) continue
    const b = 밑번호(c.n)
    if (!살아있는.has(b)) 살아있는.set(b, [])
    살아있는.get(b)!.push(c)
  }

  let 이세트 = 0
  for (const c of cards) {
    if (!죽은것.has(String(c.n))) continue
    // 같은 밑번호 중 **무늬가 안 붙은 것(원본)**을 먼저 고른다. 없으면 아무거나.
    const 후보 = 살아있는.get(밑번호(c.n)) ?? []
    const 빌릴 = 후보.find((x) => !String(x.n).includes('~')) ?? 후보[0]
    if (!빌릴) {
      못메움++
      if (못메운예.length < 8) 못메운예.push(slug + ' ' + c.n + ' ' + (c.name ?? ''))
      continue
    }
    c.img = 빌릴.img
    c.imgBase = true // ⚠️ 화면이 「일반판 그림」이라고 밝히는 데 쓴다
    메움++
    이세트++
  }
  if (이세트) {
    세트별메움.push([slug, 이세트])
    if (WRITE) await writeFile(path.join(SETS, f), JSON.stringify(j))
  }
}

console.log((WRITE ? '메웠습니다' : '메울 수 있습니다') + ' — ' + 메움 + '장 · 세트 ' + 세트별메움.length + '개')
console.log('빌릴 그림이 없어 그대로 둔 것 — ' + 못메움 + '장 (카드 뒷면으로 남는다)')
console.log('\n세트별 상위 15:')
for (const [s, n] of 세트별메움.sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log('  ' + String(n).padStart(4) + '  ' + s)
if (못메운예.length) { console.log('\n못 메운 예:'); for (const e of 못메운예) console.log('  ' + e) }
if (!WRITE) console.log('\n(보기만 했습니다. 실제로 쓰려면 --write)')
else console.log('\n⚠️ 이어서 `npx tsx scripts/gen-card-index.mts`를 돌리세요.')
