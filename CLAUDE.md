# pokegre — 작업 전 필독

포켓몬 카드 시세·세트·센터링·일러스트 사이트. React+TS+Vite 프론트 / Node·Express 서버(`server/api.ts`의 `mountApi`, Node 24로 .ts 직접 실행). Fly.io 배포(app `pokegre`, 도쿄). 사용자는 비개발자 — 쉬운 한국어로, 짧게.

## ⚠️ 최우선 규칙 — 지시받으면 "보유한 기능·API에 맞춰" 일할 것

**어떤 작업을 지시받든, 시작 전에 아래 "보유 API·결제 항목" 표를 먼저 보고 그 자원을 활용해 계획·수행할 것.** 맨땅에서 시작하거나, 이미 결제·발급된 도구를 잊고 헤매지 말 것. (사용자가 이 점을 반복 지적함 — 매번 까먹는 게 가장 큰 불만.)

- 예: "세트 이미지 채워줘" → 무료 pokemontcg 키·유료 PPT(이미지 포함)를 **먼저 떠올려** 그걸로 함.
- 예: "시세 관련" → PPT(유료) 기능을 최대한 활용.
- 새 작업 전 `.env`도 함께 확인(값은 출력 금지, 존재·용도만). 새 API가 생겼는데 표에 없으면 사용자에게 확인 후 추가.

## 보유 API · 결제 항목 (`.env`)

| 키 | 용도 | 결제 | 코드 사용 | 주의점 |
|---|---|---|---|---|
| `POKEMON_PRICE_TRACKER_API_KEY` | **PPT** (pokemonpricetracker.com/api/v2). eBay·TCGplayer 시세, 등급별 히스토리 | **유료(Pro $10)** | server/api.ts (Bearer) | `/cards` 응답에 **카드 이미지도 포함**(`imageCdnUrl` 200/400/800, tcgplayer-cdn). `setName`으로 조회 가능. **rate limit 매우 빡빡 — 2~3연속 호출이면 429**. `page` 파라미터 없음(`limit`만, 최대 250). |
| `POKEMONTCG_API_KEY` | **pokemontcg.io** 카드 이미지·데이터 | 무료 | **코드 미사용(데이터 작업용)** | 이미지 채우기 등 스크립트에서 `X-Api-Key` 헤더로. 키 없이 부르면 rate limit 걸림 → **반드시 이 키 사용**. 데이터 API가 가끔 500 뜸. |
| `ANTHROPIC_API_KEY` | 카드 사진 스캔(이미지→카드 인식) | 종량제 | server/api.ts | scan-card는 인증 필요(요금 방지). |
| `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET` | 카카오 로그인 | 무료 | server/api.ts | |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 로그인 | 무료 | server/api.ts | |
| `OPENCHAT_URL` | 커뮤니티 오픈채팅 링크 | — | server/api.ts | |

## 💰 요금제 · 월 비용 (사용자 확인, 2026-07 기준)

| 항목 | 요금제 | 비용 | 메모 |
|---|---|---|---|
| **PPT (PokemonPriceTracker)** | Pro | **월 $10** (매달 정기결제) | 시세 + 카드 이미지 소스 |
| **Fly.io** (서버) | 종량제(구독 아님) | **약 월 $3~4** + 트래픽 | shared-cpu-1x 512MB 1대 + 1GB 볼륨, 도쿄(nrt). 무료체험 2026-07-22 종료, 카드 등록됨. 실제 청구액은 Fly 대시보드. |
| **pokegre.com 도메인** | 연 갱신 | **연 ₩24,000** | **가비아(Gabia)**. 2026-07-17 등록 → 2027-07-17 만기. (pokegre.kr도 이벤트로 보유) |
| pokemontcg.io / 카카오 / 네이버 | 무료 | ₩0 | |
| **Anthropic** (사진 스캔) | 선불 충전 | **$5 충전** (2026-07-23 잔액 $3.82) | platform.claude.com. 스캔할 때만 소량 차감. 잔액은 시점따라 변함. |

**월 고정비 합계 ≈ $13~14 (약 ₩1.8~1.9만) + 도메인 연 약 ₩2만.**
※ 정확한 청구액·잔액은 각 대시보드에서 사용자가 확인(에이전트는 결제 화면·잔액 접근 안 함).

## 자주 잊는 함정 (오늘까지 배운 것)

- **세트별 카드 이미지**는 `public/sets/*.json`에 **빌드 시점에 박혀 있다**(런타임에 API 안 부름). 각 카드 `{n, name, img}`. 빈칸(img="") 채우려면 **pokemontcg.io(무료 키) 또는 PPT**로 받아 `--write`. 소스 매칭은 **번호+카드이름 둘 다 일치할 때만**(엉뚱한 이미지 방지 — 사용자 최우선 원칙: "틀린 것보다 빈칸").
- **이미지 프록시** `/api/img`는 wsrv로 축소. **tcgplayer-cdn은 wsrv가 막혀** 302로 원본 폴백(그래도 표시됨). 화이트리스트는 server/api.ts `IMG_ALLOWED_HOSTS`.
- **세트 화면(SetsView)은 현재 `isAdmin` 전용**(App.tsx). 일반 유저에겐 안 보임.
- **트레이너 이름 번역**: 예전 세션이 일본어 음역을 잘못 넣은 게 많았음 → [[pokegre-trainer-romaji-errors]] 참고. 나무위키/Fandom은 WebFetch가 402/403 → **인app 브라우저로 읽기**.
- 배포: `fly deploy -a pokegre` (사용자 인가 하에). 프로덕션 `/data` 읽기는 집계만, PII 금지.

## 신고함 처리
`/data/translation-feedback.json`(번역 신고), `/data/community-reports.json`(게시글 신고). 운영자만 GET/DELETE. 서버 접근: `fly ssh console -a pokegre -C "..."`.
