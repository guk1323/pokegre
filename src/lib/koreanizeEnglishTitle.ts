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
  ['Hop’s ', '호프의 '],
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
  // Penny(ボタン)의 공식 한글명은 '모란'이다. '보탄'은 일본 이름 음역이라 틀렸다.
  Penny: '모란',
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
  // ── 사용자가 확인해 준 공식 한글 카드명(2026-07-26) ──────────────────────
  // 이름 전체가 정확히 일치할 때만 바뀌므로 다른 카드를 깨뜨리지 않는다.
  'Accompanying Flute': '동반의 피리',
  "Acerola's Mischief": '아세로라의 장난',
  Amarys: '네리네',
  'Amulet of Hope': '희망의 부적',
  'Antique Cover Fossil': '복원된 덮개화석',
  'Antique Dome Fossil': '복원된 껍질화석',
  'Antique Helix Fossil': '복원된 조개화석',
  'Antique Old Amber': '복원된 비밀의암석',
  'Antique Root Fossil': '복원된 뿌리화석',
  'Area Zero Underdepths': '제로대공동',
  Artazon: '보울마을',
  "Arven's Sandwich": '페퍼의 샌드위치',
  'Babiri Berry': '바카열매',
  'Big Air Balloon': '커다란 풍선',
  "Bill's Transfer": '이슬의 전송',
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
  'Chill Teaser Toy': '차가운 장난감',
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
  'Dragon Elixir': '드래곤 에릭서',
  'Dusk Ball': '다크볼',
  'Earthen Vessel': '대지의 용기',
  "Emcee's Hype": '사회자의 사회',
  'Energy Search Pro': '에너지 수색 프로',
  'Energy Sticker': '에너지 스티커',
  'Enriching Energy': '풍요의 에너지',
  "Erika's Invitation": '민화의 초대',
  "Ethan's Adventure": '심향의 모험',
  "Explorer's Guidance": '탐험가의 안내',
  'Fan Rotom': '스핀 로토무',
  'Festival Grounds': '축제 광장',
  'Fighting Gong': '격투 징',
  'Friends in Paldea': '팔데아의 친구들',
  "Giovanni's Charisma": '비주기의 카리스마',
  'Glass Trumpet': '유리 나팔',
  Grabber: '핸드캐처',
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
  Leftovers: '먹고자남은음식',
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
  'Rigid Band': '단단한 밴드',
  'Risky Ruins': '위험한 유적',
  'Roto-Stick': '로토무 셀카봉',
  Ruffian: '불량배',
  'Sacred Ash': '성스러운재',
  'Scoop Up Cyclone': '회수 사이클론',
  'Scramble Switch': '스크램블 교체',
  'Secret Box': '시크릿 박스',
  'Sparkling Crystal': '반짝이는 결정',
  'Spikemuth Gym': '스파이크마을 체육관',
  'Spiky Energy': '가시 에너지',
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
  "Team Rocket's Energy": '로켓단의 에너지',
  "Team Rocket's Factory": '로켓단의 공장',
  "Team Rocket's Giovanni": '로켓단의 비주기',
  "Team Rocket's Great Ball": '로켓단의 수퍼볼',
  "Team Rocket's Petrel": '로켓단의 람다',
  "Team Rocket's Proton": '로켓단의 랜스',
  "Team Rocket's Venture Bomb": '로켓단의 벤처 폭탄',
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
  'Super Rod': '슈퍼로드',
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
export function koreanizeEnglishCardName(name: string): string {
  // 트레이너·인물·아이템 카드는 이름 전체가 일치할 때만 통째로 바꾼다(부분 치환 사고 방지).
  // 데이터마다 어포스트로피가 곧은(') / 굽은(’) 게 섞여 있어, 사전 키(곧은 ')에 맞게
  // 굽은 것을 곧은 것으로 바꿔 조회한다.
  const exactKey = name.trim().replace(/[’]/g, "'");
  const exact = TRAINER_EN_TO_KO[exactKey] ?? ITEM_EN_TO_KO[exactKey];
  if (exact) return exact;

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
