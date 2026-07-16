import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

// 이 파일은 pokegre의 백엔드 전부다. vite에 딸려 있으면 개발 서버에서만 살아있고
// (configureServer는 dev 전용) 프로덕션 빌드에는 API가 한 줄도 안 들어간다. 그래서
// vite에서 떼어내 양쪽이 함께 마운트하는 모듈로 둔다.
//
// Mountable은 vite의 Connect 미들웨어와 Express의 교집합이다. 둘 다 use(경로, 핸들러)를
// 같은 방식으로 처리하고(마운트 경로를 req.url에서 떼어내는 것까지), Express의 Request는
// IncomingMessage를 상속하므로 핸들러를 그대로 양쪽에 꽂을 수 있다.
export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

export interface Mountable {
  use(path: string, handler: ApiHandler): unknown
}

export interface ApiEnv {
  POKEMON_PRICE_TRACKER_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  KAKAO_REST_API_KEY?: string
  KAKAO_CLIENT_SECRET?: string
  // 운영자의 카카오 회원번호. 쉼표로 여럿 넣을 수 있다.
  ADMIN_KAKAO_IDS?: string
}

// 운영자는 회원 정보에 표시하지 않고 환경변수로 지정한다. 회원 정보에 두면 운영자를
// 세우려고 서버 안의 파일을 직접 고쳐야 하는데, 그러자고 프로덕션 서버에 들어가는 건
// 위험하다. 환경변수면 fly secrets로 바꾸면 되고 값이 코드에도 안 남는다.
//
// 비어 있으면 아무도 운영자가 아니다 — 실수로 설정을 빠뜨렸을 때 모두가 운영자가
// 되는 것보다 아무도 아닌 게 낫다.
let adminKakaoIds: Set<string> = new Set()

function isAdmin(user: User | null): boolean {
  return user != null && adminKakaoIds.has(user.kakaoId)
}

// 데이터 파일 위치. 예전엔 __dirname 기준이었는데 두 가지가 문제였다. 이 프로젝트는
// ESM이라 진짜 Node 프로세스에는 __dirname이 없고(vite가 설정을 번들링할 때 넣어줘서
// 개발 중에만 있었다), 파일이 옮겨지면 경로가 조용히 따라 움직여 저장소를 놓친다.
// cwd 기준으로 두면 개발·프로덕션이 같고, 배포 시엔 환경변수로 볼륨을 가리킬 수 있다.
const DATA_DIR = process.env.POKEGRE_DATA_DIR ?? path.resolve(process.cwd(), 'data')
const dataFile = (name: string) => path.join(DATA_DIR, name)

// 만료 시각과 최대 개수를 함께 지키는 캐시.
//
// 그냥 Map을 쓰면 두 가지로 샌다. 만료된 항목은 그 키를 누가 다시 찾을 때만 지워지니
// 인기 없는 키는 영원히 남고, 애초에 개수 상한이 없다. 게다가 여기 캐시들은 키가
// 전부 요청에서 온다(URL, 쿼리스트링, page 파라미터). 즉 시간이 지나며 느는 정도가
// 아니라 방문자가 아무 값이나 넣어 무한정 늘릴 수 있다. 개발 중엔 서버를 자주 껐다
// 켜서 안 드러났지만 상시 서버에선 메모리가 계속 는다.
export class TtlCache<T> {
  private store = new Map<string, { value: T; expires: number }>()
  private ttlMs: number
  private maxEntries: number

  constructor(ttlMs: number, maxEntries: number) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
  }

  get(key: string): T | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (hit.expires <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return hit.value
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  set(key: string, value: T): void {
    const now = Date.now()
    for (const [k, v] of this.store) {
      if (v.expires <= now) this.store.delete(k)
    }
    // Map은 이미 있는 키에 다시 넣어도 원래 삽입 순서를 유지한다. 지우고 다시 넣어야
    // 방금 쓴 항목이 뒤로 가서, 넘칠 때 오래된 것부터 버릴 수 있다.
    this.store.delete(key)
    this.store.set(key, { value, expires: now + this.ttlMs })
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }
}

// 남의 유료 API를 대신 불러주는 엔드포인트(카드 인식, eBay 시세)는 호출마다 사장님
// 돈이 나간다. 로그인을 걸어 막는 방법도 있지만, 카드 시세 조회는 비로그인도 되는 게
// 이 서비스의 의도라 그 대신 횟수로 제한한다.
//
// 클라이언트 IP는 프록시(Fly) 뒤에서는 소켓 주소가 아니라 fly-client-ip로 온다.
// 헤더는 위조할 수 있지만, 위조하려면 어차피 요청마다 값을 바꿔야 하고 그건 이 제한이
// 막으려는 "실수로/스크립트로 몰아치는" 경우와는 다른 수준의 공격이다.
function clientIp(req: IncomingMessage): string {
  const header = req.headers['fly-client-ip'] ?? req.headers['x-forwarded-for']
  const raw = Array.isArray(header) ? header[0] : header
  return raw?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
}

// 고정 창(fixed window) 방식. 창 경계에서 최대 2배까지 통과할 수 있지만, 여기 목적은
// 정밀한 제어가 아니라 하루치 크레딧이 한 번에 타는 걸 막는 것이라 이걸로 충분하다.
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new TtlCache<{ count: number }>(windowMs, 10_000)
  return function allow(req: IncomingMessage): boolean {
    const key = clientIp(req)
    const found = hits.get(key)
    if (!found) {
      hits.set(key, { count: 1 })
      return true
    }
    // 창 안에서는 만료 시각을 그대로 둬야 한다. set으로 다시 넣으면 요청할 때마다
    // 창이 뒤로 밀려서 계속 두드리는 쪽이 오히려 영원히 통과한다.
    found.count += 1
    return found.count <= limit
  }
}

function tooManyRequests(res: ServerResponse) {
  res.statusCode = 429
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ error: 'too_many_requests' }))
}

const SNKRDUNK_ORIGIN = 'https://snkrdunk.com'
const CACHE_TTL_MS = 5 * 60 * 1000
// 제일 큰 응답이 trading-history의 약 50KB라, 300개면 최대 15MB 정도다.
const CACHE_MAX_ENTRIES = 300

function mountSnkrdunkProxy(app: Mountable) {
  const cache = new TtlCache<{ body: string; status: number; contentType: string }>(CACHE_TTL_MS, CACHE_MAX_ENTRIES)

  app.use('/api/snkrdunk', async (req, res) => {
    const path = req.url ?? ''
    const cached = cache.get(path)

    if (cached) {
      res.statusCode = cached.status
      res.setHeader('content-type', cached.contentType)
      res.end(cached.body)
      return
    }

    try {
      const upstream = await fetch(`${SNKRDUNK_ORIGIN}${path}`, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (compatible; pokemon-card-price-tracker/0.1; personal use)',
        },
      })
      const body = await upstream.text()
      const contentType = upstream.headers.get('content-type') ?? 'application/json'
      cache.set(path, { body, status: upstream.status, contentType })
      res.statusCode = upstream.status
      res.setHeader('content-type', contentType)
      res.end(body)
    } catch {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'upstream_fetch_failed' }))
    }
  })
}

// 환율은 유럽중앙은행이 평일 하루 한 번 발표하는 값을 Frankfurter가 그대로 넘겨준다.
// 무료·무키·상업적 이용 허용이고, 긁어오는 게 아니라 정식으로 제공하는 데이터다.
//
// 시세는 엔·달러로 보여주고 원화는 옆에 참고로만 붙인다. 원화로 바꿔서 그것만 띄우면
// 실제로 존재하지 않는 가격이 된다 — 카드사 환율과 해외결제 수수료 때문에 결제액은
// 어차피 2~5% 어긋난다. 그래서 실시간 환율을 살 이유도 없다. 하루 지난 값이어도
// 기준일만 밝히면 참고용으로 충분하다.
const EXCHANGE_ORIGIN = 'https://api.frankfurter.dev/v1'
// 하루 한 번 바뀌는 값이라 자주 물어볼 이유가 없다. 발표를 놓쳐도 몇 시간 뒤 따라잡는다.
const EXCHANGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface ExchangeRates {
  jpyToKrw: number
  usdToKrw: number
  // 환율의 기준 날짜. 오늘이 아니다 — 평일 하루 한 번 발표라 보통 어제 것이고,
  // 주말이 끼면 사흘 전 것일 수도 있다. 화면에 이 날짜를 같이 보여줘야 사용자가
  // 언제 기준 숫자인지 알 수 있다.
  date: string
}

function mountExchangeRate(app: Mountable) {
  const cache = new TtlCache<ExchangeRates>(EXCHANGE_CACHE_TTL_MS, 1)

  app.use('/api/local/exchange-rate', async (_req, res) => {
    const cached = cache.get('latest')
    if (cached) {
      sendJson(res, 200, cached)
      return
    }

    try {
      // 달러 기준으로 한 번만 부르고 엔→원은 나눠서 구한다. 따로 부른 값과 소수점
      // 넷째 자리까지 같은 걸 확인했다.
      const upstream = await fetch(`${EXCHANGE_ORIGIN}/latest?base=USD&symbols=KRW,JPY`)
      if (!upstream.ok) {
        sendJson(res, 502, { error: 'upstream_error' })
        return
      }
      const data = (await upstream.json()) as { date?: string; rates?: { KRW?: number; JPY?: number } }
      const usdToKrw = data.rates?.KRW
      const usdToJpy = data.rates?.JPY
      if (!usdToKrw || !usdToJpy || !data.date) {
        sendJson(res, 502, { error: 'unexpected_upstream_shape' })
        return
      }

      const rates: ExchangeRates = { jpyToKrw: usdToKrw / usdToJpy, usdToKrw, date: data.date }
      cache.set('latest', rates)
      sendJson(res, 200, rates)
    } catch {
      sendJson(res, 502, { error: 'upstream_fetch_failed' })
    }
  })
}

const KOREAN_NEWS_ORIGIN = 'https://pokemoncard.co.kr'
const KOREAN_NEWS_CACHE_TTL_MS = 30 * 60 * 1000
// 페이지 번호의 상한이자 캐시 항목 수 상한. 소식은 "더보기"로 몇 페이지만 넘겨보는
// 용도라 이 정도면 충분하다.
const KOREAN_NEWS_MAX_PAGES = 20

interface KoreanNewsItem {
  url: string
  title: string
  date: string
}

// 포켓몬코리아 공식 카드게임 사이트(pokemoncard.co.kr)의 "소식" 목록은 완전한
// 한글 자연어 뉴스라, 일본어 기반인 스니커덩크 아티클보다 실사용자에게 훨씬
// 유용하다. 다만 별도 JSON API가 아니라 폼 POST로 HTML 조각을 돌려주는
// 구식 페이지라("select ... #|# <html> #|# <totalPages>" 형식), 서버에서
// 대신 호출해 HTML을 파싱한 뒤 깔끔한 JSON으로 돌려준다.
// 저작권 있는 기사 이미지는 재게시하지 않고 제목+링크만 가져온다.
function parseKoreanNewsHtml(html: string): KoreanNewsItem[] {
  const chunks = html.split(/(?=<li class="col-lg-3)/).filter((c) => c.includes('<a href'))
  const items: KoreanNewsItem[] = []

  for (const chunk of chunks) {
    const hrefMatch = chunk.match(/<a href="([^"]+)"/)
    const titleMatch = chunk.match(/<h3>\s*([^<]+?)\s*<\/h3>/)
    const dateMatch = chunk.match(/<li>(\d{4}년\s*\d{2}월\s*\d{2}일)<\/li>/)
    if (!hrefMatch || !titleMatch) continue

    const href = hrefMatch[1]
    items.push({
      url: href.startsWith('/') ? `${KOREAN_NEWS_ORIGIN}${href}` : href,
      title: titleMatch[1].trim(),
      date: dateMatch ? dateMatch[1] : '',
    })
  }

  return items
}

function mountKoreanNews(app: Mountable) {
  const cache = new TtlCache<string>(KOREAN_NEWS_CACHE_TTL_MS, KOREAN_NEWS_MAX_PAGES)

  app.use('/api/local/pokemon-news', async (req, res) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    // page를 그대로 쓰면 안 된다. 캐시 키이자 업스트림 요청 파라미터라, 아무 문자열이나
    // 넣어 캐시를 부풀리고 그때마다 포켓몬코리아로 요청을 날리게 만들 수 있다.
    const requested = Number(url.searchParams.get('page') ?? '1')
    const page = Number.isInteger(requested) && requested >= 1 && requested <= KOREAN_NEWS_MAX_PAGES ? requested : 1
    const cacheKey = String(page)
    const cached = cache.get(cacheKey)

    if (cached) {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(cached)
      return
    }

    try {
      const form = new URLSearchParams({ pn: String(page), cate: '2', sword: '', rcode: 'menu_news' })
      const upstream = await fetch(`${KOREAN_NEWS_ORIGIN}/v3/news_ajax`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'Mozilla/5.0 (compatible; pokemon-card-price-tracker/0.1; personal use)',
        },
        body: form.toString(),
      })
      const raw = await upstream.text()
      const [, html] = raw.split('#|#')
      const items = parseKoreanNewsHtml(html ?? '')
      const body = JSON.stringify({ items })
      cache.set(cacheKey, body)
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(body)
    } catch {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'upstream_fetch_failed' }))
    }
  })
}

const POSTS_FILE = dataFile('community-posts.json')
const COMMENTS_FILE = dataFile('community-comments.json')
const REPORTS_FILE = dataFile('community-reports.json')
const MAX_POSTS = 500
// 글 하나가 볼륨을 채우지 못하게 막는 상한. 게시글 500개가 전부 상한을 채워도
// 25MB 정도라 1GB 볼륨에 여유가 크다.
const MAX_TITLE_LENGTH = 200
const MAX_CONTENT_LENGTH = 50_000
const MAX_COMMENT_LENGTH = 2_000

// 작성자 닉네임은 글에 저장하지 않는다. 저장해두면 나중에 닉네임을 바꿔도 옛 글에는
// 옛 이름이 박힌 채로 남아, 같은 사람이 두 사람처럼 보인다. authorId만 남기고 닉네임은
// 매번 조회해서 채운다.
interface CommunityPost {
  id: number
  title: string
  // 작성자 카카오 회원번호. 화면에는 절대 내보내지 않고, 닉네임 조회와 본인 글 여부
  // 판별에만 쓴다.
  authorId: string
  content: string
  createdAt: number
  commentCount: number
  // 운영자가 가린 시각. 지우지 않고 가리는 이유는 두 가지다. 신고가 장난일 수 있어
  // 되돌릴 수 있어야 하고, "왜 내 글 지웠냐"는 항의에 보여줄 원문이 남아야 한다.
  // (정보통신망법이 요구하는 것도 삭제가 아니라 임시조치다.)
  hiddenAt?: number
}

interface CommunityComment {
  id: number
  postId: number
  authorId: string
  content: string
  createdAt: number
  hiddenAt?: number
}

// 탈퇴했거나 닉네임을 아직 안 정한 작성자. 글 자체는 남으므로 이름 자리는 채워야 한다.
const UNKNOWN_AUTHOR = '알 수 없음'

function authorName(authorId: string, all: User[]): string {
  return all.find((u) => u.kakaoId === authorId)?.nickname ?? UNKNOWN_AUTHOR
}

const HIDDEN_NOTICE = '신고로 가려진 글입니다.'

// authorId(카카오 회원번호)는 내부 식별용이라 응답에서 제거하고, 대신 "내 글인가"만
// 알려준다. 회원번호가 클라이언트로 새면 사용자 추적에 쓰일 수 있다.
//
// 가려진 글의 원문은 아예 응답에 담지 않는다. 화면에서 가리기만 하면 개발자도구나
// 주소창으로 그대로 볼 수 있어서 가린 게 아니게 된다. 운영자에게만 원문을 보낸다.
function toPublicPost(post: CommunityPost, viewer: User | null, all: User[]) {
  const { authorId, hiddenAt, ...rest } = post
  const hidden = hiddenAt != null && !isAdmin(viewer)
  return {
    ...rest,
    title: hidden ? HIDDEN_NOTICE : rest.title,
    content: hidden ? HIDDEN_NOTICE : rest.content,
    author: authorName(authorId, all),
    authorIsAdmin: adminKakaoIds.has(authorId),
    isMine: viewer != null && authorId === viewer.kakaoId,
    isHidden: hiddenAt != null,
  }
}

function toPublicComment(comment: CommunityComment, viewer: User | null, all: User[]) {
  const { authorId, hiddenAt, ...rest } = comment
  const hidden = hiddenAt != null && !isAdmin(viewer)
  return {
    ...rest,
    content: hidden ? HIDDEN_NOTICE : rest.content,
    author: authorName(authorId, all),
    authorIsAdmin: adminKakaoIds.has(authorId),
    isMine: viewer != null && authorId === viewer.kakaoId,
    isHidden: hiddenAt != null,
  }
}

interface CommunityReport {
  id: number
  targetType: 'post' | 'comment'
  postId: number
  commentId: number | null
  reason: string
  createdAt: number
}

// 자유게시판. 읽기는 비로그인도 되지만 쓰기는 로그인이 필요하고, 작성자는 클라이언트가
// 보낸 값이 아니라 세션에서 가져온다(아니면 남의 닉네임을 사칭할 수 있다).
// 신고 접수는 아직 별도 관리자 화면이 없어서, data/community-reports.json에 쌓아두고
// 운영자가 주기적으로 파일을 확인해 삭제 여부를 판단하는 방식으로 최소한의 신고
// 창구만 우선 마련한다(정보통신망법상 불법정보 신고 접수 창구 요건 대응).
function mountCommunity(app: Mountable) {
  let posts: CommunityPost[] | null = null
  let comments: CommunityComment[] | null = null
  let reports: CommunityReport[] | null = null

  async function loadPosts(): Promise<CommunityPost[]> {
    if (posts) return posts
    try {
      posts = JSON.parse(await readFile(POSTS_FILE, 'utf-8'))
    } catch {
      posts = []
    }
    return posts!
  }

  async function persistPosts() {
    await mkdir(path.dirname(POSTS_FILE), { recursive: true })
    await writeFile(POSTS_FILE, JSON.stringify(posts))
  }

  async function loadComments(): Promise<CommunityComment[]> {
    if (comments) return comments
    try {
      comments = JSON.parse(await readFile(COMMENTS_FILE, 'utf-8'))
    } catch {
      comments = []
    }
    return comments!
  }

  async function persistComments() {
    await mkdir(path.dirname(COMMENTS_FILE), { recursive: true })
    await writeFile(COMMENTS_FILE, JSON.stringify(comments))
  }

  async function loadReports(): Promise<CommunityReport[]> {
    if (reports) return reports
    try {
      reports = JSON.parse(await readFile(REPORTS_FILE, 'utf-8'))
    } catch {
      reports = []
    }
    return reports!
  }

  async function persistReports() {
    await mkdir(path.dirname(REPORTS_FILE), { recursive: true })
    await writeFile(REPORTS_FILE, JSON.stringify(reports))
  }

  function sendJson(res: import('node:http').ServerResponse, status: number, data: unknown) {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(data))
  }

  app.use('/api/local/community', async (req, res) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)

    try {
      // /posts
      if (segments.length === 1 && segments[0] === 'posts' && req.method === 'GET') {
        const viewer = await currentUser(req)
        const all = await loadPosts()
        const everyone = await loadUsers()
        sendJson(
          res,
          200,
          [...all].sort((a, b) => b.createdAt - a.createdAt).map((p) => toPublicPost(p, viewer, everyone)),
        )
        return
      }

      if (segments.length === 1 && segments[0] === 'posts' && req.method === 'POST') {
        // 닉네임까지 정해야 글을 쓸 수 있다(작성자 표시가 닉네임이므로).
        const user = await currentUser(req)
        if (!user?.nickname) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse(await readBody(req)) as { title?: string; content?: string }
        const title = body.title?.trim()
        const content = body.content?.trim()
        if (!title || !content) {
          sendJson(res, 400, { error: 'title and content are required' })
          return
        }
        // 자르지 않고 거절한다. 조용히 잘라내면 사용자는 글이 온전히 저장된 줄 알고
        // 나중에 뒷부분이 사라진 걸 발견하게 된다.
        if (title.length > MAX_TITLE_LENGTH || content.length > MAX_CONTENT_LENGTH) {
          sendJson(res, 400, {
            error: `title must be <= ${MAX_TITLE_LENGTH} chars and content <= ${MAX_CONTENT_LENGTH} chars`,
          })
          return
        }
        const all = await loadPosts()
        const post: CommunityPost = {
          id: Date.now(),
          title,
          // 작성자는 클라이언트가 보낸 값이 아니라 세션에서 가져온다. 아니면
          // 아무나 남의 닉네임을 사칭해 글을 쓸 수 있다.
          authorId: user.kakaoId,
          content,
          createdAt: Date.now(),
          commentCount: 0,
        }
        all.push(post)
        if (all.length > MAX_POSTS) all.splice(0, all.length - MAX_POSTS)
        await persistPosts()
        sendJson(res, 201, toPublicPost(post, user, await loadUsers()))
        return
      }

      // /posts/:id
      if (segments.length === 2 && segments[0] === 'posts' && req.method === 'GET') {
        const viewer = await currentUser(req)
        const id = Number(segments[1])
        const all = await loadPosts()
        const post = all.find((p) => p.id === id)
        if (!post) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        sendJson(res, 200, toPublicPost(post, viewer, await loadUsers()))
        return
      }

      // DELETE /posts/:id — 본인 글만
      if (segments.length === 2 && segments[0] === 'posts' && req.method === 'DELETE') {
        const user = await currentUser(req)
        const id = Number(segments[1])
        const all = await loadPosts()
        const post = all.find((p) => p.id === id)
        if (!post) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        if (!user || post.authorId !== user.kakaoId) {
          sendJson(res, 403, { error: 'not your post' })
          return
        }
        posts = all.filter((p) => p.id !== id)
        comments = (await loadComments()).filter((c) => c.postId !== id)
        await persistPosts()
        await persistComments()
        sendJson(res, 200, { ok: true })
        return
      }

      // /posts/:id/report
      if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'report' && req.method === 'POST') {
        const postId = Number(segments[1])
        const allPosts = await loadPosts()
        if (!allPosts.some((p) => p.id === postId)) {
          sendJson(res, 404, { error: 'post not found' })
          return
        }
        const rawBody = await readBody(req)
        const body = (rawBody ? JSON.parse(rawBody) : {}) as { reason?: string }
        const allReports = await loadReports()
        allReports.push({
          id: Date.now(),
          targetType: 'post',
          postId,
          commentId: null,
          reason: body.reason?.trim().slice(0, 500) ?? '',
          createdAt: Date.now(),
        })
        await persistReports()
        sendJson(res, 201, { ok: true })
        return
      }

      // /posts/:postId/comments/:commentId/report
      if (
        segments.length === 5 &&
        segments[0] === 'posts' &&
        segments[2] === 'comments' &&
        segments[4] === 'report' &&
        req.method === 'POST'
      ) {
        const postId = Number(segments[1])
        const commentId = Number(segments[3])
        const allComments = await loadComments()
        if (!allComments.some((c) => c.id === commentId && c.postId === postId)) {
          sendJson(res, 404, { error: 'comment not found' })
          return
        }
        const rawBody = await readBody(req)
        const body = (rawBody ? JSON.parse(rawBody) : {}) as { reason?: string }
        const allReports = await loadReports()
        allReports.push({
          id: Date.now(),
          targetType: 'comment',
          postId,
          commentId,
          reason: body.reason?.trim().slice(0, 500) ?? '',
          createdAt: Date.now(),
        })
        await persistReports()
        sendJson(res, 201, { ok: true })
        return
      }

      // /posts/:id/comments
      if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'comments') {
        const postId = Number(segments[1])

        if (req.method === 'GET') {
          const viewer = await currentUser(req)
          const all = await loadComments()
          const everyone = await loadUsers()
          sendJson(
            res,
            200,
            all
              .filter((c) => c.postId === postId)
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((c) => toPublicComment(c, viewer, everyone)),
          )
          return
        }

        if (req.method === 'POST') {
          const user = await currentUser(req)
          if (!user?.nickname) {
            sendJson(res, 401, { error: 'login required' })
            return
          }
          const body = JSON.parse(await readBody(req)) as { content?: string }
          const content = body.content?.trim()
          if (!content) {
            sendJson(res, 400, { error: 'content is required' })
            return
          }
          if (content.length > MAX_COMMENT_LENGTH) {
            sendJson(res, 400, { error: `content must be <= ${MAX_COMMENT_LENGTH} chars` })
            return
          }
          const allPosts = await loadPosts()
          const post = allPosts.find((p) => p.id === postId)
          if (!post) {
            sendJson(res, 404, { error: 'post not found' })
            return
          }
          const allComments = await loadComments()
          const comment: CommunityComment = {
            id: Date.now(),
            postId,
            authorId: user.kakaoId,
            content,
            createdAt: Date.now(),
          }
          allComments.push(comment)
          post.commentCount += 1
          await persistComments()
          await persistPosts()
          sendJson(res, 201, toPublicComment(comment, user, await loadUsers()))
          return
        }
      }

      // ── 여기부터 운영자 전용 ────────────────────────────────────────────────
      // 화면에서 메뉴를 숨기는 건 보안이 아니다. 주소를 직접 치면 그만이라, 막는 건
      // 여기여야 한다. 아래 셋은 전부 운영자인지 먼저 확인한다.

      // GET /reports — 신고함. 신고당한 글·댓글의 원문을 함께 실어 보낸다.
      if (segments.length === 1 && segments[0] === 'reports' && req.method === 'GET') {
        const viewer = await currentUser(req)
        if (!isAdmin(viewer)) {
          // 운영자가 아니면 이 경로가 있다는 것 자체를 알려주지 않는다.
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const [allReports, allPosts, allComments, everyone] = await Promise.all([
          loadReports(),
          loadPosts(),
          loadComments(),
          loadUsers(),
        ])
        const items = [...allReports]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((r) => {
            const post = allPosts.find((p) => p.id === r.postId)
            const comment = r.commentId != null ? allComments.find((c) => c.id === r.commentId) : undefined
            const target = r.targetType === 'comment' ? comment : post
            return {
              id: r.id,
              targetType: r.targetType,
              postId: r.postId,
              commentId: r.commentId,
              reason: r.reason,
              createdAt: r.createdAt,
              // 신고 대상이 이미 지워졌을 수 있다.
              exists: target != null,
              isHidden: target?.hiddenAt != null,
              postTitle: post?.title ?? null,
              author: target ? authorName(target.authorId, everyone) : null,
              excerpt: target?.content?.slice(0, 200) ?? null,
            }
          })
        sendJson(res, 200, items)
        return
      }

      // POST /posts/:id/hide, /posts/:id/unhide
      if (segments.length === 3 && segments[0] === 'posts' && (segments[2] === 'hide' || segments[2] === 'unhide')) {
        const viewer = await currentUser(req)
        if (!isAdmin(viewer)) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const post = (await loadPosts()).find((p) => p.id === Number(segments[1]))
        if (!post) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        if (segments[2] === 'hide') post.hiddenAt = Date.now()
        else delete post.hiddenAt
        await persistPosts()
        sendJson(res, 200, toPublicPost(post, viewer, await loadUsers()))
        return
      }

      // POST /comments/:id/hide, /comments/:id/unhide
      if (
        segments.length === 3 &&
        segments[0] === 'comments' &&
        (segments[2] === 'hide' || segments[2] === 'unhide')
      ) {
        const viewer = await currentUser(req)
        if (!isAdmin(viewer)) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const comment = (await loadComments()).find((c) => c.id === Number(segments[1]))
        if (!comment) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        if (segments[2] === 'hide') comment.hiddenAt = Date.now()
        else delete comment.hiddenAt
        await persistComments()
        sendJson(res, 200, toPublicComment(comment, viewer, await loadUsers()))
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch {
      sendJson(res, 400, { error: 'bad request' })
    }
  })
}

const SEARCH_COUNTS_FILE = dataFile('search-counts.json')
const SNAPSHOT_FILE = dataFile('search-ranking-snapshot.json')
const MAX_TRACKED_TERMS = 500
// 카드명·팩명 검색어라 이보다 길 일이 없다. 넘으면 집계하지 않고 조용히 무시한다
// (검색 자체는 클라이언트가 알아서 하므로 사용자에게 보이는 변화는 없다).
const MAX_TERM_LENGTH = 100
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000
const RANKING_SIZE = 10

// 요청 바디는 전부 메모리에 올라간다. 상한이 없으면 아무나 거대한 요청 하나로 서버를
// 죽일 수 있다(track-search는 로그인도 필요 없다). 텍스트 JSON은 이 정도면 넉넉하고,
// 카드 사진처럼 원래 큰 바디는 호출부에서 따로 넉넉히 준다.
const MAX_BODY_BYTES = 64 * 1024

export class BodyTooLargeError extends Error {}

async function readBody(
  req: import('node:http').IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    // 다 받은 뒤에 재면 이미 메모리에 다 올라온 뒤라 아무 소용이 없다. 넘는 순간
    // 끊어야 버퍼가 딱 그만큼에서 멈춘다.
    if (total > maxBytes) {
      req.destroy()
      throw new BodyTooLargeError()
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

interface Snapshot {
  snapshotAt: number
  ranks: Record<string, number>
}

// 검색창에 입력된 검색어를 로컬 파일에 누적 집계해서 "인기 검색어" 홈 화면에 쓴다.
// 스니커덩크 자체 추천/인기 알고리즘은 기준이 불투명해서, 우리 사이트 안에서
// 실제로 사용자가 몇 번 검색했는지를 직접 세는 방식으로 대체한다.
//
// 순위 변동(▲▼NEW)을 보여주기 위해 한 시간에 한 번씩 "이전 순위" 스냅샷을 따로
// 저장해두고, 그 스냅샷과 현재 순위를 비교해 변동폭을 계산한다.
function mountSearchTracker(app: Mountable) {
  let counts: Record<string, number> | null = null
  let snapshot: Snapshot | null | undefined

  async function loadCounts(): Promise<Record<string, number>> {
    if (counts) return counts
    try {
      counts = JSON.parse(await readFile(SEARCH_COUNTS_FILE, 'utf-8'))
    } catch {
      counts = {}
    }
    return counts!
  }

  async function persistCounts() {
    await mkdir(path.dirname(SEARCH_COUNTS_FILE), { recursive: true })
    await writeFile(SEARCH_COUNTS_FILE, JSON.stringify(counts))
  }

  async function loadSnapshot(): Promise<Snapshot | null> {
    if (snapshot !== undefined) return snapshot
    try {
      snapshot = JSON.parse(await readFile(SNAPSHOT_FILE, 'utf-8'))
    } catch {
      snapshot = null
    }
    return snapshot ?? null
  }

  async function persistSnapshot(next: Snapshot) {
    snapshot = next
    await mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true })
    await writeFile(SNAPSHOT_FILE, JSON.stringify(next))
  }

  function rankTerms(current: Record<string, number>) {
    return Object.entries(current)
      .sort((a, b) => b[1] - a[1])
      .slice(0, RANKING_SIZE)
      .map(([term, count], i) => ({ term, count, rank: i + 1 }))
  }

  app.use('/api/local/track-search', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    try {
      const body = JSON.parse(await readBody(req)) as { query?: string }
      const term = body.query?.trim()
      // 검색어가 그대로 JSON 키가 되어 파일에 쌓인다. MAX_TRACKED_TERMS는 개수만 막지
      // 크기는 안 막아서, 길이를 안 자르면 500개로도 볼륨을 넘길 수 있다. 이 엔드포인트는
      // 로그인도 필요 없다.
      if (term && term.length <= MAX_TERM_LENGTH) {
        const current = await loadCounts()
        current[term] = (current[term] ?? 0) + 1
        if (Object.keys(current).length > MAX_TRACKED_TERMS) {
          const sorted = Object.entries(current).sort((a, b) => b[1] - a[1])
          counts = Object.fromEntries(sorted.slice(0, MAX_TRACKED_TERMS))
        }
        await persistCounts()
      }
      res.statusCode = 204
      res.end()
    } catch {
      res.statusCode = 400
      res.end()
    }
  })

  app.use('/api/local/popular-searches', async (_req, res) => {
    const current = await loadCounts()
    const ranked = rankTerms(current)
    const prev = await loadSnapshot()
    const now = Date.now()

    const items = ranked.map(({ term, count, rank }) => {
      const prevRank = prev?.ranks[term]
      if (prevRank === undefined) return { term, count, rank, change: 'new' as const, delta: 0 }
      const delta = prevRank - rank
      if (delta === 0) return { term, count, rank, change: 'flat' as const, delta: 0 }
      return { term, count, rank, change: delta > 0 ? ('up' as const) : ('down' as const), delta: Math.abs(delta) }
    })

    if (!prev || now - prev.snapshotAt >= SNAPSHOT_INTERVAL_MS) {
      await persistSnapshot({
        snapshotAt: now,
        ranks: Object.fromEntries(ranked.map(({ term, rank }) => [term, rank])),
      })
    }

    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ asOf: now, items }))
  })
}

const PRICE_TRACKER_ORIGIN = 'https://www.pokemonpricetracker.com/api/v2'
const PRICE_TRACKER_CACHE_TTL_MS = 6 * 60 * 60 * 1000
// 응답은 화면용 필드만 추려서 작지만, TTL이 6시간이라 그만큼 오래 쌓인다.
// 무료 티어가 하루 100건이라 어차피 이만큼 채울 일도 없다.
const PRICE_TRACKER_MAX_ENTRIES = 200
// 무료 요금제가 하루 100건이다. 한 사람이 시간당 20건이면 정상 사용에는 걸릴 일이
// 없으면서, 혼자서 하루치를 태우려면 다섯 시간이 걸린다.
const PRICE_TRACKER_RATE_LIMIT = 20
const PRICE_TRACKER_RATE_WINDOW_MS = 60 * 60 * 1000

interface RawEbayGrade {
  count?: number
  averagePrice?: number
  medianPrice?: number
  minPrice?: number
  maxPrice?: number
  marketTrend?: string | null
}

interface RawPriceTrackerCard {
  tcgPlayerId?: string
  name?: string
  setName?: string
  cardNumber?: string | null
  imageCdnUrl400?: string
  imageCdnUrl200?: string
  ebay?: { salesByGrade?: Record<string, RawEbayGrade>; totalSales?: number }
}

interface ShapedEbayCard {
  tcgPlayerId: string
  name: string
  setName: string
  cardNumber: string | null
  imageUrl: string
  totalSales: number
  grades: {
    grade: string
    count: number
    averagePrice: number
    medianPrice: number
    minPrice: number
    maxPrice: number
    marketTrend: string | null
  }[]
}

// PokemonPriceTracker 원본 응답에는 화면에 안 쓰는 정보(개별 낙찰 목록, 전체 가격
// 히스토리, smartMarketPrice 등)까지 들어 있다. 원본을 그대로 프록시로 흘리면 이
// 엔드포인트가 사실상 그들의 API를 재중계(재배포)하는 꼴이라 약관 위반 소지가 있다.
// 그래서 화면에 실제로 쓰는 필드만 추려서 내려준다("제품 내 표시"에만 해당하도록).
function shapeEbayCards(raw: unknown): ShapedEbayCard[] {
  const body = raw as { data?: RawPriceTrackerCard | RawPriceTrackerCard[] }
  const list = Array.isArray(body.data) ? body.data : body.data ? [body.data] : []

  return list
    .filter((card) => (card.ebay?.totalSales ?? 0) > 0)
    .map((card) => ({
      tcgPlayerId: card.tcgPlayerId ?? '',
      name: card.name ?? '',
      setName: card.setName ?? '',
      cardNumber: card.cardNumber ?? null,
      imageUrl: card.imageCdnUrl400 ?? card.imageCdnUrl200 ?? '',
      totalSales: card.ebay?.totalSales ?? 0,
      grades: Object.entries(card.ebay?.salesByGrade ?? {})
        .map(([grade, stat]) => ({
          grade,
          count: stat.count ?? 0,
          averagePrice: stat.averagePrice ?? 0,
          medianPrice: stat.medianPrice ?? 0,
          minPrice: stat.minPrice ?? 0,
          maxPrice: stat.maxPrice ?? 0,
          marketTrend: stat.marketTrend ?? null,
        }))
        .sort((a, b) => b.count - a.count),
    }))
}

// 이베이 등급별(PSA/CGC/BGS) 실거래가를 PokemonPriceTracker API에서 대신 받아온다.
// 무료 티어가 하루 100크레딧뿐이라 캐시를 길게(6시간) 잡아서 아낀다. API 키는 서버에서만
// 붙이고 클라이언트에는 절대 내려주지 않는다.
function mountEbayPrice(app: Mountable, apiKey: string) {
  const cache = new TtlCache<string>(PRICE_TRACKER_CACHE_TTL_MS, PRICE_TRACKER_MAX_ENTRIES)
  const allow = rateLimiter(PRICE_TRACKER_RATE_LIMIT, PRICE_TRACKER_RATE_WINDOW_MS)

  app.use('/api/local/card-prices', async (req, res) => {
    if (!apiKey) {
      res.statusCode = 501
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'POKEMON_PRICE_TRACKER_API_KEY not configured' }))
      return
    }

    const url = new URL(req.url ?? '', 'http://localhost')
    const cacheKey = url.search
    const cached = cache.get(cacheKey)

    if (cached) {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(cached)
      return
    }

    // 제한은 캐시 뒤에 둔다. 캐시 적중은 크레딧을 안 쓰므로 셀 이유가 없고, 여기서
    // 막으면 남이 이미 조회해둔 카드를 보는 정상 사용자만 걸린다. 여기까지 왔다는 건
    // 진짜로 업스트림을 부른다는 뜻이다.
    if (!allow(req)) {
      tooManyRequests(res)
      return
    }

    try {
      const upstream = await fetch(`${PRICE_TRACKER_ORIGIN}/cards${url.search}`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
      })

      if (!upstream.ok) {
        // 업스트림 원본 에러 바디는 그대로 흘리지 않고 상태 코드만 전달한다.
        // (에러 응답은 캐시하지 않아 일시적 429/500이 6시간 고정되지 않게 한다.)
        res.statusCode = upstream.status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'upstream_error', status: upstream.status }))
        return
      }

      // 원본을 그대로 넘기지 않고 화면용 필드만 추려서 재배포 소지를 없앤다.
      const rawJson = await upstream.json()
      const body = JSON.stringify({ cards: shapeEbayCards(rawJson) })
      cache.set(cacheKey, body)
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(body)
    } catch {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'upstream_fetch_failed' }))
    }
  })
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MAX_IMAGE_BODY_BYTES = 8 * 1024 * 1024
// 카드를 몇 장 찍어보는 건 넉넉히 되면서, 스크립트로 몰아쳐서 요금을 태우진 못하는 선.
const SCAN_RATE_LIMIT = 10
const SCAN_RATE_WINDOW_MS = 60 * 60 * 1000
const CARD_SCAN_MODEL = 'claude-haiku-4-5'

const CARD_SCAN_PROMPT = `이 이미지는 일본판 포켓몬 카드 사진이다. 카드에 인쇄된 정보를 읽어서 아래 JSON 형식으로만 답하라. 다른 설명은 절대 붙이지 마라.

{"found": true, "pokemonNameJa": "카드에 적힌 포켓몬/카드 이름(일본어 그대로)", "setCode": "카드 왼쪽 아래 등에 있는 세트 코드(예: SV2a, M5). 안 보이면 null", "cardNumber": "카드 번호(예: 025/165). 안 보이면 null"}

카드가 안 보이거나 포켓몬 카드가 아니면 {"found": false} 로만 답하라.`

// 휴대폰 카메라로 카드를 찍으면 Claude 비전으로 카드 이름/세트코드/번호를 읽어서
// 우리 검색 파이프라인에 바로 꽂을 수 있게 돌려준다. 이미지 매칭 DB를 직접 구축하는
// 대신, 카드에 이미 인쇄되어 있는 텍스트를 읽는 방식이라 훨씬 가볍고 정확하다.
function mountCardScan(app: Mountable, apiKey: string) {
  const allow = rateLimiter(SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_MS)

  app.use('/api/local/scan-card', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    // 카드 인식은 캐시가 없어서 호출이 곧 요금이다. 로그인을 걸어 막을 수도 있지만
    // 시세 조회는 비로그인도 되는 게 의도라, 대신 횟수로 막는다.
    if (!allow(req)) {
      tooManyRequests(res)
      return
    }
    if (!apiKey) {
      res.statusCode = 501
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }))
      return
    }

    try {
      // 카드 사진이 base64로 담겨 오므로 기본 상한(64KB)으로는 정상 요청도 막힌다.
      // base64는 원본보다 약 1/3 커지니, 폰 사진 한 장을 넉넉히 받을 만큼만 연다.
      const body = JSON.parse(await readBody(req, MAX_IMAGE_BODY_BYTES)) as {
        image?: string
        mediaType?: string
      }
      if (!body.image || !body.mediaType) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'image and mediaType are required' }))
        return
      }

      const upstream = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: CARD_SCAN_MODEL,
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.image } },
                { type: 'text', text: CARD_SCAN_PROMPT },
              ],
            },
          ],
        }),
      })

      if (!upstream.ok) {
        const errText = await upstream.text()
        res.statusCode = 502
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'upstream_fetch_failed', detail: errText.slice(0, 300) }))
        return
      }

      const data = (await upstream.json()) as { content?: { type: string; text?: string }[] }
      const text = data.content?.find((c) => c.type === 'text')?.text ?? ''
      const match = text.match(/\{[\s\S]*\}/)

      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(match ? match[0] : JSON.stringify({ found: false }))
    } catch {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'scan_failed' }))
    }
  })
}

const USERS_FILE = dataFile('users.json')
const SESSIONS_FILE = dataFile('sessions.json')
const COLLECTIONS_FILE = dataFile('collections.json')
const SESSION_COOKIE = 'pokegre_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STATE_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_STATES = 10_000
const RECENT_LIMIT = 20
const FAVORITES_LIMIT = 500

// 카드 참조. 클라이언트의 StoredCardRef와 같은 모양이다 — 가격 같은 변하는 값은
// 저장하지 않고 볼 때 조회하므로 사용자당 1KB도 안 된다.
interface CardRef {
  apparelId: number
  category: string
}

interface Collections {
  favorites: CardRef[]
  recent: CardRef[]
}

interface User {
  // 카카오 회원번호. 우리가 저장하는 유일한 카카오 정보다 — 카톡 닉네임/프로필/이메일은
  // 동의항목에서 요청하지 않아 애초에 넘어오지 않는다.
  kakaoId: string
  nickname: string | null
  createdAt: number
}

interface Session {
  token: string
  kakaoId: string
  expiresAt: number
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

// 사용자/세션 저장소는 authPlugin과 communityPlugin이 함께 쓴다. 플러그인마다 캐시를
// 따로 두면 한쪽에서 쓴 내용을 다른 쪽이 못 봐서 로그인해도 글이 안 써지는 식으로 갈린다.
let users: User[] | null = null
let sessions: Session[] | null = null

async function loadUsers(): Promise<User[]> {
  if (users) return users
  try {
    users = JSON.parse(await readFile(USERS_FILE, 'utf-8'))
  } catch {
    users = []
  }
  return users!
}

async function persistUsers() {
  await mkdir(path.dirname(USERS_FILE), { recursive: true })
  await writeFile(USERS_FILE, JSON.stringify(users))
}

async function loadSessions(): Promise<Session[]> {
  if (sessions) return sessions
  try {
    sessions = JSON.parse(await readFile(SESSIONS_FILE, 'utf-8'))
  } catch {
    sessions = []
  }
  return sessions!
}

async function persistSessions() {
  // 만료된 세션은 쌓이기만 하므로 저장할 때마다 걸러낸다.
  sessions = (sessions ?? []).filter((s) => s.expiresAt > Date.now())
  await mkdir(path.dirname(SESSIONS_FILE), { recursive: true })
  await writeFile(SESSIONS_FILE, JSON.stringify(sessions))
}

// 카카오 회원번호 → 컬렉션. 즐겨찾기/최근 본 카드를 계정에 묶어 기기가 바뀌거나
// 브라우저 캐시를 지워도 남게 한다(비로그인은 계속 localStorage를 쓴다).
let collections: Record<string, Collections> | null = null

async function loadCollections(): Promise<Record<string, Collections>> {
  if (collections) return collections
  try {
    collections = JSON.parse(await readFile(COLLECTIONS_FILE, 'utf-8'))
  } catch {
    collections = {}
  }
  return collections!
}

async function persistCollections() {
  await mkdir(path.dirname(COLLECTIONS_FILE), { recursive: true })
  await writeFile(COLLECTIONS_FILE, JSON.stringify(collections))
}

async function getCollections(kakaoId: string): Promise<Collections> {
  const all = await loadCollections()
  if (!all[kakaoId]) all[kakaoId] = { favorites: [], recent: [] }
  return all[kakaoId]
}

// 클라이언트가 보낸 값을 그대로 믿지 않는다. 카드 참조 외의 필드를 끼워넣거나
// 목록을 무한정 키우는 걸 막는다.
function sanitizeRefs(input: unknown, limit: number): CardRef[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<number>()
  const out: CardRef[] = []
  for (const item of input) {
    const apparelId = Number((item as CardRef)?.apparelId)
    if (!Number.isInteger(apparelId) || apparelId <= 0 || seen.has(apparelId)) continue
    const category = String((item as CardRef)?.category ?? 'card')
    seen.add(apparelId)
    out.push({ apparelId, category: ['box', 'card', 'other'].includes(category) ? category : 'card' })
    if (out.length >= limit) break
  }
  return out
}

async function currentUser(req: import('node:http').IncomingMessage): Promise<User | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (!token) return null
  const all = await loadSessions()
  const session = all.find((s) => s.token === token && s.expiresAt > Date.now())
  if (!session) return null
  return (await loadUsers()).find((u) => u.kakaoId === session.kakaoId) ?? null
}

function sendJson(res: import('node:http').ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}

// 카카오는 로그인(본인 확인)에만 쓰고, 화면에 보이는 닉네임은 사용자가 직접 정한다.
// 그래서 동의항목 없이 회원번호만 받으며, 카톡 프로필은 저장하지 않는다.
// 카카오에 넘기는 redirect_uri를 만들 기준 주소. 예전엔 localhost:5173이 박혀 있어서
// 배포하면 카카오가 사용자를 로컬 주소로 돌려보내 로그인이 끊긴다.
//
// 배포 환경에서는 PUBLIC_ORIGIN을 명시한다. Host 헤더로만 만들면 요청자가 바꿔 넣을 수
// 있는 값에 의존하게 되는데, 카카오가 등록된 URI 목록과 대조하니 그것만으로 뚫리진
// 않더라도 굳이 남의 입력을 신뢰할 이유가 없다. 개발에서는 값이 없으니 헤더에서 만든다.
function publicOrigin(req: IncomingMessage): string {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN
  // 프록시 뒤(Fly 등)에서는 실제 프로토콜이 x-forwarded-proto로 온다. 값이 여러 개면
  // 첫 번째가 원 요청의 것이다.
  const forwarded = req.headers['x-forwarded-proto']
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ?? 'http'
  const host = req.headers.host ?? 'localhost:5173'
  return `${proto}://${host}`
}

// 세션 쿠키 속성. Secure를 무조건 붙이면 개발(http://localhost)에서 브라우저가 쿠키를
// 아예 저장하지 않아 로그인이 조용히 안 된다. 그래서 실제 스킴을 보고 붙인다.
// force_https가 있어도 Secure는 필요하다 — http://로 오는 첫 요청에 브라우저가 쿠키를
// 실어 보낸 뒤에야 리다이렉트되므로, 그 한 번이 평문으로 나간다.
function sessionCookie(req: IncomingMessage, value: string, maxAgeSeconds: number): string {
  const secure = publicOrigin(req).startsWith('https://') ? '; Secure' : ''
  return `${SESSION_COOKIE}=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`
}

function mountAuth(app: Mountable, restApiKey: string, clientSecret: string) {
  // state는 CSRF 방지용 일회성 값이라 파일에 남길 필요가 없다. 다만 Set으로 두면
  // 콜백이 돌아올 때만 지워져서, 로그인하다 그만두면 영원히 남는다. 인증도 필요 없는
  // /kakao를 반복 호출해 메모리를 불릴 수 있으므로 만료를 붙인다. 카카오 로그인 화면에
  // 머무는 시간을 감안해도 10분이면 넉넉하다.
  const pendingStates = new TtlCache<true>(STATE_TTL_MS, MAX_PENDING_STATES)

  app.use('/api/local/auth', async (req, res) => {
    const origin = publicOrigin(req)
    const url = new URL(req.url ?? '', origin)
    const segments = url.pathname.split('/').filter(Boolean)
    const redirectUri = `${origin}/api/local/auth/kakao/callback`

    try {
      // GET /me — 로그인 상태 확인
      if (segments[0] === 'me') {
        const user = await currentUser(req)
        // kakaoId는 내려주지 않는다 — 회원번호가 클라이언트로 새면 추적에 쓰일 수 있다.
        // isAdmin은 메뉴를 보여줄지 정하는 용도일 뿐이고, 실제 차단은 서버가 한다.
        sendJson(
          res,
          200,
          user
            ? { loggedIn: true, nickname: user.nickname, createdAt: user.createdAt, isAdmin: isAdmin(user) }
            : { loggedIn: false },
        )
        return
      }

      // POST /logout
      if (segments[0] === 'logout') {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
        if (token) {
          sessions = (await loadSessions()).filter((s) => s.token !== token)
          await persistSessions()
        }
        res.setHeader('set-cookie', sessionCookie(req, '', 0))
        sendJson(res, 200, { ok: true })
        return
      }

      // POST /nickname — 최초 로그인 시 표시 닉네임 설정
      if (segments[0] === 'nickname' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { nickname?: string }
        const nickname = body.nickname?.trim()
        if (!nickname || nickname.length > 20) {
          sendJson(res, 400, { error: 'nickname must be 1-20 chars' })
          return
        }
        const all = await loadUsers()
        if (all.some((u) => u.nickname === nickname && u.kakaoId !== user.kakaoId)) {
          sendJson(res, 409, { error: 'nickname taken' })
          return
        }
        user.nickname = nickname
        await persistUsers()
        sendJson(res, 200, { nickname })
        return
      }

      // GET /collections — 계정에 저장된 즐겨찾기/최근 본 카드
      if (segments[0] === 'collections' && req.method === 'GET') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        sendJson(res, 200, await getCollections(user.kakaoId))
        return
      }

      // PUT /collections — 목록 전체를 덮어쓴다. 하트를 누를 때마다 호출되므로
      // 부분 갱신보다 단순하고, 참조뿐이라 크기도 작다.
      if (segments[0] === 'collections' && req.method === 'PUT') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { favorites?: unknown; recent?: unknown }
        const store = await getCollections(user.kakaoId)
        if (body.favorites !== undefined) store.favorites = sanitizeRefs(body.favorites, FAVORITES_LIMIT)
        if (body.recent !== undefined) store.recent = sanitizeRefs(body.recent, RECENT_LIMIT)
        await persistCollections()
        sendJson(res, 200, store)
        return
      }

      // POST /collections/merge — 로그인 직후, 비로그인 상태에서 담아둔 것을
      // 계정으로 합친다. 이게 없으면 로그인하는 순간 그동안 찜한 게 사라져 보인다.
      if (segments[0] === 'collections' && segments[1] === 'merge' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { favorites?: unknown; recent?: unknown }
        const store = await getCollections(user.kakaoId)
        // 계정 쪽을 앞에 둬서, 기존에 쓰던 순서가 로컬 것 때문에 밀리지 않게 한다.
        store.favorites = sanitizeRefs([...store.favorites, ...(Array.isArray(body.favorites) ? body.favorites : [])], FAVORITES_LIMIT)
        store.recent = sanitizeRefs([...store.recent, ...(Array.isArray(body.recent) ? body.recent : [])], RECENT_LIMIT)
        await persistCollections()
        sendJson(res, 200, store)
        return
      }

      if (!restApiKey || !clientSecret) {
        sendJson(res, 501, { error: 'KAKAO_REST_API_KEY / KAKAO_CLIENT_SECRET not configured' })
        return
      }

      // GET /kakao — 카카오 인증 페이지로 보낸다
      if (segments[0] === 'kakao' && segments.length === 1) {
        const state = randomUUID()
        pendingStates.set(state, true)
        const authUrl = new URL('https://kauth.kakao.com/oauth/authorize')
        authUrl.searchParams.set('client_id', restApiKey)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('state', state)
        res.statusCode = 302
        res.setHeader('location', authUrl.toString())
        res.end()
        return
      }

      // GET /kakao/callback — 카카오가 code를 들고 돌아오는 곳
      if (segments[0] === 'kakao' && segments[1] === 'callback') {
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        // state가 없거나 우리가 발급한 게 아니면 CSRF 시도로 보고 거절한다.
        if (!code || !state || !pendingStates.get(state)) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }
        pendingStates.delete(state)

        const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: restApiKey,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          }).toString(),
        })
        if (!tokenRes.ok) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }
        const { access_token } = (await tokenRes.json()) as { access_token?: string }
        if (!access_token) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }

        // 동의항목을 요청하지 않았으므로 응답의 id(회원번호)만 쓴다.
        const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { authorization: `Bearer ${access_token}` },
        })
        if (!meRes.ok) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }
        const kakaoId = String(((await meRes.json()) as { id?: number | string }).id ?? '')
        if (!kakaoId) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }

        const all = await loadUsers()
        let user = all.find((u) => u.kakaoId === kakaoId)
        if (!user) {
          user = { kakaoId, nickname: null, createdAt: Date.now() }
          all.push(user)
          await persistUsers()
        }

        const token = randomUUID()
        ;(await loadSessions()).push({ token, kakaoId, expiresAt: Date.now() + SESSION_TTL_MS })
        await persistSessions()

        // httpOnly라 JS로 못 읽는다(XSS로 세션 탈취 방지).
        res.setHeader('set-cookie', sessionCookie(req, token, SESSION_TTL_MS / 1000))
        res.statusCode = 302
        // 닉네임이 없으면 최초 로그인 → 설정 화면을 띄우게 한다.
        res.setHeader('location', user.nickname ? '/' : '/?setNickname=1')
        res.end()
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch {
      sendJson(res, 500, { error: 'auth failed' })
    }
  })
}

// 개발(vite)과 프로덕션(Express)이 똑같이 이걸 부른다. 여기 순서가 곧 라우팅
// 순서이므로 양쪽이 갈리지 않는다 — 이 함수 하나만 유지하면 된다.
export function mountApi(app: Mountable, env: ApiEnv) {
  adminKakaoIds = new Set(
    (env.ADMIN_KAKAO_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
  mountSnkrdunkProxy(app)
  mountSearchTracker(app)
  mountKoreanNews(app)
  mountExchangeRate(app)
  mountCommunity(app)
  mountEbayPrice(app, env.POKEMON_PRICE_TRACKER_API_KEY ?? '')
  mountCardScan(app, env.ANTHROPIC_API_KEY ?? '')
  mountAuth(app, env.KAKAO_REST_API_KEY ?? '', env.KAKAO_CLIENT_SECRET ?? '')
}
