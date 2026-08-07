// 작가별 카드 목록(public/artists/*.json)에 **세트 슬러그**를 채워 넣는다.
//
// 왜 필요한가: 작가 데이터는 pokemontcg.io에서 긁은 것이라 세트를 **이름**으로만 들고
// 있다("Lost Origin"). 카드를 눌러 그 한 장의 시세로 가려면 세트 슬러그가 있어야 하는데
// (PPT 세트 이름 대응표가 슬러그를 열쇠로 쓴다), 이름으로 맞추면 16,857장 중 680장이
// 안 맞는다 — `HS—Triumphant`처럼 대시가 다르거나 우리 쪽에 없는 표기다. 같은 이름
// 세트가 둘인 경우도 88장 있다.
//
// 그래서 이름 대신 **카드 번호 + 영문 이름**으로 짝짓는다. 이건 우리 세트 파일에 그대로
// 있는 값이라 표기 흔들림이 없고, 짝이 유일하면 그 세트가 맞다. 여러 세트에 같은
// 번호·이름이 있으면 그때만 세트 이름으로 가린다.
//
// ⚠️ 짝을 못 지으면 **비워 둔다**. 틀린 것보다 빈칸이 낫다 — 슬러그가 틀리면 엉뚱한
//    세트로 좁혀 남의 카드 시세를 보여 주게 된다.
//
// 쓰는 법: npx tsx scripts/fill-artist-slugs.mts [--write]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SETS = path.join(ROOT, 'public', 'sets')
const ARTISTS = path.join(ROOT, 'public', 'artists')
const WRITE = process.argv.includes('--write')

type SetMeta = { slug: string; ed: 'ja' | 'en'; name: string }
const index = JSON.parse(readFileSync(path.join(SETS, 'index.json'), 'utf-8')) as SetMeta[]
const meta = new Map(index.map((s) => [s.slug, s]))

/** 번호+이름 → 그 조합을 가진 세트 슬러그들. 작가 데이터가 영문판이라 en만 본다. */
const 짝 = new Map<string, string[]>()
// ⚠️ 카드 이름 표기가 두 데이터에서 조금씩 다르다 — "Tapu Lele-GX"와 "Tapu Lele GX",
//    "Togepi & Cleffa & Igglybuff-GX"처럼 붙임표 자리가 갈린다. 붙임표·따옴표를 공백으로
//    바꿔 놓고 맞춘다(2026-08-06 되짚어 확인에서 729장이 이것 때문에 안 맞았다).
const 이름열쇠 = (name: string) =>
  name
    .toLowerCase()
    // ⚠️ 성별 기호 앞 공백이 데이터마다 갈린다 — "Nidoran ♂"와 "Nidoran♂".
    //    이것 하나로 초판 니드런이 세트에 못 붙었다(2026-08-06).
    .replace(/\s*([♂♀])/g, '$1')
    .replace(/[-–—'’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const 열쇠 = (num: string, name: string) =>
  `${String(num).replace(/^0+/, '').toLowerCase()}|${이름열쇠(name)}`

for (const f of readdirSync(SETS)) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const slug = f.replace('.json', '')
  const m = meta.get(slug)
  if (!m || m.ed !== 'en') continue
  const d = JSON.parse(readFileSync(path.join(SETS, f), 'utf-8')) as { cards?: { n: string; name: string }[] }
  for (const c of d.cards ?? []) {
    if (!c.n || !c.name) continue
    const k = 열쇠(c.n, c.name)
    const arr = 짝.get(k) ?? []
    if (!arr.includes(slug)) arr.push(slug)
    짝.set(k, arr)
  }
}

// 세트 이름 흔들림을 걷어낸다. 작가 데이터와 우리 데이터가 같은 세트를 다르게 적는다:
//   "HeartGold & SoulSilver" ↔ "HeartGold SoulSilver"(& 유무)
//   "HS—Unleashed" ↔ "Unleashed"(HS 접두 + 긴 대시)
//   "Celebrations: Classic Collection" ↔ "Celebrations Classic Collection"(콜론)
//   "Best of Game" ↔ "Best of game"(대소문자)
const 세트열쇠 = (s: string) =>
  s
    .toLowerCase()
    .replace(/^hs[\s—–-]+/, '')
    .replace(/[&:,'’.]/g, ' ')
    .replace(/[—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const 이름별 = new Map<string, string[]>()
for (const s of index) {
  if (s.ed !== 'en') continue
  for (const k of [s.name, 세트열쇠(s.name)]) {
    const arr = 이름별.get(k) ?? []
    if (!arr.includes(s.slug)) arr.push(s.slug)
    이름별.set(k, arr)
  }
}

// ⚠️ 채운 것을 세기만 하면 "틀리게 채운 것"이 안 보인다. 채운 슬러그의 세트 파일에
//    정말 그 번호·이름 카드가 있는지 되짚어 센다(회귀 검사).
const 세트카드 = new Map<string, Set<string>>()
for (const f of readdirSync(SETS)) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const slug = f.replace('.json', '')
  if (meta.get(slug)?.ed !== 'en') continue
  const d = JSON.parse(readFileSync(path.join(SETS, f), 'utf-8')) as { cards?: { n: string; name: string }[] }
  세트카드.set(slug, new Set((d.cards ?? []).map((c) => 열쇠(c.n, c.name))))
}
let 확인됨 = 0
let 이름만맞음 = 0
const 수상한예: string[] = []

let 총 = 0
let 채움 = 0
let 이름으로가림 = 0
let 못찾음 = 0
const 못찾은세트 = new Map<string, number>()

for (const f of readdirSync(ARTISTS)) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'by-card.json') continue
  const p = path.join(ARTISTS, f)
  const d = JSON.parse(readFileSync(p, 'utf-8')) as {
    cards?: { name: string; number: string; set: string; img: string; s?: string }[]
  }
  let 바뀜 = false
  for (const c of d.cards ?? []) {
    총++
    const 후보 = 짝.get(열쇠(c.number, c.name)) ?? []
    let slug = ''
    if (후보.length === 1) slug = 후보[0]
    else if (후보.length > 1) {
      // 여러 세트에 같은 번호·이름이 있다. 세트 이름이 맞는 쪽을 고른다.
      const 이름맞음 = 후보.filter((s) => meta.get(s)?.name === c.set)
      if (이름맞음.length === 1) {
        slug = 이름맞음[0]
        이름으로가림++
      }
    }
    // 번호+이름으로 못 찾으면 세트 이름이 딱 하나로 떨어질 때만 받아들인다.
    if (!slug) {
      const byName = 이름별.get(c.set) ?? 이름별.get(세트열쇠(c.set)) ?? []
      if (byName.length === 1) slug = byName[0]
    }
    if (slug) {
      if (c.s !== slug) {
        c.s = slug
        바뀜 = true
      }
      채움++
      if (세트카드.get(slug)?.has(열쇠(c.number, c.name))) 확인됨++
      else {
        이름만맞음++
        if (수상한예.length < 8) 수상한예.push(`${c.set} ${c.number} ${c.name} → ${slug}`)
      }
    } else {
      못찾음++
      못찾은세트.set(c.set, (못찾은세트.get(c.set) ?? 0) + 1)
    }
  }
  if (바뀜 && WRITE) writeFileSync(p, JSON.stringify(d))
}

console.log(
  `  작가 카드 ${총.toLocaleString()}장 · 슬러그 채움 ${채움.toLocaleString()}장 ` +
    `(이름으로 가린 것 ${이름으로가림}) · 못 찾음 ${못찾음.toLocaleString()}장${WRITE ? ' · 저장함' : ' (미리보기 — --write 로 저장)'}`,
)
console.log(
  `  되짚어 확인: 그 세트에 실제로 있는 카드 ${확인됨.toLocaleString()}장 · ` +
    `세트 이름만 보고 정한 것 ${이름만맞음.toLocaleString()}장`,
)
for (const e of 수상한예) console.log(`   ? ${e}`)
if (못찾음) {
  console.log('  못 찾은 세트(장수 많은 순):')
  for (const [name, n] of [...못찾은세트].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`   ${String(n).padStart(4)}장  ${name}`)
}
