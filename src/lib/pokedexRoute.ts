// 도감(포켓몬·트레이너별 카드)에서 카드 한 장을 눌렀을 때, 그 카드를 **어느 마켓에서
// 어떤 검색어로** 찾을지 정한다.
//
// 왜 필요한가: 마켓마다 갖고 있는 카드가 다르다(실측 2026-08-06).
//   · 스니커덩크 — 일본판. 매물이 있어야 상품이 생겨서, 신상·인기 카드는 강하고
//     옛 세트(1996~2006)·프로모는 아예 없다.
//   · PPT 이베이 낙찰 — 일본판·영문판 둘 다 있지만 **등급 낙찰이 있는 카드만** 잡힌다.
//     흔한 카드나 최신 세트는 대부분 0건이다.
//   · PPT TCGplayer 마켓가 — 위 둘이 놓친 카드를 많이 갖고 있다. 이베이 낙찰이 0건이던
//     영문판 5장이 전부 TCGplayer에는 값이 있었고, 스니커덩크가 못 찾은 일본판 8장 중
//     3장도 여기서 나왔다.
// 그래서 "일본판이면 무조건 스니커덩크"가 아니라, 값이 있는 곳을 차례로 찾아간다
// (운영자 지시 2026-08-06).
//
// ⚠️ 검색어 꼴도 마켓마다 다르다. 한 꼴을 다른 마켓에 그대로 넣으면 0건이 된다.
//   · 스니커덩크: "세트코드 번호"(M6 113). 제목에 [M6 113/076]으로 적혀 있다.
//   · PPT: 영문 카드 이름. **일본판 DB도 영문 이름으로 색인돼 있다.**
//     세트는 검색어에 붙이면 0건이고, setName 파라미터로 따로 보내야 걸러진다.
import pptSetNames from '../data/pptSetNames.json';
import setCardNumberAlias from '../data/setCardNumberAlias.json';

export interface 도감카드정보 {
  ko: string;
  en: string;
  raw: string;
  speciesEn: string;
  slug: string;
  setCode: string;
  /** 우리 세트 이름(원문). PPT 대응표를 못 찾았을 때 그대로 보내 본다. */
  setName: string;
  /** 화면에 적을 한글 세트 이름. 안내 문구는 반드시 이걸 쓴다 — 원문에는 일본어가
   *  섞여 있어("XY プロモ") 그대로 내보내면 안내문에 일본어가 나간다. */
  setNameKo: string;
  num: string;
  jp: boolean;
  /**
   * 이 카드의 **PPT 번호**(tcgPlayerId). 2026-08-09에 도감을 PPT로 갈아엎으면서
   * 카드마다 박아 두었다(58,151장). 이게 있으면 이베이·TCGplayer 시세를 **이름으로
   * 뒤지지 않고 콕 집어** 부를 수 있다 — 딴 카드가 안 섞이고 크레딧도 48분의 1이다.
   * ⚠️ 없을 수도 있다(PPT에 없는 옛 카드·포켓). 그때는 예전처럼 이름으로 찾는다.
   */
  tcg?: string;
  /** 목록에서 누른 그 카드의 그림. 마켓에 값이 없으면 화면에 아무 그림도 안 남아,
   *  "내가 누른 카드가 맞나"를 확인할 방법이 없었다(2026-08-07 점검 중 발견).
   *  안내 문구 옆에 이 그림을 붙여 무엇을 찾고 있는지 보이게 한다. */
  img?: string;
}

/** 마켓 한 칸. source·edition은 앱의 탭 상태 그대로다. */
export interface 마켓 {
  // ⚠️ 옛 해외 시세('ebay'·'tcgplayer')는 2026-08-13에 지웠다. 되살리지 말 것.
  source: 'snkrdunk' | 'cardboard';
  edition: 'japanese' | 'english';
  label: string;
}

/**
 * 값이 없을 때 뭐라고 할지. **마켓마다 "값"의 뜻이 달라서 한 문구로 뭉치면 안 된다.**
 *
 * - 스니커덩크는 지금 올라온 **매물**이다. 안 팔린 게 아니라 지금 물건이 없는 것이다.
 * - 이베이는 **팔린 기록**이다. 카드는 있는데 아무도 안 판 경우가 흔하다 —
 *   "어둠에서의 도전" 60장 중 27장이 시세는 멀쩡한데 이베이 낙찰만 0건이다.
 *   이걸 "값이 없다"고 하면 값이 있는데도 없는 것처럼 읽힌다(2026-08-07 지적).
 * - TCGplayer는 파는 값이라, 없으면 그냥 자료가 없는 것이다.
 *
 * @param 카드찾음 그 마켓 자료에서 이 카드를 찾기는 했는지. 못 찾았으면 "안 팔렸다"가
 *                아니라 "자료가 없다"이므로 말이 달라진다.
 */
export const 값없음문구 = (source: 마켓['source'], 카드찾음: boolean): string => {
  if (source === 'snkrdunk') return '매물이 없습니다';
  // 새 길은 **우리 도감에서 카드를 고르므로 카드는 늘 있다.** 없는 것은 거래뿐이다.
  if (source === 'cardboard') return '거래 내역이 없습니다';
  if (source === 'ebay') return 카드찾음 ? '거래 내역이 없습니다' : '시세 데이터가 없습니다';
  return '시세 데이터가 없습니다';
};

/**
 * "○○에 ~없어 다음 마켓 값을 보여 드립니다"의 앞부분.
 *
 * 카드를 찾았는지 못 찾았는지와 무관하게 참인 말만 쓴다 — 이베이는 못 찾았어도
 * 팔린 기록이 없는 건 사실이고, 스니커덩크는 어느 쪽이든 지금 물건이 없다.
 */
export const 값없음이유 = (source: 마켓['source']): string =>
  source === 'snkrdunk' || source === 'cardboard'
    ? source === 'snkrdunk'
      ? '매물이 없어'
      : '거래 내역이 없어'
    : source === 'ebay'
      ? '거래 내역이 없어'
      : '시세 데이터가 없어';

/**
 * 찾아갈 순서. 앞에서 못 찾으면 다음으로 넘어간다.
 *
 * 일본판을 스니커덩크부터 보는 이유는 하나뿐이다 — **공짜이고 실거래가라서**다.
 *
 * ⚠️⚠️ **새 시세 길(cardboard)이 마지막이고, 그 뒤는 없다**(2026-08-13에 옮김).
 *    예전엔 「이베이 → TCGplayer」 둘이었고 저쪽에 물을 때마다 크레딧이 나가서,
 *    값이 없으면 다음 마켓으로 넘겨 가며 찾아야 했다. 새 길은 **우리 도감에서 카드를
 *    고르므로 카드가 늘 있다** — 넘길 데가 없고 넘길 이유도 없다.
 *    그래서 `다음마켓으로`가 하는 일이 「스니커덩크에 매물이 없으면 새 길로」 하나로 준다.
 * ⚠️ 새 길은 마켓이 둘(eBay 낙찰·TCGplayer 시세)이지만 **한 번에 둘 다 들고 온다** —
 *    그래서 순서에는 하나만 둔다. 어느 쪽을 볼지는 화면의 칩이 정한다.
 */
export const 마켓순서 = (jp: boolean): 마켓[] =>
  jp
    ? [
        { source: 'snkrdunk', edition: 'japanese', label: '스니커덩크' },
        { source: 'cardboard', edition: 'japanese', label: '해외 시세(일본판)' },
      ]
    : [{ source: 'cardboard', edition: 'english', label: '해외 시세(영문판)' }];

/** 그 마켓에서 쓸 검색어. 빈 문자열이면 그 마켓은 건너뛴다. */
export function 도감검색어(c: 도감카드정보, m: 마켓): string {
  if (m.source === 'snkrdunk') return [c.setCode, c.num].filter(Boolean).join(' ') || c.ko;
  // ⚠️ 새 길은 **우리 도감을 한글 이름으로** 뒤진다. 영문으로 옮길 것도, 기호를 뗄 것도
  //    없다 — 우리가 지은 이름을 우리가 찾는 것이라 그대로가 제일 잘 맞는다.
  //    (어느 한 장인지는 세트·번호를 따로 넘겨 좁힌다.)
  if (m.source === 'cardboard') return c.ko || c.en || c.speciesEn;
  // PPT는 영문 이름으로 찾는다. 영문판 카드면 카드 이름이 곧 영문이라 그대로 쓴다.
  //
  // 일본판은 카드 이름이 일본어라 그대로는 안 걸린다. 대신 **한글 카드 이름**을 넘긴다 —
  // 검색을 보내는 쪽(searchEbayCards)이 이미 한글→영문 번역을 태우므로 "리자몽 EX"가
  // "Charizard EX"가 된다. 포켓몬 이름만("Charizard") 넘기면 그 포켓몬 카드가 죄다
  // 걸려 너무 넓다(운영자 지적 2026-08-06).
  // 한글 이름이 없을 때만 종 영문 이름으로 물러선다.
  //
  // ⚠️ 카드 기호(★ ● ◆ ♢)는 떼고 보낸다. 스니커덩크 제목에서 온 이름에는 이런 기호가
  //    붙어 있는데("고우스트 ●", "레지아이스★"), 번역기가 이해하지 못해 그대로 남아
  //    PPT에서 0건이 된다(2026-08-07 점검 중 발견). 어느 장인지는 세트·번호로 좁히므로
  //    기호가 없어도 그 카드를 찾는다. 화면에 보이는 글자는 그대로 둔다.
  return 기호뗌(c.en || c.ko || c.speciesEn);
}

/** 마켓에 보낼 때만 쓰는 다듬기. 화면 표시에는 쓰지 않는다. */
const 기호뗌 = (s: string) =>
  String(s)
    .replace(/[★☆◆◇●○♢♦]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 검색창·안내에 적을 짧은 세트 이름. 한글 세트 이름에는 "프로모션 : XY 프로모"처럼
 * 분류가 앞에 붙는 것이 있는데, 검색창은 좁아서 그대로 넣으면 카드 이름이 밀린다.
 * 콜론 뒤만 쓴다.
 */
export const 짧은세트 = (setNameKo: string) => setNameKo.split(/\s*:\s*/).pop() ?? setNameKo;

/** 검색창에 보일 한 줄. 마켓을 옮겨 다녀도 이 글자는 그대로 둔다. */
export const 도감표시 = (c: 도감카드정보) =>
  [c.ko, 짧은세트(c.setNameKo), c.num && `${c.num}번`].filter(Boolean).join(' · ');

/** 지금 검색어가 이 카드를 가리키는지 판단할 때 쓰는, 마켓별 검색어 전부. */
export function 도감검색어들(c: 도감카드정보): string[] {
  const 목록 = 마켓순서(c.jp).map((m) => 도감검색어(c, m));
  // 스니커덩크 2차 꼴("원문이름 번호")도 같은 카드를 가리킨다.
  if (c.raw && c.num) 목록.push(`${c.raw} ${c.num}`);
  return [...new Set(목록.filter(Boolean))];
}

/**
 * PPT에 보낼 세트 이름. 우리 세트 이름과 PPT 것이 달라서 대응표를 쓴다
 * (ja-PMCG1 → "Expansion Pack", en-sv03 → "SV03: Obsidian Flames").
 * 대응표에 없으면 우리 이름을 그대로 써 본다 — 맞을 때도 있다.
 *
 * ⚠️ 두 세트가 같은 PPT 이름을 쓰는 경우가 하나 있다(en-ex10 · en-exu → "EX Unseen
 *    Forces"). PPT가 언노운 컬렉션을 상위 세트 이름 아래 두기 때문이다. 번호 체계가
 *    완전히 달라(en-ex10은 1~117, en-exu는 !·?·A~Z) 겹치는 번호가 0장이고,
 *    en-ex10에는 언노운이 한 장도 없어 서로 섞이지 않는다(2026-08-07 전수 확인).
 *    같은 이름을 더 넣을 일이 생기면 **번호가 겹치는지부터 세어 볼 것.**
 */
// 저쪽(PPT) 카드를 **우리 번호로** 되돌린다. 표는 src/data/setCardNumberAlias.json.
// 두 가지 어긋남을 함께 다룬다.
//   ① 번호 체계가 다른 세트 — 우리 CC002가 저쪽에선 4/102다(셀레브레이션즈).
//   ② 저쪽에 번호가 아예 없는 세트 — 옛 일본판(PMCG·neo)은 시세는 있는데 번호 칸이
//      비어 있다. 그때는 **이름**을 열쇠로 쓴다(표에 "NAME:Oddish" 꼴로 적혀 있다).
const 번호되돌림: Record<string, Record<string, string>> = {};
const 이름되돌림: Record<string, Record<string, string>> = {};
const 이름열쇠 = (s: string) => String(s).trim().toLowerCase();
for (const [slug, t] of Object.entries(setCardNumberAlias as Record<string, Record<string, string>>)) {
  const byNum: Record<string, string> = {};
  const byName: Record<string, string> = {};
  for (const [우리, 저쪽] of Object.entries(t)) {
    if (저쪽.startsWith('NAME:')) byName[이름열쇠(저쪽.slice(5))] = 우리;
    else byNum[저쪽.toUpperCase()] = 우리;
  }
  번호되돌림[slug] = byNum;
  이름되돌림[slug] = byName;
}
/**
 * 저쪽 카드(번호·이름)를 우리 번호로.
 *
 * ⚠️ **이름표를 번호보다 먼저 본다.** 번호가 있어도 우리와 다를 수 있어서다
 *    (en-svp: 저쪽 "SVP 175" ↔ 우리 "175", ja-MC: 저쪽 "052/742" ↔ 우리 "051").
 *    번호가 있으면 번호만 보던 때는 이런 카드가 이름표를 넣어 두고도 안 붙었다.
 */
export const 저쪽번호를우리번호로 = (slug: string, 저쪽번호: string, 저쪽이름?: string): string => {
  const 이름 = 저쪽이름 ? 이름되돌림[slug]?.[이름열쇠(저쪽이름)] : undefined;
  if (이름) return 이름;
  const n = String(저쪽번호 ?? '').trim();
  if (n) return 번호되돌림[slug]?.[n.toUpperCase()] ?? n;
  return n;
};

export const pptSetName = (c: 도감카드정보): string => {
  const 아는이름 = (pptSetNames as Record<string, string>)[c.slug];
  if (아는이름) return 아는이름;
  // ⚠️ 대응표에 없으면 우리 이름을 써 보되, **한글이 섞였으면 보내지 않는다**.
  //    일본판 세트 이름은 우리 쪽이 이미 한글이라("스톰에메랄다") 그대로 보내면
  //    PPT가 못 알아듣고 0건이 된다. 세트 조건 없이 이름으로만 찾는 편이 낫다.
  return /[가-힣]/.test(c.setName) ? '' : c.setName || '';
};

/**
 * 마켓이 돌려준 카드가 **정말 그 카드인지** 포켓몬 이름으로 가려낸다.
 *
 * ⚠️ 번호만 맞추면 남의 카드를 그 카드인 양 보여 주게 된다. ja-neo4는 우리 데이터가
 *    영문판 번호를 담고 있어, 38번을 누르면 화면엔 "다크암스타"인데 스니커덩크는
 *    "상냥한 나인테일"을 준다 — 27장이 통째로 그렇다(2026-08-07 전수 확인).
 *    옛 세트는 일본판이 원조라 영문판과 번호 매김이 달라서다.
 *
 * 판정은 **포켓몬 이름이 잡힐 때만** 한다. 트레이너·굿즈는 두 데이터의 표기가 갈려
 * ("탈력감가드" ↔ "위크커버") 멀쩡한 카드를 버리게 된다. 확신이 없으면 null을
 * 돌려주고, 부르는 쪽은 그대로 받아들인다 — 값을 못 보여 주는 손해보다 낫다.
 *
 * @returns true 같은 포켓몬 · false 다른 포켓몬 · null 판정 못 함
 */
let 포켓몬한글목록: string[] | null = null;
export async function 같은카드인가(우리한글: string, 마켓한글: string): Promise<boolean | null> {
  if (!우리한글 || !마켓한글) return null;
  if (!포켓몬한글목록) {
    try {
      const m = await import('../data/pokemonNames.json');
      포켓몬한글목록 = (m.default as { ko?: string }[])
        .map((p) => p.ko ?? '')
        .filter((s) => s.length >= 2)
        // 긴 이름을 먼저 본다 — "이상해꽃"이 "이상해"보다 앞서야 한다.
        .sort((a, b) => b.length - a.length);
    } catch {
      return null;
    }
  }
  // ⚠️ **첫 포켓몬 하나만** 보면 태그팀 카드를 잘못 버린다. SM12a 184는 우리 이름이
  //    "루카리오&멜메탈 GX"인데(원본 데이터가 오염됐다 — 사진도 실제 카드도 멜메탈GX
  //    한 장이다), 마켓은 "멜메탈GX"라 첫 포켓몬끼리는 어긋난다. 양쪽에서 포켓몬을
  //    모두 찾아 **하나라도 겹치면** 같은 카드로 본다(2026-08-07).
  const 모두찾기 = (s: string) => {
    const 찾음: string[] = [];
    let 남은 = s;
    for (const n of 포켓몬한글목록!) {
      if (남은.includes(n)) {
        찾음.push(n);
        // 찾은 자리는 지운다 — "리자몽"을 세고 나서 "리자드"를 또 세면 안 된다.
        남은 = 남은.split(n).join(' ');
      }
    }
    return 찾음;
  };
  const 우리 = 모두찾기(우리한글);
  const 저쪽 = 모두찾기(마켓한글);
  if (!우리.length || !저쪽.length) return null;
  return 우리.some((n) => 저쪽.includes(n));
}
