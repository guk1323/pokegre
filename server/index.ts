import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { mountApi } from './api.ts'

// 프로덕션 진입점. 개발은 vite가 API(server/api.ts)와 프론트를 함께 띄우지만,
// 배포에서는 이 프로세스가 둘 다 맡는다 — 같은 mountApi를 부르므로 라우팅은 개발과
// 동일하고, 빌드된 정적 파일은 여기서 직접 서빙한다.
const app = express()
// gzip 압축. 작가 JSON(50KB대)·index.json·번들이 5~8배 줄어 로딩이 크게 빨라진다.
// 모든 라우트보다 먼저 둬야 정적 파일·API 응답까지 압축된다.
app.use(compression())
const PORT = Number(process.env.PORT ?? 3000)
const DIST = path.resolve(process.cwd(), 'dist')

// API가 정적 파일보다 먼저다. 순서가 뒤집히면 SPA 폴백이 /api/* 요청까지 삼켜서
// index.html을 돌려주고, 클라이언트는 JSON 대신 HTML을 받아 파싱 에러를 낸다.
mountApi(app, process.env)

// ── 카드 공유 링크(/c/<id>) ───────────────────────────────────────────────────
// 카드 상세 링크를 카톡·카페에 붙이면 뜨는 미리보기(제목·시세·이미지)를 서버가 주입한다.
// 클라이언트만 있는 SPA는 크롤러가 빈 껍데기만 봐서 미리보기가 안 뜬다. 여기서 그 카드의
// 대표 이미지·최저가를 스니커덩크에서 받아 index.html의 OG 태그에 심어 돌려준다.
// 사람에게는 이 HTML이 곧 SPA를 띄우고, 클라이언트가 /c/<id>를 읽어 그 카드를 검색해 준다.
const TEMPLATE = readFileSync(path.join(DIST, 'index.html'), 'utf-8')

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const yen = new Intl.NumberFormat('ja-JP')

// 크롤러·링크 언펄러가 같은 카드를 자주 때리므로 짧게 캐시한다(스니커덩크 호출 아끼기).
const shareCache = new Map<string, { at: number; data: { image: string; price: number } | null }>()
const SHARE_TTL = 10 * 60 * 1000

async function fetchShareCard(id: string): Promise<{ image: string; price: number } | null> {
  const hit = shareCache.get(id)
  if (hit && Date.now() - hit.at < SHARE_TTL) return hit.data
  let data: { image: string; price: number } | null = null
  try {
    const r = await fetch(`https://snkrdunk.com/v1/apparels/${id}`, {
      signal: AbortSignal.timeout(2500),
      headers: { accept: 'application/json' },
    })
    if (r.ok) {
      const j = (await r.json()) as { primaryMedia?: { imageUrl?: string }; usedMinPrice?: number; minPrice?: number }
      const image = j.primaryMedia?.imageUrl ?? ''
      const price = j.usedMinPrice || j.minPrice || 0
      if (image) data = { image, price }
    }
  } catch {
    // 실패하면 이름만으로 미리보기(이미지·시세 없이)
  }
  shareCache.set(id, { at: Date.now(), data })
  return data
}

function buildCardHtml(id: string, name: string | null, card: { image: string; price: number } | null): string {
  const title = name ? `${name} 시세 | pokegre` : '포켓몬 카드 시세 | pokegre'
  const desc =
    card && card.price > 0
      ? `스니커덩크 최저가 ¥${yen.format(card.price)} · 일본판·북미판 시세를 pokegre에서 확인`
      : '스니커덩크 일본 실거래가와 이베이 PSA 등급별 낙찰가를 한국어로 한눈에.'
  const url = `https://pokegre.com/c/${id}`

  let html = TEMPLATE
  html = html.replace('<title>포켓몬 카드 시세 · 센터링 · 일러스트 | pokegre — 일본판·북미판</title>', `<title>${esc(title)}</title>`)
  // og:title·twitter:title은 같은 content라 한 번에 바꾼다.
  html = html.split('content="포켓몬 카드 시세 | pokegre"').join(`content="${esc(title)}"`)
  html = html.replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${esc(desc)}$2`)
  html = html.replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, `$1${esc(desc)}$2`)
  // og:url·canonical을 이 카드 주소로.
  html = html.split('content="https://pokegre.com/"').join(`content="${esc(url)}"`)
  html = html.split('href="https://pokegre.com/"').join(`href="${esc(url)}"`)
  // 카드 이미지가 있으면 큰 미리보기로 띄운다.
  if (card?.image) {
    const imgTags = `\n    <meta property="og:image" content="${esc(card.image)}" />\n    <meta name="twitter:image" content="${esc(card.image)}" />`
    html = html.replace('<meta property="og:locale" content="ko_KR" />', `<meta property="og:locale" content="ko_KR" />${imgTags}`)
    html = html.replace('content="summary"', 'content="summary_large_image"')
  }
  return html
}

app.get('/c/:id', async (req, res) => {
  try {
    const id = req.params.id
    if (!/^\d+$/.test(id)) {
      res.sendFile(path.join(DIST, 'index.html'))
      return
    }
    const name = typeof req.query.n === 'string' ? req.query.n.slice(0, 120) : null
    const card = await fetchShareCard(id)
    res.set('content-type', 'text/html; charset=utf-8')
    res.send(buildCardHtml(id, name, card))
  } catch {
    res.sendFile(path.join(DIST, 'index.html'))
  }
})

app.use(express.static(DIST))

// SPA 폴백. 위에서 API도 정적 파일도 처리하지 못한 GET은 전부 index.html로 넘겨
// 클라이언트 라우팅이 이어받게 한다. express 5는 '*' 경로 문법이 바뀌어서
// app.get('*')가 예전처럼 동작하지 않으므로 미들웨어로 받는다.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  res.sendFile(path.join(DIST, 'index.html'))
})

// 0.0.0.0으로 열어야 한다. 기본값(localhost)으로 두면 컨테이너 바깥에서 접속이
// 안 돼 Fly/Railway의 헬스체크가 실패한다.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`pokegre listening on :${PORT}`)
})
