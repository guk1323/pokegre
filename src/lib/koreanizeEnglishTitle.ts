import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';

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
const STRUCTURAL_EN_TO_KO: [string, string][] = [
  ['Mega ', '메가'],
  ['Radiant ', '찬란한 '], // かがやく/輝く의 영문판. koreanizeTitle과 같은 표기로 맞춘다.
  // 지역폼 접두사. 뒤의 포켓몬 이름은 사전 치환으로 한글이 되고, 이 접두사만 남던 걸
  // 한글 공식 표기로 바꾼다. 예: "Galarian Mr. Mime" → "가라르 마임맨".
  ['Galarian ', '가라르 '],
  ['Alolan ', '알로라 '],
  ['Hisuian ', '히스이 '],
  ['Paldean ', '팔데아 '],
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
  Penny: '보탄',
  Clavell: '클라벨', // クラベル (청목은 Larry 이름이라 오류)
  Bianca: '벨',
  Cheren: '체렌',
  Hop: '호프',
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
  "Boss's Orders": '보스의 지령',
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
  Atticus: '추명', // 팀 스타 독 보스
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
  Volo: '찬석',
  Adaman: '류가',
  Irida: '주혜',
  Cyllene: '경단', // 조사대장
  Kamado: '파래열',
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
  'Super Rod': '슈퍼로드',
  'Air Balloon': '풍선',
  'Rocky Helmet': '오톨도톨헬멧',
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
  'Water Energy': '물 에너지',
  'Fire Energy': '불꽃 에너지',
  'Grass Energy': '풀 에너지',
  'Lightning Energy': '번개 에너지',
  'Psychic Energy': '초 에너지',
  'Fighting Energy': '격투 에너지',
  'Darkness Energy': '악 에너지',
  'Metal Energy': '강철 에너지',
  'Fairy Energy': '페어리 에너지',
  'Dragon Energy': '드래곤 에너지',
  'Rainbow Energy': '무지개 에너지',
  'Multi Energy': '멀티 에너지',
  'Double Colorless Energy': '더블무색 에너지',
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
  'Old Amber': '비밀의 호박',
  // 일반 역할 인물
  Fisherman: '낚시꾼',
  Lady: '귀부인',
  Beauty: '미인',
  Schoolboy: '남학생',
  Schoolgirl: '여학생',
  'TV Reporter': 'TV 리포터',
  'Gym Trainer': '체육관 트레이너',
  'Pokémon Fan Club': '포켓몬 팬클럽',
  'Pokémon Center Lady': '포켓몬센터 누나',
  Maintenance: '메인터넌스',
  'Night Maintenance': '나이트 메인터넌스',
  Revive: '기력의 조각',
  Judge: '심판꾼',
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
export function koreanizeEnglishCardName(name: string): string {
  // 트레이너·인물·아이템 카드는 이름 전체가 일치할 때만 통째로 바꾼다(부분 치환 사고 방지).
  // 데이터마다 어포스트로피가 곧은(') / 굽은(’) 게 섞여 있어, 사전 키(곧은 ')에 맞게
  // 굽은 것을 곧은 것으로 바꿔 조회한다.
  const exactKey = name.trim().replace(/[’]/g, "'");
  const exact = TRAINER_EN_TO_KO[exactKey] ?? ITEM_EN_TO_KO[exactKey];
  if (exact) return exact;

  let result = name;
  // 표기 차이 보정: 카드 데이터는 곧은 어포스트로피(Farfetch'd)와 성별 기호 앞 공백
  // (Nidoran ♂)을 쓰는데, 사전은 굽은 어포스트로피(Farfetch’d)·붙임(Nidoran♂) 표기라
  // 그대로는 파오리·니드런이 안 잡힌다. 사전 표기에 맞춰 정규화한다.
  result = result.replace(/'/g, '’').replace(/\s+([♂♀])/g, '$1');

  for (const [en, ko] of STRUCTURAL_EN_TO_KO) {
    if (result.includes(en)) {
      result = result.split(en).join(ko);
    }
  }
  for (const entry of sortedPokemonEnKo) {
    if (result.includes(entry.en)) {
      result = result.split(entry.en).join(entry.ko);
    }
  }

  return result;
}

// 일본판 세트명은 "SV4a: Shiny Treasure ex"처럼 팩 코드가 앞에 붙어 오므로, 그 코드로
// 한글 팩 이름을 찾는다. 북미판 세트("Obsidian Flames" 등)는 코드가 없어 원문을 유지한다.
export function koreanizeEnglishSetName(setName: string): string {
  const match = setName.match(/^([A-Za-z0-9-]+):\s*/);
  if (!match) return setName;
  return packKoByCode.get(match[1].toLowerCase()) ?? setName;
}
