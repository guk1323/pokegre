import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { brotliCompressSync, constants as zlibConst, gunzipSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
// ⚠️ 카드 이름을 **서버에서** 한글로 바꾸려고 가져온다. 화면에서 바꾸면 이름 사전
//    109KB를 홈에서 통째로 받아야 한다 — 홈은 제일 많이 열리는 화면이라 그 무게를
//    지우면 안 된다(cardImg.ts 첫머리·PackShelfPromo 설명 참고). 서버에서는 공짜다.
import { 등급순서값 } from '../src/lib/gradeOrder.ts'
import { PPT레어도별코드 } from '../src/lib/rarityCode.ts'
import { koName } from '../src/lib/koCardName.ts'
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
  livePacks,
  packBySlug,
  PPT_SET_NAMES,
  type PackSet,
} from '../src/lib/packSets.ts'
import { drawBox, drawPack, RARITY_RANK, usableCards, type MirrorFlag, type PackCard } from '../src/lib/packDraw.ts'
import { 번호열쇠 } from '../src/lib/cardNo.ts'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }
import pptSetList from '../src/data/pptSetList.json' with { type: 'json' }
import setCardNumberAlias from '../src/data/setCardNumberAlias.json' with { type: 'json' }
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import { kstDateStr, kstHourStr } from '../src/lib/kstDay.ts'

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
/**
 * **받아 줄 사람 없이 던져 놓는 일**을 안전하게 던진다.
 *
 * ⚠️ `void 어떤일()`은 예외를 아무도 안 받는다 — Node는 그걸 보면 **프로세스를 내린다.**
 *    하루 한 번 도는 곁다리(자동완성 낱말 적기·시세 미리받기·힛카드 갱신)가 디스크
 *    한 번 못 써서 서버를 죽이는 셈이다. 실제로 그런 길이 있었다(2026-08-08에 막음).
 *    앞으로 `void`로 던질 일은 **이걸로** 던질 것.
 */
function 던지기(무엇: string, 일: Promise<unknown>): void {
  void 일.catch((e) => console.log(`[pokegre] ${무엇} 중 오류: ${String(e).slice(0, 120)}`))
}

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
// 스니커덩크 프록시에도 제한을 건다. 우리가 부르는 바깥 서비스 중 여기만 없었다.
// 한 번 검색하면 목록 1번 + 카드마다 1번씩 부르므로(24장이면 25번) 넉넉히 잡는다.
// 목적은 정밀한 제어가 아니라, 한 사람이 스크립트로 몰아쳐 우리 IP가 막히는 걸 막는 것이다
// (2026-08-02에 짧은 검색어에서 403을 받았다. 원인은 우리 캐시였지만, 상대가 IP로
//  막으면 방문자 전체가 검색을 못 하게 된다).
const SNKRDUNK_RATE_LIMIT = 600
const SNKRDUNK_RATE_WINDOW_MS = 10 * 60 * 1000
const CACHE_TTL_MS = 5 * 60 * 1000
// 제일 큰 응답이 trading-history의 약 50KB라, 300개면 최대 15MB 정도다.
const CACHE_MAX_ENTRIES = 300

function mountSnkrdunkProxy(app: Mountable) {
  const cache = new TtlCache<{ body: string; status: number; contentType: string }>(CACHE_TTL_MS, CACHE_MAX_ENTRIES)
  const allow = rateLimiter(SNKRDUNK_RATE_LIMIT, SNKRDUNK_RATE_WINDOW_MS)

  app.use('/api/snkrdunk', async (req, res) => {
    const path = req.url ?? ''
    const cached = cache.get(path)

    // 캐시에 있으면 제한을 세지 않는다 — 바깥으로 나가는 요청이 아니다.
    if (!cached && !allow(req)) {
      tooManyRequests(res)
      return
    }

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
      // ⚠️ 실패한 응답은 캐시하지 않는다. 스니커덩크가 가끔 403·5xx를 뱉는데(짧은 검색어에서
      // 잦다), 그걸 담아 두면 5분 내내 같은 검색이 막힌다 — 실제로 "サナ"·"ギリー" 같은
      // 짧은 이름이 계속 0건으로 나왔다. 직접 부르면 200이 오는데도 그랬다.
      if (upstream.ok) cache.set(path, { body, status: upstream.status, contentType })
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
// 썸네일은 320px webp라 장당 20KB 안팎이다.
// 800장은 너무 빠듯했다 — 세트 하나가 100~300장이라 서너 개만 훑어도 캐시가 다 밀리고,
// 그러면 방문자가 볼 때마다 원본을 다시 받는다(tcgdex 원본은 한 장에 8초까지 걸린다).
// 2,500장이면 대략 50MB로, 실측 여유(2026-08-02 기준 사용 102MB / 여유 339MB) 안에 든다.
const IMG_CACHE_MAX = 2500
const IMG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// 세트 목록 표지를 미리 받아 두는 일감. mountImageProxy가 채워 넣는다.
// 배포할 때마다 기계가 새로 떠서 캐시가 비는데, 그 상태로 방문자가 세트 목록을 열면
// 표지 366장을 원본에서 하나씩 받느라 한참 비어 보인다(실측: 데우기 전 20장 1,219ms /
// 데운 뒤 689ms, 원본이 느린 tcgdex는 한 장에 8초까지 걸린다).
let warmCovers: (() => Promise<void>) | null = null
// 오늘 진열된 팩의 카드 그림 데우기. 진열이 자정에 바뀌므로 하루 한 번 다시 돈다.
let warmPackCards: (() => Promise<void>) | null = null
// 세트 하나의 힛카드(값 높은 8장) 그림만 데운다. 시세를 새로 받은 직후에 부른다 —
// 그때 힛카드가 레어도 순에서 값 순으로 바뀌므로, 새로 뽑힌 여덟 장은 아무도 받아
// 둔 적이 없다. mountImageProxy가 채워 넣는다.
let warmHitCardImgs: ((slug: string) => Promise<void>) | null = null
export function startCoverWarmup(): void {
  if (warmCovers) void warmCovers()
  // 표지가 먼저 끝나도록 조금 늦춘다 — 둘이 동시에 원본을 두드리면 서로 느려진다.
  if (warmPackCards) {
    setTimeout(() => void warmPackCards?.(), 6 * 60 * 1000)
    setInterval(() => void warmPackCards?.(), 24 * 60 * 60 * 1000)
  }
}

// 받아 둔 썸네일을 디스크에도 남긴다. 메모리 캐시는 배포할 때마다 통째로 날아가는데,
// 원본(tcgdex)이 한 장에 7~11초라 그때마다 방문자가 그 시간을 다시 치른다
// (실측: 영문판 세트 하나 여는 데 첫 24장 30초, 캐시가 살아 있으면 420ms).
// ⚠️ 상한을 정할 땐 볼륨 전체(973MB)를 나눠 쓴다는 걸 잊지 말 것. 예전엔 그림 600MB +
//    게시글 사진 300MB로 잡아 둬서, 둘 다 상한까지 차면 회원·게시글·앨범 JSON과 백업이
//    쓸 자리가 74MB밖에 안 남았다. 디스크가 차면 JSON 저장이 실패해 데이터가 상한다.
//    지금 배분: 그림 400 + 사진 200 = 600MB, 남는 370MB가 데이터·백업 몫이다.
//    그림은 캐시라 지워져도 다시 받으면 그만이지만, JSON은 그렇지 않다.
//    (2026-08-03 실측: 그림 22MB, 사진 0MB, 백업 1.8MB — 아직 한참 여유가 있다.)
const IMG_DISK_DIR = path.join(DATA_DIR, 'imgcache')
const IMG_DISK_MAX_BYTES = 400 * 1024 * 1024
// 방문자를 기다리게 하지 않고 뒤에서 받을 때 쓰는 시간. 원본이 느려도 한 번만 참으면
// 그 뒤로는 캐시에서 60ms에 나간다.
const IMG_SLOW_RETRY_MS = 60_000
const diskKey = (key: string) => createHash('sha1').update(key).digest('hex')

function mountImageProxy(app: Mountable) {
  const cache = new TtlCache<{ body: Buffer; contentType: string }>(IMG_CACHE_TTL_MS, IMG_CACHE_MAX)

  // 디스크에서 읽기. 없거나 못 읽으면 null(그냥 원본을 받는다).
  async function readDisk(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const body = await readFile(path.join(IMG_DISK_DIR, `${diskKey(key)}.webp`))
      return { body, contentType: 'image/webp' }
    } catch {
      return null
    }
  }
  // 디스크에 쓰기. 실패해도 서비스에 지장이 없으므로 조용히 넘긴다.
  async function writeDisk(key: string, body: Buffer): Promise<void> {
    try {
      await mkdir(IMG_DISK_DIR, { recursive: true })
      await writeFile(path.join(IMG_DISK_DIR, `${diskKey(key)}.webp`), body)
    } catch {
      /* 볼륨이 꽉 찼거나 못 쓰면 메모리 캐시만으로 간다 */
    }
  }
  // 용량이 상한을 넘으면 오래 안 쓴 것부터 지운다. 기동할 때 한 번, 그 뒤 6시간마다.
  async function trimDisk(): Promise<void> {
    try {
      const names = await readdir(IMG_DISK_DIR).catch(() => [])
      if (!names.length) return
      const files = await Promise.all(
        names.map(async (n) => {
          const st = await stat(path.join(IMG_DISK_DIR, n)).catch(() => null)
          return st ? { n, size: st.size, at: st.atimeMs || st.mtimeMs } : null
        }),
      )
      const alive = files.filter((f): f is { n: string; size: number; at: number } => !!f)
      let total = alive.reduce((s, f) => s + f.size, 0)
      if (total <= IMG_DISK_MAX_BYTES) return
      alive.sort((a, b) => a.at - b.at)
      for (const f of alive) {
        if (total <= IMG_DISK_MAX_BYTES * 0.9) break
        await rm(path.join(IMG_DISK_DIR, f.n), { force: true }).catch(() => undefined)
        total -= f.size
      }
      console.log(`[pokegre] 그림 캐시를 ${Math.round(total / 1024 / 1024)}MB로 줄였습니다.`)
    } catch {
      /* 정리 실패는 무시 */
    }
  }
  void trimDisk()
  setInterval(() => void trimDisk(), 6 * 60 * 60 * 1000).unref()
  // 같은 이미지를 동시에 여러 명이 처음 요청하면 wsrv를 여러 번 부르지 않게 진행 중인
  // 요청을 공유한다(중복 방지).
  const inflight = new Map<string, Promise<{ body: Buffer; contentType: string } | null>>()
  // 15초 안에 못 받은 것을 뒤에서 다시 받는 중인 목록(같은 걸 여러 번 받지 않게).
  const slowJobs = new Set<string>()

  // ⚠️ tcgplayer-cdn은 wsrv가 막아서 축소가 안 되고 원본으로 넘어간다(아래 폴백).
  //    그런데 그 원본 주소에 크기가 박혀 있다 — "…709264_in_800x800.jpg".
  //    tcgplayer가 작은 판을 같은 규칙으로 내주므로, 받기 전에 주소를 바꿔 달라고 한다.
  //      _in_800x800  147,843 bytes
  //      _in_400x400   44,674 bytes
  //      _in_200x200   11,877 bytes  ← 12배 가볍다 (142x200, 정상 그림)
  //    세트 화면의 "힛카드 TOP 8"이 이걸 8장 한꺼번에 받아 1.2MB였고, 정작 폰에서는
  //    68px 칸에 그린다(실측 2026-08-04). 표시 폭에 맞는 판을 고른다.
  //    ⚠️ _in_115x115와 확장자 없는 주소는 403이다. 400/200만 쓴다.
  function tcgSmaller(url: string, w: number): string {
    if (!/tcgplayer-cdn\.tcgplayer\.com\//.test(url)) return url
    const want = w <= 220 ? '_in_200x200' : w <= 430 ? '_in_400x400' : '_in_800x800'
    return url.replace(/_in_\d+x\d+(?=\.\w+$)/, want)
  }

  async function fetchThumb(
    url: string,
    w: number,
    timeoutMs = UPSTREAM_SLOW_MS,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    const bare = tcgSmaller(url, w).replace(/^https?:\/\//, '')
    // 스니커덩크의 배경제거 이미지는 1000x730 가로 캔버스 한가운데에 카드가 43%만
    // 차지하도록 들어 있다. 그대로 쓰면 목록에서 카드가 작게 보이고 둘레가 텅 빈다.
    // 투명한 여백을 잘라내면 카드가 틀을 꽉 채운다(320x234 → 320x449로 확인).
    // 다른 곳 이미지(TCGdex·TCGplayer 등)는 여백이 없거나 흰 바탕이라 자르면 카드
    // 테두리까지 깎일 수 있어 건드리지 않는다.
    const trimmable = /(^|\.)snkrdunk\.com\/upload_bg_removed\//.test(bare)
    const wsrv = `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=${w}&output=webp&q=72${trimmable ? '&trim=10' : ''}`
    try {
      const r = await fetch(wsrv, {
        signal: AbortSignal.timeout(timeoutMs),
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

    // ⚠️ tcgplayer는 wsrv가 못 받는다(늘 실패한다). 그런데도 wsrv에 물어보고 실패를
    //    기다린 뒤에 원본으로 넘기고 있어서, 넘기기만 하면 되는 일에 400ms가 걸렸다
    //    (2026-08-05 실측: 302 응답 하나에 381~404ms). 어차피 실패할 걸 아는
    //    주소는 묻지 말고 바로 넘긴다. 캐시에 못 담는 건 전과 같다.
    if (/(^|\.)tcgplayer-cdn\.tcgplayer\.com$/.test(target.hostname)) {
      res.statusCode = 302
      res.setHeader('location', tcgSmaller(u, w))
      // 이 판단은 주소만 보고 하는 것이라 바뀌지 않는다. 브라우저가 기억하게 둔다.
      res.setHeader('cache-control', 'public, max-age=604800')
      res.end()
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
      // 메모리에 없으면 디스크를 먼저 본다. 배포로 메모리가 비어도 여기서 살아난다.
      job = readDisk(key)
        .then((hit) => hit ?? fetchThumb(u, w).then((r) => {
          if (r) void writeDisk(key, r.body)
          return r
        }))
        .then((r) => {
          if (r) cache.set(key, r)
          inflight.delete(key)
          return r
        })
      inflight.set(key, job)
    }
    const result = await job
    if (!result) {
      // 못 받았으면 원본으로 리다이렉트해 화면이 비지 않게 한다. 다만 그걸로 끝내면
      // 캐시에 아무것도 안 남아 다음 사람도 똑같이 기다린다 — tcgdex는 한 장에 7~15초라
      // 이 경우가 꽤 된다. 방문자를 붙잡아 두지 않으면서 뒤에서 넉넉히 기다려 받아 둔다.
      if (!slowJobs.has(key)) {
        slowJobs.add(key)
        void fetchThumb(u, w, IMG_SLOW_RETRY_MS)
          .then((r) => {
            if (r) {
              cache.set(key, r)
              void writeDisk(key, r.body)
            }
          })
          .finally(() => slowJobs.delete(key))
      }
      // wsrv 실패: 원본으로 리다이렉트해 화면이 비지 않게 한다.
      // ⚠️ tcgplayer는 여기로 늘 떨어진다(wsrv가 막는다). 원본 그대로 보내면 148KB짜리
      //    800px 그림을 68px 칸에 그리게 되므로, 작은 판이 있으면 그쪽으로 보낸다.
      res.statusCode = 302
      res.setHeader('location', tcgSmaller(u, w))
      res.end()
      return
    }
    serve(result)
  })

  // 세트 목록 표지를 미리 받아 캐시에 채운다(위 startCoverWarmup이 부른다).
  // 방문자 요청과 같은 길(fetchThumb → cache)을 쓰므로 데워 두면 그대로 히트한다.
  // ⚠️ 천천히 돈다. 한꺼번에 366장을 두드리면 원본 서버가 막고, 우리 기계도 그동안
  //    방문자 요청이 밀린다. 4장씩·사이 300ms면 5분쯤 걸리는데, 그동안에도 방문자는
  //    자기가 보는 표지부터 받아 가므로 화면이 멈추지는 않는다.
  warmCovers = async () => {
    let list: { cover?: string }[]
    try {
      const raw = await readFile(path.resolve(process.cwd(), 'dist/sets/index.json'), 'utf-8').catch(() =>
        readFile(path.resolve(process.cwd(), 'public/sets/index.json'), 'utf-8'),
      )
      list = JSON.parse(raw)
    } catch {
      return
    }
    // 화면(cardCatalog.cardImg)과 같은 규칙으로 주소를 만든다.
    const full = (base: string) => (/\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/high.webp`)
    const urls = list.map((s) => s.cover).filter((c): c is string => !!c && !c.includes('snkrdunk'))
    let done = 0
    for (let i = 0; i < urls.length; i += 4) {
      await Promise.all(
        urls.slice(i, i + 4).map(async (base) => {
          const u = full(base)
          const key = `200|${u}`
          if (cache.get(key)) return
          const hit = (await readDisk(key)) ?? (await fetchThumb(u, 200, IMG_SLOW_RETRY_MS).catch(() => null))
          if (hit) {
            cache.set(key, hit)
            void writeDisk(key, hit.body)
            done++
          }
        }),
      )
      await new Promise((r) => setTimeout(r, 300))
    }
    console.log(`[pokegre] 세트 표지 ${done}장을 미리 받아 뒀습니다.`)
  }

  // 오늘 진열된 팩의 카드 그림을 미리 받아 둔다.
  //
  // 팩을 열면 뽑힌 카드가 240px로 뜬다. 안 받아 둔 상태면 10장에 1.5초가 걸렸다
  // (2026-08-05 실측). 하필 제일 기다리기 싫은 순간이다.
  // 진열이 매일 자정에 바뀌므로 손으로 돌리는 스크립트로는 못 따라간다 — 서버가
  // 기동할 때와 하루 한 번 돈다. 오늘 6팩이 1,013장(약 12MB)이라 부담이 없다.
  // ⚠️ 표지 데우기와 같은 속도로 천천히 돈다(4장씩·사이 300ms). 한꺼번에 두드리면
  //    원본이 막고 그동안 방문자 요청이 밀린다.
  warmPackCards = async () => {
    const today = livePacks()
    let done = 0
    let already = 0
    for (const pack of today) {
      const cards = await readPackCards(pack).catch(() => [])
      const urls = cards
        .map((c) => c.img)
        .filter((u): u is string => !!u && !u.includes('snkrdunk'))
        .map((base) => (/\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/high.webp`))
      for (let i = 0; i < urls.length; i += 4) {
        await Promise.all(
          urls.slice(i, i + 4).map(async (u) => {
            const key = `240|${u}`
            if (cache.get(key)) {
              already++
              return
            }
            const hit = (await readDisk(key)) ?? (await fetchThumb(u, 240, IMG_SLOW_RETRY_MS).catch(() => null))
            if (hit) {
              cache.set(key, hit)
              void writeDisk(key, hit.body)
              done++
            }
          }),
        )
        await new Promise((r) => setTimeout(r, 300))
      }
    }
    console.log(`[pokegre] 오늘 진열 팩 카드 ${done}장을 미리 받아 뒀습니다(이미 있던 것 ${already}장).`)
  }

  // 세트 하나의 힛카드 그림만 데운다(세트별 목록이 그리는 320px).
  // ⚠️ 폭은 SetsView가 힛카드를 그리는 값과 같아야 한다. 다르면 딴 칸에 담겨 헛일이다.
  warmHitCardImgs = async (slug: string) => {
    const top = topPricedCards(slug, 8)
    if (!top.length) return
    const cards = setCards(slug)
    const urls = top
      .map((t) => cards.get(String(Number(t.n)))?.img)
      .filter((u): u is string => !!u && !u.includes('snkrdunk'))
      .map((base) => (/\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/high.webp`))
    let done = 0
    for (const u of urls) {
      const key = `320|${u}`
      if (cache.get(key)) continue
      const hit = (await readDisk(key)) ?? (await fetchThumb(u, 320, IMG_SLOW_RETRY_MS).catch(() => null))
      if (hit) {
        cache.set(key, hit)
        void writeDisk(key, hit.body)
        done++
      }
    }
    if (done) console.log(`[pokegre] ${slug} 힛카드 그림 ${done}장을 미리 받아 뒀습니다.`)
  }
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
      // ⚠️ 원본이 실패했거나 모양이 바뀌어 한 건도 못 읽었으면 캐시하지 않는다.
      // 담아 두면 그때부터 캐시 시간 내내 뉴스가 통째로 빈 화면이 된다
      // (스니커덩크 프록시에서 같은 종류의 사고가 있었다 — 403을 담아 5분간 검색이 막혔다).
      if (upstream.ok && items.length) cache.set(cacheKey, body)
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
// 볼륨 973MB를 나눠 쓴다 — 카드 그림 캐시 400MB와 합쳐 600MB, 나머지 370MB가 데이터·백업
// 몫이다(위 IMG_DISK_MAX_BYTES 설명). 사진 한 장 상한이 4MB라 200MB면 넉넉히 담긴다.
const UPLOAD_DIR_MAX_BYTES = 200 * 1024 * 1024
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
  // 비밀글. 건의 게시판에서만 쓴다 — 쓴 사람과 운영자만 내용을 본다.
  // ⚠️ 목록에서 감추지 않는다. 감추면 "내 글이 사라졌다"고 오해하고, 운영자가 답을
  //    달아도 글쓴이가 못 찾는다. 자리는 남기고 제목·내용만 가린다.
  secret?: boolean
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
  // q는 같은 카드가 몇 장 나왔는지. 1장이면 안 붙인다(화면도 1이면 안 적는다).
  pull?: { pack: string; god: boolean; total?: number; cards: { img: string; name: string; r: string; q?: number }[] }
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
// 비밀글을 남이 볼 때 대신 보여줄 글. 글쓴이와 운영자에게는 원래 내용이 간다.
const SECRET_NOTICE = '비밀글입니다.'

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
  // ⚠️ 비밀글은 **서버에서** 내용을 지워서 내보낸다. 화면에서만 가리면 개발자 도구로
  //    응답을 열어 그대로 읽을 수 있어 비밀이 아니다.
  const 비밀 = rest.secret === true && !isAdmin(viewer) && !(viewer != null && authorId === viewer.id)
  const 가림 = hidden || 비밀
  return {
    ...rest,
    title: hidden ? HIDDEN_NOTICE : 비밀 ? SECRET_NOTICE : rest.title,
    content: hidden ? HIDDEN_NOTICE : 비밀 ? SECRET_NOTICE : rest.content,
    pull: 가림 ? undefined : rest.pull,
    images: 가림 ? undefined : rest.images,
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
          secret?: unknown
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
        // ⚠️ 비밀글은 **건의 게시판에서만** 받는다. 자유·질문까지 열어 주면 아무도 못 읽는
        //    글이 목록을 채워 게시판이 죽는다. 건의는 원래 운영자에게 하는 말이라 맞다.
        const secret = body.secret === true && category === 'suggestion'
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
          ...(secret ? { secret: true } : {}),
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
            // ⚠️ 구분자로 NUL(\0)을 쓰면 안 된다. 딱 한 글자 때문에 grep·file이 이 파일
            //    전체를 "글자 파일이 아니다"로 보고, 검색이 아무것도 못 찾은 채 조용히
            //    빈 결과를 준다(2026-08-04에 실제로 여기서 헤맸다). IP에 없는 글자면 된다.
            const key = `${clientIp(req)}|${id}`
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
          secret?: unknown
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
        // 비밀글 여부도 고칠 수 있다. 건의가 아니면 무조건 푼다 — 다른 게시판으로 옮기면서
        // 비밀글로 남으면 아무도 못 읽는 글이 그 게시판에 생긴다.
        if (body.secret === true && post.category === 'suggestion') post.secret = true
        else delete post.secret
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
          // ⚠️ 비밀글의 댓글도 같이 가린다. 글만 가리고 댓글을 열어 두면 운영자 답변이
          //    그대로 보여서 무슨 건의였는지 짐작할 수 있다 — 가린 뜻이 없어진다.
          const 글 = (await loadPosts()).find((p2) => p2.id === postId)
          if (글?.secret && !isAdmin(viewer) && !(viewer != null && 글.authorId === viewer.id)) {
            sendJson(res, 200, [])
            return
          }
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
// 새로 받는다. 넘으면 이미 있는 이름만 카운트한다(= 새 작가는 영영 순위에 못 든다).
// ⚠️ **실제 작가 수보다 크게 잡을 것.** 300으로 두고 주석에는 "80명 안팎"이라 적혀
//    있었는데, 실제로는 **388명**이다(2026-08-07 확인). 그대로 뒀으면 먼저 조회된
//    300명이 자리를 다 차지하고 나머지 88명은 아무리 조회돼도 0으로 남았을 것이다.
//    아직 57명만 쌓여서 터지지 않았을 뿐이다.
//    이름은 80자로 잘라 담으므로 800개라도 파일은 64KB를 넘지 않는다.
const MAX_ARTIST_KEYS = 800
// 세트별 목록에서 어떤 세트를 눌렀는지(누적). "세트별 조회" 이벤트에 딸려 온 세트 이름으로 센다.
const SET_STATS_FILE = dataFile('set-stats.json')
// 세트와 시리즈가 한 순위표를 같이 쓴다 — **2026-08-07 기준 세트 371 + 시리즈 33 =
// 404개**로 옛 상한 500에 96개밖에 안 남아 있었다(주석에는 "250여 개"라 적혀 있었다).
// 세트는 해마다 40개쯤 늘어 몇 해 뒤엔 새 세트가 순위에 못 들게 된다. 넉넉히 잡는다.
const MAX_SET_KEYS = 1200
// 기능별 사용 횟수만 센다. 허용된 이벤트 이름 외에는 받지 않는다(임의 키 방지).
// sets=세트별 목록에서 세트 열람, ebay_korean=이베이 한글판 시세 조회.
// search_* 는 "인기 검색어에 한 표가 들어갈 때 그 검색어를 어떻게 확정했나"를 센다.
// 검색 횟수(snkrdunk_search 등)와 합계가 같아야 정상이다 — 갈라 보는 축이 다를 뿐이다.
// 이걸 세는 이유: 지금은 그냥 타이핑하다 멈춰도(search_typed) 세는데, 그 기준(1.5초)이
// 애매하다는 지적이 있었다. typed 비중이 낮으면 그 경로를 떼도 순위가 안 무너진다.
const ALLOWED_EVENTS = new Set([
  'snkrdunk_search', 'ebay_search', 'scan', 'centering', 'artist', 'tcgplayer', 'sets', 'series',
  'ebay_korean', 'packsim', 'scantest', 'packsim_checkin', 'packsim_godpack', 'packsim_value',
  'packsim_share', 'share',
  'search_scan', 'search_pick', 'search_popular', 'search_enter', 'search_typed',
  'packsim_banner', 'artist_by_pokemon',
  // 홈의 "신팩 힛카드"(2026-08-05 추가). card=카드를 눌러 시세로 감, set=전체 보기.
  'home_hit_card', 'home_hit_set', 'pokedex',
  // 도감·세트·작가에서 카드를 눌렀을 때(2026-08-06). card_found=값을 찾은 마켓,
  // card_miss=어느 마켓에도 값이 없던 카드. 어떤 카드가 계속 빈손인지 보려는 것.
  'card_found', 'card_miss',
  // 카드 화면에 감정 수량이 실제로 보인 횟수(2026-08-07). 통째로 받아 둔 것이라
  // 크레딧을 안 쓰지만, 얼마나 자주 쓸모가 있는지는 세어 봐야 안다.
  'population', 'population_search', 'population_detail',
  // 센터링 화면을 연 횟수(2026-08-08). 'centering'은 사진이 들어온 횟수라 둘이 다르다 —
  // 같이 봐야 "안 들어온 것"과 "들어왔는데 안 쓴 것"이 갈린다.
  'centering_open',
])
// 날짜별 칸을 이만큼만 유지한다(그보다 오래된 날은 합계 보존용 legacy 칸으로 접는다).
const EVENT_KEEP_DAYS = 60
// 날짜 구분이 없던 옛 형식의 누적치를 담아두는 칸 이름. 전체 합계에만 들어간다.
const EVENT_LEGACY_KEY = 'legacy'
// 방문 통계는 날짜별 숫자만 400일치 남긴다. IP·기기 정보는 저장하지 않는다.
const VISIT_KEEP_DAYS = 400
// 400일보다 오래된 날들의 합을 담는 칸(날짜가 아니다). 기능 사용 통계와 같은 방식이다 —
// 날짜별 그래프는 최근 것만 보여주되 **누적 합계는 잃지 않는다.**
const VISIT_LEGACY_KEY = 'legacy'
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

const kstDayKey = kstDateStr

// 검색은 시간 단위 칸에 담는다: '2026-07-20T14'. 날짜 단위로 담으면 자정에 하루치가
// 통째로 사라져서 순위가 갑자기 뒤집히고, 그 사이엔 거의 안 움직인다. 시간 단위로
// 담아 "최근 24시간"만 합치면 한 시간마다 가장 오래된 한 시간이 빠지고 새 한 시간이
// 들어와, 순위가 하루 종일 조금씩 흐른다.
const kstHourKey = kstHourStr

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

  // 자동완성이 쓰는 "이름 + 레어도"("리자몽 MUR"). 서버가 시세 덤프를 받는 김에 매일
  // 다시 뽑는다 — 빌드에 박힌 목록은 만든 날에 멈춰 있어서 새 레어도를 못 따라간다.
  // 아직 한 번도 못 뽑았으면 빈 목록을 준다. 화면은 빌드 시점 목록으로 그냥 돌아간다.
  app.use('/api/local/rarity-terms', (req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    // 하루 한 번 바뀌는 값이라 오래 물고 있어도 된다.
    res.setHeader('cache-control', 'public, max-age=3600')
    // ⚠️ **미리 눌러 둔 것을 그대로 보낸다.** 325KB짜리라 요청마다 누르면 기계가 고생한다.
    //    brotli를 받겠다고 한 브라우저에만 준다(요즘 브라우저는 다 받는다). 아니면 글자
    //    그대로 보내고, 그건 앞단의 compression이 gzip으로 눌러 준다.
    const 받겠나 = String(req.headers['accept-encoding'] ?? '').includes('br')
    if (받겠나 && 레어도낱말BR) {
      res.setHeader('content-encoding', 'br')
      res.setHeader('vary', 'accept-encoding')
      res.end(레어도낱말BR)
      return
    }
    res.end(레어도낱말JSON)
  })

  app.use('/api/local/popular-searches', async (_req, res) => {
    await loadCounts()
    // 조회할 때도 오래된 날짜를 정리해 파일이 무한정 커지지 않게 한다.
    pruneOldDays()
    // 순위는 최근 24시간(POPULAR_WINDOW_HOURS)으로 매긴다 — 한 시간짜리 칸을 합치므로
    // 한 시간마다 가장 오래된 칸이 빠지고 새 칸이 들어와 하루 종일 조금씩 흐른다.
    // (예전엔 3일이었다. 시간 단위 칸으로 바꾸면서 24시간이 됐는데 이 주석만 옛 값으로
    //  남아 있었다 — 2026-08-04에 코드와 맞췄다.)
    // 그걸로 10칸이 안 차면 — 검색이 뜸해 목록이 비어 보일 때 — 더 긴 기간(30일)
    // 인기어로 뒤를 채운다. 최근 것이 늘 위, 옛 인기어가 빈 자리를 메우는 식이라
    // 목록이 텅 비지 않는다.
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
// 429가 이어지기 시작한 시각. 하루치를 다 썼는지 가리는 데 쓴다(아래 notePpt 설명).
let ppt429Since = 0
// 오늘 남은 크레딧. 응답 헤더로만 알 수 있어서 부를 때마다 갱신한다.
let pptDailyLeft = Number.POSITIVE_INFINITY
// 그 숫자가 어느 날짜(UTC) 것인지. 날이 바뀌면 옛 숫자는 못 쓴다.
let pptDailyLeftDay = ''
// 방문자 몫으로 남겨 둘 크레딧. 뒤에서 도는 앨범 시세 채우기가 하루치를 다 쓰면
// 그때부터 방문자의 eBay·TCGplayer 시세가 통째로 안 나온다. 실제로 그래 왔다 —
// 2026-07-28에도 낮 한 시간 반 동안 22세트를 받아 하루치가 바닥났다.
// 세트 하나가 200~600크레딧이라 채우기 한 바퀴에 1만 안팎이 든다.
// PPT Business 플랜(월 $99)의 하루치. 한국시간 오전 9시(UTC 0시)에 다시 찬다.
// 2026-08-07에 Pro($10, 하루 20,000)에서 올렸다 — 응답 헤더
// x-ratelimit-daily-limit이 200000으로 바뀐 것을 직접 확인했다.
const PPT_DAILY_LIMIT = 200_000
// 뒤에서 도는 작업이 넘지 않는 선. 방문자가 실제로 쓰는 건 하루 1,000 안팎이라
// (이베이 한 번에 36크레딧 × 20~30번) 40,000이면 서른 배 넘는 여유다.
const PPT_KEEP_FOR_VISITORS = 40_000
// 크레딧이 이 선을 지날 때 로그를 한 번 남긴다. 40,000은 뒤에서 도는 채우기가 멈추는 선,
// 20,000은 "이쯤부터는 눈여겨보자"는 선이다(옛 하루치와 같은 값이라 감이 잡힌다).
const PPT_ALERT_LINES = [PPT_KEEP_FOR_VISITORS, 20_000, 5000] as const

// ⚠️ 위 세 값은 메모리에만 있으면 배포할 때마다 지워진다. 그러면 "남은 크레딧을 아직
//    모른다(=무한대)" 상태로 다시 시작해 방문자 몫을 지키는 검사가 통과되고,
//    차단 중인 것도 잊고 다시 두드린다. 2026-08-02에 하루 여섯 번 배포하면서 이걸로
//    남겨 둔 4,000이 밤사이 다 나갔다. 그래서 파일에 적어 두고 뜰 때 읽는다.
const PPT_STATE_FILE = dataFile('ppt-state.json')
interface PptState {
  day: string // 어느 날짜의 잔량인지(UTC). 날이 바뀌면 버린다.
  left: number
  blockedUntil: number
  dailyOut: boolean
  // ⚠️ 오늘 "채우기"에 쓴 크레딧(WARM_FILL_BUDGET). 이것도 메모리에만 두면 배포할
  //    때마다 0으로 돌아가 하루 예산이 배포 횟수만큼 늘어난다. 2026-08-03에 이걸로
  //    그때 하루치 20,000이 통째로 나갔다 — 위 left와 똑같은 실수를 한 번 더 한 것이다.
  fillSpent?: number
  // ⚠️ 통째 받기(=/export)를 종류별로 **어느 날 받았는지**. 이것도 메모리에만 두면
  //    배포할 때마다 "오늘 아직 안 받았다"가 되어 다시 받는다. 통째 받기는 하루 2회가
  //    전부라, 하루에 두 번만 배포해도 그날 몫이 사라진다. 2026-08-07에 실제로 그랬다
  //    — 그날 네 번 배포해서 시세 덤프가 아예 안 들어왔다(left·fillSpent와 같은 실수를
  //    세 번째로 반복한 것이다). 날짜가 바뀌면 통째로 버린다.
  exportDays?: Record<string, string>
  // 저쪽(PPT)이 값을 하나도 안 주는 세트. 덤프를 받을 때마다 다시 계산한다.
  // ⚠️ 이건 **날짜와 상관없이 이어받는다**(아래 day 검사보다 먼저 읽는다). 안 그러면
  //    날이 바뀐 직후 서버가 뜰 때 잠깐 비어서, 세트별 받기가 그 세트들을 또 두드린다.
  noPriceSets?: string[]
}
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)

// 저쪽에 값이 아예 없어서 세트별로 받아 봐야 소용없는 세트(ja-SM1+ 썬&문 등).
const 값없는세트 = new Set<string>()

// 통째 받기(/export)를 종류별로 마지막에 받은 날(UTC). 파일로 남겨 배포해도 이어진다.
// 종류: cards(시세) · population(감정 수량) · ebay(등급별 낙찰)
const exportDoneDay: Record<string, string> = {}

// 지금 기준으로 쓸 수 있는 "남은 크레딧".
//
// ⚠️ 날짜가 바뀌면 어제 숫자는 버리고 "아직 모른다"로 돌아가야 한다. 안 그러면 서버를
//    안 내린 채 오전 9시를 넘겼을 때, 크레딧은 새로 찼는데 우리는 어제의 0을 들고 있어
//    미리받기가 "예산 없음"으로 판단하고 하루를 통째로 건너뛴다.
//    (방문자가 시세를 한 번 보면 헤더로 갱신되긴 하지만, 그걸 기다릴 이유가 없다.)
const pptLeftNow = () => (pptDailyLeftDay === utcDay() ? pptDailyLeft : Number.POSITIVE_INFINITY)

let pptStateSaveAt = 0
/**
 * @param 지금바로 10초 잠금을 건너뛴다. **하루 한 번뿐인 일**(통째 받기 결과처럼)에만 쓸 것.
 *   ⚠️ 이게 없어서 "저쪽에 값이 없는 세트" 목록이 파일에 안 적혔다 — 덤프 직후의 저장이
 *      바로 앞 저장에 막혀 조용히 버려졌다(2026-08-08 시험에서 잡음).
 */
async function savePptState(지금바로 = false) {
  // 부를 때마다 쓰면 디스크가 아프다. 10초에 한 번이면 배포 사이 상태를 지키기 충분하다.
  if (!지금바로 && Date.now() - pptStateSaveAt < 10_000) return
  pptStateSaveAt = Date.now()
  try {
    await mkdir(path.dirname(PPT_STATE_FILE), { recursive: true })
    // ⚠️ pptDailyLeft를 그냥 쓰면 안 된다. 날짜가 바뀐 뒤 아직 한 번도 안 불러 봤다면
    //    그 숫자는 어제 것인데, day에는 오늘을 적게 되어 어제의 0이 오늘 값으로 굳는다.
    const left = pptLeftNow()
    await writeJsonFile(PPT_STATE_FILE, {
      day: utcDay(),
      left: Number.isFinite(left) ? left : -1,
      blockedUntil: pptBlockedUntil,
      dailyOut: pptDailyOut,
      fillSpent: fillSpentToday(),
      exportDays: exportDoneDay,
      noPriceSets: [...값없는세트],
    } satisfies PptState)
  } catch {
    /* 못 적어도 서비스는 돌아간다 */
  }
}

export async function loadPptState() {
  try {
    const s = JSON.parse(await readFile(PPT_STATE_FILE, 'utf-8')) as PptState
    // ⚠️ **날짜 검사보다 먼저 읽는다.** 이건 크레딧이 아니라 "저쪽에 값이 없더라"는
    //    사실이라 하루가 지나도 유효하다. 뒤에 두면 날이 바뀐 직후 잠깐 비어서
    //    세트별 받기가 그 세트들을 헛되이 두드린다.
    if (Array.isArray(s.noPriceSets)) {
      for (const slug of s.noPriceSets) if (typeof slug === 'string') 값없는세트.add(slug)
    }
    // 하루치는 UTC 자정에 새로 찬다. 어제 것이면 그대로 쓰면 안 된다.
    if (s.day !== utcDay()) return
    // ⚠️ **"남은 0"인데 막혀 있지도 않으면 잘못 적힌 값이다.** 진짜로 다 썼으면 저쪽이
    //    429를 주고 dailyOut이 서 있다. 둘이 안 맞으면 "모름"으로 두고 다시 재게 한다.
    //    안 그러면 잘못된 0을 이어받아, 감정수량 조회와 시세 미리받기가 방문자 몫을
    //    지키느라 하루 종일 멎어 있는다(2026-08-08에 실제로 그랬다).
    if (typeof s.left === 'number' && s.left > 0) {
      pptDailyLeft = s.left
      pptDailyLeftDay = s.day
    } else if (s.left === 0 && s.dailyOut) {
      pptDailyLeft = 0
      pptDailyLeftDay = s.day
    } else if (s.left === 0) {
      console.log('[pokegre] 앞뒤가 안 맞는 크레딧 0을 버렸습니다(막혀 있지도 않은데 0) — 다시 재 봅니다.')
    }
    // ⚠️ 하루치를 다 쓴 게 아닌데(dailyOut=false) 몇 시간씩 막혀 있을 이유가 없다
    //    — 분당 한도는 1분이면 풀린다. 그런 값이 파일에 남아 있으면 버린다.
    //    CSV 전용 429의 Retry-After(하루치)를 전체 차단으로 잘못 적어 둔 적이 있다
    //    (2026-08-07). 그대로 이어받으면 배포해도 막힌 채로 뜬다.
    if (typeof s.blockedUntil === 'number') {
      const 말도안됨 = !s.dailyOut && s.blockedUntil > Date.now() + 2 * 60 * 60 * 1000
      if (말도안됨) console.log('[pokegre] 앞뒤가 안 맞는 차단 시각을 버렸습니다(하루치는 남았는데 오래 막혀 있음)')
      else pptBlockedUntil = s.blockedUntil
    }
    pptDailyOut = !!s.dailyOut
    if (typeof s.fillSpent === 'number' && s.fillSpent >= 0) {
      fillSpent = s.fillSpent
      fillSpentDay = s.day
    }
    // 통째 받기 기록도 오늘 것만 이어받는다(위 day 검사에서 이미 어제 것은 걸러졌다).
    if (s.exportDays && typeof s.exportDays === 'object') {
      for (const [종류, 날] of Object.entries(s.exportDays)) {
        if (typeof 날 === 'string') exportDoneDay[종류] = 날
      }
    }
    const 오늘받은것 = Object.entries(exportDoneDay)
      .filter(([, 날]) => 날 === utcDay())
      .map(([종류]) => 종류)
    console.log(
      `[pokegre] PPT 상태를 이어받았습니다: 남은 크레딧 ${Number.isFinite(pptLeftNow()) ? pptLeftNow() : '모름'}` +
        ` · 오늘 채우기에 쓴 것 ${fillSpentToday().toLocaleString()}/${WARM_FILL_BUDGET.toLocaleString()}` +
        (오늘받은것.length ? ` · 오늘 통째로 받아 둔 것 [${오늘받은것.join(', ')}]` : '') +
        (pptBlockedUntil > Date.now() ? ` · ${new Date(pptBlockedUntil).toISOString()}까지 쉽니다` : ''),
    )
  } catch {
    /* 처음 뜨는 것 */
  }
}

// 하루치는 UTC 자정(한국시간 오전 9시)에 초기화된다.
const nextUtcMidnight = (now = Date.now()) => {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

// 지금 불러도 되는지. daily는 "하루치를 다 썼다"는 뜻으로, 화면 안내가 달라진다.
const pptGate = (): { ok: boolean; daily: boolean } =>
  Date.now() < pptBlockedUntil ? { ok: false, daily: pptDailyOut } : { ok: true, daily: false }

/**
 * 응답 머리글에서 숫자를 읽는다. **없으면 "모름"(NaN)이지 0이 아니다.**
 *
 * ⚠️ 여기서 실제로 사고가 났다(2026-08-08 07:17 UTC). `Number(headers.get(...))`로
 *    읽었는데, 머리글이 없으면 `headers.get`은 null을 주고 **`Number(null)`은 0**이다.
 *    그런데 `Number.isFinite(0)`은 참이라, "남은 크레딧을 제대로 읽었고 그 값이 0"으로
 *    통했다. PPT에는 195,341이 멀쩡히 남아 있는데도 서버는 다 쓴 줄 알았다.
 *    그 뒤로 **감정수량(팝수) 라이브 조회와 시세 미리받기가 통째로 멎는다** — 둘 다
 *    `pptLeftNow()`가 방문자 몫보다 적으면 그냥 돌아서기 때문이다. 게다가 이 값은
 *    파일에 남아 서버를 새로 띄워도 이어받는다. 하루가 끝날 때까지 안 풀린다.
 *    (머리글이 빠지는 응답은 흔하다 — 우리 프록시 앞단의 오류 페이지, 게이트웨이 응답 등.)
 */
const 머리글숫자 = (headers: Headers, 이름: string): number => {
  const v = headers.get(이름)
  return v === null || v.trim() === '' ? NaN : Number(v)
}

// 응답을 보고 언제까지 쉴지 정한다.
// 5xx는 PPT 쪽 장애라 한도와 무관하므로 판단을 바꾸지 않는다.
function notePpt(status: number, headers: Headers) {
  // 어떤 갈래로 끝나든 파일에 남긴다. 배포로 서버가 새로 떠도 이 판단을 이어받는다.
  try {
    return notePptInner(status, headers)
  } finally {
    void savePptState()
  }
}

function notePptInner(status: number, headers: Headers) {
  const left = 머리글숫자(headers, 'x-ratelimit-daily-remaining')
  if (Number.isFinite(left)) {
    // ⚠️ 크레딧이 어디로 갔는지 로그에 아무것도 안 남아 있었다. 그래서 새벽에 400쯤
    //    줄어든 걸 보고도 누가 썼는지 끝내 못 밝혔다(2026-08-05). 매번 찍으면 시끄러우니
    //    "넘으면 안 되는 선"을 지날 때만 한 번씩 남긴다. 이게 운영자가 제일 알고 싶은 것이다.
    const before = pptLeftNow()
    for (const line of PPT_ALERT_LINES) {
      if (before > line && left <= line) {
        console.log(`[pokegre] PPT 크레딧이 ${line.toLocaleString()} 아래로 내려갔습니다: 남은 ${left.toLocaleString()}`)
      }
    }
    pptDailyLeft = left
    pptDailyLeftDay = utcDay()
  }
  const after = 머리글숫자(headers, 'retry-after')
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
      ppt429Since = 0
    }
    return
  }
  const now = Date.now()
  if (!ppt429Since) ppt429Since = now

  // 429는 두 가지인데 PPT가 늘 구분해 주지는 않는다. 남은 크레딧 헤더가 0이면 확실하지만,
  // 헤더를 아예 안 보내면서 429만 주는 경우가 있다(2026-08-01 실측: 서버를 새로 띄워
  // 우리 쪽 차단을 지운 직후 첫 호출도 429였고, 헤더는 없었다).
  //
  // 분당 한도라면 1분 안에 풀린다. 그래서 "쉬었다가 다시 불렀는데 또 429"가 2분 넘게
  // 이어지면 분당 한도가 아니다 — 하루치를 다 쓴 것으로 본다. 이걸 안 하면 방문자에게
  // "30초 뒤에 다시 눌러 주세요"라고 잘못 안내해 밤새 헛되이 새로고침하게 만든다.
  const stuckTooLong = now - ppt429Since > 2 * 60_000
  pptDailyOut = (Number.isFinite(left) && left <= 0) || stuckTooLong

  // 분당 한도면 PPT가 Retry-After로 알려준다. 없으면 1분 쉰다.
  pptBlockedUntil = pptDailyOut ? nextUtcMidnight() : now + (wait || 60_000)
}

// ⚠️ 여기 "무료 티어가 하루 100건이라 24시간"이라고 적혀 있었다. **무료 시절 설정이
//    그대로 남아 있던 것**이다(2026-08-07에 발견). Pro를 거쳐 Business(하루 200,000)가
//    됐는데 캐시만 그대로라, 아낄 이유가 없는데도 방문자가 **하루 지난 값**을 봤다.
//
//    저쪽 시세는 하루 한 번 갱신된다(lastPriceUpdate가 UTC 0시 무렵 = 한국시간 오전 9시).
//    24시간으로 두면 오전에 갱신된 값을 저녁에 들어온 사람이 못 본다. 6시간이면
//    그날 값이 늦어도 여섯 시간 안에 들어온다.
const PRICE_TRACKER_CACHE_TTL_MS = 6 * 60 * 60 * 1000
// 서로 다른 검색이 그만큼 캐시에 남는다.
// ⚠️ **한 칸이 작지 않다.** 12장짜리 검색 하나가 157KB다(2026-08-07 실측) — 시세 추이를
//    등급마다 365점씩 담기 때문이고, 낙찰 기록은 그중 24KB(15%)뿐이다.
//    기계가 512MB라 500칸이면 최악 77MB가 캐시로만 나간다. 300칸(46MB)으로 줄인다.
//    위 TTL도 6시간으로 짧아져서, 300칸이면 그 시간 안의 서로 다른 검색을 담기 충분하다.
const PRICE_TRACKER_MAX_ENTRIES = 300
// 무료 요금제가 하루 100건이다. 한 사람이 시간당 20건이면 정상 사용에는 걸릴 일이
// 없으면서, 혼자서 하루치를 태우려면 다섯 시간이 걸린다.
// 한 사람이 시간당 몇 번까지 새로 조회할 수 있는지(캐시 적중은 안 센다).
// Business로 올려 하루치가 200,000이 됐으니(2026-08-07) 시간당 1,000이어도
// 한 사람이 하루에 쓸 수 있는 건 36,000 남짓 — 방문자 몫 40,000 안에 든다.
// 목적은 정상 사용자를 막는 게 아니라 한 사람이 하루치를 태우지 못하게 하는 것이다.
const PRICE_TRACKER_RATE_LIMIT = 1000
const PRICE_TRACKER_RATE_WINDOW_MS = 60 * 60 * 1000

// 등급 목록을 세우는 순서는 **화면과 같은 한 벌**을 쓴다(src/lib/gradeOrder.ts).
// 두 벌로 두면 같은 자료를 화면마다 다르게 세우게 된다 — 오늘 그 사고를 여러 번 냈다.

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
  // 레어도("Special Art Rare"·"Mega Ultra Rare"…). 화면에서 "리자몽 SAR"처럼
  // 뒤에 붙은 코드로 좁힐 때 쓴다.
  rarity?: string
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
  // ⚠️ 마켓가가 **어떤 상태의 매물을 기준으로 잡힌 값인지**가 여기 들어 있다
  //    (conditionUsed: "Moderately Played 1st Edition - Japanese").
  //    옛 일본판은 매물이 귀해서 민트가 아닌 매물로 값이 잡히는 일이 흔하다 —
  //    2026-08-07 실측: 옛 일본판 121장 중 72장(60%)이 민트 기준이 아니었고,
  //    "Damaged"(손상됨) $0.25짜리도 있었다. 그걸 그냥 "시세"라고 보여 주면
  //    민트 카드를 가진 사람이 자기 카드 값을 그만큼으로 오해한다.
  variants?: Record<string, { printing?: string; conditionUsed?: string }>
  ebay?: {
    salesByGrade?: Record<string, RawEbayGrade>
    // ⚠️ **개별 낙찰 기록**이 여기 통째로 온다(등급별로 나뉘어). 지금까지 통계만 쓰고
    //    이건 버리고 있었다 — 블레인의 리자몽 202건, 에브이 ex 663건이 응답에 들어
    //    있는데 한 건도 안 보여 줬다(2026-08-07 발견). 이미 받는 값이라 크레딧이
    //    더 들지 않는다. "합계 202건"보다 "1월 18일 $160에 팔렸다"가 훨씬 쓸모 있다.
    soldListings?: Record<
      string,
      {
        price?: number
        soldDate?: string
        url?: string
        listingType?: string
        bestOfferAccepted?: boolean
        // ⚠️ 매물 제목. **딴 카드가 섞였는지 가리는 유일한 단서**다(아래 딴카드거르기).
        title?: string
      }[]
    >
    // 요즘 얼마나 자주 팔리는지. 값이 진짜인지, 팔고 싶을 때 팔 수 있는지를 가른다 —
    // "낙찰 202건"은 다 합친 숫자라 1년 전에 몰려 팔린 카드와 지금도 잘 나가는 카드가
    // 똑같아 보인다. 낙찰 있는 카드의 78%에 값이 있다(2026-08-07 실측).
    salesVelocity?: { dailyAverage?: number; weeklyAverage?: number; monthlyTotal?: number }
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
  /** 딴 카드로 보여 뺀 낙찰 건수(카드 전체 합). 없으면 안 보낸다. */
  droppedOther?: number
  name: string
  setName: string
  cardNumber: string | null
  rarity: string
  imageUrl: string
  totalSales: number
  // 최근 한 달 낙찰 건수. 모르면 null(화면에서 자동으로 숨김).
  monthlySales: number | null
  // TCGplayer 미국 마켓 시세(미감정 카드). 없으면 null.
  tcgplayer: {
    market: number
    low: number
    sellers: number
    printing: string | null
    // 이 값이 잡힌 매물의 상태("Near Mint"·"Moderately Played"…). 모르면 null.
    condition: string | null
    // 아래 history가 **어느 상태의** 추이인지. 큰 숫자와 다를 수 있어(그 상태 추이가
    // 없는 카드가 있다) 화면에서 밝히려고 같이 넘긴다.
    historyCondition: string | null
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
    /** 딴 카드로 보여 뺀 낙찰 건수(0이면 없음). 화면이 "몇 건 뺐다"를 밝히는 데 쓴다. */
    droppedOther?: number
    // 현재 적정가와 그 신뢰도. 없으면 null(그땐 화면이 중앙값으로 대체한다).
    smartPrice: number | null
    confidence: string | null
    // 그 등급의 날짜별 낙찰 평균가(오래된→최신). 그래프에 쓴다. 없으면 빈 배열.
    history: { date: string; price: number }[]
    // 실제 낙찰 몇 건(최근 순). 통계가 아니라 **낱개 거래**다.
    // ⚠️ 등급당 EBAY_SALES_PER_GRADE건까지만 넘긴다. 전부 넘기면 응답이 264KB까지
    //    부풀고(에브이 ex 663건), 화면에서 다 보여 줄 수도 없다.
    sales: { price: number; date: string; url: string; auction: boolean }[]
  }[]
}

// 등급 하나에 몇 건까지 보여 줄지. 사람이 훑어보는 데는 이 정도면 충분하고,
// 더 보고 싶으면 등급 줄을 눌러 이베이 낙찰내역으로 갈 수 있다.
const EBAY_SALES_PER_GRADE = 5
// 그래프에 보낼 날짜 수 상한(등급당). 낱개로 다시 그리면 점이 많아질 수 있어 막아 둔다 —
// 낱개 2,151건짜리 카드도 있다. 넉넉히 잡아도 선 모양은 그대로다.
const EBAY_HISTORY_MAX = 120

// PokemonPriceTracker 원본 응답에는 화면에 안 쓰는 정보(개별 낙찰 목록, 전체 가격
// 히스토리, smartMarketPrice 등)까지 들어 있다. 원본을 그대로 프록시로 흘리면 이
// 엔드포인트가 사실상 그들의 API를 재중계(재배포)하는 꼴이라 약관 위반 소지가 있다.
// 그래서 화면에 실제로 쓰는 필드만 추려서 내려준다("제품 내 표시"에만 해당하도록).
// have='ebay'이면 낙찰 기록이 있는 카드만, 'tcgplayer'면 TCGplayer 마켓가가 있는 카드만
// 남긴다. 소스별로 목록이 달라야 하고(이베이엔 낙찰 카드, TCGplayer엔 시세 있는 카드),
// 캐시도 have별로 나뉜다.
// 이베이·TCGplayer 카드의 "번호 → 영문 이름". 공유 링크(/e/·/t/) 미리보기 제목에 쓴다.
// 시세를 볼 때마다 응답이 서버를 지나가므로 그때 이름을 주워 둔다 — 크레딧이 안 든다.
// ⚠️ 여기 'PPT는 번호로 카드 한 장을 찾는 기능이 없다(확인함)'고 적혀 있었는데 **틀렸다.**
//    tcgPlayerId로 부르면 그 한 장을 준다(2026-08-07 직접 확인). 그 잘못된 단정 때문에
//    공유 링크가 아예 안 열리는 버그까지 있었다. 못 주운 카드는 fetchCardNameForShare가
//    받아 온다(하루 상한 있음).
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

// ── 공유 링크 미리보기용 이름 받아오기 (2026-08-07) ─────────────────────────
//
// 왜: 지금까지는 "시세를 볼 때 지나가는 응답에서 이름을 주워 두는" 것만 했다. 아무도
// 안 본 카드를 공유하면 카톡에 "pokegre — 포켓몬 카드의 모든 것"만 떠서 무슨 카드를
// 보낸 건지 알 수 없었다. 위 주석에 'PPT는 번호로 카드 한 장을 찾는 기능이 없다'고
// 적혀 있었는데 **있다** — tcgPlayerId로 부르면 그 한 장을 준다(직접 확인).
//
// ⚠️ 크롤러가 링크를 두드릴 때마다 크레딧이 나가므로 하루 상한을 둔다. 한 번 받은
//    이름은 창고에 남아 다음부터는 공짜다.
const SHARE_NAME_FETCH_DAILY_MAX = 500
let shareNameFetchDay = ''
let shareNameFetchCount = 0

export async function fetchCardNameForShare(apiKey: string, id: string): Promise<string | null> {
  if (!apiKey || !/^\d+$/.test(id)) return null
  const 이미 = cardNameById.get(id)
  if (이미) return 이미
  const today = utcDay()
  if (shareNameFetchDay !== today) { shareNameFetchDay = today; shareNameFetchCount = 0 }
  if (shareNameFetchCount >= SHARE_NAME_FETCH_DAILY_MAX) return null
  const gate = pptGate()
  if (!gate.ok) return null
  shareNameFetchCount++
  // 이름만 필요하므로 히스토리·이베이는 끈다(카드당 1크레딧).
  for (const language of ['english', 'japanese'] as const) {
    try {
      const p = new URLSearchParams({ language, tcgPlayerId: id, limit: '1' })
      const r = await fetch(`${PRICE_TRACKER_ORIGIN}/cards?${p.toString()}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(UPSTREAM_SLOW_MS),
      })
      notePpt(r.status, r.headers)
      if (!r.ok) continue
      const j = (await r.json()) as { data?: { name?: string } | { name?: string }[] }
      const d = Array.isArray(j.data) ? j.data[0] : j.data
      const name = String(d?.name ?? '').trim()
      if (!name) continue
      rememberCardName(id, name)
      return name
    } catch {
      /* 다음 판으로 */
    }
  }
  return null
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


// ── 딴 카드가 섞인 낙찰 기록 걸러내기 ────────────────────────────────────────
//
// ⚠️⚠️ **저쪽(PPT)이 이름이 겹치는 세트를 한 카드로 묶어 놓는다.** 사장님이 잡아 주셨다
//    (2026-08-08, /e/575612):
//      우리 카드   1996 일본판 「확장팩 제1탄」 나인테일
//      저쪽 세트명 "Expansion Pack"
//    그런데 그 이름에 걸리는 세트가 셋이다 — 확장팩 제1탄(1996) · 확장팩 20th
//    Anniversary(2016, CP6) · 기본확장팩(2001). 저쪽은 이 셋의 낙찰을 **한 카드에** 담는다.
//      PSA 10:  진짜 1996년 $650·$911   ↔   섞인 2016년 $79.99·$89.99·$96·$107.5
//      그래서 화면에 **평균 $461 · 중앙 $379**가 나갔다. 실제로는 $781쯤이다.
//    카드 39장·낙찰 13,771건을 훑어 보니 **10.8%가 딴 카드**였다. 한 장짜리 사고가 아니다.
//
/**
 * 이 카드의 낙찰 기록 중 **딴 카드인 것**을 가려내는 검사를 만든다.
 *
 * ⚠️⚠️⚠️ **잘못 빼는 쪽이 섞이는 쪽보다 나쁘다.** 진짜 거래를 지우면 값이 거꾸로 틀어진다.
 *    여기까지 오는 데 잘못된 규칙을 세 번 만들었다(2026-08-08, 전부 표본 119장·낙찰
 *    20,682건 전수 대조로 잡았다):
 *      ① "제목 번호가 **다수**와 다르면 딴 카드" → **거꾸로 잘랐다.** 번호를 안 적는
 *         사람이 더 많아서, 정확히 적은 진짜 기록이 소수가 된다.
 *         (Pikachu Star 104/110 — 맞게 적은 52건이 통째로 잘렸다.)
 *      ② 글자로 견주기 → "232/91"과 "232/091"이 다른 것이 됐다(0 채움 차이).
 *      ③ **연도만 어긋나면 뺀다**(건수 문턱 없이) → 표본에서 **30건 넘게 잘못 잘렸다.**
 *         감정 라벨의 연도 오기가 아주 흔하다 — "2003 EX DRAGON FRONTIERS #97"(진짜는
 *         2006) · "2021 PALDEAN FATES #232"(진짜는 2024) · "2004 PALDEAN FATES".
 *         제목에 박힌 판매일("Sold Nov 9, 2025")도 카드 연도로 읽혔다.
 *      ④ **번호 앞자리**로 견주기 → 표본에서 12건이 잘못 잘렸다. 앞자리는 카드 번호가
 *         아닌 것이 너무 많다. LEGEND는 상·하 두 장이라 제목이 "#89 and #90"이고,
 *         뮤는 **도감번호 151**을 제목에 쓴다(진짜 번호는 1/18).
 *
 * ⚠️ **저쪽이 준 카드 번호는 잣대로 안 쓴다.** 틀린 것이 있다("Mew"의 번호가 빈칸,
 *    나인테일도 빈칸). 그래서 **그 카드의 낙찰 기록끼리만** 견준다.
 *
 * 지금 규칙: **번호를 적은 기록끼리만** 견주고, **떼로 어긋난 것만** 뺀다.
 *   · 번호를 적은 게 5건 이상이고 그중 70% 이상이 한 분모여야 그 분모를 잣대로 삼는다
 *   · 어긋난 분모가 **3건 이상이고 전체의 5% 이상**일 때만 뺀다
 *     (판매자 오타는 한두 건이다 — "232/232"·"#1/17" 같은 것을 지우면 안 된다)
 *   · 연도도 같은 방식. **기간 표기("2003-06")와 올해(=팔린 해)는 안 본다.**
 *
 * ⚠️ **아직 못 잡는 것이 있다.** 사장님이 잡아 주신 /e/575612(1996 일본판 나인테일)는
 *    섞인 쪽(2016년 CP6)이 **번호를 적은 기록 중에서는 다수**라 이 규칙으로 안 걸린다.
 *    그건 세트를 알아보는 방법이 따로 있어야 한다 — 다음 회차에서 잇는다.
 */
const 등급말앞 = /(psa|bgs|cgc|sgc|tag|ace|grade|gem|mint|black label)\s*$/i
const 제목분모 = (t: string): string => {
  for (const m of t.matchAll(/(^|[^\d/])(\d{1,3})\s*\/\s*(\d{2,3})(?![\d/])/g)) {
    if (등급말앞.test(t.slice(0, (m.index ?? 0) + m[1].length))) continue
    return m[3]
  }
  return ''
}
const 기간표기 = /\b(19|20)\d{2}\s*-\s*\d{2,4}\b/
// ⚠️ **제목 맨 앞에 판 날짜가 붙어 오는 것이 있다** — "Sold  Nov 9, 2025- PSA 10 - Pikachu
//    058/102 Base Set"처럼. 이걸 안 떼면 **2025가 카드 연도로 읽혀** 1999년 카드에서
//    멀쩡한 기록이 잘린다(표본에서 실제로 3건 잘렸다). 뒤 글자에 붙어 있기도 하다
//    ("Sold  Sep 10, 20252005 Pokemon EX Deoxys…") — 그래서 연도까지만 떼어 낸다.
const 판날짜앞 = /^\s*Sold\s+[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}/i
const 제목연도 = (t: string) => {
  const s = t.replace(판날짜앞, ' ')
  return 기간표기.test(s)
    ? []
    : (s.match(/\b(19[89]\d|20[0-2]\d)\b/g) ?? []).map(Number).filter((y) => y < new Date().getFullYear())
}

/**
 * **제목이 다른 세트 이름을 대놓고 적은 것**을 잡는다. 위의 번호·연도 견주기와 달리
 * 다수결이 아니라서, 딱 한 건이 섞여 있어도 잡힌다.
 *
 * 저쪽이 세트를 헷갈리는 까닭은 단순하다 — **세트 이름이 남의 이름 안에 통째로 들어간다.**
 * 우리 대조표 332개 중 21개가 그렇다:
 *      "Expansion Pack"  ⊂  "CP6: Expansion Pack 20th Anniversary" · "Base Expansion Pack"
 *      "EX Dragon"       ⊂  "EX Dragon Frontiers"
 *      "Celebrations"    ⊂  "Celebrations: Classic Collection"
 * 그래서 제목에 **우리 이름보다 긴 형제 이름이 통째로** 적혀 있으면 딴 카드다.
 *
 * ⚠️ **긴 쪽이 적혔을 때만 뺀다.** 우리가 긴 쪽인데(CP6) 제목에 짧은 이름만("Expansion
 *    Pack") 있는 경우는 그냥 줄여 쓴 것일 수 있어서 안 뺀다. 한쪽으로만 확실할 때 뺀다.
 *
 * ⚠️⚠️ **같은 세트를 저쪽이 두 이름으로 부르는 것이 있다.** 이걸 형제로 보면 멀쩡한
 *    기록이 잘린다(표본에서 22건 — 아래 둘을 넣기 전 실측):
 *      ① 앞에 코드만 붙은 것 — "XY-P: XY Promos"는 "XY Promos"와 같은 세트다.
 *         포켓몬 판초 피카츄 203/XY-P가 통째로 잘렸다.
 *         → **콜론 뒤가 우리 이름과 같으면** 형제로 안 본다.
 *      ② 흔한 낱말만 더 붙은 것 — "Pokemon Jungle"은 "Jungle"과 같은 세트다.
 *         → **더 붙은 낱말이 전부 흔한 말이면** 형제로 안 본다.
 */
const 이름고르기 = (s: string) =>
  ' ' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '
// "pokemon jungle" 같은 것을 딴 세트로 오해하지 않게 한다. 여기 있는 말만 더 붙었으면
// 같은 세트를 달리 적은 것으로 본다.
// 'ex'가 들어 있는 까닭 — 저쪽은 같은 세트를 "Hidden Legends"와 "EX Hidden Legends"
// 둘 다로 부른다. ex만 더 붙은 것은 딴 세트가 아니다.
const 흔한말 = new Set(['pokemon', 'pokémon', 'tcg', 'card', 'cards', 'the', 'and', 'of', 'a', 'japanese', 'english', 'jp', 'en', 'ex'])
// ⚠️ **우리가 화면에 안 가진 세트까지 알아야 한다.** pptSetNames는 우리 세트 대조표라
//    332개뿐인데, 저쪽 덤프에는 세트가 654개 있다. 그리고 덤프 카드의 **29%(16,962장)가
//    대조표에 없는 세트**다(2026-08-08 실측). 섞여 들어오는 쪽은 대개 우리가 안 가진
//    세트라("Expansion Pack"에 섞인 CP6가 그랬다), 대조표만 보면 못 알아본다.
//    pptSetList.json은 덤프에서 뽑는다 — scripts/gen-ppt-set-list.mts.
const 세트이름들 = [
  ...new Set([...(pptSetList as string[]), ...Object.values(pptSetNames as Record<string, string>)]),
]
const 형제캐시 = new Map<string, string[]>()
function 긴형제(세트: string): string[] {
  const 내이름 = 이름고르기(세트)
  if (내이름.trim().length < 5) return [] // 너무 짧은 이름은 아무 데나 걸린다
  const 있는것 = 형제캐시.get(내이름)
  if (있는것) return 있는것
  const 내낱말 = new Set(내이름.trim().split(' '))
  const 것: string[] = []
  for (const 원본 of 세트이름들) {
    // ⚠️ **앞의 코드를 안 붙이고 적는 사람이 많다.** "CP6: Expansion Pack 20th
    //    Anniversary"를 그냥 "Expansion Pack 20th Anniversary"라고 쓴다. 전체 이름만
    //    보면 이런 것이 빠져나간다(나인테일 PSA 10에서 실제로 $96짜리 하나가 남았다).
    //    그래서 콜론 뒤 토막도 같이 본다 — 그래도 우리 이름보다 길어야 통과한다.
    const 후보 = 원본.includes(':') ? [원본, 원본.slice(원본.lastIndexOf(':') + 1)] : [원본]
    for (const 조각 of 후보) {
      const n = 이름고르기(조각)
      if (n === 내이름 || !n.includes(내이름) || 것.includes(n)) continue
      // ① 콜론 뒤가 우리 이름과 같으면 코드만 붙인 같은 세트다("XY-P: XY Promos").
      const 콜론뒤 = 원본.includes(':') ? 이름고르기(원본.slice(원본.lastIndexOf(':') + 1)) : ''
      if (콜론뒤 === 내이름) break
      // ② 더 붙은 낱말이 전부 흔한 말이면 같은 세트를 달리 적은 것이다("Pokemon Jungle").
      const 더붙은 = n.trim().split(' ').filter((w) => !내낱말.has(w))
      if (더붙은.some((w) => !흔한말.has(w))) 것.push(n)
    }
  }
  형제캐시.set(내이름, 것)
  return 것
}

function 딴카드거르기(
  soldListings: Record<string, { title?: string }[]> | undefined,
  setName?: string | null,
): (x: { title?: string }) => boolean {
  const 전부 = Object.values(soldListings ?? {}).flat()
  const 형제 = setName ? 긴형제(setName) : []
  const 형제인가 = (t: string) => {
    if (!형제.length) return false
    const s = 이름고르기(t)
    return 형제.some((n) => s.includes(n))
  }
  if (전부.length < 8) return 형제.length ? (x) => 형제인가(String(x.title ?? '')) : () => false

  const 셈하기 = (값들: string[]) => {
    const m = new Map<string, number>()
    for (const v of 값들) if (v) m.set(v, (m.get(v) ?? 0) + 1)
    let 대표 = '',
      n = 0
    for (const [k, c] of m) if (c > n) ((대표 = k), (n = c))
    const 합 = [...m.values()].reduce((a, b) => a + b, 0)
    // 적은 게 5건 이상이고 그중 70% 이상이 한 값이어야 잣대로 삼는다.
    return { 셈: m, 대표, 믿나: 합 >= 5 && n / 합 >= 0.7 }
  }
  // ⚠️ **잣대를 세울 땐 이미 딴 세트로 판명난 것을 빼고 센다.** 안 그러면 섞인 쪽이
  //    다수가 되어 잣대가 거꾸로 선다(나인테일이 그랬다 — 진짜 1996년 기록은 "#38"이라
  //    분모를 안 적고, 섞인 2016년 CP6가 "015/087"이라 분모 표에서 다수였다).
  const 성한것 = 전부.filter((x) => !형제인가(String(x.title ?? '')))
  const 잣대 = 성한것.length >= 5 ? 성한것 : 전부
  const D = 셈하기(잣대.map((x) => 제목분모(String(x.title ?? ''))))
  const Y = 셈하기(
    잣대.map((x) => {
      const y = 제목연도(String(x.title ?? ''))
      return y.length ? String(Math.min(...y)) : ''
    }),
  )
  // **떼로 어긋난 것만** 뺀다. 한두 건은 판매자 오타다.
  const 떼인가 = (m: Map<string, number>, k: string) => {
    const c = m.get(k) ?? 0
    return c >= 3 && c / 전부.length >= 0.05
  }

  return (x) => {
    const t = String(x.title ?? '')
    if (!t) return false
    // 제목이 더 긴 형제 세트 이름을 통째로 적었으면 다수결을 볼 것도 없다.
    if (형제인가(t)) return true
    if (D.믿나) {
      const d = 제목분모(t)
      // 0 채움은 무시하고 숫자로 견준다("232/91" = "232/091").
      if (d && Number(d) !== Number(D.대표) && 떼인가(D.셈, d)) return true
    }
    if (Y.믿나) {
      const y = 제목연도(t)
      if (y.length) {
        const k = String(Math.min(...y))
        if (Math.abs(Number(k) - Number(Y.대표)) >= 3 && 떼인가(Y.셈, k)) return true
      }
    }
    return false
  }
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
      // ⚠️ **이 카드에 딴 카드가 섞였는지 가리는 검사**를 카드마다 한 번 만든다.
      //    낙찰 기록 전체를 봐야 "다수"를 알 수 있어서 등급별로 따로 만들면 안 된다.
      const 딴것 = 딴카드거르기(card.ebay?.soldListings, card.setName)
      const history = card.ebay?.priceHistory ?? {}
      // TCGplayer 날짜별 추이는 상태(Near Mint·Lightly Played…)별로 나뉘어 온다.
      //
      // ⚠️ **큰 숫자와 같은 상태를 그려야 한다.** 예전엔 무조건 Near Mint를 우선했는데,
      //    마켓가는 Near Mint가 아닌 매물로 잡히는 일이 흔하다(옛 일본판은 60%).
      //    그러면 큰 숫자와 그래프가 서로 다른 상태를 말하게 된다 — 추이가 있는 카드
      //    83장 중 12장(14%)이 그랬다(2026-08-07 실측).
      //        뮤츠 118/128  큰 숫자 $109.99(많이 사용된)  ↔  그래프는 민트 $159
      //    같은 화면에서 값이 안 맞으니 어느 쪽을 믿어야 할지 알 수 없다.
      //    conditionUsed("Moderately Played 1st Edition - Japanese")에서 상태 부분만
      //    떼어 그 상태의 추이를 고른다. 없으면 예전처럼 Near Mint → 점 많은 순.
      const conditions = card.priceHistory?.conditions ?? {}
      // ⚠️ 큰 숫자에 붙이는 상태(아래 condition)와 **똑같은 것**을 골라야 한다. 다르게
      //    고르면 방금 맞춰 놓은 것이 다시 어긋난다. 그래서 한 변수로 둔다.
      const 쓴상태 =
        (card.prices?.primaryPrinting ? card.variants?.[card.prices.primaryPrinting]?.conditionUsed : null) ??
        Object.values(card.variants ?? {})[0]?.conditionUsed ??
        null
      // 좋은 상태부터 나쁜 상태 순. "가장 가까운 상태"를 고를 때 이 순서로 잰다.
      const 상태순서 = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged']
      const 상태이름 = 상태순서.find((c) => (쓴상태 ?? '').includes(c))
      // ⚠️ 딱 그 상태의 추이가 **없는 카드가 있다.** 뮤츠 118/128은 큰 숫자가 "많이
      //    사용된" $109.99인데 추이는 민트·조금·손상만 있다. 그때 예전처럼 민트로
      //    넘어가면 $159를 그려 큰 숫자와 50달러가 벌어진다. 순서상 **가장 가까운
      //    상태**를 고른다 — 여기서는 손상($95)이 민트($159)보다 훨씬 가깝다.
      const 있는것 = Object.keys(conditions).filter((k) => (conditions[k].history?.length ?? 0) > 0)
      const conditionKey =
        (상태이름 && 있는것.includes(상태이름) ? 상태이름 : null) ??
        (상태이름
          ? 있는것
              .filter((k) => 상태순서.includes(k))
              .sort(
                (a, b) =>
                  Math.abs(상태순서.indexOf(a) - 상태순서.indexOf(상태이름)) -
                  Math.abs(상태순서.indexOf(b) - 상태순서.indexOf(상태이름)),
              )[0]
          : null) ??
        (있는것.includes('Near Mint')
          ? 'Near Mint'
          : 있는것.sort(
              (a, b) => (conditions[b].history?.length ?? 0) - (conditions[a].history?.length ?? 0),
            )[0])
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
              // 위에서 고른 것을 그대로 쓴다(추이 그래프와 같은 상태여야 한다).
              condition: 쓴상태,
              historyCondition: conditionKey ?? null,
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
        // ⚠️ **레어도를 같이 내보낸다.** 저쪽의 search는 카드 이름만 보므로
        //    "리자몽 MUR"을 그대로 보내면 0장이 오고, "리자몽 SAR"은 **SAR가 아닌 카드
        //    7장**이 온다(2026-08-08 실측 — 저쪽이 모르는 낱말을 흘려버린다).
        //    이 값이 있어야 화면에서 진짜 그 레어도만 걸러낼 수 있다(팝수 화면과 같은 방식).
        rarity: card.rarity ?? '',
        imageUrl: card.imageCdnUrl400 ?? card.imageCdnUrl200 ?? '',
        // ⚠️ **총 낙찰 건수도 딴 카드를 빼고 센다.** 저쪽 값을 그대로 쓰면 "총 53건"이라
        //    적히는데 그중 14건이 딴 카드다(2026-08-08). 낱개가 늘 전부 오므로
        //    (카드 40장 전수 확인) 거른 낱개를 세는 쪽이 맞다.
        totalSales: (() => {
          const 낱개 = Object.values(card.ebay?.soldListings ?? {}).flat()
          if (!낱개.length) return card.ebay?.totalSales ?? 0
          const 남 = 낱개.filter((x) => !딴것(x)).length
          // 저쪽 총계와 낱개 수가 어긋나면(낱개가 일부만 온 경우) 저쪽 값을 믿는다.
          return (card.ebay?.totalSales ?? 0) === 낱개.length ? 남 : card.ebay?.totalSales ?? 0
        })(),
        // ⚠️ **뺀 건수를 화면에도 알린다.** 말없이 빼면 이베이에서 직접 세어 본 사람과
        //    숫자가 달라 보여 "우리가 틀렸나" 싶어진다. 왜 다른지 한 줄로 밝힌다.
        droppedOther: (() => {
          const 낱개 = Object.values(card.ebay?.soldListings ?? {}).flat()
          if ((card.ebay?.totalSales ?? 0) !== 낱개.length) return undefined
          const 뺀 = 낱개.filter((x) => 딴것(x)).length
          return 뺀 > 0 ? 뺀 : undefined
        })(),
        monthlySales:
          (card.ebay?.salesVelocity?.monthlyTotal ?? 0) > 0 ? (card.ebay?.salesVelocity?.monthlyTotal ?? null) : null,
        tcgplayer,
        grades: Object.entries(card.ebay?.salesByGrade ?? {})
          .map(([grade, stat]) => {
            // ⚠️ **딴 카드가 섞인 낙찰을 먼저 뺀다**(위 딴카드거르기 설명).
            const 원래 = (card.ebay?.soldListings?.[grade] ?? []).filter((x) => (x.price ?? 0) > 0 && x.soldDate)
            const 남은 = 원래.filter((x) => !딴것(x))
            const 뺀수 = 원래.length - 남은.length
            // ⚠️ **저쪽이 미리 계산한 평균·중앙값은 섞인 것까지 넣고 낸 값이라 못 쓴다.**
            //    다만 저쪽 건수와 우리가 받은 낱개 수가 같을 때만 다시 센다 — 낱개가
            //    일부만 온 카드에서 다시 세면 오히려 값이 틀어진다.
            const 전부왔나 = (stat.count ?? 0) === 원래.length && 원래.length > 0
            const 다시셀까 = 뺀수 > 0 && 전부왔나
            // ⚠️⚠️ **저쪽이 이상값으로 빼 둔 것을 우리도 빼야 한다.** 저쪽 셈법을 뜯어보니
            //    이렇다 — **건수(count)는 전부 세고, 값(합·평균·중앙·최저·최고)은 최저~최고
            //    범위 안의 것만으로 낸다.** 등급칸 2,669개를 맞춰 보니 **2,669개 전부**
            //    이 규칙과 정확히 맞았다(2026-08-08).
            //        리자몽 004/102 psa9 — 낱개 20건 중 $21,020·$19,462·$16,345 세 건은
            //        범위($1,500~$4,000) 밖이다. 저쪽 합계 43,965.26은 나머지 17건의 합과
            //        소수점까지 같다.
            //    이걸 모르고 낱개 전부로 다시 셌더니 **평균이 $2,586에서 $5,226으로 뛰었다.**
            //    한 건을 뺐는데 평균이 두 배가 되는, 있을 수 없는 값이었다.
            //    등급칸의 18.2%에 이런 범위 밖 낱개가 있다 — 드문 일이 아니다.
            const 안쪽 = 남은.filter(
              (x) =>
                (x.price ?? 0) >= (stat.minPrice ?? 0) * 0.999 &&
                (x.price ?? 0) <= (stat.maxPrice ?? Infinity) * 1.001,
            )
            const 값 = 안쪽.map((x) => x.price ?? 0).sort((a, b) => a - b)
            const 중앙 = 값.length
              ? 값.length % 2
                ? 값[(값.length - 1) / 2]
                : (값[값.length / 2 - 1] + 값[값.length / 2]) / 2
              : 0
            return {
            grade,
            // ⚠️ **건수는 범위 밖까지 센다**(저쪽과 같은 뜻으로 맞춘다 — 위 설명).
            //    다만 범위 안이 하나도 안 남으면 낼 값이 없으므로 0으로 두고,
            //    아래 filter(count > 0)에서 그 등급칸을 아예 안 보여준다.
            count: 다시셀까 ? (값.length ? 남은.length : 0) : stat.count ?? 0,
            averagePrice: 다시셀까 ? (값.length ? 값.reduce((a, b) => a + b, 0) / 값.length : 0) : stat.averagePrice ?? 0,
            medianPrice: 다시셀까 ? 중앙 : stat.medianPrice ?? 0,
            minPrice: 다시셀까 ? 값[0] ?? 0 : stat.minPrice ?? 0,
            maxPrice: 다시셀까 ? 값[값.length - 1] ?? 0 : stat.maxPrice ?? 0,
            // 몇 건을 왜 뺐는지 화면이 밝힐 수 있게 같이 준다(0이면 안 보낸다).
            droppedOther: 뺀수 > 0 ? 뺀수 : undefined,
            marketTrend: stat.marketTrend ?? null,
            lastSaleDate: stat.lastSaleDate ?? null,
            // ⚠️ **대표값이 실제 낙찰 범위를 벗어나면 안 쓴다.** 저쪽은 대표값에
            //    15%를 깎는데(실측: 벗어난 값이 전부 정확히 최저가의 0.85배였다),
            //    거래가 한두 건뿐인 등급에서는 그 결과가 **실제로 팔린 어떤 값보다도
            //    낮아진다**. 등급칸 630개 중 85개(13%)가 그랬다(2026-08-07).
            //        차리조드 V cgc10  대표 $23.8  ↔  실거래 $28~$289.99
            //    "$23.8"을 보고 온 사람은 그 값에 살 수 있다고 믿는데 그런 매물이 없다.
            //    낱개 낙찰을 화면에 붙이고 나서야 눈에 띈 문제다 — 전에는 숫자 하나뿐이라
            //    틀린 줄도 몰랐다. 범위 밖이면 null을 주고, 화면은 중앙값으로 넘어간다
            //    (중앙값은 실제 거래에서 뽑으므로 범위 안에 있는 것이 보장된다).
            smartPrice: (() => {
              const sp = stat.smartMarketPrice?.price ?? null
              if (sp == null) return null
              // ⚠️ **다시 센 범위로 견준다.** 섞인 것을 뺀 뒤에는 저쪽 대표값이 범위 밖으로
              //    나가는 일이 잦다(싼 딴 카드가 최저가를 끌어내리고 있었기 때문이다).
              const lo = 다시셀까 ? 값[0] ?? 0 : stat.minPrice ?? 0
              const hi = 다시셀까 ? 값[값.length - 1] ?? 0 : stat.maxPrice ?? 0
              if (lo > 0 && hi > 0 && (sp < lo || sp > hi)) return null
              return sp
            })(),
            confidence: stat.smartMarketPrice?.confidence ?? null,
            // ⚠️ **그래프도 우리가 다시 그린다.** 두 가지 때문이다:
            //    ① 저쪽 그래프는 **날짜별 평균에 딴 카드까지 넣어** 계산한 값이다.
            //       (2026-08-01 psa10을 보면 sevenDayAverage가 $433인데, 그날 실제로
            //        팔린 진짜 카드는 $911 하나다 — 나머지는 2016년 카드다.)
            //    ② 저쪽 그래프는 **최근 며칠치뿐**이라 거의 비어 있다. 이 카드는
            //       미감정이 12건 팔렸는데 **점이 0개**여서 그래프가 아예 안 떴다.
            //       낱개 2,151건짜리 카드도 점은 89개뿐이었다.
            //    낱개는 **늘 전부 온다**(카드 40장 전수 확인: 낱개 수 = 등급별 건수 합).
            //    그러니 낱개로 그리면 오염도 없고 훨씬 촘촘하다.
            // ⚠️ 하루에 여러 건 팔리면 그날 평균을 쓴다(저쪽과 같은 뜻으로 맞춘다).
            // ⚠️ **최근 것부터 EBAY_HISTORY_MAX일까지만** 보낸다. 다 보내면 응답이 커진다.
            // ⚠️ 그래프도 **범위 안의 것만** 쓴다. 이상값 한 건이 그래프를 통째로 눌러
            //    나머지 점이 바닥에 붙어 버린다($21,020 한 건 옆에서 $2,500은 점이 아니다).
            history: (() => {
              if (!안쪽.length) return shapeGradeHistory(history[grade])
              const 날별 = new Map<string, { 합: number; 수: number }>()
              for (const x of 안쪽) {
                const d = String(x.soldDate).slice(0, 10)
                const v = 날별.get(d) ?? { 합: 0, 수: 0 }
                v.합 += x.price ?? 0
                v.수 += 1
                날별.set(d, v)
              }
              return [...날별.entries()]
                .map(([date, v]) => ({ date, price: Math.round((v.합 / v.수) * 100) / 100 }))
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(-EBAY_HISTORY_MAX)
            })(),
            sales: 남은
              // 최근 것부터. 저쪽이 어떤 순서로 주는지 보장이 없어 우리가 정렬한다.
              .sort((a, b) => String(b.soldDate).localeCompare(String(a.soldDate)))
              .slice(0, EBAY_SALES_PER_GRADE)
              .map((x) => ({
                price: x.price ?? 0,
                date: String(x.soldDate).slice(0, 10),
                url: x.url ?? '',
                // 경매인지 즉시구매인지. 경매가는 "그날 시장이 매긴 값"이라 더 믿을 만하다.
                auction: String(x.listingType ?? '').toLowerCase() === 'auction',
              })),
            }
          })
          // ⚠️ **낙찰이 통째로 딴 카드였던 등급은 아예 뺀다.** 남은 게 없는데 등급 줄만
          //    남으면 "$0"이나 빈칸이 뜬다(이 카드의 CGC 10이 그랬다 — 두 건 다 2016년 것).
          .filter((g) => g.count > 0)
          .sort((a, b) => 등급순서값(a.grade) - 등급순서값(b.grade) || b.count - a.count),
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

  // 오래된 날짜 칸은 **지우지 않고 legacy로 접는다.** 예전엔 지웠는데, 그러면 화면의
  // "전체 누적"이 400일째부터 조용히 줄어든다 — 누적이라 적어 놓고 줄어드는 숫자다.
  // 기능 사용(event-stats)은 이미 이렇게 접고 있었다. 방문만 달랐다(2026-08-07 발견).
  function prune() {
    if (!visits) return
    const keep = new Set<string>()
    const now = Date.now()
    for (let i = 0; i < VISIT_KEEP_DAYS; i++) keep.add(kstDayKey(now - i * DAY_MS))
    for (const day of Object.keys(visits)) {
      // ⚠️ legacy 자신은 날짜가 아니므로 keep에 없다. 빼지 않으면 스스로를 지운다.
      if (day === VISIT_LEGACY_KEY || keep.has(day)) continue
      visits[VISIT_LEGACY_KEY] = (visits[VISIT_LEGACY_KEY] ?? 0) + (visits[day] ?? 0)
      delete visits[day]
    }
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
    // legacy는 날짜가 아니므로 그래프에 넣지 않는다. 대신 누적 합계에는 더한다.
    const legacy = all[VISIT_LEGACY_KEY] ?? 0
    const items = Object.entries(all)
      .filter(([date]) => date !== VISIT_LEGACY_KEY)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
    // 가입 회원 수(개수만). 회원번호 등 내용은 절대 안 내보낸다.
    const memberCount = (await loadUsers()).length
    // 오늘 시세 조회 크레딧이 얼마나 남았는지. 이게 0이 되면 방문자에게 이베이·
    // TCGplayer 시세가 안 보이므로, 운영자가 서버 로그를 뒤지지 않고 바로 보게 한다.
    const left = pptLeftNow()
    const credits = {
      left: Number.isFinite(left) ? left : null, // null = 아직 한 번도 안 불러서 모름
      daily: PPT_DAILY_LIMIT,
      fillSpent: fillSpentToday(),
      fillBudget: WARM_FILL_BUDGET,
      keepForVisitors: PPT_KEEP_FOR_VISITORS,
      resetAt: new Date(nextUtcMidnight()).toISOString(), // 한국시간 오전 9시
      blocked: Date.now() < pptBlockedUntil,
      // ⚠️ left는 **우리 서버가 마지막으로 PPT를 부른 때**의 값이다. 밖에서(스크립트 등)
      //    크레딧을 쓰면 우리는 모르므로, 남았다고 적혀 있는데 조회는 429가 될 수 있다.
      //    실제로 그런 일이 났다 — 화면엔 12,000이 남았는데 검색이 안 됐다(2026-08-07).
      //    "하루치를 다 썼다"는 판단은 429를 받아 본 이 값이 정확하므로 같이 내보낸다.
      dailyOut: pptDailyOut,
    }
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ items, total: legacy + items.reduce((s, i) => s + i.count, 0), memberCount, credits }))
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
        // 시리즈는 세트와 같은 순위표에 넣는다. 세트별 목록 화면의 한 축이라 나눠 두면
        // 두 표를 번갈아 봐야 하고, 시리즈 이름(예: "소드&실드")은 세트 이름과 안 겹친다.
        if ((ev === 'sets' || ev === 'series') && label) {
          const tally = await loadSets()
          const key = ev === 'series' ? `${label} (시리즈)` : label
          if (key in tally || Object.keys(tally).length < MAX_SET_KEYS) {
            tally[key] = (tally[key] ?? 0) + 1
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
    // jp = 일본판, na = 영문판, kr = 한글판(한글 자료가 붙은 카드만)
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
// API 키는 서버에서만 붙이고 클라이언트에는 절대 내려주지 않는다.
// (캐시 시간은 PRICE_TRACKER_CACHE_TTL_MS에 있다 — 무료 시절 기준이 오래 남아 있었다.)
// 마지막으로 받아 둔 시세. 위 TtlCache와 따로 두는 이유가 둘이다.
//
// ① 크레딧이 바닥나면 방문자에게 시세가 통째로 안 보였다(2026-08-03에 실제로 그랬다).
//    하루가 지난 값이라도 "언제 기준인지" 밝히고 보여주는 게 아무것도 안 보이는 것보다 낫다.
// ② 메모리에만 두면 배포할 때마다 지워져서, 이미 받아 둔 카드를 방문자가 다시 열 때
//    크레딧을 또 쓴다. 하루에 여러 번 배포하는 날엔 이게 크다.
const LAST_PRICE_FILE = dataFile('card-prices-last.json')
const LAST_PRICE_MAX = 400
// 지난 시세를 보여줄 최대 나이. 이보다 오래된 것은 안 보여주고 예전처럼 안내만 뜬다.
const STALE_PRICE_MAX_MS = 3 * 24 * 60 * 60 * 1000
const lastPrice = new Map<string, { body: string; at: number }>()
let lastPriceSaveAt = 0

async function saveLastPrices() {
  // 10초에 한 번이면 배포 사이 상태를 지키기 충분하다(ppt-state와 같은 이유).
  if (Date.now() - lastPriceSaveAt < 10_000) return
  lastPriceSaveAt = Date.now()
  try {
    const rows = [...lastPrice.entries()].slice(-LAST_PRICE_MAX).map(([k, v]) => [k, v.body, v.at])
    await writeJsonFile(LAST_PRICE_FILE, rows)
  } catch {
    /* 못 적어도 서비스는 돌아간다 */
  }
}

export async function loadLastPrices() {
  try {
    const rows = JSON.parse(await readFile(LAST_PRICE_FILE, 'utf-8')) as [string, string, number][]
    for (const [k, body, at] of rows) {
      if (typeof k === 'string' && typeof body === 'string' && typeof at === 'number') {
        lastPrice.set(k, { body, at })
      }
    }
    console.log(`[pokegre] 지난 시세 ${lastPrice.size}건을 이어받았습니다`)
  } catch {
    /* 처음 뜨는 것 */
  }
}

function rememberPrice(key: string, body: string) {
  lastPrice.delete(key) // 다시 넣어 순서를 뒤로 — 넘칠 때 오래된 것부터 버린다
  lastPrice.set(key, { body, at: Date.now() })
  while (lastPrice.size > LAST_PRICE_MAX) {
    const oldest = lastPrice.keys().next().value
    if (oldest === undefined) break
    lastPrice.delete(oldest)
  }
  void saveLastPrices()
}

/** 지금 못 받을 때 쓸 "지난 시세". 언제 받은 것인지 함께 실어 보낸다. */
function stalePrice(key: string): string | null {
  const hit = lastPrice.get(key)
  if (!hit) return null
  // 너무 오래된 값은 안 보여준다. 날짜를 적어 두긴 하지만 그 줄을 놓치고
  // 지금 시세로 오해할 수 있다. 크레딧은 보통 다음 날 오전 9시면 다시 차므로
  // 사흘이면 충분하다(사용자 확인 2026-08-04).
  if (Date.now() - hit.at > STALE_PRICE_MAX_MS) return null
  try {
    return JSON.stringify({ ...(JSON.parse(hit.body) as object), asOf: new Date(hit.at).toISOString() })
  } catch {
    return null
  }
}

function mountEbayPrice(app: Mountable, apiKey: string) {
  const cache = new TtlCache<string>(PRICE_TRACKER_CACHE_TTL_MS, PRICE_TRACKER_MAX_ENTRIES)
  const allow = rateLimiter(PRICE_TRACKER_RATE_LIMIT, PRICE_TRACKER_RATE_WINDOW_MS)

  // 팝수 조회 화면의 카드 찾기. **시세 검색과 달리 값을 안 받아서 1/3 값이다**
  // (시세 검색은 includeHistory·includeEbay 때문에 장당 3크레딧, 여기는 1크레딧).
  // 팝수만 볼 건데 시세까지 받아 올 이유가 없다.
  // 한 번에 받을 카드 수. 이름 하나에 카드가 수십 장인 포켓몬이 많아(개굴닌자 71장)
  // 넉넉히 받는다. 장당 1크레딧이고 캐시에 6시간 담긴다.
  // PPT는 limit을 아무리 크게 줘도 **한 번에 200행까지만** 준다. 그 최대치를 쓴다.
  // 100이던 것을 올렸다 — "피카츄"가 딱 100장으로 잘려 화면에 "카드 100장을
  // 찾았습니다"라고 적히고 있었다(2026-08-07 확인). 실제로는 더 많다.
  // ⚠️ 200을 넘는 이름은 여전히 잘린다. 잘렸는지를 화면에 알려 줘야 한다(capped).
  //    값이 높은 순으로 받으므로 잘리면 **싼 카드가 안 보인다** — "다 나온다"고
  //    믿게 두면 안 된다.
  const CARD_FIND_LIMIT = 200
  // ⚠️ 칸 수를 500 → 150으로 줄였다. 한 칸이 **41KB**다(200장 × 카드 정보).
  //    500칸이면 20MB인데, 운영 기계는 512MB이고 실측 여유가 220MB뿐이다
  //    (2026-08-07 /proc/meminfo). 150칸이면 6MB로, 서로 다른 이름 150개를
  //    6시간 안에 찾는 일은 지금 사용량에서 오지 않는다.
  const 찾기캐시 = new TtlCache<string>(6 * 60 * 60 * 1000, 150)
  app.use('/api/local/card-find', async (req, res) => {
    const q = new URL(req.url ?? '', 'http://x').searchParams
    const 말 = q.get('search')?.trim() ?? ''
    const 판 = q.get('lang') === 'english' ? 'english' : 'japanese'
    res.setHeader('content-type', 'application/json')
    if (말.length < 2) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'search required' }))
      return
    }
    // ⚠️ 저쪽은 **영문 이름만 알아듣는다.** 한글이 그대로 오면 0장이 온다(실측).
    //    화면이 사전으로 바꿔 보내지만, 사전을 아직 못 받았거나 실패하면 한글이
    //    그대로 올라온다 — 그때 "그런 카드 없음"으로 보이면 사람은 우리가 그 카드를
    //    안 다루는 줄 안다. 여기서 한 번 더 막는다.
    if (/[가-힣]/.test(말)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'needs_english', message: '영문 이름으로 다시 시도해 주세요.' }))
      return
    }
    const 열쇠 = `${판}:${말.toLowerCase()}`
    const 있음 = 찾기캐시.get(열쇠)
    if (있음) {
      res.statusCode = 200
      res.end(있음)
      return
    }
    if (!apiKey || !allow(req) || !pptGate().ok) {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'unavailable' }))
      return
    }
    try {
      const u = new URL(`${PRICE_TRACKER_ORIGIN}/cards`)
      u.searchParams.set('search', 말)
      u.searchParams.set('language', 판)
      // ⚠️ 12장만 받고 있었다. 팝수 조회는 **그 이름의 카드를 다 훑어보는 화면**이라
      //    12장은 턱없이 적다 — "개굴닌자"는 일본판 53장·영문판 71장이 있는데 12장만
      //    나왔다(2026-08-07 사장님 지적). 시세 검색(12장 + 더 보기)과 목적이 다르다.
      //    장당 1크레딧이라 60장이어도 60크레딧이고, 6시간 캐시에 담긴다.
      u.searchParams.set('limit', String(CARD_FIND_LIMIT))
      u.searchParams.set('sortBy', 'price')
      u.searchParams.set('sortOrder', 'desc')
      const r = await fetch(u, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) })
      notePpt(r.status, r.headers)
      if (!r.ok) {
        res.statusCode = r.status === 429 ? 429 : 502
        res.end(JSON.stringify({ error: 'upstream', status: r.status }))
        return
      }
      const j = (await r.json()) as { data?: Record<string, unknown>[] }
      const cards = (j.data ?? []).map((c) => ({
        tcgPlayerId: String(c.tcgPlayerId ?? ''),
        name: String(c.name ?? ''),
        setName: String(c.setName ?? ''),
        cardNumber: String(c.cardNumber ?? ''),
        rarity: String(c.rarity ?? ''),
        imageUrl: String(c.imageCdnUrl200 ?? c.imageUrl ?? ''),
      }))
      const body = JSON.stringify({ cards, language: 판, capped: cards.length >= CARD_FIND_LIMIT })
      찾기캐시.set(열쇠, body)
      res.statusCode = 200
      res.end(body)
    } catch {
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'upstream' }))
    }
  })

  // 등급표 전부. 요약은 통째로 받아 둔 것에 있지만 **등급 하나하나는 여기서 받는다**
  // (메모리가 512MB뿐이라 전 카드 상세를 들고 있을 수 없다).
  const 상세캐시 = new TtlCache<string>(POP_DETAIL_TTL_MS, POP_DETAIL_MAX)
  app.use('/api/local/population-detail', async (req, res) => {
    const q = new URL(req.url ?? '', 'http://x').searchParams
    const id = q.get('id')?.trim() ?? ''
    const 판 = q.get('lang')?.trim() || undefined
    res.setHeader('content-type', 'application/json')
    if (!id) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'id required' }))
      return
    }
    const 열쇠 = `${id}:${판 ?? ''}`
    const 있음 = 상세캐시.get(열쇠)
    if (있음) {
      res.statusCode = 200
      res.end(있음)
      return
    }
    const d = await fetchPopulationDetail(apiKey, id, 판)
    const body = JSON.stringify({ detail: d })
    if (d) 상세캐시.set(열쇠, body)
    res.statusCode = 200
    res.end(body)
  })

  // 감정 수량 · 등급별 낙찰. 통째로 받아 둔 것이라 **크레딧을 쓰지 않는다**.
  // 카드 화면이 이미 아는 tcgPlayerId로 바로 찾는다.
  app.use('/api/local/card-extra', async (req, res) => {
    const id = new URL(req.url ?? '', 'http://x').searchParams.get('id')?.trim() ?? ''
    res.setHeader('content-type', 'application/json')
    if (!id) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'id required' }))
      return
    }
    // 덤프에 있으면 그걸 쓴다(크레딧 0). 없을 때만 한 장 받아 온다 —
    // 통째 받기는 이레에 한 번이라 그 사이 빈칸이 생기고, 그 한 장이 방문자가
    // 지금 보고 있는 카드다. 예산·재시도 제한은 fetchPopulationLive 안에 있다.
    const 판 = new URL(req.url ?? '', 'http://x').searchParams.get('lang')?.trim() || undefined
    let pop = populationCache.get(id) ?? null
    if (!pop) pop = await fetchPopulationLive(apiKey, id, 판)
    const grades = ebayGradeCache.get(id) ?? null
    res.statusCode = 200
    // 하루 한 번 갱신되는 값이라 오래 물고 있어도 된다.
    res.setHeader('cache-control', 'public, max-age=3600')
    res.end(JSON.stringify({ population: pop, grades, 받은날: exportDoneDay.population ?? null }))
  })

  // ⚠️ **아는 값만 저쪽에 넘긴다.** 예전엔 방문자가 보낸 주소를 통째로 넘겼는데,
//    저쪽은 모르는 값이 하나만 붙어도 **400을 주고 아무것도 안 준다.** 실제로
//    확인용으로 붙인 `?notrack=1` 하나 때문에 시세가 통째로 안 나왔다
//    (2026-08-08). 광고·추천 링크에 흔히 붙는 utm_* 같은 것이 따라 들어오면
//    그 방문자에게는 시세 화면이 통째로 비어 보인다.
//    have는 우리 서버에서만 쓰는(소스 필터) 값이라 역시 안 보낸다.
const 넘길것 = new Set([
  'language',
  'tcgPlayerId',
  'search',
  'setName',
  'setId',
  'rarity',
  'artist',
  'cardType',
  'minPrice',
  'maxPrice',
  'limit',
  'offset',
  'sortBy',
  'sortOrder',
  'includeEbay',
  'fetchAllInSet',
])


  app.use('/api/local/card-prices', async (req, res) => {
    if (!apiKey) {
      res.statusCode = 501
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'POKEMON_PRICE_TRACKER_API_KEY not configured' }))
      return
    }

    const url = new URL(req.url ?? '', 'http://localhost')
    // ⚠️ **캐시 열쇠도 거른 값으로 만든다.** 방문자 주소를 그대로 쓰면 utm_* 하나만
    //    달라도 딴 요청으로 세어, 같은 카드를 크레딧 주고 또 산다.
    const 거른것 = new URLSearchParams()
    for (const [k, v] of [...url.searchParams].sort((x, y) => x[0].localeCompare(y[0])))
      if (넘길것.has(k) || k === 'have') 거른것.append(k, v)
    const cacheKey = '?' + 거른것.toString()
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

    // ⚠️ 여기에는 크레딧 바닥선(5,000)을 걸지 않는다 — 일부러 그런 것이다.
    //    바닥선은 "자동 작업과 스크립트가 방문자 몫을 먹지 못하게" 하는 장치다.
    //    이 길이 바로 그 방문자 몫을 쓰는 곳이라, 여기까지 막으면 5,000을 남겨 두고
    //    정작 방문자에게는 시세를 못 보여주는 셈이 된다(2026-08-03 사용자 확인).
    //    미리받기 쪽은 PPT_KEEP_FOR_VISITORS(40,000)로 따로 막고 있다.
    //
    // 이미 한도에 걸린 걸 아는 동안은 부르지 않는다. 불러도 429가 돌아올 뿐인데,
    // 그 429가 쌓이면 키가 정지된다(위 pptGate 설명).
    const gate = pptGate()
    if (!gate.ok) {
      // 크레딧이 없어도 아무것도 안 보여주지는 않는다. 지난번에 받아 둔 값이 있으면
      // "언제 기준인지"를 붙여 그걸 준다(사용자 편의 우선, 2026-08-04).
      const stale = stalePrice(cacheKey)
      if (stale) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(stale)
        return
      }
      res.statusCode = 429
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: gate.daily ? 'daily_limit' : 'upstream_error', status: 429 }))
      return
    }

    try {
      // 등급별 가격 추이 그래프를 그리려면 히스토리를 함께 받아야 한다. 클라이언트가
      // 보낸 검색 조건은 그대로 두고 히스토리 옵션만 서버에서 덧붙인다. (캐시 키는
      // 클라이언트 쿼리 기준이라 그대로 두면 된다.)
      const upstreamParams = new URLSearchParams()
      for (const [k, v] of url.searchParams) if (넘길것.has(k)) upstreamParams.append(k, v)
      upstreamParams.set('includeHistory', 'true')
      // 이베이 날짜별 낙찰 히스토리는 includeEbay를 켜야 온다(등급별 그래프의 재료).
      upstreamParams.set('includeEbay', 'true')
      // ⚠️ Pro일 때는 이력이 6개월까지만 왔다. Business는 무제한이라 더 길게 받을 수 있고,
      //    **크레딧은 그대로다**(2026-08-07 실측: 180/60도 1095/365도 카드당 3크레딧).
      //    maxDataPoints는 365까지 공짜다 — 넘으면 카드당 +1이 붙는다.
      upstreamParams.set('days', '1095')
      upstreamParams.set('maxDataPoints', '365')
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
        const dailyLeft = 머리글숫자(upstream.headers, 'x-ratelimit-daily-remaining')
        const daily = upstream.status === 429 && Number.isFinite(dailyLeft) && dailyLeft <= 0
        const stale = stalePrice(cacheKey)
        if (stale) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.end(stale)
          return
        }
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
      rememberPrice(cacheKey, body)
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(body)
    } catch {
      // 통신 자체가 실패해도 지난 시세가 있으면 그걸 준다.
      const stale = stalePrice(cacheKey)
      if (stale) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(stale)
        return
      }
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'upstream_fetch_failed' }))
    }
  })
}

// ── 이베이 한글판(Korean Version) 시세 ────────────────────────────────────
// Browse API로 "카드명 Korean Version" 현재 매물가(호가)를 받는다. 체결가(낙찰가)를 주는
// Marketplace Insights는 이베이 별도 승인이 필요해 지금은 호가. 그래서 화면에 "현재 매물가"로
// 명확히 표기한다(영문판=체결가와 혼동 금지). 키(App/Cert)는 서버에서만, 클라이언트엔 안 내림.
const EBAY_OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'

// 한글판 매물에서 "카드가 아닌 물건"을 제목으로 걸러낸다.
//
// ⚠️ 이미 category_ids=183454(낱장 카드)로 받는데도 새어 나온다 — 파는 사람이 아무
//    분류에나 올리기 때문이다. 실제로 지하철 QR 티켓 세트·보드게임·스티커가 섞여
//    나왔다(운영자 지적 2026-08-06, 106건 중 5건).
// ⚠️ 목록을 넓히면 **진짜 카드가 빠진다** — 그게 더 나쁘다. 그래서 넣기 전에 영문판
//    카드 이름 23,444개에 그 낱말이 실제로 나오는지 세어 보고 정했다. 아래 여덟 개는
//    세어 보고 **뺀** 것들이다(괄호는 걸리던 진짜 카드):
//      sticker(Energy Sticker) · ticket(Reserved Ticket) · towel(Team Yell Towel)
//      doll(Clefairy Doll) · cap(Patrol Cap) · hat(Pikachu with Grey Felt Hat)
//      puzzle(Puzzle of Time) · backpack(Nemona's Backpack)
//    sleeve·coin·bag·pin도 뺐다 — "in sleeve"처럼 진짜 카드의 포장 설명으로 쓰인다.
//    ⚠️ 여기에 낱말을 더할 때는 반드시 위와 같이 카드 이름 전체를 세어 보고 넣을 것.
//    낱말 경계(\b)로 맞춰 capture 안의 cap 같은 오검출을 막는다.
//    복수형(stickers·tickets)은 카드 이름에 안 나오고 굿즈 제목에는 흔해서 남긴다.
//    ⚠️ **festa는 뺐다.** 부산 지하철 티켓("Mega Festa 2026 Busan Subway QR Ticket")을
//       잡으려고 넣었는데, **SV8a 세트 이름이 「테라스탈 페스타(Terastal Festa)」다.**
//       그 세트 카드가 통째로 굿즈로 몰려 사라졌다
//       ("Jolteon ex SV8a Terastal Festa Korean Version" $61 · 2026-08-07 발견).
//       지하철 티켓 쪽은 subway·qr ticket이 이미 잡으므로 잃는 게 없다.
//    ⚠️ **여기에 낱말을 더할 땐 세트 이름과 겹치는지 먼저 볼 것.** 세트 이름은 해마다
//       늘고, 겹치면 그 세트가 통째로 화면에서 사라지는데 아무 표시도 안 난다.
//    plate(Mystery Plate)·pouch(Energy Pouch)도 같은 이유로 뺐다.
// ⚠️ "anniversary"·"limited edition"·"sealed"는 카드 **이름**에는 없지만 진짜 카드
//    **매물 제목**에는 흔하다(예: "Celebrations 25th Anniversary Charizard").
//    대조할 때 카드 이름만 보고 넣으면 이런 걸 놓친다 — 매물 제목까지 생각할 것.
// sticker는 진짜 카드가 딱 하나(Energy Sticker)라, 그것만 빼고 잡는다.
const NOT_A_CARD =
  /(?<!energy )\bsticker\b|\b(stickers|tickets|ticket\s?set|sticker\s?set|board\s?game|plush|plushie|keychain|key\s?chain|mug|poster|blanket|cushion|figure|figurine|t-?shirt|tshirt|hoodie|socks|playmat|playing\s?mat|transportation|transit\s?card|t-?money|binder|deck\s?box|card\s?case|sleeve\s?set|wallet|lanyard|subway|qr\s?ticket|goods|merch)\b/i
// 세트 이름에 흔히 붙는 말. 찾는 이름 뒤에 이게 오면 카드 이름이 아니라 세트 이름이다.
const 세트를뜻하는말 = 'Heroes|Edition|Collection|Box|Set|Deck|Promo|Series|Pack|Starter'
/**
 * 이 매물이 정말 그 카드인가. 찾는 말 뒤에 세트를 뜻하는 말이 붙은 자리는 지우고,
 * 그래도 찾는 말이 남아 있으면 그 카드로 본다.
 *
 * ⚠️ 검색어의 **첫 낱말만** 본다(대개 포켓몬 이름이다). 낱말을 다 따지면
 *    "Charizard VSTAR"처럼 뒤에 등급·번호가 붙은 검색에서 멀쩡한 것도 걸러진다.
 * ⚠️ 영문이 아닌 검색어는 그냥 통과시킨다 — 화면이 이미 영문으로 바꿔 보내지만,
 *    사전에 없어 한글이 그대로 올라오면 여기서 다 걸러 버리면 안 된다.
 */
// 카드 이름 뒤에 붙는 표시(V·VMAX·ex·GX…). "리피아 VMAX"처럼 **이름+표시**가 붙어
// 있으면 그게 그 매물의 카드다.
const 카드표시 = 'v|vmax|vstar|ex|gx|break|prime'
// 포켓몬 영문 이름 1,025개를 통째로 쓴다(세 글자 미만은 다른 낱말에 끼어들어 뺀다).
// 긴 이름부터 맞춰야 "Mew"가 "Mewtwo"를 가로채지 않는다.
const 포켓몬이름표 = (pokemonNames as Array<{ en?: string }>)
  .map((p) => String(p.en ?? '').trim())
  .filter((n) => n.length >= 3)
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const 이름더하기표시 = new RegExp(`\\b(${포켓몬이름표.join('|')})\\s+(?:${카드표시})\\b`, 'ig')
// 카드 번호 바로 앞에 붙은 포켓몬 이름("MACHAMP 018/024"). 사이에 다른 낱말이 끼면 안 잡는다.
const 번호앞이름 = new RegExp(`\\b(${포켓몬이름표.join('|')})\\s*[-–]?\\s*\\d{1,3}\\s*/\\s*\\d{1,3}\\b`, 'i')

const 그카드가맞나 = (title: string, q: string): boolean => {
  const 첫낱말 = (q.trim().split(/\s+/)[0] ?? '').replace(/[^A-Za-z'-]/g, '')
  if (첫낱말.length < 3) return true
  // ⚠️ **찾는 말 자체가 세트 이름이면 거르지 않는다.** "Eevee Heroes"라고 친 사람은
  //    그 세트를 보려는 것이라, 여기서 걸러 버리면 24건이 2건이 된다(2026-08-07 확인).
  if (new RegExp(`^${첫낱말}\\s+(?:${세트를뜻하는말})\\b`, 'i').test(q.trim())) return true
  const 지움 = title.replace(new RegExp(`\\b${첫낱말}\\s+(?:${세트를뜻하는말})\\b`, 'ig'), ' ')
  if (!new RegExp(`\\b${첫낱말}\\b`, 'i').test(지움)) return false
  // ⚠️ **다른 포켓몬 이름이 우리 이름보다 앞에 나오면 그건 그 포켓몬 카드다.**
  //    "Leafeon VMAX Eevee Holo Triple Rare 3/69"가 이브이로 잡혀 최저가 $1.12가
  //    리피아 값이었다(2026-08-07). 이름만 들어 있으면 통과시키던 탓이다.
  //    단, **이름 뒤에 V·ex 같은 표시가 붙은 것만** 그 카드로 본다 —
  //    "Mewtwo & Mew GX"처럼 둘이 같이 나오는 카드는 걸러내면 안 되기 때문이다.
  const 우리위치 = 지움.search(new RegExp(`\\b${첫낱말}\\b`, 'i'))
  for (const m of 지움.matchAll(이름더하기표시)) {
    if (m[1].toLowerCase() === 첫낱말.toLowerCase()) continue
    if ((m.index ?? 0) < 우리위치) return false
  }
  // ⚠️⚠️ **카드 번호 바로 앞에 붙은 포켓몬이 그 매물의 카드다.**
  //    세트 이름이 포켓몬 이름인 경우를 이것으로 가른다(2026-08-08 실측):
  //        "DETECTIVE PIKACHU SMP2 - MACHAMP 018/024 - KOREAN VERSION"
  //    피카츄로 찾으면 이게 걸려서 **최저가 $1.34가 괴력몬 값**이 됐다. 제목에
  //    "PIKACHU"가 있는 건 맞지만 그건 세트 이름이고, 파는 카드는 괴력몬이다.
  //    앞의 검사들은 못 잡는다 — 피카츄 뒤에 세트를 뜻하는 말이 없고("SMP2"),
  //    괴력몬 뒤에도 ex·V 같은 표시가 없기 때문이다.
  //    ⚠️ 이름과 번호 **사이에 다른 말이 끼면 안 본다.** "Charizard EX 006/165"의
  //       번호 앞말은 "EX"라서 걸리지 않는다 — 그건 리자몽 카드가 맞다.
  const 번호앞 = 지움.match(번호앞이름)
  if (번호앞 && 번호앞[1].toLowerCase() !== 첫낱말.toLowerCase()) return false
  return true
}

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
        // ⚠️ 183454(CCG 낱장)에는 **포켓몬만 있는 게 아니다** — 원피스·유희왕도 같은
        //    칸이다. "Starter Deck"으로 찾았더니 원피스 카드가 나왔다(2026-08-07).
        //    포켓몬 이름으로 찾을 때는 이름이 알아서 걸러 주지만, 이름이 아닌 말로
        //    찾으면 남의 게임이 섞인다. 이베이가 게임별로 거를 수 있으니 지정한다.
        // ⚠️ **게임별 거르기(aspect_filter Game:Pokémon TCG)는 안 쓴다.** 넣어 보니
        //    원피스 카드는 사라지는데 **진짜 포켓몬 매물도 1~2건씩 떨어졌다**
        //    (Charizard ex 14→13, Pokemon 151 16→15 · 2026-08-07 실측).
        //    판매자가 "게임" 칸을 안 채운 매물이 빠지는 것이다. 여기 값은 최저가를
        //    뽑는 데 쓰므로 **진짜 매물을 잃는 쪽이 더 나쁘다**. 남의 게임이 섞이는
        //    건 카드 이름으로 찾을 때는 안 생긴다(이름이 알아서 거른다).
        // ⚠️ 24개만 받던 것을 100개로 늘렸다. 싼 것부터 받아 **거른 뒤** 보여주는데,
        //    세트 이름·굿즈를 거르기 시작하면서 남는 게 너무 적어졌다
        //    (이브이 24개를 받아 22개가 걸리고 2건만 남았다 · 2026-08-07).
        //    이베이 Browse는 한 번에 200까지 주고 **요청 수는 그대로 1번**이라 공짜다.
        limit: '100',
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
      // ⚠️ **세트 이름이 포켓몬 이름과 같은 경우를 걸러낸다.** 이베이는 제목 전체에서
      //    글자를 찾으므로 "이브이"로 찾으면 "Eevee Heroes"(세트 이름) 카드가 전부
      //    걸린다 — 마릴·리피아가 나오고, 화면 맨 위 "최저 $1.25"가 **마릴 값**이었다
      //    (2026-08-07 발견). 찾는 이름 뒤에 세트를 뜻하는 말이 붙어 있으면 그건
      //    세트 이름이므로 지우고, 그래도 이름이 남아 있는 것만 그 카드로 본다.
      //    실측: 이브이 24건 → 2건(최저 $1.25 마릴 → $2.75 진짜 이브이 ex).
      //    블래키·리자몽·에브이·피카츄는 최저가가 안 바뀐다(멀쩡한 걸 안 걸러낸다).
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
        .filter((x) => !NOT_A_CARD.test(x.title))
        .filter((x) => 그카드가맞나(x.title, q))
        // ⚠️ **우리가 값 순서로 다시 세운다.** 이베이의 price 정렬은 배송비를 더한
        //    값 기준이라, 화면에는 "최저 $1" 이라 적혀 있는데 목록 첫 줄이 $7.99인
        //    일이 생겼다(2026-08-07). 우리가 보여주는 값은 물건값이므로 그 값으로
        //    세워야 머리글과 목록이 말이 맞는다.
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
      // ⚠️ total도 거른 뒤의 개수로 보낸다. 이베이가 준 total을 그대로 쓰면
      //    "매물 34건"이라 적어 놓고 30건만 보여주게 된다.
      const body = JSON.stringify({ total: items.length, items })
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
const todayKst = kstDateStr
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000)
}

// GP를 주되 상한을 넘겨 쌓지는 않는다.
//
// ⚠️ 그냥 `Math.min(MAX_BALANCE, 잔액 + 보상)`으로 쓰면 안 된다. 잔액이 이미 상한보다
//    많을 때 보상을 주면 오히려 상한까지 깎여, 출석·자랑이 GP를 빼앗는 셈이 된다
//    (2026-08-04에 잔액 355,500인 계정이 자랑하고 55,500을 잃는 걸 확인했다).
//    지금 정상 플레이로는 상한을 못 넘지만, 상한을 낮추거나 예전 백업을 되돌리면
//    그 순간 실제로 사라진다. 주는 함수는 절대 잔액을 줄이지 않아야 한다.
function capAdd(balance: number, reward: number): number {
  return Math.max(balance, Math.min(MAX_BALANCE, balance + reward))
}

// 세트 카드 목록은 정적 파일이라 한 번 읽어 캐시한다. 배포본은 dist/, 개발은 public/에 있다.
// rarityAlias가 있으면 여기서 등급 이름을 표준으로 바꾼다 — 원본 세트 파일은 그대로 두고
// 뽑기·앨범만 통일된 이름을 쓴다(세트 화면 표기는 원본 그대로 유지).
const packCardsCache = new Map<string, PackCard[]>()
async function readPackCards(pack: PackSet): Promise<PackCard[]> {
  const cached = packCardsCache.get(pack.src)
  if (cached) return cached
  const rel = pack.src.replace(/^\//, '')
  const alias = pack.rarityAlias
  for (const base of ['dist', 'public']) {
    try {
      const raw = await readFile(path.resolve(process.cwd(), base, rel), 'utf-8')
      let list = (JSON.parse(raw) as { cards?: PackCard[] }).cards ?? []
      if (alias) list = list.map((c) => (c.r && alias[c.r] ? { ...c, r: alias[c.r] } : c))
      const cards = usableCards(list)
      packCardsCache.set(pack.src, cards)
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

type PackPriceEntry = {
  at: number
  prices: Record<string, number>
  names?: Record<string, string>
  partial?: boolean
  // 마지막으로 "받아 보려고 시도한" 시각. 성공했든 실패했든 남긴다.
  triedAt?: number
}
const packPriceCache = new Map<string, PackPriceEntry>()
// ⚠️ 표는 **따로 파일로** 둔다. packPriceCache에 넣으면 세트 목록을 훑는 곳
//    (통계·세트 고르기)이 이걸 세트로 세어 버린다.
const MIX_FIX_MARK_FILE = dataFile('mix-fix-done-2.json')
// ⚠️ 대조표(pptSetNames)가 **뒤바뀌어 있던** 세트. 이 둘은 서로의 카드 시세를 받아
//    갖고 있었다(2026-08-08, scripts/check-set-mapping.mts로 찾음):
//        ja-SVLN 님피아 스타터 → "SV: Ceruledge ex …"(창염마 덱)
//        ja-SVLS 창염마 스타터 → "SV: Sylveon ex …"(님피아 덱)
//    표는 고쳤고, 저장돼 있던 값은 한 번 비워 다시 받는다.
const 대조표고친세트 = ['ja-SVLN', 'ja-SVLS']
const PACK_PRICE_TTL_MS = 24 * 60 * 60 * 1000
// 캐시를 그대로 써도 되는지. partial(뒤 페이지를 못 받음)이거나 names(영문 카드명)가
// 없으면 다시 받는다 — names는 나중에 추가한 항목이라, 이전에 저장된 캐시에는 없다.
// 그대로 두면 24시간마다 갱신돼도 영원히 안 채워져 일본판 "시세 보기"가 계속 빗나간다.
const packPriceFresh = (hit: PackPriceEntry) =>
  !hit.partial && !!hit.names && Date.now() - hit.at < PACK_PRICE_TTL_MS

// ── 하루 한 번, 시세를 통째로 받아 창고를 채운다 (2026-08-07 Business) ──────
//
// 왜: 예전엔 세트를 하나씩 불러 채웠다. 세트당 200~600크레딧이라 371개를 다 채우려면
// 7만~22만이 들고, 하루 예산 안에서 조금씩 나눠 며칠에 걸쳐야 했다. Business에는
// /export가 있어 **전체 카드 시세를 한 파일로** 준다 — 1.5MB(gzip), 58,000장,
// 영문·일본판 양쪽. 한 번 받으면 우리 세트 371개 중 331개가 그 자리에서 찬다.
//
// ⚠️ 하루 2회 제한이 있다. 그래서 하루 한 번만 부르고, 실패해도 예전 방식이 그대로 돈다.
// ⚠️ 값 고르는 규칙은 세트별로 받을 때와 **똑같이** 맞춘다(기본판 우선, 변형판은 별도 키).
//    다르면 같은 카드가 받는 길에 따라 다른 값을 갖게 된다.
const CSV_EXPORT_URL = `${PRICE_TRACKER_ORIGIN}/export`

// 통째 받기는 **하루 2회가 전부**다(종류를 나눠 세지 않는다 — 2026-08-07 확인:
// type=ebay·population 모두 같은 x-export-downloads-remaining을 보고 429가 났다).
// 그래서 종류마다 "얼마나 자주 받아야 하는지"를 정해 두고 급한 것부터 쓴다.
//   cards      매일  — 시세는 매일 바뀐다. 이걸로 세트 331개가 한 번에 찬다
//   population 이틀  — 감정 수량
//   ebay       이틀  — 등급별 낙찰
//
// ⚠️ **2칸을 꽉 채우려고 이틀로 맞췄다**(2026-08-08. 그전엔 3일·4일이라 일주일 14칸 중
//    11칸만 쓰고 3칸이 놀았다). 1칸째는 매일 시세가 가져가므로 2칸째가 주당 7칸인데,
//    이틀 간격 둘이면 3.5+3.5 = 딱 7이다. 하루씩 번갈아 가는 셈이다.
//    받는 것 자체는 **크레딧이 0**이고, 덤프에 없는 카드는 열 때마다 2크레딧씩 나가므로
//    칸을 놀리는 게 손해다. 더 자주 받을 이유는 없다 — 감정도 낙찰도 하루 이틀엔
//    거의 안 바뀐다. **딱 채우는 것이 목표지 더 조이는 게 목표가 아니다.**
//
// 앞으로 넣을 것(2026-08-07 확정, 아직 읽어 들이는 코드가 없다):
//   printings  매일  — **cards의 열을 전부 담고** 상태별(민트·플레이드…) 시세가 더 붙는다.
//                      바꾸면 cards 자리가 통째로 뜬다. 다만 **한 카드가 인쇄별로 여러 줄**이라
//                      지금 파서가 그대로면 값이 섞인다(같은 이름 두 줄을 다 기본판으로 보고
//                      싼 쪽을 고른다). 실물 한 번 받아 보고 바꿀 것.
//   sealed     이레  — 미개봉 팩·박스. 일본판도 있다(확인함).
//
// 시세가 매일 한 칸을 쓰고 **한 칸이 남는다**. 남는 칸을 팝수와 등급별 낙찰이
// 번갈아 쓴다. 통째로 받으면 크레딧이 0이라, 그 칸을 놀리고 카드마다 2크레딧씩
// 쓰는 건 손해다(2026-08-07 사장님 지적으로 되돌림).
const EXPORT_EVERY_DAYS: Record<string, number> = { cards: 1, population: 2, ebay: 2 }
const EXPORT_DAILY_MAX = 2

/** 그 종류를 오늘 받아야 하는가(마지막에 받은 날로부터 정해 둔 날수가 지났는가). */
function exportDue(종류: string): boolean {
  const 마지막 = exportDoneDay[종류]
  if (!마지막) return true
  const 지난날 = Math.floor((Date.parse(utcDay() + 'T00:00:00Z') - Date.parse(마지막 + 'T00:00:00Z')) / 86_400_000)
  return 지난날 >= (EXPORT_EVERY_DAYS[종류] ?? 1)
}

/**
 * 통째 받기 한 종류를 내려받아 본문을 돌려준다. 실패하면 null.
 *
 * ⚠️ 성공이든 실패든 **오늘 받은 것으로 적는다.** 429를 되풀이하면 키가 정지된다.
 * ⚠️ 429는 notePpt에 넘기지 않는다 — 이건 통째 받기 전용 한도라 Retry-After가
 *    하루치로 오고, 그걸 전체 크레딧 소진으로 읽으면 크레딧이 15만 남았는데도
 *    방문자 시세가 통째로 막힌다(2026-08-07에 실제로 그랬다).
 */
// 통째 받기 파일의 크기 한계(압축을 푼 뒤 기준). 이걸 넘으면 그날은 건너뛴다.
// 40MB짜리 CSV면 문자열 80MB + Map + JSON까지 한때 150MB 넘게 쓴다 — 여유 220MB에서
// 위험하다. 실제 덤프가 얼마나 큰지는 아직 못 봤다(첫 수신 2026-08-08 오전 9시 예정).
// 로그에 실제 크기가 찍히므로, 확인한 뒤 이 값을 조정할 것.
const EXPORT_MAX_BYTES = 40 * 1024 * 1024

async function fetchExport(apiKey: string, 종류: string): Promise<string | null> {
  const today = utcDay()
  try {
    const r = await fetch(`${CSV_EXPORT_URL}?type=${encodeURIComponent(종류)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5 * 60_000),
    })
    if (r.status !== 429) notePpt(r.status, r.headers)
    const 남음 = r.headers.get('x-export-downloads-remaining')
    if (!r.ok) {
      console.log(
        `[pokegre] 통째 받기(${종류}) 실패: ${r.status}` +
          (r.status === 429 ? ' (오늘 몫을 다 썼습니다 — 내일 오전 9시에 다시)' : ''),
      )
      exportDoneDay[종류] = today
      void savePptState()
      return null
    }
    // ⚠️ **몸통을 읽기 전에 길이부터 본다.** 아래 검사들은 이미 메모리에 올린 뒤라
    //    정작 위험한 순간(올리는 중)을 못 막는다. 머리글에 길이가 있으면 여기서 끊는다.
    const 알린길이 = 머리글숫자(r.headers, 'content-length')
    if (Number.isFinite(알린길이) && 알린길이 > EXPORT_MAX_BYTES) {
      console.log(
        `[pokegre] 통째 받기(${종류})가 너무 큽니다(받기 전 확인): ` +
          `${(알린길이 / 1024 / 1024).toFixed(1)}MB > 한계 ${(EXPORT_MAX_BYTES / 1024 / 1024).toFixed(0)}MB — 건너뜁니다.`,
      )
      exportDoneDay[종류] = today
      void savePptState()
      return null
    }
    const buf = Buffer.from(await r.arrayBuffer())
    exportDoneDay[종류] = today
    void savePptState()
    // ⚠️ **크기를 먼저 본다.** 여기서 CSV를 통째로 문자열로 만드는데, 자바스크립트
    //    문자열은 글자당 2바이트라 20MB 파일이 메모리에서 40MB가 된다. 게다가 그걸로
    //    Map을 만들고 다시 JSON 문자열로 저장하므로 **한때 세 벌이 같이 떠 있다.**
    //    기계는 512MB이고 실측 여유가 220MB뿐이다(2026-08-07). 너무 크면 받아 놓고
    //    쓰지 않는다 — 사이트가 죽는 것보다 그 날 갱신을 거르는 게 낫다.
    // gzip 파일인지는 **앞 두 바이트(1f 8b)**로 안다. 예전엔 그냥 풀어 보고 실패하면
    // 원본으로 썼는데, 그러면 "너무 커서 못 푼 것"과 "원래 압축이 아닌 것"이 구분되지
    // 않는다 — 너무 큰 파일을 압축 아닌 것으로 착각해 그대로 파싱하게 된다.
    const gzip인가 = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
    let 푼것: Buffer
    if (gzip인가) {
      try {
        // ⚠️ maxOutputLength가 없으면 **푸는 도중에** 메모리를 다 쓴다. 여기서 끊어야
        //    한다 — 아래 길이 검사는 이미 다 풀고 난 뒤라 늦다.
        푼것 = gunzipSync(buf, { maxOutputLength: EXPORT_MAX_BYTES })
      } catch (e) {
        console.log(
          `[pokegre] 통째 받기(${종류})를 풀지 못했습니다(한계 ` +
            `${(EXPORT_MAX_BYTES / 1024 / 1024).toFixed(0)}MB를 넘었거나 깨진 파일): ${String(e).slice(0, 60)}`,
        )
        return null
      }
    } else {
      푼것 = buf
    }
    if (푼것.length > EXPORT_MAX_BYTES) {
      console.log(
        `[pokegre] 통째 받기(${종류})가 너무 큽니다: ${(푼것.length / 1024 / 1024).toFixed(1)}MB ` +
          `> 한계 ${(EXPORT_MAX_BYTES / 1024 / 1024).toFixed(0)}MB — 이번엔 건너뜁니다. ` +
          `한계를 올리려면 기계 메모리를 먼저 키울 것.`,
      )
      return null
    }
    const text: string = 푼것.toString('utf8')
    // ⚠️ **받은 크기와 푼 크기를 둘 다 적는다.** 한계를 얼마로 잡아야 하는지는 이
    //    줄로만 알 수 있다(실제 덤프를 아직 아무도 못 봤다). 줄 수도 같이 적는다.
    console.log(
      `[pokegre] 통째 받기(${종류}) 성공: 받은 것 ${(buf.length / 1024 / 1024).toFixed(1)}MB` +
        (gzip인가 ? ` → 푼 것 ${(푼것.length / 1024 / 1024).toFixed(1)}MB` : ' (압축 아님)') +
        ` · 약 ${text.split('\n').length.toLocaleString()}줄` +
        (남음 != null ? ` · 오늘 남은 몫 ${남음}회` : ''),
    )
    return text
  } catch (e) {
    console.log(`[pokegre] 통째 받기(${종류}) 실패: ${String(e).slice(0, 80)}`)
    return null
  }
}

/** CSV 한 줄을 따옴표까지 지켜 자른다. 카드 이름에 쉼표가 들어 있다("Team Rocket's Mewtwo, ex"). */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

// ── 덤프에서 "이름 + 레어도"도 같이 뽑는다 (자동완성 재료) ────────────────────
//
// 왜 서버가 하나: 사람들은 카드 이름을 정확히 모르는 채 **레어도로 좁혀서** 찾는다
// (인기 검색어에 "제크로무 ex SR"이 20회 올라 있다). 그 재료는 덤프에만 있는데,
// 예전엔 그걸 얻으려고 **손으로 통째 받기를 한 번 더 썼다.** 하루 2회뿐인 몫을 서버가
// 이미 아침에 하나 쓴 줄 모르고 또 받아 429를 냈다(2026-08-08 사장님 지적).
// 서버가 어차피 매일 받으므로 받는 김에 여기서 같이 뽑는다 — **몫도 크레딧도 0이 더 든다.**
//
// ⚠️ 빌드 시점 목록(src/data/cardNamesKo.json)은 만든 날에 멈춰 있다. 새 세트가 새
//    레어도를 들고 나와도 안 따라온다. 이 파일이 그 자리를 매일 메운다.
const RARITY_TERMS_FILE = dataFile('rarity-terms.json')
let 레어도낱말: string[] = []
// ⚠️ **미리 눌러 둔 몸통.** 이 목록은 325KB나 되고 검색창을 처음 누르는 사람마다 나간다.
//    요청마다 압축하면 512MB짜리 기계가 그 일을 되풀이한다 — 하루 한 번만 바뀌는 값이니
//    만들 때 한 번 눌러 두고 그대로 내보낸다. brotli는 gzip보다 30% 더 준다
//    (2026-08-08 실측: 325KB → gzip 96KB → brotli 66KB).
// 지난번에 "확 줄어서" 안 덮은 적이 있는가. 이틀 연속이면 그때는 받아들인다.
// ⚠️ 이건 메모리에만 둔다 — 배포하면 다시 false가 되어 한 번 더 막는다. 그래도 괜찮다:
//    막는 쪽이 안전한 방향이고, 막을 때마다 로그가 크게 남아 사람이 알아챌 수 있다.
//    (크레딧처럼 "새면 손해"인 값이 아니라 파일에 적을 이유가 없다.)
let 낱말줄어든적 = false
let 레어도낱말JSON = JSON.stringify({ terms: [] as string[] })
let 레어도낱말BR: Buffer | null = null
function 레어도낱말굳히기() {
  레어도낱말JSON = JSON.stringify({ terms: 레어도낱말 })
  try {
    레어도낱말BR = brotliCompressSync(Buffer.from(레어도낱말JSON), {
      // 기본값(11)은 이만한 글에 몇 초씩 걸린다. 5면 거의 같은 크기에 한참 빠르다.
      params: { [zlibConst.BROTLI_PARAM_QUALITY]: 5 },
    })
  } catch {
    레어도낱말BR = null // 못 눌러도 아래에서 그냥 글자로 내보낸다
  }
}

// 저쪽(PPT) 표기 → 사람들이 실제로 치는 짧은 코드.
// ⚠️ **표는 src/lib/rarityCode.ts 한 곳에만 둔다.** 여기에 베껴 두었더니 검색기 쪽과
//    어긋나서, 자동완성이 권한 말을 눌러도 0장이 나왔다(2026-08-08). 그 파일을 볼 것.
const RARITY_CODE = PPT레어도별코드

// ⚠️ 짧은 이름은 다른 이름 속에 끼어든다("뮤"가 "뮤츠"에, "삐"가 "삐삐"에).
//    그렇다고 두 글자를 통째로 빼면 **뮤츠·팬텀·후딘·핫삼·럭키·윈디가 통째로 빠진다.**
//    그래서 길이가 아니라 **끼어드는지**로 가른다 — 다른 포켓몬 이름 속에 안 들어가는
//    두 글자 이름 70개는 넣는다. 실제로 재 보니 200가지가 늘고 깨진 것은 0가지였다
//    (2026-08-08, 덤프 58,235줄 대조).
// ⚠️ scripts/gen-rarity-from-dump.mts와 **같은 규칙이어야 한다.**
const 포켓몬한글 = (pokemonNames as { ko: string }[]).map((p) => p.ko).filter(Boolean)
const 레어도포켓몬 = new Set(
  포켓몬한글.filter((n) => n.length >= 3 || !포켓몬한글.some((m) => m !== n && m.includes(n))),
)
const 레어도포켓몬최대 = Math.max(1, ...[...레어도포켓몬].map((n) => n.length))
const 레어도포켓몬최소 = Math.min(...[...레어도포켓몬].map((n) => n.length))

/**
 * 카드 이름 안에 든 **가장 긴** 포켓몬 이름. 없으면 null.
 *
 * ⚠️ **정확히 같은 이름만 보면 안 된다.** MUR 카드는 "메가리자몽 X ex"이지 "리자몽"이
 *    아니라서, 그렇게 하면 MUR이 하나도 안 붙는다. 검색은 이름이 들어 있기만 하면
 *    찾으므로("리자몽 MUR" → 메가리자몽 X ex 1장) 포함으로 잡는 게 맞다.
 * ⚠️ 이름 1,000개를 한 줄씩 훑으면 느리다(덤프 13,295줄 × 1,000). 대신 **카드 이름을
 *    긴 조각부터 잘라 사전에 있는지 본다** — 처음 걸리는 게 곧 가장 긴 것이다.
 *    길이가 같으면 **먼저 나온 쪽**을 쓴다("토게피&푸푸린&마릴 GX" → 토게피).
 *
 * ⚠️ **가짜가 조금 섞이는 건 감수한다.** 굿즈 이름 속의 영어 낱말이 포켓몬 한글 이름과
 *    우연히 겹치면 없는 짝이 생긴다 — "G Booster"가 "G 부스터"가 되면서 **부스터**
 *    (파이어리)가 걸려 "부스터 ACE"가 만들어졌고, 눌러 보면 0장이다.
 *    2026-08-08에 낱말 17,684가지를 훑어 **딱 2가지**였다(부스터 ACE·아고용 ACE).
 *    막으려고 좁히면 **되던 것이 같이 죽는다** — 같은 방식 덕분에 "로토무 TR"이
 *    로토무도감(Rotom Dex)을, "리자몽 MUR"이 메가리자몽 X ex를 찾아 준다.
 *    0.01%를 잡자고 그걸 버릴 이유가 없다.
 */
function 속포켓몬(ko: string): string | null {
  const 끝 = Math.min(ko.length, 레어도포켓몬최대)
  for (let len = 끝; len >= 레어도포켓몬최소; len--) {
    for (let i = 0; i + len <= ko.length; i++) {
      const 조각 = ko.slice(i, i + len)
      if (레어도포켓몬.has(조각)) return 조각
    }
  }
  return null
}

/**
 * 카드 이름 뒤에 붙은 **꼬리표를 뗀다.**
 *   "리자몽 ex (Special Illustration Rare)" → "리자몽 ex"
 *   "뮤츠 EX - XY125"                       → "뮤츠 EX"
 *   "팬텀 - SWSH241 (Prerelease)"           → "팬텀"
 *   "피카츄 - 227/S-P"                      → "피카츄"
 * 자동완성에 이런 꼬리표째 뜨면 사람이 고를 수 없는 말이 된다.
 *
 * ⚠️ 꼬리표 모양이 제각각이라 **" - " 뒤는 통째로 자른다.** 번호만 노리는 규칙으로는
 *    "227/S-P" 같은 것이 남았다(2026-08-08 실측). 카드 이름 자체에 " - "가 들어가는
 *    경우는 없다.
 */
const 꼬리표떼기 = (s: string) =>
  s
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .split(' - ')[0]
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim()

/** 자동완성 목록에 넣어도 되는 이름인가. */
const 쓸만한이름 = (s: string) =>
  s.length >= 2 && s.length <= 40 && !/[([{|]/.test(s) && !/[-–—:,]$/.test(s)

async function loadRarityTerms(): Promise<void> {
  try {
    const 것 = JSON.parse(await readFile(RARITY_TERMS_FILE, 'utf-8'))
    if (Array.isArray(것)) {
      레어도낱말 = 것.filter((t): t is string => typeof t === 'string')
      레어도낱말굳히기()
      if (레어도낱말.length) console.log(`[pokegre] 자동완성 낱말 ${레어도낱말.length.toLocaleString()}가지를 이어받았습니다.`)
    }
  } catch {
    레어도낱말 = []
  }
}

/**
 * 덤프 줄에서 "이름 + 레어도"를 모아 /data에 적는다.
 *
 * ⚠️ **중간에 서버를 놓아준다.** 다 합쳐 0.5초쯤 걸리는데(내 컴퓨터 기준, 서버는 더
 *    느리다) 그동안 통째로 멈추면 마침 들어온 방문자가 그만큼 기다린다. 2,000줄마다
 *    한 번씩 다른 일에 차례를 넘긴다.
 */
async function 레어도뽑기(모은것: Map<string, Set<string>>): Promise<void> {
  // ① 포켓몬 이름 + 레어도 — "리자몽 MUR"
  const 짝 = new Map<string, Set<string>>()
  // ② **카드 이름 통째 + 레어도** — "제크로무 ex SR"
  //    ⚠️ ①만으로는 뚫린다. "제크로무"를 치면 8줄이 나오는데 **"제크로무 ex"를 치면
  //       0줄이었다** — 레어도가 포켓몬 이름에만 붙어 있어서다. 정작 방문자가 제일 많이
  //       친 것 중 하나가 "제크로무 ex SR"이다(20회, 2026-08-08 검색 기록).
  const 카드짝 = new Map<string, Set<string>>()
  // ③ **카드 이름 그 자체** — 우리 세트 자료에 없는 카드를 메운다.
  //    ⚠️ 우리 세트 자료(TCGdex)에 아예 없는 카드가 꽤 있다. 덤프에는 있는데 우리
  //       사전에 없는 이름이 한글 3,593개·영문 2,098개였다(2026-08-08 실측).
  const 이름들 = new Set<string>()
  let 셋 = 0
  for (const [열쇠, codes] of 모은것) {
    // ⚠️ 중간에 서버를 놓아준다. 5만 줄을 통째로 돌면 그동안 방문자가 기다린다.
    if (++셋 % 2000 === 0) await new Promise((r) => setImmediate(r))
    const 칸 = 열쇠.indexOf('|')
    const ed = 열쇠.slice(0, 칸) as 'ja' | 'en'
    const raw = 열쇠.slice(칸 + 1)
    const ko = 꼬리표떼기(koName(ed, raw))
    const 한글인가 = /[가-힣]/.test(ko)
    if (한글인가 && 쓸만한이름(ko)) 이름들.add(ko)
    // 영문판은 원래 이름도 담는다 — 영문으로 치는 사람이 있다(인기 검색어 2~5위가 영문).
    // ⚠️ **일본판 줄의 영어 이름은 일부러 안 담는다.** 덤프는 일본판 카드에도 영어 이름을
    //    달아 준다(저쪽이 영문으로 색인하기 때문이다). 처음엔 "우리에 없는 게 11,981가지나
    //    된다"고 보여 담을 뻔했는데, 그 숫자는 **꼬리표 때문에 부풀려진 것**이었다
    //    ("Mario Pikachu - 294/XY-P"). 꼬리표를 떼고 세면 4,676가지이고 우리에 없는 건
    //    **779가지**뿐이다. 게다가 방문자가 친 영문 검색 중 아직 빈 목록인 것들
    //    (gym promo · XY Promos · mei · yukari …)을 대 봤더니 **하나도 안 메워졌다**
    //    (2026-08-08 실측). 목록만 40KB 무거워지고 얻는 게 없다.
    if (ed === 'en') {
      const en = 꼬리표떼기(raw)
      if (/[A-Za-z]/.test(en) && 쓸만한이름(en)) 이름들.add(en)
    }
    if (!codes.size) continue
    const 기본 = 한글인가 ? 속포켓몬(ko) : null
    if (기본) {
      let s = 짝.get(기본)
      if (!s) 짝.set(기본, (s = new Set()))
      for (const c of codes) s.add(c)
    }
    // 포켓몬 이름 그 자체인 카드는 ①과 겹치므로 넣지 않는다.
    if (한글인가 && 쓸만한이름(ko) && ko !== 기본) {
      let s = 카드짝.get(ko)
      if (!s) 카드짝.set(ko, (s = new Set()))
      for (const c of codes) s.add(c)
    }
  }
  const 펴기 = (m: Map<string, Set<string>>) =>
    [...m.entries()].flatMap(([이름, codes]) => [...codes].map((c) => `${이름} ${c}`))
  // ⚠️ **이름을 먼저, 레어도를 뒤에.** 사람이 먼저 찾는 건 카드 이름이다.
  const 낱말 = [...new Set([...이름들, ...펴기(짝), ...펴기(카드짝)])]
    // 각 무리 안에서는 짧은 것부터 — 앞에서 잘라 8개만 보여주므로 순서가 곧 목록이다.
    .sort((a, b) => a.length - b.length || a.localeCompare(b, 'ko'))
  // ⚠️ 빈 결과로 덮지 않는다. 열 이름이 바뀌거나 덤프가 반토막이면 어제 것이 낫다.
  if (!낱말.length) {
    console.log('[pokegre] 자동완성 낱말을 하나도 못 뽑았습니다 — 어제 것을 그대로 둡니다.')
    return
  }
  // ⚠️ **확 줄어도 덮지 않는다.** 위 검사는 "통째로 빈 것"만 막는다. 덤프가 **반쪽만**
  //    망가지면(예: rarity 열 이름이 바뀌면 레어도 짝 8,500가지가 통째로 빠진다)
  //    17,684 → 9,088로 조용히 줄어든 채 덮어써진다. 아무도 모른다.
  //    → 3분의 1 넘게 줄면 하루는 어제 것을 지킨다. 크게 적어 두어 눈에 띄게 한다.
  // ⚠️ 다만 **영영 막으면 안 된다.** 저쪽이 진짜로 자료를 줄였을 수도 있다.
  //    이틀 연속으로 작게 오면 그때는 받아들인다(그 사이 로그를 보고 판단하면 된다).
  if (레어도낱말.length && 낱말.length < 레어도낱말.length * 0.66 && !낱말줄어든적) {
    낱말줄어든적 = true
    console.log(
      `[pokegre] ⚠️ 자동완성 낱말이 확 줄었습니다: ${레어도낱말.length.toLocaleString()} → ` +
        `${낱말.length.toLocaleString()}. 덤프가 반쪽만 왔을 수 있어 **오늘은 어제 것을 지킵니다.** ` +
        `내일도 이만큼이면 그때 받아들입니다.`,
    )
    return
  }
  낱말줄어든적 = false
  레어도낱말 = 낱말
  레어도낱말굳히기()
  // ⚠️ **적다가 실패해도 여기서 멈추면 안 된다.** 이건 곁다리(자동완성)이고, 이 함수를
  //    부른 쪽은 본체(시세 331개 세트)를 넣는 중이다. 디스크가 꽉 차면 writeJsonFile이
  //    예외를 던지는데, 그게 밖으로 나가면 **그날 시세가 통째로 안 들어간다.**
  //    게다가 부르는 자리가 `void runDailyExports(...)`라 아무도 안 받고,
  //    Node는 안 받은 예외에 프로세스를 내린다 — 즉 **서버가 죽는다.**
  //    메모리에는 이미 새 낱말이 들어갔으니, 못 적었으면 다음 기동 때 어제 것으로
  //    돌아갈 뿐이다(하루 뒤 다시 만든다).
  try {
    await writeJsonFile(RARITY_TERMS_FILE, 낱말)
  } catch (e) {
    console.log(`[pokegre] 자동완성 낱말을 파일에 못 적었습니다(메모리에는 들어갔습니다): ${String(e).slice(0, 80)}`)
  }
  console.log(
    `[pokegre] 자동완성 낱말 ${낱말.length.toLocaleString()}가지를 적었습니다` +
      ` (카드 이름 ${이름들.size.toLocaleString()} · 포켓몬+레어도 ${짝.size.toLocaleString()}종` +
      ` · 카드+레어도 ${카드짝.size.toLocaleString()}가지).`,
  )
}

async function loadPricesFromCsv(apiKey: string): Promise<number> {
  if (!apiKey) return 0
  if (!exportDue('cards')) return 0
  const gate = pptGate()
  if (!gate.ok) return 0
  const text = await fetchExport(apiKey, 'cards')
  if (text == null) return 0

  const lines = text.split('\n')
  const head = splitCsvLine(lines[0] ?? '')
  const I = Object.fromEntries(head.map((k, i) => [k.trim(), i])) as Record<string, number>
  if (I.setName === undefined || I.cardNumber === undefined || I.marketPrice === undefined) {
    console.log('[pokegre] 시세 통째 받기: 열 이름이 예상과 다릅니다')
    return 0
  }

  // PPT 세트 이름 → 우리 slug. 대응표를 뒤집어 쓴다(이미 331개를 전수 검증해 뒀다).
  // ⚠️ **한 이름에 우리 슬러그가 둘일 수 있다.** 저쪽이 별책을 본편에 합쳐 두기 때문이다 —
  //    "EX Unseen Forces"에 본편(en-ex10)과 언노운 모음집(en-exu)이 같이 들어 있다.
  //    예전엔 앞의 것만 채워서 en-exu가 **영원히 빈 세트**로 남았고, 그 탓에 세트별로
  //    받는 일이 매일 헛돌았다(2026-08-08). 번호가 안 겹치니(본편 1~117, 모음집 !·?·A~Z)
  //    양쪽에 같은 값을 넣어도 서로 섞이지 않는다 — 쓸 데 없는 열쇠는 그냥 안 읽힌다.
  const slug별: Map<string, string[]> = new Map()
  for (const [slug, ppt] of Object.entries(pptSetNames as Record<string, string>)) {
    const 것 = slug별.get(ppt)
    if (것) 것.push(slug)
    else slug별.set(ppt, [slug])
  }
  // ⚠️⚠️ **저쪽이 떼어 놓은 "속 세트"도 부모 세트에 넣어 준다.**
  //    en-g1 제너레이션즈 117장 = 본편 85장 + RC1~RC32(래디언트 컬렉션)인데,
  //    저쪽은 RC를 "Generations: Radiant Collection"이라는 딴 이름으로 둔다.
  //    우리한테 그 이름의 슬러그가 **따로 없으면** 그건 부모 세트의 일부다 —
  //    안 넣으면 그 세트에서 제일 비싼 카드가 통째로 값이 빈다
  //    (RC5 리자몽·RC25 뮤EX가 그랬다. 2026-08-08 실측 57장).
  //    ⚠️ 슬러그가 **있는** 이름은 안 넣는다("Base Set 2"는 엄연히 딴 세트다).
  const 속세트: Map<string, string[]> = new Map()
  {
    const 아는이름 = new Set(Object.values(pptSetNames as Record<string, string>))
    for (const 저쪽이름 of new Set(pptSetList as string[])) {
      if (아는이름.has(저쪽이름)) continue
      // ⚠️⚠️ **"부모 이름 + 콜론"만 속 세트로 본다.** 처음엔 "부모 이름을 품기만 하면"
      //    으로 했다가 16개가 걸렸는데 **3개만 진짜였다**(2026-08-08). 나머지는 엄연히
      //    딴 세트라, 그대로 뒀으면 아까 고친 섞임이 이 길로 되돌아올 뻔했다:
      //        "ADV Expansion Pack"(2003) → ja-PMCG1 확장팩 제1탄(1996)
      //        "sm1+: Enhanced Expansion Pack Sun & Moon" → 같은 곳
      //        "Pt4: Advent of Arceus"·"Arceus LV.X Deck: …" → en-pl4
      //    콜론 형태만 남기면 딱 둘이다 — 래디언트 컬렉션 두 개, 그게 원래 찾던 것이다.
      //    괄호 형태("Base Set (Shadowless)")도 안 받는다 — 인쇄가 달라 값이 딴판이다.
      for (const [부모이름, slugs] of slug별) {
        if (!저쪽이름.startsWith(부모이름 + ':')) continue
        속세트.set(저쪽이름, [...(속세트.get(저쪽이름) ?? []), ...slugs])
      }
    }
    if (속세트.size) {
      console.log(`[pokegre] 저쪽이 떼어 놓은 속 세트 ${속세트.size}개를 부모 세트에 같이 넣습니다.`)
    }
  }

  // 세트별로 모은다. 값 고르는 규칙은 세트별 받기와 같다.
  const 모음 = new Map<string, { prices: Record<string, number>; names: Record<string, string>; base: Set<string> }>()
  // 자동완성용 "이름 + 레어도" 재료. **줄을 자르는 김에 같이 줍는다** — 이것 때문에 덤프를
  // 한 번 더 받으면 하루 2회뿐인 몫이 날아간다(2026-08-08).
  // ⚠️ 아래 `if (!slug) continue`보다 **먼저** 주워야 한다. 우리가 이름을 모르는 세트의
  //    카드도 레어도 재료로는 쓸모가 있다(검색은 세트와 상관없이 이름으로 찾는다).
  // ⚠️ 자른 줄(rows) 전체를 들고 있으면 안 된다 — 58,235줄 × 20칸이라 기계(여유 220MB)에
  //    부담이다. 레어도가 있는 13,295줄에서 **필요한 세 칸만** 남긴다.
  // 자동완성 재료. 열쇠는 "판|원래이름", 값은 그 이름이 가진 레어도 코드들.
  // ⚠️ **줄을 자르는 김에 같이 줍는다** — 이것 때문에 덤프를 한 번 더 받으면 하루
  //    2칸뿐인 몫이 날아간다(2026-08-08).
  // ⚠️ 자른 줄(rows)을 통째로 들고 있으면 안 된다(58,235줄 × 20칸, 여유 220MB).
  //    이름만 **겹치는 것을 즉시 합쳐** 담는다.
  const 자동완성재료 = new Map<string, Set<string>>()
  // 덤프에 실제로 나온 세트 이름. 아래에서 "저쪽에 값이 없는 세트"를 가려내는 데 쓴다.
  const 본이름 = new Set<string>()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const c = splitCsvLine(line)
    const 원래이름 = String(c[I.name] ?? '')
    if (원래이름) {
      const 판 = String(c[I.language] ?? '').trim() === 'japanese' ? 'ja' : 'en'
      const 열쇠 = `${판}|${원래이름}`
      let codes = 자동완성재료.get(열쇠)
      if (!codes) 자동완성재료.set(열쇠, (codes = new Set()))
      const code = I.rarity === undefined ? null : RARITY_CODE.get(String(c[I.rarity] ?? '').trim())
      if (code) codes.add(code)
    }
    const slugs = slug별.get(c[I.setName]) ?? 속세트.get(c[I.setName])
    if (!slugs) continue
    // 속 세트 줄은 **부모가 안 채운 번호에만** 쓴다(번호가 겹치면 부모가 이긴다).
    const 속인가 = !slug별.has(c[I.setName])
    본이름.add(c[I.setName])
    const market = Number(c[I.marketPrice])
    if (!(market > 0)) continue
    const nm = String(c[I.name] ?? '')
    for (const slug of slugs) {
      // ⚠️ 세트에 따라 저쪽이 **다른 번호 체계**를 쓴다. 셀레브레이션즈 클래식 컬렉션은
      //    우리가 CC001~CC025로 두는데 저쪽은 원본 카드 번호(4/102)를 쓴다. 그대로 두면
      //    그 25장은 시세가 통째로 안 붙는다(2026-08-07 덤프 대조로 확인).
      const 되돌림 = 번호되돌리기(slug, String(c[I.cardNumber] ?? ''), String(c[I.name] ?? ''))
      const num = stripZeros(되돌림.split('/')[0].trim())
      if (!num) continue
      const 것 = 모음.get(slug) ?? { prices: {}, names: {}, base: new Set<string>() }
      if (속인가 && 것.prices[num] !== undefined) continue
      const isBase = !nm.includes('(')
      if (nm && (isBase || !것.names[num])) 것.names[num] = nm.replace(/\s*-\s*\d+\/\d+\s*$/, '').trim()
      if (isBase) {
        것.prices[num] = 것.base.has(num) ? Math.min(것.prices[num], market) : market
        것.base.add(num)
      } else {
        const vk = nm.includes('Master Ball') ? '~m' : nm.includes('Poke Ball') ? '~p' : nm.includes('Reverse') ? '~r' : null
        if (vk) 것.prices[num + vk] = Math.min(것.prices[num + vk] ?? Infinity, market)
        else if (!것.base.has(num)) 것.prices[num] = Math.min(것.prices[num] ?? Infinity, market)
      }
      모음.set(slug, 것)
    }
  }

  // 시세를 넣기 전에 레어도부터 적는다. 뒤에 두면 시세 저장에서 실패했을 때 같이 날아간다.
  await 레어도뽑기(자동완성재료)

  // ⚠️ **저쪽에 값이 없는 세트를 표시해 둔다.** 덤프에 세트 이름은 나왔는데 값이 하나도
  //    안 붙은 것들이다(ja-SM1+ 썬&문은 덤프에 줄 1개, 값 0). 이걸 안 적어 두면 세트별
  //    받기가 **6시간마다 영원히 다시 두드린다** — 아무리 두드려도 안 채워지는데도.
  //    매번 덤프로 다시 계산하므로, 저쪽이 나중에 값을 넣어 주면 저절로 풀린다.
  값없는세트.clear()
  for (const [slug, ppt] of Object.entries(SET_NAMES)) {
    if (본이름.has(ppt) && !Object.keys(모음.get(slug)?.prices ?? {}).length) 값없는세트.add(slug)
  }
  if (값없는세트.size) {
    console.log(`[pokegre] 저쪽에 값이 없는 세트 ${값없는세트.size}개는 따로 안 받습니다: ${[...값없는세트].join(' ')}`)
  }
  void savePptState(true)

  const now = Date.now()
  let 채움 = 0
  for (const [slug, 것] of 모음) {
    if (!Object.keys(것.prices).length) continue
    packPriceCache.set(slug, { at: now, prices: 것.prices, names: 것.names, triedAt: now })
    채움++
  }
  if (채움) {
    await savePackPriceFile()
    const 장수 = [...모음.values()].reduce((a, b) => a + Object.keys(b.prices).length, 0)
    console.log(`[pokegre] 시세를 통째로 받아 세트 ${채움}개 · 카드 ${장수.toLocaleString()}장을 채웠습니다.`)
  }
  return 채움
}

// ── 감정 수량(population)과 등급별 낙찰(ebay) ────────────────────────────────
//
// 왜 넣나: 옛 일본판은 **감정 안 된 값이 아무 뜻이 없다**. 미감정 $2인 카드가 PSA 10에선
// $103에 팔린다(2003 ジュブトル 004/019, 2026-04-03 이베이). 표본 1,836장을 재 보니
// "미감정 $5 이하인데 PSA 10은 $50 이상"이 128장(7%)이었고, 최악은 미감정 $0인데
// PSA 10이 $8,252였다(일본판 e카드 팬텀 044). 시세만 보여 주면 이런 카드를 싸구려로
// 오해하게 된다.
//
// 감정 수량이 그 이유를 설명해 준다 — ジュブトル 005는 **전 세계에 감정된 게 7장뿐**이고
// 그중 PSA 10은 2장이다. 이건 값이 아니라 희소성이라, 낙찰 기록이 없어도 보여 줄 수 있다.
//
// ⚠️ 둘 다 **tcgPlayerId를 열쇠로** 둔다. 카드 화면은 이미 그 번호를 알고 있어서
//    세트·번호 대응표를 거칠 필요가 없다(대응표를 거치면 옛 일본판에서 또 새어 나간다).
interface PopEntry {
  psa10?: number
  psa9?: number
  psaAll?: number
  all: number
  gem?: number // 젬률(%) — 전체 기관 합산
}
interface GradeSale {
  n: number // 낙찰 건수
  avg: number
  med?: number
  smart?: number // PPT가 계산한 "지금 시세"
}
const populationCache = new Map<string, PopEntry>()
const ebayGradeCache = new Map<string, Record<string, GradeSale>>()
const POPULATION_FILE = dataFile('population.json')
const EBAY_GRADE_FILE = dataFile('ebay-grades.json')

const 숫자 = (s: string | undefined) => {
  const n = Number(String(s ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

/** 통째 받은 CSV를 줄 단위로 훑는다. 열 이름이 기대와 다르면 false. */
function forEachCsvRow(
  text: string,
   필수: string[],
   한줄: (c: string[], I: Record<string, number>) => void,
): boolean {
  const lines = text.split('\n')
  const head = splitCsvLine(lines[0] ?? '')
  const I = Object.fromEntries(head.map((k, i) => [k.trim(), i])) as Record<string, number>
  // ⚠️ 열 이름을 한 줄 남긴다. 문서에 적힌 이름과 실제가 다르면 값이 조용히 0이 되는데,
  //    그러면 화면엔 아무 일도 없는 것처럼 보인다. 처음 받는 종류라 로그가 유일한 단서다.
  console.log(`[pokegre] 통째 받기 열 이름: ${head.map((k) => k.trim()).join(', ')}`)
  for (const k of 필수) {
    if (I[k] === undefined) {
      console.log(`[pokegre] 통째 받기: 열 "${k}"가 없습니다`)
      return false
    }
  }
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    한줄(splitCsvLine(lines[i]), I)
  }
  return true
}

async function loadPopulationFromCsv(apiKey: string): Promise<number> {
  const text = await fetchExport(apiKey, 'population')
  if (text == null) return 0
  // 한 줄이 (카드 × 감정기관) 하나다. PSA를 따로 챙기고 나머지는 합계에만 더한다.
  const 모음 = new Map<string, PopEntry>()
  const ok = forEachCsvRow(text, ['tcgPlayerId', 'grader', 'totalPopulation'], (c, I) => {
    const id = String(c[I.tcgPlayerId] ?? '').trim()
    if (!id) return
    const 기관 = String(c[I.grader] ?? '').trim().toUpperCase()
    const 합 = 숫자(c[I.totalPopulation])
    if (!(합 > 0)) return
    const 것 = 모음.get(id) ?? { all: 0 }
    것.all += 합
    if (기관 === 'PSA') {
      것.psaAll = 합
      const g10 = 숫자(c[I.g10]) + (I.pristine !== undefined ? 숫자(c[I.pristine]) : 0) + (I.perfect !== undefined ? 숫자(c[I.perfect]) : 0)
      if (g10 > 0) 것.psa10 = g10
      const g9 = 숫자(c[I.g9])
      if (g9 > 0) 것.psa9 = g9
    }
    const 젬 = I.gemRate !== undefined ? 숫자(c[I.gemRate]) : 0
    if (기관 === 'PSA' && 젬 > 0) 것.gem = Math.round(젬 * 10) / 10
    모음.set(id, 것)
  })
  if (!ok) return 0
  // ⚠️ **빈 것으로 덮어쓰지 않는다.** forEachCsvRow는 열 이름만 맞으면 줄이 하나도
  //    없어도 성공을 돌려준다. 저쪽이 머리글만 있는 파일을 주는 날(장애·형식 바뀜)
  //    있던 자료가 통째로 지워지고 화면에서 값이 사라진다. 다음 받는 날까지 며칠이
  //    걸린다 — 옛 자료가 조금 낡은 게 아예 없는 것보다 낫다.
  if (모음.size === 0) {
    console.log(`[pokegre] 통째 받기(population): 쓸 줄이 하나도 없어 그대로 둡니다(있던 것 ${populationCache.size.toLocaleString()}개 유지).`)
    return 0
  }
  populationCache.clear()
  for (const [id, v] of 모음) populationCache.set(id, v)
  await saveJsonMap(POPULATION_FILE, populationCache)
  console.log(`[pokegre] 감정 수량을 통째로 받아 카드 ${populationCache.size.toLocaleString()}장을 채웠습니다.`)
  return populationCache.size
}

async function loadEbayGradesFromCsv(apiKey: string): Promise<number> {
  const text = await fetchExport(apiKey, 'ebay')
  if (text == null) return 0
  const 모음 = new Map<string, Record<string, GradeSale>>()
  const ok = forEachCsvRow(text, ['tcgPlayerId', 'grade', 'salesCount'], (c, I) => {
    const id = String(c[I.tcgPlayerId] ?? '').trim()
    const 등급 = String(c[I.grade] ?? '').trim()
    if (!id || !등급) return
    const n = 숫자(c[I.salesCount])
    const avg = I.averagePrice !== undefined ? 숫자(c[I.averagePrice]) : 0
    const smart = I.smartMarketPrice !== undefined ? 숫자(c[I.smartMarketPrice]) : 0
    if (!(n > 0) && !(smart > 0)) return
    const 것 = 모음.get(id) ?? {}
    것[등급] = {
      n,
      avg: Math.round(avg * 100) / 100,
      ...(I.medianPrice !== undefined && 숫자(c[I.medianPrice]) > 0 ? { med: Math.round(숫자(c[I.medianPrice]) * 100) / 100 } : {}),
      ...(smart > 0 ? { smart: Math.round(smart * 100) / 100 } : {}),
    }
    모음.set(id, 것)
  })
  if (!ok) return 0
  // ⚠️ **빈 것으로 덮어쓰지 않는다.** forEachCsvRow는 열 이름만 맞으면 줄이 하나도
  //    없어도 성공을 돌려준다. 저쪽이 머리글만 있는 파일을 주는 날(장애·형식 바뀜)
  //    있던 자료가 통째로 지워지고 화면에서 값이 사라진다. 다음 받는 날까지 며칠이
  //    걸린다 — 옛 자료가 조금 낡은 게 아예 없는 것보다 낫다.
  if (모음.size === 0) {
    console.log(`[pokegre] 통째 받기(ebay): 쓸 줄이 하나도 없어 그대로 둡니다(있던 것 ${ebayGradeCache.size.toLocaleString()}개 유지).`)
    return 0
  }
  ebayGradeCache.clear()
  for (const [id, v] of 모음) ebayGradeCache.set(id, v)
  await saveJsonMap(EBAY_GRADE_FILE, ebayGradeCache)
  console.log(`[pokegre] 등급별 낙찰을 통째로 받아 카드 ${ebayGradeCache.size.toLocaleString()}장을 채웠습니다.`)
  return ebayGradeCache.size
}

// ── 덤프에 없는 카드는 그때그때 한 장씩 받는다 ──────────────────────────────
//
// 통째 받기는 하루 2회가 전부라 감정 수량을 이레에 한 번밖에 못 받는다. 그 사이에
// 새로 감정된 카드나, 덤프를 받은 뒤에 우리가 추가한 카드는 빈칸으로 남는다.
// 다행히 **한 장씩 받는 길은 하루 2회와 무관하다**(카드당 2크레딧, 한 번에 50장까지).
// 방문자가 실제로 연 카드만 채우므로 낭비가 거의 없다.
//
// ⚠️ 없는 카드를 되풀이해 묻지 않는다. 감정 기록이 아예 없는 카드가 많은데
//    (사장님 카드 614026이 그렇다), 그때마다 2크레딧을 태우면 티끌이 모인다.
//    한 번 없다고 나오면 이레는 다시 묻지 않는다.
const POP_LIVE_DAILY_MAX = 4_000 // 크레딧. 하루 2,000장까지.
const POP_MISS_AGAIN_MS = 7 * 24 * 60 * 60 * 1000
const populationMissAt = new Map<string, number>()
let popLiveSpent = 0
let popLiveDay = ''
const popLiveSpentToday = () => (popLiveDay === utcDay() ? popLiveSpent : 0)

// ── 팝수 조회 화면이 쓰는 "자세히" ─────────────────────────────────────────
//
// ⚠️ **전 카드의 등급별 상세를 메모리에 들고 있으면 안 된다.** 기계가 512MB뿐인데
//    카드 58,000장 × 감정기관 4곳 × 등급 20여 칸이라 수십 MB짜리 객체가 된다.
//    그래서 요약(전체·PSA 10·PSA 9)만 통째로 들고, **자세한 등급표는 볼 때 받는다**.
//    한 장에 2크레딧이고, 사람이 일부러 찾아본 카드에만 나가므로 낭비가 없다.
const POP_DETAIL_TTL_MS = 12 * 60 * 60 * 1000
const POP_DETAIL_MAX = 500
interface PopGrader {
  total: number
  gem?: number
  g: Record<string, number>
}
interface PopDetail {
  all: number
  gems?: number
  byGrader: Record<string, PopGrader>
  updatedAt?: string
}

/** 한 판(일본판/영문판)만 물어본다. 2크레딧. */
async function 감정수량한판(apiKey: string, id: string, 판: 'japanese' | 'english'): Promise<PopEntry | null> {
  const r = await fetch(
    `${PRICE_TRACKER_ORIGIN}/population?tcgPlayerId=${encodeURIComponent(id)}&language=${판}`,
    { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) },
  )
  notePpt(r.status, r.headers)
  popLiveDay = utcDay()
  popLiveSpent = popLiveSpentToday() + 2
  if (!r.ok) return null
  const j = (await r.json()) as { data?: unknown }
  const d = (Array.isArray(j.data) ? j.data[0] : j.data) as Record<string, unknown> | null | undefined
  const 전체 = Number(d?.totalPopulation) || 0
  if (!d || !(전체 > 0)) return null
  // ⚠️ 감정기관별 칸 이름은 `populationByGrader`다. `graders`로 읽으면 값이 조용히
  //    비어서, 화면엔 "전체 7장"만 뜨고 정작 중요한 "PSA 10 2장"이 사라진다
  //    (2026-08-07에 실제로 그렇게 나왔다). gradersTracked는 기관 이름 목록일 뿐이다.
  const psa = ((d.populationByGrader as Record<string, Record<string, number>> | undefined)?.PSA ?? {}) as Record<string, number>
  const 것: PopEntry = { all: 전체 }
  const g10 = (Number(psa.g10) || 0) + (Number(psa.pristine) || 0) + (Number(psa.perfect) || 0)
  if (g10 > 0) 것.psa10 = g10
  if (Number(psa.g9) > 0) 것.psa9 = Number(psa.g9)
  if (Number(psa.totalPopulation) > 0) 것.psaAll = Number(psa.totalPopulation)
  const 젬 = Number(psa.gemRate ?? d.combinedGemRate)
  if (Number.isFinite(젬) && 젬 > 0) 것.gem = Math.round(젬 * 10) / 10
  return 것
}

/**
 * ⚠️ **판을 반드시 붙여 물어야 한다.** 안 붙이면 저쪽이 영문판으로 찾아서, 일본판
 *    카드는 감정 기록이 멀쩡히 있는데도 전부 "없음"으로 온다(2026-08-07에 이걸로
 *    18,726장짜리 카드가 빈손으로 나왔다). 화면이 판을 알려주면 그것만 묻고,
 *    모르면 둘 다 물어본다(4크레딧).
 */
async function fetchPopulationLive(apiKey: string, id: string, 판?: string): Promise<PopEntry | null> {
  if (!apiKey || !id) return null
  const 지난번없음 = populationMissAt.get(id)
  if (지난번없음 && Date.now() - 지난번없음 < POP_MISS_AGAIN_MS) return null
  const 물을것: ('japanese' | 'english')[] =
    판 === 'japanese' ? ['japanese'] : 판 === 'english' ? ['english'] : ['japanese', 'english']
  if (popLiveSpentToday() + 2 * 물을것.length > POP_LIVE_DAILY_MAX) return null
  // 방문자 몫은 건드리지 않는다.
  const 남음 = pptLeftNow()
  if (Number.isFinite(남음) && 남음 - 2 * 물을것.length < PPT_KEEP_FOR_VISITORS) return null
  if (!pptGate().ok) return null
  try {
    for (const p of 물을것) {
      const 것 = await 감정수량한판(apiKey, id, p)
      if (것) {
        populationCache.set(id, 것)
        void saveJsonMap(POPULATION_FILE, populationCache as Map<string, unknown>)
        return 것
      }
    }
    populationMissAt.set(id, Date.now())
    return null
  } catch {
    return null
  }
}

/** 등급표 전부. 라이브로만 받는다(위 설명 참고). 못 받으면 null. */
async function fetchPopulationDetail(apiKey: string, id: string, 판?: string): Promise<PopDetail | null> {
  if (!apiKey || !id) return null
  const 물을것: ('japanese' | 'english')[] =
    판 === 'japanese' ? ['japanese'] : 판 === 'english' ? ['english'] : ['japanese', 'english']
  const 남음 = pptLeftNow()
  if (Number.isFinite(남음) && 남음 - 2 * 물을것.length < PPT_KEEP_FOR_VISITORS) return null
  if (!pptGate().ok) return null
  for (const p of 물을것) {
    try {
      const r = await fetch(
        `${PRICE_TRACKER_ORIGIN}/population?tcgPlayerId=${encodeURIComponent(id)}&language=${p}`,
        { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) },
      )
      notePpt(r.status, r.headers)
      if (!r.ok) continue
      const j = (await r.json()) as { data?: unknown }
      const d = (Array.isArray(j.data) ? j.data[0] : j.data) as Record<string, unknown> | null | undefined
      const 전체 = Number(d?.totalPopulation) || 0
      if (!d || !(전체 > 0)) continue
      const byGrader: Record<string, PopGrader> = {}
      const 원본 = (d.populationByGrader ?? {}) as Record<string, Record<string, number>>
      for (const [기관, v] of Object.entries(원본)) {
        // 0인 칸은 버린다 — 등급 20여 개 중 대부분이 0이라, 그대로 두면 표가
        // 빈칸으로 뒤덮여 정작 값이 있는 등급이 안 보인다.
        const g: Record<string, number> = {}
        for (const [칸, n] of Object.entries(v)) {
          if (칸 === 'totalPopulation' || 칸 === 'gemRate') continue
          if (typeof n === 'number' && n > 0) g[칸] = n
        }
        byGrader[기관] = {
          total: Number(v.totalPopulation) || 0,
          ...(Number(v.gemRate) > 0 ? { gem: Math.round(Number(v.gemRate) * 10) / 10 } : {}),
          g,
        }
      }
      return {
        all: 전체,
        ...(Number(d.totalGems) > 0 ? { gems: Number(d.totalGems) } : {}),
        byGrader,
        ...(typeof d.updatedAt === 'string' ? { updatedAt: d.updatedAt } : {}),
      }
    } catch {
      /* 다음 판으로 */
    }
  }
  return null
}

async function saveJsonMap(file: string, m: Map<string, unknown>) {
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeJsonFile(file, Object.fromEntries(m))
  } catch (e) {
    console.log(`[pokegre] ${path.basename(file)} 저장 실패: ${String(e).slice(0, 60)}`)
  }
}

async function loadJsonMap(file: string, m: Map<string, unknown>, 이름: string) {
  try {
    const o = JSON.parse(await readFile(file, 'utf-8')) as Record<string, unknown>
    for (const [k, v] of Object.entries(o)) m.set(k, v)
    if (m.size) console.log(`[pokegre] ${이름} ${m.size.toLocaleString()}장을 이어받았습니다`)
  } catch {
    /* 처음 뜨는 것 */
  }
}

/**
 * 오늘 통째로 받을 것을 골라 순서대로 받는다.
 *
 * ⚠️ 하루 2회가 전부다. 시세(cards)를 먼저 받고, 남는 한 칸은 **가장 오래된 것**에 준다.
 *    셋을 매일 받으려 들면 시세가 밀려 어제 값이 그대로 남는다.
 */
/**
 * **오늘은 이것만 받아서 파일로 남겨라** — 손으로 켜는 스위치.
 *
 * 왜: 아직 안 써 본 종류(printings·sealed)가 뭘 담고 있는지 **눈으로 보고 나서**
 * 계획표를 짜야 한다. 그런데 하루 2칸을 서버가 평소 계획대로 다 써 버려서, 사람이
 * 볼 몫이 남지 않는다(2026-08-08 사장님 지시).
 *
 * 켜기:  fly secrets set EXPORT_TODAY=printings,sealed -a pokegre
 * 끄기:  fly secrets unset EXPORT_TODAY -a pokegre     ← **보고 나면 반드시 끌 것**
 *
 * ⚠️ 켜져 있으면 **평소 계획(시세·감정 수량·등급별 낙찰)을 통째로 건너뛴다.** 그날은
 *    시세가 안 들어온다. 하루치라 값이 하루 묵을 뿐이지만, 켜 둔 걸 잊으면 계속 묵는다.
 * ⚠️ 받은 것을 **해석하지 않고 그대로 /data에 적는다.** 아직 열이 뭔지 모르는 자료를
 *    억지로 읽으면 엉뚱한 값이 화면에 나간다.
 */
function 오늘손으로받을것(): string[] {
  return String(process.env.EXPORT_TODAY ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z]+$/.test(t))
    .slice(0, EXPORT_DAILY_MAX)
}

async function 받아서파일로만(apiKey: string, 종류: string): Promise<void> {
  const text = await fetchExport(apiKey, 종류)
  if (text == null) return
  const 곳 = dataFile(`export-${종류}.csv`)
  try {
    await mkdir(path.dirname(곳), { recursive: true })
    await writeFile(곳, text)
    const 줄 = text.split('\n')
    console.log(
      `[pokegre] ${종류}를 그대로 적었습니다: ${(Buffer.byteLength(text) / 1024 / 1024).toFixed(1)}MB · ` +
        `${줄.length.toLocaleString()}줄 · 열: ${(줄[0] ?? '').slice(0, 200)}`,
    )
  } catch (e) {
    console.log(`[pokegre] ${종류}를 파일로 못 적었습니다: ${String(e).slice(0, 80)}`)
  }
}

async function runDailyExports(apiKey: string) {
  if (!apiKey) return
  // ⚠️ 스위치가 켜져 있으면 **이것만** 하고 끝낸다(위 설명).
  const 손으로 = 오늘손으로받을것()
  if (손으로.length) {
    for (const 종류 of 손으로) {
      const 쓴것 = Object.values(exportDoneDay).filter((날) => 날 === utcDay()).length
      if (쓴것 >= EXPORT_DAILY_MAX) {
        console.log('[pokegre] 오늘 통째 받기 몫을 다 썼습니다 — 남은 것은 내일.')
        return
      }
      if (!exportDue(종류)) continue
      console.log(`[pokegre] EXPORT_TODAY가 켜져 있습니다 — ${종류}를 받아 파일로만 남깁니다.`)
      await 받아서파일로만(apiKey, 종류)
    }
    return
  }
  let 쓴칸 = Object.values(exportDoneDay).filter((날) => 날 === utcDay()).length
  if (쓴칸 >= EXPORT_DAILY_MAX) {
    console.log('[pokegre] 오늘 통째 받기 몫을 이미 다 썼습니다(한국시간 오전 9시에 초기화).')
    return
  }
  if (exportDue('cards')) {
    await loadPricesFromCsv(apiKey)
    쓴칸++
  }
  if (쓴칸 >= EXPORT_DAILY_MAX) return
  // 남는 칸은 더 오래 묵은 쪽에 준다.
  // ⚠️ 순서가 [population, ebay]인 게 중요하다. 둘 다 한 번도 안 받았으면 묵은 날이
  //    같아서(빈칸) 앞에 적힌 쪽이 먼저 간다. 감정 수량이 먼저여야 한다 — 등급별
  //    낙찰은 검색할 때 실시간으로도 받고 있지만, 감정 수량은 통째로 받아 두지 않으면
  //    카드를 열 때마다 2크레딧씩 나간다.
  const 밀린것 = (['population', 'ebay'] as const)
    .filter((t) => exportDue(t))
    .sort((a, b) => (exportDoneDay[a] ?? '').localeCompare(exportDoneDay[b] ?? ''))
  const 고른것 = 밀린것[0]
  if (!고른것) return
  if (고른것 === 'population') await loadPopulationFromCsv(apiKey)
  else await loadEbayGradesFromCsv(apiKey)
}

// 한 번 실패한 세트를 얼마나 두었다 다시 받아 볼지.
//
// ⚠️ 예전엔 실패하면 캐시에 아무것도 안 남겼다. 그래서 "아직 못 받은 세트"로 계속 잡혀
//    5분마다 처음부터 다시 받으러 갔다. 2026-08-02에 카드 뽑기 세트를 23개→44개로
//    늘렸더니, 새로 들어온 21개가 이 고리에 걸려 한 바퀴 4,200크레딧을 반복해서 썼다.
//    이제 실패해도 triedAt을 남기고, 그 뒤 6시간은 건드리지 않는다.
const PACK_WARM_RETRY_MS = 6 * 60 * 60 * 1000
const packWarmDue = (hit?: PackPriceEntry) =>
  !hit || (!packPriceFresh(hit) && Date.now() - (hit.triedAt ?? hit.at) >= PACK_WARM_RETRY_MS)
const PACK_PRICE_FILE = dataFile('pack-prices.json')
const stripZeros = (n: string) => n.replace(/^0+/, '') || '0'

// 저쪽(PPT) 번호를 **우리 번호로** 되돌린다. 세트마다 번호 체계가 다를 수 있어서다.
// 표는 src/data/setCardNumberAlias.json에 둔다(우리 번호 → 저쪽 번호).
// 두 가지 어긋남을 함께 다룬다.
//   ① 번호 체계가 다른 세트(우리 CC002 ↔ 저쪽 4/102)
//   ② 저쪽에 번호가 없는 세트(옛 일본판) — 그때는 **이름**을 열쇠로 쓴다("NAME:Oddish").
const 번호별칭 = setCardNumberAlias as Record<string, Record<string, string>>
const 번호되돌림 = new Map<string, Map<string, string>>()
const 이름되돌림 = new Map<string, Map<string, string>>()
for (const [slug, t] of Object.entries(번호별칭)) {
  const byNum = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const [우리, 저쪽] of Object.entries(t)) {
    if (저쪽.startsWith('NAME:')) byName.set(저쪽.slice(5).trim().toLowerCase(), 우리)
    else byNum.set(저쪽.toUpperCase(), 우리)
  }
  번호되돌림.set(slug, byNum)
  이름되돌림.set(slug, byName)
}
// ⚠️ **이름표를 번호보다 먼저 본다.** 번호가 있어도 그 번호가 우리와 다를 수 있어서다
//    (en-svp: 저쪽 "SVP 175" ↔ 우리 "175", ja-MC: 저쪽 "052/742" ↔ 우리 "051").
//    번호가 있으니 번호만 보던 때는 이런 카드 11장이 이름표를 넣어 두고도
//    시세가 안 붙었다(2026-08-07 확인). 이름표는 사람이 한 장씩 확인한 것이라
//    자동으로 맞춘 번호보다 믿을 만하고, 세트 안에서 겹치지 않음도 확인해 두었다.
export const 번호되돌리기 = (slug: string, 저쪽번호: string, 저쪽이름?: string): string => {
  const 이름 = 저쪽이름 ? 이름되돌림.get(slug)?.get(String(저쪽이름).trim().toLowerCase()) : undefined
  if (이름) return 이름
  const n = String(저쪽번호 ?? '').trim()
  if (n) return 번호되돌림.get(slug)?.get(n.toUpperCase()) ?? n
  return n
}

// 앨범을 열 때 받아오면 세트당 1분씩 걸려 못 쓴다(PPT 분당 한도). 대신
// ① 캐시를 파일로 남겨 재배포 직후에도 어제 시세가 바로 뜨고
// ② 서버가 뒤에서 1분 간격으로 하나씩 새로 받아 하루 한 번 갈아끼운다.
// 이름이 남의 세트 이름 안에 들어가는 우리 세트들. 저쪽 세트 검색이 부분일치라
// 이 세트들만 딴 세트 카드가 딸려 온다(위 담기 설명). 332개 중 28개다.
let 딸려오는세트캐시: Set<string> | null = null
const 딸려오는세트 = () => {
  if (딸려오는세트캐시) return 딸려오는세트캐시
  const 전부 = [...new Set([...(pptSetList as string[]), ...Object.values(pptSetNames as Record<string, string>)])]
  const 것 = new Set<string>()
  for (const [slug, 이름] of Object.entries(SET_NAMES)) {
    const n = 이름.toLowerCase()
    if (전부.some((x) => x.toLowerCase() !== n && x.toLowerCase().includes(n))) 것.add(slug)
  }
  딸려오는세트캐시 = 것
  return 것
}

async function loadPackPriceFile() {
  try {
    const raw = JSON.parse(await readFile(PACK_PRICE_FILE, 'utf-8')) as Record<
      string,
      { at: number; prices: Record<string, number>; partial?: boolean }
    >
    for (const [slug, v] of Object.entries(raw)) packPriceCache.set(slug, v)
    // ⚠️ **고치기 전에 받아 둔 값에는 딴 세트가 섞여 있다.** 그냥 두면 순번이 돌아올
    //    때까지(최대 45일) 틀린 값이 화면에 남는다. 딸려오는 세트만 한 번 비워
    //    다시 받게 한다. 이미 비운 뒤면 표가 남아 있어 다시 안 비운다.
    // ⚠️ **이미 지운 세트는 표에 적어 두고 다시 안 지운다.** 예전엔 "다 지웠음" 표
    //    하나만 뒀는데, 새로 고칠 세트가 생길 때마다 40개를 통째로 다시 받아야 했다.
    let 지운것: string[] = []
    try {
      const 표 = JSON.parse(await readFile(MIX_FIX_MARK_FILE, 'utf-8')) as { 지운것?: string[] }
      if (Array.isArray(표.지운것)) 지운것 = 표.지운것
      else 지운것 = [...딸려오는세트(), ...Object.keys(번호별칭)] // 예전 표 = 그때 것까지는 지웠다
    } catch {
      /* 아직 한 번도 안 지웠다 */
    }
    // ⚠️ 번호 별칭을 쓰는 세트도 같이 비운다. 옛 일본판은 저쪽에 번호가 없어서
    //    라이브로 받은 값이 "0번" 한 칸에 몰려 있었다(확장팩 제1탄이 그랬다 —
    //    1등 카드가 에너지 $0.44로 나갔다).
    const 지울것 = [...new Set([...딸려오는세트(), ...Object.keys(번호별칭), ...대조표고친세트])]
    let 비움 = 0
    for (const slug of 지울것) {
      if (지운것.includes(slug)) continue
      if (packPriceCache.delete(slug)) 비움++
    }
    if (비움) {
      console.log(`[pokegre] 딴 세트가 섞여 있던 ${비움}개 세트의 시세를 비웠습니다 — 순번대로 다시 받습니다.`)
      await savePackPriceFile()
    }
    await writeJsonFile(MIX_FIX_MARK_FILE, { at: Date.now(), 지운것: 지울것 })
  } catch {
    /* 처음엔 없다 */
  }
}
async function savePackPriceFile() {
  await mkdir(path.dirname(PACK_PRICE_FILE), { recursive: true })
  await writeJsonFile(PACK_PRICE_FILE, Object.fromEntries(packPriceCache))
}

// 미리 받을 세트를 고른다 — 순번제. 세트를 정해진 순서로 줄 세우고 매일 그중 몇 개만
// 갱신해, 7일이면 44개가 한 바퀴 돈다.
//
// 왜 이렇게 하나 (2026-08-03 사용자와 정한 방식):
//   · 예전엔 PPT_SET_NAMES 전부를 돌았다. 카드 뽑기에 세트를 추가할 때마다 범위가 같이
//     늘어나는 구조라, 23개→44개가 되자 한 바퀴가 그때 하루치(20,000)를 넘겼다.
//   · 그다음엔 "오늘 진열되는 6개"로 묶었다. 싸지만 진열이 랜덤이라 운 나쁘면 43일 동안
//     한 번도 안 뽑히는 세트가 생긴다(실측: ja-SV8 최대 43일).
//   · 순번제는 비용이 거의 같으면서 **어느 세트든 7일 안에 반드시** 갱신된다.
//
// ⚠️ 날짜로 순번을 정한다. 서버가 꺼졌다 켜져도 순서가 안 밀리고, 하루에 여러 번 돌아도
//    같은 날은 같은 세트만 본다(그날 몫을 다 받으면 그 뒤 바퀴는 할 일이 없다).
// ⚠️ 44개를 7일로 나누면 7·7·6·6·6·6·6이다. 마지막 날만 2개 같은 들쭉날쭉을 피하려고
//    앞에서부터 하나씩 더 얹는다.
// 시세 창고에 담을 수 있는 세트의 PPT 이름 사전 (2026-08-03 통합).
//
// 예전엔 시세를 두 군데서 따로 받았다 — 앨범(카드 뽑기 44세트)과 세트별 목록의 힛카드.
// 부르는 주소도 파라미터도 똑같은데 저장하는 곳만 달라서 같은 걸 두 번 받고 있었다.
// 이제 창고는 하나(packPriceCache)이고, 앨범도 힛카드도 여기서 읽는다
// (topPricedCards가 창고를 먼저 보고, 없을 때만 미리 받아 둔 파일을 본다).
//
// ⚠️ 카드 뽑기 쪽(PPT_SET_NAMES)이 이긴다 — 그쪽은 손으로 확인한 이름이다.
// ⚠️ 이름이 늘었다고 받는 양이 늘지는 않는다. 무엇을 받을지는 아래 warmTargets가 정한다.
const SET_NAMES: Record<string, string> = { ...(pptSetNames as Record<string, string>), ...PPT_SET_NAMES }

// 카드 뽑기 42개(일본 27 + 북미 15)를 7일에 한 바퀴 = 하루 6개.
// 진열이 매일 일본 3 + 북미 3이라 양쪽 다 3의 배수로 맞춰 뒀다(사용자 확인 2026-08-03).
// ── 시세를 언제 얼마나 받을지 (2026-08-03 사용자와 정함) ──────────────────
// 세 가지가 같은 창고를 쓴다.
//   A. 카드 뽑기 42개 — 앨범 값이라 자주 갱신한다. 7일에 한 바퀴(하루 6개).
//   B. 나머지 288개  — 세트별 목록의 "값 높은 카드"에만 쓴다. 45일에 한 바퀴.
//   채우기 — 아직 한 번도 못 받은 세트를 최신순으로. 하루 100,000까지.
//
// 하루치 200,000 중(2026-08-07 Business로 올린 뒤)
//   채우는 동안: 채우기 100,000 + A 1,857 + 방문자 1,000 ≈ 103,000
//   다 채운 뒤 : A 1,857 + B 1,569 + 방문자 1,000 ≈ 4,400
// 방문자 몫 40,000(PPT_KEEP_FOR_VISITORS)은 어느 경우에도 건드리지 않는다.
// ⚠️ 예산을 늘려도 실제로 더 쓰지는 않는다 — 채울 세트가 남았을 때만 쓴다.
//    오늘도 5,600에서 멈췄다(거의 다 채웠다). 새 세트가 들어올 때 하루에 다 받으라고 늘린 것이다.
const WARM_FILL_BUDGET = 100_000

// 오늘 채우기에 쓴 크레딧. 한국시간이 아니라 크레딧이 새로 차는 UTC 0시로 끊는다.
let fillSpent = 0
let fillSpentDay = ''
const noteFillSpend = (n: number) => {
  const d = utcDay()
  if (fillSpentDay !== d) { fillSpentDay = d; fillSpent = 0 }
  fillSpent += n
  // 배포로 서버가 새로 떠도 오늘 쓴 양을 이어받게 파일에 남긴다.
  void savePptState()
}
const fillSpentToday = () => (fillSpentDay === utcDay() ? fillSpent : 0)

// 세트 발매일 — 채울 때 최신 것부터 받으려고 쓴다. 한 번 읽고 들고 있는다.
let setDateCache: Map<string, string> | null = null
function setReleaseDates(): Map<string, string> {
  if (setDateCache) return setDateCache
  const m = new Map<string, string>()
  for (const base of ['dist/sets', 'public/sets']) {
    try {
      const list = JSON.parse(readFileSync(path.resolve(base, 'index.json'), 'utf-8')) as {
        slug: string
        releaseDate?: string
      }[]
      for (const s of list) m.set(s.slug, s.releaseDate ?? '')
      break
    } catch {
      /* 다음 경로 */
    }
  }
  setDateCache = m
  return m
}

/**
 * 세트별로 시세를 받아 올 대상.
 *
 * ⚠️ **덤프가 생긴 뒤로 이 일은 거의 남지 않았다.** 예전엔 세트를 하나씩 불러 채웠고,
 *    카드 뽑기 42개를 7일에 나눠 도는 순번제와 나머지 세트를 45일에 도는 느린 순번제가
 *    있었다. 지금은 **통째 받기 한 번이 매일 330개를 채운다** — 운영 실측으로 세트
 *    332개 중 331개에 값이 있고 330개가 24시간 안에 갱신돼 있었다(2026-08-08).
 *    그래서 두 순번제를 다 걷어냈다. **남은 일은 "덤프가 못 채운 것 줍기" 하나다.**
 * ⚠️ 되살리고 싶어지면 먼저 세어 볼 것 — 덤프가 이미 채운 세트를 또 받으면
 *    크레딧만 나가고 값은 그대로다.
 */
function warmTargets(): string[] {
  return fillTargets()
}

const hasPrices = (slug: string) => !!Object.keys(packPriceCache.get(slug)?.prices ?? {}).length

// 아직 한 번도 못 받은 세트를 최신순으로 채운다. 하루 예산까지만.
//
// 왜 최신순인가: 사람들이 찾는 건 대부분 최근 몇 년 세트다. 첫날에 값어치가 몰린다.
// 왜 예산을 두나: 한 번에 다 받으면 64,000이다. 하루치가 200,000이 된 지금은 넘지 않지만
// (2026-08-07 Business), 방문자 몫과 다른 작업 몫을 남겨 두려면 하루에 나눠 받는 게 낫다.
// ⚠️ 예산을 다 쓰면 빈 배열을 준다 — 그래야 warmPackPrices가 "할 일 없음"으로 보고
//    다음 날까지 조용히 기다린다.
function fillTargets(): string[] {
  if (fillSpentToday() >= WARM_FILL_BUDGET) return []
  const dates = setReleaseDates()
  return Object.keys(SET_NAMES)
    // ⚠️ 저쪽에 값이 아예 없는 세트는 뺀다. 안 빼면 6시간마다 영원히 두드린다.
    .filter((s) => !hasPrices(s) && !값없는세트.has(s))
    .sort((a, b) => (dates.get(b) ?? '').localeCompare(dates.get(a) ?? '') || a.localeCompare(b))
}

// (걷어냄) 뽑기에 없는 세트를 45일에 한 바퀴 돌던 몫이 있었다. 덤프가 매일 330개를
// 통째로 갱신하므로 할 일이 겹칠 뿐이다. 게다가 "아직 못 채운 세트가 있으면 쉰다"는
// 조건 때문에 **한 번도 돈 적이 없었다** — 저쪽에 값이 없는 세트가 늘 하나 걸려 있었다.

// 뽑은 카드에 지금 시세(USD)를 붙인다. 개봉 화면이 "값나가는 카드"를 빛나게 하는 데 쓴다.
// 앨범 가치와 같은 규칙으로 찾는다 — 번호에서 앞의 0을 떼고, 미러·마스터볼 변형은
// 접미사(~m·~p·~r)가 붙은 값을 먼저 본다. 없으면 0(=빛나지 않음)이다.
// ⚠️ 이미 받아 둔 값만 읽는다. 여기서 PPT를 부르지 않는다 — 개봉은 사람이 누를 때마다
//    일어나므로, 부르기 시작하면 크레딧이 얼마나 나갈지 아무도 모른다(앨범 가치와 같은 이유).
function withUsd<T extends { n: string; m?: string }>(slug: string, cards: T[]): (T & { usd?: number })[] {
  const prices = packPriceCache.get(slug)?.prices
  if (!prices) return cards
  return cards.map((c) => {
    const base = stripZeros(c.n)
    const vk = c.m === 'master' ? '~m' : c.m === 'poke' ? '~p' : c.m === 'rev' ? '~r' : ''
    const usd = (vk ? prices[base + vk] : undefined) ?? prices[base] ?? 0
    return usd > 0 ? { ...c, usd } : c
  })
}

// ── 뽑기 명예의 전당 ──────────────────────────────────────────────────────
// 홈에 "누가 뭘 뽑았다"를 보여주기 위한 기록. 자랑하기(본인이 눌러 커뮤니티에 올리는 것)와
// 별개다 — 자랑글은 대부분 보상(+5,000 GP) 때문에 올리는 거라 정작 좋은 카드는 안 올라온다
// (운영자가 실제 글을 보고 확인, 2026-08-04). 그래서 서버가 뽑을 때 알아서 남긴다.
//
// ⚠️ 왜 "최근"이 아니라 "역대 최고"를 같이 두나: 아직 뽑는 사람이 적다. 최근 것만 띄우면
//    며칠씩 비어 죽은 자리가 된다. 역대 최고는 팩이 몇 장 안 열렸어도 반드시 하나는 있다.
//    사람이 늘면 최근 것이 자연히 앞을 차지한다.
// ⚠️ 이름(한글 카드명)은 안 담는다. 서버엔 번역기가 없고, 화면은 이미 갖고 있다.
//    slug+번호만 주면 화면이 그때 이름을 만든다.
const PACK_HIGHLIGHT_FILE = dataFile('pack-highlights.json')
// 화면엔 최근 1개·역대 1개만 쓰지만, 지우고 나면 되돌릴 수 없으므로 여유를 둔다.
const HIGHLIGHT_MAX = 100
// "최근"으로 쳐 주는 기간.
const HIGHLIGHT_FRESH_MS = 7 * 24 * 60 * 60 * 1000
// 배너에 올릴 기준. 셋 중 하나면 된다.
//   ⚠️ 시세만 보면 아직 시세를 못 받아온 세트가 통째로 빠지고, 등급만 보면 값은 비싼데
//      등급이 낮은 카드가 빠진다. 이 교훈은 앨범 기본 담기(keepByDefault)에서 이미 겪었다.
// ⚠️ 처음엔 SAR·SIR(7) 이상이었는데 너무 드물었다. 실제로 돌려 재보니 일본판은
//    박스를 통째로 열어도 5번에 1번만 걸렸다(banner-rate.mts, 2026-08-04):
//      일본판 105~143팩에 1번(박스 17~22%) · 영문판 53~73팩에 1번(박스 35~54%)
//    일본판 박스 보장이 "SR 이상 1장"인데 SR이 기준 바로 아래라 보장이 헛돌았다.
//    한 단계 낮춰(6 = SR·UR 이상) 일본판도 박스 한 번이면 대개 걸리게 했다.
const HIGHLIGHT_USD = 30
const HIGHLIGHT_RANK = 6 // SR·UR 이상
// 배너가 돌아가며 보여줄 개수.
const HIGHLIGHT_SHOW = 5

interface PackHighlight {
  at: number
  /** 도배 방지(한 사람 하루 1번)에만 쓴다. 화면에는 절대 안 내보낸다. */
  uid: string
  nick: string
  slug: string
  n: string
  r?: string
  m?: MirrorFlag
  img?: string
  usd?: number
  god?: boolean
  /**
   * 한글 카드 이름. 서버엔 번역기가 없어서 개봉한 사람의 화면이 뒤이어 채워 준다
   * (POST /packsim/highlight-name). 홈은 사전을 안 받으므로 — 사전이 내려받는 양의
   * 절반이라 첫 화면을 무겁게 한다 — 서버가 들고 있어야 한다.
   * 안 채워져도 배너는 뜬다. 이름 없이 팩 이름과 등급만 나온다.
   */
  name?: string
}

let highlights: PackHighlight[] | null = null

async function loadHighlights(): Promise<PackHighlight[]> {
  if (highlights) return highlights
  try {
    const raw = JSON.parse(await readFile(PACK_HIGHLIGHT_FILE, 'utf-8'))
    highlights = Array.isArray(raw) ? (raw as PackHighlight[]) : []
  } catch {
    highlights = []
  }
  return highlights
}

// 둘 중 어느 쪽이 더 "좋은" 카드인가.
//
// ⚠️ 시세부터 보면 안 된다. 시세를 아직 못 받은 카드는 0이라 무조건 진다 —
//    실제로 금색 UR(제일 높은 등급)이 시세 붙은 SIR한테 지는 걸 확인했다(2026-08-04).
//    PPT 크레딧 사정으로 시세가 비는 세트가 늘 있으므로 이건 예외가 아니라 상시다.
// 그래서 양쪽 다 시세를 알 때만 시세로 견주고, 한쪽이라도 모르면 등급으로 견준다.
const usdOfHi = (h: { usd?: number }) => (h.usd && h.usd > 0 ? h.usd : 0)
const rankOfHi = (h: { r?: string }) => RARITY_RANK[h.r ?? ''] ?? 0
function betterCard<T extends { usd?: number; r?: string }>(a: T, b: T): T {
  const ua = usdOfHi(a)
  const ub = usdOfHi(b)
  if (ua > 0 && ub > 0) {
    if (ua !== ub) return ua > ub ? a : b
  } else {
    const ra = rankOfHi(a)
    const rb = rankOfHi(b)
    if (ra !== rb) return ra > rb ? a : b
    // 등급이 같으면 시세를 아는 쪽을 쓴다(배너에 값을 적을 수 있다).
    if (ua !== ub) return ua > ub ? a : b
  }
  return a
}
const betterHighlight = (a: PackHighlight, b: PackHighlight) => {
  const win = betterCard(a, b)
  // 완전히 같으면 최근 것을 쓴다.
  return win === a && betterCard(b, a) === b ? (a.at >= b.at ? a : b) : win
}

// 방금 연 팩(또는 박스)에서 배너에 올릴 만한 카드가 있으면 기록한다.
// 실패해도 개봉은 정상으로 끝나야 하므로 부르는 쪽에서 await 하지 않는다.
async function noteHighlight(
  slug: string,
  cards: { n: string; r?: string; m?: MirrorFlag; img?: string }[],
  god: boolean,
  user: { id: string; nickname?: string | null },
): Promise<string | null> {
  const nick = (user.nickname ?? '').trim()
  if (!nick) return null // 이름 없이 띄울 자리가 아니다
  const list = await loadHighlights()
  const priced = withUsd(slug, cards)
  const worthy = priced.filter(
    (c) => (c.usd ?? 0) >= HIGHLIGHT_USD || (RARITY_RANK[c.r ?? ''] ?? 0) >= HIGHLIGHT_RANK || god,
  )
  if (!worthy.length) return null
  // 그 팩에서 제일 좋은 한 장만 남긴다(위 betterCard와 같은 잣대를 쓴다).
  const best = worthy.reduce((a, b) => betterCard(a, b))

  // ⚠️ 한 사람이 여러 자리를 차지해도 된다(2026-08-05 운영자 지시).
  //    예전엔 "하루 한 자리"로 막았는데(배너 독점 걱정), 그러면 같은 날 더 좋은 카드가
  //    나와도 못 올라가서 자리를 갈아끼우는 코드까지 따로 있었다. 제한을 없애니
  //    그 코드도 필요 없다 — 뽑을 때마다 그냥 쌓고, 값 높은 순으로 뽑아 보여주면 된다.
  //    많이 여는 사람이 상위권을 채우는 건 "가장 시세 높은 카드를 뽑은 사람" 목록의
  //    뜻에 어긋나지 않는다.
  const entry: PackHighlight = {
    at: Date.now(),
    uid: user.id,
    nick: nick.slice(0, 20),
    slug,
    n: best.n,
    r: best.r,
    ...(best.m ? { m: best.m } : {}),
    ...(best.img ? { img: best.img } : {}),
    ...(best.usd ? { usd: best.usd } : {}),
    ...(god ? { god: true } : {}),
  }
  list.push(entry)
  // 넘치면 버리되, 역대 최고와 최근 것은 남긴다.
  if (list.length > HIGHLIGHT_MAX) {
    const fresh = Date.now() - HIGHLIGHT_FRESH_MS
    const ranked = [...list].sort((a, b) => (betterHighlight(a, b) === a ? -1 : 1))
    const keep = new Set(ranked.slice(0, 10))
    for (const h of list) if (h.at > fresh) keep.add(h)
    highlights = [...keep].sort((a, b) => a.at - b.at).slice(-HIGHLIGHT_MAX)
  }
  await mkdir(path.dirname(PACK_HIGHLIGHT_FILE), { recursive: true })
  await writeJsonFile(PACK_HIGHLIGHT_FILE, highlights)
  // 어느 카드가 올라갔는지 알려 주면, 화면이 그 한 장의 한글 이름만 보내 준다.
  return best.n
}

// POST /packsim/highlight-name — 방금 배너에 오른 카드의 한글 이름을 채운다.
// 서버엔 번역기가 없고 홈은 사전을 안 받으므로, 개봉한 사람의 화면이 대신 알려 준다.
// ⚠️ 이름은 표기일 뿐이라 속여도 자기 기록만 이상해진다(자랑글도 같은 방식이다).
//    그래도 자기가 방금 올린 기록에만 쓸 수 있게 막는다.
async function fillHighlightName(userId: string, n: string, name: string): Promise<boolean> {
  const list = await loadHighlights()
  // ⚠️ 배열 순서가 아니라 시각(at)으로 "가장 최근 것"을 찾아야 한다. 오늘 자리를 더 좋은
  //    카드로 갈아끼우면 그 기록은 배열 뒤로 가지 않고 제자리에 남는다. 순서로 찾으면
  //    같은 카드번호를 가진 며칠 전 기록을 짚어, 오늘 것이 이름 없이 남는다.
  const mine = list
    .filter((h) => h.uid === userId && h.n === n && !h.name)
    .reduce<PackHighlight | null>((a, b) => (a && a.at > b.at ? a : b), null)
  if (!mine) return false
  mine.name = name.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!mine.name) return false
  await mkdir(path.dirname(PACK_HIGHLIGHT_FILE), { recursive: true })
  await writeJsonFile(PACK_HIGHLIGHT_FILE, list)
  return true
}

// GET /api/local/pack-highlights — 홈의 "이번 주 TOP 5"가 읽어 간다. 로그인 없이 볼 수 있다.
// 이번 주(7일) 것을 시세 높은 순으로 먼저 주고, 5개가 안 되면 역대 기록으로 채운다.
// ⚠️ 이번 주 것만 쓰면 자리가 비는 날이 생긴다 — 아직 뽑는 사람이 적다. 대신 각 항목에
//    recent를 붙여, 다섯 개가 다 이번 주 것일 때만 화면이 "이번 주"라고 말하게 한다.
// 회원번호(uid)는 빼고 준다.
function mountPackHighlights(app: Mountable) {
  app.use('/api/local/pack-highlights', async (_req, res) => {
    const list = await loadHighlights()
    // ⚠️ "이번 주"에 든 것만 보여준다(2026-08-05 운영자 지시). 예전엔 자리가 남으면
    //    지난 기록으로 채웠는데, 그러면 "이번 주 TOP 5"라면서 20일 전 기록이 섞였다.
    //    다섯 개가 안 되면 **안 되는 대로 비운다** — 없는 걸 채워 넣지 않는다.
    const fresh = list.filter((h) => Date.now() - h.at <= HIGHLIGHT_FRESH_MS)
    // 좋은 순 정렬. betterHighlight가 "둘 중 나은 쪽"을 주므로 그걸로 비교한다.
    const picked = [...fresh].sort((a, b) => (betterHighlight(a, b) === a ? -1 : 1)).slice(0, HIGHLIGHT_SHOW)
    sendJson(res, 200, {
      // uid(회원번호)는 빼고 보낸다. at(뽑은 시각)은 화면이 날짜를 적는 데 쓴다.
      items: picked.map((h) => {
        const { uid: _uid, ...rest } = h
        void _uid
        return rest
      }),
      total: list.length,
    })
  })
}

let warming = false
async function warmPackPrices(apiKey: string) {
  if (!apiKey || warming) return
  warming = true
  let outOfBudget = false
  try {
    for (const slug of warmTargets()) {
      // 한도에 걸렸으면 이번 바퀴는 접는다. 22세트를 계속 도는 건 헛일이고,
      // 풀린 뒤에 다시 오면 못 받은 것부터 이어서 채운다.
      if (!pptGate().ok) break
      // 방문자 몫까지 먹지는 않는다. 앨범 시세는 하루 이틀 묵어도 쓸 만하지만,
      // 카드 시세가 안 나오는 건 바로 보인다.
      if (pptLeftNow() < PPT_KEEP_FOR_VISITORS) {
        outOfBudget = true
        break
      }
      // 오늘 채우기 몫을 다 썼으면 "처음 받는 세트"는 더 건드리지 않는다.
      // ⚠️ 목록은 시작할 때 한 번 만들어지므로, 여기서 매번 다시 봐야 예산을 넘지 않는다.
      if (!hasPrices(slug) && fillSpentToday() >= WARM_FILL_BUDGET) continue
      // 신선한 것과, 최근에 시도했다 실패한 것은 건너뛴다(위 packWarmDue 설명).
      if (!packWarmDue(packPriceCache.get(slug))) continue
      // 통째로 받는다(fetchAllInSet). 안 되면 함수 안에서 알아서 나눠 받는다.
      await getSetPrices(slug, apiKey, { pages: 5, pauseMs: 5_000 })
      await savePackPriceFile()
      // 시세가 들어오면 그 세트의 힛카드가 통째로 바뀐다 — 레어도 순으로 보여주던 것이
      // 값 순으로 바뀌므로, 화면 맨 위 여덟 장이 다른 카드가 된다. 그 그림은 아무도
      // 받아 둔 적이 없어서 처음 여는 사람이 1.3초를 기다린다(2026-08-05 실측).
      // 시세를 받은 김에 바로 데운다. 여덟 장뿐이라 부담이 없다.
      await warmHitCardImgs?.(slug)
      // ⚠️ **분당 한도는 요청 수가 아니다.** 여기 "요청 수다"라고 적어 뒀던 게 틀렸다
      //    (2026-08-07 실측으로 바로잡음). 받아 온 **장수 ÷ 10**만큼 나간다.
      //        카드 1장짜리 요청      →  1
      //        200장 페이지          → 20
      //        484장 통째로(모아받기) → 30  (장수/10이지만 30에서 멈춘다)
      //    한도는 분당 500이다. 1.5초로 두면 분당 40번인데, 세트 하나가 20~30이니
      //    분당 800~1,200이 되어 **한도를 두 배 넘긴다**. "요청 수"로 잘못 알고
      //    "한도의 10%"라고 적어 뒀던 것이다.
      //    3초면 분당 20세트 × 25 ≈ 500 언저리라 여유가 있다. 통째로 받게 되면서
      //    세트당 요청이 3번에서 1번으로 줄어, 실제로 채우는 속도는 더 빨라졌다.
      await new Promise((r) => setTimeout(r, 3_000))
    }
  } finally {
    warming = false
  }
  // 아직 받을 차례가 된 세트가 남았으면 다시 온다.
  // ⚠️ "못 받은 것"이 아니라 "받을 차례가 된 것"으로 세야 한다. 예전엔 못 받은 것으로
  //    셌기 때문에, 세트 이름이 틀렸다든지 해서 영영 못 받는 세트가 하나라도 있으면
  //    5분마다 영원히 다시 돌았다.
  const leftover = warmTargets().some((slug) => packWarmDue(packPriceCache.get(slug)))
  // 한도에 걸려서 접은 것이면 풀리는 시각까지 기다렸다 온다(5분마다 두드리지 않는다).
  // 방문자 몫을 남기려고 접은 것이면 하루치가 새로 차는 시각(한국시간 오전 9시)에 온다.
  if (leftover) {
    const until = outOfBudget ? nextUtcMidnight() : pptBlockedUntil
    // 아래 한도(30분)는 안전장치다. 실패한 세트는 위 packWarmDue가 6시간 막아 주지만,
    // 이 타이머까지 5분이면 그 사이 서른 번 헛되이 깨어난다.
    const wait = Math.max(30 * 60_000, until - Date.now() + 5_000)
    setTimeout(() => 던지기('시세 미리받기', warmPackPrices(apiKey)), wait)
  }
}

// PPT는 limit을 크게 줘도 한 번에 200행까지만 준다(offset으로 이어받기는 된다 —
// 처음엔 이걸 몰라서 세트의 앞번호 카드들이 통째로 잘렸다. 리자몽=6번이 그래서 빠졌다).
const PPT_PAGE = 200

type 저쪽카드 = { cardNumber?: string; name?: string; setName?: string; prices?: { market?: number } }

async function fetchSetPage(
  setName: string,
  lang: string,
  apiKey: string,
  offset: number,
): Promise<저쪽카드[] | null> {
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
  const j = (await r.json()) as { data?: 저쪽카드[] }
  return Array.isArray(j.data) ? j.data : []
}

/**
 * 세트 하나를 **한 번에** 받는다(fetchAllInSet).
 *
 * 왜 이게 나은가: 나눠 받으면 카드 한 장이 **분당 한도 1**을 먹어서, 484장짜리 세트
 * 하나에 분당 484가 나간다(한도는 500). 그래서 페이지 사이에 1분씩 쉬어야 했다.
 * 한 번에 받으면 **분당 30**만 먹는다 — 2026-08-07 실측:
 *     새 분에 남은 한도 499 → SV4a(484장)를 통째로 받은 뒤 468 (30 씀)
 * 문서의 "Math.ceil(장수/10), 최대 30"과 맞는다. **16배 아낀다.**
 * 하루 크레딧은 그대로 장당 1이라 총량은 안 바뀐다 — 빨라지는 것뿐이다.
 *
 * ⚠️ 그래서 예산 계산(noteFillSpend)은 **장수 그대로** 세어야 한다. 분당 한도가
 *    싸다고 하루 예산까지 싸진 게 아니다.
 */
async function fetchWholeSet(setName: string, lang: string, apiKey: string): Promise<저쪽카드[] | null> {
  if (!pptGate().ok) return null
  const r = await fetch(
    `${PRICE_TRACKER_ORIGIN}/cards?language=${lang}&setName=${encodeURIComponent(setName)}&fetchAllInSet=true`,
    {
      // 세트 하나를 통째로 주므로 느릴 수 있다(878장짜리도 있다).
      signal: AbortSignal.timeout(90_000),
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    },
  )
  notePpt(r.status, r.headers)
  if (!r.ok) return null
  const j = (await r.json()) as { data?: 저쪽카드[] }
  return Array.isArray(j.data) ? j.data : []
}

/**
 * 받아 온 줄들을 번호별 시세로 담는다. 통째로 받든 나눠 받든 규칙이 같아야 한다 —
 * 다르면 같은 카드가 받는 길에 따라 다른 값을 갖게 된다.
 */
/**
 * ⚠️⚠️ **저쪽 세트 검색은 부분일치다.** 이름이 남의 이름 안에 들어가면 그 세트까지
 *    통째로 딸려 온다(2026-08-08 실측):
 *        setName="EX Dragon"   → 201장 (EX Dragon 100 + EX Dragon Frontiers 101)
 *        setName="Base Set"    → SM Base Set 50 + XY Base Set 50 (진짜 Base Set은 0장)
 *        setName="Celebrations"→ Celebrations 39 + Classic Collection 25
 *    그런데 여기서는 번호를 **앞자리만** 쓴다("97/97"도 "97/101"도 그냥 "97").
 *    그래서 두 세트의 97번이 한 칸에 들어가 **싼 값으로 덮인다**
 *    (EX Dragon 라이쿠자 $484.98 ↔ Frontiers 라이쿠자 $490).
 *    게다가 EX Dragon은 97장뿐인데 Frontiers의 98~101번이 없는 카드로 생긴다.
 *    이 값은 세트별 "값 높은 카드"와 카드 뽑기 앨범에 그대로 나간다.
 *    → **부른 세트와 이름이 다른 줄은 버린다.**
 */
function 담기(
  list: 저쪽카드[],
  prices: Record<string, number>,
  names: Record<string, string>,
  basePriced: Set<string>,
  부른세트?: string,
  slug?: string,
): void {
  // ⚠️ **다 버리게 되면 아무것도 안 버린다.** 우리가 적어 둔 이름과 저쪽이 돌려주는
  //    이름이 대소문자 하나라도 다르면 그 세트가 통째로 값이 빈 채로 나갈 수 있다.
  //    거르는 것보다 세트가 통째로 비는 쪽이 훨씬 나쁘다.
  const 같은세트 = (a?: string, b?: string) =>
    !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase()
  const 우리것 = 부른세트 ? list.filter((c) => 같은세트(c.setName, 부른세트)) : list
  // ⚠️ **속 세트만 메움감으로 쓴다 — "부른 이름 + 콜론"인 것.** 아무 딴 세트나 쓰면
  //    아까 고친 섞임이 되돌아온다("EX Dragon"에 Dragon Frontiers의 98~101번이
  //    없는 카드로 생긴다). 덤프로 채우는 길과 같은 규칙이다.
  const 딴것 = 부른세트
    ? list.filter((c) => !같은세트(c.setName, 부른세트) && String(c.setName ?? '').startsWith(부른세트 + ':'))
    : []
  const 버린수 = 부른세트 ? list.length - 우리것.length - 딴것.length : 0
  if (list.length && !우리것.length) {
    console.log(`[pokegre] "${부른세트}" — 이름이 맞는 줄이 하나도 없어 그대로 씁니다(${list.length}장).`)
  }
  // ⚠️⚠️ **딴 세트 줄을 통째로 버리면 안 된다.** 저쪽이 딴 세트로 떼어 놓은 것을
  //    우리는 한 세트로 묶어 두는 경우가 있다:
  //        en-g1 제너레이션즈 117장 = 본편 85장 + **RC1~RC32(래디언트 컬렉션)**
  //        저쪽은 RC를 "Generations: Radiant Collection"이라는 딴 세트로 둔다
  //    처음엔 딴 세트 줄을 다 버렸더니 **RC5 리자몽**(그 세트에서 제일 비싼 카드)이
  //    통째로 사라졌다(2026-08-08). 같은 일이 en-bw11·SWSH 트레이너갤러리에도 난다.
  //    → **우리 세트가 못 채운 번호만** 딴 세트 줄로 메운다. 번호가 겹치는 곳
  //      (EX Dragon 97 ↔ Dragon Frontiers 97)은 우리 세트가 이미 채웠으므로 안 밀린다.
  const 이미 = new Set<string>()
  let 메움 = 0
  const 한줄 = (c: 저쪽카드, 보조: boolean): void => {
    // cardNumber가 빈 카드가 있어서 이름 꼬리("Zekrom ex - 174/086")로도 받아본다.
    // ⚠️⚠️ **옛 일본판은 저쪽에 번호가 아예 없다.** 확장팩 제1탄 102장이 전부 빈칸이다.
    //    그래서 **이름으로** 우리 번호를 찾아야 한다(setCardNumberAlias의 "NAME:" 표).
    //    덤프로 채우는 길은 이미 그렇게 하는데 여기(라이브)만 빠져 있었다. 그 결과
    //    번호가 전부 빈칸 → stripZeros('')가 "0"을 돌려줘 **0번 한 칸에 102장이
    //    몰리고, 그중 제일 싼 에너지 카드 $0.44가 그 세트의 1등 카드로 나갔다**
    //    (2026-08-08, ja-PMCG1·ja-PMCG4에서 실제로 그랬다).
    const 되돌림 = slug
      ? 번호되돌리기(slug, String(c.cardNumber ?? ''), String(c.name ?? ''))
      : String(c.cardNumber ?? '')
    const rawNum = 되돌림 || (String(c.name ?? '').match(/ (\d+)\/\d+$/)?.[1] ?? '')
    // ⚠️ **빈 번호를 stripZeros에 넘기면 안 된다** — "0"이 되어 없는 카드가 생긴다.
    if (!rawNum.trim()) return
    const num = stripZeros(rawNum.split('/')[0].trim())
    const market = c.prices?.market ?? 0
    if (!num || market <= 0) return
    // 딴 세트 줄은 **우리 세트가 안 채운 번호에만** 쓴다.
    if (보조 && 이미.has(num)) return
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
    if (보조) 메움++
    else 이미.add(num)
  }

  // ⚠️ **이름이 맞는 줄이 하나도 없으면 아무것도 안 버린다.** 우리가 적어 둔 이름과
  //    저쪽 이름이 언젠가 어긋나면, 거르는 바람에 그 세트가 통째로 빈 채로 나간다.
  const 본줄 = 우리것.length ? 우리것 : list
  for (const c of 본줄) 한줄(c, false)
  for (const c of 딴것) 한줄(c, true)
  if (버린수 || 메움) {
    console.log(
      `[pokegre] "${부른세트}" — 딴 세트 ${버린수}장을 버리고, 속 세트 ${메움}장으로 빈 번호를 메웠습니다.`,
    )
  }
}

// pages: 최대 몇 페이지까지 받을지. pauseMs: 페이지 사이 쉬는 시간 — 분당 크레딧이
// 500이고 페이지 하나가 200이라, 세 페이지째부터는 1분을 넘겨 받아야 한다.
// ⚠️ 이제는 **먼저 통째로 받아 보고**(fetchWholeSet) 안 될 때만 이 길로 온다.
async function getSetPrices(
  slug: string,
  apiKey: string,
  opts: { pages?: number; pauseMs?: number } = {},
): Promise<Record<string, number> | null> {
  const setName = SET_NAMES[slug]
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

    // ① 먼저 **한 번에** 받아 본다(fetchAllInSet). 분당 한도를 16배 아낀다 — 위
    //    fetchWholeSet 설명 참고. 되면 페이지를 나눌 이유가 없다.
    //    ⚠️ 하루 예산은 여전히 장수만큼 나간다. 받아 온 장수를 그대로 센다.
    const 통째 = await fetchWholeSet(setName, lang, apiKey)
    if (통째 && 통째.length) {
      noteFillSpend(통째.length)
      담기(통째, prices, names, basePriced, setName, slug)
      complete = true
    }

    // ② 통째로 못 받았을 때만 예전처럼 나눠 받는다(429거나 저쪽이 거절했을 때).
    for (let p = 0; !complete && p < pages; p++) {
      // 방문자 몫은 페이지마다 다시 본다. 세트 단위로만 보면 검사를 통과한 뒤
      // 한 세트가 최대 5장(1,000크레딧)을 더 써서 그만큼 넘어선다.
      // ⚠️ 첫 장은 그냥 간다 — 여기서 멈추면 앞번호만 받고 만 partial이 되어
      //    다음 바퀴에 처음부터 다시 받게 되고, 오히려 더 쓴다.
      if (p > 0 && pptLeftNow() < PPT_KEEP_FOR_VISITORS) break
      // 한 장에 PPT_PAGE(200)만큼 나간다. 헤더만 믿지 않고 직접 센다.
      noteFillSpend(PPT_PAGE)
      const list = await fetchSetPage(setName, lang, apiKey, p * PPT_PAGE)
      if (list === null) {
        // 첫 페이지부터 실패(429 등)면 이전 캐시라도 쓴다. 뒤 페이지 실패면 받은 만큼(partial) 저장.
        if (p === 0) {
          // ⚠️ 실패해도 "시도했다"는 것만은 남긴다. 안 남기면 '아직 못 받은 세트'로
          //    계속 잡혀 5분마다 처음부터 다시 받으러 간다(2026-08-02 크레딧 소진 원인).
          packPriceCache.set(slug, {
            at: hit?.at ?? 0,
            prices: hit?.prices ?? {},
            ...(hit?.names ? { names: hit.names } : {}),
            partial: true,
            triedAt: Date.now(),
          })
          return hit?.prices ?? null
        }
        break
      }
      담기(list, prices, names, basePriced, setName, slug)
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
      triedAt: Date.now(),
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
  // ⚠️ PPT 상태(남은 크레딧·차단 시각)를 먼저 읽어야 한다. 안 읽고 데우러 나가면
  //    "남은 크레딧을 모른다(=무한대)" 상태라 방문자 몫을 지키는 검사가 통과된다.
  //    배포마다 이 구멍으로 크레딧이 샜다(2026-08-02).
  void Promise.all([
    loadPptState(),
    // 어제까지 받아 둔 스니커덩크 힛카드. 배포로 서버가 새로 떠도 이어받는다.
    loadSnkrdunkHitCards(),
    // 어제 덤프에서 뽑아 둔 "이름 + 레어도". 배포로 서버가 새로 떠도 이어받는다.
    loadRarityTerms(),
    loadPackPriceFile(),
    loadLastPrices(),
    loadJsonMap(POPULATION_FILE, populationCache as Map<string, unknown>, '감정 수량'),
    loadJsonMap(EBAY_GRADE_FILE, ebayGradeCache as Map<string, unknown>, '등급별 낙찰'),
  ]).then(() => {
    if (process.env.NODE_ENV === 'production') {
      // ⚠️ **통째 받기를 먼저 한다.** 전체 시세를 한 파일로 주므로, 이걸로 채우고 나면
      //    세트별로 부를 일이 거의 없다(우리 세트 371개 중 331개가 여기서 찬다).
      //    순서를 바꾸면 세트별 호출이 먼저 크레딧을 쓰고 덤프가 그걸 덮어쓰는 낭비가 된다.
      setTimeout(() => {
        // ⚠️ **.catch를 꼭 붙인다.** .finally는 예외를 받아 주지 않는다. 안 받으면
        //    Node가 프로세스를 내린다 — 하루 한 번 도는 일이 서버를 죽이는 셈이다.
        void runDailyExports(pptApiKey)
          .catch((e) => console.log(`[pokegre] 통째 받기 중 오류: ${String(e).slice(0, 120)}`))
          .finally(() => 던지기('시세 미리받기', warmPackPrices(pptApiKey)))
      }, 5_000)
      setInterval(() => 던지기('시세 미리받기', warmPackPrices(pptApiKey)), 60 * 60 * 1000) // 매시간 점검
      // 하루가 바뀌면(UTC 0시 = 한국시간 오전 9시) 다시 받을 차례가 온다. 함수 안에서
      // "오늘 이미 받았으면 건너뛴다"를 보므로 자주 불러도 한 번만 실제로 받는다.
      setInterval(() => 던지기('통째 받기', runDailyExports(pptApiKey)), 60 * 60 * 1000)

      // ⚠️ **신상 일본판 힛카드는 스니커덩크로 매일 받는다.** 저쪽(PPT)은 미국 마켓이라
      //    갓 나온 일본판의 값이 비어 있다(스톰에메랄다 116줄 중 54줄이 값 0, 제일 비싼
      //    113번은 $0 · 2026-08-08 덤프 확인). 스니커덩크는 무료라 크레딧이 안 든다.
      //    기동 20초 뒤에 한 번(다른 일이 끝난 뒤), 그 뒤 1시간마다 확인한다 —
      //    함수 안에서 "오늘 이미 받았으면 건너뛴다"를 보므로 실제로는 하루 한 번이다.
      setTimeout(() => 던지기('힛카드 갱신', refreshSnkrdunkHitCards()), 20_000)
      setInterval(() => 던지기('힛카드 갱신', refreshSnkrdunkHitCards()), 60 * 60 * 1000)
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
      // ── 개발용 시험 로그인 (GET /api/local/auth/dev) ────────────────────────
      //
      // 카카오·네이버는 등록된 주소로만 돌려보내므로 로컬(localhost)에서는 로그인이
      // 안 된다. 그래서 개봉·앨범처럼 로그인이 있어야 보이는 화면을 로컬에서 시험할
      // 길이 없었다(2026-08-05).
      //
      // ⚠️⚠️ 이건 **인증을 건너뛰는 문**이다. 두 겹으로 잠가 둔다:
      //    ① 환경변수 DEV_LOGIN=1 이 있어야 한다 — 프로덕션(Fly)에는 절대 넣지 말 것.
      //    ② 그래도 요청이 localhost로 온 것이 아니면 거절한다. 환경변수를 실수로
      //       넣더라도 바깥에서는 못 쓴다.
      //    둘 중 하나라도 어긋나면 404처럼 조용히 막는다(있다는 사실도 안 알린다).
      if (segments[0] === 'dev') {
        const host = (req.headers.host ?? '').split(':')[0]
        const 로컬 = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
        if (process.env.DEV_LOGIN !== '1' || !로컬) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        // 시험 계정은 하나로 고정한다. 새로 만들 때마다 앨범이 비면 시험이 안 된다.
        await signIn(req, res, 'kakao', 'dev-test-account')
        return
      }

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
          // ⚠️ 되살린 개봉 결과에도 값을 붙인다. store.last에는 번호·등급만 적어 두므로
          //    그대로 주면 새로고침한 순간 카드값이 통째로 사라진다(2026-08-05 점검에서
          //    잡음 — 개봉 직후에는 값이 보이는데 새로고침하면 안 보였다).
          last: store.last ? { ...store.last, cards: withUsd(store.last.slug, store.last.cards) } : store.last,
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
        store.balance = capAdd(store.balance, reward)
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
      // (AR 3장·RR 4~5장·SR이상 1장·ACE/마스터볼), 영문판 박스는 순수 독립시행.
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
        const cards = await readPackCards(pack)
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
        // 홈 배너용 기록. 실패해도 개봉은 정상이라야 하므로 여기서 죽지 않게 감싼다.
        const hiBoxN = await noteHighlight(pack.slug, flat, box.god, user).catch(() => null)
        sendJson(res, 200, {
          ...(hiBoxN ? { highlight: hiBoxN } : {}),
          packs: box.packs.map((bp) => ({ ...bp, cards: withUsd(pack.slug, bp.cards) })),
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
        const cards = await readPackCards(pack)
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
        // 홈 배너용 기록. 실패해도 개봉은 정상이라야 하므로 여기서 죽지 않게 감싼다.
        const hiN = await noteHighlight(pack.slug, drawn.cards, drawn.god, user).catch(() => null)
        sendJson(res, 200, { cards: withUsd(pack.slug, drawn.cards), god: drawn.god, balance: store.balance, opened: store.opened, packs: store.packs ?? {}, unlimited, ...(hiN ? { highlight: hiN } : {}) })
        return
      }

      // POST /packsim/highlight-name — 방금 배너에 오른 카드의 한글 이름만 채운다.
      // 서버엔 번역기가 없고, 홈은 사전을 안 받는다(사전이 내려받는 양의 절반이라
      // 첫 화면을 무겁게 한다 — 91KB로 줄여 둔 걸 되돌리게 된다). 그래서 사전을 이미
      // 들고 있는 개봉 화면이 대신 알려 준다. 안 보내도 배너는 이름 없이 뜬다.
      if (segments[0] === 'packsim' && segments[1] === 'highlight-name' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const b = JSON.parse((await readBody(req)) || '{}') as { n?: unknown; name?: unknown }
        const n = String(b.n ?? '')
        const name = typeof b.name === 'string' ? b.name : ''
        if (!n || !name) {
          sendJson(res, 400, { error: 'bad request' })
          return
        }
        const ok = await fillHighlightName(user.id, n, name)
        sendJson(res, 200, { ok })
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
        // 카드·등급·갓팩 여부는 서버가 기억하는 값만 쓴다(조작 불가). 한글 이름 표기만
        // 화면이 보내준다 — 서버에 번역기를 들이는 것보다 가볍고, 이름은 표기일 뿐이라
        // 속여도 자기 자랑글이 이상해질 뿐이다. 길이만 자르고 줄바꿈은 뗀다.
        //
        // ⚠️ 이 읽기·해석은 반드시 아래 shared=true보다 먼저 와야 한다. 뒤에 두면 본문이
        //    깨져 들어왔을 때 자리는 이미 잡힌 채로 터져서, 글은 안 올라가고 자랑 기회만
        //    사라진다(되돌리는 코드가 아직 만들어지기 전이다).
        let body: { names?: unknown; comment?: unknown; title?: unknown }
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch {
          sendJson(res, 400, { error: 'bad body' })
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
          store.balance = capAdd(store.balance, SHARE_BONUS)
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
        const nameOf = new Map<string, string>()
        if (body.names && typeof body.names === 'object') {
          for (const [k, v] of Object.entries(body.names as Record<string, unknown>)) {
            if (typeof v === 'string') nameOf.set(String(k), v.replace(/\s+/g, ' ').trim().slice(0, 60))
          }
        }
        const cards = await readPackCards(pack)
        const byN = new Map(cards.map((c) => [c.n, c]))
        // 자랑글에 쓸 등급 약칭. 일본판은 풀아트를 SR, 금색을 UR이라 부르고 영문판은
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
        // ⚠️ 값(usd)을 붙여 둔다. 자랑글에 실을 12장을 **값 높은 순**으로 고르기 위해서다
        //    (운영자 지시 2026-08-05). 예전엔 등급 순이었는데, 개봉 화면은 값 순이라
        //    같은 박스인데 화면의 1등과 글 제목의 카드가 서로 달랐다.
        const drawn = withUsd(
          pack.slug,
          last.cards
            .map((lc) => {
              const base = byN.get(lc.n)
              return base ? { ...base, r: lc.r ?? base.r, m: lc.m } : null
            })
            .filter((c): c is NonNullable<typeof c> => !!c),
        )
        // ⚠️ 한 장도 못 맞추면 아래 best가 undefined가 되어 제목을 만들다 터진다. 그런데
        //    위에서 이미 shared=true로 자리를 잡아 뒀으므로, 되돌리지 않으면 글은 안
        //    올라가고 자랑 기회만 영영 사라진다. 카드 번호가 안 맞는 건 세트 자료가
        //    바뀐 뒤(배포 직후) 예전에 연 팩을 자랑할 때 생긴다.
        if (!drawn.length) {
          rollback()
          sendJson(res, 400, { error: 'no pack' })
          return
        }
        const mLabel = (m?: MirrorFlag) => (m === 'master' ? ' (마스터볼 미러)' : m === 'poke' ? ' (몬스터볼 미러)' : m === 'rev' ? ' (리버스)' : '')
        const koN = (c: { n: string; name: string; m?: MirrorFlag }) => (nameOf.get(c.n) || c.name) + mLabel(c.m)
        // 제목에 쓸 대표 카드도 값 높은 순. 값을 모르는 세트(시세 미수신)면 등급으로 정한다.
        const 낫다 = (a: (typeof drawn)[number], b: (typeof drawn)[number]) => {
          const av = a.usd ?? 0
          const bv = b.usd ?? 0
          if (av !== bv) return av > bv
          return (rank[a.r ?? ''] ?? 0) > (rank[b.r ?? ''] ?? 0)
        }
        const best = drawn.reduce((a, b) => (낫다(b, a) ? b : a), drawn[0])
        const packName = pack.label.replace(/^\[.+?\]\s*/, '')
        // 제목은 이용자가 쓴 것을 우선하고, 없으면 자동 제목.
        const userTitle = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
        const title =
          userTitle ||
          (last.god ? `갓팩! ${packName} 전부 AR 이상` : `${packName} 개봉 — ${koN(best)} ${tierKo[best.r ?? ''] ?? ''}`.trim())
        // 본문은 이용자가 쓴 글. 카드 목록은 pull(이미지 그리드)로 보여주므로 글이 없으면
        // 짧은 기본 문장만 넣는다.
        const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 1000) : ''
        const content = comment || `${pack.jp ? '일본판' : '영문판'} ${packName} ${last.box ? '박스를' : '팩을'} 열었습니다.`
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
            // 값 낮은 순으로 세워 뒤에서 12장 = 값 높은 12장(마지막이 제일 비싼 카드).
            // 값이 같으면 등급으로 가른다.
            //
            // ⚠️ 그 전에 **같은 카드는 한 장으로 묶는다**(운영자 지시 2026-08-05).
            //    박스는 30팩이라 같은 레어가 서너 장씩 나온다. 안 묶으면 12칸 가운데
            //    7칸이 세 종류로 채워져 "좋은 카드 12장"이 같은 그림만 늘어놓는 꼴이
            //    된다(실제로 그랬다). 대신 몇 장 나왔는지를 q로 실어 화면이 ×3으로
            //    적는다 — 여러 장 나온 것도 자랑거리라 숨기지는 않는다.
            //    묶는 기준은 카드 번호 + 미러 종류다. 미러는 다른 카드로 친다.
            cards: (() => {
              const 묶음 = new Map<string, { c: (typeof drawn)[number]; q: number }>()
              for (const c of drawn) {
                const key = `${c.n}|${c.m ?? ''}`
                const hit = 묶음.get(key)
                if (hit) hit.q += 1
                else 묶음.set(key, { c, q: 1 })
              }
              return [...묶음.values()]
                .sort(
                  (a, b) =>
                    (a.c.usd ?? 0) - (b.c.usd ?? 0) || (rank[a.c.r ?? ''] ?? 0) - (rank[b.c.r ?? ''] ?? 0),
                )
                .slice(-PULL_CARD_LIMIT)
                .map(({ c, q }) => ({
                  img: c.img ?? '',
                  name: koN(c),
                  r: tierKo[c.r ?? ''] ?? c.r ?? '',
                  ...(q > 1 ? { q } : {}),
                }))
            })(),
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
        // ⚠️ 여기서는 시세를 **새로 받지 않는다**(2026-08-03 사용자와 정함).
        //    예전에는 낡은 세트를 만나면 그 자리에서 받아왔다. 그러면 크레딧이 얼마나
        //    나갈지 아무도 모른다 — 사람이 늘고 앨범에 세트가 쌓일수록 늘어나고,
        //    방문자 몫을 지키는 안전장치도 이 길에는 안 걸려 있었다.
        //    이제 갱신은 순번제 미리받기(warmTargets)가 전담한다. 어느 세트든 7일 안에
        //    갱신되므로, 앨범은 저장된 값을 그대로 보여주면 된다.
        //    → 앨범을 아무리 많이 열어도 크레딧은 0이다.
        for (const slug of slugs) {
          const cached = packPriceCache.get(slug)
          if (Object.keys(cached?.prices ?? {}).length) {
            prices[slug] = cached!.prices
            if (cached!.names) names[slug] = cached!.names
            continue
          }
          // 아직 한 번도 못 받은 세트만 "준비 중"으로 알린다. 순번제가 제일 먼저 채운다.
          if (SET_NAMES[slug]) pending.push(slug)
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
// 앨범 시세를 안 받는 세트용. scripts/fetch-set-hit-cards.mjs가 미리 받아 둔 값을 읽는다.
// 앨범 시세(packPriceCache)는 매일 갱신되는 22세트뿐이라, 나머지는 이 파일이 채운다.
// 한 번 읽고 계속 들고 있는다(배포할 때마다 새로 읽힌다).
// src는 어디서 받은 값인지. 'snkrdunk'면 일본 마켓 실거래가라 PPT보다 먼저 쓴다
// (없으면 예전처럼 PPT에서 받은 것으로 본다).
let hitCardFile: Record<
  string,
  // grade는 스니커덩크에서 받은 것만 있다. 'psa10'(감정 10등급) 또는 'a'(미감정 거의 미사용).
  { at: number; src?: string; grade?: string; cards: { n: string; usd: number }[] }
> | null = null
// ── 신상 일본판 힛카드를 스니커덩크로 매일 갱신 ─────────────────────────────
//
// 왜 필요한가: 힛카드는 원래 PPT(미국 마켓) 시세로 뽑는데, **갓 나온 일본판은 미국에
// 자료가 얇다.** 스톰에메랄다(2026-07-31)를 재 보니 116줄 중 54줄(47%)이 값 0이고,
// 제일 비싼 113번(MUR 메가레쿠쟈)은 카드는 있는데 값이 $0이었다(2026-08-08 덤프 확인).
// 그래서 스니커덩크(일본 마켓 실거래)로 받아 두었는데, **한 번 받아 파일에 박아 둔 것**
// 이라 사흘이 지나도 그대로였다. 홈 첫 화면에서 제일 큰 값이 사흘 묵은 값이었다.
//
// → 서버가 **하루 한 번** 다시 받는다. 스니커덩크는 무료라 크레딧이 안 든다.
// ⚠️ 스니커덩크는 예전에 자동완성을 글자마다 부르다 **차단당한 적이 있다.** 그래서
//    ① 하루 한 번만 ② 세트 하나만 ③ 요청 사이를 700ms 띄우고 ④ 후보 카드를 60장으로
//    묶는다. 한 번 도는 데 1~2분이고 요청은 100번 안쪽이다.
// ⚠️ 결과는 **/data에 적는다.** src/data/setHitCards.json은 배포 이미지 안이라 못 고치고,
//    고쳐도 다음 배포에 덮인다. /data는 볼륨이라 배포해도 남는다.
const HIT_SNKRDUNK_FILE = dataFile('hit-cards-snkrdunk.json')
const SNKRDUNK_HOST = 'https://snkrdunk.com'
const SNKRDUNK_UA = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; pokegre/0.1; personal use)' }
// 미감정 "거의 미사용". 화면의 다른 값(TCGplayer 마켓가)과 잣대를 맞춘다.
const SNKRDUNK_COND_A = 'trading_card_single_nearly_unused'
// 값이 높은 카드는 특별 등급이다. 커먼까지 훑으면 시간만 걸리고 힛카드엔 못 든다.
const HIT_RARITY = new Set([
  'Double rare', 'Illustration rare', 'Ultra Rare', 'Special illustration rare',
  'Hyper rare', 'Mega Ultra Rare', 'Mega Hyper Rare', 'ACE SPEC Rare',
])
const HIT_MAX_TARGETS = 60
const HIT_SHOWN = 8
const 쉬기 = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 갱신될 때마다 1씩 는다. 홈(latest-hit-set)이 담아 둔 값이 옛것인지 이걸로 안다.
let 힛카드판번호 = 0
let 스니덩힛카드: Record<string, { at: number; src: string; grade: string; cards: { n: string; usd: number }[] }> = {}

async function loadSnkrdunkHitCards(): Promise<void> {
  try {
    스니덩힛카드 = JSON.parse(await readFile(HIT_SNKRDUNK_FILE, 'utf-8'))
    const 몇 = Object.keys(스니덩힛카드).length
    if (몇) console.log(`[pokegre] 스니커덩크 힛카드 ${몇}세트를 이어받았습니다.`)
  } catch {
    스니덩힛카드 = {}
  }
}

async function 스니덩찾기(keyword: string): Promise<{ title: string; link: string }[]> {
  const params = new URLSearchParams({
    func: 'all', refId: 'search', keyword, sortKey: 'default',
    cardVersion: '2', brandIds: 'pokemon', perPage: '24', page: '1',
  })
  try {
    const r = await fetch(`${SNKRDUNK_HOST}/v3/search?${params}`, { headers: SNKRDUNK_UA, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return []
    const d = (await r.json()) as { search?: { products?: { title?: string; link?: string }[]; rankingProducts?: { title?: string; link?: string }[] } }
    const list = d.search?.products?.length ? d.search.products : (d.search?.rankingProducts ?? [])
    return list.filter((p): p is { title: string; link: string } => Boolean(p.link && p.title))
  } catch {
    return []
  }
}

/** 그 카드의 실거래가(엔). **최근 3건의 중앙값** — 1건만 쓰면 튄 거래 하나가 그대로 뜬다. */
async function 스니덩실거래(apparelId: string): Promise<number | null> {
  try {
    const a = await fetch(`${SNKRDUNK_HOST}/v1/apparels/${apparelId}`, { headers: SNKRDUNK_UA, signal: AbortSignal.timeout(15_000) })
    if (!a.ok) return null
    const pid = ((await a.json()) as { productCatalogId?: string }).productCatalogId
    if (!pid) return null
    await 쉬기(400)
    const t = await fetch(
      `${SNKRDUNK_HOST}/v3/products/${pid}/trading-history?range=all&condition_code=${SNKRDUNK_COND_A}`,
      { headers: SNKRDUNK_UA, signal: AbortSignal.timeout(15_000) },
    )
    if (!t.ok) return null
    const trades = ((await t.json()) as { trades?: { price?: number }[] }).trades ?? []
    const ok = trades.map((x) => Number(x.price)).filter((v) => Number.isFinite(v) && v > 0)
    if (!ok.length) return null
    const 셋 = ok.slice(0, 3).sort((x, y) => x - y)
    return 셋[Math.floor(셋.length / 2)]
  } catch {
    return null
  }
}

/**
 * 오늘 스니커덩크로 받아야 할 세트 하나를 고른다.
 *
 * 기준: **발매 6개월 이내 일본판** 중, PPT 시세로는 힛카드 3장을 못 채우는 것.
 * 세트를 손으로 박지 않는다 — 새 팩이 나오면 저절로 그쪽으로 옮겨간다.
 * ⚠️ 한 번에 하나만 고른다. 스니커덩크에 부담을 주지 않으려는 것이다.
 */
async function 오늘받을세트(): Promise<{ slug: string; name: string } | null> {
  try {
    const raw = await readFile(path.resolve(process.cwd(), 'dist/sets/index.json'), 'utf-8').catch(() =>
      readFile(path.resolve(process.cwd(), 'public/sets/index.json'), 'utf-8'),
    )
    const idx = JSON.parse(raw) as { slug: string; ed?: string; name?: string; releaseDate?: string }[]
    const 반년전 = new Date(Date.now() - 182 * DAY_MS).toISOString().slice(0, 10)
    const 후보 = idx
      .filter((s) => s.ed === 'ja' && s.releaseDate && s.releaseDate >= 반년전)
      .sort((a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)))
    // ⚠️ **"저쪽에 값이 몇 장 있나"로 가르면 안 된다.** 처음엔 "PPT로 힛카드 3장을 못
    //    채우는 세트"만 받게 했는데, 배포하고 보니 **한 번도 안 돌았다**(2026-08-08).
    //    스톰에메랄다에 저쪽 값이 **34장이나** 있어서 그 검사를 통과해 버린 것이다.
    //    문제는 개수가 아니라 **어느 카드에 값이 없느냐**였다:
    //      저쪽 1등  110번 $844      ← 이건 있다
    //      실제 1등  113번 MUR       ← **저쪽은 $0**, 스니커덩크는 $1,351
    //    갓 나온 일본판은 제일 비싼 카드일수록 미국 마켓에 안 팔려 값이 빈다.
    //    → 개수를 안 본다. **발매 6개월 이내 일본판 중 가장 최근 것**을 매일 받는다.
    //      스니커덩크는 무료라 크레딧이 0이고, 하루 한 세트뿐이라 부담도 없다.
    if (후보[0]) return { slug: 후보[0].slug, name: String(후보[0].name ?? '') }
  } catch {
    // 못 고르면 그냥 넘어간다.
  }
  return null
}

/** 그 세트의 힛카드를 스니커덩크에서 새로 받아 /data에 적는다. */
async function refreshSnkrdunkHitCards(): Promise<void> {
  const 세트 = await 오늘받을세트()
  if (!세트) return
  // 오늘 이미 받았으면 건너뛴다(배포로 서버가 여러 번 떠도 하루 한 번이다).
  const 이전 = 스니덩힛카드[세트.slug]
  if (이전 && kstDateStr(이전.at) === kstDateStr()) return

  let cards: { n: string; name: string; r?: string }[] = []
  try {
    const raw = await readFile(path.resolve(process.cwd(), `dist/sets/${세트.slug}.json`), 'utf-8').catch(() =>
      readFile(path.resolve(process.cwd(), `public/sets/${세트.slug}.json`), 'utf-8'),
    )
    cards = (JSON.parse(raw) as { cards?: typeof cards }).cards ?? []
  } catch {
    return
  }
  const 후보 = cards.filter((c) => c.r && HIT_RARITY.has(c.r)).slice(0, HIT_MAX_TARGETS)
  if (후보.length < 3) return

  const 코드 = 세트.slug.replace(/^ja-/, '')
  // ⚠️ **세트 코드를 정규식에 그대로 넣으면 안 된다.** 일본판 코드 5개에 `+`가 들어
  //    있다(SM1+ · sm2+ · SM3+ · SM4+ · SM5+). `\[SM3+\s`는 정규식에서 "SM" 뒤에
  //    3이 하나 이상"이라는 뜻이 되어, **딴 세트인 [SM3 …]에 걸리고 정작 자기 것인
  //    [SM3+ …]은 못 찾는다**(2026-08-08 확인). 그 세트의 힛카드에 딴 세트 값이 붙는다.
  const 코드정규식 = 코드.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 세트 이름으로 한 번 찾으면 그 세트 상품이 한꺼번에 온다 — 카드마다 찾는 것보다 훨씬 적다.
  const 찾음 = new Map<string, string>()
  for (const kw of [세트.name, 코드].filter(Boolean)) {
    for (const p of await 스니덩찾기(kw)) {
      const m = p.title.match(new RegExp(`\\[${코드정규식}\\s+(\\d+)/`, 'i'))
      const id = p.link.match(/apparels\/(\d+)/)?.[1]
      if (m && id) 찾음.set(String(Number(m[1])), id)
    }
    await 쉬기(700)
  }

  const 값 = new Map<string, number>()
  for (const c of 후보) {
    const id = 찾음.get(번호열쇠(c.n))
    if (!id) continue
    const jpy = await 스니덩실거래(id)
    await 쉬기(700)
    if (jpy) 값.set(c.n, jpy)
  }
  if (값.size < 3) {
    console.log(`[pokegre] 힛카드 갱신(${세트.slug}): 실거래가 ${값.size}장뿐이라 그대로 둡니다.`)
    return
  }

  // 저장은 달러 기준이다(화면이 원화로 바꿀 때 쓰는 환율과 같은 곳에서 받는다).
  let usdJpy = 0
  try {
    const fx = (await fetch('https://api.frankfurter.app/latest?from=USD&to=JPY', { signal: AbortSignal.timeout(10_000) }).then((r) => r.json())) as { rates?: { JPY?: number } }
    usdJpy = Number(fx?.rates?.JPY ?? 0)
  } catch {
    usdJpy = 0
  }
  if (!usdJpy) {
    console.log(`[pokegre] 힛카드 갱신(${세트.slug}): 환율을 못 받아 그대로 둡니다.`)
    return
  }
  const 목록 = [...값.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, HIT_SHOWN)
    .map(([n, jpy]) => ({ n, usd: Math.round((jpy / usdJpy) * 100) / 100 }))

  스니덩힛카드[세트.slug] = { at: Date.now(), src: 'snkrdunk', grade: 'a', cards: 목록 }
  await mkdir(path.dirname(HIT_SNKRDUNK_FILE), { recursive: true })
  await writeJsonFile(HIT_SNKRDUNK_FILE, 스니덩힛카드)
  힛카드판번호++ // 홈이 담아 둔 값을 버리게 한다
  console.log(
    `[pokegre] 힛카드 갱신(${세트.slug} ${세트.name}): ${목록.length}장 · 1등 $${목록[0]?.usd} (스니커덩크 A등급)`,
  )
}

function loadHitCardFile() {
  if (!hitCardFile) {
    try {
      // 빌드가 dist로 옮겨 주지 않는 파일이라 소스 경로에서 읽는다(Dockerfile이 복사한다).
      hitCardFile = JSON.parse(readFileSync(path.resolve('src/data/setHitCards.json'), 'utf-8'))
    } catch {
      hitCardFile = {}
    }
  }
  // ⚠️ **매일 받아 둔 것(/data)이 배포에 딸려온 파일을 이긴다.** 배포 이미지 안의
  //    setHitCards.json은 사람이 스크립트를 돌린 날에 멈춰 있다 — 스톰에메랄다가
  //    사흘 묵어 있었다(2026-08-08). /data 쪽은 서버가 하루 한 번 새로 받는다.
  return { ...(hitCardFile ?? {}), ...스니덩힛카드 }
}

export function topPricedCards(slug: string, limit = 4): { n: string; usd: number; name: string }[] {
  const hit = packPriceCache.get(slug)
  const saved = loadHitCardFile()[slug]
  // ⚠️ 스니커덩크로 받아 둔 것(src:'snkrdunk')은 PPT보다 먼저 쓴다.
  //    PPT는 미국 마켓이라 일본판 신상은 제일 비싼 카드의 낙찰가가 없다. 실제로
  //    스톰에메랄드의 MUR 메가레쿠쟈(113번)는 PPT에 낙찰가가 없어 힛카드에서 통째로
  //    빠졌고, 2등 카드가 1등처럼 보였다(2026-08-05). 같은 카드가 스니커덩크에는
  //    실거래 20건에 ￥185,000으로 쌓여 있었다 — 2등의 2.3배다.
  //    일본판은 일본 마켓이 진짜 시세이고, 사이트의 다른 화면도 이미 그렇게 보여준다.
  if (saved?.src === 'snkrdunk' && saved.cards?.length) {
    const names = setCardNames(slug)
    return saved.cards
      .slice(0, limit)
      .map((c) => ({ n: c.n, usd: c.usd, name: names.get(번호열쇠(c.n)) ?? '' }))
  }
  if (!hit) {
    // 앨범 시세가 없으면 미리 받아 둔 파일을 본다. 이름은 세트 파일에서 번호로 찾는다.
    if (!saved?.cards?.length) return []
    const names = setCardNames(slug)
    return saved.cards
      .slice(0, limit)
      .map((c) => ({ n: c.n, usd: c.usd, name: names.get(번호열쇠(c.n)) ?? '' }))
  }
  return Object.entries(hit.prices)
    .filter(([n]) => !n.includes('~'))
    .map(([n, usd]) => ({ n, usd, name: hit.names?.[n] ?? '' }))
    .filter((r) => r.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, limit)
}

// 위 힛카드 값이 어느 마켓·어느 상태 기준인지 한 줄로. 검색 노출 페이지(server/index.ts)가
// 쓴다.
// ⚠️ 값과 라벨이 따로 놀면 안 된다. 예전엔 크롤러가 읽는 글에 "TCGplayer 마켓가"라고
//    박아 놨는데, topPricedCards는 세트에 따라 스니커덩크 값을 준다. 스톰에메랄드가
//    스니커덩크 값 $1,302를 띄우면서 TCGplayer 기준이라고 적고 있었다(2026-08-05).
export function topPricedBasis(slug: string): string {
  const saved = loadHitCardFile()[slug]
  if (saved?.src === 'snkrdunk' && saved.cards?.length) {
    return saved.grade === 'psa10' ? 'SNKRDUNK 실거래 · PSA10' : 'SNKRDUNK 실거래 · 미감정(A등급)'
  }
  return 'TCGplayer 마켓가 · 미감정'
}

// 세트 파일에서 번호 → 이름·그림. 힛카드 파일에는 번호와 값만 있어서 여기서 채운다.
const setCardCache = new Map<string, Map<string, { name: string; img: string }>>()
function setCards(slug: string): Map<string, { name: string; img: string }> {
  const hit = setCardCache.get(slug)
  if (hit) return hit
  const out = new Map<string, { name: string; img: string }>()
  for (const base of ['dist/sets', 'public/sets']) {
    try {
      const d = JSON.parse(readFileSync(path.resolve(base, `${slug}.json`), 'utf-8')) as {
        cards?: { n: string; name?: string; img?: string }[]
      }
      for (const c of d.cards ?? []) out.set(번호열쇠(c.n), { name: c.name ?? '', img: c.img ?? '' })
      break
    } catch {
      /* 다음 경로 */
    }
  }
  setCardCache.set(slug, out)
  return out
}
// ⚠️ 카드 이름을 한글로 바꾸는 규칙은 **src/lib/koCardName.ts 한 벌뿐이다.**
//    여기 똑같은 걸 베껴 두고 "같은 규칙"이라 적어 놨었는데, 그 사이 원본에만
//    번호 꼬리 떼기·부호 다듬기가 들어가 **갈렸다**(2026-08-07 확인).

const setCardNames = (slug: string) => {
  const m = new Map<string, string>()
  for (const [n, v] of setCards(slug)) m.set(n, v.name)
  return m
}

// 세트 목록에 쓸 표지. 값이 제일 높은 카드의 그림을 준다.
// 세트 파일(dist/sets/*.json)에서 번호로 그림을 찾는다. 22세트뿐이고 파일도 안 바뀌니
// 한 번 읽고 계속 들고 있는다.
let setCoverCache: Record<string, string> | null = null
async function bestCardCovers(): Promise<Record<string, string>> {
  if (setCoverCache) return setCoverCache
  const out: Record<string, string> = {}
  // 앨범 시세를 받는 세트 + 미리 받아 둔 파일에 있는 세트를 다 본다.
  const slugs = new Set([...packPriceCache.keys(), ...Object.keys(loadHitCardFile())])
  for (const slug of slugs) {
    const top = topPricedCards(slug, 8)
    if (!top.length) continue
    const byNum = setCards(slug)
    // 값이 높은 순으로 보다가 그림이 있는 첫 카드를 쓴다.
    for (const t of top) {
      const img = byNum.get(String(Number(t.n)))?.img
      if (img) {
        out[slug] = img
        break
      }
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
    const cards = topPricedCards(slug, limit)
    if (!cards.length) {
      // 앨범 시세도 없고 미리 받아 둔 파일에도 없다. 화면이 레어도 방식으로 돌아간다.
      sendJson(res, 200, { slug, priced: false, cards: [] })
      return
    }
    // 어디서 받은 값인지 화면에 알려 준다. 스니커덩크(일본 실거래)와 TCGplayer(미국
    // 마켓가)는 기준이 다르므로, 라벨을 안 바꾸면 "왜 스니커덩크 값과 다르냐"는 오해가
    // 그대로 남는다 — 오히려 스니커덩크 값을 보여주면서 TCGplayer라고 적게 된다.
    const saved = loadHitCardFile()[slug]
    const sd = saved?.src === 'snkrdunk' && saved.cards?.length
    const src = sd ? 'snkrdunk' : 'tcgplayer'
    // 스니커덩크는 같은 카드가 상태별로 갈려 거래되고 값이 두 배까지 벌어진다.
    // 어느 등급 값인지 화면이 그대로 적어야 방문자가 오해하지 않는다.
    const grade = sd ? (saved.grade === 'psa10' ? 'psa10' : 'a') : undefined
    // ⚠️ **값이 어디서 왔는지에 맞는 시각**을 보내야 한다. 스니커덩크로 받아 둔 파일이
    //    이기는데(topPricedCards 참고) 앨범 캐시 시각을 보내면 엉뚱한 날짜가 나간다.
    //    이 값은 미리 받아 둔 것이라 며칠 묵는다(2026-08-07 실측: 61세트 중간값 5.4일).
    //    화면이 "언제 기준"을 못 적으면, 홈에서 188만원을 보고 눌렀더니 상세가
    //    124만원일 때 왜 다른지 알 길이 없다.
    const at = sd ? (saved?.at ?? 0) : (packPriceCache.get(slug)?.at ?? 0)
    sendJson(res, 200, { slug, priced: true, src, grade, at, cards })
  })

  // 홈에 띄울 "신팩 힛카드". 제일 최근에 나온 세트 중 시세가 있는 것을 고른다.
  //
  // ⚠️ 세트를 손으로 박아 두지 않는다(운영자 판단 2026-08-05). 박아 두면 새 팩이
  //    나올 때마다 사람이 고쳐야 하고, 안 고치면 "신팩"이라고 적힌 자리에 몇 달 된
  //    세트가 걸린다. 발매일이 제일 최근이면서 힛카드가 있는 세트를 매번 고른다.
  // ⚠️ 그림 주소까지 여기서 같이 준다. 홈이 세트 목록(index.json 371개·수백 KB)을
  //    통째로 받지 않게 하려는 것이다 — 홈은 제일 많이 열리는 화면이다.
  // ⚠️ 카드 이름은 원어 그대로 준다. 한글로 바꾸는 사전이 화면 쪽에만 있고, 세트
  //    화면(SetsView)도 같은 방식으로 받아 화면에서 바꾼다.
  let latestHit: { at: number; body: unknown; 판: number } | null = null
  app.use('/api/local/latest-hit-set', async (_req, res) => {
    // 하루 한 번만 계산한다. **다만 힛카드를 새로 받았으면 곧바로 버린다** —
    // 서버가 하루 한 번 스니커덩크로 갱신하는데, 담아 둔 값을 24시간 들고 있으면
    // 새로 받은 값이 하루 늦게 보인다(판번호로 알아챈다).
    if (latestHit && latestHit.판 === 힛카드판번호 && Date.now() - latestHit.at < 24 * 60 * 60 * 1000) {
      sendJson(res, 200, latestHit.body)
      return
    }
    let index: { slug: string; ed?: 'ja' | 'en'; name?: string; releaseDate?: string }[] = []
    try {
      const raw = await readFile(path.resolve(process.cwd(), 'dist/sets/index.json'), 'utf-8').catch(() =>
        readFile(path.resolve(process.cwd(), 'public/sets/index.json'), 'utf-8'),
      )
      index = JSON.parse(raw)
    } catch {
      sendJson(res, 200, { slug: '', cards: [] })
      return
    }
    const 있는것 = new Set([...packPriceCache.keys(), ...Object.keys(loadHitCardFile())])
    const 후보 = index
      .filter((s) => s.releaseDate && 있는것.has(s.slug))
      .sort((a, b) => (a.releaseDate! < b.releaseDate! ? 1 : -1))
    let 고른것: (typeof 후보)[number] | null = null
    let cards: { n: string; usd: number; name: string }[] = []
    for (const s of 후보) {
      const top = topPricedCards(s.slug, 8)
      // 3장 미만이면 줄이 휑해서 안 쓴다(세트 화면과 같은 기준).
      if (top.length < 3) continue
      고른것 = s
      cards = top
      break
    }
    if (!고른것) {
      sendJson(res, 200, { slug: '', cards: [] })
      return
    }
    const saved = loadHitCardFile()[고른것.slug]
    const sd = saved?.src === 'snkrdunk' && saved.cards?.length
    const byNum = setCards(고른것.slug)
    const body = {
      slug: 고른것.slug,
      ed: 고른것.ed ?? 'ja',
      name: 고른것.name ?? '',
      releaseDate: 고른것.releaseDate ?? '',
      src: sd ? 'snkrdunk' : 'tcgplayer',
      grade: sd ? (saved.grade === 'psa10' ? 'psa10' : 'a') : undefined,
      // ⚠️ **언제 받아 둔 값인지 같이 내보낸다.** 이 값은 미리 받아 둔 것이라 며칠
      //    묵는다(2026-08-07 실측: 최신 세트가 2.2일, 61세트 중간값이 5.4일 전).
      //    그런데 화면엔 날짜가 없어서, 홈에서 188만원을 보고 눌렀더니 상세가
      //    124만원이면 왜 다른지 알 길이 없다. 날짜를 적으면 "그때 값이구나"가 된다.
      pricedAt: sd ? saved.at : undefined,
      // ko는 화면에 그대로 적을 한글 이름이다(규칙은 server/index.ts의 koName과 같다).
      cards: cards.map((c) => ({
        ...c,
        ko: koName(고른것.ed ?? 'ja', c.name),
        img: byNum.get(번호열쇠(c.n))?.img ?? '',
      })),
    }
    latestHit = { at: Date.now(), body, 판: 힛카드판번호 }
    sendJson(res, 200, body)
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
  mountPackHighlights(app)
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
