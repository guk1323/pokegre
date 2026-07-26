# pokegre — 작업 전 필독

포켓몬 카드 시세·세트·센터링·일러스트 사이트. React+TS+Vite 프론트 / Node·Express 서버(`server/api.ts`의 `mountApi`, Node 24로 .ts 직접 실행). Fly.io 배포(app `pokegre`, 도쿄). 사용자는 비개발자 — 쉬운 한국어로, 짧게.

## ⚠️ 최우선 규칙

**① 추측 금지 — 사실은 검증하고 말할 것.** API 기능·요금제·데이터 범위 같은 사실을 **마케팅 문구나 기억으로 넘겨짚지 말고**, 실제 **문서·API 응답·코드**로 확인한 뒤 답한다. 확인 못 하면 "미확인"이라고 명시(넘겨짚어서 틀린 적 반복됨 — 예: PPT 팝수를 "PSA 위주"라 잘못 말함, 실제론 GemRate 다회사). 검증 소스: PPT 문서 https://www.pokemonpricetracker.com/docs (JS 로딩이라 **브라우저 preview로 열어야** 읽힘), 각 API 직접 호출, 리포 코드.

**② 보유한 기능·API에 맞춰 일할 것.** 어떤 작업을 지시받든, 시작 전에 아래 "보유 API·결제 항목" 표를 먼저 보고 그 자원을 활용해 계획·수행. 맨땅에서 시작하거나 이미 결제·발급된 도구를 잊고 헤매지 말 것.

- 예: "세트 이미지 채워줘" → 무료 pokemontcg 키·유료 PPT(이미지 포함)를 **먼저 떠올려** 그걸로 함.
- 예: "시세 관련" → PPT(유료) 기능을 최대한 활용.
- 새 작업 전 `.env`도 함께 확인(값은 출력 금지, 존재·용도만). 새 API가 생겼는데 표에 없으면 사용자에게 확인 후 추가.

## 보유 API · 결제 항목 (`.env`)

| 키 | 용도 | 결제 | 코드 사용 | 주의점 |
|---|---|---|---|---|
| `POKEMON_PRICE_TRACKER_API_KEY` | **PPT** (pokemonpricetracker.com/api/v2). eBay·TCGplayer 시세, 등급별 히스토리 | **유료(Pro $10)** | server/api.ts (Bearer) | `/cards` 응답에 **카드 이미지도 포함**(`imageCdnUrl` 200/400/800, tcgplayer-cdn). `setName`으로 조회 가능. **rate limit 매우 빡빡 — 2~3연속 호출이면 429**. `page` 파라미터 없음(`limit`만, 최대 250). |
| `POKEMONTCG_API_KEY` | **pokemontcg.io** 카드 이미지·데이터 | 무료 | **코드 미사용(데이터 작업용)** | 이미지 채우기 등 스크립트에서 `X-Api-Key` 헤더로. 키 없이 부르면 rate limit 걸림 → **반드시 이 키 사용**. 데이터 API가 가끔 500 뜸. |
| `EBAY_APP_ID` / `EBAY_CERT_ID` | **이베이 Browse API** — 한글판(Korean Version) **현재 매물가(호가)**. server/api.ts `mountEbayKorean` → `/api/local/ebay-korean?q=` | 무료(Browse) | server/api.ts (OAuth client_credentials) | 이베이는 **매물 제목이 영어**라 `"카드명 Korean Version"`로 검색. **호가만**(체결가=Marketplace Insights는 별도 승인 필요, 403). 화면은 이베이 판 토글의 "한글판"(edition='korean' → KoreanEbayView). Fly엔 `fly secrets set`으로. |
| `ANTHROPIC_API_KEY` | 카드 사진 스캔(이미지→카드 인식) | 종량제 | server/api.ts | scan-card는 인증 필요(요금 방지). |
| `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET` | 카카오 로그인 | 무료 | server/api.ts | |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 로그인 | 무료 | server/api.ts | |
| `OPENCHAT_URL` | 커뮤니티 오픈채팅 링크 | — | server/api.ts | |

## 📡 PPT 상세 (문서 직접 검증, 2026-07)

문서: https://www.pokemonpricetracker.com/docs (브라우저 preview로 열어야 읽힘). **아래는 추측 아니라 문서/API로 확인한 것:**
- **시세 마켓**: TCGplayer(미국) + eBay 등급 낙찰 + **Cardmarket(EUR, Pro/Business)**.
- **등급 시세(PSA·CGC·BGS·SGC)**: 모든 유료 티어(우리 $10 포함). eBay 낙찰 기반.
- **팝수(Population)**: **GemRate 기반 → PSA·CGC·BGS·SGC 등 여러 회사** (PSA 전용 아님!). **Business($99) 전용**, `/population` 엔드포인트(파라미터 `tcgPlayerId`), 카드당 2크레딧. 우리 $10 키는 403.
- **요금제**: Free 100/일 · **API $10 = 20,000/일** · Business $99 = 200,000/일 · Enterprise $300 = 100만/일.
- **한도는 응답 헤더로 확인할 것**(추측 금지): `x-ratelimit-daily-limit/remaining/reset`, `x-ratelimit-minute-limit/remaining`. **분당은 "요청 60번"이지 크레딧이 아니다**(예전에 '분당 크레딧 500'이라 적어둔 건 오류). 일일은 크레딧이며 `limit=200` 한 번이 200크레딧. **초기화는 매일 UTC 0시 = 한국시간 오전 9시.**
- **크레딧 규칙**: `limit`(기본 50)에 과금 — 단건은 `limit=1`이나 `tcgPlayerId`로. history/ebay/cardmarket 각 +1/카드. **`page` 없음, `offset`은 됨**. limit을 크게 줘도 **한 번에 200행까지만** 준다 — 세트가 200행을 넘으면 offset=200,400…으로 이어받아야 앞번호 카드가 안 잘린다(2026-07-25 실측, 리자몽 6번이 이걸로 빠졌었다).
- 이미지: `imageCdnUrl` 200/400/800(tcgplayer-cdn).
- Scrydex와 비교: 팝수까지 PPT가 다회사로 커버하므로, 우리(포켓몬 전용)엔 Scrydex 고유 이점은 사진인식(이미 Claude로 있음)·멀티게임(불필요)뿐 → **갈 이유 없음**.

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

## 🗺️ 이미 구현된 기능 · 데이터 흐름 (⚠️ "없다/안 쓴다" 단정 전에 여기부터 확인)

**어떤 기능을 "추가하자/없다/안 쓴다"고 말하기 전에, 이 지도와 실제 코드부터 확인할 것.** (이미 있는 걸 잊고 새로 만들자 하거나 "안 쓴다"고 잘못 말한 적 있음 — 사용자 반복 지적.)

**화면(App.tsx의 view):** `cards`(시세) · `artists`(일러스트레이터) · `centering`(센터링) · `community` · `mypage` · `sets`(운영자) · `reports`/`stats`(운영자)

**소스 → 기능 매핑 (핵심 — 자주 까먹음):**
| 데이터 소스 | 앱에서 이미 하는 것 |
|---|---|
| **PPT** | **eBay 등급별 시세·시세추이 차트·총 낙찰건수(EbayCardDetail/EbayPriceChart/EbayCompareView)** + **TCGplayer 마켓가(TcgPlayerCardDetail)** + 카드 이미지. 등급회사 PSA·BGS·CGC·SGC·TAG 다 받음. → **등급 시세 기능은 이미 있음!** |
| **SNKRDUNK** | 일본판 실거래가·거래이력(CardTile/CardDetail/PriceChart) |
| **TCGdex** | 세트/카드 DB(public/sets/*.json → SetsView), 일러스트레이터(ArtistsView) |
| **pokemontcg.io** | 세트 카드 이미지 보강 |
| **Anthropic** | 사진→카드 인식(CardScanButton/cardScan.ts) |
| **Kakao/Naver** | 로그인 → 커뮤니티/마이페이지(즐겨찾기·최근본·계정연동) |
| 부가 | 한국 뉴스(PokemonNews), 인기검색어·자동완성, 환율(KrwHint), 공유버튼 |

**아직 안 쓰는(=보강 여지) PPT 데이터:** 등급별 판매 "개수"·거래 속도(salesVelocity)는 받는데 화면엔 덜 씀.

## 자주 잊는 함정 (오늘까지 배운 것)

- **세트별 카드 이미지**는 `public/sets/*.json`에 **빌드 시점에 박혀 있다**(런타임에 API 안 부름). 각 카드 `{n, name, img}`. 빈칸(img="") 채우려면 **pokemontcg.io(무료 키) 또는 PPT**로 받아 `--write`. 소스 매칭은 **번호+카드이름 둘 다 일치할 때만**(엉뚱한 이미지 방지 — 사용자 최우선 원칙: "틀린 것보다 빈칸").
- **이미지 프록시** `/api/img`는 wsrv로 축소. **tcgplayer-cdn은 wsrv가 막혀** 302로 원본 폴백(그래도 표시됨). 화이트리스트는 server/api.ts `IMG_ALLOWED_HOSTS`.
- **세트 화면(SetsView)은 현재 `isAdmin` 전용**(App.tsx). 일반 유저에겐 안 보임.
- **환율은 "어제 날짜"가 정상 = 버그 아님.** 유럽중앙은행 일일 발표값(Frankfurter `/latest`)이라 평일 하루 한 번, 보통 전날 값. "7.XX 환율 기준" 라벨은 의도된 표기(실시간 아님을 밝히는 것). FX 수수료로 어차피 2~5% 어긋나서 실시간 살 이유 없음 — 그렇게 설계함. **"환율 안 바뀐다/멈췄다"고 오해 말 것.**
- **트레이너 이름 번역**: 예전 세션이 일본어 음역을 잘못 넣은 게 많았음 → [[pokegre-trainer-romaji-errors]] 참고. 나무위키/Fandom은 WebFetch가 402/403 → **인app 브라우저로 읽기**.
- 배포: `fly deploy -a pokegre` (사용자 인가 하에). 프로덕션 `/data` 읽기는 집계만, PII 금지. **배포 전 검증은 `npm run build`로** — `npx tsc --noEmit`은 통과해도 빌드용 `tsc -b`(프로젝트참조·incremental)가 더 엄격해 다른 에러를 잡는다(한 번 배포 실패함). 새 서버 키는 `.env`뿐 아니라 `fly secrets set ... -a pokegre`도 필요(프로덕션은 .env 안 읽음).

## 카드명 번역 점검
**공식 한글 카드명 출처(제일 정확 — 추측하지 말 것):** 포켓몬코리아 카드검색 `https://pokemoncard.co.kr/cards/detail/<CardNum>` 은 서버렌더라 curl로 읽힌다. 이름은 `class="card-hp title"`, 번호는 `class="p_num"`, 이미지 경로에 세트코드가 들어 있다. **CardNum = 세트별 접두사 + 카드번호 3자리**(예: `BS2019007`+`092` = SM10 92번). 접두사는 `BS<연도><세트순번3자리>`라 `...001`을 훑어 세트별로 알아낼 수 있다(2018~2026 매핑을 이미 한 번 떴다). ⚠️ **한국판은 서포트·굿즈 블록을 한글 가나다순으로 다시 매긴다** — 번호가 일본판과 1:1이 아니다. 블록(예: SM12a 148~163) 전체를 받아, 이미 맞는 이름들을 짝지어 두고 **남은 것끼리 소거법**으로 맞춰야 한다. 한국 미발매(1996~2006 옛 세트)는 이 방법이 안 되니 표준 외래어 표기로.

`npx tsx scripts/card-name-audit.mts --list` — ①일본어 잔여 ②음역으로 깨진 이름 ③**공식 카드명 대조**. ③이 제일 정확하다: `scripts/ko-official-card-names.json`(공식 사이트에서 받아 둔 39개 세트·2,083장의 정식 한글명)에 우리 결과가 있는지 본다. 없으면 우리가 틀린 것. 세트가 늘면 위 방법으로 더 받아 이 파일에 합치면 된다.
**고치기 전후로 전체 카드명 렌더 결과를 떠서 diff할 것** — 2글자 규칙이 다른 이름을 깨뜨렸는지(예: `デンジ`가 `デンジャラス`를 깸) 이걸로만 잡힌다. 옛 세트(e시리즈·PCG·neo)는 **원본 TCGdex의 일본어 칸이 오염**(정식 일본명 대신 영어명 가타카나 음차: `デンリュウ`가 아니라 `アンファロス`)돼 있어 사전이 못 잡는 게 원인 — 우리 번역기 버그가 아니다. 포켓몬은 `src/data/pokemonNameAliases.json`, 굿즈·트레이너는 `STRUCTURAL_TERMS`에 추가. **별칭은 3글자 이상만**(2글자는 다른 이름에 끼어듦), 추가 전 트레이너 이름과 충돌 검사, 한글명은 `pokemonNames.json`에서 가져올 것. 상세는 메모리 [[pokegre-translation-batch-check]].

## 신고함 처리
`/data/translation-feedback.json`(번역 신고), `/data/community-reports.json`(게시글 신고). 운영자만 GET/DELETE. 서버 접근: `fly ssh console -a pokegre -C "..."`.

## 배포 이미지 파일 검사 (2026-07-26)
배포 이미지에는 `dist`와 `server`만 들어가고, server가 `src`에서 가져다 쓰는 파일은
Dockerfile에 손으로 적어 복사한다. 목록이 어긋나면 빌드도 배포도 성공한 것처럼 보이는데
서버가 뜨자마자 ERR_MODULE_NOT_FOUND로 죽어 502가 된다(2026-07-25 실제 사고).

이제 `npm run build`가 먼저 `scripts/check-deploy-files.mjs`를 돌린다 — server에서
import를 따라가며 필요한 src 파일을 모아 Dockerfile COPY 목록과 대조하고, 빠진 게
있으면 추가할 줄까지 알려주며 빌드를 멈춘다. Dockerfile의 builder 단계도 이 build를
쓰므로 **잘못된 이미지는 아예 만들어지지 않는다.**

## 데이터 보관 · 복구 (2026-07-26)
`/data`의 JSON이 이 서비스의 전부다(회원·세션·앨범/GP·게시글·통계). 세 겹으로 지킨다.

1. **안전 저장** — `writeJsonFile()`이 임시 파일에 쓴 뒤 이름만 바꾼다. 쓰는 중에 기계가
   죽어도 파일이 반토막 나지 않는다. 임시 이름에는 프로세스 번호+일련번호가 붙어 저장이
   겹쳐도 섞이지 않는다. **JSON 저장은 반드시 이 함수를 쓸 것**(`writeFile` 직접 금지).
2. **깨진 파일 보존** — 읽기에 실패하면 `rescueCorrupt()`가 `X.json.corrupt-<시각>`으로
   옮기고 로그를 남긴다. 예전처럼 빈 값으로 시작해 그대로 덮어쓰는 일이 없다.
3. **백업** — 기동할 때 한 번 + 하루 한 번 `/data/backups/<날짜>/`에 통째로 복사(7일치).
   배포마다 기계가 새로 뜨므로 "배포 직전 상태"가 늘 남는다.

**복구 절차(실제로 해보고 확인함):**
```bash
fly ssh console -a pokegre -C "ls /data/backups"          # 날짜 확인
fly ssh console -a pokegre -C "cp /data/backups/2026-07-26/packsim.json /data/packsim.json"
fly apps restart pokegre                                   # 메모리 캐시를 비워야 반영된다
```
⚠️ 서버는 파일을 메모리에 들고 있으므로 **되돌린 뒤 반드시 재시작**해야 한다.
