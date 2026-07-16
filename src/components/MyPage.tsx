import { useState } from 'react';
import type { SnkrdunkCard } from '../api/snkrdunk';
import {
  NICKNAME_TAKEN,
  PROVIDER_LABEL,
  UNLINK_LAST,
  setNickname as saveNickname,
  startLinkLogin,
  unlinkProvider,
  type LoginProvider,
} from '../api/auth';
import { CardRow } from './CardRow';

const ALL_PROVIDERS: LoginProvider[] = ['kakao', 'naver'];

// 카카오·네이버는 서로 다른 회원번호를 주고, 이름이나 이메일을 안 받으므로 같은
// 사람인지 알 방법이 없다. 그래서 자동으로 합치지 않고 여기서 본인이 직접 연결한다.
// 연결해두면 어느 걸로 들어오든 즐겨찾기와 글이 그대로 따라온다.
function LinkedAccounts({
  providers,
  onChanged,
}: {
  providers: LoginProvider[];
  onChanged: (next: LoginProvider[]) => void;
}) {
  const [busy, setBusy] = useState<LoginProvider | null>(null);

  async function handleUnlink(provider: LoginProvider) {
    if (!window.confirm(`${PROVIDER_LABEL[provider]} 연결을 해제할까요?`)) return;
    setBusy(provider);
    try {
      onChanged(await unlinkProvider(provider));
    } catch (e) {
      window.alert(
        e instanceof Error && e.message === UNLINK_LAST
          ? '마지막 로그인 수단은 해제할 수 없어요. 해제하면 계정에 들어올 방법이 없어집니다.'
          : '해제하지 못했습니다.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-neutral-200 p-5">
      <p className="text-sm font-bold text-black mb-1">로그인 수단</p>
      <p className="text-xs text-neutral-500 mb-3">
        연결해두면 어느 쪽으로 로그인해도 같은 계정으로 들어옵니다.
      </p>
      <ul className="space-y-2">
        {ALL_PROVIDERS.map((p) => {
          const linked = providers.includes(p);
          return (
            <li key={p} className="flex items-center justify-between gap-3">
              <span className="text-sm text-neutral-800">
                {PROVIDER_LABEL[p]}
                {linked && <span className="ml-2 text-xs text-neutral-400">연결됨</span>}
              </span>
              {linked ? (
                <button
                  type="button"
                  disabled={busy === p || providers.length <= 1}
                  onClick={() => handleUnlink(p)}
                  // 마지막 하나는 아예 못 누르게 막는다. 눌러보고 거절당하는 것보다
                  // 처음부터 못 누르는 게 낫다.
                  title={providers.length <= 1 ? '마지막 로그인 수단은 해제할 수 없습니다' : undefined}
                  className="flex-shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                >
                  해제
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startLinkLogin(p)}
                  className="flex-shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800"
                >
                  연결
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// 가입 당일이 1일차. (지금 - 가입일)을 그냥 나누면 0일차가 나와서 어색하다.
function daysSince(createdAt: number): number {
  return Math.floor((Date.now() - createdAt) / 86_400_000) + 1;
}

function NicknameEditor({
  nickname,
  onSaved,
  onCancel,
}: {
  nickname: string;
  onSaved: (nickname: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(nickname);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (!next) return;
    if (next === nickname) return onCancel();
    setSaving(true);
    setError('');
    try {
      onSaved(await saveNickname(next));
    } catch (err) {
      setError(err instanceof Error && err.message === NICKNAME_TAKEN ? '이미 사용 중인 닉네임이에요.' : '닉네임을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="min-w-0 flex-1">
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          autoFocus
          maxLength={20}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="flex-shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          저장
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          취소
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-rose-500">{error}</p>}
    </form>
  );
}

function AccountCard({
  loggedIn,
  nickname,
  createdAt,
  onLogout,
  onRequestLogin,
  onNicknameChange,
}: {
  loggedIn: boolean;
  nickname: string | null;
  createdAt?: number;
  onLogout: () => void;
  onRequestLogin: () => void;
  onNicknameChange: (nickname: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!loggedIn) {
    return (
      <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 p-5">
        <div className="min-w-0">
          <p className="text-sm font-bold text-black mb-1">로그인하고 시작하기</p>
          <p className="text-xs text-neutral-500">
            관심 카드를 계정에 보관하고 커뮤니티에 글을 남길 수 있어요.
          </p>
        </div>
        <button
          type="button"
          onClick={onRequestLogin}
          className="flex-shrink-0 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          로그인
        </button>
      </div>
    );
  }

  if (editing && nickname !== null) {
    return (
      <div className="mb-6 rounded-xl border border-neutral-200 p-5">
        <NicknameEditor
          nickname={nickname}
          onSaved={(next) => {
            onNicknameChange(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 p-5">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-base font-bold text-black truncate">{nickname ?? '...'}</p>
          {nickname !== null && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex-shrink-0 text-xs text-neutral-400 hover:text-black"
            >
              변경
            </button>
          )}
        </div>
        {createdAt && (
          <p className="text-xs text-neutral-400 mt-0.5">
            가입 {daysSince(createdAt).toLocaleString()}일차 ·{' '}
            {new Date(createdAt).toLocaleDateString('ko-KR')}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="flex-shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        로그아웃
      </button>
    </div>
  );
}

// 관심 카드는 localStorage에 있어서 로그인과 무관하게 동작한다. 그래서 마이페이지를
// 로그인 전용으로 막지 않고, 계정 카드만 로그인 여부에 따라 바꾼다.
export function MyPage({
  loggedIn,
  nickname,
  createdAt,
  onLogout,
  onRequestLogin,
  onNicknameChange,
  providers,
  onProvidersChange,
  recentlyViewed,
  favorites,
  selectedId,
  onSelect,
  isFavorite,
  onToggleFavorite,
  onClearRecent,
  onClearFavorites,
}: {
  loggedIn: boolean;
  nickname: string | null;
  createdAt?: number;
  onLogout: () => void;
  onRequestLogin: () => void;
  onNicknameChange: (nickname: string) => void;
  providers: LoginProvider[];
  onProvidersChange: (next: LoginProvider[]) => void;
  recentlyViewed: SnkrdunkCard[];
  favorites: SnkrdunkCard[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  isFavorite: (apparelId: number) => boolean;
  onToggleFavorite: (card: SnkrdunkCard) => void;
  onClearRecent: () => void;
  onClearFavorites: () => void;
}) {
  return (
    <>
      <AccountCard
        loggedIn={loggedIn}
        nickname={nickname}
        createdAt={createdAt}
        onLogout={onLogout}
        onRequestLogin={onRequestLogin}
        onNicknameChange={onNicknameChange}
      />

      {loggedIn && <LinkedAccounts providers={providers} onChanged={onProvidersChange} />}

      <CardRow
        title="최근 본 카드"
        items={recentlyViewed}
        emptyText="아직 본 카드가 없어요. 카드를 검색해서 눌러보세요."
        selectedId={selectedId}
        onSelect={onSelect}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onClear={onClearRecent}
      />
      <CardRow
        title="즐겨찾기 카드"
        items={favorites}
        emptyText="카드의 하트를 눌러서 즐겨찾기에 담아보세요."
        selectedId={selectedId}
        onSelect={onSelect}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onClear={onClearFavorites}
      />
    </>
  );
}
