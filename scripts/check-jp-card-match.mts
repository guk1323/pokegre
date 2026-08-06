// 일본판 카드를 눌렀을 때 **그 카드가 맞는지** 스니커덩크에 물어 대조한다.
//
// 왜: 우리가 보여 주는 사진과, 검색해서 나오는 시세가 다른 카드일 수 있다. 실제로
// ja-neo4 38번은 우리 화면에 "다크 오무스타"(북미판 Neo Destiny 38번 사진)인데,
// 스니커덩크에 "neo4 038"로 물으면 "상냥한 식스테일"이 나온다 — 일본판과 북미판은
// 번호를 매기는 방식이 달라서다(2026-08-07 점검 중 발견). 누른 카드와 다른 카드의
// 값을 보여 주는 것이라, 값이 안 나오는 것보다 나쁘다.
//
// 어떻게: 세트마다 몇 장을 뽑아 "세트코드 번호"로 스니커덩크를 부르고, 돌아온 제목에
// 우리 카드 이름이 들어 있는지 본다. 이름이 다르면 그 세트는 번호가 어긋난 것이다.
//
// ⚠️ 스니커덩크는 무료다 — PPT 크레딧을 쓰지 않는다.
// ⚠️ 0건은 "어긋남"이 아니다. 스니커덩크에 그 카드가 없을 뿐이다. 따로 센다.
//
// 쓰는 법: npx tsx scripts/check-jp-card-match.mts [세트당 장수(기본 3)] [세트슬러그…]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const 인자 = process.argv.slice(2)
const 장수 = Number(인자[0]) > 0 ? Number(인자[0]) : 3
const 고른세트 = 인자.filter((a) => a.startsWith('ja-'))
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))
const 서버 = process.env.POKEGRE_ORIGIN ?? 'http://localhost:3000'

type SetMeta = { slug: string; ed: 'ja' | 'en'; id: string; name: string; serie?: string }
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as SetMeta[]
const 대상 = index.filter(
  (s) => s.ed === 'ja' && !(s.serie ?? '').includes('Pocket') && (!고른세트.length || 고른세트.includes(s.slug)),
)

// 제목에서 카드 이름만 뽑는다. "トゲキッス R [SM9a 036/055](강화확장팩…)" → "トゲキッス"
const 제목이름 = (t: string) =>
  String(t)
    .split('[')[0]
    .replace(/[◆●★☆]|:\s*\d?ED|\s+(?:R|RR|RRR|SR|SAR|AR|UR|HR|U|C|PROMO)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
// 표기 흔들림을 걷어낸다(가운뎃점·공백·델타종 표기 등).
const 이름열쇠 = (s: string) =>
  String(s)
    .replace(/[\s・·:：]/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[-–—♢◇☆★]/g, '')
    // 등급·프로모 표기는 카드 이름이 아니다("ワタル♢" ↔ "ワタル PR").
    .replace(/\b(?:pr|promo|sr|sar|ar|ur|hr|rr+|csr|chr)\b/gi, '')
    .toLowerCase()

let 검사 = 0
let 맞음 = 0
let 없음 = 0
let 영문이라못봄 = 0
const 어긋남: string[] = []
const 세트별어긋남 = new Map<string, { 어긋: number; 검사: number }>()

console.log(`\n  일본판 세트 ${대상.length}개 · 세트당 ${장수}장씩 대조한다 (스니커덩크는 무료)\n`)

for (const s of 대상) {
  let d: { cards?: { n: string; name: string }[] }
  try {
    d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', `${s.slug}.json`), 'utf-8'))
  } catch {
    continue
  }
  const cs = (d.cards ?? []).filter((c) => c.n && c.name)
  if (!cs.length) continue
  // 앞·중간·뒤에서 고르게 뽑는다(앞쪽만 보면 번호가 어긋나는 걸 놓친다).
  const 뽑기 = Array.from({ length: Math.min(장수, cs.length) }, (_, i) =>
    cs[Math.floor(((i + 0.5) / Math.min(장수, cs.length)) * cs.length)],
  )
  let 세트어긋 = 0
  let 세트검사 = 0
  for (const c of 뽑기) {
    const q = `${s.id} ${c.n}`
    let ps: { title: string }[] = []
    try {
      const r = await fetch(
        `${서버}/api/snkrdunk/v3/search?func=all&refId=search&keyword=${encodeURIComponent(q)}` +
          `&sortKey=default&cardVersion=2&brandIds=pokemon&perPage=4&page=1`,
      )
      const j: any = await r.json()
      ps = j?.search?.rankingProducts ?? j?.search?.products ?? []
    } catch {
      /* 못 받으면 건너뛴다 */
    }
    await nap(600)
    if (!ps.length) {
      없음++
      continue
    }
    검사++
    세트검사++
    // 우리 번호를 정말로 가리키는 제목만 본다(부분 일치로 딴 세트가 걸리는 걸 막는다).
    const 번호맞는것 = ps.filter((p) =>
      new RegExp(`\\[${s.id}[-\\s](?:No\\.)?0*${String(c.n).replace(/^0+/, '')}(?:[/\\]]|\\s)`, 'i').test(p.title),
    )
    if (!번호맞는것.length) {
      없음++
      검사--
      세트검사--
      continue
    }
    // ⚠️ 우리 이름이 영문이면 일본어 제목과 글자로는 절대 안 맞는다("Lairon" ↔ "コドラ").
    //    같은 카드인데 어긋났다고 세면 진짜 어긋남이 묻힌다(첫 실행에서 4건 다 이것이었다).
    if (/^[\x20-\x7E]+$/.test(c.name)) {
      검사--
      세트검사--
      영문이라못봄++
      continue
    }
    const 우리 = 이름열쇠(c.name)
    if (번호맞는것.some((p) => 이름열쇠(제목이름(p.title)).includes(우리) || 우리.includes(이름열쇠(제목이름(p.title)))))
      맞음++
    else {
      세트어긋++
      if (어긋남.length < 20)
        어긋남.push(`${s.id} ${c.n}  우리 "${c.name}"  ↔  스니커덩크 "${제목이름(번호맞는것[0].title)}"`)
    }
  }
  if (세트어긋) 세트별어긋남.set(s.slug, { 어긋: 세트어긋, 검사: 세트검사 })
  process.stdout.write(`\r  ${s.slug.padEnd(14)} 검사 ${검사} · 맞음 ${맞음} · 어긋남 ${검사 - 맞음}      `)
}

console.log(`\n\n  대조한 카드 ${검사}장 (스니커덩크에 없어 못 본 것 ${없음}장 · 우리 이름이 영문이라 못 본 것 ${영문이라못봄}장)`)
console.log(`  ✓ 같은 카드      ${맞음}장`)
console.log(`  ${검사 - 맞음 ? '✗' : '✓'} 다른 카드가 나옴 ${검사 - 맞음}장\n`)
for (const e of 어긋남) console.log(`      ${e}`)
if (세트별어긋남.size) {
  console.log(`\n  어긋난 세트 ${세트별어긋남.size}개:`)
  for (const [slug, v] of 세트별어긋남) console.log(`      ${slug.padEnd(14)} ${v.어긋} / ${v.검사}장 어긋남`)
}
console.log('')
