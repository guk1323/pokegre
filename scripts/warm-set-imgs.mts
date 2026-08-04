// 세트별 목록 화면의 카드 그림을 미리 받아 서버 캐시에 넣어 둔다.
//
// 왜 필요한가: 어떤 세트를 처음 여는 사람은 카드 그림 수십 장을 그 자리에서 원본
// (tcgdex·limitless 등)에서 받아 오느라 기다린다. 한 번 받아 두면 그 뒤로는
// /data/imgcache에서 바로 나간다(디스크 캐시는 만료가 없다 — 400MB를 넘을 때만
// 안 쓰인 것부터 지운다).
//
// ⚠️ 반드시 화면과 똑같은 주소로 받아야 캐시가 맞는다. 캐시 열쇠가 주소이기 때문에
//    한 글자만 달라도 딴 칸에 담겨 헛일이 된다. 그래서 앱과 같은 cardImg()/thumb()를
//    가져다 쓴다. (2026-08-05: tcgdex 주소에 /high.webp를 안 붙이고 재 봤다가
//    "302라 캐시가 안 된다"고 잘못 판단할 뻔했다.)
//
// 쓰는 법:
//   npx tsx scripts/warm-set-imgs.mts                 (운영 서버, 세트당 16장)
//   npx tsx scripts/warm-set-imgs.mts --per 24        (세트당 장수 바꾸기)
//   npx tsx scripts/warm-set-imgs.mts --host http://localhost:3970
//   npx tsx scripts/warm-set-imgs.mts --dry           (받지 않고 몇 장인지만)
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { cardImg, thumb, usable } from '../src/lib/cardImg.ts'

const SETS = path.resolve(process.cwd(), 'public/sets')
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const HOST = arg('--host', 'https://pokegre.com').replace(/\/$/, '')
// 세트를 열면 커버 1장 + 카드 격자 60장이 그려진다. 60장을 다 데우면 371세트 ×
// 60장 = 2.2만 장(약 445MB)이라 캐시 상한(400MB)을 넘어 서로 밀어낸다.
// 첫 화면에 실제로 보이는 윗부분만 데운다.
const PER = Number(arg('--per', '16'))
const DRY = process.argv.includes('--dry')
// 원본(무료 CDN)에 무리를 주지 않도록 동시에 4개까지만.
const CONCURRENCY = 4
// 격자는 320px, 세트 커버는 128px로 그린다(SetsView와 같아야 한다).
const GRID_W = 320
const COVER_W = 128

interface SetCard {
  n: string
  img?: string
}

async function main() {
  const index = JSON.parse(await readFile(path.join(SETS, 'index.json'), 'utf8')) as {
    slug: string
    name?: string
    cover?: string
  }[]

  const urls: string[] = []
  const seen = new Set<string>()
  const add = (u: string) => {
    if (!u || seen.has(u)) return
    seen.add(u)
    urls.push(u)
  }

  let missing = 0
  let hitTotal = 0
  for (const s of index) {
    if (s.cover) add(thumb(cardImg(s.cover), COVER_W))
    let cards: SetCard[]
    try {
      cards = (JSON.parse(await readFile(path.join(SETS, `${s.slug}.json`), 'utf8')) as { cards?: SetCard[] }).cards ?? []
    } catch {
      missing++
      continue
    }
    // ⚠️ 힛카드를 먼저 넣는다. 세트를 열면 화면 맨 위에 뜨는 게 이 8장인데,
    //    값이 높은 카드라 거의 다 뒷번호다(클레이버스트는 89·96·93…).
    //    "앞 16장"만 데웠다가 정작 제일 잘 보이는 자리가 하나도 안 데워진 걸
    //    화면에서 확인했다(2026-08-05). 격자 앞부분보다 이쪽이 먼저다.
    const byNum = new Map(cards.map((c) => [String(Number(c.n)), c]))
    try {
      const r = await fetch(`${HOST}/api/local/set-hit-cards?slug=${encodeURIComponent(s.slug)}&limit=8`)
      const d = r.ok ? ((await r.json()) as { priced?: boolean; cards?: { n: string }[] }) : null
      if (d?.priced) {
        for (const h of d.cards ?? []) {
          const c = byNum.get(String(Number(h.n)))
          if (c && usable(c.img)) {
            add(thumb(cardImg(c.img!), GRID_W))
            hitTotal++
          }
        }
      }
    } catch {
      /* 시세를 못 받은 세트는 격자만 데운다 */
    }
    for (const c of cards.filter((c) => usable(c.img)).slice(0, PER)) {
      add(thumb(cardImg(c.img!), GRID_W))
    }
  }
  console.log(`세트 ${index.length}개 · 세트당 힛카드 8장 + 격자 앞 ${PER}장 → 받을 그림 ${urls.length.toLocaleString()}장`)
  console.log(`  (그 중 힛카드 ${hitTotal.toLocaleString()}장 — 세트를 열면 맨 위에 뜨는 자리)`)
  if (missing) console.log(`  (세트 파일을 못 읽어 건너뛴 것 ${missing}개)`)
  if (DRY) return

  let done = 0
  let ok = 0
  let redirect = 0
  let fail = 0
  let bytes = 0
  const started = Date.now()
  let next = 0

  async function worker() {
    for (;;) {
      const i = next++
      if (i >= urls.length) return
      try {
        // redirect: 'manual' — 302(tcgplayer처럼 wsrv가 막는 원본)는 캐시에 안 담기므로
        // 따라가 봐야 우리 캐시에 도움이 안 된다. 세지만 하고 넘어간다.
        const r = await fetch(HOST + urls[i], { redirect: 'manual' })
        if (r.status === 200) {
          bytes += (await r.arrayBuffer()).byteLength
          ok++
        } else if (r.status >= 300 && r.status < 400) redirect++
        else fail++
      } catch {
        fail++
      }
      done++
      if (done % 250 === 0) {
        const s = (Date.now() - started) / 1000
        const left = Math.round(((urls.length - done) * s) / done)
        console.log(
          `  ${done.toLocaleString()}/${urls.length.toLocaleString()} · 담김 ${ok.toLocaleString()} · ` +
            `원본넘김 ${redirect} · 실패 ${fail} · ${Math.round(bytes / 1024 / 1024)}MB · 남은 시간 ${Math.floor(left / 60)}분`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  const mins = ((Date.now() - started) / 60000).toFixed(1)
  console.log(
    `\n끝났습니다 (${mins}분). 캐시에 담김 ${ok.toLocaleString()}장 · ${Math.round(bytes / 1024 / 1024)}MB\n` +
      `원본으로 넘긴 것 ${redirect}장(tcgplayer는 프록시가 막혀 원래 이렇게 나간다) · 실패 ${fail}장`,
  )
}

main()
