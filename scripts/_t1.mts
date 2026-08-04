import { translateSearchQuery } from '../src/lib/translateQuery.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
const qs = process.argv.slice(2)
for (const q of qs) {
  console.log(`"${q}"`)
  console.log(`   JA: ${translateSearchQuery(q)}`)
  console.log(`   EN(jp): ${translateSearchQueryToEnglish(q, 'japanese')}`)
  console.log(`   EN(en): ${translateSearchQueryToEnglish(q, 'english')}`)
}
