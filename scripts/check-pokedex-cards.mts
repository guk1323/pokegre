/**
 * 도감 화면(포켓몬별 카드 목록)에 **딴 포켓몬 카드가 섞였는지** 본다.
 *
 * 도감은 이름으로 묶는다. 한 장이라도 딴 카드가 끼면 그 포켓몬 페이지에 엉뚱한 카드가
 * 뜨는데, 화면만 봐서는 못 찾는다 — 그 카드가 원래 거기 있어야 하는지 아무도 모른다.
 *
 * 재는 법: 카드 이름 안에 그 포켓몬의 한글 이름이 들어 있는가.
 * ⚠️ 트레이너·굿즈 무더기(t)는 포켓몬 이름으로 묶는 게 아니라 제외한다.
 *
 * 실행: node --experimental-strip-types scripts/check-pokedex-cards.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import { koName } from '../src/lib/koCardName.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(ROOT, 'public/pokedex')
if (!existsSync(dir)) { console.log('도감 자료가 없다'); process.exit(0) }
const 이름 = new Map((pokemonNames as { id: number; ko: string }[]).map((p) => [p.id, p.ko]))
const 벗김 = (s: string) => String(s).replace(/[\s·]/g, '')

let 봄 = 0
let 카드 = 0
const 나쁨: string[] = []
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const id = Number(f.replace('.json', ''))
  const ko = 이름.get(id)
  if (!ko) continue // 트레이너 무더기 등은 id가 포켓몬이 아니다
  // ⚠️ 도감 파일은 **원문 이름**을 담는다(「フシギダネ」·"Bulbasaur"). 화면이 쓰는
  //    함수로 한글로 옮긴 뒤에 견줘야 한다 — 처음에 그냥 견줬더니 0장이 나왔다.
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as
    | { cards?: { n?: string; name?: string; s?: string }[] }
    | { n?: string; name?: string; s?: string }[]
  const cs = Array.isArray(j) ? j : (j.cards ?? [])
  if (!cs.length) continue
  봄++
  for (const c of cs) {
    카드++
    const 원 = String(c.name ?? '')
    if (!원) continue
    const ed: 'ja' | 'en' = String(c.s ?? '').startsWith('ja-') ? 'ja' : 'en'
    const nm = koName(ed, 원)
    if (!/[가-힣]/.test(nm)) continue // 한글로 못 옮긴 이름은 다른 검사가 본다
    if (!벗김(nm).includes(벗김(ko)))
      나쁨.push(`  ${String(id).padStart(4)} ${ko.padEnd(10)} ← "${원}" → "${nm}" (${c.s} ${c.n})`)
  }
}
console.log(`포켓몬 ${봄.toLocaleString()}마리 · 카드 ${카드.toLocaleString()}장 · 이름이 안 맞는 것 ${나쁨.length}장\n`)
for (const x of 나쁨.slice(0, 25)) console.log(x)
