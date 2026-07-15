import type { SnkrdunkCard } from '../api/snkrdunk';
import { CardRow } from './CardRow';

// 가입 당일이 1일차. (지금 - 가입일)을 그냥 나누면 0일차가 나와서 어색하다.
function daysSince(createdAt: number): number {
  return Math.floor((Date.now() - createdAt) / 86_400_000) + 1;
}

function AccountCard({
  loggedIn,
  nickname,
  createdAt,
  onLogout,
  onRequestLogin,
}: {
  loggedIn: boolean;
  nickname: string | null;
  createdAt?: number;
  onLogout: () => void;
  onRequestLogin: () => void;
}) {
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

  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 p-5">
      <div className="min-w-0">
        <p className="text-base font-bold text-black truncate">{nickname ?? '...'}</p>
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
  recentlyViewed,
  favorites,
  selectedId,
  onSelect,
  isFavorite,
  onToggleFavorite,
}: {
  loggedIn: boolean;
  nickname: string | null;
  createdAt?: number;
  onLogout: () => void;
  onRequestLogin: () => void;
  recentlyViewed: SnkrdunkCard[];
  favorites: SnkrdunkCard[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  isFavorite: (apparelId: number) => boolean;
  onToggleFavorite: (card: SnkrdunkCard) => void;
}) {
  return (
    <>
      <AccountCard
        loggedIn={loggedIn}
        nickname={nickname}
        createdAt={createdAt}
        onLogout={onLogout}
        onRequestLogin={onRequestLogin}
      />

      <CardRow
        title="최근 본 카드"
        items={recentlyViewed}
        emptyText="아직 본 카드가 없어요. 카드를 검색해서 눌러보세요."
        selectedId={selectedId}
        onSelect={onSelect}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
      />
      <CardRow
        title="즐겨찾기 카드"
        items={favorites}
        emptyText="카드의 하트를 눌러서 즐겨찾기에 담아보세요."
        selectedId={selectedId}
        onSelect={onSelect}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
      />
    </>
  );
}
