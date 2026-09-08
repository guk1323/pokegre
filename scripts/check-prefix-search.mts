/**
 * **앞머리 검색 회귀 검사.** 「스톰」처럼 팩 이름을 앞부분만 쳐도 일본어로 옮겨지는지,
 * 그러면서 **되던 검색이 깨지지 않았는지**를 같이 센다.
 *
 * ⚠️ 좋아진 것만 세면 안 된다 — 옮겨지는 말이 늘어도 **전에 잘 나가던 말이 딴 말로
 *    바뀌면** 그 검색은 통째로 0건이 된다. 그래서 「깨짐」을 따로 세고, 하나라도
 *    있으면 0이 아닌 값으로 끝낸다.
 *
 * 실행: npx tsx scripts/check-prefix-search.mts
 */
import { translateSearchQuery, 팩앞머리 } from '../src/lib/translateQuery.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'
import { readFileSync } from 'node:fs'
import packNames from '../src/data/packNames.json' with { type: 'json' }
import setNameKoJa from '../src/data/setNameKoJa.json' with { type: 'json' }
import setNamesKo from '../src/data/setNamesKo.json' with { type: 'json' }
import { MANUAL_PACK_OVERRIDES } from '../src/lib/manualPackOverrides.ts'

const 옛 = (q:string) => { const j=translateSearchQuery(q); if(!/[가-힣]/.test(j)) return j
  const e=translateSearchQueryToEnglish(q,'japanese'); return /[가-힣]/.test(e)? j : e }
const 새 = (q:string) => { const j=translateSearchQuery(q); if(!/[가-힣]/.test(j)) return j
  const e=translateSearchQueryToEnglish(q,'japanese'); if(!/[가-힣]/.test(e)) return e
  return 팩앞머리(q) ?? j }

// 실제로 사람들이 친 말부터 넣는다.
const 센것 = JSON.parse(readFileSync('data/search-counts.json','utf8')) as Record<string,Record<string,number>>
const 말:string[] = []
for (const 시각 of Object.values(센것)) 말.push(...Object.keys(시각))
const idx = JSON.parse(readFileSync('card-index.json','utf8'))
const nm = new Set<string>(); for (const r of idx.rows) if (/[가-힣]/.test(r[2])) nm.add(r[2])
말.push(...nm)
const 팩 = [...(packNames as any[]).filter(e=>e.ko).map(e=>e.ko),
            ...MANUAL_PACK_OVERRIDES.map(([,ko])=>ko),
            ...Object.keys(setNameKoJa as Record<string,string>),
            ...(setNamesKo as {ko:string}[]).map(s=>s.ko)]
for (const k of 팩) { 말.push(k); const t=k.replace(/\s+/g,''); for(let n=2;n<Math.min(t.length,7);n++) 말.push(t.slice(0,n)) }
const 목록 = [...new Set(말)].filter(Boolean)

let 같음=0, 깨짐=0, 살아남=0
const 깨진것:string[]=[], 살아난것:string[]=[]
for (const q of 목록) {
  const a=옛(q), b=새(q)
  if (a===b) { 같음++; continue }
  const a한글=/[가-힣]/.test(a), b한글=/[가-힣]/.test(b)
  if (!a한글 && b한글) { 깨짐++; 깨진것.push(`${q}: "${a}" → "${b}"`) }        // 되던 게 안 됨
  else if (!a한글 && !b한글) { 깨짐++; 깨진것.push(`${q}: "${a}" → "${b}" (딴 말로 바뀜)`) }
  else { 살아남++; if(살아난것.length<12) 살아난것.push(`${q.padEnd(13)} "${a}" → "${b}"`) }
}
console.log(`말뭉치 ${목록.length}가지`)
console.log(`  그대로            ${같음}`)
console.log(`  ✅ 새로 옮겨짐     ${살아남}`)
console.log(`  ❌ 되던 게 깨짐    ${깨짐}`)
if (깨진것.length) { console.log('\n깨진 것:'); console.log(깨진것.slice(0,40).join('\n')) }
console.log('\n살아난 보기:'); console.log(살아난것.join('\n'))
console.log('\n사장님이 짚으신 것:')
for (const q of ['스톰','스톰에메','스톰에메랄다','어비스','30주년','드래곤','명탐정','메가'])
  console.log(`  ${q.padEnd(8)} → ${새(q)}`)

if (깨짐 > 0) process.exit(1)
