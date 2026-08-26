import { defineConfig, loadEnv, type Plugin } from 'vite'
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
  }
})
