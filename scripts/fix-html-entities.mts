// 카드·세트 이름에 남은 HTML 기호(&amp; 따위)를 푼다.
//
// 왜: 원본이 "アルセウス&amp;ディアルガ&amp;パルキアGX"처럼 실어 보낸다. 그대로 두면
// 화면에도 "아르세우스&amp;디아루가&amp;펄기아 GX"로 뜨고, 마켓 검색어에도 그 글자가
// 섞여 들어간다(2026-08-07 점검 중 발견).
//
// 쓰는 법: npx tsx scripts/fix-html-entities.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const 풀기 = (s: string) =>
  String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
let 고침 = 0
for (const s of idx) {
  const p = path.join(ROOT, 'public/sets', `${s.slug}.json`)
  let d: any
  try { d = JSON.parse(readFileSync(p, 'utf-8')) } catch { continue }
  let 바뀜 = false
  for (const c of d.cards ?? []) {
    const 새 = 풀기(c.name)
    if (새 === c.name) continue
    console.log(`  ${s.id} ${String(c.n).padEnd(4)} "${c.name}" → "${새}"`)
    c.name = 새
    바뀜 = true
    고침++
  }
  if (WRITE && 바뀜) writeFileSync(p, JSON.stringify(d))
}
console.log(`\n  ${고침}장${WRITE ? ' 고쳐 저장했다' : ' (미리보기 — --write 로 저장)'}\n`)
