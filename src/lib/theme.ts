// 밝은 화면 / 어두운 화면 고르기.
//
// ⚠️⚠️ **색을 바꾸는 일은 CSS가 한다**(`index.css`의 「어두운 화면」 절).
//    여기는 `<html>`에 `data-theme`을 붙였다 떼는 것뿐이다. 색 클래스는 한 줄도 안 건드린다.
//
// 상태가 셋이다:
//   · `system`(기본) — 표시를 아예 안 붙인다. 폰·컴퓨터 설정을 그대로 따라간다.
//   · `light` / `dark` — 사람이 고정한 것. 시스템 설정보다 우선한다.
//
// ⚠️ **첫 그림이 그려지기 전에 발라야 한다.** 나중에 바르면 밝은 화면이 한 번 번쩍하고
//    어두워진다(FOUC). 그래서 `index.html`의 인라인 스크립트가 먼저 한 번 바르고,
//    앱이 뜬 뒤에는 이 파일이 맡는다. 두 곳의 열쇠 이름·값이 같아야 한다.
export type 화면테마 = 'system' | 'light' | 'dark';

export const THEME_KEY = 'pokegre_theme';

export function 저장된테마(): 화면테마 {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function 테마바르기(t: 화면테마): void {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme');
  else el.dataset.theme = t;
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* 저장 못 해도 이번 방문에는 적용된다 */
  }
}

/** 지금 실제로 어두운 화면인가(시스템 설정까지 따져서). */
export function 지금어두운가(): boolean {
  const t = 저장된테마();
  if (t !== 'system') return t === 'dark';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}
