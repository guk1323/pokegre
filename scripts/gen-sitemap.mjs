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
// ⚠️ **세트가 하나뿐인 시리즈는 부르지 않는다.** 묶을 게 없어서 본문이 60~71자다
//    (VS·Gym·Web·전설의 부름·레전더리 컬렉션 다섯). 애드센스가 「가치가 별로 없는
//    콘텐츠」를 사유로 들었는데(2026-08-30) 이런 화면이 딱 그것이다. 페이지는 그대로
//    두고 — 세트 페이지에서 눌러 갈 수 있다 — 구글에 목록으로 내밀지만 않는다.
const 시리즈세트수 = new Map()
for (const s of idx) if (s.serie) 시리즈세트수.set(s.serie, (시리즈세트수.get(s.serie) ?? 0) + 1)
const 얇은시리즈 = []
const series = [...new Set(idx.map((s) => s.serie).filter(Boolean))]
  .filter((serie) => {
    if (시리즈세트수.get(serie) >= 2) return true
    얇은시리즈.push(serie)
    return false
  })
  .map((serie) => url(`/series/${serieSlug(serie)}`, '0.7', 'monthly'))

// ── 카드 한 장 주소(/card/<번호>) ──────────────────────────────────────────
//
// ⚠️⚠️ **애드센스가 「가치가 별로 없는 콘텐츠」로 떨어뜨렸다**(2026-08-30). 재 보니
//    우리가 가진 카드는 62,499장인데 구글에 알려 준 주소는 1,125개였고 그중 카드
//    한 장짜리는 **0개**였다. 구글이 본 것은 300자짜리 목록 페이지뿐이었다.
//
// ⚠️ **한꺼번에 6만 장을 넣지 않는다.** 얇은 페이지를 무더기로 밀어 넣으면 같은 사유로
//    또 떨어진다. 최신 세트 몇 개로 먼저 해 보고, 구글이 실제로 받아 가는 것을 확인한
//    뒤에 늘린다. 늘릴 때는 아래 숫자만 키우면 된다.
const 시범세트수 = 6

// ⚠️ **아직 안 나온 세트는 뺀다.** 애드센스 사유에 「아직 준비 중인 화면」이 있다.
//    30주년(en-ME, 2026-09-16)이 딱 그것이다 — 카드도 값도 아직 없다.
const 오늘 = today
const 시범 = idx
  .filter((s) => s.releaseDate && s.releaseDate <= 오늘)
  .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))
  .slice(0, 시범세트수)

let cards = []
let 뺀카드 = 0
for (const s of 시범) {
  let d
  try {
    d = JSON.parse(await readFile(`public/sets/${s.slug}.json`, 'utf8'))
  } catch {
    continue
  }
  for (const c of d.cards ?? []) {
    // ⚠️ **셋 다 있어야 넣는다.** 저쪽 번호가 없으면 주소가 안 만들어지고(404),
    //    그림이나 이름이 없으면 그게 바로 「내용 없는 화면」이다 — 애드센스가 든 사유다.
    //    실제로 en-B2·en-B2a는 저쪽 번호가 한 장도 없어 통째로 빠진다.
    if (!c.tcg || !c.img || !c.name) {
      뺀카드 += 1
      continue
    }
    cards.push(url(`/card/${c.tcg}`, '0.5', 'weekly'))
  }
}

// 일러스트레이터 — 카드가 많은 사람부터.
let artists = []
let 얇은작가 = []
try {
  const list = JSON.parse(await readFile('public/artists/index.json', 'utf8'))
  // ⚠️ **소개도 활동 시기도 없는 작가는 부르지 않는다.** 그 11명은 페이지에 적을 게
  //    이름과 카드 한두 장뿐이라 본문이 87~94자다 — 카드가 1장인 작가라도 소개가
  //    있으면 120~185자가 나온다. 갈리는 것은 카드 수가 아니라 **적을 말이 있느냐**다
  //    (2026-08-31 실측). 얇은 화면을 목록에 넣으면 애드센스에 또 걸린다.
  얇은작가 = list.filter((a) => !a.note && !a.era).map((a) => a.slug)
  artists = list
    .filter((a) => a.note || a.era)
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
${cards.join('\n')}
</urlset>
`
await writeFile('public/sitemap.xml', xml)
// ⚠️ 고정 주소 수를 손으로 적어 두면 주소를 하나 더할 때마다 어긋난다. 실제로
//    /pokedex를 넣은 뒤 로그가 798이라고 했는데 파일에는 799개가 있었다
//    (점검 중 발견 2026-08-06). 만들어진 글자에서 직접 센다.
const 고정 =
  (xml.match(/<loc>/g) ?? []).length - series.length - sets.length - artists.length - cards.length
console.log(`사이트맵 ${(xml.match(/<loc>/g) ?? []).length}개 주소`)
console.log(`  홈·도구·대문 ${고정} · 시리즈 ${series.length} · 세트 ${sets.length} · 작가 ${artists.length}`)
console.log(`  카드 ${cards.length} (시범 ${시범.length}세트: ${시범.map((s) => s.slug).join(', ')})`)
if (뺀카드) console.log(`  카드 ${뺀카드}장은 뺐다 — 저쪽 번호·그림·이름 중 빠진 게 있다`)
if (얇은시리즈.length) console.log(`  시리즈 ${얇은시리즈.length}개는 뺐다(세트가 1개뿐): ${얇은시리즈.join(', ')}`)
if (얇은작가.length) console.log(`  작가 ${얇은작가.length}명은 뺐다(소개·활동시기 없음): ${얇은작가.join(', ')}`)
