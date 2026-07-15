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
  }
})
