// 운영 서버를 통해 **아무 카드나 골라** 낙찰 자료가 성한지 본다.
//
// 왜: 규칙을 고칠 때마다 한두 장으로만 확인하면 다른 데가 깨진 걸 모른다(사장님 지적
// 2026-08-08 "카드들 랜덤으로 골라서 계속 확인해봐야해").
// **운영 서버(/api/local/card-prices)를 거쳐** 보므로 실제로 방문자에게 나가는 값이다.
//
// 보는 것:
//   ① 갈라진 카드: 저쪽이 한 칸에 묶어 둔 것을 우리가 번호로 가른 것
//   ② 남은 섞임: 카드 번호와 **다른 번호**가 제목에 적힌 낙찰이 아직 남아 있나
//   ③ 값 벌어짐: 한 등급 칸 안에서 최고가가 최저가의 몇 배인가(20배 넘으면 의심)
//   ④ 미감정 칸에 등급말이 남았나
//
// 실행: node scripts/spot-check-ebay.mjs [세트수] [세트당 카드수]
const 세트 = [
  ['japanese', 'Expansion Pack'], ['english', 'Base Set'], ['japanese', 'VMAX Climax'],
  ['english', 'Evolving Skies'], ['japanese', 'Shiny Treasure ex'], ['english', 'Crown Zenith'],
  ['japanese', 'Pokemon Card 151'], ['english', 'Obsidian Flames'], ['japanese', 'Terastal Festival ex'],
  ['english', 'Surging Sparks'], ['japanese', 'Wild Force'], ['english', 'Paldean Fates'],
]
const N = Number(process.argv[2] ?? 6)
const M = Number(process.argv[3] ?? 8)
const 등급앞 = /(psa|bgs|cgc|sgc|tag|ace|ars|grade|gem|mint|pgs|mpg)\s*$/i
const 번호맞추기 = (a, b) => `${Number(a.length === b.length + 2 ? a.slice(2) : a)}/${Number(b)}`
const 번호들 = (t) => { const o = new Set(); for (const m of String(t).matchAll(/(^|[^\d/])(\d{1,4})\s*\/\s*(\d{1,3})(?![\d/])/g)) { if (등급앞.test(String(t).slice(0, (m.index ?? 0) + m[1].length))) continue; o.add(번호맞추기(m[2], m[3])) } return [...o] }
const 등급말 = /\b(?:psa|bgs|beckett|cgc|sgc|ace|tag|ars|pgs|mpg|cci|gma|hga|isa|ags)\s*-?\s*(?:grade[ds]?|gem\s*-?\s*mt|nm\s*[-/]\s*(?:mt|mint)|mint|pristine)?\s*(?:10|[1-9](?:\.5)?)\b(?!\d)/i

const 고른세트 = [...세트].sort(() => Math.random() - 0.5).slice(0, N)
let 카드수 = 0, 갈린것 = 0
const 문제 = []
for (const [lang, set] of 고른세트) {
  const p = new URLSearchParams({ language: lang, setName: set, limit: String(M), includeEbay: 'true', sortBy: 'price', sortOrder: 'desc' })
  const r = await fetch(`https://pokegre.com/api/local/card-prices?${p}`)
  if (!r.ok) { 문제.push(`  [${set}] 서버 ${r.status}`); continue }
  const j = await r.json()
  for (const c of j.cards ?? []) {
    카드수++
    if (String(c.tcgPlayerId).includes('~')) 갈린것++
    // ⚠️ **카드 번호도 제목과 같은 꼴로 맞춘 뒤 견준다.** 안 그러면 "232/091"과 "232/91"이
    //    다른 것이 되어 멀쩡한 낙찰이 전부 걸린다(처음에 386개가 그렇게 걸렸다).
    //    글자가 붙은 번호(GG69/GG70)는 글자를 떼고 본다.
    const 내번호 = (() => {
      const m = String(c.cardNumber ?? '').match(/(\d{1,4})\s*\/\s*(\d{1,3})/)
      return m ? 번호맞추기(m[1], m[2]) : ''
    })()
    for (const g of c.grades ?? []) {
      const 값 = (g.sales ?? []).map((s) => s.price).filter((v) => v > 0)
      if (값.length >= 3 && Math.max(...값) / Math.min(...값) > 20)
        문제.push(`  [값 벌어짐] ${c.name} ${g.grade}  $${Math.min(...값)} ~ $${Math.max(...값)}`)
      for (const s of g.sales ?? []) {
        if (g.grade === 'ungraded' && 등급말.test(s.title ?? '')) 문제.push(`  [미감정에 등급] ${c.name}  ${String(s.title).slice(0, 60)}`)
        if (!내번호) continue
        const ns = 번호들(s.title ?? '')
        if (ns.length && !ns.includes(내번호)) 문제.push(`  [번호 다름] ${c.name}(${내번호}) ← ${ns.join(',')}  ${String(s.title).slice(0, 54)}`)
      }
    }
  }
}
console.log(`세트 ${고른세트.length}개 · 카드 ${카드수}장 · 그중 갈라진 것 ${갈린것}장`)
console.log(고른세트.map(([l, s]) => `${s}(${l[0]})`).join(' · '))
console.log(문제.length ? `\n⚠️ 걸린 것 ${문제.length}개` : '\n걸린 것 없음')
for (const x of 문제.slice(0, 25)) console.log(x)
