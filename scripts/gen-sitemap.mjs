// 사이트맵을 만든다. 세트마다 주소를 하나씩 넣어 "○○ 힛카드"로 검색됐을 때
// 우리 페이지가 걸리게 한다(서버가 /set/<슬러그>에서 카드 이름·값을 글자로 내보낸다).
import { readFile, writeFile } from 'node:fs/promises'

const idx = JSON.parse(await readFile('public/sets/index.json', 'utf8'))
// 최신 세트가 더 자주 검색되므로 우선순위를 높인다.
const today = new Date().toISOString().slice(0, 10)
const rows = idx
  .slice()
  .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')))
  .map((s, i) => {
    const p = i < 40 ? '0.8' : i < 120 ? '0.6' : '0.4'
    return `  <url>\n    <loc>https://pokegre.com/set/${s.slug}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${p}</priority>\n  </url>`
  })

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://pokegre.com/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${rows.join('\n')}
</urlset>
`
await writeFile('public/sitemap.xml', xml)
console.log(`사이트맵 ${rows.length + 1}개 주소`)
