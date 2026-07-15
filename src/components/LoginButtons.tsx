import { startKakaoLogin } from '../api/auth';

// 간편로그인 진입점은 여기 한 곳뿐이다. 마이페이지·커뮤니티가 같이 쓰므로,
// 네이버를 붙일 때도 이 파일에 버튼 하나만 추가하면 전부 반영된다.
export function LoginButtons() {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={startKakaoLogin}
        className="w-full rounded-lg bg-[#FEE500] py-2.5 text-sm font-semibold text-[#191600] hover:brightness-95"
      >
        카카오로 시작하기
      </button>
    </div>
  );
}
