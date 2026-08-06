// 카드가 **포켓몬인지 트레이너인지 에너지인지**를 원본에서 받아 둔다.
//
// 왜: 도감(포켓몬명 목록)은 이름만 보고 종류를 짐작한다 — 포켓몬 이름 사전에 정확히
// 맞으면 포켓몬, 아니면 트레이너. 그래서 "빛나는 리자몽", "피카츄 ex", "가라르 파오리"
// 같은 멀쩡한 포켓몬 카드가 "트레이너·에너지"로 표시된다(2026-08-07 점검 중 발견).
// 이름으로 규칙을 더 만들면 "모험의 랜턴"(트레이너)이 포켓몬이 되는 새 오류가 생긴다.
// 짐작하지 말고 원본에 물어보는 것이 맞다.
//
// tcgdex는 세트 단위로 종류를 걸러 준다(`?set=neo4&category=Pokemon`). 카드마다
// 상세를 부르면 38,000번이라 몇 시간이 걸리지만, 이 방법은 세트당 세 번이면 된다.
//
// ⚠️ 무료다 — PPT 크레딧을 쓰지 않는다.
//
// 쓰는 법: npx tsx scripts/fetch-card-categories.mts [--write]
//   --write 없이 돌리면 몇 장이 어떻게 갈리는지만 보여 준다.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ⚠️ 원본이 가끔 500을 뱉는다. 한 번 실패를 "없다"로 읽으면 그 세트가 통째로 빠진다.
async function 받기(url: string, 시도 = 5): Promise<any[] | null> {
  for (let i = 0; i < 시도; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'pokegre' } })
      if (r.ok) {
        const j = await r.json()
        return Array.isArray(j) ? j : []
      }
      if (r.status === 404) return []
      if (r.status < 500) return null
    } catch {
      /* 다시 본다 */
    }
    await nap(900 * (i + 1))
  }
  return null
}

type SetMeta = { slug: string; ed: 'ja' | 'en'; id: string; name: string; serie?: string }
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as SetMeta[]
const 대상 = index.filter((s) => !(s.serie ?? '').includes('Pocket'))

/** { 세트슬러그: { 카드번호: 'p' | 't' | 'e' } } */
const 결과: Record<string, Record<string, 'p' | 't' | 'e'>> = {}
const 못받음: string[] = []
let 포켓 = 0
let 트레 = 0
let 에너 = 0

console.log(`\n  세트 ${대상.length}개에서 카드 종류를 받는다 (무료 · ${Math.ceil((대상.length * 3 * 0.45) / 60)}분쯤)\n`)

let 센것 = 0
for (const s of 대상) {
  const 언어 = s.ed === 'ja' ? 'ja' : 'en'
  const 칸: Record<string, 'p' | 't' | 'e'> = {}
  let 실패 = false
  for (const [종류, 표] of [
    ['Pokemon', 'p'],
    ['Trainer', 't'],
    ['Energy', 'e'],
  ] as const) {
    const rows = await 받기(
      `https://api.tcgdex.net/v2/${언어}/cards?set=${encodeURIComponent(s.id)}&category=${종류}`,
    )
    await nap(350)
    if (rows === null) {
      실패 = true
      break
    }
    for (const c of rows) {
      const n = String(c.localId ?? '').trim()
      if (!n) continue
      칸[n] = 표
      if (표 === 'p') 포켓++
      else if (표 === 't') 트레++
      else 에너++
    }
  }
  if (실패 || !Object.keys(칸).length) {
    못받음.push(`${s.slug} (${s.id})`)
  } else {
    결과[s.slug] = 칸
  }
  센것++
  if (센것 % 20 === 0)
    process.stdout.write(`\r  ${센것}/${대상.length}세트 · 포켓몬 ${포켓} · 트레이너 ${트레} · 에너지 ${에너}   `)
}

console.log(`\n\n  받은 세트 ${Object.keys(결과).length}개 · 못 받은 세트 ${못받음.length}개`)
console.log(`  포켓몬 ${포켓.toLocaleString()}장 · 트레이너 ${트레.toLocaleString()}장 · 에너지 ${에너.toLocaleString()}장`)
for (const e of 못받음.slice(0, 10)) console.log(`      못 받음: ${e}`)

if (WRITE) {
  writeFileSync(path.join(ROOT, 'src/data/cardCategories.json'), JSON.stringify(결과))
  console.log(`\n  src/data/cardCategories.json 에 저장했다.`)
} else {
  console.log(`\n  (미리보기 — --write 로 저장)`)
}
console.log('')
