/**
 * 이베이 **매물 제목**에서 사실을 뽑아내는 한 벌. **서버와 점검 도구가 이것만 쓴다.**
 *
 * ⚠️⚠️ 규칙이 두 벌이면 점검 도구가 없는 문제를 만들어 낸다. 2026-08-08에 그 일을
 *    세 번 겪었다 — "Team 로켓단 Grunt 154장"(없는 문제) · 멀쩡한 낙찰 386건 ·
 *    BGS 부점수 "9/9/9.5"를 카드 번호로 읽은 것. 전부 도구가 서버와 다른 길을 써서였다.
 * ⚠️ 서버가 이 파일을 쓰므로 **Dockerfile COPY 목록에도 있어야 한다.**
 *    `npm run build`의 배포 파일 검사가 빠뜨리면 알려 준다.
 */

// ⚠️ 이 말들 바로 뒤 숫자는 **등급 점수**지 카드 번호가 아니다.
//    "CGC PERFECT 10/10"의 10/10을 카드 번호로 읽어 묶음 판매로 오해한 적이 있다(2026-08-08).
export const 등급앞말 =
  /(psa|bgs|cgc|sgc|tag|ace|ars|grade|gem|mint|pgs|mpg|perfect|pristine|black label|subgrade[ds]?|subs?)\s*$/i
/**
 * **제목에 적힌 감정 등급을 "칸 이름"으로 바꾼다**("PSA 10" → psa10 · "CGC 9.5" → cgc9_5).
 *
 * 왜 필요한가 — 저쪽이 제목에서 등급을 못 읽으면 그 매물을 **미감정 칸에 떨어뜨린다.**
 * 사장님 지적(2026-08-08): "사진 보면 싱글카드가 아니라 등급 카드인데, 이름에 psa10이라
 * 안 쓰여 있으니까 싱글카드로 들어 있는 게 있다."
 * 잘 알려진 회사(PSA·BGS·CGC…)뿐 아니라 작은 회사도 잡는다 — 실제로 이런 것이 섞여 있다:
 *     "PGS 10" · "MPG 10" · "Pokemon-Z gold 10" · "CCI 10"
 * ⚠️ 작은 회사를 PSA 칸에 넣으면 **그게 또 섞임이다.** 회사 이름을 그대로 살려
 *    자기 칸(pgs10 · mpg10)을 만든다. 화면의 등급 이름표는 아무 칸이나 받는다.
 */
export const 회사말 = 'psa|bgs|beckett|cgc|sgc|ace|tag|ars|rgr|pgs|mpg|cci|gma|hga|isa|ags'
export const 제목등급칸 = (t: string): string => {
  const s = String(t ?? '')
  // ⚠️ 회사와 숫자 사이에 등급말이 끼는 꼴이 흔하다 — "PSA NM-MT 8" · "CGC NM/MINT 8" ·
  //    "BGS GEM MT 9.5". 이걸 안 넣으면 그 매물이 미감정 칸에 그대로 남는다.
  const 사이말 = '(?:grade[ds]?|gem\\s*-?\\s*mt|nm\\s*[-/]\\s*(?:mt|mint)|mint|pristine)?'
  let m = s.match(new RegExp(`\\b(${회사말})\\s*-?\\s*${사이말}\\s*(10|[1-9](?:\\.5)?)\\b(?!\\d)`, 'i'))
  if (!m) {
    // 회사 이름이 뒤에 오는 꼴: "GEM MT 10 ... PSA" 는 위에서 잡히고, 여긴 "Z gold 10" 같은 것.
    const z = s.match(new RegExp(`\\b(?:pokemon-?)?z\\s*gold\\s*(10|[1-9](?:\\.5)?)\\b(?!\\d)`, 'i'))
    if (z) return `z${z[1].replace('.', '_')}`
    return ''
  }
  const 회사 = m[1].toLowerCase() === 'beckett' ? 'bgs' : m[1].toLowerCase()
  return `${회사}${m[2].replace('.', '_')}`
}
/** 그 칸의 회사 이름(ungraded면 빈값). "cgc8_5" → "cgc" */
/**
 * **여러 장을 한꺼번에 판 매물인가.** 한 장 값이 아니라서 시세에 넣으면 안 된다.
 *
 * 원본 낙찰 24,373건에 걸어 보니 **1건**뿐이었다(2026-08-08) — 아주 드물다. 대신
 * 걸리면 값이 통째로 틀어진다("Crown Zenith Mewtwo VSTAR … Set of 3" $153.5가 psa9에).
 * ⚠️ **헛발이 없게 좁게 잡았다.** "PSA 6 Card"의 "6 Card" 같은 것을 세면 멀쩡한 낙찰
 *    수천 건이 걸린다(처음에 그랬다). "lot of 3"처럼 **수량을 말하는 꼴**만 본다.
 * ⚠️ 목록에서 지우지는 않는다. 평균·중앙값·그래프에서만 뺀다 — 사람이 보고 판단하게.
 */
export const 묶음인가 = (t: string | undefined): boolean => {
  const s = String(t ?? '')
  if (/\b(?:lot|set|bundle|collection|joblot)\s*of\s*\d+|\bjob\s*lot\b|\b\d+\s*card\s*lot\b|\bbundle\s*of\b/i.test(s))
    return true
  // ⚠️ **카드 번호가 둘 이상 적힌 제목은 여러 장을 같이 판 것이다.**
  //    "Umbreon VMAX 245/184 & Umbreon 244/184" · "Latias ex 239/191 and Latios 203/191"
  //    한 장 값이 아닌데 한 장 값으로 들어가면 시세가 부풀려진다. 실제로 방문자가 자주
  //    찾는 피카츄 227/S-P에 "Pikachu 227/S-P + Cramorant 226/S-P" $3,746이 있었다.
  //    낙찰 17,716건에 걸어 34건(0.19%)이 나왔고 **전부 진짜 묶음**이었다(2026-08-08).
  //    ⚠️ 같은 번호를 두 꼴로 적은 것("232/091"·"232/91")은 번호맞추기가 하나로 모으므로
  //       여기 안 걸린다.
  //    ⚠️ 프로모는 분모가 글자다("227/S-P"·"SWSH123"). 그건 카드 번호로는 안 쓰지만
  //       **묶음을 가릴 때는 센다** — "Pikachu 227/S-P Cramorant 226/S-P"가 그렇다.
  const 번호꼴 = new Set(제목번호들(s))
  //    ⚠️ 글자 분모는 **가운뎃줄이 있는 꼴만** 본다(S-P · SM-P · XY-P). 안 그러면
  //       "Base Set 2 / Base II"의 "2 / Base"를 번호로 읽는다(2026-08-08에 겪음).
  for (const m of s.matchAll(/(^|[^\w/])(\d{1,4})\s*\/\s*([A-Za-z]{1,3}-[A-Za-z]{1,2})\b/g))
    번호꼴.add(`${Number(m[2])}/${m[3].toUpperCase()}`)
  return 번호꼴.size >= 2
}

export const 칸회사 = (칸: string): string => (칸 === 'ungraded' ? '' : (칸.match(/^[a-z]+/i)?.[0] ?? '').toLowerCase())

/**
 * 제목의 번호에서 **앞에 붙은 세트 표시를 떼어** 같은 카드끼리 모이게 한다.
 *
 * 파는 사람이 "07 03/09"를 붙여 "0703/09"로 적는다. 그대로 세면 "0703/09"와 "03/09"가
 * 딴 카드가 되어, 같은 카드가 두 갈래로 쪼개진다.
 * ⚠️ **앞자리를 무턱대고 떼면 안 된다.**
 *    · "104/128"의 104는 진짜 세 자리 번호다.
 *    · "252/184"처럼 **앞 번호가 총 장수보다 큰 것도 진짜다**(시크릿 레어).
 *      그래서 "앞이 뒤보다 크면 뗀다"로는 안 된다 — 실제로 252/184가 52/184로 깨졌다.
 *    붙여 적은 것은 자릿수가 딱 **뒤 자릿수 + 2**가 된다("07"+"03"/"09" → 4자리 = 2+2).
 *    그때만 앞 두 자리를 뗀다.
 */
export const 번호맞추기 = (앞: string, 뒤: string): string => {
  const a = 앞.length === 뒤.length + 2 ? 앞.slice(2) : 앞
  return `${Number(a)}/${Number(뒤)}`
}
export const 제목번호들 = (t: string): string[] => {
  const out = new Set<string>()
  // ⚠️ **소수점 뒤는 번호가 아니다.** BGS는 부점수를 "9.5/9.5/10/9.5"로 적는데,
  //    앞을 안 막으면 ".5/9"에서 **5/9를 카드 번호로 읽는다**(2026-08-08에 잡음).
  //    카드 번호가 마침표 바로 뒤에 오는 일은 없다.
  for (const m of String(t).matchAll(/(^|[^\d/.])(\d{1,4})\s*\/\s*(\d{1,3})(?![\d/])/g)) {
    if (등급앞말.test(String(t).slice(0, (m.index ?? 0) + m[1].length))) continue
    const n = 번호맞추기(m[2], m[3])
    // ⚠️ **"1/1"은 카드 번호가 아니라 자랑말이다** — 감정 케이스 매물에서 "POP 1"·
    //    "ARS10+ BLACK 1/1"처럼 "세상에 한 장"을 뜻한다. 포켓몬 카드에 1/1 번호는
    //    사실상 없다. 이걸 번호로 읽으면 멀쩡한 낙찰이 딴 카드로 걸린다(2026-08-08).
    if (n === '1/1') continue
    out.add(n)
  }
  return [...out]
}

/**
 * **분모 없이 "#38"처럼 적은 카드 번호.** 옛 카드 매물에 흔하다.
 *
 * ⚠️ **이것만으로 딴 카드를 가리면 안 된다.** 예전에 "번호 앞자리"로 견주다가 표본에서
 *    12건을 잘못 잘랐다 — 뮤는 도감번호 151을 제목에 쓰고, LEGEND는 상·하 두 장이라
 *    "#89 and #90"이라 적는다. 그래서 서버는 **연도까지 함께 어긋날 때만** 뺀다.
 * ⚠️ 반드시 `#`가 앞에 붙은 것만 본다(등급 숫자·인증번호와 섞이지 않게). 세 자리까지만
 *    보고, 뒤에 "/"가 오면 그건 분모 있는 번호라 여기서 안 본다.
 */
export const 맨번호들 = (t: string): string[] => {
  const out = new Set<string>()
  for (const m of String(t).matchAll(/(^|[^\w/])#\s*(\d{1,3})\b(?!\s*\/)/g)) out.add(String(Number(m[2])))
  return [...out]
}
