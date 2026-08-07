// 카드 **사진 주소에 적힌 번호**가 우리 카드 번호와 맞는지 전수로 본다.
//
// 왜: 목록에서 사진을 보고 고르는데 그게 딴 카드 사진이면, 눌러서 나온 시세도 딴 카드다.
// 사진 이름으로 견주는 방법(check-photo-vs-name)은 영문 이름이 든 869장만 볼 수 있는데,
// 번호는 거의 모든 주소에 들어 있어 훨씬 넓게 볼 수 있다(2026-08-07).
//
// 주소 꼴마다 번호가 있는 자리가 다르다:
//   assets.tcgdex.net/ja/SV/SV8/001            → 마지막 조각
//   limitless…/tpc/M2a/M2a_1_R_JP_SM.png       → 파일 이름의 두 번째 조각
//   den-cards.pokellector.com/…/Oddish.NEO1.1.38520.thumb.png → 세 번째 조각
//   images.pokemontcg.io/sv3pt5/173.png        → 파일 이름
// tcgplayer-cdn(상품번호)·snkrdunk(무작위 이름)은 번호가 없어 건너뛴다.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
// ⚠️ 앞자리 0은 글자 뒤에도 붙는다(H01 ↔ H1, BW04 ↔ BW4). 맨 앞만 떼면 그 20장을
//    "사진이 어긋난다"고 잘못 센다(2026-08-07에 그렇게 나왔다).
const 자름 = (n: string) => {
  const t = String(n).trim().toUpperCase()
  const m = t.match(/^([A-Z-]*)0*(\d+)([A-Z]?)$/)
  return m ? `${m[1]}${Number(m[2])}${m[3]}` : t
}

/** 주소에서 카드 번호를 뽑는다. 못 뽑으면 null(그 카드는 건너뛴다). */
function 주소번호(url: string): string | null {
  const u = decodeURIComponent(String(url ?? ''))
  if (!u) return null
  let m: RegExpMatchArray | null
  if (/assets\.tcgdex\.net/.test(u)) {
    m = u.match(/\/([^/]+?)(?:\/(?:high|low)\.(?:webp|png|jpg))?$/i)
    return m ? m[1] : null
  }
  if (/limitlesstcg/.test(u)) {
    m = u.match(/\/[^/]*?_(\d+[a-z]?)_/i)
    return m ? m[1] : null
  }
  if (/den-cards\.pokellector\.com/.test(u)) {
    // 이름.세트.번호.일련번호.thumb.png — 뒤에서 세 번째가 번호다
    m = u.match(/\/[^/]*?\.([A-Za-z0-9-]+)\.([A-Za-z0-9]+)\.\d+\.thumb/)
    return m ? m[2] : null
  }
  if (/images\.pokemontcg\.io/.test(u)) {
    m = u.match(/\/([A-Za-z0-9]+)\.(?:png|jpg|webp)$/i)
    return m ? m[1] : null
  }
  return null // tcgplayer-cdn · snkrdunk · artofpkm 등은 번호가 없다
}

let 봄 = 0, 맞음 = 0
const 어긋남: string[] = []
const 세트별 = new Map<string, number>()
for (const s of sidx) {
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  for (const c of d.cards ?? []) {
    const n = 주소번호(String(c.img ?? ''))
    if (n === null) continue
    봄++
    if (자름(n) === 자름(String(c.n))) { 맞음++; continue }
    세트별.set(s.slug, (세트별.get(s.slug) ?? 0) + 1)
    if (어긋남.length < 40) 어긋남.push(`${s.slug.padEnd(13)} 우리 ${String(c.n).padStart(5)} "${c.name}" ↔ 사진 주소는 ${n}`)
  }
}
const 틀림 = 봄 - 맞음
console.log(`\n  번호를 견줄 수 있는 카드 ${봄.toLocaleString()}장`)
console.log(`  ✓ 사진 번호가 맞음  ${맞음.toLocaleString()}장`)
console.log(`  ✗ 어긋남           ${틀림.toLocaleString()}장 (${((틀림/봄)*100).toFixed(2)}%)\n`)
어긋남.forEach((l) => console.log(`      ${l}`))
if (세트별.size) {
  console.log('\n  [세트별 많은 순]')
  ;[...세트별.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`      ${k.padEnd(14)} ${v}장`))
}
console.log('')
