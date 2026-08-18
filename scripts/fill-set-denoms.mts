/**
 * 세트마다 **인쇄된 분모**를 채운다. `public/sets/index.json`의 `denom` 칸. **크레딧 0**(TCGdex).
 *
 * 왜 — 카드에 찍힌 번호는 「4/130」인데 우리 도감엔 앞의 4만 있고 **130이 없다.**
 * 도감에서 짐작하면 틀린다: ja-CP6는 도감에 103장(시크릿 포함)이라 "103"으로 보이지만
 * 실제 인쇄된 분모는 **87**이다. 이 분모가 없어서 이베이 매물 제목("11/87")을 도감 카드와
 * 못 잇고 있었다 — 조각 164장 중 6장(4%)만 이어졌다(2026-08-10).
 *
 * TCGdex의 `cardCount.official`이 정확히 이 값이다(직접 확인: base4→130 · CP6→87).
 *
 * 실행:  npx tsx scripts/fill-set-denoms.mts          훑기만
 *        npx tsx scripts/fill-set-denoms.mts --write   index.json에 적기
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const 곳 = path.resolve('public/sets/index.json')
type 줄 = { slug: string; ed?: string; id?: string; name?: string; denom?: number }
const idx = JSON.parse(readFileSync(곳, 'utf-8')) as 줄[]

// PPT가 만든 세트(ppt-*)는 TCGdex에 없다. 나머지만 묻는다.
const 물을것 = idx.filter((s) => s.id && !/^ppt-/.test(String(s.id)))
console.log(`세트 ${idx.length}개 중 TCGdex 아이디 있는 것 ${물을것.length}개`)

let 채움 = 0
let 실패 = 0
const 실패목록: string[] = []
const 하나 = async (s: 줄) => {
  // 판이 맞는 쪽을 먼저 묻고, 없으면 반대쪽도 본다(TCGdex는 두 판을 따로 든다).
  const 순서 = s.ed === 'ja' ? ['ja', 'en'] : ['en', 'ja']
  for (const lang of 순서) {
    try {
      const r = await fetch(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(String(s.id))}`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) continue
      const j = (await r.json()) as { cardCount?: { official?: number } }
      const d = Number(j.cardCount?.official ?? 0)
      if (d > 0) {
        s.denom = d
        채움++
        return
      }
    } catch {
      /* 다음 판으로 */
    }
  }
  실패++
  if (실패목록.length < 15) 실패목록.push(`${s.slug} (id=${s.id})`)
}

// 여덟씩 묶어 부른다 — 무료 API라도 한꺼번에 퍼부으면 예의가 아니다.
for (let i = 0; i < 물을것.length; i += 8) {
  await Promise.all(물을것.slice(i, i + 8).map(하나))
  if (i % 80 === 0) process.stdout.write(`\r${i}/${물을것.length}…`)
}
console.log(`\n분모 채움 ${채움}개 · 못 채움 ${실패}개`)
if (실패목록.length) console.log('  못 채운 예:', 실패목록.join(' · '))

// 맞는지 아는 값으로 검산한다 — 이게 틀리면 쓰면 안 된다.
const 검산: [string, number][] = [
  ['en-base4', 130],
  ['ja-CP6', 87],
]
for (const [slug, 기대] of 검산) {
  const s = idx.find((x) => x.slug === slug)
  console.log(`  검산 ${slug}: ${s?.denom} (기대 ${기대}) ${s?.denom === 기대 ? '○' : '✗'}`)
  if (s && s.denom !== 기대) process.exit(1)
}

if (WRITE) {
  writeFileSync(곳, JSON.stringify(idx) + '\n')
  console.log(`index.json에 적었습니다`)
} else {
  console.log('(--write를 주면 적습니다)')
}
