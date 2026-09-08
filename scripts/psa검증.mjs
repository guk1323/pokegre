/**
 * PSA 팝 리포트에서 읽은 줄을 **우리 카드와 이름·갈래까지 맞춰** 짝짓는다.
 *
 * 왜 있나: 예전에는 「번호가 같은 줄 중 우리 숫자와 제일 가까운 것」을 골랐다.
 * 그건 맞는지 보는 게 아니라 **비슷한지** 보는 것이라, 우리 값이 틀렸는데 하필
 * 다른 줄과 비슷하면 그냥 통과했다(사장님 지적 2026-08-31).
 *
 * ⚠️⚠️ **끼워 맞추지 않는다.** 줄이 하나로 안 좁혀지거나 이름이 안 맞으면 `보류`다.
 *    보류는 실패가 아니라 「아직 모른다」는 정직한 답이다.
 *
 * 갈래(같은 번호에 여러 줄이 있는 까닭):
 *   마스터볼 무늬 · 몬스터볼 무늬 · 리버스홀로 · Staff판 · 1st Edition · 언어판 · 점보
 * ⚠️ 일본판 151류 세트에서 우리 「몬스터볼 무늬」를 PSA는 그냥 "Reverse Holo"로 적는다.
 *    몬스터볼 줄이 따로 없을 때만 Reverse 줄로 보고, 그 건은 `믿음:'판단'`으로 남긴다.
 *
 * 쓰는 법:
 *   import { 풀기, 짝짓기 } from './psa검증.mjs'
 *   const 나 = 풀기('팬텀 (마스터볼 무늬)')        // → { 이름, 종류, 갈래, 후보 }
 *   const r  = 짝짓기({ n:'94', 이름:'팬텀 (마스터볼 무늬)' }, psa줄들)
 *   // psa줄들 = [{ 번호, 이름, psa10, psa9, 합계 }, ...]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const 포켓 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/pokemonNames.json'), 'utf8'))
const 카드명 = JSON.parse(readFileSync(path.join(ROOT, 'src/data/cardNameKoEn.json'), 'utf8'))

// 한 한글 이름에 영문이 여럿일 수 있다(포켓몬 이름 ↔ 카드명 사전). 둘 다 후보로 둔다.
const ko2en = new Map()
const 더하기 = (ko, en) => { if (!ko || !en) return; const a = ko2en.get(ko) ?? []; if (!a.includes(en)) a.push(en); ko2en.set(ko, a) }
for (const v of Object.values(포켓)) if (v && v.ko && v.en) 더하기(v.ko, v.en)
for (const [ko, en] of Object.entries(카드명)) if (typeof en === 'string') 더하기(ko, en)
// PSA가 우리와 **다른 영문 이름**으로 적어 둔 카드(예: 리리에의 삐삐인형 = 북미명
// Lillie's Poke Doll, PSA는 일본 이름 그대로 Lillie's Clefairy Doll). 후보를 늘려만 준다.
const 딴이름 = JSON.parse(readFileSync(path.join(ROOT, 'data/psa\uB534\uC774\uB984.json'), 'utf8')).표
const 찾기 = (ko) => {
  const a = (ko2en.get(ko) ?? []).slice()
  for (const en of a.slice()) for (const 딴 of 딴이름[en] ?? []) if (!a.includes(딴)) a.push(딴)
  return a
}

/** 이름·번호 비교용으로 씻는다. 기호(♀·-·')와 대소문자를 없앤다. */
export const 씻기 = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * 번호를 견줄 수 있게 다듬는다.
 * ⚠️ **뒤에 붙은 글자를 살린다.** `SM103a`는 `SM103`과 **다른 카드**다.
 *    예전엔 글자를 지워 103a가 103 줄에 붙었다(2026-08-31에 실제로 값이 잘못 덮였다).
 */
export const 번호정리 = (n) => {
  const s = String(n).split('~')[0].trim()
  const m = s.match(/(\d+)\s*([a-z])?\b/i)
  if (!m) return '0'
  return String(Number(m[1])) + (m[2] ? m[2].toLowerCase() : '')
}

/** 번호 앞에 붙은 글자(SM·XY·SWSH·DP…). 없으면 빈 문자열. */
export const 번호앞글자 = (n) => {
  const m = String(n).split('~')[0].trim().match(/^([A-Za-z]+)\s*\d/)
  return m ? m[1].toUpperCase() : ''
}

/**
 * 두 번호가 같은가.
 * ⚠️ **앞글자가 양쪽에 다 있으면 그것까지 같아야 한다.** 프로모는 앞글자가 곧 갈래다 —
 *    SM197과 XY197은 완전히 다른 카드인데, 예전엔 숫자만 봐서 개굴닌자 V-UNION이
 *    SM197 줄 값을 먹을 뻔했다(2026-08-31).
 *    한쪽에만 앞글자가 있으면(우리는 SM103, PSA는 103) 숫자만 견준다.
 */
export const 번호같나 = (줄번호, 우리번호) => {
  if (번호정리(줄번호) !== 번호정리(우리번호)) return false
  const 줄앞 = 번호앞글자(줄번호), 내앞 = 번호앞글자(우리번호)
  if (줄앞 && 내앞) return 줄앞 === 내앞
  // ⚠️ **PSA 줄에만 앞글자가 있으면 다른 카드다.** 우리 「108」이 PSA 「SM108」에 붙어
  //    일본판 BW 프로모 피카츄가 지우의 피카츄(프랑스판) 값을 먹을 뻔했다(2026-08-31).
  if (줄앞 && !내앞) return false
  // 우리에게만 앞글자가 있는 경우는 괜찮다 — PSA가 앞글자를 떼고 적는 세트가 있다.
  return true
}

/** 우리 카드 이름 → { 이름, 종류, 갈래[], 영문후보[] } */
export function 풀기(이름) {
  let s = String(이름 || '').trim()
  // ⚠️ 괄호 안 영문 낱말은 따로 챙겨 둔다. 같은 번호에 줄이 여럿일 때
  //    「Autumn / Spring」처럼 이것으로만 갈리는 카드가 있다(비토리컵 BW29~31).
  const 곁말 = [...new Set((s.match(/[A-Za-z]{4,}/g) || []).map((x) => x.toLowerCase()))]
  // ⚠️ 레벨(LV.11 · LV.13)로만 갈리는 카드가 있다(체육관 덱의 포니타·가디 등).
  const lv = s.match(/LV\.?\s*(\d+)/i)
  if (lv) 곁말.push('lv' + lv[1])
  const 갈래 = []
  const 떼기 = (re, 표) => { if (re.test(s)) { 갈래.push(표); s = s.replace(re, ' ').trim() } }
  떼기(/\s*·\s*1st Edition\s*$/i, '1st Edition')
  떼기(/\s*·\s*기타 언어\s*$/, '언어')
  // 무늬·홀로 갈래 — 우리 표기 → 맞춤 이름. PSA 줄 이름에서도 같은 이름으로 읽는다(줄갈래).
  for (const [re, 표] of [
    [/\s*\(?마스터볼 무늬\)?\s*/, 'Master Ball'],
    [/\s*\(?몬스터볼 무늬\)?\s*/, 'Poke Ball'],
    [/\s*\(?에너지마크 무늬\)?\s*/, 'Energy'],
    [/\s*\(?프렌드볼 무늬\)?\s*/, 'Friend Ball'],
    [/\s*\(?다크볼 무늬\)?\s*/, 'Dark Ball'],
    [/\s*\(?러브볼 무늬\)?\s*/, 'Love Ball'],
    [/\s*\(?퀵볼 무늬\)?\s*/, 'Quick Ball'],
    [/\s*\(?로켓단 무늬\)?\s*/, 'Team Rocket Pattern'],
    // ⚠️ 「무늬」를 빼고 **괄호로만** 적은 카드가 있다(「턱지충이 (퀵볼)」 — 어센디드 히어로즈).
    //    안 읽으면 못 알아들은 표시로 남는데, 그 번호에 PSA 줄이 하나뿐이면 맨 카드와 이 카드가
    //    **같은 줄을 나눠 갖는다**(2026-08-31에 12자리가 그랬다).
    //    ⚠️ 괄호가 있을 때만 잡는다 — 괄호 없이 풀면 「몬스터볼」 같은 굿즈 카드 이름이 사라진다.
    [/\s*\(마스터볼\)\s*/, 'Master Ball'],
    [/\s*\(몬스터볼\)\s*/, 'Poke Ball'],
    [/\s*\(에너지마크\)\s*/, 'Energy'],
    [/\s*\(프렌드볼\)\s*/, 'Friend Ball'],
    [/\s*\(다크볼\)\s*/, 'Dark Ball'],
    [/\s*\(러브볼\)\s*/, 'Love Ball'],
    [/\s*\(퀵볼\)\s*/, 'Quick Ball'],
    [/\s*\((?:로켓단|Team Rocket)\)\s*/i, 'Team Rocket Pattern'],
    [/\s*\(Terastal 무늬\)\s*/i, 'Terastal'],
    [/\s*\(?크랙아이스 홀로\)?\s*/, 'Crosshatch'],
    [/\s*\(Water Web Holo\)\s*/i, 'Water Web'],
    // 리그·대회 프로모. PSA는 같은 카드의 리그판을 "… Pokemon League" 줄로 따로 센다.
    // ⚠️ 리그판은 원래 리버스 포일이라 PSA 줄에 "Reverse Foil"이 같이 붙는다 —
    //    그래서 줄갈래에서 리그를 리버스보다 **먼저** 잡는다.
    [/\s*\(?리그 챌린지\)?\s*/, 'League Challenge'],
    [/\s*\(?리그 컵\)?\s*/, 'League Cup'],
    [/\s*\(?포켓몬 리그\)?\s*/, 'League'],
    // ⚠️ 우리 자료에 영어 그대로 「(League)」라고만 적힌 카드가 섞여 있다(개굴닌자 40/122).
    [/\s*\(League\)\s*/i, 'League'],
    [/\s*\(League Cup\)\s*/i, 'League Cup'],
    [/\s*\(League Challenge\)\s*/i, 'League Challenge'],
    // ⚠️ 「리그 프로모」는 우리 쪽에서 대회 상품을 통틀어 부르는 말이다.
    //    PSA는 리그·지역·주·시·전국·플레이어리워드로 잘게 나눠 적으므로 **아무 대회나**로 본다.
    [/\s*\(?리그 프로모\)?\s*/, 'AnyEvent'],
    // 「Championship Series/Promo」도 대회를 통틀어 부르는 말이다(PSA는 시·주·전국으로 나눠 적는다).
    [/\s*\(Championship (?:Series|Promo)\)\s*/i, 'AnyEvent'],
    [/\s*\(Regional Championship Promo\)\s*/i, 'Regional'],
    [/\s*\(플레이! 포켓몬 Promo\)\s*/, 'Play Pokemon'],
    [/\s*\(?지역 챔피언십\)?\s*/, 'Regional'],
    [/\s*\(Latin America Championships?\)\s*/i, 'LatinAmerica'],
    [/\s*\(Oceania Championships?\)\s*/i, 'Oceania'],
    [/\s*\(North America Championships?\)\s*/i, 'NorthAmerica'],
    [/\s*\(International Championships?\)\s*/i, 'International'],
    [/\s*\(State Championships\)\s*/i, 'State'],
    [/\s*\(City Championships\)\s*/i, 'City'],
    [/\s*\(National Championships\)\s*/i, 'National'],
    [/\s*\(Europe Championships?\)\s*/i, 'Europe'],
    // ⚠️ 우리 자료는 「(Player Reward)」처럼 **홑수로** 적혀 있는데 PSA는 「Player Rewards」다.
    //    안 읽으면 못 알아들은 표시로 남아 그 카드가 통째로 보류된다(2026-08-31).
    [/\s*\(Player Rewards?\)\s*/i, 'PlayerRewards'],
    [/\s*\((?:\d{4}\s*)?플레이! 포켓몬\)\s*/, 'Play Pokemon'],
    [/\s*\(?미러 홀로\)?\s*/, 'Reverse'],
    [/\s*\(?코스모스 홀로\)?\s*/, 'Cosmos'],
    // ⚠️ 우리 자료에 **영어 그대로** 적힌 것도 있다(「부스터 E4 - 60/111 (Cracked Ice)」·
    //    「망나뇽 (Cosmo Holo)」). 안 읽으면 못 알아들은 표시로 남아 통째로 보류된다(2026-08-31).
    [/\s*\(Cracked Ice( Holo)?\)\s*/i, 'Crosshatch'],
    [/\s*\(Cosmos? Holo\)\s*/i, 'Cosmos'],
  ]) 떼기(re, 표)
  떼기(/\s*[\[(]\s*Staff\s*[\])]\s*/i, 'Staff')
  // 우리 쪽 「(2015 Top Thirty-Two)」 같은 표시도 같은 갈래로 읽는다(어느 Top인지는 곁말이 가른다).
  if (/\btop\s*(?:\d+|four|eight|sixteen|thirty[- ]two)\b/i.test(s)) 갈래.push('Top')
  for (const [re, 표] of [[/\s*\[1위\]\s*/, '1st'], [/\s*\[2위\]\s*/, '2nd'], [/\s*\[3위\]\s*/, '3rd'], [/\s*\[4위\]\s*/, '4th']]) 떼기(re, 표)
  // ⚠️ 순위·Staff를 떼고도 남는 대괄호는 **누구를 그렸는지 같은 곁딸린 설명**이다
  //    (「박사의 연구 [매그놀리아박사]」). 이름에서는 떼되 곁말로 챙겨 둔다.
  for (const m of s.match(/\[[^\]]*\]/g) || []) 곁말.push(m.slice(1, -1).trim().toLowerCase())
  s = s.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()
  // ⚠️ 앞머리가 긴 번호도 뗀다(HGSS10 · SWSH045 등). 예전엔 세 글자까지만 떼어
  //    「라티아스 - HGSS10」이 이름으로 안 풀렸다(2026-08-31).
  // ⚠️ 줄표 앞에 **띄어쓰기가 있을 때만** 번호로 본다. 「G-109」처럼 이름 속에 든 줄표를
  //    떼면 「갤럭시단의 발명 G-109 SP레이더」가 사전에서 안 찾아진다(2026-08-31).
  s = s.replace(/\s+-\s*[A-Z]{0,5}\d+[a-z]?(\/\d+)?(?=\s|$)/g, ' ').trim()
  // ⚠️ 줄표 없이 붙은 번호도 뗀다(「뚜꾸리 15/114」 · 「기가이어스 53/98 (Prerelease)」).
  //    끝이 아니라 가운데 있어도 뗀다 — 뒤에 괄호 표시가 더 붙는 카드가 있다.
  s = s.replace(/\s+\d+[a-z]?\/\d+(?=\s|$)/gi, ' ').trim()
  // ⚠️ 번호를 떼고 나면 줄표가 홀로 남는 이름이 있다(「힘의 머리띠 - 121/146 - (포켓몬 리그)」).
  //    남은 줄표를 안 지우면 사전에서 못 찾는다(2026-08-31).
  s = s.replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '').replace(/\s+-\s+(?=[(\[])/g, ' ').trim()
  // ⚠️ 괄호 안에서 갈래만 떼어 내면 여는 괄호가 짝 없이 남는다
  //    (「에브이 - 2/90 (HGSS Undaunted - 크랙아이스 홀로)」 → 「에브이 (HGSS Undaunted」).
  //    닫는 괄호가 없으면 그 조각째로 지운다 — 안 그러면 이름을 사전에서 못 찾는다.
  if (/\([^)]*$/.test(s)) s = s.replace(/\s*\([^)]*$/, '').trim()
  // ⚠️ 갈래로 못 알아들은 괄호 표시(Water Web Holo · General Mills Promo 등)는 따로 챙긴다.
  //    이런 표시가 남아 있으면 **그 카드는 특별한 판**이므로, 아무 줄에나 붙이면 안 된다.
  // ⚠️ 괄호 안이 **본 세트 이름**인 카드가 있다(「엘레이드 E4 - 20/111 (DPPt Rising Rivals)」).
  //    이건 특별한 판을 가리키는 표시가 아니라 «어느 세트에서 나온 카드인가»를 적어 둔 것이라,
  //    못 알아들은 표시로 두면 그 카드가 통째로 보류된다(2026-08-31 덱 전용 24장이 그랬다).
  //    ⚠️ 그냥 지워도 되는 까닭: 짝은 세트마다 따로 지어 두고, `psa훑기`가 **두 세트에서
  //       다르게 걸리는 카드는 거부**하기 때문에 엉뚱한 세트에 붙을 길이 막혀 있다.
  const 세트말 = /^(DPPt|DP|HGSS|SWSH|SM|BW|XY|EX|Base Set|Call of Legends|Team Rocket|Neo|Gym|Aquapolis|Skyridge|Expedition|Platinum|Diamond|Sun & Moon|Sword & Shield)\b/i
  const 남은표시 = (s.match(/\(([^)]*)\)/g) || []).map((x) => x.slice(1, -1).trim()).filter(Boolean).filter((x) => !세트말.test(x))
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim()

  let 종류 = ''
  // ⚠️ 우리 자료는 「프리즘스타」를 한글로 적는데 PSA는 그 말을 아예 안 적는다
  //    (SM12a 58 「기라티나 프리즘스타」 ↔ PSA 「Giratina-Holo」). 떼고 나서 찾는다(2026-08-31).
  const 프 = s.match(/\s*프리즘\s*스타\s*$/)
  if (프) { 종류 = 'Prism Star'; s = s.slice(0, 프.index).trim() }
  const m = 종류 ? null : s.match(/\s+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Prism Star)$/)
  if (m) { 종류 = m[1]; s = s.slice(0, m.index).trim() }

  // ⚠️ 「디아루가 G」·「루카리오 GL」·「밀로틱 C」·「무장조 FB」처럼 **소속 글자**가 붙는다.
  //    떼었다가 영문 뒤에 그대로 붙인다(사전에 낱낱이 넣지 않아도 되게).
  let 소속 = ''
  // ⚠️ 사천왕 카드는 우리가 「E4」, PSA가 「4」로 적는다(엘레이드 E4 = Gallade 4).
  const 소m = s.match(/\s+(G|GL|C|FB|E4|4)$/)
  if (소m) { 소속 = 소m[1] === 'E4' ? '4' : 소m[1]; s = s.slice(0, 소m.index).trim() }

  // 「메가리자몽 Y」처럼 모습 글자(X·Y)가 붙는다 — 떼었다가 영문 뒤에 다시 붙인다
  let 모습 = ''
  const fm = s.match(/\s+([XY])$/)
  if (fm) { 모습 = fm[1]; s = s.slice(0, fm.index).trim() }

  const 후보 = []
  const 넣 = (en) => {
    if (!en) return
    const 밑 = 모습 ? en + ' ' + 모습 : en
    const b = 소속 ? 밑 + ' ' + 소속 : 밑
    if (종류) 후보.push(b + ' ' + 종류)
    후보.push(b)
    // ⚠️ PSA가 **소속 글자를 빼고** 적는 줄이 있다(「Flareon-Reverse Foil Cracked Ice」 =
    //    우리 「부스터 E4」). 번호·갈래는 그대로 걸리니 이름 후보만 하나 더 둔다(2026-08-31).
    if (소속) { if (종류) 후보.push(밑 + ' ' + 종류); 후보.push(밑) }
  }
  for (const en of 찾기(s)) 넣(en)
  // ⚠️ PSA는 「메가」를 「Mega」로도 「M」으로도 적는다(M Diancie EX). 둘 다 후보로 넣는다.
  for (const [앞, 영앞] of [['메가', 'Mega '], ['메가', 'M '], ['오리진', 'Origin Forme ']]) {
    if (!s.startsWith(앞)) continue
    for (const 밑 of 찾기(s.slice(앞.length).trim())) 넣(영앞 + 밑)
  }
  // ⚠️⚠️ 「누구의 무엇」은 **주인 이름까지 붙여** 찾는다.
  //    체육관 덱은 관장만 다른 같은 포켓몬이 여럿이라(강연의 식스테일 ↔ 웅의 식스테일),
  //    포켓몬 이름만으로 찾으면 남의 줄에 붙는다(2026-08-31에 실제로 붙었다).
  const 임자 = s.match(/^(.+?)의\s+(.+)$/)
  const 임자후보 = []
  if (임자) {
    for (const a of 찾기(임자[1])) for (const b of 찾기(임자[2])) { 넣(a + "'s " + b); 임자후보.push(a + "'s " + b) }
  }
  const 조각 = s.split(/\s+/)
  if (조각.length > 1) for (const en of 찾기(조각[조각.length - 1])) 넣(en)
  const 의뒤 = s.replace(/^.*?의\s+/, '')
  if (의뒤 !== s) for (const en of 찾기(의뒤)) 넣(en)
  // ⚠️ 우리 이름 끝에 붙은 **대문자 약칭**(Blend Energy GRPD·WLFM)을 PSA는 안 적는다.
  //    약칭을 뗀 이름도 후보에 넣어 둔다 — 어차피 번호가 갈라 주므로 위험하지 않다.
  for (const en of [...후보]) {
    const m = en.match(/^(.*\S)\s+[A-Z]{3,5}$/)
    if (m) 후보.push(m[1])
  }
  return { 이름: s, 종류, 갈래, 곁말, 남은표시, 임자후보: [...new Set(임자후보)], 후보: [...new Set(후보.filter(Boolean))] }
}

/** PSA 줄 이름에서 갈래를 읽는다. 무늬는 하나만 잡는다(마스터볼 > 몬스터볼 > 리버스). */
export function 줄갈래(이름) {
  const s = String(이름)
  const g = []
  // ⚠️ 무늬는 **하나만** 잡는다. PSA 줄 이름이 "… Master Ball Reverse Holo"처럼
  //    무늬와 Reverse를 같이 적기 때문에, 먼저 잡히는 쪽이 그 줄의 갈래다.
  if (/\beurope\b/i.test(s) && /championship|champs/i.test(s)) g.push('Europe')
  else if (/l\.?\s*america|latin america/i.test(s) && /championship/i.test(s)) g.push('LatinAmerica')
  else if (/oceania/i.test(s) && /championship/i.test(s)) g.push('Oceania')
  // ⚠️ 「2013 North American State/Province/Territory Championships」는 **주 대회**다.
  //    北미 국제대회(International Championships North America)와 헷갈리면 안 되므로
  //    State·Province가 같이 적힌 줄은 먼저 주 대회로 본다.
  // ⚠️ PSA는 「2011 State/Province/Territory」처럼 **Championships를 빼고** 적기도 한다.
  else if (/state\s*\/\s*province|province\s*\/\s*territory/i.test(s)) g.push('State')
  else if (/state[,/ ]|province|territory/i.test(s) && /championship/i.test(s)) g.push('State')
  else if (/n\.?\s*america|north america/i.test(s) && /championship/i.test(s)) g.push('NorthAmerica')
  else if (/int'?l|international/i.test(s) && /championship/i.test(s)) g.push('International')
  // ⚠️ PSA는 「Regional Champions」처럼 뒷말을 줄여 적기도 한다.
  else if (/regional champion(s|ship|ships)?\b/i.test(s)) g.push('Regional')
  // ⚠️ PSA는 「State/Province/Territory」를 여러 꼴로 적는다 — State, Province, Territory 어느 낱말이든 잡는다.
  else if (/state[,/ ]|province|territory/i.test(s) && /championship/i.test(s)) g.push('State')
  else if (/city championships?/i.test(s)) g.push('City')
  else if (/national championships?/i.test(s)) g.push('National')
  // ⚠️ 「Player Rewards」·「Professor Program」도 대회처럼 **따로 나눠 준 판**이다.
  //    이걸 갈래로 안 잡으면 무늬(Crosshatch)만 잡혀 「아무 대회나」 규칙이 안 통한다.
  else if (/player ?rewards?|professor program/i.test(s)) g.push('PlayerRewards')
  else if (/play ?! ?pokemon|play pokemon/i.test(s)) g.push('Play Pokemon')
  else if (/(pokemon )?league challenge/i.test(s)) g.push('League Challenge')
  // ⚠️ 「Pokemon」을 빼고 「League Cup」만 적는 줄도 있다.
  else if (/(pokemon )?league cup/i.test(s)) g.push('League Cup')
  // ⚠️ 「2019 Yellow A Alternate」는 **리그에서 나눠 준 다른그림 판**이다(2026-08-31).
  //    PSA가 어떤 줄엔 「… Yellow A Alternate Art 1st Place Pokemon League」라 적고
  //    어떤 줄엔 리그를 빼고 적어서, 안 맞춰 두면 같은 상품인데 짝이 안 지어진다.
  else if (/yellow a alternate/i.test(s)) g.push('League')
  else if (/pokemon league/i.test(s)) g.push('League')
  else if (/master ?ball/i.test(s)) g.push('Master Ball')
  // ⚠️ 「Poke Ball Collection」·「Poke Ball Tin」은 **상품 이름**이지 몬스터볼 무늬가 아니다
  //    (SM157 피카츄가 그렇다). 뒤에 상품말이 붙으면 무늬로 안 본다(2026-08-31).
  else if (/\bpoke ?ball\b(?!\s*(collection|tin|box|set|blister))/i.test(s)) g.push('Poke Ball')
  else if (/friend ?ball/i.test(s)) g.push('Friend Ball')
  else if (/dark ?ball/i.test(s)) g.push('Dark Ball')
  else if (/love ?ball/i.test(s)) g.push('Love Ball')
  else if (/quick ?ball/i.test(s)) g.push('Quick Ball')
  else if (/team rocket.*reverse|rocket ?pattern/i.test(s)) g.push('Team Rocket Pattern')
  else if (/terastal/i.test(s)) g.push('Terastal')
  else if (/energy reverse/i.test(s)) g.push('Energy')
  else if (/water web/i.test(s)) g.push('Water Web')
  else if (/crosshatch|cracked ice/i.test(s)) g.push('Crosshatch')
  // ⚠️ 코스모스도 **무늬**다. PSA는 「Reverse Foil … Cosmos …」처럼 리버스와 같이 적는데,
  //    둘 다 잡으면 우리 「코스모스 홀로」 카드와 갈래가 안 맞아 짝이 안 지어진다(2026-08-31).
  //    마스터볼·크랙아이스와 똑같이 **먼저 잡히는 무늬 하나만** 쓴다.
  else if (/cosmos/i.test(s)) g.push('Cosmos')
  else if (/reverse/i.test(s)) g.push('Reverse')
  if (/\bstaff\b/i.test(s)) g.push('Staff')
  if (/1st edition/i.test(s)) g.push('1st Edition')
  // ⚠️ PSA는 언어를 「-French」로도, 「 Box French」처럼 띄어쓰기로도 적는다. 끝에 붙은 것도 잡는다.
  //    (「Germa」처럼 오타로 잘린 것도 있다.)
  if (/-(French|German|Italian|Spanish|Portuguese|Korean|Chinese|Japanese|Germa)\b/i.test(s) ||
      /[-\s](French|German|Italian|Spanish|Portuguese|Korean|Chinese|Japanese|Germa|Ita)\s*$/i.test(s)) g.push('언어')
  if (/jumbo/i.test(s)) g.push('Jumbo')
  // ⚠️ 「Missing Texture」는 **무늬가 빠져 나온 잘못 찍힌 카드**다(포비든 라이트에 여럿 있다).
  //    갈래로 안 잡으면 멀쩡한 카드가 이 줄을 먹을 수 있다.
  if (/missing texture/i.test(s)) g.push('Missing Texture')
  // ⚠️ 「Corrected」는 **잘못 찍힌 것을 고쳐 다시 낸 판**이다(융합 아츠 샹델라 VMAX가 그렇다).
  if (/\bcorrected\b/i.test(s)) g.push('Corrected')
  // ⚠️ 「Top 8 · Top Sixteen · Top Thirty-Two」는 **입상자에게 따로 준 판**이다.
  //    갈래로 안 잡으면 그냥 나눠 준 판과 구별이 안 돼 둘 중 아무거나 골라 버린다.
  if (/\btop\s*(?:\d+|four|eight|sixteen|thirty[- ]two|32|16|8)\b/i.test(s)) g.push('Top')
  // ⚠️ 「…-Champion」은 **우승자에게 준 판**이다(2026-08-31). 「Championship(s)」와는 다른 말이라
  //    뒤에 글자가 더 붙지 않은 홑말일 때만 잡는다 — 안 가르면 그냥 대회판과 줄이 안 좁혀진다.
  if (/\bchampion(?![a-z])/i.test(s)) g.push('Champion')
  for (const [re, 표] of [[/1st place/i, '1st'], [/2nd place/i, '2nd'], [/3rd place/i, '3rd'], [/4th place/i, '4th']])
    if (re.test(s)) g.push(표)
  return g
}

/**
 * 우리 카드 하나를 PSA 줄들과 짝짓는다.
 * @returns {{판정:'확인'|'보류', 줄?, 믿음?:'판단', 까닭?:string}}
 */
/**
 * ⚠️ `번호무시`: 우리 번호와 PSA 번호가 **아예 다른 체계**인 세트에서만 쓴다.
 *    (보기: 포켓몬 카드 게임 제1탄 — 우리는 001~108 차례번호, PSA는 도감번호를 쓴다.)
 *    이때는 번호를 아예 안 보고 **영어 이름이 딱 하나 걸릴 때만** 받아들인다.
 *    이름이 여럿 걸리면(무판·홀로 갈림 등) 보류다.
 */
export function 짝짓기(우리카드, psa줄들, { 선호, 초판쌍번호, 번호무시, 기본갈래 } = {}) {
  const 내번호 = 번호정리(우리카드.n)
  const 나 = 풀기(우리카드.이름)
  // ⚠️ 세트 자체가 한 갈래인 곳이 있다(점보 세트의 카드는 이름에 「점보」라고 안 적혀 있다).
  //    그런 세트는 밖에서 갈래를 넣어 준다 — 안 그러면 맞는 줄이 갈래 다르다고 걸러진다.
  let 내갈래 = [...나.갈래, ...(기본갈래 || []).filter((g) => !나.갈래.includes(g))]

  // ⚠️⚠️ **우리 쪽에 같은 번호로 「1st Edition」 카드가 따로 있으면, 초판 아닌 카드는
  //    초판 줄을 절대 가져오지 않는다.** 그 세트는 통째로 초판인 게 아니라 초판·무판이
  //    갈라져 있다는 뜻이기 때문이다. 2026-08-31에 e카드 제1탄에서 PSA에 초판 줄만 있는
  //    번호(식스테일·잉어킹 등 7장)의 무판 카드가 초판 값을 먹을 뻔했다.
  // ⚠️ 같은 번호뿐 아니라 **그 세트 어디에라도** 초판 카드가 따로 있으면 그 세트는 초판·무판을
  //    가르는 세트다. 그러면 무판 카드는 어느 번호에서든 초판 줄을 가져오지 않는다.
  //    (VS·CP6처럼 세트가 통째로 초판인 곳은 우리 목록에 `~1st`가 아예 없어 이 규칙이 안 걸린다.)
  const 초판갈림 = 초판쌍번호 instanceof Set && 초판쌍번호.size > 0 && !내갈래.includes('1st Edition')

  // ⚠️ 도감에 진짜 번호가 없는 카드는 `#<상품번호>`로 적혀 있다(체육관 덱 굿즈 등).
  //    그런 카드는 번호로 맞추면 안 된다 — 이름과 갈래로만 찾는다.
  const 번호없음 = 번호무시 || /^#/.test(String(우리카드.n).trim())
  let 후보 = 번호없음 ? [] : psa줄들.filter((r) => 번호같나(r.번호, 우리카드.n))
  if (초판갈림) {
    const 무판 = 후보.filter((r) => !/1st edition/i.test(r.이름))
    if (!무판.length) return { 판정: '보류', 까닭: 'PSA에 초판 줄만 있는데 우리 카드는 무판이다' }
    후보 = 무판
  }
  if (번호없음 && 나.후보.length) {
    // ⚠️ 여기서도 「누구의 무엇」은 주인 붙은 이름을 먼저 쓴다(강연의 식스테일 ↔ 웅의 식스테일).
    const 임자먼저 = 나.후보.filter((x) => x.includes("'s "))
    let 쓸이름 = 임자먼저.length ? 임자먼저 : 나.후보
    // ⚠️⚠️ **종류(GX·EX·V-UNION…)가 있는 카드는 종류까지 붙은 이름으로만 찾는다.**
    //    예전엔 「개굴닌자 V-UNION」이 이름만 걸려 「Greninja GX」 줄에 붙을 뻔했다(2026-08-31).
    if (나.종류) {
      const ㅈ = 쓸이름.filter((x) => x.toLowerCase().endsWith(나.종류.toLowerCase()))
      if (!ㅈ.length) return { 판정: '보류', 까닭: `번호가 없고 종류(${나.종류})가 붙은 이름을 못 만들었다` }
      쓸이름 = ㅈ
    }
    // ⚠️ 이름은 **줄 이름 맨 앞에서 낱말 단위로** 걸려야 한다. 가운데에 우연히 들어간 것은 안 된다.
    // ⚠️ 뒤에 아포스트로피가 오면 **남의 것**이다(「Blaine」이 「Blaine's Quiz」에 걸리면 안 된다).
    const 앞에걸리나 = (이름, en) =>
      new RegExp('^' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]*') + "(?![A-Za-z0-9'\u2019])", 'i').test(String(이름).trim())
    let 걸림 = psa줄들.filter((r) => 쓸이름.some((en) => 앞에걸리나(r.이름, en) || 씻기(r.이름) === 씻기(en)))
    // ⚠️ 번호가 없어도 **갈래는 맞아야 한다.** 예전엔 이 검사가 빠져 「2010 플레이! 포켓몬」
    //    카드가 「2011 Pokemon League」 줄에 붙었다(2026-08-31).
    if (내갈래.length) {
      const g맞 = 걸림.filter((r) => { const g = 줄갈래(r.이름); return g.length === 내갈래.length && g.every((x) => 내갈래.includes(x)) })
      if (g맞.length) 걸림 = g맞
      else if (내갈래.includes('AnyEvent')) {
        const 대회 = ['League', 'League Challenge', 'League Cup', 'Regional', 'State', 'City', 'National', 'Play Pokemon', 'Europe', 'PlayerRewards']
        걸림 = 걸림.filter((r) => 줄갈래(r.이름).some((x) => 대회.includes(x)))
      } else return { 판정: '보류', 까닭: `번호가 없고 갈래(${내갈래.join(',')})가 맞는 줄도 없다` }
    } else {
      const g빈 = 걸림.filter((r) => !줄갈래(r.이름).length)
      if (g빈.length) 걸림 = g빈
    }
    if (걸림.length > 1) {
      const lv = 나.곁말.find((w) => /^lv\d+$/.test(w))
      if (lv) { const l = 걸림.filter((r) => r.이름.toLowerCase().replace(/[.\s]/g, '').includes(lv)); if (l.length) 걸림 = l }
    }
    if (걸림.length === 1) return { 판정: '확인', 줄: 걸림[0], 믿음: '판단' }
    if (걸림.length > 1) return { 판정: '보류', 까닭: `번호가 없어 이름으로 찾았으나 줄이 여럿(${걸림.length}개)` }
    return { 판정: '보류', 까닭: '번호가 없고 이름으로도 못 찾았다' }
  }
  // ⚠️ 트레이너·굿즈는 PSA가 번호를 안 매긴다(N/A). 우리 쪽도 번호가 없을 때가 많다.
  //    그럴 때만 **이름 하나로** 찾는다. 딱 한 줄일 때만 받아들인다.
  if (!후보.length && 나.후보.length) {
    const 번호없는줄 = psa줄들.filter((r) => !/\d/.test(String(r.번호)))
    const 이름걸림 = 번호없는줄.filter((r) => 나.후보.some((en) => 씻기(r.이름) === 씻기(en)))
    if (이름걸림.length === 1) return { 판정: '확인', 줄: 이름걸림[0] }
  }
  if (!후보.length) return { 판정: '보류', 까닭: 'PSA에 같은 번호 줄이 없다' }

  let 믿음
  const 같은갈래 = (g, 내) => g.length === 내.length && g.every((x) => 내.includes(x))
  // ⚠️ 세트 자체가 「그 상품에만 든 카드」인 슬러그(덱 전용·블리스터 전용)에서는,
  //    우리 이름에 무늬가 안 적혀 있어도 PSA의 그 상품 줄이 맞는 카드다.
  //    (앤테이 47/214는 우리 쪽에 「크랙아이스」라고 안 적혀 있지만 실제로는 테마덱 판뿐이다.)
  //    선호 줄이 **딱 하나**일 때만, 「판단」으로 남기고 받아들인다.
  // ⚠️ 「프리릴리즈 키트 한정」처럼 우리 표시가 한글이라 못 알아듣지만, PSA 줄에
  //    「Prerelease Kit」이 있으면 그것이 맞는 줄이다. 딱 하나일 때만 「판단」으로 받는다.
  if (!내갈래.length && /프리릴리즈 키트/.test(String(우리카드.이름)) && 나.후보.length) {
    const 키트 = 후보.filter((r) => /prerelease( kit)?/i.test(r.이름) && 나.후보.some((en) => 씻기(r.이름).includes(씻기(en))))
    if (키트.length === 1) return { 판정: '확인', 줄: 키트[0], 믿음: '판단' }
  }
  // ⚠️ **우리 한글 표시 ↔ PSA 상품 이름**을 이어 주는 표.
  //    우리 이름에 이 말이 있으면 PSA 줄에서 짝이 되는 상품 줄을 찾는다.
  //    딱 하나 걸릴 때만 「판단」으로 받아들인다(둘 이상이면 보류).
  const 상품말 = [
    [/프리릴리즈 키트/, /prerelease( kit)?/i],
    [/빌드어베어/, /build-?a-?bear/i],
    [/토이저러스/, /toys ?r ?us/i],
    [/프리미엄 컬렉션/, /premium collection/i],
    [/EB ?게임즈|EBGames/i, /eb games/i],
    [/European Promo|유럽/i, /europe exclusive/i],
    [/코스트코|Costco/i, /costco/i],
  ]
  if (!내갈래.length && 나.후보.length) {
    for (const [우리말, psa말] of 상품말) {
      if (!우리말.test(String(우리카드.이름))) continue
      const ㅅ = 후보.filter((r) => psa말.test(r.이름) && 나.후보.some((en) => 씻기(r.이름).includes(씻기(en))))
      if (ㅅ.length === 1) return { 판정: '확인', 줄: ㅅ[0], 믿음: '판단' }
    }
  }

  // ⚠️ 세트가 통째로 한 갈래인 슬러그(점보)에서는 우리 이름에 표시가 남아 있어도
  //    그 상품 줄이 딱 하나면 그것이 맞다(「드래펄트 (Prime)」 → Celebrations Jumbo).
  const 갈래가기본뿐 = (기본갈래 || []).length && 내갈래.length === 기본갈래.length &&
    내갈래.every((x) => 기본갈래.includes(x))
  if (선호 && (!내갈래.length || 갈래가기본뿐) && 나.후보.length) {
    // ⚠️⚠️ **이름이 맞는지 먼저 본다.** 이 검사를 빠뜨렸다가 무우마직(5/95)이
    //    「Serperior Green Tornado Theme Deck」에 붙을 뻔했다(2026-08-31).
    const 상품줄 = 후보.filter((r) => 선호.test(r.이름) && 나.후보.some((en) => 씻기(r.이름).includes(씻기(en))))
    if (상품줄.length === 1) return { 판정: '확인', 줄: 상품줄[0], 믿음: '판단' }
  }
  let 갈 = 후보.filter((r) => 같은갈래(줄갈래(r.이름), 내갈래))
  // ⚠️ 순위가 붙은 리그 상품은 우리 쪽이 「리그 챌린지」, PSA가 「Nth Place Pokemon League」로
  //    적는 일이 있다. **순위가 양쪽 다 있을 때만** 서로 통하는 것으로 보고 「판단」으로 남긴다.
  // 「아무 대회나」 — 대회 표시가 붙은 줄이 딱 하나면 그것으로 본다(판단).
  // ⚠️ 우리가 「플레이! 포켓몬」이라 적은 것을 PSA는 「Pokemon League」로 적기도 한다
  //    (흑백 기본세트 에너지 105~112). 대회 줄이 딱 하나면 그것으로 보되 「판단」으로 남긴다.
  if (!갈.length && 내갈래.includes('Play Pokemon')) 내갈래 = 내갈래.map((x) => (x === 'Play Pokemon' ? 'AnyEvent' : x))
  // ⚠️ 우리 쪽 「리그 컵」을 PSA는 그냥 「Pokemon League」로 적는 일이 많다(2026-08-31).
  //    로스트썬더 172번이 그렇다 — 영문 줄은 「Pokemon League」인데 독일어 줄만 「League Cup」이다.
  //    그러니 **리그 컵 줄이 하나도 없을 때만** 리그 줄로 갈아 보고, 「판단」으로 남긴다.
  if (!갈.length && 내갈래.includes('League Cup') && !후보.some((r) => 줄갈래(r.이름).includes('League Cup'))) {
    const 바꾼 = 내갈래.map((x) => (x === 'League Cup' ? 'League' : x))
    const 다시 = 후보.filter((r) => 같은갈래(줄갈래(r.이름), 바꾼))
    if (다시.length === 1) { 갈 = 다시; 믿음 = '판단' }
  }
  if (!갈.length && 내갈래.includes('AnyEvent')) {
    const 대회 = ['League', 'League Challenge', 'League Cup', 'Regional', 'State', 'City', 'National', 'Play Pokemon', 'LatinAmerica', 'Oceania', 'NorthAmerica', 'International', 'Europe', 'PlayerRewards']
    const 나머지 = 내갈래.filter((x) => x !== 'AnyEvent')
    갈 = 후보.filter((r) => {
      const g = 줄갈래(r.이름)
      const 대회있나 = g.some((x) => 대회.includes(x)) || /player rewards|professor program/i.test(r.이름)
      const 나머지맞나 = 나머지.every((x) => g.includes(x)) && g.filter((x) => !대회.includes(x)).length === 나머지.length
      return 대회있나 && 나머지맞나
    })
    if (갈.length === 1) 믿음 = '판단'
    else 갈 = []
  }
  // ⚠️ 순위가 붙은 리그 상품은 우리와 PSA가 「리그」와 「리그 챌린지」를 서로 바꿔 적는다.
  //    **양쪽 방향 모두** 통하게 둔다(PSA가 「Pokemon League League Challenge-4th Place」처럼
  //    둘을 같이 적은 줄이 있다). 순위가 양쪽 다 있을 때만 허용하고 「판단」으로 남긴다.
  if (!갈.length && 내갈래.some((x) => /^[1-4](st|nd|rd|th)$/.test(x)) &&
      (내갈래.includes('League Challenge') || 내갈래.includes('League'))) {
    const 짝바꿈 = 내갈래.includes('League Challenge') ? ['League Challenge', 'League'] : ['League', 'League Challenge']
    const 바꾼 = 내갈래.map((x) => (x === 짝바꿈[0] ? 짝바꿈[1] : x))
    갈 = 후보.filter((r) => 같은갈래(줄갈래(r.이름), 바꾼))
    if (갈.length) 믿음 = '판단'
  }
  // 몬스터볼 줄이 따로 없는 세트 — Reverse 줄로 본다(판단)
  if (!갈.length && 내갈래.includes('Poke Ball')) {
    갈 = 후보.filter((r) => { const g = 줄갈래(r.이름); return g.length === 1 && g[0] === 'Reverse' })
    if (갈.length) 믿음 = '판단'
  }
  // ⚠️⚠️ **갈래가 있는데 맞는 줄이 없으면 보류다.** 예전엔 줄이 하나뿐이면 그냥 받아들였는데,
  //    「크랙아이스 홀로」 카드가 「Reverse Foil Pokemon League」 줄에 붙을 뻔했다(2026-08-31).
  //    무늬·갈래가 다르면 다른 카드다. 끼워 맞추지 않는다.
  // ⚠️ 블리스터·덱 전용 코스모스 홀로는 PSA가 무늬 대신 **상품 이름**으로 적는다
  //    (「Furfrou-Holo Primal Clash Three Pack Blister」). 코스모스 줄이 아예 없고
  //    상품 줄이 딱 하나면 그것으로 보되 「판단」으로 남긴다.
  if (!갈.length && 선호 && 내갈래.length === 1 && 내갈래[0] === 'Cosmos' && 나.후보.length) {
    const 상품 = 후보.filter((r) => 선호.test(r.이름) && 나.후보.some((en) => 씻기(r.이름).includes(씻기(en))))
    if (상품.length === 1) { 갈 = 상품; 믿음 = '판단' }
  }
  if (갈.length) 후보 = 갈
  else if (내갈래.length) return { 판정: '보류', 까닭: `갈래(${내갈래.join(',')})가 맞는 PSA 줄이 없다` }
  // ⚠️⚠️ **우리 카드에 무늬 표시가 없으면 무늬 줄을 가져가면 안 된다**(2026-08-31).
  //    맨 「동미러」가 「Bronzor-Reverse Foil」 값을 먹었다(보정표에 없던 카드까지 채우기
  //    시작하면서 드러났다). 미러·코스모스·크랙아이스는 **같은 카드의 다른 인쇄**라 값이 다르다.
  //    ⚠️ 언어판·초판은 여기서 막지 않는다 — 각자 따로 다루는 규칙이 이미 있고, 세트 자체가
  //       한 언어·초판뿐인 곳(피카츄 월드 컬렉션·드래곤 셀렉션)이 있어 막으면 되레 틀린다.
  else if (!내갈래.length) {
    const 무늬 = ['Reverse', 'Cosmos', 'Crosshatch', 'Master Ball', 'Poke Ball', 'Friend Ball',
      'Dark Ball', 'Love Ball', 'Quick Ball', 'Terastal', 'Water Web', 'Energy', 'Team Rocket Pattern']
    if (후보.every((r) => 줄갈래(r.이름).some((x) => 무늬.includes(x)))) {
      return { 판정: '보류', 까닭: '우리 카드엔 무늬 표시가 없는데 PSA 줄엔 죄다 무늬가 붙어 있다' }
    }
  }

  // ⚠️⚠️ **「누구의 무엇」 카드는 주인 이름이 붙은 줄에만 붙인다.**
  //    PSA가 그 카드를 다른 나라 말로만 올려 둔 일이 있는데(SM108~114 「Pikachu de Sacha」),
  //    줄이 하나뿐이라는 이유로 그 값을 가져갈 뻔했다(2026-08-31). 주인이 안 보이면 보류다.
  if ((나.임자후보 || []).length) {
    const ㅇ = 후보.filter((r) => 나.임자후보.some((en) => 씻기(r.이름).includes(씻기(en))))
    if (!ㅇ.length) return { 판정: '보류', 까닭: `주인 이름(${나.임자후보[0]})이 붙은 PSA 줄이 없다` }
    후보 = ㅇ
  }
  if (후보.length > 1 && 나.후보.length) {
    const nn = 후보.filter((r) => 나.후보.some((en) => 씻기(r.이름).includes(씻기(en))))
    if (nn.length) 후보 = nn
  }
  let 곁말로골랐다 = ''
  // ⚠️ 우리 세트가 「구축 덱 전용」처럼 판을 알려 주면 그쪽 줄을 먼저 고른다.
  //    도감 세트 이름이 곧 단서다 — 덱에만 든 카드는 PSA도 "… Theme Deck"으로 적는다.
  if (후보.length > 1 && 선호) {
    const pp = 후보.filter((r) => 선호.test(r.이름))
    if (pp.length === 1) { 후보 = pp; 곁말로골랐다 = '세트단서' }
  }
  // 마지막 가름 — 우리 이름에 있던 영문 낱말(Autumn·Spring 등)이 한 줄에만 있으면 그 줄이다.
  if (후보.length > 1 && 나.곁말.length) {
    // ⚠️ 'prerelease'는 뺐다 — 같은 번호에 「그냥 홀로」와 「Prerelease」가 같이 있을 때
    //    이것으로만 갈리는 카드가 있다(히드런 88/156). 여럿에 걸리면 어차피 안 고른다.
    const 흔한 = new Set(['holo', 'promo', 'staff', 'card', 'pokemon', 'reverse'])
    const 쓸말 = 나.곁말.filter((w) => !흔한.has(w))
    const 씻은줄 = (r) => r.이름.toLowerCase().replace(/[.\s]/g, '')
    for (const w of 쓸말) {
      const 걸린 = /^lv\d+$/.test(w) ? 후보.filter((r) => 씻은줄(r).includes(w)) : 후보.filter((r) => r.이름.toLowerCase().includes(w))
      if (걸린.length === 1) { 후보 = 걸린; 곁말로골랐다 = w; break }
    }
  }
  if (후보.length !== 1) return { 판정: '보류', 까닭: `줄을 하나로 못 좁혔다(${후보.length}개)` }

  const r = 후보[0]
  // ⚠️⚠️ **표시가 붙은 줄은 아무 카드에나 주지 않는다.**
  //    우리 카드에 갈래가 없고 곁말로 고른 것도 아닌데, PSA 줄에 League·Cosmos·Blister 같은
  //    표시가 붙어 있으면 그건 **다른 판**이다. 걸러 담은 줄 파일로 대조하다 이 사고가 났다
  //    (Water Web Holo 카드가 Pokemon League 줄에 붙음, 2026-08-31 · 6장 되돌림).
  // ⚠️ 그 번호에 줄이 **하나뿐**이면 표시가 붙어 있어도 그 카드다(다른 선택지가 없다).
  const 그번호줄 = psa줄들.filter((x) => 번호정리(x.번호) === 내번호)
  // ⚠️⚠️ **못 알아들은 괄호 표시가 남아 있으면, 그 번호에 줄이 여럿일 때 아예 고르지 않는다.**
  //    표시 붙은 줄이든 안 붙은 줄이든 마찬가지다 — 우리 카드가 어느 판인지 모르기 때문이다.
  //    (Dragon Vault 코스모스판이 일반 홀로 줄에 붙을 뻔했다, 2026-08-31)
  // ⚠️ 다만 그 표시가 **고른 줄 이름에 그대로 들어 있으면** 설명된 것이다(Prerelease 등).
  // ⚠️ 제품 사정을 말하는 표시(Prerelease·Team Plasma 등)는 판을 가르는 표시가 아니다.
  //    PSA가 줄 이름에 안 적기도 하므로 이런 것은 걸림돌로 삼지 않는다.
  // ⚠️ 「Promo」 한 낱말은 순한 표시지만, 「2014 Movie Promo」처럼 **앞에 말이 붙으면 다른 판**이다.
  //    예전엔 `promo$`로 끝만 봐서, 극장판 피카츄가 XY 기본세트 42번 줄 값을 먹었다(2026-08-31).
  const 순한표시 = /^(?:prerelease|team plasma|shiny|non-?holo|oversize|theme deck|half deck|deck exclusive|promo)$/i
  // ⚠️ 표시 안에 섞인 **순한 낱말**(Prerelease·Promo·Holo·Staff 같은 것)은 빼고 견준다.
  //    「XY Steam Siege Prerelease」에서 정작 중요한 말은 Steam Siege이기 때문이다.
  const 순한낱말 = /^(?:prerelease|promo|holo|foil|staff|card|cards|edition|series)$/i
  // ⚠️ 「(SM 블랙 Star Promo)」처럼 **프로모 세트 이름만 적힌 표시**는 판을 가르는 말이 아니다.
  //    어느 프로모 세트인지는 번호 앞글자(SM·XY…)가 이미 말해 준다. 이것만 콕 집어 넘긴다.
  const 프로모세트표시 = /^(?:SM|XY|DP|BW|SWSH|HGSS)\s*블랙\s*Star\s*Promos?$/i
  // ⚠️⚠️ 한때 「(DP Legends Awakened)」 같은 **세트 이름 표시**를 그냥 넘기게 했다가,
  //    덱 전용 히드런(코스모스 홀로 1/11/35)이 일반 줄(0/2/7)로 덮일 뻔했다(2026-08-31).
  //    덱·블리스터 전용 카드는 그 표시가 「어느 세트의 특별판인지」를 뜻하므로 넘기면 안 된다.
  const 안풀린표시 = (나.남은표시 || []).filter((x) => 순한표시.test(x) || 프로모세트표시.test(x) ? false : true).filter((x) => {
    // 순한 낱말을 빼고 남는 말이 있는지 본다.
    const 남은말 = x.replace(/[A-Za-z]+/g, (w) => (순한낱말.test(w) ? ' ' : w)).replace(/\s+/g, ' ').trim()
    if (!남은말) return false
    // ⚠️ 한글이 남으면 PSA 줄 이름(영어)과 견줄 길이 없다 — 못 알아들은 것으로 본다.
    //    「토이저러스 Promo」를 순한 표시로 봤다가 코스모그가 기본 줄 값을 먹을 뻔했다(2026-08-31).
    // ⚠️ 숫자만 남으면 그건 **같은 이름 카드를 가르는 번호**다(「레쿠쟈 & 테오키스 LEGEND (90)」).
    //    판을 가르는 표시가 아니므로 그냥 넘긴다.
    if (/^[0-9\s]+$/.test(남은말)) return false
    if (/[가-힣]/.test(남은말)) return true
    const 낱말 = 남은말.match(/[A-Za-z]{4,}/g) || []
    if (!낱말.length) return true
    return !낱말.every((w) => r.이름.toLowerCase().includes(w.toLowerCase()))
  })
  if (!곁말로골랐다 && 안풀린표시.length && 그번호줄.length > 1)
    return { 판정: '보류', 까닭: `못 알아들은 표시(${안풀린표시.join(',')})가 있고 줄이 여럿이다` }
  if (!곁말로골랐다 && (그번호줄.length > 1 || (나.남은표시 || []).length) && !내갈래.length) {
    // ⚠️ 여기 넣는 것은 「그 카드만의 판」을 뜻하는 표시다.
    //    1st Edition·Prerelease처럼 **세트 전체의 성격**인 것은 넣지 않는다 —
    //    넣으면 VS·CP6처럼 세트가 통째로 1st Edition인 곳이 모두 보류가 된다.
    const 표시 = /pokemon league|cosmos|crosshatch|cracked ice|\bstaff\b|championship|blister|master ?ball|poke ?ball|reverse|toys ?r ?us|general mills/i
    if (표시.test(r.이름)) return { 판정: '보류', 까닭: `PSA 줄에 표시가 붙어 있다 — "${r.이름}"` }
  }
  // 갈래가 안 맞는데도 줄이 하나뿐이라 고른 경우 — 받아들이되 「판단」으로 남긴다.
  // (CP6·VS처럼 세트 전체가 1st Edition뿐이면 우리 본자리에 그 값이 오는 게 맞다.)
  if (!믿음) {
    const g = 줄갈래(r.이름)
    if (g.length !== 내갈래.length || !g.every((x) => 내갈래.includes(x))) 믿음 = '판단'
  }
  // 영문 이름을 모르더라도, 우리 이름의 낱말(Autumn 같은 것)로 한 줄이 딱 집혔으면 받아들인다.
  if (!나.후보.length) {
    if (곁말로골랐다) return { 판정: '확인', 줄: r, 믿음: '판단' }
    return { 판정: '보류', 까닭: '우리 이름의 영문을 몰라 대조 못 함' }
  }
  if (!나.후보.some((en) => 씻기(r.이름).includes(씻기(en))))
    return { 판정: '보류', 까닭: `이름이 안 맞는다 · PSA "${r.이름}" ↔ 우리 ${나.후보.join('/')}` }

  return { 판정: '확인', 줄: r, ...(믿음 ? { 믿음 } : {}) }
}
