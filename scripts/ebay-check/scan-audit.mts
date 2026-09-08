// 【긁은 줄 점검】 서버에 넣기 **전에** 담길 것과 걸러질 것을 눈으로 보는 도구.
//
// ⚠️⚠️ **정확함이 1순위, 양이 2순위다**(사장님 지시 2026-08-29). 넣고 나서 세면 늦다 —
//    한 번 담긴 딴 카드 값은 어디가 틀렸는지 찾기 어렵다. **넣기 전에** 이걸로 본다.
// ⚠️ 「담음 189건」처럼 숫자만 보지 마라. **걸러낸 줄을 전부 훑어** 그 카드 단품이
//    남아 있는지 눈으로 확인한다(2026-08-29에 33줄을 잘못 버린 적이 있다).
//
// 쓰기: npx tsx scripts/ebay-check/scan-audit.mts <카드번호> [--전부]
//   ~/Downloads/pokegre-<카드번호>-rows.json 을 읽는다(크롬에서 내려받은 것).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { 내낙찰인가 } from '../../server/api.ts'
import { 검수번호표, 긁은줄내것인가 } from '../../src/lib/listingJudge.ts'
import { 묶음인가, 제목등급칸, 제목에감정사있나 } from '../../src/lib/listingTitle.ts'

const id = process.argv[2]
const 전부 = process.argv.includes('--전부')
if (!id) { console.log('카드번호를 주세요'); process.exit(1) }

const 색인 = JSON.parse(readFileSync('card-index.json', 'utf8'))
const 줄 = 색인.rows.find((r: unknown[]) => String(r[7]) === id)
if (!줄) { console.log('도감에 없는 카드'); process.exit(1) }
const 번호 = 검수번호표[id]?.no ?? String(줄[1])
const rows = JSON.parse(readFileSync(`${homedir()}/Downloads/pokegre-${id}-rows.json`, 'utf8'))

const 담김: any[] = []
const 뺌: any[] = []
for (const r of rows) {
  const t = String(r.t ?? '')
  const 내것 = 긁은줄내것인가(id, t)
  const 통과 = 내것 === false ? false : 내것 === true ? true : 내낙찰인가(t, 번호)
  ;(통과 ? 담김 : 뺌).push(r)
}
const 묶음뺌 = 담김.filter((r) => 묶음인가(r.t))
const 셀것 = 담김.filter((r) => !묶음인가(r.t) && !r.bo)

console.log(`■ ${줄[2]} (${id}) · 번호 ${번호} · ${줄[0]}`)
console.log(`  긁은 줄 ${rows.length} → 담김 ${담김.length} · 걸러냄 ${뺌.length}`)
console.log(`  담긴 것 중 묶음 ${묶음뺌.length} · 깎아 판 값 ${담김.filter((r) => r.bo).length} → 셈에 들 것 ${셀것.length}`)

const 칸별: Record<string, number[]> = {}
for (const r of 셀것) {
  const 칸 = 제목등급칸(r.t) || (제목에감정사있나(r.t) ? 'ungraded' : 'raw')
  ;(칸별[칸] ??= []).push(r.krw || 0)
}
console.log('\n  등급칸 (원화 중앙값)')
for (const [칸, v] of Object.entries(칸별).sort((a, b) => b[1].length - a[1].length)) {
  const s = v.filter((x) => x > 0).sort((a, b) => a - b)
  console.log(`    ${칸.padEnd(10)}${String(v.length).padStart(3)}건  약 ${s.length ? Math.round(s[Math.floor(s.length / 2)] / 1e4) : 0}만원`)
}

console.log(`\n  ⚠️ 걸러낸 ${뺌.length}줄 — 이 카드 단품이 남아 있는지 눈으로 볼 것`)
for (const r of 전부 ? 뺌 : 뺌.slice(0, 30)) console.log('    ' + String(r.t).slice(0, 78))
if (!전부 && 뺌.length > 30) console.log(`    … 그 밖 ${뺌.length - 30}줄 (--전부 로 다 보기)`)
