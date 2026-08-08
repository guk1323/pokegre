/**
 * **한글 카드 이름에 영어가 반쯤 남아 있는 것**을 찾는다.
 *
 * 예: "유빈의 Conviction" — 사람 이름만 옮겨지고 뒷말은 영어 그대로다. 같은 카드가
 * 일본판 탭에서는 "유빈의 확신"으로 멀쩡히 나와서, 탭을 옮기면 이름이 달라진다.
 *
 * ⚠️⚠️ **화면이 쓰는 koName을 그대로 쓴다.** 2026-08-08에 검사 도구가 판을 안 가리고
 *    `koreanizeEnglishCardName(koreanizeTitle(...))`를 썼다가 **없는 문제를 봤다** —
 *    앱의 koName은 북미판에 일본어 옮기개를 **안 쓴다**. 그 도구로는 "Team 로켓단
 *    Grunt가 154장"이라고 나왔는데 진짜 화면은 "로켓단 단원"이었다.
 *    검사기가 화면과 다른 길로 이름을 만들면, 없는 문제를 쫓고 있는 문제는 놓친다.
 *
 * ⚠️ 카드 이름에 **남아 있어도 되는 영문**이 많다. 아래 `정상`에 적어 둔 것들이다:
 *    표기(ex·V·GX·VMAX·VSTAR·BREAK·LV.X·V-UNION) · 옛 접미(GL·C·G·N·4·FB·SP) ·
 *    홀론 에너지의 기호(WP·FF·GL·SYN) · 우리가 일부러 곁들인 원어("낚시꾼 (Fisher)").
 *    **숫자와 한 글자짜리도 정상**으로 본다(안농 A~Z, 기술머신 TS-1).
 *
 * 2026-08-08 기준 남은 것은 전부 공식 한글명을 사람이 정해야 하는 것들이다
 * (ja-VS1의 "Technical Machine" 등).
 *
 * 실행: npx tsx scripts/check-half-translated.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koName } from '../src/lib/koCardName.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { slug: string; ed?: string }[]

// 카드 이름에 남아 있어도 되는 영문 토막
const 정상 = new Set([
  'ex', 'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'BREAK', 'LV', 'X', 'V-UNION', 'M', 'N', 'G', 'C', 'Z',
  'FB', 'SP', 'GL', 'WP', 'FF', 'SYN', 'UB', 'ZGX', 'AD', 'ESP', 'PC', 'TV', 'MC', 'AZ', 'VIP',
  'MAX', 'TS', 'EXP', 'ALL', 'HANDY', 'is', 'u', 's', 'Fisher', 'Merchant', 'LEGEND', 'Prime', 'Star',
  'LV.X', 'PRO', 'DX',
])

let 잼 = 0
const 걸림: { slug: string; n: string; 원: string; ko: string; 남은: string[] }[] = []
for (const s of idx) {
  let cards: { n?: string; name?: string }[] = []
  try {
    cards = JSON.parse(readFileSync(join(dir, `${s.slug}.json`), 'utf8')).cards ?? []
  } catch {
    continue
  }
  const ed = s.ed === 'ja' ? 'ja' : 'en'
  for (const c of cards) {
    const 원 = String(c.name ?? '')
    const ko = koName(ed, 원)
    잼++
    // 한글이 하나도 없으면 아예 못 옮긴 것이다 — 그건 다른 검사(card-name-audit)가 본다.
    if (!/[가-힣]/.test(ko) || !/[A-Za-z]/.test(ko)) continue
    const 남은 = [...ko.matchAll(/[A-Za-z][A-Za-z'’.\-]*/g)]
      .map((m) => m[0].replace(/[.'’-]+$/, ''))
      .filter((w) => w && !정상.has(w) && !/^\d+$/.test(w) && w.length > 1)
    if (남은.length) 걸림.push({ slug: s.slug, n: String(c.n), 원, ko, 남은 })
  }
}

console.log(`카드 ${잼.toLocaleString()}장 · 한글에 영어가 반쯤 남은 것 ${걸림.length}장`)
const 갈래 = new Map<string, number>()
for (const g of 걸림) for (const w of g.남은) 갈래.set(w, (갈래.get(w) ?? 0) + 1)
for (const [w, n] of [...갈래].sort((a, b) => b[1] - a[1])) {
  const 예 = 걸림.find((g) => g.남은.includes(w))!
  console.log(`  ${String(n).padStart(3)}장  "${w}"   ${예.slug} ${예.n} "${예.원}" → "${예.ko}"`)
}
