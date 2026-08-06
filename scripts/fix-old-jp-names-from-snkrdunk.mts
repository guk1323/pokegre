// 옛 일본판 세트 카드 이름을 **스니커덩크에서 받은 정식 이름으로 바꾼다**.
//
// 왜: 원본(TCGdex)의 옛 세트 일본어 칸이 오염돼 있다. 영어명을 소리로 옮긴 가짜 이름
// (ガストリー=Gastly, 정식은 ゴース), 아예 영어로 남은 것(luvdisc·Omastar),
// 메가진화 표기가 빠진 것(フシギバナEX ↔ MフシギバナEX가 같은 이름이 돼 버림)이 섞여 있다.
// 세트 목록에서 PCG3 043을 "어둠의 최면"으로 보여주는데 눌러 나온 스니커덩크는
// "나쁜 슬리퍼"였다(2026-08-07 발견). 스니커덩크가 실제로 그 카드를 파는 곳이라 그쪽이 맞다.
//
// ⚠️ 안전 규칙: **바꾼 이름이 한글로 안 풀리면 바꾸지 않는다.**
//    스니커덩크 이름에 한자가 섞이면(ホロンの聖跡·思い出のみ) 우리 사전이 못 읽어
//    화면에 한자가 그대로 나간다. 틀린 것보다 빈칸이 낫고, 되던 게 깨지면 더 나쁘다.
//
// 받는 건 fetch-old-jp-names.mts가 한다. 여기서는 그 결과를 적용만 한다.
// 쓰는 법: npx tsx scripts/fix-old-jp-names-from-snkrdunk.mts [받은파일] [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/cardCatalog.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const IN = process.argv.find((a) => a.endsWith('.json')) ?? '/tmp/old-jp-names.json'
const 받음 = JSON.parse(readFileSync(IN, 'utf-8')) as Record<string, { 우리: string; 저쪽: string }>

/** 화면에 원어가 그대로 나가는가(한자·가나가 남거나 통째로 영어인가). */
const 원어남음 = (s: string) => /[ぁ-んァ-ヶ一-鿿]/.test(s) || /^[A-Za-z0-9 .'&-]+$/.test(s)

const 세트별 = new Map<string, { n: string; 저쪽: string }[]>()
for (const [key, v] of Object.entries(받음)) {
  const [slug, n] = key.split('|')
  if (!slug || !n || !v.저쪽 || v.우리 === v.저쪽) continue
  세트별.set(slug, [...(세트별.get(slug) ?? []), { n, 저쪽: v.저쪽 }])
}

let 바꿈 = 0
let 지킴 = 0
const 지킨예: string[] = []
const 바꾼예: string[] = []
for (const [slug, 것들] of 세트별) {
  const p = path.join(ROOT, `public/sets/${slug}.json`)
  let d: any
  try { d = JSON.parse(readFileSync(p, 'utf-8')) } catch { continue }
  let 손댐 = false
  for (const c of d.cards ?? []) {
    const 하나 = 것들.find((x) => x.n === String(c.n))
    if (!하나) continue
    const 지금 = koName('ja', String(c.name ?? ''))
    const 새것 = koName('ja', 하나.저쪽)
    // 지금은 멀쩡히 한글로 나오는데 바꾸면 원어가 남는다면 그대로 둔다.
    if (!원어남음(지금) && 원어남음(새것)) {
      지킴++
      if (지킨예.length < 15) 지킨예.push(`${slug} ${하나.n}  "${c.name}"→"${지금}"  (새 이름 "${하나.저쪽}"→"${새것}")`)
      continue
    }
    if (바꾼예.length < 20) 바꾼예.push(`${slug} ${하나.n}  "${c.name}"→"${지금}"   ⇒  "${하나.저쪽}"→"${새것}"`)
    c.name = 하나.저쪽
    바꿈++
    손댐 = true
  }
  if (손댐 && WRITE) writeFileSync(p, JSON.stringify(d))
}
console.log(`\n  받은 ${Object.keys(받음).length}장 중 이름이 다른 것 ${[...세트별.values()].reduce((a, b) => a + b.length, 0)}장`)
console.log(`  ✓ 바꿈            ${바꿈}장${WRITE ? ' (저장함)' : ' (미리보기 — --write 로 저장)'}`)
console.log(`  · 한글이 깨져 그대로 둠 ${지킴}장\n`)
console.log('  [바꾼 것]'); 바꾼예.forEach((l) => console.log(`      ${l}`))
console.log('\n  [그대로 둔 것]'); 지킨예.forEach((l) => console.log(`      ${l}`))
console.log('')
