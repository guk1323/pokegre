import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SNKRDUNK_ORIGIN = 'https://snkrdunk.com'
const CACHE_TTL_MS = 5 * 60 * 1000

function snkrdunkProxyPlugin(): Plugin {
  const cache = new Map<string, { body: string; status: number; contentType: string; expires: number }>()

  return {
    name: 'snkrdunk-proxy',
    configureServer(server) {
      server.middlewares.use('/api/snkrdunk', async (req, res) => {
        const path = req.url ?? ''
        const cached = cache.get(path)
        const now = Date.now()

        if (cached && cached.expires > now) {
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
          cache.set(path, { body, status: upstream.status, contentType, expires: now + CACHE_TTL_MS })
          res.statusCode = upstream.status
          res.setHeader('content-type', contentType)
          res.end(body)
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'upstream_fetch_failed' }))
        }
      })
    },
  }
}

const KOREAN_NEWS_ORIGIN = 'https://pokemoncard.co.kr'
const KOREAN_NEWS_CACHE_TTL_MS = 30 * 60 * 1000

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

function koreanNewsPlugin(): Plugin {
  const cache = new Map<string, { body: string; expires: number }>()

  return {
    name: 'korean-news-proxy',
    configureServer(server) {
      server.middlewares.use('/api/local/pokemon-news', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const page = url.searchParams.get('page') ?? '1'
        const cacheKey = page
        const cached = cache.get(cacheKey)
        const now = Date.now()

        if (cached && cached.expires > now) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(cached.body)
          return
        }

        try {
          const form = new URLSearchParams({ pn: page, cate: '2', sword: '', rcode: 'menu_news' })
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
          cache.set(cacheKey, { body, expires: now + KOREAN_NEWS_CACHE_TTL_MS })
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(body)
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'upstream_fetch_failed' }))
        }
      })
    },
  }
}

const POSTS_FILE = path.resolve(__dirname, 'data/community-posts.json')
const COMMENTS_FILE = path.resolve(__dirname, 'data/community-comments.json')
const REPORTS_FILE = path.resolve(__dirname, 'data/community-reports.json')
const MAX_POSTS = 500

interface CommunityPost {
  id: number
  title: string
  author: string
  content: string
  createdAt: number
  commentCount: number
}

interface CommunityComment {
  id: number
  postId: number
  author: string
  content: string
  createdAt: number
}

interface CommunityReport {
  id: number
  targetType: 'post' | 'comment'
  postId: number
  commentId: number | null
  reason: string
  createdAt: number
}

// 로그인 없이 누구나 글을 쓸 수 있는 자유게시판. 계정 시스템이 없어서 닉네임은
// 그냥 텍스트로만 받고(클라이언트가 localStorage에 기억해뒀다 재사용), 글/댓글은
// 검색어 집계와 같은 방식으로 로컬 JSON 파일에 저장한다.
// 신고 접수는 아직 별도 관리자 화면이 없어서, data/community-reports.json에 쌓아두고
// 운영자가 주기적으로 파일을 확인해 삭제 여부를 판단하는 방식으로 최소한의 신고
// 창구만 우선 마련한다(정보통신망법상 불법정보 신고 접수 창구 요건 대응).
function communityPlugin(): Plugin {
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

  return {
    name: 'community',
    configureServer(server) {
      server.middlewares.use('/api/local/community', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const segments = url.pathname.split('/').filter(Boolean)

        try {
          // /posts
          if (segments.length === 1 && segments[0] === 'posts' && req.method === 'GET') {
            const all = await loadPosts()
            sendJson(res, 200, [...all].sort((a, b) => b.createdAt - a.createdAt))
            return
          }

          if (segments.length === 1 && segments[0] === 'posts' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as { title?: string; author?: string; content?: string }
            const title = body.title?.trim()
            const content = body.content?.trim()
            const author = body.author?.trim() || '익명'
            if (!title || !content) {
              sendJson(res, 400, { error: 'title and content are required' })
              return
            }
            const all = await loadPosts()
            const post: CommunityPost = {
              id: Date.now(),
              title,
              author,
              content,
              createdAt: Date.now(),
              commentCount: 0,
            }
            all.push(post)
            if (all.length > MAX_POSTS) all.splice(0, all.length - MAX_POSTS)
            await persistPosts()
            sendJson(res, 201, post)
            return
          }

          // /posts/:id
          if (segments.length === 2 && segments[0] === 'posts' && req.method === 'GET') {
            const id = Number(segments[1])
            const all = await loadPosts()
            const post = all.find((p) => p.id === id)
            if (!post) {
              sendJson(res, 404, { error: 'not found' })
              return
            }
            sendJson(res, 200, post)
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
              const all = await loadComments()
              sendJson(
                res,
                200,
                all.filter((c) => c.postId === postId).sort((a, b) => a.createdAt - b.createdAt),
              )
              return
            }

            if (req.method === 'POST') {
              const body = JSON.parse(await readBody(req)) as { author?: string; content?: string }
              const content = body.content?.trim()
              const author = body.author?.trim() || '익명'
              if (!content) {
                sendJson(res, 400, { error: 'content is required' })
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
                author,
                content,
                createdAt: Date.now(),
              }
              allComments.push(comment)
              post.commentCount += 1
              await persistComments()
              await persistPosts()
              sendJson(res, 201, comment)
              return
            }
          }

          sendJson(res, 404, { error: 'not found' })
        } catch {
          sendJson(res, 400, { error: 'bad request' })
        }
      })
    },
  }
}

const SEARCH_COUNTS_FILE = path.resolve(__dirname, 'data/search-counts.json')
const SNAPSHOT_FILE = path.resolve(__dirname, 'data/search-ranking-snapshot.json')
const MAX_TRACKED_TERMS = 500
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000
const RANKING_SIZE = 10

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
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
function searchTrackerPlugin(): Plugin {
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

  return {
    name: 'search-tracker',
    configureServer(server) {
      server.middlewares.use('/api/local/track-search', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        try {
          const body = JSON.parse(await readBody(req)) as { query?: string }
          const term = body.query?.trim()
          if (term) {
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

      server.middlewares.use('/api/local/popular-searches', async (_req, res) => {
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
    },
  }
}

const PRICE_TRACKER_ORIGIN = 'https://www.pokemonpricetracker.com/api/v2'
const PRICE_TRACKER_CACHE_TTL_MS = 6 * 60 * 60 * 1000

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
function ebayPricePlugin(apiKey: string): Plugin {
  const cache = new Map<string, { body: string; status: number; expires: number }>()

  return {
    name: 'ebay-price-proxy',
    configureServer(server) {
      server.middlewares.use('/api/local/card-prices', async (req, res) => {
        if (!apiKey) {
          res.statusCode = 501
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'POKEMON_PRICE_TRACKER_API_KEY not configured' }))
          return
        }

        const url = new URL(req.url ?? '', 'http://localhost')
        const cacheKey = url.search
        const cached = cache.get(cacheKey)
        const now = Date.now()

        if (cached && cached.expires > now) {
          res.statusCode = cached.status
          res.setHeader('content-type', 'application/json')
          res.end(cached.body)
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
          cache.set(cacheKey, { body, status: 200, expires: now + PRICE_TRACKER_CACHE_TTL_MS })
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(body)
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'upstream_fetch_failed' }))
        }
      })
    },
  }
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const CARD_SCAN_MODEL = 'claude-haiku-4-5'

const CARD_SCAN_PROMPT = `이 이미지는 일본판 포켓몬 카드 사진이다. 카드에 인쇄된 정보를 읽어서 아래 JSON 형식으로만 답하라. 다른 설명은 절대 붙이지 마라.

{"found": true, "pokemonNameJa": "카드에 적힌 포켓몬/카드 이름(일본어 그대로)", "setCode": "카드 왼쪽 아래 등에 있는 세트 코드(예: SV2a, M5). 안 보이면 null", "cardNumber": "카드 번호(예: 025/165). 안 보이면 null"}

카드가 안 보이거나 포켓몬 카드가 아니면 {"found": false} 로만 답하라.`

// 휴대폰 카메라로 카드를 찍으면 Claude 비전으로 카드 이름/세트코드/번호를 읽어서
// 우리 검색 파이프라인에 바로 꽂을 수 있게 돌려준다. 이미지 매칭 DB를 직접 구축하는
// 대신, 카드에 이미 인쇄되어 있는 텍스트를 읽는 방식이라 훨씬 가볍고 정확하다.
function cardScanPlugin(apiKey: string): Plugin {
  return {
    name: 'card-scan',
    configureServer(server) {
      server.middlewares.use('/api/local/scan-card', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        if (!apiKey) {
          res.statusCode = 501
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }))
          return
        }

        try {
          const body = JSON.parse(await readBody(req)) as { image?: string; mediaType?: string }
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
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
      snkrdunkProxyPlugin(),
      searchTrackerPlugin(),
      koreanNewsPlugin(),
      communityPlugin(),
      ebayPricePlugin(env.POKEMON_PRICE_TRACKER_API_KEY ?? ''),
      cardScanPlugin(env.ANTHROPIC_API_KEY ?? ''),
    ],
  }
})
