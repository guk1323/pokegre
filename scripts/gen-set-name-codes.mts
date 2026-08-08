/**
 * 세트 목록(public/sets/index.json)의 **한글 세트 이름 → 팩 코드** 표를 만든다.
 *
 * 왜 필요한가 — 화면에 보이는 세트 이름을 그대로 검색창에 쳤을 때 안 나오는 세트가
 * 있었다(2026-08-08 실측):
 *     "스톰에메랄다"(M6, 최신 팩)  → "Storm Emerald"로 나가 **0장**
 *     "창공의스트림"(S7R)         → "Evolving Skies"로 나가 **0장**
 * 팩 이름표(packNames.json)에 M6이 아예 없었고, S7R은 "창공스트림"으로 적혀 있어
 * 화면 이름과 한 글자 달랐다. 방문자는 화면에 있는 이름을 그대로 친다.
 *
 * 이 표는 **검색에만** 쓴다. 화면 표기는 건드리지 않는다 — 어느 표기가 공식인지는
 * 따로 정할 일이고, 그때까지도 검색은 되어야 한다.
 *
 * 다시 만들기: node --experimental-strip-types scripts/gen-set-name-codes.mts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
  slug: string
  name?: string
  ed?: string
}[]

const 표: Record<string, string> = {}
for (const s of idx) {
  if (s.ed !== 'ja' || !s.name) continue
  const 이름 = s.name.trim()
  // 한글이 없는 이름은 이미 영문이라 여기 담을 이유가 없다.
  if (!/[가-힣]/.test(이름)) continue
  const code = s.slug.replace(/^ja-/, '')
  // 시리즈가 앞에 붙은 이름은 뒤쪽도 함께 담는다("스칼렛&바이올렛 : 로켓단의 영광").
  for (const n of new Set([이름, 이름.includes(':') ? 이름.slice(이름.lastIndexOf(':') + 1).trim() : 이름])) {
    if (n.length >= 2 && !표[n]) 표[n] = code
  }
}

writeFileSync(join(ROOT, 'src/data/setNameKoCode.json'), JSON.stringify(표, null, 0) + '\n')
console.log(`세트 이름 ${Object.keys(표).length}가지를 src/data/setNameKoCode.json에 적었습니다.`)
