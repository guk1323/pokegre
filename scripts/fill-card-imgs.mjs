// 카드 그림이 비어 있는 자리를 limitless에서 채운다.
//
// 왜 필요한가: 원본(TCGdex)이 프로모·특별세트의 그림을 안 주는 경우가 많다. 그러면
// 세트 화면이 카드 뒷면으로 가득 차서 초라해 보인다. limitless는 같은 세트를 코드로
// 갖고 있고 목록 한 페이지에 번호·이름·그림이 다 들어 있다(세트당 요청 1번).
//
// ⚠️ 번호와 이름이 둘 다 맞을 때만 채운다. 번호만 보고 붙이면 엉뚱한 그림이 들어간다
//    (리포 CLAUDE.md 최우선 원칙: 틀린 것보다 빈칸이 낫다).
// ⚠️ 스니커덩크 사진은 "판매자가 찍은 실물 사진"이라 공식 스캔이 아니다. 슬랩·손·책상이
//    같이 찍혀 있다. 공식 스캔이 있으면 그걸로 바꾼다.
//
// 쓰기: node scripts/fill-card-imgs.mjs ja-M-P en-mep          (몇 장인지만)
//       node scripts/fill-card-imgs.mjs ja-M-P en-mep --write  (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// limitless가 &#039;·&amp; 같은 HTML 기호로 내보내는 이름이 있다. 풀어 두지 않으면
// "N's Zekrom"과 "N&#039;s Zekrom"이 다른 이름으로 보여 그림을 못 채운다.
const unescape = (s) =>
  s
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
const strip = (s) => unescape(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

// 그림이 실제로 있는지 열어 본다(HEAD 한 번). 같은 주소는 두 번 묻지 않는다.
const aliveCache = new Map()
async function imageAlive(url) {
  if (aliveCache.has(url)) return aliveCache.get(url)
  let ok = false
  try {
    ok = (await fetch(url, { method: 'HEAD' })).ok
  } catch {
    ok = false
  }
  aliveCache.set(url, ok)
  return ok
}
// 이름 비교는 표기 차이를 지우고 한다("Mr. Mime" / "Mr Mime").
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-鿿]/g, '')

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

if (!slugs.length) {
  console.log('세트 슬러그를 적어 주세요. 예: node scripts/fill-card-imgs.mjs ja-M-P en-mep --write')
  process.exit(0)
}

let total = 0
for (const slug of slugs) {
  const file = path.join(OUT, `${slug}.json`)
  let d
  try {
    d = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    console.log(`  ${slug}: 파일 없음`)
    continue
  }
  const lang = slug.startsWith('ja-') ? 'jp/' : ''
  const html = await get(`https://limitlesstcg.com/cards/${lang}${d.id}?display=list`)
  if (!html) {
    console.log(`  ${slug}: limitless에서 못 받음`)
    continue
  }
  const src = new Map()
  for (const [, hover, body] of html.matchAll(/<tr data-hover="([^"]+)">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, name] = td
    if (!n || !name) continue
    src.set(String(n).padStart(3, '0'), { name, img: hover.replace('_XS.png', '_SM.png') })
  }

  let filled = 0
  let replaced = 0
  const skipped = []
  let dead = 0
  for (const c of d.cards ?? []) {
    const hit = src.get(c.n)
    if (!hit) continue
    const blank = !(c.img || '').trim()
    const seller = (c.img || '').includes('snkrdunk')
    if (!blank && !seller) continue
    if (norm(c.name) !== norm(hit.name)) {
      if (skipped.length < 3) skipped.push(`${c.n} ${c.name}≠${hit.name}`)
      continue
    }
    // ⚠️ 목록에 있다고 그림이 있는 게 아니다. limitless도 목록엔 있는데 파일이
    //    없는 카드가 있다(ja-SM10b 043이 403이었다 — 2026-08-04). 깨진 그림은
    //    빈칸보다 나쁘니 넣기 전에 하나씩 열어 본다.
    if (!(await imageAlive(hit.img))) {
      dead++
      continue
    }
    c.img = hit.img
    if (blank) filled++
    else replaced++
  }
  total += filled + replaced
  console.log(
    `  ${slug.padEnd(14)} limitless ${String(src.size).padStart(3)}장 · 빈칸 채움 ${filled} · 판매자 사진 교체 ${replaced}` +
      (dead ? ` · 그림이 없어 건너뜀 ${dead}장` : '') +
      (skipped.length ? `  (이름이 달라 건너뜀: ${skipped.join(', ')})` : ''),
  )
  if (WRITE && filled + replaced) await writeFile(file, JSON.stringify(d))
  await sleep(600)
}
console.log(`\n합계 ${total}장`)
if (!WRITE) console.log('저장하려면 --write')
