import { useState } from 'react';
import { nicknameErrorMessage, setNickname } from '../api/auth';

// 로그인에 쓴 계정의 이름을 그대로 쓰지 않고 직접 정하게 한다. 카톡·네이버 프로필
// 이름은 실명인 경우가 많아서 게시판에 그대로 노출되면 곤란하기 때문(애초에 동의항목에서
// 요청하지도 않는다 — 받는 건 회원번호뿐이다).
//
// 이 화면은 카카오·네이버 어느 쪽으로 들어와도 뜬다. 그래서 문구에 특정 서비스 이름을
// 넣지 않는다(예전엔 "카카오 프로필과는 무관하며"라 적혀 있어 네이버로 들어온 사람에겐
// 엉뚱한 말이었다).
export function NicknameSetup({ onDone }: { onDone: (nickname: string) => void }) {
  const [value, setValue] = useState('');
  // 만 14세 미만은 법정대리인 동의가 필요하다. 우리는 대리인 동의를 받을 방법이 없으므로,
  // 가입 문턱에서 나이를 스스로 확인하게 하고 그 아래면 가입을 진행하지 않는다.
  const [ageOk, setAgeOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || !ageOk) return;
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
          커뮤니티에 표시될 이름입니다. 로그인에 쓴 계정의 이름과는 무관하며, 언제든 바꿀 수 있습니다.
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

        <label className="mt-3 flex items-start gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={ageOk}
            onChange={(e) => setAgeOk(e.target.checked)}
            className="mt-0.5 flex-shrink-0"
          />
          <span>
            <b className="text-black">만 14세 이상</b>입니다. (필수)
            <br />
            <span className="text-neutral-400">
              만 14세 미만은 법정대리인 동의가 필요해 지금은 가입할 수 없습니다.
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={saving || !value.trim() || !ageOk}
          className="mt-4 w-full rounded-lg bg-black py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? '저장 중...' : '시작하기'}
        </button>
      </form>
    </div>
  );
}
