// 검색어 점검: 한글 검색어가 일본어(스니커덩크)·영어(이베이·TCGplayer) 양쪽으로
// 온전히 나가는지 한 번에 잰다.
//
// 왜 필요한가: 한글→일본어와 한글→영어는 **따로 도는 두 길**이다. 2026-08-02~03에만
// 세 번, 한쪽만 고치고 다른 쪽을 잊었다:
//   · "메가디안시" 처리가 영어 쪽에만 있어 일본어 쪽에서 「메サーナイト시」로 깨졌다
//   · 별칭 사전(백마 버드렉스·오리진디아르가)을 일본어 쪽에만 넣었다
//   · "이슬이·시로나" 표기 보정을 일본어 쪽에만 넣어 이베이 검색이 계속 빗나갔다
// 눈으로는 계속 놓치니, 두 방향을 나란히 놓고 **한쪽만 되는 것**을 따로 뽑아 준다.
//
// 쓰기: npx tsx scripts/search-check.mts
//       npx tsx scripts/search-check.mts --list          (안 되는 것 목록까지)
//       npx tsx scripts/search-check.mts --terms <파일>   (실제 검색어도 같이 — 아래 참고)
//
// 실제 방문자 검색어로 재려면 운영 서버에서 받아 "검색어<탭>횟수" 꼴로 저장한다:
//   fly ssh console -a pokegre -C "cat /data/search-counts.json" > /tmp/sc.json
//   (날짜별로 묶여 있으니 합쳐서 쓴다 — 아래 readTerms가 json도 그대로 읽는다)
import { readFileSync, readdirSync } from 'node:fs'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import { translateSearchQuery } from '../src/lib/translateQuery.ts'
import { translateSearchQueryToEnglish } from '../src/lib/translateQueryToEnglish.ts'

const LIST = process.argv.includes('--list')
const LIMIT = 25
const termsArg = process.argv.indexOf('--terms')
const hasKo = (s: string) => /[가-힣]/.test(s)

// 화면에 나오는 그대로의 한글 카드명을 모은다.
function cardNames(): string[] {
  const out = new Set<string>()
  for (const f of readdirSync('public/sets')) {
    if (!f.endsWith('.json') || f === 'index.json') continue
    const d = JSON.parse(readFileSync(`public/sets/${f}`, 'utf8')) as { cards?: { name: string }[] }
    const ja = f.startsWith('ja-')
    for (const c of d.cards ?? []) {
      if (!c.name) continue
      const ko = ja ? koreanizeEnglishCardName(koreanizeTitle(c.name)) : koreanizeEnglishCardName(c.name)
      if (hasKo(ko)) out.add(ko)
    }
  }
  return [...out]
}

// 방문자가 실제로 친 검색어. search-counts.json(날짜별)도, "말<탭>횟수" 파일도 읽는다.
function readTerms(file: string): Map<string, number> {
  const raw = readFileSync(file, 'utf8')
  const out = new Map<string, number>()
  const text = raw.slice(raw.indexOf('{') >= 0 ? raw.indexOf('{') : 0)
  try {
    const j = JSON.parse(text) as Record<string, Record<string, number> | number>
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === 'number') out.set(k, (out.get(k) ?? 0) + v)
      else for (const [t, n] of Object.entries(v ?? {})) if (typeof n === 'number') out.set(t, (out.get(t) ?? 0) + n)
    }
    return out
  } catch {
    /* json이 아니면 탭 파일로 읽는다 */
  }
  for (const line of raw.trim().split('\n')) {
    const [t, n] = line.split('\t')
    if (t) out.set(t, Number(n) || 1)
  }
  return out
}

function report(title: string, terms: Map<string, number>) {
  const total = [...terms.values()].reduce((s, n) => s + n, 0)
  let jaOk = 0
  let enOk = 0
  const jaBad: [string, number, string][] = []
  const enBad: [string, number, string][] = []
  // 한쪽만 되는 것 — 이게 이 검사의 핵심이다.
  const lopsided: [string, number, string, string][] = []
  for (const [term, n] of terms) {
    const ja = translateSearchQuery(term)
    const en = translateSearchQueryToEnglish(term)
    const jaGood = !hasKo(ja)
    const enGood = !hasKo(en)
    if (jaGood) jaOk += n
    else jaBad.push([term, n, ja])
    if (enGood) enOk += n
    else enBad.push([term, n, en])
    if (jaGood !== enGood) lopsided.push([term, n, ja, en])
  }
  const pct = (x: number) => ((x / total) * 100).toFixed(1)
  console.log(`\n── ${title} ─ ${terms.size}종 / ${total}번 ──`)
  console.log(`  일본어(스니커덩크)로 온전히 나감  ${jaOk}/${total} (${pct(jaOk)}%) · 한글 남음 ${jaBad.length}종`)
  console.log(`  영어(이베이·TCGplayer)로 온전히   ${enOk}/${total} (${pct(enOk)}%) · 한글 남음 ${enBad.length}종`)
  console.log(`  ⚠️ 한쪽만 되는 것 ${lopsided.length}종  ← 한 방향만 고치고 잊은 자리`)

  const byCount = <T extends [string, number, ...unknown[]]>(a: T[]) => a.sort((x, y) => y[1] - x[1])
  if (lopsided.length) {
    console.log('\n  한쪽만 되는 것 (많이 찾은 순):')
    for (const [t, n, ja, en] of byCount(lopsided).slice(0, LIMIT)) {
      console.log(`    ${String(n).padStart(3)}번  "${t}"`)
      console.log(`           일본어 ${hasKo(ja) ? '✗' : '○'} ${ja}`)
      console.log(`           영어   ${hasKo(en) ? '✗' : '○'} ${en}`)
    }
    if (lopsided.length > LIMIT) console.log(`    … 그 밖 ${lopsided.length - LIMIT}종`)
  }
  if (LIST) {
    for (const [name, arr] of [
      ['일본어로 갈 때 한글이 남는 것', jaBad],
      ['영어로 갈 때 한글이 남는 것', enBad],
    ] as const) {
      if (!arr.length) continue
      console.log(`\n  ${name} (많이 찾은 순 ${LIMIT}개):`)
      for (const [t, n, got] of byCount([...arr]).slice(0, LIMIT))
        console.log(`    ${String(n).padStart(3)}번  "${t}"  →  ${got}`)
      if (arr.length > LIMIT) console.log(`    … 그 밖 ${arr.length - LIMIT}종`)
    }
  }
  return lopsided.length
}

const cards = new Map(cardNames().map((n) => [n, 1] as const))
let lop = report('우리가 가진 카드 이름 전부', cards)

if (termsArg >= 0 && process.argv[termsArg + 1]) {
  lop += report('방문자가 실제로 친 검색어', readTerms(process.argv[termsArg + 1]))
} else {
  console.log('\n(실제 검색어로도 재려면 --terms <파일> — 받는 법은 이 파일 맨 위 설명 참고)')
}

if (!LIST) console.log('\n안 되는 것을 다 보려면 --list')
// 한쪽만 되는 것이 있으면 실패로 끝낸다 — 이게 제일 놓치기 쉬운 실수다.
if (lop) {
  console.log(`\n⚠️ 한쪽 방향만 되는 검색어가 ${lop}종 있습니다. 두 길은 따로 도니 양쪽을 같이 고쳐야 합니다.`)
  process.exitCode = 1
}
