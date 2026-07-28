import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import {
  backupDataFiles,
  isAdminRequest,
  lookupCardName,
  maintenanceOn,
  mountApi,
  startCardNameStore,
} from './api.ts'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

// 프로덕션 진입점. 개발은 vite가 API(server/api.ts)와 프론트를 함께 띄우지만,
// 배포에서는 이 프로세스가 둘 다 맡는다 — 같은 mountApi를 부르므로 라우팅은 개발과
// 동일하고, 빌드된 정적 파일은 여기서 직접 서빙한다.
const app = express()
// gzip 압축. 작가 JSON(50KB대)·index.json·번들이 5~8배 줄어 로딩이 크게 빨라진다.
// 모든 라우트보다 먼저 둬야 정적 파일·API 응답까지 압축된다.
app.use(compression())

// 보안 헤더. 지금까지 하나도 안 붙이고 있었다. 로그인(카카오·네이버)이 있는 사이트라
// 남의 페이지가 우리를 iframe에 넣어 클릭을 가로챌 수 있었다.
// 세션 쿠키는 이미 HttpOnly·SameSite=Lax라 CSRF 쪽은 막혀 있다.
app.use((_req, res, next) => {
  // 어떤 사이트도 우리를 iframe에 넣지 못하게 한다(클릭재킹).
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
  // 브라우저가 파일 내용을 보고 타입을 멋대로 바꾸지 않게 한다.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // 이베이·스니커덩크로 나갈 때 우리 주소 전체(검색어가 들어 있다)를 넘기지 않는다.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // https로만 접속하게 한다. pokegre.com은 http를 안 쓰므로 안전하다.
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  next()
})

const PORT = Number(process.env.PORT ?? 3000)
const DIST = path.resolve(process.cwd(), 'dist')
const DATA_DIR = process.env.POKEGRE_DATA_DIR ?? path.resolve(process.cwd(), 'data')
const accessData = () => access(DATA_DIR)

// ── 점검 모드 ────────────────────────────────────────────────────────────────
// /data/maintenance.on 파일이 있으면 일반 방문자에겐 점검 안내만 보여준다. 운영자
// 세션은 그대로 통과해 전체 기능을 쓸 수 있다(완성 전 기능을 이용자 시점으로 시험할 때
// 씀). 로그인 경로는 열어 둔다 — 막으면 운영자가 로그아웃된 상태에서 못 들어온다.
const MAINT_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>점검 중 | pokegre</title>
<style>body{margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;
font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;background:#111;color:#eee;text-align:center}
.b{padding:2rem}h1{font-size:1.4rem}p{color:#aaa;font-size:.95rem;line-height:1.6}
a{color:#666;font-size:.8rem;text-decoration:none}</style></head><body><div class="b">
<h1>서비스 점검 중입니다</h1><p>안녕하세요, pokegre 운영자입니다.<br>
더 나은 서비스를 위해 잠시 점검하고 있습니다.<br>최대한 빠르게 마치겠습니다. 조금만 기다려 주세요!</p>
<p><a href="/api/local/auth/kakao">운영자 로그인</a></p></div></body></html>`

// 건강 검사 통로. Fly가 30초마다 두드려서 응답이 없으면 기계를 다시 세운다.
// ⚠️ 점검 모드보다 반드시 앞에 둬야 한다 — 점검 중에는 모든 경로가 503이라, 이 통로가
// 뒤에 있으면 Fly가 "죽었다"고 보고 멀쩡한 기계를 계속 재시작한다.
// 데이터 폴더까지 확인한다. 볼륨이 안 붙으면 서버는 떠 있어도 아무것도 저장 못 한다.
app.get('/healthz', async (_req, res) => {
  try {
    await accessData()
    res.status(200).type('text/plain').send('ok')
  } catch {
    res.status(503).type('text/plain').send('data volume unavailable')
  }
})

app.use(async (req, res, next) => {
  if (!(await maintenanceOn())) return next()
  // 로그인·세션 확인 경로는 통과(운영자가 들어올 문). 뽑기 API도 이 아래라 함께 열리지만,
  // 점검 중엔 일반 방문자가 화면 자체를 못 열어 실질적으로 접근할 수 없다.
  if (req.path.startsWith('/api/local/auth')) return next()
  if (await isAdminRequest(req)) return next()
  res.setHeader('Cache-Control', 'no-store')
  if (req.path.startsWith('/api/')) {
    res.status(503).json({ error: 'maintenance' })
    return
  }
  res.status(503).type('html').send(MAINT_HTML)
})

// API가 정적 파일보다 먼저다. 순서가 뒤집히면 SPA 폴백이 /api/* 요청까지 삼켜서
// index.html을 돌려주고, 클라이언트는 JSON 대신 HTML을 받아 파싱 에러를 낸다.
mountApi(app, process.env)

// 공유 링크 미리보기에 쓸 카드 이름을 파일에서 불러오고, 주기적으로 저장한다.
startCardNameStore()

// 데이터 백업: 기동할 때 한 번, 그 뒤로는 하루에 한 번. 배포마다 기계가 새로 뜨므로
// 기동 시점 백업만으로도 "배포 직전 상태"가 늘 남는다.
void backupDataFiles()
setInterval(() => void backupDataFiles(), 24 * 60 * 60 * 1000).unref()

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
const shareCache = new Map<string, { at: number; data: ShareCard | null }>()
const SHARE_TTL = 10 * 60 * 1000

type ShareCard = { image: string; price: number; name: string }

async function fetchShareCard(id: string): Promise<ShareCard | null> {
  const hit = shareCache.get(id)
  if (hit && Date.now() - hit.at < SHARE_TTL) return hit.data
  let data: ShareCard | null = null
  try {
    const r = await fetch(`https://snkrdunk.com/v1/apparels/${id}`, {
      signal: AbortSignal.timeout(2500),
      headers: { accept: 'application/json' },
    })
    if (r.ok) {
      const j = (await r.json()) as {
        primaryMedia?: { imageUrl?: string }
        usedMinPrice?: number
        minPrice?: number
        name?: string
      }
      const image = j.primaryMedia?.imageUrl ?? ''
      const price = j.usedMinPrice || j.minPrice || 0
      // 스니커덩크 이름은 일본어라 화면과 같은 방식으로 한글로 바꾼다. 예전엔 이걸 서버에서
      // 못 해서 링크에 ?n=<한글 이름>을 붙여 보냈는데, 한글이 %EB%A6%AC…로 늘어나
      // 주소가 세 배로 길어졌다(91자 → 28자).
      const name = j.name ? shareName(koreanizeEnglishCardName(koreanizeTitle(j.name))) : ''
      if (image) data = { image, price, name }
    }
  } catch {
    // 실패하면 이름만으로 미리보기(이미지·시세 없이)
  }
  shareCache.set(id, { at: Date.now(), data })
  return data
}

// 템플릿의 meta 태그를 "이름"으로 찾아 바꾼다. 예전엔 문구를 통째로 적어 두고 문자열
// 일치로 바꿨는데, index.html의 문구를 손보는 순간 조용히 안 먹었다 — 2026-07-27에
// 실제로 그렇게 깨져서 공유 링크에 카드 이름이 안 나왔다.
function setMeta(html: string, key: string, value: string): string {
  const attr = key.startsWith('og:') ? 'property' : 'name'
  // content가 여러 줄로 쪼개져 있어도 잡히게 [\s\S]를 쓴다.
  const a = new RegExp(`(<meta[\\s\\S]*?${attr}="${key}"[\\s\\S]*?content=")[^"]*(")`)
  if (a.test(html)) return html.replace(a, `$1${value}$2`)
  // 속성 순서가 반대(content가 먼저)인 경우.
  const b = new RegExp(`(<meta[\\s\\S]*?content=")[^"]*("[\\s\\S]*?${attr}="${key}")`)
  return html.replace(b, `$1${value}$2`)
}

// sharePath는 "/c/123"·"/e/456" 같은 공유 주소. 모듈 위쪽의 node:path와 헷갈리지 않게
// 이름을 따로 뒀다.
// 미리보기 제목에만 쓰므로 군더더기를 뗀다. 스니커덩크 이름에는 세트·번호가 대괄호로,
// 팩 이름이 괄호로 붙어 있다("리자드 AR[SV2a 169/165](확장팩「…」)").
function shareName(title: string): string {
  return title
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .trim()
    .slice(0, 40)
}

function buildCardHtml(
  sharePath: string,
  name: string | null,
  card: { image: string; price: number } | null,
): string {
  const title = name ? `${name} 시세 | pokegre` : '포켓몬 카드 시세 | pokegre'
  const desc =
    card && card.price > 0
      ? `스니커덩크 최저가 ¥${yen.format(card.price)} · 등급별 시세는 pokegre에서`
      : '일본판·북미판 시세를 한국어로 봅니다.'
  const url = `https://pokegre.com${sharePath}`

  let html = TEMPLATE
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, esc(title))
  for (const k of ['og:description', 'twitter:description', 'description']) html = setMeta(html, k, esc(desc))
  html = setMeta(html, 'og:url', esc(url))
  html = html.replace('href="https://pokegre.com/"', `href="${esc(url)}"`)

  // 카드 그림. 있던 og:image를 "바꿔야" 한다 — 예전엔 뒤에 하나 더 붙였는데 크롤러는
  // 보통 먼저 나온 걸 쓰므로 기본 그림이 이겨서 카드가 안 보였다.
  if (card?.image) {
    for (const k of ['og:image', 'twitter:image']) html = setMeta(html, k, esc(card.image))
    // 세로로 긴 카드라 1200x630을 그대로 두면 미리보기가 잘린다.
    html = html.replace(/\s*<meta property="og:image:(width|height)"[^>]*\/?>/g, '')
  }
  return html
}

// 이베이·TCGplayer 공유 링크. 카드 시세(PPT)는 호출 한도가 빡빡해서 그림과 가격은
// 미리보기에 넣지 않는다 — 크롤러가 링크를 두드릴 때마다 크레딧이 나간다.
// 다만 카드 이름은 링크(?n=)에 이미 들어 있으므로 제목에는 넣는다. 안 넣으면 카톡에
// "pokegre — 포켓몬 카드의 모든 것"만 떠서 무슨 카드를 보낸 건지 알 수 없다.
app.get(['/e/:id', '/t/:id'], (req, res) => {
  // 시세를 볼 때 주워 둔 이름이 있으면 그걸 쓴다(주소가 짧아진다). 없으면 링크에 실려 온
  // ?n=으로 넘어간다 — 서버가 다시 뜬 직후나 아무도 안 본 카드가 여기 해당한다.
  const id = String(req.params.id ?? '')
  const known = lookupCardName(id)
  const name = known
    ? shareName(koreanizeEnglishCardName(known))
    : typeof req.query.n === 'string'
      ? req.query.n.slice(0, 120)
      : null
  if (!name) {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(DIST, 'index.html'))
    return
  }
  res.set('content-type', 'text/html; charset=utf-8')
  res.send(buildCardHtml(req.path, name, null))
})

app.get('/c/:id', async (req, res) => {
  try {
    const id = req.params.id
    if (!/^\d+$/.test(id)) {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(DIST, 'index.html'))
      return
    }
    const card = await fetchShareCard(id)
    // 이름은 서버가 스스로 알아낸다. ?n=은 옛 링크를 위해 남겨 두고 예비로만 쓴다.
    const name = card?.name || (typeof req.query.n === 'string' ? req.query.n.slice(0, 120) : null)
    res.set('content-type', 'text/html; charset=utf-8')
    res.send(buildCardHtml(`/c/${id}`, name, card))
  } catch {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(DIST, 'index.html'))
  }
})

// 정적 파일 캐시 정책. 번들(assets/*)은 파일명에 해시가 있어 1년 캐시해도 안전하지만,
// index.html에 정책이 없으면 브라우저가 휴리스틱으로 옛 HTML을 들고 있어 배포한 새
// 기능이 "안 보이는" 문제가 생긴다(실제로 몇 번 겪음). HTML은 항상 재검증하게 한다.
app.use(
  express.static(DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
      else if (filePath.includes(`${path.sep}assets${path.sep}`))
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      else res.setHeader('Cache-Control', 'no-cache')
    },
  }),
)

// /api 아래에서 아무도 받지 못한 요청은 여기서 끝낸다. 아래 SPA 폴백까지 흘러가면
// JSON을 기다리는 쪽에 HTML이 돌아가서, 주소를 잘못 적은 것뿐인데 "JSON 파싱 실패"
// 같은 엉뚱한 오류로 보인다.
app.use('/api', (_req, res) => {
  res.status(404).set('content-type', 'application/json').send(JSON.stringify({ error: 'not found' }))
})

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
