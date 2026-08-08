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
// ⚠️ 번호를 Number()로 바꾸면 안 된다 — RC5·TG01·24a가 전부 NaN 한 칸에 뭉친다
//    (src/lib/cardNo.ts 설명 참고). 앞의 0만 뗀다.
import { 번호열쇠 } from '../src/lib/cardNo.ts'
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
// ⚠️ 폭이 캐시 열쇠에 들어간다. SetsView가 그리는 폭과 하나라도 다르면 딴 칸에
//    담겨 데운 게 헛일이 된다(2026-08-05: 목록 썸네일이 200px인데 128px로 데워
//    목록 화면이 하나도 안 빨라져 있었다).
const GRID_W = 320 // 세트 안 카드 격자
const COVER_W = 128 // 세트 상세 머리의 작은 표지
const LIST_W = 200 // 세트 목록의 세로 타일
const ARTIST_LIST_W = 140 // 작가 목록의 표지 (ArtistsView 455줄)
const ARTIST_COVER_W = 200 // 작가 상세 머리의 표지 (ArtistsView 250줄)
const ARTIST_CARD_W = 240 // 작가 상세의 카드 격자 (ArtistsView 317줄)
const ARTIST_PAGE = 60 // 작가 상세가 처음 보여주는 장수 (ArtistsView PAGE)
const ARTIST_TOP = 20 // 조회가 많은 작가 몇 명까지 카드를 데울지

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

  // 작가 목록 화면의 표지 388장(140px). 세트와 똑같이 안 데워져 있어서 첫 화면
  // 12칸에 1,310ms가 걸렸다(2026-08-05 실측). 한 장이 6KB라 통째로 데워도 2MB다.
  // ⚠️ ArtistsView는 cardImg()를 안 쓰고 표지 주소를 그대로 넘긴다. 여기서도 그대로 둔다.
  try {
    const artists = JSON.parse(await readFile(path.resolve(process.cwd(), 'public/artists/index.json'), 'utf8')) as {
      cover?: string
    }[]
    let n = 0
    for (const a of artists) {
      if (a.cover) {
        add(thumb(a.cover, ARTIST_LIST_W))
        n++
      }
    }
    console.log(`작가 목록 표지 ${n}장`)

    // 작가 한 명을 열면 카드 60장이 뜬다. 388명을 다 데우면 2.3만 장(약 280MB)이라
    // 캐시 상한을 넘는다. 그래서 "실제로 열어 본 작가"만 데운다 — 운영 기록으로는
    // 위 20명이 전체 조회의 대부분이다(2026-08-05: 56명 133회 중 상위 20명이 100회).
    // ⚠️ 조회 기록의 열쇠는 영어 이름이라 slug가 아니다. 이름으로 맞춘다.
    // 기록은 서버 파일에만 있고 공개 주소가 없다. 아래로 받아서 --stats로 넘긴다:
    //   fly ssh console -a pokegre -C "cat /data/artist-stats.json" | tail -1 > /tmp/art.json
    //   npx tsx scripts/warm-set-imgs.mts --stats /tmp/art.json
    // 안 넘기면 작가 카드 격자는 건너뛴다(짐작으로 데우면 안 보는 걸 데우게 된다).
    const statsPath = arg('--stats', '')
    let wanted = new Set<string>()
    if (statsPath) {
      try {
        const tally = JSON.parse(await readFile(statsPath, 'utf8')) as Record<string, number>
        wanted = new Set(
          Object.entries(tally)
            .sort((a, b) => b[1] - a[1])
            .slice(0, ARTIST_TOP)
            .map(([name]) => name),
        )
      } catch {
        console.log(`  (조회 기록 파일을 못 읽었습니다: ${statsPath})`)
      }
    }
    let cardN = 0
    if (wanted.size) {
      for (const a of artists as { slug?: string; en?: string; ko?: string; cover?: string }[]) {
        if (!a.slug || !wanted.has(a.en ?? '')) continue
        if (a.cover) add(thumb(a.cover, ARTIST_COVER_W)) // 상세 머리의 큰 표지
        try {
          const f = JSON.parse(
            await readFile(path.resolve(process.cwd(), `public/artists/${a.slug}.json`), 'utf8'),
          ) as { cards?: { img?: string }[] }
          for (const c of (f.cards ?? []).slice(0, ARTIST_PAGE)) {
            if (c.img) {
              add(thumb(c.img, ARTIST_CARD_W))
              cardN++
            }
          }
        } catch {
          /* 파일이 없으면 그 작가는 건너뛴다 */
        }
      }
      console.log(`  많이 보는 작가 ${wanted.size}명의 첫 화면 카드 ${cardN.toLocaleString()}장`)
    } else {
      console.log('  (--stats 를 안 줘서 작가 카드 격자는 건너뜁니다)')
    }
  } catch {
    console.log('작가 목록을 못 읽어 건너뜁니다.')
  }

  // 세트 목록 타일이 쓰는 표지. 시세를 받아 둔 세트는 값이 제일 높은 카드를 표지로
  // 쓰므로(set-covers), 그걸 먼저 물어봐야 화면과 같은 주소가 된다.
  let covers: Record<string, string> = {}
  try {
    const r = await fetch(`${HOST}/api/local/set-covers`)
    covers = r.ok ? (((await r.json()) as { covers?: Record<string, string> }).covers ?? {}) : {}
  } catch {
    /* 못 받으면 index.json의 표지로 간다 */
  }
  console.log(`세트 목록 표지: 값 기준 표지 ${Object.keys(covers).length}개 + 나머지는 기본 표지`)

  let missing = 0
  let hitTotal = 0
  for (const s of index) {
    // 목록 화면(세로 타일, 200px)
    const listPick = usable(covers[s.slug]) ? covers[s.slug] : s.cover
    if (usable(listPick)) add(thumb(cardImg(listPick!), LIST_W))
    // 세트 상세 머리의 작은 표지(128px)
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
    const byNum = new Map(cards.map((c) => [번호열쇠(c.n), c]))
    try {
      const r = await fetch(`${HOST}/api/local/set-hit-cards?slug=${encodeURIComponent(s.slug)}&limit=8`)
      const d = r.ok ? ((await r.json()) as { priced?: boolean; cards?: { n: string }[] }) : null
      if (d?.priced) {
        for (const h of d.cards ?? []) {
          const c = byNum.get(번호열쇠(h.n))
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
