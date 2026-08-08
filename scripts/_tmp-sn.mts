import { readFileSync } from 'node:fs'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
const idx = JSON.parse(readFileSync('public/sets/index.json', 'utf8')) as { slug: string; name?: string; ed?: string }[]
let 잼 = 0
const 탈: string[] = []
for (const s of idx) {
  if (s.ed !== 'ja' || !s.name || !/[가-힣]/.test(s.name)) continue
  잼++
  const code = s.slug.replace(/^ja-/, '')
  const en = translateSearchQueryToEnglish(s.name, 'japanese')
  // 그 세트의 코드로 나가면 맞다. 코드가 아니어도 한글이 안 남았으면 일단 통과로 본다.
  if (en.toLowerCase() === code.toLowerCase()) continue
  탈.push(`  ${s.slug.padEnd(12)} "${s.name}" → "${en}"  (코드는 ${code})`)
}
console.log(`한글 이름을 가진 일본판 세트 ${잼}개 · 자기 코드로 안 가는 것 ${탈.length}개\n`)
for (const x of 탈.slice(0, 25)) console.log(x)
