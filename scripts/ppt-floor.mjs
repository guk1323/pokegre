// PPT 크레딧 바닥선. 스크립트가 여기를 넘어 쓰지 못하게 막는다.
//
// 왜 있나: 2026-08-03에 하루치 20,000이 아침 예약 작업 한 번으로 거의 다 빠졌다.
// 크레딧이 없으면 방문자에게 이베이·TCGplayer 시세가 통째로 안 나오고, 다시 차는 건
// 다음 날 한국시간 오전 9시(UTC 0시)다. 사용자가 "5,000 밑으로는 절대 쓰지 마라"고
// 규칙으로 못 박았다.
//
// 서버(server/api.ts)는 미리받기에 PPT_KEEP_FOR_VISITORS = 8000으로 더 보수적인 선을
// 두고 있다. 스크립트에는 그런 게 없어서 이 파일을 만들었다.
//
// 쓰는 법 — PPT를 부르는 스크립트는 시작할 때 한 번, 그리고 응답을 받을 때마다:
//   import { assertFloor, noteLeft, FLOOR } from './ppt-floor.mjs'
//   ...
//   noteLeft(res.headers.get('x-ratelimit-daily-remaining'))   // 응답마다
//   if (!assertFloor(다음에_쓸_크레딧)) break                    // 부르기 전에
export const FLOOR = 5000

let left = null

/** 응답 헤더의 남은 크레딧을 기록한다. 숫자가 아니면 무시한다. */
export function noteLeft(headerValue) {
  const n = Number(headerValue)
  if (Number.isFinite(n)) left = n
  return left
}

export const leftNow = () => left

/**
 * 이만큼 더 써도 바닥선을 안 넘는지 본다. 넘으면 false를 주고 이유를 찍는다.
 * 아직 남은 양을 모르면(첫 호출 전) 통과시킨다 — 첫 응답에서 알게 된다.
 */
export function assertFloor(about = 0) {
  if (left === null) return true
  if (left - about >= FLOOR) return true
  console.log(
    `\n멈춥니다 — 크레딧 바닥선(${FLOOR.toLocaleString()})에 닿습니다.` +
      `\n  남은 ${left.toLocaleString()} · 다음에 쓸 것 약 ${about.toLocaleString()}` +
      `\n  한국시간 오전 9시에 20,000으로 다시 찹니다.`,
  )
  return false
}
