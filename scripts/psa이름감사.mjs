/**
 * **한글 이름 ↔ 영문 이름 사전이 틀린 곳**을 PSA 원장으로 찾아낸다.
 *
 * 왜 있나: 2026-08-31에 「도희」가 Sophocles로, 「회연」이 Wikstrom으로, 「주혜」가
 * Serena로 잘못 적혀 있었다. 셋 다 PSA 줄과 번호는 딱 맞는데 이름만 달라서 보류로
 * 남아 있었다. 그 자리를 자동으로 모아 보여 준다.
 *
 * 어떻게 찾나: 짝지어 둔 세트마다 「번호는 맞는 줄이 **딱 하나** 있는데 이름이 안 맞아
 * 보류된 카드」를 모은다. 이런 자리는 십중팔구 사전이 틀린 것이다.
 *
 * ⚠️ **자동으로 고치지 않는다.** 사람이 보고 판단할 목록만 낸다.
 *
 * 쓰는 법: node scripts/psa이름감사.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { 우리카드, 줄읽기, 대조, 덱단서, 덱이름으로, 슬러그단서 } from './psa대조.mjs'
import { 번호같나, 풀기, 줄갈래 } from './psa검증.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const 읽기 = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'))
const 짝 = 읽기('data/psa짝목록.json')

let 몇 = 0
for (const [슬러그, 줄파일, psaId, 줄에, 우리이름에] of 짝) {
  let 줄들
  try { 줄들 = 줄읽기(readFileSync(path.join(ROOT, `data/psa줄/${줄파일}.txt`), 'utf8')) } catch { continue }
  if (줄에) 줄들 = 줄들.filter((r) => new RegExp(줄에, 'i').test(r.이름))
  const 결과 = 대조(슬러그, 줄들, { 우리이름에 })
  // ⚠️ **짝이 대체로 잘 맞는 세트에서만** 본다. 프로모·점보처럼 번호가 뒤죽박죽인
  //    묶음에서는 「번호만 우연히 같은 딴 카드」가 잔뜩 걸려 헛것만 나온다.
  const 맞은수 = 결과.같음.length + 결과.다름.length
  if (맞은수 < 3 || 결과.보류.length > 맞은수) continue
  for (const c of 결과.보류) {
    if (!/이름이 안 맞는다/.test(String(c.까닭 || ''))) continue
    // 번호가 맞는 줄이 딱 하나일 때만 알린다(둘 이상이면 갈래 문제라 사전 탓이 아니다).
    const 같은번호 = 줄들.filter((r) => 번호같나(r.번호, String(c.n).split('~')[0]))
    if (같은번호.length !== 1) continue
    // 우리 쪽에도 그 번호가 하나뿐이어야 한다(갈래로 갈린 번호는 이름 탓이 아니다).
    if (우리카드(슬러그).filter((x) => 번호같나(String(x.n).split('~')[0], String(c.n).split('~')[0])).length !== 1) continue
    const 우리 = 풀기(c.이름).후보.join('/')
    console.log(`${슬러그.padEnd(28)} ${String(c.n).padEnd(8)} ${c.이름}`)
    console.log(`  우리: ${우리}   ↔   PSA: ${같은번호[0].이름}`)
    몇++
  }
}
console.log(`이름만 어긋난 자리 ${몇}곳`)
