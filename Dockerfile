# Node 22.18+ 가 .ts를 그대로 실행한다(타입 스트리핑). tsconfig에 erasableSyntaxOnly가
# 켜져 있어 코드가 전부 "타입만 지우면 JS"라 가능한 것이고, 덕분에 서버용 트랜스파일
# 단계가 없다. 24는 이 기능이 기본으로 켜져 있다.
FROM node:24-alpine AS builder
WORKDIR /app

# 소스보다 매니페스트를 먼저 복사한다. 소스만 고칠 때 npm ci 레이어가 캐시에서 재사용돼
# 빌드가 빨라진다.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── 실행 이미지 ───────────────────────────────────────────────────────────────
# 빌드 도구(vite, typescript 등)는 실행에 필요 없으므로 단계를 나눠 뺀다. 실행에 필요한
# 런타임 의존성은 express 하나다.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 빌드된 프론트와, .ts 그대로 실행할 서버 소스.
COPY --from=builder /app/dist ./dist
COPY server ./server
# 서버가 화면과 같이 쓰는 모듈(카드 뽑기 가격표·뽑기 로직). 이게 빠지면 서버가
# 아예 안 뜬다 — 실제로 한 번 배포가 죽었다. server/api.ts가 src/에서 import하는
# 파일이 늘어나면 여기에도 같이 있어야 한다.
COPY src/lib/packSets.ts src/lib/packDraw.ts src/lib/koreanizeTitle.ts src/lib/koreanizeEnglishTitle.ts src/lib/kanaToHangul.ts src/lib/manualPackOverrides.ts src/lib/setNameKo.ts src/lib/cardImg.ts src/lib/gradeOrder.ts src/lib/koCardName.ts src/lib/kstDay.ts src/lib/punct.ts src/lib/rarityCode.ts ./src/lib/
# 카드 이름 한글화에 쓰는 사전들. 공유 링크 미리보기 제목을 서버가 직접 만들 때 쓴다.
COPY src/data/pokemonNames.json src/data/pokemonNameAliases.json src/data/packNames.json src/data/cardNameKoEn.json ./src/data/
# 세트별 힛카드(값이 제일 높은 카드). scripts/fetch-set-hit-cards.mjs가 미리 받아 둔 것.
# 앨범 시세를 매일 받는 22세트 말고 나머지 세트의 힛카드가 여기서 나온다.
COPY src/data/setHitCards.json src/data/pptSetNames.json src/data/setCardNumberAlias.json ./src/data/
# 카드 이름 검색용 색인(31,603장). 서버만 읽는다 — public/ 에 두면 3MB가 그대로
# 공개돼 크롤러가 긁어 간다. scripts/gen-card-index.mts 로 만든다.
COPY card-index.json ./

EXPOSE 3000
CMD ["npm", "start"]
