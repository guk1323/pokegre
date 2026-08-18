/**
 * **한글로 찾았을 때 엉뚱한 카드가 올라오나** 무작위로 본다.
 *
 * 저쪽(PPT)의 search는 카드 이름만 보는 게 아니라 **세트 이름까지 뒤진다.** 그래서
 * "이상해씨"로 찾으면 「Intro Pack (Bulbasaur)」 세트가 걸려 그 세트의 포션·에너지가
 * 올라온다(사용자 제보로 알려진 문제). 값 높은 순으로 받아 잡동사니를 뒤로 미는 것이
 * 지금의 대책인데, 실제로 몇 장이나 섞이는지는 재 본 적이 없다.
 *
 * ⚠️ 배포하지 않고 본다 — 저쪽 원본을 받아 서버가 쓰는 함수를 그대로 돌린다.
 * ⚠️ 화면이 쓰는 번역기(translateSearchQueryToEnglish)를 그대로 쓴다. 따로 적으면
 *    검사기가 없는 문제를 만들어 낸다(오늘만 세 번 겪었다).
 *
 * 실행: npx tsx scripts/spot-check-search.mts [검색어 수]
 */
import { readFileSync } from 'node:fs'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import { shapeEbayCards } from '../server/api.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const key = (readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^POKEMON_PRICE_TRACKER_API_KEY=(.*)$/m) ?? [])[1]?.trim()
if (!key) { console.log('.env에 PPT 키가 없습니다'); process.exit(1) }

const 몬 = (pokemonNames as { ko: string; en: string }[]).filter((p) => p.ko && p.en && p.ko.length >= 2)
const N = Number(process.argv[2] ?? 12)
const 고른것 = [...몬].sort(() => Math.random() - 0.5).slice(0, N)

let 카드수 = 0
const 섞임: string[] = []
for (const p of 고른것) {
  const en = translateSearchQueryToEnglish(p.ko, 'english')
  if (!en) { 섞임.push(`  [번역 안 됨] "${p.ko}"`); continue }
  const q = new URLSearchParams({ language: 'english', search: en, limit: '10', includeEbay: 'true', sortBy: 'price', sortOrder: 'desc' })
  const r = await fetch(`https://www.pokemonpricetracker.com/api/v2/cards?${q}`, { headers: { authorization: `Bearer ${key}` } })
  if (!r.ok) { 섞임.push(`  [저쪽 ${r.status}] "${p.ko}"`); continue }
  const 온것 = (await shapeEbayCards(await r.json(), 'ebay')) as unknown as { name: string; setName: string }[]
  // ⚠️ 이름이 **그 포켓몬을 품고 있으면** 맞는 카드다. 진화형·태그팀도 이름에 들어 있다.
  const 맞나 = (nm: string) => nm.toLowerCase().replace(/[^a-z]/g, '').includes(en.toLowerCase().replace(/[^a-z]/g, ''))
  for (const c of 온것) {
    카드수++
    if (!맞나(String(c.name))) 섞임.push(`  "${p.ko}"(${en}) 로 찾았는데 → "${c.name}"   [세트 ${c.setName}]`)
  }
}
console.log(`검색어 ${고른것.length}개 · 올라온 카드 ${카드수}장`)
console.log(고른것.map((p) => p.ko).join(' · '))
console.log(섞임.length ? `\n⚠️ 엉뚱한 카드 ${섞임.length}장 (${((섞임.length / Math.max(카드수, 1)) * 100).toFixed(1)}%)` : '\n엉뚱한 카드: 없음')
for (const x of 섞임.slice(0, 20)) console.log(x)
