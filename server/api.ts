import { readFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { brotliCompressSync, constants as zlibConst, gunzipSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
// ⚠️ 카드 이름을 **서버에서** 한글로 바꾸려고 가져온다. 화면에서 바꾸면 이름 사전
//    109KB를 홈에서 통째로 받아야 한다 — 홈은 제일 많이 열리는 화면이라 그 무게를
//    지우면 안 된다(cardImg.ts 첫머리·PackShelfPromo 설명 참고). 서버에서는 공짜다.
import { PPT레어도별코드, 레어도떼기, 레어도맞나, 레어도표, 마켓전용말떼기 } from '../src/lib/rarityCode.ts'
import { 별명찾기 } from '../src/lib/searchAliases.ts'
import { koName, koSet } from '../src/lib/koCardName.ts'
import { FLEA_EDITION_LABEL, FLEA_SET_SET } from '../src/lib/fleaSets.ts'
import cardValue from '../src/data/cardValue.json' with { type: 'json' }
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
import { 번호열쇠, 앨범값, 일본쪽세트, 중국판세트 } from '../src/lib/cardNo.ts'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }
import pptSetList from '../src/data/pptSetList.json' with { type: 'json' }
import setCardNumberAlias from '../src/data/setCardNumberAlias.json' with { type: 'json' }
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import psaPopFix from '../src/data/psaPopFix.json' with { type: 'json' }
import { kstDateStr, kstHourStr } from '../src/lib/kstDay.ts'
import { 묶음인가, 제목등급칸, 제목에감정사있나, 회사말 } from '../src/lib/listingTitle.ts'
import { 낙찰판정, 검수변형표, 검수총표, 차단판매자, 도장말뽑기, type 판정카드 } from '../src/lib/listingJudge.ts'

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
  /**
   * 이베이 Browse API 열쇠. **매물 번호로 사진 주소를 받는 데만** 쓴다(무료 · 하루 5,000).
   * ⚠️ 2026-08-10에 「이베이 한글판 호가」 기능을 뺄 때 이 키를 지우지 않고 남겨 뒀는데,
   *    2026-08-14에 미감정 낙찰의 사진을 읽으려고 다시 쓰게 됐다. **지우지 말 것.**
   */
  EBAY_APP_ID?: string
  EBAY_CERT_ID?: string
  KAKAO_REST_API_KEY?: string
  KAKAO_CLIENT_SECRET?: string
  NAVER_CLIENT_ID?: string
  NAVER_CLIENT_SECRET?: string
  // 이베이 Browse API(한글판 시세, 호가). App ID(Client ID) / Cert ID(Client Secret).
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
  // 세트 로고(pokellector). 카드 그림과 **서브도메인이 다르다**(den-cards가 아니라
  // den-media) — 안 넣으면 프록시가 막아 로고 자리가 빈다(2026-08-25 30주년 세트).
  'den-media.pokellector.com',
  'tcgplayer-cdn.tcgplayer.com',
  'images.pokemontcg.io',
  'images.scrydex.com',
  // 한글판 카드 그림(포켓몬코리아 공식). wmimages라 워터마크가 박혀 있는 형태 그대로다.
  'cards.image.pokemonkorea.co.kr',
  'www.artofpkm.com', // 옛 일본어판(e-Card·PCG) 공식 스캔. cdn.artofpkm.com으로 302됨
  'cdn.artofpkm.com',
  'i.ebayimg.com', // 이베이 한글판 매물 사진(Browse API)
  // ⚠️⚠️ 대전쟁 도트(PokéAPI 스프라이트). **반드시 이 프록시를 거쳐야 한다** —
  //    `raw.githubusercontent.com`을 화면에서 직접 부르면 **429로 막힌다**(2026-08-17 실측:
  //    8장 중 7장이 안 떴다). 한 판에 수십 장을 계속 부르는데 GitHub은 속도 제한이 빡빡하다.
  //    프록시를 거치면 서버가 한 번만 받아 캐시하고, 브라우저에도 장기 캐시가 걸린다.
  'raw.githubusercontent.com',
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
// 【그림 예열】 전 카드 그림을 미리 받아 디스크에 담는다(사장님 지시 2026-08-21 「언제 사라질지
// 모르니 다 저장」). mountImageProxy가 채워 넣고, 검수 화면 단추(POST {예열:1})가 부른다.
// ⚠️ 자동으로는 안 돈다(자동 받기 전부 없음 규칙) — 사장님이 누를 때만.
let 그림예열: ((최대?: number) => Promise<void>) | null = null
let 예열상태: { 돌고있나: boolean; 함: number; 건너뜀: number; 실패: number; 전체: number; 시작: number; 끝?: number } | null = null
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
// ⚠️ 상한을 정할 땐 볼륨 전체를 나눠 쓴다는 걸 잊지 말 것. 디스크가 차면 JSON 저장이
//    실패해 데이터가 상한다 — 그림은 캐시라 지워져도 다시 받으면 그만이지만, JSON은 아니다.
// ⚠️ 2026-08-21에 400MB → 800MB로 올렸다. 볼륨이 3GB로 커졌고(실측 df: 전체 2.9G ·
//    쓴 것 1.0G), tcgplayer 그림도 저장하기 시작해서(위 「자체 저장」) 자리가 더 든다 —
//    400x400 jpg 한 장 약 44KB × 방문된 카드 수. 800MB면 약 2만 장 몫이고, 상한을
//    넘으면 오래 안 본 것부터 지우는 규칙(trimDisk)은 그대로다.
const IMG_DISK_DIR = path.join(DATA_DIR, 'imgcache')
// ⚠️ 2026-08-21에 800MB → 2.5GB. 사장님이 볼륨을 5GB로 늘렸고(잔여 3.6GB 실측),
//    「그림이 언제 사라질지 모르니 전부 저장」 지시로 전 카드 예열(약 1.7GB)을 담는다.
// ⚠️ 2026-08-22에 2.5GB → 3.5GB. 예열이 끝나 **2.2GB로 천장의 90%에 닿았다** —
//    이대로면 9/16 30주년 신팩이 들어올 때부터 오래된 그림을 지우기 시작한다.
//    그때 실측: /data 4.9GB 중 2.9GB 사용 · 1.8GB 남음 · imgcache 82,514장 2.2GB.
//    ⚠️ **볼륨을 더 사도 돈이 더 들지 않는다는 뜻이 아니다** — 이 숫자는 이미 산
//    5GB 안에서 나눠 쓰는 몫일 뿐이다. 3.5GB로 잡으면 JSON·검수·기록 몫으로
//    1.4GB가 남는다(지금 그쪽이 다 합쳐 0.6GB).
const IMG_DISK_MAX_BYTES = 3_500 * 1024 * 1024
// 방문자를 기다리게 하지 않고 뒤에서 받을 때 쓰는 시간. 원본이 느려도 한 번만 참으면
// 그 뒤로는 캐시에서 60ms에 나간다.
const IMG_SLOW_RETRY_MS = 60_000
const diskKey = (key: string) => createHash('sha1').update(key).digest('hex')

function mountImageProxy(app: Mountable) {
  const cache = new TtlCache<{ body: Buffer; contentType: string }>(IMG_CACHE_TTL_MS, IMG_CACHE_MAX)

  // 디스크에서 읽기. 없거나 못 읽으면 null(그냥 원본을 받는다).
  // ⚠️ 형식은 파일 머리 바이트로 가른다 — tcgplayer 그림은 jpg 그대로 저장되므로
  //    (2026-08-21부터) 'image/webp'로 못 박으면 형식이 어긋난다.
  async function readDisk(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const body = await readFile(path.join(IMG_DISK_DIR, `${diskKey(key)}.webp`))
      const contentType =
        body[0] === 0xff && body[1] === 0xd8 ? 'image/jpeg' : body[0] === 0x89 ? 'image/png' : 'image/webp'
      return { body, contentType }
    } catch {
      return null
    }
  }
  // **있는지만** 본다 — 내용은 안 읽는다.
  // ⚠️⚠️ 예열이 5만 장을 훑을 때 `readDisk`를 쓰면 **1.6GB를 읽고 그냥 버린다.**
  //    실측(2026-08-23 · 파일 8만 6천 개): 통째로 읽기 205MB·멈춤 329ms ↔ 이름만 보기 29MB·1ms.
  async function 디스크에있나(key: string): Promise<boolean> {
    try {
      const st = await stat(path.join(IMG_DISK_DIR, `${diskKey(key)}.webp`))
      return st.size > 0
    } catch {
      return false
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
  //
  // ⚠️⚠️ **8만 6천 파일을 한꺼번에 stat하지 않는다**(2026-08-23). 예전엔 `Promise.all`로
  //    파일 수만큼 약속을 한 번에 띄웠다 — 그림이 8만 장을 넘자 그 순간 메모리가 치솟아
  //    459MB 기계에서 넘쳤다(12:01 OOM · 18:01 먹통 2시간). 200개씩 끊어 차례로 잰다.
  //    느려져 봐야 몇 초고, 뒤에서 도는 일이라 방문자는 모른다.
  async function trimDisk(): Promise<void> {
    try {
      const names = await readdir(IMG_DISK_DIR).catch(() => [])
      if (!names.length) return
      const alive: { n: string; size: number; at: number }[] = []
      for (let i = 0; i < names.length; i += 200) {
        const 묶음 = await Promise.all(
          names.slice(i, i + 200).map(async (n) => {
            const st = await stat(path.join(IMG_DISK_DIR, n)).catch(() => null)
            return st ? { n, size: st.size, at: st.atimeMs || st.mtimeMs } : null
          }),
        )
        for (const f of 묶음) if (f) alive.push(f)
      }
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
  // ⚠️ 카드 기록 청소(`기록정리`)와 **같은 6시간 주기**라 늘 같은 순간에 겹쳐 돌았다.
  //    3시간 어긋나게 시작해 둘이 절대 안 겹치게 한다(2026-08-23).
  setTimeout(() => {
    void trimDisk()
    setInterval(() => void trimDisk(), 6 * 60 * 60 * 1000).unref()
  }, 3 * 60 * 60 * 1000).unref()
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
    // ⚠️ tcgplayer는 wsrv가 막아서 축소를 못 시킨다 — 대신 **원본을 직접 받아 저장**한다
    //    (2026-08-21 · 그림 자체 저장). 주소에 크기가 박혀 있어 작은 판을 골라 받으면
    //    되므로(400x400 = 44KB) 축소 없이도 부담이 크지 않다.
    // ⚠️⚠️ 호스트 판별용 `(^|\.)` 머리를 **주소 전체**에 그대로 옮겨 붙였다가 이 갈래가
    //    한 번도 안 돌았다 — `https://` 뒤라 `^`도 `\.`도 안 맞는다. 오류 없이 wsrv 길로
    //    새서 늘 302가 났고, 시간 재보고야 잡았다(2026-08-21). `tcgSmaller`와 같은 꼴로 판별한다.
    if (/tcgplayer-cdn\.tcgplayer\.com\//.test(url)) {
      try {
        const r = await fetch(tcgSmaller(url, w), {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'user-agent': 'pokegre-img/0.1' },
        })
        if (!r.ok) return null
        return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? 'image/jpeg' }
      } catch {
        return null
      }
    }
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

    // ⚠️⚠️ **tcgplayer도 이제 우리 캐시를 거친다**(사장님 지시 2026-08-21 「자체 저장해서
    //    계속 쓰면 안 되나」). 예전엔 저장 없이 302로 원본에 바로 넘겼는데(wsrv가
    //    tcgplayer를 못 받아서), 그래서 tcgplayer가 옛 그림을 지우면 우리 사본이 없어
    //    화면에서 그대로 사라졌다 — 「원래 나오던 사진이 없어졌다」의 원인이 이것이다
    //    (실측: tcgplayer 그림 3%가 403 · 기록.md). 이제는 아래 일반 길에서 서버가
    //    원본을 직접 받아 디스크에 저장한다(fetchThumb의 tcgplayer 갈래). **한 번이라도
    //    열린 그림은 저쪽이 지워도 계속 나온다.** 받기 실패면 아래 폴백이 전처럼 302다.

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
      // ⚠️ **다른 크기로 받아 둔 것이 있으면 그걸 낸다**(2026-08-21 · 그림 자체 저장의 짝).
      //    예열은 400px 한 벌만 담는데, 타일은 200px로 부르므로 원본이 죽으면 타일만
      //    뒷면이 된다. 같은 주소의 다른 크기가 디스크에 있으면 그것으로 화면을 채운다
      //    (브라우저가 칸에 맞춰 줄여 그린다). 못 찾을 때만 아래 폴백으로 간다.
      for (const w2 of [400, 200, 800]) {
        if (w2 === w) continue
        const 대신 = await readDisk(`${w2}|${u}`)
        if (대신) {
          cache.set(key, 대신)
          serve(대신)
          return
        }
      }
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
      // 받기 실패: 원본으로 리다이렉트해 화면이 비지 않게 한다.
      // ⚠️ tcgplayer도 2026-08-21부터는 위에서 직접 받아 저장하므로, 여기 떨어지는 것은
      //    받기 실패(저쪽이 지운 403 등)뿐이다. 작은 판이 있으면 그쪽으로 보낸다.
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

  // 【그림 예열】 도감의 **모든 카드 그림**(5만 5천 장)을 400px로 받아 디스크에 담는다.
  // 한 번 담기면 원본(tcgplayer 등)이 지워도 계속 나온다(위 /api/img가 디스크를 먼저 본다).
  // ⚠️ 살살 돈다 — 2장씩·사이 150ms(초당 4~5장, 전부 3~4시간). 승격 세 판이 겹쳐 돌 때
  //    사이트가 굼떠진 것을 봤다(2026-08-21). 이건 그물(네트워크) 기다림이 대부분이라 가볍다.
  // ⚠️ 메모리 캐시에는 안 넣는다 — 5만 장을 올리면 512MB 기계가 숨을 못 쉰다. 디스크만.
  // ⚠️ 이미 디스크에 있으면 건너뛴다(다시 눌러도 새로 생긴 것만 받는다 → 신팩 뒤에 한 번씩).
  그림예열 = async (최대?: number) => {
    const idx = await loadCardIndex()
    if (!idx) return
    const full = (base: string) => (/\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base.replace(/\/$/, '')}/high.webp`)
    const 본 = new Set<string>()
    const urls: string[] = []
    for (const r of idx.rows) {
      const img = String(r[3] ?? '')
      if (!img || img.includes('snkrdunk') || 본.has(img)) continue
      본.add(img)
      urls.push(full(img))
    }
    const 대상 = typeof 최대 === 'number' && 최대 > 0 ? urls.slice(0, 최대) : urls
    예열상태 = { 돌고있나: true, 함: 0, 건너뜀: 0, 실패: 0, 전체: 대상.length, 시작: Date.now() }
    console.log(`[pokegre] 그림 예열 시작 — ${대상.length.toLocaleString()}장`)

    // ── ① 먼저 **없는 것만 추린다**(200개씩 · 이름만 본다) ────────────────
    // ⚠️⚠️ 예전엔 한 장씩 「읽어 보고 있으면 건너뛰기」였는데, **건너뛸 때도 150ms를 쉬어서**
    //    한 장도 안 받아도 69분이 걸렸다(5만 5천 장 ÷ 2 × 150ms). 게다가 확인하느라
    //    1.6GB를 읽었다. 추리는 일에는 그물을 안 쓰므로 쉴 이유가 없다 — 몇 초면 끝난다.
    const 받을것: string[] = []
    for (let i = 0; i < 대상.length; i += 200) {
      const 묶음 = await Promise.all(
        대상.slice(i, i + 200).map(async (u) => ((await 디스크에있나(`400|${u}`)) ? null : u)),
      )
      for (const u of 묶음) if (u) 받을것.push(u)
    }
    예열상태 = { ...예열상태, 건너뜀: 대상.length - 받을것.length }
    console.log(
      `[pokegre] 그림 예열 — 이미 있는 것 ${예열상태.건너뜀.toLocaleString()}장 · 받을 것 ${받을것.length.toLocaleString()}장`,
    )

    // ── ② 없는 것만 받는다. 속도·예의는 예전 그대로다(2장씩 · 사이 150ms) ──
    for (let i = 0; i < 받을것.length; i += 2) {
      await Promise.all(
        받을것.slice(i, i + 2).map(async (u) => {
          const key = `400|${u}`
          const hit = await fetchThumb(u, 400, IMG_SLOW_RETRY_MS).catch(() => null)
          if (hit) { await writeDisk(key, hit.body); 예열상태!.함++ } else 예열상태!.실패++
        }),
      )
      if ((i / 2) % 500 === 0 && i > 0)
        console.log(`[pokegre] 그림 예열 ${i}/${받을것.length} · 받음 ${예열상태.함} · 실패 ${예열상태.실패}`)
      await new Promise((r) => setTimeout(r, 150))
    }
    예열상태 = { ...예열상태, 돌고있나: false, 끝: Date.now() }
    console.log(`[pokegre] 그림 예열 끝 — 받음 ${예열상태.함.toLocaleString()} · 있었음 ${예열상태.건너뜀.toLocaleString()} · 실패 ${예열상태.실패.toLocaleString()}`)
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

// ⚠️ 환율 캐시는 **함수 밖**에 둔다. 화면에 내려 주는 것 말고도 서버가 직접 쓸 데가
//    있어서다 — 뽑기 자랑글은 **그때 값이 얼마였는지**를 글에 박아 둬야 하므로
//    올리는 시점의 환율이 필요하다(사장님 요청 2026-08-11). 안에 두면 못 꺼낸다.
const 환율캐시 = new TtlCache<ExchangeRates>(EXCHANGE_CACHE_TTL_MS, 1)

/** 지금 환율. 아직 한 번도 못 받았으면 null(그럴 땐 값을 안 적는다 — 틀린 값보다 빈칸). */
const 지금환율 = (): ExchangeRates | null => 환율캐시.get('latest') ?? null

function mountExchangeRate(app: Mountable) {
  const cache = 환율캐시

  app.use('/api/local/exchange-rate', async (_req, res) => {
    const cached = cache.get('latest')
    if (cached) {
      sendJson(res, 200, cached)
      return
    }

    try {
      // 달러 기준으로 한 번만 부르고 엔→원은 나눠서 구한다. 따로 부른 값과 소수점
      // 넷째 자리까지 같은 걸 확인했다.
      // ⚠️⚠️ **파라미터 이름이 `from`/`to`다.** 옛 주소(api.frankfurter.app)는 `base`/`symbols`
      //    였는데, 새 주소(api.frankfurter.dev/v1)로 옮겨지며 이름이 바뀌었다. 우리는 주소만
      //    바꾸고 이름을 안 바꿔서 **522가 오고 환율이 통째로 안 나왔다**(2026-08-10 발견 —
      //    미개봉 시세가 원화 대신 달러로 나오는 걸 보고 찾았다. 사이트의 모든 원화 표시가
      //    이 한 줄에 걸려 있다).
      const upstream = await fetch(`${EXCHANGE_ORIGIN}/latest?from=USD&to=KRW,JPY`, {
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
  // ⚠️ krw는 **글을 올린 그때의 값**이다(사장님 요청 2026-08-11 "뽑았을 당시 얼마짜린지").
  //    나중에 다시 계산하면 안 된다 — 시세도 환율도 움직여서, 반년 뒤에 열어 보면
  //    그때 자랑한 금액과 달라진다. 자랑글은 그 순간의 기록이라 박아 둬야 맞다.
  //    시세를 아직 못 받은 세트는 값이 없다(빈칸으로 둔다 — 0원이라고 적으면 틀린 말이다).
  pull?: {
    pack: string
    god: boolean
    total?: number
    cards: { img: string; name: string; r: string; q?: number; krw?: number }[]
  }
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

// 검색 노출용. server/index.ts가 글마다 화면을 그리고 사이트맵에 넣을 때 쓴다.
// loadPosts가 mountCommunity 안에 있어서, 위 appendCommunityPost와 같은 방식으로
// 마운트할 때 등록해 둔다(파일을 직접 읽으면 캐시와 어긋난다).
export type 공개글 = { id: number; title: string; content: string; category: string; createdAt: number; editedAt?: number }
let 공개글읽기: (() => Promise<공개글[]>) | null = null
export async function 공개게시글(): Promise<공개글[]> {
  return 공개글읽기 ? 공개글읽기() : []
}

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
  // ⚠️ **비밀글·가려진 글은 빼고 준다** — 검색에 올라가면 안 된다.
  // ⚠️ 회원번호(authorId)는 절대 안 나간다. 필요한 것만 골라 담는다.
  공개글읽기 = async () =>
    (await loadPosts())
      .filter((p) => !p.secret && p.hiddenAt == null)
      .map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        category: p.category as string,
        createdAt: p.createdAt,
        ...(p.editedAt ? { editedAt: p.editedAt } : {}),
      }))

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
        // ⚠️ **운영자 조회도 센다**(사장님 지시 2026-08-10 — 전엔 운영자를 빼서, 사장님이
        //    본 글의 조회수가 안 올랐다). 부풀림 걱정은 아래 "같은 사람은 한 번만"이 막는다.
        //    notrack(집계 제외 주소)만 빼고 다 센다.
        const notrack = url.searchParams.get('notrack') === '1'
        if (!notrack) {
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
// 신고에 딸린 메모의 길이(2026-08-18). 화면도 같은 수로 막는다.
const MAX_FEEDBACK_NOTE = 200
// 플리마켓(회원끼리 카드 거래) 운영 설정. 기능을 만들기 전에 스위치부터 둔다 —
// 문제가 생겼을 때 배포 없이 바로 닫을 수 있어야 하기 때문이다.
const FLEA_CONFIG_FILE = dataFile('flea-config.json')
// 매물·거래 기록. 아직 만들지 않은 기능이라 파일이 없는 게 정상이다(없으면 0건).
const FLEA_LISTINGS_FILE = dataFile('flea-listings.json')
const FLEA_OFFERS_FILE = dataFile('flea-offers.json')
const FLEA_DEALS_FILE = dataFile('flea-deals.json')
const FLEA_BIDS_FILE = dataFile('flea-bids.json')
const FLEA_CHATS_FILE = dataFile('flea-chats.json')
const FLEA_CHAT_MSGS_FILE = dataFile('flea-chat-msgs.json')
const FEEDBACK_FILE = dataFile('feedback.json')
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

// ── 작가·세트를 **날짜별로도** 쌓는다 (2026-08-16) ─────────────────────────
//
// ⚠️ 위 두 파일은 **누적만** 센다. 그래서 「8월 16일에 어느 작가를 많이 봤나」를 물으면
//    답할 수가 없었다(사장님이 달력 통계를 요청하시면서 드러남). 누적 파일은 그대로
//    두고 — 순위표가 그걸 쓴다 — 날짜별 칸을 따로 만든다.
// ⚠️ **지난 것은 못 되살린다.** 오늘부터 쌓인다.
// ⚠️ 하루에 남길 이름은 상위 40개로 자른다. 안 자르면 세트 583개 × 400일이 쌓여
//    파일이 몇 MB가 된다. 순위표에 40위 아래는 어차피 안 보인다.
const DAY_RANK_FILE = dataFile('day-ranks.json')
const 하루이름최대 = 40
/**
 * ⚠️⚠️ **대전쟁만 칸을 더 준다.** 판 12 × 난이도 3 × (시작·깸·짐) 3 = **108칸**이라
 *    40(정리 문턱 80)으로는 **적게 한 판이 조용히 잘린다** — 통계에서 사라지는데
 *    화면엔 오류가 아니라 그냥 「그 판은 아무도 안 했다」로 보인다(2026-08-18에 미리 잡음).
 *    칸 하나가 작은 숫자라 150을 둬도 파일이 거의 안 커진다.
 */
const 하루이름최대별: Partial<Record<'artist' | 'set' | 'battle', number>> = { battle: 150 }
const 날짜순위보관 = 400
let 날짜순위: Record<string, { artist?: Record<string, number>; set?: Record<string, number>; battle?: Record<string, number> }> | null = null
async function 날짜별쌓기(무엇: 'artist' | 'set' | 'battle', 이름: string) {
  try {
    if (!날짜순위) {
      try { 날짜순위 = JSON.parse(await readFile(DAY_RANK_FILE, 'utf-8')) } catch { 날짜순위 = {} }
    }
    const 날 = kstDateStr()
    const 칸 = (날짜순위![날] ??= {})
    const 표 = (칸[무엇] ??= {})
    표[이름] = (표[이름] ?? 0) + 1
    // 하루가 너무 커지면 적게 본 것부터 버린다.
    const 이름들 = Object.keys(표)
    const 최대 = 하루이름최대별[무엇] ?? 하루이름최대
    if (이름들.length > 최대 * 2) {
      const 남길 = 이름들.sort((a, b) => 표[b] - 표[a]).slice(0, 최대)
      const 새: Record<string, number> = {}
      for (const k of 남길) 새[k] = 표[k]
      칸[무엇] = 새
    }
    const 날들 = Object.keys(날짜순위!).sort()
    if (날들.length > 날짜순위보관) {
      for (const d of 날들.slice(0, 날들.length - 날짜순위보관)) delete 날짜순위![d]
    }
    await writeJsonFile(DAY_RANK_FILE, 날짜순위)
  } catch {
    /* 곁다리다 — 실패해도 본 집계를 막지 않는다 */
  }
}
// 기능별 사용 횟수만 센다. 허용된 이벤트 이름 외에는 받지 않는다(임의 키 방지).
// sets=세트별 목록에서 세트 열람, ebay_korean=이베이 한글판 시세 조회.
// search_* 는 "인기 검색어에 한 표가 들어갈 때 그 검색어를 어떻게 확정했나"를 센다.
// 검색 횟수(snkrdunk_search 등)와 합계가 같아야 정상이다 — 갈라 보는 축이 다를 뿐이다.
// 이걸 세는 이유: 지금은 그냥 타이핑하다 멈춰도(search_typed) 세는데, 그 기준(1.5초)이
// 애매하다는 지적이 있었다. typed 비중이 낮으면 그 경로를 떼도 순위가 안 무너진다.
const ALLOWED_EVENTS = new Set([
  'snkrdunk_search', 'ebay_search', 'scan', 'centering', 'artist', 'tcgplayer', 'sets', 'series',
  'ebay_korean', 'sealed', 'packsim', 'scantest', 'packsim_checkin', 'packsim_godpack', 'packsim_value',
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
  // ⚠️ **`population`은 뺐다**(사장님 지시 2026-08-19). 화면이 저절로 세던 것이라
  //    사람 행동이 아니었다. 여기서 빼야 **더 안 쌓인다** — 화면에서만 지우면 계속 쌓인다.
  //    쌓인 자료는 그대로 둔다(`/data/event-stats.json`).
  'population_search', 'population_detail',
  // 센터링 화면을 연 횟수(2026-08-08). 'centering'은 사진이 들어온 횟수라 둘이 다르다 —
  // 같이 봐야 "안 들어온 것"과 "들어왔는데 안 쓴 것"이 갈린다.
  'centering_open',
  // 해외 시세(2026-08-12). 옛 길(ebay_search·tcgplayer)을 **이어받은** 줄들이다 —
  // 2026-08-13에 옛 탭을 떼면서 이쪽이 유일한 해외 시세가 됐다.
  // search=검색한 횟수 · tcg=TCGplayer 눈으로 바꾼 횟수.
  'cardboard_search', 'cardboard_tcg',
  // 포켓몬 대전쟁(2026-08-17 · 운영자 베타). 라벨은 스테이지 이름이다.
  // 시작·깸·짐을 따로 세야 어느 스테이지에서 막히는지 보인다.
  'battle_start', 'battle_clear', 'battle_lose',
  // 왜 졌나(2026-08-18). 라벨은 짧은 열쇠라 여섯 칸이면 된다 — 짐 라벨에 덧붙이면
  // 12판 × 3난이도 × 6까닭 = 216칸이라 하루 칸(150)을 넘어 조용히 잘린다.
  'battle_why',
  // 숫자키 1~8로 낸 판(2026-08-18). **라벨이 없다** — 붙이면 아래에서 판별 표에 섞여 쌓인다.
  // 한 판에 한 번만 오므로 `battle_start`와 나눠 「몇 판에서 숫자키를 썼나」로 읽는다.
  'battle_key',
  // 첫 판 안내(2026-08-18). **라벨이 없다** — 붙이면 아래에서 판별 표에 섞여 쌓인다.
  // guide=안내가 처음 뜬 브라우저 · guide_done=그 안내를 따라 첫 포켓몬을 낸 브라우저.
  // 둘의 비율이 곧 안내의 성적이라 **같이 봐야** 뜻이 있다.
  'battle_guide', 'battle_guide_done', 'battle_card_detail', 'battle_quit',
  // 홈 배너 의견함(2026-08-21). 보내기 성공 한 번에 1. 라벨 없음.
  'feedback',
  // 오늘의 상점의 「내 GP 내역」을 펼친 횟수(2026-08-22).
  'packsim_log',
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
/** 절대 넘어서면 안 되는 크레딧 바닥선. 뒤에서 도는 일은 여기 닿으면 스스로 멈춘다. */
const PPT_FLOOR = 5000

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
  /** 종류별로 **성공적으로 받아 해석까지 끝낸** 마지막 날(UTC). */
  exportOkDays?: Record<string, string>
  // 저쪽(PPT)이 값을 하나도 안 주는 세트. 덤프를 받을 때마다 다시 계산한다.
  // ⚠️ 이건 **날짜와 상관없이 이어받는다**(아래 day 검사보다 먼저 읽는다). 안 그러면
  //    날이 바뀐 직후 서버가 뜰 때 잠깐 비어서, 세트별 받기가 그 세트들을 또 두드린다.
  noPriceSets?: string[]
}
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)

// 저쪽에 값이 아예 없어서 세트별로 받아 봐야 소용없는 세트(ja-SM1+ 썬&문 등).
const 값없는세트 = new Set<string>()

// 통째 받기(/export)를 종류별로 **마지막에 두드린 날**(UTC). 파일로 남겨 배포해도 이어진다.
// 종류: cards(시세) · printings · sealed · population(감정 수량) · ebay(등급별 낙찰)
//
// ⚠️⚠️ **이 칸은 「성공」이 아니라 「오늘은 더 두드리지 마라」는 표시다.** 429(몫 소진)나
//    파일이 너무 클 때도 여기 적힌다. 그래서 이 값만 보면 **받은 줄로 착각한다** —
//    실제로 2026-08-08에 `population`이 그렇게 적혔는데, 백업을 보니 그날 자료는
//    2KB(약 30장)뿐이었고 그 뒤로도 방문자가 낱장으로 받은 것만 하루 1~3KB씩 쌓였다.
//    사흘 동안 「받았는데 왜 없지?」를 헤맨 원인이다(사장님 지적 2026-08-11).
//    → **진짜로 받아서 해석까지 끝낸 날**은 아래 `exportOkDay`에 따로 적는다.
const exportDoneDay: Record<string, string> = {}
/** 그 종류를 **성공적으로 받아 해석까지 끝낸** 마지막 날(UTC). 화면·점검이 믿을 값이다. */
const exportOkDay: Record<string, string> = {}
/** 받아서 해석까지 끝났을 때만 부른다 — 429·용량초과로 못 받은 날과 갈라 적기 위한 것이다. */
const 기록성공 = (종류: string) => {
  exportOkDay[종류] = utcDay()
  void savePptState()
}

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
      exportOkDays: exportOkDay,
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
    // ⚠️ **성공한 날은 하루가 지나도 지우지 않는다.** 「마지막으로 제대로 받은 날」은
    //    어제 것이든 그제 것이든 그대로 값어치가 있다(위 day 검사와 다른 성격이다).
    if (s.exportOkDays && typeof s.exportOkDays === 'object') {
      for (const [종류, 날] of Object.entries(s.exportOkDays)) {
        if (typeof 날 === 'string') exportOkDay[종류] = 날
      }
    }
    // ⚠️ 기동 로그에는 **진짜로 받아 해석까지 끝낸 것**만 적는다. 예전엔 `exportDoneDay`를
    //    썼는데 그건 429로 못 받은 것까지 세어 「오늘 받아 뒀다」로 보이게 했다.
    const 오늘받은것 = Object.entries(exportOkDay)
      .filter(([, 날]) => 날 === utcDay())
      .map(([종류]) => 종류)
    const 마지막성공 = Object.entries(exportOkDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([종류, 날]) => `${종류}=${날}`)
    console.log(
      `[pokegre] PPT 상태를 이어받았습니다: 남은 크레딧 ${Number.isFinite(pptLeftNow()) ? pptLeftNow() : '모름'}` +
        ` · 오늘 채우기에 쓴 것 ${fillSpentToday().toLocaleString()}/${WARM_FILL_BUDGET.toLocaleString()}` +
        (오늘받은것.length ? ` · 오늘 통째로 받아 둔 것 [${오늘받은것.join(', ')}]` : '') +
        (pptBlockedUntil > Date.now() ? ` · ${new Date(pptBlockedUntil).toISOString()}까지 쉽니다` : ''),
    )
    // 종류별로 **마지막에 제대로 받은 날**. 「받은 줄 알았는데 아니었다」를 눈으로 잡는 줄이다.
    console.log(
      `[pokegre] 통째 받기 마지막 성공: ${마지막성공.length ? 마지막성공.join(' · ') : '(아직 한 번도 없음)'}`,
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
        listingId?: string
        price?: number
        soldDate?: string
        url?: string
        listingType?: string
        bestOfferAccepted?: boolean
        // ⚠️ 매물 제목. **딴 카드가 섞였는지 가리는 유일한 단서**다(아래 딴카드거르기).
        title?: string
        /**
         * **딴 카드 칸에서 옮겨 온 낙찰**이라는 표시(값은 원래 있던 카드의 저쪽 번호).
         * 저쪽이 준 것이 아니라 `쌓인것붙이기`가 얹은 것이다. 두 가지에 쓴다:
         *   ① 화면에 "어디서 옮겨 왔는지" 밝힌다 — 말없이 섞으면 그것도 속이는 것이다.
         *   ② **이건 다시 옮기지 않는다.** 안 그러면 두 카드가 서로 떠넘겨 파일만 는다.
         */
        옮겨옴?: string
        /** 어느 카드에서 왔는지 사람 말로("Charizard · Expansion Pack"). */
        옮겨온곳?: string
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

/**
 * 저쪽 번호로 **우리 도감에서** 카드 이름을 찾는다(공유 링크 미리보기용). **크레딧 0.**
 *
 * ⚠️ 예전에는 이 자리에서 저쪽에 물어봤다(`fetchCardNameForShare`) — 크레딧이 나가서
 *    하루 500번 상한을 걸어 뒀고, 크롤러가 그걸 다 쓰면 그 뒤 링크는 카톡 미리보기에
 *    카드 이름이 안 떴다. 색인에 저쪽 번호가 57,344장 있으니 우리가 찾으면 된다.
 * ⚠️ 이름은 **화면에 보이는 한글 이름 그대로**다 — 미리보기와 화면이 다른 이름이면
 *    누른 사람이 딴 카드로 온 줄 안다.
 */
let 공유이름표: Map<string, string> | null = null
export async function 도감에서카드이름(id0: string): Promise<string | null> {
  const id = String(id0 ?? '').split('~')[0]
  if (!/^\d+$/.test(id)) return null
  if (!공유이름표) {
    const idx = await loadCardIndex()
    if (!idx) return null
    공유이름표 = new Map()
    for (const r of idx.rows) {
      const tcg = (r as unknown as string[])[7]
      if (tcg && !공유이름표.has(tcg)) 공유이름표.set(tcg, (r as unknown as string[])[2])
    }
  }
  return 공유이름표.get(id) ?? null
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

export async function fetchCardNameForShare(apiKey: string, id0: string): Promise<string | null> {
  // ⚠️ 갈라 담은 카드의 열쇠는 "617410~4-9"다(위 갈라담기 설명). 공유 링크 미리보기는
  //    이름 한 줄만 필요하므로 뒤의 번호를 떼고 원래 카드로 물어본다.
  const id = String(id0).split('~')[0]
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


// ── 카드 번호 다듬기 ────────────────────────────────────────────────────────
//
// ⚠️ 예전에는 이 함수가 「제목 뜯기」 구역 한가운데 있었다. 그 구역은 **옛 시세 길**의
//    것이라 2026-08-13에 통째로 걷어냈는데, 이 하나만은 **새 길이 쓴다** — 그래서
//    여기로 옮겨 왔다. 지울 때 딸려 가지 않도록 자리를 따로 준다.
/**
 * 도감 카드의 `n`을 **화면에 낼 번호**로 바꾼다. 없으면 null(빈칸).
 *
 * ⚠️ `#577029`처럼 `#`+숫자만 있는 것은 **번호가 아니라 저쪽(PPT) 내부번호**다.
 *    옛 일본 카드는 번호가 인쇄돼 있지 않아 도감에도 없고, 도감을 PPT 덤프로 만들 때
 *    자리표로 그 번호가 들어갔다. 화면에 내면 방문자에게 아무 뜻도 없는 여섯 자리
 *    숫자가 카드 번호인 척 붙는다 — **틀린 것보다 빈칸**이다(2026-08-11 이베이 검색
 *    타일에서 「Blastoise #577029」로 새고 있던 것을 잡았다. 도감 화면은 이미 비웠다).
 */
const 도감번호 = (n?: string): string | null => {
  const s = String(n ?? '').trim()
  if (!s || /^#\d+$/.test(s)) return null
  return s.split('~')[0]
}



// ── 팝수 조회 화면 · 미개봉 시세 ─────────────────────────────────────────────
//
// ⚠️⚠️ **이 다섯은 원래 옛 시세 길()에 얹혀 살았다.** 2026-08-13에 옛
//    길을 걷어내면서 통째로 딸려 갈 뻔했다 — 시세와 아무 상관이 없는데 한 함수 안에
//    있었을 뿐이다. 그래서 제 이름을 가진 자리로 옮겼다.
//     ·  ·  ·
//     · 
// ⚠️ 가 필요한 것은 와  둘뿐이다(장당 1~2크레딧).
//    나머지 셋은 받아 둔 것을 읽기만 하므로 **크레딧을 안 쓴다.**
function mountPopulationAndSealed(app: Mountable, apiKey: string) {

  /**
   * 저쪽 번호 → 우리 도감 카드. 팝수 맛보기(`population-samples`)가 쓴다.
   *
   * ⚠️ 예전에는 옛 길의 `옮길곳색인`(도감 전체를 이름으로 뒤집은 16.8MB짜리)을 빌려
   *    썼는데, 그건 **매물 제목을 카드에 잇느라** 만든 것이라 여기엔 과했다. 여기 필요한
   *    것은 「저쪽 번호로 카드 하나 찾기」뿐이라 그만큼만 만든다.
   * ⚠️ 한 번 만들면 들고 있는다. 팝수 화면은 자주 열리지 않으니 **처음 열 때만** 만든다.
   */
  let 번호표: Map<string, { slug: string; n: string; 이름: string; img: string; 세트: string }> | null = null
  const 번호로카드 = async () => {
    if (번호표) return 번호표
    const idx = await loadCardIndex()
    번호표 = new Map()
    if (!idx) return 번호표
    for (const r of idx.rows) {
      const [slug, n, 이름, img, , , , tcg] = r as unknown as string[]
      if (!tcg || !img || 번호표.has(tcg)) continue
      번호표.set(tcg, { slug, n, 이름, img, 세트: idx.sets[slug]?.[0] ?? slug })
    }
    return 번호표
  }

  // ⚠️ (없앰) **저쪽 번호 → 우리 카드 「되찾기」 표.** 옛 `card-find`가 저쪽 검색 결과에서
  //    「우리가 아는 카드」를 위로 올리려고 쓰던 것이다. 2026-08-13에 팝수 찾기를
  //    **우리 도감에서 찾기**로 바꾸면서 저쪽 결과 자체가 없어져 쓸 데가 사라졌다.
  //    서버가 뜰 때 세트 파일 666개를 통째로 읽던 자리라, 지우면서 그 비용도 없어졌다.

  // ── 우리 도감에서 카드 찾기 (크레딧 0) ──────────────────────────────────────
  //
  // 왜 — 방문자가 해외 시세 탭에 이름을 치면 지금은 **PPT에 이름으로 뒤진다.** 저쪽
  // `search`는 카드 이름뿐 아니라 세트 이름까지 보므로 딴 카드가 섞이고, 12장을 받느라
  // 크레딧을 144씩 쓴다.
  // 2026-08-09에 도감을 PPT로 갈아엎으며 **카드마다 PPT 번호가 생겼다**(58,151장).
  // 그러니 **우리가 먼저 찾아 번호를 고르고**, 시세는 그 번호로만 부르면 된다.
  //
  // ⚠️ 값 순서는 `cardValue.json`(덤프에서 미리 만든 것)으로 매긴다. 운영 서버에는
  //    덤프가 없고(하루 쓰고 지운다), 값을 알자고 PPT를 부르면 크레딧이 든다.
  //    **그 값을 화면에 쓰면 안 된다 — 묵은 값이라 정렬에만 쓴다.**
  const 찾기색인 = (() => {
    type 색인줄 = { 열쇠: string; tcg: string; slug: string; n: string; date: string; 값: number; ko: string; img: string; setKo: string }
    let 만든것: 색인줄[] | null = null
    return () => {
      if (만든것) return 만든것
      const 값표 = cardValue as Record<string, number>
      const 읽기 = (p: string): string | null => {
        for (const base of ['dist/sets', 'public/sets']) {
          try {
            return readFileSync(path.resolve(base, p), 'utf-8')
          } catch {
            /* 다음 경로 */
          }
        }
        return null
      }
      const idxRaw = 읽기('index.json')
      const out: 색인줄[] = []
      if (!idxRaw) {
        만든것 = out
        return 만든것
      }
      for (const s of JSON.parse(idxRaw) as { slug: string; ed?: string; releaseDate?: string }[]) {
        const raw = 읽기(`${s.slug}.json`)
        if (!raw) continue
        const cards = (JSON.parse(raw).cards ?? []) as { n?: string; name?: string; tcg?: string; img?: string }[]
        const setKo = koSet(s.ed === 'ja' ? 'ja' : 'en', String((JSON.parse(raw) as { name?: string }).name ?? ''))
        for (const c of cards) {
          if (!c.tcg) continue
          const ed = s.ed === 'ja' ? 'ja' : 'en'
          // 원문·한글 둘 다로 찾히게 한다. 방문자는 "리자몽"도 "Charizard"도 친다.
          const ko = koName(ed, String(c.name ?? ''))
          const 이름들 = [String(c.name ?? ''), ko]
          for (const nm of new Set(이름들.filter(Boolean)))
            out.push({
              열쇠: nm.toLowerCase().replace(/[\s·]/g, ''),
              tcg: String(c.tcg),
              slug: s.slug,
              n: String(c.n ?? ''),
              date: String(s.releaseDate ?? ''),
              값: 값표[String(c.tcg)] ?? 0,
              // ⚠️ **이름·그림은 우리 것이 낫다.** PPT는 옛 일본판 그림을 안 주고
              //    이름에 번호를 붙여 준다("Charizard #6"). 우리 도감은 한글 이름과
              //    그림을 갖고 있다(64,170장) — 화면은 이쪽을 먼저 쓴다.
              ko,
              img: String(c.img ?? ''),
              setKo,
            })
        }
      }
      만든것 = out
      console.log(`[card-lookup] 우리 도감 검색 색인 ${out.length.toLocaleString()}줄`)
      return 만든것
    }
  })()

  // 세트 상세의 「미개봉 시세」. 덤프에서 접어 둔 것만 주므로 크레딧 0.
  app.use('/api/local/sealed-prices', (req, res) => {
    const slug = (new URL(req.url ?? '', 'http://x').searchParams.get('slug') ?? '').trim()
    // slug가 없으면 통째로 — 「미개봉 시세」 모아보기 화면이 쓴다(200세트 남짓이라 가볍다).
    if (!slug) {
      sendJson(res, 200, Object.fromEntries(sealedPriceCache))
      return
    }
    sendJson(res, 200, sealedPriceCache.get(slug) ?? {})
  })

  app.use('/api/local/card-lookup', (req, res) => {
    const u = new URL(req.url ?? '', 'http://x')
    const q = (u.searchParams.get('q') ?? '').trim().toLowerCase().replace(/[\s·]/g, '')
    const 판 = u.searchParams.get('lang') === 'english' ? 'en' : 'ja'
    const 몇 = Math.min(24, Math.max(1, Number(u.searchParams.get('limit')) || 12))
    // ⚠️⚠️ **몇 번째부터 줄지도 받는다.** 이걸 안 두고 앞 12장만 주면서 "더 없다"고 했더니,
    //    영문판 리자몽 **240장 중 12장**만 보이고 「더 보기」도 안 떴다(사장님 지적 2026-08-10:
    //    "리자몽 영문판을 검색했는데 데이터가 12개만 나오는게 말이 되냐").
    //    예전 길(저쪽 이름 검색)은 쪽 넘기기가 됐으므로 이건 **되던 것을 깬 것**이다.
    const 건너뛸것 = Math.max(0, Number(u.searchParams.get('offset')) || 0)
    res.setHeader('content-type', 'application/json')
    if (q.length < 2) {
      res.end(JSON.stringify({ cards: [], total: 0 }))
      return
    }
    const 앞 = 판 === 'ja' ? 'ja-' : 'en-'
    const 걸린것 = 찾기색인().filter((x) => x.slug.startsWith(앞) && x.열쇠.includes(q))
    // ⚠️ 같은 카드가 원문·한글 두 줄로 들어 있다. 번호로 한 번만 남긴다.
    const 본것 = new Set<string>()
    const 고른것 = 걸린것
      .sort(
        (a, b) =>
          // ① 이름이 그 말로 시작하는 것 ② 값이 높은 것 ③ 최근 발매
          Number(b.열쇠.startsWith(q)) - Number(a.열쇠.startsWith(q)) ||
          b.값 - a.값 ||
          (b.date || '').localeCompare(a.date || ''),
      )
      .filter((x) => (본것.has(x.tcg) ? false : (본것.add(x.tcg), true)))
    sendJson(res, 200, {
      cards: 고른것
        .slice(건너뛸것, 건너뛸것 + 몇)
        .map((x) => ({ tcg: x.tcg, slug: x.slug, n: x.n, ko: x.ko, img: x.img, setKo: x.setKo })),
      // 화면이 "더 보기"를 띄울지 정하는 데 쓴다. 크레딧이 안 드는 값이라 통째로 준다.
      total: 고른것.length,
    })
  })

  // 등급표 전부. 요약은 통째로 받아 둔 것에 있지만 **등급 하나하나는 여기서 받는다**
  // (메모리가 512MB뿐이라 전 카드 상세를 들고 있을 수 없다).
  const 상세캐시 = new TtlCache<string>(POP_DETAIL_TTL_MS, POP_DETAIL_MAX)
  /**
   * **팝수 화면의 「맛보기」에 쓸 카드**를 준다 — 감정 수량이 **실제로 있는** 카드만.
   *
   * ⚠️⚠️ 예전엔 화면이 「최근 1년 지난 세트의 비싼 카드」를 골랐다. 그런데 그건 **시세**
   *    기준이라 **감정 수량과 아무 상관이 없다** — 사장님 지적(2026-08-11)대로 12장
   *    전부 「등급 매물 없음」이 떴다(실측: 2025년 8월 신상 세트라 감정된 물량 자체가
   *    없었다). 팝수 화면의 맛보기가 팝수 없는 카드를 보여 주는 것은 앞뒤가 안 맞는다.
   *    여기서는 **우리가 가진 팝수 자료에서** 감정 수량이 많은 순으로 고른다.
   * ⚠️ 그림이 없는 카드는 뺀다 — 회색 상자를 맛보기로 낼 이유가 없다.
   */
  app.use('/api/local/population-samples', async (req, res) => {
    res.setHeader('content-type', 'application/json')
    const q = new URL(req.url ?? '', 'http://x').searchParams
    const 몇장 = Math.min(24, Math.max(1, Number(q.get('limit')) || 12))
    const 표 = await 번호로카드()
    const 모음: { id: string; n: string; 이름: string; img: string; 세트: string; slug: string; 감정: number }[] = []
    for (const [id, v] of populationCache) {
      const 전체 = Number((v as { all?: number }).all ?? 0)
      if (!(전체 > 0)) continue
      const 카드 = 표.get(String(id))
      if (!카드) continue
      모음.push({ id: String(id), n: 카드.n, 이름: 카드.이름, img: 카드.img, 세트: 카드.세트, slug: 카드.slug, 감정: 전체 })
    }
    모음.sort((a, b) => b.감정 - a.감정)
    res.statusCode = 200
    res.end(JSON.stringify({ cards: 모음.slice(0, 몇장), 전체: 모음.length }))
  })

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
    // 갈라 담은 카드는 저쪽에 그런 열쇠가 없다. 물어봐야 헛걸음이다(위 card-extra 설명).
    if (id.includes('~')) {
      res.statusCode = 200
      res.end(JSON.stringify({ detail: null }))
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
    // ⚠️⚠️ **어느 카드의 표인지 같이 보낸다.** 카드 상세의 「자세히 →」로 들어오면
    //    화면은 번호만 알아서, 표는 열리는데 **무슨 카드인지 한 줄도 안 적혔다**
    //    (사장님 지적 2026-08-13: "딱 그 카드를 찾아주는게 낫지않아?").
    //    받아 둔 색인에서 꺼내는 것이라 **크레딧 0**이고 새로 부르는 것도 없다.
    // ⚠️ 감정 기록이 없어도(`detail`이 null) 카드는 보낸다 — 「○○는 감정 기록이
    //    없습니다」라고 이름을 밝혀야 방문자가 헛다리를 안 짚는다.
    const 것 = (await 번호로카드()).get(id)
    const body = JSON.stringify({
      detail: d,
      card: 것 ? { tcgPlayerId: id, name: 것.이름, setName: 것.세트, cardNumber: 도감번호(것.n) ?? '', imageUrl: 것.img } : null,
    })
    if (d) 상세캐시.set(열쇠, body)
    res.statusCode = 200
    res.end(body)
  })
}

// 날짜별 방문 수만 센다(운영자가 홍보 효과를 보려는 용도). IP·기기·회원 정보는 저장하지
// 않는다. 같은 브라우저가 하루에 한 번만 세도록 집계는 클라이언트의 localStorage로
// 거르고, 서버는 그저 그날 숫자를 1 올린다.
// ── 유입경로 ──────────────────────────────────────────────────────────────
// 「어디서 들어왔나」를 **낱말 하나로만** 날짜별로 센다(2026-08-16).
//
// ⚠️ 붙인 까닭: 방문자가 하루 만에 80 → 163으로 뛰었는데 **사람인지 크롤러인지 가릴
//    자료가 하나도 없어서** 끝내 못 밝혔다. 서치 콘솔은 2~3일 늦게 나와 그날 일을
//    그날 못 본다.
// ⚠️⚠️ **주소도 IP도 안 남긴다.** 화면(`어디서왔나`)이 호스트를 낱말로 바꿔 보내고,
//    서버는 그중 **아는 낱말만** 받는다. `google.com/search?q=…`처럼 남의 검색어가
//    붙어 오는 일이 있어서 주소를 그대로 받으면 그게 곧 개인정보 저장이다.
const VISIT_FROM_FILE = dataFile('visit-referrers.json')
// ⚠️ 화면(`어디서왔나`)이 보내는 낱말과 **한 글자도 틀리면 안 된다.** 여기 없는 말은
//    조용히 버려지므로, 화면 쪽 표를 고치면 이 목록도 같이 고칠 것.
const 유입낱말 = new Set([
  '직접(사람)', '사이트안', '알수없음', '그밖',
  // 로봇 — 프로그램 이름으로 가린 것(`로봇인가`)
  '구글봇', '빙봇', '네이버봇', '다음봇', 'AI 수집기', 'SEO 수집기', '링크 미리보기',
  '그밖 검색로봇', '그밖 로봇',
  '구글', '네이버', '네이버 카페', '네이버 블로그', '다음', '빙', '덕덕고',
  '카카오톡', '라인', '텔레그램',
  '인스타그램', 'X(트위터)', '페이스북', '스레드', '틱톡', '레딧',
  '유튜브',
  '디시인사이드', '에펨코리아', '루리웹', '인벤', '더쿠', '클리앙', '아카라이브', '중고거래',
  '챗GPT', '퍼플렉시티', '클로드', '제미나이',
  // 옛 낱말 — 2026-08-16에 잘게 나누기 전 것. 그날 쌓인 것이 사라지지 않게 남겨 둔다.
  '다음·카카오', 'SNS', '커뮤니티', 'AI 답변', '직접',
])
let 유입표: Record<string, Record<string, number>> | null = null
/**
 * 접속한 프로그램 이름으로 **로봇인지** 가린다. 이름이 있으면 그걸로, 없으면 빈 문자열.
 *
 * ⚠️ 왜 필요한가: 「직접」은 **브라우저가 어디서 왔는지 안 알려 준 것 전부**라
 *    ①주소 직접 입력 ②즐겨찾기 ③검색로봇 ④카톡 링크가 한 칸에 섞인다. 2026-08-16에
 *    방문이 하루 만에 80 → 163으로 뛰었는데 **사람인지 로봇인지 가릴 자료가 없어**
 *    끝내 못 밝혔다. 로봇은 자기 이름을 프로그램 이름에 적어 두므로 그것만 갈라낸다.
 * ⚠️ **로봇 대부분은 자바스크립트를 안 돌려서 여기까지 안 온다.** 그래서 0으로 나올
 *    수 있는데, 그것 자체가 「직접은 사람이다」라는 답이라 쓸모가 있다.
 * ⚠️ 프로그램 이름은 **누구나 바꿔 적을 수 있다.** 정확한 잣대가 아니라 참고다.
 */
const 로봇들: [RegExp, string][] = [
  [/googlebot|google-inspectiontool|storebot-google/i, '구글봇'],
  [/bingbot|adidxbot/i, '빙봇'],
  [/yeti\//i, '네이버봇'],
  [/daumoa/i, '다음봇'],
  [/gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|ccbot|perplexitybot|google-extended|bytespider/i, 'AI 수집기'],
  [/ahrefsbot|semrushbot|mj12bot|dotbot|dataforseo|petalbot|barkrowler/i, 'SEO 수집기'],
  [/facebookexternalhit|twitterbot|slackbot|discordbot|telegrambot|kakaotalk-scrap/i, '링크 미리보기'],
  [/applebot|yandexbot|baiduspider|duckduckbot|amazonbot|slurp/i, '그밖 검색로봇'],
  [/\bbot\b|crawler|spider|crawling|headless/i, '그밖 로봇'],
]
function 로봇인가(req: import('node:http').IncomingMessage): string {
  const ua = String(req.headers['user-agent'] ?? '')
  if (!ua) return '그밖 로봇' // 프로그램 이름을 아예 안 보내는 것은 사람 브라우저가 아니다
  for (const [re, 이름] of 로봇들) if (re.test(ua)) return 이름
  return ''
}

// ⚠️ 「그밖 로봇」이 무엇인지 **이름을 남겨 둔다.** 칸 이름만 세면 27번이 찍혀도 그게
//    무슨 프로그램인지 알 길이 없다(사장님 물음 2026-08-16: "그밖 로봇이 27번이라는데
//    이건 뭐야?"). 이름을 알아야 ①진짜 로봇이면 위 표에 제 칸을 만들어 주고
//    ②사람인데 잘못 걸린 것이면 규칙을 고칠 수 있다.
// ⚠️ **가짓수를 막아 둔다**(하루 40가지). 프로그램 이름은 누구나 아무렇게나 적을 수 있어
//    막지 않으면 그 자체가 파일을 부풀리는 구멍이 된다.
// ⚠️ 사람을 가리는 값이 아니다 — 프로그램 이름일 뿐이고, 개인을 알아볼 수 없다.
const 로봇이름표: Record<string, Record<string, number>> = {}
const 로봇이름파일 = dataFile('bot-agents.json')
let 로봇이름읽음 = false
/** 남겨 둔 로봇 이름표를 그대로 준다(운영 화면이 읽는다). */
async function 로봇이름읽기(): Promise<Record<string, Record<string, number>>> {
  try { return JSON.parse(await readFile(로봇이름파일, 'utf-8')) } catch { return {} }
}

async function 로봇이름남기기(req: import('node:http').IncomingMessage, 날: string) {
  try {
    if (!로봇이름읽음) {
      로봇이름읽음 = true
      try { Object.assign(로봇이름표, JSON.parse(await readFile(로봇이름파일, 'utf-8'))) } catch { /* 처음이면 빈 채로 */ }
    }
    const 칸 = (로봇이름표[날] ??= {})
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 160) || '(이름 없음)'
    if (!(ua in 칸) && Object.keys(칸).length >= 40) return
    칸[ua] = (칸[ua] ?? 0) + 1
    for (const k of Object.keys(로봇이름표).sort().slice(0, -14)) delete 로봇이름표[k] // 두 주만
    await writeJsonFile(로봇이름파일, 로봇이름표)
  } catch { /* 적다 실패해도 방문 집계는 계속돼야 한다 */ }
}

async function 유입기록(req: import('node:http').IncomingMessage, 날: string) {
  try {
    const 몸 = await readBody(req, 2_000).catch(() => '')
    let 말 = String((JSON.parse(몸 || '{}') as { from?: unknown }).from ?? '')
    // ⚠️ **로봇 판정이 「직접」보다 먼저다.** 구글봇이 구글 검색에서 왔다고 적어 보내는
    //    일은 없지만, 참고 주소 없이 오는 것은 대부분 로봇이라 그 칸을 갈라 준다.
    const 로봇 = 로봇인가(req)
    if (로봇) {
      말 = 로봇
      // 「그밖」으로 뭉뚱그려진 것만 이름을 남긴다 — 이름이 붙은 로봇은 이미 안다.
      if (로봇.startsWith('그밖')) await 로봇이름남기기(req, 날)
    }
    else if (말 === '직접') 말 = '직접(사람)'
    if (!유입낱말.has(말)) return
    if (!유입표) {
      try { 유입표 = JSON.parse(await readFile(VISIT_FROM_FILE, 'utf-8')) } catch { 유입표 = {} }
    }
    const 칸 = (유입표![날] ??= {})
    칸[말] = (칸[말] ?? 0) + 1
    // 방문 숫자와 같은 기간(400일)만 남긴다.
    const 남길 = Object.keys(유입표!).sort().slice(-400)
    if (남길.length < Object.keys(유입표!).length) {
      const 새: typeof 유입표 = {}
      for (const d of 남길) 새[d] = 유입표![d]
      유입표 = 새
    }
    await writeJsonFile(VISIT_FROM_FILE, 유입표)
  } catch {
    /* 유입경로는 곁다리다 — 실패해도 방문 세기를 막지 않는다 */
  }
}

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
    // ⚠️ 유입경로는 **방문 숫자와 따로** 담는다. 방문 파일에 섞으면 날짜 칸과 낱말 칸이
    //    한 객체에 뒤섞여 `prune`이 낱말까지 지운다.
    // ⚠️ 화면이 보낸 낱말만 받는다(허용목록). 아무 글이나 받으면 그게 곧 저장 구멍이다.
    await 유입기록(req, today)
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
    // 유입경로 — 최근 14일치만. 낱말과 횟수뿐이라 개인정보가 아니다.
    if (!유입표) {
      try { 유입표 = JSON.parse(await readFile(VISIT_FROM_FILE, 'utf-8')) } catch { 유입표 = {} }
    }
    const 최근 = Object.keys(유입표!).sort().slice(-14)
    const from = 최근.map((date) => ({ date, counts: 유입표![date] }))
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
    // ── 회원별 이용 현황 ────────────────────────────────────────────────────
    // 사장님 요청(2026-08-11): "가입한지 얼마나 됐는지와 사이트 사용 얼마나 했는지".
    // ⚠️⚠️ **회원번호(kakao:1234…)는 절대 안 내보낸다.** 그건 로그인 식별자라 밖으로
    //    나가면 안 되고, 「누가 쓰나」를 보는 데는 닉네임이면 충분하다.
    //    닉네임은 사장님 요청(2026-08-11 "넣어줘")으로 낸다 — 그 전에는 이것도 뺐는데,
    //    「일주일 넘게 안 온 8명」이 누구인지 알 수가 없어 쓸모가 없었다.
    //    운영자만 부를 수 있는 경로다(위에서 isAdmin이 아니면 404).
    // ⚠️ 닉네임은 **본인이 우리 사이트에서 직접 정한 이름**이다. 카카오·네이버에서
    //    받아오는 게 아니다(동의항목에서 이름·이메일을 아예 요청하지 않는다).
    //    아직 안 정한 사람은 null이므로 화면에서 빈칸으로 나온다.
    // ⚠️ 뽑기를 한 번도 안 한 회원도 세어야 한다 — 「가입만 하고 안 쓰는 사람」이
    //    몇 명인지가 이 표에서 제일 중요한 숫자다.
    const 회원 = await loadUsers()
    const 뽑기전체 = await loadPacksim()
    const 오늘 = kstDateStr()
    const 며칠전 = (날: string) => {
      const t = Date.parse(`${날}T00:00:00Z`)
      return Number.isFinite(t) ? Math.floor((Date.parse(`${오늘}T00:00:00Z`) - t) / 86_400_000) : null
    }
    const members = 회원
      .map((u) => {
        const p = 뽑기전체[u.id]
        // ⚠️ 가입일은 **한국시간**으로 끊는다. UTC로 자르면 오전 0~9시에 가입한 사람이
        //    하루 전날로 찍혀 "가입한지 며칠"이 하루씩 어긋난다.
        const 가입 = u.createdAt ? kstDateStr(u.createdAt) : ''
        return {
          닉네임: (u.nickname ?? '').trim(),
          가입일: 가입,
          가입한지: 가입 ? 며칠전(가입) : null,
          로그인수: Array.isArray(u.logins) ? u.logins.length : 0,
          마지막출석: p?.lastCheckIn || '',
          안온지: p?.lastCheckIn ? 며칠전(p.lastCheckIn) : null,
          연속: p?.streak ?? 0,
          GP: p?.balance ?? 0,
          깐팩: p?.opened ?? 0,
          쓴GP: p?.spent ?? 0,
          앨범: Array.isArray(p?.album) ? p.album.length : 0,
        }
      })
      .sort((a, b) => (b.깐팩 || 0) - (a.깐팩 || 0))
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        items,
        total: legacy + items.reduce((s, i) => s + i.count, 0),
        memberCount,
        credits,
        members,
        from,
        // ⚠️ 「그밖 로봇」이 무엇인지 **이름 그대로** 같이 내려준다. 칸(구글봇·네이버봇처럼)을
        //    미리 만들어 두지 않아도 사장님이 화면에서 바로 확인하실 수 있게 하려는 것이다
        //    (사장님 물음 2026-08-16: "지금 바로 안만들어도 어디 봇인지 판별이 돼?").
        //    운영자만 부를 수 있는 경로이고, 담긴 것은 프로그램 이름뿐이다.
        botAgents: await 로봇이름읽기(),
      }),
    )
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
          await 날짜별쌓기('artist', label)
        }
        // ⚠️⚠️ **대전쟁은 어느 판인지가 알맹이다.** 라벨을 안 쌓으면 「몇 번 했나」만 알고
        //    **어느 스테이지에서 막히는지**를 못 본다 — 라벨을 붙여 놓고 서버가 버리고 있었다
        //    (2026-08-17에 잡음). 시작/깸/짐을 한 표에 넣되 이름 앞에 무엇인지 붙인다.
        // ⚠️⚠️ **왜 졌나는 「짐까닭:」을 앞에 붙여 같은 표에 넣는다.** ' · '가 한 번도
        //    없으므로 판별·난이도별 셈(`전투줄읽기`)은 이 줄을 그냥 건너뛴다 — 표를
        //    나누지 않고도 안 섞인다.
        // ⚠️ 이 갈래를 **아래 `battle_`보다 먼저** 둔다. 안 그러면 clear·lose가 아니라는
        //    이유로 「시작」으로 세어진다.
        // ⚠️⚠️⚠️ **`battle_`로 시작한다고 다 판 표에 넣으면 안 된다.** `startsWith('battle_')`로
        //    받았더니 `battle_card_detail`의 라벨(포켓몬 이름)이 **스테이지인 척** 들어와
        //    「이상해씨 · 시작 1」 같은 유령 줄이 생기고 시작 수까지 부풀었다(2026-08-18 실측).
        //    ⚠️ **판 표에 들어갈 이벤트를 이름으로 못 박는다.** 대전쟁에 새 이벤트를 더할 때
        //       이 목록을 안 건드리면 저절로 안 섞인다 — 그게 맞는 기본값이다.
        if (ev === 'battle_why' && label) {
          await 날짜별쌓기('battle', `짐까닭:${label}`)
        } else if ((ev === 'battle_start' || ev === 'battle_clear' || ev === 'battle_lose'
                    || ev === 'battle_quit') && label) {
          const 말 = ev === 'battle_clear' ? '깸' : ev === 'battle_lose' ? '짐'
            : ev === 'battle_quit' ? '그만둠' : '시작'
          await 날짜별쌓기('battle', `${label} · ${말}`)
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
          await 날짜별쌓기('set', key)
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
    // 날짜별 작가·세트 순위(2026-08-16부터 쌓인다). 달력에서 하루를 고르면 이걸 쓴다.
    if (!날짜순위) {
      try { 날짜순위 = JSON.parse(await readFile(DAY_RANK_FILE, 'utf-8')) } catch { 날짜순위 = {} }
    }
    const dayRanks: Record<string, {
      artists: { name: string; count: number }[]
      sets: { name: string; count: number }[]
      battles: { name: string; count: number }[]
    }> = {}
    for (const [날, 칸] of Object.entries(날짜순위!)) {
      const 줄세우기 = (o?: Record<string, number>) =>
        Object.entries(o ?? {}).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20)
      dayRanks[날] = { artists: 줄세우기(칸.artist), sets: 줄세우기(칸.set), battles: 줄세우기(칸.battle) }
    }
    // 대전쟁은 **누적 순위도** 낸다 — 하루치만 보면 「이 판이 어렵다」가 안 보인다.
    const 전투누적: Record<string, number> = {}
    for (const 칸 of Object.values(날짜순위!)) for (const [k, v] of Object.entries(칸.battle ?? {})) 전투누적[k] = (전투누적[k] ?? 0) + v
    const battleRanking = Object.entries(전투누적)
      .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 60)
    res.end(JSON.stringify({ days: all, artists: artistRanking, sets: setRanking, battles: battleRanking, dayRanks }))
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
        const b = JSON.parse(await readBody(req)) as {
          title?: string
          raw?: string
          link?: string
          note?: string
        }
        const title = (b.title ?? '').slice(0, 120)
        if (!title.trim()) {
          res.statusCode = 400
          res.end()
          return
        }
        // ⚠️ 사용자가 적은 메모(2026-08-18). **화면에서도 200자로 막지만 여기서 또 자른다** —
        //    화면의 제한은 사람에게 알려 주는 것일 뿐, 서버로 곧장 보내면 소용이 없다.
        // ⚠️ **비어 있는 것이 정상이다.** 「보내기」를 눌렀다는 것 자체가 신고이고,
        //    메모는 안 써도 되게 두었다. 빈 값이면 칸을 아예 안 남긴다 — 옛 신고와
        //    똑같은 모양이 되어 화면에서 따로 갈라 그릴 것이 없다.
        const note = (b.note ?? '').trim().slice(0, MAX_FEEDBACK_NOTE)
        const all = await load()
        all.push({
          title,
          raw: (b.raw ?? '').slice(0, 200),
          link: (b.link ?? '').slice(0, 200),
          ...(note ? { note } : {}),
          at: Date.now(),
        })
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
// ⚠️ 감정 등급은 「회사 + 등급」 한 벌 문자열이다("PSA 10"). 회사를 드롭다운으로
//    정확히 받는 까닭은 데이터다(사장님 2026-08-21) — 나중에 회사별 시세를 가르려면
//    앞 낱말이 회사 이름으로 고정돼 있어야 한다. 화면(src/api/flea.ts SLAB_COMPANIES)과
//    같은 표에서 나온 조합이라 두 곳을 같이 고칠 것.
export const FLEA_SLAB_GRADES = [
  'PSA 10', 'PSA 9', 'PSA 8 이하',
  'BGS 10 블랙라벨', 'BGS 10', 'BGS 9.5', 'BGS 9 이하',
  'CGC 10 퍼펙트', 'CGC 10', 'CGC 9.5', 'CGC 9 이하',
  'SGC 10', 'SGC 9.5', 'SGC 9 이하',
  'ARS 10+', 'ARS 10', 'ARS 9', 'ARS 8 이하',
  '기타 감정품',
] as const
const FLEA_ALL_GRADES: string[] = [...FLEA_RAW_GRADES, ...FLEA_SLAB_GRADES]
// 다루는 판과 확장팩은 **화면과 같은 한 벌**을 쓴다(src/lib/fleaSets.ts).
const FLEA_EDITIONS = Object.keys(FLEA_EDITION_LABEL) as (keyof typeof FLEA_EDITION_LABEL)[]

// 구매 희망(매수 호가). 카드 단위로 "이 값에 사고 싶다"를 걸어 둔다 —
// 파는 쪽이 이걸 보고 「이 값에 팔기」로 응할 수 있다(사장님 2026-08-21).
// 주식 관례대로 화면에서 매수는 빨강, 매도(매물)는 파랑이다.
export type FleaBid = {
  id: number
  buyerId: string
  buyer: string
  cardSlug: string
  cardNo: string
  cardName: string
  setName: string
  cardImg: string
  edition: (typeof FLEA_EDITIONS)[number]
  price: number
  status: 'open' | 'cancelled'
  createdAt: number
}

// 거래 대화방. 구매 희망의 「판매하기」·매물의 「문의하기」로 두 사람이 이어진다.
// 대화는 자유지만 **최종 금액은 「거래 확정」 버튼으로만 남는다** — 채팅 글 속 숫자는
// 시세 자료가 못 된다(사장님 방향 2026-08-21: 당근의 편함 + 기록은 버튼).
export type FleaChatRoom = {
  id: number
  cardSlug: string
  cardNo: string
  cardName: string
  setName: string
  cardImg: string
  edition: (typeof FLEA_EDITIONS)[number]
  // 어디서 열렸나 — 구매 희망(bid)인지 매물(listing)인지. 방 위에 참고가로 고정된다.
  source: 'bid' | 'listing'
  refId: number
  refPrice: number
  aId: string
  aNick: string
  bId: string
  bNick: string
  // 진행 중인 확정 제안. 수락·거절되면 지우고, 결과는 메시지로 남는다.
  제안?: { price: number; byId: string; at: number }
  성사가?: number
  reads: Record<string, number>
  lastAt: number
  lastText: string
  createdAt: number
}

export type FleaChatMsg = {
  id: number
  roomId: number
  senderId: string
  sender: string
  // system은 「거래 확정 제안·수락」 같은 안내 줄이다.
  type: 'text' | 'image' | 'system'
  text: string
  image: string
  createdAt: number
}

type FeedbackRow = {
  id: number
  text: string
  // 로그인 안 한 의견은 빈 문자열. 닉네임은 저장하지 않고 보여줄 때 찾는다 —
  // 닉네임이 바뀌거나 초기화돼도 따라가게(신고함과 같은 방식).
  authorId: string
  at: number
}

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
const MAX_FLEA_IMAGES = 10 // 앞·뒤 전체 2 + 앞·뒤 모서리 4×2 (사장님 규격 2026-08-21)
const FLEA_MAX_PRICE = 100_000_000

function mountFleaMarket(app: Mountable) {
  let config: FleaConfig | null = null
  let listings: FleaListing[] | null = null
  let offers: FleaOffer[] | null = null
  let deals: FleaDeal[] | null = null
  let bids: FleaBid[] | null = null
  let chatRooms: FleaChatRoom[] | null = null
  let chatMsgs: FleaChatMsg[] | null = null
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
  let feedbackRows: FeedbackRow[] | null = null
  const loadFeedback = () =>
    loadList<FeedbackRow>('feedback', FEEDBACK_FILE, () => feedbackRows, (v) => { feedbackRows = v })
  const loadOffers = () =>
    loadList<FleaOffer>('flea-offers', FLEA_OFFERS_FILE, () => offers, (v) => { offers = v })
  const loadBids = () =>
    loadList<FleaBid>('flea-bids', FLEA_BIDS_FILE, () => bids, (v) => { bids = v })
  const loadChatRooms = () =>
    loadList<FleaChatRoom>('flea-chats', FLEA_CHATS_FILE, () => chatRooms, (v) => { chatRooms = v })
  const loadChatMsgs = () =>
    loadList<FleaChatMsg>('flea-chat-msgs', FLEA_CHAT_MSGS_FILE, () => chatMsgs, (v) => { chatMsgs = v })
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
        // ⚠️ **정해 둔 세트 밖은 올릴 수 없다**(FLEA_SET_SLUGS 설명 참고).
        //    검색에서도 안 보이지만, 주소로 직접 찔러 넣는 것을 여기서 막는다.
        if (!FLEA_SET_SET.has(cardSlug)) {
          sendJson(res, 400, { error: '지금은 정해진 확장팩의 카드만 올릴 수 있습니다.' })
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
        // 사진은 등급과 무관하게 10장 고정이다(사장님 규격 2026-08-21) —
        // 앞·뒤 전체 1장씩 + 앞·뒤 모서리(왼위·오위·왼아래·오아래) 4장씩.
        // ⚠️ 배열 차례가 곧 자리다(src/api/flea.ts PHOTO_SLOTS). 상세 화면이 차례로
        //    이름표를 붙이므로 여기서 순서를 건드리면 안 된다.
        if (images.length < MAX_FLEA_IMAGES) {
          sendJson(res, 400, { error: '사진 10장이 필요합니다 — 앞·뒤 전체와 앞·뒤 모서리 4장씩.' })
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

    const out: unknown[] = []
    let total = 0
    for (const r of idx.rows) {
      const [slug, n, name, img, koName, koImg, koNo] = r
      // ⚠️ **정해 둔 세트 밖은 아예 안 보여 준다**(FLEA_SET_SLUGS 설명 참고).
      //    검색에서 나오면 올릴 수 있다고 읽히므로, 올리기를 막기 전에 여기서 먼저 막는다.
      if (!FLEA_SET_SET.has(slug)) continue
      const set = idx.sets[slug]
      if (!set) continue
      // 한글판은 한글 이미지가 붙은 카드만(아직 한글로 안 나온 카드가 섞이면 빈 칸이 된다).
      if (ed === 'kr' && !koImg) continue
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

  // ── 의견함 ─────────────────────────────────────────────────────
  //    홈 배너의 「의견 보내기」. 로그인 없이도 받는다(시세 조회를 비로그인에 연 것과
  //    같은 잣대) — 대신 IP당 시간당 5건으로 막는다. 읽는 건 운영자뿐이다(신고함 화면).
  const 의견허용 = rateLimiter(5, 60 * 60 * 1000)
  app.use('/api/local/feedback', async (req, res) => {
    if (req.method === 'POST') {
      if (!의견허용(req)) {
        tooManyRequests(res)
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { text?: unknown }
        const text = str(b.text, 500).trim()
        if (!text) {
          sendJson(res, 400, { error: '내용이 없습니다.' })
          return
        }
        const user = await currentUser(req)
        const rows = await loadFeedback()
        rows.push({ id: nextId(rows), text, authorId: user?.id ?? '', at: Date.now() })
        await writeJsonFile(FEEDBACK_FILE, rows)
        sendJson(res, 201, { ok: true })
      } catch {
        sendJson(res, 400, { error: '보내지 못했습니다.' })
      }
      return
    }

    // 여기부터는 운영자만. 아니면 경로가 있다는 것도 안 알린다(신고함과 같은 잣대).
    const user = await currentUser(req)
    if (!isAdmin(user)) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const url = new URL(req.url ?? '', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)

    // DELETE /<id> — 확인 끝난 의견 지우기.
    if (req.method === 'DELETE' && segments.length === 1) {
      const rows = await loadFeedback()
      const idx = rows.findIndex((r) => r.id === Number(segments[0]))
      if (idx >= 0) {
        rows.splice(idx, 1)
        await writeJsonFile(FEEDBACK_FILE, rows)
      }
      sendJson(res, 200, { ok: true })
      return
    }

    // GET — 최근 것부터. 회원번호는 화면에 안 내보내고 닉네임만 찾아 붙인다.
    const [rows, everyone] = await Promise.all([loadFeedback(), loadUsers()])
    sendJson(
      res,
      200,
      [...rows]
        .sort((a, b) => b.at - a.at)
        .map((r) => ({ id: r.id, text: r.text, at: r.at, author: r.authorId ? authorName(r.authorId, everyone) : null })),
    )
  })

  // ── 거래 대화방 ────────────────────────────────────────────────
  //    글·사진은 자유, **최종 금액만 확정 버튼**으로 남긴다(그래야 시세 자료가 된다).
  //    새 메시지는 화면이 5초마다 물어 간다(폴링) — 푸시 알림은 없다.
  //    ⚠️ 지금은 운영자 혼자 쓰는 단계라 **자기 자신과의 방도 허용**한다(시험용).
  //       회원 공개 전에 반드시 막을 것.
  app.use('/api/local/flea/chats', async (req, res) => {
    const user = await currentUser(req)
    if (!isAdmin(user) || !user) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const url = new URL(req.url ?? '', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    const 방들 = await loadChatRooms()
    const 내방인가 = (r: FleaChatRoom) => r.aId === user.id || r.bId === user.id

    // POST /chats — 방 열기(있으면 그 방). { source: 'bid'|'listing', refId }
    if (req.method === 'POST' && segments.length === 0) {
      if (!allowWrite(req)) {
        tooManyRequests(res)
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { source?: unknown; refId?: unknown }
        const refId = Number(b.refId)
        let 카드: Pick<FleaChatRoom, 'cardSlug' | 'cardNo' | 'cardName' | 'setName' | 'cardImg' | 'edition' | 'refPrice'>
        let 상대: { id: string; nick: string }
        if (b.source === 'bid') {
          const bid = (await loadBids()).find((x) => x.id === refId && x.status === 'open')
          if (!bid) {
            sendJson(res, 404, { error: '이미 내려간 구매 희망입니다.' })
            return
          }
          카드 = { cardSlug: bid.cardSlug, cardNo: bid.cardNo, cardName: bid.cardName, setName: bid.setName, cardImg: bid.cardImg, edition: bid.edition, refPrice: bid.price }
          상대 = { id: bid.buyerId, nick: bid.buyer }
        } else if (b.source === 'listing') {
          const l = (await loadListings()).find((x) => x.id === refId && x.status === 'open')
          if (!l) {
            sendJson(res, 404, { error: '이미 없는 매물입니다.' })
            return
          }
          카드 = { cardSlug: l.cardSlug, cardNo: l.cardNo, cardName: l.cardName, setName: l.setName, cardImg: l.cardImg, edition: l.edition, refPrice: l.price }
          상대 = { id: l.sellerId, nick: l.seller }
        } else {
          sendJson(res, 400, { error: '잘못된 요청입니다.' })
          return
        }
        const 이미 = 방들.find((r) => r.source === b.source && r.refId === refId && 내방인가(r))
        if (이미) {
          sendJson(res, 200, 방보내기(이미, user.id))
          return
        }
        const row: FleaChatRoom = {
          id: nextId(방들),
          ...카드,
          source: b.source,
          refId,
          aId: user.id,
          aNick: user.nickname ?? '회원',
          bId: 상대.id,
          bNick: 상대.nick,
          reads: { [user.id]: Date.now() },
          lastAt: Date.now(),
          lastText: '',
          createdAt: Date.now(),
        }
        방들.push(row)
        await writeJsonFile(FLEA_CHATS_FILE, 방들)
        sendJson(res, 201, 방보내기(row, user.id))
      } catch {
        sendJson(res, 400, { error: '열지 못했습니다.' })
      }
      return
    }

    // POST /chats/<id>/messages — 글 또는 사진 하나
    if (req.method === 'POST' && segments.length === 2 && segments[1] === 'messages') {
      if (!allowWrite(req)) {
        tooManyRequests(res)
        return
      }
      const room = 방들.find((r) => r.id === Number(segments[0]) && 내방인가(r))
      if (!room) {
        sendJson(res, 404, { error: '없는 대화입니다.' })
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { text?: unknown; image?: unknown }
        const text = str(b.text, 1000)
        const image = typeof b.image === 'string' && /^\/uploads\/[\w.-]+$/.test(b.image) ? b.image : ''
        if (!text && !image) {
          sendJson(res, 400, { error: '내용이 없습니다.' })
          return
        }
        const msgs = await loadChatMsgs()
        const msg: FleaChatMsg = {
          id: nextId(msgs),
          roomId: room.id,
          senderId: user.id,
          sender: user.nickname ?? '회원',
          type: image ? 'image' : 'text',
          text,
          image,
          createdAt: Date.now(),
        }
        msgs.push(msg)
        await writeJsonFile(FLEA_CHAT_MSGS_FILE, msgs)
        room.lastAt = msg.createdAt
        room.lastText = image ? '사진' : text.slice(0, 40)
        room.reads[user.id] = msg.createdAt
        await writeJsonFile(FLEA_CHATS_FILE, 방들)
        sendJson(res, 201, 메시지보내기(msg, user.id))
      } catch {
        sendJson(res, 400, { error: '보내지 못했습니다.' })
      }
      return
    }

    // POST /chats/<id>/deal — 확정 제안 { price } / 응답 { accept }
    if (req.method === 'POST' && segments.length === 2 && segments[1] === 'deal') {
      const room = 방들.find((r) => r.id === Number(segments[0]) && 내방인가(r))
      if (!room) {
        sendJson(res, 404, { error: '없는 대화입니다.' })
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as { price?: unknown; accept?: unknown }
        const msgs = await loadChatMsgs()
        const 알림 = async (글: string) => {
          const m: FleaChatMsg = { id: nextId(msgs), roomId: room.id, senderId: '', sender: '', type: 'system', text: 글, image: '', createdAt: Date.now() }
          msgs.push(m)
          await writeJsonFile(FLEA_CHAT_MSGS_FILE, msgs)
          room.lastAt = m.createdAt
          room.lastText = 글
        }
        if (typeof b.accept === 'boolean') {
          const 제안 = room.제안
          if (!제안) {
            sendJson(res, 400, { error: '진행 중인 제안이 없습니다.' })
            return
          }
          // 자기 자신과의 방(운영자 시험용)에서는 본인이 답해도 된다 — 아니면
          // 혼자서는 확정 흐름을 끝까지 못 눌러 본다. 회원 공개 때 방 자체를 막는다.
          if (제안.byId === user.id && room.aId !== room.bId) {
            sendJson(res, 400, { error: '상대가 답할 차례입니다.' })
            return
          }
          delete room.제안
          if (b.accept) {
            room.성사가 = 제안.price
            // 파는 쪽·사는 쪽은 **방을 연 경로**로 가른다(제안을 누가 냈는지와 무관하다):
            // · 구매 희망에서 열린 방 — 연 사람(a)이 팔러 온 것 → a가 판매, 희망 건 b가 구매
            // · 매물에서 열린 방 — 연 사람(a)이 문의한 것 → a가 구매, 매물 주인 b가 판매
            const sellerId = room.source === 'bid' ? room.aId : room.bId
            const buyerId = room.source === 'bid' ? room.bId : room.aId
            const done = await loadDeals()
            done.push({
              id: nextId(done),
              listingId: room.source === 'listing' ? room.refId : 0,
              cardSlug: room.cardSlug,
              cardNo: room.cardNo,
              cardName: room.cardName,
              edition: room.edition,
              // 대화 거래는 상태(등급) 합의가 대화 속에 있다 — 시세로 쓸 때는
              // 「대화 성사」 표시로 따로 걸러 다룬다(3단계 시세 공개 때 결정).
              grade: '대화 성사',
              price: 제안.price,
              sellerId,
              buyerId,
              at: Date.now(),
            })
            await writeJsonFile(FLEA_DEALS_FILE, done)
            // 성사된 근거는 내려간다 — 구매 희망이면 희망을, 매물이면 매물을 닫는다.
            if (room.source === 'bid') {
              const 희망들 = await loadBids()
              const 희망 = 희망들.find((x) => x.id === room.refId && x.status === 'open')
              if (희망) {
                희망.status = 'cancelled'
                await writeJsonFile(FLEA_BIDS_FILE, 희망들)
              }
            } else {
              const 매물들 = await loadListings()
              const 매물 = 매물들.find((x) => x.id === room.refId && x.status === 'open')
              if (매물) {
                매물.status = 'sold'
                await writeJsonFile(FLEA_LISTINGS_FILE, 매물들)
              }
            }
            await 알림(`거래 확정 — ${제안.price.toLocaleString()}원에 합의했습니다.`)
          } else {
            await 알림('확정 제안을 거절했습니다. 대화는 계속할 수 있습니다.')
          }
          await writeJsonFile(FLEA_CHATS_FILE, 방들)
          sendJson(res, 200, 방보내기(room, user.id))
          return
        }
        const price = Math.round(Number(b.price))
        if (!Number.isFinite(price) || price <= 0 || price > FLEA_MAX_PRICE) {
          sendJson(res, 400, { error: '금액을 다시 확인해 주세요.' })
          return
        }
        room.제안 = { price, byId: user.id, at: Date.now() }
        await 알림(`거래 확정 제안 — ${price.toLocaleString()}원`)
        await writeJsonFile(FLEA_CHATS_FILE, 방들)
        sendJson(res, 200, 방보내기(room, user.id))
      } catch {
        sendJson(res, 400, { error: '처리하지 못했습니다.' })
      }
      return
    }

    // GET /chats/<id>/messages — 읽으면 읽은 시각을 남긴다(안 읽음 셈의 근거)
    if (req.method === 'GET' && segments.length === 2 && segments[1] === 'messages') {
      const room = 방들.find((r) => r.id === Number(segments[0]) && 내방인가(r))
      if (!room) {
        sendJson(res, 404, { error: '없는 대화입니다.' })
        return
      }
      const msgs = (await loadChatMsgs()).filter((m) => m.roomId === room.id)
      room.reads[user.id] = Date.now()
      await writeJsonFile(FLEA_CHATS_FILE, 방들)
      sendJson(res, 200, { room: 방보내기(room, user.id), messages: msgs.map((m) => 메시지보내기(m, user.id)) })
      return
    }

    // GET /chats — 내 방 목록(안 읽음 수 포함), 최근 순
    const msgs = await loadChatMsgs()
    const rows = 방들
      .filter(내방인가)
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((r) => ({
        ...방보내기(r, user.id),
        안읽음: msgs.filter((m) => m.roomId === r.id && m.senderId !== user.id && m.createdAt > (r.reads[user.id] ?? 0)).length,
      }))
    sendJson(res, 200, rows)
    return

    function 방보내기(r: FleaChatRoom, meId: string) {
      const { aId, bId, reads: _r, ...rest } = r
      return {
        ...rest,
        상대: aId === meId ? r.bNick : r.aNick,
        제안: r.제안 ? { price: r.제안.price, 내가냈나: r.제안.byId === meId } : undefined,
      }
    }
    function 메시지보내기(m: FleaChatMsg, meId: string) {
      const { senderId, ...rest } = m
      return { ...rest, mine: senderId === meId }
    }
  })

  // ── 구매 희망(매수 호가) ────────────────────────────────────────
  //    카드에 걸린 "사고 싶은 값" 목록. 매물(매도)과 짝을 이루는 반대쪽 호가다.
  //    지금은 걸기·내리기만 있다 — 「이 값에 팔기」는 화면이 매물 올리기 폼에 그 값을
  //    미리 채워 주는 방식이라 서버가 따로 맺어 주지는 않는다(맺기는 다음 단계 후보).
  app.use('/api/local/flea/bids', async (req, res) => {
    const user = await currentUser(req)
    if (!isAdmin(user) || !user) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const url = new URL(req.url ?? '', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)

    if (req.method === 'POST' && segments.length === 0) {
      if (!allowWrite(req)) {
        tooManyRequests(res)
        return
      }
      try {
        const b = JSON.parse(await readBody(req)) as Record<string, unknown>
        const cardSlug = str(b.cardSlug, 80)
        const cardNo = str(b.cardNo, 40)
        const cardName = str(b.cardName, 120)
        const price = Math.round(Number(b.price))
        const edition = FLEA_EDITIONS.includes(b.edition as (typeof FLEA_EDITIONS)[number])
          ? (b.edition as (typeof FLEA_EDITIONS)[number])
          : 'jp'
        if (!/^[a-z]{2}-[A-Za-z0-9._-]+$/.test(cardSlug) || !/^[\w./-]+$/.test(cardNo) || !cardName) {
          sendJson(res, 400, { error: '카드를 골라 주세요.' })
          return
        }
        if (!Number.isFinite(price) || price <= 0 || price > FLEA_MAX_PRICE) {
          sendJson(res, 400, { error: '금액을 다시 확인해 주세요.' })
          return
        }
        const all = await loadBids()
        // 같은 카드에 걸린 내 희망이 이미 있으면 값만 바꾼 것으로 본다 — 줄줄이 쌓이면
        // 호가판이 한 사람 것으로 도배된다.
        const 이미 = all.find((x) => x.buyerId === user.id && x.cardSlug === cardSlug && x.cardNo === cardNo && x.status === 'open')
        if (이미) {
          이미.price = price
          이미.createdAt = Date.now()
          await writeJsonFile(FLEA_BIDS_FILE, all)
          const { buyerId: _h, ...safe } = 이미
          sendJson(res, 200, { ...safe, mine: true })
          return
        }
        const row: FleaBid = {
          id: nextId(all),
          buyerId: user.id,
          buyer: user.nickname ?? '회원',
          cardSlug,
          cardNo,
          cardName,
          setName: str(b.setName, 120),
          cardImg: str(b.cardImg, 300),
          edition,
          price,
          status: 'open',
          createdAt: Date.now(),
        }
        all.push(row)
        await writeJsonFile(FLEA_BIDS_FILE, all)
        const { buyerId: _hidden, ...safe } = row
        sendJson(res, 201, { ...safe, mine: true })
      } catch {
        sendJson(res, 400, { error: '걸지 못했습니다.' })
      }
      return
    }

    // DELETE /bids/<id> — 내 구매 희망 내리기
    if (req.method === 'DELETE' && segments.length === 1) {
      const id = Number(segments[0])
      const all = await loadBids()
      const row = all.find((x) => x.id === id && x.buyerId === user.id && x.status === 'open')
      if (!row) {
        sendJson(res, 404, { error: '없는 항목입니다.' })
        return
      }
      row.status = 'cancelled'
      await writeJsonFile(FLEA_BIDS_FILE, all)
      res.statusCode = 204
      res.end()
      return
    }

    // GET ?slug=&no= — 그 카드의 호가(비싼 값부터). slug 없으면 **내 것**만.
    const slug = url.searchParams.get('slug') ?? ''
    const no = url.searchParams.get('no') ?? ''
    const all = await loadBids()
    const rows = all
      .filter((x) => x.status === 'open')
      .filter((x) => (slug ? x.cardSlug === slug && x.cardNo === no : x.buyerId === user.id))
      .sort((a, b) => b.price - a.price || b.createdAt - a.createdAt)
      .map(({ buyerId, ...x }) => ({ ...x, mine: buyerId === user.id }))
    sendJson(res, 200, rows)
    return
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

// ── (없앰) 이베이 한글판(Korean Version) 시세 ─────────────────────────────
// **2026-08-10에 뺐다**(사장님 지시). Browse API로 "카드명 Korean Version"을 찾아
// **호가**를 보여 주던 길이다. 뺀 까닭:
//   · 나머지(이베이·TCGplayer)는 **낙찰가**인데 여기만 호가라 같은 화면에서 값의 뜻이 달랐다.
//   · 매물 **제목으로만** 찾아 세트·번호를 못 좁혔다 — 무작위 10장으로 재 보니 매물이
//     있던 4장이 **전부 다른 세트**였다(2026-08-07 실측).
// ⚠️ 되살리려면 이 자리에 mountEbayKorean과 /api/local/ebay-korean을 되돌리고,
//    App.tsx의 판 토글에 한글판 버튼을 다시 넣으면 된다.
// ⚠️ `EBAY_APP_ID`·`EBAY_CERT_ID`는 이제 **아무 데서도 안 쓴다.** Fly 시크릿에는
//    남아 있으니, 지울지는 사장님이 정한다(`fly secrets unset`).

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

{"found": true, "pokemonNameEn": "카드에 인쇄된 이름을 먼저 정확히 읽어 어떤 포켓몬/트레이너인지 알아낸 뒤, 그 카드가 영문판 포켓몬 카드에서 쓰는 공식 영어 이름으로 답하라(추측 금지, 인쇄된 이름 기준). ex·V·VMAX·VSTAR·GX 표기가 있으면 포함(예: Greninja ex, Pikachu V)", "cardNumber": "카드 번호(예: 086/083, 209/XY-P, 025/165). 반사로 흐릿해 확실치 않으면 절대 지어내지 말고 null. 틀린 번호보다 null이 낫다", "setCode": "세트 코드(예: M4, SV5a, XY-P). 번호 옆이나 라벨에서. 안 보이면 null", "edition": "카드 자체에 인쇄된 언어 기준(사진 속 앱 화면·설명글은 절대 보지 마라). 일본어면 \\"japanese\\", 한국어여도 반드시 \\"japanese\\"로 답하라, 영어면 \\"english\\". \\"korean\\"이라고 답하지 마라", "illustrator": "일러스트레이터 이름을 인쇄된 로마자 그대로(예: Mitsuhiro Arita, 5ban Graphics). \\"Illus.\\"는 빼고 이름만. 안 보이면 null", "hp": "HP 숫자만(예: 210). 없거나 안 보이면 null", "rarity": "카드 오른쪽 아래 레어도 기호나 글자(예: RR, SAR, AR, C, U, R). 안 보이면 null", "year": "카드나 라벨에 적힌 발매연도 4자리(예: 2023). 안 보이면 null", "graded": "등급 케이스에 들어 있으면 true, 맨 카드면 false", "gradeCompany": "등급 회사(PSA, BGS, CGC, SGC, ARS 등). 케이스가 아니거나 안 보이면 null", "grade": "감정 등급(예: 10, 9.5). 안 보이면 null"}

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

// ── 포켓몬 디펜스 시즌1 — 계정에 붙는 기록 ────────────────────────────────
//
// ⚠️⚠️ **게임은 로그인 없이도 다 된다.** 로그인한 사람만 기록이 **계정에 남을 뿐**이다
//    (사장님 2026-08-18: "비로그인 로그인 다 가능하게는 해줘 근데 로그인한 회원은 기록을 써주자").
//    비로그인은 지금처럼 브라우저(localStorage)에만 남는다 — 기기를 바꾸면 처음부터다.
// ⚠️ 담는 것은 **깬 판 이름과 판별 최고 별**뿐이다. 사람을 알아볼 것은 회원번호 말고 안 담는다.
// ⚠️⚠️ **별은 낮은 값으로 덮어쓰지 않는다.** 어려움으로 ★★★을 딴 뒤 쉬움으로 다시 깨도
//    ★★★이 남아야 한다 — 화면 쪽 규칙과 같아야 하므로 서버에서도 `max`로 합친다.
const BATTLE_FILE = dataFile('battle.json')
/** 회원번호 → { 판이름: 최고 별 }. 깬 판은 별이 1 이상인 것으로 알 수 있다. */
interface 디펜스기록 { stars: Record<string, number>; at: string }
let 디펜스: Record<string, 디펜스기록> | null = null

async function load디펜스(): Promise<Record<string, 디펜스기록>> {
  if (디펜스) return 디펜스
  return firstReadOnce('battle', async () => {
    if (디펜스) return 디펜스
    try {
      const raw = JSON.parse(await readFile(BATTLE_FILE, 'utf-8')) as Record<string, 디펜스기록>
      // ⚠️ 회원번호에 접두어를 붙이는 규칙이 있다 — 안 붙이면 로그인은 되는데 기록이 빈다.
      디펜스 = Object.fromEntries(Object.entries(raw).map(([id, v]) => [migrateId(id), v]))
    } catch {
      await rescueCorrupt(BATTLE_FILE)
      디펜스 = {}
    }
    return 디펜스!
  })
}

async function persist디펜스() {
  await mkdir(path.dirname(BATTLE_FILE), { recursive: true })
  await writeJsonFile(BATTLE_FILE, 디펜스)
}

// ── 게임평 — **로그인하면 누구나 쓰고, 서로 읽는다** (2026-08-18) ──────────
//
// ⚠️⚠️ **처음에는 「별 36개 만점인 사람만」이었다가 걷어냈다**(사장님 2026-08-18).
//    "남이 쓴 게 보여야 다음 사람도 쓴다" — 그래서 **읽기는 누구나**(로그인도 필요 없다),
//    **쓰기는 로그인한 사람**, **지우기는 운영자**다.
//    자격이 헐거워진 만큼 **막는 것들이 더 중요해졌다**(200자·하루 한 번·같은 글·링크).
//
// ⚠️⚠️ **회원번호는 답에 절대 안 실린다.** 남에게 보이는 목록이라 더 그렇다 —
//    도배를 막고 하루 한 번을 세는 데만 쓴다. 보이는 이름은 **사람이 직접 적은 것**뿐이다.
// ⚠️ 통계에는 안 붙인다(지휘부 지시).
const BATTLE_REVIEW_FILE = dataFile('battle-reviews.json')
interface 게임평 { id: string; at: number; 이름: string; 글: string; 별: number; uid: string }
let 게임평들: 게임평[] | null = null

async function load게임평(): Promise<게임평[]> {
  if (게임평들) return 게임평들
  return firstReadOnce('battle-reviews', async () => {
    if (게임평들) return 게임평들
    try {
      게임평들 = JSON.parse(await readFile(BATTLE_REVIEW_FILE, 'utf-8')) as 게임평[]
    } catch {
      await rescueCorrupt(BATTLE_REVIEW_FILE)
      게임평들 = []
    }
    return 게임평들!
  })
}

async function persist게임평() {
  await mkdir(path.dirname(BATTLE_REVIEW_FILE), { recursive: true })
  await writeJsonFile(BATTLE_REVIEW_FILE, 게임평들)
}

/** 글 길이 제한. 짧게 쓰라는 뜻이 아니라 **화면이 감당할 수 있는 길이**다. */
const 게임평글자수 = 200

/**
 * 그 사람의 별 합계. **자격에는 안 쓴다**(2026-08-18에 만점 조건을 걷어냈다) —
 * 글 옆에 「★ 몇 개인 사람이 썼나」를 같이 보이려고 담는다.
 */
function 별합(기록: 디펜스기록 | undefined): number {
  if (!기록) return 0
  return Object.values(기록.stars).reduce((a, b) => a + (Number(b) || 0), 0)
}

/** 별 표를 다듬는다. **화면에서 온 값을 그대로 믿지 않는다.** */
function 별표다듬(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {}
  const 나온것: Record<string, number> = {}
  let n = 0
  for (const [이름, 별] of Object.entries(v as Record<string, unknown>)) {
    // ⚠️ 판이 12개뿐이라 넉넉히 40칸이면 충분하다. 없으면 아무 열쇠나 무한정 들어온다.
    if (n >= 40) break
    if (typeof 이름 !== 'string' || 이름.length > 40) continue
    const x = Math.floor(Number(별))
    if (!Number.isFinite(x) || x < 1 || x > 3) continue
    나온것[이름] = x
    n++
  }
  return 나온것
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
// GP 이용 내역 한 줄. 금액은 실제로 오간 값(+들어옴 / -나감), 잔액은 그 직후 값이다.
type GpLog = { at: number; 종류: string; 금액: number; 잔액: number; 메모?: string }

interface PackSimStore {
  balance: number
  lastCheckIn: string // 한국시간 'YYYY-MM-DD'
  streak: number
  opened: number
  spent: number
  god: number
  album: AlbumCard[]
  // GP 이용 내역(최근 GP_LOG_MAX줄). ⚠️ **만든 날(2026-08-22)부터 쌓인다** —
  // 그전에는 잔액·누적만 저장했어서 지난 내역은 되살릴 수가 없다.
  log?: GpLog[]
  // 운영자가 보낸 선물 중 아직 안 본 것. 화면이 한 번 알리고 지운다.
  pendingGift?: { amount: number; message: string; at: number }
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

// GP가 오간 것을 한 줄 남긴다.
// ⚠️ **잔액을 바꾼 뒤에** 부른다 — 적히는 잔액이 그 시점 값이어야 한다.
// ⚠️ 0원은 안 남긴다. 상한에 걸려 실제로는 안 들어온 경우가 그렇고, 그걸 적으면
//    "받았는데 잔액이 그대로"인 줄이 생겨 오히려 헷갈린다.
const GP_LOG_MAX = 100
function gp기록(store: PackSimStore, 종류: string, 금액: number, 메모?: string): void {
  if (!금액) return
  const 줄: GpLog = { at: Date.now(), 종류, 금액, 잔액: store.balance, ...(메모 ? { 메모 } : {}) }
  store.log = [줄, ...(store.log ?? [])].slice(0, GP_LOG_MAX)
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

/**
 * 받은 덤프를 `/data/export-<종류>.csv`로 남긴다. 실패해도 시세 갱신은 그대로 간다.
 * ⚠️ 디스크는 1GB뿐이다. 날짜별로 쌓지 않고 **종류마다 최신 한 벌만** 둔다.
 */
async function 덤프저장(종류: string, text: string): Promise<void> {
  const 곳 = dataFile(`export-${종류}.csv`)
  try {
    await mkdir(path.dirname(곳), { recursive: true })
    await writeFile(곳, text)
    console.log(`[pokegre] ${종류} 덤프를 남겼습니다: ${곳} · ${(Buffer.byteLength(text) / 1024 / 1024).toFixed(1)}MB`)
  } catch (e) {
    console.log(`[pokegre] ${종류} 덤프를 못 남겼습니다(시세 갱신은 계속합니다): ${String(e).slice(0, 80)}`)
  }
}

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
      // ⚠️⚠️ **429일 때만 "오늘 받았다"로 적는다.**
      //    예전엔 어떤 실패든 적었다. 그러면 저쪽이 잠깐 500을 내거나 네트워크가 한 번
      //    끊긴 것만으로 **그날 시세가 통째로 안 들어온다** — 다음 시간에 다시 시도할
      //    기회를 스스로 없애기 때문이다.
      //    429는 "오늘 몫을 다 썼다"는 뜻이라 오늘 다시 두드려 봐야 소용없다(적는 게 맞다).
      //    그 밖의 실패는 **안 적는다** — 한 시간 뒤 확인 때 다시 해 본다.
      const 몫바닥 = r.status === 429
      console.log(
        `[pokegre] 통째 받기(${종류}) 실패: ${r.status}` +
          (몫바닥 ? ' (오늘 몫을 다 썼습니다 — 내일 오전 9시에 다시)' : ' — 다음 시간에 다시 해 봅니다'),
      )
      if (몫바닥) {
        exportDoneDay[종류] = today
        void savePptState(true)
      }
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
      void savePptState(true)
      return null
    }
    const buf = Buffer.from(await r.arrayBuffer())
    exportDoneDay[종류] = today
    // ⚠️⚠️ **여기는 반드시 「지금 바로」 적는다.** `savePptState()`는 10초에 한 번으로
    //    묶여 있는데, 한 번에 두 종류를 받으면 **두 번째 기록이 통째로 삼켜진다.**
    //    2026-08-13에 「시세+ebay」를 시켰더니 ebay는 멀쩡히 받아 놓고 상태에는
    //    `ebay: 08-12`가 그대로 남았다. 그러면 ① 오늘 쓴 칸이 1로 세어져 **한 칸을 더
    //    쓰려다 429**가 날 수 있고 ② 안 묵은 것을 다시 받으러 간다.
    //    받은 사실은 **잃으면 안 되는 기록**이라 디스크를 아끼는 것보다 우선한다.
    void savePptState(true)
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
    // ⚠️⚠️ **받은 덤프는 반드시 파일로 남긴다.** 예전엔 읽어서 값만 뽑고 버렸다.
    //    그래서 나중에 "저쪽 카드 목록"이 필요할 때마다 세트를 하나씩 다시 받았고,
    //    2026-08-09에 그렇게 **34,000크레딧**을 썼다 — 그날 아침 덤프에 이미 다 있던 자료였다.
    //    덤프 받기 자체는 크레딧이 0이므로, 남겨 두면 검사도 개선도 공짜로 할 수 있다.
    //    같은 종류는 덮어쓴다(하루 한 번이라 늘 최신이고, 디스크도 아낀다).
    // ⚠️⚠️ **`void`로 던져 두면 안 된다 — 기다린다.** 예전엔 `void 덤프저장(...)`이라
    //    저장이 끝나기 전에 돌아왔는데, 「sealed」 작업이 **바로 뒤에서 그 파일을 다시
    //    읽는다.** writeFile은 열면서 파일을 비우므로 그 찰나에 읽으면 **빈 문자열**이
    //    오고, `if (t2)`가 거짓이라 **아무 로그도 없이 해석을 건너뛰었다**
    //    (2026-08-14 실측: 미개봉 시세가 나흘 묵은 채 그대로였다).
    await 덤프저장(종류, text)
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

export async function loadPricesFromCsv(
  apiKey: string,
  // ⚠️ 시세 재료를 어느 덤프로 받을지. **2026-08-11에 기본을 printings로 바꿨다** —
  //    같은 시세에 **인쇄판별 값 + 상태별 5칸**이 더 붙는다. 실물로 검증하고 넘어왔다:
  //      · cards를 새 파서에 태우니 옛 결과와 36,673장 전수 일치(다름 0)
  //      · printings를 태우니 **잃음 0 · 크게 바뀜 0**, 인쇄판별 시세 53,108장이 새로 붙음
  //        (인쇄판이 여럿인 카드 16,797장 · 상태별 5칸 52,555장)
  //    cards로 받고 싶으면 명시해서 부른다(옛 길은 그대로 남겨 둔다).
  종류: 'cards' | 'printings' = 'printings',
  // ⚠️ 점검용 뒷문. 파일 내용을 주면 **받기(몫·크레딧)를 건너뛰고 해석만** 한다 —
  //    회귀 검증이 서버와 같은 코드를 타게 하기 위한 것이다(규칙이 둘이면 어긋난다).
  시험텍스트?: string,
): Promise<number> {
  if (!apiKey && !시험텍스트) return 0
  if (!시험텍스트 && !exportDue(종류)) return 0
  if (!시험텍스트 && !pptGate().ok) return 0
  const text = 시험텍스트 ?? (await fetchExport(apiKey, 종류))
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
  const 모음 = new Map<
    string,
    { prices: Record<string, number>; names: Record<string, string>; base: Set<string>; 이름맞음: Set<string> }
  >()
  // 세트별 "번호 → 우리 카드 이름"(겹친 번호를 가릴 때 쓴다). 한 번 만들고 다시 쓴다.
  const 이름표캐시 = new Map<string, Map<string, string> | null>()
  const 세트이름표 = (slug: string): Map<string, string> | null => {
    const 있는것 = 이름표캐시.get(slug)
    if (있는것 !== undefined) return 있는것
    let m: Map<string, string> | null = null
    try {
      m = new Map<string, string>()
      for (const [n, v] of setCards(slug)) m.set(stripZeros(n), 이름만벗기기(String(v.name ?? '')))
      if (!m.size) m = null
    } catch {
      m = null
    }
    이름표캐시.set(slug, m)
    return m
  }
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

  // ── 1차: 줄을 카드(tcgPlayerId)별로 모은다 ──────────────────────────────────
  // cards 덤프는 카드당 한 줄이라 그대로 지나가고, printings 덤프는 인쇄판당 한 줄이라
  // 여기서 한 카드의 줄들이 묶인다. **줄을 그대로 흘리면 안 된다** — 인쇄판 여러 줄이
  // 값담기의 "겹치면 최솟값" 규칙을 타서, 네오 루기아가 초판 $118 대신 언리 $45로
  // 앉는다(대표는 저쪽 기준 초판이다). 카드별로 모아 **대표 한 줄**만 태운다.
  const 인쇄판덤프 = I.marketNearMint !== undefined // printings에만 있는 열
  type 줄틀 = {
    name: string
    setName: string
    cardNumber: string
    rarity: string
    lang: string
    printing: string
    market: number
    sellers: number
    low: number
    cond: number[] | null
  }
  const 카드별 = new Map<string, 줄틀[]>()
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const c = splitCsvLine(line)
    const tcg = String(c[I.tcgPlayerId] ?? '').trim()
    if (!tcg) continue
    const cond = 인쇄판덤프
      ? [
          Number(c[I.marketNearMint]) || 0,
          Number(c[I.marketLightlyPlayed]) || 0,
          Number(c[I.marketModeratelyPlayed]) || 0,
          Number(c[I.marketHeavilyPlayed]) || 0,
          Number(c[I.marketDamaged]) || 0,
        ]
      : null
    const 줄: 줄틀 = {
      name: String(c[I.name] ?? ''),
      setName: String(c[I.setName] ?? ''),
      cardNumber: String(c[I.cardNumber] ?? ''),
      rarity: I.rarity === undefined ? '' : String(c[I.rarity] ?? ''),
      lang: String(c[I.language] ?? '').trim(),
      printing: I.printing === undefined ? '' : String(c[I.printing] ?? '').trim(),
      market: Number(c[I.marketPrice]) || 0,
      sellers: I.sellers === undefined ? 0 : Number(c[I.sellers]) || 0,
      low: I.lowPrice === undefined ? 0 : Number(c[I.lowPrice]) || 0,
      cond: cond && cond.some((v) => v > 0) ? cond : null,
    }
    const 든것 = 카드별.get(tcg)
    if (든것) 든것.push(줄)
    else 카드별.set(tcg, [줄])
  }

  // ── 2차: 카드마다 대표 줄을 골라 예전과 똑같은 규칙으로 담는다 ─────────────────
  let 대표배움 = 0
  if (인쇄판덤프) 인쇄판시세.clear()
  for (const [tcg, 줄들] of 카드별) {
    let 대표 = 줄들[0]
    if (줄들.length > 1) {
      const 배운 = 대표인쇄판.get(tcg)
      대표 =
        줄들.find((r) => 배운 && r.printing === 배운) ??
        // 표에 없으면: 파는 사람이 많은 줄(=주로 거래되는 인쇄판) → 값이 큰 줄 순.
        [...줄들].sort((x, y) => y.sellers - x.sellers || y.market - x.market)[0]
    }
    // cards 덤프면 이 줄의 printing이 대표다 — 배워 둔다(빈 값은 안 배운다).
    if (!인쇄판덤프 && 대표.printing) {
      if (대표인쇄판.get(tcg) !== 대표.printing) {
        대표인쇄판.set(tcg, 대표.printing)
        대표배움++
      }
    }
    // printings 덤프면 인쇄판별 값을 통째로 남긴다(값이 하나라도 있는 카드만).
    if (인쇄판덤프) {
      const 통: Record<string, 인쇄판값> = {}
      for (const r of 줄들) {
        if (!(r.market > 0) && !r.cond) continue
        const v: 인쇄판값 = { m: Math.round(r.market * 100) / 100 }
        if (r.low > 0) v.l = Math.round(r.low * 100) / 100
        if (r.cond) v.c = r.cond.map((x) => Math.round(x * 100) / 100)
        통[r.printing || '기본'] = v
      }
      if (Object.keys(통).length) 인쇄판시세.set(tcg, 통)
    }

    // ── 여기부터는 예전 한 줄 처리와 같다(대표 줄 하나만 태운다) ──
    const 원래이름 = 대표.name
    if (원래이름) {
      const 판 = 대표.lang === 'japanese' ? 'ja' : 'en'
      const 열쇠 = `${판}|${원래이름}`
      let codes = 자동완성재료.get(열쇠)
      if (!codes) 자동완성재료.set(열쇠, (codes = new Set()))
      const code = RARITY_CODE.get(대표.rarity.trim())
      if (code) codes.add(code)
    }
    const slugs = slug별.get(대표.setName) ?? 속세트.get(대표.setName)
    if (!slugs) continue
    // 속 세트 줄은 **부모가 안 채운 번호에만** 쓴다(번호가 겹치면 부모가 이긴다).
    const 속인가 = !slug별.has(대표.setName)
    본이름.add(대표.setName)
    const market = 대표.market
    if (!(market > 0)) continue
    const nm = 대표.name
    for (const slug of slugs) {
      // ⚠️ 세트에 따라 저쪽이 **다른 번호 체계**를 쓴다(셀레브레이션즈 CC 등 — 아래 함수 설명).
      const 되돌림 = 번호되돌리기(slug, 대표.cardNumber, nm)
      const num = stripZeros(되돌림.split('/')[0].trim())
      if (!num) continue
      const 것 = 모음.get(slug) ?? { prices: {}, names: {}, base: new Set<string>(), 이름맞음: new Set<string>() }
      if (속인가 && 것.prices[num] !== undefined) continue
      // ⚠️⚠️ **한 세트 안에서도 앞자리가 겹친다**(프로모 세트의 분모 다른 시리즈 —
      //    en-basep 1번 자리 다툼). 이름이 우리 카드와 맞는 줄이 이긴다.
      const 우리이름 = 세트이름표(slug)?.get(num)
      const 이름맞나 = !!우리이름 && 이름만벗기기(nm) === 우리이름
      if (이름맞나 && !것.이름맞음.has(num)) {
        delete 것.prices[num]
        것.base.delete(num)
        것.이름맞음.add(num)
      } else if (!이름맞나 && 것.이름맞음.has(num)) {
        continue // 이미 이름이 맞는 줄이 있다
      }
      값담기(것, num, nm, market)
      모음.set(slug, 것)
    }
  }
  if (대표배움) console.log(`[pokegre] 대표 인쇄판 ${대표배움.toLocaleString()}장을 배웠습니다(cards 덤프에서).`)

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
    기록성공(종류)
  console.log(`[pokegre] 시세를 통째로 받아 세트 ${채움}개 · 카드 ${장수.toLocaleString()}장을 채웠습니다.`)
  }
  // 배운 대표 인쇄판과 인쇄판별 값을 파일에 남긴다 — 배포로 서버가 새로 떠도 이어진다.
  if (대표배움) await writeJsonFile(PRINTING_PRIMARY_FILE, Object.fromEntries(대표인쇄판)).catch(() => undefined)
  if (인쇄판덤프 && 인쇄판시세.size) {
    await writeJsonFile(PRINTING_PRICES_FILE, Object.fromEntries(인쇄판시세)).catch(() => undefined)
    console.log(`[pokegre] 인쇄판별 시세 ${인쇄판시세.size.toLocaleString()}장을 남겼습니다(상태별 5칸 포함).`)
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
  // 덤프가 이 카드의 PSA 줄을 **제대로 잡았다**(matchConfidence high·medium)는 표시.
  // 이게 있으면 저쪽 값이 더 최신이므로 우리 손표(psaPopFix)로 덮지 않는다.
  psaOk?: boolean
}
interface GradeSale {
  n: number // 낙찰 건수
  avg: number
  med?: number
  smart?: number // PPT가 계산한 "지금 시세"
  /**
   * 그 "지금 시세"를 얼마나 믿을 만한가(high/medium/low). 덤프에 `smartMarketConfidence`로
   * 온다. ⚠️ **안 담고 있었다** — 그래서 새 시세 길에서는 「신뢰도 낮음」이 한 번도 안 떴다
   * (2026-08-13에 붙임). 거래가 적어 값이 못 미더운 카드를 그냥 값으로만 보여 주면 안 된다.
   */
  cf?: string
}
// ── 인쇄판(초판/언리미티드…)별 시세 ────────────────────────────────────────────
//
// 왜 — cards 덤프는 카드당 **대표 인쇄판 한 줄**만 줘서 나머지 인쇄판 값(약 29%)을 버린다.
// printings 덤프는 인쇄판당 한 줄씩 다 주지만, 그중 **어느 줄이 대표인지는 안 알려 준다.**
// 실측(2026-08-10): cards 덤프의 printing 열이 바로 대표다 — 네오 루기아 줄이
// "1st Edition, 118.31"이고 실시간 API의 primaryPrinting과 정확히 일치했다.
// → cards를 읽을 때 **카드→대표 인쇄판**을 배워 두고(printing-primary.json),
//   printings를 읽을 때 그 표로 대표 줄을 골라 값을 예전과 똑같이 매긴다.
//   표에 없는 카드는 파는 사람이 많은 줄 → 값이 큰 줄 순으로 고른다.
/** 카드(tcgPlayerId) → 대표 인쇄판 이름. cards 덤프에서 배운다. */
const 대표인쇄판 = new Map<string, string>()
const PRINTING_PRIMARY_FILE = dataFile('printing-primary.json')
/**
 * 카드 → 인쇄판별 값(그리고 상태별 5칸). printings 덤프에서만 채워진다.
 * m=마켓가 · l=최저가 · c=[민트,약간,보통,많이,손상] (0이면 생략).
 * 화면(초판/언리 구분·상태별 시세)에 붙일 재료다 — 붙이는 것은 다음 단계.
 */
type 인쇄판값 = { m: number; l?: number; c?: number[] }
const 인쇄판시세 = new Map<string, Record<string, 인쇄판값>>()
const PRINTING_PRICES_FILE = dataFile('printing-prices.json')

// ── 미개봉(sealed) 시세 ───────────────────────────────────────────────────────
//
// sealed 덤프(제품 2,527개 · 전부 값 있음 · 2026-08-10 첫 수령)를 세트별로 접는다.
// 화면(세트 상세)이 "이 박스 지금 얼마"를 보여주는 재료다 — 사장님 지시 2026-08-11.
// ⚠️ 종류마다 제품이 여럿이다(초판 박스·언리 박스·포켓몬센터 ETB…). **파는 사람이 많은
//    것 → 값이 싼 것** 순으로 하나를 고른다 — 잘 거래되는 기본판이 대표라는 뜻이다.
//    (인쇄판 대표 고르기의 대체 규칙과 같은 생각이다.)
// ⚠️ 판을 가른다 — 일본판 세트(ja-)에는 japanese 제품만, 영문판엔 english만 붙인다.
type 미개봉값 = { name: string; usd: number; sellers: number; tcg: string }
type 미개봉세트 = { box?: 미개봉값; pack?: 미개봉값; etb?: 미개봉값 }
const sealedPriceCache = new Map<string, 미개봉세트>()
const SEALED_PRICES_FILE = dataFile('sealed-prices.json')

export async function 미개봉해석(text: string): Promise<number> {
  const lines = text.split('\n')
  const head = splitCsvLine(lines[0] ?? '')
  const I = Object.fromEntries(head.map((k, i) => [k.trim(), i])) as Record<string, number>
  for (const k of ['tcgPlayerId', 'name', 'setName', 'productType', 'language', 'marketPrice']) {
    if (I[k] === undefined) {
      console.log(`[pokegre] 미개봉 해석: 열 "${k}"가 없습니다`)
      return 0
    }
  }
  // PPT 세트 이름 → 우리 slug (시세 파서와 같은 대응표를 쓴다)
  const slug별 = new Map<string, string[]>()
  for (const [slug, ppt] of Object.entries(pptSetNames as Record<string, string>)) {
    const 것 = slug별.get(ppt)
    if (것) 것.push(slug)
    else slug별.set(ppt, [slug])
  }
  const 갈래 = (t: string): keyof 미개봉세트 | null =>
    t === 'Booster Box' ? 'box' : t === 'Booster Pack' ? 'pack' : t === 'Elite Trainer Box' ? 'etb' : null
  const 새것 = new Map<string, 미개봉세트>()
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const c = splitCsvLine(lines[i])
    const 종류 = 갈래(String(c[I.productType] ?? '').trim())
    if (!종류) continue
    const usd = Number(c[I.marketPrice])
    if (!(usd > 0)) continue
    const slugs = slug별.get(String(c[I.setName] ?? '')) ?? []
    if (!slugs.length) continue
    const 일본제품 = String(c[I.language] ?? '').trim() === 'japanese'
    const 후보: 미개봉값 = {
      name: String(c[I.name] ?? ''),
      usd: Math.round(usd * 100) / 100,
      sellers: I.sellers === undefined ? 0 : Number(c[I.sellers]) || 0,
      tcg: String(c[I.tcgPlayerId] ?? ''),
    }
    for (const slug of slugs) {
      // ⚠️ 중국판 세트에는 **미개봉 값을 안 붙인다.** 저쪽 덤프에 중국판 미개봉이 없어,
      //    안 거르면 「ja-가 아니다」로 읽혀 **영문판 부스터 박스 값이 붙는다.**
      if (중국판세트(slug)) continue
      if (일본쪽세트(slug) !== 일본제품) continue // 판이 다른 제품은 안 붙인다
      const 통 = 새것.get(slug) ?? {}
      const 지금 = 통[종류]
      if (!지금 || 후보.sellers > 지금.sellers || (후보.sellers === 지금.sellers && 후보.usd < 지금.usd)) 통[종류] = 후보
      새것.set(slug, 통)
    }
  }
  if (!새것.size) return 0
  sealedPriceCache.clear()
  for (const [k, v] of 새것) sealedPriceCache.set(k, v)
  await writeJsonFile(SEALED_PRICES_FILE, Object.fromEntries(sealedPriceCache)).catch(() => undefined)
  console.log(`[pokegre] 미개봉 시세를 세트 ${sealedPriceCache.size}개에 붙였습니다.`)
  return sealedPriceCache.size
}

const populationCache = new Map<string, PopEntry>()

/**
 * **우리가 다시 센 등급값**(카드 열쇠 → 등급칸별 건수·중앙값).
 *
 * ⚠️⚠️ **왜 따로 두나 — 목록 타일이 값을 못 찾고 있었다.** 타일은 저쪽 덤프
 *    (`ebayGradeCache`)에서 값을 꺼내는데, **우리가 이베이에서 직접 긁은 값은 거기 없다.**
 *    그래서 검색하자마자는 값이 안 보이고 카드를 눌러야 보였다(사장님 지적 2026-08-19:
 *    「처음 검색하고 나서는 왜 카드에 가격이 안 뜨는데」).
 * ⚠️ **타일마다 기록 파일을 읽는 길은 안 골랐다.** 한 번 검색에 수십 장을 그리는데
 *    장마다 파일을 열면 검색이 느려진다. 대신 **다시 셀 때 요약만 메모리에 함께 적어 두고**
 *    타일은 그것만 본다 — 파일을 안 읽으므로 **느려지는 것이 없다.**
 * ⚠️ 서버가 새로 떠도 이어지도록 파일에 남긴다(배포가 잦다).
 */
const 보정등급 = new Map<string, Record<string, { n: number; avg: number; med: number }>>()
const 보정등급파일 = dataFile('graded-fix.json')
let 보정저장예약: NodeJS.Timeout | null = null
function 보정등급적기(id: string, gx: Record<string, { n: number; avg: number; med: number }>) {
  보정등급.set(id, gx)
  // ⚠️ 한 장 받을 때마다 통째로 쓰면 2만 장 다시받기에서 디스크가 녹는다. 몰아서 쓴다.
  if (보정저장예약) return
  보정저장예약 = setTimeout(() => {
    보정저장예약 = null
    void writeJsonFile(보정등급파일, Object.fromEntries(보정등급)).catch(() => undefined)
  }, 20_000)
  보정저장예약.unref?.()
}
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
    // ⚠️⚠️ **매칭 신뢰도 low는 버린다**(사장님 승인 2026-08-22). 저쪽(GemRate 집계)도 「이 팝수가
    //    이 카드 것인지」를 high·medium·low로 적어 주는데 여태 안 읽었다. PSA 공식 팝과 대조한
    //    결과: high·medium은 정확(베이스 리자몽 언리미티드 487↔488 · 섀도리스 58↔58 ·
    //    151 리자몽 ex 28,389↔28,426), low는 헛매칭(트레이너 키트 기본 에너지에 PSA 399장).
    //    PSA 줄 기준 low가 1,560장(6%) — 틀린 팝수보다 빈칸이 낫다.
    if (I.matchConfidence !== undefined && String(c[I.matchConfidence] ?? '').trim().toLowerCase() === 'low') return
    const 것 = 모음.get(id) ?? { all: 0 }
    것.all += 합
    if (기관 === 'PSA') {
      // 여기까지 온 PSA 줄은 low가 아니다(위에서 걸러 냈다) — 「제대로 잡았다」고 적어 둔다.
      것.psaOk = true
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
  PSA공식팝얹기()
  await saveJsonMap(POPULATION_FILE, populationCache)
  기록성공('population')
  console.log(`[pokegre] 감정 수량을 통째로 받아 카드 ${populationCache.size.toLocaleString()}장을 채웠습니다.`)
  return populationCache.size
}

/**
 * **PSA 공식 팝수로 덮는다**(`src/data/psaPopFix.json`, 2026-08-22).
 *
 * 저쪽 덤프에서 매칭 신뢰도 low로 버린 카드 가운데 값나가는 것들을 PSA 팝 리포트에서
 * 직접 읽어 적어 둔 표다(사장님 PSA 계정으로 세트 표를 받아 이름·번호로 맞췄다).
 *
 * ⚠️⚠️ **덤프에 값이 있어도 덮는다.** 여기 든 495장은 **전부 덤프가 low(헛매칭)로 찍은
 *    줄**이다(2026-08-22 실측: 495장 중 예외 0). 「저쪽에 값이 있으면 저쪽을 믿는다」로
 *    두면 **못 믿을 값을 믿으라는 말**이 된다 — 실제로 일본판 151 거북왕 ex가 2,489장인데
 *    26,702장(10배)으로 나가고 있었다. 덮는 게 맞다.
 * ⚠️ 단 `psaOk`(덤프가 high·medium으로 제대로 잡음)가 붙은 카드는 **저쪽이 더 최신**이니
 *    그대로 둔다. 나중에 저쪽 매칭이 좋아지면 이 표가 저절로 물러나는 길이다.
 *
 * ⚠️⚠️⚠️ **물러나기 전에 「말이 되는 숫자인가」를 본다**(2026-08-23). `psaOk`만 믿고
 *    비켜 주면, 저쪽 판정이 low→medium으로 바뀌는 날 **틀린 값이 조용히 되돌아온다.**
 *    실측으로 저쪽 low 값은 절반쯤 맞지만 나머지는 **수십 배씩** 틀렸다 —
 *    부이젤 우리 25장 ↔ 저쪽 1,228장(49배) · 레쿠쟈 우리 983장 ↔ 저쪽 14장(1/70).
 *    → **감정 수량은 줄지 않고 하루에 몇 장씩만 는다**는 성질을 잣대로 쓴다.
 *      저쪽 값이 우리보다 **작거나** 우리의 **1.5배를 넘으면** 안 믿고 우리 값을 쓴다.
 *      341→342는 통과하고 25→1,228은 막힌다. 막을 때는 로그로 남겨 사람이 본다.
 * ⚠️ 덤프를 새로 받을 때마다 `populationCache`를 비우므로, **받은 뒤와 부팅 뒤 둘 다** 얹는다.
 * ⚠️ 이 표의 값은 PSA 한 곳 것이다. `all`(전 기관 합)에서 **옛 PSA 몫을 빼고** 우리 값을
 *    더한다 — 안 빼면 같은 카드가 두 번 세어진다.
 */
/** 저쪽이 「제대로 잡았다」고 해도 이 정도까지만 믿는다. 감정 수량은 줄지 않는다. */
const PSA덤프믿을배수 = 1.5
function PSA공식팝얹기() {
  let n = 0
  let 지킴 = 0
  const 막음: string[] = []
  for (const [id, f] of Object.entries(psaPopFix as Record<string, { psa10?: number; psa9?: number; psaAll: number }>)) {
    const 것 = populationCache.get(id) ?? { all: 0 }
    if (것.psaOk) {
      const 저쪽 = 것.psaAll ?? 0
      // 말이 되는 숫자면(안 줄고, 너무 안 뛰었으면) 저쪽이 더 최신이니 비켜 준다.
      if (저쪽 >= f.psaAll && 저쪽 <= f.psaAll * PSA덤프믿을배수) { 지킴++; continue }
      if (막음.length < 10) 막음.push(`${id} 우리 ${f.psaAll} ↔ 덤프 ${저쪽}`)
    }
    것.all = Math.max(0, 것.all - (것.psaAll ?? 0)) + f.psaAll
    것.psaAll = f.psaAll
    것.psa10 = f.psa10 ?? 0
    것.psa9 = f.psa9 ?? 0
    것.gem = f.psaAll > 0 ? Math.round(((f.psa10 ?? 0) / f.psaAll) * 1000) / 10 : undefined
    populationCache.set(id, 것)
    n++
  }
  if (n || 지킴) {
    console.log(`[pokegre] PSA 공식 팝수로 카드 ${n.toLocaleString()}장을 채웠습니다` + (지킴 ? ` (덤프가 제대로 잡은 ${지킴}장은 그대로 뒀습니다).` : '.'))
  }
  if (막음.length) {
    console.log(`[pokegre] ⚠️ 덤프가 「제대로 잡았다」고 했지만 숫자가 말이 안 돼 우리 값을 지킨 카드 ${막음.length}장${막음.length >= 10 ? '+' : ''}: ${막음.join(' · ')}`)
  }
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
      // 신뢰도. 「지금 시세」가 있을 때만 뜻이 있다(그 값에 붙는 딱지다).
      ...(smart > 0 && I.smartMarketConfidence !== undefined && String(c[I.smartMarketConfidence] ?? '').trim()
        ? { cf: String(c[I.smartMarketConfidence]).trim() }
        : {}),
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
  기록성공('ebay')
  console.log(`[pokegre] 등급별 낙찰을 통째로 받아 카드 ${ebayGradeCache.size.toLocaleString()}장을 채웠습니다.`)
  return ebayGradeCache.size
}

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

async function 받아서파일로만(apiKey: string, 종류: string): Promise<string | null> {
  // 파일로 남기는 일은 이제 fetchExport가 늘 한다. 여기서는 **해석을 안 하고 끝낸다**는
  // 것만 다르다(안 써 본 종류의 생김새를 볼 때 쓰는 길).
  // ⚠️ 받은 내용을 **그대로 돌려준다** — 뒤에서 쓸 사람이 파일을 다시 읽지 않게 한다.
  //    디스크를 한 번 더 거치면 위 경합에 또 걸릴 수 있고, 10MB를 두 번 읽을 이유도 없다.
  const text = await fetchExport(apiKey, 종류)
  if (text == null) return null
  기록성공(종류)
  console.log(`[pokegre] ${종류}는 해석하지 않고 파일로만 뒀습니다 · 열: ${(text.split('\n')[0] ?? '').slice(0, 200)}`)
  return text
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
  // ⚠️ 시세 재료가 2026-08-11에 cards → **printings**로 바뀌었다. 여기 검사도 같은
  //    종류를 봐야 한다 — 안 그러면 「어제 cards를 받았으니 오늘은 쉰다」로 잘못 판단한다.
  if (exportDue('printings')) {
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
// ⚠️ **번호 다듬는 규칙은 한 벌뿐이다**(src/lib/cardNo.ts의 번호열쇠). 여기서 또 적으면
//    언젠가 한쪽만 고쳐 값이 안 붙는다. 빈 값만 "0"으로 받는 것이 다르다 — 이 길에는
//    번호가 빈 줄이 들어올 수 있고, 그때 빈 열쇠를 만들면 안 되기 때문이다.
const stripZeros = (n: string) => 번호열쇠(n) || '0'

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
  // ⚠️⚠️ **아직 안 나온 세트는 건너뛴다.** 저쪽(PPT)은 예약 판매가 열린 카드를 발매
  //    한참 전부터 주는데(30주년은 발매 한 달 전에 19장이 들어왔다) **값은 안 준다** —
  //    아직 팔린 적이 없으니 시세가 있을 수 없다. 그런데 이 목록은 **발매일 최신순**이라
  //    발매일을 적어 넣는 순간 그 세트가 **맨 앞**에 서고, 값이 영영 안 붙으니
  //    `hasPrices`가 계속 false여서 **6시간마다 영원히 두드린다.**
  //    (`값없는세트`가 막아 주기는 하는데 그건 **시세 덤프를 해석할 때만** 채워진다 —
  //     받기가 손으로 시키는 일이 된 지금은 그 사이가 며칠씩 벌어진다.)
  //    발매 전 세트를 안 줍는다고 잃는 건 없다. 이 일은 「덤프가 못 채운 것 줍기」인데,
  //    발매되면 덤프가 알아서 채운다.
  const 오늘 = kstDateStr()
  return Object.keys(SET_NAMES)
    // ⚠️ 저쪽에 값이 아예 없는 세트는 뺀다. 안 빼면 6시간마다 영원히 두드린다.
    .filter((s) => !hasPrices(s) && !값없는세트.has(s) && (dates.get(s) ?? '') <= 오늘)
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
    const usd = 앨범값(prices, c.n, c.m)
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
/**
 * 기록 시각이 **절대 안 겹치게** 하는 자리.
 * ⚠️ 이름 채우기(`fillHighlightName`)가 「같은 카드 중 가장 최근 것」을 **시각으로** 찾는다.
 *    한 박스에서 자리가 여러 개 생기면 같은 밀리초에 몰려 시각이 겹치고, 그러면 엉뚱한
 *    자리에 이름이 붙는다(실측: 37개 중 6건이 겹쳤다). 앞 값보다 늘 크게 만든다.
 */
let 마지막기록시각 = 0
const 다음기록시각 = () => {
  마지막기록시각 = Math.max(Date.now(), 마지막기록시각 + 1)
  return 마지막기록시각
}

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
/**
 * 홈 「이번 주 TOP 5」에 올릴 기록을 남긴다.
 *
 * ⚠️⚠️ **팩 단위로 받는다(`묶음`). 박스는 팩 배열을 그대로 넘겨야 한다.**
 *    예전에는 카드를 한 줄로 펴서 받고 **그중 딱 한 장**만 올렸다. 낱개로 열면 팩마다
 *    한 자리씩 생기는데, **한 박스(30팩)를 사면 30팩이 통째로 한 자리로 줄었다**
 *    (사장님 지적 2026-08-13: "한박스 까고 나온 전체목록이 top5 올라가는게 아니라
 *     제일 높았던거 하나만 올라가는거같아"). **같은 카드를 뽑고도 박스로 사면 손해**였다.
 *    지금은 **팩마다 그 팩의 제일 좋은 한 장**을 올린다 — 낱개로 30번 연 것과 같은 셈이다.
 * ⚠️ 팩마다 **한 장까지**다. 한 팩의 모든 값나가는 카드를 다 올리면 이번엔 낱개보다
 *    유리해진다. 「낱개로 열었을 때와 같게」가 잣대다.
 *
 * @returns 올라간 카드 번호들(화면이 그 카드들의 한글 이름을 채워 준다)
 */
async function noteHighlight(
  slug: string,
  묶음: { n: string; r?: string; m?: MirrorFlag; img?: string }[][],
  godOf: (i: number) => boolean,
  user: { id: string; nickname?: string | null },
): Promise<string[]> {
  const nick = (user.nickname ?? '').trim()
  if (!nick) return [] // 이름 없이 띄울 자리가 아니다
  const list = await loadHighlights()
  const 오른것: string[] = []
  for (let i = 0; i < 묶음.length; i++) {
    const god = godOf(i)
    const priced = withUsd(slug, 묶음[i])
    const worthy = priced.filter(
      (c) => (c.usd ?? 0) >= HIGHLIGHT_USD || (RARITY_RANK[c.r ?? ''] ?? 0) >= HIGHLIGHT_RANK || god,
    )
    if (!worthy.length) continue
    // 그 팩에서 제일 좋은 한 장만 남긴다(위 betterCard와 같은 잣대를 쓴다).
    const best = worthy.reduce((a, b) => betterCard(a, b))

  // ⚠️ 한 사람이 여러 자리를 차지해도 된다(2026-08-05 운영자 지시).
  //    예전엔 "하루 한 자리"로 막았는데(배너 독점 걱정), 그러면 같은 날 더 좋은 카드가
  //    나와도 못 올라가서 자리를 갈아끼우는 코드까지 따로 있었다. 제한을 없애니
  //    그 코드도 필요 없다 — 뽑을 때마다 그냥 쌓고, 값 높은 순으로 뽑아 보여주면 된다.
  //    많이 여는 사람이 상위권을 채우는 건 "가장 시세 높은 카드를 뽑은 사람" 목록의
  //    뜻에 어긋나지 않는다.
    const entry: PackHighlight = {
      at: 다음기록시각(),
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
    오른것.push(best.n)
  }
  if (!오른것.length) return []
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
  // 어느 카드가 올라갔는지 알려 주면, 화면이 그 카드들의 한글 이름을 보내 준다.
  return [...new Set(오른것)]
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
    const 좋은순 = [...fresh].sort((a, b) => (betterHighlight(a, b) === a ? -1 : 1))
    // ⚠️⚠️ **같은 사람이 같은 카드를 여러 번 뽑아도 한 줄만 낸다.**
    //    2026-08-13에 「박스도 팩마다 한 자리」로 고치면서 이게 눈에 띄게 됐다 —
    //    36팩 박스를 몇 번 여니 **같은 카드가 TOP5를 5줄 다 차지했다**(실측).
    //    사람이 다르면 각자 낸다(같은 카드를 서로 뽑은 것은 다른 이야기다).
    const 본것 = new Set<string>()
    const picked: PackHighlight[] = []
    for (const h of 좋은순) {
      const 열쇠 = `${h.uid}|${h.slug}|${h.n}|${h.m ?? ''}`
      if (본것.has(열쇠)) continue
      본것.add(열쇠)
      picked.push(h)
      if (picked.length >= HIGHLIGHT_SHOW) break
    }
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
  // ⚠️ **스스로 다시 오지 않는다**(자동화 제거 · 사장님 지시 2026-08-10). 예전엔 남은
  //    세트가 있으면 타이머를 걸어 저절로 이어받았는데, 이제는 시킨 일만 하고 끝낸다.
  //    남았으면 알리기만 한다 — 다시 시키면("줍기") 이어받는다.
  if (leftover)
    console.log(
      `[pokegre] 시세 미리받기: 남은 세트가 있습니다${outOfBudget ? '(방문자 몫을 지키려 접음)' : ''} — 다시 시키면 이어받습니다.`,
    )
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
/**
 * 이름을 견줄 꼴로 다듬는다. 저쪽이 붙이는 꼬리(번호·괄호)를 떼고 부호를 지운다.
 * ⚠️ **function으로 둔다(const 아님).** 이 파일 위쪽(덤프 읽는 곳)에서 먼저 쓰는데,
 *    const로 두면 선언 전 접근이 되어 언젠가 터진다.
 */
function 이름만벗기기(x: string): string {
  return x
    .replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/[^A-Za-z0-9가-힣]/g, '')
    .toLowerCase()
}

/**
 * 한 줄의 값을 번호 칸에 담는다. **덤프로 채우는 길과 세트별로 받는 길이 이 한 벌만 쓴다.**
 *
 * ⚠️⚠️ 예전엔 같은 코드가 두 군데 있었다. 오늘 하루에만 베껴 둔 규칙이 어긋나 사고가
 *    세 번 났다(레어도표 3벌 · 카드 이름 규칙 · 번호 열쇠). 규칙이 둘이면 언젠가 한쪽만
 *    고쳐 **같은 카드가 받는 길에 따라 다른 값을 갖는다.**
 *
 * 규칙:
 *   · 같은 번호가 여러 줄로 온다("Machamp / Machamp (Poke Ball Pattern) / (Master Ball)").
 *     팩에서 나오는 건 기본판이므로 괄호 없는 이름을 우선하고, 기본판이 없을 때만 제일
 *     싼 값을 쓴다(덮어쓰기 순서에 맡겼더니 일반 괴력몬이 마스터볼 값 $18을 받았다).
 *   · 변형판은 별도 열쇠로 담는다(앨범의 미러·리버스 시세용).
 */
function 값담기(
  통: { prices: Record<string, number>; names: Record<string, string>; base: Set<string> },
  num: string,
  nm: string,
  market: number,
): void {
  const isBase = !nm.includes('(')
  // 검색어로 쓸 영문 이름. 저쪽은 "Team Rocket's Mewtwo ex - 231/182"처럼 번호를 꼬리에
  // 붙여 주므로 떼어 낸다. 기본판 이름을 우선한다.
  if (nm && (isBase || !통.names[num])) 통.names[num] = nm.replace(/\s*-\s*\d+\/\d+\s*$/, '').trim()
  if (isBase) {
    통.prices[num] = 통.base.has(num) ? Math.min(통.prices[num], market) : market
    통.base.add(num)
    return
  }
  const vk = nm.includes('Master Ball') ? '~m' : nm.includes('Poke Ball') ? '~p' : nm.includes('Reverse') ? '~r' : null
  if (vk) 통.prices[num + vk] = Math.min(통.prices[num + vk] ?? Infinity, market)
  else if (!통.base.has(num)) 통.prices[num] = Math.min(통.prices[num] ?? Infinity, market)
}

function 담기(
  list: 저쪽카드[],
  prices: Record<string, number>,
  names: Record<string, string>,
  basePriced: Set<string>,
  부른세트?: string,
  slug?: string,
): void {
  // ⚠️⚠️ **한 세트 안에서도 앞자리가 겹친다.** 저쪽은 프로모 세트에 여러 시리즈를 같이
  //    담는데 번호가 "01/64"·"41/53"처럼 분모가 다르다. 우리는 앞자리만 열쇠로 쓰므로
  //    서로 덮어쓴다 — 13개 세트 59칸이 그렇다(2026-08-08 실측):
  //        en-basep 1번  Clefable(Prerelease) $999.95 · Aerodactyl $86.96 · Pikachu
  //    그래서 **이름이 우리 카드와 맞는 줄을 먼저 믿는다.** 이름이 맞으면 그 카드의
  //    우리 번호를 쓰고, 안 맞으면 예전처럼 앞자리를 쓴다.
  //    ⚠️⚠️ **이름은 마지막 수단이다.** 두 번 좁혔다:
  //       ① 그 세트에서 이름이 하나뿐일 때만 — 요즘 세트는 시크릿이 기본 카드와 같은
  //          이름이라 겹치는 이름이 23~26가지다(en-sv06.5·en-me02). 안 좁히면 시크릿
  //          값이 기본 카드에 붙는다(100줄이 엉뚱한 자리로 갈 뻔했다).
  //       ② **우리 세트에 그 번호가 아예 없을 때만** — ①만으로도 2,403줄이 옮겨졌다.
  //          저쪽은 같은 이름의 시크릿을 여러 장 두는데(125·130·109번 리자몽 ex),
  //          그게 전부 우리 한 카드로 몰린다. 번호가 있으면 번호가 맞다.
  const 이름벗기기 = 이름만벗기기
  const 열쇠뽑기 = (c: 저쪽카드): string => {
    const 되 = slug ? 번호되돌리기(slug, String(c.cardNumber ?? ''), String(c.name ?? '')) : String(c.cardNumber ?? '')
    const raw = 되 || (String(c.name ?? '').match(/ (\d+)\/\d+$/)?.[1] ?? '')
    return raw.trim() ? stripZeros(raw.split('/')[0].trim()) : ''
  }
  const 이름표 = (() => {
    if (!slug) return null
    try {
      const 셈 = new Map<string, number>()
      const m = new Map<string, string>()
      const 있는번호 = new Set<string>()
      for (const [n, v] of setCards(slug)) {
        있는번호.add(stripZeros(n))
        const k = String(v.name ?? '').replace(/[^A-Za-z0-9가-힣]/g, '').toLowerCase()
        if (!k) continue
        셈.set(k, (셈.get(k) ?? 0) + 1)
        if (!m.has(k)) m.set(k, n)
      }
      for (const [k, c] of 셈) if (c > 1) m.delete(k)
      const 번호별이름 = new Map<string, string>()
      for (const [n, v] of setCards(slug)) 번호별이름.set(stripZeros(n), 이름벗기기(String(v.name ?? '')))
      return m.size ? { 이름: m, 있는번호, 번호별이름 } : null
    } catch {
      return null
    }
  })()
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
    // 이름이 우리 카드와 딱 맞으면 그 카드의 우리 번호를 쓴다(앞자리 겹침을 피한다).
    //    저쪽 이름의 꼬리("- 174/086"·"(Prerelease)")는 떼고 견준다.
    const 이름열쇠 = String(c.name ?? '')
      .replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '')
      .replace(/\s*\([^()]*\)\s*$/, '')
      .replace(/[^A-Za-z0-9가-힣]/g, '')
      .toLowerCase()
    // 저쪽 번호가 우리 세트에 있으면 번호가 맞다. 없을 때만 이름으로 찾는다.
    const 저쪽앞 = stripZeros(String(되돌림 || '').split('/')[0].trim())
    const 이름으로 =
      이름열쇠 && 이름표 && (!저쪽앞 || !이름표.있는번호.has(저쪽앞)) ? 이름표.이름.get(이름열쇠) : undefined
    const rawNum = 이름으로 || 되돌림 || (String(c.name ?? '').match(/ (\d+)\/\d+$/)?.[1] ?? '')
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
    값담기({ prices, names, base: basePriced }, num, nm, market)
    if (보조) 메움++
    else 이미.add(num)
  }

  // ⚠️ **이름이 맞는 줄이 하나도 없으면 아무것도 안 버린다.** 우리가 적어 둔 이름과
  //    저쪽 이름이 언젠가 어긋나면, 거르는 바람에 그 세트가 통째로 빈 채로 나간다.
  const 본줄 = 우리것.length ? 우리것 : list
  // ⚠️⚠️ **같은 앞자리에 여러 줄이 오면 이름이 맞는 줄만 쓴다.** 저쪽은 프로모 세트에
  //    여러 시리즈를 같이 담는데 번호 분모가 다르다("01/64" · "41/53"). 우리는 앞자리만
  //    열쇠로 쓰므로 서로 덮어쓴다 — 13개 세트 59칸이 그렇다(2026-08-08 실측):
  //        en-basep 1번  Clefable(Prerelease) $999.95 · Aerodactyl $86.96 · Pikachu
  //    그 칸에 이름이 우리 카드와 맞는 줄이 하나라도 있으면 **그것만** 쓴다.
  //    하나도 안 맞으면 예전대로 다 쓴다(싼 값 고르기) — 함부로 버리지 않는다.
  if (이름표) {
    const 칸별 = new Map<string, 저쪽카드[]>()
    for (const c of 본줄) {
      const n = 열쇠뽑기(c)
      if (!n) continue
      칸별.set(n, [...(칸별.get(n) ?? []), c])
    }
    const 버릴것 = new Set<저쪽카드>()
    for (const [n, 줄들] of 칸별) {
      if (줄들.length < 2) continue
      const 우리이름 = 이름표.번호별이름.get(n)
      if (!우리이름) continue
      const 맞는것 = 줄들.filter((c) => 이름벗기기(String(c.name ?? '')) === 우리이름)
      if (!맞는것.length || 맞는것.length === 줄들.length) continue
      for (const c of 줄들) if (!맞는것.includes(c)) 버릴것.add(c)
    }
    if (버릴것.size) {
      console.log(`[pokegre] "${부른세트}" — 같은 번호에 딴 카드 ${버릴것.size}줄이 겹쳐 이름이 맞는 것만 썼습니다.`)
      for (const c of 본줄) if (!버릴것.has(c)) 한줄(c, false)
      for (const c of 딴것) 한줄(c, true)
      if (버린수 || 메움) {
        console.log(`[pokegre] "${부른세트}" — 딴 세트 ${버린수}장을 버리고, 속 세트 ${메움}장으로 빈 번호를 메웠습니다.`)
      }
      return
    }
  }
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
  // ⚠️⚠️ 중국판도 **japanese**로 묻는다 — PPT는 언어가 english·japanese 둘뿐이고
  //    중국판 카드는 japanese 목록에 들어 있다(2026-08-18 확인). 영문으로 물으면 0건이다.
  const lang = 일본쪽세트(slug) ? 'japanese' : 'english'
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
    loadJsonMap(POPULATION_FILE, populationCache as Map<string, unknown>, '감정 수량'),
    loadJsonMap(PRINTING_PRIMARY_FILE, 대표인쇄판 as Map<string, unknown>, '대표 인쇄판'),
    loadJsonMap(PRINTING_PRICES_FILE, 인쇄판시세 as Map<string, unknown>, '인쇄판별 시세'),
    loadJsonMap(보정등급파일, 보정등급 as Map<string, unknown>, '우리가 다시 센 등급값'),
    loadJsonMap(SEALED_PRICES_FILE, sealedPriceCache as Map<string, unknown>, '미개봉 시세'),
    loadJsonMap(EBAY_GRADE_FILE, ebayGradeCache as Map<string, unknown>, '등급별 낙찰'),
  ]).then(() => {
    PSA공식팝얹기()
    // 카드별 추이·낱개는 **파일을 나눠 두고 그때그때 읽는다**(메모리에 안 이고 있는다).
    // 여기서는 자리만 훑어 천장을 넘었으면 오래된 것을 비운다.
    void 기록정리()
    setInterval(() => void 기록정리(), 6 * 60 * 60 * 1000).unref?.()
    // ═════════════════════════════════════════════════════════════════════════
    //  **밖에서 받아오는 자동화는 없앴다**(사장님 지시 2026-08-10: "자동화는 싹 다 제거해
    //  앞으로는 내가 이거 이거 지금 받아 이렇게 지시할테니까").
    //
    //  예전엔 여기서 통째 받기(덤프)·시세 미리받기·스니덩크 힛카드를 매시간 저절로
    //  돌렸다. 이제는 **시킨 일 파일**이 생겼을 때만 돈다:
    //
    //      fly ssh console -a pokegre -C "/bin/sh -c 'echo {\"받기\":[\"cards\"]} > /data/manual-jobs.json'"
    //
    //  1분 안에 서버가 읽어 그 일만 하고 파일을 지운다. 받을 수 있는 일:
    //      cards · population · ebay        덤프를 받아 **해석까지** 한다(시세·팝수·등급낙찰)
    //      printings · sealed               덤프를 받아 **파일로만** 남긴다(/data/export-*.csv)
    //      힛카드                            스니커덩크에서 신상 일본판 힛카드
    //      줍기                              덤프가 못 채운 세트를 PPT에서 낱개로(크레딧 씀)
    //      옛계획                            예전 자동 계획 한 바퀴(cards + 팝수/낙찰 격일)
    //
    //  ⚠️ 그대로 남긴 것(자동이지만 밖에서 **받는** 게 아니다): 백업(하루 1회)·그림 캐시
    //     정리·카드 이름 저장·자정 상점 진열·출석 예산·그림 데우기(우리가 이미 아는
    //     주소를 미리 여는 것). 이것까지 끄려면 사장님 지시가 따로 필요하다.
    //  ⚠️ 이제 **지시가 없으면 앨범값·힛카드·팝수·등급낙찰이 안 새로워진다.** 방문자
    //     검색(이베이·티피 실시간 조회)은 요청이 올 때 받는 것이라 그대로 돈다.
    // ═════════════════════════════════════════════════════════════════════════
    const 시킨일파일 = dataFile('manual-jobs.json')
    let 시킨일도는중 = false
    const 몫남았나 = () => Object.values(exportDoneDay).filter((날) => 날 === utcDay()).length < EXPORT_DAILY_MAX
    const 시킨일하기 = async () => {
      if (시킨일도는중) return
      let raw: string
      try {
        raw = await readFile(시킨일파일, 'utf-8')
      } catch {
        return // 파일이 없으면 할 일도 없다 — 평소의 모습이다
      }
      시킨일도는중 = true
      try {
        // ⚠️ **읽자마자 지운다.** 일하다 죽어도 같은 일을 무한 반복하지 않게.
        await rm(시킨일파일, { force: true })
        const 일들 = ((JSON.parse(raw) as { 받기?: string[] }).받기 ?? []).map((x) => String(x).trim())
        console.log(`[pokegre] 시킨 일: ${일들.join(', ') || '(비어 있음)'}`)
        for (const 일 of 일들) {
          // ⚠️ 통째 받기 몫(하루 2칸)을 쓰는 일들. 「시세」·「printings시세」도 printings
          //    덤프를 받으므로 여기 들어가야 한다 — 빠뜨리면 몫 검사를 건너뛰어 429가 난다.
          const 덤프류 = ['cards', '시세', 'printings시세', 'population', 'ebay', 'printings', 'sealed'].includes(일)
          if (덤프류 && !몫남았나()) {
            console.log(`[pokegre] ${일}: 오늘 통째 받기 몫(하루 ${EXPORT_DAILY_MAX}칸)을 다 썼습니다 — 오전 9시 뒤에 다시.`)
            continue
          }
          // ⚠️ 「시세」가 이제 **printings**다(2026-08-11 전환). 「cards」는 옛 덤프를
          //    쓰고 싶을 때를 위해 남겨 둔다 — 값은 같고 인쇄판별·상태별만 안 붙는다.
          if (일 === '시세' || 일 === 'printings시세') await loadPricesFromCsv(pptApiKey)
          else if (일 === 'cards') await loadPricesFromCsv(pptApiKey, 'cards')
          else if (일 === 'population') await loadPopulationFromCsv(pptApiKey)
          else if (일 === 'ebay') await loadEbayGradesFromCsv(pptApiKey)
          else if (일 === 'printings' || 일 === 'sealed') {
            const 받은것 = await 받아서파일로만(pptApiKey, 일)
            // sealed는 받은 김에 바로 세트별로 접는다(미개봉 시세 화면의 재료).
            // ⚠️⚠️ **받은 내용을 그대로 쓴다 — 파일을 다시 읽지 않는다.** 예전엔 방금 쓴
            //    CSV를 다시 읽었는데, 저장이 `void`로 던져져 있어 **빈 문자열을 읽고
            //    아무 말 없이 건너뛰었다**(2026-08-14). 저장도 이제 기다리지만, 애초에
            //    디스크를 거칠 이유가 없다.
            if (일 === 'sealed' && 받은것) await 미개봉해석(받은것)
          }
          // ⚠️ **받지 않고 이미 있는 파일만 다시 해석한다.** 하루 2칸을 다 쓴 날에도
          //    해석 코드를 고쳤으면 다시 접어야 한다 — 안 그러면 다음 날 오전 9시까지
          //    화면이 비어 있다(2026-08-10 배포 직후 실제로 그랬다).
          else if (일 === 'sealed다시') {
            const t2 = await readFile(dataFile('export-sealed.csv'), 'utf-8').catch(() => null)
            if (t2) await 미개봉해석(t2)
            else console.log('[pokegre] sealed 덤프 파일이 없습니다 — 먼저 "sealed"로 받으세요.')
          }
          // ⚠️ **미감정 칸이 이상한 카드부터 사진으로 확인한다**(2026-08-14).
          //    잣대: 미감정 값이 PSA 10보다 비싼 카드 — 방문자가 「말이 안 된다」고 느끼는 자리다.
          //    한 장에 PPT 3크레딧 + 사진 몇 장이고, 하루 상한(`SLAB_*_DAILY`)에 걸리면 멈춘다.
          //    다시 시키면 **이어서** 한다(한 번 읽은 매물은 캐시에 있어 값이 안 든다).
          // ⚠️ **거르는 규칙을 고쳤을 때 쓴다.** 기록을 이레 캐시하므로 배포만으로는
          //    화면이 안 바뀐다. `다시받기:5000`처럼 뒤에 숫자를 주면 그만큼 건너뛰고 이어 한다.
          //    `다시받기:0:50` = 앞에서부터 50장만(시험용).
          else if (일 === '다시받기' || 일.startsWith('다시받기:')) {
            const 쪽 = 일.split(':')
            await 낙찰기록다시받기(pptApiKey, Number(쪽[1]) || 0, Number(쪽[2]) || 0)
          }
          else if (일 === '미감정점검') await 미감정점검(pptApiKey)
          else if (일 === '힛카드') await refreshSnkrdunkHitCards()
          else if (일 === '줍기') await warmPackPrices(pptApiKey)
          else if (일 === '옛계획') await runDailyExports(pptApiKey)
          else console.log(`[pokegre] 모르는 일이라 건너뜁니다: ${일}`)
        }
        console.log('[pokegre] 시킨 일 끝')
      } catch (e) {
        console.log(`[pokegre] 시킨 일 중 오류: ${String(e).slice(0, 150)}`)
      } finally {
        시킨일도는중 = false
      }
    }
    setInterval(() => 던지기('시킨 일', 시킨일하기()), 60 * 1000).unref()
    // ── **유일한 자동: 스니덩크 힛카드, 매일 자정(한국시간)** ─────────────────────
    // 사장님 지시(2026-08-11): "힛카드는 자동화로 매일 새벽 12시에 받는게 좋을거같다."
    // 자동화 전부 걷어낸 뒤 유일하게 되살린 것이다 — 크레딧 0(스니덩크는 무료)이고,
    // 함수 안에 "오늘 이미 받았으면 건너뛴다"가 있어 재부팅해도 두 번 안 받는다.
    const 다음자정까지 = () => {
      const 지금 = Date.now()
      // 한국시간 자정 = (지금+9시간)이 날짜를 넘는 순간. 5초 여유를 붙인다.
      return Math.floor((지금 + 9 * 3600_000) / 86_400_000 + 1) * 86_400_000 - 9 * 3600_000 - 지금 + 5_000
    }
    const 힛카드자정 = () => {
      setTimeout(() => {
        던지기('힛카드 갱신', refreshSnkrdunkHitCards())
        힛카드자정()
      }, 다음자정까지()).unref()
    }
    힛카드자정()
    // 재부팅으로 자정을 놓친 날의 몫. 오늘 이미 받았으면 함수가 스스로 건너뛴다.
    setTimeout(() => 던지기('힛카드 갱신', refreshSnkrdunkHitCards()), 30_000).unref()
    console.log('[pokegre] 자동 받기: 힛카드(매일 자정)뿐 — 나머지는 /data/manual-jobs.json 로 시킬 때만')
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

      // ── 포켓몬 디펜스 시즌1 ──────────────────────────────────────────────
      // GET /battle — 내 기록. **로그인 안 했어도 오류가 아니다** — 게임은 누구나 되고
      //   기록만 안 남는 것이라, 화면이 조용히 로컬 기록으로 굴러가면 된다.
      if (segments[0] === 'battle' && segments.length === 1 && req.method === 'GET') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 200, { 로그인: false, stars: {} })
          return
        }
        const all = await load디펜스()
        sendJson(res, 200, { 로그인: true, stars: all[user.id]?.stars ?? {} })
        return
      }

      // POST /battle — 기록을 **합친다**(덮어쓰지 않는다).
      // ⚠️⚠️ 별은 큰 쪽을 남긴다. 낮은 난이도로 다시 깨도 안 내려가야 하고, 기기 두 대에서
      //    따로 한 것도 합쳐져야 한다. 덮어쓰기로 두면 나중에 켠 기기가 앞의 것을 지운다.
      if (segments[0] === 'battle' && segments.length === 1 && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          // 비로그인은 조용히 넘어간다. 화면이 로그인 여부를 몰라도 그냥 보내면 된다.
          sendJson(res, 200, { 로그인: false, stars: {} })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}') as { stars?: unknown }
        const 온것 = 별표다듬(body.stars)
        const all = await load디펜스()
        const 칸 = (all[user.id] ??= { stars: {}, at: new Date().toISOString() })
        for (const [이름, 별] of Object.entries(온것)) {
          if ((칸.stars[이름] ?? 0) < 별) 칸.stars[이름] = 별
        }
        칸.at = new Date().toISOString()
        await persist디펜스()
        sendJson(res, 200, { 로그인: true, stars: 칸.stars })
        return
      }

      // DELETE /battle — 계정 기록을 지운다.
      // ⚠️⚠️ **이게 없으면 「깬 기록 지우기」가 로그인한 사람에게 안 먹는다.** 로컬만 지워도
      //    다음에 켤 때 서버에서 도로 받아 와 되살아난다(만들며 미리 잡았다).
      if (segments[0] === 'battle' && segments.length === 1 && req.method === 'DELETE') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 200, { 로그인: false, stars: {} })
          return
        }
        const all = await load디펜스()
        delete all[user.id]
        await persist디펜스()
        sendJson(res, 200, { 로그인: true, stars: {} })
        return
      }

      // ── 게임평 ──────────────────────────────────────────────────────────
      // GET /battle-review — 내가 쓸 수 있나 + (운영자면) 들어온 글 목록.
      // ⚠️ 운영자가 아니면 **목록을 아예 안 보낸다.** 「운영자만 본다」가 화면 약속이 아니라
      //    서버 약속이어야 한다.
      if (segments[0] === 'battle-review' && segments.length === 1 && req.method === 'GET') {
        const user = await currentUser(req)
        // ⚠️⚠️ **목록은 누구에게나 준다**(2026-08-18). 남이 쓴 것이 보여야 다음 사람도 쓴다.
        //    ⚠️ **회원번호는 어떤 경우에도 안 실린다** — 남에게 보이는 목록이라 더 그렇다.
        const 목록 = [...(await load게임평())]
          .sort((a, b) => b.at - a.at)
          .slice(0, 100)
          .map(({ uid: _uid, ...나머지 }) => 나머지)
        if (!user) {
          sendJson(res, 200, { 로그인: false, 별: 0, 쓸수있나: false, 운영자: false, 목록 })
          return
        }
        const 별 = 별합((await load디펜스())[user.id])
        // ⚠️ 쓸 수 있는 잣대는 **로그인 하나**다. 별은 글 옆에 보이려고 담을 뿐이다.
        sendJson(res, 200, { 로그인: true, 별, 쓸수있나: true, 운영자: isAdmin(user), 목록 })
        return
      }

      // POST /battle-review — 게임평을 남긴다.
      if (segments[0] === 'battle-review' && segments.length === 1 && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        // ⚠️ 별은 **막는 데 안 쓴다** — 글 옆에 「★ 몇 개인 사람이 썼나」를 보이려고 담는다.
        const 별 = 별합((await load디펜스())[user.id])
        const body = JSON.parse((await readBody(req, 4_000)) || '{}') as { 글?: unknown; 이름?: unknown }
        const 글 = String(body.글 ?? '').trim().replace(/\r/g, '').replace(/\n{3,}/g, '\n\n')
        const 이름 = String(body.이름 ?? '').trim().slice(0, 10)
        if (글.length < 2) { sendJson(res, 400, { error: 'too short' }); return }
        if (글.length > 게임평글자수) { sendJson(res, 400, { error: 'too long', 최대: 게임평글자수 }); return }
        // ⚠️ 링크는 통째로 막는다. 게임평 자리에 광고가 들어올 까닭이 없다.
        if (/https?:\/\/|www\.|\.com|\.net|\.kr\b/i.test(글)) { sendJson(res, 400, { error: 'no links' }); return }

        const 모두 = await load게임평()
        const 하루 = 24 * 60 * 60 * 1000
        const 지금 = Date.now()
        // ⚠️ **하루 한 번.** 회원번호로만 센다(사람을 알아보는 데 안 쓴다).
        if (모두.some((r) => r.uid === user.id && 지금 - r.at < 하루)) {
          sendJson(res, 429, { error: 'once a day' })
          return
        }
        // ⚠️ 같은 글을 다시 올리는 것도 막는다 — 하루 지나면 또 붙일 수 있기 때문이다.
        if (모두.some((r) => r.uid === user.id && r.글 === 글)) {
          sendJson(res, 409, { error: 'same text' })
          return
        }
        모두.push({ id: `${지금.toString(36)}${Math.random().toString(36).slice(2, 8)}`, at: 지금, 이름, 글, 별, uid: user.id })
        // ⚠️ 파일이 무한정 커지지 않게 최근 500개만 남긴다.
        if (모두.length > 500) 모두.splice(0, 모두.length - 500)
        await persist게임평()
        sendJson(res, 200, { 남겼습니다: true })
        return
      }

      // DELETE /battle-review/<id> — 운영자만 지운다.
      if (segments[0] === 'battle-review' && segments.length === 2 && req.method === 'DELETE') {
        const user = await currentUser(req)
        if (!isAdmin(user)) {
          // 운영자가 아니면 이 길이 있다는 것 자체를 안 알린다.
          sendJson(res, 404, { error: 'not found' })
          return
        }
        const 모두 = await load게임평()
        const i = 모두.findIndex((r) => r.id === segments[1])
        if (i >= 0) { 모두.splice(i, 1); await persist게임평() }
        sendJson(res, 200, { 지웠습니다: true })
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
        const 보너스 = store.streak > 0 && store.streak % STREAK_DAYS === 0
        gp기록(store, '출석', gained, `${store.streak}일 연속${보너스 ? ' · 연속 보너스' : ''}${first ? ' · 첫 출석' : ''}`)
        await persistPacksim()
        sendJson(res, 200, { ...store, today, canCheckIn: false, gained, reward, capped: gained < reward })
        return
      }

      // POST /packsim/gift — 운영자가 회원에게 GP를 보낸다(사장님 지시 2026-08-22).
      // ⚠️ 운영자만. 아니면 이 길이 있다는 것도 안 알린다(다른 운영 창구와 같은 잣대).
      // ⚠️ 받는 사람은 **닉네임**으로 찾는다 — 회원번호를 화면까지 내려보내지 않으려고
      //    지켜 온 선이라, 선물 때문에 그걸 깨지 않는다.
      if (segments[0] === 'packsim' && segments[1] === 'gift' && segments.length === 2 && req.method === 'POST') {
        const viewer = await currentUser(req)
        if (!isAdmin(viewer)) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        try {
          const b = JSON.parse(await readBody(req)) as { 닉네임?: unknown; 금액?: unknown; 메시지?: unknown }
          // str() 도우미는 다른 함수 안에만 있다 — 여기서는 직접 다듬는다.
          const 글자 = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
          const 닉 = 글자(b.닉네임, 40)
          const 금액 = Math.round(Number(b.금액))
          const 메시지 = 글자(b.메시지, 100)
          if (!닉 || !Number.isFinite(금액) || 금액 <= 0 || 금액 > MAX_BALANCE) {
            sendJson(res, 400, { error: '닉네임과 금액을 확인해 주세요.' })
            return
          }
          const 후보 = (await loadUsers()).filter((u) => (u.nickname ?? '').trim() === 닉)
          if (후보.length === 0) {
            sendJson(res, 404, { error: `"${닉}" 회원을 찾지 못했습니다.` })
            return
          }
          if (후보.length > 1) {
            // 닉네임은 겹칠 수 있다. 엉뚱한 사람에게 주느니 멈춘다.
            sendJson(res, 409, { error: `"${닉}" 이름을 쓰는 회원이 ${후보.length}명입니다. 지금은 못 보냅니다.` })
            return
          }
          const store = await getPacksim(후보[0].id)
          const before = store.balance
          store.balance = capAdd(store.balance, 금액)
          const 들어감 = store.balance - before
          if (!들어감) {
            sendJson(res, 400, { error: `이미 잔액이 상한(${MAX_BALANCE.toLocaleString()}GP)이라 못 넣었습니다.` })
            return
          }
          gp기록(store, '운영자 선물', 들어감, 메시지 || undefined)
          // 안 본 선물이 남아 있으면 합쳐 둔다(둘 다 알려야 하는데 안내 자리는 하나다).
          store.pendingGift = {
            amount: (store.pendingGift?.amount ?? 0) + 들어감,
            message: 메시지 || store.pendingGift?.message || '',
            at: Date.now(),
          }
          await persistPacksim()
          sendJson(res, 200, { ok: true, 닉네임: 닉, 들어감, 잔액: store.balance, 상한걸림: 들어감 < 금액 })
        } catch {
          sendJson(res, 400, { error: '보내지 못했습니다.' })
        }
        return
      }

      // POST /packsim/gift/seen — 선물 안내를 봤다. 화면이 안내를 닫을 때 부른다.
      if (segments[0] === 'packsim' && segments[1] === 'gift' && segments[2] === 'seen' && req.method === 'POST') {
        const user = await currentUser(req)
        if (!user) {
          sendJson(res, 401, { error: 'login required' })
          return
        }
        const store = await getPacksim(user.id)
        if (store.pendingGift) {
          delete store.pendingGift
          await persistPacksim()
        }
        sendJson(res, 200, { ok: true })
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
          gp기록(store, isBox ? '박스 구매' : '팩 구매', -price, pack.label)
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
            gp기록(store, '박스 열기', -boxPrice, pack.label)
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
        // ⚠️ **팩 배열을 그대로 넘긴다.** 펴서 넘기면 30팩이 한 자리로 줄어든다(noteHighlight 설명).
        //    갓팩 여부도 팩마다 다르므로 그 팩 것을 준다.
        const hiBoxN = await noteHighlight(
          pack.slug,
          box.packs.map((bp) => bp.cards),
          (i) => !!box.packs[i]?.god,
          user,
        ).catch(() => [] as string[])
        sendJson(res, 200, {
          ...(hiBoxN.length ? { highlight: hiBoxN } : {}),
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
            gp기록(store, '팩 열기', -pack.price, pack.label)
          }
        }
        store.opened += 1
        if (drawn.god) store.god += 1
        store.last = { slug: pack.slug, cards: drawn.cards.map(({ n, r, m }) => ({ n, r, ...(m ? { m } : {}) })), god: drawn.god }
        await persistPacksim()
        // 홈 배너용 기록. 실패해도 개봉은 정상이라야 하므로 여기서 죽지 않게 감싼다.
        const hiN = await noteHighlight(pack.slug, [drawn.cards], () => drawn.god, user).catch(() => [] as string[])
        sendJson(res, 200, { cards: withUsd(pack.slug, drawn.cards), god: drawn.god, balance: store.balance, opened: store.opened, packs: store.packs ?? {}, unlimited, ...(hiN.length ? { highlight: hiN } : {}) })
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
        // ⚠️ 한 박스를 열면 자리가 여러 개 생기므로 **여러 장을 한 번에** 받는다.
        //    옛 꼴({n,name})도 그대로 받는다 — 이미 열린 화면이 그 꼴로 보낼 수 있다.
        const b = JSON.parse((await readBody(req)) || '{}') as {
          n?: unknown
          name?: unknown
          list?: { n?: unknown; name?: unknown }[]
        }
        const 것들 = Array.isArray(b.list) ? b.list : [{ n: b.n, name: b.name }]
        let 채움 = 0
        for (const it of 것들.slice(0, 60)) {
          const n = String(it?.n ?? '')
          const name = typeof it?.name === 'string' ? it.name : ''
          if (!n || !name) continue
          if (await fillHighlightName(user.id, n, name)) 채움++
        }
        sendJson(res, 200, { ok: 채움 > 0, 채움 })
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
        // 올리는 그 시점의 환율. 아직 한 번도 못 받았으면 값을 안 적는다(아래 krw 설명).
        const 환율 = 지금환율()
        const content = comment || `${pack.jp ? '일본어판' : '영문판'} ${packName} ${last.box ? '박스를' : '팩을'} 열었습니다.`
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
                // ⚠️ **값 높은 것부터** 늘어놓는다(사장님 지시 2026-08-11). 위에서 오름차순으로
                //    세워 뒤 12장을 잘랐으므로, 여기서 뒤집어야 제일 비싼 카드가 맨 앞에 온다.
                //    자랑글은 제일 좋은 카드를 먼저 보여 주는 게 맞다.
                .reverse()
                .map(({ c, q }) => ({
                  img: c.img ?? '',
                  name: koN(c),
                  r: tierKo[c.r ?? ''] ?? c.r ?? '',
                  ...(q > 1 ? { q } : {}),
                  // 올리는 그때의 원화값. 환율을 아직 못 받았거나 시세가 없는 카드는 안 적는다.
                  ...(c.usd && 환율 ? { krw: Math.round(c.usd * 환율.usdToKrw) } : {}),
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
        // ⚠️ 여기서 남긴다 — 위 rollback()이 도는 길이 있어서, 글이 올라간 게 확정된 뒤라야 한다.
        gp기록(store, '자랑 보너스', gained, '오늘 첫 자랑')
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
          const usd = 앨범값(prices[a.s], a.n, a.m)
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
//
// ⚠️⚠️ **레어도는 반드시 소문자로 견준다**(2026-08-11 · 사장님 지적 "스톰에메랄드가 왜
//    아직 8월 8일 기준이야"). 자료마다 표기가 달라(`Double Rare` ↔ `Double rare`)
//    **최근 일본판 세트 셋 다 후보가 1장뿐**이었고, `후보.length < 3`에 걸려 **매일
//    조용히 건너뛰고 있었다.** 8월 8일 이후 사흘간 한 번도 안 받은 이유다.
//    (카드 뽑기에서도 같은 함정을 이미 겪었다 — CLAUDE.md의 「등급 이름 대소문자」)
//    ⚠️ 「Art Rare」·「Special Art Rare」는 일본판 표기다. 영문판의
//       「Illustration rare」·「Special illustration rare」와 같은 자리라 함께 넣는다.
const HIT_RARITY = new Set(
  [
    'Double rare', 'Illustration rare', 'Ultra Rare', 'Special illustration rare',
    'Hyper rare', 'Mega Ultra Rare', 'Mega Hyper Rare', 'ACE SPEC Rare',
    'Art Rare', 'Special Art Rare', 'Super Rare', 'Secret Rare', 'Shiny Super Rare',
  ].map((r) => r.toLowerCase()),
)
/** ⚠️ 레어도를 견줄 땐 늘 이 함수를 쓴다 — 표기가 자료마다 다르다. */
const 힛등급인가 = (r?: string) => !!r && HIT_RARITY.has(String(r).toLowerCase())
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
  const 후보 = cards.filter((c) => 힛등급인가(c.r)).slice(0, HIT_MAX_TARGETS)
  if (후보.length < 3) return

  const 코드 = 세트.slug.replace(/^ja-/, '')
  // ⚠️ **세트 코드를 정규식에 그대로 넣으면 안 된다.** 일본판 코드 5개에 `+`가 들어
  //    있다(SM1+ · sm2+ · SM3+ · SM4+ · SM5+). `\[SM3+\s`는 정규식에서 "SM" 뒤에
  //    3이 하나 이상"이라는 뜻이 되어, **딴 세트인 [SM3 …]에 걸리고 정작 자기 것인
  //    [SM3+ …]은 못 찾는다**(2026-08-08 확인). 그 세트의 힛카드에 딴 세트 값이 붙는다.
  const 코드정규식 = 코드.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 세트 이름으로 한 번 찾으면 그 세트 상품이 한꺼번에 온다 — 카드마다 찾는 것보다 훨씬 적다.
  // ⚠️ **세트 코드로만 찾는다.** 예전엔 [한글 세트 이름, 코드] 둘로 찾았는데, 실측해 보니
  //    (2026-08-08):
  //      · 한글 이름("어비스아이"·"닌자스피너") → **0장.** 매물 제목이 일본어라 당연하다.
  //        요청 하나와 700ms를 매번 그냥 버리고 있었다.
  //      · 일본어 이름("アビスアイ") → 10장인데 **코드로 찾은 것과 같은 카드**라 더해도
  //        늘지 않는다(M5 10→10 · M4 12→12).
  //    코드만으로 충분하다 — 스톰에메랄다에서 24개 중 22개가 번호·이름까지 맞았다.
  //    스니커덩크에 부담을 덜 주는 것도 중요하다(예전에 조사하던 컴퓨터가 차단당했다).
  const 찾음 = new Map<string, string>()
  for (const kw of [코드].filter(Boolean)) {
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
    const fx = (await fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY', { signal: AbortSignal.timeout(10_000) }).then((r) => r.json())) as { rates?: { JPY?: number } }
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

/**
 * 저쪽(PPT) 번호 하나로 **그 카드의 요약**을 낸다 — 검색엔진용 카드 페이지가 쓴다.
 *
 * ⚠️⚠️ **크레딧 0이다.** 이미 받아 둔 것만 읽는다 — 도감(`card-index.json`) ·
 *    인쇄판별 시세 · 등급별 낙찰 · 감정 수량. **여기서 저쪽을 부르면 안 된다.**
 *    크롤러가 카드 주소를 두드릴 때마다 크레딧이 나가고, 카드가 5만 장이다.
 * ⚠️ 없는 값은 그냥 뺀다. 「틀린 것보다 빈칸」이 이 리포의 원칙이고, 검색 결과에
 *    「0원」이 적히면 안 본 것만 못하다.
 */
export async function 카드요약(id: string): Promise<{
  이름: string
  세트: string
  번호: string
  판: 'ja' | 'en'
  티피?: number
  등급?: { 이름: string; 값: number; 건수: number }
  팝수?: number
} | null> {
  const idx = await loadCardIndex()
  if (!idx) return null
  const 줄 = idx.rows.find((r) => r[7] === id)
  if (! 줄) return null
  const [slug, n, 이름] = 줄
  const 세트칸 = idx.sets[slug]
  const 것: Awaited<ReturnType<typeof 카드요약>> = {
    이름,
    세트: 세트칸?.[0] ?? slug,
    번호: 도감번호(n) ?? '',
    // ⚠️ 색인의 `ed`가 먼저다. 중국판 세트는 `ed`를 **'ja'로 적어** 일본판 목록에 섞여
    //    보이게 한다(사장님 결정) — 슬러그만 `zh-`다.
    판: (세트칸?.[1] as 'ja' | 'en') ?? (일본쪽세트(slug) ? 'ja' : 'en'),
  }
  // TCGplayer 대표 인쇄판 값 — 여럿이면 제일 비싼 것을 쓴다(대표를 따로 안 들고 있다).
  const 인쇄 = 인쇄판시세.get(id)
  if (인쇄) {
    const 값들 = Object.values(인쇄).map((v) => v.m).filter((v) => v > 0)
    if (값들.length) 것.티피 = Math.max(...값들)
  }
  // 등급별 낙찰 — 건수가 제일 많은 등급 하나만(타일에서 쓰는 「대표 등급」과 같은 잣대).
  const 등급표 = ebayGradeCache.get(id)
  if (등급표) {
    // ⚠️⚠️ **`ungraded`는 뺀다.** 저쪽이 등급을 못 알아본 낙찰 모음이라 값이 「생카드 값」이
    //    아니다(화면에서도 값을 안 보여 준다 — `등급확인안됨`). 검색 결과에 그 값을 적으면
    //    화면과 어긋나고, 무엇보다 틀린 값을 밖에 내보내는 셈이다.
    const 줄들 = Object.entries(등급표).filter(
      ([칸, v]) => 칸 !== 'ungraded' && 칸 !== 'raw' && v.n > 0 && (v.smart ?? v.avg) > 0,
    )
    줄들.sort((a, b) => b[1].n - a[1].n)
    const [등급이름, v] = 줄들[0] ?? []
    if (등급이름 && v) 것.등급 = { 이름: 등급이름, 값: Math.round(v.smart ?? v.avg), 건수: v.n }
  }
  const 팝 = populationCache.get(id)
  if (팝?.all) 것.팝수 = 팝.all
  return 것
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
  // ⚠️ **우리 세트에 없는 번호는 버린다.** 힛카드 파일은 저쪽 자료로 만든 것이라
  //    우리에게 없는 번호가 섞인다 — VMAX 클라이맥스에 284번이 들어 있었는데
  //    그 세트는 277번까지다(2026-08-08). 이름을 못 찾아 **빈 카드에 $51.23**만
  //    붙어 나갔고, 자리를 차지해 진짜 8등이 밀려났다.
  //    자르기(slice) **전에** 걸러야 밀려나지 않는다.
  const 있는것만 = (list: { n: string; usd: number }[], names: Map<string, string>) =>
    list
      .map((c) => ({ n: c.n, usd: c.usd, name: names.get(번호열쇠(c.n)) ?? '' }))
      .filter((c) => c.name)
      .slice(0, limit)
  if (saved?.src === 'snkrdunk' && saved.cards?.length) {
    return 있는것만(saved.cards, setCardNames(slug))
  }
  if (!hit) {
    // 앨범 시세가 없으면 미리 받아 둔 파일을 본다. 이름은 세트 파일에서 번호로 찾는다.
    if (!saved?.cards?.length) return []
    return 있는것만(saved.cards, setCardNames(slug))
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

// 카드 이름으로 세트를 가리지 않고 찾는 색인. `scripts/gen-card-index.mts`가 미리 만든다.
// 7MB라 클라이언트로 통째로 내려주면 무겁다 — 서버가 한 번 읽어 두고 결과만 준다.
// 한글 이름도 색인에 이미 들어 있어 서버가 변환기를 들고 있을 필요가 없다.
//
// ⚠️ **한 벌만 읽는다.** 플리마켓 안에 있던 것을 여기로 올렸다(2026-08-12) — 새 시세 길도
//    같은 색인을 쓰는데, 각자 읽으면 **7MB짜리를 두 번 펼쳐** 512MB 기계에서 위험하다.
type CardIndex = {
  // slug → [한글 세트명, ed, 발매일, 영문 세트명(한글과 같으면 빈칸)]
  sets: Record<string, [string, string, string, string?]>
  // slug · 번호 · 이름 · 그림 · 한글이름 · 한글그림 · 한글번호 · **저쪽(PPT) 번호**
  //   · **원래(영문) 이름** · 레어도 · 일반판그림표시 · 인쇄번호
  // ⚠️ 8번째 `tcg`는 2026-08-12에 붙였다. 이게 있어야 덤프에서 값을 콕 집어 꺼낸다.
  // ⚠️⚠️ **여기 적힌 길이가 실제보다 짧으면 뒤쪽 칸을 못 읽는다.** 파일에는 12칸이
  //    들어 있는데(`scripts/gen-card-index.mts`) 이 줄은 8칸까지만 적혀 있었다.
  //    9번째(영문 이름)를 쓰려다 타입에서 걸려 알았다(2026-08-19). **생성기와 같이 고칠 것.**
  rows: [string, string, string, string, string, string, string, string, string?, string?, string?, string?][]
}
let cardIndex: CardIndex | null = null
let cardIndexTried = false

async function loadCardIndex(): Promise<CardIndex | null> {
  if (cardIndex || cardIndexTried) return cardIndex
  return firstReadOnce('card-index', async () => {
    if (cardIndex) return cardIndex
    cardIndexTried = true
    // 리포 루트(개발)와 이미지 루트(배포) 모두 같은 자리다. public/ 에 두지 않는 이유는
    // 거기 있으면 정적 파일로 공개돼 누구나 7MB를 내려받게 되기 때문이다.
    try {
      cardIndex = JSON.parse(await readFile(path.resolve('card-index.json'), 'utf-8'))
      return cardIndex
    } catch {
      /* 아래에서 알린다 */
    }
    console.warn('[pokegre] card-index.json 을 못 찾았습니다. npx tsx scripts/gen-card-index.mts 로 만드세요.')
    return null
  })
}

// ═══════════════════════════════════════════════════════════════════════════
//  새 시세 길 (2026-08-12) — 「카드가 먼저, 값이 나중」
//
//  ⚠️⚠️ **옛 길에 덧붙인 게 아니라 따로 깐 길이다**(사장님 지시: "기존꺼에 덧붙이지
//     말고 새로운 토글 만들어서"). 옛 길(`/api/local/card-prices` + ebayPrices.ts)은
//     그대로 살아 있다. 둘을 나란히 놓고 세어 본 뒤에 무엇을 남길지 정한다.
//
//  왜 새로 깔았나 — 옛 길은 **매물을 찾는다.** 그래서 매물 제목이 재료가 되고,
//  제목은 파는 사람 마음대로라 뒤처리가 겹겹이 붙었다(제목 뜯기·조각 잇기·옮겨쌓기·
//  세트 대응표·레어도 꼬리 떼기 — 700줄쯤). 이 길은 **카드를 먼저 정한다.**
//  카드가 정해지면 그 카드의 PPT 번호로 덤프에서 값을 꺼내면 끝이라 뒤처리가 없다.
//
//  재료(전부 덤프 · **크레딧 0**):
//    인쇄판별 시세 52,213장(91%) · 등급별 낙찰 20,179장(35%) · 감정 수량 19,334장(34%)
//    셋 중 하나라도 값이 있는 카드 52,222장(91%)
//
//  ⚠️ 화면에 내주는 꼴은 **옛 길과 똑같다**(EbayCard). 사장님 지시로 형태를 맞춘 것이라,
//     화면 컴포넌트를 그대로 재사용해 두 길을 같은 눈으로 견줄 수 있다.
// ═══════════════════════════════════════════════════════════════════════════
// ── 카드 한 장의 「추이 + 낱개 낙찰」을 받아서 **우리 것으로 쌓는다** (2026-08-12) ──
//
// 덤프는 **요약만** 준다(등급별 건수·평균·중앙값·적정가). 날짜별 추이도, 「1월 18일에
// $160에 팔렸다」도 안 온다. 그건 저쪽에 따로 물어야 나온다(카드당 3크레딧).
//
// ⚠️ **한 번 받은 것은 저장해서 다시 안 받는다.** 사람들이 많이 보는 카드일수록 값을
//    딱 한 번만 치른다. 게다가 **덮어쓰지 않고 이어 붙인다** — 저쪽은 한 번에 200일치쯤
//    주는데, 이어 붙이면 시간이 갈수록 **우리 그래프가 저쪽보다 길어진다.**
//    1년 뒤에는 저쪽에 없는 기간까지 우리가 갖게 된다. 그게 「우리 자료가 된다」의 뜻이다.
//
// ⚠️ 값이 묵으니 **이레가 지나면 다시 받는다**(사장님과 정한 간격). 한 장에 이레마다
//    3크레딧이라 하루 200,000 중 티도 안 난다.
type 낱개낙찰 = {
  p: number
  d: string
  u?: string
  a?: boolean
  t?: string
  /** 깎아 판 값(Best Offer). 셈에는 들고 화면에 작은 표만 붙는다(사장님 결정 2026-08-19). */
  bo?: boolean
  /** 저쪽이 원래 담았던 칸(우리가 옮겼을 때만). */
  g0?: string
  /**
   * **셈에서 뺀 까닭.** 값을 지우는 게 아니라 「왜 안 셌는지」를 적어 남긴다 —
   * 나중에 밝혀지면 되살릴 수 있어야 하고, 화면도 목록에는 그대로 보여 주며
   * 취소선으로만 표시한다(`src/components/EbayCardDetail.tsx`의 `뺀까닭`).
   */
  x?: string
}

/**
 * **이 낙찰이 중국판(간체) 카드인가.** 맞으면 까닭을 돌려주고, 아니면 빈 문자열.
 *
 * ⚠️ 왜 필요한가: 저쪽(PPT)은 이베이 매물을 **포켓몬 이름으로 뭉쳐** 보내는데, 중국판은
 *    카드 이름이 영문으로 같아서 일본판·영문판 칸에 그대로 섞여 들어온다. 실측(2026-08-18):
 *    무번호 프로모 세트에서 낙찰 **152/994건(15%)** 이 중국판이었고, 루기아 58/251 ·
 *    리자몽 24/147 · 강철톤 18/131이었다. 값이 딴 나라 것이라 **중앙값이 통째로 내려간다.**
 *
 * ⚠️⚠️ **낱말 여섯 개는 실제 매물 제목 2,611건으로 재 보고 고른 것이다.** 210건이 걸렸고
 *    **헛걸림 0건 · 놓침 0건**이었다(제목에 중국 표식이 있는데 안 걸린 것이 없었다).
 *    `\bCN\b`도 재 봤는데 걸리는 것이 이미 세트코드로 걸리는 한 건뿐이라 **뺐다** —
 *    두 글자짜리는 딴 뜻으로 쓰일 자리가 너무 많다.
 * ⚠️ **`Gem Pack`은 중국 전용 상품명이다**(보석팩). 우리 세트 665개·카드 58,527장 어디에도
 *    없는 것을 확인하고 넣었다. 「GEM MINT」·「GEM MT」와는 안 겹친다(`gem ?pack`으로 묶었다).
 * ⚠️ 늘릴 때는 **반드시 실제 제목으로 헛걸림을 세어 볼 것.** 여기서 잘못 걸면 멀쩡한 낙찰이
 *    조용히 셈에서 빠져 값이 틀려진다 — 「안 보이는 것」이 아니라 「틀린 값」이 된다.
 */
function 중국어판낙찰(제목: string | undefined): string {
  const s = String(제목 ?? '')
  if (!s) return ''
  if (/\bchinese\b/i.test(s)) return '중국어판'
  if (/\bs[-. ]?chn\b/i.test(s)) return '중국어판(S-CHN)'
  if (/\bchn\b/i.test(s)) return '중국어판(CHN)'
  if (/\bgem ?pack\b/i.test(s)) return '중국어판(보석팩)'
  const 세트 = s.match(/\bC(?:BB|SM|SV)\d[\dA-Za-z.]*\b/i) ?? s.match(/\bCS\d[a-z]?(?:\.\d)?C?\b/i)
  return 세트 ? `중국어판(${세트[0].toUpperCase()})` : ''
}

/**
 * **이베이에서 긁어 온 매물이 그 카드 것인가** — 제목의 번호로 가린다.
 *
 * ⚠️⚠️⚠️ **「번호가 들어 있나」로 보면 안 된다. 처음에 그렇게 만들었다가 틀렸다.**
 *    우리 번호가 `09/09`인데 딴 카드 제목 `0703/09`에도 「/09」가 있어서, 실측 35건 중
 *    **23건을 골랐고 그중 11건이 딴 카드**였다(2026-08-19). 리포에 이미 적혀 있던
 *    「앞의 0」 함정과 같은 것이다. **슬래시 앞쪽이 내 번호와 같아야** 내 카드다.
 * ⚠️ 고친 뒤 같은 35건으로 다시 재니 **3건 · 딴 카드 0건**이었고, 다른 꼴 번호
 *    여섯 가지(`107` · `BW73` · `H31` · `4/102` …)도 다 맞았다.
 * ⚠️⚠️ **한 자리 번호(`1`·`4`)는 아직 헐겁다.** 제목에 흔한 숫자라 엉뚱한 게 걸린다.
 *    그래서 세 글자 미만 번호는 **세트 코드가 제목에 같이 있어야** 받는다.
 */
export function 내낙찰인가(제목: string, 번호: string, 세트코드?: string): boolean {
  const t = String(제목 || '').toLowerCase()
  const [내번, 총] = String(번호).toLowerCase().split('/')
  const 앞0떼기 = (s: string) => s.replace(/^0+/, '') || '0'
  const n = 앞0떼기(내번)
  if (!n) return false
  // ⚠️ **제목에 「N/M」이 있으면 그게 가장 확실한 단서다** — 우리 번호에 총이 있든 없든.
  //    (`4`짜리 카드도 이베이 제목엔 `4/102`로 적힌다.)
  const 슬래시들 = [...t.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
  if (슬래시들.length) {
    for (const m of 슬래시들) {
      if (앞0떼기(m[1]) === n) return true
      // 「0709/09」처럼 앞에 팩 번호가 붙는 판이 있다 — 뒤 두 자리가 카드 번호다.
      if (m[1].length > 2 && 앞0떼기(m[1].slice(-2)) === n) return true
    }
    // ⚠️ 슬래시 번호가 있는데 안 맞으면 딴 카드다. 여기서 낱말 검사로 넘기면
    //    `0703/09`의 「/09」가 걸려 딴 카드를 담는다.
    //    다만 우리 번호가 글자 섞인 꼴(`BW73`·`H31`)이면 슬래시와 상관없으니 넘어간다.
    if (/^\d+$/.test(n)) return false
  }
  // ⚠️ 짧은 번호는 그 자체로 못 믿는다(제목에 흔한 숫자다). 세트 코드가 같이 있을 때만.
  //    ⚠️ 다만 **우리 번호가 `09/09`처럼 총까지 있는 꼴이면 그대로 믿는다** — 앞의 0을
  //       떼면 `9` 한 자리가 되는데, 그것 때문에 진짜 우리 카드를 놓쳤다(2026-08-19).
  if (n.length < 2 && !총 && !(세트코드 && t.includes(세트코드.toLowerCase()))) return false
  // ⚠️⚠️ **등급 숫자를 카드 번호로 읽으면 안 된다.** 「PSA **9**」의 9가 우리 번호 9로
  //    읽혀 **딴 카드(#01)가 우리 칸에 들어왔다**(사장님이 화면에서 보시고 알았다 ·
  //    2026-08-19). 감정 회사 뒤에 붙는 숫자는 등급이지 카드 번호가 아니다 — 지우고 본다.
  const 등급뗀 = t.replace(new RegExp(`\\b(?:${회사말})\\s*-?\\s*[a-z/\\s-]{0,14}?\\s*\\d+(?:[._]\\d)?\\b`, 'gi'), ' ')
  const 낱말 = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(^|[^0-9a-z])0*' + 낱말 + '($|[^0-9a-z])').test(등급뗀)
}

/** 이베이가 적는 「Aug 19, 2026」을 `2026-08-19`로. 못 읽으면 빈 문자열. */
export function 날짜읽기(s: string): string {
  const 달 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const m = String(s).trim().match(/([A-Za-z]{3})\w*\s+(\d{1,2}),?\s+(\d{4})/)
  if (!m) return ''
  const i = 달.indexOf(m[1].toLowerCase())
  if (i < 0) return ''
  return `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/**
 * **한 저쪽 번호를 여러 카드가 나눠 쓸 때, 그 카드 것만 고르는 규칙.**
 *
 * ⚠️⚠️ **왜 필요한가:** TCGplayer가 「Captain Pikachu」 상품 **하나**만 만들어 놓아서,
 *    저쪽 낙찰 35건 안에 **여덟 가지 넘는 다른 중국판 카드**가 들어 있다(보석팩 1권
 *    03/09·04/09·09/09 · 5권 02/07~07/07). 우리가 카드를 갈라 놓았어도 낙찰은 안 갈라진다.
 *    그대로 붙이면 **5권 $1.25짜리가 이 카드 값인 척** 나간다.
 *
 * ⚠️ **손으로 확인한 것만 적는다.** 매물 제목을 하나하나 눈으로 보고 적었다 —
 *    기계로 번호를 뽑게 했다가 「Pikachu 004」를 4번이 아니라 1번으로 보낸 적이 있다
 *    (앞의 0 때문 · `값고침`의 `drop` 주석 참고).
 * ⚠️ **여기 없는 열쇠는 아무것도 안 거른다.** 규칙이 없으면 예전 그대로 돈다.
 */
/**
 * **시세 검색에서 감출 카드.** 열쇠는 `세트slug|번호`.
 *
 * ⚠️⚠️ **자료는 안 지운다 — 화면에서만 뺀다.** 여기서 한 줄 지우면 그대로 되살아난다.
 * ⚠️ **줄 것이 하나도 없는 카드만** 적는다. 값도 없고, 그림도 없고, 붙은 낙찰마저
 *    딴 카드인 것. 값이 없다는 이유만으로 감추면 안 된다 — 그런 카드가 6,306장이다.
 */
const 감춘카드 = new Set<string>([
  // ⚠️ 지금은 비어 있다. 「Captain Pikachu」(617410)가 여기 있었는데, **정체가 밝혀져
  //    2026-08-19에 뺐다** — 위 조건("진짜 그 카드가 무엇인지 밝혀지면")을 채웠다.
  //    **2008년 요코하마 포켓몬센터 이전 기념 일본판 점보 프로모**다(TCGplayer 제품 설명
  //    「Yokohama Pokemon Center relocation 2008」 + 불바피디아와 항목 전부 일치:
  //    작가 Kouki Saitou · HP 80 · 약점 +20 · 저항 -20 · 후퇴 1 · たからさがし ·
  //    だいらんとう!? 100). 중국어판 AR과는 **이름만 같은 남남**이라, 이름을
  //    「캡틴피카츄 (2008 요코하마 점보)」로 갈라 놓고 다시 낸다.
  //    ⚠️ 이 카드의 팝수(PSA 1,604장)는 **이 카드 것이 맞다** — 감출 것은 AR 쪽이다.
])

const 내낙찰고르기: Record<string, { 맞나: RegExp; 왜: string }> = {
  // 캡틴피카츄 AR — 보석팩 1권 **09/09**. 제목에 「09/09」·「07 09」로 적히거나,
  // 번호 없이 「VOL. 1 … ART RARE」로만 적힌 것이 있다(실측 4건: PSA10 셋 + CGC10 하나).
  // ⚠️ 5권(CBB5C)의 AR은 **07/07이라 다른 카드**다 — 「VOL.5」가 걸리면 안 된다.
  '617410~zh': {
    맞나: /\b0?9\s*\/\s*0?9\b|\b07\s+09\b|\bholo\s+0?9\b|vol\.?\s*1\b[^|]*\bart rare\b/i,
    왜: '보석팩 1권 09/09(AR). 스니커덩크 상품 528639와 같은 카드.',
  },
}

type 카드기록 = {
  /** 마지막으로 저쪽에 물어본 때(ms). 이레가 지나면 다시 묻는다. */
  at: number
  /** 등급별 날짜별 낙찰 평균가. `{ psa10: { '2026-05-05': 99.99 } }` */
  h?: Record<string, Record<string, number>>
  /** 등급별 낱개 낙찰(최근 것부터). */
  s?: Record<string, 낱개낙찰[]>
  /**
   * **우리가 다시 센 등급값.** 저쪽이 등급을 잘못 담아 보낸 칸만 들어 있다.
   * 있으면 덤프 값보다 이걸 먼저 쓴다(`smart`는 버리고 중앙값이 나간다).
   */
  gx?: Record<string, { n: number; avg: number; med: number }>
  /** TCGplayer 추이 — `c`는 어느 상태의 추이인지. */
  tcg?: { c: string | null; h: Record<string, number> }
  /**
   * 감정 수량. **덤프에 없는 카드만** 여기 담긴다(덤프에 있으면 목록 응답에 이미 실려 있다).
   * ⚠️ 덤프가 담는 것은 저쪽 번호 있는 카드의 **34%**뿐이다(19,334/57,344 · 2026-08-12).
   *    값 \$20 넘는데 없는 카드가 1,242장이라, 그건 카드를 열 때 한 번 받아 두는 게 맞다.
   */
  pop?: PopEntry
}
/**
 * ⚠️⚠️ **카드마다 파일 하나로 나눠 둔다. 한 파일에 모으면 안 된다.**
 *
 * 처음엔 다른 자료처럼 `card-history.json` 한 덩이로 만들었다가 실물을 보고 갈아엎었다
 * (2026-08-12). 한 장이 **41KB**였다 — 3~4KB로 짐작했던 것의 열 배다. 그러면
 * 카드를 하나 열 때마다 **수백 MB짜리 파일을 통째로 다시 쓰게 된다**(`saveJsonMap`은
 * 맵 전체를 쓴다). 512MB 기계에서 그건 사고다.
 * 나눠 두면 한 번에 20KB만 쓰고, 기동할 때 통째로 읽어 메모리에 이고 있을 필요도 없다
 * (그림 캐시 `/data/imgcache`가 쓰는 방식과 같다).
 */
// ── 미감정 칸 낙찰의 **사진을 보고 등급을 읽는다** (2026-08-14) ────────────────
//
// ⚠️⚠️ **왜 필요한가 — 미감정 칸은 「저쪽이 등급을 못 읽었다」는 뜻이다.** 그래서 잘못
//    담기는 곳이 정확히 거기다(사장님 지적: "미감정에 psa10 매물이 들어있다").
//    실물로 확인한 카드 하나(`/e/250323`)에서 미감정 5건 중 **4건이 감정 카드**였다 —
//    PSA 10 둘 · PSA 9 하나 · CGC 10 하나. 진짜 미감정은 $0.99짜리 한 건뿐이었다.
//
// ⚠️⚠️ **제목으로는 못 잡는다.** 그 4건 중 제목에 등급이 적힌 것은 하나뿐이었다
//    (「Graded CC&G 10」). 나머지는 제목·매물 페이지 글 어디에도 등급이 없고 **사진에만**
//    슬랩이 찍혀 있다. 저쪽이 주는 `gradingCompany`·`grade` 칸도 **전부 비어 있다**(확인함).
//    그래서 사진이 유일한 근거다.
//
// ⚠️⚠️ **감정 칸(psa10 등)은 안 건드린다.** 거기는 저쪽이 등급을 읽고 넣은 것이라 근거가
//    이미 둘(제목·저쪽 분류)이고, 우리 판독은 작은 사진에서 **8을 9로 잘못 읽은 적이 있다**.
//    근거가 하나뿐인 우리 판독으로 근거가 둘인 것을 뒤집으면 그게 새 오류다.
//
// ⚠️ 사진 주소는 **이베이 API**로 받는다(매물 번호 → 사진). 매물 페이지는 `curl`이 403이고
//    인앱 브라우저도 막히지만, API는 **낙찰이 끝난 매물도** 준다. 키는 예전에 기능을 뺄 때
//    지우지 않고 Fly 시크릿에 남겨 둔 것을 다시 쓴다(무료 · 하루 5,000번).
// ⚠️ 사진은 **225px 짜리**를 쓴다(`s-l1600`을 `s-l225`로 바꾼다). 500px는 장당 420토큰,
//    225px는 **192토큰**인데 판독은 그대로였다(실측). Haiku는 등급 숫자를 못 읽어 안 쓴다.
// ⚠️⚠️ **이 열쇠는 사이트 「사진으로 찾기」와 같은 지갑을 쓴다.** 2026-08-13에 카드 820장을
//    읽다 잔액이 바닥나 **운영의 사진 검색이 멈춘 적이 있다.** 그래서 하루 상한이 있다.
/** mountApi가 받은 환경. 사진 판독이 이베이·Anthropic 열쇠를 여기서 꺼낸다. */
let 환경: ApiEnv = {}
const SLAB_FILE = dataFile('slab-reads.json')
/** 매물 번호 → 읽어낸 등급칸(`psa10`…) · `raw`(진짜 미감정) · `''`(못 읽음·매물 지워짐) */
const slabCache = new Map<string, string>()
const SLAB_STATE_FILE = dataFile('slab-state.json')
let slab하루 = { day: '', ebay: 0, ai: 0 }
/** 하루에 읽을 사진 수. 잔액이 사이트 사진 검색과 공유라 넉넉히 잡지 않는다. */
const SLAB_AI_DAILY = 4_000
/**
 * ⚠️⚠️⚠️ **사진 읽기는 꺼 둔다**(사장님 지시 2026-08-15: "예상하지 못하는 금액이 나갈 것 같으니까").
 *
 * 왜 껐나 — 두 가지다.
 *   ① **돈.** 카드를 열 때마다 매물 사진을 읽어 한 달 $12쯤이 예고 없이 나간다. 이 열쇠는
 *      사이트 「사진으로 찾기」와 **같은 지갑**이라, 마르면 방문자 기능이 멈춘다.
 *   ② **느려진다.** 카드 하나를 열 때 낱개마다 이베이 API + 사진 판독을 하느라 상세가
 *      몇 초씩 늦게 떴다(사장님 지적: "상세보기할때 내역들 너무 늦게 나와").
 *
 * ⚠️ **끈다고 값이 틀려지지는 않는다.** 「등급 확인 안 됨」 칸은 이제 값을 아예 안 보여 주므로
 *    (`등급확인안됨` · src/api/ebayPrices.ts), 사진으로 확인해도 화면에 더 쓸 데가 없다.
 *    제목에 등급이 적힌 매물을 옮기는 것은 **공짜라 그대로 돈다.**
 * ⚠️ 다시 켜려면 이 값만 true로. 이미 읽은 매물은 `/data/slab-reads.json`에 남아 있어
 *    값이 다시 들지 않는다.
 */
const 사진판독켬 = false
/** 이베이 API 하루 몫(저쪽이 정한 값은 5,000이라 여유를 둔다). */
const SLAB_EBAY_DAILY = 4_500

async function slab상태읽기() {
  try {
    const d = JSON.parse(await readFile(SLAB_STATE_FILE, 'utf-8')) as typeof slab하루
    if (d && typeof d.day === 'string') slab하루 = { day: d.day, ebay: d.ebay || 0, ai: d.ai || 0 }
  } catch {
    /* 없으면 처음 */
  }
  await loadJsonMap(SLAB_FILE, slabCache as Map<string, unknown>, '사진 등급 판독')
}
async function slab상태쓰기() {
  await writeJsonFile(SLAB_STATE_FILE, slab하루).catch(() => undefined)
}
function slab오늘맞추기() {
  const 오늘 = utcDay()
  if (slab하루.day !== 오늘) slab하루 = { day: 오늘, ebay: 0, ai: 0 }
}

let ebay토큰: { v: string; 만료: number } | null = null
async function 이베이토큰(env: ApiEnv): Promise<string | null> {
  if (ebay토큰 && ebay토큰.만료 > Date.now() + 60_000) return ebay토큰.v
  const id = env.EBAY_APP_ID
  const cs = env.EBAY_CERT_ID
  if (!id || !cs) return null
  try {
    const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${id}:${cs}`).toString('base64')}`,
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope')}`,
      signal: AbortSignal.timeout(15_000),
    })
    const j = (await r.json()) as { access_token?: string; expires_in?: number }
    if (!j.access_token) return null
    ebay토큰 = { v: j.access_token, 만료: Date.now() + (j.expires_in ?? 7200) * 1000 }
    return ebay토큰.v
  } catch {
    return null
  }
}

/** 매물 번호로 사진 주소를 받는다. 지워진 매물은 null(그때는 손대지 않는다). */
async function 매물사진(env: ApiEnv, listingId: string): Promise<string | null> {
  const t = await 이베이토큰(env)
  if (!t) return null
  slab오늘맞추기()
  if (slab하루.ebay >= SLAB_EBAY_DAILY) return null
  slab하루.ebay++
  try {
    const r = await fetch(`https://api.ebay.com/buy/browse/v1/item/v1|${encodeURIComponent(listingId)}|0`, {
      headers: { Authorization: `Bearer ${t}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { image?: { imageUrl?: string } }
    return j.image?.imageUrl ?? null
  } catch {
    return null
  }
}

/** 사진 한 장을 보고 슬랩인지·어느 등급인지 읽는다. 못 읽으면 ''. */
async function 사진등급(env: ApiEnv, 사진주소: string): Promise<string> {
  const k = env.ANTHROPIC_API_KEY
  if (!k) return ''
  slab오늘맞추기()
  if (slab하루.ai >= SLAB_AI_DAILY) return ''
  try {
    // ⚠️ 큰 사진은 값만 두 배다 — 225px로 줄여 받는다(실측: 판독 결과 같음).
    const 작은것 = 사진주소.replace(/s-l\d+\.jpg/i, 's-l225.jpg')
    const buf = Buffer.from(await (await fetch(작은것, { signal: AbortSignal.timeout(15_000) })).arrayBuffer())
    if (!buf.length) return ''
    slab하루.ai++
    const r = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 48,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } },
              {
                type: 'text',
                text: '이 이베이 매물 사진을 봐라. 카드가 감정 회사 케이스(슬랩)에 들어 있나? 들어 있으면 라벨의 회사와 등급을 읽어라. 딱 한 줄로만 답해라: SLAB <회사> <등급> 또는 RAW 또는 SLAB UNKNOWN. 다른 말은 하지 마라.',
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const j = (await r.json()) as { content?: { text?: string }[] }
    const 답 = (j.content ?? []).map((c) => c.text ?? '').join(' ').trim()
    if (/^\s*RAW\b/i.test(답)) return 'raw'
    // 「SLAB PSA 10」·「SLAB PSA GEM MINT 10」 꼴에서 회사와 숫자를 뽑는다.
    const m = /SLAB\s+([A-Za-z&]+)[^0-9]*?(10|[1-9](?:\.5)?)\b/i.exec(답)
    if (!m) return ''
    const 회사 = m[1].toLowerCase()
    if (!new RegExp(`^(?:${회사말})$`, 'i').test(회사)) return '' // 우리가 아는 회사만
    return `${회사}${m[2].replace('.', '_')}`
  } catch {
    return ''
  }
}

/**
 * 미감정 칸 낙찰들의 사진을 읽어 **제자리 등급칸**을 돌려준다(매물번호 → 등급칸).
 * ⚠️ 한 번 읽은 매물은 다시 안 읽는다 — 못 읽은 것(`''`)도 적어 두어 두 번 두드리지 않는다.
 */
async function 미감정사진읽기(env: ApiEnv, 낙찰: { listingId?: string }[]): Promise<Map<string, string>> {
  const 답 = new Map<string, string>()
  let 바뀜 = false
  for (const s of 낙찰) {
    const id = String(s.listingId ?? '').trim()
    if (!id) continue
    if (slabCache.has(id)) {
      답.set(id, slabCache.get(id)!)
      continue
    }
    const 사진 = await 매물사진(env, id)
    const 등급 = 사진 ? await 사진등급(env, 사진) : ''
    slabCache.set(id, 등급)
    답.set(id, 등급)
    바뀜 = true
  }
  if (바뀜) {
    await writeJsonFile(SLAB_FILE, Object.fromEntries(slabCache)).catch(() => undefined)
    await slab상태쓰기()
  }
  return 답
}

/**
 * 미감정 칸이 수상한 카드를 골라 **사진으로 등급을 확인**한다(시킬 때만 돈다).
 *
 * ⚠️ 고르는 잣대는 **미감정 값이 PSA 10보다 비싼 카드**다. 5.5%(670장)가 그렇고,
 *    그게 방문자 눈에 제일 이상하게 보이는 자리다.
 * ⚠️ 실제 판독·옮기기는 `카드기록받기`가 한다 — 여기서는 그 카드를 **열어 주기만** 한다.
 *    자리가 둘이면 규칙도 둘이 되어 언젠가 어긋난다.
 * ⚠️ 하루 상한에 걸리면 조용히 멈춘다. 남은 것은 다음에 시키면 이어서 한다.
 */
/**
 * **쌓아 둔 낙찰 기록을 통째로 다시 받는다.** 거르는 규칙을 고쳤을 때 쓴다.
 *
 * ⚠️⚠️ **왜 필요한가:** 낙찰을 거르는 일(중국판 걷어내기·등급 옮겨쌓기)은 **저쪽에서
 *    받는 그 순간에만** 할 수 있다. 저장할 땐 칸마다 5건으로 자르기 때문에(`기록낱개최대`)
 *    나중엔 다시 셀 수 없다. 그런데 기록은 **이레**를 캐시하므로, 규칙을 고쳐 배포해도
 *    화면은 최대 이레 동안 옛 값 그대로다. 2026-08-18에 중국판 걷어내기를 넣고
 *    **배포 뒤에도 화면이 안 바뀌어** 이 자리를 만들었다.
 *
 * ⚠️ 크레딧: **한 장에 3**(카드 1 + 히스토리 1 + 이베이 1). 20,276장이면 60,828이다.
 * ⚠️ **바닥선(5,000)을 넘어서면 멈춘다.** 방문자 몫을 먹으면 안 된다.
 * ⚠️ **다시 시키면 이어서 한다** — 이레 검사를 건너뛰므로 이미 한 카드도 다시 받지만,
 *    멈춘 자리부터 이어 하려면 `건너뛸수`를 준다(`{"받기":["다시받기:5000"]}`).
 * ⚠️ **진행을 200장마다 찍는다.** 총계만 보면 멈춘 걸 못 알아챈다 — 러너에서 겪었다.
 */
async function 낙찰기록다시받기(apiKey: string, 건너뛸수 = 0, 몇장 = 0): Promise<void> {
  const 이름들 = (await readdir(CARD_HISTORY_DIR).catch(() => [] as string[]))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort()
  const idx = await loadCardIndex()
  const 판표 = new Map<string, 'japanese' | 'english'>()
  if (idx) for (const r of idx.rows) if (r[7]) 판표.set(r[7], (idx.sets[r[0]]?.[1] ?? 'ja') === 'en' ? 'english' : 'japanese')
  const 할것 = 몇장 > 0 ? 이름들.slice(건너뛸수, 건너뛸수 + 몇장) : 이름들.slice(건너뛸수)
  console.log(
    `[pokegre] 낙찰 기록 다시받기 시작: ${할것.length.toLocaleString()}장` +
      (몇장 > 0 ? `(전체 ${이름들.length.toLocaleString()}장 중 시험)` : '') +
      (건너뛸수 ? `(앞 ${건너뛸수.toLocaleString()}장 건너뜀)` : '') +
      ` · 예상 ${(할것.length * 3).toLocaleString()}크레딧 · 지금 남은 ${Number.isFinite(pptLeftNow()) ? pptLeftNow().toLocaleString() : '모름'}`,
  )
  let 한것 = 0
  let 멈춘까닭 = '다 했습니다'
  const 시작 = Date.now()
  for (const id of 할것) {
    // ⚠️ **바닥선을 지킨다.** 한 장에 3이므로 여유를 두고 미리 선다.
    if (pptLeftNow() < PPT_FLOOR + 100) {
      멈춘까닭 = `크레딧 바닥선(${PPT_FLOOR.toLocaleString()})에 닿아 멈춥니다 — 남은 ${pptLeftNow().toLocaleString()}`
      break
    }
    if (!pptGate().ok) {
      멈춘까닭 = '저쪽이 막아서 멈춥니다(429·403) — 잠잠해진 뒤 다시 시키세요'
      break
    }
    await 카드기록받기(apiKey, id, 판표.get(id) ?? 'japanese', true)
    한것++
    // 분당 500요청 한도. 한 장이 요청 하나라 넉넉하지만, 저쪽을 몰아치지 않는다.
    await new Promise((r) => setTimeout(r, 130))
    if (한것 % 200 === 0) {
      const 분 = (Date.now() - 시작) / 60000
      console.log(
        `[pokegre] 낙찰 기록 다시받기 ${한것.toLocaleString()}/${할것.length.toLocaleString()}장 · ` +
          `${분.toFixed(1)}분 · 분당 ${(한것 / 분).toFixed(0)}장 · 남은 크레딧 ${Number.isFinite(pptLeftNow()) ? pptLeftNow().toLocaleString() : '모름'}`,
      )
    }
  }
  console.log(
    `[pokegre] 낙찰 기록 다시받기 끝: ${한것.toLocaleString()}장 · ${((Date.now() - 시작) / 60000).toFixed(1)}분 · ` +
      `남은 크레딧 ${Number.isFinite(pptLeftNow()) ? pptLeftNow().toLocaleString() : '모름'} · ${멈춘까닭}` +
      (한것 < 할것.length ? ` · 이어서 하려면 "다시받기:${건너뛸수 + 한것}"` : ''),
  )
}

async function 미감정점검(apiKey: string): Promise<void> {
  if (!apiKey) return
  if (!사진판독켬) {
    console.log('[pokegre] 미감정 점검: 사진 읽기가 꺼져 있습니다(사진판독켬=false). 켜고 다시 시키세요.')
    return
  }
  slab오늘맞추기()
  const 후보: { id: string; 배: number }[] = []
  for (const [id, 표] of ebayGradeCache) {
    const u = 표.ungraded
    const p = 표.psa10
    if (!u || !p) continue
    const uv = u.smart ?? u.avg
    const pv = p.smart ?? p.avg
    if (uv > 0 && pv > 0 && uv > pv) 후보.push({ id, 배: uv / pv })
  }
  후보.sort((a, b) => b.배 - a.배)
  console.log(`[pokegre] 미감정 점검: 수상한 카드 ${후보.length.toLocaleString()}장 — 하루 몫이 닿는 데까지 봅니다.`)
  const idx = await loadCardIndex()
  const 판표 = new Map<string, 'japanese' | 'english'>()
  if (idx) for (const r of idx.rows) if (r[7]) 판표.set(r[7], (idx.sets[r[0]]?.[1] ?? 'ja') === 'en' ? 'english' : 'japanese')
  let 본카드 = 0
  for (const { id } of 후보) {
    if (slab하루.ai >= SLAB_AI_DAILY || slab하루.ebay >= SLAB_EBAY_DAILY) {
      console.log(`[pokegre] 미감정 점검: 하루 몫을 다 썼습니다(사진 ${slab하루.ai} · 이베이 ${slab하루.ebay}). 다음에 이어서.`)
      break
    }
    // 점검은 **늘 다시 받는다** — 규칙을 고쳤을 때 이미 본 카드도 다시 계산돼야 한다.
    await 카드기록받기(apiKey, id, 판표.get(id) ?? 'english', true)
    본카드++
  }
  await slab상태쓰기()
  console.log(
    `[pokegre] 미감정 점검 끝 — 카드 ${본카드}장 · 사진 ${slab하루.ai}장 · 이베이 ${slab하루.ebay}번(오늘 누적).`,
  )
}

const CARD_HISTORY_DIR = dataFile('card-history')
/** 이레가 지나면 다시 묻는다. */
const 기록다시묻기 = 7 * 24 * 60 * 60 * 1000
/** 한 등급에 남길 점의 최대 개수(하루 한 점이면 2년치). 넘으면 오래된 것부터 버린다. */
const 기록점최대 = 730
/**
 * 한 등급에 남길 낱개 낙찰 개수.
 * ⚠️ 처음에 30건으로 뒀다가 줄였다 — 실물을 재 보니 **낱개가 한 장 덩치의 70%**였고
 *    (제목이 평균 72자다) 화면에는 등급당 몇 건만 보인다. 5건이면 화면에 쓰고도 남는다.
 */
const 기록낱개최대 = 5
/**
 * 쌓아 둘 카드 수의 천장.
 *
 * ⚠️⚠️ **2026-08-15에 6,000 → 21,000으로 올렸다.** 등급 자료가 있는 카드가 20,197장인데,
 *    낙찰가 점검(위 「값 고침표」)을 하려면 **전부 손에 있어야** 한다 — 6,000이면 받는
 *    족족 앞엣것이 지워져 전수 점검 자체가 안 된다(사장님 지시).
 *
 * ⚠️ **처음 6,000으로 잡은 근거가 틀렸었다.** 한 장을 21KB로 짐작했는데 실물로 재니
 *    **11.8KB**였다(821장 = 9.7MB). 20,197장이면 약 238MB이고 `/data`는 974MB 중
 *    537MB를 써서 370MB가 남는다 — **디스크는 넉넉하다.** 짐작한 숫자를 근거로
 *    한도를 박아 두면 나중에 그 한도가 일을 막는다.
 *
 * ⚠️⚠️⚠️ **2026-08-22에 21,000 → 40,000으로 올렸다. 천장이 승격 장수보다 낮으면
 *    배포할 때마다 조용히 지워진다.** 승격이 24,109장(곁 카드 포함)을 굽는데 천장이
 *    21,000이라, 부팅 때 도는 `기록정리`가 **먼저 구운 5,218장을 오래된 순으로 지웠다**
 *    — 낱개 낙찰과 우리가 다시 센 값이 그 카드들에서 통째로 사라졌다. 오류도 안 나고
 *    화면은 저쪽 덤프 값으로 조용히 되돌아가 있었다(사장님이 「낱개가 없다」로 잡음).
 *    → **승격 장수를 늘리면 이 숫자부터 본다.** 지금 잣대는 「승격 장수 + 방문자가 여는
 *    몫」이다(24,109 + 여유).
 *
 * ⚠️ **처음 6,000으로 잡은 근거가 틀렸었다.** 한 장을 21KB로 짐작했는데 실물로 재니
 *    **11.8KB**였다(821장 = 9.7MB). 짐작한 숫자를 근거로 한도를 박아 두면 나중에 그
 *    한도가 일을 막는다. 2026-08-22 재측정은 **8.2KB**다(18,902장 = 154.8MB) —
 *    40,000장이면 약 330MB이고 `/data`는 5GB 중 1.8GB가 남아 있다. 넉넉하다.
 *
 * ⚠️ 넘으면 **제일 오래 안 본 카드부터** 버린다(다시 열면 3크레딧으로 다시 받으면 된다).
 *    파일 시각(mtime)이 곧 「마지막으로 받은 때」라 그게 그대로 잣대가 된다.
 * ⚠️ **백업에는 안 담긴다** — `backupDataFiles`가 최상위 `.json`만 복사하므로 폴더는
 *    안 딸려간다(확인함 2026-08-12). 담기면 7일치가 곱해져 볼륨이 터진다. 잃어도
 *    다시 받으면 그만이라 안 담는 게 맞다(`card-names.json`을 뺀 것과 같은 판단).
 */
const 기록카드최대 = 40_000

/** 값에 붙은 긴 소수를 자른다. `1128.3333333333333`을 그대로 적으면 자리만 먹는다. */
const 값다듬 = (n: number) => Math.round(n * 100) / 100

const 기록길 = (id: string) => path.join(CARD_HISTORY_DIR, `${id}.json`)

// ── 값 고침표 ────────────────────────────────────────────────────────────
// ⚠️⚠️ **저쪽(PPT)이 낙찰가를 틀리게 주는 일이 있다.** 2026-08-15에 사장님이 찾으셨다 —
//    `/e/475445`(메타몽 GG22) PSA 10에 **9,900원**이 찍혀 있었다. 그 매물 링크를 열어
//    보니 이베이에는 **SOLD US $749.99**라고 적혀 있는데, 저쪽이 우리에게 보낸 값은
//    `"price": 7`이었다. 사기 매물도 아니고 딴 카드도 아니다 — **값 하나만 틀렸다.**
//
// 여기에 적어 두면 저쪽에서 받을 때마다 그 값을 갈아 끼운다. 이베이 매물에 적힌
// 값으로 고치는 것이라 **우리 판단이 들어갈 자리가 없다** — 근거가 매물 그 자체다.
// (「저쪽이 뺀 것만 뺀다」는 규칙과 다른 일이다. 그건 뺄지 말지를 정하는 것이고,
//  이건 틀린 값을 사실로 바로잡는 것이다.)
//
// ⚠️ **파일만 고쳐서는 안 되는 이유가 이것이다.** `점잇기`가 `{...옛, ...새}`라 새로 받은
//    값이 이긴다 — `/data/card-history/<번호>.json`을 손으로 고쳐 놔도 이레 뒤 다시 받을 때
//    저쪽 값으로 되돌아간다. 그래서 **받는 자리에서** 갈아 끼워야 한다.
//
// ⚠️ 배포 없이 고칠 수 있어야 한다(매물 확인은 사람이 크롬으로 하는 일이라 수시로 는다).
//    그래서 파일 시각(mtime)을 보고 바뀌었으면 다시 읽는다.
const PRICE_FIX_FILE = dataFile('price-fixes.json')
type 값고침 = {
  /** 이베이 매물에 적힌 진짜 값(USD). */
  p: number
  /** 저쪽이 보냈던 틀린 값. 그래프 점을 고칠 때 이 값과 같은 날만 건드린다. */
  was?: number
  /** 확인한 날(YYYY-MM-DD). */
  at?: string
  /**
   * **이 카드 것이 아니라서 아예 안 담는다.**
   *
   * ⚠️ 값이 틀린 것과 **다른 문제**다. 저쪽은 포켓몬 이름으로 낙찰을 뭉쳐 보내서
   *    「강챙이」 한 칸에 스카이릿지·익스페디션·네오 디스커버리 강챙이가 다 들어온다.
   *    값을 고쳐 놓으면 오히려 더 나빠진다 — $15일 땐 그냥 이상한 값이었는데
   *    $860이 되면 **그 카드가 정말 $860에 팔린 것처럼 보인다**(2026-08-15 실측).
   *
   * ⚠️⚠️ **매물을 눈으로 확인한 것만 적는다.** 제목의 번호로 기계가 가리게 했더니
   *    「Pikachu 004(SV-P)」를 **4번이 아니라 1번 카드로** 보냈다(앞의 0 때문이다).
   *    겹친 매물 437건 중 150건이 그 잣대에 걸렸는데 그대로 지웠으면 멀쩡한 것이 날아갔다.
   *    옛 길의 `딴카드거르기`가 진짜 $773 낙찰을 세트명 때문에 뺐던 것과 같은 함정이다.
   */
  drop?: boolean
  /** 제자리 카드의 저쪽 번호(되짚기용). */
  home?: string
  /** 어느 카드·어느 등급칸에서 나온 낙찰인지(되짚기용). */
  card?: string
  g?: string
  /** `drop`한 까닭을 사람 말로(되짚기용). */
  why?: string
}
let 값고침표: Map<string, 값고침> = new Map()
let 값고침시각 = -1
async function 값고침읽기(): Promise<Map<string, 값고침>> {
  try {
    const st = await stat(PRICE_FIX_FILE)
    if (st.mtimeMs === 값고침시각) return 값고침표
    const j = JSON.parse(await readFile(PRICE_FIX_FILE, 'utf-8')) as Record<string, 값고침>
    const 표 = new Map<string, 값고침>()
    for (const [id, v] of Object.entries(j ?? {})) {
      // 안 담을 것(`drop`)은 값이 없어도 된다 — 값을 고치는 게 아니라 빼는 것이라서.
      if (v && (v.drop || (Number.isFinite(v.p) && v.p > 0))) 표.set(String(id), v)
    }
    값고침표 = 표
    값고침시각 = st.mtimeMs
    console.log(`[pokegre] 값 고침표 ${표.size}건을 읽었습니다.`)
  } catch {
    // 파일이 없는 게 정상이다(고칠 게 없으면 안 만든다).
    값고침표 = new Map()
    값고침시각 = -1
  }
  return 값고침표
}

/**
 * 저쪽 응답의 낙찰가를 고침표대로 갈아 끼운다. **아무것도 읽기 전에** 부른다.
 *
 * 낱개·그래프·다시 세기가 모두 이 응답을 재료로 쓰므로, 여기서 한 번 고치면 세 곳이
 * 같이 맞는다.
 *
 * ⚠️ **그래프는 그날 값이 틀린 값과 같을 때만 고친다.** 저쪽이 주는 그래프 점은 「그날
 *    팔린 것들의 평균」이라 매물 하나에 1:1로 안 붙는다. 그날 한 건만 팔렸으면 점이 곧
 *    그 값이고(우리가 찾은 경우가 이것이다), 여러 건이면 평균이라 함부로 못 바꾼다.
 *    **모르는 것은 안 건드린다.**
 */
function 값고침적용(카드: RawPriceTrackerCard, 표: Map<string, 값고침>, 이카드: string): { 고친수: number; 뺀수: number } {
  if (!표.size) return { 고친수: 0, 뺀수: 0 }
  // ⚠️⚠️ **`drop`은 적어 둔 그 카드에서만 뺀다.** 저쪽은 같은 매물을 **여러 카드에** 준다
  //    (이름으로 뭉치기 때문이다 — 강챙이 한 매물이 우리 카드와 스카이릿지 강챙이 양쪽에
  //    들어와 있었다). 매물번호만 보고 빼면 **제자리 카드에서도 같이 사라진다.**
  const 뺄까 = (고침: 값고침 | undefined) => !!고침?.drop && (!고침.card || 고침.card === 이카드)
  let 고친수 = 0
  let 뺀수 = 0
  const 고친날: Record<string, Map<string, 값고침>> = {}
  for (const [등급, 목록] of Object.entries(카드.ebay?.soldListings ?? {})) {
    if (!목록) continue
    // ⚠️ **이 카드 것이 아닌 낙찰을 먼저 걷어낸다.** 값을 고치기 전에 해야 한다 —
    //    안 그러면 딴 카드 낙찰에 제 값을 채워 넣어 더 그럴듯하게 보이게 만든다.
    const 남길 = 목록.filter((s) => !뺄까(표.get(String(s?.listingId ?? ''))))
    뺀수 += 목록.length - 남길.length
    목록.length = 0
    목록.push(...남길)
    for (const s of 목록) {
      const 고침 = 표.get(String(s?.listingId ?? ''))
      if (!고침 || 고침.p == null) continue
      const 옛값 = Number(s.price)
      if (옛값 === 고침.p) continue
      s.price = 고침.p
      고친수++
      const 날 = String(s?.soldDate ?? '').slice(0, 10)
      if (날) ((고친날[등급] ??= new Map())).set(날, { ...고침, was: 고침.was ?? 옛값 })
    }
  }
  // 그래프 점도 같이 — 그날 점이 틀린 값 그대로일 때만.
  for (const [등급, 날들] of Object.entries(고친날)) {
    const 줄 = 카드.ebay?.priceHistory?.[등급]
    if (!줄) continue
    for (const [날, 고침] of 날들) {
      const 점 = 줄[날]
      if (!점) continue
      const 이전 = Number(점.average)
      if (!Number.isFinite(이전) || 고침.was == null) continue
      if (Math.abs(이전 - 고침.was) > 0.011) continue // 그날 여러 건이 섞인 점이다 — 안 건드린다
      점.average = 고침.p
    }
  }
  return { 고친수, 뺀수 }
}

async function 카드기록읽기(id: string): Promise<카드기록 | null> {
  try {
    return JSON.parse(await readFile(기록길(id), 'utf-8')) as 카드기록
  } catch {
    return null
  }
}

async function 카드기록쓰기(id: string, 기록: 카드기록) {
  try {
    await mkdir(CARD_HISTORY_DIR, { recursive: true })
    await writeJsonFile(기록길(id), 기록)
  } catch (e) {
    console.log(`[pokegre] 카드 추이 저장 실패(${id}): ${String(e).slice(0, 60)}`)
  }
}

/** 천장을 넘으면 오래된 것부터 지운다. 기동할 때와 여섯 시간마다 한 번씩만 돈다. */
let 기록정리중 = false
async function 기록정리() {
  if (기록정리중) return
  기록정리중 = true
  try {
    const 이름들 = await readdir(CARD_HISTORY_DIR).catch(() => [] as string[])
    const 것들 = 이름들.filter((f) => f.endsWith('.json'))
    if (것들.length <= 기록카드최대) return
    const 잰것: { f: string; t: number }[] = []
    for (const f of 것들) {
      const st = await stat(path.join(CARD_HISTORY_DIR, f)).catch(() => null)
      if (st) 잰것.push({ f, t: st.mtimeMs })
    }
    잰것.sort((a, b) => a.t - b.t)
    // 천장에 딱 맞추면 다음 한 장에 또 돈다 — 조금 넉넉히 지운다.
    const 지울것 = 잰것.slice(0, Math.max(0, 잰것.length - Math.floor(기록카드최대 * 0.9)))
    for (const x of 지울것) await rm(path.join(CARD_HISTORY_DIR, x.f)).catch(() => undefined)
    if (지울것.length) console.log(`[pokegre] 카드 추이 ${지울것.length.toLocaleString()}장을 오래된 순으로 비웠습니다.`)
  } finally {
    기록정리중 = false
  }
}

/** 새로 받은 점을 **얹는다**(덮지 않는다). 같은 날짜는 새 값으로 갱신한다. */
function 점잇기(옛: Record<string, number> | undefined, 새: Record<string, number>): Record<string, number> {
  const 합 = { ...(옛 ?? {}), ...새 }
  const 날들 = Object.keys(합).sort()
  if (날들.length <= 기록점최대) return 합
  const 남길: Record<string, number> = {}
  for (const d of 날들.slice(-기록점최대)) 남길[d] = 합[d]
  return 남길
}

/** 낱개 낙찰을 잇는다. 같은 매물(주소)은 하나로 본다. */
function 낱개잇기(옛: 낱개낙찰[] | undefined, 새: 낱개낙찰[]): 낱개낙찰[] {
  // ⚠️⚠️ **같은 매물이면 「새로 셈한 것」이 이긴다.** 예전엔 옛것을 남겼는데, 그러면
  //    **이번에 새로 붙인 표시가 통째로 버려진다** — 2026-08-19에 실제로 겪었다.
  //    중국판 걷어내기를 넣고 20,272장을 다시 받았는데, 숫자는 맞게 빠졌으면서
  //    낱개의 「셈 제외 · 중국판」 딱지가 **25건 중 0건**이었다. 화면에는 $700짜리
  //    낙찰이 멀쩡히 보이는데 시세는 없는 꼴이 되어, 방문자가 우리를 못 믿게 된다.
  // ⚠️ **값이 뒤집힐 걱정은 없다.** 저쪽이 준 틀린 낙찰가는 이 함수에 오기 **전에**
  //    `값고침적용`이 이미 갈아 끼운다(러너가 확인한 값). 새것이 곧 고쳐진 값이다.
  // ⚠️ 옛것에만 있고 새 응답에 없는 낙찰은 **그대로 남는다**(겹칠 때만 새것이 이긴다).
  //    저쪽보다 우리 기록이 길어지는 것은 그 덕이라, 그 성질은 안 건드린다.
  const 본 = new Map<string, 낱개낙찰>()
  for (const x of [...(옛 ?? []), ...새]) {
    const 열쇠 = x.u || `${x.d}|${x.p}`
    본.set(열쇠, x)
  }
  return [...본.values()].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 기록낱개최대)
}

/**
 * 카드 한 장을 저쪽에 물어 추이·낱개를 받아 쌓는다. 이미 쌓아 둔 게 싱싱하면 안 묻는다.
 *
 * ⚠️ **`pptGate`를 반드시 거친다.** 429를 계속 내면 키가 정지된다(CLAUDE.md).
 * ⚠️ 크레딧 바닥선(방문자 몫)은 **안 건다** — 이건 방문자가 지금 보고 있는 카드라,
 *    바로 그 몫을 쓰라고 있는 것이다(`/api/local/card-prices`와 같은 판단).
 */
// ── 판정기에 넘길 도감 쪽 단서 둘 (2026-08-22 · 복각·변종 조사 뒤 사장님 승인) ────────
// ① 도장판 쌍둥이 말: 같은 세트·같은 번호에 「(포켓몬센터 한정)」「(… Stamped)」 같은 도장판 카드가
//    따로 있으면, 그 도장을 가리키는 말들. 일반판 칸에서 그 말이 든 낙찰을 쌍둥이 것으로 뺀다.
//    색인 한 벌당 한 번만 표를 만든다(2만 장 재분류에서 매번 훑으면 느리다).
// ② 리버스판 있음: 인쇄판 자료에 「Reverse Holofoil」과 다른 판이 둘 다 있는가.
let 도장표색인: CardIndex | null = null
let 도장표: Map<string, RegExp[]> = new Map()
function 도장쌍둥이말(색인: CardIndex | null, slug: string, no: string): RegExp[] {
  if (!색인) return []
  if (도장표색인 !== 색인) {
    도장표 = new Map()
    for (const r of 색인.rows) {
      const 이름 = `${String(r[8] ?? '')} ${String(r[2] ?? '')}`
      const m = 이름.match(/\(([^)]*?(?:한정|Stamp|Pokemon Center|Pokémon Center|Exclusive|Showcase)[^)]*)\)/i)
      if (!m) continue
      const 말 = 도장말뽑기(m[1])
      if (!말.length) continue
      const k = `${r[0]}|${String(r[1]).split('~')[0].replace(/^0+(?=\d)/, '')}`
      도장표.set(k, (도장표.get(k) ?? []).concat(말))
    }
    도장표색인 = 색인
  }
  return 도장표.get(`${slug}|${String(no).split('~')[0].replace(/^0+(?=\d)/, '')}`) ?? []
}
/** 도장판 자신이면 쌍둥이 규칙을 걸면 안 된다 — 이름에 도장 표시가 있는 카드인가. */
const 도장판자신 = (nameEn: string, name: string) =>
  /\(([^)]*?(?:한정|Stamp|Pokemon Center|Pokémon Center|Exclusive|Showcase)[^)]*)\)/i.test(`${nameEn} ${name}`)
function 리버스판있음(id: string): boolean | undefined {
  const 판들 = 인쇄판시세.get(String(id).split('~')[0])
  if (!판들) return undefined
  const keys = Object.keys(판들)
  return keys.some((k) => /reverse/i.test(k)) && keys.some((k) => !/reverse/i.test(k))
}

async function 카드기록받기(
  apiKey: string,
  id: string,
  판: 'japanese' | 'english',
  /**
   * 이레 검사를 건너뛰고 다시 받는다. **점검을 다시 돌릴 때만** 쓴다.
   * ⚠️ 기록 파일을 지우면 안 된다 — 쌓아 둔 추이(저쪽보다 긴 그래프)가 통째로 날아간다.
   *    그래서 지우는 대신 이 문으로 다시 받아 **이어 붙인다**.
   */
  강제 = false,
): Promise<카드기록 | null> {
  // ⚠️⚠️ **`~` 꼬리를 받아 준다.** 한 저쪽 번호를 여러 카드가 나눠 쓸 때 열쇠에 꼬리를
  //    붙이는데(`617410~zh`), 숫자만 받게 두면 **여기서 통째로 거부되어 아무 일도 안 하고
  //    돌아선다.** 그러면 그 카드는 기록 파일이 영영 안 생기고, 화면에는 우리가 고친 값이
  //    아니라 **덤프의 오염된 값**이 그대로 나간다(2026-08-19에 실제로 그렇게 나갔다 —
  //    AR 카드에 딴 카드 값 $51이 붙었다). 파일 이름으로도 안전한 글자만 받는다.
  if (!id || !/^\d+(~[A-Za-z0-9-]+)?$/.test(id)) return null
  const 있는것 = await 카드기록읽기(id)
  // ⚠️⚠️ 곁 카드(`~1st`·`~lang`)는 저쪽에 다시 묻지 않는다(사장님 지시 2026-08-20 곁 카드
  //    도감 등록). 저쪽엔 그런 상품이 없어 물으면 **부모 것이 통째로** 오고, 판정기는 그
  //    줄들을 부모 기준으로 갈라 곁 카드가 부모 줄로 도로 오염된다. 곁 카드의 자료는
  //    승격(검수 저장소 → card-history)만 굽는다.
  if (/~(1st|lang|rev)$/.test(id)) return 있는것
  if (!강제 && 있는것 && Date.now() - 있는것.at < 기록다시묻기) return 있는것
  if (!apiKey) return 있는것
  if (!pptGate().ok) return 있는것
  try {
    const p = new URLSearchParams({
      // ⚠️⚠️ **저쪽에는 `~` 앞 번호로 묻는다.** 우리는 한 저쪽 번호를 여러 카드가
      //    나눠 쓸 수 있어(`617410` ↔ `617410~zh`) 열쇠에 꼬리를 붙이는데, 저쪽에는
      //    그런 번호가 없다. 꼬리째 물으면 **0건이 오고 값이 통째로 사라진다.**
      tcgPlayerId: id.split('~')[0],
      language: 판,
      limit: '1',
      includeHistory: 'true',
      includeEbay: 'true',
      // 옛 길과 같은 값. 365점까지는 크레딧이 안 늘어난다(2026-08-07 실측).
      days: '1095',
      maxDataPoints: '365',
    })
    const r = await fetch(`${PRICE_TRACKER_ORIGIN}/cards?${p}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    notePpt(r.status, r.headers)
    if (!r.ok) return 있는것
    const j = (await r.json()) as { data?: unknown }
    const 카드 = (Array.isArray(j.data) ? j.data[0] : j.data) as RawPriceTrackerCard | undefined
    if (!카드) return 있는것

    // ⚠️ **아무것도 읽기 전에** 틀린 낙찰가를 갈아 끼운다(위 `값고침적용` 주석 참고).
    //    낱개·그래프·다시 세기가 다 이 응답을 재료로 쓰므로 여기 한 곳이면 된다.
    const { 고친수, 뺀수 } = 값고침적용(카드, await 값고침읽기(), id)
    if (고친수 || 뺀수) {
      console.log(`[pokegre] 카드 ${id}: 낙찰가 ${고친수}건을 고치고 ${뺀수}건은 딴 카드 것이라 뺐습니다.`)
    }

    // ⚠️⚠️ **gx(우리가 다시 센 등급값)도 물려받는다.** 안 물려받으면 다시 받을 때마다
    //    사라져서, 되짚기에 안 걸린 칸은 덤프의 옛 섞인 값으로 되돌아간다 — 승격으로
    //    구운 잉어킹 PSA 10($22,500)이 한 번 다시 받자 $164로 돌아간 것이 이것이다
    //    (2026-08-20 실측). 아래 되짚기가 바뀐 칸만 새로 덮는다.
    const 기록: 카드기록 = {
      at: Date.now(),
      h: { ...(있는것?.h ?? {}) },
      s: { ...(있는것?.s ?? {}) },
      ...(있는것?.gx ? { gx: { ...있는것.gx } } : {}),
    }
    // ① 등급별 날짜별 낙찰 평균
    for (const [등급, 날들] of Object.entries(카드.ebay?.priceHistory ?? {})) {
      const 새: Record<string, number> = {}
      for (const [날, v] of Object.entries(날들 ?? {})) {
        const 값 = Number(v?.average)
        if (Number.isFinite(값) && 값 > 0) 새[String(날).slice(0, 10)] = 값다듬(값)
      }
      if (Object.keys(새).length) 기록.h![등급] = 점잇기(기록.h![등급], 새)
    }
    // ② 등급별 낱개 낙찰
    //
    // ⚠️⚠️ **저쪽이 제 셈에서 뺀 낙찰은 아예 안 담는다**(사장님 지시 2026-08-12:
    //    "저쪽이 이상하다고 판단된 기록만 빼줘 선으로 긋지말고 아예 제외").
    //    저쪽은 등급마다 **최저~최고 범위**를 같이 주는데, **건수는 전부 세고 값(평균·중앙)은
    //    그 범위 안의 것만으로 낸다.** 옛 길이 등급칸 2,669개를 맞춰 이 규칙을 확인했다.
    //    그래서 범위 밖을 그냥 두면 **목록의 값과 위의 평균이 안 맞는다** — 실측(2026-08-12,
    //    메가리자몽 X ex 110):
    //        BGS 9.5  범위 $537~$1,200 · 낱개 23건 평균 $1,088  ← $5,100 한 건 때문
    //                 범위 밖 1건 빼면 $906.00 = **덤프가 말하는 $906.01과 센트까지 같다**
    //        PSA 10   범위 밖 8건 빼면 $1,099.26 ✔ · PSA 9 4건 빼면 $622.19 ✔ · TAG 10 ✔
    // ⚠️ 범위를 안 주는 등급은 **거르지 않는다** — 모르는 잣대로 지우면 멀쩡한 기록이 사라진다.
    // ⚠️⚠️ **제목이 등급을 말하면 그 칸으로 옮겨 담는다** (2026-08-14).
    //    사장님이 「미감정에 psa10 매물이 들어있다」고 짚어 주셔서 찾았다. 실물:
    //    `/e/250323` 미감정 칸에 **"… Celebrations 15/82 PSA Gem 10" $99.99**가 들어 있었다.
    //    저쪽이 등급을 잘못 담아 보낸 것이라, 그대로 두면 눌러 들어간 사람이 미감정
    //    밑에서 PSA 10 매물을 본다.
    //    ⚠️ **`제목등급칸`은 이미 있던 함수다**(`src/lib/listingTitle.ts`). 주석에까지
    //       「이걸 안 넣으면 그 매물이 미감정 칸에 그대로 남는다」고 적혀 있는데, 옛 시세
    //       길을 지울 때(2026-08-13) 부르는 자리가 같이 사라져 **아무 데서도 안 쓰이고
    //       있었다.** 새로 만들 것이 아니라 다시 이어 붙이는 일이다.
    //    ⚠️ **드물다 — 흔한 문제로 오해하지 말 것.** 카드 35장을 받아 낱개를 전부 뒤졌더니
    //       어긋난 것은 그 한 카드뿐이었고, 쌓여 있던 2,188건 중에서는 10건(0.5%)이었다.
    //    ⚠️ **큰 숫자(건수·평균·시세)는 저쪽 것을 그대로 둔다.** 저쪽은 제 분류대로 셈했고
    //       우리는 그 칸의 낙찰을 5건만 들고 있어 다시 셀 수 없다. 여기서 바로잡는 것은
    //       **낱개가 어느 칸 밑에 보이느냐**뿐이다.
    //    ⚠️ 제목에 등급이 안 적힌 매물은 못 고친다 — 제목이 우리가 가진 유일한 단서다.
    const 옮길것: Record<string, 낱개낙찰[]> = {}
    // ⚠️⚠️ **저쪽이 보낸 낱개의 「날것」 개수**를 센다 — 범위 검사를 통과한 수가 아니다.
    //    저쪽은 **건수는 전부 세고 평균만 범위 안의 것으로** 낸다(CLAUDE.md). 그래서
    //    범위를 통과한 수와 저쪽 건수를 맞대면 **거의 늘 어긋나** 보이고, 그 탓에
    //    「다시 세기」가 54장 중 3장에서만 돌았다(2026-08-14 실측).
    const 받은수: Record<string, number> = {}
    let 옮긴수 = 0
    // 판이 달라 셈에서 뺀 낙찰 수(중국판). 지우는 게 아니라 **까닭을 적어 남긴다.**
    // ⚠️ 위쪽 `뺀수`(값고침표가 「딴 카드 것」이라 아예 안 담은 수)와 **뜻이 다르다.**
    //    저건 목록에서 사라지고, 이건 목록에 남되 셈에만 안 든다. 이름을 갈라 둔다.
    let 판다름수 = 0
    // 내 카드 자신이 중국판인가. 중국판 카드에서 중국판 낙찰을 빼면 값이 통째로 없어진다.
    const 내카드중국판 = 중국판세트(cardIndex?.rows.find((r) => r[7] === id)?.[0])
    // 한 저쪽 번호를 여러 카드가 나눠 쓰는 자리(`617410~zh`). 있으면 이 규칙이 먼저다.
    const 고르기 = 내낙찰고르기[id]
    // ⚠️⚠️ **미감정 칸만 사진을 읽는다.** 「미감정」은 저쪽이 등급을 못 읽었다는 뜻이라
    //    잘못 담기는 곳이 거기다. 감정 칸은 근거가 이미 둘(제목·저쪽 분류)이라 안 건드린다.
    const 사진판독 = 사진판독켬
      ? await 미감정사진읽기(환경, 카드.ebay?.soldListings?.ungraded ?? [])
      : new Map<string, string>()
    // ⚠️⚠️ **새 판정기(검수와 같은 잣대)를 받는 자리에 건다**(승격 · 사장님 승인 2026-08-20).
    //    안 걸면 이레 갱신 때 딴 세트·복각·딴 언어·1st Edition이 도로 섞인다 — 승격으로
    //    갈아 끼운 깨끗한 값이 이레 만에 다시 썩는다. 검수의 삭제 정책 그대로, 「든다」가
    //    아닌 낙찰은 이 카드에 안 담는다(1st Edition·기타 언어 몫은 검수 저장소가 든다).
    // ⚠️ **사장님 판정 기억(listing-verdicts.json)이 규칙보다 먼저다**(검수와 같은 차례).
    let 판정기억: Record<string, { x?: string; 칸?: string; 지움?: boolean }> = {}
    try { 판정기억 = JSON.parse(await readFile(dataFile('listing-verdicts.json'), 'utf-8')) } catch { /* 없으면 빈 것 */ }
    // ⚠️⚠️ `cardIndex` 변수를 그대로 보면 안 된다 — 색인을 아직 아무도 안 읽었으면 null이라
    //    판정기가 **통째로 건너뛰어진다**(2026-08-20 실측: 잉어킹 650건 중 1건만 버림 —
    //    그 1건도 판정 기억의 지움이었다). 반드시 읽어 온다(읽은 적 있으면 공짜다).
    const 판정색인 = cardIndex ?? (await loadCardIndex())
    const 판정색인줄 = 판정색인?.rows.find((r) => r[7] === id)
    const 판정저쪽번호 = String((카드 as { cardNumber?: unknown }).cardNumber ?? '')
    const 판정정보: 판정카드 | null = 판정색인줄
      ? {
          no: String(판정색인줄[1] ?? '').replace(/^#/, '').split('~')[0],
          total: 검수총표[id] ?? (판정저쪽번호.includes('/') ? 판정저쪽번호.split('/')[1].trim() : ''),
          setEn: String(카드.setName ?? ''),
          ed: String(판정색인줄[0]).split('-')[0],
          slug: String(판정색인줄[0]),
          nameEn: String(판정색인줄[8] ?? 판정색인줄[2] ?? ''),
          세트해: Number(String(판정색인?.sets[String(판정색인줄[0])]?.[2] ?? '').slice(0, 4)) || undefined,
          변형: 검수변형표[id],
          도장쌍둥이: 도장판자신(String(판정색인줄[8] ?? ''), String(판정색인줄[2] ?? ''))
            ? []
            : 도장쌍둥이말(판정색인, String(판정색인줄[0]), String(판정색인줄[1] ?? '')),
          리버스판있음: 리버스판있음(id),
          // 구판(번호 안 찍힌 1996~2001 일본 세트) — 다시짓기와 같은 잣대.
          구판: (() => {
            const 해 = Number(String(판정색인?.sets[String(판정색인줄[0])]?.[2] ?? '').slice(0, 4)) || undefined
            const 총 = 검수총표[id] ?? (판정저쪽번호.includes('/') ? 판정저쪽번호.split('/')[1].trim() : '')
            return String(판정색인줄[0]).startsWith('ja-') && !총 && 해 && 해 <= 2001
              ? { 인쇄번호: String(판정색인줄[11] ?? '') || undefined, 연도: 해 }
              : undefined
          })(),
        }
      : null
    let 판정지움 = 0
    for (const [등급, 목록] of Object.entries(카드.ebay?.soldListings ?? {})) {
      const 칸 = 카드.ebay?.salesByGrade?.[등급]
      // 소수점 끝자리가 어긋나는 일이 있어 아주 조금 여유를 준다(옛 길과 같은 폭).
      const 아래 = Number.isFinite(칸?.minPrice) ? (칸!.minPrice as number) * 0.999 : 0
      const 위 = Number.isFinite(칸?.maxPrice) ? (칸!.maxPrice as number) * 1.001 : Infinity
      받은수[등급] = (받은수[등급] ?? 0) + (목록?.length ?? 0)
      for (const s of 목록 ?? []) {
        const 값 = Number(s?.price)
        const 날 = String(s?.soldDate ?? '').slice(0, 10)
        if (!Number.isFinite(값) || 값 <= 0 || !날) continue
        // ⚠️ 범위 검사는 **원래 칸 기준**으로 한다. 「저쪽이 제 셈에서 뺀 것은 우리도 안
        //    담는다」가 이 검사의 뜻이라, 옮길 곳이 아니라 저쪽이 넣었던 칸으로 재야 맞다.
        // ⚠️⚠️ **판정기가 도는 카드는 범위 검사를 건너뛴다**(2026-08-20). 저쪽 범위는 섞인
        //    채로 계산된 것이라, 걸러낸 뒤에는 잣대가 못 된다 — 잉어킹 psa10의 **진짜
        //    $22,500 낙찰**이 셀레브 $160들로 잡힌 범위에 밀려 잘려 나갔다(실측). 검수
        //    파이프라인(사장님이 검사·승인)도 범위 검사 없이 판정기만 쓴다 — 잣대 한 벌.
        if (!판정정보 && (값 < 아래 || 값 > 위)) continue
        const 제목 = s.title || undefined
        // 판정 기억 → 판정기 차례(검수와 같다). 기억이 지운 것은 영구히 안 담고,
        // 기억이 없으면 판정기가 「든다」 아닌 것(딴 세트·복각·딴 언어·1st Ed·애매)을 버린다.
        const 판정itm = String(s.listingId ?? '')
        const 기억줄 = 판정itm ? 판정기억[판정itm] : undefined
        if (기억줄?.지움) { 판정지움++; continue }
        if (!기억줄 && 판정정보) {
          const 판 = 낙찰판정(제목 ?? '', 판정정보)
          if (판.자리 !== '든다') { 판정지움++; continue }
        }
        // ⚠️ 순서: **사진이 먼저**다. 미감정 칸은 제목에 등급이 없는 게 보통이라
        //    (그래서 미감정으로 분류됐다) 사진만이 근거다. `raw`면 진짜 미감정이니 그대로 둔다.
        const 사진칸 = 등급 === 'ungraded' ? (사진판독.get(String(s.listingId ?? '')) ?? '') : ''
        const 제목칸 = 제목 ? 제목등급칸(제목) : ''
        const 읽은칸 = 사진칸 && 사진칸 !== 'raw' ? 사진칸 : 제목칸
        // 기억이 칸을 정해 뒀으면 그것이 먼저다(사장님이 손으로 고친 칸).
        const 갈곳 = 기억줄?.칸 ? 기억줄.칸 : 읽은칸 && 읽은칸 !== 등급 ? 읽은칸 : 등급
        if (갈곳 !== 등급) 옮긴수++
        // ⚠️⚠️ **판이 다른 낙찰은 셈에서 뺀다**(중국판). 우리 카드는 전부 일본판·영문판이라
        //    중국판 낙찰은 어느 칸에 있든 딴 카드 값이다. **목록에서 지우지는 않는다** —
        //    까닭을 적어 두고 화면이 취소선으로 보여 준다. 나중에 밝혀지면 되살릴 수 있어야 한다.
        // ⚠️⚠️ **내 카드가 중국판이면 빼지 않는다.** 지금 우리 세트는 665개가 전부
        //    `ja-`·`en-`이라 걸릴 일이 없지만, 중국판 카드를 들이는 순간(캡틴피카츄 AR)
        //    이 검사가 없으면 **그 카드가 제 낙찰을 통째로 잃는다.** 나중에 붙이면
        //    늦는다 — 그때는 「값이 왜 없지」로 보이지 원인이 여기라고 안 보인다.
        // ⚠️⚠️ **고르는 규칙이 있으면 그게 먼저다.** 한 저쪽 번호를 여러 카드가 나눠 쓰는
        //    자리에서는 「중국판이냐」가 아니라 **「내 카드 것이냐」**가 잣대다.
        //    (캡틴피카츄 AR은 저 자신이 중국판이라 중국판 검사로는 아무것도 못 거른다.)
        // 기억이 뺀 까닭을 정해 뒀으면 그것이 먼저다. (중국판 검사는 색인에 없는 카드용
        // 뒷받침으로 남긴다 — 색인에 있는 카드는 위 판정기가 이미 걸렀다.)
        const 뺀까닭 = 기억줄?.x
          ? 기억줄.x
          : 고르기
            ? 고르기.맞나.test(제목 ?? '')
              ? ''
              : '다른 인쇄'
            : 내카드중국판
              ? ''
              : 중국어판낙찰(제목)
        if (뺀까닭) 판다름수++
        ;(옮길것[갈곳] ??= []).push({
          p: 값다듬(값),
          d: 날,
          // ⚠️ 주소 꼬리(?nordt=true…)를 뗀다 — 낱개잇기가 주소로 겹침을 가려서, 꼬리가
          //    다르면 같은 매물이 두 줄 선다(잉어킹 $22,500이 실제로 두 번 섰다 · 2026-08-20).
          //    검수 길(split('?')[0])과 같은 꼴로 맞춘다.
          u: (s.url || '').split('?')[0] || undefined,
          ...((s as { bestOfferAccepted?: unknown }).bestOfferAccepted ? { bo: true } : {}),
          // ⚠️ 저쪽은 **소문자**로 보낸다(`auction` · `buy_it_now`). 예전엔 `'Auction'`과
          //    견줘서 **한 건도 안 맞았고, 경매로 팔린 것이 전부 「즉시구매」로 나갔다**
          //    (2026-08-15 실측: 메타몽 GG22 한 장만 262건 중 170건이 실제로는 경매).
          a: String(s.listingType ?? '').toLowerCase() === 'auction' || undefined,
          t: 제목,
          // 옮긴 것에는 **원래 칸**을 남긴다 — 나중에 「왜 여기 있나」를 되짚을 수 있어야 한다.
          ...(갈곳 !== 등급 ? { g0: 등급 } : {}),
          // 뺀 것에는 **까닭**을 남긴다. 「옮겼다」(g0)와 「뺐다」(x)는 다른 일이라 따로 적는다.
          ...(뺀까닭 ? { x: 뺀까닭 } : {}),
        })
      }
    }
    // ⚠️⚠️ **옮긴 게 있으면 그 칸들을 여기서 다시 센다.**
    //    사장님 지시: "제자리에 옮기고 그에 따라서 다시 시세를 적어주는 것".
    //    **이 자리에서만 할 수 있다** — 저쪽이 준 낙찰 목록이 통째로 손에 있는 지금뿐이고,
    //    저장할 때는 칸마다 5건으로 자르므로(`기록낱개최대`) 나중엔 다시 못 센다.
    //    ⚠️ 우리 셈이 저쪽 셈과 같다는 건 이미 검증돼 있다 — 카드 8장 · 등급칸 287개에서
    //       **평균이 센트까지 287/287 일치**했다(CLAUDE.md). 새 잣대를 만드는 게 아니다.
    //    ⚠️ **건드린 칸만** 다시 센다. 멀쩡한 칸까지 우리 값으로 바꾸면, 저쪽과 어긋나는
    //       자리가 쓸데없이 늘고 어디가 왜 다른지 되짚기 어려워진다.
    //    ⚠️ `smart`(저쪽의 「지금 시세」)는 **버린다.** 섞인 채로 만든 값이라 근거가 무너졌고,
    //       우리가 그 모델을 다시 만들 수는 없다. 화면은 `smartPrice`가 없으면 중앙값을
    //       쓰므로(`src/api/ebayPrices.ts`), 우리가 다시 센 중앙값이 나간다.
    // ⚠️⚠️⚠️ **저쪽이 낙찰을 다 보내 줬을 때만 다시 센다.**
    //    저쪽이 낙찰 목록을 추려서 보내면(예: 66건 중 20건) 우리 셈은 그 20건짜리가 되어
    //    **저쪽 값보다 더 틀린 값**이 된다. 그래서 칸마다 「범위를 통과한 건수」와 저쪽이
    //    말한 건수를 맞대 보고, **카드의 모든 칸이 딱 맞을 때만** 다시 센다.
    //    ⚠️ 한 칸이라도 어긋나면 **옮기기만 하고 숫자는 저쪽 것을 그대로 둔다** —
    //       낱개가 제자리로 가는 것만으로도 「미감정 밑에 PSA 10」은 없어진다.
    const 다알고있나 = Object.entries(카드.ebay?.salesByGrade ?? {}).every(
      ([칸이름, v]) => !(v?.count && v.count > 0) || (받은수[칸이름] ?? 0) === v.count,
    )
    const 바뀐칸 = new Set<string>()
    // ⚠️ **뺀 것이 있어도 다시 세야 한다.** 예전엔 옮긴 것만 보고 다시 셌는데, 그러면
    //    중국판을 빼 놓고도 **저쪽이 준 옛 값이 그대로 화면에 남는다**(뺀 티가 안 난다).
    if ((옮긴수 > 0 || 판다름수 > 0 || 판정지움 > 0) && 다알고있나) {
      // ⚠️ 판정기가 칸을 **통째로** 비웠으면 그 칸은 아래 되짚기에 안 걸린다(옮길것에 없어서).
      //    저쪽 옛 값이 시세인 척 남으니, 받았는데 하나도 안 남은 칸을 0건으로 적는다
      //    (아래 「0건으로 적는다」와 같은 까닭).
      if (판정지움 > 0)
        for (const 칸이름 of Object.keys(카드.ebay?.salesByGrade ?? {})) {
          if (옮길것[칸이름]?.length || !((받은수[칸이름] ?? 0) > 0)) continue
          기록.gx ??= {}
          기록.gx[칸이름] = { n: 0, avg: 0, med: 0 }
          바뀐칸.add(칸이름)
        }
      for (const [칸이름, 목록] of Object.entries(옮길것)) {
        const 원래 = 카드.ebay?.salesByGrade?.[칸이름]
        const 옮겨온것있나 = 목록.some((x) => x.g0)
        const 뺀것있나 = 목록.some((x) => x.x)
        const 빠져나간것있나 = 원래 != null && 목록.filter((x) => !x.g0).length !== (원래.count ?? 목록.length)
        if (!옮겨온것있나 && !빠져나간것있나 && !뺀것있나) continue
        // ⚠️⚠️ **뺀 것은 셈에서 제외한다.** 목록에는 그대로 남아 화면에 보이지만(취소선)
        //    건수·평균·중앙값에는 안 들어간다.
        const 값들 = 목록.filter((x) => !x.x).map((x) => x.p).sort((a, b) => a - b)
        // ⚠️⚠️ **한 건도 안 남았으면 「0건」으로 적는다 — `continue`로 넘기면 안 된다.**
        //    넘기면 저쪽의 옛 값이 살아남아, 전부 딴 판 낙찰인 칸이 멀쩡한 시세인 척한다
        //    (617410은 낙찰 35건 중 33건이 중국판이라 이 자리가 바로 걸린다).
        //    0건짜리 칸은 응답에서 통째로 걸러진다(아래 `grades` 만드는 자리).
        const 가운데 = !값들.length
          ? 0
          : 값들.length % 2
            ? 값들[(값들.length - 1) / 2]
            : (값들[값들.length / 2 - 1] + 값들[값들.length / 2]) / 2
        기록.gx ??= {}
        기록.gx[칸이름] = {
          n: 값들.length,
          avg: 값들.length ? 값다듬(값들.reduce((a, b) => a + b, 0) / 값들.length) : 0,
          med: 값다듬(가운데),
        }
        바뀐칸.add(칸이름)
      }
      // ⚠️⚠️ **그래프(h)도 우리 줄로 다시 그린다.** 위 ①이 부은 저쪽 날별 평균은 **거르기
      //    전** 값이라, 낱개·숫자를 다 걸러도 그래프에만 오염이 남는다(잉어킹 셀레브 실측
      //    2026-08-20). 걸러낸 것이 있는 판이면, 이 받기의 낱개로 날별 평균을 다시 내고
      //    **옛 파일의 h(①이 붓기 전 것)** 위에 얹는다 — ①의 오염 병합은 버려진다.
      for (const 칸이름 of new Set([...Object.keys(옮길것), ...Object.keys(카드.ebay?.salesByGrade ?? {})])) {
        const 날별: Record<string, number[]> = {}
        for (const x of (옮길것[칸이름] ?? []).filter((x) => !x.x)) (날별[x.d] ??= []).push(x.p)
        const 새h = Object.fromEntries(
          Object.entries(날별).map(([d, v]) => [d, 값다듬(v.reduce((a, b) => a + b, 0) / v.length)]),
        )
        기록.h ??= {}
        const 합친 = 점잇기(있는것?.h?.[칸이름], 새h)
        if (Object.keys(합친).length) 기록.h[칸이름] = 합친
        else delete 기록.h[칸이름]
      }
    }
    for (const [칸이름, 새] of Object.entries(옮길것)) {
      if (새.length) 기록.s![칸이름] = 낱개잇기(기록.s![칸이름], 새)
    }
    // ⚠️ **「옮겼다」와 「뺐다」를 갈라 적는다**(사장님 지시 2026-08-18). 셈이 맞는지
    //    되짚으려면 들어온 수·옮긴 수·뺀 수가 각각 보여야 한다.
    if (옮긴수 > 0 || 판다름수 > 0 || 판정지움 > 0)
      console.log(
        `[pokegre] 카드 ${id}: 낱개 낙찰 ${Object.values(받은수).reduce((a, b) => a + b, 0)}건 중 ` +
          `판정기로 ${판정지움}건을 버리고, ${옮긴수}건을 제목이 말하는 등급칸으로 옮기고, ${판다름수}건을 셈에서 뺐습니다 · ` +
          (다알고있나 ? `${바뀐칸.size}개 칸을 다시 셈함` : '저쪽이 낙찰을 다 안 보내 숫자는 그대로 둠'),
      )
    // ③ TCGplayer 추이 — **큰 숫자와 같은 상태**를 고른다(옛 길과 같은 규칙).
    const conditions = 카드.priceHistory?.conditions ?? {}
    const 쓴상태 =
      (카드.prices?.primaryPrinting ? 카드.variants?.[카드.prices.primaryPrinting]?.conditionUsed : null) ??
      Object.values(카드.variants ?? {})[0]?.conditionUsed ??
      null
    const 상태순서 = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged']
    const 있는상태 = Object.keys(conditions).filter((k) => (conditions[k].history?.length ?? 0) > 0)
    const 바라는 = 상태순서.find((c) => (쓴상태 ?? '').includes(c))
    const 고른상태 =
      (바라는 && 있는상태.includes(바라는) ? 바라는 : null) ??
      있는상태.find((k) => k.includes('Near Mint')) ??
      있는상태.sort((a, b) => (conditions[b].history?.length ?? 0) - (conditions[a].history?.length ?? 0))[0] ??
      null
    if (고른상태) {
      const 새: Record<string, number> = {}
      for (const pt of conditions[고른상태].history ?? []) {
        const 값 = Number(pt?.market)
        const 날 = String(pt?.date ?? '').slice(0, 10)
        if (Number.isFinite(값) && 값 > 0 && 날) 새[날] = 값다듬(값)
      }
      if (Object.keys(새).length) 기록.tcg = { c: 고른상태, h: 점잇기(있는것?.tcg?.h, 새) }
    } else if (있는것?.tcg) 기록.tcg = 있는것.tcg

    // ④ 감정 수량 — **덤프에 없을 때만** 받는다(있으면 목록 응답에 이미 실려 나간다).
    //    추이·낱개를 받는 이 한 번에 같이 묻고 같은 곳에 쌓는다 — 자리가 둘이면 갱신
    //    규칙도 둘이 되어 언젠가 어긋난다.
    // ⚠️⚠️ **갈라 담은 카드는 팝수를 아예 안 받는다.** 저쪽에 물을 때 꼬리를 떼고
    //    묻게 되어(`617410~zh` → `617410`) **통째 상품의 수**가 온다 — 화면에
    //    「감정 수량 1,718장」이 떴는데 그건 일본판 캡틴피카츄 것이었다(2026-08-19 실측).
    //    이 카드만의 팝수는 우리에게 없으므로 **안 보여 주는 것이 맞다.**
    if (!populationCache.has(id) && !내낙찰고르기[id]) {
      const 이미 = 있는것?.pop
      if (이미) 기록.pop = 이미
      else {
        const 것 = await 감정수량한판(apiKey, id, 판).catch(() => null)
        if (것) 기록.pop = 것
      }
    }
    if (기록.gx) 보정등급적기(id, 기록.gx)
    await 카드기록쓰기(id, 기록)
    return 기록
  } catch {
    return 있는것
  }
}

function mountCardBoard(app: Mountable, apiKey: string) {
  // ⚠️⚠️⚠️ **쪽을 나누지 않는다. 찾은 것을 다 준다.**
  //
  //    처음에 옛 길의 「12장씩 + 더 보기」를 그대로 옮겨 놨다가 두 번 지적받았다
  //    (2026-08-12 "왜 12장밖에 안나와?" → 100장으로 고침 → "더보기를 눌러도 12장이라는게
  //    문제야" → "베끼지말고 새걸로 처음부터 다시 하라고 했잖아").
  //    **옛 길이 쪽을 나눈 것은 한 쪽마다 크레딧 36이 나가고 저쪽이 12장씩만 주기 때문**이다.
  //    우리 파일만 읽는 이 길에는 그 이유가 **하나도** 남지 않는다 — 쪽 나누기 자체가 베낀 것이다.
  //
  //    ⚠️ 그래도 천장 하나는 있어야 한다. 두 글자만 쳐도 수천 장이 걸리고("er" 5,489장 ·
  //       "이" 3,540장 · 한 글자면 "a" 20,311장), 통째로 보내면 15MB에 타일 2만 개가 된다.
  //       이 천장은 **크레딧이 아니라 브라우저가 그릴 수 있는 양**이 정하는 것이라,
  //       걸리면 「몇 장까지만 보여 드린다」고 밝힌다. 진짜 카드 이름은 여기 안 걸린다
  //       (리자몽 125 · charizard 224 · 피카츄 367 — 전부 한 번에 다 나온다).
  const 낼수있는최대 = 2000

  // 목록 타일은 **등급을 딱 하나만** 보여 준다(`대표등급()` = 낙찰이 제일 많은 등급).
  // 그런데 카드 하나에 등급이 최대 17줄이라, 다 실어 보내면 **쓰지도 않을 것이 덩치의 83%**다.
  // 그래서 목록에는 대표 하나만 싣고, 카드를 누르면 그때 `?grades=` 로 전부 받아 온다
  // (크레딧 0 · 10ms). ⚠️ 화면이 쓰는 꼴(`EbayGradeStat`)은 목록·상세가 똑같아야 한다 —
  // 그래서 빚는 자리를 이 함수 하나로 모았다.
  const 등급빚기 = (등급: Record<string, GradeSale> | undefined) =>
    Object.entries(등급 ?? {})
      .map(([grade, g]) => ({
        grade,
        count: g.n,
        averagePrice: g.avg,
        medianPrice: g.med ?? g.avg,
        minPrice: 0,
        maxPrice: 0,
        marketTrend: null,
        lastSaleDate: null,
        smartPrice: g.smart ?? null,
        confidence: g.cf ?? null,
        // 덤프는 **셈해 둔 값만** 준다 — 날짜별 추이도 낱개 낙찰도 안 온다.
        // 빈 배열로 두면 화면이 그래프와 낱개 목록을 알아서 접는다(옛 캐시 응답과 같은 꼴).
        history: [],
        sales: [],
      }))
      // ⚠️ **낙찰 많은 등급 순.** 화면의 대표가(`대표등급`)가 「건수가 제일 많은 등급」을
      //    고르므로, 다른 잣대로 세우면 타일에는 PSA 10이 뜨는데 상세 맨 위에는 다른
      //    등급이 서서 **같은 카드가 두 값을 말하는 것처럼** 보인다. 미감정을 맨 위로
      //    올려 볼까 했으나 그래서 그만뒀다 — 형태를 맞추라는 지시이기도 하다.
      .sort((a, b) => b.count - a.count)

  // 세트 코드 → 그 세트들. 「M2 110」·「SV2a 201」처럼 코드로 찾을 때 쓴다.
  // ⚠️ **낱말이 딱 맞을 때만** 쓴다 — 부분 일치를 허용하면 "s1"이 "s10"에 걸린다
  //    (CLAUDE.md에 같은 함정이 적혀 있다). 그래서 Map으로 정확히 맞춘다.
  // 저쪽(PPT) 번호 → 우리 카드. **공유 링크(`/e/<번호>`)가 이걸로 카드를 찾는다.**
  // ⚠️ 예전엔 번호로 **저쪽에 이름을 물어봤다** — 크레딧이 나가서 하루 상한(500번)까지
  //    걸어 뒀고, 상한을 넘으면 카톡 미리보기에 카드 이름이 안 떴다. 우리 색인에 그 번호가
  //    57,344장 들어 있으니 **공짜로, 더 빨리** 찾을 수 있다.
  let 번호표: Map<string, { slug: string; n: string; name: string; ed: string }> | null = null
  const 저쪽번호표 = (idx: CardIndex) => {
    if (번호표) return 번호표
    번호표 = new Map()
    for (const r of idx.rows) {
      const [slug, n, name, , , , , tcg] = r as unknown as string[]
      if (!tcg || 번호표.has(tcg)) continue
      번호표.set(tcg, { slug, n, name, ed: idx.sets[slug]?.[1] ?? 'ja' })
    }
    return 번호표
  }

  let 코드표: Map<string, string[]> | null = null
  const 세트코드표 = (idx: CardIndex) => {
    if (코드표) return 코드표
    코드표 = new Map()
    // ⚠️⚠️ **붙임표·점을 뗀 꼴도 같이 넣는다.** 사진으로 찾기가 읽는 세트코드는
    //    **카드에 찍힌 그대로**라 「S-P」·「SM-P」인데, 우리 슬러그는 「ja-SP」·「ja-SMP」다.
    //    그 한 글자 때문에 「S-P 049/S-P」가 **0건**이었다(2026-08-16 실측 · 스캔 기록에
    //    남은 실제 검색어로 확인). 카드에 찍힌 꼴로 쳐도 찾아져야 한다.
    const 넣기 = (열쇠: string, slug: string) => {
      if (열쇠.length < 2) return
      const 있 = 코드표!.get(열쇠)
      if (있) { if (!있.includes(slug)) 있.push(slug) }
      else 코드표!.set(열쇠, [slug])
    }
    for (const slug of Object.keys(idx.sets)) {
      const c = slug.replace(/^(ja|en)-/, '').toLowerCase()
      넣기(c, slug)
      넣기(c.replace(/[-.]/g, ''), slug)
    }
    return 코드표
  }

  // ── 「이 카드 것이 아닌 것 같다」 판정 ──────────────────────────────────────
//
// 매물 제목만 보고 **후보**를 고른다. 지우는 게 아니라 사람이 읽을 목록을 만드는 것이다.
// 2026-08-16에 1,942건을 손으로 판정하면서 얻은 규칙을 그대로 옮겼다.
//
// ⚠️⚠️ **제목의 번호로 가리지 마라.** 「Pikachu 004(SV-P)」를 4번이 아니라 1번 카드로
//    보냈다(앞의 0 때문). 겹친 437건 중 150건이 그 잣대에 걸렸는데 그대로 지웠으면
//    멀쩡한 낙찰이 날아간다. 옛 길의 `딴카드거르기`가 진짜 $773 낙찰을 세트명 때문에
//    뺐던 것과 같은 함정이다.
const 비게임말: [RegExp, string][] = [
  [/\btopsun\b/i, '톱선(껌 카드)'],
  [/\bcarddass\b/i, '반다이 카드다스'],
  [/\bamada\b/i, '아마다 스티커'],
  [/\bmerlin\b/i, '멀린 스티커'],
  [/\buno\b/i, '우노'],
  [/\bplaying cards?\b/i, '플레잉 카드'],
  [/\bhanafuda\b/i, '하나후다'],
  [/\bold maid\b/i, '올드메이드'],
  [/\bdragon ?ball\b/i, '드래곤볼'],
  [/\bpanini\b/i, '파니니'],
  [/\btopps\b/i, '톱스'],
  [/\bmetazoo\b/i, '메타주'],
  [/\byu-?gi-?oh\b/i, '유희왕'],
  [/\bone piece\b/i, '원피스'],
  [/\bzukan\b/i, '주칸'],
  [/\bsticker/i, '스티커'],
  [/\bflipz?\b/i, '액션 플립즈'],
]
/** 제목에서 인쇄 연도를 뽑는다. 앞에 붙는 「Sold Aug 26, 2025」(팔린 날)는 뗀다. */
function 제목연도(t: string): number[] {
  const s = String(t || '').replace(/^\s*Sold\s+[A-Za-z]{3,9}\.?\s+\d{1,2},?\s*\d{4}\s*-?\s*/i, '')
  return [...new Set([...s.matchAll(/\b(19[9]\d|20[0-2]\d)\b/g)].map((m) => Number(m[1])))]
}
/** 걸리면 까닭을 돌려주고, 아니면 빈 문자열. */
function 딴카드의심(제목: string, 카드번호: string): string {
  const t = String(제목 || '')
  if (!t) return ''
  for (const [re, 이름] of 비게임말) if (re.test(t)) return '포켓몬 카드게임 아님: ' + 이름
  const idx = cardIndex
  if (!idx) return ''
  const 줄 = idx.rows.find((r) => r[7] === 카드번호)
  if (!줄) return ''
  const 세트 = idx.sets[줄[0]]
  if (!세트) return ''
  // ⚠️⚠️ **판(중국판) 검사는 연도보다 먼저 한다.** 아래 연도 검사는 프로모 세트와
  //    발매일 없는 세트를 통째로 건너뛰는데, **중국판이 제일 많이 섞이는 자리가 바로
  //    거기다**(무번호 프로모 세트는 이름에 「프로모」가 들어가고 발매일도 비어 있다).
  //    그래서 러너가 캡틴피카츄 낙찰을 세 건이나 열어 보고도 제목에 `CHINESE`·
  //    `GEM PACK VOL.5`가 적힌 것을 하나도 못 걸렀다(2026-08-18 실측).
  //    ⚠️ 우리 세트는 전부 `ja-`·`en-`이다 — 중국판 세트가 생기면 그 카드는 빼야 한다.
  const 중국어판 = 중국어판낙찰(t)
  if (중국어판 && !중국판세트(줄[0])) return `판이 다름: ${중국어판}`
  const 해 = Number(String(세트[2] || '').slice(0, 4))
  if (!해) return ''
  // ⚠️ 프로모·프리릴리즈 세트는 여러 해에 걸쳐 나와 세트 연도가 무의미하다.
  //    안 빼면 후보가 17,497건이 되고 표본 15개가 전부 헛것이었다(실측).
  const 이름 = String(세트[0] || '')
  if (/프로모|promo|prerelease|championship|리그|league/i.test(이름)) return ''
  const 해들 = 제목연도(t)
  if (!해들.length) return ''
  // ⚠️ 5년 넘게 벌어질 때만. 1~2년 차이는 재판·발매 지연으로 흔하다.
  if (해들.some((y) => Math.abs(y - 해) <= 4)) return ''
  // ⚠️ **여기 「제목에 우리 세트 영문 이름이 있으면 우리 카드」 검사가 빠져 있다.**
  //    색인이 세트 이름을 한글로만 들고 있어 영문 제목과 못 견준다. 그래서 이 목록에는
  //    「파는 사람이 연도를 잘못 적은 것」이 섞여 들어온다(2026-08-16 실측으로 배치당
  //    0~11건). 지우는 목록이 아니라 **사람이 읽을 후보**라 그대로 둔다 — 읽으면 바로
  //    갈린다(「2021 Southern Islands Wartortle #15/18」은 우리 카드가 맞다).
  return `연도 ${해들.join(',')} ↔ 우리 세트 ${해}`
}

// ── 낙찰가 점검용 목록 ────────────────────────────────────────────────────
  // 저쪽(PPT)이 낙찰가를 틀리게 주는 걸 이베이 원문과 맞대 보려면, **이베이 페이지에서
  // 돌아가는 스크립트가** 확인할 매물 목록을 받아 가야 한다(서버가 이베이를 직접 부르면
  // 403이다 — 위 「값 고침표」 절 참고).
  //
  // ⚠️ 그래서 이 자리만 **다른 출처에서 부를 수 있게**(CORS) 열어 둔다. 열쇠(`CHECK_TOKEN`)가
  //    맞을 때만 답한다 — 없으면 아예 꺼져 있는 것과 같다.
  // ⚠️ 내주는 것은 **매물번호·우리가 아는 값·카드번호·등급칸**뿐이다. 개인정보가 아니고
  //    이미 `/api/local/card-board`로 누구나 볼 수 있는 값이다.
  app.use('/api/local/check-queue', async (req, res) => {
    const 열쇠 = process.env.CHECK_TOKEN
    const q = new URL(req.url ?? '', 'http://x').searchParams
    res.setHeader('access-control-allow-origin', '*')
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-headers', '*')
      res.statusCode = 204
      res.end()
      return
    }
    // ⚠️⚠️ **우리 사이트 화면에서 부를 때는 열쇠가 필요 없다.**
    //    열쇠는 이 자리를 **다른 출처에도 열어 둔 것**(CORS) 때문에 두는 문지기다.
    //    그런데 이베이 탭은 우리 서버를 못 부르므로(이베이 CSP), 실제로 부르는 것은
    //    **pokegre.com에 띄운 「다리」 탭**이다 — 즉 우리 출처다. 그 탭에 열쇠를 넣으려면
    //    스크립트에 비밀을 적어 넣어야 하는데, 그건 하면 안 되는 짓이다(도구도 막는다).
    //    → 브라우저가 붙여 주는 `sec-fetch-site: same-origin`을 본다. 이 값은 **브라우저가
    //      직접 넣고 스크립트가 못 바꾸는 값**이라, 남의 사이트가 흉내 낼 수 없다.
    //    ⚠️ 서버 밖(curl·스크립트)에서 부를 때는 그 헤더가 없으므로 **여전히 열쇠가 필요하다.**
    const 우리화면 = String(req.headers['sec-fetch-site'] ?? '') === 'same-origin'
    if (!우리화면 && (!열쇠 || q.get('token') !== 열쇠)) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    // ── 확인 결과 받기 ──────────────────────────────────────────────────
    // 한 줄 = [매물번호, 상태, 이베이값, 우리값, 카드번호, 등급칸, 제목]
    //  · 「팔림」이고 값이 우리 것과 다르면 → 고침표에 넣고 쌓아 둔 기록도 바로 고친다
    //  · 그 밖(지워짐·미상·오류·값 같음)은 → 확인 끝 목록에만 넣는다(다시 안 본다)
    // ⚠️ 「미상」은 안 고친다 — 안 팔리고 끝난 매물도 값이 보이는데 그건 호가다.
    //
    // ⚠️⚠️ **제목도 여기서 같이 본다**(2026-08-16에 고침). 처음엔 값만 쓰고 제목을 버려서
    //    **같은 매물을 두 번 훑었다** — 값 점검으로 한 번, 「딴 카드 섞임」 점검으로 또 한 번.
    //    사장님 지적: "어차피 가격 확인해보면서 까볼텐데 왜 그때 같이 검증 안하고".
    //    이제 한 번 열 때 값과 「이 카드 것이 맞나」를 같이 판정한다.
    if (req.method === 'POST') {
      try {
        // 한 번에 500줄쯤 보내므로 넉넉히 잡는다(기본 상한은 글쓰기용이라 작다).
        const 몸 = await readBody(req, 4 * 1024 * 1024)
        const rows = (JSON.parse(몸) as { rows?: unknown[] }).rows ?? []
        const 표 = JSON.parse(await readFile(PRICE_FIX_FILE, 'utf-8').catch(() => '{}')) as Record<string, 값고침>
        const 확인끝 = new Set<string>(
          JSON.parse(await readFile(dataFile('price-checked.json'), 'utf-8').catch(() => '[]')),
        )
        const 고칠카드: Record<string, { itm: string; p: number; was: number; g: string }[]> = {}
        let 고침 = 0
        // 「이 카드 것이 아닌 것 같다」고 걸린 줄. 사람이 읽고 정하도록 따로 모아 둔다.
        const 의심 = JSON.parse(
          await readFile(dataFile('mix-candidates.json'), 'utf-8').catch(() => '[]'),
        ) as { itm: string; card: string; g: string; p: number; t: string; why: string }[]
        const 의심본것 = new Set(의심.map((x) => x.itm))
        let 새의심 = 0
        for (const r of rows as [string, string, number | null, number, string, string, string][]) {
          const [itm, 상태, 값, 우리, card, g, 제목] = r
          if (!itm) continue
          if (상태 === '팔림' && Number.isFinite(값) && (값 as number) > 0 && Math.abs((값 as number) - 우리) > 0.011) {
            표[itm] = { p: 값 as number, was: 우리, at: kstDateStr(), card, g }
            ;(고칠카드[card] ??= []).push({ itm, p: 값 as number, was: 우리, g })
            고침++
          } else 확인끝.add(itm)
          // ⚠️ 값과 **같은 자리에서** 「이 카드 것이 맞나」도 본다. 여기서 안 보면 같은
          //    매물을 나중에 또 열어야 한다(그 실수를 이미 한 번 했다).
          if (제목 && !표[itm]?.drop && !의심본것.has(itm)) {
            const 왜 = 딴카드의심(제목, card)
            if (왜) {
              의심.push({ itm, card, g, p: 우리, t: String(제목).slice(0, 70), why: 왜 })
              의심본것.add(itm)
              새의심++
            }
          }
        }
        if (새의심) await writeJsonFile(dataFile('mix-candidates.json'), 의심)
        // 쌓아 둔 기록도 그 자리에서 고친다(그래프 점은 그날 한 건뿐일 때만).
        for (const [id, 목록] of Object.entries(고칠카드)) {
          const p = 기록길(id)
          let j: 카드기록
          try { j = JSON.parse(await readFile(p, 'utf-8')) } catch { continue }
          for (const v of 목록) {
            for (const [칸, s] of Object.entries(j.s ?? {})) {
              for (const x of s) {
                if (!(x.u ?? '').includes('/itm/' + v.itm)) continue
                const 옛 = x.p
                x.p = v.p
                const 점 = j.h?.[칸]?.[x.d]
                if (점 != null && Math.abs(점 - 옛) < 0.011) j.h![칸][x.d] = v.p
              }
            }
          }
          await writeJsonFile(p, j)
        }
        await writeJsonFile(PRICE_FIX_FILE, 표)
        await writeJsonFile(dataFile('price-checked.json'), [...확인끝])
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ 받음: rows.length, 고침, 고침표: Object.keys(표).length, 확인끝: 확인끝.size }))
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
      return
    }
    const n = Math.min(20_000, Math.max(1, Number(q.get('n') ?? 5000) || 5000))
    const 건너 = Math.max(0, Number(q.get('skip') ?? 0) || 0)
    // ── 급한 것부터 보기 ──────────────────────────────────────────────────
    //
    // ⚠️⚠️ **거르는 게 아니라 순서다. 마지막 칸(`전부`)에 아무 조건이 없으므로 결국 다 본다**
    //    (사장님 확인 2026-08-16: "15달러 먼저 보더라도 마지막에는 결국 다른것들도 다 봐야해").
    //    순서를 바꿔도 안 꼬인다 — 진행은 「어디까지 갔나」가 아니라 **「무엇을 봤나」**
    //    (`price-checked.json`의 매물번호)로 적히고, 큐는 부를 때마다 그걸 빼고 처음부터
    //    다시 만든다. 커서가 없다(같은 요청을 두 번 하면 글자까지 같은 답이 온다).
    //    ⚠️ 단 `skip`은 순서에 기대므로 **급함을 바꿔 쓸 때 같이 쓰면 안 된다.**
    //
    // 왜 이 차례인가(2026-08-16 실측):
    //   · **$15**: 틀린 값의 90%가 정확히 $15였고, $15 낱개 50건을 까 보니 24건이 틀렸다.
    //     남은 3,272건 중 절반쯤이 틀렸다는 뜻이라, 전체 평균(0.35%)보다 **140배** 효율이다.
    //   · **헐값인데 상위 등급**: 등급 받은 카드가 $20 밑은 드물다. 22,934건.
    //   · 그 뒤로 헐값 전부 → 상위 등급 전부 → 나머지 전부.
    // ⚠️ 주소의 파라미터 **이름은 아스키여야 한다.** 「급함」으로 뒀더니 노드가 요청을
    //    아예 안 받고 **400**을 냈다(주소 줄에 날것 한글이 들어가서다). 이름만 `pri`다.
    const 급함 = (q.get('pri') ?? '').trim()
    const 상위등급 = new Set(['psa10','psa9','psa9_5','cgc10','cgc9_5','cgc9','bgs10','bgs9_5','bgs9','ace10','tag10','sgc10','sgc9_5'])
    const 급한가 = (p: number, 칸: string): boolean => {
      switch (급함) {
        case 'p15': return p === 15
        case '헐값상위': return p > 0 && p < 20 && 상위등급.has(칸)
        case '헐값': return p > 0 && p < 20
        case '상위': return 상위등급.has(칸)
        default: return true // 「전부」 — 조건 없음
      }
    }
    try {
      const 확인끝 = new Set<string>(JSON.parse(await readFile(dataFile('price-checked.json'), 'utf-8')))
      const 표 = JSON.parse(await readFile(PRICE_FIX_FILE, 'utf-8')) as Record<string, unknown>
      const 본 = new Set<string>()
      const 목록: [string, number, string, string][] = []
      let 지나침 = 0
      for (const f of await readdir(CARD_HISTORY_DIR)) {
        if (목록.length >= n) break
        let j: 카드기록
        try { j = JSON.parse(await readFile(path.join(CARD_HISTORY_DIR, f), 'utf-8')) } catch { continue }
        const id = f.replace('.json', '')
        for (const [칸, s] of Object.entries(j.s ?? {})) {
          for (const x of s) {
            const m = /itm\/(\d+)/.exec(x.u ?? '')
            if (!m) continue
            const itm = m[1]
            if (확인끝.has(itm) || 표[itm] || 본.has(itm)) continue
            본.add(itm)
            if (!급한가(Number(x.p) || 0, 칸)) continue
            if (지나침++ < 건너) continue
            목록.push([itm, x.p, id, 칸])
            if (목록.length >= n) break
          }
          if (목록.length >= n) break
        }
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ rows: 목록 }))
    } catch (e) {
      res.statusCode = 500
      res.end(String(e))
    }
  })

  // ── 이베이 「팔린 목록」을 직접 긁어 쌓는 자리 (2026-08-19) ──────────────────
  //
  // ⚠️⚠️ **왜 필요한가 — 저쪽(PPT)이 우리 천장이었다.** 캡틴피카츄 AR을 재 보니
  //    저쪽은 낙찰 **4건**(7월 중순 것)을 주는데 이베이엔 **49건**이 있었고,
  //    그래서 PSA 9가 **4.9만원**으로 나갔다(진짜는 **34.5만원** · 7배).
  //    저쪽이 이 카드를 마지막으로 본 게 8일 전이었다.
  //
  // ⚠️ **판단은 전부 여기서 한다.** 크롬 쪽 러너는 **쪽을 열어 줄을 뜯어 보내기만** 한다 —
  //    어느 카드 것인지 가리기·등급 읽기·환율은 서버가 한다. 잣대가 두 벌이면 반드시 어긋난다.
  // ⚠️ 러너와 같은 문지기를 쓴다(`sec-fetch-site: same-origin` 또는 `CHECK_TOKEN`).
  app.use('/api/local/scan-queue', async (req, res) => {
    const 열쇠 = process.env.CHECK_TOKEN
    const q = new URL(req.url ?? '', 'http://x').searchParams
    res.setHeader('access-control-allow-origin', '*')
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-headers', '*')
      res.statusCode = 204
      res.end()
      return
    }
    const 우리화면 = String(req.headers['sec-fetch-site'] ?? '') === 'same-origin'
    if (!우리화면 && (!열쇠 || q.get('token') !== 열쇠)) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    if (req.method === 'POST') {
      try {
        const 몸 = await readBody(req, 4 * 1024 * 1024)
        const { card, rows } = JSON.parse(몸) as { card?: string; rows?: { itm: string; t: string; krw?: number; usd?: number; d?: string; a?: boolean; bo?: boolean }[] }
        const id = String(card ?? '').trim()
        const idx = await loadCardIndex()
        const 줄 = idx?.rows.find((r) => r[7] === id)
        if (!id || !줄) { sendJson(res, 400, { error: '모르는 카드' }); return }
        const 환 = 지금환율()?.usdToKrw ?? 0
        const 번호 = 줄[1]
        const 담을것: Record<string, 낱개낙찰[]> = {}
        let 받음 = 0, 남띔 = 0, 값없음 = 0, 묶음뺌 = 0, 오퍼뺌 = 0
        for (const r of rows ?? []) {
          받음++
          if (!내낙찰인가(String(r.t ?? ''), 번호)) { 남띔++; continue }
          // ⚠️⚠️ **여러 장을 한꺼번에 판 매물은 한 장 값이 아니다.** 「3장 묶음 $900」이
          //    한 장 값으로 들어가면 세 배로 잡힌다. 옛 길이 쓰던 잣대를 그대로 쓴다.
          if (묶음인가(r.t)) { 묶음뺌++; continue }
          // ⚠️⚠️ **「Best offer accepted」는 적힌 값이지 판 값이 아니다.** 이베이가 깎아 준
          //    금액을 안 밝히므로, 그대로 담으면 **실제보다 비싸게** 잡힌다. 셈에서 뺀다.
          //    자료는 남긴다 — 나중에 판 값을 알 길이 생기면 되살릴 수 있어야 한다.
          const 값모름 = !!r.bo
          // ⚠️⚠️ **값은 달러로 되돌려 담는다.** 이베이가 원화로 보여 주는 것은 저쪽이
          //    **오늘 환율로 달러에서 바꾼 값**이라, 오늘 환율로 되돌리면 거의 그대로 온다.
          //    우리 자료는 전부 달러라 여기서 안 맞추면 한 칸에 두 통화가 섞여 중앙값이 깨진다.
          const usd = r.usd && r.usd > 0 ? r.usd : 환 > 0 && r.krw ? 값다듬(r.krw / 환) : 0
          if (!(usd > 0)) { 값없음++; continue }
          const 날 = 날짜읽기(String(r.d ?? ''))
          if (!날) { 값없음++; continue }
          // ⚠️⚠️ **감정 표기가 하나도 없으면 「미감정」이지 「확인 안 됨」이 아니다.**
          //    사장님이 매물을 직접 열어 사진에 슬랩이 없는 것까지 확인해 주셨다(2026-08-19).
          //    회사 이름은 있는데 등급을 못 읽은 것만 `ungraded`(확인 안 됨)로 둔다.
          const 제목 = String(r.t ?? '')
          const 칸 = 제목등급칸(제목) || (제목에감정사있나(제목) ? 'ungraded' : 'raw')
          ;(담을것[칸] ??= []).push({
            p: usd,
            d: 날,
            u: `https://www.ebay.com/itm/${String(r.itm ?? '').replace(/\D/g, '')}`,
            a: r.a || undefined,
            t: String(r.t ?? '').slice(0, 160),
            ...(값모름 ? { x: '깎아 판 값(Best Offer)' } : {}),
          })
        }
        const 기록 = (await 카드기록읽기(id)) ?? { at: Date.now() }
        기록.s ??= {}
        기록.gx ??= {}
        let 쌓음 = 0
        // ⚠️⚠️⚠️ **우리가 긁은 날짜 범위 밖의 옛 낙찰은 지우면 안 된다** (사장님 지적 2026-08-19:
        //    「저쪽이 주던 7월 값은 이제 안 쓰는 거야?」). **이베이는 팔린 목록을 90일만 보여 준다**
        //    (2026-08-19 실측: 쪽을 끝까지 넘기니 5/21~8/19 = 91일치에서 끊겼다).
        //    그보다 오래된 낙찰은 **이베이에도 없어서 우리는 영영 못 본다** — 저쪽(PPT)이 그때
        //    받아 둔 것이 유일한 기록이다. 갈아 끼우면 그게 통째로 날아간다.
        //    → **긁어 온 것 중 가장 옛 날짜를 경계로 삼는다.** 그 뒤쪽은 우리가 방금 본 것이
        //      진실이니 갈아 끼우고, 그보다 앞은 손대지 않고 남긴다.
        const 긁은가장옛 = Object.values(담을것).flat().reduce((a, x) => (a && a < x.d ? a : x.d), '')
        // ⚠️ 갈라 담은 카드는 예외 — 저쪽 자료가 **통째로 딴 카드 것**이라 옛것도 남길 가치가 없다
        //    (캡틴피카츄 617410 칸의 7월 $385·$395는 03/09와 0107/07, 아예 다른 카드였다).
        const 통째버림 = !!내낙찰고르기[id]
        const 남길옛낱개 = (칸: string) =>
          통째버림 || !긁은가장옛 ? [] : (기록.s![칸] ?? []).filter((s) => s.d < 긁은가장옛)
        const 남길옛점 = (칸: string) =>
          통째버림 || !긁은가장옛
            ? {}
            : Object.fromEntries(Object.entries(기록.h?.[칸] ?? {}).filter(([날]) => 날 < 긁은가장옛))
        for (const [칸, 새] of Object.entries(담을것)) {
          if (!새.length) continue
          쌓음 += 새.length
          // ⚠️⚠️ **긁은 것으로 그 칸을 통째로 갈아 끼운다 — 이어 붙이면 안 된다.**
          //    처음엔 옛 낱개에 이어 붙였는데, **건수와 목록이 어긋났다**(사장님 지적
          //    2026-08-19): CGC 10이 「1건」인데 목록에는 셈에 든 낙찰이 **2건** 보였다.
          //    까닭은 건수(`gx.n`)는 **이번에 긁은 것**으로 덮으면서 목록은 **옛것과 합쳤기**
          //    때문이다. 화면에 보이는 수와 셈이 다르면 그건 그냥 고장이다.
          //    → 긁은 것이 **지금 이베이에 보이는 전부**이므로, 건수·중앙값·목록을 **한 벌로**
          //      그것에서만 낸다. 옛 낱개는 이미 이베이에서 내려간 것이라 버려도 된다.
          //    ⚠️ 값이 오르는 카드에서는 **버리는 편이 더 정확하다** — 캡틴피카츄 CGC 10은
          //       7월 $385와 8월 $663이 섞여 있었는데, 지금 값은 8월 것이다.
          // ⚠️ 갈아 끼우는 것은 **긁은 범위 안**뿐이다. 그보다 옛것(저쪽만 가진 것)은 얹어 센다.
          const 합 = [...새, ...남길옛낱개(칸)]
          const 값들 = 합.filter((x) => !x.x).map((x) => x.p).sort((a, b) => a - b)
          오퍼뺌 += 새.filter((x) => x.x).length
          const 가운데 = 값들.length % 2 ? 값들[(값들.length - 1) / 2] : (값들[값들.length / 2 - 1] + 값들[값들.length / 2]) / 2
          기록.gx[칸] = { n: 값들.length, avg: 값다듬(값들.reduce((a, b) => a + b, 0) / 값들.length), med: 값다듬(가운데) }
          // ⚠️⚠️ **추이 그래프도 우리가 긁은 것으로 다시 그린다.** 안 그러면 **한 화면이
          //    두 가지 말을 한다** — 표는 8월 낙찰 21건인데 그래프는 저쪽이 준 7월 3점만
          //    그려 「변동이 적다」로 보였다(사장님 지적 2026-08-19).
          //    ⚠️ 점 하나는 **그날 팔린 것들의 평균**이다(저쪽이 주던 것과 같은 뜻).
          //    ⚠️ 셈에서 뺀 것(묶음·Best Offer)은 그래프에도 안 넣는다 — 잣대를 하나로 둔다.
          const 날별: Record<string, number[]> = {}
          for (const x of 새) if (!x.x) (날별[x.d] ??= []).push(x.p)
          기록.h ??= {}
          기록.h[칸] = {
            // 긁은 범위보다 앞선 점은 저쪽이 준 것 그대로 남긴다 — 그게 없으면 그래프가
            // 「우리가 긁기 시작한 날」부터 시작해 그 전 흐름이 통째로 사라진다.
            ...남길옛점(칸),
            ...Object.fromEntries(
              Object.entries(날별).map(([날, v]) => [날, 값다듬(v.reduce((a, b) => a + b, 0) / v.length)]),
            ),
          }
          // ⚠️⚠️ **보여 줄 5건은 「최신 5건」이다 — 받은 순서 앞 5건이 아니다.**
          //    저쪽 쪽이 대개 최신 순으로 오지만 그건 이베이 정렬에 기댄 것이라, 정렬이
          //    바뀌면 **아무 5건**이 조용히 올라온다. 날짜로 내림차순 세워 못 박는다
          //    (옛 길 `낱개잇기`가 하던 것과 같은 규칙 · 사장님 물음 2026-08-19).
          기록.s[칸] = [...합].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 기록낱개최대)
        }
        // ⚠️⚠️⚠️ **이번에 안 나온 칸은 지운다 — 안 지우면 옛 칸이 유령으로 남는다.**
        //    2026-08-19 실측: 규칙을 고쳐 「CGC 10 PRI」를 `cgcp10`(프리스틴)으로,
        //    감정사 표기 없는 것을 `raw`(미감정)으로 옮겼더니 **옛 칸이 그대로 남아**
        //    한 낙찰이 **두 칸에서 두 번** 세어졌다(`ungraded` 10건과 `raw` 7건이 같은
        //    매물들, `cgc10`과 `cgcp10`이 같은 $663 하나). 게다가 옛 `cgc10`에는 저쪽이
        //    주던 **딴 카드**(03/09·0107/07) 7월 낙찰 $38~$395가 그대로 붙어 있었다.
        //    → 칸을 하나씩 갈아 끼우는 것으로는 부족하다. **긁은 것이 이 카드의 전부**이므로
        //      카드를 통째로 이번 것으로 맞춘다(위 칸 갈아 끼우기와 같은 잣대다).
        //    ⚠️ 다만 쪽을 덜 읽었을 때 멀쩡한 값을 날리면 안 되니, **3건 넘게 건졌을 때만**
        //       지운다. 적게 걸린 것은 검색이 좁았을 수 있다.
        const 센것 = Object.values(담을것).reduce((s, v) => s + v.filter((x) => !x.x).length, 0)
        let 지운칸 = 0
        if (센것 > 3) {
          for (const 칸 of new Set([...Object.keys(기록.gx), ...Object.keys(기록.s), ...Object.keys(기록.h ?? {})])) {
            if (담을것[칸]?.length) continue
            // ⚠️ 여기도 **긁은 범위 밖은 남긴다**(위와 같은 잣대). 이 칸은 이번에 하나도 안
            //    나왔지만, 90일 창 밖의 옛 낙찰만 가진 칸일 수 있다 — 그건 지우면 안 된다.
            const 옛 = 남길옛낱개(칸)
            const 옛점 = 남길옛점(칸)
            if (옛.length) {
              const v = 옛.filter((x) => !x.x).map((x) => x.p).sort((a, b) => a - b)
              const 가 = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
              기록.gx[칸] = { n: v.length, avg: 값다듬(v.reduce((a, b) => a + b, 0) / v.length), med: 값다듬(가) }
              기록.s[칸] = 옛
              if (기록.h) 기록.h[칸] = 옛점
              continue
            }
            delete 기록.gx[칸]
            delete 기록.s[칸]
            if (기록.h) delete 기록.h[칸]
            지운칸++
          }
        }
        기록.at = Date.now()
        if (기록.gx) 보정등급적기(id, 기록.gx)
        await 카드기록쓰기(id, 기록)
        console.log(
          `[pokegre] 이베이 긁기(${id}): 받은 줄 ${받음} · 내 카드 ${받음 - 남띔 - 값없음} · ` +
            `남의 카드 ${남띔} · 묶음 ${묶음뺌} · 깎아 판 값 ${오퍼뺌} · 값·날짜 못 읽음 ${값없음} → ` +
            `${Object.keys(담을것).length}개 칸에 ${쌓음}건 쌓음 · 옛 칸 ${지운칸}개 지움`,
        )
        sendJson(res, 200, { 받음, 담음: 쌓음, 칸: Object.keys(담을것).length, 남띔, 값없음, 지운칸 })
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
      return
    }

    // ── 무엇을 긁을지 ─────────────────────────────────────────────────────────
    // ⚠️ **값나가는 카드부터.** 전부 돌 수는 없다(58,528장). 값이 큰 자리가 틀리면
    //    방문자에게 제일 아프다.
    // ⚠️ **영문 이름이 깨끗한 것만** — 이름 자리에 일본어가 든 카드가 1,312장 있는데
    //    그걸로 이베이를 찾으면 거의 안 나온다. 그 카드들은 따로 손봐야 한다.
    try {
      const n = Math.min(2000, Math.max(1, Number(q.get('n') ?? 200) || 200))
      const 최저값 = Math.max(0, Number(q.get('min') ?? 100) || 100)
      const 건너 = Math.max(0, Number(q.get('skip') ?? 0) || 0)
      const idx = await loadCardIndex()
      if (!idx) { sendJson(res, 200, { rows: [] }); return }
      const 값 = (id: string) => {
        let m = 0
        for (const v of Object.values(인쇄판시세.get(id) ?? {})) if (v.m > m) m = v.m
        for (const v of Object.values(ebayGradeCache.get(id) ?? {})) { const x = v.med ?? v.avg ?? 0; if (x > m) m = x }
        return m
      }
      const 목록: [string, string, string][] = [] // [저쪽번호, 영문이름, 번호]
      const 후보: { id: string; name: string; no: string; v: number }[] = []
      for (const r of idx.rows) {
        const id = r[7]
        const name = r[8] || r[2]
        const no = r[1]
        if (!id || !name || !no || no.startsWith('#')) continue
        if (/[^\x20-\x7E]/.test(name)) continue
        const v = 값(id.split('~')[0])
        if (v < 최저값) continue
        후보.push({ id, name, no, v })
      }
      후보.sort((a, b) => b.v - a.v)
      for (const c of 후보.slice(건너, 건너 + n)) 목록.push([c.id, c.name, c.no])
      sendJson(res, 200, { rows: 목록, 전체: 후보.length })
    } catch (e) {
      res.statusCode = 500
      res.end(String(e))
    }
  })

  // ── 【이베이 검수】 운영자 전용 — 새 판정기로 다시 분류한 것을 딴 저장소에 쌓는다 ──
  //
  // ⚠️⚠️⚠️ **사용자 화면과 완전히 분리된다**(사장님 지시 2026-08-19). 저장은
  //    `/data/ebay-check/<번호>.json` — 실제 화면이 읽는 `/data/card-history/`와 딴 폴더라
  //    **검사를 통과하기 전에는 방문자에게 한 글자도 안 나간다.** 통과한 카드를 실제 화면에
  //    옮기는 것(승격)은 다음 단계이고 사장님이 정한다.
  //
  // ⚠️ **판정은 `낙찰판정`(src/lib/listingJudge.ts) 한 벌이 한다.** 저쪽(PPT) 분류는
  //    등급칸조차 안 믿는다 — 35건 중 18건이 제목과 달랐다(2026-08-19 실측).
  //    등급은 `제목등급칸`으로 제목에서 다시 읽는다.
  //
  // ⚠️ **판정 기억**(`/data/listing-verdicts.json`)이 규칙보다 먼저다. 사장님 검사나
  //    사진 확인으로 확정된 매물은 다음 업데이트가 와도 그 자리로 간다(사장님 의도:
  //    「이미 분류한 데이터를 받으면 분류한 자리로」). 사람 판정 > 규칙.
  // 【승격】 진행 상황 — POST {승격:1}이 배경에서 돌며 여기 적는다(2만 장이라 답을
  // 기다리게 하면 브라우저가 끊는다). GET ?승격=1 로 들여다본다.
  let 승격상태: { 돌고있나: boolean; 함: number; 낙찰: number; 전체: number; 시작: number; 끝?: number; 오류?: string } | null = null
  //
  // 창구: GET ?list=1(목록) · GET ?id=(카드 한 장, 화면용) · POST {id}(받아서 분류) ·
  //       POST {itm, x|칸}(판정 기억 적기). 전부 운영자만.
  app.use('/api/local/ebay-check', async (req, res) => {
    // ⚠️ 로컬 개발에서는 카카오 로그인이 안 붙으므로 운영자 검사를 건너뛴다.
    //    Fly 위에서는 `FLY_APP_NAME`이 늘 설정되므로 배포판에서는 그대로 막힌다.
    const 로컬개발 = !process.env.FLY_APP_NAME
    if (!로컬개발 && !(await isAdminRequest(req))) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    const 검수폴더 = dataFile('ebay-check')
    const 기억파일 = dataFile('listing-verdicts.json')
    // 사장님이 낱개 밑에 적는 한 줄 메모(사장님 지시 2026-08-19: 「코멘트 달 수 있는
    // 한줄 메모칸」). 내(시세팀)가 한꺼번에 읽어 규칙·판정을 고치는 데 쓴다.
    const 메모파일 = dataFile('listing-comments.json')
    // 고친값: 같은 매물을 저쪽과 러너가 둘 다 갖고 있는데 값이 다르면, 러너 값(화면에서
    // 직접 읽음)으로 갈고 저쪽이 적었던 값을 여기 남긴다 → 화면에 「가격 고침」 표시.
    type 검수낱개 = { itm: string; p: number; d: string; u: string; a?: boolean; t: string; x?: string; 출처?: '러너'; 고친값?: number; bo?: boolean; sl?: string }
    type 검수기록 = {
      at: number
      id: string
      slug: string
      name: string
      nameEn: string
      setEn: string
      no: string
      total: string
      img: string
      요약: { 받음: number; 든수: number; 뺀수: number; 애매수: number }
      칸들: Record<string, 검수낱개[]>
    }
    // 판 규칙·총 장수 보충은 판정기 파일의 표를 그대로 쓴다 — 잣대 한 벌.
    const 변형표 = 검수변형표
    const 총표 = 검수총표
    const q = new URL(req.url ?? '', 'http://x').searchParams

    // 판 갈래 — 기타 언어 곁 카드와 중국어판 세트는 「기타 언어판」으로 간다.
    const 판구하기 = (기록: 검수기록) =>
      기록.id.endsWith('-lang') || 기록.slug.startsWith('zh-')
        ? 'other'
        : 기록.slug.startsWith('ja-') ? 'japanese' : 'english'

    // ── 【다시짓기】 저장된 낱개 전부를 지금 규칙으로 다시 갈라 부모/1st Edition 두 파일로 ──
    //
    // ⚠️⚠️ **1st Edition은 빼는 게 아니라 딴 카드로 옮긴다**(사장님 지시 2026-08-19:
    //    「바로 옆에 퍼스트 에디션 버전 카드를 다시 만들어서 거기에 넣어둬」).
    //    같은 카드지만 딴 값의 딴 물건이라, 취소선으로 버려 두면 그 판의 시세가 없다.
    //    부모 `<번호>.json` 옆에 `<번호>-1st.json`을 만들어 제 등급표·중앙값을 갖게 한다.
    // ⚠️ 세 길(저쪽 받기·러너 합류·재분류)이 **전부 이 함수로 끝난다** — 잣대 한 벌.
    async function 다시짓기(id: string) {
      const 부모파일 = path.join(검수폴더, `${id}.json`)
      const 부모 = JSON.parse(await readFile(부모파일, 'utf8')) as 검수기록
      const 곁이름들: [string, string][] = [
        // [파일 꼬리, 카드 이름 꼬리]
        ['-1st', ' · 1st Edition'],
        ['-lang', ' · 기타 언어'],
        ['-rev', ' · 리버스 홀로'],
        ['-25th', ' · 25주년 복각'],
        ['-auto', ' · 사인'],
      ]
      const 곁있던: 검수낱개[] = []
      for (const [꼬리] of 곁이름들) {
        try {
          곁있던.push(...Object.values((JSON.parse(await readFile(path.join(검수폴더, `${id}${꼬리}.json`), 'utf8')) as 검수기록).칸들).flat())
        } catch { /* 아직 없음 */ }
      }
      let 기억: Record<string, { x?: string; 칸?: string; 지움?: boolean }> = {}
      try { 기억 = JSON.parse(await readFile(기억파일, 'utf8')) } catch { /* 없으면 빈 것 */ }
      const 색인 = await loadCardIndex()
      const 세트해 = Number(String(색인?.sets[부모.slug]?.[2] ?? '').slice(0, 4)) || undefined
      // 구판(번호가 안 찍힌 1996~2001 일본 세트)이면 도감번호·연도를 판정기에 넘긴다.
      const 색인줄구판 = 색인?.rows.find((r) => r[7] === id)
      const 구판 =
        부모.slug.startsWith('ja-') && !부모.total && 세트해 && 세트해 <= 2001
          ? { 인쇄번호: String(색인줄구판?.[11] ?? '') || undefined, 연도: 세트해 }
          : undefined
      const 정보: 판정카드 = {
        no: 부모.no,
        total: 부모.total,
        setEn: 부모.setEn,
        ed: 부모.slug.split('-')[0],
        slug: 부모.slug,
        nameEn: 부모.nameEn,
        세트해,
        변형: 변형표[id],
        // 도장판 쌍둥이·리버스판 — 도장판 자신(이름에 도장 표시)에는 쌍둥이 규칙을 안 건다.
        도장쌍둥이: 도장판자신(부모.nameEn, 부모.name) ? [] : 도장쌍둥이말(색인, 부모.slug, 부모.no),
        리버스판있음: 리버스판있음(id),
        구판,
      }
      // 부모+곁을 한 풀에 붓고 매물 번호로 겹침을 없앤다(러너 것이 이긴다).
      const 풀 = new Map<string, 검수낱개>()
      for (const s of [...Object.values(부모.칸들).flat(), ...곁있던]) {
        const 있던 = 풀.get(s.itm)
        if (!있던 || (s.출처 === '러너' && 있던.출처 !== '러너')) 풀.set(s.itm, s)
      }
      const 갈래칸: Record<string, Record<string, 검수낱개[]>> = { 부모: {}, '-1st': {}, '-lang': {}, '-rev': {}, '-25th': {}, '-auto': {} }
      let 지운애매 = 0, 지운판매자 = 0, 지운딴카드 = 0
      // ── 가짜 낙찰가 거르기 (2026-08-24 · 사장님 지시 「터무니없는 값만」) ──────────
      // PPT의 새 수집분(웹페이지 긁기)에 값을 엉뚱한 자리에서 읽은 낙찰이 섞여 온다.
      // ① **자리표 값** — $9,999.99·$99,999·$999,999가 서로 다른 카드 수십 장에 똑같이
      //    붙어 있었다(42건 실측). 사람이 채워 넣은 빈칸 값이다.
      // ② **40만 달러 초과 + 그 카드 전체 중앙값의 100배 초과** — 몇십 달러짜리 애프룡에
      //    $945,576 같은 것(13건). 두 조건을 **같이** 거는 까닭: 언젠가 진짜 40만 달러
      //    낙찰(1st 베이스 리자몽급)이 나와도 그건 중앙값의 10~20배라 안 걸린다.
      // ⚠️ **지우지 않고 딱지(x)만 붙인다** — 셈·그래프에서는 빠지고, 검수 화면에는 남아
      //    사장님이 보고 되돌릴 수 있다. $10만~40만의 애매한 17건은 안 건드린다(따로 표로).
      // ⚠️ $0.01은 **아래쪽 자리표**다 — 피카츄 VMAX가 1센트에 팔렸을 리 없다(61건 실측).
      //    위쪽과 반대로 중앙값을 끌어내린다. 정확히 1센트인 것만 건다(싼 카드의 진짜
      //    1~2달러 낙찰은 안 다치게).
      const 자리표값 = new Set([0.01, 9999.99, 99999, 99999.99, 999999, 999999.99])
      const 값들전부 = [...풀.values()].map((s) => Number(s.p) || 0).filter((v) => v > 0).sort((a, b) => a - b)
      const 카드중앙 = 값들전부.length ? 값들전부[Math.floor(값들전부.length / 2)] : 0
      for (const s of 풀.values()) {
        // ⚠️ 차단 판매자(카드 아닌 물건 파는 사람)의 것은 통째로 버린다(사장님 지시 2026-08-19).
        if (s.sl && 차단판매자.has(s.sl.toLowerCase())) { 지운판매자++; continue }
        // ⚠️ 깎아 판 값 여부는 저장된 표시(bo)나 옛 까닭에서 되살린다 — 판정을 다시 해도 안 잃는다.
        const bo = s.bo === true || s.x === '깎아 판 값(Best Offer)'
        let 칸 = 제목등급칸(s.t) || (제목에감정사있나(s.t) ? 'ungraded' : 'raw')
        let x: string | undefined
        let 곳: '부모' | '-1st' | '-lang' | '-rev' | '-25th' | '-auto' = '부모'
        const 저장된 = 기억[s.itm]
        if (저장된?.지움) { 지운판매자 += 0; 지운애매 += 0; continue } // 사장님이 지운 매물 — 영구히 안 담는다
        if (저장된) {
          if (저장된.x) x = 저장된.x
          if (저장된.칸) 칸 = 저장된.칸
        } else if (자리표값.has(Number(s.p)) || (Number(s.p) > 400_000 && 카드중앙 > 0 && Number(s.p) / 카드중앙 > 100)) {
          // 위 「가짜 낙찰가 거르기」 — 딱지만 붙이고 제목 판정은 안 거친다(값이 문제지 카드가 문제가 아니다).
          x = '값 이상(가짜 낙찰가로 봄)'
        } else {
          const 판정 = 낙찰판정(s.t, 정보)
          if (판정.자리 === '뺀다' && 판정.왜 === '판 다름(1st Edition)') 곳 = '-1st'
          else if (판정.자리 === '기타언어') 곳 = '-lang'
          else if (판정.자리 === '복각25') 곳 = '-25th'
          else if (판정.자리 === '사인') 곳 = '-auto'
          else if (판정.자리 === '리버스') 곳 = '-rev'
          // ⚠️⚠️ **딴 카드로 확정된 것도 지운다**(사장님 지시 2026-08-20: 「딴 카드 섞임
          //    이런 건 왜 삭제 안 했어」). 처음엔 취소선+까닭으로 남겼는데(영수증), 딴 카드는
          //    애초에 이 카드 화면에서 볼 이유가 없다는 잣대다. 규칙은 이미 검사로 통과됐고,
          //    지워도 다시 긁으면 같은 규칙이 또 거른다.
          else if (판정.자리 === '뺀다') { 지운애매 += 0; 지운딴카드++; continue }
          // ⚠️⚠️ **애매(확인 대기)는 지운다** — 사장님이 스무 건을 직접 보시고 「거의 카드가
          //    아니다」라고 판정하셨다(2026-08-19). 보관하지 않는다 — 다시 긁으면 또 걸러진다.
          else if (판정.자리 === '애매') { 지운애매++; continue }
        }
        // ⚠️ Best Offer는 이제 **셈에 넣는다**(사장님 지시 2026-08-19: 「어쩔 수 없을 것
        //    같아. 그냥 베스트 오퍼라고 작게만 써 주고 가격은 그대로」). 부른 값이지만
        //    큰 차이가 안 나는 게 보통이라, 빼서 건수를 잃는 것보다 넣고 밝히는 쪽을 고르셨다.
        const 새줄: 검수낱개 = { ...s, ...(bo ? { bo: true } : {}), x: undefined, ...(x ? { x } : {}) }
        if (!x) delete 새줄.x
        ;(갈래칸[곳][칸] ??= []).push(새줄)
      }
      const 요약셈 = (칸들: Record<string, 검수낱개[]>) => {
        for (const 칸 of Object.keys(칸들)) 칸들[칸].sort((a, b) => (a.d < b.d ? 1 : -1))
        const 전부 = Object.values(칸들).flat()
        return {
          받음: 전부.length,
          든수: 전부.filter((s) => !s.x).length,
          뺀수: 전부.filter((s) => s.x).length,
          애매수: 0,
        }
      }
      부모.칸들 = 갈래칸['부모']
      부모.요약 = 요약셈(갈래칸['부모'])
      부모.at = Date.now()
      await writeFile(부모파일, JSON.stringify(부모))
      const 곁수들: Record<string, number> = {}
      for (const [꼬리, 이름꼬리] of 곁이름들) {
        const 칸들 = 갈래칸[꼬리]
        const 수 = Object.values(칸들).flat().length
        곁수들[꼬리] = 수
        const 곁파일 = path.join(검수폴더, `${id}${꼬리}.json`)
        if (수 > 0) {
          const 곁: 검수기록 = {
            ...부모,
            id: `${id}${꼬리}`,
            name: `${부모.name}${이름꼬리}`,
            nameEn: `${부모.nameEn}${이름꼬리}`,
            칸들,
            요약: 요약셈(칸들),
          }
          await writeFile(곁파일, JSON.stringify(곁))
        } else {
          try { await rm(곁파일) } catch { /* 없으면 그만 */ }
        }
      }
      return { 부모요약: 부모.요약, 첫판수: 곁수들['-1st'], 기타언어수: 곁수들['-lang'], 지운애매, 지운판매자, 지운딴카드 }
    }

    if (req.method === 'POST') {
      try {
        const 몸 = JSON.parse(await readBody(req, 4 * 1024 * 1024)) as {
          id?: string
          itm?: string
          x?: string
          칸?: string
          rows?: { itm: string; t: string; krw?: number; usd?: number; d?: string; a?: boolean; bo?: boolean; sl?: string }[]
          메모?: string
          redo?: number
          지움?: number
          승격?: number
          씨앗덮기?: number
          예열?: number
          최대?: number
        }
        // ── 【그림 예열】 전 카드 그림을 미리 받아 디스크에 담는다(사장님 지시 2026-08-21) ──
        if (몸.예열) {
          if (!그림예열) { sendJson(res, 500, { error: '그림 예열기가 아직 안 붙었습니다' }); return }
          if (예열상태?.돌고있나) { sendJson(res, 200, { 이미돌고있음: true, ...예열상태 }); return }
          sendJson(res, 200, { 시작: true })
          void 그림예열(몸.최대).catch((e) => {
            예열상태 = { ...(예열상태 ?? { 함: 0, 건너뜀: 0, 실패: 0, 전체: 0, 시작: Date.now() }), 돌고있나: false, 끝: Date.now() }
            console.log('[pokegre] 그림 예열 실패: ' + String(e))
          })
          return
        }
        // ── 【승격】 검수 저장소를 실제 화면 저장소로 굽는다 ─────────────────────────
        //
        // 검수를 통과한 2만 장을 **실제 화면이 읽는 자리**(card-history의 h·s·gx +
        // 보정등급)로 바꿔 넣는다(사장님 승인 2026-08-20). 낱개는 칸마다 최신 5건만
        // 저장하고(저장 5건 정책), 건수·평균·중앙값(gx)은 **전체 낙찰**로 센다.
        // ⚠️ `gx`는 읽는 자리에서 덤프 값을 덮는다 — 덤프가 새로 와도 안 되돌아간다.
        // ⚠️ **덤프에만 있는 칸은 0건으로 눌러 둔다.** 안 누르면 검수에 없던 칸에서
        //    옛 섞인 값이 시세인 척 되살아난다(「0건으로 적는다」와 같은 까닭).
        // ⚠️ 운영 서버에 검수 저장소가 없으면 배포 이미지의 씨앗(seed/ebay-check.tar.gz)을
        //    먼저 푼다 — 로컬에서 검수한 것을 이미지에 실어 보내는 길이다.
        // ⚠️ tcg(TCGplayer 추이)·pop(감정 수량)은 이베이와 딴 자료라 있던 것을 살린다.
        if (몸.승격) {
          if (승격상태?.돌고있나) { sendJson(res, 200, { 이미돌고있음: true, ...승격상태 }); return }
          const 씨앗 = path.join(process.cwd(), 'seed', 'ebay-check.tar.gz')
          const 있나 = await readdir(검수폴더).then((f) => f.some((x) => x.endsWith('.json'))).catch(() => false)
          if (!있나 && !existsSync(씨앗)) { sendJson(res, 500, { error: '검수 저장소가 비었고 씨앗(seed)도 없습니다' }); return }
          // ⚠️⚠️ **답부터 보내고 나머지는 전부 배경에서** — 씨앗 풀기(수십 초) 동안 단추가
          //    조용하면 또 누르게 되고, 그 사이 승격상태도 비어 있어 세 판이 겹쳐 돌았다
          //    (2026-08-21 운영 실측: 「승격 실행」이 19초 간격으로 세 번 눌림).
          승격상태 = { 돌고있나: true, 함: 0, 낙찰: 0, 전체: 0, 시작: Date.now() }
          sendJson(res, 200, { 시작: true })
          void (async () => {
            try {
          // ⚠️ **씨앗덮기** — 배포 이미지의 씨앗으로 검수 저장소를 갈아 끼우고 굽는다.
          //    처음 승격은 저장소가 비어 있을 때만 풀었는데, 그러면 로컬에서 새로 한 판정
          //    (조로아크 TAG 10 같은 것)이 운영에 영영 안 닿는다(2026-08-21에 겪음).
          //    단추는 늘 이걸 켠다 — 「검수한 대로 내보내기」가 단추의 뜻이라서.
          //    ⚠️ 운영 화면에서 직접 적은 판정 기억이 있다면 씨앗 것으로 덮인다(같은 파일).
          // ⚠️ 단계마다 걸린 시간을 남긴다 — 「4분이 어디로 가나」를 물었을 때 답할 게 없었다
          //    (2026-08-23). 골라 굽기 같은 걸 만들지 말지는 이 숫자를 보고 정한다.
          const 잰다 = Date.now()
          let 푼시간 = 0
          if ((!있나 || 몸.씨앗덮기) && existsSync(씨앗)) {
            await mkdir(path.dirname(검수폴더), { recursive: true })
            await new Promise<void>((resolve, reject) =>
              execFile('tar', ['xzf', 씨앗, '-C', path.dirname(검수폴더)], (e) => (e ? reject(e) : resolve())),
            )
            푼시간 = Date.now() - 잰다
            console.log(
              '[pokegre] 승격: 씨앗(seed/ebay-check.tar.gz)을 풀었습니다' + (있나 ? '(덮어씀)' : '') +
              ` — ${(푼시간 / 1000).toFixed(1)}초.`,
            )
          }
          const 굽기시작 = Date.now()
          // ⚠️⚠️ 맥에서 만든 tar에는 부스러기(`._*` AppleDouble)가 딸려 온다 — 처음 운영
          //    승격이 이걸 카드 파일로 읽다 죽었다("Mac OS X" 글자가 JSON일 리 없다 ·
          //    2026-08-20 실측). 걸러 내고, 씨앗은 COPYFILE_DISABLE=1 로 만든다.
          // ⚠️ 곁 카드(-1st·-lang)도 같이 굽는다(사장님 지시 2026-08-20 도감 등록) — 열쇠만
          //    색인과 같은 `~` 갈래로 바꾼다(`12345-1st` 파일 → `12345~1st` 카드).
          const 구울것 = (await readdir(검수폴더)).filter(
            (f) => f.endsWith('.json') && !f.startsWith('._') && !/-(25th|auto)\.json$/.test(f),
          )
          승격상태 = { ...(승격상태 as NonNullable<typeof 승격상태>), 전체: 구울것.length }
              await mkdir(CARD_HISTORY_DIR, { recursive: true })
              for (const f of 구울것) {
                // ⚠️ 파일 하나가 깨져도 전체가 서면 안 된다 — 목록 창구와 같은 잣대로 건너뛴다.
                let 검: 검수기록
                try { 검 = JSON.parse(await readFile(path.join(검수폴더, f), 'utf8')) as 검수기록 } catch { continue }
                // 곁 카드는 색인의 `~` 갈래 열쇠로 굽는다. 부모는 그대로.
                const 구울키 = 검.id.replace(/-(1st|lang|rev)$/, '~$1')
                const gx: NonNullable<카드기록['gx']> = {}
                const s새: NonNullable<카드기록['s']> = {}
                const h새: NonNullable<카드기록['h']> = {}
                for (const [칸, 낱개] of Object.entries(검.칸들)) {
                  const 든것 = 낱개.filter((x) => !x.x)
                  const 값들 = 든것.map((x) => x.p).sort((a, b) => a - b)
                  const 가운데 = !값들.length
                    ? 0
                    : 값들.length % 2
                      ? 값들[(값들.length - 1) / 2]
                      : 값다듬((값들[값들.length / 2 - 1] + 값들[값들.length / 2]) / 2)
                  gx[칸] = {
                    n: 값들.length,
                    avg: 값들.length ? 값다듬(값들.reduce((a, b) => a + b, 0) / 값들.length) : 0,
                    med: 가운데,
                  }
                  s새[칸] = 낱개.slice(0, 기록낱개최대).map((x) => ({
                    p: x.p,
                    d: x.d,
                    ...(x.u ? { u: x.u } : {}),
                    ...(x.a ? { a: true } : {}),
                    ...(x.t ? { t: x.t } : {}),
                    ...(x.bo ? { bo: true } : {}),
                    ...(x.x ? { x: x.x } : {}),
                  }))
                  const 날별: Record<string, number[]> = {}
                  for (const x of 든것) (날별[x.d] ??= []).push(x.p)
                  h새[칸] = Object.fromEntries(
                    Object.entries(날별).map(([d, v]) => [d, 값다듬(v.reduce((a, b) => a + b, 0) / v.length)]),
                  )
                  승격상태!.낙찰 += 낱개.length
                }
                // 덤프 눌러두기는 부모만 — 곁 카드는 읽는 자리가 덤프를 아예 안 본다.
                if (!구울키.includes('~'))
                  for (const 칸 of Object.keys(ebayGradeCache.get(구울키) ?? {}))
                    if (!(칸 in gx)) gx[칸] = { n: 0, avg: 0, med: 0 }
                let 옛: 카드기록 | null = null
                try { 옛 = JSON.parse(await readFile(기록길(구울키), 'utf-8')) as 카드기록 } catch { /* 처음 */ }
                const 새기록: 카드기록 = {
                  at: Date.now(),
                  h: h새,
                  s: s새,
                  gx,
                  ...(옛?.tcg ? { tcg: 옛.tcg } : {}),
                  ...(옛?.pop ? { pop: 옛.pop } : {}),
                }
                await writeJsonFile(기록길(구울키), 새기록)
                보정등급적기(구울키, gx)
                승격상태!.함++
              }
              승격상태 = { ...승격상태!, 돌고있나: false, 끝: Date.now() }
              const 구운시간 = Date.now() - 굽기시작
              console.log(
                `[pokegre] 승격 끝 — 카드 ${승격상태.함.toLocaleString()}장(낙찰 ${승격상태.낙찰.toLocaleString()}건)을 실제 화면 저장소로 구웠습니다.` +
                ` (씨앗 풀기 ${(푼시간 / 1000).toFixed(1)}초 · 굽기 ${(구운시간 / 1000).toFixed(1)}초 · 한 장에 ${승격상태.함 ? Math.round(구운시간 / 승격상태.함) : 0}ms)`,
              )
              // ⚠️⚠️ 구운 장수가 천장에 닿으면 **다음 부팅 때 기록정리가 앞엣것을 지운다.**
              //    2026-08-22에 24,109장을 구웠는데 천장이 21,000이라 5,218장이 조용히
              //    날아갔다(오류 없음 · 화면만 저쪽 값으로 되돌아감). 그때 이 줄이 없었다.
              if (승격상태.함 > 기록카드최대 * 0.9) {
                console.log(`[pokegre] ⚠️ 구운 장수 ${승격상태.함.toLocaleString()}장이 기록 천장 ${기록카드최대.toLocaleString()}장에 닿습니다 — 다음 부팅 때 앞엣것이 지워집니다. 「기록카드최대」를 올리세요.`)
              }
            } catch (e) {
              승격상태 = { ...(승격상태 as NonNullable<typeof 승격상태>), 돌고있나: false, 오류: String(e), 끝: Date.now() }
              console.log('[pokegre] 승격 실패: ' + String(e))
            }
          })()
          return
        }
        // ── 사장님 한 줄 메모 적기 — 낱개마다 붙는다. 빈 글이면 지운다. ──────────
        if (몸.itm && '메모' in 몸) {
          let 메모들: Record<string, { 글: string; card?: string; at: number }> = {}
          try { 메모들 = JSON.parse(await readFile(메모파일, 'utf8')) } catch { /* 처음 */ }
          const 글 = String(몸.메모 ?? '').trim().slice(0, 300)
          if (글) 메모들[String(몸.itm)] = { 글, ...(몸.id ? { card: String(몸.id) } : {}), at: Date.now() }
          else delete 메모들[String(몸.itm)]
          await mkdir(path.dirname(메모파일), { recursive: true })
          await writeFile(메모파일, JSON.stringify(메모들))
          sendJson(res, 200, { 적음: 몸.itm, 남은메모: Object.keys(메모들).length })
          return
        }
        // ── 재분류 — 저장된 것을 지금 규칙으로 다시 가른다(1st Edition 갈라내기 포함) ──
        if (몸.id && 몸.redo) {
          const 답 = await 다시짓기(String(몸.id).trim())
          console.log(`[pokegre] 이베이 검수 재분류(${몸.id}): 부모 ${답.부모요약.받음}건 · 1st Edition으로 ${답.첫판수}건`)
          sendJson(res, 200, 답)
          return
        }
        // ── 판정 기억 적기(사장님 검사에서 확정된 것) ────────────────────────
        // 지움: 사장님이 「카드 아님 · 삭제」라 판정한 매물. 저장에서 빠지고, **다음 긁기에
        // 또 들어와도 이 기억이 먼저라 다시는 안 담긴다.**
        if (몸.itm) {
          let 기억: Record<string, { x?: string; 칸?: string; 지움?: boolean; 출처: string; at: number }> = {}
          try { 기억 = JSON.parse(await readFile(기억파일, 'utf8')) } catch { /* 처음 */ }
          기억[String(몸.itm)] = { ...(몸.x ? { x: 몸.x } : {}), ...(몸.칸 ? { 칸: 몸.칸 } : {}), ...(몸.지움 ? { 지움: true } : {}), 출처: '사람', at: Date.now() }
          await mkdir(path.dirname(기억파일), { recursive: true })
          await writeFile(기억파일, JSON.stringify(기억))
          sendJson(res, 200, { 적음: 몸.itm })
          return
        }
        // ── 러너가 긁어 온 줄 받기 — 검수 기록에 **합친다** ─────────────────────
        // ⚠️ 같은 매물(itm)은 러너 것이 이긴다 — 값을 이베이 화면에서 직접 읽은 것이라
        //    저쪽이 적어 둔 값보다 진짜다(사장님이 「링크엔 $100인데 표기는 $80」을 직접
        //    찾으셨다 · 2026-08-19). 저쪽에만 있던 낱개는 지우지 않고 남긴다(90일 밖 기록).
        if (몸.id && Array.isArray(몸.rows)) {
          const id = String(몸.id).trim()
          const 파일 = path.join(검수폴더, `${id}.json`)
          let 기록: 검수기록
          try { 기록 = JSON.parse(await readFile(파일, 'utf8')) } catch {
            sendJson(res, 400, { error: '먼저 저쪽 것을 받으세요(POST {id})' })
            return
          }
          const 환 = 지금환율()?.usdToKrw ?? 0
          let 받음 = 0, 값없음 = 0, 판매자차단 = 0
          const 지울판매자매물 = new Set<string>()
          const 새것: 검수낱개[] = []
          for (const r of 몸.rows) {
            const 제목 = String(r.t ?? '')
            const itm = String(r.itm ?? '').replace(/\D/g, '')
            if (!제목 || !itm) continue
            // ⚠️ 차단 판매자 물건은 안 담고, 예전에 담긴 것도 지운다(같은 매물 번호로).
            const 셀러 = String(r.sl ?? '').toLowerCase()
            if (셀러 && 차단판매자.has(셀러)) { 판매자차단++; 지울판매자매물.add(itm); continue }
            const usd = r.usd && r.usd > 0 ? r.usd : 환 > 0 && r.krw ? 값다듬(r.krw / 환) : 0
            const 날 = 날짜읽기(String(r.d ?? ''))
            if (!(usd > 0) || !날) { 값없음++; continue }
            받음++
            // ⚠️ 판정은 여기서 안 한다 — 담기만 하고, 끝의 `다시짓기`가 한 벌 잣대로 가른다.
            const 칸 = 제목등급칸(제목) || (제목에감정사있나(제목) ? 'ungraded' : 'raw')
            새것.push({ itm, p: 값다듬(usd), d: 날, u: `https://www.ebay.com/itm/${itm}`, a: r.a || undefined, t: 제목.slice(0, 160), 출처: '러너', ...(r.bo ? { bo: true } : {}), ...(셀러 ? { sl: 셀러 } : {}), 칸 } as 검수낱개 & { 칸: string })
          }
          for (const 있는칸 of Object.keys(기록.칸들)) {
            기록.칸들[있는칸] = 기록.칸들[있는칸].filter((s) => !지울판매자매물.has(s.itm))
          }
          // 합치기: 매물 번호로 겹치면 러너 것으로 갈아 끼우고, 새것은 얹는다.
          let 갈음 = 0, 얹음 = 0, 값고침 = 0
          for (const 줄 of 새것 as (검수낱개 & { 칸: string })[]) {
            const { 칸, ...낱개 } = 줄
            let 겹침 = false
            for (const 있는칸 of Object.keys(기록.칸들)) {
              const i = 기록.칸들[있는칸].findIndex((s) => s.itm === 낱개.itm)
              if (i < 0) continue
              겹침 = true
              갈음++
              // ⚠️⚠️ **값이 다르면 러너 값으로 갈고 「가격 고침」을 남긴다**(사장님 지시
              //    2026-08-19). 저쪽이 적은 값이 실제 화면과 다른 매물이 있어서다.
              //    저쪽이 적었던 값을 `고친값`에 남겨 화면이 「전 $X」로 밝힌다.
              const 옛 = 기록.칸들[있는칸][i]
              if (옛.출처 !== '러너' && Math.abs(옛.p - 낱개.p) > 0.5) { 낱개.고친값 = 옛.p; 값고침++ }
              // 등급칸이 다르게 읽혔으면 옛 칸에서 빼고 새 칸으로 옮긴다.
              if (있는칸 === 칸) 기록.칸들[있는칸][i] = 낱개
              else {
                기록.칸들[있는칸].splice(i, 1)
                ;(기록.칸들[칸] ??= []).push(낱개)
              }
              break
            }
            if (!겹침) { 얹음++; (기록.칸들[칸] ??= []).push(낱개) }
          }
          for (const 칸 of Object.keys(기록.칸들)) {
            if (!기록.칸들[칸].length) { delete 기록.칸들[칸]; continue }
          }
          기록.at = Date.now()
          await writeFile(파일, JSON.stringify(기록))
          // 합친 것을 지금 규칙으로 다시 가른다 — 1st Edition은 곁 카드로 옮겨진다.
          const 답 = await 다시짓기(id)
          console.log(`[pokegre] 이베이 검수 긁기(${id} ${기록.name}): 러너 줄 ${받음} · 갈아 끼움 ${갈음} · 새로 얹음 ${얹음} · 가격 고침 ${값고침} · 1st Ed ${답.첫판수} · 기타 언어 ${답.기타언어수} · 애매 지움 ${답.지운애매} · 판매자 차단 ${판매자차단} · 값 못 읽음 ${값없음}`)
          sendJson(res, 200, { 받음, 갈음, 얹음, 값고침, 값없음, 판매자차단, ...답 })
          return
        }

        // ── 카드 한 장 받아서 분류 ────────────────────────────────────────────
        const id = String(몸.id ?? '').trim()
        if (!/^\d+$/.test(id)) { sendJson(res, 400, { error: '카드 번호가 아님' }); return }
        const idx = await loadCardIndex()
        const 줄 = idx?.rows.find((r) => r[7] === id)
        if (!줄) { sendJson(res, 404, { error: '도감에 없음' }); return }
        const 판 = String(줄[0]).startsWith('ja-') ? 'japanese' : 'english'
        const p = new URLSearchParams({ tcgPlayerId: id, language: 판, limit: '1', includeEbay: 'true' })
        const r = await fetch(`${PRICE_TRACKER_ORIGIN}/cards?${p}`, {
          headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15_000),
        })
        notePpt(r.status, r.headers)
        if (!r.ok) { sendJson(res, 502, { error: `저쪽 ${r.status}` }); return }
        const j = (await r.json()) as { data?: unknown }
        const 카드 = (Array.isArray(j.data) ? j.data[0] : j.data) as RawPriceTrackerCard | undefined
        if (!카드) { sendJson(res, 404, { error: '저쪽에 없음' }); return }
        // ⚠️ 총 장수는 저쪽 `cardNumber`의 뒷자리("154/172")에서 온다 — `totalSetNumber`는
        //    전부 null이었다(2026-08-19 실측 10장). 보충표가 있으면 그것이 먼저다.
        const 저쪽번호 = String((카드 as { cardNumber?: unknown }).cardNumber ?? '')
        const 정보: 판정카드 = {
          no: String(줄[1] ?? '').replace(/^#/, '').split('~')[0],
          total: 총표[id] ?? (저쪽번호.includes('/') ? 저쪽번호.split('/')[1].trim() : ''),
          setEn: String(카드.setName ?? ''),
          ed: String(줄[0]).split('-')[0],
          변형: 변형표[id],
        }
        const 칸들: Record<string, 검수낱개[]> = {}
        let 받음 = 0
        for (const 목록 of Object.values(카드.ebay?.soldListings ?? {})) {
          for (const s of 목록 ?? []) {
            const 제목 = String(s.title ?? '')
            const 값 = Number(s.price)
            const 날 = String(s.soldDate ?? '').slice(0, 10)
            if (!제목 || !Number.isFinite(값) || 값 <= 0 || !날) continue
            받음++
            const itm = String(s.listingId ?? '')
            // ⚠️ 판정은 여기서 안 한다 — 담기만 하고, 끝의 `다시짓기`가 한 벌 잣대로 가른다.
            const 칸 = 제목등급칸(제목) || (제목에감정사있나(제목) ? 'ungraded' : 'raw')
            ;(칸들[칸] ??= []).push({
              itm,
              p: 값다듬(값),
              d: 날,
              u: itm ? `https://www.ebay.com/itm/${itm}` : String(s.url ?? '').split('?')[0],
              a: String(s.listingType ?? '').toLowerCase() === 'auction' || undefined,
              t: 제목.slice(0, 160),
              ...(s.bestOfferAccepted ? { bo: true } : {}),
            })
          }
        }
        const 기록: 검수기록 = {
          at: Date.now(),
          id,
          slug: String(줄[0]),
          name: String(줄[2] ?? ''),
          nameEn: String(줄[8] ?? 줄[2] ?? ''),
          setEn: 정보.setEn ?? '',
          no: 정보.no,
          total: 정보.total ?? '',
          img: String(줄[3] ?? ''),
          요약: { 받음, 든수: 0, 뺀수: 0, 애매수: 0 },
          칸들,
        }
        // ⚠️⚠️ **덮어쓰지 않고 합친다.** 예전엔 통째로 갈아 끼워서, 다시 받으면 러너가
        //    긁어 둔 낙찰이 사라졌다(문서에 「다시 쓰지 말 것」이라 적어 두기까지 했다).
        //    같은 매물(itm)은 저장된 러너 줄이 이기고, 저쪽에만 있던 옛 줄은 남긴다.
        try {
          const 있던 = JSON.parse(await readFile(path.join(검수폴더, `${id}.json`), 'utf8')) as 검수기록
          const 새itm = new Set(Object.values(기록.칸들).flat().map((s) => s.itm))
          for (const [칸, v] of Object.entries(있던.칸들)) {
            for (const s of v) {
              if (!새itm.has(s.itm)) { (기록.칸들[칸] ??= []).push(s); continue }
              if (s.출처 === '러너') {
                for (const 새칸 of Object.keys(기록.칸들)) {
                  const i = 기록.칸들[새칸].findIndex((x) => x.itm === s.itm)
                  if (i >= 0) { 기록.칸들[새칸][i] = s; break }
                }
              }
            }
          }
        } catch { /* 처음 받는 카드 */ }
        await mkdir(검수폴더, { recursive: true })
        await writeFile(path.join(검수폴더, `${id}.json`), JSON.stringify(기록))
        // 받은 것을 지금 규칙으로 가른다 — 1st Edition·기타 언어는 곁 카드로 옮겨진다.
        const 답 = await 다시짓기(id)
        console.log(`[pokegre] 이베이 검수(${id} ${기록.name}): 받음 ${받음} · 든 것 ${답.부모요약.든수} · 뺀 것 ${답.부모요약.뺀수} · 1st Ed ${답.첫판수} · 기타 언어 ${답.기타언어수} · 애매 지움 ${답.지운애매}`)
        sendJson(res, 200, { 받음, ...답 })
        return
      } catch (e) {
        sendJson(res, 500, { error: String(e).slice(0, 200) })
        return
      }
    }

    // ── GET: 목록 또는 카드 한 장 ──────────────────────────────────────────────
    try {
      // 사장님 메모를 한꺼번에 읽는 창구 — 내가 읽고 규칙·판정을 고치는 데 쓴다.
      if (q.get('comments') === '1') {
        let 메모들: Record<string, { 글: string; card?: string; at: number }> = {}
        try { 메모들 = JSON.parse(await readFile(메모파일, 'utf8')) } catch { /* 없음 */ }
        // 메모가 달린 낱개의 제목·값을 곁들인다 — 메모만 봐서는 어느 매물인지 모른다.
        const 붙임: Record<string, unknown>[] = []
        let 파일들: string[] = []
        try { 파일들 = (await readdir(검수폴더)).filter((f) => f.endsWith('.json')) } catch { /* 없음 */ }
        const 찾기 = new Map<string, { 카드: string; t: string; p: number; 칸: string; x?: string }>()
        for (const f of 파일들) {
          try {
            const 기록 = JSON.parse(await readFile(path.join(검수폴더, f), 'utf8')) as 검수기록
            for (const [칸, v] of Object.entries(기록.칸들))
              for (const s of v) if (메모들[s.itm] && !찾기.has(s.itm)) 찾기.set(s.itm, { 카드: 기록.name, t: s.t, p: s.p, 칸, x: s.x })
          } catch { /* 건너뜀 */ }
        }
        for (const [itm, m] of Object.entries(메모들)) 붙임.push({ itm, ...m, ...(찾기.get(itm) ?? {}) })
        붙임.sort((a, b) => Number(b.at) - Number(a.at))
        sendJson(res, 200, { 메모: 붙임 })
        return
      }
      // 검수 기록 하나를 실제 화면 부품(EbayCardDetail·EbayCardTile)이 그대로 그릴 수 있는 꼴로.
      // ⚠️ ?id(상세)와 ?q(실서비스 꼴 검색)가 **같은 이 함수**를 쓴다 — 따로 지으면 어긋난다.
      const 검수카드꼴 = (기록: 검수기록, 메모들: Record<string, { 글: string }>) => {
        const grades = Object.entries(기록.칸들).map(([칸, 낱개]) => {
        const 값들 = 낱개.filter((s) => !s.x).map((s) => s.p).sort((a, b) => a - b)
        const 가운데 = 값들.length
          ? 값들.length % 2 ? 값들[(값들.length - 1) / 2] : 값다듬((값들[값들.length / 2 - 1] + 값들[값들.length / 2]) / 2)
          : 0
        const 날별: Record<string, number[]> = {}
        for (const s of 낱개) if (!s.x) (날별[s.d] ??= []).push(s.p)
        return {
          grade: 칸,
          count: 값들.length,
          averagePrice: 값들.length ? 값다듬(값들.reduce((a, b) => a + b, 0) / 값들.length) : 0,
          medianPrice: 가운데,
          minPrice: 0,
          maxPrice: 0,
          marketTrend: null,
          lastSaleDate: null,
          smartPrice: null,
          confidence: null,
          history: Object.entries(날별)
            .map(([date, v]) => ({ date, price: 값다듬(v.reduce((a, b) => a + b, 0) / v.length) }))
            .sort((a, b) => (a.date < b.date ? -1 : 1)),
          sales: 낱개.map((s) => ({
            price: s.p,
            date: s.d,
            url: s.u,
            auction: !!s.a,
            title: s.t,
            itm: s.itm,
            ...(s.x ? { 뺀까닭: s.x } : {}),
            ...(s.출처 ? { 출처: s.출처 } : {}),
            ...(s.고친값 ? { 고친값: s.고친값 } : {}),
            ...(s.bo && !s.x ? { 베스트오퍼: true } : {}),
            ...(메모들[s.itm]?.글 ? { 메모: 메모들[s.itm].글 } : {}),
          })),
        }
      })
        grades.sort((a, b) => b.count - a.count)
        return {
          tcgPlayerId: 기록.id,
          name: 기록.name,
          nameEn: 기록.nameEn,
          setName: 기록.setEn,
          setNameEn: 기록.setEn,
          cardNumber: 기록.total ? `${기록.no}/${기록.total}` : 기록.no,
          rarity: '',
          imageUrl: 기록.img,
          totalSales: grades.reduce((s, g) => s + g.count, 0),
          tcgplayer: null,
          grades,
          요약: 기록.요약,
          판: 판구하기(기록),
          검사시각: 기록.at,
        }
      }

      // 승격 진행 상황 — 배경에서 도는 것을 들여다본다.
      if (q.get('승격')) {
        sendJson(res, 200, 승격상태 ?? { 아직: true })
        return
      }
      // 그림 예열 진행 상황.
      if (q.get('예열')) {
        sendJson(res, 200, 예열상태 ?? { 아직: true })
        return
      }
      const id = (q.get('id') ?? '').trim()
      // 실서비스 꼴 검색(?q=이름&pan=판) — 검수 화면의 「실제 모습」 보기가 쓴다(사장님 지시
      // 2026-08-20: 「실제랑 똑같은 환경으로」). 실서비스 타일(EbayCardTile)이 그대로 그릴 수
      // 있게 카드를 통째로 준다. 맞은 것이 많으면 60장까지만(실서비스 목록 상한과 같은 잣대).
      const 검색 = (q.get('q') ?? '').trim().toLowerCase()
      if (!id && 검색) {
        const 판 = (q.get('pan') ?? 'english').trim()
        let 메모들: Record<string, { 글: string }> = {}
        try { 메모들 = JSON.parse(await readFile(메모파일, 'utf8')) } catch { /* 없음 */ }
        let 파일들: string[] = []
        try { 파일들 = (await readdir(검수폴더)).filter((f) => f.endsWith('.json')) } catch { /* 폴더 없음 */ }
        const 맞은: 검수기록[] = []
        for (const f of 파일들) {
          try {
            const 기록 = JSON.parse(await readFile(path.join(검수폴더, f), 'utf8')) as 검수기록
            if (판구하기(기록) !== 판) continue
            if (!`${기록.name} ${기록.nameEn} ${기록.no} ${기록.setEn} ${기록.id}`.toLowerCase().includes(검색)) continue
            맞은.push(기록)
          } catch { /* 깨진 파일은 건너뜀 */ }
        }
        // 실서비스는 도감 차례로 나오지만 검수 저장소엔 그 차례가 없다 — 거래 많은 순으로 세운다.
        const 낙찰수 = (기록: 검수기록) =>
          Object.values(기록.칸들).reduce((n, v) => n + v.filter((s) => !s.x).length, 0)
        맞은.sort((a, b) => 낙찰수(b) - 낙찰수(a))
        sendJson(res, 200, { rows: 맞은.slice(0, 60).map((r) => 검수카드꼴(r, 메모들)), 총수: 맞은.length })
        return
      }
      if (!id) {
        let 파일들: string[] = []
        try { 파일들 = (await readdir(검수폴더)).filter((f) => f.endsWith('.json')) } catch { /* 폴더 없음 */ }
        const rows = []
        for (const f of 파일들) {
          try {
            const 기록 = JSON.parse(await readFile(path.join(검수폴더, f), 'utf8')) as 검수기록
            rows.push({ id: 기록.id, name: 기록.name, no: 기록.no, setEn: 기록.setEn, img: 기록.img, at: 기록.at, 판: 판구하기(기록), 요약: 기록.요약 })
          } catch { /* 깨진 파일은 건너뜀 */ }
        }
        rows.sort((a, b) => b.at - a.at)
        sendJson(res, 200, { rows })
        return
      }
      const 기록 = JSON.parse(await readFile(path.join(검수폴더, `${id}.json`), 'utf8')) as 검수기록
      let 메모들: Record<string, { 글: string }> = {}
      try { 메모들 = JSON.parse(await readFile(메모파일, 'utf8')) } catch { /* 없음 */ }
      sendJson(res, 200, 검수카드꼴(기록, 메모들))
    } catch {
      sendJson(res, 404, { error: 'not found' })
    }
  })

  app.use('/api/local/card-board', async (req, res) => {
    const q = new URL(req.url ?? '', 'http://x').searchParams
    // 카드를 눌렀을 때 그 한 장을 받아 가는 자리. 목록은 대표 등급 하나만 싣는다.
    //
    // ⚠️ 여기서 **추이와 낱개 낙찰까지** 채운다. 덤프에는 요약만 있어 그 둘이 없다
    //    (사장님 지적 2026-08-12: "그래프는 왜 없냐?" / "세부 낙찰기록은 없네?").
    //    쌓아 둔 게 싱싱하면 크레딧 0, 이레가 지났으면 3크레딧으로 다시 받아 **이어 붙인다.**
    const 등급만 = (q.get('grades') ?? '').trim()
    if (등급만) {
      const 판말 = q.get('lang') === 'english' ? 'english' : 'japanese'
      // ⚠️ **비교 담기는 등급표만 쓴다 — 추이·낱개를 받으면 안 된다.**
      //    등급표는 받아 둔 덤프(`ebayGradeCache`)에 있어 크레딧이 0인데, 추이·낱개는
      //    저쪽에 물어야 나와 **처음 보는 카드면 3크레딧**이다. 비교는 그 둘을 한 줄도
      //    안 그리므로, 담을 때마다 크레딧이 나가면 그건 그냥 새는 것이다.
      //    카드를 열 때는 이 표시가 없으므로 예전 그대로 다 받아 온다.
      const 기록 = q.get('grades만') === '1' ? null : await 카드기록받기(apiKey, 등급만, 판말)
      // ⚠️⚠️ **덤프에 없는 등급칸도 낸다.** 등급표는 덤프(`ebayGradeCache`)로 빚는데,
      //    낱개를 **제목이 말하는 칸으로 옮기면**(`제목등급칸`) 덤프에 없는 칸이 생긴다 —
      //    AGS·GMA·Z gold 같은 작은 감정 회사는 저쪽이 PSA·CGC 칸에 담아 보내기 때문이다.
      //    그대로 두면 옮긴 낱개가 **화면에서 통째로 사라진다**(2026-08-16 실측: 197816의
      //    AGS 9.5 낙찰 2건이 파일에는 있는데 등급표 13칸 어디에도 안 나왔다).
      //    저쪽 값이 없는 칸이므로 **우리가 가진 낙찰로만** 건수·중앙값을 낸다.
      // ⚠️ 덤프는 **저쪽 번호**로 들어오므로 꼬리를 떼고 찾는다. 꼬리가 붙은 카드는
      //    덤프 값이 저 혼자 것이 아니라, 아래에서 우리가 다시 센 값(`gx`)이 덮는다.
      // ⚠️⚠️ **갈라 담은 카드는 덤프를 안 쓴다.** 덤프는 저쪽의 **통째 상품** 것이라
      //    딴 카드 낙찰이 섞여 있다(캡틴피카츄 칸은 35건이 여덟 가지 카드다).
      //    쓰면 우리가 고친 값 대신 **남의 값이 이 카드 값인 척** 나간다.
      //    이 카드는 우리가 제목으로 골라 센 것(`우리만줄`)만 낸다.
      // ⚠️ `~` 갈래 카드(곁 카드·나눠 쓰는 번호)는 덤프를 안 쓴다 — 덤프는 저쪽 통째 상품
      //    것이라 곁 카드에 부모 값이 섞인다. 우리가 구운 값(gx)만 쓴다.
      const 덤프칸 = 내낙찰고르기[등급만] || 등급만.includes('~') ? {} : (ebayGradeCache.get(등급만.split('~')[0]) ?? {})
      const 우리만 = Object.keys(기록?.s ?? {}).filter((칸) => !(칸 in 덤프칸) && (기록!.s![칸]?.length ?? 0) > 0)
      const 우리만줄 = 우리만.map((칸) => {
        // ⚠️ **뺀 낙찰(`x`)은 안 센다** — 저쪽 값이 없는 칸이라 우리가 세는 것이 곧 화면 값이다.
        //    여기를 빠뜨리면 옮겨 온 칸에서만 중국판이 되살아난다(칸마다 잣대가 달라진다).
        const 값들 = 기록!.s![칸].filter((s) => !s.x).map((s) => s.p).filter((v) => v > 0).sort((a, b) => a - b)
        const 중앙 = 값들.length
          ? 값들.length % 2
            ? 값들[(값들.length - 1) / 2]
            : 값다듬((값들[값들.length / 2 - 1] + 값들[값들.length / 2]) / 2)
          : 0
        return {
          grade: 칸,
          count: 기록!.s![칸].filter((s) => !s.x).length,
          averagePrice: 값들.length ? 값다듬(값들.reduce((a, b) => a + b, 0) / 값들.length) : 0,
          medianPrice: 중앙,
          minPrice: 0,
          maxPrice: 0,
          marketTrend: null,
          lastSaleDate: null,
          smartPrice: null,
          confidence: null,
          history: [],
          sales: [],
        }
      })
      const grades = [...등급빚기(덤프칸), ...우리만줄]
        .sort((a, b) => b.count - a.count)
        .map((g) => ({
        ...g,
        // ⚠️ 우리가 다시 센 칸이면 **그 값을 쓴다**(저쪽이 등급을 잘못 담았던 칸).
        //    `smartPrice`를 null로 두면 화면이 중앙값을 쓴다 — 그게 우리가 센 값이다.
        ...(기록?.gx?.[g.grade]
          ? {
              count: 기록.gx[g.grade].n,
              averagePrice: 기록.gx[g.grade].avg,
              medianPrice: 기록.gx[g.grade].med,
              smartPrice: null,
              confidence: null,
            }
          : {}),
        history: Object.entries(기록?.h?.[g.grade] ?? {})
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([date, price]) => ({ date, price })),
        sales: (기록?.s?.[g.grade] ?? []).map((s) => ({
          price: s.p,
          date: s.d,
          url: s.u ?? '',
          auction: !!s.a,
          ...(s.t ? { title: s.t } : {}),
          // 셈에서 뺀 것. 화면이 취소선 + 「셈 제외 · 중국판」으로 보여 준다.
          ...(s.x ? { 뺀까닭: s.x } : {}),
        })),
      }))
        // ⚠️⚠️ **셈에 든 낙찰이 한 건도 없는 칸은 안 내보낸다.** 중국판을 빼고 나면 그런
        //    칸이 생기는데(617410은 35건 중 33건이 중국판이라 거의 모든 칸이 그렇다),
        //    남겨 두면 값 없는 줄이 시세인 척 서 있게 된다. 뺀 낙찰 자체는 지우지 않고
        //    `/data/card-history/<번호>.json`에 까닭(`x`)과 함께 그대로 남아 있다.
        .filter((g) => g.count > 0)
      sendJson(res, 200, {
        grades,
        // 감정 수량. 덤프에 있으면 그것, 없으면 카드를 열 때 받아 쌓아 둔 것.
        // ⚠️ 이걸 같이 주므로 화면은 `card-extra`를 따로 부르지 않는다(옛 길에 남은 자리다).
        // ⚠️ 갈라 담은 카드에는 **감정 수량도 안 붙인다.** 저쪽 팝수는 통째 상품 것이라
        //    (캡틴피카츄 1,718장) 이 카드 한 장의 수가 아니다.
        //    ⚠️ 예전엔 여기서 `기록?.pop`을 그대로 냈는데, 그 값 자체가 통째 상품 것이라
        //       까닭을 적어 놓고도 **그 수가 그대로 화면에 나갔다.** 아예 안 낸다.
        population: 내낙찰고르기[등급만] || 등급만.includes('~') ? null : (populationCache.get(등급만.split('~')[0]) ?? 기록?.pop ?? null),
        // TCGplayer 추이. `historyCondition`은 **어느 상태의 추이인지** — 큰 숫자와 다르면
        // 화면이 제목에 밝힌다(옛 길이 하던 그대로).
        tcgHistory: 기록?.tcg
          ? {
              condition: 기록.tcg.c,
              history: Object.entries(기록.tcg.h)
                .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                .map(([date, price]) => ({ date, price })),
            }
          : null,
      })
      return
    }
    // 공유 링크로 들어왔을 때 「이 번호가 어느 카드인가」를 묻는 자리. **크레딧 0.**
    // ⚠️ 갈라 담은 열쇠(「617410~4-9」)가 올 수 있으니 앞 숫자만 쓴다.
    const 번호로 = (q.get('id') ?? '').trim().split('~')[0]
    if (번호로) {
      const idx0 = await loadCardIndex()
      const 것 = idx0 ? 저쪽번호표(idx0).get(번호로) : undefined
      sendJson(
        res,
        200,
        것
          ? {
              card: {
                slug: 것.slug,
                no: 도감번호(것.n) ?? '',
                name: 것.name,
                edition: 것.ed === 'en' ? 'english' : 'japanese',
                setName: idx0!.sets[것.slug]?.[0] ?? '',
              },
            }
          : { card: null },
      )
      return
    }
    // 레어도 코드(SAR·SR…)는 대문자라, **소문자로 만들기 전 말**도 들고 있어야 뗄 수 있다.
    const 원래말 = (q.get('q') ?? '').trim()
    const 말 = 원래말.toLowerCase()
    // 판 셋: 일본어판(ja) · 영문판(en) · **기타 언어판(other)**(사장님 지시 2026-08-20).
    const 판 = q.get('lang') === 'english' ? 'en' : q.get('lang') === 'other' ? 'other' : 'ja'
    // ⚠️ 기타 언어 곁 카드(`~lang`)는 세트가 en이라도 「기타 언어판」 몫이다 — 세트의 판만
    //    보면 영문판 검색에 프랑스·독일판이 섞인다. 1st Edition(`~1st`)은 영문판 그대로다.
    // ⚠️ 중국어판 세트(`zh-` — 캡틴피카츄 AR)도 「기타 언어판」이다(사장님 지적 2026-08-21:
    //    「중국어판인데 왜 일본어판에 붙어 있지」). 세트 틀이 ja/en 둘뿐이라 zh 세트가 ja로
    //    적혀 있었다 — 검수 저장소의 판구하기(zh- → other)와 같은 잣대로 맞춘다.
    const 행판 = (set: readonly (string | undefined)[] | undefined, tcg: string | undefined, slug?: string) =>
      String(tcg ?? '').includes('~lang') || String(slug ?? '').startsWith('zh-') ? 'other' : set?.[1]
    // ⚠️ 도감·세트·작가에서 카드 한 장을 눌러 온 경우 그 카드가 **맨 앞**에 서야 한다.
    //    옛 길은 그 카드를 아예 콕 집어 열어 줬다 — 새 길이 그걸 잃으면 후퇴다
    //    (CLAUDE.md 「새 길을 만들면 옛 길이 하던 것을 빠짐없이 옮겨라」).
    //    여기서는 한 장만 주는 게 아니라 **맨 앞에 세우고 형제 카드도 같이** 보여 준다.
    const 콕slug = (q.get('slug') ?? '').trim()
    const 콕번호 = (q.get('no') ?? '').trim()
    res.setHeader('content-type', 'application/json')
    if (말.length < 1) {
      sendJson(res, 200, { cards: [], hasMore: false, total: 0 })
      return
    }
    const idx = await loadCardIndex()
    if (!idx) {
      sendJson(res, 200, { cards: [], hasMore: false, total: 0 })
      return
    }

    // ── 카드 고르기 ──────────────────────────────────────────────────────────
    // 우리 도감에서만 찾는다. 저쪽에 묻지 않으므로 크레딧이 0이고, 딴 카드가 섞일
    // 자리도 없다(옛 길은 저쪽 search가 세트 이름까지 뒤져 엉뚱한 게 올라왔다).
    //
    // ⚠️ **한글 이름과 원래 이름을 둘 다 본다.** 색인에 한글만 있으면 「charizard」를
    //    쳤을 때 한 장도 안 나온다 — 옛 길은 번역기를 태워 영문으로 물었으므로 됐다.
    //    새 길이 그걸 잃으면 후퇴다(CLAUDE.md 「새 길을 만들면 옛 길이 하던 것을 빠짐없이」).
    // ⚠️⚠️ **꼬리표 말고 카드 이름으로 찾는다.**
    //    이름 뒤에는 번호와 꼬리표가 붙는다 — 「부스터 - SM186 (#44 리자몽 스탬프)」.
    //    통째로 견주면 **리자몽 스탬프가 찍힌 부스터·기본 불꽃 에너지까지** 리자몽 검색에
    //    딸려 온다. 실측(2026-08-12 · 영문판 「리자몽」): 224장 중 **58장이 리자몽 카드가
    //    아니었다**(기본 불꽃 에너지 18 · 파이리 4 · 슈퍼볼 4 · 하우 4 …).
    //    사장님이 「저게 전체 매물이 맞아?」로 물으셨을 때 세다가 찾았다.
    // ⚠️ 꼬리표를 뗄 때 **`\s+-\s+`로 견준다.** 「Ho-Oh」처럼 이름 안에 붙임표가 있는 카드가
    //    있어서, 사이 공백을 안 보면 이름이 잘린다(CLAUDE.md에 같은 함정이 적혀 있다).
    const 머리이름 = (s: string) => {
      let cur = s
      for (;;) {
        const 뗀것 = cur.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim()
        if (뗀것 === cur) break
        cur = 뗀것
      }
      return cur.replace(/\s+-\s+.*$/, '').trim()
    }
    // 번호를 견주는 잣대. 앞의 0은 떼고 본다 — 도감은 「025」, 색인은 「25」로 적힌 자리가 있다.
    // ⚠️ 쪼개기와 「눌러 온 카드 맨 앞」이 **같은 잣대**를 써야 한다. 따로 두면 한쪽만 고쳐서 어긋난다.
    const 번호열쇠 = (s: string) => String(s ?? '').trim().replace(/^0+(?=\d)/, '').toUpperCase()
    type 고른카드 = { slug: string; n: string; name: string; en: string; img: string; tcg: string; rare: string; 일반판그림: boolean; 인쇄번호: string }
    const 고른것: 고른카드[] = []
    // 꼬리표에만 걸린 것. 이름으로 한 장도 못 찾았을 때만 쓴다 — 「스탬프」·「델타종」처럼
    // 꼬리표를 일부러 찾는 사람도 있어서, 아예 버리면 그 검색이 빈손이 된다.
    const 꼬리표만: 고른카드[] = []

    // ── ① 별명으로 먼저 찾는다 ────────────────────────────────────────────────
    // 「생일 피카츄」·「맥도날드」처럼 **카드 이름에 없는 말**로 부르는 것들이다.
    // 스니커덩크는 매물 제목에 별명을 같이 담아 찾히는데 우리는 카드 이름만 들고 있어
    // 0건이 났다(사장님 지적 2026-08-16). 자세한 근거는 src/lib/searchAliases.ts에 있다.
    // ⚠️ 화면 이름은 안 건드린다 — **찾는 길만 하나 더 내는 것**이다.
    {
      const 줄 = 별명찾기(원래말)
      if (줄) {
        const 카드열쇠 = new Set((줄.카드 ?? []).map(([s, n]) => s + '|' + 번호열쇠(n)))
        const 세트집합 = new Set(줄.세트 ?? [])
        for (const r of idx.rows) {
          const [slug, n, name, img, , , , tcg, en, rare, 일반판그림, 인쇄번호] = r as unknown as string[]
          const set = idx.sets[slug]
          if (!set || 행판(set, tcg, slug) !== 판) continue
          if (!세트집합.has(slug) && !카드열쇠.has(slug + '|' + 번호열쇠(n))) continue
          고른것.push({ slug, n, name, en: en || name, img: img ?? '', tcg: tcg ?? '', rare: rare ?? '', 일반판그림: 일반판그림 === '1', 인쇄번호: 인쇄번호 ?? '' })
        }
      }
    }

    if (!고른것.length) for (const r of idx.rows) {
      const [slug, n, name, img, , , , tcg, en, rare, 일반판그림, 인쇄번호] = r as unknown as string[]
      const set = idx.sets[slug]
      if (!set || 행판(set, tcg, slug) !== 판) continue
      const 통째 = name.toLowerCase().includes(말) || (en ?? '').toLowerCase().includes(말)
      if (!통째) continue
      const 카드 = { slug, n, name, en: en || name, img: img ?? '', tcg: tcg ?? '', rare: rare ?? '', 일반판그림: 일반판그림 === '1', 인쇄번호: 인쇄번호 ?? '' }
      const 이름으로 =
        머리이름(name).toLowerCase().includes(말) || 머리이름(en ?? '').toLowerCase().includes(말)
      if (이름으로) 고른것.push(카드)
      else 꼬리표만.push(카드)
    }
    if (!고른것.length) 고른것.push(...꼬리표만)

    // ── 그래도 0건이면 **말을 쪼개서** 다시 찾는다 ────────────────────────────
    //
    // 스니커덩크에서 치던 말이 그대로 통해야 한다(사장님 2026-08-12: "스니덩크에서
    // 검색하던걸 그대로 이베이 티피에도 되나해서"). 이런 꼴이 지금은 0건이었다:
    //     「M2 110」(세트코드+번호) · 「리자몽 110」 · 「저지맨 SR」 · 「Pikachu XY95」
    //     사진으로 찾기가 만드는 「M4 086/083」도 같다.
    //
    // ⚠️⚠️ **0건일 때만 쪼갠다.** 이 한 줄이 「기존 검색이 안 깨진다」를 보장한다 —
    //    지금 결과가 나오는 검색은 여기까지 아예 안 온다. 안 그러면 이름에 숫자·코드가
    //    든 카드가 깨진다(실측: 이름에 숫자 든 것 149가지 「폴리곤2」·「포켓기어3.0」 ·
    //    세트코드가 이름에 든 것 「동탁군 E4」 24개 · 「조로아크 BW」 · 「SP 에너지」).
    // ⚠️ 새 길이 옛 길보다 잘하는 자리다 — 옛 길은 저쪽 세트 대응표가 있어야 세트를
    //    좁혔는데 **31%가 대응표에 없었다.** 여기는 우리 도감이라 전부 좁혀진다.
    if (!고른것.length) {
      // ① 스니커덩크에서만 통하는 말을 뗀다(":1ED" 등). ② 뒤에 붙은 레어도를 뗀다.
      const { 이름: 전용뗀 } = 마켓전용말떼기(원래말)
      const { 이름: 레어도뗀, 코드: 레어도 } = 레어도떼기(전용뗀)
      // ③ 남은 것을 토막 내어 「세트코드 / 번호 / 이름」으로 가른다.
      const 코드표2 = 세트코드표(idx)
      const 세트들: string[] = []
      const 번호들: string[] = []
      const 이름조각: string[] = []
      for (const 토막 of 레어도뗀.split(/\s+/).filter(Boolean)) {
        const 소문자 = 토막.toLowerCase()
        const 세트 = 코드표2.get(소문자) ?? 코드표2.get(소문자.replace(/[-.]/g, ''))
        // 세트코드는 그 판에 있는 것만 인정한다(영문판을 보는데 ja- 세트를 잡으면 0건이 된다).
        const 이판세트 = (세트 ?? []).filter((s) => idx.sets[s]?.[1] === 판)
        if (이판세트.length) {
          세트들.push(...이판세트)
          continue
        }
        // ⚠️⚠️ **「No.」·「#」 머리는 떼고 본다.** 옛 일본 세트를 파는 사람과 사진으로 찾기가
        //    「PMCG4 No.004」 꼴로 적는데, 이 머리 때문에 번호로 안 잡혀 **0건**이 났다
        //    (사장님 지적 2026-08-16: "이미 있어서 보여줄수있는 매물인데 매칭이 안되서").
        //    같은 카드를 「PMCG4 004」로 치면 잘 나온다 — 머리 세 글자 차이였다.
        //    ⚠️ 숫자가 뒤따를 때만 뗀다. 「N」(트레이너 카드 이름)을 건드리면 안 된다.
        const 머리뗀 = 토막.replace(/^(?:no\.?|#|번호)\s*(?=\d)/i, '')
        // 「No.」가 홀로 한 낱말인 경우(「PMCG4 No. 004」)는 버린다 — 이름이 아니다.
        if (/^(?:no\.?|#|번호)$/i.test(토막)) continue
        // 번호꼴: 숫자로 시작(110 · 086/083)하거나 프로모 꼴(XY95 · SM169 · SWSH050)
        // ⚠️ **빗금 뒤(분모)는 뗀다.** 스니커덩크와 사진으로 찾기가 「086/083」 꼴로 만드는데,
        //    색인의 번호는 「86」이라 안 떼면 영영 안 맞는다(색인에 빗금 든 번호는 0개다).
        if (/^\d/.test(머리뗀) || /^[A-Za-z]{2,5}\d{1,4}$/.test(머리뗀)) {
          번호들.push(번호열쇠(도감번호(머리뗀.split('/')[0]) ?? 머리뗀))
          continue
        }
        이름조각.push(토막)
      }
      // 갈라낸 게 하나도 없어도, **군더더기를 뗀 이름으로 한 번 더** 찾아본다.
      // 스니커덩크는 「리자몽 :1ED」처럼 저기서만 통하는 말을 붙인다 — 떼면 그냥 이름이다.
      if (!세트들.length && !번호들.length && !레어도 && 레어도뗀 && 레어도뗀 !== 원래말) {
        const 뗀말 = 레어도뗀.toLowerCase()
        for (const r of idx.rows) {
          const [slug, n, name, img, , , , tcg, en, rare, 일반판그림, 인쇄번호] = r as unknown as string[]
          const set = idx.sets[slug]
          if (!set || 행판(set, tcg, slug) !== 판) continue
          if (!머리이름(name).toLowerCase().includes(뗀말) && !머리이름(en ?? '').toLowerCase().includes(뗀말)) continue
          고른것.push({ slug, n, name, en: en || name, img: img ?? '', tcg: tcg ?? '', rare: rare ?? '', 일반판그림: 일반판그림 === '1', 인쇄번호: 인쇄번호 ?? '' })
        }
      }
      // 아무것도 못 갈랐으면 그냥 둔다(쪼개기가 할 수 있는 게 없다).
      if (세트들.length || 번호들.length || 레어도) {
        const 이름말 = 이름조각.join(' ').toLowerCase()
        const 세트집합 = new Set(세트들)
        // ⚠️⚠️ **레어도로 걸러 0건이면 레어도를 빼고 한 번 더 본다.**
        //    사람이 치는 레어도와 우리 자료가 어긋나는 일이 잦다 — 「캡틴피카츄 AR」이
        //    **0건 1등(23회)**이었는데, 그 카드는 도감에 멀쩡히 있고 레어도만 `Promo`다
        //    (장터에서는 AR이라 부른다). 빈손을 내주느니 **그 포켓몬을 보여 주는 것**이 낫다.
        //    ⚠️ 레어도를 **먼저** 지키고, 그걸로 아무것도 없을 때만 푼다 — 순서를 뒤집으면
        //       「리자몽 SAR」이 리자몽 전부를 쏟아내어 지금 잘 되는 검색이 깨진다.
        for (const 레어도쓸까 of [true, false]) {
          if (고른것.length) break
          if (!레어도쓸까 && !레어도) break // 레어도가 없었으면 두 번 돌 이유가 없다
          for (const r of idx.rows) {
            const [slug, n, name, img, , , , tcg, en, rare, 일반판그림, 인쇄번호] = r as unknown as string[]
            const set = idx.sets[slug]
            if (!set || 행판(set, tcg, slug) !== 판) continue
            if (세트집합.size && !세트집합.has(slug)) continue
            // ⚠️⚠️ **카드에 찍힌 번호로도 찾는다.** 옛 일본 세트는 우리 `n`(정렬 순번)과
          //    실물 번호(포켓몬 도감번호)가 다르다 — 파이리가 우리는 012, 카드엔 No.004다.
          //    사람이 손에 든 카드를 보고 치는 번호는 **찍힌 쪽**이라 그것도 맞춰야 한다.
          // ⚠️⚠️ **찍힌 번호가 있으면 그것만 본다.** 우리 `n`(정렬 순번)까지 같이 보면
          //    「PMCG4 No.004」에 파이리(찍힌 004)와 **질퍽이(우리 순번 004)가 같이** 나온다
          //    — 사장님 지적 2026-08-17. 찍힌 번호가 그 카드의 진짜 번호이고 `n`은 우리 사정이다.
          const 볼번호 = 인쇄번호 ? 번호열쇠(인쇄번호) : 번호열쇠(도감번호(n) ?? '')
          if (번호들.length && !번호들.includes(볼번호)) continue
            if (레어도쓸까 && 레어도 && !레어도맞나(레어도, rare ?? '')) continue
            if (이름말 && !머리이름(name).toLowerCase().includes(이름말) && !머리이름(en ?? '').toLowerCase().includes(이름말))
              continue
            고른것.push({ slug, n, name, en: en || name, img: img ?? '', tcg: tcg ?? '', rare: rare ?? '', 일반판그림: 일반판그림 === '1', 인쇄번호: 인쇄번호 ?? '' })
          }
        }
      }
    }

    // ── ②′ 그래도 0건이면 **세트 이름으로** 찾는다 ────────────────────────────
    //
    // 실제 검색 기록에서 0건이던 것의 제일 큰 덩어리가 세트 이름이었다(2026-08-16):
    //     「어비스아이」6회 · 「닌자스피너」5회 · 「붉은 섬광」5회 · 「배틀파트너즈」7회 …
    // ⚠️ **자동완성으로 고르면 세트 화면으로 잘 간다** — 손으로 친 사람만 빈손이었다.
    //    그 사람에게 「없다」고 보이는 것이 제일 나쁘다(사장님 지적).
    //
    // 맞춰 보는 꼴 넷. 사람들이 실제로 친 말을 그대로 본떴다:
    //   ① 색인의 한글 세트명 그대로            「M5 어비스 아이」
    //   ② 앞의 세트코드를 뗀 것                「어비스 아이」  ← 「어비스아이」가 여기 걸린다
    //   ③ 콜론 뒤 토막                        「스칼렛&바이올렛 : 배틀파트너즈」
    //   ④ 영문 세트명                         「Paradigm Trigger」·「crown zenith」
    // ⚠️ **띄어쓰기·기호를 없애고 견준다.** 사람들이 「어비스아이」·「니힐제로」처럼 붙여 친다.
    // ⚠️ **세 글자 이상일 때만** 품기(부분 일치)를 허용한다. 짧은 말로 품기를 하면
    //    엉뚱한 세트가 통째로 딸려 온다. 여기는 0건일 때만 오므로 지금 되는 검색은 안 깨진다.
    // ⚠️⚠️ **딱 맞는 것과 품는 것을 갈라 둔다.**
    //    ① **이름이 딱 맞으면** 다른 결과가 있어도 세트를 낸다. 「정글」·「Silver tempest」는
    //       우연히 이름에 그 말이 든 카드가 **한 장** 걸려서, 「0건일 때만」으로 두면
    //       그 한 장 때문에 세트 230장을 영영 못 본다(실측으로 잡았다).
    //    ② **품기(부분 일치)는 0건일 때만.** 「맥도날드」가 「맥도날드 프로모 2011」에 걸리는
    //       자리라, 아무 때나 켜면 엉뚱한 세트가 통째로 딸려 온다.
    {
      const 납작 = (s: string) => s.toLowerCase().replace(/[\s:·&\-_.,'’()[\]]+/g, '')
      const 코드뗌 = (s: string) => s.replace(/^[A-Za-z0-9.:\-]{1,9}\s+/, '')
      const 친말 = 납작(원래말)
      const 콜론뒤 = 원래말.includes(':') ? 납작(원래말.slice(원래말.lastIndexOf(':') + 1)) : ''
      const 딱맞음 = new Set<string>()
      const 품음 = new Set<string>()
      // ⚠️ 한 글자는 세트 찾기에서 뺀다 — 「N」이 세트 이름에 걸린다.
      //    ⚠️ **딱 맞기는 두 글자부터** 본다. 한글 세트 이름은 짧다 — 「정글」이 두 글자라
      //       세 글자로 막았더니 통째로 안 걸렸다(실측으로 잡았다).
      const 딱볼말 = [친말, 콜론뒤].filter((x) => x.length >= 2)
      const 품을말 = [친말, 콜론뒤].filter((x) => x.length >= 3)
      if (딱볼말.length) {
        for (const [slug, s] of Object.entries(idx.sets)) {
          if (s[1] !== 판) continue
          const 후보 = [s[0], 코드뗌(s[0]), s[3] ?? '', 코드뗌(s[3] ?? '')].filter(Boolean).map(납작)
          // ⚠️⚠️ **딱 맞기를 먼저 전부 본 뒤에 품기를 본다.** 예전엔 한 덩이로 돌면서
          //    품기에 걸리면 `break` 했는데, 그러면 뒤에 있는 **진짜 딱 맞는 후보**를
          //    영영 못 본다 — 「Silver tempest」가 `swsh12silvertempest`(품음)에 먼저
          //    걸려 멈추는 바람에 `silvertempest`(딱맞음)에 도달하지 못했다.
          if (후보.some((c) => 딱볼말.includes(c))) { 딱맞음.add(slug); continue }
          if (품을말.length && 후보.some((c) => 품을말.some((w) => c.includes(w)))) 품음.add(slug)
        }
      }
      // ⚠️⚠️ **이름으로 이미 여러 장 찾았으면 세트를 얹지 않는다.**
      //    「아르세우스」·「델타종」은 포켓몬 이름이면서 **세트 이름이기도** 하다. 문턱 없이
      //    얹었더니 영문판 「아르세우스」가 41장 → 142장이 됐는데, 늘어난 99장이 그 세트의
      //    **아르세우스가 아닌 카드**였다(실측 2026-08-16). 숫자는 늘었어도 나빠진 것이다.
      //    우리가 고치려던 것은 **엉뚱한 카드 한두 장이 세트를 가로막는 것**이다
      //    (「정글」 1장 · 「Silver tempest」 1장). 그래서 두 장 이하일 때만 얹는다.
      const 세트얹기 = 고른것.length <= 2
      const 쓸것 = 딱맞음.size && 세트얹기 ? 딱맞음 : 고른것.length ? new Set<string>() : 품음
      if (쓸것.size) {
        const 이미 = new Set(고른것.map((c) => c.slug + '|' + c.n))
        for (const r of idx.rows) {
          const [slug, n, name, img, , , , tcg, en, rare, 일반판그림, 인쇄번호] = r as unknown as string[]
          if (!쓸것.has(slug) || 이미.has(slug + '|' + n)) continue
          고른것.push({ slug, n, name, en: en || name, img: img ?? '', tcg: tcg ?? '', rare: rare ?? '', 일반판그림: 일반판그림 === '1', 인쇄번호: 인쇄번호 ?? '' })
        }
      }
    }

    // ── ② 그래도 0건이면 **붙여 쓴 꼬리를 띄워** 한 번 더 ─────────────────────
    // 「피카츄v」는 0장인데 「피카츄 v」는 30장이다. 사람들은 한 칸을 잘 안 띄운다 —
    // 실제 검색 기록에서 이 꼴이 27가지·36회였다(2026-08-16 실측).
    // ⚠️ **0건일 때만** 한다. 지금 결과가 나오는 검색은 여기까지 아예 안 온다
    //    (「폴리곤2」·「포켓기어3.0」처럼 이름에 글자가 붙은 카드를 깨뜨리지 않으려는 것이다).
    // ⚠️ 꼬리는 두 갈래다.
    //    ① **카드 표기**(ex·V·GX·VMAX·VSTAR) — 「피카츄v」
    //    ② **한글 레어도 낱말**(프로모·찬란…) — 「체육관프로모」
    //       ⚠️ ②는 **띄우기만 하고 다시 돌린다**. 「체육관 프로모」가 되면 위 쪼개기가
    //          「이름 체육관 + 레어도 Promo」로 알아듣는다(실측: 체육관 트레이너·체육관 배지).
    //          여기서 이름만 견주면 레어도 조건이 사라져 프로모가 아닌 것까지 딸려 온다.
    //       ⚠️ 낱말 목록은 **레어도표에서 뽑는다**(src/lib/rarityCode.ts). 표가 원본이라
    //          거기 한 줄 넣으면 여기도 저절로 따라온다 — 목록을 두 벌 두지 않는다.
    if (!고른것.length) {
      const 한글레어도 = [...레어도표.keys()].filter((k) => /[가-힣]/.test(k)).sort((a, b) => b.length - a.length)
      const 붙은한글 = new RegExp('([가-힣])(' + 한글레어도.join('|') + ')$')
      const 붙은꼬리 = /(\S)(ex|v|gx|vmax|vstar|vunion)$/i
      const 말끔 = 원래말.trim()
      const 한 = 말끔.match(붙은한글)
      const m = 말끔.match(붙은꼬리)
      if (한) {
        // 한글 레어도는 띄운 뒤 **쪼개기를 다시 태운다**(레어도 조건을 살리려는 것이다).
        const { 이름: 레어도뗀2, 코드: 레어도2 } = 레어도떼기(말끔.replace(붙은한글, '$1 $2'))
        const 이름말2 = 레어도뗀2.toLowerCase()
        if (레어도2 && 이름말2) {
          for (const r of idx.rows) {
            const [slug, n, name, img, , , , tcg, en, rare, 일반판그림, 인쇄번호] = r as unknown as string[]
            const set = idx.sets[slug]
            if (!set || 행판(set, tcg, slug) !== 판) continue
            if (!레어도맞나(레어도2, rare ?? '')) continue
            if (!머리이름(name).toLowerCase().includes(이름말2) && !머리이름(en ?? '').toLowerCase().includes(이름말2)) continue
            고른것.push({ slug, n, name, en: en || name, img: img ?? '', tcg: tcg ?? '', rare: rare ?? '', 일반판그림: 일반판그림 === '1', 인쇄번호: 인쇄번호 ?? '' })
          }
        }
      } else if (m && !/\s/.test(말끔.slice(-m[0].length))) {
        const 띄운말 = 말끔.replace(붙은꼬리, '$1 $2').toLowerCase()
        for (const r of idx.rows) {
          const [slug, n, name, img, , , , tcg, en, rare, 일반판그림, 인쇄번호] = r as unknown as string[]
          const set = idx.sets[slug]
          if (!set || 행판(set, tcg, slug) !== 판) continue
          if (!머리이름(name).toLowerCase().includes(띄운말) && !머리이름(en ?? '').toLowerCase().includes(띄운말)) continue
          고른것.push({ slug, n, name, en: en || name, img: img ?? '', tcg: tcg ?? '', rare: rare ?? '', 일반판그림: 일반판그림 === '1', 인쇄번호: 인쇄번호 ?? '' })
        }
      }
    }

    // 줄 세우기. 값도 낙찰도 없는 카드가 먼저 나오면 "이 사이트는 값이 없네"로 읽힌다
    // (옛 길에서 겪은 것과 같은 이유 — 못 알아본 것은 뒤로 민다).
    //
    // ⚠️ **값이 있느냐 다음은 「얼마나 거래되느냐」로 세운다.** 값 있는 카드끼리는
    //    점수가 같아 색인 순서(=세트 파일 이름 순)로 남는데, 그러면 「리자몽」을 쳤을 때
    //    아무도 안 찾는 덱 부록이 맨 앞에 선다. 낙찰 건수가 곧 "사람들이 실제로 사고파는
    //    카드"라 이걸 잣대로 쓴다. 낙찰이 없으면 비싼 것 순(둘 다 없으면 색인 순).
    const 값점수 = (t: string) => (t && 인쇄판시세.has(t) ? 2 : 0) + (t && ebayGradeCache.has(t) ? 1 : 0)
    const 낙찰수 = (t: string) => {
      const g = t ? ebayGradeCache.get(t) : undefined
      let n = 0
      for (const v of Object.values(g ?? {})) n += v.n
      return n
    }
    const 대표값 = (t: string) => {
      let m = 0
      for (const v of Object.values((t ? 인쇄판시세.get(t) : undefined) ?? {})) if (v.m > m) m = v.m
      return m
    }
    // 눌러서 온 그 카드는 무엇보다 앞에 세운다(번호는 `도감번호()`를 거친 것끼리 견준다 —
    // 색인에는 「110~709224」처럼 꼬리가 붙은 것이 있어 그대로 맞추면 영영 안 맞는다).
    const 콕인가 = (c: { slug: string; n: string }) =>
      !!콕slug && c.slug === 콕slug && 번호열쇠(도감번호(c.n) ?? '') === 번호열쇠(콕번호)

    // ⚠️⚠️ **친 말과 이름이 똑같은 카드를 맨 앞에 세운다.**
    //    무작위 1,500장 왕복 검사에서 딱 한 장을 못 찾았는데, 이름이 **「N」 한 글자**인
    //    트레이너 카드였다(2026-08-12). 「N」은 12,884장에 걸려 천장(2,000장)을 넘고,
    //    정작 이름이 「N」인 카드는 그 뒤로 밀려 화면에 아예 안 나왔다.
    //    **이름이 짧은 카드는 이 규칙이 없으면 영영 못 찾는다** — 더 칠 글자가 없기 때문이다.
    //    덤으로, 「리자몽」을 치면 메가리자몽보다 리자몽이 먼저 나와 읽기도 자연스럽다.
    const 이름점수 = (c: { name: string; en: string }) => {
      const a = 머리이름(c.name).toLowerCase()
      const b = 머리이름(c.en ?? '').toLowerCase()
      if (a === 말 || b === 말) return 2 // 이름이 그대로 그 말
      if (a.startsWith(말) || b.startsWith(말)) return 1 // 그 말로 시작
      return 0
    }
    const 순서 = new Map(
      고른것.map((c) => [c, [콕인가(c) ? 1 : 0, 이름점수(c), 값점수(c.tcg), 낙찰수(c.tcg), 대표값(c.tcg)] as const]),
    )
    고른것.sort((a, b) => {
      const x = 순서.get(a)!
      const y = 순서.get(b)!
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || y[3] - x[3] || y[4] - x[4]
    })

    // ⚠️⚠️ **감출 카드는 여기서 뺀다**(사장님 지시 2026-08-19). 자료는 안 지운다 —
    //    화면에서만 안 보이게 한다. 되살리려면 `감춘카드`에서 한 줄 지우면 된다.
    const 보일것 = 고른것.filter((c) => !감춘카드.has(`${c.slug}|${c.n}`))

    const 총 = 보일것.length
    // 찾은 것을 다 낸다. 천장에 걸릴 때만 자른다(그리고 아래에서 잘렸다고 밝힌다).
    const 이쪽 = 보일것.slice(0, 낼수있는최대)

    // ── 값 붙이기 ────────────────────────────────────────────────────────────
    const cards = 이쪽.map((c) => {
      const set = idx.sets[c.slug]
      // ⚠️ TCGplayer 인쇄판 시세도 `~` 갈래에는 안 붙인다(통째 상품 값이라 남의 값이 된다).
      const 인쇄 = c.tcg && !c.tcg.includes('~') ? 인쇄판시세.get(c.tcg) : undefined
      // ⚠️⚠️ **우리가 다시 센 값이 있으면 그것이 먼저다.** 저쪽 덤프에는 우리가 긁은 값도,
      //    중국판을 걷어낸 결과도 없다. 그래서 목록에서는 값이 안 보이거나 옛 값이 보였다
      //    (사장님 지적 2026-08-19). ⚠️ 파일은 안 읽는다 — 메모리 표만 본다.
      const 우리등급 = c.tcg ? 보정등급.get(c.tcg) : undefined
      // ⚠️ `~` 갈래 카드는 덤프를 안 쓴다 — 통째 상품 값이라 곁 카드에 부모 값이 붙는다.
      const 덤프등급 = c.tcg && !c.tcg.includes('~') ? ebayGradeCache.get(c.tcg) : undefined
      const 등급 = 우리등급
        ? Object.fromEntries(
            // 0건짜리 칸은 「없는 것」이다 — 걷어낸 뒤 아무것도 안 남은 칸이 여기 든다.
            Object.entries(우리등급).filter(([, v]) => v.n > 0).map(([k, v]) => [k, { n: v.n, avg: v.avg, med: v.med }]),
          )
        : 덤프등급
      const 팝 = c.tcg && !c.tcg.includes('~') ? populationCache.get(c.tcg) : undefined

      // 인쇄판이 여럿이면 **제일 비싼 것**을 대표로 낸다. 어느 인쇄판인지 같이 적는다 —
      // 안 적으면 1st Edition을 가진 사람이 Unlimited 값을 보고 있을 수 있다(59%가 2배 넘게 갈린다).
      let 대표: { printing: string; m: number; l?: number } | null = null
      for (const [printing, v] of Object.entries(인쇄 ?? {}))
        if (!대표 || v.m > 대표.m) 대표 = { printing, m: v.m, l: v.l }

      /**
       * ⚠️⚠️⚠️ **인쇄판이 여럿이면 전부 싣는다**(사장님 2026-08-18 「둘 다 보이기」로 결정).
       *    위 `대표` 하나만 내보내면 흔한 쪽을 가진 사람이 남의 값을 본다 — 리자몽 베이스셋을
       *    열면 $10,000(1st Edition)이 뜨는데 대개 가진 것은 Unlimited($2,146)다.
       * ⚠️ **하나뿐이면 안 싣는다**(전체의 68%). 화면이 「여럿일 때만」 여러 줄을 그리므로
       *    한 장짜리를 실어 봐야 덩치만 는다.
       * ⚠️⚠️ **`대표`는 그대로 둔다.** 타일·비교·미개봉이 그 값을 쓰고 있어 바꾸면
       *    오류 없이 조용히 어긋난다 — 여기서는 **더하기만** 한다.
       * ⚠️ 값이 0인 인쇄판은 뺀다(저쪽이 칸만 만들고 값을 안 준 것이다).
       * ⚠️ 비싼 것부터 세운다 — 어느 쪽이 윗값인지가 한눈에 보여야 한다.
       */
      const 인쇄줄 = Object.entries(인쇄 ?? {})
        .filter(([, v]) => v.m > 0)
        .map(([printing, v]) => ({ printing, market: v.m, low: v.l ?? 0 }))
        .sort((a, b) => b.market - a.market)

      // ⚠️ **목록에는 대표 등급 하나만 싣는다.** 타일이 그것만 보여 주는데 17줄을 다 실으면
      //    덩치의 83%가 안 쓰는 것이다(한 장 3,669 → 643바이트). 나머지는 카드를 눌렀을 때
      //    `?grades=`로 받아 간다. 총 낙찰 건수는 **자르기 전에** 세어 둔다 — 자른 뒤에 세면
      //    타일의 「낙찰 727건」이 대표 등급 건수(511)로 줄어들어 사실과 달라진다.
      const 등급전부 = 등급빚기(등급)
      const 총낙찰 = 등급전부.reduce((s, g) => s + g.count, 0)
      const grades = 등급전부.slice(0, 1)

      return {
        // ⚠️⚠️ **번호가 없는 카드에도 남과 겹치지 않는 열쇠를 준다.** 화면이 이 값으로
        //    타일을 구분하고 고른 카드를 기억하는데, 9%(구판·프로모)는 PPT 번호가 없어
        //    전부 빈 문자열이 된다 — 그러면 그 카드들이 **한 장으로 뭉쳐** 아무거나 눌러도
        //    같은 것이 열리고, 「더 보기」의 겹침 거르기가 뒤쪽을 통째로 지운다.
        //    숫자로 시작하지 않게 지어 저쪽 번호와 절대 헷갈리지 않게 한다.
        tcgPlayerId: c.tcg || `no-tcg.${c.slug}.${c.n}`,
        name: c.name,
        // 이베이에서 직접 찾아보기 링크가 쓰는 원본 이름. 한글로는 매물이 한 건도 안 잡힌다.
        nameEn: c.en,
        setName: set?.[0] ?? '',
        setNameEn: set?.[0] ?? '',
        // ⚠️ **`도감번호()`를 거친다.** 색인의 `n`에는 「85~669812」·「#577029」처럼
        //    저쪽 내부번호가 붙은 것이 있어, 그대로 내면 뜻 없는 숫자가 카드 번호인
        //    척 붙는다(2026-08-11에 옛 길에서 잡았던 것과 같은 함정 — 잣대를 나눠 쓴다).
        cardNumber: 도감번호(c.n),
        // ⚠️ **타일에도 레어도를 보여 준다.** 색인에 넣어 놓고 빈 문자열로 보내고 있었다
        //    (2026-08-12에 잡음). 같은 이름 카드가 여럿일 때(기본판·SR·SAR) 레어도가 없으면
        //    어느 것인지 못 가리는데, 값이 크게 갈리는 자리다(사장님 지시 2026-08-09).
        // ⚠️ 저쪽이 「None」이라 준 것은 안 적는다 — 화면에 「None」이 그대로 나간다.
        rarity: c.rare && c.rare !== 'None' ? c.rare : '',
        imageUrl: c.img,
        // ⚠️ **그림이 그 카드 것이 아니라 같은 번호의 일반판 것**일 때 화면이 밝히게 한다.
        //    저쪽 CDN에 무늬 변종 그림이 없어(403) 뒷면이 나오던 자리를 메운 것이다.
        imgBase: c.일반판그림 || undefined,
        // ⚠️ **카드에 찍힌 번호.** 옛 일본 세트는 우리 번호와 실물이 달라, 화면은 이걸 보여 준다.
        printNo: c.인쇄번호 || undefined,
        totalSales: 총낙찰,
        monthlySales: null,
        tcgplayer: 대표
          ? {
              market: 대표.m,
              low: 대표.l ?? 0,
              sellers: 0,
              printing: 대표.printing,
              ...(인쇄줄.length > 1 ? { printings: 인쇄줄 } : {}),
              condition: null,
              lastUpdated: null,
              url: c.tcg ? `https://www.tcgplayer.com/product/${c.tcg}` : '',
              history: [],
            }
          : null,
        grades,
        // 등급이 더 있다는 표시. 화면이 이걸 보고 카드를 열 때 나머지를 받아 온다.
        // ⚠️ 없으면 화면이 "이 카드는 등급이 하나뿐"으로 알고 **표를 반쪽만** 보여 준다.
        gradesTrimmed: 등급전부.length > grades.length,
        // 새 길에만 있는 칸 — 감정 수량을 같이 낸다(옛 길은 카드를 열어야 나왔다).
        population: 팝 ?? null,
        slug: c.slug,
      }
    })

    sendJson(res, 200, {
      cards,
      total: 총,
      // 천장에 걸려 잘랐으면 밝힌다. **말없이 자르면 「이게 전부」로 읽힌다.**
      잘림: 총 > 이쪽.length ? 낼수있는최대 : 0,
      받은날: { 시세: exportOkDay.printings ?? exportOkDay.cards ?? null, 낙찰: exportOkDay.ebay ?? null, 팝수: exportOkDay.population ?? null },
    })
  })
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
      // ⚠️ **세트 이름도 한글로 보낸다.** 카드 이름만 옮기고 세트 이름은 원어로 보내고
      //    있어서 홈 제목이 `M6: Storm Emeralda 힛카드 목록`으로 나갔다(2026-08-09에
      //    브라우저로 확인). 원어(`name`)는 그대로 두고 한글을 따로 얹는다 — 화면이
      //    한글을 먼저 쓰고, 없으면 원어로 되돌아간다.
      nameKo: koSet(고른것.ed ?? 'ja', 고른것.name ?? ''),
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
  환경 = env
  // 사진 판독 결과와 하루 몫을 이어받는다(한 번 읽은 매물을 다시 읽지 않으려고).
  void slab상태읽기()
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
  // 시세 길(2026-08-12). ⚠️ **옛 길은 2026-08-13에 지웠다** — 이제 이것 하나뿐이다.
  // ⚠️ 열쇠를 넘기는 것은 **카드를 열 때 추이·낱개를 받아 오기 위해서**다. 검색 자체는
  //    여전히 크레딧 0이고, 저쪽을 부르는 자리는 `카드기록받기` 하나뿐이다.
  mountCardBoard(app, env.POKEMON_PRICE_TRACKER_API_KEY ?? '')
  mountPopulationAndSealed(app, env.POKEMON_PRICE_TRACKER_API_KEY ?? '')
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
