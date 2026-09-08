# pokegre — 포켓몬 카드 시세 사이트

https://pokegre.com

포켓몬 카드의 시세·도감·감정 팝수를 한 곳에서 보는 한국어 사이트입니다. 2026년 7월 15일에 시작해 운영 중입니다.

## 무엇을 하는 사이트인가

- **카드 도감** — 일본판·영문판 686세트, 카드 6만 장. 한글 이름으로 검색합니다.
- **시세 추이** — 이베이 낙찰 기록과 TCGplayer 시세를 등급(미감정·PSA·CGC·BGS)별로 그래프와 최근 낙찰 5건으로 보여 줍니다.
- **감정 팝수** — PSA·CGC·BGS 공식 팝 리포트를 직접 읽어 카드마다 등급별 감정 수량을 보여 줍니다. PSA 28,225칸 · CGC 46,377칸 · BGS 497칸.
- **미개봉 시세** — 부스터 박스·팩 시세.
- **카드 뽑기·앨범** — 출석 예산으로 팩을 뜯고 앨범에 모으는 놀이.
- **통계** — 방문·검색·세트별 조회 통계.

## 어떻게 만들었나

| 층 | 구성 |
|---|---|
| 화면 | React 19 + TypeScript + Vite, Tailwind |
| 서버 | Node 24 + Express, TypeScript를 그대로 실행 (`server/api.ts`) |
| 배포 | Fly.io (도쿄), Docker |
| 자료 | PokemonPriceTracker API 덤프 + 이베이·PSA·CGC·BGS 직접 수집 |

### 자료 파이프라인

- **시세 덤프** — PokemonPriceTracker API에서 카드·인쇄판별 시세를 받아 `/data`에 두고, 크레딧 한도(하루 20,000)를 넘지 않도록 속도·바닥선을 둡니다.
- **이베이 낙찰** — 시세가 없는 카드는 이베이 낙찰 목록을 긁어 규칙으로 가릅니다(묶음·예약판매·가짜·이상값·다른 카드 제외). `src/lib/listingTitle.ts`.
- **팝수** — PSA 세트 페이지 POST, CGC 뒷단 API, BGS 공개 리포트를 크롬에서 읽어 `src/data/*PopFix.json`에 적고, 서버가 등급표에 얹습니다. 인쇄판(1st Edition·리버스·마스터볼 무늬)은 따로 셉니다.
- **도감** — Limitless·TCGdex·Pokellector·Bulbapedia에서 카드 목록과 그림을 모으고 한글 이름을 붙입니다.

## 폴더

```
src/            화면 (components 55개)
server/api.ts   서버 창구 37개 (시세·도감·팝수·통계·게임)
public/sets/    세트별 카드 목록 686개
src/data/       손으로 적은 보정표 (팝수·시세·이름 번역)
scripts/        수집·검사 도구
```

## 실행

```bash
npm install
npm run dev        # 화면
npm run start      # 서버 (.env에 API 키 필요)
npm run build      # 배포 전 검사 + 빌드
```

## 만든 방식

비개발자인 운영자가 Claude Code와 함께 만들었습니다. 시세팀·홍보팀·게임팀으로 나눠 작업하며, 규칙과 사연은 `CLAUDE.md`와 `.claude/*.md`에 적어 두었습니다.
