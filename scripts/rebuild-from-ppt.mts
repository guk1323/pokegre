/**
 * **도감을 PPT 덤프로 새로 만든다.** (크레딧 0)
 *
 * 왜 — 예전엔 도감이 TCGdex에서 오고 시세는 PPT에서 와서, 둘을 **짝지어야** 했다
 * (`src/data/cardIdMap.json`). 그 짝짓기가 틀리면 딴 카드 시세가 섞인다. 도감을 PPT로
 * 만들면 카드가 **자기 PPT 번호를 처음부터 달고 있어서** 짝지을 일이 없어진다.
 *
 * ⚠️ 안 건드리는 것
 *   · 카드 뽑기용 포켓 세트 — PPT에 아예 없다
 *   · PPT에 없는 우리 세트 — 지우지 않는다(자료가 사라지면 안 된다)
 *   · 트레이너 킷처럼 **우리 세트 둘이 PPT 한 세트를 나눠 쓰는 곳** — 지금 나눠 둔 것이
 *     더 정확하다(덱별로 갈라 뒀다). PPT로 합치면 오히려 뭉갠다.
 *   · 일러스트레이터(`public/artists/*`) — 카드 정보를 스스로 들고 있어 안 깨진다
 *
 * ⚠️ 이어받는 것 — 공식 한글 카드명(`koName`)·한글판 그림/번호(`koImg`/`koNo`)는 PPT가
 *    주지 않는다. 세트+번호가 같은 카드에서 옮겨 붙인다.
 *
 * 실행: npx tsx scripts/rebuild-from-ppt.mts <덤프.csv> [--write]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 번호열쇠 } from '../src/lib/cardNo.ts'
import { 덤프읽기 } from './card-id-map/lib.mts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [CSV] = process.argv.slice(2)
const WRITE = process.argv.includes('--write')
if (!CSV || !existsSync(CSV)) {
  console.log('덤프 csv 경로를 주세요')
  process.exit(1)
}
const dir = join(ROOT, 'public/sets')

// ── 재료 ─────────────────────────────────────────────────────────────────────
type 줄 = {
  id: string
  name: string
  setName: string
  setId: string
  num: string
  rarity: string
  lang: string
  printing: string
  파는곳: number
}
/** 덤프읽기는 카드마다 한 줄만 준다 — 여기서는 **인쇄판까지** 봐야 해서 직접 읽는다. */
function 줄가르기(s: string): string[] {
  const o: string[] = []
  let c = ''
  let q = false
  for (const ch of s) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) {
      o.push(c)
      c = ''
    } else c += ch
  }
  o.push(c)
  return o
}
const L = readFileSync(CSV, 'utf8').split('\n')
const H = 줄가르기(L[0])
const c = (n: string) => H.indexOf(n)
const [ID, NM, SET, SETID, NUM, RARE, LANG, PRT, SELL] = [
  'tcgPlayerId',
  'name',
  'setName',
  'setId',
  'cardNumber',
  'rarity',
  'language',
  'printing',
  'sellers',
].map(c)
const 모든줄: 줄[] = []
for (let i = 1; i < L.length; i++) {
  if (!L[i]) continue
  const f = 줄가르기(L[i])
  if (!f[ID]) continue
  모든줄.push({
    id: f[ID],
    name: f[NM] ?? '',
    setName: f[SET] ?? '',
    setId: f[SETID] ?? '',
    num: f[NUM] ?? '',
    rarity: f[RARE] ?? '',
    lang: (f[LANG] ?? '').toLowerCase(),
    printing: f[PRT] ?? '',
    파는곳: Number(f[SELL]) || 0,
  })
}

const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Record<string, unknown>[]
const 세트표 = JSON.parse(readFileSync(join(ROOT, 'src/data/pptSets.json'), 'utf8')) as {
  slug: string
  setId: number
  번호앞?: string
  덱겹침?: boolean
  메모?: string
}[]

/** PPT 세트 하나를 우리 세트 **여럿이** 나눠 쓰는 곳(트레이너 킷) — 건드리지 않는다. */
const setId쓰는곳 = new Map<string, string[]>()
for (const e of 세트표) (setId쓰는곳.get(String(e.setId)) ?? setId쓰는곳.set(String(e.setId), []).get(String(e.setId))!).push(e.slug)
const 나눠쓰는setId = new Set([...setId쓰는곳].filter(([, v]) => v.length > 1).map(([k]) => k))
/** 번호 앞자리로 칸을 갈라 쓰는 세트(en-g1의 RC칸 등)도 건드리지 않는다. */
for (const e of 세트표) if (e.번호앞) 나눠쓰는setId.add(String(e.setId))
const setId별slug = new Map<string, string>()
for (const e of 세트표) if (!나눠쓰는setId.has(String(e.setId))) setId별slug.set(String(e.setId), e.slug)

/** 지금 도감에서 이어받을 것 — 공식 한글명·한글판 그림/번호. */
const 이어받을 = new Map<string, Record<string, unknown>>()
const 옛세트 = new Map<string, Record<string, unknown>>()
/** 세트별 **옛 카드 전체** — PPT에 없는 카드를 잃지 않으려고 들고 있는다. */
const 옛카드 = new Map<string, Record<string, unknown>[]>()
let 옛한글칸 = 0
for (const s of idx) {
  const slug = String(s.slug)
  옛세트.set(slug, s)
  const f = join(dir, `${slug}.json`)
  if (!existsSync(f)) continue
  const cs = (JSON.parse(readFileSync(f, 'utf8')).cards ?? []) as Record<string, unknown>[]
  옛카드.set(slug, cs)
  for (const c of cs) {
    const 값: Record<string, unknown> = {}
    for (const k of ['koName', 'koImg', 'koNo']) if (c[k]) 값[k] = c[k]
    if (Object.keys(값).length) {
      옛한글칸++
      이어받을.set(`${slug}|${번호열쇠(c.n)}`, 값)
    }
  }
}

// ── 이름·번호 다듬기 ─────────────────────────────────────────────────────────
/**
 * PPT가 이름 끝에 붙이는 **번호 꼬리**를 뗀다.
 * ⚠️ 이름 속 붙임표(Ho-Oh·Porygon-Z)는 건드리면 안 된다.
 */
const 이름다듬기 = (s: string) =>
  s
    .replace(/\s+-\s+[A-Za-z0-9]{1,6}\d*\s*\/\s*\S+\s*$/, '')
    .replace(/\s+-\s+[A-Z]{1,4}\d{1,4}\s*$/, '')
    .replace(/\s+\d{1,4}\s*\/\s*\S+\s*$/, '')
    .trim()
/** 한 번호에 딴 카드가 여럿일 때 갈라 줄 **구분표**. PPT가 이름에 적어 둔 것을 쓴다. */
function 구분표(name: string): string {
  const 조각: string[] = []
  const 속 = /\(#\s*(\d+)/.exec(name)
  if (속) 조각.push('#' + 속[1])
  const 스 = /\(([^)]*?)\s*Stamped\)/.exec(name)
  if (스?.[1]) 조각.push(스[1].replace(/#\s*\d+\s*/, '').replace(/\s+/g, ''))
  if (!조각.length) {
    const 덱 = /-\s*([A-Za-z][A-Za-z ]*?)\s*(\d+)\s*$/.exec(name)
    if (덱) 조각.push(덱[1].replace(/\s+/g, '') + 덱[2])
    else {
      const 괄 = /\(([^)]+)\)\s*$/.exec(name)
      if (괄) 조각.push(괄[1].replace(/\s+/g, ''))
    }
  }
  return 조각.join('')
}
/** 주소(slug)는 **한 번 정하면 안 바꾼다** — 즐겨찾기·검색 주소가 그걸 쓴다. */
const 있는slug = new Set(idx.map((s) => String(s.slug)))
function 새주소(name: string, lang: string) {
  const 앞 = lang === 'japanese' ? 'ja' : 'en'
  const base = `${앞}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 34)}`
  let s = base
  for (let i = 2; 있는slug.has(s); i++) s = `${base}-${i}`
  있는slug.add(s)
  return s
}

// ── 세트별로 새로 만든다 ─────────────────────────────────────────────────────
const setId별 = new Map<string, 줄[]>()
for (const r of 모든줄) (setId별.get(r.setId) ?? setId별.set(r.setId, []).get(r.setId)!).push(r)

const 새index: Record<string, unknown>[] = []
const 쓴slug = new Set<string>()
let 만든세트 = 0
let 만든카드 = 0
let 번호없는카드 = 0
let 이어받은 = 0
let 남긴옛카드 = 0
const 새로생긴: string[] = []

for (const [setId, 줄들] of setId별) {
  if (나눠쓰는setId.has(setId)) continue // 트레이너 킷 등 — 지금 나눠 둔 것이 더 정확하다
  const slug = setId별slug.get(setId) ?? 새주소(줄들[0].setName, 줄들[0].lang)
  if (!setId별slug.has(setId)) 새로생긴.push(`${slug} ← ${줄들[0].setName}`)
  const ed = 줄들[0].lang === 'japanese' ? 'ja' : 'en'

  // 카드 한 장 = tcgPlayerId 하나. 인쇄판은 여러 줄로 온다.
  const 카드별 = new Map<string, { r: 줄; 인쇄: Set<string> }>()
  for (const r of 줄들) {
    const v = 카드별.get(r.id) ?? { r, 인쇄: new Set<string>() }
    if (r.printing) v.인쇄.add(r.printing)
    if (r.파는곳 > v.r.파는곳) v.r = r
    카드별.set(r.id, v)
  }
  // 한 번호에 딴 카드가 오는지 먼저 센다 — 겹칠 때만 구분표를 붙인다.
  const 뭉갠번호 = new Set<string>()
  {
    const 임시 = new Map<string, Set<string>>()
    for (const [id, v] of 카드별) {
      const n = 번호열쇠(String(v.r.num).split('/')[0])
      if (!n) continue
      ;(임시.get(n) ?? 임시.set(n, new Set()).get(n)!).add(id)
    }
    for (const [n, s] of 임시) if (s.size > 1) 뭉갠번호.add(n)
  }
  const cards: Record<string, unknown>[] = []
  const 쓴번호 = new Set<string>()
  for (const [id, v] of 카드별) {
    const 앞 = 번호열쇠(String(v.r.num).split('/')[0])
    let n = 앞
    if (!앞) {
      // ⚠️ PPT가 번호를 안 주는 세트가 있다. **지어내지 않는다** — PPT 번호를 그대로 쓴다.
      //    지어낸 번호는 다음에 자료를 다시 받을 때 어긋난다.
      n = `#${id}`
      번호없는카드++
    } else if (뭉갠번호.has(앞)) {
      const 표 = 구분표(v.r.name)
      const 뒤 = String(v.r.num).includes('/') ? String(v.r.num).split('/')[1].trim() : ''
      n = 표 ? `${앞}~${표}${뒤 ? '.' + 뒤 : ''}` : `${앞}~${id}`
    }
    while (쓴번호.has(n)) n = `${n}.${id}`
    쓴번호.add(n)
    const card: Record<string, unknown> = {
      n,
      name: 이름다듬기(v.r.name),
      img: `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_400x400.jpg`,
      r: v.r.rarity,
      tcg: id,
    }
    const 인쇄 = [...v.인쇄].filter(Boolean).sort()
    if (인쇄.length && !(인쇄.length === 1 && 인쇄[0] === 'Normal')) card.p = 인쇄
    const 옛 = 이어받을.get(`${slug}|${번호열쇠(n)}`)
    if (옛) {
      Object.assign(card, 옛)
      이어받은++
    }
    cards.push(card)
  }
  // ⚠️⚠️ **PPT에 없는 옛 카드를 버리면 안 된다.** 우리 도감에만 있던 카드(TCGdex에서 온 것)가
  //    조용히 사라진다. PPT 번호 없이 그대로 남긴다 — 시세만 안 붙을 뿐 카드는 남는다.
  const 새번호 = new Set(cards.map((c) => 번호열쇠(c.n as string)))
  for (const 옛c of 옛카드.get(slug) ?? []) {
    if (새번호.has(번호열쇠(옛c.n))) continue
    const { tcg: _버림, ...나머지 } = 옛c
    cards.push(나머지)
    남긴옛카드++
  }
  cards.sort((a, b) => (Number(a.n) || 1e9) - (Number(b.n) || 1e9) || String(a.n).localeCompare(String(b.n)))
  const 옛s = 옛세트.get(slug)
  새index.push({
    slug,
    ed,
    id: String(옛s?.id ?? `ppt-${setId}`),
    name: 줄들[0].setName,
    count: cards.length,
    releaseDate: String(옛s?.releaseDate ?? ''),
    serie: String(옛s?.serie ?? (ed === 'ja' ? '기타' : 'Miscellaneous')),
    logo: String(옛s?.logo ?? ''),
    cover: String(옛s?.cover ?? ''),
    // ⚠️⚠️ **실물 팩 사진과 인쇄 분모를 반드시 물려받는다.** 2026-08-09 갈아엎기 때 이 두
    //    칸을 빠뜨려 오늘의 상점 표지 126장이 로고로 주저앉았고(사장님 지적 2026-08-10
    //    "실물 팩처럼 나오게 할것") 조각 잇기의 분모도 날아갈 뻔했다.
    //    boxImg는 patch-set-boxes.mjs가, denom은 fill-set-denoms.mts가 채운 값이다.
    ...(옛s?.boxImg ? { boxImg: String(옛s.boxImg) } : {}),
    ...(옛s?.denom ? { denom: Number(옛s.denom) } : {}),
  })
  쓴slug.add(slug)
  만든세트++
  만든카드 += cards.length
  if (WRITE) writeFileSync(join(dir, `${slug}.json`), JSON.stringify({ ed, id: String(옛s?.id ?? `ppt-${setId}`), name: 줄들[0].setName, cards }) + '\n')
}

// ── PPT에 없는 우리 세트는 그대로 둔다 ───────────────────────────────────────
let 그대로세트 = 0
let 그대로카드 = 0
for (const s of idx) {
  const slug = String(s.slug)
  if (쓴slug.has(slug)) continue
  새index.push(s)
  그대로세트++
  그대로카드 += Number(s.count ?? 0)
}

console.log(`\nPPT로 새로 만든 세트 **${만든세트}개 · 카드 ${만든카드.toLocaleString()}장** (전부 PPT 번호를 달고 있다)`)
console.log(`   그중 PPT가 번호를 안 주는 카드 ${번호없는카드.toLocaleString()}장 — PPT 번호를 그대로 칸 번호로 썼다`)
console.log(`   공식 한글명·한글판 그림을 이어받은 카드 ${이어받은.toLocaleString()}장`)
console.log(`   PPT에 없어서 그대로 남긴 옛 카드 ${남긴옛카드.toLocaleString()}장 (시세는 안 붙는다)`)
console.log(`   지금 도감의 한글 칸 ${옛한글칸.toLocaleString()}장 중 이어받은 것 ${이어받은.toLocaleString()}장`)
console.log(`   새로 생긴 세트 ${새로생긴.length}개`)
console.log(`\n건드리지 않은 세트 **${그대로세트}개 · 카드 ${그대로카드.toLocaleString()}장** (포켓 · PPT에 없는 세트 · 트레이너 킷)`)
console.log(`\n합계 — 세트 ${새index.length}개 · 카드 ${(만든카드 + 그대로카드).toLocaleString()}장`)
if (새로생긴.length) console.log('\n새 세트 앞 10개:\n   ' + 새로생긴.slice(0, 10).join('\n   '))
// ⚠️⚠️ **새로 만든 세트는 반드시 세트표에도 적는다.** 안 적으면 다음에 다시 만들 때
//    "우리가 안 가진 세트"로 보여 **똑같은 세트를 하나 더 만든다.** 2026-08-09에 그렇게
//    `ja-gym-challenge`가 생겨 `en-gym2`와 겹쳤고, 카드 132장이 두 곳에 있었다.
const 짚은slug = new Set(세트표.map((e) => e.slug))
let 세트표더함 = 0
for (const s of 새index) {
  const m = /^ppt-(\d+)$/.exec(String(s.id ?? ''))
  if (!m || 짚은slug.has(String(s.slug))) continue
  세트표.push({ slug: String(s.slug), setId: Number(m[1]), 메모: '덤프에서 만든 세트' })
  짚은slug.add(String(s.slug))
  세트표더함++
}
if (세트표더함) console.log(`\n세트표(pptSets.json)에 ${세트표더함}줄을 더했습니다 — 다시 만들 때 겹치지 않도록`)

if (WRITE) {
  writeFileSync(join(ROOT, 'src/data/pptSets.json'), JSON.stringify(세트표, null, 1) + '\n')
  writeFileSync(join(dir, 'index.json'), JSON.stringify(새index) + '\n')
  console.log('\npublic/sets/*.json · index.json 을 새로 썼습니다.')
  console.log('이어서: npx tsx scripts/gen-card-name-suggestions.mts · gen-set-name-suggestions.mts · node scripts/gen-sitemap.mjs')
} else console.log('\n(미리보기입니다. 실제로 쓰려면 --write)')
