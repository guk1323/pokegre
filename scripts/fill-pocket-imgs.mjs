// 포켓몬 카드 포켓(A·B 시리즈) 세트의 빈 그림을 채운다.
//
// 원본(TCGdex)이 새 포켓 세트의 그림을 안 주는 경우가 있다 — B2a는 131장 중 91장이
// 빈칸이었다. pocket.limitlesstcg.com 목록 화면에 카드마다 그림 주소가 붙어 있다.
//
// ⚠️ 번호+이름이 둘 다 맞을 때만 채운다. 번호만 보고 붙이면 엉뚱한 그림이 들어간다
//    (리포 CLAUDE.md의 최우선 원칙: 틀린 것보다 빈칸이 낫다).
//
// 쓰기: node scripts/fill-pocket-imgs.mjs en-B2a          (몇 장 채워지는지만)
//       node scripts/fill-pocket-imgs.mjs en-B2a --write  (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
// 이름 비교는 표기 차이를 지우고 한다("Mr. Mime" / "Mr Mime").
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

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

let total = 0
for (const slug of process.argv.filter((a) => a.startsWith('en-'))) {
  const file = path.join(OUT, `${slug}.json`)
  let d
  try {
    d = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    console.log(`  ${slug}: 파일 없음`)
    continue
  }
  const html = await get(`https://pocket.limitlesstcg.com/cards/${d.id}?display=list`)
  if (!html) {
    console.log(`  ${slug}: 받기 실패`)
    continue
  }
  // 번호 → { 이름, 그림 }
  const src = new Map()
  for (const [, img, body] of html.matchAll(/<tr data-hover="([^"]+)">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, name] = td
    if (!n || !name || !img) continue
    src.set(String(n).padStart(3, '0'), { name, img })
  }
  let filled = 0
  const skipped = []
  for (const c of d.cards ?? []) {
    if ((c.img || '').trim()) continue
    const hit = src.get(c.n)
    if (!hit) continue
    const a = norm(c.name)
    const b = norm(hit.name)
    const suffixOnly = b.startsWith(a) && /^(ex|v|vmax|vstar|gx)$/.test(b.slice(a.length))
    if (a !== b && !suffixOnly) {
      skipped.push(`${c.n} ${c.name}≠${hit.name}`)
      continue
    }
    c.img = hit.img
    if (suffixOnly) c.name = hit.name
    filled++
  }
  total += filled
  console.log(`  ${slug}: ${filled}장 채움${skipped.length ? ` (이름이 달라 건너뜀 ${skipped.length}장: ${skipped.slice(0, 3).join(', ')})` : ''}`)
  if (WRITE && filled) await writeFile(file, JSON.stringify(d))
  await sleep(600)
}
console.log(`\n합계 ${total}장`)
if (!WRITE) console.log('저장하려면 --write')
