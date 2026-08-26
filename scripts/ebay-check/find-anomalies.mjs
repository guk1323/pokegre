// 【이상 탐지】 값이 뒤집힌 카드 찾기 — 같은 감정사에서 높은 등급이 낮은 등급보다 싼 것.
// 전수 검사 대신 「이상한 곳만」 사람이 보게 하는 문지기다(사장님 방침 2026-08-20).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
const 뿌리 = new URL('../..', import.meta.url).pathname
const dir = path.join(뿌리, 'data', 'ebay-check')
const 중앙 = (arr) => {
  const v = arr.slice().sort((a, b) => a - b)
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0
}
const 이상들 = []
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
  // 회사별 숫자 등급 → 중앙값 (셈에 든 것만, 3건 이상만)
  const 회사들 = {}
  // ⚠️ 최근 1년 낙찰만으로 잰다 — 옛 고점 낙찰과 최근 낙찰이 칸마다 섞이면
  //    시장이 내렸을 뿐인데 등급이 뒤집혀 보인다(칠색조 실측 2026-08-20).
  const 기준일 = '2025-08-20'
  for (const [칸, rows] of Object.entries(j.칸들)) {
    const m = 칸.match(/^(psa|bgs|cgc|sgc)(\d+)(?:_5)?$/)
    if (!m) continue
    const 든 = rows.filter((s) => !s.x && s.d >= 기준일).map((s) => s.p)
    if (든.length < 3) continue
    const 등급 = Number(m[2]) + (칸.endsWith('_5') ? 0.5 : 0)
    ;(회사들[m[1]] ??= []).push({ 칸, 등급, n: 든.length, med: 중앙(든) })
  }
  for (const [회사, 줄들] of Object.entries(회사들)) {
    줄들.sort((a, b) => a.등급 - b.등급)
    for (let i = 0; i < 줄들.length - 1; i++) {
      const 낮 = 줄들[i], 높 = 줄들[i + 1]
      // ⚠️ 소표본 노이즈는 거른다 — 저등급 골드스타끼리 3~7건으로 1.4배쯤 어긋나는 건
      //    시장의 정상 흔들림이다. 둘 다 10건 이상이면 1.5배부터, 아니면 2배부터 잡는다.
      const 문턱 = 낮.n >= 10 && 높.n >= 10 ? 1.5 : 2.0
      if (높.med * 문턱 < 낮.med && Math.max(낮.med, 높.med) >= 100) {
        const 판 = j.id.endsWith('-lang') || j.slug.startsWith('zh-') ? '기타 언어' : j.slug.startsWith('ja-') ? '일본어판' : '영문판'
        const 갈래 = j.id.endsWith('-1st') ? '1st Ed' : j.id.endsWith('-25th') ? '25주년' : j.id.endsWith('-auto') ? '사인' : '일반'
        이상들.push({
          판, 갈래,
          카드: `${j.name} ${j.no}${j.total ? '/' + j.total : ''}`,
          세트: j.setEn.slice(0, 24),
          id: j.id,
          짝: `${낮.칸} $${낮.med}(${낮.n}건) > ${높.칸} $${높.med}(${높.n}건)`,
          심함: Math.round((낮.med / Math.max(높.med, 1)) * 10) / 10,
          값: Math.max(낮.med, 높.med),
        })
      }
    }
  }
}
이상들.sort((a, b) => b.값 * b.심함 - a.값 * a.심함)
import('node:fs').then(m=>m.writeFileSync(path.join(뿌리,'data','ebay-check-anomalies.json'), JSON.stringify(이상들)))
console.log(`값이 뒤집힌 곳: ${이상들.length}건 (3건 이상 등급끼리 · 1.3배 넘는 역전만)`)
for (const x of 이상들.slice(0, 40)) {
  console.log(`  [${x.판}·${x.갈래}] ${x.카드} · ${x.세트} · ${x.짝} · ${x.심함}배`)
}
