/**
 * **가진 줄파일을 모두 훑어** 아직 출처 없는 카드의 짝을 찾는다.
 *
 * ⚠️⚠️ 안전장치: 한 카드가 **줄파일 두 개 이상에서 걸리면 아예 안 쓴다.**
 *    (같은 번호 딴 세트에 붙는 사고를 막는 핵심이다. 하나에서만 걸릴 때만 믿는다.)
 * ⚠️ 크기표에 그 짝의 세트 카드수가 있으면 그것도 함께 건다.
 *
 *   node scripts/psa훑기.mjs <슬러그> [--적기]
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { 대조, 줄읽기 } from './psa대조.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const 슬러그 = process.argv[2]
if (!슬러그) { console.log('쓰는 법: node scripts/psa훑기.mjs <슬러그> [--적기]'); process.exit(0) }
const 크기표 = JSON.parse(readFileSync(path.join(ROOT, 'data/psa크기표.json'), 'utf8'))
const 짝 = JSON.parse(readFileSync(path.join(ROOT, 'data/psa짝목록.json'), 'utf8'))
const 파일id = {}
for (const [, 파일, id] of 짝) 파일id[파일] = id

// ⚠️⚠️ **그 슬러그와 짝으로 등록된 줄파일만 훑는다.**
//    아무 파일이나 훑었더니 점보 뮤츠 EX가 XY 에볼루션스 값(6,650)을, 점보 캥카 EX가
//    월드덱 값을 먹으려 했다(2026-08-31). 새 세트를 붙일 때는 사람이 대조로 확인하고
//    짝목록에 넣은 뒤 여기서 거둔다.
// ⚠️ `--새것도`를 주면 **보정표에 아직 없는 카드**까지 채운다(2026-08-31). 규칙은 그대로다 —
//    번호·이름·갈래가 다 맞고, 줄파일 두 곳에서 엇갈리지 않아야만 쓴다.
const 새것도 = process.argv.includes('--새것도')
const 조용히 = process.argv.includes('--조용히')
// ⚠️⚠️ **짝에 걸어 둔 「줄에」·「우리이름에」 거르개를 반드시 함께 쓴다**(2026-08-31).
//    안 쓰면 흑백 블랙 컬렉션 슬러그가 화이트 컬렉션 줄까지 보게 되어, 되짚기가 거부하는 값을
//    훑기가 적는 엇갈림이 생긴다(실제로 피카츄 56번에서 났다).
const 짝들 = 짝.filter((x) => x[0] === 슬러그)
if (!짝들.length) { console.log(`  (${슬러그}와 짝지어 둔 줄파일이 없습니다 — 먼저 대조로 확인하고 짝목록에 넣으세요)`); process.exit(0) }
const 모음 = new Map()   // tcg → [{파일, 값, 줄이름, 믿음}]
const 본파일 = new Set()
for (const [, 파일, , 줄에, 우리이름에] of 짝들) {
  const 열쇠 = 파일 + '|' + (줄에 || '') + '|' + (우리이름에 || '')
  if (본파일.has(열쇠)) continue
  본파일.add(열쇠)
  let 줄 = 줄읽기(readFileSync(path.join(ROOT, 'data/psa줄', 파일 + '.txt'), 'utf8'))
  if (줄에) 줄 = 줄.filter((r) => new RegExp(줄에, 'i').test(r.이름))
  const R = 대조(슬러그, 줄, { 출처없는것만: true, 세트크기: 크기표[슬러그 + '|' + 파일], 새것도, 우리이름에 })
  for (const x of [...R.같음, ...R.다름, ...R.새로]) {
    if (!모음.has(x.tcg)) 모음.set(x.tcg, [])
    모음.get(x.tcg).push({ 파일, 값: x.psa, 줄이름: x.줄이름, 믿음: x.믿음, n: x.n, 이름: x.이름 })
  }
}

const 넣을것 = {}
let 하나 = 0, 여럿 = 0, 겹침 = 0
for (const [tcg, 들] of 모음) {
  const 다른값 = new Set(들.map((x) => x.값.join('/') + '|' + x.줄이름))
  if (들.length > 1 && 다른값.size > 1) {
    여럿++
    console.log(`  ✖ ${들[0].이름} — 줄파일 ${들.map((x) => x.파일).join(',')}에서 서로 다르게 걸립니다`)
    continue
  }
  const it = 들[0]
  하나++
  if (!조용히) console.log(`  ✔ ${it.이름} ← ${it.파일} ${it.줄이름} ${it.값.join('/')}`)
  넣을것[tcg] = { v: it.값, 출처: `${파일id[it.파일] || it.파일}/${String(it.n).split('~')[0]} ${it.줄이름}`, ...(it.믿음 ? { 믿음: it.믿음 } : {}) }
}
// ⚠️⚠️ **한 PSA 줄은 한 카드만 가져간다**(2026-08-31). 여러 슬러그를 한꺼번에 훑었더니
//    맨 카드와 무늬 카드가, 또 해가 다른 대회 카드끼리 같은 줄을 나눠 갖는 자리가 99곳 생겼다.
//    둘 중 어느 쪽이 맞는지는 사람이 봐야 하므로 **둘 다 안 쓴다**(끼워 맞추지 않는다).
{
  const 표 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/psaPopFix.json'), 'utf8'))
  const 쓴줄 = new Map()   // 출처 → [카드id…]
  for (const [k, v] of Object.entries(표)) if (v && v.출처) { if (!쓴줄.has(v.출처)) 쓴줄.set(v.출처, []); 쓴줄.get(v.출처).push(k) }
  for (const [tcg, it] of Object.entries(넣을것)) {
    const 남 = (쓴줄.get(it.출처) || []).filter((x) => x !== tcg)
    if (남.length) { delete 넣을것[tcg]; 겹침++; continue }
    if (!쓴줄.has(it.출처)) 쓴줄.set(it.출처, [])
    쓴줄.get(it.출처).push(tcg)
  }
  // 이번에 담은 것끼리 겹친 것도 걷어낸다.
  const 몇 = {}
  for (const it of Object.values(넣을것)) 몇[it.출처] = (몇[it.출처] || 0) + 1
  for (const [tcg, it] of Object.entries(넣을것)) if (몇[it.출처] > 1) { delete 넣을것[tcg]; 겹침++ }
  하나 = Object.keys(넣을것).length
}
console.log(`한 곳에서만 걸린 카드 ${하나}장 · 여러 곳에서 엇갈린 카드 ${여럿}장` + (겹침 ? ` · 남이 이미 쓰는 줄이라 건너뛴 카드 ${겹침}장` : ''))
if (process.argv.includes('--적기') && 하나) {
  const { 적기 } = await import('./psa팝-기록.mjs')
  const w = 적기(넣을것)
  console.log(`  적음 ${하나}칸 · 값바꿈 ${w.바꿈}`)
}
