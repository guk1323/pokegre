// 방송용 카드 스캔 화면의 진입점.
//
// ⚠️ **App.tsx가 아니라 따로 선 페이지다**(live.html). 까닭이 셋이다:
//   (1) 방송 화면에 사이트 껍데기(윗줄·검색바·광고)가 같이 잡히면 안 된다.
//   (2) App.tsx는 세 팀이 같이 만지는 파일이라, 방송 도구 때문에 부딪힐 이유가 없다.
//   (3) server/api.ts를 한 줄도 안 고친다 — 이미 있는 창구(scan-card·card-board)만 쓴다.
//       그래서 지휘부 차례를 안 기다리고 만들 수 있었다.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LiveScan } from './components/LiveScan.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LiveScan />
    </ErrorBoundary>
  </StrictMode>,
)
