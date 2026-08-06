// 화면에 적히는 숫자가 실제 카드 수와 맞는지 센다.
//
// 왜: 목록에는 "12종", "카드 116장" 같은 숫자가 붙는다. 이 숫자는 미리 만들어 둔
// 목록 파일에서 오는데, 실제 카드 파일과 어긋나도 화면은 멀쩡해 보인다 — 눌러서
// 세어 보기 전에는 모른다. 도감을 다시 만들 때마다 어긋날 수 있어 특히 위험하다.
//
// 쓰는 법: npx tsx scripts/check-counts.mts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const 줄 = (제목: string, 어긋남: string[], 전체: number) => {
  console.log(`  ${어긋남.length ? '✗' : '✓'} ${제목.padEnd(32)} ${어긋남.length} / ${전체.toLocaleString()}`)
  for (const e of 어긋남.slice(0, 6)) console.log(`      ${e}`)
}

// ── 세트 목록의 "N종" ───────────────────────────────────────────────
{
  const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
    slug: string
    name: string
    count: number
  }[]
  const 어긋남: string[] = []
  for (const s of index) {
    const f = path.join(ROOT, 'public/sets', `${s.slug}.json`)
    if (!existsSync(f)) {
      어긋남.push(`${s.slug} 파일 없음`)
      continue
    }
    const 실제 = (JSON.parse(readFileSync(f, 'utf-8')) as { cards?: unknown[] }).cards?.length ?? 0
    if (실제 !== s.count) 어긋남.push(`${s.slug.padEnd(14)} ${s.name.slice(0, 22).padEnd(24)} 적힌 ${s.count} · 실제 ${실제}`)
  }
  console.log(`\n[세트별 목록] 세트 ${index.length}개`)
  줄('"N종"이 실제와 다름', 어긋남, index.length)
}

// ── 도감 목록의 "카드 N장" ──────────────────────────────────────────
{
  const index = JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex/index.json'), 'utf-8')) as {
    id: number
    ko: string
    c: number
  }[]
  const 어긋남: string[] = []
  const 파일들 = new Set(readdirSync(path.join(ROOT, 'public/pokedex')).filter((f) => f !== 'index.json'))
  for (const r of index) {
    const f = `${r.id}.json`
    if (!파일들.has(f)) {
      어긋남.push(`${r.ko} (${r.id}) 파일 없음`)
      continue
    }
    파일들.delete(f)
    const 실제 = (JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex', f), 'utf-8')) as unknown[]).length
    if (실제 !== r.c) 어긋남.push(`${r.ko.padEnd(20)} 적힌 ${r.c} · 실제 ${실제}`)
  }
  console.log(`\n[도감] 이름 ${index.length.toLocaleString()}개`)
  줄('"카드 N장"이 실제와 다름', 어긋남, index.length)
  줄('목록에 없는데 파일만 있음', [...파일들], index.length)
}

// ── 작가 목록의 카드 수 ─────────────────────────────────────────────
{
  const index = JSON.parse(readFileSync(path.join(ROOT, 'public/artists/index.json'), 'utf-8')) as {
    slug: string
    en?: string
    count?: number
    c?: number
  }[]
  const 어긋남: string[] = []
  for (const a of index) {
    const f = path.join(ROOT, 'public/artists', `${a.slug}.json`)
    if (!existsSync(f)) {
      어긋남.push(`${a.slug} 파일 없음`)
      continue
    }
    const d = JSON.parse(readFileSync(f, 'utf-8')) as { cards?: unknown[]; count?: number }
    const 실제 = d.cards?.length ?? 0
    // 목록에 적힌 수는 "전체 카드 수"이고 파일에는 그림이 있는 것만 담길 수 있다.
    // ⚠️ 목록의 count와 파일의 count는 **같은 값을 복사한 것**이라 늘 일치한다.
    //    그것만 견주면 "1,109종"이라 적어 놓고 500장만 담긴 것을 못 잡는다
    //    (실제로 5명 3,275장이 이렇게 새고 있었다 — 2026-08-06).
    //    화면이 보여줄 수 있는 건 **담긴 카드**뿐이니, 적힌 수와 담긴 수를 견준다.
    const 적힌 = a.count ?? a.c ?? d.count
    if (적힌 !== undefined && 적힌 !== 실제)
      어긋남.push(`${a.slug.padEnd(24)} 적힌 ${적힌} · 담긴 ${실제}`)
  }
  console.log(`\n[작가별 목록] 작가 ${index.length}명`)
  줄('목록과 파일의 수가 다름', 어긋남, index.length)
}
console.log('')
