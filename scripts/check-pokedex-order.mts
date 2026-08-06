// 도감 목록이 **발매 순**으로 서 있는지, 같은 카드가 두 번 들어갔는지 센다.
//
// 왜: 운영자가 요구한 것이 "출시순으로 모든 개굴닌자 카드가 다 나오는" 화면이다.
// 정렬이 깨지면 화면은 멀쩡해 보이는데 순서만 어긋나 — 눈으로는 잘 안 보인다.
// 중복도 마찬가지로, 같은 카드가 두 번 서 있으면 세어 보기 전엔 모른다.
//
// 쓰는 법: npx tsx scripts/check-pokedex-order.mts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { 번호순 } from './gen-pokedex.mts'

const ROOT = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  name: string
  releaseDate?: string
}[]
const meta = new Map(index.map((s) => [s.slug, s]))

let 무더기 = 0
let 총장수 = 0
const 순서깨짐: string[] = []
const 중복: string[] = []
const 날짜없음 = new Map<string, number>()

for (const f of readdirSync(path.join(ROOT, 'public/pokedex'))) {
  if (f === 'index.json') continue
  무더기++
  const arr = JSON.parse(readFileSync(path.join(ROOT, 'public/pokedex', f), 'utf-8')) as {
    s: string
    n: string
    name: string
  }[]
  총장수 += arr.length

  // ① 발매 순. gen-pokedex가 쓰는 기준과 같게 본다 — 날짜가 없으면 맨 뒤.
  //
  // ⚠️ 세 값을 이어붙여 한 번에 견주면 안 된다. 구분자 '|'가 '.'보다 커서
  //    "en-swsh9|129"와 "en-swsh9.5tg|TG24"의 앞뒤가 뒤집힌다 — 멀쩡한 순서를
  //    깨졌다고 잘못 세게 된다(2026-08-06에 내가 그렇게 만들었다).
  //    gen-pokedex처럼 **한 칸씩 차례로** 견준다.
  const 앞뒤 = (a: { s: string; n: string }, b: { s: string; n: string }) =>
    (meta.get(a.s)?.releaseDate || '9').localeCompare(meta.get(b.s)?.releaseDate || '9') ||
    a.s.localeCompare(b.s) ||
    // ⚠️ 번호는 **숫자로** 견준다. 글자로 견주면 "9" 다음 "10"이 깨진 것처럼 보인다.
    //    만드는 쪽(gen-pokedex)에서 쓰는 바로 그 함수를 가져와 쓴다 — 규칙을 여기
    //    또 베끼면 언젠가 어긋나고, 실제로 한 번 어긋나 멀쩡한 무더기 6개를 잘못
    //    잡았다(2026-08-07).
    번호순(a.n, b.n)
  for (let i = 1; i < arr.length; i++) {
    if (앞뒤(arr[i - 1], arr[i]) > 0) {
      if (순서깨짐.length < 6)
        순서깨짐.push(
          `${f} ${i}번째: ${meta.get(arr[i - 1].s)?.releaseDate ?? '?'} ${arr[i - 1].s} ${arr[i - 1].n}` +
            ` → ${meta.get(arr[i].s)?.releaseDate ?? '?'} ${arr[i].s} ${arr[i].n}`,
        )
      break
    }
  }

  // ② 같은 세트·번호가 두 번 들어갔나.
  const 본것 = new Set<string>()
  for (const c of arr) {
    const k = `${c.s}|${c.n}`
    if (본것.has(k)) {
      if (중복.length < 6) 중복.push(`${f} ${c.s} ${c.n} ${c.name}`)
    }
    본것.add(k)
    if (!meta.get(c.s)?.releaseDate) 날짜없음.set(c.s, (날짜없음.get(c.s) ?? 0) + 1)
  }
}

const 줄 = (제목: string, n: number, 예: string[]) => {
  console.log(`  ${n ? '✗' : '✓'} ${제목.padEnd(28)} ${n}`)
  for (const e of 예) console.log(`      ${e}`)
}
console.log(`\n  도감 무더기 ${무더기.toLocaleString()}개 · 카드 ${총장수.toLocaleString()}장\n`)
줄('발매 순이 깨진 무더기', 순서깨짐.length, 순서깨짐)
줄('같은 카드가 두 번', 중복.length, 중복)
const 날짜없는장수 = [...날짜없음.values()].reduce((a, b) => a + b, 0)
console.log(`  ${날짜없는장수 ? '△' : '✓'} 발매일이 없는 세트의 카드   ${날짜없는장수}장 · 세트 ${날짜없음.size}개 (맨 뒤로 간다)`)
for (const [slug, n] of [...날짜없음].sort((a, b) => b[1] - a[1]).slice(0, 6))
  console.log(`      ${String(n).padStart(4)}장  ${slug.padEnd(12)} ${meta.get(slug)?.name ?? ''}`)
console.log('')
