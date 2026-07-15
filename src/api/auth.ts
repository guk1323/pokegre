export interface AuthState {
  loggedIn: boolean;
  nickname?: string | null;
  createdAt?: number;
}

export async function fetchMe(): Promise<AuthState> {
  const res = await fetch('/api/local/auth/me');
  if (!res.ok) return { loggedIn: false };
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch('/api/local/auth/logout', { method: 'POST' });
}

export const NICKNAME_TAKEN = 'nickname_taken';

export async function setNickname(nickname: string): Promise<string> {
  const res = await fetch('/api/local/auth/nickname', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  // 중복 닉네임은 사용자가 고쳐서 재시도할 수 있는 상황이라 별도로 구분한다.
  if (res.status === 409) throw new Error(NICKNAME_TAKEN);
  if (!res.ok) throw new Error('닉네임을 저장하지 못했습니다.');
  return (await res.json()).nickname;
}

// 카카오 인증 페이지로 이동. 서버가 state를 발급하고 리다이렉트한다.
export function startKakaoLogin(): void {
  window.location.href = '/api/local/auth/kakao';
}
