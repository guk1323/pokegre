/**
 * 저쪽 덤프에 있는데 **우리 목록엔 없는 세트**를 카드 목록으로 만든다.
 *
 * 우리 목록엔 일본판 2007~2012년(DP·Pt·L·BW)이 통째로 빠져 있고, 영문판도 섀도우리스·
 * 프라이즈팩 같은 것이 없다. 합치면 **9,000장이 넘는다.**
 *
 * 재료 — TCGdex는 이 세트들의 **카드를 안 준다**(목록엔 있는데 속이 비었다. 실측).
 *   덤프       번호 · 이름(영어) · 레어도 · 저쪽 번호(tcgPlayerId)
 *   우리 번역기  화면에 낼 때 한글로 옮긴다 → **파일에는 원어를 둔다**
 *   자동 작업   그림 (매일 도는 "빈 그림 채우기"가 나중에 메운다)
 *
 * ⚠️⚠️ **번호가 없는 세트는 안 만든다.** 번호가 우리 시스템의 열쇠다. 지어내면 `NAN1` 같은
 *    가짜 번호가 또 생긴다 — 지금 227장이 그것 때문에 못 붙고 있다(DP 시대가 여기 걸린다).
 * ⚠️ 세트 이름은 **원어 그대로** 넣는다. 화면은 `koSet()`이 옮기므로, 한글 이름은
 *    `src/lib/setNameKo.ts`의 `SET_KO`에 적는다 — 데이터와 번역을 섞지 않는다.
 * ⚠️ 만들면 반드시 이어서:
 *      npm run 대조표 <덤프> --write          (저쪽 번호가 공짜로 붙는다)
 *      npx tsx scripts/gen-card-name-suggestions.mts   (한글 검색 재료)
 *
 * 실행: npx tsx scripts/sets-from-dump.mts <덤프.csv> <목록.json> [--write]
 *   목록.json = [{ "저쪽이름": "...", "slug": "en-...", "id": "...", "serie": "..." }, …]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 번호열쇠 } from '../src/lib/cardNo.ts'
import { koName } from '../src/lib/koCardName.ts'
import { 덤프읽기 } from './card-id-map/lib.mts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [CSV, 목록파일] = process.argv.slice(2)
const WRITE = process.argv.includes('--write')
if (!CSV || !existsSync(CSV) || !목록파일 || !existsSync(목록파일)) {
  console.log('덤프 csv 경로와 만들 세트 목록(json)을 주세요')
  process.exit(1)
}
type 만들것 = { 저쪽이름: string; slug: string; id: string; serie: string; releaseDate?: string }
const 만들것들 = JSON.parse(readFileSync(목록파일, 'utf8')) as 만들것[]
const dir = join(ROOT, 'public/sets')
const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Record<string, unknown>[]
const 세트표 = JSON.parse(readFileSync(join(ROOT, 'src/data/pptSets.json'), 'utf8')) as Record<string, unknown>[]
const 있는slug = new Set(idx.map((s) => String(s.slug)))

const 덤프 = 덤프읽기(CSV)
const 이름별 = new Map<string, typeof 덤프>()
for (const r of 덤프) (이름별.get(r.setName) ?? 이름별.set(r.setName, []).get(r.setName)!).push(r)

/**
 * 저쪽이 이름 끝에 붙이는 **번호 꼬리**를 뗀다.
 * ⚠️ 모양이 여러 가지다 — `- 174/086` · `- 005/L` · `- SM198` · 그냥 ` 011/015`.
 *    붙임표만 보고 뗐더니 429장에 번호가 그대로 남아 한글로 안 옮겨졌다(2026-08-09).
 * ⚠️ 이름 속 붙임표(Ho-Oh·Porygon-Z)는 건드리면 안 된다.
 */
const 이름다듬기 = (s: string) =>
  s
    .replace(/\s+-\s+[A-Za-z0-9]{1,6}\d*\s*\/\s*\S+\s*$/, '')
    .replace(/\s+-\s+[A-Z]{1,4}\d{1,4}\s*$/, '')
    .replace(/\s+\d{1,4}\s*\/\s*\S+\s*$/, '')
    .trim()
/**
 * 이 줄이 **우리 목록에서 가질 번호**.
 *
 * ⚠️⚠️ 저쪽은 한 세트에 **서로 다른 카드를 같은 번호로** 넣어 두는 곳이 있다. 그냥 앞자리만
 *    쓰면 그 카드들이 한 칸에 뭉개고, 그게 곧 섞임이다(2026-08-09에 238장이 그랬다):
 *        19/68 Pikachu (#55 Pikachu Stamped)
 *        19/68 Pikachu (#2 Pikachu Stamped)     ← 다른 카드다
 *    다행히 저쪽이 **이름에 구분표를 적어 둔다.** 그것을 번호 뒤에 붙여 제자리를 준다.
 *      `(#55 … Stamped)` → 그 상품에서의 번호      `- Pikachu 47` → 어느 덱의 몇 번
 *      `(Team Up)` 같은 꼬리표 → 그대로 구분표로
 * ⚠️ 스탬프 이름과 `#번호`는 **둘 다** 써야 갈린다(`#50 Charizard` ↔ `#50 Pikachu`).
 * ⚠️ 그래도 겹치면 **분모까지** 붙인다(`119/156` ↔ `119/149`).
 */
/** 이 줄을 다른 줄과 갈라 줄 **구분표**. 저쪽이 이름에 적어 둔 것을 그대로 쓴다. */
function 구분표(name: string): string {
  const 조각: string[] = []
  const 속 = /\(#\s*(\d+)/.exec(name)
  if (속) 조각.push('#' + 속[1])
  const 스 = /\(([^)]*?)\s*Stamped\)/.exec(name)
  if (스?.[1]) 조각.push(스[1].replace(/#\s*\d+\s*/, '').replace(/\s+/g, ''))
  if (!조각.length) {
    const 덱 = /-\s*([A-Za-z][A-Za-z ]*?)\s*(\d+)\s*$/.exec(name)
    if (덱) 조각.push(덱[1].replace(/\s+/g, '') + 덱[2])
    else {
      const 괄 = /\(([^)]+)\)\s*$/.exec(name)
      if (괄) 조각.push(괄[1].replace(/\s+/g, ''))
    }
  }
  return 조각.join('')
}

/** 인쇄판 표시는 **같은 카드**다 — 갈라야 할지 따질 때 떼고 본다. */
const 인쇄판표시 = /\((?:mirror\s+)?(?:reverse\s+)?holo(?:foil)?\)|\(non-holo[^)]*\)|\(master ball[^)]*\)|\(poke ball[^)]*\)|\(cosmos[^)]*\)|\(reverse[^)]*\)/gi
const 카드됨 = (name: string) =>
  name.replace(/\s*-\s*[\w/]+/g, ' ').replace(인쇄판표시, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

let 만든세트 = 0
let 만든카드 = 0
const 못한것: string[] = []
for (const e of 만들것들) {
  if (있는slug.has(e.slug)) {
    못한것.push(`   ${e.slug} — 이미 있는 세트입니다`)
    continue
  }
  const 줄 = 이름별.get(e.저쪽이름)
  if (!줄?.length) {
    못한것.push(`   ${e.slug} — 덤프에 "${e.저쪽이름}"이 없습니다`)
    continue
  }
  // ⚠️⚠️ **한 번호에 서로 다른 카드가 오는 곳이 있다.** 그냥 앞자리만 쓰면 뭉개고, 그게 곧
  //    섞임이다(2026-08-09에 238장이 그랬다):
  //        19/68 Pikachu (#55 Pikachu Stamped)  ↔  19/68 Pikachu (#2 Pikachu Stamped)
  //    저쪽이 이름에 구분표를 적어 두므로 그것을 번호 뒤에 붙여 **제자리를 준다.**
  // ⚠️ 다만 **겹치는 번호에만** 붙인다. 안 겹치는데 붙이면 번호가 지저분해진다
  //    (`143~143/175.175` 같은 것이 나왔다).
  const 겹치는번호 = new Set<string>()
  {
    const 임시 = new Map<string, Set<string>>()
    for (const r of 줄) {
      const n = 번호열쇠(String(r.num).split('/')[0])
      if (!n) continue
      ;(임시.get(n) ?? 임시.set(n, new Set()).get(n)!).add(카드됨(r.name))
    }
    for (const [n, v] of 임시) if (v.size > 1) 겹치는번호.add(n)
  }
  const 번호별 = new Map<string, { id: string; name: string; rarity: string; 파는곳: number }>()
  for (const r of 줄) {
    const 앞 = 번호열쇠(String(r.num).split('/')[0])
    if (!앞) continue
    let n = 앞
    if (겹치는번호.has(앞)) {
      const 표 = 구분표(r.name)
      const 뒤 = String(r.num).includes('/') ? String(r.num).split('/')[1].trim() : ''
      n = 표 ? `${앞}~${표}${뒤 ? '.' + 뒤 : ''}` : 앞
    }
    const 있 = 번호별.get(n)
    const 기본 = !r.name.includes('(')
    const 옛기본 = 있 ? !있.name.includes('(') : false
    if (!있 || (기본 && !옛기본) || (기본 === 옛기본 && r.파는곳 > 있.파는곳))
      번호별.set(n, { id: r.id, name: r.name, rarity: r.rarity, 파는곳: r.파는곳 })
  }
  if (!번호별.size) {
    못한것.push(`   ${e.slug} — 번호가 있는 줄이 하나도 없습니다(만들지 않습니다)`)
    continue
  }
  const cards = [...번호별.entries()]
    .sort((a, b) => (Number(a[0]) || 1e9) - (Number(b[0]) || 1e9) || a[0].localeCompare(b[0]))
    .map(([n, v]) => ({ n, name: 이름다듬기(v.name), img: '', r: v.rarity }))
  const 판 = 줄[0].lang === 'japanese' ? 'ja' : 'en'
  const 못옮김 = cards.filter((c) => koName(판, c.name) === c.name && /[A-Za-z]{3,}/.test(c.name)).length

  console.log(
    `   ${e.slug.padEnd(16)} ${String(cards.length).padStart(4)}장  한글로 못 옮긴 이름 ${String(못옮김).padStart(3)}장  ${e.저쪽이름.slice(0, 34)}`,
  )
  만든세트++
  만든카드 += cards.length
  if (WRITE) {
    writeFileSync(join(dir, `${e.slug}.json`), JSON.stringify({ ed: 판, id: e.id, name: e.저쪽이름, cards }) + '\n')
    idx.push({
      slug: e.slug,
      ed: 판,
      id: e.id,
      name: e.저쪽이름,
      count: cards.length,
      releaseDate: e.releaseDate ?? '',
      serie: e.serie,
      logo: '',
      cover: '',
    })
    세트표.push({ slug: e.slug, setId: Number(줄[0].setId), 메모: '덤프에서 만든 세트' })
  }
}

console.log(`\n세트 ${만든세트}개 · 카드 ${만든카드.toLocaleString()}장`)
for (const x of 못한것) console.log(x)
if (WRITE) {
  writeFileSync(join(dir, 'index.json'), JSON.stringify(idx) + '\n')
  writeFileSync(join(ROOT, 'src/data/pptSets.json'), JSON.stringify(세트표, null, 1) + '\n')
  console.log('\npublic/sets/*.json · index.json · src/data/pptSets.json 을 갱신했습니다.')
  console.log('이어서 반드시: npm run 대조표 <덤프> --write · npx tsx scripts/gen-card-name-suggestions.mts')
}
