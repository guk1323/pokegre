/**
 * 카드 이름을 화면에 낼 때 **마지막으로 다듬는** 한 벌.
 * `koName`이 사전을 다 거친 뒤 여기를 지난다 — 서버와 화면이 같이 쓴다.
 *
 * 왜 따로 뒀나 — 사전(포켓몬·트레이너 이름)으로는 안 잡히는 것들이 있다.
 *   · 소유격 지명·인명   `Alto Mare's 네이티오` → `알토마레의 네이티오`
 *   · 표시 괄호         `(Pikachu Stamped)` → `(피카츄 스탬프)`
 *   · 조각 카드 위치     `(Top Left)` → `(좌상)`
 * 전부 2026-08-09에 사장님이 하나씩 확인해 확정한 것이다.
 *
 * ⚠️⚠️ **카드에 실제로 영문으로 찍힌 표식은 건드리지 않는다.** 한글로 바꾸면 틀린다 —
 *    `ex` `GX` `V` `VMAX` `VSTAR` `V-UNION` `BREAK` `LV.X` `GL` `LEGEND` `Prime`
 *    `SP` `FB` `Team Plasma` `CLL` `CLB` `AZ's` `HANDY910is` · 언어 표기 `(English)` 등.
 * ⚠️ 여기서 바꾼 이름이 **검색 재료**로도 쓰인다(gen-card-name-suggestions.mts).
 *    고치면 그 스크립트를 다시 돌려야 한글 검색에 반영된다.
 */

import { koreanizeEnglishCardName } from './koreanizeEnglishTitle.ts';
import { koSetName } from './setNameKo.ts';

/** 소유격으로 붙는 지명·인명. 사전에 없어 영문으로 남던 것들. */
const 소유격: Record<string, string> = {
  'Alto Mare': '알토마레',
  PokePark: '포켓파크',
  Forina: '포리나',
  Samiya: '사미야',
  Rota: '로타',
  Aura: '오라',
  Sea: '바다',
  Butler: '버틀러',
  May: '봄이',
  Kidd: '키드',
  Phantom: '팬텀',
  Oakley: '오클리',
  Ross: '로스',
  Annie: '애니',
  LaRousse: '라루스',
  Ilene: '아이린',
  Aaron: '아론',
  Shep: '셰프',
  Lizabeth: '리자베스',
  'Reverse World': '반전세계',
  'Real World': '리얼월드',
  'Icy Sky': '빙공',
  Master: '달인',
  Fennel: '주리비안',
  'Professor Oak': '오박사',
  Jackie: '재키',
  Influencer: '인플루언서',
  Manaphy: '마나피',
};

/** 괄호 안 표시말. 그림이 아니라 **글자로** 알려 주는 것이라 한글로 바꾼다. */
const 괄호말: Record<string, string> = {
  'Mirror Holofoil': '미러 홀로',
  'Top Left': '좌상',
  'Top Right': '우상',
  'Bottom Left': '좌하',
  'Bottom Right': '우하',
  Ivy: '아이비',
  'Base Set': '베이스 세트',
  Jungle: '정글',
  Italian: '이탈리아어판',
  Spanish: '스페인어판',
  German: '독일어판',
  French: '프랑스어판',
  Polish: '폴란드어판',
  Portuguese: '포르투갈어판',
  Jumbo: '점보',
  // ── 특별 상품에만 든 카드 — **어느 상품을 사야 나오는지** 적는다 ─────────────
  // ⚠️⚠️ 사장님 지시(2026-08-29): 「우린 특별세트를 따로 도감에 넣지않잖아, 그니까
  //    카드 옆에 괄호치고 세트 출처를 적어주는 방향」. 팩을 뜯어 나오는 카드가
  //    아니라는 것이 한눈에 보여야 한다 — 151 세트에 뮤 ex가 205번으로 두 장 뜨는데
  //    하나는 팩에서 나오고 하나는 박스를 사야 나온다.
  // ⚠️ 낱말은 「금속 카드」가 아니라 **「메탈 카드」**다(사장님 지적) — 수집가들이
  //    실제로 쓰는 말이고, 「금속」은 재질 설명처럼 들린다.
  // 출처는 전부 실제로 확인한 것이다(2026-08-29). 짐작해서 적지 말 것.
  '151 Metal Card': '울트라 프리미엄 컬렉션 메탈 카드',
  'Celebrations Metal Card': '셀러브레이션스 울트라 프리미엄 컬렉션 메탈 카드',
  'Metal Card': '울트라 프리미엄 컬렉션 메탈 카드',
  'GameStop Metal Card': '게임스탑 한정 메탈 카드',
  // 카드 종류·에너지 갈래를 괄호로 알려 주는 것 — 표식이 아니라 설명말이라 옮긴다.
  Special: '특수',
  Basic: '기본',
  Supporter: '서포트',
  Item: '굿즈',
  Stadium: '스타디움',
};

/** 낱말 그대로 바꾸는 것(사전이 못 잡는 굿즈·표시말). */
const 낱말: [RegExp, string][] = [
  [/\bTechnical Machine\b/g, '기술머신'],
  [/\bVictory Medal\b/g, '승리의 훈장'],
  // ⚠️ `Merchant`·`Fisher`는 **여기서 건드리지 않는다.** 이름 사전이 일부러
  //    `낚시꾼 (Fisher)`·`행상인 (Merchant)`로 적어 둔다 — `Fisherman`도 「낚시꾼」이라
  //    구분하려고 영문을 괄호에 남긴 것이다. 규칙을 또 걸면 `낚시꾼 (낚시꾼)`이 된다
  //    (2026-08-09에 실제로 그렇게 됐다).
  [/\bSpiky-eared\b/g, '뾰족귀'],
  [/\bSky-Splitting\b/g, '천공의'],
  [/\bTimeless\b/g, '시공을 초월한'],
  [/\bWish Maker\b/g, '소원을 비는 자'],
  [/\bTime Flower\b/g, '시간의 꽃'],
  [/\bSoul Dew\b/g, '마음의이슬'],
  [/\bScorching Charcoal\b/g, '타오르는 숯'],
  [/\bDrops in the Ocean\b/g, '바다의 물방울'],
  [/\bSun Seed\b/g, '태양의 씨앗'],
  [/\bWonder Platinum\b/g, '원더 플래티넘'],
  [/\bMichina Temple\b/g, '미시나 신전'],
  [/\bCore Memory\b/g, '코어 메모리'],
  [/\bPokemon Card Laboratory\b/g, '포켓몬 카드 연구소'],
  [/\bPokemon Card Fan\b/g, '포켓몬 카드 팬'],
  [/\bPokemon Center\b/g, '포켓몬센터'],
  [/\bTouch Generation Change!/g, '터치 세대교체!'],
  [/\bTouch Exchange!/g, '터치 교환!'],
  [/\bShopping\b/g, '쇼핑'],
  [/\becogym\b/gi, '에코짐'],
  [/\bImakuni\?/g, '이마쿠니?'],
  [/\bPok\s?egear 3\.0\b/g, '포켓몬기어3.0'],
  [/\bNidoran\s?F\b/g, '니드런♀'],
  [/\bNidoran\s?M\b/g, '니드런♂'],
  [/\bPP Up\b/g, 'PP맥스'],
  [/\bPowerful C Energy\b/g, '파워풀 무색 에너지'],
  [/\bHorror P Energy\b/g, '공포 초 에너지'],
  [/\bHeat R Energy\b/g, '히트 불꽃 에너지'],
  [/\bAlto Mare Cube\b/g, '알토마레 큐브'],
  [/\bProfessor Roawn\b/g, '마박사'],
  [/\bJacq\b/g, '클라벨'],
  [/\bMela\b/g, '멜로코'],
  [/\bNemona\b/g, '네모'],
  [/\bPicnicker\b/g, '피크닉걸'],
  [/\bYoungster\b/g, '반바지 어린이'],
  [/\bNest Ball\b/g, '네스트볼'],
  [/\bGreat Ball\b/g, '슈퍼볼'],
  [/\bPoke Ball\b/g, '몬스터볼'],
  [/\bElectric Generator\b/g, '일렉트릭제네레이터'],
  [/\bElectropower\b/g, '일렉트릭파워'],
  [/\bBug Catcher\b/g, '곤충채집소년'],
  [/\bPokemon Fan Club\b/g, '포켓몬애호가클럽'],
  [/\bBoss['’]s Orders\b/g, '보스의 지령'],
  [/\bDeck\b/g, '덱'],
  // ── 2026-08-09에 도감을 PPT로 갈아엎으며 새로 들어온 말들 ────────────────────
  // 전부 **괄호 안 표시말**이다 — 카드에 찍힌 표식이 아니라 「어떤 무늬/어떤 행사」인지
  // 글자로 알려 주는 것이라 한글로 바꾼다. 해마다 앞에 연도가 붙으므로(`2019 Unnumbered`)
  // 통째 대조가 아니라 낱말로 바꾼다.
  [/\bMaster Ball Pattern\b/g, '마스터볼 무늬'],
  [/\bPoke\s?Ball Pattern\b/g, '몬스터볼 무늬'],
  [/\bEnergy Symbol Pattern\b/g, '에너지마크 무늬'],
  [/\bCracked Ice Holo(?:foil)?\b/g, '크랙아이스 홀로'],
  [/\bCosmos (?:Holo(?:foil)?|Foil)\b/g, '코스모스 홀로'],
  [/\bRegional Championships\b/g, '지역 챔피언십'],
  [/\bPokemon League\b/g, '포켓몬 리그'],
  [/\bUnnumbered\b/g, '무번호'],
  [/\bAlternate Full Art\b/g, '얼터네이트 풀아트'],
  [/\bPlay!?\s*Pokemon\b/g, '플레이! 포켓몬'],
  [/\bCode Card\b/g, '코드 카드'],
  [/\bTV Reporter\b/g, 'TV 리포터'],
  [/\bCelebration Fanfare\b/g, '축하 팡파르'],
  [/\bBattle VIP Pass\b/g, '배틀 VIP 패스'],
  [/\bPokemon Enterprise\b/g, '포켓몬 엔터프라이즈'],
  [/\bProfessor['’]s Research\b/g, '박사의 연구'],
  [/\bPokedex\b/g, '포켓몬도감'],
  // `Powerful C`·`Horror P`·`Heat R`와 같은 갈래(글자 하나가 에너지 타입이다).
  // 대괄호 안 인물명 — 공식 한국 이름(2026-08-09 사장님 확인).
  [/\[Professor Sada\]/g, "[올림박사]"],
  [/\[Professor Turo\]/g, "[투로박사]"],
  [/\[Professor Juniper\]/g, "[주박사]"],
  [/\[Corbeau\]/g, "[비주기]"],
  [/\bSpeed L Energy\b/g, '스피드 번개 에너지'],
  [/\bHiding D Energy\b/g, '하이딩 악 에너지'],
  [/\bMirror Foil\b/g, '미러 홀로'],
  [/\bReverse Holofoil\b/g, '리버스 홀로'],
  [/\bLeague Promo\b/g, '리그 프로모'],
  [/\bPremium Collection\b/g, '프리미엄 컬렉션'],
  // ⚠️ **이 둘은 맨 끝이어야 한다.** 위에서 `Poke Ball Pattern`처럼 통째로 잡는 규칙이
  //    먼저 걸려야 하는데, `Poke Ball`이 이미 「몬스터볼」로 바뀐 뒤라 `몬스터볼 Pattern`이
  //    남는다(2026-08-09에 693장이 그랬다). 남은 낱말만 여기서 마저 옮긴다.
  [/\bPattern\b/g, '무늬'],
  [/\bHolofoil\b/g, '홀로'],
  [/\bElite Trainer Box\b/g, '엘리트 트레이너 박스'],
  [/\bBuild & Battle Box\b/g, '빌드 & 배틀 박스'],
  [/\bBuild & Battle Stadium\b/g, '빌드 & 배틀 스타디움'],
  // ⚠️ `Box`는 **이름 끝에 올 때만** 바꾼다. 그냥 낱말로 걸었더니 `Box of Disaster`
  //    (재앙의 상자)가 「박스 of Disaster」가 됐다 — 사전이 이름 전체로 찾는데
  //    앞 낱말을 먼저 바꿔 버려 못 찾게 된 것이다(2026-08-09).
  [/(\s)Box$/g, '$1박스'],
  // ── 대회 상품 표시 ──────────────────────────────────────────────────────────
  // 리그·챔피언십에서 상으로 준 카드는 **몇 등 상품인지가 이름에 찍힌다.** 값이 갈리는
  // 근거라 지우면 안 되고, 글자로 알려 주는 것이라 한글로 옮긴다.
  [/\[1st Place\]/g, '[1위]'],
  [/\[2nd Place\]/g, '[2위]'],
  [/\[3rd Place\]/g, '[3위]'],
  [/\[4th Place\]/g, '[4위]'],
  [/\[Winner\]/g, '[우승]'],
  [/\[Thank You\]/g, '[감사]'],
  [/\bLeague Challenge\b/g, '리그 챌린지'],
  [/\bLeague Cup\b/g, '리그 컵'],
  [/\be-League\b/g, 'e리그'],
  [/\bJP Illustration Grand Prix\b/g, '일러스트 그랑프리'],
  [/\bIllustration Contest\b/g, '일러스트 공모전'],
  [/\bThunder Mountain\b/g, '썬더 마운틴'],
  // ⚠️ `Nidoran F`·`Nidoran M`을 **먼저** 바꾼 뒤라야 한다(위에 있다). 성별 표시가 없는
  //    옛 카드만 여기서 걸린다.
  [/\bNidoran\b/g, '니드런'],
  [/\bTeam Magma\b/g, '마그마단'],
  [/\bTeam Aqua\b/g, '아쿠아단'],
  [/\bAsh-/g, '지우'],
  [/\bPokenav\b/g, '포켓내비'],
  [/\bDelta Rainbow Energy\b/g, '델타 레인보우 에너지'],
  // 뒤 글자(WLFM·GRPD)는 **에너지 타입 약자**라 카드에 영문으로 찍힌다 — 그대로 둔다.
  [/\bBlend Energy\b/g, '블렌드 에너지'],
  // ⚠️ 사전에 `Professor Roawn`(오타)만 있었다. 바르게 적힌 것도 같이 받는다.
  [/\bProfessor Rowan\b/g, '마박사'],
  // ── 몬스터볼 종류 ───────────────────────────────────────────────────────────
  // ⚠️ 공식 한글명이 영문과 다른 것이 있다 — `Ultra Ball`은 「하이퍼볼」이다.
  //    `울트라 Ball`은 사전이 앞만 옮기고 만 꼴이라 그것도 같이 받는다.
  // ⚠️⚠️ **한글에는 `\b`(낱말 경계)가 안 먹는다** — `\w`가 영문·숫자뿐이라 `\b울트라`는
  //    한 번도 안 맞는다(lib.mts에 같은 함정이 적혀 있는데 또 걸렸다. 2026-08-09).
  //    한글이 섞인 규칙은 `\b`를 쓰지 않는다.
  [/(?:\bUltra|울트라)\s?Ball\b/g, '하이퍼볼'],
  [/\bDusk Ball\b/g, '다크볼'],
  [/\bFriend Ball\b/g, '프렌드볼'],
  [/\bLove Ball\b/g, '러브볼'],
  [/\bQuick Ball\b/g, '퀵볼'],
  [/\bHeavy Ball\b/g, '헤비볼'],
  [/\bLevel Ball\b/g, '레벨볼'],
  [/\bTimer Ball\b/g, '타이머볼'],
  [/\bDive Ball\b/g, '다이브볼'],
  [/\bLuxury Ball\b/g, '고급봉'],
  [/\bPremier Ball\b/g, '프리미어볼'],
  [/\bRepeat Ball\b/g, '리피트볼'],
  [/\bMaster Ball\b/g, '마스터볼'],
  [/\bBeast Ball\b/g, '울트라볼'],
  [/\bSafari Ball\b/g, '사파리볼'],
  // ── 어디서 판 것인지 · 어느 대회 것인지 ─────────────────────────────────────
  [/\bWorld Championships\b/g, '월드 챔피언십'],
  [/\bWorlds\b/g, '월드'],
  [/\bPrize Pack Series\b/g, '프라이즈 팩 시리즈'],
  [/\bV Battle (?:Deck|덱)/g, 'V 배틀 덱'],
  [/\bLeague Battle (?:Deck|덱)/g, '리그 배틀 덱'],
  [/\[Top (\d+)\]/g, '[$1강]'],
  [/\[Finalist\]/g, '[준우승]'],
  [/\[Quarter-?Finalist\]/g, '[8강]'],
  [/\[Semi-?Finalist\]/g, '[4강]'],
  [/\bGamestop\b/gi, '게임스탑'],
  [/\bPrerelease Kit\b/g, '프리릴리즈 키트'],
  [/\bMythical Pokemon Collection Box\b/g, '환상의 포켓몬 컬렉션 박스'],
  [/\bXY Evolutions\b/g, 'XY 에볼루션스'],
  [/(?:\bPaldean|팔데아)\s?Fates\b/g, '팔데아 페이츠'],
  [/\bNew Theory\b/g, '신이론'],
  [/\bKit\b/g, '키트'],
  [/\bToys ?R[’']? ?Us\b/g, '토이저러스'],
  [/\bBuild-A-Bear Workshop\b/g, '빌드어베어'],
  [/\bEB Games\b/g, 'EB 게임즈'],
  [/\bExclusive\b/g, '한정'],
];

/**
 * `(Tyranitar Stamped)`의 **안쪽 포켓몬 이름**은 사전을 안 거친다 — 괄호 밖 이름만
 * 옮겨지기 때문이다. 그래서 여기서 한 번 더 태운다.
 * ⚠️ `koName`을 부르면 서로 부르게 되므로, **이름 사전만** 직접 쓴다.
 */
function 스탬프이름(s: string): string {
  // ⚠️ **세트 이름이 스탬프로 찍히는 카드가 있다**(`(Surging Sparks Stamped)`).
  //    카드 이름 사전에는 없고 **세트 이름 사전에 있다** — 그쪽을 먼저 본다.
  const 세트 = koSetName(s);
  if (세트 !== s && /[가-힣]/.test(세트)) return 세트;
  const ko = koreanizeEnglishCardName(s);
  return /[가-힣]/.test(ko) && !/[A-Za-z]{3,}/.test(ko) ? ko : s;
}

/**
 * `[Rebel Clash]`처럼 **대괄호 안에 세트 이름**이 오는 카드가 있다(그 세트 발매 기념 배포).
 * 세트 이름 사전으로 옮긴다. 사람 이름·표식은 사전에 없으니 그대로 지나간다.
 */
function 대괄호속(s: string): string {
  return s.replace(/\[([^\]]+)\]/g, (m, 안: string) => {
    const t = 안.trim();
    const ko = koSetName(t);
    return ko !== t && /[가-힣]/.test(ko) ? `[${ko}]` : m;
  });
}

export function 이름다듬기(s: string): string {
  let out = s;
  // ① `(○○ Stamped)` → `(○○ 스탬프)`. 안쪽 이름도 한글로 옮긴다.
  // ⚠️ **대괄호로 적힌 것도 같이 본다** — `Dark Arbok [W Stamped]`. 예전엔 소괄호만
  //    보아서 이 꼴 7장이 「나쁜 아보크 [W Stamped]」로 나갔다(사장님 지적 2026-08-11).
  //    괄호 종류만 다를 뿐 같은 표시라, 사전에 7줄을 따로 넣는 대신 여기서 한 번에 잡는다.
  out = out.replace(/([([])([^)\]]*?)\s*Stamped([)\]])/g, (_m, 여는: string, 앞: string, 닫는: string) => {
    const 이름 = 앞.trim();
    return 이름 ? `${여는}${스탬프이름(이름)} 스탬프${닫는}` : `${여는}스탬프${닫는}`;
  });
  // ② 소유격 지명·인명
  for (const [en, ko] of Object.entries(소유격)) {
    out = out.replace(new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['’]s\\b`, 'g'), `${ko}의`);
  }
  // ③ 괄호 안 표시말
  out = out.replace(/\(([^)]+)\)/g, (m, 안: string) => (괄호말[안.trim()] ? `(${괄호말[안.trim()]})` : m));
  // ④ 낱말
  for (const [re, ko] of 낱말) out = out.replace(re, ko);
  // ④-2 대괄호 안 세트 이름
  out = 대괄호속(out);
  // ⑤ `앞 - 뒤` 꼴에서 **앞이 통째로 안 옮겨진 것**을 한 번 더 태운다.
  //    사전은 이름 전체를 찾으므로 `Basic Darkness Energy - 다크라이 덱`처럼 꼬리가 붙으면
  //    못 찾는다. 꼬리는 어느 덱인지 알려 주는 것이라 지우면 안 되고, 앞만 옮기면 된다
  //    (2026-08-09 화면에서 확인).
  const 쪼갬 = /^(.+?)\s+-\s+(.+)$/.exec(out);
  if (쪼갬 && /[A-Za-z]{3,}/.test(쪼갬[1])) {
    const 앞 = koreanizeEnglishCardName(쪼갬[1]);
    if (/[가-힣]/.test(앞) && !/[A-Za-z]{3,}/.test(앞)) out = `${앞} - ${쪼갬[2]}`;
  }
  // ⑥ `앞 (뒤)` 꼴도 마찬가지다. `Basic Fairy Energy (Raichu Stamped)`는 사전에
  //    `Basic Fairy Energy`가 **분명히 있는데도** 괄호 때문에 이름 전체로는 못 찾아
  //    영문 그대로 나갔다(2026-08-09에 30장이 그랬다). 괄호 안은 ①~③에서 이미
  //    다뤘으니 **앞만** 한 번 더 태운다.
  // ⚠️ 앞이 이미 한글이면 건드리지 않는다 — `낚시꾼 (Fisher)`의 괄호는 일부러 남긴 것이다.
  const 괄쪼갬 = /^([^(]+?)\s*(\([\s\S]+)$/.exec(out);
  if (괄쪼갬 && /[A-Za-z]{3,}/.test(괄쪼갬[1])) {
    const 앞 = koreanizeEnglishCardName(괄쪼갬[1]);
    if (/[가-힣]/.test(앞) && !/[A-Za-z]{3,}/.test(앞)) out = `${앞} ${괄쪼갬[2]}`;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}
