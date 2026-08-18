/**
 * **한 세트에 두 벌씩 든 옛 일본 카드를 합친다.**
 *
 * 도감을 PPT 덤프로 다시 만들 때, 옛 일본 세트에 **같은 카드가 두 벌** 들어갔다:
 *
 * | | 출처 | 번호 | 이름 | 저쪽 번호(tcg) |
 * |---|---|---|---|---|
 * | 일본어 카드 | TCGdex/pokellector | **있다**(001) | 일본어(フシギダネ) | 없다 |
 * | 영어 카드 | PPT 덤프 | **없다**(#575571) | 영어(Bulbasaur) | 있다 |
 *
 * 이름 표기가 달라 겹침 검사가 못 잡았다. 그 결과 ①세트를 열면 카드가 두 배로 보이고
 * ②이베이 매물을 도감과 이을 때 **번호가 없어 실패**한다 — 「1996 Japanese Basic #9
 * Blastoise」 431건이 갈 곳을 못 찾고 회색 타일로 남았다(사장님 지적 2026-08-11:
 * "거북왕 이베이 검색하면 이미지 없는게 너무 많은데").
 *
 * **짝짓는 근거는 그림 주소다.** 일본어 카드의 pokellector 주소에 영어 이름이 그대로
 * 박혀 있다 — `.../Bulbasaur.EXP.1.37251.thumb.png`. 이름표(pokemonNames.json)로도
 * 한 번 더 대 본다(트레이너·굿즈는 이름표에 없어 그림 주소 쪽이 훨씬 많이 맞는다).
 *
 * ⚠️⚠️ **1:1일 때만 합친다.** 한쪽에 후보가 둘 이상이면(「Giovanni's Nidoran」이
 *    ♂♀ 두 장) 어느 쪽인지 모른다 — 넘겨짚어 합치면 그게 섞임이다. 틀린 것보다 빈칸.
 *
 * ```
 * npx tsx scripts/merge-dup-jp-cards.mts          무엇이 합쳐지는지만 본다
 * npx tsx scripts/merge-dup-jp-cards.mts --write  실제로 고친다
 * ```
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const 쓰기 = process.argv.includes('--write')
const 뿌리 = path.resolve(import.meta.dirname, '..')
const 세트경로 = (p: string) => path.join(뿌리, 'public/sets', p)

type 카드 = { n?: string; name?: string; img?: string; r?: string; tcg?: string; en?: string; [k: string]: unknown }

const CJK = /[぀-ヿ㐀-鿿]/
/** 이름을 견주는 꼴 — 악센트·따옴표·괄호(레어도 표시)·띄어쓰기를 버리고 영숫자만 남긴다. */
const 이름꼴 = (s: string) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

/**
 * pokellector 그림 주소에 박힌 **영어 이름과 번호**: `.../Bulbasaur.EXP.1.37251.thumb.png`
 *
 * ⚠️ 이름만 읽고 끝내면 그림이 딴 카드 것일 때 알 수가 없다. 주소에 번호도 같이
 *    박혀 있으므로 **카드 번호와 맞는지 함께 본다** — 안 맞으면 그 그림을 안 믿는다.
 */
const 그림속영어이름 = (img: string, 번호: string): string => {
  const m = /\/([A-Za-z0-9'’.\- ]+?)\.[A-Za-z0-9]+\.(\d+)[a-z]?\.\d+\.thumb/.exec(String(img ?? ''))
  if (!m) return ''
  const n = Number(String(번호 ?? '').replace(/^0+/, ''))
  if (n && Number(m[2]) !== n) return ''
  return m[1].replace(/-/g, ' ')
}

const 이름표 = JSON.parse(readFileSync(path.join(뿌리, 'src/data/pokemonNames.json'), 'utf-8')) as {
  ja?: string
  en?: string
}[]
const 일영 = new Map<string, string>()
for (const p of 이름표) if (p.ja && p.en) 일영.set(String(p.ja).replace(/[\s・･]/g, ''), p.en)

const idx = JSON.parse(readFileSync(세트경로('index.json'), 'utf-8')) as {
  slug: string
  name?: string
  /** 세트 목록·세트 머리글에 「N종」으로 나가는 값. 카드를 지웠으면 **여기도 같이 고친다**. */
  count?: number
}[]

let 세트합침 = 0
let 합친장 = 0
let 남긴장 = 0
const 남긴예: string[] = []
const 세트별: { slug: string; 이름: string; 전: number; 후: number; 합침: number; 남김: number }[] = []

for (const s of idx) {
  const 파일 = 세트경로(`${s.slug}.json`)
  let j: { cards?: 카드[] }
  try {
    j = JSON.parse(readFileSync(파일, 'utf-8'))
  } catch {
    continue
  }
  const cards = j.cards ?? []
  const 영어것 = cards.filter((c) => /^#/.test(String(c.n ?? '')) && c.tcg)
  const 일본것 = cards.filter((c) => CJK.test(String(c.name ?? '')) && !/^#/.test(String(c.n ?? '')))
  if (!영어것.length || !일본것.length) continue

  // 일본어 카드 → 견줄 영어 이름(그림 주소 우선, 없으면 이름표)
  const 일별 = new Map<string, 카드[]>()
  for (const c of 일본것) {
    const en =
      그림속영어이름(String(c.img ?? ''), String(c.n ?? '')) || 일영.get(String(c.name ?? '').replace(/[\s・･]/g, '')) || ''
    if (!en) continue
    const k = 이름꼴(en)
    if (!k) continue
    ;(일별.get(k) ?? 일별.set(k, []).get(k)!).push(Object.assign(c, { __en: en }) as 카드 & { __en: string })
  }
  // 영어 카드도 같은 열쇠로 모은다 — **양쪽 다 하나뿐일 때만** 합친다.
  const 영별 = new Map<string, 카드[]>()
  for (const c of 영어것) {
    const k = 이름꼴(String(c.name ?? ''))
    if (!k) continue
    ;(영별.get(k) ?? 영별.set(k, []).get(k)!).push(c)
  }

  const 지울것 = new Set<카드>()
  let s합침 = 0
  for (const [k, 영들] of 영별) {
    const 일들 = 일별.get(k)
    if (!일들 || 일들.length !== 1 || 영들.length !== 1) continue
    const 일 = 일들[0] as 카드 & { __en?: string }
    const 영 = 영들[0]
    if (일.tcg) continue // 이미 저쪽 번호가 있으면 건드리지 않는다
    일.tcg = String(영.tcg)
    // 잇기는 영어 제목으로 찾는다 — 화면 이름(일본어)은 그대로 두고 영어 이름을 따로 적어 둔다.
    일.en = String(영.name ?? '')
    if (!일.img) 일.img = String(영.img ?? '')
    if (!일.r) 일.r = String(영.r ?? '')
    delete (일 as { __en?: string }).__en
    지울것.add(영)
    s합침++
  }
  for (const c of 일본것) delete (c as { __en?: string }).__en

  const s남김 = 영어것.length - s합침
  if (s남김)
    for (const c of 영어것)
      if (!지울것.has(c) && 남긴예.length < 20) 남긴예.push(`${s.slug} ${c.name}`)

  if (s합침) {
    세트합침++
    합친장 += s합침
    남긴장 += s남김
    const 새카드 = cards.filter((c) => !지울것.has(c))
    세트별.push({ slug: s.slug, 이름: String(s.name ?? ''), 전: cards.length, 후: 새카드.length, 합침: s합침, 남김: s남김 })
    if (쓰기) {
      j.cards = 새카드
      writeFileSync(파일, JSON.stringify(j))
    }
  }
}

// ⚠️ 세트 머리글의 「204종」은 index.json의 `count`에서 온다 — 안 고치면 수록 카드는
//    104장인데 머리글만 204종이라고 우긴다(2026-08-11에 실제로 그렇게 나왔다).
//    합친 세트만이 아니라 **전부** 실제 장수와 맞춰 둔다(다시 돌려도 안전하다).
let 셈고침 = 0
for (const s of idx) {
  let 장수 = 0
  try {
    장수 = (JSON.parse(readFileSync(세트경로(`${s.slug}.json`), 'utf-8')).cards ?? []).length
  } catch {
    continue
  }
  if (s.count !== 장수) {
    if (쓰기) s.count = 장수
    셈고침++
  }
}
if (셈고침) console.log(`\n세트 목록의 「N종」이 실제와 다른 곳 ${셈고침}개${쓰기 ? ' — 맞췄습니다.' : ''}`)
if (쓰기 && 셈고침) writeFileSync(세트경로('index.json'), JSON.stringify(idx))

console.log(`세트 ${세트합침}개 · **합친 카드 ${합친장}장** · 못 합치고 남긴 것 ${남긴장}장`)
console.log('')
for (const r of 세트별.sort((a, b) => b.합침 - a.합침))
  console.log(
    `  ${String(r.합침).padStart(4)}장 합침 · ${String(r.남김).padStart(3)}장 남김 · ${String(r.전).padStart(4)}→${String(r.후).padEnd(4)} ${r.slug.padEnd(30)} ${r.이름.slice(0, 34)}`,
  )
console.log('\n못 합치고 남긴 예:')
for (const l of 남긴예) console.log('  ', l)
console.log(쓰기 ? '\n→ 도감을 고쳤습니다.' : '\n→ 미리보기입니다. 실제로 고치려면 --write')
