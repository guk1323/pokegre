/**
 * PSA 공식 팝수 보정표(`src/data/psaPopFix.json`)에 **출처를 남기며** 값을 적는 도구.
 *
 * 왜 있나: 예전에는 숫자만 저장해서, 나중에 "이 값 어디서 봤어?"를 못 답했다.
 * 이제는 값마다 **어느 PSA 세트 어느 줄에서 가져왔는지**를 같이 남긴다.
 *
 * 한 칸의 모양:
 *   "164283": {
 *     "psa10": 196, "psa9": 241, "psaAll": 479,
 *     "출처": "98581/24 Steelix-Holo Crosshatch-2011 Pokemon League",
 *     "본날": "2026-08-30",
 *     "믿음": "판단",                       // 없으면 = 그대로 옮겨 적음(확실)
 *     "까닭": "PSA에 리그 줄이 하나뿐이라 이걸로 봤다"
 *   }
 *
 * ⚠️ `server/api.ts`는 psa10·psa9·psaAll 만 읽는다. 나머지 칸은 사람이 보라고 있는 것이라
 *    덧붙여도 화면에는 아무 영향이 없다.
 * ⚠️ **카드가 아닌 키(설명·머리말 같은 것)를 이 파일에 넣지 말 것.** api.ts가 모든 키를
 *    카드로 훑기 때문에 psaAll이 없는 키가 있으면 값이 NaN이 된다.
 *
 * 쓰는 법:
 *   node scripts/psa팝-기록.mjs '<JSON>'
 *   JSON 모양: { "카드id": { "v":[10등급,9등급,합계], "출처":"...", "믿음":"판단", "까닭":"..." } }
 */
import fs from 'node:fs'

const 표길 = 'src/data/psaPopFix.json'
const 오늘 = process.env.오늘 || new Date().toISOString().slice(0, 10)

export function 적기(넣을것, { 표길: 길 = 표길, 오늘: 날 = 오늘 } = {}) {
  const 표 = JSON.parse(fs.readFileSync(길, 'utf8'))
  const 결과 = { 새로: 0, 바꿈: 0, 그대로: 0, 목록: [] }

  for (const [id, 것] of Object.entries(넣을것)) {
    const [psa10, psa9, psaAll] = 것.v
    if (!Number.isFinite(psaAll) || psaAll < 0) throw new Error(`${id}: 합계가 이상합니다 (${psaAll})`)
    if (psa10 + psa9 > psaAll) throw new Error(`${id}: 10등급+9등급이 합계보다 큽니다`)
    if (!것.출처) throw new Error(`${id}: 출처가 없습니다. PSA 세트id와 줄 이름을 적어 주세요.`)

    const 전 = 표[id]
    const 칸 = { psa10, psa9, psaAll, 출처: 것.출처, 본날: 날 }
    if (것.믿음) 칸.믿음 = 것.믿음
    if (것.까닭) 칸.까닭 = 것.까닭

    if (!전) 결과.새로++
    else if (전.psaAll !== psaAll) { 결과.바꿈++; 결과.목록.push(`${id}: ${전.psaAll} → ${psaAll}`) }
    else 결과.그대로++

    표[id] = 칸
  }

  // ⚠️ **덮어쓰기 전에 한 벌 떠 둔다.** 2026-08-31에 짝을 잘못 지어 대조를 돌리다
  //    값 여럿이 엉뚱한 세트 것으로 덮였는데, 되돌릴 사본이 없어 애를 먹었다.
  //    사본은 마지막 다섯 벌만 남긴다(디스크를 아낀다).
  try {
    const 방 = 'data/psaPopFix-사본'
    fs.mkdirSync(방, { recursive: true })
    const 이름 = `psaPopFix-${날}-${String(Date.now()).slice(-6)}.json`
    fs.copyFileSync(길, `${방}/${이름}`)
    const 목록 = fs.readdirSync(방).filter((x) => x.endsWith('.json')).sort()
    for (const x of 목록.slice(0, Math.max(0, 목록.length - 5))) fs.unlinkSync(`${방}/${x}`)
  } catch (e) {
    console.log('  (사본을 못 떴습니다: ' + String(e).slice(0, 60) + ')')
  }
  fs.writeFileSync(길, JSON.stringify(표, null, 1))
  결과.전체 = Object.keys(표).length
  return 결과
}

/** 지금 보정표가 얼마나 「출처가 남아 있는지」 세어 본다. */
export function 세기({ 표길: 길 = 표길 } = {}) {
  const 표 = JSON.parse(fs.readFileSync(길, 'utf8'))
  const n = { 전체: 0, 출처있음: 0, 확실: 0, 판단: 0, 미기록: 0 }
  for (const 것 of Object.values(표)) {
    n.전체++
    if (!것.출처) { n.미기록++; continue }
    n.출처있음++
    if (것.믿음 === '판단') n.판단++
    else n.확실++
  }
  return n
}

if (process.argv[1] && process.argv[1].endsWith('psa팝-기록.mjs')) {
  const 인자 = process.argv[2]
  if (!인자) { console.log(JSON.stringify(세기(), null, 1)); process.exit(0) }
  const 결과 = 적기(JSON.parse(인자))
  console.log(`새로 ${결과.새로} · 값바꿈 ${결과.바꿈} · 그대로 ${결과.그대로} · 보정표 ${결과.전체}장`)
  for (const x of 결과.목록.slice(0, 40)) console.log('  ' + x)
}
