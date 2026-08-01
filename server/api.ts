import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
// 카드 뽑기: 가격표와 뽑기 로직을 화면과 같은 파일에서 읽는다(가격을 클라이언트 말대로
// 믿으면 예산을 속일 수 있어서, 서버도 같은 표로 차감하고 뽑기도 서버가 한다).
import {
  DAILY_BUDGET,
  FIRST_BONUS,
  MAX_BALANCE,
  MAX_BOX_STASH,
  MAX_STASH,
  SHARE_BONUS,
  STREAK_BONUS,
  STREAK_DAYS,
  isLive,
  packBySlug,
  PPT_SET_NAMES,
} from '../src/lib/packSets.ts'
import { drawBox, drawPack, RARITY_RANK, usableCards, type MirrorFlag, type PackCard } from '../src/lib/packDraw.ts'

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
  NAVER_CLIENT_ID?: string
  NAVER_CLIENT_SECRET?: string
  // 이베이 Browse API(한글판 시세, 호가). App ID(Client ID) / Cert ID(Client Secret).
  EBAY_APP_ID?: string
  EBAY_CERT_ID?: string
  // 운영자의 카카오 회원번호. 쉼표로 여럿 넣을 수 있다.
  ADMIN_KAKAO_IDS?: string
  // 피드백을 받을 카카오 오픈톡 링크. 비어 있으면 화면에 버튼이 안 뜬다.
  OPENCHAT_URL?: string
}

// 화면에 공개해도 되는 설정만 담는다. 비밀 키는 절대 넣지 않는다.
let publicConfig: { openChatUrl: string | null } = { openChatUrl: null }

function mountConfig(app: Mountable) {
  app.use('/api/local/config', (_req, res) => {
    sendJson(res, 200, publicConfig)
  })
}

// 운영자는 회원 정보에 표시하지 않고 환경변수로 지정한다. 회원 정보에 두면 운영자를
// 세우려고 서버 안의 파일을 직접 고쳐야 하는데, 그러자고 프로덕션 서버에 들어가는 건
// 위험하다. 환경변수면 fly secrets로 바꾸면 되고 값이 코드에도 안 남는다.
//
// 비어 있으면 아무도 운영자가 아니다 — 실수로 설정을 빠뜨렸을 때 모두가 운영자가
// 되는 것보다 아무도 아닌 게 낫다.
// 접두어를 붙인 형태("kakao:123")로 담는다. 환경변수에는 카카오 회원번호를 그대로
// 적게 두고(사장님이 넣기 쉬우라고) 여기서 붙인다.
let adminIds: Set<string> = new Set()

// ── 점검 모드 ─────────────────────────────────────────────────────────────
// /data/maintenance.on 파일이 있으면 점검 중. 배포 없이 켜고 끌 수 있게 파일 스위치로
// 두고, 서버 진입점(index.ts)이 요청마다 묻는다(5초 캐시라 부담 없음).

let maintCache = { at: 0, on: false }
export async function maintenanceOn(): Promise<boolean> {
  if (Date.now() - maintCache.at < 5_000) return maintCache.on
  let on = false
  try {
    await readFile(path.join(DATA_DIR, 'maintenance.on'))
    on = true
  } catch {
    on = false
  }
  maintCache = { at: Date.now(), on }
  return on
}

// 점검 중에도 운영자는 정상 이용해야 하므로, 진입점이 요청 쿠키로 운영자인지 묻는다.
export async function isAdminRequest(req: import('node:http').IncomingMessage): Promise<boolean> {
  try {
    return isAdmin(await currentUser(req))
  } catch {
    return false
  }
}

function isAdmin(user: User | null): boolean {
  return user != null && adminIds.has(user.id)
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
// 저장 도중에 서버가 죽어도 파일이 반토막 나지 않게 한다.
//
// 지금까지는 파일에 곧바로 덮어썼다. Fly는 배포할 때마다 기계를 새로 띄우는데, 하필
// 쓰는 중에 끊기면 JSON이 잘린 채 남는다. 그러면 다음 기동 때 읽기가 실패하고, 로더는
// 빈 값으로 시작한 뒤 첫 저장에서 그 빈 값을 그대로 덮어쓴다 — 앨범·GP·게시글이
// 통째로, 되돌릴 수 없이 사라진다.
//
// 임시 파일에 다 쓴 뒤 이름만 바꾼다. 이름 바꾸기는 같은 디스크 안에서 쪼개지지 않아,
// 파일은 "이전 것" 아니면 "새 것"이지 반쪽인 상태가 없다.
let writeSeq = 0
async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  // 임시 파일 이름은 매번 달라야 한다. 같은 이름을 쓰면 저장이 겹칠 때 두 요청이
  // 한 파일에 뒤섞여 써서, 정작 그 뒤섞인 내용이 본 파일이 되어 버린다.
  const tmp = `${file}.${process.pid}.${++writeSeq}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value))
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

// 파일이 있는데 못 읽는 경우(내용이 깨졌을 때). 그냥 빈 값으로 시작하면 다음 저장에
// 덮여 영영 사라지므로, 옆으로 치워 두고 이름을 남긴다 — 나중에 손으로 복구할 수 있다.
async function rescueCorrupt(file: string): Promise<void> {
  try {
    await stat(file)
  } catch {
    return // 파일이 아예 없는 것은 정상(첫 실행)
  }
  const moved = `${file}.corrupt-${Date.now()}`
  await rename(file, moved).catch(() => undefined)
  console.error(`[pokegre] ${file}을(를) 읽지 못해 ${moved}로 옮겨 두었습니다. 확인이 필요합니다.`)
}

// 하루 한 번 데이터 파일을 통째로 복사해 둔다.
//
// 안전 저장(writeJsonFile)은 "쓰다 죽는" 경우를 막아줄 뿐, 잘못된 배포나 실수로 지운
// 것까지는 못 막는다. 이 사이트의 데이터는 다 합쳐 몇백 KB이고 볼륨은 900MB가 남아
// 있으므로, 며칠치를 통째로 들고 있는 게 가장 싸고 확실한 보험이다.
const BACKUP_KEEP_DAYS = 7

// 바깥 서비스가 응답을 안 주고 매달릴 때를 대비한 제한 시간. 걸어두지 않으면 Node 기본이
// 5분이라, 그동안 방문자는 로딩 화면만 보고 우리 서버는 연결을 붙잡고 있는다.
// 기계가 512MB짜리 한 대뿐이라 이런 요청이 쌓이면 사이트 전체가 느려진다.
const UPSTREAM_TIMEOUT_MS = 8000 // 시세·목록처럼 보통 1초 안에 오는 것
const UPSTREAM_SLOW_MS = 15000 // 이미지·이베이 검색처럼 더 걸릴 수 있는 것
const SCAN_TIMEOUT_MS = 45000 // 사진 인식(Claude)은 원래 오래 걸린다
export async function backupDataFiles(): Promise<void> {
  const dir = path.join(DATA_DIR, 'backups')
  const today = kstDayKey(Date.now())
  const target = path.join(dir, today)
  try {
    await mkdir(target, { recursive: true })
    // card-names.json은 공유 링크 제목에 쓰는 캐시라 잃어도 다시 모이면 그만이다.
    // 백업은 잃으면 되돌릴 수 없는 것(회원·글·앨범)만 담는다.
    const names = (await readdir(DATA_DIR)).filter((n) => n.endsWith('.json') && n !== 'card-names.json')
    for (const name of names) {
      const body = await readFile(path.join(DATA_DIR, name), 'utf-8').catch(() => null)
      if (body == null) continue
      await writeFile(path.join(target, name), body)
    }
    // 오래된 날짜 폴더 정리.
    const days = (await readdir(dir)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
    for (const old of days.slice(0, Math.max(0, days.length - BACKUP_KEEP_DAYS))) {
      await rm(path.join(dir, old), { recursive: true, force: true }).catch(() => undefined)
    }
  } catch (err) {
    // 백업 실패로 서비스가 멈추면 안 된다. 남겨만 두고 계속 간다.
    console.error('[pokegre] 백업에 실패했습니다.', err)
  }
}

// 저장소 파일의 "첫 읽기"를 하나로 묶는다.
//
// 지연 로더는 보통 `if (캐시) return 캐시` 뒤에서 파일을 읽는데, 서버가 막 뜬 직후
// 같은 요청이 여러 개 겹치면 전부 그 검사를 통과해 각자 파일을 읽는다. 그러면 서로
// 다른 사본을 하나씩 들고 각자 고친 뒤 저장하므로, 마지막에 저장한 것만 남고 앞선
// 변경은 소리 없이 사라진다(출석을 동시에 8번 누르면 8번 다 "받았습니다"라고
// 답하면서 실제로는 한 번만 들어가는 것을 재현해 확인했다).
//
// 첫 읽기를 약속(Promise) 하나로 묶어 두면 겹쳐 들어온 요청이 모두 같은 결과를 쓴다.
const firstReads = new Map<string, Promise<unknown>>()
function firstReadOnce<T>(key: string, read: () => Promise<T>): Promise<T> {
  const running = firstReads.get(key) as Promise<T> | undefined
  if (running) return running
  const started = read().finally(() => firstReads.delete(key))
  firstReads.set(key, started)
  return started
}

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
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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

// 카드·세트·작가 썸네일을 우리(도쿄) 서버가 직접 캐시해 쏜다. 예전엔 클라이언트가
// 유럽 CDN(wsrv.nl)을 매번 직접 불러 장당 0.4초씩 걸렸는데, 그걸 이 프록시로 바꿔
// ① 처음 한 번만 wsrv로 축소본을 받아 ② 서버 메모리에 캐시하고 ③ 이후엔 도쿄에서
// 바로 쏜다. 브라우저에도 장기 캐시를 걸어(아래 Cache-Control), 재방문 땐 서버도 안
// 거치고 즉시 뜬다. wsrv가 리사이즈를 대신 해줘서 서버에 이미지 라이브러리가 필요 없다.
//
// 오픈 프록시로 아무 URL이나 대신 받아주면 남이 우리를 대역폭 중계로 악용할 수 있어,
// 우리가 실제로 쓰는 이미지 호스트만 화이트리스트로 허용한다.
const IMG_ALLOWED_HOSTS = new Set([
  'cdn.snkrdunk.com',
  'assets.tcgdex.net',
  'images.tcgdex.net',
  'limitlesstcg.nyc3.cdn.digitaloceanspaces.com',
  's3.limitlesstcg.com',
  'den-cards.pokellector.com',
  'tcgplayer-cdn.tcgplayer.com',
  'images.pokemontcg.io',
  'images.scrydex.com',
  // 한글판 카드 그림(포켓몬코리아 공식). wmimages라 워터마크가 박혀 있는 형태 그대로다.
  'cards.image.pokemonkorea.co.kr',
  'www.artofpkm.com', // 옛 일본판(e-Card·PCG) 공식 스캔. cdn.artofpkm.com으로 302됨
  'cdn.artofpkm.com',
  'i.ebayimg.com', // 이베이 한글판 매물 사진(Browse API)
])
// 썸네일은 장당 수 KB라, 800장이면 최대 수십 MB 정도다(512MB 램에 안전한 상한).
const IMG_CACHE_MAX = 800
const IMG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function mountImageProxy(app: Mountable) {
  const cache = new TtlCache<{ body: Buffer; contentType: string }>(IMG_CACHE_TTL_MS, IMG_CACHE_MAX)
  // 같은 이미지를 동시에 여러 명이 처음 요청하면 wsrv를 여러 번 부르지 않게 진행 중인
  // 요청을 공유한다(중복 방지).
  const inflight = new Map<string, Promise<{ body: Buffer; contentType: string } | null>>()

  async function fetchThumb(url: string, w: number): Promise<{ body: Buffer; contentType: string } | null> {
    const bare = url.replace(/^https?:\/\//, '')
    // 스니커덩크의 배경제거 이미지는 1000x730 가로 캔버스 한가운데에 카드가 43%만
    // 차지하도록 들어 있다. 그대로 쓰면 목록에서 카드가 작게 보이고 둘레가 텅 빈다.
    // 투명한 여백을 잘라내면 카드가 틀을 꽉 채운다(320x234 → 320x449로 확인).
    // 다른 곳 이미지(TCGdex·TCGplayer 등)는 여백이 없거나 흰 바탕이라 자르면 카드
    // 테두리까지 깎일 수 있어 건드리지 않는다.
    const trimmable = /(^|\.)snkrdunk\.com\/upload_bg_removed\//.test(bare)
    const wsrv = `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=${w}&output=webp&q=72${trimmable ? '&trim=10' : ''}`
    try {
      const r = await fetch(wsrv, {
        signal: AbortSignal.timeout(UPSTREAM_SLOW_MS),
        headers: { 'user-agent': 'pokegre-img/0.1' },
      })
      if (!r.ok) return null
      const buf = Buffer.from(await r.arrayBuffer())
      return { body: buf, contentType: r.headers.get('content-type') ?? 'image/webp' }
    } catch {
      return null
    }
  }

  app.use('/api/img', async (req, res) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const u = url.searchParams.get('u') ?? ''
    const w = Math.min(1024, Math.max(16, parseInt(url.searchParams.get('w') ?? '256', 10) || 256))
    // 호스트 검증: 허용 목록 밖이면 거절(오픈 프록시 악용 차단).
    let target: URL
    try {
      target = new URL(u)
    } catch {
      res.statusCode = 400
      res.end('bad url')
      return
    }
    if (target.protocol !== 'https:' || !IMG_ALLOWED_HOSTS.has(target.hostname)) {
      res.statusCode = 403
      res.end('host not allowed')
      return
    }

    const key = `${w}|${u}`
    const serve = (hit: { body: Buffer; contentType: string }) => {
      res.statusCode = 200
      res.setHeader('content-type', hit.contentType)
      // 브라우저·중간 캐시가 1주일 보관. immutable이라 그 안엔 재검증도 안 한다.
      res.setHeader('cache-control', 'public, max-age=604800, immutable')
      res.end(hit.body)
    }

    const cached = cache.get(key)
    if (cached) {
      serve(cached)
      return
    }

    let job = inflight.get(key)
    if (!job) {
      job = fetchThumb(u, w).then((r) => {
        if (r) cache.set(key, r)
        inflight.delete(key)
        return r
      })
      inflight.set(key, job)
    }
    const result = await job
    if (!result) {
      // wsrv 실패: 원본으로 리다이렉트해 화면이 비지 않게 한다.
      res.statusCode = 302
      res.setHeader('location', u)
      res.end()
      return
    }
    serve(result)
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
      const upstream = await fetch(`${EXCHANGE_ORIGIN}/latest?base=USD&symbols=KRW,JPY`, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
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
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
// ── 게시글 사진 ───────────────────────────────────────────────────────────
// 사진은 /data/uploads에 파일로 두고 글에는 주소만 담는다(글 JSON에 이미지를 넣으면
// 목록을 부를 때마다 통째로 딸려와 무거워진다). 볼륨에 쌓이므로 장수·용량을 막는다.
const UPLOAD_DIR = dataFile('uploads')
const MAX_POST_IMAGES = 4 // 글 하나에 붙일 수 있는 사진 수
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // 원본 4MB까지(폰 사진 한 장 여유)
const UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// 볼륨은 1GB뿐이라 사진이 무한정 쌓이면 서버가 멈춘다. 두 겹으로 막는다:
// ① 사람마다 한 시간에 올릴 수 있는 장수 ② 폴더 전체 용량.
const UPLOAD_PER_HOUR = 20
const UPLOAD_DIR_MAX_BYTES = 300 * 1024 * 1024
const uploadLog = new Map<string, number[]>() // 회원 → 최근 업로드 시각
// 이 표는 한 시간짜리 기록인데 회원 칸 자체는 지워지지 않아, 사진을 한 번이라도 올린
// 사람이 늘어나는 만큼 계속 쌓인다(512MB짜리 작은 기계라 새는 곳은 다 막는 게 낫다).
// 칸이 많아지면 오래된 기록만 남은 칸을 통째로 지운다.
const UPLOAD_LOG_SWEEP_AT = 500
function sweepUploadLog(now: number) {
  if (uploadLog.size < UPLOAD_LOG_SWEEP_AT) return
  for (const [id, times] of uploadLog) {
    if (times.every((t) => now - t >= 3600_000)) uploadLog.delete(id)
  }
}

// 글에서 떨어져 나온 사진 파일을 지운다(글 삭제·수정으로 더 안 쓰이는 것).
async function removeUploads(urls: string[] | undefined) {
  for (const u of urls ?? []) {
    const name = u.replace(/^\/uploads\//, '')
    if (!/^[\w.-]+$/.test(name)) continue
    await rm(path.join(UPLOAD_DIR, name), { force: true }).catch(() => undefined)
  }
}

async function uploadDirBytes(): Promise<number> {
  try {
    const files = await readdir(UPLOAD_DIR)
    let total = 0
    for (const f of files) total += (await stat(path.join(UPLOAD_DIR, f)).catch(() => null))?.size ?? 0
    return total
  } catch {
    return 0
  }
}

const MAX_POSTS = 500
// 글 하나가 볼륨을 채우지 못하게 막는 상한. 게시글 500개가 전부 상한을 채워도
// 25MB 정도라 1GB 볼륨에 여유가 크다.
const MAX_TITLE_LENGTH = 200
const MAX_CONTENT_LENGTH = 50_000
const MAX_COMMENT_LENGTH = 2_000

// 작성자 닉네임은 글에 저장하지 않는다. 저장해두면 나중에 닉네임을 바꿔도 옛 글에는
// 옛 이름이 박힌 채로 남아, 같은 사람이 두 사람처럼 보인다. authorId만 남기고 닉네임은
// 매번 조회해서 채운다.
// 게시판 종류. 서버가 값을 정하므로 클라이언트가 아무 문자열이나 보내도 free로 떨어진다.
type PostCategory = 'free' | 'question' | 'suggestion' | 'pulls'
const POST_CATEGORIES: PostCategory[] = ['free', 'question', 'suggestion', 'pulls']

interface CommunityPost {
  id: number
  title: string
  // 작성자가 올린 사진 주소(/uploads/…). 없으면 필드 자체가 없다.
  images?: string[]
  // 어느 게시판 글인지. 이 필드가 없던 시절 글은 전부 자유게시판으로 본다.
  category: PostCategory
  // 작성자 카카오 회원번호. 화면에는 절대 내보내지 않고, 닉네임 조회와 본인 글 여부
  // 판별에만 쓴다.
  authorId: string
  content: string
  createdAt: number
  // 마지막으로 고친 시각. 고친 적 없으면 없다. 화면에 "(수정됨)"을 붙이는 데만 쓴다.
  editedAt?: number
  // 운영자가 공지로 고정한 시각. 고정한 글은 게시판과 무관하게 모든 목록 맨 위에
  // "공지"로 뜬다. 안 고정했으면 없다.
  pinnedAt?: number
  // 좋아요를 누른 회원번호 목록. 한 사람이 한 번만 누르게 하려면 누가 눌렀는지를
  // 알아야 한다. authorId와 마찬가지로 회원번호라 화면에는 개수만 내보내고 목록은
  // 절대 내보내지 않는다.
  likedBy: string[]
  commentCount: number
  // 글을 열어 본 횟수. 한 사람이 여러 번 봐도 한 번만 센다(운영자 조회는 빼서 부풀지
  // 않게). 없던 시절 글은 0으로 본다.
  viewCount?: number
  // 이 글을 이미 본 회원번호 목록. 새로고침이나 재방문으로 조회수가 부풀지 않게 하려면
  // 누가 봤는지를 알아야 한다. likedBy·authorId와 마찬가지로 회원번호라 화면에는 절대
  // 내보내지 않는다(toPublicPost에서 뺀다).
  viewedBy?: string[]
  // 팩 개봉 자랑글에만 붙는 카드 목록. 커뮤니티 화면이 이걸로 실제 카드 이미지를
  // 그려 준다(스크린샷 업로드 없이도 "그 뽑은 화면"이 그대로 보인다).
  pull?: { pack: string; god: boolean; total?: number; cards: { img: string; name: string; r: string }[] }
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
  return all.find((u) => u.id === authorId)?.nickname ?? UNKNOWN_AUTHOR
}

const HIDDEN_NOTICE = '신고로 가려진 글입니다.'

// authorId(카카오 회원번호)는 내부 식별용이라 응답에서 제거하고, 대신 "내 글인가"만
// 알려준다. 회원번호가 클라이언트로 새면 사용자 추적에 쓰일 수 있다.
//
// 가려진 글의 원문은 아예 응답에 담지 않는다. 화면에서 가리기만 하면 개발자도구나
// 주소창으로 그대로 볼 수 있어서 가린 게 아니게 된다. 운영자에게만 원문을 보낸다.
function toPublicPost(post: CommunityPost, viewer: User | null, all: User[]) {
  // likedBy는 회원번호 목록이라 authorId와 마찬가지로 응답에서 빼고, 개수와 "내가
  // 눌렀는지"만 내보낸다.
  const { authorId, hiddenAt, likedBy, pinnedAt, viewedBy: _viewedBy, ...rest } = post
  const hidden = hiddenAt != null && !isAdmin(viewer)
  return {
    ...rest,
    title: hidden ? HIDDEN_NOTICE : rest.title,
    content: hidden ? HIDDEN_NOTICE : rest.content,
    pull: hidden ? undefined : rest.pull,
    images: hidden ? undefined : rest.images,
    author: authorName(authorId, all),
    authorIsAdmin: adminIds.has(authorId),
    isMine: viewer != null && authorId === viewer.id,
    isHidden: hiddenAt != null,
    likeCount: likedBy.length,
    liked: viewer != null && likedBy.includes(viewer.id),
    isPinned: pinnedAt != null,
  }
}

function toPublicComment(comment: CommunityComment, viewer: User | null, all: User[]) {
  const { authorId, hiddenAt, ...rest } = comment
  const hidden = hiddenAt != null && !isAdmin(viewer)
  return {
    ...rest,
    content: hidden ? HIDDEN_NOTICE : rest.content,
    author: authorName(authorId, all),
    authorIsAdmin: adminIds.has(authorId),
    isMine: viewer != null && authorId === viewer.id,
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
  // 누가 신고했는지. 같은 사람이 같은 글을 반복 신고해 목록을 덮는 것을 막는 데만 쓰고
  // 운영자 화면에는 내보내지 않는다. 옛 기록에는 없어서 optional이다.
  reporterId?: string
}

// 신고는 접수 창구라 지우지 않지만, 무한정 쌓이면 파일이 커져 운영 화면이 느려진다.
// 오래된 것부터 잘라 최근 것만 남긴다(다른 피드백 저장소와 같은 방식).
const MAX_REPORTS = 500

// 자유게시판. 읽기는 비로그인도 되지만 쓰기는 로그인이 필요하고, 작성자는 클라이언트가
// 보낸 값이 아니라 세션에서 가져온다(아니면 남의 닉네임을 사칭할 수 있다).
// 신고 접수는 아직 별도 관리자 화면이 없어서, data/community-reports.json에 쌓아두고
// 운영자가 주기적으로 파일을 확인해 삭제 여부를 판단하는 방식으로 최소한의 신고
// 창구만 우선 마련한다(정보통신망법상 불법정보 신고 접수 창구 요건 대응).
// 카드 뽑기 자랑글이 커뮤니티 캐시를 거쳐 글을 넣을 수 있게, mountCommunity가
// 마운트 시점에 이 변수에 등록 함수를 담아둔다(파일 직접 쓰기는 캐시와 어긋난다).
let appendCommunityPost: ((post: CommunityPost) => Promise<void>) | null = null

function mountCommunity(app: Mountable) {
  // 비로그인 손님의 조회 중복 방지. 로그인 회원은 회원번호를 글에 적어 두면 영구히
  // 한 번만 세지지만, 손님은 신원을 남길 수 없어(남기면 안 되고) IP를 메모리에만 잠깐
  // 들고 있는다. 파일에 안 남으므로 배포로 서버가 다시 뜨면 초기화된다 — 손님이 반나절
  // 뒤에 다시 보면 한 번 더 세지는데, 조회수를 "정확한 사람 수"가 아니라 "부풀지 않은
  // 대략치"로 두는 선택이다.
  const GUEST_VIEW_TTL_MS = 12 * 60 * 60 * 1000
  const guestViews = new TtlCache<true>(GUEST_VIEW_TTL_MS, 50_000)
  // 글 하나가 들고 있을 조회자 회원번호의 상한. 넘으면 오래된 것부터 버린다(그 사람이
  // 다시 보면 한 번 더 세진다). 파일이 무한정 커지는 것보다 낫다.
  const MAX_VIEWERS_PER_POST = 3000

  let posts: CommunityPost[] | null = null
  let comments: CommunityComment[] | null = null
  let reports: CommunityReport[] | null = null

  async function loadPosts(): Promise<CommunityPost[]> {
    if (posts) return posts
    return firstReadOnce('posts', async () => {
      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.
      if (posts) return posts
      try {
        // authorId도 회원번호라 접두어를 붙인다. 안 그러면 옛 글의 작성자를 못 찾아
        // 전부 "알 수 없음"이 되고, 본인 글인데도 삭제 버튼이 안 뜬다.
        posts = (JSON.parse(await readFile(POSTS_FILE, 'utf-8')) as CommunityPost[]).map((p) => ({
          ...p,
          authorId: migrateId(p.authorId),
          // 카테고리가 없던 시절 글은 자유게시판으로 본다.
          category: p.category ?? 'free',
          // 좋아요가 없던 시절 글은 빈 목록으로 시작한다. 여기 담긴 회원번호도 접두어를
          // 붙여줘야 지금 회원과 대조돼 "내가 눌렀는지"가 맞게 나온다.
          likedBy: (p.likedBy ?? []).map(migrateId),
        }))
      } catch {
        await rescueCorrupt(POSTS_FILE)
        posts = []
      }
      return posts!
    })
  }

  async function persistPosts() {
    await mkdir(path.dirname(POSTS_FILE), { recursive: true })
    await writeJsonFile(POSTS_FILE, posts)
  }

  // 상한을 넘겨 밀려나는 글을 지운다. 사진과 댓글도 같이 치운다 — 예전에는 글만 잘라내서
  // 주인 없는 사진이 폴더에 그대로 남았다(폴더 상한 300MB에 도달하면 새 사진을 못 올린다).
  async function trimOldPosts(all: CommunityPost[]): Promise<void> {
    if (all.length <= MAX_POSTS) return
    const dropped = all.splice(0, all.length - MAX_POSTS)
    for (const p of dropped) await removeUploads(p.images)
    const ids = new Set(dropped.map((p) => p.id))
    const cs = await loadComments()
    const left = cs.filter((c) => !ids.has(c.postId))
    if (left.length !== cs.length) {
      comments = left
      await persistComments()
    }
  }

  // 카드 뽑기 자랑글 등록 훅(위 모듈 변수 참조). 글 수 상한도 일반 글쓰기와 같게 지킨다.
  appendCommunityPost = async (post: CommunityPost) => {
    const all = await loadPosts()
    all.push(post)
    await trimOldPosts(all)
    await persistPosts()
  }

  async function loadComments(): Promise<CommunityComment[]> {
    if (comments) return comments
    return firstReadOnce('comments', async () => {
      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.
      if (comments) return comments
      try {
        comments = (JSON.parse(await readFile(COMMENTS_FILE, 'utf-8')) as CommunityComment[]).map((c) => ({
          ...c,
          authorId: migrateId(c.authorId),
        }))
      } catch {
        await rescueCorrupt(COMMENTS_FILE)
        comments = []
      }
      return comments!
    })
  }

  async function persistComments() {
    await mkdir(path.dirname(COMMENTS_FILE), { recursive: true })
    await writeJsonFile(COMMENTS_FILE, comments)
  }

  async function loadReports(): Promise<CommunityReport[]> {
    if (reports) return reports
    return firstReadOnce('reports', async () => {
      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.
      if (reports) return reports
      try {
        reports = JSON.parse(await readFile(REPORTS_FILE, 'utf-8'))
      } catch {
        await rescueCorrupt(REPORTS_FILE)
        reports = []
      }
      return reports!
    })
  }

  // 오래된 신고부터 잘라 최근 MAX_REPORTS건만 남긴다.
  function trimReports(list: CommunityReport[]) {
    if (list.length <= MAX_REPORTS) return
    list.sort((a, b) => a.createdAt - b.createdAt)
    list.splice(0, list.length - MAX_REPORTS)
  }

  async function persistReports() {
    await mkdir(path.dirname(REPORTS_FILE), { recursive: true })
    await writeJsonFile(REPORTS_FILE, reports)
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
        // ?category=question 이면 그 게시판만. 없거나 이상한 값이면 전체를 준다.
        const cat = url.searchParams.get('category')
        const inCategory = POST_CATEGORIES.includes(cat as PostCategory)
          ? all.filter((p) => p.category === cat)
          : all
        // 공지(고정 글)는 게시판과 무관하게 늘 맨 위에 보여준다. 그래서 카테고리 필터와
        // 별개로 전체에서 고정 글을 모아 앞에 붙이고, 나머지는 카테고리 안에서 최신순으로
        // 잇는다. 이렇게 하면 자유게시판에 쓴 공지도 질문·건의 탭에서 똑같이 보인다.
        const pinned = all.filter((p) => p.pinnedAt != null).sort((a, b) => b.pinnedAt! - a.pinnedAt!)
        const pinnedIds = new Set(pinned.map((p) => p.id))
        const rest = inCategory.filter((p) => !pinnedIds.has(p.id)).sort((a, b) => b.createdAt - a.createdAt)
        sendJson(
          res,
          200,
          [...pinned, ...rest].map((p) => toPublicPost(p, viewer, everyone)),
        )
        return
      }

      // POST /community/upload — 사진 한 장을 올린다(로그인 필수).
      // 본문은 data URL(base64) 한 장. 사진 인식(scan-card)과 같은 방식이라
      // 새 라이브러리 없이 처리한다.
      if (segments.length === 1 && segments[0] === 'upload' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user?.nickname) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        let raw: string
        try {
          raw = await readBody(req, Math.ceil(MAX_UPLOAD_BYTES * 1.4))
        } catch {
          sendJson(res, 413, { error: 'too large' })
          return
        }
        const body = JSON.parse(raw || '{}') as { image?: unknown }
        const m = typeof body.image === 'string' ? body.image.match(/^data:([\w/+.-]+);base64,(.+)$/s) : null
        const ext = m ? UPLOAD_TYPES[m[1]] : undefined
        if (!m || !ext) {
          sendJson(res, 400, { error: 'unsupported type' })
          return
        }
        const buf = Buffer.from(m[2], 'base64')
        if (buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) {
          sendJson(res, 413, { error: 'too large' })
          return
        }
        // 한 사람이 한 시간에 올릴 수 있는 장수 제한
        const now = Date.now()
        sweepUploadLog(now)
        const recent = (uploadLog.get(user.id) ?? []).filter((t) => now - t < 3600_000)
        if (recent.length >= UPLOAD_PER_HOUR) {
          sendJson(res, 429, { error: 'too many uploads' })
          return
        }
        await mkdir(UPLOAD_DIR, { recursive: true })
        if ((await uploadDirBytes()) + buf.length > UPLOAD_DIR_MAX_BYTES) {
          sendJson(res, 507, { error: 'storage full' })
          return
        }
        recent.push(now)
        uploadLog.set(user.id, recent)
        const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
        await writeFile(path.join(UPLOAD_DIR, name), buf)
        sendJson(res, 201, { url: `/uploads/${name}` })
        return
      }

      if (segments.length === 1 && segments[0] === 'posts' && req.method === 'POST') {
        // 닉네임까지 정해야 글을 쓸 수 있다(작성자 표시가 닉네임이므로).
        const user = await currentUser(req)
        if (!user?.nickname) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse(await readBody(req)) as {
          title?: string
          content?: string
          category?: string
          images?: unknown
        }
        const title = body.title?.trim()
        const content = body.content?.trim()
        // 우리 업로드 주소만 받는다. 아무 주소나 받으면 남의 서버 이미지를 글에 심거나
        // 추적용 주소를 넣을 수 있다.
        const images = (Array.isArray(body.images) ? body.images : [])
          .filter((u): u is string => typeof u === 'string' && /^\/uploads\/[\w.-]+$/.test(u))
          .slice(0, MAX_POST_IMAGES)
        // 클라이언트가 보낸 카테고리를 그대로 믿되, 목록에 없는 값이면 자유로 떨어뜨린다.
        const category: PostCategory = POST_CATEGORIES.includes(body.category as PostCategory)
          ? (body.category as PostCategory)
          : 'free'
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
          category,
          // 작성자는 클라이언트가 보낸 값이 아니라 세션에서 가져온다. 아니면
          // 아무나 남의 닉네임을 사칭해 글을 쓸 수 있다.
          authorId: user.id,
          content,
          ...(images.length ? { images } : {}),
          createdAt: Date.now(),
          likedBy: [],
          commentCount: 0,
        }
        all.push(post)
        await trimOldPosts(all)
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
        // 운영자·집계 제외(notrack) 조회는 빼서 조회수가 부풀지 않게 한다.
        // 같은 사람이 다시 봐도 세지 않는다 — 안 그러면 새로고침만으로 조회수가 오른다.
        const notrack = url.searchParams.get('notrack') === '1'
        if (!isAdmin(viewer) && !notrack) {
          let first: boolean
          if (viewer) {
            const seen = (post.viewedBy ??= [])
            first = !seen.includes(viewer.id)
            if (first) {
              seen.push(viewer.id)
              if (seen.length > MAX_VIEWERS_PER_POST) seen.splice(0, seen.length - MAX_VIEWERS_PER_POST)
            }
          } else {
            const key = `${clientIp(req)} ${id}`
            first = !guestViews.get(key)
            if (first) guestViews.set(key, true)
          }
          if (first) {
            post.viewCount = (post.viewCount ?? 0) + 1
            await persistPosts()
          }
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
        if (!user || post.authorId !== user.id) {
          sendJson(res, 403, { error: 'not your post' })
          return
        }
        // 글이 사라지면 그 사진도 쓸 데가 없다. 안 지우면 볼륨에 영원히 남는다.
        await removeUploads(post.images)
        posts = all.filter((p) => p.id !== id)
        comments = (await loadComments()).filter((c) => c.postId !== id)
        await persistPosts()
        await persistComments()
        sendJson(res, 200, { ok: true })
        return
      }

      // PUT /posts/:id — 본인 글만 수정. 제목·내용·게시판을 바꿀 수 있다.
      if (segments.length === 2 && segments[0] === 'posts' && req.method === 'PUT') {
        const user = await currentUser(req)
        const id = Number(segments[1])
        const all = await loadPosts()
        const post = all.find((p) => p.id === id)
        if (!post) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        if (!user || post.authorId !== user.id) {
          sendJson(res, 403, { error: 'not your post' })
          return
        }
        const body = JSON.parse(await readBody(req)) as {
          title?: string
          content?: string
          category?: string
          images?: unknown
        }
        const title = body.title?.trim()
        const content = body.content?.trim()
        if (!title || !content) {
          sendJson(res, 400, { error: 'title and content are required' })
          return
        }
        if (title.length > MAX_TITLE_LENGTH || content.length > MAX_CONTENT_LENGTH) {
          sendJson(res, 400, {
            error: `title must be <= ${MAX_TITLE_LENGTH} chars and content <= ${MAX_CONTENT_LENGTH} chars`,
          })
          return
        }
        // 사진도 함께 고친다. 안 보냈으면 원래 사진을 유지하고, 뺀 사진은 파일까지 지운다
        // (안 지우면 볼륨에 남는다).
        if (Array.isArray(body.images)) {
          const next = body.images
            .filter((u): u is string => typeof u === 'string' && /^\/uploads\/[\w.-]+$/.test(u))
            .slice(0, MAX_POST_IMAGES)
          await removeUploads((post.images ?? []).filter((u) => !next.includes(u)))
          if (next.length) post.images = next
          else delete post.images
        }
        post.title = title
        post.content = content
        // 게시판은 보낸 값이 유효할 때만 옮긴다. 안 보냈으면 원래 게시판을 유지한다.
        if (POST_CATEGORIES.includes(body.category as PostCategory)) {
          post.category = body.category as PostCategory
        }
        post.editedAt = Date.now()
        await persistPosts()
        sendJson(res, 200, toPublicPost(post, user, await loadUsers()))
        return
      }

      // POST /posts/:id/like — 좋아요 토글. 이미 눌렀으면 취소된다.
      if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'like' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user?.nickname) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const id = Number(segments[1])
        const all = await loadPosts()
        const post = all.find((p) => p.id === id)
        if (!post) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const i = post.likedBy.indexOf(user.id)
        if (i === -1) post.likedBy.push(user.id)
        else post.likedBy.splice(i, 1)
        await persistPosts()
        sendJson(res, 200, { likeCount: post.likedBy.length, liked: i === -1 })
        return
      }

      // POST /posts/:id/pin | /unpin — 운영자만. 공지로 고정하거나 해제한다.
      if (
        segments.length === 3 &&
        segments[0] === 'posts' &&
        (segments[2] === 'pin' || segments[2] === 'unpin') &&
        req.method === 'POST'
      ) {
        const viewer = await currentUser(req)
        if (!isAdmin(viewer)) {
          // 운영자가 아니면 이 경로가 있다는 것 자체를 알려주지 않는다.
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const id = Number(segments[1])
        const all = await loadPosts()
        const post = all.find((p) => p.id === id)
        if (!post) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        if (segments[2] === 'pin') post.pinnedAt = Date.now()
        else delete post.pinnedAt
        await persistPosts()
        sendJson(res, 200, toPublicPost(post, viewer, await loadUsers()))
        return
      }

      // /posts/:id/report
      if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'report' && req.method === 'POST') {
        // 로그인을 받아야 같은 사람의 반복 신고를 막을 수 있다. 예전엔 검사가 없어서
        // 누구나 같은 글을 몇 번이고 신고해 운영자 목록을 덮을 수 있었다.
        const reporter = await currentUser(req)
        if (!reporter) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const postId = Number(segments[1])
        const allPosts = await loadPosts()
        if (!allPosts.some((p) => p.id === postId)) {
          sendJson(res, 404, { error: 'post not found' })
          return
        }
        const rawBody = await readBody(req)
        const body = (rawBody ? JSON.parse(rawBody) : {}) as { reason?: string }
        const allReports = await loadReports()
        // 이미 신고한 글이면 조용히 접수된 것으로 답한다 — "이미 신고했습니다"라고
        // 알려 주면 남이 신고했는지까지 떠보는 데 쓸 수 있다.
        if (!allReports.some((r) => r.reporterId === reporter.id && r.targetType === 'post' && r.postId === postId)) {
          allReports.push({
            id: Date.now(),
            targetType: 'post',
            postId,
            commentId: null,
            reason: body.reason?.trim().slice(0, 500) ?? '',
            createdAt: Date.now(),
            reporterId: reporter.id,
          })
          trimReports(allReports)
          await persistReports()
        }
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
        const reporter = await currentUser(req)
        if (!reporter) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
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
        if (
          !allReports.some(
            (r) => r.reporterId === reporter.id && r.targetType === 'comment' && r.commentId === commentId,
          )
        ) {
          allReports.push({
            id: Date.now(),
            targetType: 'comment',
            postId,
            commentId,
            reason: body.reason?.trim().slice(0, 500) ?? '',
            createdAt: Date.now(),
            reporterId: reporter.id,
          })
          trimReports(allReports)
          await persistReports()
        }
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
            authorId: user.id,
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

      // POST /reports/:id/reset-nickname — 신고된 글의 작성자 닉네임을 지운다.
      //
      // 금지어 목록은 조금만 비틀면 뚫린다. 뚫린 걸 실제로 처리하는 건 여기다.
      // 초기화하면 그 사람은 다음에 들어올 때 닉네임을 다시 정해야 한다.
      //
      // 회원번호 대신 신고 id로 대상을 찾는다. 닉네임을 지우려고 회원번호를 화면까지
      // 내려보내면, 지금껏 안 내보내려고 지킨 게 무너진다.
      if (segments.length === 3 && segments[0] === 'reports' && segments[2] === 'reset-nickname') {
        const viewer = await currentUser(req)
        if (!isAdmin(viewer)) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const report = (await loadReports()).find((r) => r.id === Number(segments[1]))
        if (!report) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const target =
          report.targetType === 'comment' && report.commentId != null
            ? (await loadComments()).find((c) => c.id === report.commentId)
            : (await loadPosts()).find((p) => p.id === report.postId)
        if (!target) {
          sendJson(res, 404, { error: 'target gone' })
          return
        }
        const author = (await loadUsers()).find((u) => u.id === target.authorId)
        if (!author) {
          sendJson(res, 404, { error: 'author gone' })
          return
        }
        author.nickname = null
        await persistUsers()
        sendJson(res, 200, { ok: true })
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
const VISIT_STATS_FILE = dataFile('visit-stats.json')
const SCAN_FEEDBACK_FILE = dataFile('scan-feedback.json')
// 스캔 오류 신고는 최근 것 위주로만 남긴다(프롬프트 튜닝 참고용이라 오래된 건 불필요).
const MAX_SCAN_FEEDBACK = 300
const TRANSLATION_FEEDBACK_FILE = dataFile('translation-feedback.json')
// 번역 오류 신고도 사전(translateQuery) 보정 참고용이라 최근 것만 남긴다.
const MAX_TRANSLATION_FEEDBACK = 300
// 플리마켓(회원끼리 카드 거래) 운영 설정. 기능을 만들기 전에 스위치부터 둔다 —
// 문제가 생겼을 때 배포 없이 바로 닫을 수 있어야 하기 때문이다.
const FLEA_CONFIG_FILE = dataFile('flea-config.json')
// 매물·거래 기록. 아직 만들지 않은 기능이라 파일이 없는 게 정상이다(없으면 0건).
const FLEA_LISTINGS_FILE = dataFile('flea-listings.json')
const FLEA_OFFERS_FILE = dataFile('flea-offers.json')
const FLEA_DEALS_FILE = dataFile('flea-deals.json')
const EVENT_STATS_FILE = dataFile('event-stats.json')
// 작가별 조회 횟수(누적). "작가별 조회" 이벤트에 딸려 온 작가 이름으로 센다.
const ARTIST_STATS_FILE = dataFile('artist-stats.json')
// 클라이언트가 아무 이름이나 보내 맵을 부풀리지 못하게, 서로 다른 작가 이름은 이만큼까지만
// 새로 받는다(실제 작가는 80명 안팎이라 넉넉하다). 넘으면 이미 있는 이름만 카운트한다.
const MAX_ARTIST_KEYS = 300
// 세트별 목록에서 어떤 세트를 눌렀는지(누적). "세트별 조회" 이벤트에 딸려 온 세트 이름으로 센다.
const SET_STATS_FILE = dataFile('set-stats.json')
// 실제 세트는 250여 개라 500까지 새 이름을 받는다. 넘으면 이미 있는 이름만 카운트.
const MAX_SET_KEYS = 500
// 기능별 사용 횟수만 센다. 허용된 이벤트 이름 외에는 받지 않는다(임의 키 방지).
// sets=세트별 목록에서 세트 열람, ebay_korean=이베이 한글판 시세 조회.
const ALLOWED_EVENTS = new Set([
  'snkrdunk_search', 'ebay_search', 'scan', 'centering', 'artist', 'tcgplayer', 'sets', 'ebay_korean',
  'packsim', 'scantest', 'packsim_checkin', 'packsim_godpack', 'packsim_value', 'packsim_share',
  'share',
])
// 날짜별 칸을 이만큼만 유지한다(그보다 오래된 날은 합계 보존용 legacy 칸으로 접는다).
const EVENT_KEEP_DAYS = 60
// 날짜 구분이 없던 옛 형식의 누적치를 담아두는 칸 이름. 전체 합계에만 들어간다.
const EVENT_LEGACY_KEY = 'legacy'
// 방문 통계는 날짜별 숫자만 400일치 남긴다. IP·기기 정보는 저장하지 않는다.
const VISIT_KEEP_DAYS = 400
const MAX_TRACKED_TERMS = 500
// 카드명·팩명 검색어라 이보다 길 일이 없다. 넘으면 집계하지 않고 조용히 무시한다
// (검색 자체는 클라이언트가 알아서 하므로 사용자에게 보이는 변화는 없다).
const MAX_TERM_LENGTH = 100
// 순위 변화(▲▼)를 재는 기준 시점을 얼마나 자주 갱신할지. 집계 창이 한 시간씩
// 흘러가므로(오래된 한 시간이 빠지고 새 한 시간이 들어온다) 1시간 전과 견줘도
// 순위가 실제로 움직인다.
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000
const RANKING_SIZE = 10
// 인기 검색어는 "지금부터 거꾸로 24시간"으로 순위를 매긴다. 달력 하루로 끊으면 자정에
// 하루치가 통째로 빠져 순위가 갑자기 뒤집히고 그 사이엔 거의 안 움직인다. 창을 한
// 시간씩 밀면 오래된 한 시간이 빠지고 새 한 시간이 들어와 하루 종일 조금씩 흐른다.
const POPULAR_WINDOW_HOURS = 24
// 옛 평면 형식(날짜 구분 없는 누적)을 옮겨 담을 때 쓰는 기준일 수.
const POPULAR_RECENT_DAYS = 3
// 검색이 뜸하면 24시간 안에 검색어가 몇 개 없어 목록이 텅 비어 보인다. 그럴 때
// 빈 자리를 메우려고 더 긴 기간의 집계도 남겨둔다(순위는 최근 우선, 나머지는 이걸로 채움).
const POPULAR_KEEP_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

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

// 검색창에 입력된 검색어를 로컬 파일에 날짜별로 집계해서 "인기 검색어" 홈 화면에 쓴다.
// ⚠️ 한 사람(IP)이 같은 말을 10분 안에 여러 번 쳐도 한 번만 센다 — 그래서 이 숫자는
// "검색된 횟수"보다 "몇 사람이 찾았나"에 가깝다. 반복 요청으로 순위를 올리는 것을
// 막으려면 이 방법뿐이고, 인기 순위로서도 이쪽이 더 정직하다.
// 스니커덩크 자체 추천/인기 알고리즘은 기준이 불투명해서, 우리 사이트 안에서
// 실제로 사용자가 최근 며칠간 몇 번 검색했는지를 직접 세는 방식으로 대체한다.
//
// 순위 변동(▲▼NEW)을 보여주기 위해 한 시간에 한 번씩 "이전 순위" 스냅샷을 따로
// 저장해두고, 그 스냅샷과 현재 순위를 비교해 변동폭을 계산한다.
// 검색어를 "언제" 검색했는지까지 알아야 최근 것만 셀 수 있다. 그래서 날짜별로 칸을
// 나눠 담는다: { '2026-07-16': { 리자몽: 3, 피카츄: 1 }, ... }. 순위를 낼 때 최근
// POPULAR_WINDOW_DAYS 칸만 합친다. 하루 경계는 한국 시각 기준으로 맞춘다(UTC로 세면
// 한국 오전 9시에 날짜가 바뀐다).
type DayBuckets = Record<string, Record<string, number>>

function kstDayKey(ts: number): string {
  return new Date(ts + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// 검색은 시간 단위 칸에 담는다: '2026-07-20T14'. 날짜 단위로 담으면 자정에 하루치가
// 통째로 사라져서 순위가 갑자기 뒤집히고, 그 사이엔 거의 안 움직인다. 시간 단위로
// 담아 "최근 24시간"만 합치면 한 시간마다 가장 오래된 한 시간이 빠지고 새 한 시간이
// 들어와, 순위가 하루 종일 조금씩 흐른다.
function kstHourKey(ts: number): string {
  return new Date(ts + 9 * 60 * 60 * 1000).toISOString().slice(0, 13)
}

// 칸 키에서 날짜 부분만. 시간 칸('2026-07-20T14')과 옛 날짜 칸('2026-07-20') 둘 다
// 앞 10글자가 날짜라 그대로 쓸 수 있다.
function dayOfKey(key: string): string {
  return key.slice(0, 10)
}

// 최근 `hours`시간치 시간 키 집합. 순위 집계에 쓴다.
function recentHourKeys(hours: number): Set<string> {
  const keys = new Set<string>()
  const now = Date.now()
  for (let i = 0; i < hours; i++) keys.add(kstHourKey(now - i * 60 * 60 * 1000))
  return keys
}

// 최근 `days`일치 날짜 집합. 오래된 칸 정리와 예비 채움용(30일)에 쓴다.
function popularWindowKeys(days: number): Set<string> {
  const keys = new Set<string>()
  const now = Date.now()
  for (let i = 0; i < days; i++) keys.add(kstDayKey(now - i * DAY_MS))
  return keys
}

function mountSearchTracker(app: Mountable) {
  let buckets: DayBuckets | null = null
  let snapshot: Snapshot | null | undefined

  async function loadCounts(): Promise<DayBuckets> {
    if (buckets) return buckets

    return firstReadOnce('buckets:1442', async () => {

      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.

      if (buckets) return buckets
      try {
        const raw = JSON.parse(await readFile(SEARCH_COUNTS_FILE, 'utf-8')) as Record<string, unknown>
        // 옛 형식은 { 검색어: 횟수 } 평면 구조였다(날짜 구분 없이 영원히 누적). 값이 숫자면
        // 옛 형식으로 보고, 창에서 가장 오래된 날짜 칸에 통째로 넣는다 — 오늘 하루는 예전
        // 목록이 그대로 보이다가 내일이면 창 밖으로 밀려나 자연스럽게 최근 기준으로 바뀐다.
        if (Object.values(raw).some((v) => typeof v === 'number')) {
          const oldestKey = kstDayKey(Date.now() - (POPULAR_RECENT_DAYS - 1) * DAY_MS)
          buckets = { [oldestKey]: raw as Record<string, number> }
        } else {
          buckets = raw as DayBuckets
        }
      } catch {
        buckets = {}
      }
      return buckets!
  

    })

  }

  // 예비 채움 기간(30일)보다 오래된 칸은 버린다. 안 버리면 파일이 날마다 커진다.
  // 시간 칸이든 옛 날짜 칸이든 날짜 부분으로 판단한다.
  function pruneOldDays() {
    if (!buckets) return
    const keep = popularWindowKeys(POPULAR_KEEP_DAYS)
    for (const key of Object.keys(buckets)) if (!keep.has(dayOfKey(key))) delete buckets[key]
  }

  // 순위용 집계: 지금부터 거꾸로 `hours`시간. 한 시간이 지나면 가장 오래된 한 시간이
  // 자연히 빠져서 순위가 계속 조금씩 움직인다.
  function aggregateHours(hours: number): Record<string, number> {
    const keep = recentHourKeys(hours)
    const total: Record<string, number> = {}
    for (const [key, terms] of Object.entries(buckets ?? {})) {
      if (!keep.has(key)) continue
      for (const [term, n] of Object.entries(terms)) total[term] = (total[term] ?? 0) + n
    }
    return total
  }

  // 예비 채움용 집계: 최근 `days`일. 검색이 뜸해 24시간 안에 10칸이 안 찰 때 쓴다.
  // 시간 칸과 옛 날짜 칸을 모두 날짜 기준으로 합친다.
  function aggregateDays(days: number): Record<string, number> {
    const keep = popularWindowKeys(days)
    const total: Record<string, number> = {}
    for (const [key, terms] of Object.entries(buckets ?? {})) {
      if (!keep.has(dayOfKey(key))) continue
      for (const [term, n] of Object.entries(terms)) total[term] = (total[term] ?? 0) + n
    }
    return total
  }

  async function persistCounts() {
    await mkdir(path.dirname(SEARCH_COUNTS_FILE), { recursive: true })
    await writeJsonFile(SEARCH_COUNTS_FILE, buckets)
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
    await writeJsonFile(SNAPSHOT_FILE, next)
  }

  function rankTerms(current: Record<string, number>) {
    return Object.entries(current)
      .sort((a, b) => b[1] - a[1])
      .slice(0, RANKING_SIZE)
      .map(([term, count], i) => ({ term, count, rank: i + 1 }))
  }

  // 인기 검색어는 홈 첫 화면에 그대로 뜨는데 이 엔드포인트는 로그인이 필요 없다.
  // 막지 않으면 한 사람이 반복 요청만으로 아무 말이나 1위에 올릴 수 있다(실제로
  // 200번 보내 1위가 되는 걸 확인했다). 두 겹으로 막는다:
  //  ① 분당 요청 수 — 다른 집계 엔드포인트와 같은 방식
  //  ② 같은 사람이 같은 말을 반복해도 창 하나에 한 번만 센다. 순위를 올리려면
  //     결국 이 겹을 넘어야 하므로 ①만으로는 부족하다.
  // 둘 다 메모리에만 두고 파일에는 안 남긴다 — IP를 저장하지 않는다는 원칙 그대로다.
  const allowSearchTrack = rateLimiter(30, 60 * 1000)
  const SEARCH_DEDUPE_MS = 10 * 60 * 1000
  const searchSeen = new TtlCache<true>(SEARCH_DEDUPE_MS, 20_000)

  app.use('/api/local/track-search', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    if (!allowSearchTrack(req)) {
      tooManyRequests(res)
      return
    }
    // 운영자(본인) 검색은 인기 검색어·검색 통계 집계에서 뺀다.
    if (isAdmin(await currentUser(req))) {
      res.statusCode = 204
      res.end()
      return
    }
    try {
      const body = JSON.parse(await readBody(req)) as { query?: string }
      const term = body.query?.trim()
      // 검색어가 그대로 JSON 키가 되어 파일에 쌓인다. MAX_TRACKED_TERMS는 개수만 막지
      // 크기는 안 막아서, 길이를 안 자르면 500개로도 볼륨을 넘길 수 있다. 이 엔드포인트는
      // 로그인도 필요 없다.
      // 같은 사람이 같은 말을 또 보내면 집계하지 않는다. 사용자에겐 성공으로 답한다 —
      // 검색 자체는 이미 끝났고, 집계 여부를 알려 줄 이유가 없다.
      const dedupeKey = term ? `${clientIp(req)}\u0000${term}` : ''
      if (term && searchSeen.get(dedupeKey)) {
        res.statusCode = 204
        res.end()
        return
      }
      if (term && term.length <= MAX_TERM_LENGTH) {
        searchSeen.set(dedupeKey, true)
        const all = await loadCounts()
        const hour = kstHourKey(Date.now())
        const bucket = (all[hour] ??= {})
        bucket[term] = (bucket[term] ?? 0) + 1
        // 한 칸이 지나치게 커지지 않게 상한을 둔다. 넘으면 그 시간에 덜 검색된 것부터 버린다.
        if (Object.keys(bucket).length > MAX_TRACKED_TERMS) {
          const top = Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED_TERMS)
          all[hour] = Object.fromEntries(top)
        }
        pruneOldDays()
        await persistCounts()
      }
      res.statusCode = 204
      res.end()
    } catch {
      res.statusCode = 400
      res.end()
    }
  })

  // 날짜별 검색 횟수 합계 — 운영자 통계용. 검색어 목록이 아니라 "그날 검색이 몇 번
  // 있었나"만 준다(이미 쌓고 있는 날짜별 칸을 합산할 뿐 새로 수집하는 건 없다).
  app.use('/api/local/search-stats', async (req, res) => {
    const viewer = await currentUser(req)
    if (!isAdmin(viewer)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    await loadCounts()
    // 칸은 시간 단위라 날짜별로 다시 묶어서 합친다(옛 날짜 칸도 그대로 섞여 들어온다).
    const byDate: Record<string, number> = {}
    for (const [key, terms] of Object.entries(buckets ?? {})) {
      const sum = Object.values(terms).reduce((a, b) => a + b, 0)
      byDate[dayOfKey(key)] = (byDate[dayOfKey(key)] ?? 0) + sum
    }
    const items = Object.entries(byDate)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items }))
  })

  app.use('/api/local/popular-searches', async (_req, res) => {
    await loadCounts()
    // 조회할 때도 오래된 날짜를 정리해 파일이 무한정 커지지 않게 한다.
    pruneOldDays()
    // 순위는 최근 3일로 매긴다(살아있는 느낌). 그걸로 10칸이 안 차면 — 검색이 뜸해
    // 목록이 비어 보일 때 — 더 긴 기간(30일) 인기어로 뒤를 채운다. 최근 것이 늘 위,
    // 옛 인기어가 빈 자리를 메우는 식이라 목록이 텅 비지 않는다.
    const ranked = rankTerms(aggregateHours(POPULAR_WINDOW_HOURS))
    if (ranked.length < RANKING_SIZE) {
      const shown = new Set(ranked.map((r) => r.term))
      const fillers = Object.entries(aggregateDays(POPULAR_KEEP_DAYS))
        .filter(([term]) => !shown.has(term))
        .sort((a, b) => b[1] - a[1])
      for (const [term, count] of fillers) {
        if (ranked.length >= RANKING_SIZE) break
        ranked.push({ term, count, rank: ranked.length + 1 })
      }
    }
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

// ── PPT 호출 차단기 ────────────────────────────────────────────────────────
// "한도 초과"를 받고도 계속 부르면 PPT가 키를 통째로 정지시킨다(5분에 429가 50번이면
// 1시간, 반복하면 24시간 → 7일 → 영구). 2026-07-28에 실제로 한 번 막혔다.
//
// 원인은 재시도가 아니라 "안 멈춘 것"이었다. 하루치 크레딧이 바닥나면 그때부터 모든
// 응답이 429인데, 방문자가 카드를 볼 때마다 캐시에 없으면 그대로 업스트림을 불렀다.
// 한 번 부를 때마다 429가 한 번 쌓이니, 사람 몇 명이 목록을 넘기는 것만으로 5분에
// 50번을 넘긴다. 뒤에서 도는 앨범 시세 채우기도 5초마다 한 번씩 보태고 있었다.
//
// 그래서 429를 한 번이라도 받으면 풀릴 시각까지 아예 부르지 않는다. 그동안은 저장해 둔
// 값이나 안내 문구로 답한다 — 어차피 불러 봐야 429라 방문자가 얻는 건 없고, 정지만
// 앞당긴다.
let pptBlockedUntil = 0
let pptDailyOut = false
// 오늘 남은 크레딧. 응답 헤더로만 알 수 있어서 부를 때마다 갱신한다.
let pptDailyLeft = Number.POSITIVE_INFINITY
// 방문자 몫으로 남겨 둘 크레딧. 뒤에서 도는 앨범 시세 채우기가 하루치를 다 쓰면
// 그때부터 방문자의 eBay·TCGplayer 시세가 통째로 안 나온다. 실제로 그래 왔다 —
// 2026-07-28에도 낮 한 시간 반 동안 22세트를 받아 하루치가 바닥났다.
// 세트 하나가 200~600크레딧이라 채우기 한 바퀴에 1만 안팎이 든다.
const PPT_KEEP_FOR_VISITORS = 8000

// 하루치는 UTC 자정(한국시간 오전 9시)에 초기화된다.
const nextUtcMidnight = (now = Date.now()) => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

// 지금 불러도 되는지. daily는 "하루치를 다 썼다"는 뜻으로, 화면 안내가 달라진다.
const pptGate = (): { ok: boolean; daily: boolean } =>
  Date.now() < pptBlockedUntil ? { ok: false, daily: pptDailyOut } : { ok: true, daily: false }

// 응답을 보고 언제까지 쉴지 정한다.
// 5xx는 PPT 쪽 장애라 한도와 무관하므로 판단을 바꾸지 않는다.
function notePpt(status: number, headers: Headers) {
  const left = Number(headers.get('x-ratelimit-daily-remaining'))
  if (Number.isFinite(left)) pptDailyLeft = left
  const after = Number(headers.get('retry-after'))
  const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 0

  // 키가 정지되면 429가 아니라 403으로 오고, 남은 시간을 Retry-After로 알려준다
  // (실측: `403 {"error":"API key blocked for abuse"}` + retry-after 2924).
  // 이걸 "429가 아니니 풀렸다"로 읽으면 정지된 키를 정지 내내 계속 두드리게 된다.
  if (status === 403 && wait > 0) {
    pptBlockedUntil = Date.now() + wait
    pptDailyOut = false
    return
  }
  if (status !== 429) {
    if (status < 500) {
      pptBlockedUntil = 0
      pptDailyOut = false
    }
    return
  }
  pptDailyOut = Number.isFinite(left) && left <= 0
  // 분당 한도면 PPT가 Retry-After로 알려준다. 없으면 1분 쉰다.
  pptBlockedUntil = pptDailyOut ? nextUtcMidnight() : Date.now() + (wait || 60_000)
}

// 무료 티어가 하루 100건(전체 방문자 공용)이라, 캐시 적중률이 곧 eBay가 얼마나 오래
// 살아있느냐다. TTL을 24시간으로 두면 같은 카드는 하루 한 번만 크레딧을 쓴다. 홍보로
// 사람이 몰려 다들 같은 인기 카드를 볼 때, 첫 조회 한 번만 크레딧을 쓰고 나머지는
// 저장된 값을 본다. eBay 낙찰가는 하루 안에 크게 안 흔들려 참고용으로 문제없다.
const PRICE_TRACKER_CACHE_TTL_MS = 24 * 60 * 60 * 1000
// 서로 다른 카드가 그만큼 캐시에 남는다. 인기 카드가 200종을 넘겨 밀려나면 그 카드는
// 다시 크레딧을 쓰므로, 하루치 인기 카드를 넉넉히 담도록 늘려둔다(shaped JSON이라 작다).
const PRICE_TRACKER_MAX_ENTRIES = 500
// 무료 요금제가 하루 100건이다. 한 사람이 시간당 20건이면 정상 사용에는 걸릴 일이
// 없으면서, 혼자서 하루치를 태우려면 다섯 시간이 걸린다.
// 유료 플랜(하루 20,000크레딧) 기준. 무료 시절(하루 100건)엔 20/시간으로 묶어뒀지만,
// 이제 캐시 미스가 시간당 300건이어도 하루 한도의 절반도 안 쓴다.
const PRICE_TRACKER_RATE_LIMIT = 300
const PRICE_TRACKER_RATE_WINDOW_MS = 60 * 60 * 1000

interface RawEbayGrade {
  count?: number
  averagePrice?: number
  medianPrice?: number
  minPrice?: number
  maxPrice?: number
  marketTrend?: string | null
  // 이 등급의 마지막 낙찰 날짜(ISO). 표시 값이 얼마나 최신인지 알려준다.
  lastSaleDate?: string | null
  // PPT가 최근 30일 낙찰을 튀는 값 걸러 가중 계산한 "현재 적정가". 신뢰도(high/medium/low)
  // 는 최근 거래가 얼마나 있었는지에 따른다.
  smartMarketPrice?: { price?: number; confidence?: string } | null
}

interface RawPriceTrackerCard {
  tcgPlayerId?: string
  name?: string
  setName?: string
  cardNumber?: string | null
  imageCdnUrl400?: string
  imageCdnUrl200?: string
  tcgPlayerUrl?: string
  // TCGplayer(미국 마켓) 시세. market=실거래 기반 시세, low=현재 최저가, sellers=판매자 수.
  prices?: {
    market?: number
    low?: number
    sellers?: number
    primaryPrinting?: string
    lastUpdated?: string
  }
  ebay?: {
    salesByGrade?: Record<string, RawEbayGrade>
    totalSales?: number
    // 등급별 × 날짜별 낙찰 평균가. { psa10: { "2026-05-05": { average: 99.99 } } }
    priceHistory?: Record<string, Record<string, { average?: number } | null>>
  }
  // TCGplayer(미감정) 시세의 날짜별 추이. 유료 플랜에서 includeHistory로 온다.
  // 컨디션(Near Mint 등)별로 나뉘어 온다.
  priceHistory?: {
    conditions?: Record<string, { history?: { date?: string; market?: number }[] }>
  }
}

interface ShapedEbayCard {
  tcgPlayerId: string
  name: string
  setName: string
  cardNumber: string | null
  imageUrl: string
  totalSales: number
  // TCGplayer 미국 마켓 시세(미감정 카드). 없으면 null.
  tcgplayer: {
    market: number
    low: number
    sellers: number
    printing: string | null
    lastUpdated: string | null
    url: string
    // 날짜별 마켓가 추이(오래된→최신). 그래프에 쓴다. 없으면 빈 배열.
    history: { date: string; price: number }[]
  } | null
  grades: {
    grade: string
    count: number
    averagePrice: number
    medianPrice: number
    minPrice: number
    maxPrice: number
    marketTrend: string | null
    lastSaleDate: string | null
    // 현재 적정가와 그 신뢰도. 없으면 null(그땐 화면이 중앙값으로 대체한다).
    smartPrice: number | null
    confidence: string | null
    // 그 등급의 날짜별 낙찰 평균가(오래된→최신). 그래프에 쓴다. 없으면 빈 배열.
    history: { date: string; price: number }[]
  }[]
}

// PokemonPriceTracker 원본 응답에는 화면에 안 쓰는 정보(개별 낙찰 목록, 전체 가격
// 히스토리, smartMarketPrice 등)까지 들어 있다. 원본을 그대로 프록시로 흘리면 이
// 엔드포인트가 사실상 그들의 API를 재중계(재배포)하는 꼴이라 약관 위반 소지가 있다.
// 그래서 화면에 실제로 쓰는 필드만 추려서 내려준다("제품 내 표시"에만 해당하도록).
// have='ebay'이면 낙찰 기록이 있는 카드만, 'tcgplayer'면 TCGplayer 마켓가가 있는 카드만
// 남긴다. 소스별로 목록이 달라야 하고(이베이엔 낙찰 카드, TCGplayer엔 시세 있는 카드),
// 캐시도 have별로 나뉜다.
// 이베이·TCGplayer 카드의 "번호 → 영문 이름". 공유 링크(/e/·/t/) 미리보기 제목을 서버가
// 만들려면 이름이 있어야 하는데, PPT는 번호로 카드 한 장을 찾는 기능이 없다(확인함).
// 대신 시세를 볼 때마다 응답이 서버를 지나가므로, 그때 이름을 주워 둔다. 크레딧이 안 든다.
// 못 주운 카드는 링크에 실려 온 ?n=으로 넘어간다.
const cardNameById = new Map<string, string>()
const CARD_NAME_MAX = 20_000
const CARD_NAMES_FILE = dataFile('card-names.json')
// 배포하면 기계가 새로 뜨므로 메모리에만 두면 그때마다 처음부터 다시 모은다. 파일에
// 남겨 두면 옛 링크의 미리보기도 계속 나온다. 쓰기가 잦지 않게 조금 모았다가 저장한다.
let cardNamesDirty = false
let cardNamesLoaded = false

async function loadCardNames(): Promise<void> {
  if (cardNamesLoaded) return
  cardNamesLoaded = true
  try {
    const rows = JSON.parse(await readFile(CARD_NAMES_FILE, 'utf-8')) as Record<string, string>
    for (const [id, name] of Object.entries(rows)) cardNameById.set(id, name)
  } catch {
    /* 아직 없으면 빈 채로 시작한다 */
  }
}

export function rememberCardName(id: string, name: string): void {
  if (!id || !name) return
  if (cardNameById.get(id) === name) return
  // 이미 있으면 맨 뒤로 옮겨 오래된 것부터 밀려나게 한다(자주 보는 카드가 남는다).
  cardNameById.delete(id)
  cardNameById.set(id, name)
  if (cardNameById.size > CARD_NAME_MAX) {
    const oldest = cardNameById.keys().next().value
    if (oldest !== undefined) cardNameById.delete(oldest)
  }
  cardNamesDirty = true
}

export function lookupCardName(id: string): string | null {
  return cardNameById.get(id) ?? null
}

// 5분마다 바뀐 게 있을 때만 저장한다. 시세를 볼 때마다 파일을 쓰면 볼륨이 고생한다.
export function startCardNameStore(): void {
  void loadCardNames()
  setInterval(
    () => {
      if (!cardNamesDirty) return
      cardNamesDirty = false
      void writeJsonFile(CARD_NAMES_FILE, Object.fromEntries(cardNameById)).catch(() => undefined)
    },
    5 * 60 * 1000,
  ).unref()
}

function shapeEbayCards(raw: unknown, have: 'ebay' | 'tcgplayer' = 'ebay'): ShapedEbayCard[] {
  const body = raw as { data?: RawPriceTrackerCard | RawPriceTrackerCard[] }
  const list = Array.isArray(body.data) ? body.data : body.data ? [body.data] : []

  // 한 등급의 날짜별 히스토리(객체)를 그래프용 배열로 편다. 날짜 오름차순 정렬하고,
  // 평균가가 없는 날은 버린다.
  function shapeGradeHistory(byDate: Record<string, { average?: number } | null> | undefined) {
    if (!byDate) return []
    return Object.entries(byDate)
      .map(([date, v]) => ({ date, price: v?.average ?? 0 }))
      .filter((p) => p.price > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  return list
    .filter((card) =>
      have === 'tcgplayer' ? (card.prices?.market ?? 0) > 0 : (card.ebay?.totalSales ?? 0) > 0,
    )
    .map((card) => {
      const history = card.ebay?.priceHistory ?? {}
      // TCGplayer 날짜별 추이: 컨디션별로 오는데 화면 시세가 미감정(Near Mint) 기준이라
      // Near Mint를 우선하고, 없으면 점이 제일 많은 컨디션을 쓴다.
      const conditions = card.priceHistory?.conditions ?? {}
      const conditionKey =
        'Near Mint' in conditions
          ? 'Near Mint'
          : Object.keys(conditions).sort(
              (a, b) => (conditions[b].history?.length ?? 0) - (conditions[a].history?.length ?? 0),
            )[0]
      const tcgHistory = (conditionKey ? conditions[conditionKey]?.history ?? [] : [])
        .map((h) => ({ date: h.date ?? '', price: h.market ?? 0 }))
        .filter((h) => h.date && h.price > 0)
        .sort((a, b) => a.date.localeCompare(b.date))
      // TCGplayer 시세: 마켓가가 있을 때만 담는다(없으면 화면에서 아예 안 보인다).
      const p = card.prices
      const tcgplayer =
        p && (p.market ?? 0) > 0
          ? {
              market: p.market ?? 0,
              low: p.low ?? 0,
              sellers: p.sellers ?? 0,
              printing: p.primaryPrinting ?? null,
              lastUpdated: p.lastUpdated ?? null,
              url: card.tcgPlayerUrl ?? '',
              history: tcgHistory,
            }
          : null
      return {
        tcgPlayerId: card.tcgPlayerId ?? '',
        name: card.name ?? '',
        setName: card.setName ?? '',
        cardNumber: card.cardNumber ?? null,
        imageUrl: card.imageCdnUrl400 ?? card.imageCdnUrl200 ?? '',
        totalSales: card.ebay?.totalSales ?? 0,
        tcgplayer,
        grades: Object.entries(card.ebay?.salesByGrade ?? {})
          .map(([grade, stat]) => ({
            grade,
            count: stat.count ?? 0,
            averagePrice: stat.averagePrice ?? 0,
            medianPrice: stat.medianPrice ?? 0,
            minPrice: stat.minPrice ?? 0,
            maxPrice: stat.maxPrice ?? 0,
            marketTrend: stat.marketTrend ?? null,
            lastSaleDate: stat.lastSaleDate ?? null,
            smartPrice: stat.smartMarketPrice?.price ?? null,
            confidence: stat.smartMarketPrice?.confidence ?? null,
            history: shapeGradeHistory(history[grade]),
          }))
          .sort((a, b) => b.count - a.count),
      }
    })
}

// 날짜별 방문 수만 센다(운영자가 홍보 효과를 보려는 용도). IP·기기·회원 정보는 저장하지
// 않는다. 같은 브라우저가 하루에 한 번만 세도록 집계는 클라이언트의 localStorage로
// 거르고, 서버는 그저 그날 숫자를 1 올린다.
function mountVisitStats(app: Mountable) {
  let visits: Record<string, number> | null = null
  const allow = rateLimiter(20, 60 * 1000)

  async function load(): Promise<Record<string, number>> {
    if (visits) return visits

    return firstReadOnce('visit-stats:1834', async () => {

      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.

      if (visits) return visits
      try {
        visits = JSON.parse(await readFile(VISIT_STATS_FILE, 'utf-8'))
      } catch {
        visits = {}
      }
      return visits!
  

    })

  }

  async function persist() {
    await mkdir(path.dirname(VISIT_STATS_FILE), { recursive: true })
    await writeJsonFile(VISIT_STATS_FILE, visits)
  }

  function prune() {
    if (!visits) return
    const keep = new Set<string>()
    const now = Date.now()
    for (let i = 0; i < VISIT_KEEP_DAYS; i++) keep.add(kstDayKey(now - i * DAY_MS))
    for (const day of Object.keys(visits)) if (!keep.has(day)) delete visits[day]
  }

  app.use('/api/local/track-visit', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    // 로그인도 필요 없는 엔드포인트라, 스크립트로 숫자를 부풀리지 못하게 가볍게 막는다.
    if (!allow(req)) {
      tooManyRequests(res)
      return
    }
    // 운영자(본인) 방문은 집계에서 뺀다 — 테스트로 숫자가 부풀지 않게.
    if (isAdmin(await currentUser(req))) {
      res.statusCode = 204
      res.end()
      return
    }
    const all = await load()
    const today = kstDayKey(Date.now())
    all[today] = (all[today] ?? 0) + 1
    prune()
    await persist()
    res.statusCode = 204
    res.end()
  })

  app.use('/api/local/visit-stats', async (req, res) => {
    // 운영자만. 아니면 이 경로가 있다는 것 자체를 안 알려준다.
    const viewer = await currentUser(req)
    if (!isAdmin(viewer)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    const all = await load()
    const items = Object.entries(all)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
    // 가입 회원 수(개수만). 회원번호 등 내용은 절대 안 내보낸다.
    const memberCount = (await loadUsers()).length
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items, total: items.reduce((s, i) => s + i.count, 0), memberCount }))
  })
}

// 스캔이 카드를 잘못 읽었을 때 사용자가 "이 카드 아니에요"로 알려주는 창구. 사진은 절대
// 저장하지 않고, 스캔이 뭐라고 읽었는지(이름·번호·세트·판)만 남긴다. 이 기록으로 어떤
// 패턴에서 자주 틀리는지 보고 프롬프트를 다듬는다. Claude가 이걸로 재학습하는 건 아니다.
function mountScanFeedback(app: Mountable) {
  // 스캔이 뭐라고 읽었는지. 사진은 안 받는다.
  // illustrator·graded·grade는 왜 틀렸는지 짚어 보려고 나중에 넣었다(옛 기록엔 없다).
  let items:
    | {
        name: string
        number: string | null
        setCode: string | null
        edition: string | null
        illustrator?: string | null
        graded?: boolean
        gradeCompany?: string | null
        grade?: string | null
        at: number
      }[]
    | null = null
  const allow = rateLimiter(20, 60 * 1000)

  async function load() {
    if (items) return items

    return firstReadOnce('items:1931', async () => {

      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.

      if (items) return items
      try {
        items = JSON.parse(await readFile(SCAN_FEEDBACK_FILE, 'utf-8'))
      } catch {
        items = []
      }
      return items!
  

    })

  }

  app.use('/api/local/scan-feedback', async (req, res) => {
    if (req.method === 'POST') {
      if (!allow(req)) {
        tooManyRequests(res)
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as {
          name?: string
          number?: string
          setCode?: string
          edition?: string
          illustrator?: string
          graded?: boolean
          gradeCompany?: string
          grade?: string
        }
        const all = await load()
        all.push({
          name: (b.name ?? '').slice(0, 80),
          number: b.number?.slice(0, 40) ?? null,
          setCode: b.setCode?.slice(0, 20) ?? null,
          edition: b.edition?.slice(0, 20) ?? null,
          illustrator: b.illustrator?.slice(0, 60) ?? null,
          graded: b.graded === true,
          gradeCompany: b.gradeCompany?.slice(0, 20) ?? null,
          grade: b.grade?.slice(0, 10) ?? null,
          at: Date.now(),
        })
        if (all.length > MAX_SCAN_FEEDBACK) all.splice(0, all.length - MAX_SCAN_FEEDBACK)
        await mkdir(path.dirname(SCAN_FEEDBACK_FILE), { recursive: true })
        await writeJsonFile(SCAN_FEEDBACK_FILE, items)
        res.statusCode = 204
        res.end()
      } catch {
        res.statusCode = 400
        res.end()
      }
      return
    }
    // GET — 운영자만. 아니면 이 경로가 있다는 것 자체를 안 알려준다.
    const viewer = await currentUser(req)
    if (!isAdmin(viewer)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    const all = await load()
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items: [...all].reverse() }))
  })
}

// 기능별 사용 횟수만 센다(개인정보·누가 썼는지 없음). 홍보 뒤 "사람들이 뭘 많이 쓰나"를
// 보기 위한 것. 허용된 이벤트 이름만 받아 카운터를 올린다.
function mountEventStats(app: Mountable) {
  // 날짜별 칸: { "2026-07-19": { scan: 3, ... }, legacy: {...} }. legacy는 날짜 구분이
  // 없던 옛 형식의 누적치로, 전체 합계에만 들어간다.
  let buckets: Record<string, Record<string, number>> | null = null
  // 작가별 조회 누적: { "Mitsuhiro Arita": 12, ... }
  let artists: Record<string, number> | null = null
  // 세트별 조회 누적: { "초전브레이커": 8, ... }
  let sets: Record<string, number> | null = null
  const allow = rateLimiter(60, 60 * 1000)

  async function loadArtists() {
    if (artists) return artists

    return firstReadOnce('artist-stats:1985', async () => {

      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.

      if (artists) return artists
      try {
        artists = JSON.parse(await readFile(ARTIST_STATS_FILE, 'utf-8')) as Record<string, number>
      } catch {
        artists = {}
      }
      return artists!
  

    })

  }

  async function loadSets() {
    if (sets) return sets

    return firstReadOnce('set-stats:2005', async () => {

      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.

      if (sets) return sets
      try {
        sets = JSON.parse(await readFile(SET_STATS_FILE, 'utf-8')) as Record<string, number>
      } catch {
        sets = {}
      }
      return sets!
  

    })

  }

  async function load() {
    if (buckets) return buckets

    return firstReadOnce('buckets:2045', async () => {

      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.

      if (buckets) return buckets
      try {
        const raw = JSON.parse(await readFile(EVENT_STATS_FILE, 'utf-8')) as Record<string, unknown>
        // 옛 형식은 { 이벤트: 횟수 } 평면 구조. 값이 숫자면 legacy 칸으로 접는다.
        if (Object.values(raw).some((v) => typeof v === 'number')) {
          buckets = { [EVENT_LEGACY_KEY]: raw as Record<string, number> }
        } else {
          buckets = raw as Record<string, Record<string, number>>
        }
      } catch {
        buckets = {}
      }
      return buckets!
  

    })

  }

  // 오래된 날짜 칸은 legacy로 접어 파일이 무한정 크지 않게 한다(합계는 보존).
  function foldOldDays() {
    if (!buckets) return
    const keep = popularWindowKeys(EVENT_KEEP_DAYS)
    for (const day of Object.keys(buckets)) {
      if (day === EVENT_LEGACY_KEY || keep.has(day)) continue
      const legacy = (buckets[EVENT_LEGACY_KEY] ??= {})
      for (const [ev, n] of Object.entries(buckets[day])) legacy[ev] = (legacy[ev] ?? 0) + n
      delete buckets[day]
    }
  }

  app.use('/api/local/track-event', async (req, res) => {
    if (req.method === 'POST') {
      if (!allow(req)) {
        tooManyRequests(res)
        return
      }
      // 운영자(본인) 사용은 기능 통계에서 뺀다.
      if (isAdmin(await currentUser(req))) {
        res.statusCode = 204
        res.end()
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { event?: string; label?: string }
        const ev = b.event ?? ''
        if (!ALLOWED_EVENTS.has(ev)) {
          res.statusCode = 400
          res.end()
          return
        }
        const all = await load()
        const day = (all[kstDayKey(Date.now())] ??= {})
        day[ev] = (day[ev] ?? 0) + 1
        foldOldDays()
        await mkdir(path.dirname(EVENT_STATS_FILE), { recursive: true })
        await writeJsonFile(EVENT_STATS_FILE, buckets)
        // 작가별 조회는 어떤 작가를 봤는지도 따로 센다(라벨이 있을 때만).
        const label = typeof b.label === 'string' ? b.label.trim().slice(0, 80) : ''
        if (ev === 'artist' && label) {
          const tally = await loadArtists()
          if (label in tally || Object.keys(tally).length < MAX_ARTIST_KEYS) {
            tally[label] = (tally[label] ?? 0) + 1
            await writeJsonFile(ARTIST_STATS_FILE, tally)
          }
        }
        // 세트별 목록도 어떤 세트를 열었는지 라벨(세트 한글명)로 따로 센다.
        if (ev === 'sets' && label) {
          const tally = await loadSets()
          if (label in tally || Object.keys(tally).length < MAX_SET_KEYS) {
            tally[label] = (tally[label] ?? 0) + 1
            await writeJsonFile(SET_STATS_FILE, tally)
          }
        }
        res.statusCode = 204
        res.end()
      } catch {
        res.statusCode = 400
        res.end()
      }
      return
    }
    // GET — 운영자만. 날짜별 칸을 그대로 주고 합계는 클라이언트가 낸다.
    const viewer = await currentUser(req)
    if (!isAdmin(viewer)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    const all = await load()
    const tally = await loadArtists()
    // 작가별 조회 순위: 많이 본 순으로 상위 50명.
    const artistRanking = Object.entries(tally)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
    // 세트별 조회 순위: 많이 연 순으로 상위 100개.
    const setTally = await loadSets()
    const setRanking = Object.entries(setTally)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100)
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ days: all, artists: artistRanking, sets: setRanking }))
  })
}

// 카드 제목·시리즈명 한글화가 이상할 때(예: "파미리마토"→"패밀리마트") 사용자가 알려주는
// 창구. 화면에 보인 제목과 원본 링크만 남긴다(개인정보 없음). 이 기록으로 koreanizeTitle
// 사전에서 고칠 단어를 보고 매핑을 보탠다. 원본 링크로 실제 일본어 이름을 확인할 수 있다.
function mountTranslationFeedback(app: Mountable) {
  let items: { title: string; raw: string; link: string; at: number }[] | null = null
  const allow = rateLimiter(20, 60 * 1000)

  async function load() {
    if (items) return items

    return firstReadOnce('items:2168', async () => {

      // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.

      if (items) return items
      try {
        items = JSON.parse(await readFile(TRANSLATION_FEEDBACK_FILE, 'utf-8'))
      } catch {
        items = []
      }
      return items!
  

    })

  }

  app.use('/api/local/translation-feedback', async (req, res) => {
    if (req.method === 'POST') {
      if (!allow(req)) {
        tooManyRequests(res)
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { title?: string; raw?: string; link?: string }
        const title = (b.title ?? '').slice(0, 120)
        if (!title.trim()) {
          res.statusCode = 400
          res.end()
          return
        }
        const all = await load()
        all.push({ title, raw: (b.raw ?? '').slice(0, 200), link: (b.link ?? '').slice(0, 200), at: Date.now() })
        if (all.length > MAX_TRANSLATION_FEEDBACK) all.splice(0, all.length - MAX_TRANSLATION_FEEDBACK)
        await mkdir(path.dirname(TRANSLATION_FEEDBACK_FILE), { recursive: true })
        await writeJsonFile(TRANSLATION_FEEDBACK_FILE, items)
        res.statusCode = 204
        res.end()
      } catch {
        res.statusCode = 400
        res.end()
      }
      return
    }
    // DELETE — 운영자가 처리 끝난 신고를 지운다({at}으로 하나) 또는 전체 비우기({all:true}).
    if (req.method === 'DELETE') {
      const viewer = await currentUser(req)
      if (!isAdmin(viewer)) {
        res.statusCode = 404
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'not found' }))
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { at?: number; all?: boolean }
        const all = await load()
        items = b.all ? [] : all.filter((x) => x.at !== b.at)
        await mkdir(path.dirname(TRANSLATION_FEEDBACK_FILE), { recursive: true })
        await writeJsonFile(TRANSLATION_FEEDBACK_FILE, items)
        res.statusCode = 204
        res.end()
      } catch {
        res.statusCode = 400
        res.end()
      }
      return
    }
    // GET — 운영자만. 아니면 이 경로가 있다는 것 자체를 안 알려준다.
    const viewer = await currentUser(req)
    if (!isAdmin(viewer)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    const all = await load()
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items: [...all].reverse() }))
  })
}

// ── 플리마켓 ────────────────────────────────────────────────────────────────
// 회원끼리 실물 카드를 거래하고, 그 거래가로 우리 자체 시세를 만드는 기능.
// 아직 화면은 없고 운영 설정만 있다. 순서를 이렇게 잡은 이유:
//   기능을 만든 뒤에 스위치를 붙이면, 문제가 터졌을 때 배포(약 7초 정지)를 해야 닫힌다.
//   스위치를 먼저 두면 화면에서 즉시 닫을 수 있다.
//
// 우리는 돈을 만지지 않는다(송금·배송은 당사자끼리). 전자상거래법상 '통신판매중개'라
// 제20조 제1항 고지("저희는 거래 당사자가 아닙니다")가 필수다 — noticeShown이 그 확인이다.
export type FleaConfig = {
  // 0 준비중(닫힘) · 1 매물+쪽지 · 2 거래기록까지 · 3 시세 공개
  stage: 0 | 1 | 2 | 3
  // 단계와 별개인 즉시 차단 스위치. false면 단계가 몇이든 닫힌다.
  open: boolean
  // 같은 카드·같은 등급으로 이만큼 모여야 시세로 보여준다.
  minSamples: number
  // 외부 시세(스니커덩크·이베이) 대비 이 배수 밖이면 시세 집계에서 뺀다.
  outlierLow: number
  outlierHigh: number
  // 제20조 제1항 고지문을 화면에 붙였는지. 이걸 안 켜면 3단계로 못 간다.
  noticeShown: boolean
  updatedAt: number
}

const FLEA_DEFAULT: FleaConfig = {
  stage: 0,
  open: false,
  minSamples: 3,
  outlierLow: 0.3,
  outlierHigh: 3,
  noticeShown: false,
  updatedAt: 0,
}

function normalizeFleaConfig(raw: unknown): FleaConfig {
  const b = (raw ?? {}) as Partial<FleaConfig>
  const stage = [0, 1, 2, 3].includes(Number(b.stage)) ? (Number(b.stage) as FleaConfig['stage']) : 0
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback
  }
  return {
    stage,
    open: b.open === true,
    minSamples: Math.round(num(b.minSamples, FLEA_DEFAULT.minSamples, 1, 100)),
    outlierLow: num(b.outlierLow, FLEA_DEFAULT.outlierLow, 0.01, 1),
    outlierHigh: num(b.outlierHigh, FLEA_DEFAULT.outlierHigh, 1, 100),
    noticeShown: b.noticeShown === true,
    updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : 0,
  }
}

// 싱글카드(등급 안 받은 카드) 등급과 등급카드(감정회사가 매긴 것) 등급.
// 표기는 스니커덩크와 맞춘다 — 그래야 우리 거래가와 스니커덩크
// 시세를 나란히 놓고 볼 수 있다. 판정 기준은 docs/플리마켓-등급기준.md에 있다.
export const FLEA_RAW_GRADES = ['A', 'B', 'C', 'D'] as const
export const FLEA_SLAB_GRADES = [
  'PSA10', 'PSA9', 'PSA8 이하',
  'BGS10 BL', 'BGS10 GL', 'BGS9.5', 'BGS9.5 이하',
  'ARS10+', 'ARS10', 'ARS9', 'ARS8 이하',
  '기타 감정품',
] as const
const FLEA_ALL_GRADES: string[] = [...FLEA_RAW_GRADES, ...FLEA_SLAB_GRADES]
const FLEA_EDITIONS = ['jp', 'na', 'kr'] as const

export type FleaListing = {
  id: number
  sellerId: string
  seller: string
  // 어느 카드인지. 카탈로그(public/sets)의 세트 코드 + 카드 번호로 못 박는다.
  // 이름을 자유롭게 받으면 같은 카드가 여러 갈래로 흩어져 시세를 못 만든다.
  cardSlug: string
  cardNo: string
  cardImg: string
  cardName: string
  setName: string
  edition: (typeof FLEA_EDITIONS)[number]
  grade: string
  // 감정 카드일 때만. 나중에 감정사 공식 조회로 대조해 가짜를 걸러내려고 필수로 받는다.
  certNo: string
  price: number
  images: string[]
  note: string
  status: 'open' | 'sold' | 'closed'
  createdAt: number
}

export type FleaOffer = {
  id: number
  listingId: number
  buyerId: string
  buyer: string
  price: number
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

// 성사된 거래. 우리 자체 시세는 이 기록으로만 만든다 — 올려둔 가격(호가)은 시세가 아니다.
export type FleaDeal = {
  id: number
  listingId: number
  // 시세는 이 둘로 묶어서 낸다(카드 + 등급). 이름으로 묶으면 표기가 갈려 안 모인다.
  cardSlug: string
  cardNo: string
  cardName: string
  edition: string
  grade: string
  price: number
  sellerId: string
  buyerId: string
  at: number
}

const MAX_FLEA_LISTINGS = 2000
const MAX_FLEA_IMAGES = 6
const FLEA_MAX_PRICE = 100_000_000

function mountFleaMarket(app: Mountable) {
  let config: FleaConfig | null = null
  let listings: FleaListing[] | null = null
  let offers: FleaOffer[] | null = null
  let deals: FleaDeal[] | null = null
  const allowWrite = rateLimiter(30, 60 * 1000)

  async function load(): Promise<FleaConfig> {
    if (config) return config
    return firstReadOnce('flea-config', async () => {
      if (config) return config
      try {
        config = normalizeFleaConfig(JSON.parse(await readFile(FLEA_CONFIG_FILE, 'utf-8')))
      } catch {
        config = { ...FLEA_DEFAULT }
      }
      return config!
    })
  }

  // 매물·제안·거래 목록. 파일이 없으면 빈 배열로 시작한다(아직 아무도 안 올린 상태).
  async function loadList<T>(key: string, file: string, get: () => T[] | null, set: (v: T[]) => void): Promise<T[]> {
    const cached = get()
    if (cached) return cached
    return firstReadOnce(key, async () => {
      const again = get()
      if (again) return again
      let parsed: T[]
      try {
        const raw = JSON.parse(await readFile(file, 'utf-8'))
        parsed = Array.isArray(raw) ? raw : []
      } catch {
        parsed = []
      }
      set(parsed)
      return parsed
    })
  }

  const loadListings = () =>
    loadList<FleaListing>('flea-listings', FLEA_LISTINGS_FILE, () => listings, (v) => { listings = v })
  const loadOffers = () =>
    loadList<FleaOffer>('flea-offers', FLEA_OFFERS_FILE, () => offers, (v) => { offers = v })
  const loadDeals = () =>
    loadList<FleaDeal>('flea-deals', FLEA_DEALS_FILE, () => deals, (v) => { deals = v })

  const nextId = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  app.use('/api/local/flea/listings', async (req, res) => {
    // 지금은 운영자만. 회원에게 여는 건 1단계로 올린 뒤에 푼다.
    const user = await currentUser(req)
    if (!isAdmin(user) || !user) {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    const url = new URL(req.url ?? '', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)

    // POST — 매물 올리기
    if (req.method === 'POST' && segments.length === 0) {
      if (!allowWrite(req)) {
        tooManyRequests(res)
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as Record<string, unknown>
        const cardSlug = str(b.cardSlug, 40)
        const cardNo = str(b.cardNo, 20)
        const cardName = str(b.cardName, 120)
        const grade = str(b.grade, 20)
        const price = Math.round(Number(b.price))
        const edition = FLEA_EDITIONS.includes(b.edition as never) ? (b.edition as FleaListing['edition']) : 'jp'
        const images = Array.isArray(b.images)
          ? b.images.filter((u): u is string => typeof u === 'string' && /^\/uploads\/[\w.-]+$/.test(u)).slice(0, MAX_FLEA_IMAGES)
          : []
        const isSlab = (FLEA_SLAB_GRADES as readonly string[]).includes(grade)
        const certNo = str(b.certNo, 40)

        // 카탈로그에서 고른 카드여야 한다. 형식만 확인한다 — 세트 파일은 서버가 아니라
        // 정적 파일(dist/sets)이라 여기서 존재 여부까지 보지는 않는다.
        // 세트 코드는 대소문자가 섞여 있다(ja-M5·ja-SV5a·en-me05 …) — 256개 중 79개가
        // 대문자를 쓴다. 소문자만 받으면 그 세트 카드는 아예 못 올린다.
        if (!/^[a-z]{2}-[A-Za-z0-9._-]+$/.test(cardSlug) || !/^[\w./-]+$/.test(cardNo) || !cardName) {
          sendJson(res, 400, { error: '카드를 골라 주세요.' })
          return
        }
        if (!FLEA_ALL_GRADES.includes(grade)) {
          sendJson(res, 400, { error: '등급을 골라 주세요.' })
          return
        }
        if (!Number.isFinite(price) || price <= 0 || price > FLEA_MAX_PRICE) {
          sendJson(res, 400, { error: '가격을 다시 확인해 주세요.' })
          return
        }
        // 감정 카드는 인증번호가 있어야 나중에 감정사 조회로 대조할 수 있다.
        if (isSlab && !certNo) {
          sendJson(res, 400, { error: '등급카드는 인증번호가 필요합니다.' })
          return
        }
        // 사진 장수는 등급 기준 문서와 맞춘다. A·B는 모서리까지 4장, C·D는 결함 사진까지 3장.
        const needed = grade === 'A' || grade === 'B' ? 4 : 3
        if (images.length < needed) {
          sendJson(res, 400, { error: `${grade}등급은 사진 ${needed}장이 필요합니다.` })
          return
        }

        const all = await loadListings()
        const row: FleaListing = {
          id: nextId(all),
          sellerId: user.id,
          seller: user.nickname ?? '운영자',
          cardSlug,
          cardNo,
          cardImg: str(b.cardImg, 300),
          cardName,
          setName: str(b.setName, 120),
          edition,
          grade,
          certNo: isSlab ? certNo : '',
          price,
          images,
          note: str(b.note, 500),
          status: 'open',
          createdAt: Date.now(),
        }
        all.push(row)
        if (all.length > MAX_FLEA_LISTINGS) all.splice(0, all.length - MAX_FLEA_LISTINGS)
        await writeJsonFile(FLEA_LISTINGS_FILE, all)
        const { sellerId: _hidden, ...safe } = row
        sendJson(res, 201, { ...safe, mine: true, offers: 0 })
      } catch {
        sendJson(res, 400, { error: '올리지 못했습니다.' })
      }
      return
    }

    // DELETE /listings/<id> — 내 매물 내리기
    if (req.method === 'DELETE' && segments.length === 1) {
      const id = Number(segments[0])
      const all = await loadListings()
      const row = all.find((l) => l.id === id)
      if (!row || row.sellerId !== user.id) {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      row.status = 'closed'
      await writeJsonFile(FLEA_LISTINGS_FILE, all)
      res.statusCode = 204
      res.end()
      return
    }

    // GET — 매물 목록. 내린 매물은 빼고 최신순.
    const [all, pending] = await Promise.all([loadListings(), loadOffers()])
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
    // 카드 한 장의 매물만 볼 때 쓴다(카드 페이지). 팔린 것도 같이 준다 —
    // 얼마에 팔렸는지가 시세를 가늠하는 자료라 스니커덩크도 그렇게 보여준다.
    const slug = url.searchParams.get('slug') ?? ''
    const no = url.searchParams.get('no') ?? ''
    const rows = all
      .filter((l) => l.status !== 'closed')
      .filter((l) => !slug || (l.cardSlug === slug && l.cardNo === no))
      .filter((l) => !q || l.cardName.toLowerCase().includes(q) || l.setName.toLowerCase().includes(q))
      // 파는 중인 게 먼저, 그 안에서 싼 것부터. 팔린 건 뒤에 최근 순으로.
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1
        return a.status === 'open' ? a.price - b.price : b.createdAt - a.createdAt
      })
      // 회원번호(sellerId)는 클라이언트로 내리지 않는다 — /me가 안 주는 것과 같은 이유다.
      // 대신 "내 매물인지"만 서버가 판단해서 알려준다.
      .map(({ sellerId, ...l }) => ({
        ...l,
        mine: sellerId === user.id,
        offers: pending.filter((o) => o.listingId === l.id && o.status === 'pending').length,
      }))
    sendJson(res, 200, rows)
  })

  // 카드 이름으로 세트를 가리지 않고 찾는다("개굴닌자" → 어느 세트에 있든 다 나온다).
  //
  // 색인(dist/card-index.json)은 scripts/gen-card-index.mts 가 미리 만들어 둔 것이다.
  // 3MB라 클라이언트로 통째로 내려주면 무겁다 — 서버가 한 번 읽어 두고 결과만 준다.
  // 한글 이름도 색인에 이미 들어 있어 서버가 변환기를 들고 있을 필요가 없다.
  type CardIndex = {
    sets: Record<string, [string, string, string]> // slug → [한글 세트명, ed, 발매일]
    rows: [string, string, string, string, string, string, string][]
  }
  let cardIndex: CardIndex | null = null
  let cardIndexTried = false

  async function loadCardIndex(): Promise<CardIndex | null> {
    if (cardIndex || cardIndexTried) return cardIndex
    return firstReadOnce('card-index', async () => {
      if (cardIndex) return cardIndex
      cardIndexTried = true
      // 리포 루트(개발)와 이미지 루트(배포) 모두 같은 자리다. public/ 에 두지 않는 이유는
      // 거기 있으면 정적 파일로 공개돼 누구나 3MB를 내려받게 되기 때문이다.
      try {
        cardIndex = JSON.parse(await readFile(path.resolve('card-index.json'), 'utf-8'))
        return cardIndex
      } catch {
        /* 아래에서 알린다 */
      }
      console.warn('[flea] card-index.json 을 못 찾았습니다. npx tsx scripts/gen-card-index.mts 로 만드세요.')
      return null
    })
  }

  const SEARCH_LIMIT = 60

  app.use('/api/local/flea/search', async (req, res) => {
    const user = await currentUser(req)
    if (!isAdmin(user) || !user) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const url = new URL(req.url ?? '', 'http://localhost')
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    // jp = 일본판, na = 북미판, kr = 한글판(한글 자료가 붙은 카드만)
    const ed = url.searchParams.get('ed') ?? 'jp'
    if (q.length < 1) {
      sendJson(res, 200, { rows: [], total: 0 })
      return
    }

    const [idx, all] = await Promise.all([loadCardIndex(), loadListings()])
    if (!idx) {
      sendJson(res, 200, { rows: [], total: 0 })
      return
    }

    // 카드별 매물 수·최저가. 검색 결과 칸에 바로 붙여 준다.
    const stat = new Map<string, { onSale: number; lowest: number | null }>()
    for (const l of all) {
      if (l.status !== 'open') continue
      const key = `${l.cardSlug}/${l.cardNo}`
      const cur = stat.get(key) ?? { onSale: 0, lowest: null as number | null }
      cur.onSale++
      cur.lowest = cur.lowest == null ? l.price : Math.min(cur.lowest, l.price)
      stat.set(key, cur)
    }

    const wantEd = ed === 'na' ? 'en' : 'ja'
    const out: unknown[] = []
    let total = 0
    for (const r of idx.rows) {
      const [slug, n, name, img, koName, koImg, koNo] = r
      const set = idx.sets[slug]
      if (!set) continue
      if (ed === 'kr' ? !koImg : set[1] !== wantEd) continue
      const label = ed === 'kr' ? koName || name : name
      if (!label.toLowerCase().includes(q)) continue
      total++
      if (out.length >= SEARCH_LIMIT) continue
      const no = ed === 'kr' ? koNo || n : n
      const hit = stat.get(`${slug}/${no}`)
      out.push({
        slug,
        n: no,
        name: label,
        img: ed === 'kr' ? koImg : img,
        setName: set[0],
        ed,
        onSale: hit?.onSale ?? 0,
        lowest: hit?.lowest ?? null,
      })
    }
    sendJson(res, 200, { rows: out, total })
  })

  // 매물이 하나라도 올라온 카드 목록. 카드 한 장이 한 줄이고, 그 카드의 매물 수와
  // 최저가가 붙는다. 매물 탭의 첫 화면이다 — 매물 낱개를 늘어놓는 게 아니라
  // "어떤 카드에 매물이 있는지"를 먼저 보여줘야 카탈로그처럼 굴러간다.
  app.use('/api/local/flea/cards', async (req, res) => {
    const user = await currentUser(req)
    if (!isAdmin(user) || !user) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const all = await loadListings()
    const byCard = new Map<
      string,
      {
        cardSlug: string
        cardNo: string
        cardImg: string
        cardName: string
        setName: string
        edition: string
        onSale: number
        sold: number
        lowest: number | null
      }
    >()
    for (const l of all) {
      if (l.status === 'closed') continue
      const key = `${l.cardSlug}/${l.cardNo}`
      const row =
        byCard.get(key) ??
        {
          cardSlug: l.cardSlug,
          cardNo: l.cardNo,
          cardImg: l.cardImg,
          cardName: l.cardName,
          setName: l.setName,
          edition: l.edition,
          onSale: 0,
          sold: 0,
          lowest: null as number | null,
        }
      if (l.status === 'sold') row.sold++
      else {
        row.onSale++
        row.lowest = row.lowest == null ? l.price : Math.min(row.lowest, l.price)
      }
      byCard.set(key, row)
    }
    // 파는 중인 매물이 많은 카드부터. 같으면 이름순으로 고정해 순서가 흔들리지 않게 한다.
    const rows = [...byCard.values()].sort((a, b) => b.onSale - a.onSale || a.cardName.localeCompare(b.cardName))
    sendJson(res, 200, rows)
  })

  app.use('/api/local/flea/offers', async (req, res) => {
    const user = await currentUser(req)
    if (!isAdmin(user) || !user) {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    const url = new URL(req.url ?? '', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)

    // POST — 이 값에 사겠다고 제안한다. 흥정을 쪽지가 아니라 버튼으로 하는 게 핵심이다.
    // 그래야 합의 금액이 시스템에 남아 시세로 쓸 수 있다(쪽지 안에 숨으면 못 쓴다).
    if (req.method === 'POST' && segments.length === 0) {
      if (!allowWrite(req)) {
        tooManyRequests(res)
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { listingId?: unknown; price?: unknown }
        const listingId = Number(b.listingId)
        const price = Math.round(Number(b.price))
        const all = await loadListings()
        const listing = all.find((l) => l.id === listingId && l.status === 'open')
        if (!listing) {
          sendJson(res, 404, { error: '이미 없는 매물입니다.' })
          return
        }
        if (!Number.isFinite(price) || price <= 0 || price > FLEA_MAX_PRICE) {
          sendJson(res, 400, { error: '금액을 다시 확인해 주세요.' })
          return
        }
        // ⚠️ 지금은 운영자 혼자라 자기 매물에도 제안할 수 있게 열어 뒀다(흐름 확인용).
        // 회원에게 열 때 여기서 sellerId === user.id 를 막아야 한다.
        const rows = await loadOffers()
        const row: FleaOffer = {
          id: nextId(rows),
          listingId,
          buyerId: user.id,
          buyer: user.nickname ?? '운영자',
          price,
          status: 'pending',
          createdAt: Date.now(),
        }
        rows.push(row)
        await writeJsonFile(FLEA_OFFERS_FILE, rows)
        const { buyerId: _hidden, ...safe } = row
        sendJson(res, 201, { ...safe, canAnswer: listing.sellerId === user.id, mine: true })
      } catch {
        sendJson(res, 400, { error: '보내지 못했습니다.' })
      }
      return
    }

    // PUT /offers/<id> — 판매자가 수락하거나 거절한다. 수락하면 그 금액이 거래로 남는다.
    if (req.method === 'PUT' && segments.length === 1) {
      try {
        const id = Number(segments[0])
        const b = JSON.parse(await readBody(req)) as { accept?: unknown }
        const [rows, all] = await Promise.all([loadOffers(), loadListings()])
        const offer = rows.find((o) => o.id === id && o.status === 'pending')
        const listing = offer ? all.find((l) => l.id === offer.listingId) : undefined
        if (!offer || !listing || listing.sellerId !== user.id) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        if (b.accept !== true) {
          offer.status = 'rejected'
          await writeJsonFile(FLEA_OFFERS_FILE, rows)
          sendJson(res, 200, { ...offer, buyerId: undefined })
          return
        }
        offer.status = 'accepted'
        listing.status = 'sold'
        // 남은 제안은 자동으로 거절 처리한다 — 판 물건에 제안이 계속 붙어 있으면 헷갈린다.
        for (const o of rows) if (o.listingId === listing.id && o.status === 'pending') o.status = 'rejected'
        const done = await loadDeals()
        done.push({
          id: nextId(done),
          listingId: listing.id,
          cardSlug: listing.cardSlug,
          cardNo: listing.cardNo,
          cardName: listing.cardName,
          edition: listing.edition,
          grade: listing.grade,
          price: offer.price,
          sellerId: listing.sellerId,
          buyerId: offer.buyerId,
          at: Date.now(),
        })
        await writeJsonFile(FLEA_OFFERS_FILE, rows)
        await writeJsonFile(FLEA_LISTINGS_FILE, all)
        await writeJsonFile(FLEA_DEALS_FILE, done)
        sendJson(res, 200, { ...offer, buyerId: undefined })
      } catch {
        sendJson(res, 400, { error: '처리하지 못했습니다.' })
      }
      return
    }

    // GET /offers?listingId=N — 그 매물에 들어온 제안. 여기서도 회원번호는 빼고,
    // "내가 답할 수 있는 제안인지"(내 매물에 들어온 것인지)만 서버가 알려준다.
    const [rows, all] = await Promise.all([loadOffers(), loadListings()])
    const listingId = Number(url.searchParams.get('listingId'))
    const sellerOf = new Map(all.map((l) => [l.id, l.sellerId]))
    sendJson(
      res,
      200,
      rows
        .filter((o) => !Number.isFinite(listingId) || o.listingId === listingId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(({ buyerId, ...o }) => ({ ...o, canAnswer: sellerOf.get(o.listingId) === user.id, mine: buyerId === user.id })),
    )
  })

  app.use('/api/local/flea/config', async (req, res) => {
    const viewer = await currentUser(req)
    // 운영자가 아니면 이 경로가 있다는 것 자체를 알리지 않는다(다른 운영 경로와 같은 방식).
    if (!isAdmin(viewer)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    if (req.method === 'PUT') {
      try {
        const next = normalizeFleaConfig(JSON.parse(await readBody(req)))
        // 고지문을 안 붙였으면 시세 공개(3단계)로 못 간다. 화면에서도 막지만
        // 서버에서 한 번 더 막는다 — 여기가 진짜 잠금이다.
        if (next.stage === 3 && !next.noticeShown) {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: '고지문을 붙인 뒤에 시세를 공개할 수 있습니다.' }))
          return
        }
        next.updatedAt = Date.now()
        config = next
        await writeJsonFile(FLEA_CONFIG_FILE, next)
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(next))
      } catch {
        res.statusCode = 400
        res.end()
      }
      return
    }

    const [current, allListings, allDeals] = await Promise.all([load(), loadListings(), loadDeals()])
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        config: current,
        counts: { listings: allListings.filter((l) => l.status !== 'closed').length, deals: allDeals.length },
      }),
    )
  })
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

    // 이미 한도에 걸린 걸 아는 동안은 부르지 않는다. 불러도 429가 돌아올 뿐인데,
    // 그 429가 쌓이면 키가 정지된다(위 pptGate 설명).
    const gate = pptGate()
    if (!gate.ok) {
      res.statusCode = 429
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: gate.daily ? 'daily_limit' : 'upstream_error', status: 429 }))
      return
    }

    try {
      // 등급별 가격 추이 그래프를 그리려면 히스토리를 함께 받아야 한다. 클라이언트가
      // 보낸 검색 조건은 그대로 두고 히스토리 옵션만 서버에서 덧붙인다. (캐시 키는
      // 클라이언트 쿼리 기준이라 그대로 두면 된다.)
      const upstreamParams = new URLSearchParams(url.search)
      // have는 우리 서버에서만 쓰는(소스 필터) 값이라 PPT엔 보내지 않는다(보내면 400).
      upstreamParams.delete('have')
      upstreamParams.set('includeHistory', 'true')
      // 이베이 날짜별 낙찰 히스토리는 includeEbay를 켜야 온다(등급별 그래프의 재료).
      upstreamParams.set('includeEbay', 'true')
      upstreamParams.set('days', '180')
      // 히스토리 점 수 상한 — 응답 크기와 그래프 해상도의 균형(180일에 60점 = 3일 간격).
      upstreamParams.set('maxDataPoints', '60')
      const upstream = await fetch(`${PRICE_TRACKER_ORIGIN}/cards?${upstreamParams.toString()}`, {
        signal: AbortSignal.timeout(UPSTREAM_SLOW_MS),
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
      })

      notePpt(upstream.status, upstream.headers)

      if (!upstream.ok) {
        // 업스트림 원본 에러 바디는 그대로 흘리지 않고 상태 코드만 전달한다.
        // (에러 응답은 캐시하지 않아 일시적 429/500이 6시간 고정되지 않게 한다.)
        // 429는 두 종류다. 분당 한도면 정말 "잠시 후"에 풀리지만, 하루치를 다 쓴 것이면
        // 한국시간 오전 9시(UTC 0시)까지 안 열린다. 화면에 다르게 안내해야 방문자가
        // 헛되이 새로고침하지 않는다.
        const dailyLeft = Number(upstream.headers.get('x-ratelimit-daily-remaining'))
        const daily = upstream.status === 429 && Number.isFinite(dailyLeft) && dailyLeft <= 0
        res.statusCode = upstream.status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: daily ? 'daily_limit' : 'upstream_error', status: upstream.status }))
        return
      }

      // 원본을 그대로 넘기지 않고 화면용 필드만 추려서 재배포 소지를 없앤다.
      const rawJson = await upstream.json()
      // shapeEbayCards는 낙찰 없는 카드를 걸러내서, 걸러진 개수만 보면 "더 있는지"를
      // 오판한다(한 페이지가 꽉 찼는데 필터로 줄면 끝난 줄 안다). 원본 개수를 함께
      // 실어 보내, 클라이언트가 "원본이 페이지 크기만큼 왔으면 더 있다"고 판단하게 한다.
      const rawList = Array.isArray((rawJson as { data?: unknown }).data)
        ? ((rawJson as { data: unknown[] }).data)
        : (rawJson as { data?: unknown }).data
          ? [(rawJson as { data: unknown }).data]
          : []
      // have=tcgplayer면 TCGplayer 시세 있는 카드만 추린다(기본은 이베이 낙찰 카드).
      const have = url.searchParams.get('have') === 'tcgplayer' ? 'tcgplayer' : 'ebay'
      // 지나가는 김에 이름을 주워 둔다(공유 링크 미리보기에 쓴다). 화면에 나갈 목록이
      // 아니라 원본에서 주워야 한다 — 낙찰 기록이 없어 걸러진 카드도 이름은 알 수 있고,
      // 그 카드의 링크를 공유할 수도 있다.
      for (const row of rawList) {
        const c = row as { tcgPlayerId?: unknown; name?: unknown }
        if (typeof c?.tcgPlayerId === 'string' && typeof c?.name === 'string') {
          rememberCardName(c.tcgPlayerId, c.name)
        }
      }
      const body = JSON.stringify({ cards: shapeEbayCards(rawJson, have), rawCount: rawList.length })
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

// ── 이베이 한글판(Korean Version) 시세 ────────────────────────────────────
// Browse API로 "카드명 Korean Version" 현재 매물가(호가)를 받는다. 체결가(낙찰가)를 주는
// Marketplace Insights는 이베이 별도 승인이 필요해 지금은 호가. 그래서 화면에 "현재 매물가"로
// 명확히 표기한다(북미판=체결가와 혼동 금지). 키(App/Cert)는 서버에서만, 클라이언트엔 안 내림.
const EBAY_OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'
const EBAY_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6시간(호가는 자주 안 변함 + 무료 콜 아낌)
const EBAY_MAX_ENTRIES = 2000

function mountEbayKorean(app: Mountable, appId: string, certId: string) {
  const cache = new TtlCache<string>(EBAY_CACHE_TTL_MS, EBAY_MAX_ENTRIES)
  const allow = rateLimiter(300, 60 * 1000)
  // 앱 토큰(client_credentials, 2시간)은 요청마다 새로 받지 않고 캐시해 재사용한다.
  let token = { value: '', exp: 0 }

  async function getToken(): Promise<string> {
    const now = Date.now()
    if (token.value && now < token.exp - 60_000) return token.value
    const basic = Buffer.from(`${appId}:${certId}`).toString('base64')
    const r = await fetch(EBAY_OAUTH_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
    })
    const j = (await r.json()) as { access_token?: string; expires_in?: number }
    if (!j.access_token) throw new Error('ebay_oauth_failed')
    token = { value: j.access_token, exp: now + (j.expires_in ?? 7200) * 1000 }
    return token.value
  }

  app.use('/api/local/ebay-korean', async (req, res) => {
    if (!appId || !certId) {
      sendJson(res, 501, { error: 'EBAY keys not configured' })
      return
    }
    const url = new URL(req.url ?? '', 'http://localhost')
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
    if (!q) {
      sendJson(res, 400, { error: 'missing q' })
      return
    }
    const cacheKey = q.toLowerCase()
    const cached = cache.get(cacheKey)
    if (cached) {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(cached)
      return
    }
    if (!allow(req)) {
      tooManyRequests(res)
      return
    }
    try {
      const tok = await getToken()
      // 이베이 매물 제목은 영어라 "Korean Version"을 붙여 한글판만 걸러 받는다.
      // category_ids=183454 = CCG Individual Cards(낱장 카드). 박스·팩·스티커 등을 뺀다.
      const params = new URLSearchParams({
        q: `${q} Korean Version`,
        category_ids: '183454',
        limit: '24',
        filter: 'buyingOptions:{FIXED_PRICE}',
        sort: 'price',
      })
      const r = await fetch(`${EBAY_BROWSE_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(UPSTREAM_SLOW_MS),
        headers: { authorization: `Bearer ${tok}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      })
      if (!r.ok) {
        sendJson(res, r.status, { error: 'upstream_error', status: r.status })
        return
      }
      const j = (await r.json()) as {
        total?: number
        itemSummaries?: Array<{
          title?: string
          price?: { value?: string; currency?: string }
          itemWebUrl?: string
          image?: { imageUrl?: string }
          thumbnailImages?: Array<{ imageUrl?: string }>
          condition?: string
        }>
      }
      const items = (j.itemSummaries ?? [])
        .map((it) => ({
          title: it.title ?? '',
          price: it.price?.value ? Number(it.price.value) : null,
          currency: it.price?.currency ?? 'USD',
          url: it.itemWebUrl ?? '',
          img: it.image?.imageUrl ?? it.thumbnailImages?.[0]?.imageUrl ?? '',
          condition: it.condition ?? '',
        }))
        .filter((x) => x.price != null && x.price > 0)
      const body = JSON.stringify({ total: j.total ?? items.length, items })
      cache.set(cacheKey, body)
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(body)
    } catch {
      sendJson(res, 502, { error: 'ebay_fetch_failed' })
    }
  })
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MAX_IMAGE_BODY_BYTES = 8 * 1024 * 1024
// 카드를 몇 장 찍어보는 건 넉넉히 되면서, 스크립트로 몰아쳐서 요금을 태우진 못하는 선.
const SCAN_RATE_LIMIT = 10
const SCAN_RATE_WINDOW_MS = 60 * 60 * 1000
// 사람마다 시간당 10번을 막아도, 사람 수에는 상한이 없다. 방문자가 늘거나 여러 곳에서
// 몰아치면 요금이 끝없이 올라가므로 하루 전체 상한을 따로 둔다. 이걸 넘으면 그날은
// 스캔을 멈추고 안내만 한다 — 사이트의 다른 기능은 그대로 쓸 수 있다.
const SCAN_DAILY_LIMIT = 300
// Claude 비전이 받는 형식만 보낸다. 안 받는 형식을 그대로 넘기면 요금을 쓰고
// 실패만 돌아온다(HEIC 원본이 그대로 오는 경우가 실제로 있다).
const SCAN_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// 홀로(반짝이) 카드는 빛 반사로 작은 글씨가 잘 안 읽힌다. 제일 약한 Haiku 대신 눈이
// 좋은 Sonnet을 써서 반사·작은 글씨 판독률을 올린다(스캔 한 번당 비용은 여전히 1센트 미만).
const CARD_SCAN_MODEL = 'claude-sonnet-5'

const CARD_SCAN_PROMPT = `이 이미지는 포켓몬 카드다. 등급 케이스(슬랩)에 들어 있을 수도 있다. 아래 JSON 하나로만 답하고 다른 말은 절대 붙이지 마라.

【사진에 카드가 여러 장이면】
가장 크게, 가장 가운데 있는 카드 한 장만 읽어라. 여러 장을 뭉뚱그려 답하지 마라.

【사진이 화면 캡처면】
휴대폰 상태표시줄·앱 제목·댓글·상품 설명처럼 카드 바깥의 글자는 전부 무시하고 카드만 봐라.
특히 언어 판정을 카드 바깥 글자로 하면 안 된다 — 한국어 앱 화면에 영어 카드가 올라와 있는
경우가 흔하다. 판정은 오직 카드에 인쇄된 글자로만 한다.

【등급 케이스(슬랩)일 때】
위쪽에 인쇄된 라벨을 먼저 읽어라. 케이스 안 카드의 작은 글씨보다 라벨이 훨씬 또렷하다.
라벨에는 보통 이런 것들이 적혀 있다 — 발매연도 · 언어(JAPANESE 등) · 세트 이름이나 코드 ·
카드 번호 · 카드 이름 · 감정 등급.
⚠️ 회사(PSA·BGS·CGC·SGC 등)마다 순서와 표기가 달라서 정해진 틀이 없다. 순서에 기대지 말고
보이는 항목을 하나씩 골라내라. 판단이 어려우면 이렇게 본다:
· 숫자 두 개가 떨어져 있으면 대개 앞이 카드 번호, 뒤(또는 큰 글씨)가 등급이다.
· "10" "9.5" "GEM MT 10" "MINT 9"처럼 10 이하 숫자나 등급어가 붙은 것은 등급이지 카드 번호가 아니다.
· 카드 번호는 "086/083"처럼 빗금이 있거나 세트 코드가 옆에 붙는 경우가 많다.
· 라벨 맨 위 긴 숫자(인증번호)는 카드 번호가 아니다. 절대 쓰지 마라.
라벨이 잘려서 안 보이면 케이스 안 카드에서 읽어라.

【케이스가 없는 맨 카드일 때】
카드 번호는 보통 아래쪽 구석에 작게 인쇄돼 있다. 홀로그램 반사·번들거림이 있으면
반사에 가려지지 않은 또렷한 글자만 읽어라.

【번호가 안 보이면】
번호를 지어내지 말고 null로 두되, 대신 카드를 알아볼 다른 단서를 최대한 채워라.
그림 아래나 옆에 작게 적힌 일러스트레이터 이름(예: "Illus. Mitsuhiro Arita")이 특히 중요하다.

{"found": true, "pokemonNameEn": "카드에 인쇄된 이름을 먼저 정확히 읽어 어떤 포켓몬/트레이너인지 알아낸 뒤, 그 카드가 영어판 포켓몬 카드에서 쓰는 공식 영어 이름으로 답하라(추측 금지, 인쇄된 이름 기준). ex·V·VMAX·VSTAR·GX 표기가 있으면 포함(예: Greninja ex, Pikachu V)", "cardNumber": "카드 번호(예: 086/083, 209/XY-P, 025/165). 반사로 흐릿해 확실치 않으면 절대 지어내지 말고 null. 틀린 번호보다 null이 낫다", "setCode": "세트 코드(예: M4, SV5a, XY-P). 번호 옆이나 라벨에서. 안 보이면 null", "edition": "카드 자체에 인쇄된 언어 기준(사진 속 앱 화면·설명글은 절대 보지 마라). 일본어면 \\"japanese\\", 한국어여도 반드시 \\"japanese\\"로 답하라, 영어면 \\"english\\". \\"korean\\"이라고 답하지 마라", "illustrator": "일러스트레이터 이름을 인쇄된 로마자 그대로(예: Mitsuhiro Arita, 5ban Graphics). \\"Illus.\\"는 빼고 이름만. 안 보이면 null", "hp": "HP 숫자만(예: 210). 없거나 안 보이면 null", "rarity": "카드 오른쪽 아래 레어도 기호나 글자(예: RR, SAR, AR, C, U, R). 안 보이면 null", "year": "카드나 라벨에 적힌 발매연도 4자리(예: 2023). 안 보이면 null", "graded": "등급 케이스에 들어 있으면 true, 맨 카드면 false", "gradeCompany": "등급 회사(PSA, BGS, CGC, SGC, ARS 등). 케이스가 아니거나 안 보이면 null", "grade": "감정 등급(예: 10, 9.5). 안 보이면 null"}

포켓몬 카드가 아니면 {"found": false} 로만 답하라.`

// 휴대폰 카메라로 카드를 찍으면 Claude 비전으로 카드 이름/세트코드/번호를 읽어서
// 우리 검색 파이프라인에 바로 꽂을 수 있게 돌려준다. 이미지 매칭 DB를 직접 구축하는
// 대신, 카드에 이미 인쇄되어 있는 텍스트를 읽는 방식이라 훨씬 가볍고 정확하다.
function mountCardScan(app: Mountable, apiKey: string) {
  const allow = rateLimiter(SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_MS)
  // 하루 사용량. 파일에 남긴다 — 메모리에만 두면 배포할 때마다 0으로 돌아가서
  // 상한이 사실상 없는 것과 같아진다.
  const SCAN_USAGE_FILE = dataFile('scan-usage.json')
  let scanUsage: { day: string; count: number } | null = null
  async function bumpScanUsage(): Promise<number> {
    const today = kstDayKey(Date.now())
    if (!scanUsage) {
      try {
        scanUsage = JSON.parse(await readFile(SCAN_USAGE_FILE, 'utf-8'))
      } catch {
        scanUsage = { day: today, count: 0 }
      }
    }
    if (scanUsage!.day !== today) scanUsage = { day: today, count: 0 }
    scanUsage!.count += 1
    await mkdir(path.dirname(SCAN_USAGE_FILE), { recursive: true }).catch(() => undefined)
    await writeJsonFile(SCAN_USAGE_FILE, scanUsage).catch(() => undefined)
    return scanUsage!.count
  }

  // 커뮤니티에 올린 사진. /data/uploads 안의 파일만 이름으로 찾아 내보낸다
  // (경로에 슬래시나 ..이 들어오면 거절 — 서버의 다른 파일을 읽히면 안 된다).
  app.use('/uploads', async (req, res) => {
    const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''))
    if (!/^[\w.-]+$/.test(name) || name.includes('..')) {
      res.statusCode = 400
      res.end()
      return
    }
    const ext = name.split('.').pop() ?? ''
    const type = Object.entries(UPLOAD_TYPES).find(([, e]) => e === ext)?.[0]
    if (!type) {
      res.statusCode = 400
      res.end()
      return
    }
    try {
      const buf = await readFile(path.join(UPLOAD_DIR, name))
      res.setHeader('content-type', type)
      // 파일 이름에 시각+난수가 들어가 내용이 바뀌지 않으므로 오래 캐시해도 된다.
      res.setHeader('cache-control', 'public, max-age=31536000, immutable')
      res.end(buf)
    } catch {
      res.statusCode = 404
      res.end()
    }
  })

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
      if (!SCAN_MEDIA_TYPES.includes(body.mediaType)) {
        res.statusCode = 415
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'unsupported image type' }))
        return
      }
      // 요금이 나가기 직전에 하루 상한을 확인한다.
      if ((await bumpScanUsage()) > SCAN_DAILY_LIMIT) {
        res.statusCode = 429
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'daily_limit' }))
        return
      }

      const upstream = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
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
// 운영자만 쓸 수 있는 닉네임. 금지가 아니라 예약이다 — 이 단어를 막는 이유가 운영자인
// 척하는 걸 막으려는 것이므로, 진짜 운영자에게까지 막으면 앞뒤가 안 맞는다.
//
// 운영자 배지를 달아놔도 닉네임 자체가 "운영자"면 목록에서 흘려볼 때 구분이 안 된다.
// 배지를 만든 순간 사칭 통로도 같이 열린 셈이라 함께 막아야 한다.
const RESERVED_NICKNAMES = ['운영자', '관리자', '운영팀', '관리팀', '공지', 'admin', 'administrator', 'pokegre', '포켓그레']

// 대놓고 쓰는 것만 막는 목록. 벽이 아니라 속도방지턱이다 — "시1발", "싀발", "ㅅ1ㅂ"
// 처럼 조금만 비틀면 얼마든지 빠져나간다. 목록으로 다 막겠다는 건 애초에 이길 수 없는
// 싸움이라, 뚫린 건 운영자가 신고함에서 닉네임을 초기화해서 처리한다.
//
// 일부러 뺀 것들: "보지", "자지"는 한국어 동사 활용형이라("보지 못하다", "자지 않다")
// 멀쩡한 닉네임을 막는다. "새끼"도 "고양이새끼" 같은 게 걸린다. 걸러내려다 진짜
// 사용자를 쫓아내는 쪽이 더 손해다. 짧게 두고 필요하면 여기에 추가한다.
//
// 부분 일치라 "시발"은 "시발점(始發點)"도 막는다. 닉네임으로 쓸 일이 거의 없어
// 감수한다.
const BANNED_WORDS = [
  '씨발',
  '시발',
  '씨팔',
  '시팔',
  '씨빨',
  'ㅅㅂ',
  '좆',
  '병신',
  'ㅂㅅ',
  'ㅄ',
  '지랄',
  '개새끼',
  '니미',
  '창녀',
  '강간',
  '섹스',
  '야동',
  'fuck',
  'shit',
  'bitch',
]

// 예약어·금지어 검사용. 띄어쓰기로 피해가는 걸("운 영 자", "ㅅ ㅂ") 막으려고 공백을
// 전부 지우고 대소문자도 맞춘다.
function normalizeForReserved(nickname: string): string {
  return nickname.toLowerCase().replace(/\s+/g, '')
}

function containsBannedWord(nickname: string): boolean {
  const normalized = normalizeForReserved(nickname)
  return BANNED_WORDS.some((w) => normalized.includes(w))
}

// 중복 검사용. 예약어와 달리 공백은 살린다 — "개 발자"와 "개발자"는 다른 이름으로 봐도
// 되고, 공백까지 지우면 멀쩡한 닉네임끼리 부딪힌다. 대소문자만 맞춰서 "Pokegre"와
// "pokegre"가 같이 존재하는 것만 막는다.
// 중복 검사용으로 "같은 이름"을 한 모양으로 모은다. 소문자만 맞추던 시절엔
// "독자"와 "독자<보이지 않는 공백>", "DOKJA"와 "ＤＯＫＪＡ"(전각)가 서로 다른 이름으로
// 통과해서 남의 닉네임을 그대로 흉내낼 수 있었다.
// NFKC는 전각·호환 문자를 보통 글자로 모아 주고, 그다음 공백·보이지 않는 문자를 지운다.
function normalizeForDuplicate(nickname: string): string {
  return nickname
    .normalize('NFKC')
    .replace(/[\s\u00ad\u200b-\u200f\u2060\ufeff]/g, '')
    .toLowerCase()
}

// 닉네임에 쓸 수 있는 글자. 한글(자모 포함 — "ㅋㅋ" 같은 것)·영문·숫자와 가운데 공백,
// 밑줄·붙임표·마침표만 받는다. 태그처럼 보이는 이름(<script>…)이나 눈에 안 보이는
// 문자를 막는 게 목적이다 — 목록에서 남과 구분이 되어야 한다.
const NICKNAME_OK = /^[가-힣ㄱ-ㆎa-zA-Z0-9]([가-힣ㄱ-ㆎa-zA-Z0-9 ._-]*[가-힣ㄱ-ㆎa-zA-Z0-9._-])?$/

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

type LoginProvider = 'kakao' | 'naver'

interface User {
  // "kakao:4992619297" 처럼 어디서 온 번호인지 앞에 붙여 저장한다.
  //
  // 카카오와 네이버는 각자 회원번호를 매기므로 서로 겹칠 수 있다(둘 다 숫자 문자열을
  // 준다). 번호만 저장하면 겹치는 순간 서로 모르는 두 사람이 한 계정을 쓰게 되어
  // 남의 즐겨찾기가 보이고 남의 이름으로 글이 써진다. 접두어를 붙이면 구조적으로
  // 그럴 수가 없다.
  //
  // 회원번호는 우리가 저장하는 유일한 로그인 정보다 — 이름/프로필/이메일은 양쪽 다
  // 동의항목에서 요청하지 않아 애초에 넘어오지 않는다.
  //
  // 계정의 영구 키다. 즐겨찾기(collections의 키)와 게시글(authorId)이 이 값을 가리키므로
  // 나중에 로그인 수단을 붙이거나 떼도 이건 절대 바뀌지 않는다. 처음 가입한 수단의
  // 식별자가 그대로 굳는다.
  id: string
  // 이 계정으로 들어올 수 있는 로그인 수단들. 보통 하나지만, 본인이 마이페이지에서
  // 연결하면 ["kakao:123", "naver:abc"]처럼 늘어난다.
  //
  // 이메일이나 본인인증 없이 두 번호가 같은 사람인 걸 알 방법은 없다. 그래서 자동으로
  // 합치지 않고, 로그인한 상태에서 본인이 직접 연결하게 한다 — 그 행위 자체가 증거다.
  logins: string[]
  nickname: string | null
  createdAt: number
}

interface Session {
  token: string
  userId: string
  expiresAt: number
}

function userId(provider: LoginProvider, providerId: string): string {
  return `${provider}:${providerId}`
}

// 접두어를 붙이기 전에 저장된 기록을 읽을 때 변환한다. 파일을 직접 고치는 대신 읽을
// 때 바꾸면, 프로덕션 볼륨에 손을 안 대도 되고 예전 파일이 남아 있어도 안전하다.
// (그때는 카카오뿐이었으므로 접두어 없는 번호는 전부 카카오다.)
function migrateUser(raw: User & { kakaoId?: string }): User {
  const id = raw.id ?? userId('kakao', raw.kakaoId!)
  // logins가 없던 시절 기록은 가입한 수단 하나뿐이다.
  return { id, logins: raw.logins ?? [id], nickname: raw.nickname, createdAt: raw.createdAt }
}

// 로그인 수단으로 계정을 찾는다. id가 아니라 logins를 뒤져야 한다 — 네이버를 연결한
// 계정은 id가 "kakao:..."인데 네이버로도 들어올 수 있어야 하기 때문이다.
function findUserByLogin(all: User[], loginId: string): User | undefined {
  return all.find((u) => u.logins.includes(loginId))
}

function migrateSession(raw: Session & { kakaoId?: string }): Session {
  if (raw.userId) return raw
  return { token: raw.token, userId: userId('kakao', raw.kakaoId!), expiresAt: raw.expiresAt }
}

// 접두어 없는 옛 식별자를 카카오로 본다. 회원번호(users/sessions)뿐 아니라
// collections의 키와 게시글의 authorId에도 옛 번호가 그대로 들어있다.
function migrateId(raw: string): string {
  return raw.includes(':') ? raw : userId('kakao', raw)
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
  return firstReadOnce('users', async () => {
    // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.
    if (users) return users
    try {
      users = (JSON.parse(await readFile(USERS_FILE, 'utf-8')) as User[]).map(migrateUser)
    } catch {
      await rescueCorrupt(USERS_FILE)
      users = []
    }
    return users!
  })
}

async function persistUsers() {
  await mkdir(path.dirname(USERS_FILE), { recursive: true })
  await writeJsonFile(USERS_FILE, users)
}

async function loadSessions(): Promise<Session[]> {
  if (sessions) return sessions
  return firstReadOnce('sessions', async () => {
    // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.
    if (sessions) return sessions
    try {
      sessions = (JSON.parse(await readFile(SESSIONS_FILE, 'utf-8')) as Session[]).map(migrateSession)
    } catch {
      await rescueCorrupt(SESSIONS_FILE)
      sessions = []
    }
    return sessions!
  })
}

async function persistSessions() {
  // 만료된 세션은 쌓이기만 하므로 저장할 때마다 걸러낸다.
  sessions = (sessions ?? []).filter((s) => s.expiresAt > Date.now())
  await mkdir(path.dirname(SESSIONS_FILE), { recursive: true })
  await writeJsonFile(SESSIONS_FILE, sessions)
}

// 카카오 회원번호 → 컬렉션. 즐겨찾기/최근 본 카드를 계정에 묶어 기기가 바뀌거나
// 브라우저 캐시를 지워도 남게 한다(비로그인은 계속 localStorage를 쓴다).
let collections: Record<string, Collections> | null = null

async function loadCollections(): Promise<Record<string, Collections>> {
  if (collections) return collections
  return firstReadOnce('collections', async () => {
    // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.
    if (collections) return collections
    try {
      const raw = JSON.parse(await readFile(COLLECTIONS_FILE, 'utf-8')) as Record<string, Collections>
      // 키가 회원번호라 여기도 접두어를 붙여야 한다. 안 그러면 로그인은 되는데
      // 즐겨찾기가 통째로 빈 것처럼 보인다.
      collections = Object.fromEntries(Object.entries(raw).map(([id, c]) => [migrateId(id), c]))
    } catch {
      await rescueCorrupt(COLLECTIONS_FILE)
      collections = {}
    }
    return collections!
  })
}

async function persistCollections() {
  await mkdir(path.dirname(COLLECTIONS_FILE), { recursive: true })
  await writeJsonFile(COLLECTIONS_FILE, collections)
}

async function getCollections(id: string): Promise<Collections> {
  const all = await loadCollections()
  if (!all[id]) all[id] = { favorites: [], recent: [] }
  return all[id]
}

// ── 카드 뽑기(PackSim) ────────────────────────────────────────────────────
// 출석으로 받은 예산으로 팩을 사서 열고, 나온 카드를 앨범에 모은다.
// 뽑기는 서버에서 한다 — 화면에서 뽑으면 예산도 앨범도 얼마든지 조작할 수 있다.
const PACKSIM_FILE = dataFile('packsim.json')
// 앨범은 "종류별 1줄 + 장수"라 22개 팩을 다 모아도 3,500줄쯤이다. 상한을 둬서
// 한 사람이 파일을 무한정 키우지 못하게 한다.
const ALBUM_LIMIT = 4000

interface AlbumCard {
  s: string // 세트 슬러그
  n: string // 카드 번호
  r: string // 레어도
  c: number // 모은 장수
  g?: 1 // 갓팩에서 나온 적 있음
  m?: MirrorFlag // 반짝이 변형판(마스터볼·몬스터볼 미러, 리버스 홀로)
}
interface PackSimStore {
  balance: number
  lastCheckIn: string // 한국시간 'YYYY-MM-DD'
  streak: number
  opened: number
  spent: number
  god: number
  album: AlbumCard[]
  // 사서 아직 안 연 팩(슬러그→개수). "모아뒀다가 나중에 깐다"용 보관함.
  packs?: Record<string, number>
  // 사서 아직 안 연 박스(슬러그→개수). 팩과 따로 센다(상한 MAX_BOX_STASH).
  boxes?: Record<string, number>
  // 방금 연 팩(박스면 전체 카드). 앨범에는 "고른 카드"만 넣기 때문에, 아무 카드나 넣지
  // 못하도록 서버가 마지막 결과를 기억했다가 그 안의 카드만 받아준다(idx 기준 — 미러와
  // 일반판이 같은 번호일 수 있어 번호로는 구분이 안 된다). shared/kept는 중복 방지.
  // box: 박스로 열었으면 그 팩 수. 자랑 기본 문구를 "박스를 열었습니다"로 쓰려고 남긴다.
  last?: { slug: string; cards: { n: string; r?: string; m?: MirrorFlag }[]; god: boolean; box?: number; shared?: boolean; kept?: boolean }
  // 자랑 보상을 마지막으로 받은 날(KST). 하루 1번만 준다.
  lastShareDay?: string
}

let packsim: Record<string, PackSimStore> | null = null
async function loadPacksim(): Promise<Record<string, PackSimStore>> {
  if (packsim) return packsim
  return firstReadOnce('packsim', async () => {
    // 겹쳐 들어온 다른 요청이 이미 채웠으면 그것을 그대로 쓴다.
    if (packsim) return packsim
    try {
      packsim = JSON.parse(await readFile(PACKSIM_FILE, 'utf-8')) as Record<string, PackSimStore>
    } catch {
      await rescueCorrupt(PACKSIM_FILE)
      packsim = {}
    }
    return packsim
  })
}
async function persistPacksim() {
  await mkdir(path.dirname(PACKSIM_FILE), { recursive: true })
  await writeJsonFile(PACKSIM_FILE, packsim)
}
async function getPacksim(id: string): Promise<PackSimStore> {
  const all = await loadPacksim()
  all[id] ??= { balance: 0, lastCheckIn: '', streak: 0, opened: 0, spent: 0, god: 0, album: [] }
  return all[id]
}

// 출석은 "하루 한 번"이라 기준 시각이 필요하다. 이용자가 전부 한국이므로 한국시간
// 자정으로 끊는다(서버는 UTC로 돌 수도 있어서 UTC+9로 옮겨 날짜만 본다).
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000)
}

// 세트 카드 목록은 정적 파일이라 한 번 읽어 캐시한다. 배포본은 dist/, 개발은 public/에 있다.
const packCardsCache = new Map<string, PackCard[]>()
async function readPackCards(src: string): Promise<PackCard[]> {
  const cached = packCardsCache.get(src)
  if (cached) return cached
  const rel = src.replace(/^\//, '')
  for (const base of ['dist', 'public']) {
    try {
      const raw = await readFile(path.resolve(process.cwd(), base, rel), 'utf-8')
      const cards = usableCards((JSON.parse(raw) as { cards?: PackCard[] }).cards ?? [])
      packCardsCache.set(src, cards)
      return cards
    } catch {
      /* 다음 경로 */
    }
  }
  return []
}

// ── 앨범 시세 ─────────────────────────────────────────────────────────────
// 세트 하나의 카드 시세(TCGplayer 마켓가, USD)를 PPT에서 받아 하루 캐시한다.
// PPT는 분당 제한이 빡빡해서(연속 2~3콜에 429) 세트 단위로 한 번에 받고(limit=250),
// 캐시가 있으면 크레딧을 아예 안 쓴다. 카드번호는 "174/086" 꼴이라 앞자리만 쓴다.
// names: 번호→영문 카드명. 일본판 카드는 우리 데이터가 일본어 이름뿐이라 "시세 보기"를
// 눌러도 검색이 안 잡힌다(PPT는 일본판도 영문으로 색인). 시세를 받아올 때 같이 오는
// 영문 이름을 기억해 두었다가 그 검색어로 쓴다.
// 자랑글에 싣는 카드 장수 상한. 박스(140장)를 통째로 실으면 글이 너무 무겁고
// 화면에서도 읽히지 않아, 좋은 등급부터 이만큼만 보여준다.
const PULL_CARD_LIMIT = 12

type PackPriceEntry = { at: number; prices: Record<string, number>; names?: Record<string, string>; partial?: boolean }
const packPriceCache = new Map<string, PackPriceEntry>()
const PACK_PRICE_TTL_MS = 24 * 60 * 60 * 1000
// 캐시를 그대로 써도 되는지. partial(뒤 페이지를 못 받음)이거나 names(영문 카드명)가
// 없으면 다시 받는다 — names는 나중에 추가한 항목이라, 이전에 저장된 캐시에는 없다.
// 그대로 두면 24시간마다 갱신돼도 영원히 안 채워져 일본판 "시세 보기"가 계속 빗나간다.
const packPriceFresh = (hit: PackPriceEntry) =>
  !hit.partial && !!hit.names && Date.now() - hit.at < PACK_PRICE_TTL_MS
const PACK_PRICE_FILE = dataFile('pack-prices.json')
const stripZeros = (n: string) => n.replace(/^0+/, '') || '0'

// 앨범을 열 때 받아오면 세트당 1분씩 걸려 못 쓴다(PPT 분당 한도). 대신
// ① 캐시를 파일로 남겨 재배포 직후에도 어제 시세가 바로 뜨고
// ② 서버가 뒤에서 1분 간격으로 하나씩 새로 받아 하루 한 번 갈아끼운다.
async function loadPackPriceFile() {
  try {
    const raw = JSON.parse(await readFile(PACK_PRICE_FILE, 'utf-8')) as Record<string, { at: number; prices: Record<string, number>; partial?: boolean }>
    for (const [slug, v] of Object.entries(raw)) packPriceCache.set(slug, v)
  } catch {
    /* 처음엔 없다 */
  }
}
async function savePackPriceFile() {
  await mkdir(path.dirname(PACK_PRICE_FILE), { recursive: true })
  await writeJsonFile(PACK_PRICE_FILE, Object.fromEntries(packPriceCache))
}

let warming = false
async function warmPackPrices(apiKey: string) {
  if (!apiKey || warming) return
  warming = true
  let outOfBudget = false
  try {
    for (const slug of Object.keys(PPT_SET_NAMES)) {
      // 한도에 걸렸으면 이번 바퀴는 접는다. 22세트를 계속 도는 건 헛일이고,
      // 풀린 뒤에 다시 오면 못 받은 것부터 이어서 채운다.
      if (!pptGate().ok) break
      // 방문자 몫까지 먹지는 않는다. 앨범 시세는 하루 이틀 묵어도 쓸 만하지만,
      // 카드 시세가 안 나오는 건 바로 보인다.
      if (pptDailyLeft < PPT_KEEP_FOR_VISITORS) {
        outOfBudget = true
        break
      }
      const hit = packPriceCache.get(slug)
      if (hit && packPriceFresh(hit)) continue
      await getSetPrices(slug, apiKey, { pages: 5, pauseMs: 5_000 })
      await savePackPriceFile()
      // ⚠️ 분당 한도는 "크레딧 500"이 아니라 "요청 60번"이다(응답 헤더 x-ratelimit-
      // minute-limit로 확인). 5초씩 띄우면 분당 12번이라 넉넉히 안전하고, 22세트를
      // 채우는 데 50분이 아니라 몇 분이면 끝난다(서버가 새로 뜬 직후 시세 빈 시간 단축).
      await new Promise((r) => setTimeout(r, 5_000))
    }
  } finally {
    warming = false
  }
  // 429로 부분만 받은 세트가 남았으면 5분 뒤 한 번 더 돈다.
  const leftover = Object.keys(PPT_SET_NAMES).some((slug) => {
    const hit = packPriceCache.get(slug)
    return !hit || hit.partial || Date.now() - hit.at >= PACK_PRICE_TTL_MS
  })
  // 한도에 걸려서 접은 것이면 풀리는 시각까지 기다렸다 온다(5분마다 두드리지 않는다).
  // 방문자 몫을 남기려고 접은 것이면 하루치가 새로 차는 시각(한국시간 오전 9시)에 온다.
  if (leftover) {
    const until = outOfBudget ? nextUtcMidnight() : pptBlockedUntil
    const wait = Math.max(5 * 60_000, until - Date.now() + 5_000)
    setTimeout(() => void warmPackPrices(apiKey), wait)
  }
}

// PPT는 limit을 크게 줘도 한 번에 200행까지만 준다(offset으로 이어받기는 된다 —
// 처음엔 이걸 몰라서 세트의 앞번호 카드들이 통째로 잘렸다. 리자몽=6번이 그래서 빠졌다).
const PPT_PAGE = 200

async function fetchSetPage(
  setName: string,
  lang: string,
  apiKey: string,
  offset: number,
): Promise<{ cardNumber?: string; name?: string; prices?: { market?: number } }[] | null> {
  // 한도에 걸린 동안은 부르지 않는다. 뒤에서 도는 워밍이 5초마다 429를 쌓으면
  // 그것만으로 키가 정지된다.
  if (!pptGate().ok) return null
  const r = await fetch(
    `${PRICE_TRACKER_ORIGIN}/cards?language=${lang}&setName=${encodeURIComponent(setName)}&limit=${PPT_PAGE}&offset=${offset}`,
    {
      signal: AbortSignal.timeout(UPSTREAM_SLOW_MS),
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    },
  )
  notePpt(r.status, r.headers)
  if (!r.ok) return null
  const j = (await r.json()) as { data?: { cardNumber?: string; name?: string; prices?: { market?: number } }[] }
  return Array.isArray(j.data) ? j.data : []
}

// pages: 최대 몇 페이지까지 받을지. pauseMs: 페이지 사이 쉬는 시간 — 분당 크레딧이
// 500이고 페이지 하나가 200이라, 세 페이지째부터는 1분을 넘겨 받아야 한다(워밍 전용).
async function getSetPrices(
  slug: string,
  apiKey: string,
  opts: { pages?: number; pauseMs?: number } = {},
): Promise<Record<string, number> | null> {
  const setName = PPT_SET_NAMES[slug]
  if (!setName || !apiKey) return null
  const hit = packPriceCache.get(slug)
  // partial(뒤 페이지를 못 받은 것)은 신선한 걸로 치지 않는다 — 안 그러면 429 한 번에
  // 앞번호 카드가 빠진 채 하루 동안 굳는다(Destined Rivals가 45번부터 시작하던 문제).
  if (hit && packPriceFresh(hit)) return hit.prices
  const lang = slug.startsWith('ja-') ? 'japanese' : 'english'
  // 한 번에 200행까지만 오므로, 행이 많은 세트는 여러 번 이어받아야 앞번호가 안 잘린다
  // (SV2a 151은 변형판까지 516행이라 2페이지=400행으로는 1~42번이 통째로 빠졌다).
  // 짧은 페이지가 오면 바로 멈추므로 작은 세트는 여전히 1페이지만 쓴다.
  const pages = opts.pages ?? 5
  try {
    const prices: Record<string, number> = {}
    const names: Record<string, string> = {}
    const basePriced = new Set<string>() // 기본판 값을 이미 받은 번호
    let complete = false
    for (let p = 0; p < pages; p++) {
      const list = await fetchSetPage(setName, lang, apiKey, p * PPT_PAGE)
      if (list === null) {
        // 첫 페이지부터 실패(429 등)면 이전 캐시라도 쓴다. 뒤 페이지 실패면 받은 만큼(partial) 저장.
        if (p === 0) return hit?.prices ?? null
        break
      }
      for (const c of list) {
        // cardNumber가 빈 카드가 있어서 이름 꼬리("Zekrom ex - 174/086")로도 받아본다.
        const rawNum = String(c.cardNumber ?? '') || (String(c.name ?? '').match(/ (\d+)\/\d+$/)?.[1] ?? '')
        const num = stripZeros(rawNum.split('/')[0])
        const market = c.prices?.market ?? 0
        if (!num || market <= 0) continue
        // 같은 번호가 "Machamp / Machamp (Poke Ball Pattern) / (Master Ball Pattern)"처럼
        // 여러 줄로 온다. 팩에서 나오는 건 기본판이므로 괄호 없는 이름(기본판)을 우선하고,
        // 기본판이 없을 때만 가장 싼 값을 쓴다. (덮어쓰기 순서에 맡겼더니 일반 괴력몬이
        // 마스터볼 값 $18를 받았던 문제)
        const nm = String(c.name ?? '')
        const isBase = !nm.includes('(')
        // 검색어로 쓸 영문 이름. PPT는 "Team Rocket's Mewtwo ex - 231/182"처럼 번호를
        // 꼬리에 붙여 주므로 떼어 낸다. 기본판 이름을 우선한다.
        if (nm && (isBase || !names[num])) names[num] = nm.replace(/\s*-\s*\d+\/\d+\s*$/, '').trim()
        if (isBase) {
          prices[num] = basePriced.has(num) ? Math.min(prices[num], market) : market
          basePriced.add(num)
        } else {
          // 변형판은 별도 키로 저장(앨범의 미러/리버스 카드 시세용).
          const vk = nm.includes('Master Ball') ? '~m' : nm.includes('Poke Ball') ? '~p' : nm.includes('Reverse') ? '~r' : null
          if (vk) prices[num + vk] = Math.min(prices[num + vk] ?? Infinity, market)
          else if (!basePriced.has(num)) prices[num] = Math.min(prices[num] ?? Infinity, market)
        }
      }
      if (list.length < PPT_PAGE) {
        complete = true // 덜 찬 페이지 = 마지막 페이지까지 다 받았다
        break
      }
      if (opts.pauseMs && p < pages - 1) await new Promise((r) => setTimeout(r, opts.pauseMs))
    }
    // 이전 값이 더 많으면(부분 수집이 이전보다 후퇴) 합쳐서 잃지 않는다.
    const merged = { ...(hit?.prices ?? {}), ...prices }
    const mergedNames = { ...(hit?.names ?? {}), ...names }
    packPriceCache.set(slug, {
      at: Date.now(),
      prices: merged,
      names: mergedNames,
      ...(complete ? {} : { partial: true }),
    })
    return merged
  } catch {
    return hit?.prices ?? null
  }
}

// 앨범에 넣는다. 같은 카드는 장수만 올린다(미러 여부까지 같아야 같은 카드).
// 넣은 장수와, 자리가 없어 못 넣은 장수를 돌려준다. 예전엔 상한을 넘으면 아무 말 없이
// 버렸는데, 화면은 "넣었습니다"라고 답해서 이용자는 들어간 줄 알고 넘어간다.
// (이미 앨범에 있는 종류는 자리를 더 쓰지 않으므로 가득 찼어도 장수는 계속 올라간다.)
function addToAlbum(
  store: PackSimStore,
  slug: string,
  cards: { n: string; r?: string; m?: MirrorFlag }[],
  god: boolean,
): { added: number; dropped: number } {
  let added = 0
  let dropped = 0
  for (const c of cards) {
    const found = store.album.find((a) => a.s === slug && a.n === c.n && (a.m ?? '') === (c.m ?? ''))
    if (found) {
      found.c++
      if (god) found.g = 1
      added++
    } else if (store.album.length < ALBUM_LIMIT) {
      store.album.push({ s: slug, n: c.n, r: c.r ?? 'Common', c: 1, ...(c.m ? { m: c.m } : {}), ...(god ? { g: 1 as const } : {}) })
      added++
    } else {
      dropped++
    }
  }
  return { added, dropped }
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
  return (await loadUsers()).find((u) => u.id === session.userId) ?? null
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

// 이미 로그인한 계정에 로그인 수단을 하나 더 붙인다.
//
// 실패 사유를 주소로 돌려보내 화면이 안내할 수 있게 한다.
export async function linkLogin(
  provider: LoginProvider,
  providerId: string,
  linkToUserId: string,
  currentUserId: string | null,
): Promise<string> {
  // state만으로는 부족하다. state가 새어나가면 남이 자기 계정을 사장님 계정에 붙여서
  // 사장님으로 로그인할 수 있다. 지금 로그인한 사람이 연결을 시작한 그 사람인지
  // 반드시 다시 확인한다.
  if (!currentUserId || currentUserId !== linkToUserId) return '/?link=failed'

  const loginId = userId(provider, providerId)
  const all = await loadUsers()

  const owner = findUserByLogin(all, loginId)
  if (owner) {
    // 이미 내 계정에 붙어 있으면 그냥 성공으로 친다(같은 걸 두 번 눌렀을 때).
    if (owner.id === linkToUserId) return '/?link=ok'
    // 남의 계정에 붙어 있으면 옮겨오면 안 된다. 그쪽 계정이 로그인 수단을 잃는다.
    return '/?link=taken'
  }

  const me = all.find((u) => u.id === linkToUserId)
  if (!me) return '/?link=failed'
  me.logins.push(loginId)
  await persistUsers()
  return '/?link=ok'
}

// 카카오든 네이버든 회원번호를 받아낸 다음은 똑같다 — 없으면 만들고, 세션을 발급하고,
// 쿠키를 심고, 닉네임이 없으면 설정 화면으로 보낸다. 공급자별로 이 흐름을 복사해두면
// 한쪽만 고쳐서 갈리기 쉬우므로 한 곳에 둔다.
async function signIn(
  req: IncomingMessage,
  res: ServerResponse,
  provider: LoginProvider,
  providerId: string,
): Promise<void> {
  const loginId = userId(provider, providerId)
  const all = await loadUsers()
  // 연결해둔 계정이 있으면 그리로 들어간다. 없을 때만 새로 만든다.
  let user = findUserByLogin(all, loginId)
  if (!user) {
    user = { id: loginId, logins: [loginId], nickname: null, createdAt: Date.now() }
    all.push(user)
    await persistUsers()
  }

  const token = randomUUID()
  // 세션은 로그인 수단이 아니라 계정을 가리킨다. 카카오로 들어오든 네이버로 들어오든
  // 같은 계정이면 같은 곳을 본다.
  ;(await loadSessions()).push({ token, userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS })
  await persistSessions()

  // httpOnly라 JS로 못 읽는다(XSS로 세션 탈취 방지).
  res.setHeader('set-cookie', sessionCookie(req, token, SESSION_TTL_MS / 1000))
  res.statusCode = 302
  // 닉네임이 없으면 최초 로그인 → 설정 화면을 띄우게 한다.
  res.setHeader('location', user.nickname ? '/' : '/?setNickname=1')
  res.end()
}

function mountAuth(
  app: Mountable,
  restApiKey: string,
  clientSecret: string,
  naverClientId: string,
  naverClientSecret: string,
  pptApiKey: string, // 앨범 시세(카드 뽑기)용 PPT 키
) {
  // 앨범 시세 캐시: 파일에서 복구하고, 프로덕션이면 뒤에서 미리 데워둔다.
  // (개발 서버는 재시작이 잦아 그때마다 크레딧을 태우지 않게 열 때만 받는다.)
  void loadPackPriceFile().then(() => {
    if (process.env.NODE_ENV === 'production') {
      setTimeout(() => void warmPackPrices(pptApiKey), 5_000)
      setInterval(() => void warmPackPrices(pptApiKey), 60 * 60 * 1000) // 매시간 점검, TTL 지난 것만 받는다
    }
  })
  // state는 CSRF 방지용 일회성 값이라 파일에 남길 필요가 없다. 다만 Set으로 두면
  // 콜백이 돌아올 때만 지워져서, 로그인하다 그만두면 영원히 남는다. 인증도 필요 없는
  // /kakao를 반복 호출해 메모리를 불릴 수 있으므로 만료를 붙인다. 카카오 로그인 화면에
  // 머무는 시간을 감안해도 10분이면 넉넉하다.
  // state는 CSRF 방지용이자, 인증하러 나갔다 돌아오는 동안 "이게 로그인인지 연결인지"를
  // 기억하는 자리다. 연결이면 어느 계정에 붙일지도 여기 담는다.
  const pendingStates = new TtlCache<{ linkToUserId?: string }>(STATE_TTL_MS, MAX_PENDING_STATES)

  app.use('/api/local/auth', async (req, res) => {
    const origin = publicOrigin(req)
    const url = new URL(req.url ?? '', origin)
    const segments = url.pathname.split('/').filter(Boolean)
    const redirectUri = `${origin}/api/local/auth/kakao/callback`

    try {
      // GET /me — 로그인 상태 확인
      // DELETE /me — 회원 탈퇴. 가입은 클릭 한 번인데 탈퇴만 이메일로 받으면 안 된다.
      //
      // 지우는 것: 회원 기록·로그인 수단·세션·즐겨찾기·오늘의 상점(GP·앨범).
      // 남기는 것: 이미 쓴 글·댓글. 다른 사람이 주고받은 대화가 통째로 사라지면 흐름이
      // 끊기므로 글은 두되 작성자를 알 수 없게 한다(회원 기록이 사라지면 이름 자리가
      // "알 수 없음"으로 표시된다). 이 점은 탈퇴 전에 화면에서 안내한다.
      // 백업본에는 최대 7일 남는다 — 개인정보처리방침에 밝혀 두었다.
      if (segments[0] === 'me' && req.method === 'DELETE') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const all = await loadUsers()
        const idx = all.findIndex((u) => u.id === user.id)
        if (idx >= 0) all.splice(idx, 1)
        await persistUsers()

        sessions = (await loadSessions()).filter((sn) => sn.userId !== user.id)
        await persistSessions()

        const cols = await loadCollections()
        delete cols[user.id]
        await persistCollections()

        const store = await loadPacksim()
        delete store[user.id]
        await persistPacksim()

        res.setHeader('set-cookie', sessionCookie(req, '', 0))
        sendJson(res, 200, { ok: true })
        return
      }

      if (segments[0] === 'me') {
        const user = await currentUser(req)
        // kakaoId는 내려주지 않는다 — 회원번호가 클라이언트로 새면 추적에 쓰일 수 있다.
        // isAdmin은 메뉴를 보여줄지 정하는 용도일 뿐이고, 실제 차단은 서버가 한다.
        sendJson(
          res,
          200,
          user
            ? {
                loggedIn: true,
                nickname: user.nickname,
                createdAt: user.createdAt,
                isAdmin: isAdmin(user),
                // 어느 수단이 연결돼 있는지만 알려준다. 회원번호는 내보내지 않는다.
                providers: user.logins.map((l) => l.split(':')[0]),
              }
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
        // 가운데 공백이 여러 칸이면 한 칸으로 줄인다("독   자" → "독 자"). 안 그러면
        // 공백 수만 다른 이름이 서로 다른 사람처럼 보인다.
        const nickname = body.nickname?.trim().replace(/\s+/g, ' ')
        if (!nickname || nickname.length > 20) {
          sendJson(res, 400, { error: 'nickname must be 1-20 chars' })
          return
        }
        if (!NICKNAME_OK.test(nickname)) {
          sendJson(res, 400, { error: 'nickname_charset' })
          return
        }
        // 금지어는 운영자에게도 적용한다. 예약어와 달리 "운영자니까 욕은 써도 된다"는
        // 말이 안 된다.
        if (containsBannedWord(nickname)) {
          sendJson(res, 409, { error: 'nickname_banned' })
          return
        }
        // 예약어는 운영자만. 운영자 배지가 있어도 닉네임이 "운영자"면 목록에서
        // 구분이 안 되므로, 배지와 이 검사는 한 세트다.
        if (!isAdmin(user) && RESERVED_NICKNAMES.includes(normalizeForReserved(nickname))) {
          sendJson(res, 409, { error: 'nickname_reserved' })
          return
        }
        const all = await loadUsers()
        const taken = normalizeForDuplicate(nickname)
        if (all.some((u) => u.nickname != null && normalizeForDuplicate(u.nickname) === taken && u.id !== user.id)) {
          sendJson(res, 409, { error: 'nickname taken' })
          return
        }
        user.nickname = nickname
        await persistUsers()
        sendJson(res, 200, { nickname })
        return
      }

      // POST /unlink — 연결한 로그인 수단을 뗀다
      if (segments[0] === 'unlink' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { provider?: string }
        // 마지막 하나는 뗄 수 없다. 떼면 그 계정으로 들어올 방법이 사라져서, 즐겨찾기와
        // 글이 남아 있는데 주인이 영영 못 들어오는 유령 계정이 된다.
        if (user.logins.length <= 1) {
          sendJson(res, 400, { error: 'last_login' })
          return
        }
        const next = user.logins.filter((l) => !l.startsWith(`${body.provider}:`))
        if (next.length === user.logins.length) {
          sendJson(res, 400, { error: 'not_linked' })
          return
        }
        if (next.length === 0) {
          sendJson(res, 400, { error: 'last_login' })
          return
        }
        user.logins = next
        await persistUsers()
        sendJson(res, 200, { providers: next.map((l) => l.split(':')[0]) })
        return
      }

      // GET /collections — 계정에 저장된 즐겨찾기/최근 본 카드
      if (segments[0] === 'collections' && req.method === 'GET') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        sendJson(res, 200, await getCollections(user.id))
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
        const store = await getCollections(user.id)
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
        const store = await getCollections(user.id)
        // 계정 쪽을 앞에 둬서, 기존에 쓰던 순서가 로컬 것 때문에 밀리지 않게 한다.
        store.favorites = sanitizeRefs([...store.favorites, ...(Array.isArray(body.favorites) ? body.favorites : [])], FAVORITES_LIMIT)
        store.recent = sanitizeRefs([...store.recent, ...(Array.isArray(body.recent) ? body.recent : [])], RECENT_LIMIT)
        await persistCollections()
        sendJson(res, 200, store)
        return
      }

      // ── 카드 뽑기(PackSim) ───────────────────────────────────────────────
      // GET /packsim — 예산·연속출석·앨범. 오늘 출석 안 했으면 받을 금액도 같이 알려준다.
      if (segments[0] === 'packsim' && segments.length === 1 && req.method === 'GET') {
        const user = await currentUser(req)
        // 로그인만 하면 쓸 수 있다(공개 시점의 형태). 화면 노출은 아직 운영자 메뉴뿐이고,
        // 점검 모드를 켜면 일반 방문자는 화면 자체를 못 연다.
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const store = await getPacksim(user.id)
        const today = todayKst()
        // admin: 화면이 "예산 쓰기" 스위치(무제한)를 운영자에게만 보여주기 위한 표식.
        sendJson(res, 200, {
          ...store,
          today,
          canCheckIn: store.lastCheckIn !== today,
          // 오늘 첫 자랑 보상(+5,000GP)을 아직 안 받았는지 — 버튼에 "+5,000GP"를 보여줄 근거.
          canShareBonus: store.lastShareDay !== today,
          admin: isAdmin(user),
        })
        return
      }

      // POST /packsim/checkin — 하루 한 번 예산 지급. 연속 출석이면 보너스가 붙는다.
      if (segments[0] === 'packsim' && segments[1] === 'checkin' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const store = await getPacksim(user.id)
        const today = todayKst()
        if (store.lastCheckIn === today) {
          sendJson(res, 200, { ...store, today, canCheckIn: false, gained: 0 })
          return
        }
        const first = !store.lastCheckIn
        // 어제 왔으면 연속, 하루라도 건너뛰면 처음부터. 이월은 되지만 연속은 끊긴다.
        store.streak = !first && dayDiff(store.lastCheckIn, today) === 1 ? store.streak + 1 : 1
        let reward = DAILY_BUDGET
        if (first) reward += FIRST_BONUS
        if (store.streak > 0 && store.streak % STREAK_DAYS === 0) reward += STREAK_BONUS
        // 잔액 상한에 걸리면 준 만큼 다 들어가지 않는다. 실제로 늘어난 만큼만 알린다
        // (안 들어온 GP를 "받았습니다"라고 하면 숫자가 안 맞아 보인다).
        const before = store.balance
        store.balance = Math.min(MAX_BALANCE, store.balance + reward)
        const gained = store.balance - before
        store.lastCheckIn = today
        await persistPacksim()
        sendJson(res, 200, { ...store, today, canCheckIn: false, gained, reward, capped: gained < reward })
        return
      }

      // POST /packsim/buy — 팩(기본)이나 박스(kind='box')를 사서 보관함에 담는다.
      // 개봉은 보관함에서 한다. 구매만 오늘 진열(isLive) 기준이고, 보관함에 있는
      // 것은 진열이 바뀌어도 열 수 있다.
      if (segments[0] === 'packsim' && segments[1] === 'buy' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { slug?: unknown; spend?: unknown; kind?: unknown }
        const pack = packBySlug.get(String(body.slug ?? ''))
        const isBox = body.kind === 'box'
        if (!pack || !isLive(pack.slug) || (isBox && !(pack.boxPacks && pack.boxPacks > 0))) {
          sendJson(res, 400, { error: 'unknown pack' })
          return
        }
        const store = await getPacksim(user.id)
        const unlimited = isAdmin(user) && !(body.spend === true)
        const price = isBox ? pack.price * (pack.boxPacks ?? 0) : pack.price
        if (!unlimited && store.balance < price) {
          sendJson(res, 400, { error: 'not enough', balance: store.balance, price })
          return
        }
        store.packs ??= {}
        store.boxes ??= {}
        if (isBox) {
          if (Object.values(store.boxes).reduce((a, b) => a + b, 0) >= MAX_BOX_STASH) {
            sendJson(res, 400, { error: 'stash full', max: MAX_BOX_STASH })
            return
          }
        } else if (Object.values(store.packs).reduce((a, b) => a + b, 0) >= MAX_STASH) {
          sendJson(res, 400, { error: 'stash full', max: MAX_STASH })
          return
        }
        if (!unlimited) {
          store.balance -= price
          store.spent += price
        }
        if (isBox) store.boxes[pack.slug] = (store.boxes[pack.slug] ?? 0) + 1
        else store.packs[pack.slug] = (store.packs[pack.slug] ?? 0) + 1
        await persistPacksim()
        sendJson(res, 200, { balance: store.balance, packs: store.packs, boxes: store.boxes })
        return
      }

      // POST /packsim/box — 박스를 통째로 산다·연다. 일본판은 실물처럼 보장 봉입
      // (AR 3장·RR 4~5장·SR이상 1장·ACE/마스터볼), 북미판 박스는 순수 독립시행.
      // 북미 특별세트는 실물에 36팩 박스가 없어(boxPacks=0) 박스 구매 불가.
      if (segments[0] === 'packsim' && segments[1] === 'box' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { slug?: unknown; spend?: unknown; from?: unknown }
        const pack = packBySlug.get(String(body.slug ?? ''))
        if (!pack || !(pack.boxPacks && pack.boxPacks > 0)) {
          sendJson(res, 400, { error: 'unknown pack' })
          return
        }
        // 카드 데이터를 먼저 읽는다(/open과 같은 이유 — 검사와 차감 사이에 await 금지).
        const cards = await readPackCards(pack.src)
        if (cards.length === 0) {
          sendJson(res, 500, { error: 'pack data missing' })
          return
        }
        const store = await getPacksim(user.id)
        const unlimited = isAdmin(user) && !(body.spend === true)
        const boxPrice = pack.price * pack.boxPacks
        // from='stash'면 보관함의 박스를 꺼내 연다(진열이 바뀌어도 됨, GP 안 나감).
        // 아니면 그 자리 구매+개봉(오늘 진열 + GP 차감) — 운영자 무제한 점검용으로만 남긴다.
        const fromStash = body.from === 'stash'
        const haveBox = store.boxes?.[pack.slug] ?? 0
        if (!unlimited) {
          if (fromStash) {
            if (haveBox < 1) {
              sendJson(res, 400, { error: 'no box in stash' })
              return
            }
          } else if (!isLive(pack.slug)) {
            sendJson(res, 400, { error: 'unknown pack' })
            return
          } else if (store.balance < boxPrice) {
            sendJson(res, 400, { error: 'not enough', balance: store.balance, price: boxPrice })
            return
          }
        }
        const guarantee = pack.jp ? (pack.mirror === 'jp151' ? ('jp151' as const) : ('jp' as const)) : null
        const box = drawBox(cards, pack.profile, {
          packs: pack.boxPacks,
          guarantee,
          godRate: pack.godRate ?? 0,
          mirror: pack.mirror,
        })
        if (!unlimited) {
          if (fromStash && store.boxes) {
            if (haveBox <= 1) delete store.boxes[pack.slug]
            else store.boxes[pack.slug] = haveBox - 1
          } else {
            store.balance -= boxPrice
            store.spent += boxPrice
          }
        }
        store.opened += pack.boxPacks
        const godCount = box.packs.filter((p) => p.god).length
        store.god += godCount
        const flat = box.packs.flatMap((p) => p.cards)
        store.last = {
          slug: pack.slug,
          cards: flat.map(({ n, r, m }) => ({ n, r, ...(m ? { m } : {}) })),
          god: box.god,
          box: pack.boxPacks,
        }
        await persistPacksim()
        sendJson(res, 200, {
          packs: box.packs,
          god: box.god,
          godCount,
          boxPacks: pack.boxPacks,
          balance: store.balance,
          opened: store.opened,
          packsLeft: store.packs ?? {},
          boxes: store.boxes ?? {},
        })
        return
      }

      // POST /packsim/open — 보관함의 팩 하나를 연다. 뽑기는 서버가 한다.
      if (segments[0] === 'packsim' && segments[1] === 'open' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { slug?: unknown; spend?: unknown; from?: unknown }
        const pack = packBySlug.get(String(body.slug ?? ''))
        if (!pack) {
          sendJson(res, 400, { error: 'unknown pack' })
          return
        }
        // ⚠️ 카드 데이터는 검사보다 먼저 읽는다. 검사와 차감 사이에 await가 끼면 그
        // 틈에 같은 요청이 또 들어와(빠른 두 번 클릭) 보관함 1팩으로 두 팩을 열거나
        // GP가 한 번만 빠질 수 있다. 아래로는 await 없이 검사→뽑기→차감을 끝낸다.
        const cards = await readPackCards(pack.src)
        if (cards.length === 0) {
          sendJson(res, 500, { error: 'pack data missing' })
          return
        }
        const store = await getPacksim(user.id)
        // 무제한은 운영자 전용 — 보관함·GP 없이도 바로 열어 점검할 수 있다.
        const unlimited = isAdmin(user) && !(body.spend === true)
        // from='stash'면 보관함에서 꺼내 연다(진열이 바뀐 팩도 됨, GP 안 나감).
        // 아니면 "바로 개봉" = 그 자리에서 구매(오늘 진열 + GP 차감). 보관함은 절대
        // 건드리지 않는다 — 담아둔 팩이 몰래 소비되면 이용자가 헷갈린다(피드백).
        const fromStash = body.from === 'stash'
        const have = store.packs?.[pack.slug] ?? 0
        if (!unlimited) {
          if (fromStash) {
            if (have < 1) {
              sendJson(res, 400, { error: 'no pack in stash' })
              return
            }
          } else if (!isLive(pack.slug)) {
            sendJson(res, 400, { error: 'unknown pack' })
            return
          } else if (store.balance < pack.price) {
            sendJson(res, 400, { error: 'not enough', balance: store.balance, price: pack.price })
            return
          }
        }
        const drawn = drawPack(cards, pack.profile, pack.godRate ?? 0, pack.mirror)
        if (!unlimited) {
          if (fromStash && store.packs) {
            if (have <= 1) delete store.packs[pack.slug]
            else store.packs[pack.slug] = have - 1
          } else {
            store.balance -= pack.price
            store.spent += pack.price
          }
        }
        store.opened += 1
        if (drawn.god) store.god += 1
        store.last = { slug: pack.slug, cards: drawn.cards.map(({ n, r, m }) => ({ n, r, ...(m ? { m } : {}) })), god: drawn.god }
        await persistPacksim()
        sendJson(res, 200, { cards: drawn.cards, god: drawn.god, balance: store.balance, opened: store.opened, packs: store.packs ?? {}, unlimited })
        return
      }

      // POST /packsim/share — 방금 연 팩을 커뮤니티 "뽑기 자랑"에 올린다.
      // 글은 서버가 기억하는 마지막 팩으로만 쓴다(가짜 결과로 자랑·보상 방지).
      // 보상(SHARE_BONUS)은 하루 1번. 같은 팩은 한 번만 올릴 수 있다.
      if (segments[0] === 'packsim' && segments[1] === 'share' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        if (!user.nickname) {
          sendJson(res, 400, { error: 'nickname required' })
          return
        }
        const store = await getPacksim(user.id)
        const last = store.last
        if (!last || last.shared) {
          sendJson(res, 400, { error: last ? 'already shared' : 'no pack' })
          return
        }
        const pack = packBySlug.get(last.slug)
        if (!pack || !appendCommunityPost) {
          sendJson(res, 500, { error: 'unavailable' })
          return
        }
        if (!last.cards) {
          sendJson(res, 400, { error: 'no pack' })
          return
        }
        // 아래로는 await가 여러 번 나온다. 그 사이에 같은 요청이 또 들어오면(등록 버튼
        // 두 번 클릭) 글이 두 개 올라가고 보상도 두 번 나간다. 그래서 자리를 먼저
        // 잡아 두고, 등록에 실패하면 되돌린다.
        last.shared = true
        const today = todayKst()
        const prevShareDay = store.lastShareDay
        // 상한에 걸리면 실제로 늘어난 만큼만 보상으로 알리고, 되돌릴 때도 그만큼만 뺀다
        // (준 금액 그대로 빼면 상한에 걸렸을 때 있던 GP까지 사라진다).
        let gained = 0
        if (prevShareDay !== today) {
          const before = store.balance
          store.balance = Math.min(MAX_BALANCE, store.balance + SHARE_BONUS)
          gained = store.balance - before
          store.lastShareDay = today
        }
        const rollback = () => {
          last.shared = false
          if (prevShareDay !== today) {
            store.balance -= gained
            store.lastShareDay = prevShareDay
          }
        }
        // 카드·등급·갓팩 여부는 서버가 기억하는 값만 쓴다(조작 불가). 한글 이름 표기만
        // 화면이 보내준다 — 서버에 번역기를 들이는 것보다 가볍고, 이름은 표기일 뿐이라
        // 속여도 자기 자랑글이 이상해질 뿐이다. 길이만 자르고 줄바꿈은 뗀다.
        const body = JSON.parse((await readBody(req)) || '{}') as { names?: unknown; comment?: unknown; title?: unknown }
        const nameOf = new Map<string, string>()
        if (body.names && typeof body.names === 'object') {
          for (const [k, v] of Object.entries(body.names as Record<string, unknown>)) {
            if (typeof v === 'string') nameOf.set(String(k), v.replace(/\s+/g, ' ').trim().slice(0, 60))
          }
        }
        const cards = await readPackCards(pack.src)
        const byN = new Map(cards.map((c) => [c.n, c]))
        // 자랑글에 쓸 등급 약칭. 일본판은 풀아트를 SR, 금색을 UR이라 부르고 북미판은
        // UR·HR이라 부른다 — 어느 판 팩인지 알고 있으니 그 판 이름으로 적는다.
        const tierKo: Record<string, string> = {
          Common: '커먼', Uncommon: '언커먼', Rare: '레어', 'Double rare': 'RR',
          'ACE SPEC Rare': 'ACE',
          'Illustration rare': pack.jp ? 'AR' : 'IR',
          'Ultra Rare': pack.jp ? 'SR' : 'UR',
          'Special illustration rare': pack.jp ? 'SAR' : 'SIR',
          'Hyper rare': pack.jp ? 'UR' : 'HR',
          'Mega Ultra Rare': 'MUR',
          'Mega Hyper Rare': 'MHR',
        }
        // 순위는 뽑기 로직과 같은 표를 쓴다(따로 적어 두면 새 등급이 생길 때 빠진다 —
        // 실제로 MUR·MHR이 빠져 최고 등급으로 안 뽑히던 문제가 있었다).
        const rank = RARITY_RANK
        const drawn = last.cards
          .map((lc) => {
            const base = byN.get(lc.n)
            return base ? { ...base, r: lc.r ?? base.r, m: lc.m } : null
          })
          .filter((c): c is NonNullable<typeof c> => !!c)
        const mLabel = (m?: MirrorFlag) => (m === 'master' ? ' (마스터볼 미러)' : m === 'poke' ? ' (몬스터볼 미러)' : m === 'rev' ? ' (리버스)' : '')
        const koN = (c: { n: string; name: string; m?: MirrorFlag }) => (nameOf.get(c.n) || c.name) + mLabel(c.m)
        const best = drawn.reduce((a, b) => ((rank[b.r ?? ''] ?? 0) > (rank[a.r ?? ''] ?? 0) ? b : a), drawn[0])
        const packName = pack.label.replace(/^\[.+?\]\s*/, '')
        // 제목은 이용자가 쓴 것을 우선하고, 없으면 자동 제목.
        const userTitle = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
        const title =
          userTitle ||
          (last.god ? `갓팩! ${packName} 전부 AR 이상` : `${packName} 개봉 — ${koN(best)} ${tierKo[best.r ?? ''] ?? ''}`.trim())
        // 본문은 이용자가 쓴 글. 카드 목록은 pull(이미지 그리드)로 보여주므로 글이 없으면
        // 짧은 기본 문장만 넣는다.
        const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 1000) : ''
        const content = comment || `${pack.jp ? '일본판' : '북미판'} ${packName} ${last.box ? '박스를' : '팩을'} 열었습니다.`
        const post: CommunityPost = {
          id: Date.now(),
          title,
          category: 'pulls',
          authorId: user.id,
          content,
          createdAt: Date.now(),
          likedBy: [],
          commentCount: 0,
          // 커뮤니티가 카드 이미지를 그대로 그릴 재료. 등급 낮은 것부터(마지막이 최고).
          pull: {
            pack: packName,
            god: last.god,
            // 박스는 140장이라 전부 실으면 글이 16KB가 되고 화면도 못 읽는다.
            // 좋은 등급부터 12장만 싣고(마지막이 최고), 총 장수는 따로 알려 준다.
            total: drawn.length,
            cards: [...drawn]
              .sort((a, b) => (rank[a.r ?? ''] ?? 0) - (rank[b.r ?? ''] ?? 0))
              .slice(-PULL_CARD_LIMIT)
              .map((c) => ({ img: c.img ?? '', name: koN(c), r: tierKo[c.r ?? ''] ?? c.r ?? '' })),
          },
        }
        try {
          await appendCommunityPost(post)
        } catch {
          rollback()
          sendJson(res, 500, { error: 'unavailable' })
          return
        }
        await persistPacksim()
        sendJson(res, 200, { postId: post.id, gained, balance: store.balance })
        return
      }

      // POST /packsim/keep — 방금 연 팩에서 고른 카드만 앨범에 넣는다.
      // 다 넣으면 커먼으로 뒤덮여서 앨범이 지저분해진다. 남길 것만 고르는 게 재미다.
      if (segments[0] === 'packsim' && segments[1] === 'keep' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { idxs?: unknown }
        const store = await getPacksim(user.id)
        // 앨범에 넣어도 last를 지우지 않는다 — 지우면 그 팩을 자랑할 수 없게 된다
        // (앨범 넣기와 자랑은 독립이어야 한다). 같은 팩을 두 번 넣는 것만 kept로 막는다.
        if (!store.last?.cards || store.last.kept) {
          sendJson(res, 400, { error: store.last ? 'already kept' : 'no pack' })
          return
        }
        const max = store.last.cards.length
        const picked = [...new Set((Array.isArray(body.idxs) ? body.idxs : []).map(Number))].filter(
          (i) => Number.isInteger(i) && i >= 0 && i < max,
        )
        const put = addToAlbum(store, store.last.slug, picked.map((i) => store.last!.cards[i]), store.last.god)
        store.last.kept = true
        await persistPacksim()
        // kept는 "고른 장수"가 아니라 "실제로 들어간 장수"다. 자리가 모자라 못 넣은
        // 장수도 같이 알려 준다(화면이 그대로 안내한다).
        sendJson(res, 200, { kept: put.added, dropped: put.dropped, albumLimit: ALBUM_LIMIT, album: store.album })
        return
      }

      // POST /packsim/album/remove — 선택한 카드들을 앨범에서 뺀다(중복 포함 통째로).
      if (segments[0] === 'packsim' && segments[1] === 'album' && segments[2] === 'remove' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { items?: unknown }
        const store = await getPacksim(user.id)
        // 중복까지 싹 지우면 안 된다는 피드백 — 선택한 종류마다 1장씩만 줄이고,
        // 0장이 되는 항목만 앨범에서 빠진다.
        const del = new Set(
          (Array.isArray(body.items) ? body.items : []).map(
            (it) =>
              `${String((it as { s?: unknown }).s ?? '')}|${String((it as { n?: unknown }).n ?? '')}|${String((it as { m?: unknown }).m ?? '')}`,
          ),
        )
        let removed = 0
        for (const key of del) {
          const [s2, n, m] = key.split('|')
          const i = store.album.findIndex((a) => a.s === s2 && a.n === n && (a.m ?? '') === m)
          if (i < 0) continue
          removed++
          if (store.album[i].c > 1) store.album[i].c -= 1
          else store.album.splice(i, 1)
        }
        await persistPacksim()
        sendJson(res, 200, { removed, album: store.album })
        return
      }

      // GET /packsim/value — 앨범 카드들의 시세(TCGplayer 마켓가, USD)와 합계.
      // 환율 변환은 화면이 한다(이미 쓰는 환율 API가 있다).
      if (segments[0] === 'packsim' && segments[1] === 'value' && req.method === 'GET') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const store = await getPacksim(user.id)
        const slugs = [...new Set(store.album.map((a) => a.s))]
        const prices: Record<string, Record<string, number>> = {}
        const names: Record<string, Record<string, string>> = {}
        const pending: string[] = []
        // PPT는 분당 크레딧 500인데 세트 하나 받는 데 250이 든다. 한 요청에 두 세트를
        // 받으면 그 분의 남은 호출이 전부 429라, 업스트림은 요청당 1세트만 부르고
        // 나머지는 pending으로 알린다. 화면이 1분쯤 뒤 다시 부르면 하나씩 채워진다.
        let fetched = false
        for (const slug of slugs) {
          const cached = packPriceCache.get(slug)
          const fresh = !!cached && packPriceFresh(cached)
          if (fresh) {
            prices[slug] = cached.prices
            if (cached.names) names[slug] = cached.names
            continue
          }
          if (!fetched && !warming && PPT_SET_NAMES[slug]) {
            fetched = true
            const p = await getSetPrices(slug, pptApiKey)
            const after = packPriceCache.get(slug)
            if (p && after) {
              prices[slug] = p
              if (after.names) names[slug] = after.names
            } else if (PPT_SET_NAMES[slug]) pending.push(slug)
          } else if (PPT_SET_NAMES[slug]) {
            if (cached) {
              prices[slug] = cached.prices // 만료·부분이어도 있으면 일단 보여준다
              if (cached.names) names[slug] = cached.names
            }
            pending.push(slug)
          }
        }
        let totalUsd = 0
        let priced = 0
        for (const a of store.album) {
          const base = stripZeros(a.n)
          const vk = a.m === 'master' ? '~m' : a.m === 'poke' ? '~p' : a.m === 'rev' ? '~r' : ''
          const usd = (vk ? prices[a.s]?.[base + vk] : undefined) ?? prices[a.s]?.[base] ?? 0
          if (usd > 0) {
            totalUsd += usd * a.c
            priced++
          }
        }
        sendJson(res, 200, {
          prices,
          names,
          pending,
          totalUsd: Math.round(totalUsd * 100) / 100,
          priced,
          totalKinds: store.album.length,
        })
        return
      }

      // ── 네이버 ────────────────────────────────────────────────────────────
      // 카카오와 흐름은 같지만 다른 점이 셋 있다. 토큰을 받을 때 state를 다시 보내야
      // 하고, 회원번호가 response 안에 한 겹 들어있고, 토큰 요청이 GET이다.

      if (segments[0] === 'naver') {
        if (!naverClientId || !naverClientSecret) {
          sendJson(res, 501, { error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET not configured' })
          return
        }
        const naverRedirectUri = `${origin}/api/local/auth/naver/callback`

        // GET /naver — 네이버 인증 페이지로 보낸다. ?link=1이면 로그인이 아니라
        // 지금 로그인한 계정에 붙이러 가는 것이다.
        if (segments.length === 1) {
          const state = randomUUID()
          const linkTo = url.searchParams.get('link') ? (await currentUser(req))?.id : undefined
          pendingStates.set(state, { linkToUserId: linkTo })
          const authUrl = new URL('https://nid.naver.com/oauth2.0/authorize')
          authUrl.searchParams.set('client_id', naverClientId)
          authUrl.searchParams.set('redirect_uri', naverRedirectUri)
          authUrl.searchParams.set('response_type', 'code')
          authUrl.searchParams.set('state', state)
          res.statusCode = 302
          res.setHeader('location', authUrl.toString())
          res.end()
          return
        }

        // GET /naver/callback — 네이버가 code를 들고 돌아오는 곳
        if (segments[1] === 'callback') {
          const code = url.searchParams.get('code')
          const state = url.searchParams.get('state')
          const pending = state ? pendingStates.get(state) : undefined
          if (!code || !state || !pending) {
            // 네이버가 거절하면 code 없이 error를 달고 돌아온다. 배포로 서버가 새로 뜨면
            // pendingStates(메모리)가 비어서 state를 못 찾는 경우도 여기로 온다.
            console.warn(
              '[auth:naver] 콜백 실패 —',
              `code=${code ? '있음' : '없음'}`,
              `state=${state ? (pending ? '있음' : '만료/유실') : '없음'}`,
              `error=${url.searchParams.get('error') ?? '-'}`,
              url.searchParams.get('error_description') ?? '',
            )
            res.statusCode = 302
            res.setHeader('location', '/?login=failed')
            res.end()
            return
          }
          pendingStates.delete(state)

          const tokenUrl = new URL('https://nid.naver.com/oauth2.0/token')
          tokenUrl.searchParams.set('grant_type', 'authorization_code')
          tokenUrl.searchParams.set('client_id', naverClientId)
          tokenUrl.searchParams.set('client_secret', naverClientSecret)
          tokenUrl.searchParams.set('code', code)
          // 카카오와 달리 네이버는 토큰 단계에서도 state를 확인한다.
          tokenUrl.searchParams.set('state', state)

          const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
          if (!tokenRes.ok) {
            console.warn('[auth:naver] 토큰 교환 실패 —', tokenRes.status, (await tokenRes.text()).slice(0, 200))
            res.statusCode = 302
            res.setHeader('location', '/?login=failed')
            res.end()
            return
          }
          const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string }
          const { access_token } = tokenBody
          if (!access_token) {
            console.warn('[auth:naver] 토큰 없음 —', tokenBody.error ?? '-', tokenBody.error_description ?? '')
            res.statusCode = 302
            res.setHeader('location', '/?login=failed')
            res.end()
            return
          }

          // 제공 정보를 하나도 체크하지 않았으므로 id(회원번호)만 온다. 이름·이메일은
          // 애초에 넘어오지 않는다.
          const meRes = await fetch('https://openapi.naver.com/v1/nid/me', {
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            headers: { authorization: `Bearer ${access_token}` },
          })
          if (!meRes.ok) {
            console.warn('[auth:naver] 회원정보 조회 실패 —', meRes.status, (await meRes.text()).slice(0, 200))
            res.statusCode = 302
            res.setHeader('location', '/?login=failed')
            res.end()
            return
          }
          // 카카오는 최상위에 id가 있지만 네이버는 response 안에 들어있다.
          const providerId = String(((await meRes.json()) as { response?: { id?: string } }).response?.id ?? '')
          if (!providerId) {
            console.warn('[auth:naver] 회원번호가 응답에 없음')
            res.statusCode = 302
            res.setHeader('location', '/?login=failed')
            res.end()
            return
          }

          if (pending.linkToUserId) {
            const to = await linkLogin('naver', providerId, pending.linkToUserId, (await currentUser(req))?.id ?? null)
            res.statusCode = 302
            res.setHeader('location', to)
            res.end()
            return
          }

          await signIn(req, res, 'naver', providerId)
          return
        }
      }

      // ── 카카오 ────────────────────────────────────────────────────────────
      if (!restApiKey || !clientSecret) {
        sendJson(res, 501, { error: 'KAKAO_REST_API_KEY / KAKAO_CLIENT_SECRET not configured' })
        return
      }

      // GET /kakao — 카카오 인증 페이지로 보낸다. ?link=1이면 연결.
      if (segments[0] === 'kakao' && segments.length === 1) {
        const state = randomUUID()
        const linkTo = url.searchParams.get('link') ? (await currentUser(req))?.id : undefined
        pendingStates.set(state, { linkToUserId: linkTo })
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
        const pending = state ? pendingStates.get(state) : undefined
        // state가 없거나 우리가 발급한 게 아니면 CSRF 시도로 보고 거절한다.
        if (!code || !state || !pending) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }
        pendingStates.delete(state)

        const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
          method: 'POST',
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          headers: { authorization: `Bearer ${access_token}` },
        })
        if (!meRes.ok) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }
        const providerId = String(((await meRes.json()) as { id?: number | string }).id ?? '')
        if (!providerId) {
          res.statusCode = 302
          res.setHeader('location', '/?login=failed')
          res.end()
          return
        }

        if (pending.linkToUserId) {
          const to = await linkLogin('kakao', providerId, pending.linkToUserId, (await currentUser(req))?.id ?? null)
          res.statusCode = 302
          res.setHeader('location', to)
          res.end()
          return
        }

        await signIn(req, res, 'kakao', providerId)
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
// ── 세트별 힛카드 ─────────────────────────────────────────────────────────
// "이 세트에서 값이 제일 높은 카드"를 돌려준다.
//
// 예전엔 화면에서 레어도만 보고 골랐다. 레어도가 높아도 싸게 풀린 카드가 있고 낮아도
// 비싼 카드가 있어서, 그건 "힛카드"라기보다 "간판 카드"였다. 이제 실제 값으로 고른다.
//
// 값은 앨범 시세로 이미 받아 둔 것을 그대로 쓴다(크레딧을 새로 안 쓴다). 그래서 앨범
// 목록에 있는 세트만 나온다. 없는 세트는 빈 배열을 주고, 화면이 예전 방식으로 돌아간다.
// 세트에서 값이 높은 카드를 골라 준다. 화면(API)과 검색 노출 페이지가 같이 쓴다.
export function topPricedCards(slug: string, limit = 4): { n: string; usd: number; name: string }[] {
  const hit = packPriceCache.get(slug)
  if (!hit) return []
  return Object.entries(hit.prices)
    .filter(([n]) => !n.includes('~'))
    .map(([n, usd]) => ({ n, usd, name: hit.names?.[n] ?? '' }))
    .filter((r) => r.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, limit)
}

// 세트 목록에 쓸 표지. 값이 제일 높은 카드의 그림을 준다.
// 세트 파일(dist/sets/*.json)에서 번호로 그림을 찾는다. 22세트뿐이고 파일도 안 바뀌니
// 한 번 읽고 계속 들고 있는다.
let setCoverCache: Record<string, string> | null = null
async function bestCardCovers(): Promise<Record<string, string>> {
  if (setCoverCache) return setCoverCache
  const out: Record<string, string> = {}
  for (const slug of packPriceCache.keys()) {
    const top = topPricedCards(slug, 8)
    if (!top.length) continue
    try {
      const raw = await readFile(path.resolve('dist/sets', `${slug}.json`), 'utf-8')
      const d = JSON.parse(raw) as { cards?: { n: string; img?: string }[] }
      const byNum = new Map((d.cards ?? []).map((c) => [String(Number(c.n)), c]))
      // 값이 높은 순으로 보다가 그림이 있는 첫 카드를 쓴다.
      for (const t of top) {
        const img = byNum.get(String(Number(t.n)))?.img
        if (img) { out[slug] = img; break }
      }
    } catch {
      /* 세트 파일이 없으면 건너뛴다 */
    }
  }
  setCoverCache = out
  return out
}

function mountSetHitCards(app: Mountable) {
  // 세트 목록용: 값이 제일 높은 카드 그림을 세트마다 하나씩.
  app.use('/api/local/set-covers', async (_req, res) => {
    sendJson(res, 200, { covers: await bestCardCovers() })
  })

  app.use('/api/local/set-hit-cards', async (req, res) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const slug = (url.searchParams.get('slug') ?? '').trim()
    const limit = Math.min(12, Math.max(1, Number(url.searchParams.get('limit')) || 4))
    if (!slug || !/^[a-zA-Z0-9._-]+$/.test(slug)) {
      sendJson(res, 400, { error: 'bad slug' })
      return
    }
    const hit = packPriceCache.get(slug)
    if (!hit) {
      // 아직 시세를 안 받은 세트다. 화면이 예전 방식(레어도)으로 돌아가게 알려 준다.
      sendJson(res, 200, { slug, priced: false, cards: [] })
      return
    }
    sendJson(res, 200, { slug, priced: true, at: hit.at, cards: topPricedCards(slug, limit) })
  })
}

export function mountApi(app: Mountable, env: ApiEnv) {
  publicConfig = { openChatUrl: env.OPENCHAT_URL?.trim() || null }
  mountConfig(app)
  adminIds = new Set(
    (env.ADMIN_KAKAO_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      // 환경변수엔 카카오 회원번호만 적혀 있으므로 여기서 접두어를 붙여 실제 식별자와
      // 같은 모양으로 만든다. 안 붙이면 영원히 안 맞아서 운영자가 조용히 사라진다
      // (둘 다 문자열이라 타입 검사로는 안 잡힌다).
      .map((kakaoId) => userId('kakao', kakaoId)),
  )
  mountSnkrdunkProxy(app)
  mountImageProxy(app)
  mountSetHitCards(app)
  mountSearchTracker(app)
  mountVisitStats(app)
  mountScanFeedback(app)
  mountTranslationFeedback(app)
  mountFleaMarket(app)
  mountEventStats(app)
  mountKoreanNews(app)
  mountExchangeRate(app)
  mountCommunity(app)
  mountEbayPrice(app, env.POKEMON_PRICE_TRACKER_API_KEY ?? '')
  mountEbayKorean(app, env.EBAY_APP_ID ?? '', env.EBAY_CERT_ID ?? '')
  mountCardScan(app, env.ANTHROPIC_API_KEY ?? '')
  mountAuth(
    app,
    env.KAKAO_REST_API_KEY ?? '',
    env.KAKAO_CLIENT_SECRET ?? '',
    env.NAVER_CLIENT_ID ?? '',
    env.NAVER_CLIENT_SECRET ?? '',
    env.POKEMON_PRICE_TRACKER_API_KEY ?? '',
  )
}
