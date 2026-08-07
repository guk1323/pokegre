// 카드 **사진과 이름이 다른 카드를 가리키는지** 전수로 본다.
//
// 왜: 목록에서 사진을 보고 누르는데 이름이 딴 카드면, 눌러서 나온 시세도 딴 카드다.
// SM12a 181은 이름이 '블래키&다크라이 GX'인데 사진은 Deoxys-Espeon-GX였다
// (182가 진짜 블래키&다크라이다 — 2026-08-07 발견).
//
// 어떻게: pokellector 사진 주소에는 영문 카드 이름이 들어 있다
// (.../Umbreon-Darkrai-GX.SM12A.182.png). 거기서 **포켓몬 이름만** 뽑아 우리 카드 이름에서
// 뽑은 것과 견준다. 이름 표기 차이(&·띄어쓰기·순서)는 자동으로 무시된다.
//
// ⚠️ 사진에 영문 이름이 든 카드에만 쓸 수 있다(약 1,100장). 나머지는 이 방법으로 못 본다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import { koName } from '../src/lib/cardCatalog.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
type PN = { ko: string; en: string; ja: string }
const 목록 = (pokemonNames as PN[]).filter((p) => p.ko && p.en)
// 긴 이름부터 찾아야 '에브이'가 '에브이&…' 안에서 짧게 잘리지 않는다.
const 한글순 = [...목록].sort((a, b) => b.ko.length - a.ko.length)
const 영문순 = [...목록].sort((a, b) => b.en.length - a.en.length)

const 한글에서 = (s: string) => {
  const 찾음 = new Set<string>()
  let 남은 = s
  for (const p of 한글순) if (남은.includes(p.ko)) { 찾음.add(p.en.toLowerCase()); 남은 = 남은.split(p.ko).join(' ') }
  return 찾음
}
const 영문에서 = (s: string) => {
  const 찾음 = new Set<string>()
  let 남은 = ` ${s.toLowerCase()} `
  for (const p of 영문순) {
    const w = p.en.toLowerCase()
    if (남은.includes(w)) { 찾음.add(w); 남은 = 남은.split(w).join(' ') }
  }
  return 찾음
}
const 사진영문 = (url: string) => {
  const m = decodeURIComponent(String(url ?? '')).match(/\/([A-Za-z][A-Za-z0-9_-]*)\.[A-Za-z0-9]+\.\d+\.\d+\.thumb/)
  return m ? m[1].replace(/[_-]+/g, ' ').trim() : ''
}

let 봄 = 0, 맞음 = 0
const 어긋남: string[] = []
for (const s of sidx) {
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  for (const c of d.cards ?? []) {
    const 사진 = 사진영문(String(c.img ?? ''))
    if (!사진) continue
    const 사진몬 = 영문에서(사진)
    if (!사진몬.size) continue // 사진이 포켓몬 카드가 아니면 견줄 수 없다
    const ko = koName(s.ed, String(c.name ?? ''))
    const 이름몬 = 한글에서(ko)
    if (!이름몬.size) continue
    봄++
    // 한쪽이라도 겹치면 같은 카드로 본다(태그팀은 한 마리만 적힌 표기도 있다).
    const 겹침 = [...이름몬].some((x) => 사진몬.has(x))
    if (겹침) { 맞음++; continue }
    어긋남.push(`${s.slug.padEnd(12)} ${String(c.n).padStart(4)}  이름 "${ko}"  ↔  사진 "${사진}"`)
  }
}
console.log(`\n  사진으로 견줄 수 있는 카드 ${봄}장`)
console.log(`  ✓ 사진과 이름이 같은 카드  ${맞음}장`)
console.log(`  ✗ 서로 다른 카드를 가리킴  ${어긋남.length}장\n`)
어긋남.slice(0, 40).forEach((l) => console.log(`      ${l}`))
if (어긋남.length > 40) console.log(`      … 그 밖 ${어긋남.length - 40}장`)
console.log('')
