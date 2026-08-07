// 세 목록(세트별·작가별·포켓몬명)이 **찾기 쉬운 순서로 서 있는지**, 그리고 카드 이름이
// 화면에 원어로 새지 않는지 한 번에 본다.
//
// 왜 리포에 두나: 이 검사들을 임시 폴더에 두었더니 하루 만에 지워졌다(2026-08-07).
// 매번 다시 만들면 규칙이 조금씩 달라져 결과를 견줄 수 없다.
//
// 규칙(지금 데이터가 이미 따르고 있는 것):
//   · 세트별  — 번호가 커지는 순
//   · 작가별  — 발매일이 늦은 순(같은 세트 안에서는 번호가 큰 순)
//   · 포켓몬명 — 발매일이 이른 순
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/cardCatalog.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 발매 = new Map(sidx.map((s) => [s.slug, String(s.releaseDate ?? '')]))

// ⚠️ 대소문자를 무시하면 안 된다. "00W"·"00L"(에너지 같은 특수 카드)이 '0번'으로
//    읽혀 멀쩡한 세트가 '93 다음에 0'으로 잡힌다(2026-08-07에 그렇게 나왔다).
//    꼬리는 소문자만 인정한다(SWSH135a 꼴). 안 맞으면 null → 그 카드는 건너뛴다.
const 쪼개기 = (n: string) => {
  const m = String(n).match(/^([A-Za-z-]*)0*(\d+)([a-z]?)$/)
  return m ? { 앞: m[1].toUpperCase(), 숫자: Number(m[2]), 뒤: m[3] } : null
}

// ── ① 세트별: 번호 순 ───────────────────────────────────────────────────
let 세트봄 = 0
const 세트깨짐: string[] = []
for (const s of sidx) {
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  const cs = d.cards ?? []
  if (cs.length < 2) continue
  세트봄++
  let 앞것: ReturnType<typeof 쪼개기> = null
  for (const c of cs) {
    const 지금 = 쪼개기(String(c.n))
    if (!지금) continue
    // 접두사가 다르면(1 ↔ SWSH1) 숫자로 견줄 수 없다.
    if (앞것 && 앞것.앞 === 지금.앞 && 지금.숫자 < 앞것.숫자) {
      세트깨짐.push(`${s.slug.padEnd(13)} ${앞것.앞}${앞것.숫자} 다음에 ${지금.앞}${지금.숫자}`)
      break
    }
    앞것 = 지금
  }
}
console.log(`\n  [세트별] 카드가 2장 이상인 세트 ${세트봄}개`)
console.log(`  ${세트깨짐.length ? '✗' : '✓'} 번호 순이 깨진 세트 ${세트깨짐.length}개`)
세트깨짐.slice(0, 8).forEach((e) => console.log(`      ${e}`))

// ── ② 작가별: 발매 순이 중간에 튀지 않는지 ────────────────────────────────
// ⚠️ 되살린 카드를 목록 끝에 이어 붙였다가 19명이 튀었던 적이 있다(2026-08-07).
let 작가봄 = 0
const 튐: string[] = []
for (const f of readdirSync(path.join(ROOT, 'public/artists'))) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'by-card.json') continue
  const d = JSON.parse(readFileSync(path.join(ROOT, 'public/artists', f), 'utf-8')) as any
  const cs = (d.cards ?? []).filter((c: any) => c.s && 발매.get(c.s))
  if (cs.length < 3) continue
  작가봄++
  for (let i = 1; i < cs.length; i++) {
    const 앞 = 발매.get(cs[i - 1].s)!
    const 뒤 = 발매.get(cs[i].s)!
    // 1년 넘게 거꾸로 튀어 오르면 이어 붙인 자리다(같은 날 세트가 섞인 것과 가른다).
    if (뒤 > 앞 && Number(뒤.slice(0, 4)) - Number(앞.slice(0, 4)) >= 1) {
      튐.push(`${f.replace('.json', '').padEnd(24)} ${i}번째에서 ${앞} → ${뒤} (총 ${cs.length}장)`)
      break
    }
  }
}
console.log(`\n  [작가별] 카드가 3장 이상인 작가 ${작가봄}명`)
console.log(`  ${튐.length ? '✗' : '✓'} 발매 순이 크게 튀는 작가 ${튐.length}명`)
튐.slice(0, 8).forEach((e) => console.log(`      ${e}`))

// ── ③ 포켓몬명: 발매 순 ─────────────────────────────────────────────────
const pidx = JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex/index.json'), 'utf-8')) as any[]
let 도감봄 = 0
const 도감깨짐: string[] = []
for (const r of pidx) {
  let arr: any[]
  try { arr = JSON.parse(readFileSync(path.join(ROOT, `public/pokedex/${r.id}.json`), 'utf-8')) } catch { continue }
  if (arr.length < 2) continue
  도감봄++
  let 앞날 = ''
  for (const c of arr) {
    const 날 = String(c.date ?? 발매.get(c.s) ?? '')
    if (!날) continue
    if (앞날 && 날 < 앞날) { 도감깨짐.push(`${r.ko} — ${앞날} 다음에 ${날}`); break }
    앞날 = 날
  }
}
console.log(`\n  [포켓몬명] 카드가 2장 이상인 이름 ${도감봄}개`)
console.log(`  ${도감깨짐.length ? '✗' : '✓'} 발매 순이 깨진 것 ${도감깨짐.length}개`)
도감깨짐.slice(0, 8).forEach((e) => console.log(`      ${e}`))

// ── ④ 화면에 원어가 새는 카드 ────────────────────────────────────────────
let 총 = 0
const 샘: string[] = []
for (const s of sidx) {
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  for (const c of d.cards ?? []) {
    총++
    const ko = koName(s.ed, String(c.name ?? ''))
    const 남음 = /[ぁ-んァ-ヶ一-鿿]/.test(ko) || (s.ed === 'ja' && /^[A-Za-z0-9 .'&-]+$/.test(ko) && /[A-Za-z]{3}/.test(ko))
    if (남음 && 샘.length < 10) 샘.push(`${s.slug.padEnd(12)} ${String(c.n).padStart(4)} "${c.name}" → "${ko}"`)
    if (남음) 샘.length // 세기만
  }
}
const 새는수 = 샘.length
console.log(`\n  [카드 이름] ${총.toLocaleString()}장 중 화면에 원어가 남는 것 ${새는수 >= 10 ? '10장 이상' : `${새는수}장`}`)
샘.forEach((e) => console.log(`      ${e}`))
console.log('')
