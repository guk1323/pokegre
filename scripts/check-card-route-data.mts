// 카드를 눌러 "그 한 장"으로 가는 데 필요한 정보가 빠진 카드가 있는지 전수로 센다.
//
// 왜: 화면에서 랜덤으로 눌러 보는 검사는 한 번에 세 장뿐이다. 정보가 빠진 카드는
// 검색어가 이름만 남아 엉뚱한 결과로 이어지는데(세트코드가 없으면 스니커덩크가
// "M6 113" 대신 "리자몽"으로 찾는다), 그런 카드가 몇 장인지 랜덤으로는 알 수 없다.
//
// 세 화면이 같은 길(카드로가기)을 쓰므로 각각 필요한 것이 있다:
//  · 도감·세트 — 세트가 목록에 있어야 하고, 세트코드·번호가 있어야 한다
//  · 작가      — 세트 슬러그(s)가 있어야 한다. 없으면 이름으로만 찾는다
//
// 쓰는 법: npx tsx scripts/check-card-route-data.mts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  ed: 'ja' | 'en'
  id: string
  name: string
  serie?: string
}[]
const meta = new Map(index.map((s) => [s.slug, s]))

const 줄 = (제목: string, n: number, 전체: number, 예: string[]) => {
  const 표 = n === 0 ? '✓' : '✗'
  console.log(`  ${표} ${제목.padEnd(30)} ${String(n).padStart(5)} / ${전체.toLocaleString()}`)
  for (const e of 예.slice(0, 4)) console.log(`      ${e}`)
}

// ── 도감 ────────────────────────────────────────────────────────────
{
  let 총 = 0
  const 세트없음: string[] = []
  const 코드없음: string[] = []
  const 번호없음: string[] = []
  for (const f of readdirSync(path.join(ROOT, 'public/pokedex'))) {
    if (f === 'index.json') continue
    for (const c of JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex', f), 'utf-8')) as {
      s: string
      n: string
      name: string
    }[]) {
      총++
      const m = meta.get(c.s)
      if (!m) {
        if (세트없음.length < 6) 세트없음.push(`${f} ${c.s} ${c.n} ${c.name}`)
        continue
      }
      if (!m.id) 코드없음.push(`${c.s} ${c.n} ${c.name}`)
      if (!String(c.n ?? '').trim()) 번호없음.push(`${c.s} ${c.name}`)
    }
  }
  console.log(`\n[도감] 카드 ${총.toLocaleString()}장`)
  줄('세트가 목록에 없음', 세트없음.length, 총, 세트없음)
  줄('세트코드 없음', 코드없음.length, 총, 코드없음)
  줄('카드번호 없음', 번호없음.length, 총, 번호없음)
}

// ── 세트별 목록 ─────────────────────────────────────────────────────
{
  let 총 = 0
  const 코드없음: string[] = []
  const 번호없음: string[] = []
  const 이름없음: string[] = []
  for (const f of readdirSync(path.join(ROOT, 'public/sets'))) {
    if (!f.endsWith('.json') || f === 'index.json') continue
    const m = meta.get(f.replace('.json', ''))
    if (!m) continue
    const d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', f), 'utf-8')) as {
      cards?: { n: string; name: string }[]
    }
    for (const c of d.cards ?? []) {
      총++
      if (!m.id) 코드없음.push(`${m.slug} ${c.n} ${c.name}`)
      if (!String(c.n ?? '').trim()) 번호없음.push(`${m.slug} ${c.name}`)
      if (!String(c.name ?? '').trim()) 이름없음.push(`${m.slug} ${c.n}`)
    }
  }
  console.log(`\n[세트별 목록] 카드 ${총.toLocaleString()}장`)
  줄('세트코드 없음', 코드없음.length, 총, 코드없음)
  줄('카드번호 없음', 번호없음.length, 총, 번호없음)
  줄('카드이름 없음', 이름없음.length, 총, 이름없음)
}

// ── 작가별 목록 ─────────────────────────────────────────────────────
{
  let 총 = 0
  const 슬러그없음: string[] = []
  const 슬러그이상: string[] = []
  const 번호없음: string[] = []
  for (const f of readdirSync(path.join(ROOT, 'public/artists'))) {
    if (!f.endsWith('.json') || f === 'index.json' || f === 'by-card.json') continue
    const d = JSON.parse(readFileSync(path.join(ROOT, 'public/artists', f), 'utf-8')) as {
      cards?: { name: string; number: string; set: string; s?: string }[]
    }
    for (const c of d.cards ?? []) {
      총++
      if (!c.s) 슬러그없음.push(`${f.replace('.json', '')} ${c.set} ${c.number} ${c.name}`)
      else if (!meta.get(c.s)) 슬러그이상.push(`${f.replace('.json', '')} ${c.s} ${c.number} ${c.name}`)
      if (!String(c.number ?? '').trim()) 번호없음.push(`${f.replace('.json', '')} ${c.name}`)
    }
  }
  console.log(`\n[작가별 목록] 카드 ${총.toLocaleString()}장`)
  줄('세트 슬러그 없음(이름으로만 찾음)', 슬러그없음.length, 총, 슬러그없음)
  줄('슬러그가 우리 목록에 없음', 슬러그이상.length, 총, 슬러그이상)
  줄('카드번호 없음', 번호없음.length, 총, 번호없음)
}
console.log('')
