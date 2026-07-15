const NICKNAME_KEY = 'pokegre:nickname';

export function getSavedNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, name);
  } catch {
    // localStorage를 못 쓰는 환경이면 조용히 무시한다.
  }
}
