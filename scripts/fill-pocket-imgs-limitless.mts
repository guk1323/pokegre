// 포켓몬 TCG Pocket(모바일 게임) 세트의 빈 카드 그림을 limitless에서 채운다.
//
// 왜 따로 만드나: Pocket 카드는 주소 규칙이 실물 카드와 다르다.
//   실물   .../tpc/<세트>/<세트>_<번호>_R_JP_SM.png
//   Pocket .../pocket/<세트>/<세트>_<번호>_EN.png
// 그래서 기존 스크립트로는 안 잡히고, TCGdex는 Pocket 카드 그림을 통째로 404를 준다
// (2026-08-04 확인). PPT에도 Pocket은 없다.
//
// ⚠️ 번호만 보고 붙인다. Pocket은 한 세트 안에서 번호가 유일하고, 주소에 번호가 그대로
//    들어가므로 다른 카드가 섞일 여지가 없다. 대신 넣기 전에 그림을 하나씩 열어 본다.
// ⚠️ 무료 CDN이다. 사이를 띄워 부른다.
//
// 실행: npx tsx scripts/fill-pocket-imgs-limitless.mts [--write]
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SETS = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// index.json의 Pocket 세트: 슬러그가 en-A*·en-B*·en-P-A 꼴이고 TCGdex 계열 주소를 쓴다.
const POCKET = /^en-(A\d|B\d|P-A)/

const idx = JSON.parse(await readFile(path.join(SETS, 'index.json'), 'utf8')) as { slug: string; name: string }[]
const targets = idx.filter((s) => POCKET.test(s.slug))
console.log(`Pocket 세트 ${targets.length}개를 본다\n`)

const aliveCache = new Map<string, boolean>()
async function firstAlive(urls: string[]): Promise<string | null> {
  for (const u of urls) {
    const known = aliveCache.get(u)
    if (known === false) continue
    if (known === true) return u
    let ok = false
    try {
      ok = (await fetch(u, { method: 'HEAD' })).ok
    } catch {
      ok = false
    }
    aliveCache.set(u, ok)
    if (ok) return u
    await sleep(150)
  }
  return null
}

let total = 0
for (const s of targets) {
  const file = path.join(SETS, `${s.slug}.json`)
  let d: { cards?: { n: string; name: string; img?: string }[] }
  try {
    d = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    continue
  }
  const blanks = (d.cards ?? []).filter((c) => !(c.img ?? '').trim())
  if (!blanks.length) continue

  // 슬러그의 'en-' 을 뗀 것이 limitless의 세트 코드다(en-P-A → P-A, en-B1 → B1).
  const code = s.slug.replace(/^en-/, '')
  let filled = 0
  for (const c of blanks) {
    const num = String(c.n).replace(/^0+(?=\d)/, '')
    const pad3 = num.padStart(3, '0')
    const base = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/pocket/${code}/${code}_`
    const hit = await firstAlive([`${base}${pad3}_EN.png`, `${base}${num}_EN.png`, `${base}${pad3}_EN.webp`])
    if (!hit) continue
    c.img = hit
    filled++
    await sleep(200)
  }
  total += filled
  console.log(`  ${s.slug.padEnd(10)} 빈칸 ${String(blanks.length).padStart(3)}장 중 ${String(filled).padStart(3)}장 찾음`)
  if (WRITE && filled) await writeFile(file, JSON.stringify(d, null, 1) + '\n')
}
console.log(`\n합계 ${total}장`)
console.log(WRITE ? '저장했습니다.' : '저장하려면 --write')
