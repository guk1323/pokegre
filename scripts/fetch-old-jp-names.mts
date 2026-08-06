// 옛 일본판 세트 카드의 **정식 일본 이름을 스니커덩크에서 받아 적어 둔다**.
//
// 왜: 원본(TCGdex)의 옛 세트 일본어 칸이 오염돼 있다. 정식 일본명 대신 영어명을 소리로
// 옮긴 가짜 이름이 들어 있다(ガストリー=Gastly인데 정식은 ゴース, チャンジー=Chansey인데
// 정식은 ラッキー, 아예 영어로 남은 luvdisc·Omastar도 있다). 그래서 세트 목록에서
// PCG3 043이 "어둠의 최면"으로 나오는데, 눌러서 나온 스니커덩크는 "나쁜 슬리퍼"였다
// (2026-08-07 발견). 표본 200장 중 스니커덩크에 있는 117장의 64%가 어긋났다.
//
// 스니커덩크는 실제로 그 카드를 파는 곳이라 상품명이 정식 일본명이다. 무료 API다.
// 받기만 하고 고치지는 않는다 — 적용은 fix-old-jp-names-from-snkrdunk.mts가 한다.
//
// 쓰는 법: npx tsx scripts/fetch-old-jp-names.mts [출력경로]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASE = process.env.PG_BASE ?? 'http://localhost:8787'
const OUT = process.argv[2] ?? '/tmp/old-jp-names.json'
// ⚠️ 서버가 스니커덩크를 10분에 600번(=초당 1번)까지만 통과시킨다(SNKRDUNK_RATE_LIMIT).
//    0.3초로 두드렸다가 2,916장 중 2,607장이 429로 튕겼다(2026-08-07). 넉넉히 잡는다.
const 쉬는시간 = Number(process.env.PG_SLEEP_MS ?? 1100)

const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 옛시리즈 = ['PCG', 'ポケモンカードe', 'ポケモンカード★neo', 'VS', 'web', 'ポケットモンスターカードゲーム', 'XY BREAK']
const 옛세트 = sidx.filter((s) => s.ed === 'ja' && 옛시리즈.includes(s.serie))

/** 스니커덩크가 이름 뒤에 붙이는 레어도 꼬리표를 뗀다("ニョロボン R" → "ニョロボン"). */
const 레어도뗌 = (s: string) =>
  s
    .replace(/[●◆◇★☆■□▲△]/g, ' ')
    .replace(/\s+(?:RRR|RR|SSR|SR|HR|UR|SAR|AR|CHR|CSR|PR|K|A|R|C|U)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
/** "わるいスリーパー ★ :1ED [PCG3 043/084](…)" → "わるいスリーパー" */
const 이름뽑기 = (title: string) => 레어도뗌((title.split('[')[0] ?? '').split(':')[0].replace(/[★☆]/g, ' '))
const 자름 = (n: string) => String(n).replace(/^0+/, '')

// 하다 끊겨도 이어받게, 이미 받은 건 건너뛴다.
const 결과: Record<string, { 우리: string; 저쪽: string; 제목: string }> =
  existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}
const 저장 = () => writeFileSync(OUT, JSON.stringify(결과, null, 1))

let 본것 = 0
let 새로 = 0
let 없음 = 0
let 실패 = 0
let 막힘 = 0
// 실패를 뭉뚱그리면 "왜 안 됐는지"를 못 본다. 상태코드별로 센다.
const 코드: Record<string, number> = {}
for (const s of 옛세트) {
  const code = String(s.slug).replace(/^ja-/, '')
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${s.slug}.json`), 'utf-8')) } catch { continue }
  const 카드들 = d.cards ?? []
  for (let ci = 0; ci < 카드들.length; ci++) {
    const c = 카드들[ci]
    const key = `${s.slug}|${c.n}`
    본것++
    if (결과[key]) continue
    let j: any
    try {
      const r = await fetch(
        `${BASE}/api/snkrdunk/v3/search?func=all&refId=search&keyword=${encodeURIComponent(`${code} ${c.n}`)}&sortKey=default&cardVersion=2&brandIds=pokemon&perPage=24&page=1`,
        { signal: AbortSignal.timeout(15000) },
      )
      if (r.status === 429) {
        // 한도에 걸렸다. 창이 지나가길 기다렸다가 같은 카드를 다시 친다.
        막힘++
        if (막힘 % 20 === 1) console.log(`   429에 걸려 60초 쉰다 (지금까지 ${막힘}번)`)
        await new Promise((r) => setTimeout(r, 60000))
        ci--
        본것--
        continue
      }
      if (!r.ok) { 실패++; 코드[r.status] = (코드[r.status] ?? 0) + 1; continue }
      j = await r.json()
    } catch (e) { 실패++; 코드['throw'] = (코드['throw'] ?? 0) + 1; continue }
    const ps = j?.search?.rankingProducts ?? []
    const 맞는것 = ps.find((p: any) => {
      const m = String(p.title ?? '').match(/\[([^\]]+?)\s+([^\s/\]]+)(?:\/[^\]]*)?\]/)
      return m && m[1].toUpperCase() === code.toUpperCase() && 자름(m[2]) === 자름(String(c.n))
    })
    if (!맞는것) { 없음++; await new Promise((r) => setTimeout(r, 쉬는시간)); continue }
    결과[key] = { 우리: String(c.name ?? ''), 저쪽: 이름뽑기(String(맞는것.title)), 제목: String(맞는것.title) }
    새로++
    if (새로 % 50 === 0) { 저장(); console.log(`   ${새로}장 받음 (훑은 것 ${본것} · 없음 ${없음} · 실패 ${실패})`) }
    await new Promise((r) => setTimeout(r, 쉬는시간))
  }
}
저장()
console.log(`\n  훑은 카드 ${본것}장 · 받은 이름 ${Object.keys(결과).length}장 · 스니커덩크에 없음 ${없음}장 · 실패 ${실패}장 · 429로 쉰 횟수 ${막힘}`)
if (Object.keys(코드).length) console.log(`  실패 내역: ${JSON.stringify(코드)}`)
console.log(`  ${OUT} 에 적었다\n`)
