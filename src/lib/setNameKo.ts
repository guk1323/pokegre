// 북미판·Pocket 세트의 공식 한글명(영어명 그대로면 한글 사이트에서 어색).
// 키는 영어 세트명 — 원본 name은 그대로 둬서 영어 검색도 계속 되게 한다.
// 세트별 목록(SetsView)과 작가별 목록(ArtistsView)이 같은 세트를 같은 한글명으로
// 보여줘야 해서 공용 모듈로 뒀다. 두 화면 모두 지연 로딩이라 컴포넌트끼리 import하면
// 코드 분리가 깨지므로 lib에 둔다.
import { koreanizeEnglishCardName } from './koreanizeEnglishTitle.ts';

export const SET_KO: Record<string, string> = {
  // Pokémon TCG Pocket (한국어판 게임 공식 확장팩명, 나무위키 대조)
  'Genetic Apex': '최강의 유전자',
  'Mythical Island': '환상이 있는 섬',
  'Space-Time Smackdown': '시공의 격투',
  'Triumphant Light': '초극의 빛',
  'Shining Revelry': '샤이닝 하이',
  'Celestial Guardians': '쌍천의 수호자',
  'Extradimensional Crisis': '이차원 크라이시스',
  'Eevee Grove': '이브이 가든',
  'Wisdom of Sea and Sky': '하늘과 바다의 인도',
  'Secluded Springs': '미지의 수역',
  'Mega Rising': '메가라이징',
  'Crimson Blaze': '홍련 블레이즈',
  'Fantastical Parade': '몽환 퍼레이드',
  'Paldean Wonders': '팔데아의 기적',
  'Promos-A': '프로모 카드 A',

  // ── 물리 북미판(EN) ──
  // ⚠️ 북미판은 **북미판 이름을 소리 나는 대로** 적는다(운영자 지시 2026-08-05).
  //    예전엔 "일본판과 1:1 대응하면 정식 한글명"이었는데, 1:1이라는 판단이 틀렸다.
  //    Surging Sparks는 북미판 252장, 초전브레이커는 일본판 138장이고 같은 번호에
  //    다른 카드가 들어 있다(3번: 일본판 아이언트 ex / 북미판 나시). 북미판은 일본판
  //    두세 개를 합쳐 내기 때문이다. 다른 상품에 같은 이름을 붙이면, 목록을 연 사람이
  //    카드가 다른 걸 보고 우리가 틀렸다고 생각한다.
  //    포켓몬 이름이 들어간 것만 정식 한글명을 쓴다(Deoxys→테오키스).
  // Mega Evolution (EN 메가 시리즈)
  'Mega Evolution': '메가 에볼루션',
  'Phantasmal Flames': '팬타스말 플레임즈',
  'Ascended Heroes': '어센디드 히어로즈',
  'Perfect Order': '퍼펙트 오더',
  'Chaos Rising': '카오스 라이징',
  'Pitch Black': '피치 블랙',
  // Scarlet & Violet
  'Scarlet & Violet': '스칼렛 & 바이올렛',
  'Paldea Evolved': '팔데아 이볼브드',
  'Obsidian Flames': '옵시디언 플레임즈',
  '151': '151',
  'Paradox Rift': '패러독스 리프트',
  'Paldean Fates': '팔데안 페이츠',
  'Temporal Forces': '템포럴 포시스',
  'Twilight Masquerade': '트와일라잇 마스커레이드',
  'Shrouded Fable': '슈라우디드 페이블',
  'Stellar Crown': '스텔라 크라운',
  'Surging Sparks': '서징 스파크스',
  'Prismatic Evolutions': '프리즈매틱 이볼루션즈',
  'Journey Together': '저니 투게더',
  'Destined Rivals': '데스틴드 라이벌즈',
  'Black Bolt': '블랙 볼트',
  'White Flare': '화이트 플레어',
  'SVP Black Star Promos': 'SVP 블랙스타 프로모',
  // Sword & Shield
  'Sword & Shield': '소드 & 실드',
  'Rebel Clash': '리벨 클래시',
  'Darkness Ablaze': '다크니스 어블레이즈',
  "Champion's Path": '챔피언스 패스',
  'Vivid Voltage': '비비드 볼티지',
  'Shining Fates': '샤이닝 페이츠',
  'Shining Fates Shiny Vault': '샤이닝 페이츠 샤이니 볼트',
  'Battle Styles': '배틀 스타일즈',
  'Chilling Reign': '칠링 레인',
  'Evolving Skies': '이볼빙 스카이즈',
  'Celebrations': '셀레브레이션즈',
  'Fusion Strike': '퓨전 스트라이크',
  'Brilliant Stars': '브릴리언트 스타즈',
  'Brilliant Stars Trainer Gallery': '브릴리언트 스타즈 트레이너 갤러리',
  'Astral Radiance': '아스트랄 라디언스',
  'Astral Radiance Trainer Gallery': '아스트랄 라디언스 트레이너 갤러리',
  'Pokémon GO': '포켓몬 GO',
  // 상품 이름이 아니라 원본(TCGdex)이 묶어 둔 자루 이름이다. 그대로 두면 목록에 영어만 뜬다.
  'Miscellaneous Promos': '기타 프로모',
  'Lost Origin': '로스트 오리진',
  'Lost Origin Trainer Gallery': '로스트 오리진 트레이너 갤러리',
  'Silver Tempest': '실버 템페스트',
  'Silver Tempest Trainer Gallery': '실버 템페스트 트레이너 갤러리',
  'Crown Zenith': '크라운 제니스',
  'Crown Zenith Galarian Gallery': '크라운 제니스 가라르 갤러리',
  'Pokémon Futsal 2020': '포켓몬 풋살 2020',
  'SWSH Black Star Promos': 'SWSH 블랙스타 프로모',
  // Sun & Moon
  'Sun & Moon': '썬 & 문',
  'Guardians Rising': '가디언즈 라이징',
  'Burning Shadows': '버닝 섀도우스',
  'Shining Legends': '샤이닝 레전즈',
  'Crimson Invasion': '크림슨 인베이전',
  'Ultra Prism': '울트라 프리즘',
  'Forbidden Light': '포비든 라이트',
  'Celestial Storm': '셀레스티얼 스톰',
  'Dragon Majesty': '드래곤 마제스티',
  'Lost Thunder': '로스트 썬더',
  'Team Up': '팀 업',
  'Detective Pikachu': '디텍티브 피카츄',
  'Unbroken Bonds': '언브로큰 본즈',
  'Unified Minds': '유니파이드 마인즈',
  'Hidden Fates': '히든 페이츠',
  'Hidden Fates Shiny Vault': '히든 페이츠 샤이니 볼트',
  'Cosmic Eclipse': '코스믹 이클립스',
  'SM Black Star Promos': 'SM 블랙스타 프로모',
  // XY
  'XY': 'XY',
  'Kalos Starter Set': '칼로스 스타터 세트',
  'Flashfire': '플래시파이어',
  'Furious Fists': '퓨리어스 피스츠',
  'Phantom Forces': '팬텀 포시스',
  'Primal Clash': '프라이멀 클래시',
  'Double Crisis': '더블 크라이시스',
  'Roaring Skies': '로어링 스카이즈',
  'Ancient Origins': '에인션트 오리진스',
  'BREAKthrough': '브레이크스루',
  'BREAKpoint': '브레이크포인트',
  'Generations': '제너레이션즈',
  'Fates Collide': '페이츠 콜라이드',
  'Steam Siege': '스팀 시즈',
  'Evolutions': '이볼루션즈',
  'XY Black Star Promos': 'XY 블랙스타 프로모',
  // Black & White
  'Black & White': '블랙 & 화이트',
  'Emerging Powers': '이머징 파워스',
  'Noble Victories': '노블 빅토리즈',
  'Next Destinies': '넥스트 데스티니즈',
  'Dark Explorers': '다크 익스플로러스',
  'Dragons Exalted': '드래곤즈 이그절티드',
  'Dragon Vault': '드래곤 볼트',
  'Boundaries Crossed': '바운더리즈 크로스드',
  'Plasma Storm': '플라스마 스톰',
  'Plasma Freeze': '플라스마 프리즈',
  'Plasma Blast': '플라스마 블래스트',
  'Legendary Treasures': '레전더리 트레저스',
  'BW Black Star Promos': 'BW 블랙스타 프로모',
  // HeartGold & SoulSilver
  'HeartGold SoulSilver': '하트골드 소울실버',
  'Unleashed': '언리쉬드',
  'Undaunted': '언돈티드',
  'Triumphant': '트라이엄펀트',
  'HGSS Black Star Promos': 'HGSS 블랙스타 프로모',
  'Call of Legends': '콜 오브 레전즈',
  // Platinum
  'Platinum': '플래티넘',
  'Rising Rivals': '라이징 라이벌스',
  'Supreme Victors': '슈프림 빅터스',
  'Arceus': '아르세우스',
  'Pokémon Rumble': '포켓몬 럼블',
  // Diamond & Pearl
  'Diamond & Pearl': '다이아몬드 & 펄',
  'Mysterious Treasures': '미스테리어스 트레저스',
  'Secret Wonders': '시크릿 원더스',
  'Great Encounters': '그레이트 인카운터스',
  'Majestic Dawn': '마제스틱 던',
  'Legends Awakened': '레전즈 어웨이크드',
  'Stormfront': '스톰프론트',
  'DP Black Star Promos': 'DP 블랙스타 프로모',
  // POP
  'POP Series 1': 'POP 시리즈 1',
  'POP Series 2': 'POP 시리즈 2',
  'POP Series 3': 'POP 시리즈 3',
  'POP Series 4': 'POP 시리즈 4',
  'POP Series 5': 'POP 시리즈 5',
  'POP Series 6': 'POP 시리즈 6',
  'POP Series 7': 'POP 시리즈 7',
  'POP Series 8': 'POP 시리즈 8',
  'POP Series 9': 'POP 시리즈 9',
  'Nintendo Black Star Promos': '닌텐도 블랙스타 프로모',
  // EX 시리즈 (일본판 ADV·PCG 블록에 대응 — 정식 한글명 있는 건 매칭)
  'Ruby & Sapphire': '루비 & 사파이어',
  'Sandstorm': '샌드스톰',
  'Dragon': '드래곤',
  'Team Magma vs Team Aqua': '마그마단 VS 아쿠아단',
  'Hidden Legends': '히든 레전즈',
  'FireRed & LeafGreen': '파이어레드 & 리프그린',
  'Team Rocket Returns': '팀 로켓 리턴즈',
  'Deoxys': '테오키스',
  'Emerald': '에메랄드',
  'Unseen Forces': '언신 포시즈',
  'Delta Species': '델타 스피시즈',
  'Legend Maker': '레전드 메이커',
  'Holon Phantoms': '홀론 팬텀즈',
  'Crystal Guardians': '크리스탈 가디언즈',
  'Dragon Frontiers': '드래곤 프론티어즈',
  'Power Keepers': '파워 키퍼스',
  // Trainer kits
  'EX trainer Kit (Latios)': 'EX 트레이너 키트 (라티오스)',
  'EX trainer Kit (Latias)': 'EX 트레이너 키트 (라티아스)',
  'EX trainer Kit 2 (Plusle)': 'EX 트레이너 키트 2 (플러시)',
  'EX trainer Kit 2 (Minun)': 'EX 트레이너 키트 2 (마이농)',
  // e-Card (일본판 e블록 대응)
  'Expedition Base Set': '엑스페디션 베이스 세트',
  'Best of game': '베스트 오브 게임',
  'Aquapolis': '아쿠아폴리스',
  'Skyridge': '스카이릿지',
  // 초기 시리즈
  'Legendary Collection': '레전더리 컬렉션',
  'Neo Genesis': '네오 제네시스',
  'Neo Discovery': '네오 디스커버리',
  'Southern Islands': '서던 아일랜즈',
  'Neo Revelation': '네오 레벌레이션',
  'Neo Destiny': '네오 데스티니',
  'Gym Heroes': '짐 히어로즈',
  'Gym Challenge': '짐 챌린지',
  'Base Set': '베이스 세트',
  'Jungle': '정글',
  'Wizards Black Star Promos': '위저드 블랙스타 프로모',
  'Fossil': '파슬',
  'Base Set 2': '베이스 세트 2',
  'Team Rocket': '팀 로켓',

  // 작가별 목록의 세트명은 다른 소스(scrydex)라 표기가 조금 다르다. 같은 세트가 화면마다
  // 다른 이름으로 보이지 않게 별칭을 함께 둔다(한글명은 위 정식 항목과 동일하게 맞춤).
  'HeartGold & SoulSilver': '하트골드 소울실버',
  'HS—Triumphant': '트라이엄펀트',
  'HS—Unleashed': '언리쉬드',
  'HS—Undaunted': '언돈티드',
  'Base': '베이스 세트',
  'Best of Game': '베스트 오브 게임',
  'Pokémon Futsal Collection': '포켓몬 풋살 2020',
  'Scarlet & Violet Black Star Promos': 'SVP 블랙스타 프로모',
  'Scarlet & Violet Promos': 'SVP 블랙스타 프로모',
  // 원본 세트명에 콜론이 없다. 콜론을 넣어 두면 영영 안 걸린다(en-cel25cc).
  // ⚠️ 이름 앞부분은 부모 세트와 똑같이 쓴다. 목록에서 나란히 서기 때문에 다르게 쓰면
  //    같은 시리즈로 안 보인다('Celebrations' = 셀레브레이션즈,
  //    'Unseen Forces' = 금의 하늘, 은의 바다).
  'Celebrations Classic Collection': '셀레브레이션즈 클래식 컬렉션',
  'Unseen Forces Unown Collection': '언신 포시즈 안농 컬렉션',
  'Poké Card Creator Pack': '포케 카드 크리에이터 팩',
  'Yellow A Alternate': '옐로 A 알터네이트',
  // 부모 세트('Mega Evolution' = 메가 에볼루션)와 앞부분을 맞춘다.
  'Mega Evolution Energy': '메가 에볼루션 에너지',
  'My First Battle': '마이 퍼스트 배틀',
  // 한글 이름이 없어 영어로 나오던 것들(2026-08-05). 트레이너 키트 괄호 안은
  // 포켓몬 정식 한글명이다 — 소리 나는 대로 적지 않는다(Sylveon은 실베온이 아니라 님피아).
  'MEP Black Star Promos': 'MEP 블랙스타 프로모',
  "McDonald's Collection 2011": '맥도날드 컬렉션 2011',
  "McDonald's Collection 2012": '맥도날드 컬렉션 2012',
  "McDonald's Collection 2014": '맥도날드 컬렉션 2014',
  "McDonald's Collection 2015": '맥도날드 컬렉션 2015',
  "McDonald's Collection 2016": '맥도날드 컬렉션 2016',
  "McDonald's Collection 2017": '맥도날드 컬렉션 2017',
  "McDonald's Collection 2018": '맥도날드 컬렉션 2018',
  "McDonald's Collection 2019": '맥도날드 컬렉션 2019',
  "McDonald's Collection 2021": '맥도날드 컬렉션 2021',
  "McDonald's Collection 2022": '맥도날드 컬렉션 2022',
  "McDonald's Collection 2023": '맥도날드 컬렉션 2023',
  "McDonald's Collection 2024": '맥도날드 컬렉션 2024',
  'XY trainer Kit (Bisharp)': 'XY 트레이너 키트 (절각참)',
  'XY trainer Kit (Latias)': 'XY 트레이너 키트 (라티아스)',
  'XY trainer Kit (Latios)': 'XY 트레이너 키트 (라티오스)',
  'XY trainer Kit (Noivern)': 'XY 트레이너 키트 (음번)',
  'XY trainer Kit (Pikachu Libre)': 'XY 트레이너 키트 (피카츄 리브레)',
  'XY trainer Kit (Suicune)': 'XY 트레이너 키트 (스이쿤)',
  'XY trainer Kit (Sylveon)': 'XY 트레이너 키트 (님피아)',
  'XY trainer Kit (Wigglytuff)': 'XY 트레이너 키트 (푸크린)',
  'SM trainer Kit (Alolan Raichu)': 'SM 트레이너 키트 (알로라 라이츄)',
  'SM trainer Kit (Lycanroc)': 'SM 트레이너 키트 (루가루암)',
  'HS trainer Kit (Gyarados)': 'HS 트레이너 키트 (갸라도스)',
  'HS trainer Kit (Raichu)': 'HS 트레이너 키트 (라이츄)',
  'DP trainer Kit (Lucario)': 'DP 트레이너 키트 (루카리오)',
  'DP trainer Kit (Manaphy)': 'DP 트레이너 키트 (마나피)',
  'BW trainer Kit (Excadrill)': 'BW 트레이너 키트 (몰드류)',
  'BW trainer Kit (Zoroark)': 'BW 트레이너 키트 (조로아크)',
  // 부모 세트('Scarlet & Violet' = 스칼렛 & 바이올렛)와 띄어쓰기를 맞춘다.
  'Scarlet & Violet Energy': '스칼렛 & 바이올렛 에너지',
  // 일본판이지만 이름이 영어로 붙어 있어 여기(영어 세트명 사전)로 들어온다(ja-S8a).
  '25th Anniversary': '25th 어니버서리 컬렉션',
  'EX Trainer Kit Latios': 'EX 트레이너 키트 (라티오스)',
  'EX Trainer Kit Latias': 'EX 트레이너 키트 (라티아스)',
  'EX Trainer Kit 2 Plusle': 'EX 트레이너 키트 2 (플러시)',
  'EX Trainer Kit 2 Minun': 'EX 트레이너 키트 2 (마이농)',
};

// 맥도날드·POP 등은 규칙적이라 접두 변환으로 처리(개별 매핑 누락 방지).
export function koSetName(name: string): string {
  if (SET_KO[name]) return SET_KO[name];
  const mcd = name.match(/^McDonald's Collection (\d{4})$/);
  if (mcd) return `맥도날드 컬렉션 ${mcd[1]}`;
  // 트레이너킷은 "<시리즈> trainer Kit (<포켓몬>)" 꼴로 16개가 같은 모양이다.
  // 하나씩 적는 대신 규칙으로 잡는다. 괄호 안 포켓몬 이름은 영문 사전으로 바꾼다.
  const kit = name.match(/^(\w+) trainer Kit \(([^)]+)\)$/i);
  if (kit) return `${kit[1]} 트레이너킷 (${koreanizeEnglishCardName(kit[2])})`;
  // 블랙스타 프로모도 시리즈 코드만 다르다. 새 시리즈가 나와도 저절로 잡힌다.
  const promo = name.match(/^(\w+) Black Star Promos$/);
  if (promo) return `${promo[1]} 블랙스타 프로모`;
  return name;
}

// 시리즈 이름을 주소에 쓸 수 있는 꼴로 바꾼다("剣と盾" → "剣と盾", "Sword & Shield" → "sword-shield").
// 서버(server/index.ts의 /series/:slug)와 화면·사이트맵이 같은 규칙을 써야 주소가 맞는다.
export const serieSlug = (serie: string): string =>
  serie
    .toLowerCase()
    .replace(/[^\w가-힣ぁ-んァ-ヶー・一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'etc';
