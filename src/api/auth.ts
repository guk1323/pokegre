import type { StoredCardRef } from './snkrdunk';

export interface AuthState {
  loggedIn: boolean;
  nickname?: string | null;
  createdAt?: number;
  // 신고함 메뉴를 보여줄지 정하는 용도. 실제 차단은 서버가 한다.
  isAdmin?: boolean;
  // 이 계정에 연결된 로그인 수단. 보통 하나지만 본인이 연결하면 늘어난다.
  providers?: LoginProvider[];
}

export type LoginProvider = "kakao" | "naver";

export const PROVIDER_LABEL: Record<LoginProvider, string> = {
  kakao: "카카오",
  naver: "네이버",
};

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

// 인증 페이지로 이동. 서버가 state를 발급하고 리다이렉트한다.
export function startKakaoLogin(): void {
  window.location.href = '/api/local/auth/kakao';
}

export function startNaverLogin(): void {
  window.location.href = "/api/local/auth/naver";
}

// 로그인이 아니라 "지금 로그인한 계정에 이 수단을 붙이러" 간다. 서버가 state에
// 연결 의도를 담아뒀다가 돌아올 때 처리한다.
export function startLinkLogin(provider: LoginProvider): void {
  window.location.href = `/api/local/auth/${provider}?link=1`;
}

export const UNLINK_LAST = "last_login";

export async function unlinkProvider(provider: LoginProvider): Promise<LoginProvider[]> {
  const res = await fetch("/api/local/auth/unlink", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error === UNLINK_LAST ? UNLINK_LAST : "연결을 해제하지 못했습니다.");
  return body.providers;
}

export interface StoredCollections {
  favorites: StoredCardRef[];
  recent: StoredCardRef[];
}

export async function fetchCollections(): Promise<StoredCollections | null> {
  const res = await fetch('/api/local/auth/collections');
  if (!res.ok) return null;
  return res.json();
}

export async function saveCollections(input: Partial<StoredCollections>): Promise<void> {
  await fetch('/api/local/auth/collections', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// 로그인 직후 1회. 비로그인일 때 이 기기에 담아둔 걸 계정으로 합친다.
export async function mergeCollections(input: StoredCollections): Promise<StoredCollections | null> {
  const res = await fetch('/api/local/auth/collections/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  return res.json();
}
