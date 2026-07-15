import { startKakaoLogin } from '../api/auth';

// 로그인 수단 선택은 여기 한 곳에서만 한다. 공급자를 늘릴 때(네이버 등) 이 파일에
// 버튼 한 줄만 추가하면 마이페이지·커뮤니티 등 모든 진입점에 함께 반영된다.
export function LoginModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-black mb-1">로그인</h2>
        <p className="text-xs text-neutral-500 mb-5">
          간편하게 시작하세요. 관심 카드를 계정에 보관하고 커뮤니티에 글을 남길 수 있어요.
        </p>

        <div className="space-y-2">
          <button
            type="button"
            onClick={startKakaoLogin}
            className="w-full rounded-lg bg-[#FEE500] py-2.5 text-sm font-semibold text-[#191600] hover:brightness-95"
          >
            카카오로 로그인
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg py-2 text-xs font-semibold text-neutral-400 hover:text-neutral-600"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
