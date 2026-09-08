import { defineConfig, loadEnv, type Plugin } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mountApi, type ApiEnv } from './server/api.js'

// 백엔드 본체는 server/api.ts에 있다. configureServer는 개발 서버 전용이라, 여기서만
// 마운트하면 프로덕션 빌드에 API가 없다. 프로덕션은 server/index.ts가 같은 mountApi를
// Express에 꽂는다 — 라우팅이 한 곳에서 나오므로 개발과 배포가 갈리지 않는다.
function apiPlugin(env: ApiEnv): Plugin {
  return {
    name: 'pokegre-api',
    configureServer(server) {
      mountApi(server.middlewares, env)
    },
  }
}

// ESM이라 __dirname이 없다. 진입점 경로를 절대경로로 적으려고 만든다.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss(), apiPlugin(env)],
    // ⚠️ 개발 서버는 IPv4 루프백에 붙인다. 기본값(localhost)이면 macOS에서 ::1(IPv6)에만
    //    붙어서, 127.0.0.1로 접속하는 크롬이 「연결 거부」를 본다(2026-08-19 실측 —
    //    사장님 크롬에서 검수 화면이 안 열렸다). 개발 전용 설정이라 배포에는 영향 없다.
    //    (다른 PC에서도 보려고 잠깐 0.0.0.0으로 열었다가, 맥에서만 보기로 해 도로 닫았다.)
    server: { host: '127.0.0.1' },
    // ⚠️ 진입점이 둘이다. `index.html`이 사이트 본체고, `live.html`은 **방송용 카드 스캔**
    //    화면이다(src/live.tsx). 따로 세운 까닭은 방송 화면에 사이트 껍데기가 잡히면
    //    안 되고, App.tsx를 세 팀이 같이 만지기 때문이다.
    //    ⚠️ input을 적는 순간 vite는 여기 적힌 것만 짓는다 — **index.html을 빼면 안 된다.**
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          live: path.resolve(__dirname, 'live.html'),
        },
      },
    },
  }
})
