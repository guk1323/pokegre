import express from 'express'
import path from 'node:path'
import { mountApi } from './api.ts'

// 프로덕션 진입점. 개발은 vite가 API(server/api.ts)와 프론트를 함께 띄우지만,
// 배포에서는 이 프로세스가 둘 다 맡는다 — 같은 mountApi를 부르므로 라우팅은 개발과
// 동일하고, 빌드된 정적 파일은 여기서 직접 서빙한다.
const app = express()
const PORT = Number(process.env.PORT ?? 3000)
const DIST = path.resolve(process.cwd(), 'dist')

// API가 정적 파일보다 먼저다. 순서가 뒤집히면 SPA 폴백이 /api/* 요청까지 삼켜서
// index.html을 돌려주고, 클라이언트는 JSON 대신 HTML을 받아 파싱 에러를 낸다.
mountApi(app, process.env)

app.use(express.static(DIST))

// SPA 폴백. 위에서 API도 정적 파일도 처리하지 못한 GET은 전부 index.html로 넘겨
// 클라이언트 라우팅이 이어받게 한다. express 5는 '*' 경로 문법이 바뀌어서
// app.get('*')가 예전처럼 동작하지 않으므로 미들웨어로 받는다.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  res.sendFile(path.join(DIST, 'index.html'))
})

// 0.0.0.0으로 열어야 한다. 기본값(localhost)으로 두면 컨테이너 바깥에서 접속이
// 안 돼 Fly/Railway의 헬스체크가 실패한다.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`pokegre listening on :${PORT}`)
})
