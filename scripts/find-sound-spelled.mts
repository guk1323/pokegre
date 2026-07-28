// 카드 이름이 뜻으로 옮겨지지 않은 것을 두 갈래로 찾아 표로 뽑는다.
//
//   A. 반쪽만 바뀐 것 — "Black Kyurem-EX → Black 큐레무-EX"처럼 영어가 섞여 남은 것.
//      이건 명백한 버그다.
//   B. 소리로만 적힌 굿즈·기술 카드 — "Steel Shelter → 스틸 셸터".
//      공식 한글명이 따로 있으면 그것으로 바꿔야 한다. 다만 한국판도 굿즈 이름을
//      소리로 적는 게 많아서(마스터볼·네스트볼), 맞는지는 사람이 봐야 한다.
//
// 인물 이름(하우·세레나)과 포켓몬은 소리로 적는 게 맞으므로 처음부터 뺀다.
import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }

const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']

function romanize(ko: string) {
  let out = ''
  for (const ch of ko) {
    const code = ch.codePointAt(0)!
    if (code < 0xac00 || code > 0xd7a3) {
      if (/[a-z0-9]/i.test(ch)) out += ch.toLowerCase()
      continue
    }
    const i = code - 0xac00
    out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28]
  }
  return out
}

// 자음만 남긴 뼈대. 모음 표기는 흔들림이 커서(셸터/쉘터) 비교에서 뺀다.
const skeleton = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '')

function overlap(a: string, b: string) {
  if (!a || !b) return 0
  let i = 0
  for (const ch of b) if (i < a.length && a[i] === ch) i++
  return i / Math.max(a.length, b.length)
}

// ── 걸러낼 것들 ──────────────────────────────────────────────────────────
// 인물 이름은 소리로 적는 게 맞고, 사용자가 이미 확인해 준 이름도 다시 물을 이유가 없다.
// 사전 표를 통째로 내보내면 앱 번들이 커지므로, 조사할 때만 원본에서 키를 훑는다.
const src = readFileSync('src/lib/koreanizeEnglishTitle.ts', 'utf8')
function keysOf(table: string) {
  const body = src.split(`const ${table}`)[1]?.split('\n}')[0] ?? ''
  // 키가 따옴표 없이 쓰인 줄도 있다(`Serena: '세레나'`). 둘 다 읽는다.
  const quoted = [...body.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'"))
  const bare = [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1])
  return new Set([...quoted, ...bare])
}
const skipTables = new Set([
  ...keysOf('TRAINER_EN_TO_KO'), // 인물
  ...keysOf('USER_CONFIRMED_EN_TO_KO'), // 확인 끝
  ...keysOf('ENGLISH_CARD_EN_TO_KO'), // 확인 끝
  ...keysOf('UNVERIFIED_EN_TO_KO'),
])

// 포켓몬 카드는 이름을 소리로 적는 게 맞다. "Kyurem-EX"·"Galarian Mr. Mime"처럼
// 앞뒤에 뭐가 붙어 오므로, 붙는 말을 떼고도 견준다.
const pokemonEn = new Set((pokemonNames as { en: string }[]).map((p) => p.en.toLowerCase()))
const AFFIX =
  /(^|\s)(galarian|alolan|hisuian|paldean|dark|light|shining|radiant|team\s+\w+'?s?|mega|primal|origin|detective)\s+|[\s-]+(ex|gx|v|vmax|vstar|star|lv\.?x|break|prism\s*star|δ|◇|♦)$/gi
const isPokemon = (name: string) => {
  let s = name.toLowerCase().replace(/\s*\(.*\)$/, '')
  for (let i = 0; i < 3; i++) s = s.replace(AFFIX, '$1').trim()
  if (pokemonEn.has(s)) return true
  return s.split(/[^a-z♂♀'’.]+/).some((w) => w && pokemonEn.has(w))
}

// 카드 표기로 정상인 영어 토막(EX·GX 같은 것). 이게 남은 건 버그가 아니다.
// 카드 표기로 정상인 영어 토막. 한국판도 이대로 쓴다(폴리곤Z·M리자몽EX·V-UNION).
const OK_LATIN =
  /^([a-z]|ex|gx|vmax|vstar|v-union|union|star|break|lv|sp|fb|gl|δ|tv|hp|pok[eé]mon|no|i{1,3}|iv|[0-9]+)$/i

type Hit = { en: string; ko: string; where: string[]; count: number; score: number }
const half = new Map<string, Hit>()
const sound = new Map<string, Hit>()

for (const f of readdirSync('public/sets')) {
  if (f === 'index.json' || !f.endsWith('.json')) continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as {
    ed: string
    name: string
    cards?: { n: string; name: string }[]
  }
  if (d.ed !== 'en') continue
  for (const c of d.cards ?? []) {
    const en = (c.name ?? '').trim()
    if (!en || !/[A-Za-z]/.test(en)) continue
    const ko = koreanizeEnglishCardName(en)
    if (!/[가-힣]/.test(ko)) continue // 통째로 영어인 건 이 조사 대상이 아니다

    // A. 한글로 바뀌었는데 영어 낱말이 섞여 남은 것.
    const leftover = (ko.match(/[A-Za-z]+/g) ?? []).filter((w) => !OK_LATIN.test(w))
    const target = leftover.length ? half : sound

    if (target === sound) {
      if (isPokemon(en) || skipTables.has(en.replace(/[’]/g, "'"))) continue
      if (overlap(skeleton(romanize(ko)), skeleton(en)) < 0.55) continue
    }

    const key = en
    const hit = target.get(key) ?? {
      en,
      ko,
      where: [],
      count: 0,
      score: overlap(skeleton(romanize(ko)), skeleton(en)),
    }
    hit.count++
    if (hit.where.length < 2) hit.where.push(`${d.name} ${c.n}`)
    target.set(key, hit)
  }
}

// A는 종수가 많지만 남은 영어는 몇 가지 안 된다("Ice Rider"가 여러 카드에 같이 붙는
// 식). 낱말 하나만 옮기면 그 카드가 다 풀리므로, 카드가 아니라 낱말로 묶어 보여준다.
function fragmentTable(m: Map<string, Hit>) {
  type Frag = { count: number; kinds: number; sample: string[] }
  const frags = new Map<string, Frag>()
  for (const h of m.values()) {
    // 낱말 하나씩 쪼개면 "Ice / Rider"처럼 갈라져 무슨 말인지 안 보인다. 붙어 있는
    // 영어는 덩어리째 묶고, EX·V 같은 정상 표기만으로 된 덩어리는 버린다.
    const runs = (h.ko.match(/[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)*/g) ?? [])
      .map((r) => r.trim())
      .filter((r) => r.split(/\s+/).some((w) => !OK_LATIN.test(w)))
    for (const w of new Set(runs)) {
      const g = frags.get(w) ?? { count: 0, kinds: 0, sample: [] }
      g.count += h.count
      g.kinds++
      if (g.sample.length < 2) g.sample.push(`${h.en} → ${h.ko}`)
      frags.set(w, g)
    }
  }
  const rows = [...frags].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
  console.log(`\n## A. 반쪽만 바뀐 것 — 낱말 ${rows.length}개 (카드 ${m.size}종 / ${[...m.values()].reduce((s, h) => s + h.count, 0)}장)\n`)
  console.log('남은 영어 낱말 하나를 옮기면 그 낱말이 붙은 카드가 한꺼번에 풀린다.\n')
  console.log('| # | 남은 영어 | 이렇게 나간다 | 카드 종류 | 장수 | 한글로 |')
  console.log('|---|---|---|---|---|---|')
  rows.forEach(([w, g], i) =>
    console.log(`| ${i + 1} | ${w} | ${g.sample.join(' · ')} | ${g.kinds} | ${g.count} | |`),
  )
}

const table = (title: string, m: Map<string, Hit>, note: string) => {
  const rows = [...m.values()].sort((a, b) => b.count - a.count || a.en.localeCompare(b.en))
  const cards = rows.reduce((s, r) => s + r.count, 0)
  console.log(`\n## ${title} — ${rows.length}종 / ${cards}장\n`)
  console.log(note + '\n')
  console.log('| # | 영문 카드명 | 지금 나가는 한글 | 세트 | 장수 | 공식 한글명 |')
  console.log('|---|---|---|---|---|---|')
  rows.forEach((r, i) => console.log(`| ${i + 1} | ${r.en} | ${r.ko} | ${r.where.join(' · ')} | ${r.count} | |`))
}

// C. 서로 다른 카드가 같은 한글명으로 나가는 것. 검색이 서로를 덮어써서 한쪽을
// 아예 못 찾게 된다(Peonia·Peony가 둘 다 "피오니"로 나가던 것).
function conflictTable() {
  const byKo = new Map<string, Map<string, number>>()
  for (const f of readdirSync('public/sets')) {
    if (f === 'index.json' || !f.endsWith('.json')) continue
    const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as {
      ed: string
      cards?: { n: string; name: string }[]
    }
    if (d.ed !== 'en') continue
    for (const c of d.cards ?? []) {
      const en = (c.name ?? '').trim()
      if (!en || isPokemon(en)) continue
      const ko = koreanizeEnglishCardName(en)
      if (!/[가-힣]/.test(ko) || ko === en) continue
      const g = byKo.get(ko) ?? new Map<string, number>()
      g.set(en, (g.get(en) ?? 0) + 1)
      byKo.set(ko, g)
    }
  }
  // 같은 카드가 세트마다 어포스트로피·띄어쓰기만 다르게 적힌 경우가 많다
  // (Professor's / Professor’s). 그건 겹치는 게 정상이라 뺀다.
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const rows = [...byKo]
    .filter(([, g]) => new Set([...g.keys()].map(plain)).size > 1)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
  console.log(`\n## C. 서로 다른 카드가 같은 한글명으로 나감 — ${rows.length}건\n`)
  console.log('한쪽이 검색에서 다른 쪽에 묻힌다. 어느 쪽 이름을 바꿔야 하는지 알려 주세요.\n')
  console.log('| # | 같은 한글명 | 이 이름으로 나가는 영문 카드들 | 바꿀 이름 |')
  console.log('|---|---|---|---|')
  rows.forEach(([ko, g], i) =>
    console.log(`| ${i + 1} | ${ko} | ${[...g].map(([en, n]) => `${en}(${n}장)`).join(' · ')} | |`),
  )
}

fragmentTable(half)
table('B. 소리로만 적힌 굿즈·기술 카드', sound, '공식 한글명이 따로 있으면 알려 주세요. 지금 것이 맞으면 비워 두시면 됩니다.')
conflictTable()
