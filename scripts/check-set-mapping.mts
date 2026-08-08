/**
 * 우리 세트 ↔ 저쪽(PPT) 세트 대조표가 **정말 같은 세트를 가리키는지** 확인한다.
 *
 * 번호가 같은 칸에 같은 포켓몬이 있는지로 잰다. 이름 표기는 두 변환기가 달라서 못 쓴다.
 *
 * 2026-08-08에 이 검사로 **뒤바뀐 짝**을 찾았다:
 *     ja-SVLN(님피아 스타터) → "SV: Ceruledge ex …"   ← 창염마 덱이다
 *     ja-SVLS(창염마 스타터) → "SV: Sylveon ex …"     ← 님피아 덱이다
 * 두 세트 44장의 시세가 서로 바뀌어 나가고 있었다.
 *
 * 실행: node --experimental-strip-types scripts/check-set-mapping.mts <cards.csv>
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2] ?? '/data/export-cards.csv'
const KO = (pokemonNames as { ko: string }[]).map((p) => p.ko).filter((k) => k.length >= 2).sort((a, b) => b.length - a.length)
const 포켓 = (s: string) => KO.find((k) => s.includes(k)) ?? ''

function 칸쪼개기(줄: string): string[] {
  const 칸: string[] = []
  let 지금 = ''
  let 따옴표 = false
  for (let i = 0; i < 줄.length; i++) {
    const c = 줄[i]
    if (c === '"') { if (따옴표 && 줄[i + 1] === '"') { 지금 += c; i++ } else 따옴표 = !따옴표 }
    else if (c === ',' && !따옴표) { 칸.push(지금); 지금 = '' } else 지금 += c
  }
  칸.push(지금)
  return 칸
}

// ⚠️ 번호는 **0을 떼고** 견준다. 우리는 "1", 저쪽은 "001"로 적는 세트가 있어서
//    그대로 견주면 멀쩡한 세트가 0%로 나온다(en-np가 그랬다 — 1~6번이 정확히 맞는데도).
//    실제 시세 코드(담기·덤프 읽기)도 stripZeros로 떼고 맞춘다 — 검사도 같아야 한다.
const 번호맞추기 = (n: string) => n.replace(/^0+/, '') || '0'

const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const 머리 = 칸쪼개기(줄들[0])
const I = { set: 머리.indexOf('setName'), num: 머리.indexOf('cardNumber'), name: 머리.indexOf('name') }
const 저쪽: Record<string, Record<string, string>> = {}
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸쪼개기(줄들[i])
  const n = String(f[I.num] ?? '').split('/')[0].trim()
  if (!f[I.set] || !n) continue
  ;(저쪽[f[I.set]] ??= {})[번호맞추기(n)] ??= String(f[I.name] ?? '')
}

const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
let 봄 = 0
const 나쁨: string[] = []
for (const [slug, 이름] of Object.entries(pptSetNames as Record<string, string>)) {
  const f = join(dir, `${slug}.json`)
  if (!existsSync(f) || !저쪽[이름]) continue
  const cards: { n?: string; name?: string }[] = JSON.parse(readFileSync(f, 'utf8')).cards ?? []
  let 맞음 = 0
  let 셈 = 0
  const 예: string[] = []
  for (const c of cards) {
    const e = 저쪽[이름][번호맞추기(String(c.n ?? ''))]
    if (!e) continue
    const p1 = 포켓(koreanizeEnglishCardName(koreanizeTitle(String(c.name ?? ''))))
    const p2 = 포켓(koreanizeEnglishCardName(e))
    if (!p1 || !p2) continue
    셈++
    if (p1 === p2) 맞음++
    else if (예.length < 3) 예.push(`${c.n} ${p1}↔${p2}`)
  }
  if (셈 < 5) continue
  봄++
  const 율 = 맞음 / 셈
  if (율 < 0.7) 나쁨.push(`  ${slug.padEnd(12)} "${이름}"  포켓몬 일치 ${(율 * 100).toFixed(0)}% (${맞음}/${셈})  ${예.join(' · ')}`)
}
console.log(`대조한 세트 ${봄}개 · 어긋난 세트 ${나쁨.length}개\n`)
for (const b of 나쁨) console.log(b)
