import { useState } from 'react';
import type { SnkrdunkCard } from '../api/snkrdunk';
import {
  deleteAccount,
  PROVIDER_LABEL,
  UNLINK_LAST,
  nicknameErrorMessage,
  setNickname as saveNickname,
  startLinkLogin,
  unlinkProvider,
  type LoginProvider,
} from '../api/auth';
import { CardRow } from './CardRow';



const ALL_PROVIDERS: LoginProvider[] = ['kakao', 'naver'];


// 계정 카드 안에 들어가는 한 줄. 로그인 수단 연결은 평생 한 번 누르거나 아예 안 누르는
// 일이라, 상자를 따로 주면 정작 매번 보는 즐겨찾기보다 자리를 더 먹는다.
//
// 해제는 연결보다도 훨씬 드물어서 기본으로 감춘다 — "관리"를 눌러야 나온다.
function LoginMethods({
  providers,
  onChanged,
}: {
  providers: LoginProvider[];
  onChanged: (next: LoginProvider[]) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState<LoginProvider | null>(null);

  const linked = ALL_PROVIDERS.filter((p) => providers.includes(p));
  const unlinked = ALL_PROVIDERS.filter((p) => !providers.includes(p));

  async function handleUnlink(provider: LoginProvider) {
    if (!window.confirm(`${PROVIDER_LABEL[provider]} 연결을 해제할까요?`)) return;
    setBusy(provider);
    try {
      onChanged(await unlinkProvider(provider));
    } catch (e) {
      window.alert(
        e instanceof Error && e.message === UNLINK_LAST
          ? '마지막 로그인 수단은 해제할 수 없습니다. 해제하면 계정에 들어올 방법이 없어집니다.'
          : '해제하지 못했습니다.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (linked.length === 0) return null;

  return (
    <div className="mt-1.5 text-xs text-neutral-400">
      <span>
        {linked.map((p) => PROVIDER_LABEL[p]).join(' · ')}
        {linked.length === 1 ? '로 로그인 중' : ' 연결됨'}
      </span>

      {/* 아직 안 붙인 게 있으면 바로 연결하게 두고, 다 붙였으면 관리(=해제)만 남는다. */}
      {unlinked.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => startLinkLogin(p)}
          className="ml-1.5 font-semibold text-[#2a78d6] hover:underline"
        >
          {PROVIDER_LABEL[p]} 연결
        </button>
      ))}

      {linked.length > 1 && (
        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          className="ml-1.5 font-semibold text-[#2a78d6] hover:underline"
        >
          {managing ? '닫기' : '관리'}
        </button>
      )}

      {managing && (
        <div className="mt-2 space-y-1">
          {linked.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className="text-neutral-600">{PROVIDER_LABEL[p]}</span>
              <button
                type="button"
                disabled={busy === p || linked.length <= 1}
                onClick={() => handleUnlink(p)}
                className="text-neutral-400 hover:text-rose-500 disabled:opacity-40"
              >
                해제
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


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
      setError(nicknameErrorMessage(err));
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
  providers,
  onProvidersChange,
}: {
  loggedIn: boolean;
  nickname: string | null;
  createdAt?: number;
  onLogout: () => void;
  onRequestLogin: () => void;
  onNicknameChange: (nickname: string) => void;
  providers: LoginProvider[];
  onProvidersChange: (next: LoginProvider[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!loggedIn) {
    return (
      // ⚠️⚠️ **이 카드에 단추를 더 넣지 마라.** 화면 단추를 「로그인」 옆에 뒀다가 뺐다 —
      //    단추가 둘이 되니 설명이 좁은 칸에 밀려 **320px에서 여섯 줄**로 찢어졌다
      //    (사장님 지적: "작은 화면으로 보니까 옆에 설명이 되게 너저분하게 되네").
      //    폰에서 위아래로 쌓아 봤지만, 결국 **제목 줄로 옮기는 것**으로 정해졌다.
      <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 p-5">
        <div className="min-w-0">
          <p className="text-sm font-bold text-black mb-1">로그인하고 시작하기</p>
          <p className="text-xs text-neutral-500">
            관심 카드를 계정에 보관하고 커뮤니티에 글을 남길 수 있습니다.
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
    // 로그인 수단 줄이 펼쳐질 수 있어서 items-center 대신 items-start로 둔다.
    // 가운데 정렬이면 관리를 펼칠 때 로그아웃 버튼이 같이 내려간다.
    <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-neutral-200 p-5">
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
        <LoginMethods providers={providers} onChanged={onProvidersChange} />
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
// 회원 탈퇴. 로그아웃 옆에 두면 잘못 누르므로 페이지 맨 아래에 따로 두고, 무엇이
// 지워지고 무엇이 남는지 먼저 밝힌다.
function DeleteAccount({ loggedIn, onDone }: { loggedIn: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!loggedIn) return null;

  async function run() {
    if (!window.confirm('정말 탈퇴하시겠습니까? 되돌릴 수 없습니다.')) return;
    setBusy(true);
    setErr('');
    try {
      await deleteAccount();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '탈퇴 처리에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 border-t border-neutral-200 pt-5">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-neutral-400 underline underline-offset-2">
          회원 탈퇴
        </button>
      ) : (
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-sm font-bold text-black">회원 탈퇴</p>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-neutral-600">
            <li>회원 기록, 로그인 연결, 닉네임이 지워집니다.</li>
            <li>즐겨찾기·최근 본 카드가 지워집니다.</li>
            <li>오늘의 상점의 GP·보관함·앨범이 모두 지워집니다.</li>
            <li>이미 쓴 글과 댓글은 남고, 작성자만 알 수 없게 표시됩니다. 먼저 지우고 싶으시면 탈퇴 전에 직접 지워 주세요.</li>
            <li>백업본에 남은 기록은 최대 7일 안에 함께 사라집니다.</li>
          </ul>
          {err && <p className="mt-2 text-xs text-rose-500">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            >
              {busy ? '처리 중…' : '탈퇴하기'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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
  recentMissing,
  favoritesMissing,
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
  /** 지금 못 받은 장수(없어진 것 말고). 0보다 크면 안내를 띄운다. */
  recentMissing: number;
  favoritesMissing: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  isFavorite: (apparelId: number) => boolean;
  onToggleFavorite: (card: SnkrdunkCard) => void;
  onClearRecent: () => void;
  onClearFavorites: () => void;
}) {
  return (
    <>
      {/* ⚠️ 이 화면에만 제목이 없었다(운영자 지적 2026-08-05). 다른 화면은 다 "여기가
          어디인지"를 먼저 알려주는데 마이페이지만 바로 "최근 본 카드"부터 시작했다.
          로그인 뒤 이리로 튕겨 들어오면 어디인지 알 길이 없다.
          크기는 다른 화면 제목과 같은 18px(text-lg)이다. */}
      <h2 className="mb-4 text-lg font-bold text-black">마이페이지</h2>
      <AccountCard
        loggedIn={loggedIn}
        nickname={nickname}
        createdAt={createdAt}
        onLogout={onLogout}
        onRequestLogin={onRequestLogin}
        onNicknameChange={onNicknameChange}
        providers={providers}
        onProvidersChange={onProvidersChange}
      />

      <CardRow
        title="최근 본 카드"
        items={recentlyViewed}
        emptyText="아직 본 카드가 없습니다. 카드를 검색해서 눌러보세요."
        selectedId={selectedId}
        onSelect={onSelect}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onClear={onClearRecent}
        missing={recentMissing}
      />
      <CardRow
        title="즐겨찾기 카드"
        items={favorites}
        emptyText="카드의 북마크를 눌러서 즐겨찾기에 담아보세요."
        selectedId={selectedId}
        onSelect={onSelect}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onClear={onClearFavorites}
        missing={favoritesMissing}
      />
      <DeleteAccount loggedIn={nickname !== null || providers.length > 0} onDone={() => window.location.replace('/')} />
    </>
  );
}
