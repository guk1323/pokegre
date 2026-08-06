// 도감의 한 무더기(포켓몬 하나 · 트레이너 하나)에 **다른 카드가 섞였는지** 센다.
//
// 왜: 트레이너·에너지는 이름표가 없어 **한글 카드 이름**으로 묶는다(gen-pokedex.mts).
// 번역이 우연히 같아지면 서로 다른 카드가 한 무더기에 들어간다 — 목록에서 누르면
// 엉뚱한 카드의 시세로 가게 된다. 화면에서 랜덤으로 눌러서는 찾기 어렵고, 원문 이름을
// 세어 보면 공짜로 잡힌다.
//
// 포켓몬 쪽은 원문 이름으로 묶으므로 원래 여러 카드가 섞인다(리자몽 · 메가리자몽 ·
// 리자몽 ex …). 그건 의도된 것이라 세지 않는다.
//
// 쓰는 법: npx tsx scripts/check-pokedex-buckets.mts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  ed: 'ja' | 'en'
  name: string
}[]
const meta = new Map(index.map((s) => [s.slug, s]))
const 도감 = JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex/index.json'), 'utf-8')) as {
  id: number
  ko: string
  c: number
  t: 'p' | 't'
}[]
const ko = (ed: 'ja' | 'en', n: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(n)) : koreanizeEnglishCardName(n)

// 띄어쓰기·가운뎃점·대소문자만 다른 것은 같은 이름으로 본다.
// ⚠️ gen-pokedex가 묶는 기준과 **똑같아야** 한다. 한쪽만 고치면 의도해서 합친 것을
//    "섞였다"고 잘못 세게 된다("뮤 ex"와 "뮤 Ex" — 2026-08-06).
const 열쇠 = (s: string) => s.replace(/[\s·]/g, '').toLowerCase()

let 트레이너수 = 0
const 섞인것: { 이름: string; 종류: string[]; 장수: number }[] = []
for (const row of 도감) {
  if (row.t !== 't') continue
  트레이너수++
  const arr = JSON.parse(readFileSync(path.join(ROOT, `public/pokedex/${row.id}.json`), 'utf-8')) as {
    s: string
    n: string
    name: string
  }[]
  // 그 무더기 안 카드들의 **한글 이름**이 몇 가지인가. 하나여야 정상이다.
  const 이름들 = new Set<string>()
  for (const c of arr) {
    const m = meta.get(c.s)
    if (!m) continue
    이름들.add(열쇠(ko(m.ed, c.name)))
  }
  if (이름들.size > 1) 섞인것.push({ 이름: row.ko, 종류: [...이름들], 장수: arr.length })
}

console.log(`\n  트레이너·에너지 무더기 ${트레이너수.toLocaleString()}개`)
console.log(`  ${섞인것.length ? '✗' : '✓'} 한 무더기에 다른 이름이 섞인 것  ${섞인것.length}개\n`)
for (const s of 섞인것.slice(0, 15)) console.log(`   ${s.이름.padEnd(20)} ${s.장수}장 · ${s.종류.join(' / ')}`)
if (섞인것.length > 15) console.log(`   … 그 밖 ${섞인것.length - 15}개`)
console.log('')
