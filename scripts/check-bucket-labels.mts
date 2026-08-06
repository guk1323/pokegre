// 트레이너·에너지 무더기에 **대표로 뜨는 이름**이 적절한지 본다.
//
// 왜: 한 무더기에는 표기가 조금씩 다른 이름이 섞인다("체육관 배지"와 "체육관배지",
// "뮤 ex"와 "뮤 Ex"). 그중 하나를 골라 목록에 띄우는데, 붙여 쓴 쪽이나 대문자 쪽이
// 대표가 되면 읽기 나쁘다. gen-pokedex는 "띄어쓰기가 많은 쪽"을 고르게 되어 있는데,
// 대소문자를 무시하고 묶기 시작한 뒤로(2026-08-06) 그 규칙이 지켜지는지 확인 안 했다.
//
// 쓰는 법: npx tsx scripts/check-bucket-labels.mts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const sets = new Map(
  (JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
    slug: string
    ed: 'ja' | 'en'
  }[]).map((s) => [s.slug, s]),
)
const 도감 = JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex/index.json'), 'utf-8')) as {
  id: number
  ko: string
  t: 'p' | 't'
}[]
const ko = (ed: 'ja' | 'en', n: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(n)) : koreanizeEnglishCardName(n)

const 띄어쓰기수 = (s: string) => (s.match(/[\s·]/g) ?? []).length
const 대문자수 = (s: string) => (s.match(/[A-Z]/g) ?? []).length

let 검사 = 0
const 붙여쓴대표: string[] = []
const 대문자대표: string[] = []
for (const row of 도감) {
  if (row.t !== 't') continue
  검사++
  const arr = JSON.parse(readFileSync(path.join(ROOT, `public/pokedex/${row.id}.json`), 'utf-8')) as {
    s: string
    name: string
  }[]
  const 이름들 = [...new Set(arr.map((c) => {
    const m = sets.get(c.s)
    return m ? ko(m.ed, c.name) : ''
  }).filter(Boolean))]
  if (이름들.length < 2) continue
  // 띄어쓰기가 더 많은 이름이 있는데 대표가 그게 아니면 읽기 나쁜 쪽을 고른 것이다.
  const 최다띄 = Math.max(...이름들.map(띄어쓰기수))
  if (띄어쓰기수(row.ko) < 최다띄)
    붙여쓴대표.push(`${row.ko}  ←  ${이름들.filter((n) => 띄어쓰기수(n) === 최다띄).join(' / ')}`)
  // 같은 글자인데 대문자가 더 많은 쪽이 대표면(“뮤 Ex”) 소문자 쪽이 낫다.
  const 같은글자 = 이름들.filter((n) => n.toLowerCase() === row.ko.toLowerCase())
  const 최소대 = Math.min(...같은글자.map(대문자수))
  if (같은글자.length > 1 && 대문자수(row.ko) > 최소대)
    대문자대표.push(`${row.ko}  ←  ${같은글자.filter((n) => 대문자수(n) === 최소대).join(' / ')}`)
}

const 줄 = (제목: string, 목록: string[]) => {
  console.log(`  ${목록.length ? '△' : '✓'} ${제목.padEnd(30)} ${목록.length}개`)
  for (const e of 목록.slice(0, 10)) console.log(`      ${e}`)
}
console.log(`\n  트레이너·에너지 무더기 ${검사.toLocaleString()}개 (이름이 두 가지 이상인 것만 본다)\n`)
줄('붙여 쓴 쪽이 대표', 붙여쓴대표)
줄('대문자 쪽이 대표', 대문자대표)
console.log('')
