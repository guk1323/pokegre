// 게임(랜덤 디펜스) 재료 — **1세대 151마리**의 속성·종족값을 받아 파일로 굽는다.
//
// ⚠️ 왜 받아 두나: 우리 리포에는 포켓몬 **이름**밖에 없다(pokemonNames.json은 id·ko·ja·en뿐).
//    속성(불꽃/물/풀)도 공격력·방어력도 없다. 게임에는 그게 있어야 한다.
// ⚠️ **한 번 받아 파일로 굽는다.** 게임이 돌 때마다 남의 API를 부르지 않는다.
//    PokéAPI는 무료이고 열쇠가 필요 없다(2026-08-16 확인).
// ⚠️ 한글 이름은 **우리 이름표(pokemonNames.json)에서** 가져온다 — 저쪽 한글을 믿지 않는다.
//
// 사용법: npx tsx scripts/gen-gen1-dex.mts [--write]

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const WRITE = process.argv.includes('--write')
const 한글 = new Map((pokemonNames as { id: number; ko: string }[]).map((p) => [p.id, p.ko]))

interface 줄 {
  id: number
  ko: string
  en: string
  타입: string[]
  hp: number
  공: number
  방: number
  특공: number
  특방: number
  속: number
  총합: number
}

const 받기 = async (id: number): Promise<줄 | null> => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://pokeapi.co/api/v2/pokemon/' + id)
      if (!r.ok) { await new Promise((s) => setTimeout(s, 500)); continue }
      const j = (await r.json()) as {
        name: string
        types: { type: { name: string } }[]
        stats: { stat: { name: string }; base_stat: number }[]
      }
      const st = (n: string) => j.stats.find((s) => s.stat.name === n)?.base_stat ?? 0
      const 값 = { hp: st('hp'), 공: st('attack'), 방: st('defense'), 특공: st('special-attack'), 특방: st('special-defense'), 속: st('speed') }
      return { id, ko: 한글.get(id) ?? j.name, en: j.name, 타입: j.types.map((t) => t.type.name), ...값,
        총합: 값.hp + 값.공 + 값.방 + 값.특공 + 값.특방 + 값.속 }
    } catch { await new Promise((s) => setTimeout(s, 500)) }
  }
  return null
}

const 모두: 줄[] = []
// 남의 서버에 부담 주지 않게 조금씩 나눠 받는다.
for (let 시작 = 1; 시작 <= 151; 시작 += 8) {
  const 뭉치 = await Promise.all(
    Array.from({ length: Math.min(8, 152 - 시작) }, (_, k) => 받기(시작 + k)),
  )
  모두.push(...뭉치.filter((x): x is 줄 => !!x))
  await new Promise((s) => setTimeout(s, 200))
}

모두.sort((a, b) => a.id - b.id)
console.log('받은 것 ' + 모두.length + '/151마리 · 한글 이름 붙은 것 ' + 모두.filter((x) => /[가-힣]/.test(x.ko)).length)

const 타입수 = new Map<string, number>()
for (const x of 모두) for (const t of x.타입) 타입수.set(t, (타입수.get(t) ?? 0) + 1)
console.log('\n속성별 마릿수: ' + [...타입수].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · '))

const 총 = 모두.map((x) => x.총합).sort((a, b) => a - b)
const 몫 = (p: number) => 총[Math.floor((총.length - 1) * p)]
console.log('\n종족값 총합 — 최저 ' + 총[0] + ' · 25% ' + 몫(0.25) + ' · 중앙 ' + 몫(0.5) + ' · 75% ' + 몫(0.75) + ' · 최고 ' + 총[총.length - 1])
console.log('제일 약한 5: ' + [...모두].sort((a, b) => a.총합 - b.총합).slice(0, 5).map((x) => x.ko + '(' + x.총합 + ')').join(' · '))
console.log('제일 센 5  : ' + [...모두].sort((a, b) => b.총합 - a.총합).slice(0, 5).map((x) => x.ko + '(' + x.총합 + ')').join(' · '))

if (WRITE) {
  const 길 = path.resolve('src/data/dexGen1.json')
  await writeFile(길, JSON.stringify(모두))
  console.log('\n→ ' + 길)
} else console.log('\n(보기만 했습니다. 쓰려면 --write)')
