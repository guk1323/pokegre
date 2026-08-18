// 고친 낙찰가가 **같은 카드·같은 등급의 다른 낙찰과 말이 되나** 본다.
//
// ⚠️ 왜 필요한가: 이베이 원문을 읽어 값을 고치는데, 페이지에서 값을 잘못 집을 수가 있다
//    (옆에 붙은 「비슷한 상품」 값을 낙찰가로 읽는 식). 그러면 틀린 값을 틀린 값으로
//    바꾸는 셈이라 더 나쁘다. 이웃과 견주면 그런 것이 드러난다.
//    실측(2026-08-16 · 고친 148건): 중앙 0.98배 · 0.5~2배 안에 84% · 5배 넘게 어긋난 것 6건.
//
// ⚠️⚠️ **이웃 중 아직 안 고친 $15는 빼고 본다.** 한 카드에 틀린 값이 여러 개면 서로를
//    가려 준다 — 이웃 중앙값이 $15가 되어 **멀쩡한 고침이 101배 어긋난 것처럼** 보였다.
//    이게 이 점검을 만들며 제일 헷갈린 자리다.
//
// ⚠️ **점검 시점이 늦을수록 정확하다.** 이웃이 아직 안 고쳐졌으면 배수가 부풀려지므로,
//    매물 점검을 **다 끝낸 뒤** 한 번에 돌리는 것이 맞다(사장님 지시 2026-08-16:
//    "그런건 모아뒀다가 러너 30만장 다 끝나면 한번에 같이 확인하자").
//
// 어디서 도나: **운영 서버**다(/data를 읽어야 한다). 크레딧 0 · 이베이 안 건드림.
//   B64=$(base64 < scripts/check-fix-outliers.mjs | tr -d '\n')
//   fly ssh console -a pokegre -C "/bin/sh -c 'echo $B64 | base64 -d > /data/o.js && node /data/o.js && rm -f /data/o.js'"
//
// 옵션(환경변수):
//   FIXES=/data/backups/2026-08-16/price-fixes.json   견줄 고침표(기본: /data/price-fixes.json)
//   배수=5                                            이만큼 어긋나면 「다시 볼 것」(기본 5)

import { readFileSync } from 'node:fs'

const 고침표길 = process.env.FIXES || '/data/price-fixes.json'
const 문턱 = Number(process.env.배수 || 5)
const 표 = JSON.parse(readFileSync(고침표길, 'utf8'))
const 중앙 = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }

const 잰것 = []
let 못잼 = 0
for (const [itm, x] of Object.entries(표)) {
  if (x.drop || x.p == null || !x.card || !x.g) continue
  let j
  try { j = JSON.parse(readFileSync('/data/card-history/' + x.card + '.json', 'utf8')) } catch { 못잼++; continue }
  const 다른것 = ((j.s || {})[x.g] || []).filter((s) => !String(s.u || '').includes('/itm/' + itm))
  const 성한이웃 = 다른것.map((s) => s.p).filter((p) => p > 0 && p !== 15)
  if (!성한이웃.length) { 못잼++; continue }
  const mid = 중앙(성한이웃)
  잰것.push({ itm, card: x.card, g: x.g, was: x.was, p: x.p, n: 성한이웃.length, 아직15: 다른것.filter((s) => s.p === 15).length,
    최저: Math.min(...성한이웃), 중앙: mid, 최고: Math.max(...성한이웃), 배: x.p / mid })
}

const 배 = 잰것.map((r) => r.배).sort((a, b) => a - b)
const 안에 = (lo, hi) => 잰것.filter((r) => r.배 >= lo && r.배 <= hi).length
const 어긋 = 잰것.filter((r) => r.배 >= 문턱 || r.배 <= 1 / 문턱).sort((a, b) => Math.abs(Math.log(b.배)) - Math.abs(Math.log(a.배)))

console.log('고침표: ' + 고침표길)
console.log('견줄 수 있는 것 ' + 잰것.length + '건 (이웃이 없어 못 잰 것 ' + 못잼 + ')')
console.log('고친 값 ÷ 이웃 중앙값 — 중앙 ' + 중앙(배).toFixed(2) + '배 · 절반 ' +
  배[Math.floor(배.length * 0.25)].toFixed(2) + '~' + 배[Math.floor(배.length * 0.75)].toFixed(2) + '배')
console.log('  0.5~2배 안 : ' + 안에(0.5, 2) + '건 (' + Math.round((100 * 안에(0.5, 2)) / 잰것.length) + '%)')
console.log('  0.2~5배 안 : ' + 안에(0.2, 5) + '건 (' + Math.round((100 * 안에(0.2, 5)) / 잰것.length) + '%)')
console.log('  ★ ' + 문턱 + '배 넘게 어긋남: ' + 어긋.length + '건 — 눈으로 다시 볼 것\n')

for (const r of 어긋) {
  console.log('https://www.ebay.com/itm/' + r.itm + '  카드' + r.card + ' ' + r.g +
    ' | $' + r.was + ' → $' + r.p + ' | 성한 이웃 ' + r.n + '건 $' + r.최저 + '~$' + r.최고 +
    ' (중앙 $' + r.중앙 + ')' + (r.아직15 ? ' · 아직 안 고친 $15 ' + r.아직15 + '건' : '') + ' | ' + r.배.toFixed(2) + '배')
}
