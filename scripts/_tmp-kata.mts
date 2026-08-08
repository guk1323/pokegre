// 일본판 원본이 영어를 가타카나로 적어 놓은 카드를 찾는다.
// 재는 법: 우리 일본어 이름을 한글로 옮긴 것과, 저쪽 영문 이름을 한글로 옮긴 것이
// 다르고, 원본이 **가타카나뿐**이면 의심스럽다(진짜 일본어 이름은 히라가나·한자가 섞인다).
import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName, 자동사전없이 } from '../src/lib/koreanizeEnglishTitle.ts'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const CSV = process.argv[2]
const 칸 = (줄: string) => {
  const r: string[] = []; let c = ''; let q = false
  for (let i = 0; i < 줄.length; i++) {
    const ch = 줄[i]
    if (ch === '"') { if (q && 줄[i + 1] === '"') { c += ch; i++ } else q = !q }
    else if (ch === ',' && !q) { r.push(c); c = '' } else c += ch
  }
  r.push(c); return r
}
const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const H = 칸(줄들[0])
const I = { set: H.indexOf('setName'), num: H.indexOf('cardNumber'), name: H.indexOf('name'), lang: H.indexOf('language') }
const 이름to = new Map(Object.entries(pptSetNames as Record<string, string>).map(([k, v]) => [v, k]))
const 저쪽 = new Map<string, string>()
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸(줄들[i])
  if (f[I.lang] !== 'japanese') continue
  const slug = 이름to.get(f[I.set]); if (!slug) continue
  const n = String(f[I.num] ?? '').split('/')[0].replace(/^0+(?=.)/, '')
  if (!n) continue
  const k = `${slug}|${n}`
  if (!저쪽.has(k)) 저쪽.set(k, String(f[I.name] ?? '').replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '').trim())
}
const 가타카나뿐 = /^[ァ-ヶー・\s0-9]+$/
const 벗김 = (s: string) => s.replace(/[\s·]/g, '')
const 나옴: string[] = []
for (const f of readdirSync('public/sets')) {
  if (!f.startsWith('ja-') || !f.endsWith('.json')) continue
  const slug = f.replace('.json', '')
  for (const c of (JSON.parse(readFileSync('public/sets/' + f, 'utf8')).cards ?? []) as { n?: string; name?: string }[]) {
    const 원 = String(c.name ?? '')
    if (!원 || !가타카나뿐.test(원)) continue
    const en = 저쪽.get(`${slug}|${String(c.n).replace(/^0+(?=.)/, '')}`)
    if (!en) continue
    const a = 자동사전없이(() => koreanizeEnglishCardName(koreanizeTitle(원)))
    const b = 자동사전없이(() => koreanizeEnglishCardName(en))
    if (!/[가-힣]/.test(b)) continue           // 영문 쪽이 한글로 안 옮겨지면 견줄 수 없다
    if (벗김(a) === 벗김(b)) continue
    나옴.push(`  ${slug.padEnd(11)} ${String(c.n).padEnd(5)} "${원}" → "${a}"   ↔   저쪽 "${en}" → "${b}"`)
  }
}
console.log(`가타카나뿐인 일본어 이름 중 영문 쪽과 한글이 갈리는 카드: ${나옴.length}장\n`)
for (const x of 나옴.slice(0, 30)) console.log(x)
