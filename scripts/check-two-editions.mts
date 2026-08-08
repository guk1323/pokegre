/**
 * **같은 카드가 일본판 탭과 북미판 탭에서 다른 이름으로 보이는지** 본다.
 *
 * 우리는 이름을 두 길로 만든다 — 일본어 원문을 옮기는 길(koreanizeTitle)과 저쪽이 준
 * 영문 이름을 옮기는 길(koreanizeEnglishTitle). 두 길이 어긋나면 같은 카드가 화면마다
 * 다른 이름이 된다. 2026-08-08에 이 문제로 세 가지를 찾았다:
 *     ダークジェンガー "다크팬텀" ↔ Dark Gengar "나쁜 팬텀" (13장)
 *     スイッチ "스위치" ↔ Switch "포켓몬 교체" (161장)
 *     ファイティングキューブ01 "파이틴구큐부01" ↔ Fighting Cube 01 "파이팅큐브 01" (8장)
 *
 * ⚠️ **저쪽이 이름 뒤에 붙이는 꼬리를 떼고 견줘야 한다.** 안 떼면 1,431장이 어긋난 것처럼
 *    보이는데, 대부분 "Electrode - Team Plasma"처럼 꼬리만 다른 같은 카드다.
 * ⚠️ **자동 사전을 끄고 잰다.** 그걸 켜면 사전에 굳어 있는 값이 양쪽에 같이 나와서
 *    어긋난 곳이 안 보인다 — 정작 그게 문제인데.
 *
 * 실행: node --experimental-strip-types scripts/check-two-editions.mts <cards.csv>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName, 자동사전없이 } from '../src/lib/koreanizeEnglishTitle.ts'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2] ?? '/data/export-cards.csv'

function 칸(줄: string): string[] {
  const r: string[] = []
  let c = ''
  let q = false
  for (let i = 0; i < 줄.length; i++) {
    const ch = 줄[i]
    if (ch === '"') { if (q && 줄[i + 1] === '"') { c += ch; i++ } else q = !q }
    else if (ch === ',' && !q) { r.push(c); c = '' } else c += ch
  }
  r.push(c)
  return r
}

// 저쪽이 붙이는 꼬리: 번호("- 174/086")·부제("- Team Plasma")·괄호 인쇄표시.
const 꼬리떼기 = (s: string) =>
  s
    .replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '')
    .replace(/\s*-\s*(Team Plasma|Delta Species|Prerelease|Staff)\s*$/i, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim()

const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const H = 칸(줄들[0])
const I = { set: H.indexOf('setName'), num: H.indexOf('cardNumber'), name: H.indexOf('name'), lang: H.indexOf('language') }
const 이름to = new Map(Object.entries(pptSetNames as Record<string, string>).map(([k, v]) => [v, k]))
const 저쪽 = new Map<string, string>()
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸(줄들[i])
  if (f[I.lang] !== 'japanese') continue
  const slug = 이름to.get(f[I.set])
  if (!slug) continue
  const n = String(f[I.num] ?? '').split('/')[0].replace(/^0+(?=.)/, '')
  if (!n) continue
  const k = `${slug}|${n}`
  if (!저쪽.has(k)) 저쪽.set(k, 꼬리떼기(String(f[I.name] ?? '')))
}

const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const 벗김 = (s: string) => s.replace(/[\s·]/g, '')
let 잼 = 0
const 갈림: string[] = []
for (const f of readdirSync(dir)) {
  if (!f.startsWith('ja-') || !f.endsWith('.json')) continue
  const slug = f.replace('.json', '')
  for (const c of (JSON.parse(readFileSync(join(dir, f), 'utf8')).cards ?? []) as { n?: string; name?: string }[]) {
    const 원 = String(c.name ?? '')
    const en = 저쪽.get(`${slug}|${String(c.n).replace(/^0+(?=.)/, '')}`)
    if (!원 || !en) continue
    // ⚠️ 기본은 **화면에 실제로 나가는 값**으로 잰다(자동 사전 켠 채). 사전이 양쪽을
    //    같은 값으로 맞춰 주는 경우가 많아서, 끄고 재면 실제보다 훨씬 부풀려 보인다.
    //    끄고 재면 **밑에 깔린 규칙**이 어긋난 곳이 드러난다 — 사전에 없는 카드가
    //    새로 들어올 때 터질 자리다. RULE=1 로 그렇게 볼 수 있다.
    const 규칙만 = !!process.env.RULE
    const a = 규칙만 ? 자동사전없이(() => koreanizeEnglishCardName(koreanizeTitle(원))) : koreanizeEnglishCardName(koreanizeTitle(원))
    const b = 규칙만 ? 자동사전없이(() => koreanizeEnglishCardName(en)) : koreanizeEnglishCardName(en)
    // 한쪽이 한글로 안 옮겨지면 견줄 수 없다(그건 다른 검사가 본다).
    if (!/[가-힣]/.test(a) || !/[가-힣]/.test(b)) continue
    잼++
    if (벗김(a) !== 벗김(b)) 갈림.push(`  ${slug.padEnd(11)} ${String(c.n).padEnd(5)} "${원}" → "${a}"   ↔   "${en}" → "${b}"`)
  }
}
// ⚠️ **갈래를 나눠 보여준다.** 통짜로 1,904장이라고만 하면 어디부터 봐야 할지 모른다.
//    대부분은 저쪽이 이름을 덜 적은 것("Sceptile"이 실은 M나무킹EX)이라 우리 문제가 아니다.
const 갈래 = new Map<string, { 수: number; 예: string[] }>()
const 넣기 = (k: string, 줄: string) => {
  const v = 갈래.get(k) ?? { 수: 0, 예: [] }
  v.수++
  if (v.예.length < (process.env.ALL ? 400 : 4)) v.예.push(줄)
  갈래.set(k, v)
}
for (const 줄 of 갈림) {
  const m = 줄.match(/"([^"]*)" → "([^"]*)"\s+↔\s+"([^"]*)" → "([^"]*)"/)
  if (!m) { 넣기('꼴이 다름', 줄); continue }
  const [, , a, en, b] = m
  const 벗 = (x: string) => x.replace(/[\s·]/g, '')
  if (벗(a) === 벗(b)) 넣기('띄어쓰기만 다름', 줄)
  else if (/^M[가-힣]/.test(a) && /^메가/.test(b)) 넣기('M___ ↔ 메가___', 줄)
  else if (벗(a).includes(벗(b)) || 벗(b).includes(벗(a))) 넣기('저쪽이 이름을 덜 적음', 줄)
  else if (/^[A-Za-z' -]+$/.test(en) && en.split(' ').length <= 2) 넣기('저쪽이 포켓몬 이름만 적음', 줄)
  else 넣기('낱말이 다름 — 사람이 정해야 한다', 줄)
}
console.log(`양쪽을 다 잰 카드 ${잼.toLocaleString()}장 · 이름이 갈리는 것 ${갈림.length}장\n`)
for (const [k, v] of [...갈래].sort((x, y) => y[1].수 - x[1].수)) {
  console.log(`■ ${k} — ${v.수}장`)
  for (const x of v.예) console.log(x)
  console.log('')
}
