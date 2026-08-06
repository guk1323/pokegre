// 스니커덩크가 **한 코드로 묶어 파는 일본판 세트**의 카드 이름을 받는다.
//
// 왜: 푸른 충격(XY8a)·붉은 섬광(XY8b)은 우리 데이터에선 따로인데 스니커덩크는 둘 다
// [XY8 025/059]로 판다. XY11a·XY11b도 [XY11 …]과 [XY11-1 …]·[XY11-2 …]이 섞인다.
// 그래서 fetch-old-jp-names.mts는 이 4개 세트에서 한 장도 못 받았다(2026-08-07).
// 번호는 우리와 맞는 것을 확인했다(우리 XY8a 025 = 저쪽 XY8 025 青い衝撃, 둘 다 ミュウツーEX).
//
// ⚠️ 코드가 아니라 **제목 괄호 안의 일본 세트 이름**으로 가른다. 코드는 XY11/XY11-1/XY11-2로
//    들쭉날쭉해 믿을 수 없다.
// ⚠️ neo·PMCG·VS·web은 여기 넣지 않는다. 번호 체계가 달라 다른 카드가 들어온다
//    (우리 neo1 035=キングドラ, 저쪽 neo1 No.035=ピッピ).
//
// 쓰는 법: npx tsx scripts/fetch-xy-split-names.mts [출력경로]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASE = process.env.PG_BASE ?? 'http://localhost:8787'
const OUT = process.argv[2] ?? '/tmp/xy-split-names.json'
const 쉬는시간 = Number(process.env.PG_SLEEP_MS ?? 1150)

// 우리 세트 → [스니커덩크에 칠 검색 코드, 제목 괄호 안의 일본 세트 이름]
const 짝 = [
  { slug: 'ja-XY8a', 코드: 'XY8', 일본이름: '青い衝撃' },
  { slug: 'ja-XY8b', 코드: 'XY8', 일본이름: '赤い閃光' },
  { slug: 'ja-XY11a', 코드: 'XY11', 일본이름: '爆熱の闘士' },
  { slug: 'ja-XY11b', 코드: 'XY11', 일본이름: '冷酷の反逆者' },
]

const 레어도뗌 = (s: string) =>
  s
    .replace(/[●◆◇★☆■□▲△]/g, ' ')
    .replace(/\s+(?:RRR|RR|SSR|SR|HR|UR|SAR|AR|CHR|CSR|PR|K|A|R|C|U)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
const 이름뽑기 = (title: string) => 레어도뗌((title.split('[')[0] ?? '').split(':')[0].replace(/[★☆]/g, ' '))
const 자름 = (n: string) => String(n).replace(/^0+/, '')

const 결과: Record<string, { 우리: string; 저쪽: string; 제목: string }> =
  existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}
const 저장 = () => writeFileSync(OUT, JSON.stringify(결과, null, 1))

let 본것 = 0, 새로 = 0, 없음 = 0, 실패 = 0, 막힘 = 0
for (const { slug, 코드, 일본이름 } of 짝) {
  let d: any
  try { d = JSON.parse(readFileSync(path.join(ROOT, `public/sets/${slug}.json`), 'utf-8')) } catch { continue }
  const 카드들 = d.cards ?? []
  for (let ci = 0; ci < 카드들.length; ci++) {
    const c = 카드들[ci]
    const key = `${slug}|${c.n}`
    본것++
    if (결과[key]) continue
    let j: any
    try {
      const r = await fetch(
        `${BASE}/api/snkrdunk/v3/search?func=all&refId=search&keyword=${encodeURIComponent(`${코드} ${c.n}`)}&sortKey=default&cardVersion=2&brandIds=pokemon&perPage=24&page=1`,
        { signal: AbortSignal.timeout(15000) },
      )
      if (r.status === 429) {
        막힘++
        if (막힘 % 20 === 1) console.log(`   429에 걸려 60초 쉰다 (지금까지 ${막힘}번)`)
        await new Promise((x) => setTimeout(x, 60000))
        ci--; 본것--
        continue
      }
      if (!r.ok) { 실패++; continue }
      j = await r.json()
    } catch { 실패++; continue }
    const ps = j?.search?.rankingProducts ?? []
    const 맞는것 = ps.find((p: any) => {
      const t = String(p.title ?? '')
      if (!t.includes(일본이름)) return false
      const m = t.match(/\[[^\]]*?\s+([^\s/\]]+)(?:\/[^\]]*)?\]/)
      return m && 자름(m[1]) === 자름(String(c.n))
    })
    if (!맞는것) { 없음++; await new Promise((x) => setTimeout(x, 쉬는시간)); continue }
    결과[key] = { 우리: String(c.name ?? ''), 저쪽: 이름뽑기(String(맞는것.title)), 제목: String(맞는것.title) }
    새로++
    if (새로 % 40 === 0) { 저장(); console.log(`   ${새로}장 받음 (훑은 것 ${본것} · 없음 ${없음})`) }
    await new Promise((x) => setTimeout(x, 쉬는시간))
  }
}
저장()
console.log(`\n  훑은 카드 ${본것}장 · 받은 이름 ${Object.keys(결과).length}장 · 없음 ${없음}장 · 실패 ${실패}장`)
console.log(`  ${OUT} 에 적었다\n`)
