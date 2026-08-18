// 시크릿 카드(AR·SR·SAR·MUR)의 공식 한글명을 **같은 세트의 같은 카드**에서 옮겨 채운다.
//
// ⚠️ 왜 필요한가: 포켓몬코리아 공식 카드검색은 세트의 **본세트 구간까지만** 올라오는
//    일이 있다. M5(어비스 아이)는 081번에서 끝나 082~118(AR·SR·SAR)이 통째로 비었다
//    — 082번부터 여섯 번호를 직접 눌러 확인했다(2026-08-16). 그런데 그 카드들은
//    **본세트에 같은 카드가 이미 있다**(82번 AR 짜랑랑 ↔ 본세트의 짜랑랑).
//    같은 카드니까 이름도 같다 — 지어내는 게 아니라 **우리가 이미 가진 공식 이름을
//    옮기는 것**이다.
//
// ⚠️⚠️ **이름이 글자 하나까지 같을 때만** 옮긴다. 그리고 그 영문 이름에 붙은 공식
//    한글명이 세트 안에서 **하나뿐일 때만** 옮긴다 — 둘 이상이면(무늬 변종 등 표기가
//    갈리는 경우) 손대지 않는다. 「틀린 것보다 빈칸」이 이 리포의 원칙이다.
//
// ⚠️ koImg·koNo는 **안 옮긴다.** 그건 그 카드 고유의 한국판 그림·번호라 시크릿 카드
//    것이 따로 있다(없으면 없는 것이지 본세트 것을 빌려 오면 딴 카드 그림이 뜬다).
//
// 사용법:
//   npx tsx scripts/fill-ko-name-from-same-set.mts            무엇이 채워지는지 보기만
//   npx tsx scripts/fill-ko-name-from-same-set.mts --write    실제로 public/sets에 쓴다
// ⚠️ --write 뒤에는 `npx tsx scripts/gen-card-index.mts`를 반드시 다시 돌린다
//    (색인 [4]번 칸이 공식 한글명이다 — 안 돌리면 검색이 옛 이름으로 남는다).

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SETS_DIR = path.resolve('public/sets')
const WRITE = process.argv.includes('--write')

interface Card {
  n: string
  name?: string
  koName?: string
  [k: string]: unknown
}

const files = (await readdir(SETS_DIR)).filter((f) => f.endsWith('.json') && !['index.json', 'ko-index.json'].includes(f))

// ⚠️ 무늬 변종(「… (Poke Ball Pattern)」)은 **여쭐 목록에서 뺀다.** 한국판 이름이
//    「… (몬스터볼 무늬)」로 본편과 다르므로 본편 이름을 옮기면 안 되고, 그렇다고
//    사장님께 수백 장을 여쭐 것도 아니다 — 무늬 표기는 따로 다룰 일이다.
const 무늬변종 = (name: string) => /\((?:[^)]*\b(?:Pattern|Mirror Holo|Holofoil|Cosmos Holo)\b[^)]*)\)/i.test(name)

let 채움 = 0
let 남음 = 0
const 세트별: [string, number][] = []
const 못채운것: string[] = []

for (const f of files) {
  const slug = f.replace('.json', '')
  const raw = await readFile(path.join(SETS_DIR, f), 'utf-8')
  const j = JSON.parse(raw) as Card[] | { cards?: Card[] }
  const cards: Card[] = Array.isArray(j) ? j : (j.cards ?? [])
  if (!cards.length) continue

  // 영문 이름 → 공식 한글명. 갈리면 null(=안 쓴다).
  const 표 = new Map<string, string | null>()
  for (const c of cards) {
    if (!c.name || !c.koName) continue
    const 있 = 표.get(c.name)
    if (있 === undefined) 표.set(c.name, c.koName)
    else if (있 !== c.koName) 표.set(c.name, null)
  }

  let 이세트 = 0
  for (const c of cards) {
    if (!c.name || c.koName) continue
    const v = 표.get(c.name)
    if (v) {
      c.koName = v
      이세트++
      채움++
    } else if (표.size && !무늬변종(c.name)) {
      // 이 세트에 공식 한글명이 어느 정도 있는데도 못 채운 카드 = 사장님께 여쭐 목록
      남음++
      if (못채운것.length < 40) 못채운것.push(`${slug} ${c.n} ${c.name}`)
    }
  }
  if (!이세트) continue
  세트별.push([slug, 이세트])
  if (WRITE) await writeFile(path.join(SETS_DIR, f), JSON.stringify(j))
}

console.log(`${WRITE ? '채웠습니다' : '채울 수 있습니다'} — ${채움}장 · 세트 ${세트별.length}개`)
for (const [s, n] of 세트별.sort((a, b) => b[1] - a[1])) console.log('  ' + String(n).padStart(4) + '장  ' + s)

console.log(`\n아직 공식 한글명이 없는 카드 ${남음}장 — 이건 사장님께 여쭤야 한다:`)
for (const x of 못채운것) console.log('  ' + x)

if (!WRITE) console.log('\n(보기만 했습니다. 실제로 쓰려면 --write)')
else console.log('\n⚠️ 이어서 `npx tsx scripts/gen-card-index.mts`를 돌리세요.')
