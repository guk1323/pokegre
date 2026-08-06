// 스니커덩크가 쓰는 세트 코드와 어긋난 것을 바로잡는다.
//
// 왜: 세트 코드는 스니커덩크 검색의 열쇠다("SM11 065"). 우리 코드가 다르면 그 세트
// 카드가 통째로 0건이 된다. ja-sn11(미라클트윈)·ja-sn10a(GG엔드)가 그랬다 —
// 스니커덩크는 SM11·SM10a로 부른다(2026-08-07 카드 이름까지 견줘 확인).
//
// ⚠️ 슬러그(ja-sn11)는 그대로 둔다. 주소·사이트맵·PPT 대응표가 슬러그를 열쇠로 쓰므로
//    건드리면 링크가 깨진다. 바꾸는 것은 세트 코드(id)뿐이다.
// ⚠️ 코드를 바꾸기 전에 반드시 **카드 이름까지 견줘** 확인할 것. 번호만 맞는 다른
//    세트를 가리키게 되면 남의 카드 시세를 보여 준다.
//
// 쓰는 법: npx tsx scripts/fix-set-codes.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')

/** 우리 슬러그 → 스니커덩크가 쓰는 코드 */
const 고칠것: Record<string, string> = {
  'ja-sn11': 'SM11',
  'ja-sn10a': 'SM10a',
  // 프로모 세트는 스니커덩크가 하이픈을 넣어 적는다(2026-08-07 카드 3장씩 견줘 확인).
  //   SP  001 ピカチュウ → [S-P 001]  · 160 ガラルバリヤード → [S-P 160]
  //   XYP 001 ピカチュウ → [XY-P 001] · 219 アグノム       → [XY-P 219]
  'ja-SP': 'S-P',
  'ja-XYP': 'XY-P',
  //   SMP 001 カビゴンGX → [SM-P 001] · 294 ミミッキュ → [SM-P 294]
  //   BWP 001 ヤナップ   → [BW-P 001] · 172 ランプラー → [BW-P 172]
  'ja-SMP': 'SM-P',
  'ja-BWP': 'BW-P',
}
// ⚠️ 하이픈이 늘 답은 아니다. SV2P·S10P·SMP2·CP1~6은 하이픈 없이 잘 걸리고,
//    ja-SVP는 SVP·SV-P 둘 다 0건이라 코드가 또 다르거나 스니커덩크에 없다.
//    P가 붙었다고 일괄로 바꾸지 말고 세트마다 카드 이름을 견줘 확인할 것.

const p = path.join(ROOT, 'public/sets/index.json')
const idx = JSON.parse(readFileSync(p, 'utf-8')) as any[]
let 고침 = 0
for (const s of idx) {
  const 새코드 = 고칠것[s.slug]
  if (!새코드 || s.id === 새코드) continue
  console.log(`  ${s.slug.padEnd(12)} "${s.name}"  코드 "${s.id}" → "${새코드}"`)
  s.id = 새코드
  고침++
}
if (WRITE && 고침) writeFileSync(p, JSON.stringify(idx))
console.log(`\n  ${고침}개${WRITE ? ' 고쳐 저장했다' : ' (미리보기 — --write 로 저장)'}\n`)
