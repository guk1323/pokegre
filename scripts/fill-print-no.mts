// 옛 일본 세트 카드에 **실물에 찍힌 번호**를 붙인다(`printNo`).
//
// ⚠️⚠️ 1996~2001년 일본판 구판에는 「4/102」 같은 카드 번호가 **없다.** 대신 카드 오른쪽
//    아래에 **그 포켓몬의 도감번호**가 「No. 004」로 찍혀 있다(실물 그림으로 확인:
//    파이리=No.004 · 스파라크=No.167 · 다크 리자몽=No.006).
//    그런데 우리 도감은 pokellector가 매긴 **정렬 순번**을 쓰고 있어 실물과 다르다
//    (파이리가 012). 사장님 지적 2026-08-17: "카드에 써있는 번호가 파이리가 4번이면 4번으로".
//
// ⚠️ **트레이너·에너지 카드에는 번호가 아예 없다**(세트 마크만 있다 — 실물로 확인).
//    그러니 안 붙는 것이 정상이다. 억지로 채우지 않는다.
//
// ⚠️⚠️ **`n`(내부 번호)은 안 바꾼다.** 실물 번호는 **겹칠 수 있어서**다 — 한 세트에 같은
//    포켓몬 카드가 둘이면 둘 다 같은 번호를 달고 나온다(에리카의 뚜벅쵸 002·003이 둘 다
//    No.043). `n`이 열쇠 노릇을 하는 자리가 많아(색인·매물 잇기·시세 붙이기) 겹치면
//    조용히 깨진다. 그래서 **보여 줄 번호만 따로** 둔다.
//
// ⚠️ 근거를 **둘로 교차 검증**한다 — ①그림 주소에 박힌 영어 이름 ②카드의 일본어 이름.
//    둘이 어긋나면 **안 쓴다.** 그림 주소만 믿었더니 「ジョバンニのニドラン♀」와 「♂」가
//    둘 다 같은 번호로 나왔다(주소가 `Giovannis-Nidoran`으로 같아서다).
//
// 사용법:
//   npx tsx scripts/fill-print-no.mts            무엇이 붙는지 보기만
//   npx tsx scripts/fill-print-no.mts --write    실제로 public/sets에 쓴다
// ⚠️ --write 뒤에는 `npx tsx scripts/gen-card-index.mts`를 다시 돌린다.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const WRITE = process.argv.includes('--write')

// ⚠️ 이 열 세트만 손댄다. **짐작으로 넓히지 마라** — 실물 그림을 열어 확인한 것들이다.
//    (pokellector 그림을 쓰는 세트 = 옛 구판. 나중 세트는 「4/102」 꼴이라 해당 없음.)
const 대상 = ['ja-PMCG1', 'ja-PMCG2', 'ja-PMCG3', 'ja-PMCG4', 'ja-PMCG5', 'ja-PMCG6',
  'ja-neo1', 'ja-neo2', 'ja-neo3', 'ja-neo4']

type 이름표 = { id: number; ko: string; ja: string; en: string }
const 표 = pokemonNames as 이름표[]
const 납작 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const 영문표 = new Map(표.map((p) => [납작(p.en), p.id]))
// 일본어는 **긴 이름부터** 본다 — 「わるいリザードン」에서 リザード가 아니라 リザードン을 잡아야 한다.
const 일본표 = 표.map((p) => [p.ja, p.id] as const).filter(([ja]) => ja).sort((a, b) => b[0].length - a[0].length)

/** 그림 주소에 박힌 영어 이름으로 도감번호를 찾는다. 「Dark-Charizard」는 뒤쪽이 포켓몬이다. */
function 주소로(img: string): number | null {
  const m = img.match(/pokellector\.com\/\d+\/([^.]+)\./)
  if (!m) return null
  const 낱말 = m[1].split('-')
  // 뒤에서부터 이어 붙여 본다 — 긴 것이 먼저 맞아야 「Porygon2」가 「Porygon」에 안 진다.
  for (let i = 0; i < 낱말.length; i++) {
    const k = 납작(낱말.slice(i).join(''))
    if (영문표.has(k)) return 영문표.get(k)!
  }
  return null
}

/**
 * 카드 이름으로 도감번호를 찾는다.
 * ⚠️ **옛 세트는 일본어 칸이 오염돼 있다** — 정식 일본명이 아니라 **영어명을 가타카나로
 *    옮긴 것**이 들어 있다(스파라크=Spinarak, 정식은 イトマル). 아예 영어인 것도 있다
 *    (`Oddish`·`Bayleef`). 그래서 일본어·영어를 다 본다.
 */
function 이름으로(name: string): { id: number; 맞은말: string } | null {
  for (const [ja, id] of 일본표) if (name.includes(ja)) return { id, 맞은말: ja }
  const k = 납작(name)
  if (영문표.has(k)) return { id: 영문표.get(k)!, 맞은말: name }
  return null
}

/**
 * 잡힌 이름이 **카드 이름의 꼬리**를 이루나 — 잡힌 자리부터 끝까지가 전부 가타카나인가.
 *
 * ⚠️ 왜 필요한가: 포켓몬 카드의 이름은 꾸밈말이 **앞에** 붙는다(「軽いアズマリル」·「輝くカブトップ」).
 *    그래서 진짜 포켓몬 이름은 늘 **뒤쪽 가타카나 덩어리**다. 트레이너 카드는 포켓몬 이름을
 *    문장 속에서 부르므로(「壁を台無しにする[カブト]」) 뒤에 가타카나가 아닌 것이 따라온다.
 */
function 이름이꼬리인가(카드이름: string, 맞은말: string): boolean {
  const i = 카드이름.indexOf(맞은말)
  if (i < 0) return false
  return /^[゠-ヿ゙-゜]+$/.test(카드이름.slice(i))
}

let 붙임 = 0
let 번호없음 = 0
let 어긋남 = 0
const 어긋난것: string[] = []
const 주소가이김: string[] = []
const 세트별: [string, number][] = []
const 겹친번호: string[] = []

for (const slug of 대상) {
  const 곳 = path.resolve('public/sets', `${slug}.json`)
  const raw = await readFile(곳, 'utf-8')
  const j = JSON.parse(raw) as { cards?: { n: string; name: string; img?: string; printNo?: string }[] }
  const cards = j.cards ?? []
  let 이세트 = 0
  const 번호셈 = new Map<number, string[]>()

  for (const c of cards) {
    const a = 주소로(c.img ?? '')
    const b = 이름으로(c.name)
    // ⚠️ **둘이 맞을 때만 쓴다.** 하나만 나오면 근거가 하나뿐이라 안 쓴다 —
    //    틀린 번호를 적는 것은 지금(순번)보다 나쁘다.
    if (a == null && b == null) { 번호없음++; continue }
    // ⚠️ **어긋날 때만 버린다. 한쪽만 나오면 그쪽을 믿는다.**
    //    옛 세트는 이름 칸이 오염돼 이름 쪽이 자주 빈손인데, 그때마다 버리면 절반이 날아간다.
    //    그림 주소의 영어 이름은 이 리포에서 이미 검증된 근거다(CLAUDE.md 「짝짓는 근거는
    //    그림 주소다 … 어긋남 0」).
    let 쓸것: number | null = null
    if (a != null && b?.id != null && a !== b.id) {
      // ⚠️ **♀·♂는 이름이 이긴다.** 그림 주소는 둘을 못 가른다(`Giovannis-Nidoran` 하나뿐).
      //    영문 이름을 납작하게 눌렀을 때 겹치는 것은 **이 한 쌍뿐**이다(전수로 셌다).
      if (/[♀♂]/.test(c.name)) 쓸것 = b.id
      // ⚠️⚠️ **이름 안에 더 짧은 이름이 들어 있을 때는 그림 주소가 이긴다.**
      //    옛 세트의 일본어 칸은 **영어명을 가타카나로 옮긴 것**이라 정식 일본명과 다르고,
      //    그러다 보니 **진화 전 이름이 통째로 안에 든다**:
      //      アズマリル(Azumarill 184) ⊃ マリル(마릴 183)   ← 정식 일본명은 マリルリ
      //      カブトップス(Kabutops 141) ⊃ カブト(투구 140)  ← 정식 일본명은 カブトプス
      //    이 넷을 「어긋남」으로 버려서 마릴리·투구푸스 카드가 번호를 못 받고 있었다
      //    (사장님 확인 2026-08-17). **실물 그림으로 넷 다 눈으로 확인했다** —
      //    neo1 34번 No.184 · neo2 18번 No.141 · neo4 40번 No.184 · neo4 80번 No.141.
      //    ⚠️⚠️ **단, 잡힌 이름이 카드 이름의 꼬리를 이룰 때만이다**(`이름이꼬리인가`).
      //       안 그러면 **트레이너 카드가 걸린다** — 「壁を台無しにする[カブト]」는 그림 주소가
      //       `Ruin-Wall-Kabuto…Aerodactyl`이라 프테라(142)로 잡히는데, **실물에는 번호가 아예
      //       없다**(눈으로 확인). 이 카드는 포켓몬 이름을 문장 속에서 부를 뿐이다.
      //    ⚠️ 이 갈래로 정한 것은 **아래에 목록으로 찍는다. 반드시 눈으로 볼 것.**
      else if (b.맞은말.length < c.name.length && 이름이꼬리인가(c.name, b.맞은말)) { 쓸것 = a; 주소가이김.push(`${slug} ${c.n} ${c.name} — 주소:${a}(씀) 이름:${b.id}(「${b.맞은말}」가 안에 듦)`) }
      else {
        어긋남++
        if (어긋난것.length < 20) 어긋난것.push(`${slug} ${c.n} ${c.name} — 주소:${a} 이름:${b.id}`)
        continue
      }
    } else 쓸것 = a ?? b?.id ?? null
    c.printNo = String(쓸것).padStart(3, '0')
    붙임++; 이세트++
    if (!번호셈.has(쓸것!)) 번호셈.set(쓸것!, [])
    번호셈.get(쓸것!)!.push(c.n + ' ' + c.name)
  }
  for (const [id, 것] of 번호셈) if (것.length > 1) 겹친번호.push(`${slug} No.${id} — ${것.join(' / ')}`)
  세트별.push([slug, 이세트])
  if (WRITE && 이세트) await writeFile(곳, JSON.stringify(j))
}

console.log((WRITE ? '붙였습니다' : '붙일 수 있습니다') + ` — ${붙임}장`)
console.log(`번호가 없는 카드(트레이너·에너지) — ${번호없음}장 (실물에도 없다)`)
console.log(`근거가 어긋나 안 쓴 것 — ${어긋남}장`)
console.log('\n세트별:')
for (const [s, n] of 세트별) console.log('  ' + s.padEnd(10) + String(n).padStart(4) + '장')
if (겹친번호.length) {
  console.log(`\n같은 번호가 둘인 것 ${겹친번호.length}가지 — **실물도 그렇다**(같은 포켓몬 카드가 한 세트에 둘):`)
  for (const x of 겹친번호) console.log('  ' + x)
}
if (어긋난것.length) { console.log('\n어긋나 안 쓴 예:'); for (const x of 어긋난것) console.log('  ' + x) }
if (주소가이김.length) {
  console.log(`\n⚠️ 이름 안에 더 짧은 이름이 들어 어긋났고 **그림 주소를 쓴 것** — ${주소가이김.length}장.`)
  console.log('   반드시 실물 그림으로 눈으로 확인할 것:')
  for (const x of 주소가이김) console.log('  ' + x)
}
if (!WRITE) console.log('\n(보기만 했습니다. 실제로 쓰려면 --write)')
