// 게임(포켓몬 디펜스 · 시즌1 = 1세대 151마리) 재료를 한 파일로 굽는다.
//
// 담는 것: 속성 · 종족값 · **진화 다음 단계** · **속성 상성표**
// ⚠️ 상성표를 **손으로 적지 않는다.** 17종 × 17종을 사람이 옮겨 적으면 반드시 틀린다.
//    PokéAPI의 `/type/<이름>`이 damage_relations를 준다 — 그걸 그대로 굽는다.
// ⚠️ 한글 이름은 **우리 이름표(pokemonNames.json)**에서 가져온다. 저쪽 한글은 안 믿는다.
// ⚠️ 그림은 주소를 저장하지 않는다 — 도감번호로 정해져 있다(sprites/pokemon/<id>.png).
//
// 사용법: npx tsx scripts/gen-gen1-game.mts [--write]

import { writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const WRITE = process.argv.includes('--write')
const 한글 = new Map((pokemonNames as { id: number; ko: string }[]).map((p) => [p.id, p.ko]))
const 잠깐 = (ms: number) => new Promise((s) => setTimeout(s, ms))

async function 받기<T>(url: string): Promise<T | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return (await r.json()) as T
    } catch { /* 다시 */ }
    await 잠깐(400)
  }
  return null
}

// ── ① 1세대 151마리: 속성·종족값 (앞서 구운 것을 다시 쓴다) ────────────────────
type 마리 = { id: number; ko: string; en: string; 타입: string[]; hp: number; 공: number; 방: number; 특공: number; 특방: number; 속: number; 총합: number }
const 목록 = JSON.parse(await readFile(path.resolve('src/data/dexGen1.json'), 'utf-8')) as 마리[]
console.log('1세대 ' + 목록.length + '마리를 이어받았습니다.')

// ── ② 진화: 「이 포켓몬 → 다음 단계」 ────────────────────────────────────────
// ⚠️ 진화 계보는 **종(species)** 쪽에 있다. 포켓몬 하나씩 물어보면 151번이라,
//    계보 주소를 모아 **겹치는 것을 한 번만** 받는다(1세대는 계보 78개뿐).
const 계보주소 = new Set<string>()
for (const p of 목록) {
  const sp = await 받기<{ evolution_chain?: { url: string } }>('https://pokeapi.co/api/v2/pokemon-species/' + p.id)
  if (sp?.evolution_chain?.url) 계보주소.add(sp.evolution_chain.url)
  await 잠깐(40)
}
console.log('진화 계보 ' + 계보주소.size + '갈래')

interface 사슬 { species: { name: string; url: string }; evolves_to: 사슬[] }
const 다음: Record<number, number> = {} // 도감번호 → 다음 진화 도감번호
const 번호뽑기 = (url: string) => Number(url.replace(/\/$/, '').split('/').pop())
const 훑기 = (n: 사슬) => {
  for (const 자식 of n.evolves_to ?? []) {
    const a = 번호뽑기(n.species.url)
    const b = 번호뽑기(자식.species.url)
    // ⚠️ 1세대(1~151) 안에서만 잇는다. 이브이는 2세대 진화형이 있는데 시즌1엔 없다.
    if (a <= 151 && b <= 151 && 다음[a] == null) 다음[a] = b
    훑기(자식)
  }
}
for (const u of 계보주소) {
  const c = await 받기<{ chain: 사슬 }>(u)
  if (c?.chain) 훑기(c.chain)
  await 잠깐(40)
}
console.log('진화가 있는 포켓몬 ' + Object.keys(다음).length + '마리')
// ⚠️ 갈래 진화(이브이 → 샤미드·쥬피썬더·부스터)는 **먼저 나온 하나만** 잡힌다.
//    시즌1은 단순하게 간다 — 고르게 하려면 게임 규칙이 확 커진다.
const 갈래 = 목록.filter((p) => 다음[p.id] != null && p.id === 133)
if (갈래.length) console.log('⚠️ 이브이는 갈래 진화 — 시즌1은 ' + 한글.get(다음[133]) + ' 하나로 간다')

// ── ③ 속성 상성표 ──────────────────────────────────────────────────────────
const 쓰는타입 = [...new Set(목록.flatMap((p) => p.타입))].sort()
const 상성: Record<string, Record<string, number>> = {}
for (const t of 쓰는타입) {
  const j = await 받기<{ damage_relations: Record<string, { name: string }[]> }>('https://pokeapi.co/api/v2/type/' + t)
  if (!j) continue
  const m: Record<string, number> = {}
  for (const x of j.damage_relations.double_damage_to ?? []) m[x.name] = 2
  for (const x of j.damage_relations.half_damage_to ?? []) m[x.name] = 0.5
  for (const x of j.damage_relations.no_damage_to ?? []) m[x.name] = 0
  상성[t] = m
  await 잠깐(40)
}
console.log('상성표 ' + Object.keys(상성).length + '종')

// ── 굽기 ───────────────────────────────────────────────────────────────────
// 코스트는 종족값 총합으로 나눈다(2026-08-16 실측: 40/36/38/31/6마리로 고르게 갈린다).
const 코스트 = (총: number) => (총 <= 320 ? 1 : 총 <= 405 ? 2 : 총 <= 490 ? 3 : 총 <= 579 ? 4 : 5)
const 결과 = {
  만든날: '2026-08-16',
  포켓몬: 목록.map((p) => ({
    id: p.id, ko: 한글.get(p.id) ?? p.ko, 타입: p.타입,
    // ⚠️⚠️ **물리와 특수를 뭉개지 마라.** 처음엔 `Math.max(공, 특공)`으로 합쳤는데,
    //    그러면 **「몸으로 때리나 멀리서 때리나」가 통째로 사라진다**(2026-08-17에 되살림).
    //    후딘은 물리 50·특수 135라 원거리인데, 뭉개면 그냥 「공격 135」가 되어
    //    역할을 지어낸 잣대(공 ≥ 방+20 같은 것)로 다시 나눠야 했다.
    //    원작이 이미 나눠 놓은 것을 쓰는 편이 맞다.
    hp: p.hp, 공: p.공, 특공: p.특공, 방: p.방, 특방: p.특방, 속: p.속,
    총합: p.총합, 코스트: 코스트(p.총합), 진화: 다음[p.id] ?? null,
  })),
  상성,
}
console.log('\n코스트별: ' + [1, 2, 3, 4, 5].map((c) => c + '코 ' + 결과.포켓몬.filter((p) => p.코스트 === c).length).join(' · '))

if (WRITE) {
  const 길 = path.resolve('src/data/gameGen1.json')
  await writeFile(길, JSON.stringify(결과))
  console.log('→ ' + 길)
} else console.log('(보기만 했습니다. 쓰려면 --write)')
