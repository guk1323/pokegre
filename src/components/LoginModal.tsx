import { startKakaoLogin, startNaverLogin } from '../api/auth';

// 로그인 수단 선택은 여기 한 곳에서만 한다. 공급자를 늘릴 때(네이버 등) 이 파일에
// 버튼 한 줄만 추가하면 마이페이지·커뮤니티 등 모든 진입점에 함께 반영된다.
export function LoginModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-black mb-1">로그인</h2>
        <p className="text-xs text-neutral-500 mb-5">
          간편하게 시작하세요. 관심 카드를 계정에 보관하고 게시판에 글을 남길 수 있습니다.
        </p>

        {/* 각 서비스의 지정 색을 그대로 쓴다. 흑백 테마와 안 어울려 보여도, 로그인
            버튼은 한눈에 알아보는 게 예쁜 것보다 중요하다. */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={startKakaoLogin}
            className="w-full rounded-lg bg-[#FEE500] py-2.5 text-sm font-semibold text-[#191600] hover:brightness-95"
          >
            카카오로 로그인
          </button>
          <button
            type="button"
            onClick={startNaverLogin}
            className="w-full rounded-lg bg-[#03C75A] py-2.5 text-sm font-semibold text-white hover:brightness-95"
          >
            네이버로 로그인
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
