/**
 * 카드가 **포켓몬인지 트레이너인지 에너지인지**를 TCGdex에서 받아 채운다. (크레딧 0)
 *
 * 왜 — 도감(포켓몬별 카드)은 이 갈래를 보고 트레이너·에너지를 뺀다. 모르면 **카드 이름만
 * 보고** 가르는데, 그러면 `Big Parasol`이 파라스 무더기에 들어간다(2026-08-09에 10장을
 * 잡았다). PPT 덤프에는 이 칸이 아예 없다.
 *
 * 갖고 있던 자료가 269개 세트분뿐이라 카드 65,596장 중 **52%가 갈래를 몰랐다.**
 *
 * ⚠️ TCGdex는 갈래로 걸러 주는 주소가 있다(`/cards?category=Trainer`). 낱장으로 6만 번
 *    부르지 않아도 된다.
 * ⚠️ TCGdex 카드 아이디는 `<세트아이디>-<번호>`이고, 우리 주소는 `ja-<세트아이디>` 꼴이라
 *    앞의 `ja-`·`en-`만 떼면 짝지어진다(도감이 원래 거기서 왔다).
 * ⚠️ **TCGdex가 모르는 세트는 그대로 둔다.** 지어내면 도감이 조용히 어긋난다.
 *
 * 실행: npx tsx scripts/fill-card-categories.mts [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')
const 잠깐 = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 갈래별로 카드 아이디를 통째로 받는다. 한 번에 다 안 주면 페이지를 넘긴다. */
async function 받기(lang: 'en' | 'ja', cat: 'Pokemon' | 'Trainer' | 'Energy'): Promise<string[]> {
  const out: string[] = []
  for (let page = 1; page <= 60; page++) {
    const u = `https://api.tcgdex.net/v2/${lang}/cards?category=${cat}&pagination:page=${page}&pagination:itemsPerPage=1000`
    let j: { id?: string }[] = []
    for (let 시도 = 0; 시도 < 3; 시도++) {
      try {
        const r = await fetch(u)
        if (!r.ok) throw new Error(String(r.status))
        j = (await r.json()) as { id?: string }[]
        break
      } catch {
        await 잠깐(800)
      }
    }
    if (!j.length) break
    for (const c of j) if (c.id) out.push(c.id)
    if (j.length < 1000) break
    await 잠깐(150)
  }
  return out
}

// ⚠️⚠️ **판을 갈라 담는다.** 같은 세트 아이디가 영문판·일본판에 **둘 다 있고 내용이 다르다** —
//    `neo4-106`은 영문판에선 Shining Celebi(포켓몬)인데 일본판에선 트레이너다. 한 표에
//    담았더니 일본판이 영문판을 덮어 527장이 어긋났다(2026-08-09에 그렇게 됐다).
const 갈래: Record<'en' | 'ja', Record<string, 'p' | 't' | 'e'>> = { en: {}, ja: {} }
for (const lang of ['en', 'ja'] as const) {
  for (const [cat, 코드] of [
    ['Pokemon', 'p'],
    ['Trainer', 't'],
    ['Energy', 'e'],
  ] as const) {
    const ids = await 받기(lang, cat)
    for (const id of ids) 갈래[lang][id] = 코드
    console.log(`   ${lang} ${cat.padEnd(8)} ${ids.length.toLocaleString()}장`)
  }
}
console.log(`\nTCGdex에서 받은 카드 영문판 ${Object.keys(갈래.en).length.toLocaleString()}장 · 일본판 ${Object.keys(갈래.ja).length.toLocaleString()}장`)

// ── 우리 카드와 짝짓기 ───────────────────────────────────────────────────────
const dir = join(ROOT, 'public/sets')
const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as any[]
const 표 = JSON.parse(readFileSync(join(ROOT, 'src/data/cardCategories.json'), 'utf8')) as Record<string, Record<string, string>>
const 번호꼴 = (n: string) => [...new Set([String(n), String(n).replace(/^0+/, ''), String(n).padStart(3, '0')])]
/**
 * ⚠️⚠️ **번호의 세 꼴을 다 같은 값으로 적는다.** 옛 자료가 `58`=포켓몬 / `058`=트레이너처럼
 *    같은 번호를 두 꼴로 적어 두고 값을 다르게 넣어 놨다. 한 꼴만 고치면 도감이 "갈린다 →
 *    모른다"로 보고 여전히 이름으로만 가른다(2026-08-09에 이것 때문에 「모름」이 오히려 늘었다).
 */
const 넣기 = (slug: string, n: string, v: 'p' | 't' | 'e') => {
  표[slug] ??= {}
  for (const k of 번호꼴(n)) 표[slug][k] = v
}
let 카드 = 0
let 새로앎 = 0
let 이미앎 = 0
let 어긋남 = 0
const 어긋난예: string[] = []
const 방향: Record<string, number> = {}
const 세트별: Record<string, string[]> = {}
for (const s of idx) {
  const 판: 'en' | 'ja' = s.ed === 'ja' ? 'ja' : 'en'
  const 세트 = String(s.slug).replace(/^(ja|en)-/, '')
  const cs = JSON.parse(readFileSync(join(dir, `${s.slug}.json`), 'utf8')).cards as any[]
  for (const c of cs) {
    카드++
    let 새: 'p' | 't' | 'e' | '' = ''
    for (const k of 번호꼴(String(c.n))) {
      const v = 갈래[판][`${세트}-${k}`]
      if (v) {
        새 = v
        break
      }
    }
    if (!새) continue
    const 옛 = 표[s.slug]?.[String(c.n)] ?? 표[s.slug]?.[String(c.n).padStart(3, '0')] ?? 표[s.slug]?.[String(c.n).replace(/^0+/, '')]
    if (옛) {
      이미앎++
      if (옛 !== 새) {
        어긋남++
        방향[`${옛}→${새}`] = (방향[`${옛}→${새}`] ?? 0) + 1
        ;(세트별[s.slug] ??= []).push(String(c.n))
        if (어긋난예.length < 8) 어긋난예.push(`      ${s.slug} ${c.n} ${String(c.name).slice(0, 26)}  우리 ${옛} ↔ TCGdex ${새}`)
        // ⚠️⚠️ **TCGdex 쪽을 믿는다.** 우리가 갖고 있던 표는 옛 자료라 **한 세트 자리에
        //    딴 세트 것이 겹쳐 들어와** 있다(en-sm3 58번 Scolipede가 트레이너로 적혀
        //    있었다. gen-pokedex.mts에도 같은 경고가 적혀 있다). TCGdex는 판을 갈라
        //    낱장으로 확인했고 맞았다.
        넣기(s.slug, String(c.n), 새)
      }
      continue
    }
    넣기(s.slug, String(c.n), 새)
    새로앎++
  }
}
console.log(`\n카드 ${카드.toLocaleString()}장`)
console.log(`   **새로 알게 된 것 ${새로앎.toLocaleString()}장** · 이미 알던 것 ${이미앎.toLocaleString()}장`)
console.log(`   ⚠️ 우리가 알던 것과 TCGdex가 어긋난 것 ${어긋남}장`)
for (const x of 어긋난예) console.log(x)
console.log('   방향별: ' + Object.entries(방향).map(([k, v]) => k + ' ' + v).join(' · '))
console.log('   어긋난 세트 ' + Object.keys(세트별).length + '개: ' + Object.entries(세트별).sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([k, v]) => k + ' ' + v.length).join(' · '))
if (WRITE) {
  writeFileSync(join(ROOT, 'src/data/cardCategories.json'), JSON.stringify(표) + '\n')
  console.log('\nsrc/data/cardCategories.json 을 갱신했습니다. 이어서 `npx tsx scripts/gen-pokedex.mts`')
} else console.log('\n(미리보기입니다. 실제로 넣으려면 --write)')
