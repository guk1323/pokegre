/**
 * 새 일본 세트에 **같은 카드가 두 벌** 들어간 것을 합친다. 크레딧 0.
 *
 * 왜 — `ja-M2a`가 실제로는 250장인데 도감엔 **604장**이었다(2026-08-12 발견).
 * 세트를 열면 카드가 두 번 나오고, 그중 한 벌은 저쪽 번호도 레어도도 없어
 * 「값도 레어도도 없는 카드」로 보인다.
 *
 * | | 어디서 왔나 | 번호 | 이름 | 저쪽 번호(tcg) | 레어도 |
 * |---|---|---|---|---|---|
 * | 한 벌 | limitless | **001** | 일본어 (ヒビキのカイロス) | 없음 | 없음 |
 * | 다른 벌 | PPT 덤프 | **1** | 영문 (Ethan's Pinsir) | 있음 | 있음 |
 *
 * **한글로 옮기면 둘 다 「심향의 쁘사이저」로 같다** — 그래서 한글 이름으로 묶는다.
 * 번호가 「001」과 「1」로 달라서 여태 안 잡혔다(앞의 0을 떼면 같다).
 *
 * ⚠️ 이건 CLAUDE.md의 「옛 일본 세트 두 벌」과 **같은 병이고 다른 세트**다. 그때 쓴
 *    `merge-dup-jp-cards.mts`는 그림 주소에 영어 이름이 박힌 옛 세트만 다뤘는데,
 *    새 세트는 그림 이름이 `M2a_1_R_JP_SM.png` 꼴이라 이름이 없어 안 잡혔다.
 *
 * ⚠️⚠️ **한글 이름이 글자 하나까지 같을 때만 합친다.** 무늬 변종은 이름이
 *    「심향의 쁘사이저 (몬스터볼 무늬)」라 저절로 갈린다 — 번호만 보고 합치면
 *    그 변종에 엉뚱한 값이 붙는다. 틀린 것보다 빈칸.
 * ⚠️ **저쪽 번호를 가진 줄이 딱 하나일 때만** 합친다. 둘이면 어느 쪽인지 모른다.
 * ⚠️ 남기는 줄이 못 가진 것(한글 이름·한글 그림·한글 번호)은 **옮겨 담고** 버린다.
 * ⚠️ **막히지 않는 그림을 남긴다** — 버릴 쪽의 limitless 그림이 tcgplayer(403이 나는)
 *    그림보다 낫다(2026-08-12에 약 2,990장이 막혀 있었다).
 *
 * 쓰는 법: npx tsx scripts/merge-dup-jp-new-sets.mts [--write]
 * ⚠️ 합친 뒤에는 **`gen-card-index.mts` · `gen-pokedex.mts` ·
 *    `gen-card-name-suggestions.mts`를 반드시 다시 돌린다.**
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/koCardName'

const WRITE = process.argv.includes('--write')
const SETS = path.resolve('public/sets')
const 목록 = JSON.parse(readFileSync(path.join(SETS, 'index.json'), 'utf-8')) as {
  slug: string
  ed?: 'ja' | 'en'
  count?: number
}[]
const 세트표 = new Map(목록.map((s) => [s.slug, s]))

const 밑번호 = (n: unknown) => String(n ?? '').split('~')[0].replace(/^0+(?=\d)/, '')
const 안막히는그림 = (u: unknown) => !!u && !String(u).includes('tcgplayer-cdn')

type 카드 = { n?: string; name?: string; img?: string; tcg?: string; r?: string; koName?: string; koImg?: string; koNo?: string }

let 합침 = 0
let 한글살림 = 0
let 그림살림 = 0
let 애매해서둠 = 0
const 세트별: [string, number, number, number][] = []

for (const f of readdirSync(SETS)) {
  if (!f.endsWith('.json') || ['index.json', 'ko-index.json'].includes(f)) continue
  const slug = f.slice(0, -5)
  let j: { ed?: 'ja' | 'en'; cards?: 카드[]; count?: number }
  try {
    j = JSON.parse(readFileSync(path.join(SETS, f), 'utf-8'))
  } catch {
    continue
  }
  const cards = j.cards
  if (!Array.isArray(cards) || !cards.length) continue
  const meta = 세트표.get(slug)
  const ed = j.ed ?? meta?.ed ?? (slug.startsWith('en-') ? 'en' : 'ja')

  // **화면에 보이는 한글 이름**으로 묶는다(색인이 쓰는 것과 같은 함수).
  const 묶음 = new Map<string, 카드[]>()
  for (const c of cards) {
    const k = `${밑번호(c.n)}|${koName(ed, String(c.name ?? ''))}`
    const 있 = 묶음.get(k)
    if (있) 있.push(c)
    else 묶음.set(k, [c])
  }

  const 버릴 = new Set<카드>()
  for (const v of 묶음.values()) {
    if (v.length < 2) continue
    const 번호있음 = v.filter((c) => c.tcg)
    const 번호없음 = v.filter((c) => !c.tcg)
    if (번호있음.length !== 1 || !번호없음.length) {
      if (번호있음.length > 1 && 번호없음.length) 애매해서둠 += 번호없음.length
      continue
    }
    const 남길 = 번호있음[0]
    for (const 버릴것 of 번호없음) {
      if (!남길.koName && 버릴것.koName) {
        남길.koName = 버릴것.koName
        한글살림++
      }
      if (!남길.koImg && 버릴것.koImg) 남길.koImg = 버릴것.koImg
      if (!남길.koNo && 버릴것.koNo) 남길.koNo = 버릴것.koNo
      if (!안막히는그림(남길.img) && 안막히는그림(버릴것.img)) {
        남길.img = 버릴것.img
        그림살림++
      }
      // ⚠️ 레어도는 **남기는 줄 것을 그대로 둔다.** 버리는 쪽은 애초에 레어도가 없고,
      //    있더라도 판이 다른 값일 수 있어 옮기면 안 된다(사장님 지시 2026-08-12:
      //    "영문 일판 레어도가 다를수도 있으니까 정확한거 아니면 니가 유추해서 넣지마").
      버릴.add(버릴것)
      합침++
    }
  }

  if (!버릴.size) continue
  const 남은 = cards.filter((c) => !버릴.has(c))
  세트별.push([slug, 버릴.size, cards.length, 남은.length])
  if (WRITE) {
    j.cards = 남은
    // ⚠️ **머리글의 「N종」도 같이 고친다.** 안 고치면 수록 카드는 486장인데 머리글만
    //    604종이라고 우긴다(CLAUDE.md에 같은 실수가 적혀 있다).
    if (typeof j.count === 'number') j.count = 남은.length
    if (meta && typeof meta.count === 'number') meta.count = 남은.length
    writeFileSync(path.join(SETS, f), JSON.stringify(j))
  }
}

if (WRITE && 세트별.length) writeFileSync(path.join(SETS, 'index.json'), JSON.stringify(목록))

console.log(WRITE ? '=== 합쳤습니다 ===' : '=== 미리보기(파일은 안 건드림) ===')
console.log(`  합친 줄        ${합침.toLocaleString()}장`)
console.log(`  한글 자료 살림  ${한글살림.toLocaleString()}장`)
console.log(`  막히는 그림 바꿈 ${그림살림.toLocaleString()}장`)
console.log(`  애매해서 그냥 둠 ${애매해서둠.toLocaleString()}장   ← 저쪽 번호 가진 줄이 둘 이상`)
console.log(`\n  세트 ${세트별.length}개`)
for (const [s, 준, 전, 후] of 세트별.sort((a, b) => b[1] - a[1]).slice(0, 20))
  console.log(`     ${String(준).padStart(4)}장 줄임  ${s.padEnd(14)} ${전} → ${후}장`)
if (!WRITE) console.log('\n  실제로 합치려면 --write 를 붙여 다시 돌린다.')
else console.log('\n  ⚠️ 이어서 gen-card-index · gen-pokedex · gen-card-name-suggestions 를 다시 돌릴 것.')
