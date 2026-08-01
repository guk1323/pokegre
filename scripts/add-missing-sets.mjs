// 세트별 목록에 빠져 있는 일본판 세트를 limitless에서 받아 붙인다.
//
// 왜 TCGdex가 아니라 limitless인가:
//   TCGdex는 이 세트들을 목록에는 갖고 있으면서 카드는 0장으로 준다(원본 데이터 구멍).
//   2026-08-01 실측 — S4a는 cardCount 190인데 cards 0장, S8b·SM8b·XY2도 마찬가지다.
//   반면 limitless에는 다 있다(S4a 326장, S8b 277장). 우리 카드 뽑기가 이미 쓰는 곳이다.
//   ⚠️ 그래서 이걸 "TCGdex가 느려서"로 오해하지 말 것. 몇 번을 다시 물어도 0장이다.
//
// 이미 있는 파일과 목록 항목은 건드리지 않는다. 빠진 것만 받아 붙인다.
//
// 쓰기: node scripts/add-missing-sets.mjs          (받아보기만)
//       node scripts/add-missing-sets.mjs --write  (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (r.ok) return await r.text()
    } catch {
      /* 재시도 */
    }
    await sleep(1500 + i * 1500)
  }
  return null
}

// limitless 목록 화면에서 번호·이름·그림을 뽑는다(세트당 요청 1번).
// gen-packsim.mjs와 같은 표를 읽지만, 여기서는 레어도가 없어도 버리지 않는다 —
// 세트별 목록은 전종을 보여주는 화면이라 한 장이라도 빠지면 구멍으로 보인다.
function parseCards(html) {
  const cards = []
  for (const [, hover, body] of html.matchAll(/<tr data-hover="([^"]+)">(.*?)<\/tr>/gs)) {
    const td = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => strip(m[1]))
    const [, n, name] = td
    if (!n || !name) continue
    cards.push({ n: String(n).padStart(3, '0'), name, img: hover.replace('_XS.png', '_SM.png') })
  }
  // limitless 목록에 같은 줄이 두 번 나오는 세트가 있다(XY7·CP4의 기라티나EX).
  // 번호+이름이 같으면 한 장만 남긴다 — 안 그러면 세트 화면에 같은 카드가 두 번 뜬다.
  const seen = new Set()
  return cards.filter((c) => {
    const key = `${c.n}|${c.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ⚠️ TCGdex와 limitless가 같은 코드를 다른 세트에 쓰는 곳이 있다. 코드만 보고 받으면
// 엉뚱한 카드가 들어간다(2026-08-01에 실제로 걸러냈다).
//   TCGdex XY8b(赤い閃光)  ↔ limitless XY8b는 Blue Counterattack — 다른 세트다
//   TCGdex XY11b(冷酷の反逆者) ↔ limitless XY11b는 Heat Burst Fighter — 다른 세트다
// 아래는 이름을 하나씩 맞춰 확인한 짝이다.
const CODE_MAP = {
  XY8b: 'XY8r',   // 赤い閃光 = Red Light Flash
  XY8a: 'XY8b',   // 青い衝撃 = Blue Counterattack
  XY11b: 'XY11r', // 冷酷の反逆者 = Cruel Traitor
  XY11a: 'XY11b', // 爆熱の闘士 = Heat Burst Fighter
  XY5a: 'XY5g',   // ガイアボルケーノ = Gaia Volcano
  XY5b: 'XY5t',   // タイダルストーム = Tidal Storm
  sn10a: 'SM10a', // ジージーエンド = GG End
  sn11: 'SM11',   // ミラクルツイン = Miracle Twin
  XY1a: 'XY1x',   // コレクションX = Collection X
  XY1b: 'XY1y',   // コレクションY = Collection Y
  'SM1+': 'SM1p', // サン＆ムーン = Sun and Moon plus
  'sm2+': 'SM2p', // 新たなる試練の向こう = Let's Face New Trials
  'SM3+': 'SM3p', // ひかる伝説 = Shining Legends
  'SM4+': 'SM4p', // GXバトルブースト = GX Battle Boost
  'SM5+': 'SM5p', // ウルトラフォース = Ultra Force
}

// TCGdex 목록에 아직 없지만 limitless에는 있는 세트(새로 나온 것). 직접 적어 둔다.
// 여기 적힌 것은 TCGdex를 거치지 않으므로 발매일·시리즈도 같이 적는다.
const EXTRA = [
  { id: 'M6', name: 'ストームエメラルダ', releaseDate: '2026-07-31', serie: 'ポケモンカードゲーム MEGA' },
]

// TCGdex 쪽이 망가진 항목. CS로 시작하는 16개가 전부 "トリプレットビート 101장"으로
// 똑같이 들어 있다(실제로는 한 세트다). 받으면 같은 세트가 16번 나온다.
const SKIP = /^CS/i

// limitless 일본판은 BW 시대부터만 있다. 그 앞(ADV·L·PCG10)은 여기서 못 받는다.
const llCode = (id) => CODE_MAP[id] ?? id

async function main() {
  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
  const have = new Set(index.map((x) => x.slug))

  // TCGdex 목록은 "어떤 세트가 있는가"를 아는 데만 쓴다(발매일·시리즈도 여기서 온다).
  const list = await get('https://api.tcgdex.net/v2/ja/sets').then((t) => (t ? JSON.parse(t) : null))
  if (!Array.isArray(list)) return console.log('세트 목록 받기 실패')
  const missing = list.filter((s) => !have.has(`ja-${s.id}`))
  console.log(`일본판 전체 ${list.length}개 / 우리에게 없는 것 ${missing.length}개\n`)

  const added = []
  const failed = []
  for (const s of missing) {
    if (SKIP.test(s.id)) {
      failed.push(`${s.id}(TCGdex 중복)`)
      continue
    }
    const html = await get(`https://limitlesstcg.com/cards/jp/${llCode(s.id)}?display=list`)
    const cards = html ? parseCards(html) : []
    if (cards.length === 0) {
      failed.push(s.id)
      await sleep(500)
      continue
    }
    // 발매일·시리즈는 TCGdex 상세에 있다(카드는 비어도 이건 준다).
    const meta = await get(`https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(s.id)}`).then((t) => (t ? JSON.parse(t) : null))
    const slug = `ja-${s.id}`
    if (WRITE) {
      await writeFile(path.join(OUT, `${slug}.json`), JSON.stringify({ ed: 'ja', id: s.id, name: s.name, cards }))
    }
    index.push({
      slug,
      ed: 'ja',
      id: s.id,
      name: s.name,
      count: cards.length,
      releaseDate: meta?.releaseDate ?? '',
      serie: meta?.serie?.name ?? '',
      logo: meta?.logo ?? '',
      cover: cards[0]?.img ?? '',
    })
    added.push(`${slug} ${cards.length}장 ${meta?.releaseDate ?? ''} ${s.name}`)
    console.log(`  + ${slug} ${cards.length}장 ${s.name}`)
    await sleep(600)
  }

  // TCGdex에 아직 없는 새 세트
  for (const e of EXTRA) {
    if (have.has(`ja-${e.id}`) || index.some((x) => x.slug === `ja-${e.id}`)) continue
    const html = await get(`https://limitlesstcg.com/cards/jp/${llCode(e.id)}?display=list`)
    const cards = html ? parseCards(html) : []
    if (cards.length === 0) {
      failed.push(`${e.id}(limitless 실패)`)
      continue
    }
    if (WRITE) {
      await writeFile(path.join(OUT, `ja-${e.id}.json`), JSON.stringify({ ed: 'ja', id: e.id, name: e.name, cards }))
    }
    index.push({
      slug: `ja-${e.id}`,
      ed: 'ja',
      id: e.id,
      name: e.name,
      count: cards.length,
      releaseDate: e.releaseDate,
      serie: e.serie,
      logo: '',
      cover: cards[0]?.img ?? '',
    })
    added.push(`ja-${e.id} ${cards.length}장 ${e.releaseDate} ${e.name}`)
    console.log(`  + ja-${e.id} ${cards.length}장 ${e.name} (TCGdex에 없어 직접 적어 둔 것)`)
    await sleep(600)
  }

  index.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
  if (WRITE) await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))

  console.log(`\n새로 받은 세트 ${added.length}개`)
  if (failed.length) console.log(`limitless에도 없어 못 받은 것 ${failed.length}개: ${failed.join(', ')}`)
  console.log(`합계 ${index.length}개 (ja ${index.filter((x) => x.ed === 'ja').length} · en ${index.filter((x) => x.ed === 'en').length})`)
  if (!WRITE) console.log('\n저장하려면 --write')
}

main()
