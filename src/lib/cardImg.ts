// 카드 이미지 주소를 만드는 규칙만 모아 둔 파일. 사전을 하나도 안 가져온다.
//
// 왜 cardCatalog에서 떼어냈나: 첫 화면에 늘 붙어 있는 CardTile이 thumb() 하나 때문에
// cardCatalog를 가져왔는데, cardCatalog는 이름 사전 세 덩이(koreanizeTitle ·
// koreanizeEnglishTitle · packNames)를 통째로 끌고 온다. 그래서 첫 화면에 카드 이름이
// 하나도 안 나오는데도 109KB(gzip)를 미리 받고 있었다 — 사전을 "필요할 때" 받으려고
// 만든 nameDict.ts의 뜻이 이 한 줄 때문에 무너져 있었다.
//
// ⚠️ 여기에는 사전을 쓰는 것(koName·koSet 등)을 넣지 말 것. 하나라도 넣으면 다시
//    첫 화면으로 딸려 온다. cardCatalog가 이 파일을 다시 내보내므로, 쓰는 쪽 코드는
//    예전 그대로 cardCatalog에서 가져와도 된다.

// TCGdex는 베이스 주소라 /high.webp를 붙인다(low.webp는 245px라 320px 표시에서 뿌옇게
// 확대돼, 600px high를 받아 프록시가 선명하게 축소한다). 다른 소스는 완성된 주소 그대로.
// ⚠️ 화질 꼬리(/high.webp)는 **tcgdex 꼴 주소에만** 붙는다. scrydex는 주소 끝이
//    이미 화질 표시라(".../me5-15/small"), 꼬리를 붙이면 400이 된다(2026-08-07 확인).
//    지금 화면은 작가 표지에 thumb만 쓰고 있어 탈이 안 났지만, 누가 cardImg를 태우면
//    그 자리부터 깨진다. 붙일 곳이 아닌 주소는 그대로 둔다.
const 꼬리안붙임 = /images\.scrydex\.com/i;
export const cardImg = (base: string) =>
  !base
    ? ''
    : /\.(png|jpe?g|webp)(\?|$)/i.test(base) || 꼬리안붙임.test(base)
      ? base
      : `${base}/high.webp`;

// 썸네일은 원본(로고 127KB·박스 59KB)을 그대로 받으면 느리다. 무료 CDN(wsrv.nl)으로
// 필요한 크기의 WebP로 줄여 받는다(~5KB). w는 표시의 2배(레티나).
export const thumb = (url: string, w: number) => (url ? `/api/img?u=${encodeURIComponent(url)}&w=${w}` : '');

// 이미지가 아직 없는 카드(옛 프로모·트레이너킷 등)의 임시 대체. 빈 회색칸 대신
// "뒷면(이미지 준비 중)"을 보여줘 일관성을 지킨다.
export const CARD_BACK = '/card-back.svg';

// 스니덩크 사진은 경로로 갈린다(2026-08-07 눈으로 확인).
//  · /apparel_used_listings/ — **중고 매물 사진**이다. 담요 위에 비스듬히 놓고 찍은 것이라
//    공식 카드 그림이 아니다. 뒷면("이미지 준비 중")으로 대체한다.
//  · /upload_bg_removed/ — 배경을 지운 **정면 스캔**이다. 공식 렌더와 다를 바 없다.
//    옛 세트(e카드·PCG)에는 이것밖에 없는 카드가 66장 있는데, 통째로 막고 있어서
//    귀한 카드(리자몽☆·갸라도스☆)가 뒷면으로 나왔다.
// ⚠️ 아는 경로만 받아들인다. 새 경로가 생기면 어떤 사진인지 눈으로 보고 넣을 것 —
//    틀린 그림을 보여 주느니 빈칸이 낫다.
const 스니덩크쓸만함 = /cdn\.snkrdunk\.com\/upload_bg_removed\//i;
export const usable = (url?: string) =>
  !!url && (!url.includes('snkrdunk') || 스니덩크쓸만함.test(url));

// 미리 받아 둔 시세가 **언제 것인지** 한 줄로. 홈·세트 두 화면이 같이 쓴다.
//
// ⚠️ 이 값은 실시간이 아니다. 스크립트가 미리 받아 둔 것이라 며칠 묵는다
//    (2026-08-07 실측: 최신 세트 2.2일, 61세트 중간값 5.4일 전).
//    날짜를 안 적으면 홈에서 188만원을 보고 눌렀는데 상세가 124만원일 때
//    방문자가 왜 다른지 알 길이 없다 — 상세는 지금 값이라 다른 게 맞다.
// ⚠️ 두 화면이 **같은 함수**를 써야 한다. 한쪽만 고치면 같은 값을 두 화면이
//    다르게 설명하게 된다(NewSetHitCards의 basisLabel 주석과 같은 이유).
export const 기준일글 = (at?: number): string => {
  if (!at || !Number.isFinite(at)) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return ` · ${d.getMonth() + 1}.${d.getDate()} 기준`;
};

// 공유·탭 제목에 쓸 카드 이름. **한 곳에서만 정한다.**
//
// ⚠️ 예전엔 세 곳이 제각각이었다(2026-08-07 발견).
//      화면 큰 글씨   "메가레쿠쟈 ex MUR [M6 113/076]"        (괄호만 뗌)
//      탭 제목        "메가레쿠쟈 ex MUR"                     (둘 다 뗌)
//      공유 시트 제목  "메가레쿠쟈 ex MUR [M6 113/076](확장팩「…」)"  (원본 그대로)
//    링크를 받은 사람이 여는 화면 제목과 보낸 사람이 본 공유 제목이 달랐다.
//
// ⚠️ **괄호를 다 떼면 안 된다.** 뗄 것과 남길 것이 섞여 있다.
//      뗄 것  — 스니커덩크가 붙이는 팩 이름 "(확장팩「스칼렛ex」)"
//      남길 것 — 카드를 가르는 말 "(Delta Species)"·"(Master Ball Pattern)"
//                "(Alternate Art Secret)"·"(Mirror Holofoil)"
//    저쪽 카드 58,215장 중 6,499장이 뜻 있는 괄호로 끝난다.
//
// ⚠️ 서버(server/index.ts)도 이 함수를 가져다 쓴다. 두 벌로 두면 새로고침 전후로
//    탭 이름이 바뀐다.
const 뜻있는괄호 =
  /holo|reverse|mirror|delta|cosmos|master ball|pok[ée]? ?ball|shadowless|stamp|1st|full art|secret|prism|rainbow|pattern|jumbo|error|misprint|알?터네이트|델타|미러|리버스|마스터볼|몬스터볼/i;
export const 공유이름 = (title: string): string =>
  title
    .replace(/\s*\(([^()]*)\)\s*$/, (전체: string, 안: string) => (뜻있는괄호.test(안) ? 전체 : ''))
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .trim()
    .slice(0, 40);
