import { useEffect, useRef } from 'react';

type SubMap = Record<string, unknown>;

// 화면 안의 "상세/하위 화면"(세트 상세, 작가 상세, 게시글 보기·쓰기 등)을 방문기록
// 한 칸으로 실어, 뒤로가기(폰 물리 버튼 포함)가 정확히 직전 화면으로 가게 한다.
// App의 navigate()가 메인 화면을 기록에 쌓는 것과 같은 원리이고, 하위 화면 정보는
// history.state.sub[key]에 담는다. 메인 화면 상태(nav)와 섞이지 않는다.
//
// - push(data): 하위 화면을 연다(기록 한 칸 추가 → 뒤로가기가 "닫기"가 된다)
// - replace(data): 지금 칸의 하위 화면만 바꾼다(기록 추가 없음. 글쓰기→작성된 글처럼
//   뒤로가기로 되돌아갈 필요가 없는 전환에 쓴다)
// - back(): ← 버튼용. 기록을 한 칸 되돌린다(그 결과 restore가 불려 닫힌다)
//
// restore(data)는 ① 뒤로가기/앞으로가기 때 ② 처음 붙을 때(다른 화면에 갔다가 돌아온
// 경우 복원) 불린다. data가 null이면 하위 화면을 닫으라는 뜻이다.
// closeTo: 상세를 닫았을 때 주소를 무엇으로 되돌릴지(예: /set/ja-M6 → /sets).
//   안 주면 주소를 안 건드린다.
//   ⚠️ 안 주면 상세는 닫혔는데 주소창에는 그 세트가 남아 "주소가 거짓말"이 된다.
// openTo: 상세를 열었을 때 주소를 무엇으로 바꿀지(예: 'ja-M6' → /set/ja-M6).
//   ⚠️ 안 주면 세트를 열어도 주소가 목록 그대로라, 지금 보는 자리를 남에게 줄 수 없다
//      (운영자 지적 2026-08-05). 제목은 화면이 직접 정한다 — 세트는 시세 유무에 따라
//      "힛카드 시세"와 "카드 목록"으로 갈려서 여기서는 알 수 없다.
export function useSubScreen<T>(
  key: string,
  restore: (data: T | null) => void,
  closeTo?: { path: string; title: string },
  openTo?: (data: T) => string,
) {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const closeToRef = useRef(closeTo);
  closeToRef.current = closeTo;
  const openToRef = useRef(openTo);
  openToRef.current = openTo;
  // 이 화면이 방문기록에 칸을 쌓은 적이 있나. back()이 history.back()을 써도 되는지
  // 가르는 값이다.
  //
  // ⚠️ 검색으로 상세 주소에 바로 들어온 사람은 우리 사이트 기록이 한 칸도 없다.
  //    그 상태에서 history.back()을 부르면 사이트 밖(검색 결과)으로 나가 버린다.
  //    실제로 /set/ja-M6로 들어와 "← 세트 목록"을 누르면 그랬다(2026-08-05 점검에서
  //    발견). 그럴 땐 기록을 되돌리는 대신 이 자리에서 상세만 닫는다.
  const pushed = useRef(0);

  useEffect(() => {
    const read = () => {
      const sub = (window.history.state as { sub?: SubMap } | null)?.sub;
      restoreRef.current((sub?.[key] as T | undefined) ?? null);
    };
    window.addEventListener('popstate', read);
    read();
    return () => window.removeEventListener('popstate', read);
  }, [key]);

  const write = (data: T | null, mode: 'push' | 'replace') => {
    const st = (window.history.state ?? {}) as { sub?: SubMap };
    const sub: SubMap = { ...(st.sub ?? {}) };
    if (data === null) delete sub[key];
    else sub[key] = data;
    const next = { ...st, sub };
    // 주소도 같이 옮긴다. 뒤로가기로 돌아올 때는 브라우저가 알아서 옛 주소를 되살린다.
    const url =
      data !== null && openToRef.current
        ? openToRef.current(data) + window.location.search
        : mode === 'push'
          ? ''
          : null;
    if (mode === 'push') window.history.pushState(next, '', url || undefined);
    else window.history.replaceState(next, '', url ?? undefined);
  };

  return {
    push: (data: T) => {
      pushed.current += 1;
      write(data, 'push');
    },
    replace: (data: T | null) => write(data, 'replace'),
    back: () => {
      if (pushed.current > 0) {
        pushed.current -= 1;
        window.history.back();
        return;
      }
      // 쌓은 칸이 없다 = 검색·공유 링크로 상세에 바로 들어왔다. 기록을 되돌리면
      // 사이트 밖으로 나가므로, 여기서 상세만 닫는다.
      write(null, 'replace');
      if (closeToRef.current) {
        const { path, title } = closeToRef.current;
        window.history.replaceState(window.history.state, '', path + window.location.search);
        document.title = title;
      }
      restoreRef.current(null);
    },
  };
}
