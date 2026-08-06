// 도감 이름 검색이 제 이름을 맨 위로 올리는지 전수로 본다.
//
// 왜: 운영자가 요구한 것이 "개굴닌자를 치면 개굴닌자 카드가 나오는" 화면이다. 이름이
// 다른 이름 안에 들어 있으면(피카츄 ⊂ 캡틴피카츄) 내가 뒤로 밀릴 수 있고, 그러면
// 찾는 사람은 목록을 훑어야 한다. 3,631개를 하나씩 눌러 볼 수는 없으므로 계산으로 센다.
//
// ⚠️ 화면(PokedexView)의 규칙을 그대로 옮긴다. 다르게 적으면 검사가 화면을 안 지킨다:
//    띄어쓰기·가운뎃점을 지우고 포함 검사 → 정확히 같은 것 · 그 말로 시작하는 것 ·
//    장수 많은 것 순.
//
// 쓰는 법: npx tsx scripts/check-pokedex-search.mts
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
type Row = { id: number; ko: string; en: string; c: number; t: 'p' | 't' }
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex/index.json'), 'utf-8')) as Row[]

const 붙임 = (s: string) => s.toLowerCase().replace(/[\s·]/g, '')
const 찾기 = (q: string) => {
  const s = 붙임(q)
  if (!s) return index
  const hit = index.filter((p) => 붙임(p.ko).includes(s) || 붙임(p.en).includes(s))
  return hit.sort((a, b) => {
    const 점수 = (p: Row) => (붙임(p.ko) === s ? 0 : 붙임(p.ko).startsWith(s) ? 1 : 2)
    return 점수(a) - 점수(b) || b.c - a.c
  })
}

let 일등 = 0
const 밀린것: { 이름: string; 등수: number; 앞: string }[] = []
const 못찾음: string[] = []
for (const row of index) {
  const 결과 = 찾기(row.ko)
  const at = 결과.findIndex((p) => p.id === row.id)
  if (at < 0) {
    못찾음.push(row.ko)
    continue
  }
  if (at === 0) 일등++
  else 밀린것.push({ 이름: row.ko, 등수: at + 1, 앞: 결과[0].ko })
}

console.log(`\n  도감 이름 ${index.length.toLocaleString()}개\n`)
console.log(`  ${못찾음.length ? '✗' : '✓'} 제 이름으로 쳤는데 안 나옴   ${못찾음.length}개`)
for (const e of 못찾음.slice(0, 6)) console.log(`      ${e}`)
console.log(`  ${밀린것.length ? '△' : '✓'} 1등이 아님                  ${밀린것.length}개 (1등 ${일등.toLocaleString()}개)`)
for (const e of 밀린것.sort((a, b) => b.등수 - a.등수).slice(0, 12))
  console.log(`      ${e.이름.padEnd(18)} ${e.등수}등 · 1등은 "${e.앞}"`)

// 띄어쓰기를 빼고 쳐도 찾아지는지(운영자가 "체육관배지"처럼 붙여 칠 수 있다)
let 띄어쓰기OK = 0
let 띄어쓰기총 = 0
for (const row of index) {
  if (!/[\s·]/.test(row.ko)) continue
  띄어쓰기총++
  if (찾기(row.ko.replace(/[\s·]/g, '')).some((p) => p.id === row.id)) 띄어쓰기OK++
}
console.log(
  `  ${띄어쓰기OK === 띄어쓰기총 ? '✓' : '✗'} 붙여 쳐도 찾아짐             ` +
    `${띄어쓰기OK}/${띄어쓰기총} (띄어쓰기 있는 이름)`,
)
console.log('')
