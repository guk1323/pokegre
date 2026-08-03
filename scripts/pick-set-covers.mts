// 세트 목록 타일에 쓸 대표 카드(cover)를 그 세트에서 제일 좋은 등급의 카드로 고른다.
//
// 왜 필요한가: 지금은 1번 카드를 쓰는데, 1번은 대개 커먼이다. 366개 중 251개 세트가
// 평범한 풀 포켓몬 카드로 진열돼 있어 목록이 심심하다. 세트마다 등급 정보(r)가 이미
// 있으므로 크레딧 한 푼 안 쓰고 가장 좋은 카드를 고를 수 있다.
//
// ⚠️ 시세를 받아 둔 세트(setHitCards.json)는 건드리지 않는다. 그쪽은 "실제로 제일 비싼
//    카드"를 서버가 화면에 내려주므로 등급으로 고른 것보다 정확하다.
// ⚠️ 그림이 있는 카드만 고른다. 등급만 높고 그림이 없으면 뒷면이 뜬다.
//
// 쓰기: npx tsx scripts/pick-set-covers.mts          (몇 개 바뀌는지만)
//       npx tsx scripts/pick-set-covers.mts --write  (저장)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rarityRank } from '../src/lib/cardCatalog.ts'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

const idxPath = join(ROOT, 'public/sets/index.json')
const idx = JSON.parse(readFileSync(idxPath, 'utf8')) as { slug: string; name: string; cover?: string }[]
const hit = JSON.parse(readFileSync(join(ROOT, 'src/data/setHitCards.json'), 'utf8')) as Record<string, unknown>

const usable = (u?: string) => !!u && !u.includes('snkrdunk')

// 진열대에는 포켓몬 카드가 어울린다. 등급만 보고 고르면 "이그니션 에너지"나
// "일렉트릭 제너레이터" 같은 굿즈·에너지가 표지가 된다(실제로 그렇게 뽑혔다).
const koSet = new Set((pokemonNames as { ko: string }[]).map((p) => p.ko).filter(Boolean))
const isPokemon = (name: string, ja: boolean) => {
  const ko = ja ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name)
  return [...koSet].some((k) => k.length >= 2 && ko.includes(k))
}

let changed = 0
let skipped = 0
for (const s of idx) {
  if (hit[s.slug]) {
    skipped++
    continue // 시세로 고른 커버가 이미 있다
  }
  let d: { cards?: { n: string; name: string; img?: string; r?: string }[] }
  try {
    d = JSON.parse(readFileSync(join(ROOT, 'public/sets', `${s.slug}.json`), 'utf8'))
  } catch {
    continue
  }
  const cards = (d.cards ?? []).filter((c) => usable(c.img))
  const graded = cards.filter((c) => rarityRank(c.r) > 0)
  // 등급이 한 장도 없는 세트가 있다(프로모·에너지 세트는 원래 등급이 없다). 그럴 땐
  // 등급을 포기하고 그림 있는 카드 중에서 고른다 — 카드 뒷면보다 실제 카드가 낫다.
  // ⚠️ 표지가 이미 있는 세트는 이 폴백을 안 쓴다. 등급으로 고른 표지를 등급 없는
  //    카드로 바꿔치기하면 오히려 나빠진다.
  // ⚠️ 단, 스니커덩크 주소는 "있는" 것으로 치지 않는다. 화면(cardCatalog의 usable)이
  //    판매자 실물 사진이라 보고 통째로 걸러서, 표지가 있는데도 카드 뒷면이 뜬다
  //    (ja-M-P 메가 프로모카드가 그랬다 — 카드 83장은 멀쩡한 주소인데 표지만 스니커덩크).
  const hasCover = usable(s.cover)
  const all = graded.length ? graded : hasCover ? [] : cards
  if (!all.length) continue
  // 포켓몬 카드가 있으면 그 안에서만 고른다.
  const mons = all.filter((c) => isPokemon(c.name, s.slug.startsWith('ja-')))
  const ranked = mons.length ? mons : all
  // 등급이 같으면 뒤 번호(시크릿은 뒤에 붙는다)를 고른다.
  const best = ranked.reduce((a, b) => {
    const d1 = rarityRank(b.r) - rarityRank(a.r)
    if (d1 !== 0) return d1 > 0 ? b : a
    return Number(b.n) > Number(a.n) ? b : a
  })
  if (!best.img || s.cover === best.img) continue
  if (changed < 12) console.log(`  ${s.slug.padEnd(13)} ${s.name.slice(0, 18).padEnd(20)} → ${best.name} (${best.r})`)
  s.cover = best.img
  changed++
}
console.log(`\n바꾼 세트 ${changed}개 · 시세 커버가 있어 건너뛴 세트 ${skipped}개`)
if (WRITE && changed) {
  writeFileSync(idxPath, JSON.stringify(idx))
  console.log('저장했다')
} else if (!WRITE) {
  console.log('저장하려면 --write')
}
