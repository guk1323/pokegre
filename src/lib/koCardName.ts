// 카드·세트 이름을 화면에 쓸 한글로. **서버와 화면이 이 한 벌만 쓴다.**
//
// 왜 따로 뺐나: 서버(server/index.ts)가 "브라우저 전용 파일이라 가져다 쓸 수 없다"며
// cardCatalog의 규칙을 **베껴 두고** 있었는데, 그 사이 화면 쪽만 고쳐져 어긋났다
// (2026-08-07 발견).
//     "Zekrom ex - 174/086"  서버 "제크로무 ex - 174/086"  ↔ 화면 "제크로무 ex"
//     "カスミ＆マナフィ"       서버 "이슬＆마나피"          ↔ 화면 "이슬&마나피"
// 서버가 만드는 세트 페이지 설명문(검색 결과에 나가는 글)이 화면과 다른 이름을 썼다.
//
// ⚠️ 이 파일은 **사전 두 개만** 가져온다(서버가 이미 쓰는 것들이다). 화면 전용 코드
//    (fetch·이미지 주소 등)를 여기 넣지 말 것 — 넣는 순간 서버가 못 쓴다.
// ⚠️ 서버가 쓰므로 **Dockerfile COPY 목록에도 있어야 한다.** `npm run build`의
//    배포 파일 검사가 빠뜨리면 알려 준다.
import { koreanizeTitle } from './koreanizeTitle.ts';
import { koreanizeEnglishCardName } from './koreanizeEnglishTitle.ts';
import { koSetName } from './setNameKo.ts';
import { 전각부호펴기 } from './punct.ts';

const hasJapanese = (s: string) => /[ぁ-んァ-ヶ一-龯]/.test(s);

// 저쪽이 이름 뒤에 붙이는 번호("Zekrom ex - 174/086")를 뗀다. 번호는 화면이 따로
// 적어 주므로 이름에 두 번 나올 이유가 없다.
const 번호꼬리떼기 = (s: string) => s.replace(/\s*-\s*\d+\/\d+\s*$/, '').trim();

// 한글 이름에 남는 **전각 문장부호**를 보통 부호로 바꾼다. 일본어 원문의 부호가 그대로
// 따라와 "포로！핸드 익스텐션", "초련＆담죽"처럼 나온다 — 한글 사이에 끼면 어색하고,
// 마켓에 보낼 때도 번역기가 못 읽어 검색을 방해한다.
// ⚠️ 한글이 하나도 없는 이름(번역이 안 된 일본어 원문)은 그대로 둔다 — 그쪽은 원문
//    표기가 맞다.
const 부호다듬기 = (s: string) => {
  if (!/[가-힣]/.test(s)) return s;
  return 전각부호펴기(s).replace(/\s+/g, ' ').trim();
};

export const koName = (ed: 'ja' | 'en', name: string): string => {
  if (ed !== 'ja') return 부호다듬기(번호꼬리떼기(koreanizeEnglishCardName(name)));
  if (hasJapanese(name)) return 부호다듬기(번호꼬리떼기(koreanizeEnglishCardName(koreanizeTitle(name))));
  // 영어 이름이다. 영어 사전이 통째로 아는 이름이면 그대로 쓴다.
  const en = 번호꼬리떼기(koreanizeEnglishCardName(name));
  if (/[가-힣]/.test(en) && !/[A-Za-z]{3,}/.test(en)) return 부호다듬기(en);
  // 영어 사전이 못 잡은 것만 일본어 사전에 맡긴다. 옛 세트에는 원본이 깨져 영어로 들어온
  // 이름이 있는데("Bugsy's Pinsir", "Mime Ex"), 그건 일본어 쪽에 고치는 규칙을 넣어 뒀다.
  return 부호다듬기(번호꼬리떼기(koreanizeEnglishCardName(koreanizeTitle(name))));
};

// 일본판 세트인데 이름이 영어로 붙은 것들이 있다(「Pokémon GO」, 「25th Anniversary」).
// 일본어 사전은 이런 이름을 손대지 못해 영어 그대로 나갔다. 한글이 하나도 안 남으면
// 영어 세트명 사전으로 한 번 더 시도한다.
export const koSet = (ed: 'ja' | 'en', name: string): string => {
  if (ed !== 'ja') return koSetName(name);
  const ko = koreanizeTitle(name);
  return /[가-힣]/.test(ko) ? ko : koSetName(ko);
};
