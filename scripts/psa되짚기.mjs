/**
 * 지금까지 지은 **모든 짝(세트 ↔ PSA 원장)을 한꺼번에 다시 돌려 본다.**
 *
 * 왜 있나: 맞추는 규칙을 고치면 예전에 적어 둔 값이 조용히 틀어질 수 있다.
 * 그래서 규칙을 고칠 때마다 이걸 돌려 **「전에는 확인이던 게 지금은 보류/다름」**인 칸을 찾는다.
 *
 *   node scripts/psa되짚기.mjs            → 달라진 것만 보여 준다
 *   node scripts/psa되짚기.mjs --적기     → 짝지어진 것을 모두 다시 적는다
 *                                          (규칙을 고쳐 새로 맞춰지게 된 카드를 거두는 용도)
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { 대조, 줄읽기 } from './psa대조.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const 짝 = JSON.parse(readFileSync(path.join(ROOT, 'data/psa짝목록.json'), 'utf8'))
const 크기표 = JSON.parse(readFileSync(path.join(ROOT, 'data/psa크기표.json'), 'utf8'))
const 표 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/psaPopFix.json'), 'utf8'))

const 적을까 = process.argv.includes('--적기')
const 넣을것 = {}
// ⚠️ **한 PSA 세트를 줄파일 둘로 나눠 두면 서로 어긋난다.**
//    (2026-08-31에 XY 증기 열차가 ss·xyss 두 파일로 갈려, 한쪽에서 확인한 값이
//     다른 쪽에서 「줄이 없다」로 뒤집혔다.) 같은 id에 파일이 둘이면 합쳐야 한다.
{
  const 묶음 = {}
  for (const [, 파일, id] of 짝) (묶음[id] = 묶음[id] || new Set()).add(파일)
  for (const [id, 들] of Object.entries(묶음))
    if (들.size > 1) console.log(`  ⚠ PSA 세트 ${id}에 줄파일이 여럿입니다: ${[...들].join(', ')} — 하나로 합치세요`)
}
let 어긋남 = 0, 돌린짝 = 0
for (const [슬러그, 파일, psaId, 줄에, 우리이름에] of 짝) {
  const p = path.join(ROOT, 'data/psa줄', 파일 + '.txt')
  if (!existsSync(p)) { console.log(`  (줄파일 없음: ${파일})`); continue }
  let 줄 = 줄읽기(readFileSync(p, 'utf8'))
  if (줄에) 줄 = 줄.filter((r) => r.이름.toLowerCase().includes(String(줄에).toLowerCase()))
  const R = 대조(슬러그, 줄, { 세트크기: 크기표[슬러그 + '|' + 파일] || 크기표[슬러그], 우리이름에 })
  돌린짝++
  // ⚠️⚠️ **번호 없는 카드(#로 시작)는 여기서 쓰지 않는다.** 이름만으로 맞춘 것이라
  //    다른 세트 줄파일에도 같은 이름이 있으면 엉뚱한 값을 쓴다(체육관 덱 디펜더·만병통치제).
  //    그런 카드는 `psa훑기.mjs`로 **한 곳에서만 걸릴 때만** 쓴다.
  if (적을까) for (const x of [...R.같음, ...R.다름].filter((y) => !/^#/.test(String(y.n))))
    넣을것[x.tcg] = { v: x.psa, 출처: `${psaId}/${String(x.n).split('~')[0]} ${x.줄이름}`, ...(x.믿음 ? { 믿음: x.믿음 } : {}) }
  for (const x of R.다름) {
    const f = 표[x.tcg]
    if (!f || !f.출처) continue
    console.log(`  △ ${슬러그} ${x.tcg} ${x.이름} — 적힌값 ${x.v.join('/')} ≠ 지금줄 ${x.psa.join('/')} [${x.줄이름}]`)
    어긋남++
  }
  for (const x of R.보류) {
    const f = 표[x.tcg]
    if (!f || !f.출처) continue
    if (String(f.출처).startsWith(psaId + '/')) {
      console.log(`  ❗ [${파일}] ${슬러그} ${x.tcg} ${x.이름} — 전엔 적었는데 지금은 보류(${x.까닭}) · 적힌출처 ${f.출처}`)
      어긋남++
    }
  }
}
if (적을까) {
  const { 적기 } = await import('./psa팝-기록.mjs')
  const w = 적기(넣을것)
  console.log(`  적음 ${Object.keys(넣을것).length}칸 · 값바꿈 ${w.바꿈}`)
}

// ⚠️⚠️ **한 PSA 줄을 두 카드가 가리키면 하나는 반드시 틀린 것이다**(2026-08-31).
//    PSA에 줄이 하나뿐인데 우리 쪽에 판이 둘인 카드(케르디오 BW60 보통/틴셀, 비토리컵
//    봄 2012/2013)가 같은 값을 나눠 갖고 있었다. 값을 적을 때마다 여기서 잡는다.
{
  const 표 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/psaPopFix.json'), 'utf8'))
  const idx = JSON.parse(readFileSync(path.join(ROOT, 'card-index.json'), 'utf8'))
  const 이름 = {}
  for (const r of idx.rows) if (r[7]) 이름[String(r[7])] = r[0] + ' | ' + r[2]
  const 모 = new Map()
  for (const [k, v] of Object.entries(표)) {
    if (!v || !v.출처) continue
    if (!모.has(v.출처)) 모.set(v.출처, [])
    모.get(v.출처).push(k)
  }
  let 겹 = 0
  for (const [출처, ids] of 모) {
    if (ids.length < 2) continue
    겹++
    if (겹 <= 10) console.log(`  ⚠ 같은 PSA 줄을 둘이 씁니다 — ${출처}\n      ${ids.map((x) => 이름[x] || x).join('\n      ')}`)
  }
  if (겹) console.log(`겹친 자리 ${겹}곳 — 한쪽은 틀린 것이니 사람이 골라야 합니다`)
}
console.log(`짝 ${돌린짝}개 되짚음 · 어긋난 칸 ${어긋남}개`)
