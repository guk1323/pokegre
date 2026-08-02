// 카드 등급(레어도)이 빈 자리를 limitless에서 채운다.
//
// 왜 필요한가: 세트 화면 맨 위 "간판 카드"와 목록 표지는 등급으로 고른다. 등급이 비면
// 그냥 번호순이 되어, 커먼 카드가 세트 얼굴로 올라간다. 원본(TCGdex)이 등급을 안 준
// 세트가 많다(2026-08-02 기준 40,489장 중 9,776장).
//
// ⚠️ 번호와 이름이 둘 다 맞을 때만 채운다. 번호만 보고 붙이면 엉뚱한 등급이 들어간다
//    (리포 CLAUDE.md 최우선 원칙: 틀린 것보다 빈칸이 낫다).
// ⚠️ 이미 등급이 있는 카드는 건드리지 않는다. 덮어쓰기가 아니라 빈칸 메우기다.
// ⚠️ 프로모 세트(SVP·SMP·XYP…)는 원래 등급이 없다. limitless에도 비어 있어 안 채워진다.
//
// 쓰기: node scripts/fill-card-rarity.mjs                (전체, 몇 장인지만)
//       node scripts/fill-card-rarity.mjs --write        (저장)
//       node scripts/fill-card-rarity.mjs ja-SV4a --write (세트 지정)
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// limitless가 &#039;·&amp; 같은 HTML 기호로 내보내는 이름이 있다. 풀어 두지 않으면
// "レシラム&マッシブーン"과 "レシラム&amp;マッシブーン"이 다른 이름으로 보인다.
const unescape = (s) =>
  s
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
const strip = (s) => unescape(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
// 이름 비교는 표기 차이를 지우고 한다("Mr. Mime" / "Mr Mime").
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-鿿]/g, '')

// limitless와 우리 데이터(TCGdex)가 같은 등급을 다르게 적는다. 여기서 맞춰 두지 않으면
// src/lib/cardCatalog.ts의 RARITY_ORDER에 안 걸려, 채워 넣고도 등급이 없는 것과 똑같아진다.
// (대소문자도 다르다: limitless "Shiny Rare" / 우리 "Shiny rare")
const RARITY_ALIAS = {
  'Art Rare': 'Illustration rare',
  'Special Art Rare': 'Special illustration rare',
  'Shiny Rare': 'Shiny rare',
  'Shiny Super Rare': 'Shiny Ultra Rare',
  'Hyper Rare': 'Hyper rare',
  'Double Rare': 'Double rare',
  'Illustration Rare': 'Illustration rare',
  'Special Illustration Rare': 'Special illustration rare',
  'ACE SPEC Rare': 'ACE SPEC Rare',
}
// 우리 순위표에 있는 이름만 넣는다. 모르는 등급을 넣으면 순위 -1이라 아무 소용이 없고,
// 나중에 "등급이 있는데 왜 안 걸리지" 하고 헤매게 된다.
const KNOWN = new Set([
  'Common',
  'Uncommon',
  'Rare',
  'Double rare',
  'ACE SPEC Rare',
  'Ultra Rare',
  'Illustration rare',
  'Shiny rare',
  'Shiny Ultra Rare',
  'Special illustration rare',
  'Secret Rare',
  'Hyper rare',
  'Black White Rare',
  'Mega Hyper Rare',
])

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (r.ok) return await r.text()
    } catch {
      /* 재시도 */
    }
    await sleep(1500 + i * 1500)
  }
  return null
}

const files = only.length
  ? only.map((s) => `${s}.json`)
  : (await readdir(OUT)).filter((f) => f.endsWith('.json') && f !== 'index.json')

// 등급이 하나도 안 빈 세트는 아예 안 부른다(요청 낭비 방지).
const targets = []
for (const f of files) {
  const slug = f.replace('.json', '')
  let d
  try {
    d = JSON.parse(await readFile(path.join(OUT, f), 'utf8'))
  } catch {
    continue
  }
  const blank = (d.cards ?? []).filter((c) => !(c.r || '').trim()).length
  if (blank) targets.push({ slug, file: f, d, blank })
}
console.log(`등급이 빈 카드가 있는 세트 ${targets.length}개 (빈 카드 ${targets.reduce((a, t) => a + t.blank, 0)}장)\n`)

let total = 0
let touchedFiles = 0
for (const t of targets) {
  const lang = t.slug.startsWith('ja-') ? 'jp/' : ''
  const html = await get(`https://limitlesstcg.com/cards/${lang}${t.d.id}?display=list`)
  if (!html) {
    console.log(`  ${t.slug.padEnd(14)} limitless에서 못 받음`)
    await sleep(600)
    continue
  }
  // 표 칸: [세트, 번호, 이름, 타입, 등급, USD, EUR]
  const src = new Map()
  for (const [, body] of html.matchAll(/<tr data-hover="[^"]+">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, name, , rarity] = td
    if (!n || !name || !rarity) continue
    src.set(String(n).padStart(3, '0'), { name, rarity })
  }
  if (!src.size) {
    console.log(`  ${t.slug.padEnd(14)} limitless에도 등급 없음 (프로모 등)`)
    await sleep(600)
    continue
  }

  let filled = 0
  const skipped = []
  const unknown = new Set()
  for (const c of t.d.cards ?? []) {
    if ((c.r || '').trim()) continue
    const hit = src.get(c.n)
    if (!hit) continue
    if (norm(c.name) !== norm(hit.name)) {
      if (skipped.length < 3) skipped.push(`${c.n} ${c.name}≠${hit.name}`)
      continue
    }
    const r = RARITY_ALIAS[hit.rarity] ?? hit.rarity
    if (!KNOWN.has(r)) {
      unknown.add(hit.rarity)
      continue
    }
    c.r = r
    filled++
  }
  total += filled
  if (filled) touchedFiles++
  console.log(
    `  ${t.slug.padEnd(14)} 빈칸 ${String(t.blank).padStart(3)}장 중 ${String(filled).padStart(3)}장 채움` +
      (unknown.size ? `  (모르는 등급이라 건너뜀: ${[...unknown].join(', ')})` : '') +
      (skipped.length ? `  (이름이 달라 건너뜀: ${skipped.join(', ')})` : ''),
  )
  if (WRITE && filled) await writeFile(path.join(OUT, t.file), JSON.stringify(t.d))
  await sleep(600)
}
console.log(`\n합계 ${total}장 · 세트 ${touchedFiles}개`)
if (!WRITE) console.log('저장하려면 --write')
