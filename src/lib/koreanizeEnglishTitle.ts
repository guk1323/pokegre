import pokemonNames from '../data/pokemonNames.json' with { type: 'json' };
import packNames from '../data/packNames.json' with { type: 'json' };
import cardNameKoEn from '../data/cardNameKoEn.json' with { type: 'json' };

// 영문 카드명 → 한글. scripts/gen-ko-en-cards.mts가 만든 "한글 → 영문"을 뒤집은 것이다.
// 왜 뒤집어 쓰는가: 같은 카드가 탭마다 다른 이름으로 보였다("올림박사의 기백"(스니커덩크)
// vs "올림박사의 기력"(이베이)). 공식 카드명을 확인해 보면 일본어 경로 쪽이 맞다 —
// 그쪽은 포켓몬코리아 공식명과 계속 대조해 왔고, 이 영문 표는 그런 검증이 없었다.
// 그래서 아래 손 사전보다 이걸 먼저 본다.
// 같은 영문에 한글이 둘 이상 붙은 것은 어느 쪽인지 알 수 없으므로 뺀다.
const AUTO_EN_TO_KO: Map<string, string> = (() => {
  const count = new Map<string, number>();
  for (const en of Object.values(cardNameKoEn as Record<string, string>)) {
    count.set(en, (count.get(en) ?? 0) + 1);
  }
  const map = new Map<string, string>();
  for (const [ko, en] of Object.entries(cardNameKoEn as Record<string, string>)) {
    if (count.get(en) === 1) map.set(en, ko);
  }
  return map;
})();

interface PokemonName {
  id: number;
  ko: string;
  ja: string;
  en: string;
}

interface PackName {
  code: string;
  ja: string;
  ko: string;
}

// 긴 이름부터 치환해야 "Mew"가 "Mewtwo" 안에서 먼저 걸려 이름이 깨지는 걸 막을 수 있다.
// (koreanizeTitle의 일본어 처리, translateQueryToEnglish의 한글 처리와 같은 방식)
const sortedPokemonEnKo = (pokemonNames as PokemonName[])
  .filter((entry) => entry.en && entry.ko)
  .sort((a, b) => b.en.length - a.en.length);

const packKoByCode = new Map(
  (packNames as PackName[]).filter((entry) => entry.code && entry.ko).map((entry) => [entry.code.toLowerCase(), entry.ko]),
);

// 포켓몬 이름 앞에 붙는 수식어. "ex"/"V"/"VMAX"/"GX" 같은 접미사는 한국 공식 표기에서도
// 영문 그대로 쓰기 때문에 건드리지 않는다.
export const STRUCTURAL_EN_TO_KO: [string, string][] = [
  // 2020년 영국 축구협회(The FA) 한정 프로모 5종. 한국 정식 발매가 없어 공식명이 없다.
  // 일본판 원문 「ボールをかかえたピカチュウ」의 뜻대로 "공을 안은 <포켓몬>"으로 쓴다
  // (사용자 확인 2026-08-01). 수집가들이 같이 쓰는 "피카츄 온 더 볼"은 검색어로만 받는다.
  // ⚠️ 이름이 뒤로 가므로 "<이름> on the Ball"을 통째로 잡을 수 없다. 꼬리만 떼고
  //    앞에 "공을 안은 "을 붙이는 건 이 사전 구조로는 안 되니, 다섯 장을 통째로 적는다.
  // e카드 시절 타입별 굿즈 8종. "Fire Cube 01"처럼 번호가 붙어 와 통짜 조회가 안 걸리므로
  // 낱말로 쪼개지기 전에 여기서 잡는다(안 그러면 "파이어큐브 01"로 띄어 나온다).
  // 일본판과 같은 꼴로 붙여 쓴다. 파이어·워터·라이트닝·사이킥은 사용자 확인(2026-08-01).
  ['Fire Cube', '파이어큐브'],
  ['Water Cube', '워터큐브'],
  ['Lightning Cube', '라이트닝큐브'],
  ['Psychic Cube', '사이킥큐브'],
  ['Grass Cube', '그라스큐브'],
  ['Fighting Cube', '파이팅큐브'],
  ['Metal Cube', '메탈큐브'],
  ['Darkness Cube', '다크니스큐브'],
  // 소유격 카드명(Destined Rivals 등). 함수 초입에서 곧은 어포스트로피(')를 굽은
  // 것(’)으로 정규화하므로 여기 키도 굽은 표기다. 한글명은 전부 기존 트레이너
  // 사전에서 확정된 이름만 쓴다.
  ['Team Rocket’s ', '로켓단의 '],
  ['Ethan’s ', '심향의 '],
  ['Misty’s ', '이슬의 '],
  ['Cynthia’s ', '난천의 '],
  ['Steven’s ', '성호의 '],
  ['Arven’s ', '페퍼의 '],
  ['Marnie’s ', '마리의 '],
  ['Lillie’s ', '릴리에의 '],
  ['N’s ', 'N의 '],
  ['Iono’s ', '모야모의 '],
  ['Hop’s ', '호브의 '], // ホップ. 정식명은 호브다
  ['Mega ', '메가'],
  // ⚠️ 대문자 MEGA도 같이 잡는다. 스니커덩크 상세 API가 영문 이름을 대문자로 준다
  //    ("MEGA Charizard X ex MA"). 이게 빠져 있어서 공유 링크 미리보기에는
  //    "MEGA 리자몽"으로, 사이트 화면에는 "메가리자몽"으로 서로 다르게 떴다
  //    (2026-08-05 점검에서 잡음 — 새로고침하면 탭 이름이 바뀌었다).
  ['MEGA ', '메가'],
  ['Radiant ', '찬란한 '], // かがやく/輝く의 영문판. koreanizeTitle과 같은 표기로 맞춘다.
  // 지역폼 접두사. 뒤의 포켓몬 이름은 사전 치환으로 한글이 되고, 이 접두사만 남던 걸
  // 한글 공식 표기로 바꾼다. 예: "Galarian Mr. Mime" → "가라르 마임맨".
  ['Galarian ', '가라르 '],
  ['Alolan ', '알로라 '],
  ['Hisuian ', '히스이 '],
  ['Paldean ', '팔데아 '],
  // ── 2026-07-28: 사용자 검수(공식 한글명 기준) ──────────────────────────
  // 앞뒤 공백이 낱말 경계다. 'Dark '는 "Darkrai"를 건드리지 않는다.
  // 이름 전체가 맞는 카드는 위 exact 사전이 먼저 잡으므로 여기까지 오지 않는다.
  ['Team Aqua’s ', '아쿠아단의 '],
  ['Team Magma’s ', '마그마단의 '],
  ['Lt. Surge’s ', '마티스의 '],
  ['Erika’s ', '민화의 '],
  ['Brock’s ', '웅의 '],
  ['Sabrina’s ', '초련의 '],
  ['Blaine’s ', '강연의 '],
  ['Koga’s ', '독수의 '],
  ['Giovanni’s ', '비주기의 '],
  ['Ash’s ', '지우의 '],
  ['Holon’s ', '홀론의 '],
  ['Lance’s ', '목호의 '],
  ['Imakuni?’s ', '이마쿠니?의 '],
  // 'Team Rocket’s '가 배열 앞에 있어 이미 바뀐 뒤라, 남은 것만 잡는다.
  ['Rocket’s ', '로켓단의 '],
  // 버드렉스는 접두어에 말 이름이 들어간다(백마/흑마).
  ['Ice Rider ', '백마 '],
  ['Shadow Rider ', '흑마 '],
  ['Rapid Strike ', '연격 '],
  ['Single Strike ', '일격 '],
  ['Origin Forme ', '오리진폼 '],
  ['Special Delivery ', '스페셜 배달 '],
  ['Armor Fossil ', '방패의화석 '],
  ['Claw Fossil ', '발톱화석 '],
  ['Dome Fossil ', '껍질화석 '],
  ['Helix Fossil ', '조개화석 '],
  ['Root Fossil ', '뿌리화석 '],
  ['Old Amber ', '비밀의호박 '], // 아엠버는 Amber를 소리로 옮긴 것이었다
  ['Detective ', '명탐정 '],
  ['Shining ', '빛나는 '],
  ['Armored ', '아머드 '],
  ['Primal ', '원시 '],
  ['Flying ', '공중날기 '],
  ['Surfing ', '파도타기 '],
  ['Ancient ', '고대 '],
  ['Frost ', '프로스트 '],
  ['Drone ', '드론 '],
  ['Dark ', '나쁜 '], // 한국 정식 발매명은 "나쁜 리자몽"이다(2026-08-02 확인)
  ['Light ', '상냥한 '], // やさしい○○. Dark=나쁜과 짝이다(2026-08-02 확인)
  // ── 2026-08-02 사용자 확인 ──────────────────────────────────────────
  // δ(델타종)는 한국 정식 발매본이 괄호 표기를 쓴다. 이름 뒤에 붙으므로 공백째 잡는다.
  [' δ', ' (델타종)'],
  // 폼체인지·특수 형태 포켓몬 고유명사는 붙여 쓰는 것이 원칙이다.
  // 아래 세 줄은 'Black '·'White '·'Ultra ' 조각 규칙보다 먼저 와야 한다.
  ['Black Kyurem', '블랙큐레무'],
  ['White Kyurem', '화이트큐레무'],
  ['Ultra Necrozma', '울트라네크로즈마'],
  ['White ', '화이트 '],
  ['Black ', '블랙 '],
  ['Ultra ', '울트라 '],
  ['Cool ', '쿨 '],
  // 뒤에 붙는 말. 앞의 공백이 낱말 경계다.
  [' Spirit Link', ' 소울링크'],
  [' Plant Cloak', ' 초목부목'],
  [' Sandy Cloak', ' 모래땅부목'],
  [' Trash Cloak', ' 슈레기부목'],
  [' East Sea', ' 동쪽바다'],
  [' West Sea', ' 서쪽바다'],
  [' Attack Forme', ' 어택폼'],
  [' Defense Forme', ' 디펜스폼'],
  [' Normal Forme', ' 노말폼'],
  [' Speed Forme', ' 스피드폼'],
  [' Rain Form', ' 빗방울의 모습'],
  [' Rainy Form', ' 빗방울의 모습'],
  [' Snow-cloud Form', ' 설운의 모습'],
  [' Snowy Form', ' 설운의 모습'],
  [' Sunny Form', ' 태양의 모습'],
  [' Chestplate', ' 체스트플레이트'],
  [' Cerulean City Gym', ' 블루시티 체육관'],
  [' Water Command', ' 수룡 조종'],
  [' Full Force', ' 진심'],
  [' Evil Deeds', ' 악행'],
  [' Determination', ' 결의'],
  [' Hypnotizer', ' 최면기'],
  [' Handiwork', ' 공작'],
  [' Guidance', ' 인도'],
  [' Trickery', ' 속임수'],
  [' Feelings', ' 의지'],
  [' Vitality', ' 활력'],
  [' Friends', ' 친구들'],
  [' Resolve', ' 각오'],
  [' Advice', ' 조언'],
  [' Pride', ' 프라이드'],
  [' Favor', ' 부탁'],
  [' Tears', ' 눈물'],
  [' Wrath', ' 분노'],
  [' Duel', ' 결투'],
  [' Wish', ' 소원'],
  [' Plan', ' 플랜'],
  [' Bag', ' 가방'],
  [' Heavy Ball', ' 헤비볼'], // "Hisuian Heavy Ball"의 뒷말이 영어로 남았다
];

// 트레이너·인물 서포트 카드 이름(영어 → 한글). 포켓몬이 아니라 pokemonNames 사전에 없어
// 그동안 영문으로 남았다. 한글은 공식 한국 포켓몬 표기(koreanizeTitle의 일본어쪽과 동일).
// ⚠️ "N"·"Red"처럼 짧은 이름이 다른 단어 안에 끼지 않도록, 카드명 "전체"가 정확히
// 일치할 때만 바꾼다(부분 치환 안 함).
const TRAINER_EN_TO_KO: Record<string, string> = {
  Serena: '세레나',
  Cynthia: '난천', // シロナ. 일본어 음역 "시로나"가 아니라 한국 정식명 "난천".
  Marnie: '마리',
  Lillie: '릴리에',
  Sabrina: '초련', // ナツメ (나츠메는 일본명)
  Iono: '모야모', // ナンジャモ. 난자모는 흔한 오표기, 공식은 모야모
  Nemona: '네모',
  Arven: '페퍼',
  // Penny(ボタン)의 공식 한글명은 '모란'이다. '보탄'은 일본 이름 음역이라 틀렸다.
  Penny: '모란',
  Clavell: '클라벨', // クラベル (청목은 Larry 이름이라 오류)
  Bianca: '벨',
  Cheren: '체렌',
  Hop: '호브',
  Leon: '단델',
  Sonia: '소니아',
  Nessa: '야청', // ルリナ
  Piers: '두송', // ネズ, 스파이크타운 악 관장 (네즈는 일본명)
  Roxie: '보미카',
  Rosa: '명희',
  Grusha: '그루샤',
  Acerola: '아세로라',
  Wally: '민진',
  Lance: '목호',
  Blaine: '강연',
  Misty: '이슬',
  Ash: '지우',
  "Professor's Research": '박사의 연구',
  "Brock's Scouting": '웅의 스카우트',
  Levincia: '누룩스시티',
  "Boss's Orders": '보스의 지령',
  // Atticus = シュウメイ = 추명. 효과문이 완전히 같아 확정했다(SV8a シュウメイ:
  // "상대 배틀 포켓몬이 독일 때만 쓸 수 있다 … 패를 덱에 되돌려 섞고 7장 뽑는다"
  // ↔ Atticus: "opponent's Active Pokémon is Poisoned … draw 7 cards").
  Atticus: '추명',
  'Forest of Vitality': '활력의 숲',
  // 추가 인물(확신하는 공식 표기만). 갈라르 관장 등 불확실한 이름은 넣지 않는다
  // — 틀린 한글보다 영어가 낫다.
  Guzma: '구즈마',
  Lusamine: '루자미네',
  Lysandre: '플라드리',
  Hau: '하우',
  Rose: '로즈',
  Oleana: '올리브',
  Bea: '채두', // サイトウ, 가라르 격투 관장 (사요는 오역)
  Brawly: '철구', // トウキ (텟센은 Wattson의 일본명이라 오류였음)
  Wattson: '암페어', // テッセン
  Flannery: '민지', // アスナ
  Juan: '아단', // アダン
  Sidney: '혁진', // カゲツ, 악 사천왕
  Glacia: '미혜', // プリム, 얼음 사천왕
  Drake: '권수', // ゲンジ, 드래곤 사천왕
  Opal: '포플러', // ポプラ (포푸라는 일본명)
  Shauna: '사나',
  Skyla: '풍란', // フウロ (후우로는 일본명)
  Hala: '할라',
  Milo: '야로우', // ヤロー, 터프필드 풀 관장
  Agatha: '국화', // キクコ (오바는 오역)
  Bruno: '시바',
  Erika: '민화', // エリカ (에리카는 일본명)
  Kiawe: '키아웨', // カキ (카키는 일본명)
  Sophocles: '마마네',
  Volkner: '전진', // デンジ (덴지는 일본명)
  Phoebe: '회연', // フヨウ (후요는 일본명)
  Cheryl: '모미',
  Candice: '무청', // スズナ (스즈나는 일본명)
  Gardenia: '유채', // ナタネ (나타네는 일본명)
  Grant: '자크로', // ザクロ (자쿠로는 일본명)
  Korrina: '코르니',
  Tierno: '티에르노',
  Hilda: '투희', // ヒルダ (히루다는 일본명)
  'Professor Sycamore': '플라타느박사',
  'Professor Juniper': '아라라기박사',
  'Team Yell Grunt': '옐 단원',
  'Team Flare Grunt': '플레어단 단원',
  'Team Rocket Grunt': '로켓단 단원',
  // 번역 점검 배치: 공식 한글명 확인된 관장·챔피언·악당보스.
  Brock: '웅',
  Steven: '성호',
  Wallace: '윤진',
  Giovanni: '비주기',
  Cyrus: '태홍',
  Ghetsis: '게치스',
  'Lt. Surge': '마티스',
  Maylene: '자두',
  Diantha: '카르네',
  Alder: '노간주',
  Iris: '아이리스',
  // 번역 점검 2차: 성도·호연 관장/사천왕/악당보스(공식 한글명 확인).
  Falkner: '비상',
  Bugsy: '호일',
  Whitney: '꼭두',
  Morty: '유빈',
  Chuck: '사도',
  Jasmine: '규리',
  Pryce: '류옹',
  Clair: '이향',
  Koga: '독수',
  Janine: '도희',
  Lorelei: '칸나',
  Will: '일목',
  Karen: '카렌',
  Colress: '아크로마',
  Maxie: '마적',
  Archie: '아강',
  // 번역 점검 3차: 사용자 확인 + 검증한 관장/라이벌.
  Barry: '용식', // ジュン, 신오 라이벌
  Norman: '종길', // センリ, 무궁시티 노말 관장
  Winona: '은송', // ナギ, 검방울시티 비행 관장 (이전 "원규"는 Roark 이름이라 수정)
  Roark: '강석', // ヒョウタ, 광연시티 바위 관장
  Roxanne: '원규', // ツツジ, 호연 바위 관장 (사용자가 Roark로 준 "원규"의 실제 주인)
  'Crasher Wake': '맥실러', // マキシ, 연화시티 물 관장
  Elesa: '카밀레', // カミツレ, 뇌엔시티 전기 관장
  Clay: '야콘', // ヤーコン, 물풍경시티 땅 관장 (아콘은 오타)
  // 번역 점검 5차: 하나·칼로스 관장/사천왕 (Fandom 리그 공식표).
  Cilan: '덴트',
  Chili: '팟',
  Cress: '콘',
  Lenora: '알로에',
  Burgh: '아티',
  Brycen: '담죽',
  Drayden: '사간',
  Marlon: '시즈',
  Shauntal: '망초',
  Marshal: '연무',
  Grimsley: '블래리',
  Caitlin: '카틀레야',
  Viola: '비올라',
  Ramos: '후쿠지',
  Clemont: '시트론',
  Wulfric: '우르프',
  Aaron: '충호', // 신오 벌레 사천왕
  Bertha: '들국화', // 신오 땅 사천왕
  Flint: '대엽', // 신오 불꽃 사천왕
  Lucian: '오엽', // 신오 에스퍼 사천왕
  Byron: '동관', // 신오 강철 관장
  Fantina: '멜리사', // 신오 고스트 관장
  // 번역 점검 6차: 팔데아 관장/사천왕 + 칼로스 사천왕.
  Katy: '단풍',
  Brassius: '콜사',
  Kofu: '곤포',
  Larry: '청목', // アオキ, 노말 관장 겸 비행 사천왕
  Ryme: '라임',
  Tulip: '리파',
  Rika: '칠리',
  // 아래는 일본어 사전에서 이미 확인된 공식 한글명을 영문판 경로에도 맞춘 것.
  // (영문 카드에서 이름이 영어 그대로 뜨던 인물들)
  Melony: '멜론',
  Raihan: '금랑',
  Jacq: '지니어',
  Miriam: '미모사',
  Saguaro: '사구아로',
  Poppy: '뽀삐',
  Hassel: '팔자크',
  Geeta: '테사',
  Malva: '파키라',
  Siebold: '즈미',
  Wikstrom: '간피',
  Drasna: '드라세나',
  // 알로라 캡틴 + 갤럭시단 간부.
  Ilima: '일리마',
  Lana: '수련',
  Mallow: '마오',
  Mina: '말리화',
  Mars: '마스',
  Jupiter: '주피터',
  Saturn: '새턴',
  Charon: '플루토',
  Allister: '어니언', // 가라르 고스트 관장
  Bede: '비트', // 가라르
  Kieran: '카지', // 벽록의 가면 (시유의 남동생)
  Briar: '브라이어', // SV
  Mela: '멜로코', // 팀 스타 보스
  Eri: '비파', // 팀 스타 보스
  Ortega: '오르티가', // 팀 스타 보스
  Giacomo: '피나', // 팀 스타 악 보스
  // 플레어단 간부 + 스컬단.
  Aliana: '아케비',
  Celosia: '코레아',
  Mable: '바라',
  Bryony: '모미지',
  Xerosic: '크세로시키',
  Plumeria: '플루메리',
  Gladion: '글라디오', // 릴리에의 오빠
  Faba: '자우보', // 에테르재단
  Hapu: '하푸우', // 포니섬 왕
  Blue: '그린', // グリーン. 북미판만 Blue, 한국/일본은 그린
  Molayne: '머마네',
  Kahili: '카히리',
  Wicke: '비커', // 에테르재단 비서
  // 히스이 (레전드 아르세우스).
  Volo: '월로',
  Drayton: '제빈',
  Perrin: '세류',
  Crispin: '하솔',
  Adaman: '찬석', // 공식 카드로 확인(류가 아님)
  Irida: '주혜',
  Cyllene: '금경', // 조사대장. 공식 카드 S9a로 확인(경단·찬석 아님)
  Kamado: '전목', // 공식 카드 S9a로 확인(파래열 아님)
  Mai: '마이',
  Laventon: '라벤',
  Valerie: '마슈', // マーシュ, 후늬시티 페어리 관장 (마수드는 오역)
  Olympia: '고지카', // ゴジカ, 별록시티 에스퍼 관장
  Olivia: '라이치', // ライチ, 아칼라섬 도주 바위
  Nanu: '나루화', // ナリヤ, 울라울라섬 도주 악
};

// 아이템·에너지·화석·일반 역할 카드(영어 → 한글). 공식 한국 포켓몬 카드 표기.
// 카드명 "전체"가 정확히 일치할 때만 바꾼다.
const ITEM_EN_TO_KO: Record<string, string> = {
  // 골드스타. 카드에는 ★로 인쇄돼 있다(일본판 쪽과 같은 표기로 맞춘다).
  'Groudon Star': '그란돈 ★',
  'Kyogre Star': '가이오가 ★',
  'Metagross Star': '메타그로스 ★',
  'Mewtwo Star': '뮤츠 ★',
  'Pikachu Star': '피카츄 ★',
  'Treecko Star': '나무지기 ★',
  'Entei Star': '앤테이 ★',
  'Suicune Star': '스이쿤 ★',
  'Registeel Star': '레지스틸 ★',
  'Pikachu on the Ball': '공을 안은 피카츄',
  'Eevee on the Ball': '공을 안은 이브이',
  'Grookey on the Ball': '공을 안은 흥나숭',
  'Scorbunny on the Ball': '공을 안은 염버니',
  'Sobble on the Ball': '공을 안은 울머기',
  // ── 되물어서 하나로 특정한 이름(2026-07-26) ────────────────────────────
  Bonnie: '유리카', // XY 시트론의 여동생. 고지(Sandslash)로 잘못 왔던 것을 바로잡음
  Dendra: '운향', // 아카데미 배틀 선생님. 레포르는 역사 선생님 Raifort다
  // 이름이 겹치거나 한글이 아니어서 보류했던 것들을 사용자가 공식명으로 다시
  // 확인해 줬다. 같은 한글을 쓰는 쌍은 실제로 같은 이름으로 발매된 것이다.
  Zisu: '금주',
  Arezu: '성화',
  Iscan: '억새',
  'Choice Belt': '구애머리띠', // Choice Band와 같은 이름으로 발매됐다(사용자 확인)
  Charity: '자선',
  'Energy Restore': '에너지 재활용',
  Fisher: '낚시꾼 (Fisher)', // Fisherman이 정발명이라 옛 이름 쪽에 구분을 붙인다(2026-07-28)
  'Focus Band': '기합의 머리띠',
  'Focus Sash': '기합의 띠',
  'Muscle Band': '힘의 머리띠',
  'Expert Belt': '달인의 띠',
  'Impact Energy': '임팩트 에너지',
  'Single Strike Energy': '일격 에너지',
  Peonia: '피오니아', // 아버지 Peony=피오니와 다른 인물(2026-07-28 정정)
  Peony: '피오니',
  'Acro Bike': '더트자전거',
  Bicycle: '자전거',
  Hiker: '등산가',
  'Poké Maniac': '애호가',
  'Roller Skater': '롤러스케이터', // 사람(서포트)과 도구를 가른다(2026-07-28)
  'Roller Skates': '롤러스케이트',
  'Ultra Forest Kartenvoy': '울트라조무래기',
  'Ultra Recon Squad': '울트라조사대',
  'Cara Liss': '복원 연구원',
  Fieldworker: '필드연구원',
  Dan: '단', // 한 글자라 검색은 이름 전체가 일치할 때만 걸린다
  'Pokémon Breeder': '포켓몬 브리더',
  'Double Gust': '더블 돌풍',
  'Gust of Wind': '돌풍',
  'Superior Energy Retrieval': '슈퍼 에너지 회수',
  'Super Energy Retrieval': '하이퍼 에너지 회수',
  'Dowsing Machine': '다우징머신',
  'Item Finder': '아이템 탐지기', // Dowsing Machine(다우징머신)과 원문 뜻이 다르다(2026-07-28)
  'Moomoo Milk': '튼튼밀크',
  'Moo-Moo Milk': '튼튼밀크', // Moomoo Milk의 옛 표기(사용자 확인)
  Picnicker: '피크닉걸',
  'Technical Machine: Devolution': '기술머신 퇴화',
  'Technical Machine: Evolution': '기술머신 진화',
  'Sweet Honey': '달콤한꿀',

  // ── 사용자가 확인해 준 공식 한글 카드명 621개(2026-07-26) ────────────────
  // 한국 공식 포켓몬 카드 게임 데이터베이스 기준. SV·SWSH·SM·XY·BW·구세대의
  // 트레이너스·스타디움·굿즈·특수에너지가 섞여 있다(둘 다 같은 방식으로 쓰이므로
  // 표를 나누지 않았다). 이름이 겹치거나 한글이 아닌 45개는 넣지 않고 되물었다.
  'Academy at Night': '야간 학원',
  'Ancient Booster Energy Capsule': '부스트에너지 고대',
  'Antique Plume Fossil': '오래된 깃털화석', // 카세키=化石의 음역이었다
  'Awakening Drum': '각성의 드럼',
  'Beach Court': '해변의 코트',
  'Boxed Order': '박스 주문',
  'Brave Bangle': '용기의 뱅글',
  'Calamitous Snowy Mountain': '재앙의 설산',
  'Calamitous Wasteland': '재앙의 황야',
  Cassiopeia: '카시오페아',
  Clive: '클라브',
  'Counter Catcher': '카운터 캐처',
  'Cursed Duster': '원한의 먼지털이',
  'Dangerous Laser': '데인저러스 레이저',
  'Defiance Band': '반격의 머리띠',
  'Defiance Vest': '반격의 조끼',
  'Delivery Drone': '배달 드론',
  'Electric Generator': '일렉트릭제네레이터',
  'Energy Coin': '에너지 코인',
  'Exp. Share': '학습장치',
  Fennel: '주리', // マコモ. 회향(채소)으로 옮겨져 있었다
  'Fighting Au Lait': '격투 맛의 오레',
  'Full Metal Lab': '풀메탈랩',
  'Future Booster Energy Capsule': '부스트에너지 미래',
  'Hand Trimmer': '핸드트리머',
  Harlequin: '피에로',
  'Heavy Baton': '헤비바톤',
  'Ignition Energy': '점화 에너지',
  'Luxurious Cape': '호화로운 망토',
  'Medical Energy': '메디컬 에너지',
  Mesagoza: '테이블시티',
  'Mist Energy': '미스트 에너지',
  'Moonlit Hill': '달이 빛나는 언덕', // 샤이니트레저ex 정식명(2026-07-29 정정)
  'Neo Upper Energy': '네오 어퍼 에너지',
  'Neutralization Zone': '뉴트럴센터',
  'Paradise Resort': '파라다이스 리조트',
  'Parasol Lady': '파라솔 언니', // パラソルおねえさん
  'Perilous Jungle': '위협의 정글',
  'Picnic Basket': '피크닉 바스켓',
  'Poké Vital A': '포케바이탈A',
  Powerglass: '파워글라스',
  'Practice Studio': '연습 스튜디오',
  'Prism Energy': '프리즘 에너지',
  'Reboot Pod': '리부트 포드',
  'Reversal Energy': '리버스 에너지',
  'Rock Chestplate': '암석의 가슴받이',
  Salvatore: '세이지',
  'Technical Machine: Blindside': '기술머신 사격',
  'Technical Machine: Crisis Punch': '기술머신 위기펀치',
  'Technical Machine: Turbo Energize': '기술머신 에너지가속',
  'Therapeutic Energy': '세라피 에너지',
  'Vitality Band': '활력의 머리띠',
  Youngster: '반바지 어린이',
  'Arc Phone': '알세우스폰',
  'Aroma Lady': '아로마 언니', // アロマなおねえさん — 일본판과 같은 카드
  'Aromatic Grass Energy': '아로마 풀 에너지',
  'Aurora Energy': '오로라 에너지',
  Avery: '세이버',
  'Ball Guy': '볼갱이',
  'Battle VIP Pass': '배틀 VIP 패스',
  'Big Charm': '큰 부적',
  'Big Parasol': '큰 파라솔',
  'Billowing Smoke': '자욱한 연기',
  'Bird Keeper': '새조련사',
  Blanche: '블랑쉐',
  'Blunder Policy': '실수보험',
  'Boost Shake': '부스트셰이크',
  'Box of Disaster': '재앙의 상자',
  Brandon: '진철',
  'Bug Catcher': '벌레잡이소년',
  'Burning Scarf': '스카프',
  'Café Master': '카페소믈리에',
  'Camping Gear': '캠핑 세트',
  'Canceling Cologne': '캔슬코롱', // 타임게이저 정식명(2026-07-29 정정)
  Candela: '칸델라',
  'Capacious Bucket': '듬뿍양동이',
  'Cape of Toughness': '질긴의 망토',
  'Capture Energy': '캡처 에너지',
  'Capturing Aroma': '캡처아로마',
  'Chili & Cilan & Cress': '덴트·콩두·팟',
  Choy: '상인',
  'Circhester Bath': '키르쿠스타운 온천',
  'Cleansing Gloves': '정화의 글러브',
  'Coating Metal Energy': '코팅 강철 에너지',
  'Collapsed Stadium': '붕괴된 스타디움',
  'Cram-o-matic': '로봇우구우구',
  'Cross Switcher': '크로스 스위처',
  Crossceiver: '크로스 트랜시버',
  'Crushing Gloves': '분쇄의 글러브',
  'Crystal Cave': '결정 동굴',
  'Cursed Shovel': '저주의 삽',
  'Damage Pump': '데미지펌프',
  'Dark Patch': '다크패치',
  'Digging Duo': '구멍파기 형제',
  'Digging Gloves': '구멍파기 글러브',
  'Double Turbo Energy': '더블 터보 에너지',
  'Dream Ball': '드림볼',
  'Dyna Tree Hill': '다이나나무 언덕',
  'Earthen Seal Stone': '대지의 봉인석',
  'Echoing Horn': '메아리나팔',
  'Egg Incubator': '부화장치',
  'Elemental Badge': '엘리멘탈 배지',
  'Emergency Jelly': '비상용 젤리',
  'Energy Loto': '에너지 로토무',
  'Evolution Incense': '진화향로',
  'Expedition Uniform': '방한복',
  'Familiar Bell': '친숙한 방울',
  'Fan of Waves': '몰아치는 파도의 부채',
  'Farewell Bell': '작별의 종',
  'Feather Ball': '페더볼',
  'Fire-Resistant Gloves': '내화의 글러브',
  'Fog Crystal': '안개 수정',
  'Forest Seal Stone': '숲의 봉인석',
  'Fresh Water Set': '맛있는 물 세트',
  'Friends in Galar': '가라르의 친구들',
  'Friends in Hisui': '히스이의 친구들',
  'Friends in Sinnoh': '신오의 친구들',
  'Full Face Guard': '헬멧',
  'Furisode Girl': '후리소데',
  'Fusion Strike Energy': '퓨전 에너지',
  'Galar Mine': '가라르 광산',
  'Gapejaw Bog': '벌어진 턱 늪',
  'Gift Energy': '선물 에너지',
  'Glimwood Tangle': '아라베스크마을 체육관',
  Gloria: '방순이',
  Gordie: '마쿠와',
  'Gutsy Pickaxe': '배짱의 곡괭이',
  'Heat Fire Energy': '히트 불꽃 에너지',
  'Hiding Darkness Energy': '하이드 악 에너지',
  Honey: '밀벅',
  'Horror Psychic Energy': '호러 초 에너지',
  'Hunting Gloves': '사냥의 글러브',
  'Jubilife Village': '축복마을',
  'Justified Gloves': '정의의 글러브',
  Kabu: '순무',
  Klara: '도볼',
  'Lake Acuity': '예지호수',
  'Leafy Camo Poncho': '위장 폰초',
  'League Staff': '리그 스태프',
  'Lost City': '로스트시티',
  'Lost Vacuum': '로스트 스위퍼',
  'Lucky Egg': '행운의알',
  'Lucky Energy': '럭키 에너지',
  'Lucky Ice Pop': '행운의 아이스',
  'Lum Berry': '리샘열매',
  'Lure Module': '루어모듈',
  'Magma Basin': '마그마의 폭포',
  'Memory Capsule': '메모리 캡슐',
  'Metal Saucer': '금속소서',
  'Mirage Gate': '미라주게이트',
  'Miss Fortune Sisters': '세 자매',
  'Moomoo Cheese': '튼튼밀크 치즈',
  'Moon & Sun Badge': '달과 태양의 배지',
  Nugget: '금구슬',
  'Old Cemetery': '오래된 무덤',
  'Old PC': '옛날 PC',
  'Ordinary Rod': '보통 낚싯대',
  'Panic Mask': '패닉마스크',
  'Path to the Peak': '정상을 향한 눈길',
  'Poké Kid': '포켓몬키드',
  'PokéStop': '포켓스톱',
  'Pot Helmet': '냄비 헬멧',
  'Power Tablet': '파워탭',
  'Powerful Colorless Energy': '파워풀 무색 에너지',
  'Primordial Altar': '태고의 제단',
  'Professor Burnet': '버넷박사',
  'Professor Laventon': '라벤박사',
  'Quad Stone': '4개의 돌',
  'Rapid Strike Energy': '연격 에너지',
  'Rapid Strike Scroll of Swirls': '연격의 권이·소용돌이',
  'Rapid Strike Scroll of the Flying Dragon': '연격의 권이·비룡',
  'Rapid Strike Scroll of the Skies': '연격의 권이·천공',
  'Rapid Strike Style Mustard': '마스터 마스터 (연격)',
  'Rare Fossil': '드문 카세키',
  'Regenerative Energy': '리제네레이트 에너지',
  'Rescue Carrier': '구조캐리어',
  'Ribbon Badge': '리본 배지',
  Riley: '현이',
  'Rose Tower': '로즈타워',
  'Rubber Gloves': '고무 글러브',
  'Rugged Helmet': '고쯔고쯔메트',
  'Rusted Shield': '녹슨 방패',
  'Rusted Sword': '녹슨 검',
  'Scoop Up Net': '회수네트',
  'Shopping Center': '쇼핑센터',
  'Single Strike Scroll of Piercing': '일격의 권이·관통',
  'Single Strike Scroll of Scorn': '일격의 권이·분노',
  'Single Strike Scroll of the Fanged Dragon': '일격의 권이·용아',
  'Single Strike Style Mustard': '마스터 마스터 (일격)',
  'Sitrus Berry': '자뭉열매',
  'Sky Seal Stone': '하늘의 봉인석',
  'Snow Leaf Badge': '눈과 잎의 배지',
  'Sordward & Shielbert': '실디 & 소드',
  Spark: '스파크',
  'Speed Lightning Energy': '스피드 번개 에너지',
  'Spicy Seasoned Curry': '매운 맛 카레',
  Spikemuth: '스파이크마을',
  'Spiral Energy': '스파이럴 에너지',
  'Spirit Mask': '저주의 탈',
  'Spongy Gloves': '해면 글러브',
  'Stone Fighting Energy': '스톤 격투 에너지',
  'Stormy Mountains': '폭풍의 산맥',
  'Struggle Gloves': '투지의 글러브',
  'Supereffective Glasses': '약점보험 안경',
  'Suspicious Food Tin': '수상한 통조림',
  'Switch Cart': '교체카트',
  'Switching Cups': '교체 컵',
  'Team Yell Towel': '옐단 타올',
  'Telescopic Sight': '망원렌즈',
  'Temple of Sinnoh': '신오의 신전',
  Thorton: '느지키', // ネジキ. 주리(マコモ=Fennel)·노간주(アデク=Alder)와 다른 인물이다
  'Tool Box': '도구상자',
  'Tool Jammer': '툴 재머',
  'Tower of Darkness': '악의 탑',
  'Tower of Waters': '물의 탑',
  'Toy Catcher': '토이 캐처',
  'Training Court': '트레이닝 코트',
  'Treasure Energy': '보물 에너지',
  'Turbo Patch': '터보패치',
  'Turffield Stadium': '터프마을 체육관',
  'Twin Energy': '트윈 에너지',
  'Urn of Vitality': '활력의 항아리',
  'V Guard Energy': 'V 가드 에너지',
  'Wait and See Turbo': '시간벌기터보',
  'Wash Water Energy': '워시 물 에너지',
  'Weeding Gloves': '제초 글러브',
  'Welcoming Lantern': '맞이하는 등불',
  'Windup Arm': '태엽 팔',
  'Wyndon Stadium': '슛스타디움',
  'Yell Horn': '옐단 나팔',
  'Adventure Bag': '모험의가방',
  'Aether Foundation Employee': '에테르재단 직원',
  'Aether Paradise Conservation Area': '에테르 파라다이스 보호구역',
  'Altar of the Moone': '월륜의 제단',
  'Altar of the Sunne': '일륜의 제단',
  'Ancient Crystal': '고대의 결정',
  'Apricorn Maker': '규토리 직공',
  'Aqua Patch': '아쿠아패치',
  'Beast Ball': '비스트볼',
  'Beast Bringer': '비스트 브링어',
  'Beast Energy ◇': '비스트 에너지 ◇',
  'Beast Ring': '비스트링',
  Beastite: '비스트나이트',
  'Bellelba & Brycen-Man': '애프터눈티',
  'Big Malasada': '큰 말라사다',
  'Bill\'s Analysis': '이수재의 분석',
  'Bill\'s Maintenance': '이수재의 메인터넌스',
  'Black Market ◇': '블랙마켓 ◇',
  'Blaine\'s Last Stand': '강철의 배수진',
  'Blaine\'s Quiz Show': '강철의 퀴즈',
  'Blizzard Town': '설화시티',
  'Blue\'s Tactics': '그린의 전략',
  'Bodybuilding Dumbbells': '머슬 아령',
  'Brock\'s Grit': '웅의 웅지',
  'Brock\'s Pewter City Gym': '웅의 회색시티 체육관',
  'Brock\'s Training': '웅의 단련',
  'Brooklet Hill': '잔물결영지',
  'Buff Padding': '바위 패딩',
  Channeler: '무당',
  'Chaotic Swell': '카오스스웰',
  'Cherish Ball': '프레셔스볼',
  'Chip-Chip Ice Axe': '단단한 얼음곡괭이',
  'Choice Helmet': '구애헬멧',
  'Coach Trainer': '코치 트레이너',
  'Counter Energy': '카운터 에너지',
  'Custom Catcher': '커스텀 캐처',
  'Cynthia & Caitlin': '난천 & 카틀레야',
  'Cyrus ◇': '태홍 ◇',
  'Damage Mover': '데미지스왑',
  Dana: '닥터',
  'Dangerous Drill': '데인저러스 드릴',
  'Dark City': '다크시티',
  'Dashing Pouch': '댓시 파우치',
  'Devolution Spray Z': '퇴화스프레이 Z',
  'Devoured Field': '약육강식의 들판',
  'Dragon Talon': '드래곤의 발톱',
  'Dragonium Z: Dragon Claw': '드래곤Z',
  'Draw Energy': '드로 에너지',
  'Dusk Stone': '어둠의돌',
  'Dust Island': '먼지섬',
  'Ear-Ringing Bell': '환각의 종',
  'Electric Memory': '전기 메모리',
  Electrocharger: '에렉키차저',
  'Electromagnetic Radar': '전자기 레이다',
  Electropower: '엘렉키파워',
  Eneporter: '에네포터',
  'Energy Recycle System': '에너지 회수 시스템',
  'Energy Spinner': '에너지 스피너',
  'Erika\'s Hospitality': '민화의 대접',
  'Escape Board': '탈출보드',
  Evelyn: '에블린',
  'Fairy Charm Ability': '페어리참 특성',
  'Fairy Charm Dragon': '페어리참 드래곤',
  'Fairy Charm Fighting': '페어리참 격투',
  'Fairy Charm Grass': '페어리참 풀',
  'Fairy Charm Lightning': '페어리참 번개',
  'Fairy Charm Psychic': '페어리참 초',
  'Fairy Charm UB': '페어리참 울트라비스트',
  'Fiery Flint': '불꽃 부싯돌',
  'Fighting Memory': '격투 메모리',
  'Fire Crystal': '불꽃 결정',
  'Fire Memory': '불꽃 메모리',
  'Flyinium Z: Air Slash': '비행Z',
  'Fossil Excavation Map': '카세키 발굴 지도',
  'Giant Bomb': '대형 폭탄',
  'Giant Hearth': '거대한 용광로',
  'Giovanni\'s Exile': '비주기의 추방',
  'Grass Memory': '풀 메모리',
  'Great Catcher': '그레이트 캐처',
  'Great Potion': '물약',
  'Green\'s Exploration': '불꽃의 탐구',
  'Guzma & Hala': '구즈마 & 할라',
  'Heat Factory ◇': '히트 공장 ◇',
  'Hustle Belt': '근성 머리띠',
  'Ingo & Emmet': '상행 & 상하',
  'Island Challenge Amulet': '아일랜드 챌린지 부적',
  'Jessie & James': '로사 & 로이',
  'Judge Whistle': '저지맨 호루라기',
  'Karate Belt': '가라테 띠',
  'Koga\'s Trap': '독수의 함정',
  'Lana\'s Fishing Rod': '수련의 낚싯대',
  'Lance ◇': '목호 ◇',
  'Last Chance Potion': '위기회복약',
  'Lavender Town': '보라타운',
  'Life Forest ◇': '생명의 숲 ◇',
  'Life Herb': '생명의 풀',
  Lisia: '루티아',
  Looker: '핸섬',
  'Looker Whistle': '핸섬 호루라기',
  'Lost Blender': '로스트 믹서',
  'Lt. Surge\'s Strategy': '마티스의 작전',
  'Lure Ball': '루어볼',
  'Lusamine ◇': '자몽 ◇',
  'Lysandre ◇': '플라드리 ◇',
  'Lysandre Labs': '플라드리 연구소',
  'Mallow & Lana': '마오 & 수련',
  'Martial Arts Dojo': '무도관 스타디움',
  'Memory Energy': '메모리 에너지',
  'Metal Core Barrier': '메탈코어 장벽',
  'Metal Frying Pan': '강철 프라이팬',
  'Metal Goggles': '메탈 고글',
  'Missing Clover': '행운의 클로버',
  'Misty & Lorelei': '이슬 & 칸나',
  'Mixed Herbs': '약초 혼합',
  Morgan: '모건',
  'Mount Lanakila': '라나키라마운틴',
  'Mt. Coronet': '천관산',
  'Multi Switch': '멀티 스위치',
  'Mysterious Treasure': '신비한 보물',
  Nita: '니타',
  'Normalium Z: Tackle': '노말Z',
  'Order Pad': '주문패드',
  'Peeking Red Card': '엿보기 레드카드',
  'Po Town': '포마을',
  'Poison Barb': '독침',
  'Pokémon Research Lab': '포켓몬 연구소',
  'Professor Elm\'s Lecture': '공박사의 가르침',
  'Professor Kukui': '쿠쿠이박사',
  'Professor Oak\'s Setup': '오박사의 세팅',
  'Psychic Memory': '초 메모리',
  'Rainbow Brush': '무지개 붓',
  'Recycle Energy': '리사이클 에너지',
  'Red & Blue': '레드 & 블루',
  'Red\'s Challenge': '레드의 도전',
  'Rescue Stretcher': '구조키트',
  'Reset Stamp': '리셋 스탬프',
  'Return Label': '반송 라벨',
  'Sabrina & Brycen': '초련 & 담죽',
  'Sabrina\'s Suggestion': '초련의 제안',
  'Samson Oak': '송호오',
  'Sea of Nothingness': '공허의 바다',
  'Shrine of Punishment': '응징의 사당',
  Sightseer: '관광객',
  'Sky Pillar': '하늘의 기둥',
  'Slumbering Forest': '수면의 숲',
  'Spell Tag': '저주의 부적',
  'Stadium Nav': '스타디움 네비',
  'Stealthy Hood': '은밀한 후드',
  'Super Boost Energy ◇': '슈퍼 부스트 에너지 ◇',
  'Super Scoop Up': '슈퍼회수',
  'Surprise Box': '깜짝 상자',
  'Switch Raft': '교체 뗏목',
  'Tag Call': '태그콜',
  'Tag Switch': '태그 스위치',
  'Tate & Liza': '풍 & 란',
  'Team Skull Grunt': '스컬단 조무래기',
  'The Masked Royal': '로열마스크',
  'Thunder Mountain ◇': '썬더 마운틴 ◇',
  'Tormenting Spray': '방해 스프레이',
  'Triple Acceleration Energy': '트리플 가속 에너지',
  'U-Turn Board': '유턴보드',
  'Ultra Space': '울트라스페이스',
  'Underground Expedition': '지하 탐험',
  'Unit Energy FightingDarknessFairy': '유닛 에너지 격투악페어리',
  'Unit Energy GrassFireWater': '유닛 에너지 풀불꽃물',
  'Unit Energy LightningPsychicMetal': '유닛 에너지 번개초강철',
  'Viridian Forest': '상록숲',
  'Wait and See Hammer': '살펴보기 해머',
  'Warp Energy': '워프 에너지',
  'Water Memory': '물 메모리',
  'Weakness Guard Energy': '약점 가드 에너지',
  'Weakness Policy': '약점보험',
  'Wela Volcano Park': '벨라 화산공원',
  Welder: '용접공',
  'Wishful Baton': '소원의 바통',
  'Wondrous Labyrinth ◇': '원더 라비린스 ◇',
  Zinnia: '피아나',
  'Ace Trainer': '엘리트 트레이너',
  'All-Night Party': '올나이트 파티',
  'Assault Vest': '돌격조끼',
  'Battle Compressor Team Flare Gear': '플레어단 기어 배틀압축기',
  'Battle Reporter': '배틀 리포터',
  'Bent Spoon': '구부러진 스푼',
  Blacksmith: '대장장이',
  Brigette: '이수진',
  'Buddy-Buddy Rescue': '친구친구 구조대',
  'Burning Energy': '버닝 에너지',
  'Bursting Balloon': '풍선 폭탄',
  'Captivating Poké Puff': '미혹의 포켓파플',
  Cassius: '칼름',
  'Chaos Tower': '카오스 타워',
  'Dangerous Energy': '데인저러스 에너지',
  'Devolution Spray': '퇴화스프레이',
  'Dimension Valley': '차원의 골짜기',
  'Double Dragon Energy': '더블 드래곤 에너지',
  'Eco Arm': '에코암',
  'Energy Pouch': '에너지 주머니',
  'Energy Reset': '에너지 리셋',
  Evosoda: '진화사이다',
  'Faded Town': '쇠퇴한 마을',
  'Fairy Drop': '페어리 드롭',
  'Fairy Garden': '페어리 가든',
  'Fiery Torch': '단단한 횃불',
  'Fighting Fury Belt': '투혼의 띠',
  'Fighting Stadium': '격투 도장',
  'Flash Energy': '플래시 에너지',
  'Float Stone': '가벼운돌',
  'Forest of Giant Plants': '거대식물의 숲',
  'Fossil Excavation Kit': '카세키 발굴 키트',
  'Fossil Researcher': '카세키 연구원',
  'Greedy Dice': '욕심쟁이 주사위',
  'Hand Scope': '핸드스코프',
  'Hard Charm': '단단한 부적',
  'Head Ringer Team Flare Hyper Gear': '플레어단 하이퍼기어 헤드링어',
  'Healing Scarf': '치료 머플러',
  'Heavy Boots': '헤비 부츠',
  'Herbal Energy': '허브 에너지',
  'Here Comes Team Rocket!': '로켓단이 온다!',
  'Hex Maniac': '오컬트 마니아',
  'Jamming Net Team Flare Hyper Gear': '플레어단 하이퍼기어 재밍넷',
  'Jaw Fossil': '턱카세키',
  'Magnetic Storm': '자기장 폭풍',
  'Max Elixir': '맥스 엘릭서',
  'Max Revive': '기력의 덩어리',
  'Mountain Ring': '산맥 링',
  'Mystery Energy': '미스터리 에너지',
  'Ninja Boy': '닌자소년',
  'Paint Roller': '페인트 롤러',
  'Parallel City': '파라렐 시티',
  'Pokémon Ranger': '포켓몬 레인저',
  'Power Memory': '파워 메모리',
  'Protection Cube': '프로텍트 큐브',
  // e카드 시절 타입별 굿즈 8종. 일본판과 같은 꼴(붙여쓰기)로 맞춘다.
  // 파이어·워터·라이트닝·사이킥은 사용자 확인(2026-08-01), 나머지 넷은 같은 규칙을 따랐다.
  'Star Piece': '별의조각',
  'Hand Extension': '핸드 익스텐션',
  'Mystery Plate': '미스터리 플레이트',
  'Puzzle of Time': '시간의 파즐',
  'Random Receiver': '랜덤수신기',
  'Red Card': '레드카드',
  'Repeat Ball': '리피트볼',
  'Reserved Ticket': '예매권',
  'Reverse Valley': '리버스 골짜기',
  'Robo Substitute Team Flare Gear': '플레어단 기어 로봇대타출동',
  'Rough Seas': '거친 바다',
  'Sail Fossil': '지느러미카세키',
  'Scorched Earth': '타오르는 들판',
  'Shadow Circle': '섀도 서클',
  'Shield Energy': '실드 에너지',
  'Shrine of Memories': '추억의 사당',
  'Silent Lab': '무음의 연구소',
  'Sky Field': '스카이필드',
  'Sparkling Robe': '반짝이는 로브',
  'Special Charge': '스페셜 차치',
  'Splash Energy': '스플래시 에너지',
  'Startling Megaphone': '메가폰',
  'Steel Shelter': '스틸 셸터',
  'Strong Energy': '스트롱 에너지',
  'Target Whistle Team Flare Gear': '플레어단 기어 타깃 호루라기',
  Teammates: '탑승 파트너',
  'Tool Retriever': '도구 회수',
  'Town Map': '타운맵',
  'Trainers\' Mail': '트레이너스 우체통',
  'Training Center': '트레이닝 센터',
  Trevor: '트로바',
  'Trick Coin': '트릭 코인',
  'Trick Shovel': '트릭 삽',
  'VS Seeker': '배틀서처',
  'Wide Lens': '와이드렌즈',
  'Wonder Energy': '원더 에너지',
  'Aspertia City Gym': '부채시티 체육관',
  'Battle City': '배틀시티',
  'Blend Energy Grass Fire Psychic Darkness': '혼합 에너지 풀불꽃초악',
  'Blend Energy Water Lightning Fighting Metal': '혼합 에너지 물번개격투강철',
  'Cedric Juniper': '주박사',
  'Colress Machine': '아크로마 머신',
  'Cover Fossil': '덮개카세키',
  'Crystal Edge': '크리스탈 엣지',
  'Crystal Wall': '크리스탈 월',
  'Dark Claw': '다크 클로',
  Ether: '에테르',
  Eviolite: '진화의휘석', // しんかのきせき. 게임 아이템 '진화의돌'(進化の石)과 다른 것이다
  'Frozen City': '얼어붙은 도시',
  'G Booster': 'G 부스터',
  'G Scope': 'G 스코프',
  'Giant Cape': '거대한 망토',
  'Gold Potion': '골드 포션',
  'Hooligans Jim & Cas': '갱단',
  Hugh: '휴',
  'Hypnotoxic Laser': '독가스 레이저',
  'Life Dew': '생명의 이슬',
  'Plasma Energy': '플라스마 에너지',
  'Plasma Frigate': '플라스마 프리깃함',
  'Plume Fossil': '깃털카세키',
  'Pokémon Center': '포켓몬센터',
  Recycle: '리사이클',
  'Rescue Scarf': '구조 머플러',
  'Reversal Trigger': '리버스 트리거',
  'Rock Guard': '로크 가드',
  'Shadow Triad': '다크트리니티',
  'Silver Bangle': '실버 뱅글',
  'Silver Mirror': '실버 미러',
  'Skyarrow Bridge': '스카이아로 브리지',
  'Team Plasma Badge': '플라스마단 배지',
  'Team Plasma Ball': '플라스마단 볼',
  'Team Plasma Grunt': '플라스마단 조무래기',
  'Tropical Beach': '트로피컬 비치',
  'Twist Mountain': '태엽산',
  'Victory Cup': '비토리컵',
  'Victory Piece': '비토리 피스',
  'Virbank City Gym': '모란만시티 체육관',
  Xtransceiver: '라이브캐스터',
  // Lithograph는 석판이다. 유적 그 자체는 Ruins of Alph 라는 다른 카드다.
  'Alph Lithograph': '알프의 석판',
  'Amulet Coin': '부적금화',
  'Ancient Technical Machine (Ice)': '고대 기술머신 (얼음)',
  'Ancient Technical Machine (Rock)': '고대 기술머신 (바위)',
  'Ancient Technical Machine (Steel)': '고대 기술머신 (강철)',
  'Armor Fossil': '방패의화석', // 발톱(Claw)이 아니라 방패다. 카세키=化石의 음역이었다.
  'Balloon Berry': '풍선 열매',
  'Battle Frontier': '배틀프런티어',
  'Battle Tower': '배틀타워',
  'Bench Shield': '벤치 실드',
  Berry: '나무열매',
  Bill: '이수재',
  'Black Belt': '태권왕',
  'Broken Time-Space': '시공의 왜곡',
  'Call Energy': '콜 에너지',
  Castaway: '조난자',
  'Cessation Crystal': '봉인의 결정',
  'Computer Error': '컴퓨터 오류',
  'Curse Powder': '저주의 가루',
  'Cyclone Energy': '사이클론 에너지',
  'Dark Metal Energy': '다크 메탈 에너지',
  Dawn: '빛나',
  'Dawn Stadium': '여명의 스타디움',
  'Desert Ruins': '사막의 유적',
  Digger: '구멍파기',
  'Dome Fossil': '껍질화석',
  'Dual Ball': '듀얼볼',
  'Energy Amplifier': '에너지 증폭기',
  'Energy Charge': '에너지 차치',
  'Energy Removal 2': '에너지 전송 2',
  'Energy Stadium': '에너지 스타디움',
  'Fast Ball': '스피드볼',
  Fossil: '카세키',
  Gambler: '도박사',
  'Gold Berry': '황금 열매',
  'Good Rod': '좋은 낚싯대',
  'Heal Energy': '치료 에너지',
  'Heal Powder': '치료 가루',
  'Helix Fossil': '조개화석',
  'Holon Energy FF': '홀론 에너지 FF',
  'Holon Energy GL': '홀론 에너지 GL',
  'Holon Energy WP': '홀론 에너지 WP',
  'Holon Mentor': '홀론의 스승',
  'Junk Arm': '정크암',
  'Lady Outing': '아가씨',
  Lass: '미니스커트',
  'Legend Box': '레전드 박스',
  'Light Ball': '전기구슬',
  'Lucky Stadium': '행운의 스타디움',
  'Miracle Berry': '기적의 열매',
  'Miracle Energy': '기적의 에너지',
  'Mr. Briney\'s Compassion': '하구의 배려',
  'Mr. Fuji': '등나무 노인',
  'Mt. Moon': '달맞이산',
  'Old Rod': '낡은 낚싯대',
  'Oran Berry': '오랭열매',
  'Pewter City Gym': '회색시티 체육관',
  'Poké Radar': '포켓몬 포레',
  'PokéGear': '포켓기어',
  'Pokémon Collector': '포켓몬 컬렉터',
  'Pokémon Flute': '포켓몬의 피리',
  'Pokémon Nurse': '포켓몬 간호사',
  'Pokémon Trader': '포켓몬 교환 아저씨',
  'Power Charge': '파워 차지',
  'Premier Ball': '프레미어볼',
  'Professor Birch': '털보박사',
  'Professor Elm': '공박사',
  'Professor Oak': '오박사',
  'Professor Rowan': '마박사',
  'Professor\'s Letter': '박사의 편지',
  'Rescue Energy': '리스큐 에너지',
  'Resistance Gym': '저항 체육관',
  Revitalizer: '회복약',
  'Roseanne\'s Research': '이슬의 조사',
  'Scramble Energy': '스크램블 에너지',
  'Secret Mission': '비밀 미션',
  'Scoop Up': '포켓몬 회수',
  'Skull Fossil': '두개골카세키',
  'Super Energy Removal': '슈퍼 에너지 제거',
  'Team Galactic Grunt': '갤럭시단 조무래기',
  'Team Rocket': '로켓단',
  'Time Capsule': '타임캡슐',
  'Town Volunteers': '마을의 봉사자',
  Windstorm: '폭풍',
  // ── 사용자가 확인해 준 공식 한글 카드명(2026-07-26) ──────────────────────
  // 애매했던 것들도 사용자가 하나로 특정해 줬다(2026-07-26).
  // Cyrano는 블루베리 아카데미 이사장으로 Clavell(클라벨)과 다른 인물이다.
  Cyrano: '시아노',
  'Heat Rotom': '히트 로토무',
  'Buddy-Buddy Poffin': '페포마을포핀',
  "Daisy's Help": '남나리의 도움', // 그린의 누나 남나리(2026-07-29 정정)
  'Grand Tree': '그랜드 트리',
  "Hop's Choice Band": '호프의 구애머리띠',
  "Team Rocket's Transceiver": '로켓단의 리시버',
  // 이름 전체가 정확히 일치할 때만 바뀌므로 다른 카드를 깨뜨리지 않는다.
  'Accompanying Flute': '동반의 피리',
  "Acerola's Mischief": '아세로라의 장난',
  Amarys: '네리네',
  'Amulet of Hope': '희망의 부적',
  // Antique(古びた)는 한국 정식 발매명이 '오래된'이다. 영문판 쪽에만 '복원된'이
  // 섞여 들어와 있었다(2026-07-28 정정).
  'Antique Cover Fossil': '오래된 덮개화석',
  'Antique Dome Fossil': '오래된 껍질화석',
  'Antique Helix Fossil': '오래된 조개화석',
  'Antique Old Amber': '오래된 비밀의호박',
  'Antique Root Fossil': '오래된 뿌리화석',
  'Area Zero Underdepths': '제로대공동',
  Artazon: '보울마을',
  "Arven's Sandwich": '페퍼의 샌드위치',
  'Babiri Berry': '바카열매',
  'Big Air Balloon': '커다란 풍선',
  "Bill's Transfer": '이수재의 전송',
  "Billy & O'Nare": '브라이어 & 오네어',
  'Binding Mochi': '사슬떡',
  "Black Belt's Training": '태권왕의 특훈',
  'Black Kyurem ex': '블랙큐레무 ex',
  'Bloodmoon Ursaluna': '다투곰 붉은 달',
  'Bloodmoon Ursaluna ex': '다투곰 붉은 달 ex',
  'Boomerang Energy': '부메랑 에너지',
  'Bravery Charm': '용기의 부적',
  'Brilliant Blender': '브릴리언트 블렌더',
  'Bug Catching Set': '곤충채집 세트',
  'Call Bell': '호출벨',
  Caretaker: '안내인',
  Carmine: '카민',
  'Castform Sunny Form': '캐스퐁 태양의 모습',
  'Chill Teaser Toy': '느긋풀',
  "Ciphermaniac's Codebreaking": '암호마니아의 해독',
  "Clemont's Quick Wit": '시트론의 재치',
  'Colbur Berry': '마코열매',
  'Community Center': '공통 센터',
  'Cornerstone Mask Ogerpon': '주징의 가면 오거폰',
  'Cornerstone Mask Ogerpon ex': '주징의 가면 오거폰 ex',
  'Counter Gain': '카운터 게인',
  'Cycling Road': '사이클링 로드',
  "Cynthia's Power Weight": '난천의 파워웨이트',
  'Deduction Kit': '추리키트',
  'Deluxe Bomb': '디럭스 폭탄',
  'Dragon Elixir': '용의 비약',
  'Dusk Ball': '다크볼',
  'Earthen Vessel': '대지의 용기',
  "Emcee's Hype": '사회자의 사회',
  'Energy Search Pro': '에너지 수색 프로',
  'Energy Sticker': '에너지 스티커',
  'Enriching Energy': '리치 에너지',
  "Erika's Invitation": '민화의 초대',
  "Ethan's Adventure": '심향의 모험',
  "Explorer's Guidance": '탐험가의 안내',
  'Fan Rotom': '스핀 로토무',
  'Festival Grounds': '축제 광장',
  'Fighting Gong': '격투 징',
  'Friends in Paldea': '팔데아의 동료들', // '○○의 동료들' 표기(2026-07-29 정정)
  "Giovanni's Charisma": '비주기의 카리스마',
  'Glass Trumpet': '유리 나팔',
  Grabber: '스내치암', // 포켓몬 카드 151 정식명(2026-07-29 정정)
  'Granite Cave': '바위동굴',
  'Gravity Gemstone': '중력의 보석',
  'Gravity Mountain': '중력 산',
  'Haban Berry': '야느와르열매',
  'Handheld Fan': '핸디 팬',
  'Hearthflame Mask Ogerpon': '화덕의 가면 오거폰',
  'Hearthflame Mask Ogerpon ex': '화덕의 가면 오거폰 ex',
  "Hop's Bag": '호프의 가방',
  'Hyper Aroma': '하이퍼 아로마',
  "Iris's Fighting Spirit": '아이리스의 투지',
  'Iron Defender': '무쇠 방어구',
  'Jamming Tower': '방해 타워',
  "Janine's Secret Art": '도희의 비술',
  "Jasmine's Gaze": '규리의 시선',
  'Jet Energy': '제트 에너지',
  Lacey: '타로',
  "Lana's Aid": '수련의 지원',
  "Larry's Skill": '청목의 요령',
  Leftovers: '먹다남은음식', // 2026-07-29 정정(먹고자=Munchlax가 섞여 있었다)
  'Legacy Energy': '레거시 에너지',
  'Letter of Encouragement': '응원 편지',
  "Lillie's Determination": '릴리에의 결의',
  "Lillie's Pearl": '릴리에의 진주',
  "Lisia's Appeal": '루치아의 어필',
  'Lively Stadium': '활기찬 스타디움',
  'Love Ball': '러브러브볼',
  "Lt. Surge's Bargain": '마티스의 거래',
  'Lucky Helmet': '행운의 헬멧',
  'Luminous Energy': '루미너스 에너지',
  'Max Rod': '맥스 낚싯대',
  'Maximum Belt': '맥시멈 벨트',
  'Meddling Memo': '참견 메모',
  'Mega Signal': '메가 시그널',
  'Megaton Blower': '메가톤 블로어',
  'Miracle Headset': '미라클 헤드셋',
  'Mow Rotom': '커트 로토무',
  'Mystery Garden': '신비의 정원',
  "N's Castle": 'N의 성',
  "N's PP Up": 'N의 포인트업',
  'Night Stretcher': '야간 들것',
  'Occa Berry': '바쿨열매',
  "Ogre's Mask": '오거의 가면',
  'Passho Berry': '어름열매',
  'Patrol Cap': '순찰모자',
  'Payapa Berry': '바나열매',
  'Pokémon League Headquarters': '포켓몬리그 본부',
  Postwick: '펄롱마을',
  'Precious Trolley': '프레셔스 카트',
  'Premium Power Pro': '프리미엄 파워 프로',
  'Prime Catcher': '프라임 캐처',
  "Professor Sada's Vitality": '올림박사의 기력',
  "Professor Turo's Scenario": '투로박사의 시나리오',
  'Protective Goggles': '방진고글',
  Raifort: '레포르',
  'Redeemable Ticket': '상환 티켓',
  Repel: '벌레퇴치스프레이',
  'Rescue Board': '구조 보드',
  'Rigid Band': '타이트밴드',
  'Risky Ruins': '위험한 유적',
  'Roto-Stick': '로토무 셀카봉',
  Ruffian: '불량배',
  'Sacred Ash': '성스러운재',
  'Scoop Up Cyclone': '회수 사이클론',
  'Scramble Switch': '스크램블 교체',
  'Secret Box': '시크릿 박스',
  'Sparkling Crystal': '반짝이는 결정',
  'Spikemuth Gym': '스파이크마을 체육관',
  'Spiky Energy': '스파이크 에너지',
  'Strange Timepiece': '이상한 시계',
  Surfer: '서퍼',
  'Surfing Beach': '파도타기 해변',
  'Survival Brace': '서바이벌 깁스',
  'TM Machine': '기술머신 머신',
  'Teal Mask Ogerpon': '벽록의 가면 오거폰',
  'Teal Mask Ogerpon ex': '벽록의 가면 오거폰 ex',
  "Team Rocket's Archer": '로켓단의 아폴로',
  "Team Rocket's Ariana": '로켓단의 아테나',
  "Team Rocket's Bother-Bot": '로켓단의 방해 로봇',
  "Team Rocket's Energy": '로켓단 에너지',
  "Team Rocket's Factory": '로켓단의 공장',
  "Team Rocket's Giovanni": '로켓단의 비주기',
  "Team Rocket's Great Ball": '로켓단의 수퍼볼',
  "Team Rocket's Petrel": '로켓단의 람다',
  "Team Rocket's Proton": '로켓단의 랜스',
  "Team Rocket's Venture Bomb": '로켓단의 깜짝봄',
  "Team Rocket's Watchtower": '로켓단의 감시탑',
  'Team Star Grunt': '스타단 조무래기',
  'Technical Machine: Fluorite': '기술머신 플로라이트',
  'Techno Radar': '테크노 레이더',
  'Tera Orb': '테라스탈 오브',
  'Town Store': '마을 상점',
  'Treasure Tracker': '보물 추적기',
  Tyme: '타임',
  'Unfair Stamp': '언페어 스탬프',
  'Vengeful Punch': '보복의 펀치',
  "Wally's Compassion": '민진의 자비',
  'Wash Rotom': '워시 로토무',
  'Wellspring Mask Ogerpon': '우물질의 가면 오거폰',
  'Wellspring Mask Ogerpon ex': '우물질의 가면 오거폰 ex',
  // 회복 아이템
  Potion: '상처약',
  'Super Potion': '좋은상처약',
  'Hyper Potion': '뛰어난상처약',
  'Max Potion': '최고상처약',
  'Full Heal': '만능제',
  // 볼
  'Poké Ball': '몬스터볼',
  'Great Ball': '슈퍼볼',
  'Ultra Ball': '하이퍼볼',
  'Master Ball': '마스터볼',
  'Quick Ball': '퀵볼',
  'Nest Ball': '네스트볼',
  'Net Ball': '넷볼',
  'Dive Ball': '다이브볼',
  'Level Ball': '레벨볼',
  'Luxury Ball': '럭셔리볼',
  'Timer Ball': '타이머볼',
  'Heavy Ball': '헤비볼',
  'Friend Ball': '프렌드볼',
  // 도구·기기
  'Rare Candy': '이상한사탕',
  Switch: '포켓몬 교체',
  PlusPower: '플러스파워',
  Defender: '디펜더',
  Pokédex: '포켓몬도감',
  'Pokégear 3.0': '포켓기어3.0',
  PokéNav: '포켓내비',
  'Pal Pad': '팔패드',
  'Super Rod': '대단한 낚싯대',
  'Air Balloon': '풍선',
  'Rocky Helmet': '울퉁불퉁멧', // 공식 카드 SV1V 073으로 확인
  'Pokémon Catcher': '포켓몬 캐처',
  'Crushing Hammer': '크래시해머',
  'Enhanced Hammer': '강화해머',
  'Tool Scrapper': '툴스크래퍼',
  'Field Blower': '필드블로어',
  'Trekking Shoes': '트레킹슈즈',
  'Strength Charm': '힘의 부적',
  'Escape Rope': '탈출용밧줄',
  'Warp Point': '워프포인트',
  'Energy Switch': '에너지 전환',
  'Energy Search': '에너지 서치',
  'Energy Retrieval': '에너지 회수',
  'Energy Recycler': '에너지 리사이클',
  'Energy Removal': '에너지 제거',
  Copycat: '카피캣',
  'Gym Badge': '체육관 배지',
  'Champions Festival': '챔피언스 페스티벌',
  'Pokémon Communication': '포켓몬 교환',
  'Quick Search': '퀵서치',
  // 에너지
  'Water Energy': '기본 물 에너지',
  'Fire Energy': '기본 불꽃 에너지',
  'Grass Energy': '기본 풀 에너지',
  'Lightning Energy': '기본 번개 에너지',
  'Psychic Energy': '기본 초 에너지',
  'Fighting Energy': '기본 격투 에너지',
  'Darkness Energy': '기본 악 에너지',
  'Metal Energy': '기본 강철 에너지',
  'Fairy Energy': '기본 페어리 에너지',
  'Dragon Energy': '기본 드래곤 에너지',
  'Rainbow Energy': '무지개 에너지',
  'Multi Energy': '멀티 에너지',
  'Double Colorless Energy': '더블 무색 에너지',
  'Double Rainbow Energy': '더블무지개 에너지',
  'Boost Energy': '부스트 에너지',
  'Basic Water Energy': '기본 물 에너지',
  'Basic Fire Energy': '기본 불꽃 에너지',
  'Basic Grass Energy': '기본 풀 에너지',
  'Basic Lightning Energy': '기본 번개 에너지',
  'Basic Psychic Energy': '기본 초 에너지',
  'Basic Fighting Energy': '기본 격투 에너지',
  'Basic Darkness Energy': '기본 악 에너지',
  'Basic Metal Energy': '기본 강철 에너지',
  // 화석
  'Mysterious Fossil': '신비의 화석',
  'Unidentified Fossil': '정체불명의 화석',
  'Root Fossil': '뿌리화석',
  'Claw Fossil': '발톱화석',
  'Old Amber': '비밀의호박',
  // 일반 역할 인물
  Fisherman: '낚시꾼',
  Lady: '귀부인',
  Beauty: '미인',
  Schoolboy: '남학생',
  Schoolgirl: '여학생',
  'TV Reporter': 'TV 리포터',
  'Gym Trainer': '체육관 트레이너',
  'Pokémon Fan Club': '포켓몬 팬클럽',
  'Pokémon Center Lady': '포켓몬센터 언니', // ポケモンセンターのお姉さん
  Maintenance: '메인터넌스',
  'Night Maintenance': '나이트 메인터넌스',
  Revive: '기력의 조각',
  // 일본판 경로는 이미 '저지맨'인데 영문판만 '심판꾼'이었다(사용자 지적).
  Judge: '저지맨',
  'Choice Band': '구애머리띠',
  'Power Plant': '발전소',
  'Computer Search': '컴퓨터 서치',
  // 일반 역할 인물 추가
  Worker: '인부',
  Cook: '요리사',
  Dancer: '댄서',
  Doctor: '의사',
  Delinquent: '불량소녀',
  Kindler: '불꽃술사',
};

// PokemonPriceTracker는 일본판 DB도 TCGPlayer 영문 표기로 내려준다("Charizard ex").
// SNKRDUNK 쪽 koreanizeTitle이 일본어 전용이라 여기엔 못 쓰므로, 영문 카드명을
// 한글 포켓몬 이름으로 치환하는 별도 경로를 둔다.
// 검색용 역방향 사전(한글 → 영문). 위 두 표는 "영문 카드명 → 한글"이라 화면 표시에만
// 쓰였고, 한글로 검색하면 영문 시세(eBay·TCGplayer)에서 아무것도 안 나왔다.
// ⚠️ 2글자 이하 이름(추명·이슬·모란 …)은 다른 말에 끼어들어 검색을 깨뜨리므로,
//    통째로 일치할 때만 쓰고 부분 치환에는 3글자 이상만 넣는다.

// 사용자가 공식 영문 카드명을 확인해 준 것들(2026-07-28). 자동 수집으로는 못 채운 카드다.
// 넣기 전에 PPT에 그 이름으로 실제 카드가 잡히는지 하나씩 확인했다 — 이름만 맞아도
// PPT에 그 카드가 없으면 검색은 여전히 0건이라, 확인된 것만 넣는다.
const USER_CONFIRMED_EN_TO_KO: Record<string, string> = {
  "Antique Dome Fossil": "오래된 껍질화석",
  "Antique Helix Fossil": "오래된 조개화석",
  "Battle Compressor": "배틀 컴프레서",
  "Bianca's Devotion": "벨의 진심",
  "Canceling Cologne": "캔슬코롱",
  "Cook": "쿡",
  "Daisy's Help": "남나리의 도움",
  "Digging Shovel": "구멍파는삽",
  "Grabber": "스내치암",
  "Haban Berry": "하반열매",
  "Hero's Cape": "히어로 망토",
  "Hop's Phantump": "호브의 나목령",
  "Hypnotoxic Laser": "데인저러스광선",
  "Leftovers": "먹다남은음식",
  "Moonlit Hill": "달이 빛나는 언덕",
  "Parallel City": "패럴렐시티",
  "Quad Stone": "쿼드스톤",
  "Repel": "벌레회피스프레이",
  "Technical Machine: Crisis Punch": "기술머신 위기극복한방",
  "Trainers' Mail": "트레이너즈 포스트",
  "Treasure Gadget": "트레져 가젯",
  "Unidentified Fossil": "수수께끼화석",
  "Volkner": "기선",
  "Wally's Compassion": "민진의 헤아림",
  "Worker": "작업원",
  "Xerosic's Machinations": "크세로시키의 속셈",
};


// 사용자가 확인해 줬지만 PPT에서는 그 이름으로 카드가 안 잡힌 것들. 이름이 틀려서가 아니라
// PPT에 그 세트 자료가 없기 때문으로 보인다(M-P 프로모, 스타터 세트 등).
// 지금도 검색이 0건이라 넣어서 나빠질 건 없고, PPT에 자료가 생기면 그때부터 걸린다.
const UNVERIFIED_EN_TO_KO: Record<string, string> = {
  "Celebratory Fanfare": "축하팡파르",
  "Larry's Professionalism": "청목의 수완",
  "Neutral Center": "뉴트럴센터",
  "Perfect Mixer": "퍼펙트믹서",
  "Perilous Ruins": "위험한 폐허",
  "PokeVital A": "포켓바이털A",
  "Precious Carry": "프레셔스캐리",
  "Regain Energy": "리게인 에너지",
  "Safety Goggles": "방진고글",
  "Super Rod MAX": "낚싯대MAX",
  "Tight Band": "타이트밴드",
  "Time-Gaining Turbo": "시간벌기터보",
  "Uncanny Clock": "괴상한 시계",
  "Uncharted Altar": "미개척의 제단",
  "Zett": "제트",
};


// 북미판·모바일 포켓 카드 이름(2026-07-28 사용자 확인). 2020년 이후 세트인데 영어 그대로
// 나오던 67종이다. 인물 이름은 한국 공식명을 따랐다(May=봄이, Lyra=금선, Zinnia=피아나,
// Grimsley=블랑사).
//
// ⚠️ 한글 이름이 이미 다른 영문에 매여 있는 것은 화면 표시(영문→한글)에만 쓴다.
// 검색(한글→영문)까지 바꾸면 먼저 확인해 둔 카드가 안 걸린다:
//   제트        일본판 Zett          / 북미판 Jett
//   구멍파는삽  일본판 Digging Shovel / 북미판 Hole-Digging Shovel
const ENGLISH_CARD_EN_TO_KO: Record<string, string> = {
  // 캐스퐁은 세트마다 앞뒤가 뒤집혀 온다("Castform Rain Form" / "Rain Castform").
  // 뒤집힌 쪽은 조각 치환으로 안 되므로 통째로 적는다.
  'Rain Castform': '빗방울 캐스퐁',
  'Snow-cloud Castform': '설운 캐스퐁',
  'Sunny Castform': '태양 캐스퐁',
  'Clefairy Doll': '삐삐인형',
  'Rotom Bike': '로토무 자전거',
  'Rotom Phone': '로토무 스마트폰',
  // 북미판 사전에 없어 뒷말이 영어로 남던 것.
  // 같은 카드의 다른 영문 표기(PPT와 TCGdex가 다르게 적어 온다). 한글은 같게 맞춘다.
  // PPT는 일본판 카드에 자기네 영문 이름을 붙인다. 그 이름이 화면에 그대로 뜨므로
  // 여기에도 짝을 달아 둔다(안 달면 eBay·TCGplayer 일본판 탭에서 영어로 보인다).
  "Clemont's Wit": '시트론의 재치',
  "Larry's Efficiency": '청목의 수완',
  'Fight Gong': '파이팅공',
  'Fishing Rod MAX': '낚싯대MAX',
  'Iron X Defense': '아이언 디펜더',
  'Vitality Forest': '활력의 숲',
  'Nidoran M': '니드런♂',
  'Nidoran F': '니드런♀',
  'Basic Grass Energy': '기본 풀 에너지',
  'Basic Fire Energy': '기본 불꽃 에너지',
  'Basic Water Energy': '기본 물 에너지',
  'Basic Lightning Energy': '기본 번개 에너지',
  'Basic Psychic Energy': '기본 초 에너지',
  'Basic Fighting Energy': '기본 격투 에너지',
  'Basic Darkness Energy': '기본 악 에너지',
  'Basic Metal Energy': '기본 강철 에너지',
  'Basic Fairy Energy': '기본 페어리 에너지',
  'Basic Dragon Energy': '기본 드래곤 에너지',
  "N's Plan": 'N의 방안',
  'Suspicious Watch': '이상한 시계',
  "Team Rocket's Receiver": '로켓단의 리시버',
  'Team Rocket Energy': '로켓단 에너지',
  'Deduction Set': '추리키트',
  'Spike Energy': '스파이크 에너지',
  "N's Plot": 'N의 방안',
  'Strange Timepiece': '이상한 시계',
  "Lt. Surge's Deal": '마티스의 거래',
  // ── 2026-07-28: 통째로 바꿔야 하는 것들 ────────────────────────────────
  // 말 순서가 뒤집히거나(네크로즈마 새벽의 날개) 붙여 써야 해서(메가터보),
  // 조각 치환으로는 안 되는 이름들이다.
  'Dawn Wings Necrozma': '네크로즈마 새벽의 날개',
  'Dawn Wings Necrozma GX': '네크로즈마 새벽의 날개 GX',
  'Dusk Mane Necrozma': '네크로즈마 황혼의 갈기',
  'Dusk Mane Necrozma GX': '네크로즈마 황혼의 갈기 GX',
  'Ash Greninja EX': '지우개굴닌자 EX',
  'Pikachu Libre': '옷차림 피카츄',
  'Pichu Bros.': '피츄 형제',
  'Pikachu with Grey Felt Hat': '회색 페레모를 쓴 피카츄',
  'Rotom Dex': '로토무도감',
  'Rotom Dex—Poké Finder Mode': '로토무 도감 포켓파인더 모드',
  "Lillie's Poké Doll": '릴리에의 삐삐인형',
  'Level Max': '레벨 MAX',
  'Mega Turbo': '메가터보',
  'Mega Catcher': '메가캐처',
  // 괄호 안 인물 이름. 카드마다 다른 박사가 들어간다.
  "Boss's Orders (Lysandre)": '보스의 지령 (플라드리)',
  "Boss's Orders (Giovanni)": '보스의 지령 (비주기)',
  "Professor's Research (Professor Oak)": '박사의 연구 (오박사)',
  "Professor's Research (Professor Magnolia)": '박사의 연구 (매놀리아박사)',
  "Professor's Research (Professor Juniper)": '박사의 연구 (주박사)',
  // ⚠️ 한글은 지어내지 않고 **일본판 쪽에 이미 있는 이름**을 그대로 가져왔다
  //    (SV1S 076 「博士の研究（オーリム博士）」 → "박사의 연구 (올림박사)").
  //    작가별 목록은 북미판 영문이라 여기 없으면 "(Professor Turo)"가 그대로 뜬다.
  "Professor's Research (Professor Sada)": '박사의 연구 (올림박사)',
  "Professor's Research (Professor Turo)": '박사의 연구 (투로박사)',
  // 같은 규칙 — 한글은 일본판 쪽에 이미 있는 이름을 그대로 가져왔다.
  //   SV1a 069 「ボスの指令（ゲーチス）」  → "보스의 지령 (게치스)"
  //   S12a 161 「ボスの指令（アカギ）」    → "보스의 지령 (태홍)"
  //   SM8b 086 「ネクロズマ たそがれのたてがみGX」 → "네크로즈마 황혼의 갈기 GX"
  // ⚠️ 네크로즈마는 **일본판 어순**으로 적는다. 세트별·포켓몬명 목록이 그 이름으로
  //    나오므로, 여기만 "황혼의 갈기 네크로즈마"로 적으면 같은 카드가 화면마다
  //    다르게 보인다(2026-08-07 두 목록을 견줘 확인).
  "Boss's Orders (Ghetsis)": '보스의 지령 (게치스)',
  "Boss's Orders (Cyrus)": '보스의 지령 (태홍)',
  'Dusk Mane Necrozma-GX': '네크로즈마 황혼의 갈기 GX',
  'Dawn Wings Necrozma-GX': '네크로즈마 새벽의 날개 GX',
  'Dusk Mane Necrozma': '네크로즈마 황혼의 갈기',
  'Dawn Wings Necrozma': '네크로즈마 새벽의 날개',
  // B: 피오니(아버지)와 피오니아(딸)는 다른 인물이라 이름이 겹치면 안 된다.
  'Power Charge': '파워 차지',
  // C: 같은 한글명으로 겹치던 것들. 겹치는 쪽에 구분을 붙인다.
  'EXP. ALL': '학습장치 (EXP. ALL)',
  'EXP.ALL': '학습장치 (EXP. ALL)',
  'Fisherman': '낚시꾼',
  'Traveling Merchant': '행상인 (Merchant)',
  'Traveling Salesman': '행상인',
  // 이 카드는 괄호까지가 원본 이름이다(neo4 096).
  "Thought Wave Machine (Rocket's Secret Machine)": "사고파 머신 (로켓단의 비밀메카)",

  // 옛 북미판 카드 5·6차 96종 — 2026-07-28 사용자 확인.
  "Apricorn Forest": "규토리의 숲", // 일본판(アプリコーンの森)과 같게 맞춤
  "Arcade Game": "오락실 게임",
  "Bill's Teleporter": "이수재의 텔레포터",
  "Blaine's Gamble": "강연의 도박",
  "Blaine's Last Resort": "강연의 궁극책",
  "Blaine's Quiz #1": "강연의 퀴즈 #1",
  "Blaine's Quiz #2": "강연의 퀴즈 #2",
  "Blaine's Quiz #3": "강연의 퀴즈 #3",
  "Bounce Energy": "바운스 에너지",
  "Brock's Protection": "웅의 보호",
  "Brock's Training Method": "웅의 육성법",
  "Broken Ground Gym": "갈라진 땅 체육관",
  "Card-Flip Game": "카드 뒤집기 게임",
  "Celadon City Gym": "무지개시티 체육관",
  "Cerulean City Gym": "블루시티 체육관",
  "Chaos Gym": "카오스 체육관",
  "Cinnabar City Gym": "홍련섬 체육관",
  "Counterattack Claws": "반격의 손톱",
  "Crystal Energy": "크리스탈 에너지",
  "Darkness Cube 01": "다크니스큐브 01",
  "Ecogym": "에코 체육관",
  "Energy Ark": "에너지 방주",
  "Energy Flow": "에너지의 흐름",
  "Erika's Kindness": "민화의 상냥함",
  "Erika's Maids": "민화의 하녀들",
  "Erika's Perfume": "민화의 향수",
  "Fervor": "열정",
  "Fighting Cube 01": "파이팅큐브 01",
  "Fire Cube 01": "파이어큐브 01",
  "Forest Guardian": "숲의 수호자",
  "Fossil Egg": "화석 알",
  "Fuchsia City Gym": "연분홍시티 체육관",
  "Giovanni's Last Resort": "비주기의 궁극책",
  "Good Manners": "올바른 예의",
  "Goop Gas Attack": "끈적끈적 가스 공격",
  "Grass Cube 01": "그라스큐브 01",
  "Healing Berry": "회복 열매",
  "Healing Field": "회복의 필드",
  "Hyper Devolution Spray": "하이퍼 퇴화스프레이",
  "Imposter Oak's Revenge": "가짜 오박사의 복수",
  "Imposter Professor Oak": "가짜 오박사",
  "Impostor Professor Oak's Invention": "가짜 오박사의 발명품",
  "Koga's Ninja Trick": "독수의 닌자 술법",
  "Lightning Cube 01": "라이트닝큐브 01",
  "Lt. Surge's Secret Plan": "마티스의 비밀작전",
  "Lt. Surge's Treaty": "마티스의 조약",
  "Magnifier": "돋보기",
  "Mail from Bill": "이수재의 편지",
  "Mary": "호두",
  "Mary's Impulse": "호두의 충동",
  "Metal Cube 01": "메탈큐브 01",
  "Minion of Team Rocket": "로켓단의 부하",
  "Mystery Plate Beta": "미스터리 플레이트 베타",
  "Mystery Plate Delta": "미스터리 플레이트 델타",
  "Mystery Plate Gamma": "미스터리 플레이트 감마",
  "Mystery Zone": "미스터리 존",
  "Narrow Gym": "좁은 체육관",
  "New Pokédex": "신형 포켓몬도감",
  "Nightly Garbage Run": "밤의 쓰레기 회수",
  "No Removal Gym": "제거 불가 체육관",
  "Oracle": "신탁",
  "Pokémon Breeder Fields": "포켓몬 브리더의 초원",
  "Pokémon March": "포켓몬 행진곡",
  "Pokémon Personality Test": "포켓몬 성격 진단",
  "Pokémon Tower": "포켓몬타워",
  "Psychic Cube 01": "사이킥큐브 01",
  "Radio Tower": "라디오타워",
  "Recall": "리콜",
  "Retro Energy": "레트로 에너지",
  "Rocket's Minefield Gym": "로켓단의 지뢰밭 체육관",
  "Rocket's Secret Experiment": "로켓단의 비밀실험",
  "Ruin Wall": "유적의 벽",
  "Sabrina's ESP": "초련의 초능력",
  "Sabrina's Gaze": "초련의 시선",
  "Sabrina's Psychic Control": "초련의 염동력 조종",
  "Saffron City Gym": "노랑시티 체육관",
  "Seer": "예언자",
  "Sleep!": "재워라!",
  "Sprout Tower": "모다피의탑",
  "Star Piece": "별의 조각",
  "Super Energy Removal 2": "초에너지 회수 2",
  "The Rocket's Training Gym": "로켓단의 단련 체육관",
  "The Rocket's Trap": "로켓단의 함정",
  "Thought Wave Machine": "사고파 머신",
  "Tickling Machine": "간지럼 머신",
  "Time Shard": "시간의 조각",
  "Transparent Walls": "투명한 벽",
  "Trash Exchange": "쓰레기 교환",
  "Underground Lake": "지하 호수",
  "Undersea Ruins": "해저 유적",
  "Vermilion City Gym": "갈색시티 체육관",
  "Viridian City Gym": "상록시티 체육관",
  "Water Cube 01": "워터큐브 01",
  "Weakness Guard": "약점 가드",

  // 일본 원판 'がくしゅうそうち' 하나를 북미판이 시대에 따라 다르게 불렀다.
  // 한국 이름은 둘 다 '학습장치'라 화면에는 같이 나오고, 검색은 먼저 있던 Exp. Share 를 쓴다.

  // 옛 북미판 카드 4차 49종 — 2026-07-28 사용자 확인.
  // 'Prof. Oak's Research'는 'Professor Oak's Research'와 같은 카드의 다른 표기다.
  // 둘 다 '오박사의 연구'로 보이게 두고, 검색(한글→영문)은 먼저 있던 쪽을 쓴다.
  "Ancient Ruins": "고대의 유적",
  "Ancient Tomb": "고대의 무덤",
  "Aqua Energy": "아쿠아 에너지",
  "Buried Fossil": "파묻힌 화석",
  "Championship Arena": "챔피언십 아레나",
  "Desert Shaman": "사막의 주술사",
  "Energy Root": "에너지 뿌리",
  "Fluffy Berry": "푹신푹신 열매",
  "Holon Research Tower": "홀론 연구탑",
  "Holon Researcher": "홀론의 연구원",
  "Holon Ruins": "홀론의 유적",
  "Holon Scientist": "홀론의 과학자",
  "Holon Transceiver": "홀론 트랜시버",
  "Island Cave": "작은섬 동굴",
  "Magma Energy": "마그마 에너지",
  "Mary's Request": "호두의 부탁",
  "Meteor Falls": "유성폭포",
  "Miracle Sphere Alpha": "미라클 스피어 알파",
  "Miracle Sphere Beta": "미라클 스피어 베타",
  "Miracle Sphere Gamma": "미라클 스피어 감마",
  "Mirage Stadium": "미라주 스타디움",
  "Mystery Plate Alpha": "미스터리 플레이트 알파",
  "PokéDex (HANDY909)": "포켓몬도감 (HANDY909)",
  "Pokémon Retriever": "포켓몬 리트리버",
  "Pow! Hand Extension": "파우! 핸드 익스텐션",
  "Prof. Oak's Research": "오박사의 연구",
  "Protective Orb": "수호의 구슬",
  "R Energy": "R 에너지",
  "Relic Hunter": "유적 탐사원",
  "Rocket's Mission": "로켓단의 미션",
  "Rocket's Poké Ball": "로켓단의 몬스터볼",
  "Rocket's Tricky Gym": "로켓단의 트릭 체육관",
  "Solid Rage": "솔리드 분노",
  "Space Center": "우주센터",
  "Surprise! Time Machine": "깜짝! 타임머신",
  "Swoop! Teleporter": "스우프! 텔레포터",
  "Team Aqua Ball": "아쿠아단 볼",
  "Team Aqua Belt": "아쿠아단 벨트",
  "Team Aqua Conspirator": "아쿠아단의 공모자",
  "Team Aqua Hideout": "아쿠아단 아지트",
  "Team Aqua Schemer": "아쿠아단의 책사",
  "Team Aqua's Technical Machine 01": "아쿠아단의 기술머신 01",
  "Team Magma Ball": "마그마단 볼",
  "Team Magma Belt": "마그마단 벨트",
  "Team Magma Conspirator": "마그마단의 공모자",
  "Team Magma Hideout": "마그마단 아지트",
  "Team Magma Schemer": "마그마단의 책사",
  "Team Magma's Technical Machine 01": "마그마단의 기술머신 01",
  "Venture Bomb": "벤처 폭탄",

  // 옛 북미판 카드 3차 50종 — 2026-07-28 사용자 확인.
  "Bubble Coat": "버블 코트",
  "Buck's Training": "맥의 수련",
  "Conductive Quarry": "전도 채석장",
  "Crystal Beach": "크리스탈 해변",
  "Cursed Stone": "저주받은 돌",
  "Drake's Stadium": "권수의 스타디움",
  "Energy Link": "에너지 링크",
  "Energy Pickup": "에너지 줍기",
  "Felicity's Drawing": "미지의 지혜",
  "Full Flame": "풀 프레임",
  "Giant Stump": "거대한 밑동",
  "Glacia's Stadium": "미혜의 스타디움",
  "Health Energy": "헬스 에너지",
  "Holon Adventurer": "홀론의 모험가",
  "Holon Circle": "홀론 서클",
  "Holon Farmer": "홀론의 농부",
  "Holon Fossil": "홀론의 화석",
  "Holon Lake": "홀론 호수",
  "Holon Lass": "홀론의 아가씨",
  "Holon Legacy": "홀론의 유산",
  "Island Hermit": "섬의 은둔자",
  "Lake Boundary": "호수 경계",
  "Looker's Investigation": "핸섬의 수사",
  "Marley's Request": "마이의 부탁",
  "Miasma Valley": "독기 계곡",
  "Mom's Kindness": "엄마의 상냥함",
  "Moonlight Stadium": "달빛 스타디움",
  "Mysterious Shard": "신비한 조각",
  "Night Pokémon Center": "야간 포켓몬센터",
  "Phoebe's Stadium": "회연의 스타디움",
  "Poké Blower +": "포켓블로어 +",
  "Poké Drawer +": "포켓드로어 +",
  "Poké Healer +": "포켓힐러 +",
  "Pokémon Rescue": "포켓몬 구조",
  "Power Tree": "파워 트리",
  "React Energy": "리액트 에너지",
  "Recover Energy": "리커버 에너지",
  "Sidney's Stadium": "혁진의 스타디움",
  "Snowpoint Temple": "선단신전",
  "Speed Stadium": "스피드 스타디움",
  "Stark Mountain": "하드마운틴",
  "Strange Cave": "이상한 동굴",
  "Team Galactic's Invention G-101 Energy Gain": "갤럭시단의 발명 G-101 에너지 게인",
  "Team Galactic's Invention G-103 Power Spray": "갤럭시단의 발명 G-103 파워 스프레이",
  "Team Galactic's Invention G-105 Poké Turn": "갤럭시단의 발명 G-105 포켓턴",
  "Team Galactic's Mars": "마스의 도발",
  "Team Galactic's Wager": "갤럭시단의 내기",
  "Technical Machine TS-1": "기술머신 TS-1",
  "Technical Machine TS-2": "기술머신 TS-2",
  "Time-Space Distortion": "시공의 일그러짐",

  // 옛 북미판 카드 2차 50종 — 2026-07-28 사용자 확인.
  "Aaron's Collection": "충호의 컬렉션",
  "Aqua Diffuser": "아쿠아 디퓨저",
  "Bertha's Warmth": "들국화의 온기",
  "Burned Tower": "불타버린탑",
  "Champion's Room": "챔피언의 방",
  "Charon's Choice": "플루토의 선택",
  "Cyrus's Conspiracy": "태홍의 음모",
  "Cyrus's Initiative": "태홍의 선제",
  "Department Store Girl": "백화점 소녀",
  "Double Aqua Energy": "더블 아쿠아 에너지",
  "Double Magma Energy": "더블 마그마 에너지",
  "Emcee's Chatter": "사회자의 수다",
  "Energy Exchanger": "에너지 교환기",
  "Energy Returner": "에너지 리턴",
  "Engineer's Adjustments": "정비사의 조정",
  "First Ticket": "우선 티켓",
  "Flint's Willpower": "대엽의 의지",
  "Flower Shop Lady": "꽃집 언니", // 花屋のおねえさん
  "Galactic HQ": "갤럭시단 아지트",
  "Ho Oh": "칠색조",
  "Indigo Plateau": "석영고원",
  "Lost Remover": "로스트 리무버",
  "Lost World": "로스트 월드",
  "Lucian's Assignment": "오엽의 지시",
  "Magma Pointer": "마그마 포인터",
  "Night Teleporter": "야간 텔레포터",
  "Palmer's Contribution": "종수의 공헌",
  "Pokégear3.0": "포켓기어3.0",
  "Pokémon Circulator": "포켓몬 서큘레이터",
  "Pokémon Contest Hall": "포켓몬 콘테스트 회장",
  "Psychic's Third Eye": "초능력자의 제3의 눈",
  "Research Record": "연구 기록",
  "Ruins of Alph": "알프의 유적",
  "SP Energy": "SP 에너지",
  "Seeker": "탐색자",
  "Sunyshore City Gym": "물개향도시체육관",
  "Team Aqua Admin": "아쿠아단 간부",
  "Team Aqua Grunt": "아쿠아단 조무래기",
  "Team Aqua's Great Ball": "아쿠아단의 슈퍼볼",
  "Team Aqua's Secret Base": "아쿠아단의 비밀기지",
  "Team Galactic's Invention G-107 Technical Machine": "갤럭시단의 발명 G-107 기술머신",
  "Team Galactic's Invention G-109 SP Radar": "갤럭시단의 발명 G-109 SP레이더",
  "Team Magma Admin": "마그마단 간부",
  "Team Magma Grunt": "마그마단 조무래기",
  "Team Magma's Great Ball": "마그마단의 슈퍼볼",
  "Team Magma's Secret Base": "마그마단의 비밀기지",
  "Twins": "쌍둥이",
  "Upper Energy": "어퍼 에너지",
  "Volkner's Philosophy": "전진의 철학",

  // 옛 북미판 카드(2016년 이전) 1차 50종 — 2026-07-28 사용자 확인.
  "AZ": "AZ",
  "Archie's Ace in the Hole": "아강의 에이스",
  "Bebe's Search": "베베의 검색",
  "Beginning Door": "시작의 문",
  "Buffer Piece": "버퍼 피스",
  "Celio's Network": "보라의 네트워크",
  "Challenge!": "도전!",
  "Cheerleader's Cheer": "치어리더의 응원",
  "Crystal Shard": "크리스탈 조각",
  "Double Full Heal": "더블 만병통치약",
  "Floral Crown": "꽃화관",
  "Fossil Excavator": "화석 발굴가",
  "Full Heal Energy": "만병통치 에너지",
  "Giovanni's Scheme": "비주기의 계획",
  "High Pressure System": "고기압",
  "Imakuni?": "이마쿠니?",
  "Impostor Professor Oak": "가짜 오박사",
  "Interviewer's Questions": "인터뷰어의 질문",
  "Lanette's Net Search": "유미의 넷 검색",
  "Lass's Special": "미니스커트의 특별함",
  "Low Pressure System": "저기압",
  "Lysandre's Trump Card": "플라드리의 트럼프카드",
  "Maxie's Hidden Ball Trick": "마적의 비장의 카드",
  "Memory Berry": "메모리베리", // 사용자 확인 2026-08-01
  "Mr. Stone's Project": "나성호의 프로젝트",
  "Multi Technical Machine 01": "멀티 기술머신 01",
  "N": "N",
  "Pokédex HANDY910is": "포켓몬도감 HANDY910is",
  "Pokémon Park": "포켓몬 파크",
  "Pokémon Reversal": "포켓몬 반전",
  "Potion Energy": "상처약 에너지",
  "Professor Birch's Observations": "털보박사의 관찰",
  "Professor Cozmo's Discovery": "코스모박사의 발견",
  "Professor Elm's Training Method": "공박사의 육성법",
  "Professor Oak's Hint": "오박사의 힌트",
  "Professor Oak's New Theory": "오박사의 신이론",
  "Professor Oak's Research": "오박사의 연구",
  "Professor Oak's Visit": "오박사의 방문",
  "Rival": "라이벌",
  "Rocket's Admin.": "로켓단의 간부",
  "Rocket's Hideout": "로켓단 아지트",
  "Rocket's Sneak Attack": "로켓단의 야습",
  "Sage's Training": "현인의 수련",
  "Scott": "에니시이다",
  "The Boss's Way": "두목의 수단",
  "Tropical Tidal Wave": "열대의 해일",
  "Tropical Wind": "열대 바람",
  "Ultimate Zone": "궁극의 영역",
  "Wally's Training": "민진의 수련",
  "δ Rainbow Energy": "델타 레인보우 에너지",

  "Acerola's Premonition": "아세로라의 예감",
  "Adventurer's Discovery": "모험가의 발견",
  "Adversity Policy": "역경보험",
  "Backtrack Badge": "역행의 배지",
  "Battle Cage": "배틀 케이지",
  "Beast Wall": "비스트 월",
  "Blowtorch": "블로토치",
  "Bubbly Water Energy": "버블 물 에너지",
  "Budding Expeditioner": "신입 탐험가",
  "Celestic Town Elder": "봉신마을 장로",
  "Clemont's Backpack": "시트론의 배낭",
  "Colress's Tenacity": "아크로마의 집념",
  "Dark Pendant": "다크 펜던트",
  "Electrical Cord": "전원 코드",
  "Elemental Switch": "엘리멘탈 스위치",
  "Fishing Net": "낚싯바구니",
  "Flame Patch": "불꽃의 패치",
  "Fossil Quarry": "화석 채굴장",
  "Gladion's Final Battle": "글라디오의 결전",
  "Great Haul Net": "대어 포획망",
  "Grimsley's Move": "블랑사의 수",
  "Growing Grass Energy": "그로잉 풀 에너지",
  "Heavy Helmet": "헤비헬멧",
  "Hero's Medal": "영웅의 메달",
  "Hitting Hammer": "타격 망치",
  "Hole-Digging Shovel": "구멍파는삽",
  "Inflatable Boat": "고무보트",
  "Jett": "제트",
  "Juggler": "저글러",
  "Karen's Conviction": "카린의 신념",
  "Korrina's Focus": "코르니의 기합",
  "Leaf": "리프",
  "Leaf Cape": "나뭇잎 망토",
  "Lucky Mittens": "행운의 장갑",
  "Lyra": "금선",
  "Magnetic Metal Energy": "마그넷 강철 에너지",
  "May": "봄이",
  "Memory Light": "추억의 빛",
  "Mythical Slab": "환상의 석판",
  "Nemona's Backpack": "네모의 가방",
  "Nighttime Mine": "심야의 광산",
  "Nitro Fire Energy": "나이트로 불꽃 에너지",
  "Peculiar Plaza": "기묘한 광장",
  "Poké Pad": "포켓패드",
  "Pokémon Breeder's Nurturing": "포켓몬 브리더의 육성",
  "Prank Spinner": "장난 팽이",
  "Protective Poncho": "프로텍트 우비",
  "Quick-Grow Extract": "속성 성장 엑기스",
  "Red": "레드",
  "Rocky Fighting Energy": "록 격투 에너지",
  "Shadowy Darkness Energy": "딥 다크 에너지",
  "Silver": "실버",
  "Skaters' Park": "스케이터 파크",
  "Squirt Bottle": "꼬부기물조우",
  "Starting Plains": "시작의 평원",
  "Steel Apron": "스틸 에이프런",
  "Team Yell's Cheer": "터프에일의 성원",
  "Telepathic Psychic Energy": "텔레파시 초 에너지",
  "Thick Scale": "두꺼운비늘",
  "Training Area": "트레이닝 에리어",
  "Transformation Tome": "변신의 서",
  "Tremendous Bomb": "폭발적인 폭탄",
  "Voltaic Lightning Energy": "볼텍스 번개 에너지",
  "Waitress": "웨이트리스",
  "X Speed": "스피드업",
  "Zinnia's Resolve": "피아나의 결의",
};

const KO_KEEPS_OLD = new Set([
  '제트',
  '구멍파는삽',
  '학습장치',
  '오박사의 연구',
  '행상인', // Traveling Salesman(구분자 붙인 Merchant 쪽은 이제 안 겹친다)
  '가짜 오박사', // Impostor / Imposter (철자만 다르다)
]);

const EARLIER_TABLES = {
  ...TRAINER_EN_TO_KO,
  ...ITEM_EN_TO_KO,
  ...USER_CONFIRMED_EN_TO_KO,
  ...UNVERIFIED_EN_TO_KO,
};
const earlierKoNames = new Set(Object.values(EARLIER_TABLES));
// ⚠️ 전개(...)는 뒤에 온 것이 이기는데, 화면 쪽 조회는 앞에 쓴 표가 이긴다(?? 순서).
// 그대로 두면 같은 영문 카드가 두 표에 다르게 들어 있을 때 화면과 검색이 서로 다른
// 한글을 골라, 화면에 보이는 이름으로 검색하면 아무것도 안 나온다.
// (Volkner가 화면에선 '전진', 검색 사전에선 '기선'이었다.)
// 그래서 화면 조회 순서를 뒤집어 전개한다 — 뒤에 올수록 화면에서 먼저 보는 표다.
const koToEnEntries: [string, string][] = Object.entries({
  // 한글이 겹치는 것은 앞쪽 표를 살리려고 역방향에서 뺀다. 단 앞쪽 표에 그 한글이
  // 아예 없으면 빼면 안 된다 — 빼는 순간 역방향이 통째로 사라져, 한글로 검색했을 때
  // "오박사의 연구"가 "오Professor's Research"처럼 조각나 버린다(부분 치환으로 흘러서다).
  ...Object.fromEntries(
    Object.entries(ENGLISH_CARD_EN_TO_KO).filter(
      ([, ko]) => !(KO_KEEPS_OLD.has(ko) && earlierKoNames.has(ko)),
    ),
  ),
  ...UNVERIFIED_EN_TO_KO,
  ...USER_CONFIRMED_EN_TO_KO,
  ...ITEM_EN_TO_KO,
  ...TRAINER_EN_TO_KO,
}).map(([en, ko]) => [ko, en]);
// 같은 한글에 영문이 여럿 달리면 Map은 마지막 것을 쓴다. 괄호가 붙은 변형판
// ("N's Zorua (Poke Ball Pattern)")이 이기면 검색이 그 변형판으로만 가므로,
// 괄호 있는 것을 앞으로 보내 기본판이 마지막에 남게 한다.
koToEnEntries.sort((a, b) => Number(b[1].includes('(')) - Number(a[1].includes('(')));
export const CARD_NAME_KO_TO_EN = new Map<string, string>(koToEnEntries);
// 같은 카드인데 띄어쓰기가 달라 검색이 빗나가는 걸 막는다. 화면에는 "테라스탈오브"로
// 나오는데 사전 키는 "테라스탈 오브"라 한글로 치면 eBay·TCGplayer에서 아무것도 안 나왔다.
// 가운뎃점(·)도 판마다 있고 없고 해서 같이 지운다.
export const CARD_NAME_KO_TO_EN_NOSPACE = new Map<string, string>(
  koToEnEntries.map(([ko, en]) => [ko.replace(/[\s·]/g, ''), en]),
);
export const CARD_NAME_KO_TO_EN_LONG: [string, string][] = koToEnEntries
  .filter(([ko]) => ko.replace(/\s/g, '').length >= 3)
  .sort((a, b) => b[0].length - a[0].length);

// 대소문자를 무시하되 앞뒤가 알파벳이면 건너뛴다. 그냥 대소문자만 풀면
// "Aaron's Collection"의 aron이 가보리(Aron)로 잡혀 "A가보리's"가 된다.
const pokemonEnPatterns = sortedPokemonEnKo.map((entry) => ({
  re: new RegExp(`(?<![A-Za-z])${entry.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'gi'),
  ko: entry.ko,
}));

// 사전 여섯 곳을 정해진 순서로 뒤진다(앞에 쓴 표가 이긴다).
function lookupExact(key: string): string | undefined {
  return (
    AUTO_EN_TO_KO.get(key) ??
    TRAINER_EN_TO_KO[key] ??
    ITEM_EN_TO_KO[key] ??
    USER_CONFIRMED_EN_TO_KO[key] ??
    UNVERIFIED_EN_TO_KO[key] ??
    ENGLISH_CARD_EN_TO_KO[key]
  );
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');

// 악센트를 뗀 표기 → 사전에 든 정식 표기. PPT가 "Pokemon Catcher"처럼 악센트 없이
// 주는데 우리 사전 키는 "Pokémon Catcher"라 그냥은 안 맞는다.
const accentKeys = new Map<string, string>();
for (const table of [TRAINER_EN_TO_KO, ITEM_EN_TO_KO, USER_CONFIRMED_EN_TO_KO, UNVERIFIED_EN_TO_KO, ENGLISH_CARD_EN_TO_KO]) {
  for (const key of Object.keys(table)) {
    const plain = stripAccents(key);
    if (plain !== key && !accentKeys.has(plain)) accentKeys.set(plain, key);
  }
}

export function koreanizeEnglishCardName(name: string): string {
  // 트레이너·인물·아이템 카드는 이름 전체가 일치할 때만 통째로 바꾼다(부분 치환 사고 방지).
  // 데이터마다 어포스트로피가 곧은(') / 굽은(’) 게 섞여 있어, 사전 키(곧은 ')에 맞게
  // 굽은 것을 곧은 것으로 바꿔 조회한다.
  const exactKey = name.trim().replace(/[’]/g, "'");
  // PPT는 악센트를 뺀 표기로 준다("Pokemon Catcher"·"Pokegear 3.0"·"Poke Ball").
  // 우리 사전은 정식 표기(악센트 있음)라 그대로는 안 맞는다. 악센트를 붙였다 떼었다
  // 하는 대신, 사전을 찾을 때 양쪽 표기를 다 넣어 본다.
  const deaccented = accentKeys.get(stripAccents(exactKey));
  const exact = lookupExact(exactKey) ?? (deaccented ? lookupExact(deaccented) : undefined);
  if (exact) return exact;

  // PokemonPriceTracker는 "Levincia - 092/063"처럼 이름 뒤에 카드 번호를 붙여 준다.
  // 번호를 뗀 뒤 찾고, 번호는 그대로 뒤에 다시 붙인다(안 그러면 영문 그대로 남는다).
  const numbered = exactKey.match(/^(.+?)\s+-\s+([A-Za-z0-9/-]+)$/);
  if (numbered) {
    const found = AUTO_EN_TO_KO.get(numbered[1]) ?? TRAINER_EN_TO_KO[numbered[1]] ?? ITEM_EN_TO_KO[numbered[1]] ?? USER_CONFIRMED_EN_TO_KO[numbered[1]] ?? UNVERIFIED_EN_TO_KO[numbered[1]] ?? ENGLISH_CARD_EN_TO_KO[numbered[1]];
    if (found) return `${found} - ${numbered[2]}`;
  }
  // "Judge (Mirror Holo)"처럼 괄호로 인쇄 방식이 붙는 것도 같은 방식으로 처리한다.
  const suffixed = exactKey.match(/^(.+?)\s+(\([^()]+\))$/);
  if (suffixed) {
    const found =
      AUTO_EN_TO_KO.get(suffixed[1]) ??
      TRAINER_EN_TO_KO[suffixed[1]] ??
      ITEM_EN_TO_KO[suffixed[1]] ??
      USER_CONFIRMED_EN_TO_KO[suffixed[1]] ??
      UNVERIFIED_EN_TO_KO[suffixed[1]];
    if (found) return `${found} ${suffixed[2]}`;
  }

  // 북미판 세트인데 원본 DB가 "ナッシー[Exeggutor]"처럼 일본어 이름에 영어 이름을
  // 대괄호로 덧붙여 둔 경우가 있다. 대괄호 안이 진짜 이름이라 그것만 남긴다.
  const bracketed = name.trim().match(/^[ァ-ヶー・]+\[(.+)\]$/);
  const base = bracketed ? bracketed[1] : name;

  let result = base;
  // 표기 차이 보정: 카드 데이터는 곧은 어포스트로피(Farfetch'd)와 성별 기호 앞 공백
  // (Nidoran ♂)을 쓰는데, 사전은 굽은 어포스트로피(Farfetch’d)·붙임(Nidoran♂) 표기라
  // 그대로는 파오리·니드런이 안 잡힌다. 사전 표기에 맞춰 정규화한다.
  result = result.replace(/'/g, '’').replace(/\s+([♂♀])/g, '$1');

  for (const [en, ko] of STRUCTURAL_EN_TO_KO) {
    if (result.includes(en)) {
      result = result.split(en).join(ko);
    }
  }
  // 세트에 따라 "slowpoke"·"REMORAID"처럼 대소문자가 제각각이라, 대소문자를 무시하고 맞춘다.
  for (const entry of pokemonEnPatterns) {
    entry.re.lastIndex = 0;
    if (entry.re.test(result)) {
      entry.re.lastIndex = 0;
      result = result.replace(entry.re, entry.ko);
    }
  }

  // 앞말 사전에 꼬리 공백이 있어("Hisuian " → "히스이 ") 조사가 떨어져 나가거나
  // 공백이 겹치는 일이 있다("히스이 의 동료들", "히스이  블레이범").
  // 한글 뒤에 붙는 조사 앞의 공백을 지우고, 겹친 공백은 한 칸으로 줄인다.
  result = result.replace(/(?<=[가-힣])\s+(?=의\s)/g, '').replace(/ {2,}/g, ' ');

  // 에너지 카드는 "[이름] 에너지"가 공식 표기다(2026-08-02 사용자 확인). 조각들이
  // 붙어 조립된 결과에 공백을 넣는다 — 일본어 쪽(koreanizeTitle)과 같은 규칙이라
  // 두 판의 이름이 어긋나지 않는다.
  result = result.replace(/([^\s])에너지/g, '$1 에너지');

  // 옛 세트는 원본이 영어 이름을 넣어 둬서 이 경로를 탄다("houndour（u）").
  // 일본어 전각 괄호가 섞여 오면 여기서도 한글 표기로 바꾼다(일본어 쪽과 같은 규칙).
  result = result
    .replace(/（/g, ' (')
    .replace(/）/g, ')')
    .replace(/\)(?=[A-Za-z가-힣])/g, ') ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return result;
}

// 일본판 세트명은 "SV4a: Shiny Treasure ex"처럼 팩 코드가 앞에 붙어 오므로, 그 코드로
// 한글 팩 이름을 찾는다. 북미판 세트("Obsidian Flames" 등)는 코드가 없어 원문을 유지한다.
export function koreanizeEnglishSetName(setName: string): string {
  const match = setName.match(/^([A-Za-z0-9-]+):\s*/);
  if (!match) return setName;
  return packKoByCode.get(match[1].toLowerCase()) ?? setName;
}
