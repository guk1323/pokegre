/**
 * **왕복 검사** — 화면에 보이는 한글 이름을 그대로 검색창에 쳤을 때, 저쪽이 그 카드에
 * 붙여 둔 영문 이름으로 돌아오는가.
 *
 * 방문자는 우리 화면에 있는 이름을 그대로 친다. 돌아오는 영문이 저쪽 이름과 다르면
 * 0장이 나오거나 엉뚱한 카드가 나온다. 사전 전체를 한 줄로 재는 잣대다.
 *
 * ⚠️ translateQueryToEnglish가 확장자 없는 import를 쓰므로 **tsx로 돌려야 한다**:
 *      npx tsx scripts/check-round-trip.mts <cards.csv>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koName } from '../src/lib/koCardName.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2] ?? '/data/export-cards.csv'
const 칸 = (줄: string) => {
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
const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const H = 칸(줄들[0])
const I = { set: H.indexOf('setName'), num: H.indexOf('cardNumber'), name: H.indexOf('name'), lang: H.indexOf('language') }
const 이름to = new Map(Object.entries(pptSetNames as Record<string, string>).map(([k, v]) => [v, k]))
const 저쪽 = new Map<string, string>()
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸(줄들[i])
  const slug = 이름to.get(f[I.set])
  if (!slug) continue
  const n = String(f[I.num] ?? '').split('/')[0].replace(/^0+(?=.)/, '')
  if (!n) continue
  const k = `${slug}|${n}`
  if (!저쪽.has(k)) 저쪽.set(k, String(f[I.name] ?? '').replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '').trim())
}

const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const 벗김 = (s: string) => s.replace(/[\s'’·-]/g, '').toLowerCase()
let 잼 = 0
let 맞음 = 0
const 탈 = new Map<string, number>()
const 예 = new Map<string, string[]>()
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'ko-index.json') continue
  const slug = f.replace('.json', '')
  const ed: 'ja' | 'en' = slug.startsWith('ja-') ? 'ja' : 'en'
  for (const c of (JSON.parse(readFileSync(join(dir, f), 'utf8')).cards ?? []) as { n?: string; name?: string }[]) {
    const en저쪽 = 저쪽.get(`${slug}|${String(c.n).replace(/^0+(?=.)/, '')}`)
    if (!en저쪽) continue
    const ko = koName(ed, String(c.name ?? ''))
    if (!/[가-힣]/.test(ko)) continue // 한글이 아니면 왕복을 잴 수 없다
    잼++
    const 돌아온것 = translateSearchQueryToEnglish(ko, ed === 'ja' ? 'japanese' : 'english')
    if (벗김(돌아온것) === 벗김(en저쪽)) { 맞음++; continue }
    // ⚠️ **저쪽이 붙이는 구분 꼬리는 실패가 아니다.** 같은 세트에 같은 이름이 여럿이면
    //    "Clefable (1)"처럼 번호를 달아 준다. 그런 건 이름만으로도 검색이 된다.
    //    이걸 안 가르면 5,969장이 실패로 잡혀 진짜 197장이 묻힌다.
    const 꼬리뺀저쪽 = en저쪽.replace(/\s*\(\d+\)\s*$/, '')
    if (벗김(돌아온것) === 벗김(꼬리뺀저쪽)) { 맞음++; continue }
    const k = /[가-힣]/.test(돌아온것) ? '한글이 남았다(저쪽이 못 알아듣는다)' : '영어로는 갔는데 저쪽 이름과 다르다'
    탈.set(k, (탈.get(k) ?? 0) + 1)
    const e = 예.get(k) ?? []
    if (e.length < 8) { e.push(`  ${slug} ${c.n} "${ko}" → "${돌아온것}"   (저쪽은 "${en저쪽}")`); 예.set(k, e) }
  }
}
console.log(`왕복을 잰 카드 ${잼.toLocaleString()}장 · 저쪽 이름으로 정확히 돌아온 것 ${맞음.toLocaleString()} (${((맞음 / 잼) * 100).toFixed(1)}%)\n`)
for (const [k, v] of [...탈].sort((a, b) => b[1] - a[1])) {
  console.log(`■ ${k} — ${v}장`)
  for (const x of 예.get(k) ?? []) console.log(x)
  console.log('')
}
