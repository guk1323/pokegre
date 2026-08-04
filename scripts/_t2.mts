import { readFileSync, readdirSync } from 'node:fs'
import { CARD_NAME_KO_TO_EN, CARD_NAME_KO_TO_EN_NOSPACE } from '../src/lib/koreanizeEnglishTitle.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import auto from '../src/data/cardNameKoEn.json' with { type: 'json' }

// 북미판 세트에 실제로 있는 영문 카드명 전부
const enNames = new Set<string>()
for (const f of readdirSync('public/sets')) {
  if (!f.startsWith('en-') || !f.endsWith('.json')) continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as { cards?: { name: string }[] }
  for (const c of d.cards ?? []) if (c.name) enNames.add(c.name)
}
const JP_KEYS = ['캡틴피카츄','붉은 섬광','푸른 충격','피카츄 온 더 볼','이브이 온 더 볼','흥나숭 온 더 볼','염버니 온 더 볼','울머기 온 더 볼','마티스의 거래','로켓단의리시버','파이팅공','로켓단에너지','청목의 수완','아이언 디펜더','활력의 숲','괴상한 시계','추리세트','느긋풀','용의 비약','로켓단의 깜짝봄','N의 방안','스파이크에너지','리치 에너지','시간벌기터보','안전고글','타이트밴드','시트론의 재치','낚싯대MAX','뉴트럴센터']
console.log('=== JP_SEARCH_ONLY 항목이 북미판 검색에도 그대로 나가는지 ===')
for (const k of JP_KEYS) {
  const en = translateSearchQueryToEnglish(k, 'english')
  const hand = CARD_NAME_KO_TO_EN.get(k) ?? CARD_NAME_KO_TO_EN_NOSPACE.get(k.replace(/[\s·]/g,''))
  const a = (auto as Record<string,string>)[k]
  const exists = enNames.has(en)
  if (!exists) console.log(`  ✗ "${k}" → 북미판으로 "${en}" (북미판 카드목록에 없음) | 손사전:${hand ?? '-'} | 자동사전:${a ?? '-'}`)
  else console.log(`  ○ "${k}" → ${en}`)
}
