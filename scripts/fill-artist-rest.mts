// 카드가 500장에서 잘린 작가만 골라 나머지를 마저 받는다.
//
// 왜: gen-artists.mjs는 한 작가당 2페이지(=최대 500장)만 받는다. 목록에는 실제 총량
// ("카드 1,109종")을 적으므로, 그 작가를 열면 500장만 나오고 나머지 609장은 어디에도
// 없다 — 찾는 사람은 없는 카드라고 여긴다(점검 중 발견 2026-08-06).
// 전체를 다시 긁으면 388명을 다 두드려야 하므로, 모자란 작가만 이어받는다.
//
// ⚠️ 돌린 뒤에는 `npx tsx scripts/fill-artist-slugs.mts --write`도 이어서 돌린다.
//    새로 받은 카드에는 세트 슬러그가 없어, 눌러도 그 한 장으로 못 좁힌다.
//
// 쓰는 법: npx tsx scripts/fill-artist-rest.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const KEY = process.env.POKEMONTCG_API_KEY ?? ''
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ⚠️ pokemontcg.io는 멀쩡한 요청에도 가끔 500을 뱉는다. 한 번 실패로 포기하면 안 된다.
async function 받기(url: string, 시도 = 6): Promise<any> {
  for (let i = 0; i < 시도; i++) {
    try {
      const r = await fetch(url, {
        headers: KEY ? { 'X-Api-Key': KEY, 'User-Agent': 'pokegre' } : { 'User-Agent': 'pokegre' },
      })
      if (r.ok) return await r.json()
      if (r.status < 500) return null
    } catch {
      /* 다시 본다 */
    }
    await nap(1200 * (i + 1))
  }
  // ⚠️ 실패를 null로만 돌려주면 "그 페이지에 카드가 없다"와 구별되지 않아, 조용히
  //    0장 더한 것처럼 끝난다(실제로 두 작가가 그렇게 빠졌다 — 2026-08-06).
  //    부른 쪽이 알아볼 수 있게 표식을 붙인다.
  return { 실패: true }
}

type Card = { name: string; number: string; set: string; img: string; s?: string }
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/artists/index.json'), 'utf-8')) as {
  slug: string
  en: string
  ko?: string
}[]

const 모자란 = index
  .map((a) => {
    const p = path.join(ROOT, 'public/artists', `${a.slug}.json`)
    const d = JSON.parse(readFileSync(p, 'utf-8')) as { count?: number; cards?: Card[] }
    return { ...a, p, d, 적힌: d.count ?? 0, 담긴: d.cards?.length ?? 0 }
  })
  .filter((a) => a.담긴 < a.적힌)

console.log(`\n  카드가 잘린 작가 ${모자란.length}명\n`)
for (const a of 모자란) {
  // 이미 담긴 것 뒤부터 이어받는다. 한 페이지 250장이므로 3페이지째부터.
  const 있는것 = new Set((a.d.cards ?? []).map((c) => `${c.set}|${c.number}|${c.name}`))
  const 더한것: Card[] = []
  const q = encodeURIComponent(`artist:"${a.en}"`)
  for (let page = 3; page <= 12; page++) {
    const j = await 받기(
      `https://api.pokemontcg.io/v2/cards?pageSize=250&page=${page}&orderBy=-set.releaseDate&q=${q}` +
        `&select=name,number,images,set,artist`,
    )
    if (j?.실패) {
      console.log(`    ⚠️ ${a.en} ${page}페이지를 못 받았다 — 이 작가는 다시 돌려야 한다`)
      break
    }
    const rows = j?.data ?? []
    if (!rows.length) break
    for (const c of rows) {
      // 작가명이 정확히 같은 것만(gen-artists와 같은 규칙 — 남의 카드가 섞이면 안 된다).
      if ((c.artist || '').trim() !== a.en) continue
      const img = c.images?.small
      if (!img) continue
      const k = `${c.set?.name ?? ''}|${c.number ?? ''}|${c.name}`
      if (있는것.has(k)) continue
      있는것.add(k)
      더한것.push({ name: c.name, number: c.number ?? '', set: c.set?.name ?? '', img })
    }
    if (rows.length < 250) break
    await nap(400)
  }
  const 합 = a.담긴 + 더한것.length
  console.log(
    `  ${(a.ko || a.en).slice(0, 18).padEnd(20)} 적힘 ${String(a.적힌).padStart(5)} · 담김 ${String(a.담긴).padStart(4)} → ${String(합).padStart(5)}`,
  )
  if (WRITE && 더한것.length) {
    a.d.cards = [...(a.d.cards ?? []), ...더한것]
    writeFileSync(a.p, JSON.stringify(a.d))
  }
  await nap(500)
}
console.log(WRITE ? '\n  저장함. 이어서 fill-artist-slugs.mts --write 를 돌린다.\n' : '\n  (미리보기 — --write 로 저장)\n')
