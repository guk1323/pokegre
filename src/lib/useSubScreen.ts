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
export function useSubScreen<T>(key: string, restore: (data: T | null) => void) {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

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
    if (mode === 'push') window.history.pushState(next, '');
    else window.history.replaceState(next, '');
  };

  return {
    push: (data: T) => write(data, 'push'),
    replace: (data: T | null) => write(data, 'replace'),
    back: () => window.history.back(),
  };
}
