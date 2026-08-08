/**
 * 카드 갈래표(cardCategories)에 **같은 번호가 두 갈래**로 적혀 있는 곳을 찾는다.
 *
 * 갈래표는 한 세트 자리에 번호 → 'p'(포켓몬)·'t'(트레이너)·'e'(에너지)를 담는다.
 * 그런데 앞의 0만 다른 같은 번호가 **다른 갈래**로 두 번 적힌 칸이 있다:
 *     en-swsh1  "64"=p  ↔  "064"=t     (64번은 Frosmoth — 포켓몬이 맞다)
 *     en-sma    "78"=t  ↔  "078"=p
 * 한 세트 자리에 **딴 세트 자료가 겹쳐 들어온 것**이다 — en-swsh1은 우리 216장짜리인데
 * 칸이 416개고, en-sma(94장)는 400개다.
 *
 * 지금은 탈이 안 난다. 우리 세트 번호가 0 없는 꼴이라 맞는 쪽이 먼저 걸리고,
 * gen-pokedex의 `카드종류`는 **갈리면 모른다**고 하도록 막아 뒀다. 그래도 숫자가
 * 늘어나면 알아야 해서 센다.
 *
 * ⚠️ "우리 세트에 없는 번호"는 문제가 아니다 — 갈래표가 우리보다 카드를 더 많이 아는
 *    세트가 21개 있다(트레이너 갤러리·시크릿). 안 쓰일 뿐이다.
 *
 * 실행: node --experimental-strip-types scripts/check-card-categories.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 번호열쇠 } from '../src/lib/cardNo.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const 종류표 = JSON.parse(readFileSync(join(ROOT, 'src/data/cardCategories.json'), 'utf8')) as Record<
  string,
  Record<string, string>
>

let 칸 = 0
const 갈림: { slug: string; k: string; a: string; b: string }[] = []
for (const [slug, t] of Object.entries(종류표)) {
  const 본것 = new Map<string, { n: string; v: string }>()
  for (const [n, v] of Object.entries(t)) {
    칸++
    const k = 번호열쇠(n)
    const 먼저 = 본것.get(k)
    if (먼저) {
      if (먼저.v !== v) 갈림.push({ slug, k, a: `${먼저.n}=${먼저.v}`, b: `${n}=${v}` })
    } else 본것.set(k, { n, v })
  }
}

// 그중 우리 카드가 실제로 있는 번호는 몇 개인가 — 있으면 화면에 영향이 갈 수 있다.
let 우리것 = 0
for (const g of 갈림) {
  let cards: { n?: string }[] = []
  try {
    cards = JSON.parse(readFileSync(join(dir, `${g.slug}.json`), 'utf8')).cards ?? []
  } catch {
    continue
  }
  if (cards.some((c) => 번호열쇠(c.n) === g.k)) 우리것++
}

console.log(`갈래표 칸 ${칸.toLocaleString()}개 · 같은 번호가 두 갈래인 것 ${갈림.length}개(그중 우리 카드가 있는 것 ${우리것}개)`)
for (const g of 갈림.slice(0, 30)) console.log(`  ${g.slug.padEnd(12)} ${g.a}  ↔  ${g.b}`)
