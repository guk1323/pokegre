import { useCallback, useEffect, useRef, useState } from 'react';
import { 은는 } from '../lib/josa';
import { 시트가스스로닫힘 } from '../lib/sheetHistory';
import { CardImg } from './CardImg';
import { trackEvent } from '../api/localStats';
import { warmNameDict } from '../lib/nameDict';
import { koName } from '../lib/koCardName';
import { 레어도떼기, 레어도맞나, 레어도한글, 마켓전용말떼기 } from '../lib/rarityCode';
import { SearchSuggestions } from './SearchSuggestions';
import { CardScanButton } from './CardScanButton';

// 팝수(감정 수량) 조회.
//
// 왜 따로 만들었나: 카드 상세에 붙는 요약은 PSA 10·9·전체 셋뿐이라, 전체가 4,000장인데
// 10등급 2,000·9등급 1,000이면 **나머지 1,000장이 어디 갔는지 알 수 없다**(사장님 지적
// 2026-08-07). 여기서는 감정기관 넷(PSA·BGS·CGC·SGC)의 등급을 반칸까지 하나도 빠짐없이
// 보여 준다.
//
// ⚠️ 등급표는 카드 상세와 달리 **볼 때 받아 온다**. 기계가 512MB뿐이라 카드 58,000장의
//    등급표를 통째로 들고 있을 수 없다. 한 장에 2크레딧이고, 일부러 찾아본 카드에만
//    나가므로 낭비가 없다.

interface 찾은카드 {
  /** 감정 수량. 도감에서 찾을 때 같이 온다 — 목록을 세우는 잣대이자 화면에 적는 숫자다. */
  population?: { all?: number } | null;
  tcgPlayerId: string;
  name: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  imageUrl: string;
  // ⚠️ 저쪽 `search`는 세트 이름까지 뒤져서 엉뚱한 카드가 같이 올라온다("Bulbasaur"를 찾으면
  //    「Intro Pack (Bulbasaur)」 세트의 포션·에너지까지). 서버가 대조표로 확인해 **세트 목록에
  //    있는 카드를 위로** 올려 준다. 화면에 따로 적지는 않는다 — 방문자에겐 "우리 것/저쪽 것"이
  //    아무 뜻도 없고, 애초에 목록을 채워서 없어져야 할 구분이다(2026-08-09 사장님 지적).
  우리세트?: string | null;
  우리번호?: string | null;
}
interface 기관자료 {
  total: number;
  gem?: number;
  g: Record<string, number>;
}
interface 상세 {
  all: number;
  gems?: number;
  byGrader: Record<string, 기관자료>;
  updatedAt?: string;
}

// 보여 줄 순서. 높은 등급부터 내려간다 — 사람이 궁금한 건 10등급이 몇 장인지다.
// 반칸(9.5·8.5…)까지 넣는 이유는 BGS·CGC가 반칸을 실제로 쓰기 때문이다.
const 등급순서 = [
  'perfect', 'pristine', 'g10', 'g9_5', 'g9', 'g8_5', 'g8', 'g7_5', 'g7', 'g6_5', 'g6',
  'g5_5', 'g5', 'g4_5', 'g4', 'g3_5', 'g3', 'g2_5', 'g2', 'g1_5', 'g1', 'auth', 'qualifiers',
];
const 등급이름 = (k: string): string => {
  if (k === 'perfect') return '10 퍼펙트';
  if (k === 'pristine') return '10 프리스틴';
  if (k === 'auth') return '진품만';
  if (k === 'qualifiers') return '조건부';
  const m = k.match(/^g(\d+)(_5)?$/);
  if (!m) return k;
  return m[2] ? `${m[1]}.5` : m[1];
};
// 감정기관 표시 순서. PSA가 가장 많이 쓰이니 먼저 둔다.
const 기관순서 = ['PSA', 'BGS', 'CGC', 'SGC'];

// 저쪽(PPT)이 주는 이름은 **영문에 번호 꼬리가 붙어** 온다("M Charizard EX - 091/087").
// 그대로 쓰면 ① 사이트 다른 화면은 한글인데 여기만 영어이고 ② 바로 아래 줄에 번호를
// 또 적으므로 **같은 번호가 두 번** 나온다(2026-08-07 화면 확인).
// koName이 번호 꼬리를 떼고 한글로 바꿔 준다 — 사이트 전체가 쓰는 그 한 벌이다.
const 보일이름 = (판: 'japanese' | 'english', name: string) => koName(판 === 'japanese' ? 'ja' : 'en', name);
export function PopulationView({ 처음카드 }: { 처음카드?: { id: string; lang?: string } | null }) {
  const [말, set말] = useState('');
  const [판, set판] = useState<'japanese' | 'english'>('japanese');
  const [결과, set결과] = useState<찾은카드[] | null>(null);
  // 저쪽이 주는 최대치에 걸려 잘렸나(잘리면 값이 낮은 카드가 안 온다).
  const [잘림, set잘림] = useState(false);
  // 뒤에 붙은 레어도로 좁혔을 때 그 코드(화면에 알려 준다).
  const [좁힌레어도, set좁힌레어도] = useState('');
  // 뒤에 레어도를 쳤는데 받아 온 목록에 하나도 없을 때 그 코드(왜 전체가 나오는지 알린다).
  const [못찾은레어도, set못찾은레어도] = useState('');
  // 저쪽이 모르는 말(":1ED")을 빼고 찾았을 때 그 말. 빈 화면 대신 알려 주려는 것이다.
  const [뺀말, set뺀말] = useState('');
  // 처음 들어왔을 때 보여 줄 **실제 카드**(홈의 신팩 힛카드를 그대로 쓴다).
  // ⚠️ 세트 이름 대조표(`pptSetKoMany`)를 태우던 자리다. 2026-08-13에 찾기를 도감으로
  //    바꾸면서 **세트 이름이 이미 우리 한글로 온다** — 더 바꿀 것이 없어 뺐다.
  // 찾는 중 표시. ⚠️ 「찾기」 단추를 없앤 뒤로는 **이 한 줄이 유일한 신호**다 —
  //    단추가 「찾는 중…」으로 바뀌던 것을 대신한다.
  const [찾는중, set찾는중] = useState(false);
  const [고른것, set고른것] = useState<찾은카드 | null>(null);
  const [자료, set자료] = useState<상세 | null>(null);
  const [자료받는중, set자료받는중] = useState(false);
  const [오류, set오류] = useState<string | null>(null);
  // 자동완성(우리 파일에서 뽑는 이름 목록). 홈 검색창과 같은 부품·같은 목록을 쓴다.
  const [추천, set추천] = useState<string[]>([]);
  const [추천열림, set추천열림] = useState(false);
  const [추천고른줄, set추천고른줄] = useState(-1);
  const 마지막요청 = useRef(0);

  const 등급표받기 = useCallback((id: string, lang?: string) => {
    const 표 = ++마지막요청.current;
    set자료(null);
    set자료받는중(true);
    set오류(null);
    fetch(`/api/local/population-detail?id=${encodeURIComponent(id)}${lang ? `&lang=${lang}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { detail: 상세 | null; card?: 찾은카드 | null } | null) => {
        if (표 !== 마지막요청.current) return;
        set자료(j?.detail ?? null);
        set자료받는중(false);
        // ⚠️⚠️ **어느 카드의 표인지 화면에 세운다.** 카드 상세에서 「자세히 →」로 들어오면
        //    번호만 들고 오므로 예전에는 표만 덩그러니 뜨고 **무슨 카드인지 한 줄도
        //    없었다**(사장님 지적 2026-08-13). 서버가 같이 보내 주는 카드를 여기서 세운다.
        // ⚠️ 이미 고른 카드가 있으면 안 덮는다 — 찾기로 고른 카드는 그쪽이 주인이다.
        set고른것((전) => 전 ?? (j?.card ? { ...j.card, rarity: '' } : null));
        if (j?.detail) trackEvent('population_detail');
      })
      .catch(() => {
        if (표 !== 마지막요청.current) return;
        set자료받는중(false);
        set오류('등급표를 불러오지 못했습니다.');
      });
  }, []);

  // 카드 상세에서 "전체 등급 보기"로 들어온 경우, 그 카드를 바로 연다.
  useEffect(() => {
    if (!처음카드?.id) return;
    if (처음카드.lang === 'english' || 처음카드.lang === 'japanese') set판(처음카드.lang);
    등급표받기(처음카드.id, 처음카드.lang);
  }, [처음카드, 등급표받기]);

  // ⚠️ **찾을 말과 판(일본/북미)을 인자로 받는다.** 상태를 읽어 쓰면, 판을 눌러 바꾼
  //    바로 그 순간에는 아직 옛 판이 들어 있어 한 박자 늦은 결과가 나온다.
  const 찾기실행 = async (친것0: string, 그판: 'japanese' | 'english') => {
    // ⚠️ **스니커덩크 전용 꼬리말을 먼저 뗀다.** ":1ED"(초판)는 저쪽(PPT)이 모르고,
    //    그대로 보내면 0장이 온다. 시세 화면과 같은 방식이다(2026-08-08).
    //    레어도보다 먼저 떼야 "거북왕 EX RR :1ED"에서 레어도(RR)까지 제대로 잡힌다.
    const { 이름: 저쪽말뺀것, 뗀말 } = 마켓전용말떼기(친것0);
    const { 이름: 친것, 코드: 레어도 } = 레어도떼기(저쪽말뺀것);
    // ⚠️ 레어도만 쳤을 때. 저쪽에는 레어도로 물어보는 방법이 없다 — 그냥 보내면
    //    이름에 그 글자가 든 카드가 잔뜩 온다. 무엇을 더 쳐야 하는지 알려 준다.
    if (!친것 && 레어도) {
      set찾는중(false);
      set오류(`'${레어도}'만으로는 찾을 수 없습니다. 카드 이름을 같이 쳐 주세요 (예: 리자몽 ${레어도}).`);
      return;
    }
    if (친것.length < 2) return;
    set추천열림(false);
    set찾는중(true);
    set오류(null);
    set결과(null);
    set잘림(false);
    set좁힌레어도('');
    set못찾은레어도('');
    set뺀말(뗀말);
    set고른것(null);
    set자료(null);
    // ⚠️⚠️ **우리 도감에서 찾는다**(2026-08-13에 갈아엎었다). 시세 검색과 같은 길이다.
    //    예전에는 저쪽(PPT)에 물어봤는데, 재 보니 이랬다:
    //      · **한 번에 200크레딧** (실측 198,260 → 198,059). 하루치 20만이니 천 번이면 끝난다.
    //      · **200장에서 잘렸다** — 「피카츄」는 실제로 338장이다.
    //      · **한글로는 못 찾았다** — 사전으로 영문으로 바꿔 보냈고, 사전에 없으면 빈손이었다.
    //      · 이름·세트가 저쪽 표기 그대로였다(「M Charizard EX - 091/087」).
    //    그런데 **감정 수량은 이미 우리 파일에 다 있다**(19,342장). 저쪽에 물을 이유가 없었다.
    //    도감에 있는 것이 19,334장(100.0%)이라 잃는 것은 8장뿐이다.
    // ⚠️ 이 응답에는 **감정 수량이 이미 들어 있다** — 여기서 걸러 쓴다(따로 안 부른다).
    fetch(`/api/local/card-board?q=${encodeURIComponent(친것)}&lang=${그판 === 'english' ? 'english' : 'japanese'}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('찾지 못했습니다.');
        return r.json();
      })
      .then((j: { cards: (찾은카드 & { population?: { all?: number } | null })[]; 잘림?: number }) => {
        // ⚠️⚠️ **감정 수량이 있는 카드만 낸다.** 없는 카드를 목록에 두면 눌러 봐야
        //    「기록 없습니다」라, 방문자에게는 헛걸음이다. 팝수 화면의 일은 값이
        //    **있는** 것을 보여 주는 것이다.
        const 전부 = (j.cards ?? [])
          .filter((c) => (c.population?.all ?? 0) > 0)
          // 감정 많은 순. 많이 감정된 카드가 대개 사람들이 찾는 그 카드다.
          .sort((a, b) => (b.population?.all ?? 0) - (a.population?.all ?? 0));
        // ⚠️ 레어도로 걸러 **0장이 되면 거르지 않은 목록을 보여 준다.** 빈 화면을 주면
        //    그 카드를 우리가 아예 안 다루는 줄 안다. 대신 왜 안 걸러졌는지 적는다.
        const 걸러진 = 레어도
          ? 전부.filter((c) => 레어도맞나(레어도, c.rarity))
          : 전부;
        const 쓸것 = 레어도 && 걸러진.length === 0 ? 전부 : 걸러진;
        set좁힌레어도(레어도 && 걸러진.length > 0 ? 레어도 : '');
        set못찾은레어도(레어도 && 걸러진.length === 0 ? 레어도 : '');
        set결과(쓸것);
        // 천장(2,000장)에 걸렸을 때만 「잘렸다」. 예전 200장 상한과 달리 진짜 카드
        // 이름으로는 걸릴 일이 없다(「ex」처럼 이름이 아닌 말만 걸린다).
        set잘림(Boolean(j.잘림) && 쓸것 === 전부);
        // ⚠️ 세트 이름은 이미 우리 한글이다(도감에서 왔다) — 대조표를 안 태운다.
        set찾는중(false);
        trackEvent('population_search');
      })
      .catch((err: Error) => {
        set찾는중(false);
        set오류(err.message);
      });
  };

  const 찾기 = (e?: React.FormEvent) => {
    e?.preventDefault();
    void 찾기실행(말, 판);
  };

  // ⚠️⚠️ **치는 대로 찾는다 — 「찾기」 단추를 없앴다**(사장님 지시 2026-08-13:
  //    "홈화면이랑 같은 맥락으로"). 홈 검색창과 **같은 250ms**를 기다렸다 보낸다.
  //    예전에는 단추를 눌러야 찾았다. 까닭은 **한 번에 200크레딧**이 나갔기 때문인데,
  //    이제 우리 도감을 읽어 **0크레딧**이라 그 까닭이 사라졌다.
  // ⚠️ 카드를 이미 골라 등급표를 보고 있으면 안 건드린다 — 글자가 그대로 남아 있다고
  //    보던 표를 뒤에서 갈아엎으면 안 된다.
  const 마지막친말 = useRef('');
  useEffect(() => {
    const 친것 = 말.trim();
    if (친것.length < 2) return;
    if (고른것) return;
    if (마지막친말.current === `${판}:${친것}`) return;
    const t = setTimeout(() => {
      마지막친말.current = `${판}:${친것}`;
      void 찾기실행(친것, 판);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [말, 판, 고른것]);

  // ⚠️⚠️ **카드를 열면 뒤로가기로 닫힌다.**
  //    이게 없으면 목록에서 카드를 누른 뒤 뒤로가기가 **홈으로 튕겼다**(사장님 지적
  //    2026-08-13, 실측으로 재현). 등급표는 주소가 안 바뀌는 화면 안 상태라, 뒤로가기가
  //    「팝수 화면에 들어오기 전」으로 한 칸에 건너뛰었기 때문이다.
  //    시세 화면은 카드가 **시트**(`DetailSheet`)로 열려 그 부품이 같은 일을 해 준다 —
  //    팝수는 등급표를 화면 안에 그대로 그리므로 여기서 직접 한다. **방식은 똑같다.**
  // ⚠️ 되돌아가는 칸에는 「카드를 열기 전」 화면 상태가 적혀 있어, App이 그걸 복원하면
  //    그 사이 바뀐 것이 되돌아간다. 그래서 표식을 세워 그 복원만 건너뛴다
  //    (`lib/sheetHistory.ts` — DetailSheet가 쓰는 것과 같은 표식이다).
  useEffect(() => {
    // ⚠️⚠️ **목록에서 고른 카드일 때만** 건다(`결과`가 있을 때). 카드 상세의 「자세히 →」로
    //    바로 들어온 경우(`?id=`)에는 **돌아갈 목록이 없다** — 그때 이걸 걸면 뒤로가기가
    //    빈 팝수 화면에 사람을 세워 둔다. 왔던 카드로 나가는 게 맞다(실측으로 잡았다).
    //    「← 찾은 목록으로」 단추를 `결과`가 있을 때만 내는 것과 **같은 잣대**다.
    if (!고른것 || !결과) return;
    const 닫기 = () => {
      set고른것(null);
      set자료(null);
    };
    window.history.pushState({ sheet: true }, '');
    window.addEventListener('popstate', 닫기);
    return () => {
      window.removeEventListener('popstate', 닫기);
      if (window.history.state?.sheet) {
        시트가스스로닫힘.on = true;
        window.history.back();
      }
    };
  }, [고른것, 결과]);

  // ⚠️ **판을 바꾸면 다시 찾는다.** 예전엔 일본판/영문판을 눌러도 화면에 그대로 옛
  //    결과가 남아 있어서, 판을 바꾼 줄 알고 보다가 반대쪽 카드를 보게 됐다.
  //    찾은 게 없으면(처음 들어왔거나 카드 상세에서 넘어온 경우) 토글만 바꾼다.
  const 판바꾸기 = (p: 'japanese' | 'english') => {
    if (p === 판) return;
    set판(p);
    if (말.trim().length >= 2) void 찾기실행(말, p);
  };

  // 자동완성. **크레딧이 안 든다** — 우리 사전에서 찾는다.
  // ⚠️ 2026-08-08부터 우리 서버(/api/local/rarity-terms)에서 낱말을 한 번 더 받아 온다.
  //    검색창을 처음 누를 때 한 번뿐이고, 우리 서버라 크레딧·저쪽 호출과는 무관하다.
  //    (예전 주석은 "밖으로 안 나간다"였는데 이제 사실이 아니라 고쳤다.)
  // 진짜 조회(200크레딧)는 고르거나 엔터했을 때만 나간다.
  useEffect(() => {
    const 친것 = 말.trim();
    if (!친것) {
      set추천([]);
      return;
    }
    set추천고른줄(-1);
    let 취소 = false;
    void import('../lib/localSuggestions').then((m) => {
      if (!취소) set추천(m.getLocalSuggestions(친것, 8));
    });
    return () => {
      취소 = true;
    };
  }, [말]);

  // ⚠️ **처음 화면이 비어 있으면 뭘 하는 자리인지 모른다.** 도감 화면들은 들어가자마자
  //    목록이 보이는데 여기만 검색칸 하나뿐이라 본문이 174px밖에 안 됐다(2026-08-08).
  //    ① 처음엔 글자 알약(인기 검색어)을 뒀는데 **아무 정보가 없어 밋밋했다**.
  //    ② 홈의 **신팩 힛카드**를 썼더니 **갓 나온 세트는 감정된 카드가 없었다**.
  //    ③ **발매 1년 지난 세트의 힛카드**로 바꿨는데 이것도 틀렸다 — 그건 **시세** 기준이라
  //       감정 수량과 아무 상관이 없다. 사장님 지적(2026-08-11)대로 **12장 전부**
  //       「등급 매물 없음」이 떴다(실측). 게다가 그림 주소가 죽은 카드까지 섞였다(403).
  //    → **우리가 실제로 가진 팝수 자료에서** 감정 수량이 많은 순으로 고른다
  //      (`/api/local/population-samples`). 팝수 화면의 맛보기는 팝수가 있는 카드여야 한다.
  //      서버에 담긴 자료라 크레딧이 안 든다.
  // ⚠️ (없앰) 맛보기 12장을 받아 오던 자리(`/api/local/population-samples`).
  //    2026-08-13에 그 블록을 빼면서 같이 없앴다 — 화면이 안 쓰는 것을 받아 올 이유가 없다.
  //    ⚠️ 서버 엔드포인트는 **남겨 뒀다**. 되살릴 때 쓴다(위 없앰 설명 참고).


  const 추천고르기 = (term: string) => {
    set말(term);
    set추천열림(false);
    void 찾기실행(term, 판);
  };

  const 카드고르기 = (c: 찾은카드) => {
    set고른것(c);
    등급표받기(c.tcgPlayerId, 판);
  };

  const 기관들 = 자료 ? 기관순서.filter((g) => 자료.byGrader[g]) : [];
  // 문서에 없는 기관이 오면 뒤에 붙인다(빠뜨리는 것보다 낫다).
  const 나머지기관 = 자료 ? Object.keys(자료.byGrader).filter((g) => !기관순서.includes(g)) : [];
  const 볼기관 = [...기관들, ...나머지기관];
  // 실제로 값이 있는 등급만 줄로 만든다. 20여 칸이 다 뜨면 빈칸이 표를 뒤덮는다.
  const 쓸등급 = 자료
    ? 등급순서.filter((k) => 볼기관.some((g) => (자료.byGrader[g]?.g[k] ?? 0) > 0))
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      {/* ⚠️ **머리를 카드 한 장처럼 짠다**(사장님 지시 2026-08-11 — "너무 텅텅빈 느낌").
          예전엔 제목·설명 두 줄 뒤에 곧장 흰 여백이라, 검색 전 화면이 비어 보였다.
          제목 옆에 **팝수가 무엇인지**를 짧게 붙이고, 아래에 읽는 법 세 칸을 둔다. */}
      <div className="rounded-2xl border border-neutral-200 bg-gradient-to-b from-neutral-50 to-white p-5">
        <h1 className="text-lg font-bold text-black">팝수 조회</h1>
        <p className="mt-1 text-sm text-neutral-600">
          감정 기관이 이 카드에 매긴 등급이 각각 몇 장인지 전부 보여 드립니다. <b className="text-neutral-800">10등급이
          적을수록 구하기 어려운 카드</b>입니다.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            ['전체 장수', '지금까지 감정받은 총 장수입니다. 적을수록 귀합니다.'],
            ['10등급 비율', '전체 중 만점을 받은 비율. 낮을수록 만점 받기 어려운 카드입니다.'],
            ['기관별 표', 'PSA·BGS·CGC·SGC가 매긴 등급을 반칸(9.5)까지 빠짐없이 봅니다.'],
          ].map(([제목, 설명]) => (
            <div key={제목} className="rounded-xl bg-white/70 p-3 ring-1 ring-neutral-200/70">
              <p className="text-xs font-bold text-neutral-800">{제목}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{설명}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ⚠️ **도감 화면들과 같은 뼈대로 맞춘다.** 예전엔 [판][검색칸][찾기]가 한 줄이라
          핸드폰에서 입력칸이 146px밖에 안 되어 안내문이 잘렸다(2026-08-08 실측).
          세트 화면처럼 **검색칸을 전체 폭으로 쓰고 판 고르기는 그 아래**에 둔다. */}
      <form onSubmit={찾기} className="mt-4">
        {/* ⚠️ `items-start` — 자동완성 목록이 입력칸 아래로 겹쳐 뜨느라 감싼 div가 길어진다.
            기본값(stretch)이면 옆의 사진 단추가 그만큼 같이 늘어난다. */}
        <div className="flex items-start gap-2">
        {/* 자동완성 목록이 입력칸 바로 아래에 겹쳐 떠야 해서 감싼다. */}
        <div className="relative min-w-0 flex-1">
          <input
            value={말}
            onChange={(e) => {
              set말(e.target.value);
              set추천열림(true);
            }}
            onFocus={() => {
              warmNameDict();
              set추천열림(true);
            }}
            // 목록의 버튼은 onMouseDown을 막아 두어 이 blur보다 클릭이 먼저 처리된다.
            onBlur={() => set추천열림(false)}
            onKeyDown={(e) => {
              // ⚠️ **한글을 조합하는 중에는 손대지 않는다.** 아직 안 끝난 글자 위에서
              //    엔터·방향키를 가로채면 그 글자가 한 번 더 들어가거나 깨진다
              //    (홈 검색창에서 실제로 "리자몽"이 "리자몽몽"이 됐다 · 2026-08-10).
              if (e.nativeEvent.isComposing) return;
              if (!추천열림 || 추천.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                set추천고른줄((i) => (i + 1) % 추천.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                set추천고른줄((i) => (i <= 0 ? 추천.length - 1 : i - 1));
              } else if (e.key === 'Escape') {
                set추천열림(false);
              } else if (e.key === 'Enter' && 추천고른줄 >= 0) {
                // 방향키로 고른 줄이 있으면 그걸로 찾는다(폼 제출은 막는다).
                e.preventDefault();
                추천고르기(추천[추천고른줄]);
              }
            }}
            placeholder="카드 이름. 예: 리자몽, Charizard"
            aria-label="카드 이름으로 찾기"
            role="combobox"
            aria-expanded={추천열림 && 추천.length > 0}
            aria-controls="search-suggestions"
            autoComplete="off"
            // ⚠️⚠️ **홈 검색바와 치수를 똑같이 맞춘다**(사장님 지시 2026-08-13:
            //    "사진으로 찾기가 검색바랑 위치나 높이 일치해야지").
            //    `py-3` + `text-sm` + 테두리 = **46px**이고, 그게 `CardScanButton`의
            //    `h-[46px]`와 같은 값이다. 예전엔 `py-2`(38px)라 옆 단추만 8px 더 컸다.
            //    ⚠️ 둘 중 하나를 고치면 다른 쪽도 봐야 한다 — 높이를 정하는 자리가 둘이다.
            className="w-full rounded-xl border border-neutral-300 bg-white py-3 pl-3 pr-10 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
          />
          {/* 검색어가 있을 때만 오른쪽 끝에 지우기(X). **홈 검색바와 같은 부품·같은 크기**다
              (`components/SearchBar.tsx`). 보이는 동그라미는 24px 그대로 두고 누를 자리만
              44px로 넓힌다 — 24px은 손가락으로 놓치기 쉽다.
              ⚠️ `onMouseDown`으로 blur를 막는다. 안 막으면 자동완성이 닫히는 동작과 겹쳐
                 클릭이 씹힌다(홈에서 겪은 그대로다). */}
          {말 && (
            <button
              type="button"
              aria-label="검색어 지우기"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                set말('');
                set추천열림(false);
                set결과(null);
                set고른것(null);
                set자료(null);
                set오류(null);
              }}
              className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 before:absolute before:-inset-2.5 before:content-['']"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {추천열림 && (
            <SearchSuggestions items={추천} active={추천고른줄} onSelect={추천고르기} />
          )}
        </div>
          {/* 사진으로 찾기 — 시세 화면과 **같은 부품**을 쓴다(사장님 지시 2026-08-11).
              팝수는 "내 카드가 몇 장이나 있나"를 보는 곳이라 사진으로 들어오는 게 자연스럽다.
              ⚠️ 스캔이 판(일/영문)까지 읽어 주므로 판 토글도 같이 맞춘다 — 안 맞추면
                 일본판 카드를 찍었는데 영문판에서 0장이 나온다. */}
          <CardScanButton
            onResult={({ result }) => {
              const ed = result.edition === 'english' ? 'english' : 'japanese';
              const 번호 = result.cardNumber;
              // 번호를 읽었으면 "이름 번호"로 좁히고, 못 읽었으면 이름만으로 후보를 낸다.
              const 말2 = [result.pokemonNameEn ?? '', 번호 ?? ''].filter(Boolean).join(' ').trim();
              if (!말2) return;
              set판(ed);
              set말(말2);
              set추천열림(false);
              void 찾기실행(말2, ed);
            }}
          />
        </div>

        {/* 판 고르기는 검색칸 **아래**에 둔다(세트 화면과 같은 자리). */}
        <div className="mt-2 flex w-fit overflow-hidden rounded-lg border border-neutral-300">
          {(['japanese', 'english'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => 판바꾸기(p)}
              className={`px-3 py-1.5 text-sm font-semibold ${
                판 === p ? 'bg-black text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {p === 'japanese' ? '일본판' : '영문판'}
            </button>
          ))}
        </div>
      </form>

      {찾는중 && <p className="mt-3 text-sm text-neutral-400">찾는 중…</p>}
      {오류 && <p className="mt-3 text-sm text-amber-600">{오류}</p>}

      {/* ⚠️⚠️ (없앰) **「이런 카드의 팝수를 볼 수 있습니다」 맛보기 12장.** 2026-08-13에 뺐다.
          까닭 — **눌러도 그 카드가 안 열렸다.** 카드 이름을 검색어에 넣고 이름으로 다시
          찾는 방식이라, 「메가리자몽 X ex - 023」처럼 꼬리표가 붙은 이름은 그대로 들어가
          **「카드가 없습니다」가 떴다**(실측). 그림 12장이 첫 화면을 통째로 먹으면서
          누르면 빈손이 나는 자리였다(사장님 지적: "굳이 꺼내둬야 하는지 모르겠네").
          ⚠️ 되살리려면 **이름이 아니라 그 카드를 바로 열어야 한다** — 서버가 주는
             `population-samples`에 `id`가 들어 있으니 `등급표받기(id, 판)`을 부르면 된다.
             이름으로 다시 찾는 방식으로는 되살리지 말 것. */}

      {결과 && !고른것 && (
        <div className="mt-4">
          {결과.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-400">'{말.trim()}'로 찾은 카드가 없습니다.</p>
          ) : (
            <>
            {/* ⚠️ 저쪽이 한 번에 주는 최대치(200장)에 걸리면 **그게 전부가 아니다.**
                값이 높은 순으로 받으므로 잘린 쪽은 싼 카드다. "N장을 찾았습니다"라고만
                적으면 그게 전종인 줄 알게 된다(2026-08-07 점검에서 확인 — 피카츄가
                딱 100장으로 잘려 있었다). */}
            <p className="mb-1.5 text-xs text-neutral-500">
              {뺀말
                ? `'${뺀말}'는 SNKRDUNK에서만 됩니다. 빼고 찾아 ${결과.length}장입니다.`
                : 좁힌레어도
                ? `${좁힌레어도} 카드 ${결과.length}장입니다. 누르면 등급표를 봅니다.`
                : 못찾은레어도
                  ? `'${못찾은레어도}' 카드가 없어 전체 ${결과.length}장을 보여 드립니다${잘림 ? ' (값이 높은 순)' : ''}.`
                  : 잘림
                    ? `이름에 맞는 카드가 많아 값이 높은 ${결과.length}장만 보여 드립니다. 이름을 더 자세히 치면 좁혀집니다.`
                    : `감정 기록이 있는 카드 ${결과.length}장입니다. 누르면 등급표를 봅니다.`}
            </p>
            <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
              {결과.map((c) => (
                <li key={c.tcgPlayerId}>
                  <button
                    type="button"
                    onClick={() => 카드고르기(c)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50"
                  >
                    <div className="h-12 w-9 flex-shrink-0 overflow-hidden rounded bg-neutral-100">
                      {c.imageUrl && <CardImg src={c.imageUrl} alt={c.name} className="h-full w-full object-contain" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-neutral-800">{보일이름(판, c.name)}</p>
                      <p className="truncate text-[11px] text-neutral-400">
                        {c.setName}
                        {c.cardNumber ? ` · ${c.cardNumber}` : ''}
                        {c.rarity ? ` · ${레어도한글(c.rarity)}` : ''}
                      </p>
                    </div>
                    {/* ⚠️ **줄 세운 잣대를 적어 준다.** 감정 많은 순으로 세우는데 그 수가
                        화면에 없으면 순서가 뜬금없어 보인다. 여기가 팝수 화면이니
                        방문자가 제일 알고 싶은 숫자이기도 하다. */}
                    {(c.population?.all ?? 0) > 0 && (
                      <span className="flex-shrink-0 text-[11px] tabular-nums text-neutral-500">
                        {(c.population!.all as number).toLocaleString()}장
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      )}

      {/* ⚠️ **찾은 목록이 있을 때만 낸다.** 카드 상세의 「자세히 →」로 바로 들어오면
          돌아갈 목록이 아예 없는데 「← 찾은 목록으로」가 떠 있었다(2026-08-13).
          누르면 맛보기 카드들이 나와서, 보던 카드가 사라진 것처럼 보인다. */}
      {고른것 && 결과 && (
        <button
          type="button"
          onClick={() => {
            set고른것(null);
            set자료(null);
          }}
          className="mt-4 text-sm font-semibold text-neutral-500 hover:text-neutral-800"
        >
          ← 찾은 목록으로
        </button>
      )}

      {(고른것 || 처음카드) && (
        <div className="mt-3">
          {고른것 && (
            <div className="mb-3 flex items-center gap-3">
              <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-neutral-100">
                {고른것.imageUrl && (
                  <CardImg src={고른것.imageUrl} alt={고른것.name} className="h-full w-full object-contain" lazy={false} />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-black">{보일이름(판, 고른것.name)}</p>
                <p className="truncate text-xs text-neutral-400">
                  {고른것.setName}
                  {고른것.cardNumber ? ` · ${고른것.cardNumber}` : ''}
                </p>
              </div>
            </div>
          )}

          {자료받는중 && <p className="py-10 text-center text-sm text-neutral-400">등급표를 불러오는 중…</p>}

          {!자료받는중 && !자료 && (
            <p className="py-10 text-center text-sm text-neutral-400">
              {/* ⚠️ **어느 카드인지 밝힌다.** 그냥 "이 카드는"이라고만 적으면, 번호로 바로
                  들어온 사람은 무엇이 없다는 말인지 알 수가 없다(2026-08-13). */}
              {고른것
                ? `${보일이름(판, 고른것.name)}${은는(보일이름(판, 고른것.name))} `
                : '이 카드는 '}
              감정 기록이 없습니다. 아직 아무도 감정을 안 맡겼거나, 자료에 안 잡힌 카드입니다.
            </p>
          )}

          {자료 && (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-neutral-200 px-4 py-3">
                <div>
                  <span className="text-xs text-neutral-500">전체 </span>
                  <span className="text-base font-bold text-black">{자료.all.toLocaleString()}장</span>
                </div>
                {자료.gems != null && (
                  <div>
                    <span className="text-xs text-neutral-500">10등급 </span>
                    <span className="text-base font-bold text-black">{자료.gems.toLocaleString()}장</span>
                    <span className="ml-1 text-xs text-neutral-400">
                      ({Math.round((자료.gems / 자료.all) * 1000) / 10}%)
                    </span>
                  </div>
                )}
              </div>

              {/* 표가 좁은 화면에서 넘칠 수 있어 가로로만 밀리게 한다(본문은 안 밀린다). */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[320px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-neutral-500">
                      <th className="py-2 pr-2 text-left text-xs font-semibold">등급</th>
                      {볼기관.map((g) => (
                        <th key={g} className="px-2 py-2 text-right text-xs font-semibold">
                          {g}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {쓸등급.map((k) => {
                      const 최고 = k === 'g10' || k === 'pristine' || k === 'perfect';
                      return (
                        <tr key={k} className="border-b border-neutral-50">
                          <td className={`py-1.5 pr-2 text-left ${최고 ? 'font-bold text-black' : 'text-neutral-600'}`}>
                            {등급이름(k)}
                          </td>
                          {볼기관.map((g) => {
                            const n = 자료.byGrader[g]?.g[k] ?? 0;
                            return (
                              <td
                                key={g}
                                className={`px-2 py-1.5 text-right tabular-nums ${
                                  n === 0 ? 'text-neutral-300' : 최고 ? 'font-bold text-black' : 'text-neutral-700'
                                }`}
                              >
                                {n === 0 ? '—' : n.toLocaleString()}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-neutral-300">
                      <td className="py-2 pr-2 text-left text-xs font-semibold text-neutral-500">합계</td>
                      {볼기관.map((g) => (
                        <td key={g} className="px-2 py-2 text-right text-sm font-bold tabular-nums text-black">
                          {(자료.byGrader[g]?.total ?? 0).toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1 pr-2 text-left text-xs text-neutral-500">10등급 비율</td>
                      {볼기관.map((g) => (
                        <td key={g} className="px-2 py-1 text-right text-xs tabular-nums text-neutral-500">
                          {자료.byGrader[g]?.gem != null ? `${자료.byGrader[g].gem}%` : '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[11px] leading-snug text-neutral-400">
                PSA·BGS·CGC·SGC가 지금까지 매긴 등급의 장수입니다. 반칸(9.5 등)은 BGS·CGC가 씁니다.
                “진품만”은 등급 없이 진품 확인만 받은 것, “조건부”는 흠이 적혀 등급이 따로 표시된 것입니다.
                {자료.updatedAt ? ` 자료 기준 ${자료.updatedAt.slice(0, 10)}.` : ''}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
