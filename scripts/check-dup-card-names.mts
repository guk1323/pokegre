/**
 * 같은 세트 안에서 **다른 카드인데 화면 이름이 똑같은** 경우를 찾는다.
 *
 * 왜 필요한가 — 사전에 한 줄을 잘못 적으면 두 카드가 한 이름이 된다. 화면만 봐서는
 * 절대 못 찾는다(둘 다 그럴듯한 한글이라서). 2026-08-08에 이 검사로 잡았다:
 *     S8(퓨전아츠) 089 クロスシーバー(Crossceiver)
 *     S8(퓨전아츠) 090 クロススイッチャー(Cross Switcher)
 *   둘 다 "크로스 스위처"로 적혀 있었다.
 *
 * ⚠️ **두 가지는 겹쳐도 정상이라 걸러낸다.**
 *   ① 원문까지 같은 것 — 같은 카드의 다른 인쇄(아트레어·홀로 재판)다.
 *   ② 한쪽만 영어인 것 — 원본 자료에 일본어 이름이 빠져 영어로 들어온 것뿐이다.
 *      ja-SV10에만 34장 있다. 이걸 안 거르면 74건이 나와서 진짜 문제가 묻힌다.
 *
 * 실행: node --experimental-strip-types scripts/check-dup-card-names.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koName } from '../src/lib/koCardName.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
const CJK = /[぀-ヿ一-鿿]/

let 겹침수 = 0
for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const ed = f.startsWith('ja-') ? 'ja' : 'en'
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { cards?: { n?: string; name?: string }[] }
  const 묶음 = new Map<string, { n: string; 원: string }[]>()
  for (const c of j.cards ?? []) {
    const 원 = String(c.name ?? '')
    if (!원) continue
    const ko = koName(ed, 원)
    묶음.set(ko, [...(묶음.get(ko) ?? []), { n: String(c.n), 원 }])
  }
  for (const [ko, xs] of 묶음) {
    const 원들 = [...new Set(xs.map((x) => x.원))]
    if (원들.length < 2) continue
    if (new Set(원들.map((x) => CJK.test(x))).size > 1) continue
    겹침수++
    console.log(`  ${f.replace('.json', '').padEnd(11)} "${ko}"  ← ${xs.map((x) => x.n + ' ' + x.원).join('  |  ')}`)
  }
}
console.log(
  겹침수
    ? `\n다른 카드인데 이름이 같은 묶음: ${겹침수}개 — 사전을 확인할 것.`
    : '겹치는 이름 없음.',
)
// ⚠️ ja-E1 "무장조"(096 エアームド · 128 スカルモリー)는 **정상이다.** 덤프에도
//    Skarmory가 096/128과 128/128 둘 다 있다 — 같은 포켓몬의 홀로 재판이다.
