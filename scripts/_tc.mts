import { canonicalizeSearchTerm, translateSearchQuery } from '../src/lib/translateQuery.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
for (const q of ['로켓단 에너지','일격 에너지','연격 에너지','퓨전 에너지','기프트 에너지','레인보우 에너지','더블무지개에너지','기본 물 에너지']) {
  console.log(`"${q}"`)
  console.log(`   스니커덩크로: ${translateSearchQuery(q)}`)
  console.log(`   이베이(일본판): ${translateSearchQueryToEnglish(q,'japanese')}`)
  console.log(`   인기검색어로 저장될 말: "${canonicalizeSearchTerm(q)}"`)
}
