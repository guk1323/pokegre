import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import {
  backupDataFiles,
  isAdminRequest,
  lookupCardName,
  fetchCardNameForShare,
  maintenanceOn,
  mountApi,
  startCardNameStore,
  startCoverWarmup,
  topPricedCards,
  topPricedBasis,
} from './api.ts'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import { koSetName, serieSlug } from '../src/lib/setNameKo.ts'
import { livePacks } from '../src/lib/packSets.ts'

// 화면(cardCatalog)과 같은 규칙으로 이름을 한글로 만든다. 그 파일은 브라우저 전용이라
// 여기서 가져다 쓰지 않고 같은 내용만 옮겨 둔다.
// 일본판인데 이름이 영어인 세트가 있다(「Pokémon GO」). 한글이 하나도 안 남으면
// 영어 세트명 사전으로 한 번 더 시도한다. 규칙은 src/lib/cardCatalog.ts의 koSet과 같다.
const koSet = (ed: 'ja' | 'en', name: string) => {
  if (ed !== 'ja') return koSetName(name)
  const ko = koreanizeTitle(name)
  return /[가-힣]/.test(ko) ? ko : koSetName(ko)
}
const koName = (ed: 'ja' | 'en', name: string) => {
  if (ed !== 'ja') return koreanizeEnglishCardName(name)
  if (/[ぁ-んァ-ヶ一-龯]/.test(name)) return koreanizeEnglishCardName(koreanizeTitle(name))
  const en = koreanizeEnglishCardName(name)
  if (/[가-힣]/.test(en) && !/[A-Za-z]{3,}/.test(en)) return en
  return koreanizeEnglishCardName(koreanizeTitle(name))
}

// 한글 이름 끝에 받침이 있는지 보고 조사를 고른다. 작가 388명 중 305명이 받침 없는
// 이름이라("미츠히로 아리타") "이(가)"를 그대로 쓰면 대부분 어색하게 읽힌다.
// 한글이 아닌 이름(5ban Graphics 등 69명)은 "가"를 쓴다 — 영문은 대개 모음으로 읽힌다.
const subjectParticle = (name: string): string => {
  const last = name.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return '가'
  return (code - 0xac00) % 28 === 0 ? '가' : '이'
}

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

// 세트 목록 표지를 미리 받아 둔다. 배포마다 기계가 새로 떠서 이미지 캐시가 비는데,
// 그 상태로 방문자가 세트 목록을 열면 표지가 한참 비어 보인다. 천천히 도므로
// 방문자 요청과 부딪히지 않는다.
startCoverWarmup()

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

// 서버가 만들어 보내는 HTML은 전부 이걸 쓴다.
//
// ⚠️ 예전엔 10~60분(`public, max-age=600/3600`) 캐시였는데, 이러면 배포 뒤에 사고가 난다.
//    HTML 안에는 `assets/index-<해시>.js` 주소가 박혀 있고 배포하면 그 파일이 없어진다.
//    /set/... 같은 주소를 보고 갔던 사람이 그 시간 안에 다시 들어오면, 브라우저가 옛 HTML을
//    캐시에서 꺼내 없어진 파일을 찾다가 흰 화면을 본다(2026-08-05 점검에서 발견).
//    아래 express.static도 .html은 같은 이유로 no-cache다 — 서버가 만든 HTML만 빠져 있었다.
//    no-cache는 "안 쓴다"가 아니라 "쓰기 전에 물어본다"라서, 안 바뀌었으면 304로 끝난다.
const HTML_CACHE = 'no-cache'

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
      // 스니커덩크는 스니커즈·명품도 파는 곳이라, 아무 번호나 넣으면 그 상품이 나온다.
      // 상세 응답에는 브랜드 칸이 없어서 이름 형식으로 가른다 — 포켓몬 카드는 늘
      // "이름 [세트 번호](팩 이름)" 꼴이다(검색 결과 24건 전부 확인).
      // 이게 없으면 남이 아무 번호로 링크를 만들어 "CELINE 가방 시세 | pokegre"라는
      // 미리보기를 카톡에 퍼뜨릴 수 있고, 검색엔진도 그 페이지를 우리 것으로 색인한다.
      const looksLikeCard = /\[[^\]]+\]/.test(j.name ?? '')
      if (looksLikeCard) {
        const image = j.primaryMedia?.imageUrl ?? ''
        const price = j.usedMinPrice || j.minPrice || 0
        // 스니커덩크 이름은 일본어라 화면과 같은 방식으로 한글로 바꾼다. 예전엔 이걸 서버에서
        // 못 해서 링크에 ?n=<한글 이름>을 붙여 보냈는데, 한글이 %EB%A6%AC…로 늘어나
        // 주소가 세 배로 길어졌다(91자 → 28자).
        const name = j.name ? shareName(koreanizeEnglishCardName(koreanizeTitle(j.name))) : ''
        if (image) data = { image, price, name }
      }
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
// ⚠️ **괄호를 다 떼면 안 된다.** 뗄 것과 남길 것이 섞여 있다.
//    뗄 것  — 스니커덩크가 붙이는 **팩 이름**: "리자드 AR[SV2a 169/165](확장팩「…」)"
//    남길 것 — **카드를 가르는 말**: "아보 (Delta Species)" · "이브이 (Master Ball Pattern)"
//               "움브레온 VMAX (Alternate Art Secret)" · "뮤츠 (Mirror Holofoil)"
//    다 떼고 있어서 "아보 (Delta Species)"가 그냥 "아보"가 됐다 — 전혀 다른 카드인데
//    제목과 공유 미리보기에서 구별이 안 된다. 저쪽 카드 58,215장 중 **6,499장**이
//    이런 이름이다(2026-08-07 실측).
//    ⚠️ 이 함수는 App.tsx의 shareTitle과 **글자까지 같아야 한다** — 다르면 새로고침
//       전후로 탭 이름이 바뀐다.
const 뜻있는괄호 =
  /holo|reverse|mirror|delta|cosmos|master ball|pok[ée]? ?ball|shadowless|stamp|1st|full art|secret|prism|rainbow|pattern|jumbo|error|misprint|알?터네이트|델타|미러|리버스|마스터볼|몬스터볼/i
const 꼬리괄호떼기 = (s: string) =>
  s.replace(/\s*\(([^()]*)\)\s*$/, (전체, 안) => (뜻있는괄호.test(안) ? 전체 : ''))
function shareName(title: string): string {
  return 꼬리괄호떼기(title)
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

// 공유 미리보기에서 카드 이름을 물어볼 때만 쓴다. 값은 어디에도 찍지 않는다.
const pptKeyForShare = process.env.POKEMON_PRICE_TRACKER_API_KEY ?? ''

// 이베이·TCGplayer 공유 링크. 카드 시세(PPT)는 호출 한도가 빡빡해서 그림과 가격은
// 미리보기에 넣지 않는다 — 크롤러가 링크를 두드릴 때마다 크레딧이 나간다.
// 다만 카드 이름은 링크(?n=)에 이미 들어 있으므로 제목에는 넣는다. 안 넣으면 카톡에
// "pokegre — 포켓몬 카드의 모든 것"만 떠서 무슨 카드를 보낸 건지 알 수 없다.
app.get(['/e/:id', '/t/:id'], async (req, res) => {
  // 시세를 볼 때 주워 둔 이름이 있으면 그걸 쓴다(크레딧이 안 든다).
  // ⚠️ 없으면 예전엔 링크의 ?n=에 기댔고, 그것도 없으면 미리보기 없이 넘어갔다 —
  //    아무도 안 본 카드를 공유하면 카톡에 'pokegre — 포켓몬 카드의 모든 것'만 떴다.
  //    이제 번호로 그 한 장을 물어볼 수 있으므로(2026-08-07 확인) 받아 온다.
  //    크롤러가 두드릴 것을 생각해 하루 상한을 걸어 뒀고, 한 번 받은 이름은 남는다.
  const id = String(req.params.id ?? '')
  const known = lookupCardName(id) ?? (await fetchCardNameForShare(pptKeyForShare, id))
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
  res.set('Cache-Control', HTML_CACHE).send(buildCardHtml(req.path, name, null))
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
    res.set('Cache-Control', HTML_CACHE).send(buildCardHtml(`/c/${id}`, name, card))
  } catch {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(DIST, 'index.html'))
  }
})

// ── 세트별 힛카드 페이지(검색 노출용) ──────────────────────────────────────
// "초전브레이커 힛카드"로 검색해서 우리 사이트가 나오게 하는 자리다.
//
// 지금 세트 화면은 브라우저가 그린다. 그러면 크롤러가 처음 받는 HTML이 텅 비어 있어
// 무슨 내용인지 알 수 없다. 그래서 이 주소에서는 서버가 카드 이름과 값을 글자로 미리
// 넣어 보낸다. 사람이 눌러 들어오면 앱이 이어받아 평소 화면을 그린다
// (App.tsx가 /set/<슬러그>를 읽어 그 세트를 연다).
app.get('/set/:slug', async (req, res) => {
  const slug = String(req.params.slug ?? '')
  // +를 허용한다. 옛 일본판 세트 코드에 들어 있다(SM1+·sm2+ 등 5개).
  // 빼면 그 세트만 구글용 페이지가 안 나가고 홈으로 떨어진다(2026-08-01 실측).
  // /는 여전히 막으므로 다른 폴더로 새 나갈 수 없다.
  if (!/^[\w.+-]+$/.test(slug)) {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  let setName = ''
  let ed: 'ja' | 'en' = 'ja'
  let cards: { n: string; name: string }[] = []
  try {
    const raw = await readFile(path.join(DIST, 'sets', `${slug}.json`), 'utf-8')
    const d = JSON.parse(raw) as { ed?: 'ja' | 'en'; name?: string; cards?: { n: string; name: string }[] }
    ed = d.ed ?? 'ja'
    setName = koSet(ed, d.name ?? '')
    cards = d.cards ?? []
  } catch {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const hits = topPricedCards(slug, 8)
  const basis = topPricedBasis(slug)
  const byNum = new Map(cards.map((c) => [String(Number(c.n)), c]))
  const rows = hits
    .map((h) => ({ ...h, card: byNum.get(String(Number(h.n))) }))
    .filter((r) => r.card)
    .map((r) => ({ n: r.n, usd: r.usd, name: koName(ed, r.card!.name) }))

  const title = rows.length ? `${setName} 힛카드 시세 | pokegre` : `${setName} 카드 목록 | pokegre`
  const desc = rows.length
    ? `${setName}에서 값이 높은 카드 ${rows.length}장 — ${rows
        .slice(0, 3)
        .map((r) => r.name)
        .join(' · ')} 등. ${basis} 기준.`
    : `${setName} 수록 카드 ${cards.length}장을 한국어 이름으로 봅니다.`
  const url = `https://pokegre.com/set/${slug}`

  let html = TEMPLATE
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, esc(title))
  for (const k of ['og:description', 'twitter:description', 'description']) html = setMeta(html, k, esc(desc))
  html = setMeta(html, 'og:url', esc(url))
  html = html.replace('href="https://pokegre.com/"', `href="${esc(url)}"`)

  // 크롤러가 읽을 본문. 앱이 뜨면 App.tsx가 이 조각을 지운다.
  const list = rows
    .map(
      (r) =>
        `<li>${esc(r.name)} <span>${esc(String(r.n))}번</span> <span>$${r.usd.toFixed(0)}</span></li>`,
    )
    .join('')
  const body = `<div id="seo-fallback"><h1>${esc(setName)} 힛카드</h1>${
    rows.length
      ? `<p>${esc(setName)}에서 값이 높은 카드 ${rows.length}장입니다. ${esc(basis)} 기준입니다.</p><ol>${list}</ol>`
      : `<p>${esc(setName)} 수록 카드 ${cards.length}장.</p>`
  }<p><a href="/set/${esc(slug)}">${esc(setName)} 전체 카드 보기</a></p></div>`
  html = html.replace('<body>', `<body>${body}`)
  res.set('Cache-Control', HTML_CACHE).send(html)
})

// ── 일러스트레이터 페이지(/artist/<슬러그>) ────────────────────────────────
// "사이토 미츠히로 포켓몬 카드"처럼 작가 이름으로 검색했을 때 걸리게 한다.
// 세트 페이지와 같은 방식이다 — 서버가 이름·대표작을 글자로 미리 넣어 보내고,
// 사람이 눌러 들어오면 앱이 이어받아 평소 화면을 그린다.
app.get('/artist/:slug', async (req, res) => {
  const slug = String(req.params.slug ?? '')
  if (!/^[\w.-]+$/.test(slug)) {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  let a: { en?: string; ko?: string; note?: string; era?: string; count?: number; cards?: { name: string; set?: string }[] }
  try {
    a = JSON.parse(await readFile(path.join(DIST, 'artists', `${slug}.json`), 'utf-8'))
  } catch {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const name = (a.ko || a.en || '').trim()
  if (!name) {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const shown = (a.cards ?? []).slice(0, 12).map((c) => koreanizeEnglishCardName(c.name))
  const title = `${name} 일러스트 카드 | pokegre`
  const desc = `${name}${subjectParticle(name)} 그린 포켓몬 카드 ${a.count ?? shown.length}장${
    a.note ? ` — ${a.note}` : ''
  }. ${shown.slice(0, 3).join(' · ')} 등.`
  const url = `https://pokegre.com/artist/${slug}`

  let html = TEMPLATE
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, esc(title))
  for (const k of ['og:description', 'twitter:description', 'description']) html = setMeta(html, k, esc(desc))
  html = setMeta(html, 'og:url', esc(url))
  html = html.replace('href="https://pokegre.com/"', `href="${esc(url)}"`)
  const list = shown.map((n) => `<li>${esc(n)}</li>`).join('')
  const body = `<div id="seo-fallback"><h1>${esc(name)} 일러스트 카드</h1>` +
    `<p>${esc(name)}${subjectParticle(name)} 그린 포켓몬 카드 ${a.count ?? shown.length}장입니다.` +
    `${a.era ? ` 활동 시기 ${esc(a.era)}.` : ''}${a.note ? ` ${esc(a.note)}.` : ''}</p>` +
    `<ul>${list}</ul></div>`
  html = html.replace('<body>', `<body>${body}`)
  res.set('Cache-Control', HTML_CACHE).send(html)
})

// ── 시리즈 페이지(/series/<슬러그>) ────────────────────────────────────────
// "소드실드 카드 목록"처럼 시리즈 이름으로 검색했을 때 걸리게 한다.
app.get('/series/:slug', async (req, res) => {
  const slug = String(req.params.slug ?? '')
  // 시리즈 슬러그에는 일본어가 그대로 들어간다(ポケモンカードゲーム-mega).
  // serieSlug가 한글·가나·한자를 살려 두기 때문이다 — 영문으로 억지로 옮기면
  // 사람이 주소만 보고 무슨 시리즈인지 알 수 없다. /는 여전히 막는다.
  if (!/^[\w가-힣ぁ-んァ-ヶー・一-鿿.-]+$/.test(slug)) {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  let idx: { slug: string; name: string; ed?: 'ja' | 'en'; serie?: string; count?: number; releaseDate?: string }[]
  try {
    idx = JSON.parse(await readFile(path.join(DIST, 'sets', 'index.json'), 'utf-8'))
  } catch {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const sets = idx.filter((s) => serieSlug(s.serie ?? '') === slug)
  if (!sets.length) {
    res.status(404).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const serieKo = koSet(sets[0].ed ?? 'ja', sets[0].serie ?? '')
  const cards = sets.reduce((n, s) => n + (s.count ?? 0), 0)
  const recent = sets
    .slice()
    .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')))
    .slice(0, 10)
  const title = `${serieKo} 세트 목록 | pokegre`
  const desc = `${serieKo} 시리즈 ${sets.length}개 세트, 카드 ${cards}장 — ${recent
    .slice(0, 3)
    .map((s) => koSet(s.ed ?? 'ja', s.name))
    .join(' · ')} 등.`
  const url = `https://pokegre.com/series/${slug}`

  let html = TEMPLATE
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, esc(title))
  for (const k of ['og:description', 'twitter:description', 'description']) html = setMeta(html, k, esc(desc))
  html = setMeta(html, 'og:url', esc(url))
  html = html.replace('href="https://pokegre.com/"', `href="${esc(url)}"`)
  const list = recent
    .map((s) => `<li><a href="/set/${esc(s.slug)}">${esc(koSet(s.ed ?? 'ja', s.name))}</a> ${s.count ?? 0}종</li>`)
    .join('')
  const body = `<div id="seo-fallback"><h1>${esc(serieKo)} 세트 목록</h1>` +
    `<p>${esc(serieKo)} 시리즈는 세트 ${sets.length}개, 카드 ${cards}장입니다.</p><ul>${list}</ul></div>`
  html = html.replace('<body>', `<body>${body}`)
  res.set('Cache-Control', HTML_CACHE).send(html)
})

// ── 센터링 도구(/centering) ───────────────────────────────────────────────
app.get('/centering', (_req, res) => {
  const title = '포켓몬 카드 센터링 측정 | pokegre'
  const desc =
    '카드 사진을 올리면 상하좌우 여백을 재서 센터링 비율을 알려줍니다. PSA 10을 노릴 때 미리 가늠해 볼 수 있습니다.'
  const url = 'https://pokegre.com/centering'
  let html = TEMPLATE
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, esc(title))
  for (const k of ['og:description', 'twitter:description', 'description']) html = setMeta(html, k, esc(desc))
  html = setMeta(html, 'og:url', esc(url))
  html = html.replace('href="https://pokegre.com/"', `href="${esc(url)}"`)
  const body =
    '<div id="seo-fallback"><h1>포켓몬 카드 센터링 측정</h1>' +
    '<p>카드 사진을 올리면 상하좌우 여백을 재서 센터링 비율을 알려줍니다. ' +
    'PSA·CGC 감정에서 센터링은 등급을 가르는 큰 기준이라, 보내기 전에 미리 가늠해 볼 수 있습니다.</p>' +
    '<p>사진은 브라우저 안에서만 처리하고 서버에 저장하지 않습니다.</p></div>'
  html = html.replace('<body>', `<body>${body}`)
  res.set('Cache-Control', HTML_CACHE).send(html)
})

// ── 팝수 조회(/population) ────────────────────────────────────────────────
//
// 카드 상세의 "감정 수량"을 누르면 /population?id=… 로 온다. 주소를 그대로 복사해
// 다시 들어와도 열려야 하므로 서버가 아는 주소여야 한다(App의 VIEW_PATH와 한 쌍).
app.get('/population', (_req, res) => {
  const title = '포켓몬 카드 감정 수량(팝수) 조회 | pokegre'
  const desc =
    'PSA·BGS·CGC·SGC가 이 카드에 매긴 등급이 각각 몇 장인지 전부 보여 드립니다. 10등급이 적을수록 구하기 어려운 카드입니다.'
  const url = 'https://pokegre.com/population'
  let html = TEMPLATE
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
  for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, esc(title))
  for (const k of ['og:description', 'twitter:description', 'description']) html = setMeta(html, k, esc(desc))
  html = setMeta(html, 'og:url', esc(url))
  html = html.replace('href="https://pokegre.com/"', `href="${esc(url)}"`)
  const body =
    '<div id="seo-fallback"><h1>포켓몬 카드 감정 수량(팝수) 조회</h1>' +
    '<p>PSA·BGS·CGC·SGC가 지금까지 그 카드에 매긴 등급이 각각 몇 장인지 보여 드립니다. ' +
    '반칸(9.5 등)까지 빠짐없이 나오고, 등급 없이 진품 확인만 받은 장수도 함께 나옵니다.</p>' +
    '<p>미개봉 시세가 싸도 10등급이 몇 장 없는 카드는 값이 전혀 다릅니다. 감정을 맡기기 전에 가늠해 볼 수 있습니다.</p></div>'
  html = html.replace('<body>', `<body>${body}`)
  res.set('Cache-Control', HTML_CACHE).send(html)
})

// ── 카테고리 대문(/sets · /artists · /packsim · /community) ────────────────
//
// 왜 필요한가: 낱개 페이지(세트 371·작가 388)는 사이트맵에 다 들어 있는데, 그것들을
// 묶어 주는 페이지가 없었다. 그래서 ①"포켓몬 카드 세트 목록" 같은 묶음 검색어로
// 들어올 문이 없고 ②검색엔진이 보기에 낱개 페이지끼리 이어지는 링크가 없어 사이트
// 안에서 안 중요한 페이지로 보인다(2026-08-05 운영자 지시로 추가).
//
// ⚠️ 이 네 줄은 반드시 express.static보다 **위**에 있어야 한다. dist 안에 sets·
//    artists·packsim 폴더가 실제로 있어서, 아래에 두면 static이 먼저 잡아 폴더
//    목록으로 301을 보낸다(실제로 /sets가 그렇게 동작하고 있었다).
function seoPage(opts: { title: string; desc: string; url: string; body: string }): string {
  let html = TEMPLATE
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(opts.title)}</title>`)
  for (const k of ['og:title', 'twitter:title']) html = setMeta(html, k, esc(opts.title))
  for (const k of ['og:description', 'twitter:description', 'description']) html = setMeta(html, k, esc(opts.desc))
  html = setMeta(html, 'og:url', esc(opts.url))
  html = html.replace('href="https://pokegre.com/"', `href="${esc(opts.url)}"`)
  return html.replace('<body>', `<body><div id="seo-fallback">${opts.body}</div>`)
}

app.get('/sets', async (_req, res) => {
  let sets: { slug: string; ed?: 'ja' | 'en'; name: string; count?: number; serie?: string }[] = []
  try {
    sets = JSON.parse(await readFile(path.join(DIST, 'sets', 'index.json'), 'utf-8'))
  } catch {
    res.status(500).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const 장수 = sets.reduce((n, s) => n + (s.count ?? 0), 0)
  // 시리즈로 묶어 준다. 371개를 한 줄로 늘어놓으면 사람도 크롤러도 읽기 어렵다.
  const 묶음 = new Map<string, typeof sets>()
  for (const s of sets) {
    const k = s.serie ?? '기타'
    if (!묶음.has(k)) 묶음.set(k, [])
    묶음.get(k)!.push(s)
  }
  const 본문 = [...묶음.entries()]
    .map(([serie, list]) => {
      const 이름 = koSet('ja', serie)
      const li = list
        .map((s) => `<li><a href="/set/${esc(s.slug)}">${esc(koSet(s.ed ?? 'ja', s.name))}</a> ${s.count ?? 0}종</li>`)
        .join('')
      return `<h2><a href="/series/${esc(serieSlug(serie))}">${esc(이름)}</a></h2><ul>${li}</ul>`
    })
    .join('')
  res.set('Cache-Control', HTML_CACHE).send(
    seoPage({
      title: '포켓몬 카드 세트 목록 | pokegre',
      desc: `일본판·북미판 세트 ${sets.length}개, 카드 ${장수.toLocaleString()}장을 한국어 이름으로 봅니다. 세트마다 값이 높은 카드도 함께 보여줍니다.`,
      url: 'https://pokegre.com/sets',
      body:
        '<h1>포켓몬 카드 세트 목록</h1>' +
        `<p>일본판·북미판 세트 ${sets.length}개, 카드 ${장수.toLocaleString()}장입니다. ` +
        '세트를 누르면 수록 카드를 한국어 이름으로 보고, 값이 높은 카드도 함께 볼 수 있습니다.</p>' +
        본문,
    }),
  )
})

app.get('/artists', async (_req, res) => {
  let artists: { slug: string; ko?: string; en: string; count?: number; era?: string; note?: string }[] = []
  try {
    artists = JSON.parse(await readFile(path.join(DIST, 'artists', 'index.json'), 'utf-8'))
  } catch {
    res.status(500).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const 장수 = artists.reduce((n, a) => n + (a.count ?? 0), 0)
  const li = artists
    .map((a) => {
      const 이름 = a.ko || a.en
      const 덧 = [a.era, a.count ? `${a.count.toLocaleString()}장` : ''].filter(Boolean).join(' · ')
      return `<li><a href="/artist/${esc(a.slug)}">${esc(이름)}</a>${덧 ? ` ${esc(덧)}` : ''}</li>`
    })
    .join('')
  res.set('Cache-Control', HTML_CACHE).send(
    seoPage({
      title: '포켓몬 카드 일러스트레이터 | pokegre',
      desc: `일러스트레이터 ${artists.length}명이 그린 카드 ${장수.toLocaleString()}장을 작가별로 모아 봅니다.`,
      url: 'https://pokegre.com/artists',
      body:
        '<h1>포켓몬 카드 일러스트레이터</h1>' +
        `<p>일러스트레이터 ${artists.length}명, 카드 ${장수.toLocaleString()}장입니다. ` +
        '이름을 누르면 그 작가가 그린 카드를 모아 봅니다.</p>' +
        `<ul>${li}</ul>`,
    }),
  )
})

// 포켓몬별 카드 대문(2026-08-06 운영자 지시로 추가).
// ⚠️ 이 줄도 express.static보다 **위**에 있어야 한다 — dist 안에 pokedex 폴더가 있어서,
//    아래에 두면 정적 폴더가 먼저 잡아 301로 튕긴다(sets·artists와 같은 함정).
app.get('/pokedex', async (_req, res) => {
  let list: { id: number; ko: string; en: string; c: number; t: 'p' | 't' }[] = []
  try {
    list = JSON.parse(await readFile(path.join(DIST, 'pokedex', 'index.json'), 'utf-8'))
  } catch {
    res.status(500).set('Cache-Control', HTML_CACHE).send(TEMPLATE)
    return
  }
  const 장수 = list.reduce((n, p) => n + p.c, 0)
  const 포켓몬수 = list.filter((p) => p.t === 'p').length
  // 크롤러가 읽을 이름 목록. 1,025종을 다 적으면 글이 너무 길어져 카드가 많은 순으로
  // 200종만 적는다 — 사람이 찾을 만한 포켓몬은 대개 이 안에 있다.
  const li = [...list]
    .sort((a, b) => b.c - a.c)
    .slice(0, 200)
    .map((p) => `<li>${esc(p.ko)} (${esc(p.en)}) ${p.c}장</li>`)
    .join('')
  res.set('Cache-Control', HTML_CACHE).send(
    seoPage({
      title: '포켓몬·트레이너별 카드 목록 | pokegre',
      desc: `포켓몬 ${포켓몬수}종과 트레이너·에너지 ${list.length - 포켓몬수}종, 카드 ${장수.toLocaleString()}장을 발매 순으로 모아 봅니다.`,
      url: 'https://pokegre.com/pokedex',
      body:
        '<h1>포켓몬·트레이너별 카드</h1>' +
        `<p>포켓몬 ${포켓몬수}종, 트레이너·에너지 ${list.length - 포켓몬수}종, 카드 ${장수.toLocaleString()}장입니다. ` +
        '이름을 고르면 그 카드가 일본판·북미판을 통틀어 발매 순으로 나오고, ' +
        '어느 세트에서 나온 카드인지도 함께 적습니다.</p>' +
        `<ul>${li}</ul>`,
    }),
  )
})

app.get('/packsim', (_req, res) => {
  const today = livePacks()
  // 팩 슬러그가 곧 세트 슬러그라 그 세트의 카드 목록으로 이어 준다. 대문의 값어치가
  // 여기 있다 — 링크가 없으면 검색엔진이 보기엔 그냥 외딴 페이지다.
  const li = today
    .map(
      (p) =>
        `<li><a href="/set/${esc(p.slug)}">${esc(p.label)}</a> ${p.price.toLocaleString()} GP</li>`,
    )
    .join('')
  res.set('Cache-Control', HTML_CACHE).send(
    seoPage({
      title: '오늘의 상점 — 포켓몬 카드 팩 열어 보기 | pokegre',
      desc: '실제 봉입률에 맞춰 포켓몬 카드 팩을 열어 봅니다. 상품은 매일 자정에 새롭게 갱신됩니다.',
      url: 'https://pokegre.com/packsim',
      body:
        '<h1>오늘의 상점</h1>' +
        '<p>실제 봉입률에 맞춰 포켓몬 카드 팩을 열어 보는 곳입니다. ' +
        '상품은 매일 자정에 새롭게 갱신됩니다. 오늘은 일본판 3종·북미판 3종이 진열돼 있습니다.</p>' +
        `<ul>${li}</ul>` +
        '<p>비공식 팬 시뮬레이션입니다. 실제 카드 거래가 아니며 GP는 현금 가치가 없습니다.</p>',
    }),
  )
})

// ⚠️ 글 제목은 싣지 않는다. 사람이 쓴 글이라 검색 결과에 그대로 나가면 우리가
//    책임질 수 없는 내용까지 색인된다(신고 처리보다 색인이 먼저 된다).
//    게시판이 뭐가 있는지만 적는다.
app.get('/community', (_req, res) => {
  res.set('Cache-Control', HTML_CACHE).send(
    seoPage({
      title: '커뮤니티 | pokegre',
      desc: '포켓몬 카드 자랑·질문·거래 이야기를 나누는 곳입니다.',
      url: 'https://pokegre.com/community',
      body:
        '<h1>커뮤니티</h1>' +
        '<p>포켓몬 카드 이야기를 나누는 곳입니다. 글을 쓰려면 로그인이 필요하고, 읽는 것은 누구나 됩니다.</p>' +
        '<ul><li>자유게시판</li><li>카드 자랑</li><li>질문</li></ul>',
    }),
  )
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
  // 여기도 캐시 정책을 적어야 한다. 안 적으면 브라우저가 파일 수정시각을 보고 제멋대로
  // 정하는데(휴리스틱), 그 사이 배포하면 없어진 번들을 찾아 흰 화면이 된다.
  res.set('Cache-Control', HTML_CACHE)
  res.sendFile(path.join(DIST, 'index.html'))
})

// 0.0.0.0으로 열어야 한다. 기본값(localhost)으로 두면 컨테이너 바깥에서 접속이
// 안 돼 Fly/Railway의 헬스체크가 실패한다.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`pokegre listening on :${PORT}`)
})
