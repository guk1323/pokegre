// 옛 일본판 세트 카드의 **도감 번호**를 받아 둔다.
//
// 왜: 옛 세트는 원본의 이름 칸이 오염돼 있다 — 포켓몬 영어 이름이 일반 단어로 번역돼
// 화면에 "헌터"(Haunter=고우스트), "실"(Seel=쥬쥬), "울음소리"(Growlithe=가디)로 뜬다.
// 이름으로는 손쓸 방법이 없다. 그런데 원본이 도감 번호는 정확히 들고 있다 — 93번이면
// 고우스트다(2026-08-07 확인). 번호만 있으면 우리 사전으로 옳은 한글 이름을 붙일 수 있다.
//
// 왜 이 세트들만: GraphQL은 영문판만 준다. 일본판은 카드마다 상세를 불러야 하는데
// 38,000장은 몇 시간이 걸린다. 이름이 깨진 곳은 옛 세트에 몰려 있으므로 거기만 받는다
// (26세트 2,184장 ≈ 16분).
//
// ⚠️ 무료다 — PPT 크레딧을 쓰지 않는다.
// ⚠️ 도감 번호를 그대로 이름에 쓰면 안 된다. "오리진디아르가 V"는 디아루가(483)와
//    번호가 같아서, 번호대로 고치면 멀쩡한 이름을 망친다. 이 스크립트는 **받아 두기만**
//    하고, 무엇을 고칠지는 따로 판단한다.
//
// 쓰는 법: npx tsx scripts/fetch-old-jp-dex.mts [--write]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))
const 밖 = path.join(ROOT, 'src/data/oldJpDex.json')

async function 받기(url: string, 시도 = 4): Promise<any | null> {
  for (let i = 0; i < 시도; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'pokegre' } })
      if (r.ok) return await r.json()
      if (r.status === 404) return null
      if (r.status < 500) return null
    } catch {
      /* 다시 본다 */
    }
    await nap(800 * (i + 1))
  }
  return null
}

type SetMeta = { slug: string; ed: 'ja' | 'en'; id: string; name: string }
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as SetMeta[]
const 옛 = index.filter((s) => s.ed === 'ja' && /^(E\d|PCG\d|neo\d|VS\d|web\d|PMCG\d)/i.test(s.id))

// 이미 받아 둔 것이 있으면 이어서 받는다(중간에 끊겨도 다시 다 두드리지 않는다).
const 결과: Record<string, { d?: number; c?: string; n?: string }> = existsSync(밖)
  ? JSON.parse(readFileSync(밖, 'utf-8'))
  : {}

let 본것 = 0
let 새로 = 0
let 도감있음 = 0
const 총 = 옛.reduce((a, s) => {
  try {
    return a + (JSON.parse(readFileSync(path.join(ROOT, 'public/sets', `${s.slug}.json`), 'utf-8')).cards ?? []).length
  } catch {
    return a
  }
}, 0)

console.log(`\n  옛 일본판 세트 ${옛.length}개 · 카드 ${총.toLocaleString()}장 (이미 받은 것 ${Object.keys(결과).length}장)\n`)

for (const s of 옛) {
  let d: any
  try {
    d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', `${s.slug}.json`), 'utf-8'))
  } catch {
    continue
  }
  for (const c of d.cards ?? []) {
    본것++
    const 열쇠 = `${s.id}-${c.n}`
    if (결과[열쇠]) continue
    const j = await 받기(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(s.id)}-${encodeURIComponent(c.n)}`)
    await nap(320)
    if (!j || !j.category) {
      // 못 받은 것도 표시해 둔다 — 다음에 또 두드리지 않게.
      결과[열쇠] = {}
      continue
    }
    const dex = Array.isArray(j.dexId) && j.dexId.length ? Number(j.dexId[0]) : undefined
    결과[열쇠] = { c: j.category === 'Pokemon' ? 'p' : j.category === 'Trainer' ? 't' : 'e', d: dex, n: j.name }
    새로++
    if (dex) 도감있음++
    if (새로 % 25 === 0) {
      process.stdout.write(`\r  ${본것}/${총}장 · 새로 받은 것 ${새로} · 도감번호 ${도감있음}     `)
      if (WRITE) writeFileSync(밖, JSON.stringify(결과))
    }
  }
}

console.log(`\n\n  받아 둔 카드 ${Object.keys(결과).length.toLocaleString()}장 · 이번에 새로 ${새로.toLocaleString()}장`)
console.log(`  도감 번호를 아는 카드 ${Object.values(결과).filter((v) => v.d).length.toLocaleString()}장`)
if (WRITE) {
  writeFileSync(밖, JSON.stringify(결과))
  console.log(`\n  ${path.relative(ROOT, 밖)} 에 저장했다.\n`)
} else {
  console.log(`\n  (미리보기 — --write 로 저장)\n`)
}
