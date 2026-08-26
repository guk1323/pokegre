import { Component, type ErrorInfo, type ReactNode } from 'react';

// 화면 하나가 그리다 터지면 React는 트리 전체를 걷어낸다. 경계가 없으면 그 결과가
// 흰 화면이라, 사용자는 무슨 일이 났는지도 모르고 되돌릴 방법도 없다. 여기서 붙잡아
// 사람이 읽을 수 있는 안내와 되돌릴 버튼을 보여 준다.
//
// 배포 직후에도 필요하다 — 화면을 나눠 담아 두었기 때문에(lazy), 이전 버전을 열어 둔
// 브라우저가 사라진 조각을 받으러 가면 그 자리에서 터진다. 그때는 새로고침이 정답이다.

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 서버로 보내지는 않는다(수집 창구가 없다). 개발자 도구를 열어 둔 경우에만 보이면 된다.
    console.error('화면을 그리다 오류가 났습니다.', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-base font-bold text-black">화면을 표시하지 못했습니다</p>
        <p className="mt-2 text-sm text-neutral-500">
          잠시 문제가 생겼습니다. 새로고침하면 대부분 해결됩니다. 계속 같은 화면이 나오면
          게시판에 알려 주세요.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white"
        >
          새로고침
        </button>
      </div>
    );
  }
}
