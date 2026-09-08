/**
 * **카드 공유용 가로 그림**(`/og/card/<번호>.jpg`)을 그때그때 만들어 낸다.
 *
 * ⚠️⚠️ **왜 만드나 — 카톡이 세로 카드를 잘라 버린다.**
 *    카드 그림은 286×400으로 세로가 길다. 카톡 미리보기 상자는 가로가 긴 1.91:1이라
 *    가운데만 남기고 **위아래 125px씩 잘라 낸다** — 받아 본 사람은 카드 가운데 띠만
 *    보게 된다(2026-08-31 사장님 지적, 실측 확인). 스니커덩크 그림(1000×730)은 가로가
 *    길어 멀쩡히 나왔다. 그래서 **1200×630 가로 판**을 따로 그려 준다.
 *
 * ⚠️ **디스크에 안 쌓는다.** 볼륨이 4.9GB인데 그림 캐시가 이미 2.2GB다. 여기서 더
 *    쌓으면 30주년 신팩이 들어올 때 서로 밀어낸다. 만드는 데 0.15초뿐이라 메모리에만
 *    얼마간 들고 있다가 버린다 — 카톡·구글은 한 번 받아 가면 자기들이 오래 캐시한다.
 *
 * ⚠️ 그림 라이브러리는 **순수 자바스크립트(pureimage)**를 쓴다. sharp는 빠르지만
 *    이 배포가 alpine이라 네이티브 모듈이 어긋날 수 있다(사장님 결정 2026-08-31).
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import * as PI from 'pureimage'

type Mountable = { get: (p: string, h: (req: any, res: any) => void) => void }

// ⚠️ 시안과 같은 1200×630. 카톡은 가로 300px쯤으로 줄여 보여 주는데 화면이 3배
//    촘촘하므로 900px어치가 필요하다 — 610px로 만들면 흐릿해진다.
const W = 1200
const H = 630
const 바탕 = '#141414'
const 면 = '#1a1a1a'
const 밝은글 = '#ededed'
const 옅은글 = '#a3a3a3'

// 한 장 약 100KB. 150장이면 15MB쯤이고, 그 이상은 오래된 것부터 버린다.
const 담을수 = 150
const 담은것 = new Map<string, Buffer>()

let 글꼴준비: Promise<void> | null = null
function 글꼴읽기(DIST: string): Promise<void> {
  // ⚠️ 첫 요청 때 한 번만 읽는다. 4.9MB짜리 글꼴 둘이라 기동 때 읽으면 서버가 늦게 뜬다.
  // ⚠️ 한 번 실패하면 기억을 지운다. 안 그러면 글꼴 파일이 잠깐 없었다는 이유로
  //    **서버가 살아 있는 내내** 그림을 못 만든다(실패한 약속이 그대로 남는다).
  글꼴준비 ??= (async () => {
    PI.registerFont(path.join(DIST, 'fonts', 'NotoSansKR-Regular.ttf'), 'ko', 400, 'normal').loadSync()
    PI.registerFont(path.join(DIST, 'fonts', 'NotoSansKR-Bold.ttf'), 'kob', 700, 'normal').loadSync()
  })().catch((e) => {
    글꼴준비 = null
    throw e
  })
  return 글꼴준비
}

/**
 * 그림 가장자리의 **흰 여백을 잘라 낸다.**
 *
 * ⚠️ 스니커덩크 그림은 1000×730 흰 판 가운데에 카드가 놓여 있다(442×620). 그대로 얹으면
 *    어두운 바탕 위에 **흰 네모**가 앉는다. TCGplayer 그림도 조금씩 여백이 있다.
 * ⚠️ 너무 많이 잘리면(원래의 4분의 1 미만) 흰 카드를 통째로 지운 것일 수 있으니 그냥 둔다.
 */
function 흰여백빼기(bm: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }) {
  const { width: w, height: h, data } = bm
  const 흰가 = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return data[i] > 243 && data[i + 1] > 243 && data[i + 2] > 243
  }
  let L = w, R = -1, T = h, B = -1
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (!흰가(x, y)) {
        if (x < L) L = x
        if (x > R) R = x
        if (y < T) T = y
        if (y > B) B = y
      }
    }
  }
  if (R < 0 || B < 0) return { x: 0, y: 0, w, h }
  const 여 = 4
  const x = Math.max(0, L - 여)
  const y = Math.max(0, T - 여)
  const cw = Math.min(w - x, R - L + 여 * 2)
  const chh = Math.min(h - y, B - T + 여 * 2)
  if (cw * chh < w * h * 0.25) return { x: 0, y: 0, w, h }
  return { x, y, w: cw, h: chh }
}

/** 글씨가 상자를 넘치면 뒤를 …으로 줄인다. 긴 카드 이름이 값 위로 넘어가면 안 된다. */
function 줄이기(c: any, 글: string, 최대: number): string {
  if (c.measureText(글).width <= 최대) return 글
  let s = 글
  while (s.length > 1 && c.measureText(s + '…').width > 최대) s = s.slice(0, -1)
  return s + '…'
}

type 스니커 = { name: string; image: string; price: number } | null

export function mountOgCard(
  app: Mountable,
  DIST: string,
  요약읽기: (id: string) => Promise<{
    이름: string
    세트: string
    번호: string
    그림?: string
    티피?: number
    등급?: { 이름: string; 값: number; 건수: number }
  } | null>,
  등급표기: (s: string) => string,
  스니커읽기?: (id: string) => Promise<스니커>,
  원화?: (usd: number) => string | null,
) {
  // ── 스니커덩크 공유(/c/<번호>)도 같은 판으로 ─────────────────────────────
  // ⚠️ 스니커덩크가 주는 그림은 **흰 판 가운데 카드**라 그냥 쓰면 이베이·TCG 공유와
  //    모양이 달랐다(사장님 지적 2026-08-31). 흰 여백을 잘라 내고 같은 틀에 얹는다.
  // ⚠️ 주소가 `.webp`인데 pureimage는 webp를 못 읽는다. **같은 주소의 `.jpg`가 있다**
  //    (실측 확인) — 확장자만 바꿔 받는다.
  app.get('/og/c/:file', async (req, res) => {
    const id = String(req.params.file ?? '').replace(/\.jpg$/i, '')
    if (!/^\d+$/.test(id) || !스니커읽기) {
      res.status(404).end()
      return
    }
    const 열쇠 = `c:${id}`
    const 있는것 = 담은것.get(열쇠)
    if (있는것) {
      담은것.delete(열쇠)
      담은것.set(열쇠, 있는것)
      res.set('content-type', 'image/jpeg').set('Cache-Control', 'public, max-age=86400').send(있는것)
      return
    }
    try {
      const 것 = await 스니커읽기(id)
      if (!것?.image || !것.name) {
        res.status(404).end()
        return
      }
      const buf = await 그리기(
        DIST,
        {
          이름: 것.name,
          세트: '',
          번호: '',
          그림: 것.image.replace(/\.webp$/i, '.jpg'),
          엔값: 것.price > 0 ? 것.price : undefined,
        },
        등급표기,
        원화,
      )
      담은것.set(열쇠, buf)
      while (담은것.size > 담을수) 담은것.delete(담은것.keys().next().value as string)
      res.set('content-type', 'image/jpeg').set('Cache-Control', 'public, max-age=86400').send(buf)
    } catch {
      res.status(404).end()
    }
  })
  app.get('/og/card/:file', async (req, res) => {
    const id = String(req.params.file ?? '').replace(/\.jpg$/i, '')
    if (!/^\d+$/.test(id)) {
      res.status(404).end()
      return
    }
    const 있는것 = 담은것.get(id)
    if (있는것) {
      담은것.delete(id)
      담은것.set(id, 있는것) // 최근 쓴 것으로 올린다
      res.set('content-type', 'image/jpeg').set('Cache-Control', 'public, max-age=86400').send(있는것)
      return
    }
    try {
      const 것 = await 요약읽기(id)
      if (!것?.그림) {
        res.status(404).end()
        return
      }
      const buf = await 그리기(DIST, 것, 등급표기, 원화)
      담은것.set(id, buf)
      // 오래된 것부터 버린다.
      while (담은것.size > 담을수) 담은것.delete(담은것.keys().next().value as string)
      res.set('content-type', 'image/jpeg').set('Cache-Control', 'public, max-age=86400').send(buf)
    } catch {
      // ⚠️ 실패하면 404로 둔다. 그러면 페이지에 적힌 예비 그림(카드 원본)이 쓰인다 —
      //    깨진 그림을 내보내는 것보다 낫다.
      res.status(404).end()
    }
  })
}

async function 그리기(
  DIST: string,
  것: {
    이름: string
    세트: string
    번호: string
    그림?: string
    티피?: number
    등급?: { 이름: string; 값: number; 건수: number }
    엔값?: number
  },
  등급표기: (s: string) => string,
  원화?: (usd: number) => string | null,
): Promise<Buffer> {
  await 글꼴읽기(DIST)
  const img = PI.make(W, H)
  const c = img.getContext('2d')
  c.fillStyle = 바탕
  c.fillRect(0, 0, W, H)

  // 카드 — 세로를 채우되 위아래 여백을 둔다.
  const r = await fetch(것.그림!, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) throw new Error('card image')
  const 원본 = Buffer.from(await r.arrayBuffer())
  const 통 = new PassThrough()
  통.end(원본)
  const card = 원본[0] === 0x89 ? await PI.decodePNGFromStream(통) : await PI.decodeJPEGFromStream(통)
  const 속 = 흰여백빼기(card as unknown as { width: number; height: number; data: Uint8Array })
  const ch = 470
  const cw = Math.round((속.w * ch) / 속.h)
  const cx = 96
  const cy = Math.round((H - ch) / 2)
  c.fillStyle = 면
  c.fillRect(cx - 8, cy - 8, cw + 16, ch + 16)
  c.drawImage(card, 속.x, 속.y, 속.w, 속.h, cx, cy, cw, ch)

  const x = cx + cw + 72
  const 폭 = W - x - 72
  c.fillStyle = 밝은글
  c.font = "48pt 'kob'"
  c.fillText(줄이기(c, 것.이름, 폭), x, 196)
  const 밑줄 = `${것.세트} ${것.번호}`.trim()
  if (밑줄) {
    c.fillStyle = 옅은글
    c.font = "30pt 'ko'"
    c.fillText(줄이기(c, 밑줄, 폭), x, 244)
  }

  // 값 — 미감정 싱글을 크게, 등급 낙찰을 아래 한 줄로.
  const 큰라벨 = 것.엔값
    ? '스니커덩크 최저가'
    : 것.티피
      ? '미감정 싱글'
      : 것.등급
        ? `${등급표기(것.등급.이름)} 낙찰`
        : ''
  // ⚠️ 달러값은 **원화 어림값**으로 바꿔 그린다(사장님 지시 2026-08-31).
  //    엔값(스니커덩크)은 그대로 둔다 — 그쪽 화면도 엔으로 보여 준다.
  const 달러글 = (v: number) => 원화?.(v) ?? `$${v.toLocaleString()}`
  const 큰값 = 것.엔값
    ? `¥${것.엔값.toLocaleString()}`
    : 것.티피
      ? 달러글(것.티피)
      : 것.등급
        ? 달러글(것.등급.값)
        : ''
  if (큰값) {
    c.fillStyle = 옅은글
    c.font = "30pt 'ko'"
    c.fillText(큰라벨, x, 318)
    c.fillStyle = 밝은글
    c.font = "68pt 'kob'"
    c.fillText(줄이기(c, 큰값, 폭), x, 392)
  }
  if (것.티피 && 것.등급) {
    c.fillStyle = 옅은글
    c.font = "32pt 'ko'"
    c.fillText(
      줄이기(c, `${등급표기(것.등급.이름)} 낙찰 ${달러글(것.등급.값)} · ${것.등급.건수}건`, 폭),
      x,
      456,
    )
  }

  // 로고 — 글꼴로 그리지 않고 앱 아이콘에서 떼어 둔 그림을 얹는다(로고가 어긋나지 않게).
  //
  // ⚠️⚠️ **createReadStream 을 그대로 넘기면 안 된다.** 파일이 없으면 스트림이
  //    `error` 이벤트를 던지는데, 아무도 안 받으면 **Node가 프로세스를 죽인다** —
  //    try/catch로도 못 잡는다. 실제로 서버가 통째로 내려갔다(2026-08-31 시험 중).
  //    먼저 통째로 읽어 두면(readFile) 그 실패는 평범한 예외라 아래 catch가 받는다.
  try {
    const wmBuf = await readFile(path.join(DIST, 'wordmark.png'))
    const wmS = new PassThrough()
    wmS.end(wmBuf)
    const wm = await PI.decodePNGFromStream(wmS)
    const ww = 190
    c.drawImage(wm, 0, 0, wm.width, wm.height, x, H - 118, ww, Math.round((wm.height * ww) / wm.width))
  } catch {
    /* 로고가 없어도 그림은 나간다 */
  }

  const 밖 = new PassThrough()
  const 조각: Buffer[] = []
  밖.on('data', (b: Buffer) => 조각.push(b))
  const 끝 = new Promise<void>((ok) => 밖.on('end', () => ok()))
  await PI.encodeJPEGToStream(img, 밖, 82)
  await 끝
  return Buffer.concat(조각)
}

// 파일이 있는지 미리 봐 두는 용도(서버 기동 로그).
export async function og글꼴있나(DIST: string): Promise<boolean> {
  try {
    await readFile(path.join(DIST, 'fonts', 'NotoSansKR-Bold.ttf'))
    return true
  } catch {
    return false
  }
}
