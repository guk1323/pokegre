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

EXPOSE 3000
CMD ["npm", "start"]
