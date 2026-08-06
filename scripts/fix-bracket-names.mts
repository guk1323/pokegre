// 이름에 영문명이 덧붙은 카드를 다듬는다. 두 갈래로 갈린다.
//  ① 앞부분이 멀쩡한 일본명 — `ナッシー[Exeggutor]` → 대괄호만 뗀다.
//  ② 앞부분이 오염된 이름 — `壁を台無しにする[aerodactyl]`("벽을 망치는") → **영문명이
//     유일한 단서**다. 그걸 지우면 더 나빠지므로, 영문명으로 정식 일본명을 찾아 바꾼다.
// ⚠️ "안농 [G]"처럼 대괄호 안이 한 글자인 것은 카드를 가려내는 표기다 — 건드리지 않는다.
// ⚠️ **판에 맞는 이름을 넣어야 한다.** 북미판 세트에 일본명을 넣으면 화면에 "ナッシー"가
//    그대로 뜬다(첫 시도에서 실제로 그랬다 — 2026-08-07 회귀 검사에서 잡았다).
//    북미판은 영문명, 일본판은 일본명을 쓴다.
import { readFileSync, writeFileSync } from 'node:fs'
import { koName } from '/Users/sonhunguk/Documents/GitHub/pokemon-card-price-tracker/src/lib/cardCatalog.ts'
const ROOT = '/Users/sonhunguk/Documents/GitHub/pokemon-card-price-tracker'
const WRITE = process.argv.includes('--write')
const idx = JSON.parse(readFileSync(`${ROOT}/public/sets/index.json`, 'utf-8')) as any[]
const pn = JSON.parse(readFileSync(`${ROOT}/src/data/pokemonNames.json`, 'utf-8')) as { ko: string; ja: string; en: string }[]
const 영문으로 = new Map(pn.map((p) => [p.en.toLowerCase(), p]))
let 고침 = 0
for (const s of idx) {
  const p = `${ROOT}/public/sets/${s.slug}.json`
  let d: any
  try { d = JSON.parse(readFileSync(p, 'utf-8')) } catch { continue }
  let 바뀜 = false
  for (const c of d.cards ?? []) {
    const m = String(c.name).match(/^(.+?)\s*\[([A-Za-z][A-Za-z'’.\- ]{2,})\]\s*$/)
    if (!m) continue
    if (!/[ぁ-んァ-ヶ一-龥]/.test(m[1])) continue
    const 앞 = m[1].trim()
    const 영문 = m[2].trim()
    const 정보 = 영문으로.get(영문.toLowerCase())
    const 앞한글 = koName(s.ed, 앞)
    // 앞부분이 그 포켓몬을 옳게 가리키면 대괄호만 뗀다. 아니면 정식 일본명으로 바꾼다.
    const 정식 = s.ed === 'en' ? 정보?.en : 정보?.ja
    const 새이름 = 정보 && 정식 && !앞한글.includes(정보.ko) ? 정식 : s.ed === 'en' ? 영문 : 앞
    console.log(
      `  ${s.id} ${String(c.n).padEnd(4)} [${s.ed}] "${c.name}" → "${새이름}"   화면: "${koName(s.ed, c.name)}" → "${koName(s.ed, 새이름)}"`,
    )
    c.name = 새이름
    바뀜 = true
    고침++
  }
  if (WRITE && 바뀜) writeFileSync(p, JSON.stringify(d))
}
console.log(`\n  ${고침}장${WRITE ? ' 고쳐 저장했다' : ' (미리보기 — --write 로 저장)'}\n`)
