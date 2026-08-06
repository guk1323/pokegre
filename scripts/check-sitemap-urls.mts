// 사이트맵에 적힌 주소가 앱이 실제로 여는 주소와 같은지 본다.
//
// 왜: 시리즈 주소를 만드는 규칙이 두 곳에 **복사본**으로 있다 — 앱은
// src/lib/setNameKo.ts의 serieSlug, 사이트맵은 scripts/gen-sitemap.mjs 안의 같은 코드.
// 한쪽만 고치면 사이트맵에 적힌 주소가 404가 되는데, 검색엔진이 먼저 알게 된다.
//
// ⚠️ 규칙을 여기 또 베끼면 복사본이 셋이 된다. 그래서 **산출물끼리** 견준다 —
//    사이트맵 파일에 실제로 적힌 주소 vs 앱 함수로 만든 주소.
//
// 쓰는 법: npx tsx scripts/check-sitemap-urls.mts
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { serieSlug } from '../src/lib/setNameKo.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const 사이트맵경로 = path.join(ROOT, 'public/sitemap.xml')
if (!existsSync(사이트맵경로)) {
  console.log('\n  사이트맵이 없다. node scripts/gen-sitemap.mjs 로 먼저 만든다.\n')
  process.exit(0)
}

const xml = readFileSync(사이트맵경로, 'utf-8')
const 적힌주소 = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ''))
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  serie?: string
}[]

// 앱 기준으로 있어야 하는 주소들.
const 세트주소 = new Set(index.map((s) => `/set/${s.slug}`))
const 시리즈주소 = new Set(index.filter((s) => s.serie).map((s) => `/series/${serieSlug(s.serie!)}`))

const 적힌세트 = new Set(적힌주소.filter((u) => u.startsWith('/set/')))
const 적힌시리즈 = new Set(적힌주소.filter((u) => u.startsWith('/series/')))

const 줄 = (제목: string, 목록: string[]) => {
  console.log(`  ${목록.length ? '✗' : '✓'} ${제목.padEnd(34)} ${목록.length}개`)
  for (const e of 목록.slice(0, 8)) console.log(`      ${e}`)
}

console.log(`\n  사이트맵 주소 ${적힌주소.length}개 (세트 ${적힌세트.size} · 시리즈 ${적힌시리즈.size})\n`)
줄(
  '사이트맵에만 있음(앱은 못 여는 주소)',
  [...적힌시리즈].filter((u) => !시리즈주소.has(u)).concat([...적힌세트].filter((u) => !세트주소.has(u))),
)
줄(
  '앱에만 있음(사이트맵에서 빠짐)',
  [...시리즈주소].filter((u) => !적힌시리즈.has(u)).concat([...세트주소].filter((u) => !적힌세트.has(u))),
)

// 작가 주소도 같은 방식으로.
const artists = JSON.parse(readFileSync(path.join(ROOT, 'public/artists/index.json'), 'utf-8')) as {
  slug: string
}[]
const 작가주소 = new Set(artists.map((a) => `/artist/${a.slug}`))
const 적힌작가 = new Set(적힌주소.filter((u) => u.startsWith('/artist/')))
줄('작가: 사이트맵에만 있음', [...적힌작가].filter((u) => !작가주소.has(u)))
줄('작가: 사이트맵에서 빠짐', [...작가주소].filter((u) => !적힌작가.has(u)))
console.log('')
