import { useState } from 'react';
import { nicknameErrorMessage, setNickname } from '../api/auth';

// 카카오 닉네임을 그대로 쓰지 않고 직접 정하게 한다. 카톡 프로필 이름은 실명인 경우가
// 많아서 게시판에 그대로 노출되면 곤란하기 때문(애초에 동의항목에서 요청하지도 않는다).
export function NicknameSetup({ onDone }: { onDone: (nickname: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      onDone(await setNickname(trimmed));
    } catch (err) {
      setError(nicknameErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-bold text-black mb-1">닉네임을 정해주세요</h2>
        <p className="text-xs text-neutral-500 mb-4">
          커뮤니티에 표시될 이름이에요. 카카오 프로필과는 무관하며, 언제든 바꿀 수 있어요.
        </p>

        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="예: 리자몽콜렉터"
          maxLength={20}
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}

        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="mt-4 w-full rounded-lg bg-black py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? '저장 중...' : '시작하기'}
        </button>
      </form>
    </div>
  );
}
