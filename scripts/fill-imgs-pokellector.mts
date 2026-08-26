// tcgplayer가 지워 버린 그림을 **pokellector**에서 가져와 메운다.
//
// ⚠️ 왜: 2026-08-21에 tcgplayer 그림 1,323장이 403으로 죽어 빈칸이 됐다. 다른 크기 주소도
//    전부 403이라 저쪽은 완전히 끝났고, TCGdex는 세트만 있고 그림이 2장뿐, limitless는
//    옛 일본판 세트 자체가 없다. **pokellector에만 남아 있다**(2026-08-22 실측).
//
// ⚠️⚠️ **번호와 카드 이름이 둘 다 맞을 때만 쓴다.** 번호만 보면 엉뚱한 그림이 붙는다 —
//    실제로 L1 34번이 우리는 코터스인데 저쪽은 전룡이었다. 「틀린 것보다 빈칸」이 잣대다.
// ⚠️ **미러 홀로 변종은 pokellector에도 일반판 그림뿐**이라, 일반판을 쓰되
//    `imgBase: true`를 같이 적어 화면이 「일반판 그림」이라고 밝히게 한다
//    (사장님 지시 2026-08-22 · 마스터볼 미러 때와 같은 방식).
// ⚠️ `.thumb.png`가 아니라 **원본 `.png`를 쓴다.** 옛 세트의 thumb은 140×195라 뭉개진다
//    (원본은 570×792). 그림 프록시가 어차피 줄여서 내보낸다.
//
// 사용법:
//   npx tsx scripts/fill-imgs-pokellector.mts            무엇이 바뀌는지 보기만
//   npx tsx scripts/fill-imgs-pokellector.mts --write    실제로 public/sets에 쓴다
// ⚠️ --write 뒤에는 `npx tsx scripts/gen-card-index.mts`를 다시 돌린다(색인에도 그림이 있다).

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
const SETS = path.resolve('public/sets')
const 임시 = path.resolve('.cache/pokellector')

/** 우리 세트 → pokellector 세트 페이지. 이름이 제각각이라 손으로 맞춘다. */
const 짝 = [
  ['ja-L1', 'https://jp.pokellector.com/HeartGold-Collection-Expansion/'],
  ['ja-l1-soulsilver-collection', 'https://jp.pokellector.com/SoulSilver-Collection-Expansion/'],
  ['ja-VS1', 'https://jp.pokellector.com/Pokemon-VS-Expansion/'],
  ['ja-SVP', 'https://jp.pokellector.com/Scarlet-Violet-Japanese-Promos-Expansion/'],
] as const

interface 카드 { n: string; name?: string; img?: string; imgBase?: boolean; [k: string]: unknown }

/** 이름을 견줄 수 있게 다듬는다. 저쪽 파일이름은 é 같은 글자를 떨어뜨려 적는다. */
function 이름열쇠(s: string | undefined): string {
  let t = (s ?? '')
    .replace(/\s*-\s*\d+[a-z]?\/\d+.*$/i, '') // " - 016/070 (미러 홀로)"
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/é/g, 'e')
  t = t.replace(/technical machine/g, 'tm').replace(/poke/g, 'pok') // Poké Ball ↔ Pok-Ball
  return t.replace(/[^a-z0-9]/g, '')
}

async function 페이지(url: string): Promise<string> {
  await mkdir(임시, { recursive: true })
  const 길 = path.join(임시, url.replace(/\W+/g, '_') + '.html')
  if (existsSync(길)) return readFile(길, 'utf-8')
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } })
  if (!r.ok) throw new Error(url + ' → ' + r.status)
  const h = await r.text()
  await writeFile(길, h)
  return h
}

/** 페이지에서 「번호 → 그림들」을 뽑는다. 주소에 이름·세트코드·번호가 다 들어 있다. */
function 훑기(html: string): Map<string, { url: string; name: string }[]> {
  const 표 = new Map<string, { url: string; name: string }[]>()
  const re = /https:\/\/den-cards\.pokellector\.com\/\d+\/([^/"']+?)\.([A-Za-z0-9]+)\.(\d+)\.\d+\.thumb\.png/g
  for (const m of html.matchAll(re)) {
    const [주소, 이름, , 번호] = m
    if (!표.has(번호)) 표.set(번호, [])
    표.get(번호)!.push({ url: 주소.replace('.thumb.png', '.png'), name: 이름 })
  }
  return 표
}

let 메움 = 0, 일반판으로 = 0, 번호없음 = 0, 이름다름 = 0
const 세트별: [string, number, number][] = []
const 못맞춘예: string[] = []

for (const [slug, url] of 짝) {
  const 길 = path.join(SETS, slug + '.json')
  const j = JSON.parse(await readFile(길, 'utf-8')) as { cards: 카드[] }
  let pk: Map<string, { url: string; name: string }[]>
  try { pk = 훑기(await 페이지(url)) } catch (e) { console.log(slug + ': 못 읽음 — ' + (e as Error).message); continue }

  let 이세트 = 0, 이세트일반 = 0
  for (const c of j.cards) {
    if ((c.img ?? '').trim()) continue
    const 밑 = String(c.n ?? '').split('~')[0].replace(/^#/, '')
    const 미러 = /mirror/i.test(String(c.n) + ' ' + (c.name ?? ''))
    const 후보 = pk.get(밑) ?? pk.get(밑.replace(/^0+(?=\d)/, '')) ?? []
    if (!후보.length) { 번호없음++; continue }
    const 원하는 = 이름열쇠(c.name)
    const 맞는 = 후보.find((x) => 이름열쇠(x.name) === 원하는)
    if (!맞는) {
      이름다름++
      if (못맞춘예.length < 10) 못맞춘예.push(`${slug} ${밑} 우리[${c.name}] ↔ 저쪽[${후보.map((x) => x.name).join(', ')}]`)
      continue
    }
    c.img = 맞는.url
    // ⚠️ 미러 홀로는 그림이 없어 일반판을 쓴다 — 화면이 그렇다고 밝혀야 한다.
    if (미러) { c.imgBase = true; 일반판으로++; 이세트일반++ } else { 메움++ }
    이세트++
  }
  세트별.push([slug, 이세트, 이세트일반])
  if (이세트 && WRITE) await writeFile(길, JSON.stringify(j))
}

console.log((WRITE ? '메웠습니다' : '메울 수 있습니다') + ` — 그 카드 그림 ${메움}장 · 일반판 그림으로 밝히고 메운 것 ${일반판으로}장 (합 ${메움 + 일반판으로}장)`)
console.log(`그대로 둔 것 — 저쪽에 번호가 없음 ${번호없음}장 · 이름이 달라 못 믿음 ${이름다름}장`)
console.log('\n세트별:')
for (const [s, n, m] of 세트별) console.log('  ' + String(n).padStart(4) + '장 (그중 일반판 표시 ' + m + ')  ' + s)
if (못맞춘예.length) { console.log('\n이름이 달라 건너뛴 예:'); for (const e of 못맞춘예) console.log('  ' + e) }
if (!WRITE) console.log('\n실제로 쓰려면 --write 를 붙이세요.')
