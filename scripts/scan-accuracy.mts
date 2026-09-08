// 사진 검색이 카드를 얼마나 맞히는지 잰다.
//
// 어떻게: 우리 세트 데이터에는 카드마다 정답(이름·번호·세트)과 공식 스캔 사진이 같이
// 있다. 그 사진을 그대로 스캔에 넣어 보면 답을 아는 채로 채점할 수 있다.
//
// ⚠️ 공식 스캔은 또렷하고 반듯해서 실제 폰 사진보다 쉽다. 여기 점수는 "잘 나와야 하는
//    조건에서의 상한"이지 실사용 정확도가 아니다. 여기서도 틀리면 진짜 문제다.
// ⚠️ Anthropic 요금이 든다(장당 1센트 안팎). 서버가 한 사람당 시간당 10번으로 막으므로
//    기본 8장만 본다.
//
// 실행: npx tsx scripts/scan-accuracy.mts [--n 8] [--host https://pokegre.com]
import { readFileSync, readdirSync } from 'node:fs'

const argOf = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const N = Number(argOf('n', '8'))
const HOST = argOf('host', 'https://pokegre.com')
const SEED = Number(argOf('seed', '1'))

// 되풀이할 수 있게 고정 순서로 고른다(Math.random을 쓰면 매번 다른 카드가 뽑혀
// 점수를 비교할 수 없다).
let seed = SEED
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

type Card = { n: string; name: string; img?: string }
const pool: { slug: string; setName: string; card: Card }[] = []
for (const f of readdirSync('public/sets')) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'ko-index.json') continue
  const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as { name?: string; cards?: Card[] }
  for (const c of d.cards ?? []) {
    // 공식 스캔만 쓴다. 판매자가 찍은 사진(스니커덩크)은 정답 사진이 아니다.
    if (c.img && !c.img.includes('snkrdunk')) pool.push({ slug: f.replace('.json', ''), setName: d.name ?? '', card: c })
  }
}
const picks: typeof pool = []
while (picks.length < N && pool.length) picks.push(pool[Math.floor(rand() * pool.length)])

const full = (u: string) => (/\.(png|jpe?g|webp)(\?|$)/i.test(u) ? u : `${u.replace(/\/$/, '')}/high.webp`)
const numKey = (s: string) => String(s ?? '').split('/')[0].trim().replace(/^0+(?=\d)/, '').toUpperCase()

let nameOk = 0
let numOk = 0
let found = 0
const times: number[] = []
console.log(`카드 ${picks.length}장으로 시험 · ${HOST}\n`)

for (const { slug, card } of picks) {
  const imgUrl = full(card.img as string)
  let b64 = ''
  let mediaType = 'image/webp'
  try {
    const r = await fetch(imgUrl)
    if (!r.ok) throw new Error(String(r.status))
    mediaType = r.headers.get('content-type') ?? mediaType
    b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
  } catch (e) {
    console.log(`  ? ${slug} ${card.n} — 사진을 못 받음(${e})`)
    continue
  }

  let out: Record<string, unknown> = {}
  const t0 = Date.now()
  try {
    const r = await fetch(`${HOST}/api/local/scan-card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: b64, mediaType }),
    })
    if (!r.ok) {
      console.log(`  ! ${slug} ${card.n} — 서버가 ${r.status}`)
      if (r.status === 429) break
      continue
    }
    out = (await r.json()) as Record<string, unknown>
  } catch (e) {
    console.log(`  ! ${slug} ${card.n} — ${e}`)
    continue
  }

  const ms = Date.now() - t0
  times.push(ms)
  if (out.found) found++
  const gotNum = numKey(String(out.cardNumber ?? ''))
  const wantNum = numKey(card.n)
  const numHit = !!gotNum && gotNum === wantNum
  if (numHit) numOk++
  // 이름은 영문으로 답하므로, 우리 이름과 견주려면 사람이 봐야 한다. 여기서는
  // "뭐라고 읽었는지"를 같이 찍어 두고 눈으로 채점한다.
  console.log(
    `  ${numHit ? '○' : '✗'} ${slug.padEnd(10)} ${card.n.padStart(4)}  정답: ${String(card.name).slice(0, 22).padEnd(22)}` +
      `읽은 것: ${String(out.pokemonNameEn ?? '(못읽음)').slice(0, 24).padEnd(24)} 번호: ${String(out.cardNumber ?? '-')}`,
  )
  void nameOk
  await new Promise((r) => setTimeout(r, 2000))
}

console.log(`\n  카드로 인식한 것 ${found}/${picks.length}`)
console.log(`  번호까지 맞힌 것 ${numOk}/${picks.length}`)
if (times.length) console.log(`  걸린 시간  평균 ${Math.round(times.reduce((x, y) => x + y, 0) / times.length)}ms · 최대 ${Math.max(...times)}ms`)
console.log('  (이름은 영문으로 답하므로 위 목록을 눈으로 견줄 것)')
