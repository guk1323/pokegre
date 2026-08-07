// 옛 일본판 세트에서 **누른 카드와 다른 카드가 나오는** 장이 몇 장인지 전수로 센다.
//
// 왜: ja-neo4 38번은 우리 화면에 "다크 오무스타"(사진 파일명도 Dark-Omastar.NEO4.38)인데,
// 스니커덩크에 "neo4 038"로 물으면 "상냥한 식스테일"이 나온다. 옛 세트는 일본판이 원조라
// 영문판과 번호 매김이 다른데, 우리 데이터가 세트에 따라 영문판 번호를 담고 있어서다
// (2026-08-07 점검 중 발견). 값이 안 나오는 것보다, 남의 카드 값을 그 카드인 양
// 보여 주는 쪽이 훨씬 나쁘다.
//
// 무엇을 세나: 사진을 영문판 소스(pokellector 등)에서 가져온 일본판 세트의 카드를 전부
// 스니커덩크에 물어, ① 아예 없는 것 ② 있고 이름도 맞는 것 ③ **있는데 이름이 다른 것**.
// ③이 실제 위험이고, 그 수가 손볼 방식을 정한다.
//
// ⚠️ 스니커덩크는 무료다 — PPT 크레딧을 쓰지 않는다. 대신 느리게 두드린다(600ms).
// ⚠️ 우리 이름이 영문인 카드는 일본어 제목과 글자로 비교할 수 없어 따로 센다.
//
// 쓰는 법: npx tsx scripts/check-old-jp-sets.mts [최대장수]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/cardCatalog.ts'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 상한 = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : Infinity
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))
const 서버 = process.env.POKEGRE_ORIGIN ?? 'http://localhost:3000'

type SetMeta = { slug: string; ed: 'ja' | 'en'; id: string; name: string; serie?: string }
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as SetMeta[]

const 제목이름 = (t: string) =>
  String(t)
    .split('[')[0]
    .replace(/[◆●★☆]|:\s*\d?ED/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const 이름열쇠 = (s: string) =>
  String(s)
    .replace(/[\s・·:：]/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[-–—♢◇☆★]/g, '')
    .replace(/\b(?:pr|promo|sr|sar|ar|ur|hr|rr+|csr|chr|旧裏)\b/gi, '')
    .toLowerCase()

// 사진을 영문판 소스에서 가져온 일본판 세트만 본다.
const 대상: { s: SetMeta; cards: { n: string; name: string; img: string }[] }[] = []
for (const s of index) {
  if (s.ed !== 'ja' || (s.serie ?? '').includes('Pocket')) continue
  let d: any
  try {
    d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', `${s.slug}.json`), 'utf-8'))
  } catch {
    continue
  }
  const cs = (d.cards ?? []).filter((c: any) => /pokellector|images\.pokemontcg\.io/.test(c.img ?? ''))
  if (cs.length) 대상.push({ s, cards: cs })
}

const 총장수 = 대상.reduce((a, b) => a + b.cards.length, 0)
console.log(`\n  영문판 사진을 쓰는 일본판 세트 ${대상.length}개 · 카드 ${총장수.toLocaleString()}장`)
console.log(`  스니커덩크에 하나씩 물어본다(무료, 0.6초 간격 — ${Math.ceil(Math.min(총장수, 상한) * 0.7 / 60)}분쯤)\n`)

let 봄 = 0
let 없음 = 0
let 맞음 = 0
let 영문 = 0
const 다름: string[] = []
const 세트별 = new Map<string, { 봄: number; 다름: number; 맞음: number }>()

바깥: for (const { s, cards } of 대상) {
  for (const c of cards) {
    if (봄 >= 상한) break 바깥
    봄++
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
      /* 못 받으면 없음으로 둔다 */
    }
    await nap(600)
    const re = new RegExp(`\\[${s.id}[-\\s](?:No\\.)?0*${String(c.n).replace(/^0+/, '')}(?:[/\\]]|\\s)`, 'i')
    const 번호맞음 = ps.filter((p) => re.test(p.title))
    const v = 세트별.get(s.slug) ?? { 봄: 0, 다름: 0, 맞음: 0 }
    v.봄++
    if (!번호맞음.length) {
      없음++
      세트별.set(s.slug, v)
      continue
    }
    // ⚠️ 원문끼리 견주면 안 된다 — 옛 세트는 원본의 일본어 칸이 오염돼 영어 음차가
    //    들어 있다("グリマー" ↔ 정식 "ベトベター"). 화면에는 번역기가 "질퍽이"로 옳게
    //    낸다. 양쪽을 다 한글로 바꿔, 사용자가 실제로 보는 글자로 견준다(2026-08-07).
    const 우리 = 이름열쇠(koName('ja', c.name))
    if (!/[가-힣]/.test(우리)) {
      영문++
      세트별.set(s.slug, v)
      continue
    }
    const 같다 = 번호맞음.some((p) => {
      const 저쪽 = 이름열쇠(koreanizeTitle(제목이름(p.title)))
      return !!저쪽 && (저쪽.includes(우리) || 우리.includes(저쪽))
    })
    if (같다) {
      맞음++
      v.맞음++
    } else {
      v.다름++
      if (다름.length < 60)
        다름.push(
          `${s.id} ${c.n}  우리 "${koName('ja', c.name)}"  ↔  스니커덩크 "${koreanizeTitle(제목이름(번호맞음[0].title))}"`,
        )
    }
    세트별.set(s.slug, v)
    if (봄 % 25 === 0)
      process.stdout.write(`\r  ${봄}/${Math.min(총장수, 상한)}장 · 없음 ${없음} · 같음 ${맞음} · 다름 ${[...세트별.values()].reduce((a, b) => a + b.다름, 0)}   `)
  }
}

const 총다름 = [...세트별.values()].reduce((a, b) => a + b.다름, 0)
console.log(`\n\n  본 카드 ${봄.toLocaleString()}장`)
console.log(`  · 스니커덩크에 없음        ${없음.toLocaleString()}장 (다음 마켓으로 넘어간다 — 안전)`)
console.log(`  · 있고 같은 카드          ${맞음.toLocaleString()}장`)
console.log(`  · 우리 이름이 영문이라 못 봄  ${영문.toLocaleString()}장`)
console.log(`  ${총다름 ? '✗' : '✓'} 있는데 **다른 카드**     ${총다름.toLocaleString()}장\n`)
for (const e of 다름) console.log(`      ${e}`)
const 나쁜세트 = [...세트별].filter(([, v]) => v.다름).sort((a, b) => b[1].다름 - a[1].다름)
if (나쁜세트.length) {
  console.log(`\n  다른 카드가 나오는 세트 ${나쁜세트.length}개:`)
  for (const [slug, v] of 나쁜세트) console.log(`      ${slug.padEnd(14)} ${v.다름}장 다름 / ${v.봄}장 중`)
  writeFileSync(
    path.join(ROOT, 'scripts/_old-jp-mismatch.json'),
    JSON.stringify(Object.fromEntries(나쁜세트.map(([k, v]) => [k, v])), null, 2),
  )
  console.log(`\n  scripts/_old-jp-mismatch.json 에 적어 두었다.`)
}
console.log('')
