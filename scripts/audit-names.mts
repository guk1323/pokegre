/**
 * **방문자에게 보이는 모든 이름**이 한글로 나가는지 한 번에 점검한다.
 *
 * 사장님 원칙(2026-08-09): "검색하고 사용자가 닿는 부분은 전부 한글로 가능해야 한다."
 * 그래서 화면에 글자로 나가는 것을 종류별로 다 훑는다 — 카드명·세트명·레어도·등급.
 *
 * ⚠️ **덜 옮긴 것과 원래 그런 것을 갈라야 한다.** `ex`·`GX`·`V`·`VMAX`처럼 카드에 실제로
 *    영문으로 찍혀 있는 표식은 한글로 바꾸면 오히려 틀린다. 그건 문제로 세지 않는다.
 *
 * 실행: npx tsx scripts/audit-names.mts [--자세히]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koName, koSet } from '../src/lib/koCardName.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const 자세히 = process.argv.includes('--자세히')
const dir = join(ROOT, 'public/sets')
const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { slug: string; ed?: string; name?: string; serie?: string }[]

/** 카드에 실제로 영문으로 찍히는 표식 — 한글로 바꾸면 틀린다. */
const 그대로둘것 =
  /\b(ex|EX|GX|V|VMAX|VSTAR|V-UNION|V-Union|BREAK|LV\.X|Prime|SP|FB|G|δ|☆|★|Star|Tag|Team|Plasma|Holo|Reverse|Non-Holo|Cosmos|Poke Ball|Master Ball|Mirror|Stamped|Prerelease|Staff|Winner|Full Art|Secret|Shiny|Radiant|Amazing|Rare|Common|Uncommon|Promo)\b/g
/**
 * 카드에 영문으로 찍히는 **표식·번호**를 더 잡는다(2026-08-09에 도감을 PPT로 바꾸며 늘었다).
 * ⚠️ 여기 넣는 것은 「아직 안 옮긴 말」이 아니라 **원래 영문인 것**이어야 한다. 안 그러면
 *    점검이 문제를 조용히 덮는다.
 *   `Legend`·`Prism Star`  카드에 찍힌 옛 규칙 표식
 *   `Unit Energy LPM`·`Holon Energy WP`  에너지 이름 자체가 영문+약자다
 *   `SM10`·`SWSH123`·`XY104`  프로모 카드 번호
 *   `HANDY910is`·`AZ`  기기 모델명·인물명
 */
const 표식더 = /\b(Legend|LEGEND|Prism|Unit Energy [A-Z]{2,4}|Holon Energy [A-Z]{2,4}|HANDY\d*is|AZ|ACE SPEC|ACE|Kagayaku|(?:SM|SWSH|XY|BW|SV|SVP|HGSS|DP)\d{1,3}[a-z]?)\b/g
/**
 * 괄호 안 **사람 이름**은 한글로 옮기면 안 된다 — 옮기는 순간 그 카드가 어느 해 누구의
 * 덱인지를 알 수 없게 된다.
 *
 * 월드 챔피언십 덱은 **매년 입상자가 실제로 쓴 덱을 그대로 재현해 파는 상품**이고,
 * 카드마다 그 선수 이름과 연도가 찍혀 나온다. 그게 값을 가르는 근거이기도 하다
 * (`Latias Star - 2006 (Hiroki Yano)` $249.99 · 2026-08-09 덤프 확인).
 * 1,994장 중 1,901장에 지금 파는 곳이 있다.
 */
const 사람이름 = /\((?:[A-Z][a-z'’-]+\s+){1,2}[A-Z][a-zA-Z'’-]+\)/g
const 남은영문 = (s: string) => {
  const 벗 = s
    .replace(사람이름, ' ')
    .replace(그대로둘것, ' ')
    .replace(표식더, ' ')
    .replace(/[()[\]#/\\|&+.,'’\-—:0-9\s]/g, '')
  return /[A-Za-z]{2,}/.test(벗) ? 벗.match(/[A-Za-z]{2,}/g)!.join(' ') : ''
}

type 걸린것 = { 갈래: string; 어디: string; 원래: string; 나가는것: string; 남은말: string }
const 걸림: 걸린것[] = []
const 셈 = { 카드: 0, 카드덜: 0, 세트: 0, 세트덜: 0, 레어도종류: new Set<string>(), 레어도덜: new Set<string>() }

// ── ① 카드 이름 ───────────────────────────────────────────────────────────────
for (const s of idx) {
  const cards = JSON.parse(readFileSync(join(dir, `${s.slug}.json`), 'utf8')).cards as { n?: string; name?: string; r?: string }[]
  const ed = s.ed === 'ja' ? 'ja' : 'en'
  for (const c of cards) {
    셈.카드++
    const ko = koName(ed, String(c.name ?? ''))
    const 남 = 남은영문(ko)
    if (남) {
      셈.카드덜++
      걸림.push({ 갈래: '카드 이름', 어디: `${s.slug} ${c.n}`, 원래: String(c.name ?? ''), 나가는것: ko, 남은말: 남 })
    }
    if (c.r) {
      셈.레어도종류.add(c.r)
    }
  }
  // ── ② 세트 이름 ─────────────────────────────────────────────────────────────
  셈.세트++
  const sko = koSet(ed, String(s.name ?? ''))
  const s남 = 남은영문(sko)
  if (s남) {
    셈.세트덜++
    걸림.push({ 갈래: '세트 이름', 어디: s.slug, 원래: String(s.name ?? ''), 나가는것: sko, 남은말: s남 })
  }
}

// ── ③ 레어도 ─────────────────────────────────────────────────────────────────
// 레어도는 화면에 그대로 나간다(카드 타일·상세). 한글 대응이 없으면 영문이 보인다.
let 레어도한글: ((s: string) => string) | null = null
try {
  const m = await import('../src/lib/rarityCode.ts')
  레어도한글 = (m as { 레어도한글?: (s: string) => string; rarityKo?: (s: string) => string }).레어도한글 ?? (m as never)['rarityKo'] ?? null
} catch {
  레어도한글 = null
}
for (const r of 셈.레어도종류) {
  const ko = 레어도한글 ? 레어도한글(r) : r
  if (남은영문(ko)) 셈.레어도덜.add(r)
}

// ── 보고 ─────────────────────────────────────────────────────────────────────
console.log(`\n■ 화면에 나가는 이름 점검`)
console.log(`   카드 이름   ${셈.카드.toLocaleString()}장 중 영문이 남는 것 **${셈.카드덜.toLocaleString()}장** (${((셈.카드덜 / 셈.카드) * 100).toFixed(2)}%)`)
console.log(`   세트 이름   ${셈.세트}개 중 영문이 남는 것 **${셈.세트덜}개**`)
console.log(`   레어도      ${셈.레어도종류.size}가지 중 한글이 없는 것 **${셈.레어도덜.size}가지**${레어도한글 ? '' : ' (한글 대조표를 못 찾음)'}`)

const 갈래별 = new Map<string, number>()
for (const x of 걸림) 갈래별.set(x.남은말, (갈래별.get(x.남은말) ?? 0) + 1)
console.log(`\n■ 남은 영어 낱말 ${갈래별.size}가지 (많은 것부터)`)
for (const [w, n] of [...갈래별].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`   ${String(n).padStart(5)}장  ${w}`)

const 줄들 = ['| 갈래 | 어디 | 원래 이름 | 화면에 나가는 것 | 남은 영어 |', '|---|---|---|---|---|']
for (const x of 걸림) 줄들.push(`| ${x.갈래} | ${x.어디} | ${x.원래} | ${x.나가는것} | ${x.남은말} |`)
if (셈.레어도덜.size) {
  줄들.push('', '## 한글이 없는 레어도', '', '| 레어도 |', '|---|')
  for (const r of [...셈.레어도덜].sort()) 줄들.push(`| ${r} |`)
}
const 곳 = '/Users/sonhunguk/Documents/pokegre-dumps/이름-점검.md'
writeFileSync(곳, `# 이름 점검 — 한글로 안 나가는 것 ${걸림.length.toLocaleString()}건\n\n` +
  `카드 ${셈.카드.toLocaleString()}장 · 세트 ${셈.세트}개 · 레어도 ${셈.레어도종류.size}가지를 훑었습니다.\n` +
  `\`ex\`·\`GX\`·\`V\`처럼 **카드에 실제로 영문으로 찍힌 표식은 문제로 안 셌습니다.**\n\n` + 줄들.join('\n') + '\n')
console.log(`\n${곳}에 적었습니다`)
if (자세히) for (const x of 걸림.slice(0, 40)) console.log(`   [${x.갈래}] ${x.어디} ${x.원래} → ${x.나가는것}`)
