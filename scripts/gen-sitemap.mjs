// 사이트맵을 만든다. 검색엔진이 들어올 문을 주소마다 하나씩 열어 준다.
// 서버(server/index.ts)가 각 주소에서 제목·본문을 글자로 미리 내보내므로, 크롤러가
// 빈 페이지를 보지 않는다.
//
//   /                    홈
//   /centering           센터링 측정 도구
//   /sets /artists       카테고리 대문(낱개 페이지를 묶어 주는 자리)
//   /packsim /community  카테고리 대문
//   /series/<슬러그>     시리즈별 세트 목록
//   /set/<슬러그>        세트별 카드 목록·힛카드
//   /artist/<슬러그>     일러스트레이터별 카드
//
// ⚠️ 시리즈 슬러그 규칙은 **src/lib/setNameKo.ts에서 가져다 쓴다.** 예전엔 여기에
//    같은 규칙을 베껴 두고 "같아야 한다"고 적어 뒀는데, 그렇게 두면 언젠가 한쪽만
//    고쳐져 사이트맵의 주소가 404가 된다. 2026-08-07에 같은 꼴(규칙이 두 벌)로
//    실제 사고가 여섯 건 나와서, 베끼지 않고 가져오도록 바꿨다.
//
// 실행: node scripts/gen-sitemap.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { serieSlug } from '../src/lib/setNameKo.ts'

const today = new Date().toISOString().slice(0, 10)
const url = (loc, priority, changefreq = 'weekly') =>
  `  <url>\n    <loc>https://pokegre.com${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`


const idx = JSON.parse(await readFile('public/sets/index.json', 'utf8'))

// 세트 — 최신이 더 자주 검색되므로 우선순위를 높인다.
const sets = idx
  .slice()
  .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')))
  .map((s, i) => url(`/set/${s.slug}`, i < 40 ? '0.8' : i < 120 ? '0.6' : '0.4'))

// 시리즈 — 세트를 묶는 상위 페이지라 세트보다 우선순위를 높게 둔다.
const series = [...new Set(idx.map((s) => s.serie).filter(Boolean))].map((serie) =>
  url(`/series/${serieSlug(serie)}`, '0.7', 'monthly'),
)

// 일러스트레이터 — 카드가 많은 사람부터.
let artists = []
try {
  const list = JSON.parse(await readFile('public/artists/index.json', 'utf8'))
  artists = list
    .slice()
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((a, i) => url(`/artist/${a.slug}`, i < 60 ? '0.6' : '0.4', 'monthly'))
} catch {
  /* 작가 데이터가 없으면 건너뛴다 */
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://pokegre.com/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${url('/centering', '0.7', 'monthly')}
${url('/sets', '0.9', 'weekly')}
${url('/artists', '0.9', 'weekly')}
${url('/pokedex', '0.9', 'weekly')}
${url('/packsim', '0.7', 'daily')}
${url('/community', '0.6', 'daily')}
${series.join('\n')}
${sets.join('\n')}
${artists.join('\n')}
</urlset>
`
await writeFile('public/sitemap.xml', xml)
// ⚠️ 고정 주소 수를 손으로 적어 두면 주소를 하나 더할 때마다 어긋난다. 실제로
//    /pokedex를 넣은 뒤 로그가 798이라고 했는데 파일에는 799개가 있었다
//    (점검 중 발견 2026-08-06). 만들어진 글자에서 직접 센다.
const 고정 = (xml.match(/<loc>/g) ?? []).length - series.length - sets.length - artists.length
console.log(`사이트맵 ${(xml.match(/<loc>/g) ?? []).length}개 주소`)
console.log(`  홈·도구·대문 ${고정} · 시리즈 ${series.length} · 세트 ${sets.length} · 작가 ${artists.length}`)
