/**
 * 한 세트를 **PSA 원장과 대조**하고, 확인된 것만 보정표에 적는다.
 *
 * 흐름(브라우저는 사장님 크롬으로 사람이 연다 — PSA가 로그인을 요구한다):
 *   ① 이 스크립트로 「우리 쪽 목록」을 뽑는다        node scripts/psa대조.mjs 낼것 <세트슬러그>
 *   ② PSA 세트 페이지에서 줄을 긁어 파일로 저장한다  (한 줄 = 번호|이름|10/9/합계)
 *   ③ 대조하고 적는다                              node scripts/psa대조.mjs 대조 <세트슬러그> <줄파일> <PSA세트id> [--적기]
 *
 * ⚠️ `--적기`를 안 주면 **보기만 하고 아무것도 안 쓴다.** 먼저 눈으로 보고 나서 적는다.
 * ⚠️⚠️ **세트 파일과 우리 슬러그가 실제로 짝인 것만 돌린다.**
 *    2026-08-31에 모든 슬러그 × 모든 세트 파일을 한꺼번에 돌렸더니, 번호만 같고 아무 상관 없는
 *    세트끼리 붙어 값이 여럿 틀어졌다(점보 뮤츠 EX가 XY 에볼루션스 뮤츠 EX 값 6,650을 먹음).
 *    그 카드가 **정말 그 세트에서 나온 것인지** 사람이 먼저 확인하고 짝을 지어야 한다.
 * ⚠️⚠️ **줄 파일에는 그 번호의 줄을 하나도 빼지 말고 다 담아야 한다.**
 *    2026-08-31에 「리그·코스모스 줄만」 걸러 담고 대조했더니, 진짜 짝이 걸러져 없어진 카드가
 *    남아 있던 엉뚱한 줄에 붙었다(Water Web Holo 카드가 Pokemon League 줄에 붙음, 6장).
 *    걸러도 되는 것은 **언어판·점보처럼 우리가 절대 안 쓰는 줄**뿐이다.
 * ⚠️ 짝을 못 지은 카드(`보류`)는 건드리지 않는다. 끼워 맞추지 않는 것이 이 도구의 요점이다.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { 짝짓기, 풀기, 번호정리 } from './psa검증.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const 읽기 = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'))
const 덱이름표 = 읽기('data/psa덱이름.json').표

/**
 * 세트 슬러그로 우리 카드를 모은다.
 *
 * @param 새것도 **보정표에 아직 없는 카드까지** 함께 낸다(2026-08-31).
 *   왜: 보정표는 「고칠 값」만 담고 있어서, 그 안에 없는 카드는 대조 대상이 아예 아니었다.
 *   그런데 표본을 재 보니 짝지은 세트에 든 카드 12,565장 중 셋에 하나쯤은 **화면에 감정
 *   수량이 아예 안 뜬다**(거의 다 일본판). 그 자리를 채우려면 카드 목록 전체를 봐야 한다.
 *   ⚠️ 새 카드는 견줄 옛 값이 없으므로 `v`가 null이고, 대조 결과의 `새로` 칸에 담긴다.
 */
export function 우리카드(슬러그, { 출처없는것만 = false, 새것도 = false } = {}) {
  const idx = 읽기('card-index.json')
  const 표 = 읽기('src/data/psaPopFix.json')
  const 것 = []
  for (const r of idx.rows) {
    const [s, n, 이름, , , , , tcg] = r
    if (s !== 슬러그 || !tcg) continue
    const f = 표[String(tcg)]
    if (!f) {
      if (!새것도) continue
      것.push({ tcg: String(tcg), n: String(n), 이름: String(이름), v: null, 새: true })
      continue
    }
    if (출처없는것만 && f.출처) continue
    것.push({ tcg: String(tcg), n: String(n), 이름: String(이름), v: [f.psa10 ?? 0, f.psa9 ?? 0, f.psaAll] })
  }
  return 것
}

/** "번호|이름|10/9/합계" 줄들을 psa줄 객체로 바꾼다. */
export function 줄읽기(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const t = line.trim()
    if (!t) continue
    const p = t.split('|')
    if (p.length < 3) continue
    const v = p[2].split('/').map((x) => Number(String(x).replace(/[^0-9]/g, '')) || 0)
    out.push({ 번호: p[0].trim(), 이름: p[1].trim(), psa10: v[0], psa9: v[1], 합계: v[2] })
  }
  return out
}

/** 우리 세트 슬러그가 알려 주는 「어느 판인지」 단서. 없으면 undefined. */
export function 슬러그단서(슬러그) {
  // ⚠️ 덱 전용 카드는 PSA가 「… Theme Deck」으로 적기도 하고, 무늬 이름(Cracked Ice)으로만
  //    적기도 한다. 확인된 덱 전용 출처 24개 중 11개가 크랙아이스 줄이었다(2026-08-31).
  // ⚠️ PSA는 덱 이름을 「Theme Deck」 없이 적기도 한다(「Mimikyu Hidden Moon Deck」).
  //    이 슬러그는 **덱에만 든 카드**를 모아 둔 곳이라 「Deck」이라는 말 자체를 단서로 쓴다.
  if (슬러그 === 'en-deck-exclusives') return /theme deck|deck exclusive|half deck|cracked ice|battle arena|legendary battle|\bdeck\b/i
  if (슬러그 === 'en-blister-exclusives') return /blister/i
  // ⚠️ 점보 카드는 PSA가 같은 번호 줄 이름에 「Jumbo」를 붙여 가른다.
  if (슬러그 === 'en-jumbo-cards') return /jumbo/i
  return undefined
}

/** 대조 결과를 낸다. 적지는 않는다. */
/**
 * @param 세트크기 카드 이름의 「N/M」에서 M. 주면 **그 세트 카드만** 견준다.
 * ⚠️ 이걸 주는 것이 가장 확실한 안전장치다 — 번호만 같고 딴 세트인 카드가 아예 안 걸린다.
 */
/** 월드덱 카드 이름에서 「연도 + 선수」를 읽어 덱 이름을 찾는다. 없으면 undefined. */
export function 덱찾기(이름) {
  const m = String(이름).match(/-\s*(\d{4})\s*\(([^)]+)\)\s*$/)
  if (!m) return undefined
  return 덱이름표[m[1] + ' ' + m[2].trim()]
}
export function 덱단서(이름) {
  const 덱 = 덱찾기(이름)
  return 덱 ? new RegExp(덱.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined
}
/**
 * 선수 이름을 **PSA가 쓰는 덱 이름으로 바꿔 준다.**
 * 안 바꾸면 「(Jimmy Ballard)」가 못 알아들은 표시로 남아 죄다 보류가 된다 —
 * 우리는 그 선수가 어느 덱인지 이미 알고 있으니 표시를 풀어 주는 것이 맞다.
 */
export function 덱이름으로(이름) {
  const 덱 = 덱찾기(이름)
  return 덱 ? String(이름).replace(/\(([^)]+)\)\s*$/, `(${덱})`) : 이름
}

/**
 * ⚠️⚠️ `우리이름에`: **한 슬러그 안에 여러 해·여러 제품이 섞여 있을 때 꼭 준다.**
 *    월드 챔피언십 덱은 슬러그 하나에 2004~2023년이 다 들어 있어서, 그냥 돌리면
 *    2006년 카드가 2007년 줄에 붙는다(2026-08-31에 실제로 그럴 뻔했다).
 */
export function 대조(슬러그, psa줄들, { 출처없는것만 = false, 세트크기, 번호무시 = false, 우리이름에, 새것도 = false } = {}) {
  const 결과 = { 같음: [], 다름: [], 보류: [], 새로: [] }
  // ⚠️ 이 세트에서 **초판과 무판이 갈라져 있는 번호**를 미리 모은다(둘 다 우리 목록에 있는 번호).
  //    그런 번호에서는 무판 카드가 PSA의 초판 줄을 가져가면 안 된다.
  // ⚠️ 점보 갈래는 **한 세트에 점보와 보통이 같이 있을 때만** 건다.
  //    박스 토퍼처럼 세트 전체가 점보인 곳은 PSA 줄 이름에 「Jumbo」가 없다.
  const 점보섞임 = 슬러그 === 'en-jumbo-cards' && psa줄들.some((r) => /jumbo/i.test(r.이름))
  const 전부 = 우리카드(슬러그)
  const 초판쌍번호 = new Set()
  for (const c of 전부) if (/1st Edition/i.test(c.이름)) 초판쌍번호.add(번호정리(c.n))
  // ⚠️⚠️ **PSA 쪽 증거도 본다.** 한 번호에 초판 줄과 무판 줄이 **둘 다** 있으면 그 세트는
  //    PSA가 초판·무판을 갈라 세는 세트다. 그러면 우리 보정표에 아직 초판 카드가 없어도
  //    무판 카드가 초판 줄을 가져가면 안 된다.
  //    (2026-08-31 샤이니 컬렉션에서 이 구멍이 드러났다. 거꾸로 CP6·VS처럼 PSA 줄이
  //     통째로 초판인 세트는 여기 안 걸려, 예전처럼 그대로 짝지어진다.)
  {
    const 초판번호 = new Set(), 무판번호 = new Set()
    for (const r of psa줄들) (/1st edition/i.test(r.이름) ? 초판번호 : 무판번호).add(번호정리(r.번호))
    for (const n of 초판번호) if (무판번호.has(n)) 초판쌍번호.add(n)
  }
  // (번호는 참고용이고, 실제 판단은 「이 세트에 초판 카드가 하나라도 있나」로 한다.)
  for (const c of 우리카드(슬러그, { 출처없는것만, 새것도 })) {
    if (우리이름에 && !String(c.이름).includes(우리이름에)) continue
    if (세트크기) {
      const m = String(c.이름).match(/\d+[a-z]?\/(\d+)/)
      if (!m || m[1] !== String(세트크기)) continue
    }
    const r = 짝짓기({ n: c.n, 이름: 덱이름으로(c.이름) }, psa줄들, { 선호: 덱단서(c.이름) || 슬러그단서(슬러그), 초판쌍번호, 번호무시, 기본갈래: 점보섞임 ? ['Jumbo'] : undefined })
    if (r.판정 !== '확인') { 결과.보류.push({ ...c, 까닭: r.까닭 }); continue }
    const p = [r.줄.psa10, r.줄.psa9, r.줄.합계]
    const 칸 = { ...c, psa: p, 줄이름: r.줄.이름, 믿음: r.믿음 }
    // 보정표에 없던 카드는 견줄 옛 값이 없다 — 따로 담는다.
    if (!c.v) 결과.새로.push(칸)
    else if (p[0] === c.v[0] && p[1] === c.v[1] && p[2] === c.v[2]) 결과.같음.push(칸)
    else 결과.다름.push(칸)
  }
  return 결과
}

if (process.argv[1] && process.argv[1].endsWith('psa대조.mjs')) {
  const [명령, 슬러그, ...나머지] = process.argv.slice(2)
  if (명령 === '낼것') {
    const 것 = 우리카드(슬러그, { 출처없는것만: 나머지.includes('--미확인만') })
    const 번호 = [...new Set(것.map((x) => String(x.n).split('~')[0].replace(/[^0-9]/g, '').replace(/^0+/, '')))]
    console.log('카드 ' + 것.length + '장 · 번호 ' + 번호.length + '가지')
    console.log(JSON.stringify(번호))
    for (const c of 것) console.log('  ' + c.tcg.padEnd(9) + String(c.n).padEnd(26) + c.이름 + '  [' + 풀기(c.이름).후보.join('/') + ']')
  } else if (명령 === '대조') {
    const [줄파일, psaId, ...옵션] = 나머지
    const 크기 = (옵션.find((x) => x.startsWith('--크기=')) || '').split('=')[1]
    // ⚠️ 같은 PSA 세트에 줄파일을 새로 만들면 예전 것과 갈려 서로 어긋난다. 먼저 알려 준다.
    try {
      const 짝 = 읽기('data/psa짝목록.json')
      const 이미 = [...new Set(짝.filter((x) => String(x[2]) === String(psaId)).map((x) => x[1]))]
      const 이번 = path.basename(줄파일).replace(/\.txt$/, '')
      if (이미.length && !이미.includes(이번))
        console.log(`  ⚠ PSA 세트 ${psaId}에는 이미 줄파일 「${이미.join(', ')}」이 있습니다 — 새로 만들지 말고 거기에 합치세요`)
    } catch {}
    let 줄 = 줄읽기(readFileSync(줄파일, 'utf8'))
    // ⚠️ `--줄에=<말>`: PSA가 **여러 세트를 한 페이지에 묶어 놓았을 때만** 쓴다.
    //    (보기: 2010 Japanese Black & White 한 페이지에 Black Collection과 White Collection이 같이 있다.)
    //    한 세트 안에서 「리그 줄만」처럼 걸러 쓰는 것은 금지다 — 진짜 짝이 사라져 엉뚱한 줄에 붙는다.
    const 줄에 = (옵션.find((x) => x.startsWith('--줄에=')) || '').split('=')[1]
    if (줄에) { 줄 = 줄.filter((r) => r.이름.toLowerCase().includes(줄에.toLowerCase())); console.log(`  (줄 고름: "${줄에}" 들어간 ${줄.length}줄만 본다)`) }
    const R = 대조(슬러그, 줄, { 세트크기: 크기, 번호무시: 옵션.includes('--번호무시'), 우리이름에: (옵션.find((x) => x.startsWith('--우리이름에=')) || '').split('=')[1] })
    console.log(`PSA 줄 ${줄.length}개 · 같음 ${R.같음.length} · 다름 ${R.다름.length} · 보류 ${R.보류.length}`)
    for (const x of R.다름) console.log('  △ ' + x.tcg + ' ' + x.이름 + ' 우리 ' + x.v.join('/') + ' → PSA ' + x.psa.join('/') + '  [' + x.줄이름 + ']')
    for (const x of R.보류) console.log('  ❓ ' + x.tcg + ' ' + x.이름 + ' — ' + x.까닭)
    if (옵션.includes('--적기')) {
      const { 적기 } = await import('./psa팝-기록.mjs')
      const 넣을것 = {}
      for (const x of [...R.같음, ...R.다름])
        넣을것[x.tcg] = { v: x.psa, 출처: `${psaId}/${String(x.n).split('~')[0]} ${x.줄이름}`, ...(x.믿음 ? { 믿음: x.믿음 } : {}) }
      // ⚠️⚠️ **번호가 없는 카드(#로 시작)는 이름만으로 맞춘 것**이라, 다른 세트 줄파일에도
      //    같은 이름이 있으면 엉뚱한 값을 쓸 수 있다(체육관 덱의 디펜더·만병통치제가 그랬다).
      //    이런 카드가 섞였으면 `node scripts/psa훑기.mjs <슬러그>`로 **한 곳에서만 걸리는지** 꼭 확인한다.
      const 번호없는것 = [...R.같음, ...R.다름].filter((x) => /^#/.test(String(x.n))).length
      if (번호없는것) console.log(`  ⚠ 번호 없는 카드 ${번호없는것}장이 섞였습니다 — psa훑기.mjs로 한 곳에서만 걸리는지 확인하세요`)
      const w = 적기(넣을것)
      console.log(`  적음 ${Object.keys(넣을것).length}칸 · 값바꿈 ${w.바꿈} · 보정표 ${w.전체}칸`)
    } else console.log('  (보기만 함 — 적으려면 --적기)')
  } else {
    console.log('쓰는 법: node scripts/psa대조.mjs 낼것 <세트슬러그> [--미확인만]')
    console.log('         --크기=<N> 을 주면 이름이 「.../N」인 카드만 견준다(딴 세트 섞임 방지)')
    console.log('         node scripts/psa대조.mjs 대조 <세트슬러그> <줄파일> <PSA세트id> [--적기]')
    console.log('         --번호무시 는 우리 번호와 PSA 번호 체계가 아예 다른 세트에서만 쓴다(이름으로만 맞춘다)')
    console.log('         --우리이름에=<말> 은 한 슬러그에 여러 해가 섞였을 때 그 해 카드만 고른다(월드덱)')
  }
}
