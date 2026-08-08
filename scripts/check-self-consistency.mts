/**
 * **우리 자료끼리 어긋난 곳**을 찾는다. 저쪽(PPT)과 견주기 전에 우리 안이 먼저 맞아야 한다.
 *
 * 2026-08-08에 이 눈으로 하나를 찾았다 — 포켓몬 이름표는 ディアルガ → "디아루가"인데
 * 별칭표만 オリジンディアルガ → "오리진디아르가"였다(르 ↔ 루). 18장이 그렇게 나갔다.
 * 지금까지는 저쪽 자료와만 견줬는데, 우리 표끼리도 어긋날 수 있다.
 *
 * 보는 것:
 *   ① 포켓몬 이름표의 일본어를 우리 변환기에 넣으면 그 표의 한글이 나오는가
 *   ② 영문을 넣으면 그 표의 한글이 나오는가
 *   ③ 별칭표의 한글이 그 안에 든 포켓몬의 정식 한글과 어긋나지 않는가
 *   ④ 팩 이름표(packNames)의 한글이 세트 목록의 이름과 맞는가
 *
 * 실행: node --experimental-strip-types scripts/check-self-consistency.mts
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName, 자동사전없이 } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import pokemonNameAliases from '../src/data/pokemonNameAliases.json' with { type: 'json' }
import packNames from '../src/data/packNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const 벗김 = (s: string) => String(s).replace(/[\s·]/g, '')
const 이름표 = (pokemonNames as { ja?: string; ko?: string; en?: string }[]).filter((p) => p.ko)

// ① 일본어 → 한글
const 일본어탈 = 이름표.filter((p) => p.ja && 벗김(자동사전없이(() => koreanizeTitle(p.ja!))) !== 벗김(p.ko!))
// ② 영문 → 한글
const 영문탈 = 이름표.filter(
  (p) => p.en && 벗김(자동사전없이(() => koreanizeEnglishCardName(p.en!))) !== 벗김(p.ko!),
)
// ③ 별칭표 ↔ 이름표
const 긴순 = [...이름표].filter((p) => p.ja && p.ja.length >= 3).sort((a, b) => b.ja!.length - a.ja!.length)
const 별칭탈: string[] = []
for (const x of pokemonNameAliases as { ja?: string; ko?: string }[]) {
  if (!x.ja || !x.ko) continue
  // ⚠️ 안에 든 이름을 **긴 것부터** 찾는데, 그래도 더 긴 이름의 일부일 수 있다
  //    (カリザード의 リザード는 실은 リザードン의 일부다). 별칭의 일본어와 길이가
  //    비슷한 것만 본다 — 절반도 안 되면 다른 이름이 끼어든 것이다.
  const 든것 = 긴순.find((p) => x.ja!.includes(p.ja!) && p.ja!.length * 2 >= x.ja!.length)
  if (든것 && !벗김(x.ko).includes(벗김(든것.ko!)))
    별칭탈.push(`${x.ja} → "${x.ko}"   (안에 든 ${든것.ja}는 "${든것.ko}")`)
}
// ④ 팩 이름표 ↔ 세트 목록
const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { slug: string; name?: string }[]
const 팩탈: string[] = []
for (const p of packNames as { code?: string; ko?: string }[]) {
  if (!p.code || !p.ko) continue
  const s = idx.find((x) => x.slug.toLowerCase() === `ja-${p.code}`.toLowerCase())
  if (!s?.name) continue
  // ⚠️ 시리즈는 **양쪽에서** 떼야 한다. 목록 이름에도 붙어 있는 세트가 있어서, 한쪽만
  //    떼면 똑같은 이름이 어긋난 것처럼 보인다(ja-SV6a·ja-SV5M이 그랬다).
  const 시리즈떼기 = (x: string) => (x.includes(':') ? x.slice(x.lastIndexOf(':') + 1) : x)
  if (벗김(시리즈떼기(p.ko)) !== 벗김(시리즈떼기(s.name)))
    팩탈.push(`ja-${p.code} 목록 "${s.name}" ↔ 팩표 "${p.ko}"`)
}

const 찍기 = (이름: string, 것: string[], 전체: number) => {
  console.log(`\n■ ${이름} — ${전체}개 중 어긋남 ${것.length}개`)
  for (const x of 것.slice(0, 12)) console.log('   ' + x)
}
찍기('일본어 → 한글', 일본어탈.map((p) => `${p.ja} → "${자동사전없이(() => koreanizeTitle(p.ja!))}"   (표는 "${p.ko}")`), 이름표.length)
찍기('영문 → 한글', 영문탈.map((p) => `${p.en} → "${자동사전없이(() => koreanizeEnglishCardName(p.en!))}"   (표는 "${p.ko}")`), 이름표.length)
찍기('별칭표 ↔ 이름표', 별칭탈, (pokemonNameAliases as unknown[]).length)
찍기('팩 이름표 ↔ 세트 목록', 팩탈, (packNames as unknown[]).length)
