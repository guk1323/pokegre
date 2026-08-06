// 일본판 세트 코드가 **스니커덩크가 쓰는 코드와 같은지** 전수로 확인한다.
//
// 왜: 세트 코드는 스니커덩크 검색의 열쇠다("SM11 065"). 하나라도 어긋나면 그 세트
// 카드가 통째로 0건이 된다. 미라클트윈(sn11→SM11)·GG엔드(sn10a→SM10a)가 실제로
// 그랬고, 표본 검사로 우연히 걸렸다(2026-08-07). 우연에 맡길 일이 아니다.
//
// 어떻게: 세트마다 카드 두 장을 골라 "코드 번호"로 물어본 뒤,
//   ① 그 코드·번호가 제목에 있는가  ② 카드 이름도 같은가
// 를 본다. ②까지 봐야 한다 — 번호만 맞고 다른 세트를 가리키는 경우가 있다.
//
// ⚠️ 0건은 "코드가 틀렸다"가 아니다. 스니커덩크에 그 세트가 아예 없을 수도 있다(옛 세트가
//    그렇다). 그래서 **이름이 어긋난 것**만 문제로 센다.
// ⚠️ 이름은 **화면에 뜨는 한글끼리** 견준다. 원문으로 견주면 옛 세트가 통째로 걸린다 —
//    원본의 일본어 칸이 영어 음차로 오염돼 있어서다("バネット" ↔ 정식 "ジュペッタ").
//    화면에는 번역기가 "다크펫"으로 옳게 낸다. 첫 실행에서 10개가 걸렸는데 7개가
//    이것이었다(2026-08-07). 같은 실수를 다른 도구에서 한 번 했는데 또 했다.
// ⚠️ 스니커덩크는 무료다 — PPT 크레딧을 쓰지 않는다.
//
// 쓰는 법: npx tsx scripts/check-set-codes.mts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/cardCatalog.ts'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))
const 서버 = process.env.POKEGRE_ORIGIN ?? 'http://localhost:3000'

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 일본 = idx.filter((s) => s.ed === 'ja' && !(s.serie ?? '').includes('Pocket'))

const 이름열쇠 = (s: string) =>
  String(s)
    .replace(/[\s・·:：]/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .toLowerCase()

let 맞음 = 0
let 없음 = 0
const 어긋남: string[] = []

console.log(`\n  일본판 세트 ${일본.length}개의 코드를 스니커덩크와 견준다 (무료 · ${Math.ceil((일본.length * 2 * 0.8) / 60)}분쯤)\n`)

let 센것 = 0
for (const s of 일본) {
  let d: any
  try {
    d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', `${s.slug}.json`), 'utf-8'))
  } catch {
    continue
  }
  const cs = (d.cards ?? []).filter((c: any) => c.n && c.name)
  if (!cs.length) continue
  // 앞·중간에서 한 장씩 — 한 장만 보면 그 카드만 없는 경우와 구별이 안 된다.
  const 뽑기 = [cs[0], cs[Math.floor(cs.length / 2)]].filter(Boolean)
  let 세트결과: 'ok' | 'none' | 'bad' = 'none'
  let 증거 = ''
  for (const c of 뽑기) {
    let ps: { title: string }[] = []
    try {
      const j: any = await fetch(
        `${서버}/api/snkrdunk/v3/search?func=all&refId=search&keyword=${encodeURIComponent(`${s.id} ${c.n}`)}` +
          `&sortKey=default&cardVersion=2&brandIds=pokemon&perPage=4&page=1`,
      ).then((r) => r.json())
      ps = j?.search?.rankingProducts ?? []
    } catch {
      /* 못 받으면 없음으로 둔다 */
    }
    await nap(700)
    const re = new RegExp(
      `\\[${String(s.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[-\\s](?:No\\.)?0*${Number(c.n)}(?:[/\\]]|\\s)`,
      'i',
    )
    const 맞 = ps.filter((p) => re.test(p.title))
    if (!맞.length) continue
    const 우리 = 이름열쇠(koName('ja', c.name))
    const 저쪽 = 이름열쇠(koreanizeTitle(String(맞[0].title).split('[')[0]))
    if (저쪽.includes(우리) || 우리.includes(저쪽)) {
      세트결과 = 'ok'
      break
    }
    세트결과 = 'bad'
    증거 = `${s.id} ${c.n} 우리 "${c.name}" ↔ 스니커덩크 "${String(맞[0].title).split('[')[0].trim()}"`
  }
  if (세트결과 === 'ok') 맞음++
  else if (세트결과 === 'bad') 어긋남.push(`${s.slug.padEnd(12)} "${s.name}"  ${증거}`)
  else 없음++
  센것++
  if (센것 % 10 === 0) process.stdout.write(`\r  ${센것}/${일본.length}개 · 맞음 ${맞음} · 어긋남 ${어긋남.length} · 못 봄 ${없음}   `)
}

console.log(`\n\n  세트 ${센것}개`)
console.log(`  ✓ 코드가 맞음              ${맞음}개`)
console.log(`  · 스니커덩크에 없어 못 봄    ${없음}개 (옛 세트가 대부분)`)
console.log(`  ${어긋남.length ? '✗' : '✓'} 코드가 어긋남            ${어긋남.length}개\n`)
어긋남.forEach((e) => console.log(`      ${e}`))
console.log('')
