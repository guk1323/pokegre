// 카드 그림이 비어 있는 자리를 pokemontcg.io(무료)에서 채운다.
//
// 왜 또 하나 만드나: 이미 TCGdex(check-missing-imgs)와 limitless(fill-card-imgs)로
// 채우고 있는데, 그 둘 다 없는 세트가 남는다. 맥도날드 컬렉션처럼 오래된 배포 세트가
// 그렇다 — TCGdex는 카드 목록만 있고 image가 통째로 null이다. pokemontcg.io에는 있다.
// (CLAUDE.md의 "보유 API를 먼저 떠올릴 것"에 해당한다. 키는 .env의 POKEMONTCG_API_KEY.)
//
// ⚠️ 번호와 이름이 둘 다 맞을 때만 채운다. 번호만 보고 붙이면 엉뚱한 그림이 들어간다
//    (리포 최우선 원칙: 틀린 것보다 빈칸이 낫다).
// ⚠️ 세트를 짝지을 때도 이름이 정확히 같고 수록 장수까지 같은 것만 쓴다. 이름이
//    비슷하다고 붙이면 부분집합 세트가 상위 세트에 잘못 붙는다 — 실제로
//    "Unseen Forces Unown Collection"(28장)이 "Unseen Forces"(145장)에 걸렸다.
//    번호 체계가 달라서 그대로 채웠으면 전부 엉뚱한 그림이 됐을 것이다.
//
// 쓰기: node scripts/fill-card-imgs-ptcg.mjs          (몇 장인지만)
//       node scripts/fill-card-imgs-ptcg.mjs --write  (저장)
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const SETS = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
// 카드 번호는 "007"·"7"·"SM7"이 섞여 온다. 앞의 0만 떼어 견준다(글자는 그대로 둔다).
const numKey = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '').toUpperCase()

const key = (await readFile(path.resolve(process.cwd(), '.env'), 'utf8'))
  .split('\n')
  .find((l) => l.startsWith('POKEMONTCG_API_KEY='))
  ?.split('=')
  .slice(1)
  .join('=')
  .trim()
  .replace(/^["']|["']$/g, '')
if (!key) throw new Error('.env에 POKEMONTCG_API_KEY가 없다')

async function api(url) {
  // 무료 키라도 연속으로 두드리면 막힌다. 실패하면 조금 쉬었다 두 번까지 다시 본다.
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'X-Api-Key': key } })
      if (r.ok) return await r.json()
    } catch {
      /* 아래에서 다시 시도한다 */
    }
    await sleep(2000 * (i + 1))
  }
  return null
}

// 그림이 실제로 있는지 열어 본다(HEAD 한 번). 같은 주소를 두 번 묻지 않는다.
const aliveCache = new Map()
async function imageAlive(url) {
  if (aliveCache.has(url)) return aliveCache.get(url)
  let ok = false
  try {
    const r = await fetch(url, { method: 'HEAD' })
    ok = r.ok
  } catch {
    ok = false
  }
  aliveCache.set(url, ok)
  return ok
}

// 세트 목록은 잘 안 바뀌고, 무료 키는 연속 호출에 금방 막힌다. 한 번 받아 두고
// 다시 돌릴 땐 그걸 쓴다(--refresh 를 붙이면 새로 받는다).
const CACHE = path.resolve(process.cwd(), 'node_modules/.cache/ptcg-sets.json')
let theirs = null
if (!process.argv.includes('--refresh')) {
  try {
    theirs = JSON.parse(await readFile(CACHE, 'utf8'))
  } catch {
    /* 처음이면 아래에서 받는다 */
  }
}
if (!theirs) {
  const setsRes = await api('https://api.pokemontcg.io/v2/sets?pageSize=250&select=id,name,releaseDate,total')
  if (!setsRes) throw new Error('pokemontcg.io 세트 목록을 못 받았다 — 잠시 뒤 다시 돌려 볼 것')
  theirs = setsRes.data
  await mkdir(path.dirname(CACHE), { recursive: true })
  await writeFile(CACHE, JSON.stringify(theirs))
}

const index = JSON.parse(await readFile(path.join(SETS, 'index.json'), 'utf8'))
let blankTotal = 0
let filledTotal = 0
const report = []
const skipped = []

for (const meta of index) {
  if (meta.ed !== 'en') continue // pokemontcg.io는 영문판만 다룬다
  const file = path.join(SETS, `${meta.slug}.json`)
  let data
  try {
    data = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    continue
  }
  const blanks = (data.cards ?? []).filter((c) => !c.img)
  if (!blanks.length) continue
  blankTotal += blanks.length

  // 이름이 정확히 같고 수록 장수도 같은 세트만 짝으로 인정한다(위 ⚠️ 참고).
  const match = theirs.find((s) => norm(s.name) === norm(meta.name) && s.total === (data.cards ?? []).length)
  if (!match) continue

  const cardsRes = await api(
    `https://api.pokemontcg.io/v2/cards?q=set.id:${match.id}&pageSize=250&select=number,name,images`,
  )
  await sleep(1200)
  if (!cardsRes?.data?.length) {
    // 조용히 넘어가면 "그 세트엔 없더라"와 구별이 안 된다. 실제로 한 번 이것 때문에
    // 맥도날드 2015가 결과에서 빠진 걸 못 알아볼 뻔했다.
    skipped.push(`  ${meta.slug.padEnd(14)} ${match.id} 짝은 찾았는데 카드를 못 받았다(다시 돌려 볼 것)`)
    continue
  }

  const byNum = new Map(cardsRes.data.map((c) => [numKey(c.number), c]))
  let filled = 0
  let dead = 0
  for (const card of blanks) {
    const hit = byNum.get(numKey(card.n))
    // 번호와 이름이 둘 다 맞아야 한다.
    if (!hit || norm(hit.name) !== norm(card.name)) continue
    const img = hit.images?.large || hit.images?.small
    if (!img) continue
    // ⚠️ 주소가 있다고 그림이 있는 게 아니다. pokemontcg.io는 카드 목록에 주소를
    //    만들어 주는데 실제 파일이 없는 세트가 있다(맥도날드 2014~2018이 전부 404였다).
    //    그대로 넣으면 화면에 깨진 그림이 뜬다 — 빈칸보다 나쁘다. 하나씩 열어 본다.
    if (!(await imageAlive(img))) {
      dead++
      continue
    }
    card.img = img
    filled++
  }
  if (dead) skipped.push(`  ${meta.slug.padEnd(14)} ${match.id} 주소는 있는데 그림이 없다(404) ${dead}장 — 빈칸으로 둔다`)
  if (filled) {
    filledTotal += filled
    report.push(`  ${meta.slug.padEnd(14)} 빈칸 ${String(blanks.length).padStart(3)}장 중 ${String(filled).padStart(3)}장 찾음  (${match.id})`)
    if (WRITE) await writeFile(file, JSON.stringify(data, null, 1) + '\n')
  }
}

console.log(`그림이 빈 영문판 카드 ${blankTotal}장 · 이번에 찾은 것 ${filledTotal}장\n`)
for (const line of report) console.log(line)
if (skipped.length) {
  console.log('\n⚠️ 짝은 맞는데 못 받은 세트:')
  for (const line of skipped) console.log(line)
}
console.log(WRITE ? '\n저장했습니다.' : '\n저장하려면 --write')
