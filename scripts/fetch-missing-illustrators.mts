// 작가 자료가 통째로 비어 있는 영문판 세트를 TCGdex에서 채운다.
//
// 왜 필요한가: 작가 목록은 pokemontcg.io에서 받는데, **그 DB에 작가 칸이 비어 있는
// 세트가 있다**(2026-08-08 확인). 카드는 다 있는데 작가만 없다 —
//   Surging Sparks 252장 · Prismatic Evolutions 180장 · Stellar Crown 175장 …
//   영문판 20,964장 중 1,908장(9%)이 어느 작가에도 안 붙어 있었다.
// 새 세트라서가 아니다. 피치 블랙(2026-07)은 들어 있는데 서징 스파크스(2024-11)가 없다.
//
// TCGdex(우리가 세트 자료를 받는 그곳)에는 들어 있다 — sv08-001 → "Tetsu Kayama".
// 무료이고 키도 필요 없다. 낱장으로 물어봐야 해서(세트 응답에는 illustrator가 없다)
// 카드 1,564장에 약 7분 걸린다.
//
// 이 스크립트는 **받아서 파일로만 적는다.** 합치는 것은 merge-illustrators.mts가 한다
// (받은 것을 눈으로 확인한 뒤 합치려고 둘로 나눴다).
//
// 돌리기: node --experimental-strip-types scripts/fetch-missing-illustrators.mts

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const 나온곳 = path.join(ROOT, 'scripts/.illustrators.json')
const 쉬기 = (ms: number) => new Promise((r) => setTimeout(r, ms))

type 세트 = { slug: string; ed: string; name: string; serie?: string; id: string }
const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf8')) as 세트[]

// 작가 자료가 이미 덮고 있는 세트
const A = JSON.parse(readFileSync(path.join(ROOT, 'public/artists/index.json'), 'utf8')) as { slug: string }[]
const 덮은세트 = new Set<string>()
for (const a of A) {
  const d = JSON.parse(readFileSync(path.join(ROOT, `public/artists/${a.slug}.json`), 'utf8')) as {
    cards?: { s?: string }[]
  }
  for (const c of d.cards ?? []) if (c.s) 덮은세트.add(c.s)
}

const 채울세트 = idx.filter(
  (s) => s.ed === 'en' && !String(s.serie ?? '').includes('Pocket') && !덮은세트.has(s.slug),
)
console.log(`작가 자료가 없는 영문판 세트 ${채울세트.length}개를 채웁니다.`)

const 결과: Record<string, { illustrator: string; name: string; number: string; set: string; img: string; s: string }> = {}
let 본것 = 0
let 찾음 = 0

for (const s of 채울세트) {
  const d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf8')) as {
    cards?: { n: string; name: string; img?: string }[]
  }
  const cards = d.cards ?? []
  // TCGdex 카드 id는 "<세트id소문자>-<번호>"다. 우리 세트 id를 그대로 쓴다(sv08 · me01 …).
  const 세트id = String(s.id).toLowerCase()
  let 이번찾음 = 0
  for (const c of cards) {
    본것++
    try {
      const r = await fetch(`https://api.tcgdex.net/v2/en/cards/${세트id}-${c.n}`)
      if (r.ok) {
        const j = (await r.json()) as { illustrator?: string }
        if (j.illustrator) {
          결과[`${s.slug}|${c.n}`] = {
            illustrator: j.illustrator,
            name: c.name,
            number: String(Number(c.n)),
            set: s.name,
            img: c.img ?? '',
            s: s.slug,
          }
          찾음++
          이번찾음++
        }
      }
    } catch {
      // 한 장 실패는 넘어간다. 전체를 멈추지 않는다.
    }
    await 쉬기(150)
  }
  console.log(`  ${s.slug.padEnd(14)} ${String(s.name).slice(0, 24).padEnd(26)} ${이번찾음}/${cards.length}`)
  writeFileSync(나온곳, JSON.stringify(결과))
}

console.log(`\n카드 ${본것.toLocaleString()}장을 물어 ${찾음.toLocaleString()}장에서 작가를 찾았습니다.`)
console.log(`서로 다른 작가 ${new Set(Object.values(결과).map((x) => x.illustrator)).size}명`)
console.log(`${path.relative(ROOT, 나온곳)} 에 적었습니다.`)
