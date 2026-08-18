// 대전쟁 도트 그림 151장을 **우리 쪽에 받아 둔다**(`public/dot/<도감번호>.png`).
//
// ⚠️⚠️ 왜 받아 두나: 화면에서 `raw.githubusercontent.com`을 바로 부르면 **429로 막힌다.**
//    한 판에 수십 장을 계속 부르는데 GitHub은 속도 제한이 빡빡하다(2026-08-17에 겪음).
//    그림 프록시로 우회해도 결국 프록시가 GitHub을 부르므로 같은 429다.
// ⚠️ 한 장이 1~2KB라 151장을 다 받아도 200KB 남짓이다.
// ⚠️ 받는 중에도 429가 나므로 **천천히**(0.26초 간격) 받고, 실패하면 다른 곳에서 받는다.
//
// 사용법: npx tsx scripts/fetch-dot-sprites.mts
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const 곳 = path.resolve('public/dot')
mkdirSync(곳, { recursive: true })

import 자료 from '../src/data/gameGen1.json' with { type: 'json' }

/**
 * 받을 곳 차례.
 * ⚠️ **pokemondb는 번호가 아니라 영어 이름**으로 찾는다(`.../normal/pikachu.png`).
 *    번호로 부르면 404다 — 처음에 그렇게 했다가 한 장도 못 받았다(2026-08-17).
 */
const 영문 = new Map<number, string>(
  (자료 as { 포켓몬: { id: number; ko: string }[] }).포켓몬.map((p) => [p.id, '']),
)
const 후보 = (id: number, en: string) => [
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`,
  ...(en ? [`https://img.pokemondb.net/sprites/black-white/normal/${en}.png`] : []),
]
const 잠깐 = (ms: number) => new Promise((s) => setTimeout(s, ms))

// PokéAPI에서 영어 이름을 먼저 받아 둔다(한 번에 151마리).
try {
  const r = await fetch('https://pokeapi.co/api/v2/pokemon?limit=151')
  const j = (await r.json()) as { results: { name: string }[] }
  j.results.forEach((x, i) => 영문.set(i + 1, x.name))
  console.log(`영어 이름 ${j.results.length}개 받음`)
} catch { console.log('⚠️ 영어 이름을 못 받았다 — GitHub만으로 시도한다') }

let 됨 = 0
const 안됨: number[] = []
for (let id = 1; id <= 151; id++) {
  const 파일 = path.join(곳, `${id}.png`)
  // 이미 받아 둔 것은 건너뛴다 — 다시 돌려도 안전하다.
  if (existsSync(파일) && statSync(파일).size > 200) { 됨++; continue }
  let 받음 = false
  for (const u of 후보(id, 영문.get(id) ?? '')) {
    try {
      const r = await fetch(u)
      if (!r.ok) continue
      const b = Buffer.from(await r.arrayBuffer())
      if (b.length < 200) continue      // 오류 페이지가 아닌지 크기로 거른다
      writeFileSync(파일, b)
      받음 = true
      break
    } catch { /* 다음 곳으로 */ }
    await 잠깐(150)
  }
  if (받음) 됨++
  else 안됨.push(id)
  await 잠깐(260)
  if (id % 40 === 0) console.log(`  ${id}번까지 · 받음 ${됨}`)
}
console.log(`받음 ${됨}/151` + (안됨.length ? ` · 못 받음 ${안됨.length}: ${안됨.join(',')}` : ''))
