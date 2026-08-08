// fetch-missing-illustrators.mts가 받아 둔 작가 정보를 public/artists/ 에 합친다.
//
// ⚠️ 받기와 합치기를 나눈 이유: 받는 데 7분이 걸려서, 잘못 합쳤을 때 다시 받고 싶지
//    않다. 받은 것(.illustrators.json)을 눈으로 확인한 뒤 이걸 돌린다.
//
// 하는 일
//   ① 이미 있는 작가면 그 파일에 카드를 더한다(영문 이름이 똑같을 때만).
//   ② 없는 작가면 새로 만든다(슬러그·index 한 줄·낱개 파일).
//   ③ 카드는 **발매일 최신순**으로 다시 세운다(원래 그 순서다).
//   ④ count를 index와 낱개 파일 양쪽에서 다시 센다.
//
// ⚠️ 같은 카드를 두 번 넣지 않는다 — 세트+번호로 이미 있는지 본다.
//
// 돌리기: node --experimental-strip-types scripts/merge-illustrators.mts [--write]
//         --write 없이는 무엇이 바뀌는지만 보여 준다.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const 쓰기 = process.argv.includes('--write')
const 받은것 = JSON.parse(readFileSync(path.join(ROOT, 'scripts/.illustrators.json'), 'utf8')) as Record<
  string,
  { illustrator: string; name: string; number: string; set: string; img: string; s: string }
>

type 카드 = { name: string; number: string; set: string; img: string; s: string }
type 작가줄 = { slug: string; ko: string; en: string; note?: string; era?: string; count: number; cover?: string }

const 세트idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf8')) as {
  slug: string
  releaseDate?: string
}[]
const 발매일 = new Map(세트idx.map((s) => [s.slug, s.releaseDate ?? '']))

const 색인경로 = path.join(ROOT, 'public/artists/index.json')
const 색인 = JSON.parse(readFileSync(색인경로, 'utf8')) as 작가줄[]
const 영문으로 = new Map(색인.map((a) => [a.en.trim().toLowerCase(), a]))

// 슬러그 규칙은 이미 있는 것과 같게 만든다("5ban Graphics" → "5ban-graphics").
const 슬러그만들기 = (en: string) =>
  en
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// ⚠️ **저쪽(TCGdex) 오타를 고쳐서 합친다.** 그대로 두면 진짜 작가 옆에 1장짜리
//    가짜가 생긴다. 글자 하나~둘 차이이고 기존 작가가 수백~수천 장인 것만 골랐다
//    (2026-08-08 전수 대조).
const 오타고침 = new Map<string, string>([
  ['Ken Sudimori', 'Ken Sugimori'],
  ['Natsumi Yashida', 'Natsumi Yoshida'],
  ['nisimana', 'nisimono'],
])

const 무리 = new Map<string, 카드[]>()
for (const v of Object.values(받은것)) {
  const k = 오타고침.get(v.illustrator.trim()) ?? v.illustrator.trim()
  if (!k) continue
  if (!무리.has(k)) 무리.set(k, [])
  무리.get(k)!.push({ name: v.name, number: v.number, set: v.set, img: v.img, s: v.s })
}

let 더한장수 = 0
let 새작가 = 0
let 늘어난작가 = 0
const 새로만들것: { 줄: 작가줄; 카드: 카드[] }[] = []
const 고칠것: { 줄: 작가줄; 카드: 카드[] }[] = []

for (const [이름, 카드들] of 무리) {
  const 있는것 = 영문으로.get(이름.toLowerCase())
  const 파일 = 있는것 ? path.join(ROOT, `public/artists/${있는것.slug}.json`) : ''
  const 기존 = 있는것 && existsSync(파일)
    ? (JSON.parse(readFileSync(파일, 'utf8')) as { cards?: 카드[] }).cards ?? []
    : []
  // ⚠️ **번호를 Number()로 바꾸면 안 된다.** "24a"·"24b"가 둘 다 NaN이 되어 **다른
  //    카드가 같은 것으로 묶인다**(en-xya의 대체 아트가 그렇다). 0 채움만 떼면 된다
  //    ("024" = "24"). 실제로 NaN이 그대로 파일에 적힌 카드가 6장 있었다(2026-08-08).
  const 번호열쇠 = (c: 카드) => `${c.s}|${String(c.number ?? '').replace(/^0+(?=.)/, '')}`
  const 이미 = new Set(기존.map(번호열쇠))
  const 새것 = 카드들.filter((c) => !이미.has(번호열쇠(c)))
  if (새것.length === 0) continue

  const 합친것 = [...기존, ...새것].sort(
    (a, b) => String(발매일.get(b.s) ?? '').localeCompare(String(발매일.get(a.s) ?? '')),
  )
  더한장수 += 새것.length

  if (있는것) {
    늘어난작가++
    고칠것.push({ 줄: { ...있는것, count: 합친것.length }, 카드: 합친것 })
  } else {
    새작가++
    새로만들것.push({
      줄: { slug: 슬러그만들기(이름), ko: '', en: 이름, count: 합친것.length, cover: 합친것[0]?.img },
      카드: 합친것,
    })
  }
}

console.log(`받아 둔 카드 ${Object.keys(받은것).length.toLocaleString()}장 · 작가 ${무리.size}명`)
console.log(`  이미 있는 작가에 더할 것 ${늘어난작가}명 · 새로 만들 작가 ${새작가}명 · 카드 ${더한장수.toLocaleString()}장`)
console.log('  새로 만들 작가(앞 10명):', 새로만들것.slice(0, 10).map((x) => `${x.줄.en}(${x.줄.count})`).join(' · '))

if (!쓰기) {
  console.log('\n--write 를 붙이면 실제로 적습니다.')
  process.exit(0)
}

for (const { 줄, 카드 } of [...고칠것, ...새로만들것]) {
  const 파일 = path.join(ROOT, `public/artists/${줄.slug}.json`)
  const 옛 = existsSync(파일) ? (JSON.parse(readFileSync(파일, 'utf8')) as Record<string, unknown>) : {}
  writeFileSync(파일, JSON.stringify({ ...옛, en: 줄.en, ko: 줄.ko, count: 카드.length, cards: 카드 }))
}

const 새색인 = [...색인]
for (const { 줄 } of 고칠것) {
  const i = 새색인.findIndex((a) => a.slug === 줄.slug)
  if (i >= 0) 새색인[i] = { ...새색인[i], count: 줄.count }
}
for (const { 줄 } of 새로만들것) 새색인.push(줄)
// 카드 많은 순 — 원래 index가 그 순서다.
새색인.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
writeFileSync(색인경로, JSON.stringify(새색인))
console.log(`\n적었습니다. 작가 ${색인.length}명 → ${새색인.length}명`)
