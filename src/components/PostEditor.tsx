import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';

// 게시판 글 편집기(2026-08-23 · 사장님 지시).
//
// ⚠️⚠️ **글 쓰는 사람 눈에는 표시가 보이면 안 된다.** 처음에는 글상자에 `## 제목`을 넣어
//    주는 식으로 만들었다가 두 번 퇴짜맞았다 — 「무슨 코딩하는 것도 아니고」,
//    「제목 버튼 누르면 글씨가 어느 정도 커지거나 굵어지고 이런 거처럼」.
//    그래서 여기서는 **누르면 그 자리에서 실제로 커지고 굵어진다.**
//
// 저장은 여전히 글자다(`## 제목` · `**굵게**` · `[사진1 작게]`). 그 꼴이라야
// 서버가 검색용 화면을 그리고(server/index.ts) 글보기가 읽는다(lib/postFormat.tsx).
// 이 파일은 **보이는 것 ↔ 저장되는 글자**를 오가는 번역기다.
//
// ⚠️ 붙여넣기는 **글자와 사진만** 받는다. 남의 사이트에서 복사한 HTML을 그대로 넣으면
//    우리가 모르는 꼴이 섞여 저장이 깨지고, 그게 곧 보안 구멍이다.
//
// ── 사진(2026-08-23 2차 · 사장님 「사진 넣기도 불편」) ──────────────────────
// 넣는 길을 셋으로 늘렸다: **「사진」 단추 · 끌어다 놓기 · 붙여넣기.** 어느 쪽이든
// **커서 자리에 바로 들어간다**(예전엔 글상자 밑 서랍에 사진을 쌓아 두고, 거기서 다시
// 작게·보통·크게를 눌러야 본문에 들어갔다 — 한 가지 일을 두 번에 나눠 시킨 꼴이었다).
// 넣은 사진을 누르면 그 자리에 **작게·보통·크게·삭제**가 뜬다.
//
// ⚠️⚠️ **사진 목록(images)의 주인은 이제 이 편집기다.** 본문에 있는 사진을 위에서부터
//    세어 1,2,3… 번을 매기고 그 주소 목록을 함께 돌려준다(`읽기`). 그래서 본문에서
//    사진을 지우면 목록에서도 같이 빠진다 — 예전처럼 **지운 사진이 글 아래에 되살아나지
//    않는다.** 폼은 이 값을 그대로 서버에 보내기만 한다.

export type 편집기손잡이 = {
  /** 지금 내용을 저장용 글자 + 사진 주소 목록으로. */
  읽기: () => { 글: string; 사진들: string[] };
};

const 크기들 = ['작게', '보통', '크게'] as const;
type 사진크기 = (typeof 크기들)[number];

// 글씨 크기. ⚠️ **「제목·작은 제목」이라는 말을 버렸다**(사장님 2026-08-27: 「제목 부제목
// 이런 거 필요 없을 것 같고 … 글씨 크기를 조절하게 해 주던가」). 저장되는 꼴은 그대로
// `## `·`### `라서 글보기·검색용 화면은 손댈 것이 없다 — 부르는 이름만 바뀐 것이다.
const 글씨크기들 = ['보통', '크게', '아주 크게'] as const;
type 글씨크기 = (typeof 글씨크기들)[number];
const 크기태그: Record<글씨크기, string> = { 보통: 'p', 크게: 'h3', '아주 크게': 'h2' };

// ⚠️ 크기는 **data-size 하나로만** 다룬다. 클래스로 주면 글을 다시 열 때 그 클래스가
//    안 붙어 「작게」가 통째로 풀린다(실제로 그랬다). 모양은 index.css가 준다.
function 사진태그(url: string, 크기: 사진크기): string {
  const esc = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<img src="${esc}" data-size="${크기}">`;
}

// ── 저장용 글자 → 보이는 것 ────────────────────────────────────────────────
function 마커를html로(text: string, images: string[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // ⚠️ 굵게(**)와 밑줄(__)을 같이 푼다. 겹쳐 써도 된다 — `**__글__**`이면 두 번 걸린다.
  const 꾸밈 = (s: string) =>
    esc(s)
      .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
      .replace(/__([\s\S]+?)__/g, '<u>$1</u>');
  const out: string[] = [];
  const lines = text.split('\n');
  let 목록: string[] = [];
  let 표: string[][] = [];
  const 목록비우기 = () => {
    if (목록.length) out.push(`<ul>${목록.map((v) => `<li>${꾸밈(v)}</li>`).join('')}</ul>`);
    목록 = [];
  };
  const 표비우기 = () => {
    if (!표.length) return;
    const 머리 = 표.length > 1 && 표[1].every((c) => /^:?-{2,}:?$/.test(c.trim()));
    const 몸 = 머리 ? 표.slice(2) : 표;
    out.push(
      `<table>${머리 ? `<thead><tr>${표[0].map((c) => `<th>${꾸밈(c.trim())}</th>`).join('')}</tr></thead>` : ''}` +
        `<tbody>${몸.map((r) => `<tr>${r.map((c) => `<td>${꾸밈(c.trim())}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    );
    표 = [];
  };
  for (const raw of lines) {
    const t = raw.trim();
    const 사진 = t.match(/^\[사진\s*(\d+)(?:\s+(작게|보통|크게))?\]$/);
    if (사진) {
      목록비우기();
      표비우기();
      const url = images[Number(사진[1]) - 1];
      if (url) out.push(`<p>${사진태그(url, (사진[2] as 사진크기) ?? '보통')}</p>`);
      continue;
    }
    if (!t) {
      목록비우기();
      표비우기();
      continue;
    }
    if (/^---+$/.test(t)) {
      목록비우기();
      표비우기();
      out.push('<hr>');
      continue;
    }
    if (t.startsWith('### ')) {
      목록비우기();
      표비우기();
      out.push(`<h3>${꾸밈(t.slice(4))}</h3>`);
      continue;
    }
    if (t.startsWith('## ')) {
      목록비우기();
      표비우기();
      out.push(`<h2>${꾸밈(t.slice(3))}</h2>`);
      continue;
    }
    if (t.startsWith('- ')) {
      표비우기();
      목록.push(t.slice(2));
      continue;
    }
    if (t.startsWith('|') && t.endsWith('|') && t.length > 2) {
      목록비우기();
      표.push(t.slice(1, -1).split('|'));
      continue;
    }
    목록비우기();
    표비우기();
    out.push(`<p>${꾸밈(t)}</p>`);
  }
  목록비우기();
  표비우기();
  return out.join('') || '<p><br></p>';
}

// ── 보이는 것 → 저장용 글자 ────────────────────────────────────────────────
/**
 * 편집판을 읽어 **저장할 글자**와 **사진 주소 목록**을 함께 낸다.
 * 사진 번호는 본문에 나온 차례대로 매긴다 — 같은 사진을 두 번 넣으면 같은 번호를 쓴다.
 */
function 읽기판(root: HTMLElement): { 글: string; 사진들: string[] } {
  const 사진들: string[] = [];
  const 번호 = (img: HTMLElement): number => {
    const u = img.getAttribute('src') ?? '';
    if (!u) return 0;
    const 이미 = 사진들.indexOf(u);
    if (이미 >= 0) return 이미 + 1;
    사진들.push(u);
    return 사진들.length;
  };
  const 인라인 = (el: Node): string => {
    if (el.nodeType === Node.TEXT_NODE) return el.textContent ?? '';
    if (!(el instanceof HTMLElement)) return '';
    const 안 = [...el.childNodes].map(인라인).join('');
    const 태그 = el.tagName;
    if (태그 === 'B' || 태그 === 'STRONG') return 안.trim() ? `**${안}**` : 안;
    if (태그 === 'U' || 태그 === 'INS') return 안.trim() ? `__${안}__` : 안;
    if (태그 === 'BR') return '\n';
    // ⚠️ 브라우저가 태그 대신 style로 줄 때가 있다(붙여넣기·옛 글). 그것도 받아 준다.
    const 꾸민 = el.style;
    if (안.trim() && /underline/.test(꾸민?.textDecorationLine || 꾸민?.textDecoration || '')) return `__${안}__`;
    if (안.trim() && (꾸민?.fontWeight === 'bold' || Number(꾸민?.fontWeight) >= 600)) return `**${안}**`;
    return 안;
  };
  const 줄: string[] = [];
  const 블록 = (el: Node) => {
    if (el.nodeType === Node.TEXT_NODE) {
      const t = (el.textContent ?? '').trim();
      if (t) 줄.push(t, '');
      return;
    }
    if (!(el instanceof HTMLElement)) return;
    switch (el.tagName) {
      case 'H1':
      case 'H2':
        줄.push(`## ${인라인(el).trim()}`, '');
        return;
      case 'H3':
      case 'H4':
        줄.push(`### ${인라인(el).trim()}`, '');
        return;
      case 'HR':
        줄.push('---', '');
        return;
      case 'UL':
      case 'OL':
        for (const li of [...el.children]) 줄.push(`- ${인라인(li).trim()}`);
        줄.push('');
        return;
      case 'TABLE': {
        const 행들 = [...el.querySelectorAll('tr')];
        행들.forEach((tr, i) => {
          const 칸 = [...tr.children].map((td) => 인라인(td).replace(/\n/g, ' ').trim() || ' ');
          줄.push(`| ${칸.join(' | ')} |`);
          if (i === 0 && tr.querySelector('th')) 줄.push(`|${칸.map(() => '---').join('|')}|`);
        });
        줄.push('');
        return;
      }
      case 'IMG': {
        const n = 번호(el);
        if (n) 줄.push(`[사진${n} ${el.getAttribute('data-size') || '보통'}]`, '');
        return;
      }
      default: {
        // 사진만 든 문단은 사진 줄로.
        const img = el.querySelector?.(':scope > img');
        if (img && !el.textContent?.trim()) {
          블록(img);
          return;
        }
        // ⚠️ 브라우저가 목록·표를 div로 한 겹 싸는 경우가 있다. 그냥 글자로 읽으면
        //    「1팩 5장1박스 30팩」처럼 통째로 뭉개진다(실제로 그랬다). 안에 덩어리가
        //    들어 있으면 하나씩 따로 읽는다.
        if (
          el.querySelector?.(
            ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > ul, :scope > ol, :scope > table, :scope > hr, :scope > div, :scope > p, :scope > img',
          )
        ) {
          for (const c of [...el.childNodes]) 블록(c);
          return;
        }
        const 안 = 인라인(el);
        if (안.trim()) 줄.push(안.replace(/\n+$/, ''), '');
        else if (el.tagName === 'P' || el.tagName === 'DIV') 줄.push('');
      }
    }
  };
  for (const child of [...root.childNodes]) 블록(child);
  return {
    글: 줄
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    사진들,
  };
}

/**
 * 도구막대 단추 하나. **켜져 있으면 눌린 모양**이 된다 — 워드·한글의 그 단추다.
 * ⚠️ `onMouseDown`을 막아야 편집판이 focus를 안 잃는다. 잃으면 **고른 글자가 풀린다.**
 */
function 도구단추({
  children,
  onClick,
  이름,
  눌림 = false,
}: {
  children: ReactNode;
  onClick: () => void;
  이름: string;
  눌림?: boolean;
}) {
  return (
    <button
      type="button"
      title={이름}
      aria-label={이름}
      aria-pressed={눌림}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-sm ${
        눌림 ? 'bg-neutral-800 text-white' : 'text-neutral-700 hover:bg-neutral-200'
      }`}
    >
      {children}
    </button>
  );
}

function 목록아이콘() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="4.5" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <path d="M9 7h11M9 12h11M9 17h11" strokeLinecap="round" />
    </svg>
  );
}

function 표아이콘() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d="M3 9.5h18M3 14.5h18M9.5 9.5v10M15 9.5v10" />
    </svg>
  );
}

// 「사진」 단추에 붙는 그림. 사이트 지침대로 이모지는 안 쓴다.
function 사진아이콘() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17l4.5-4.5 3.5 3.5 3-3L20 17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const PostEditor = forwardRef<
  편집기손잡이,
  {
    처음글: string;
    /** 예전 글을 열 때 쓰는 사진 목록(번호 → 주소). */
    처음사진: string[];
    최대사진: number;
    /** 파일 한 장을 올리고 주소를 받는다. 오류 문구는 이 함수가 던진다. */
    올리기: (file: File) => Promise<string>;
    onChange: (글: string, 사진들: string[]) => void;
    onError: (말: string) => void;
  }
>(function PostEditor({ 처음글, 처음사진, 최대사진, 올리기, onChange, onError }, ref) {
  const 판 = useRef<HTMLDivElement | null>(null);
  const 파일칸 = useRef<HTMLInputElement | null>(null);
  const 처음채움 = useRef(false);
  // 사진을 넣을 자리. 파일 고르기 창이 뜨는 동안 커서가 풀릴 수 있어 따로 적어 둔다.
  const 마지막범위 = useRef<Range | null>(null);
  const 고른사진 = useRef<HTMLImageElement | null>(null);
  const [도구자리, set도구자리] = useState<{ top: number; left: number; 크기: string } | null>(null);
  const [올리는중, set올리는중] = useState<{ 한것: number; 전체: number } | null>(null);
  const [끄는중, set끄는중] = useState(false);
  // 지금 커서 자리의 글씨 모양. 단추가 **눌린 채로 보여야** 굵게가 켜졌는지 알 수 있다
  // (사장님 2026-08-27: 「굵은 글씨를 클릭하면 눌러져 있어서 그 뒤로 쓰는 게 굵어진다거나」).
  const [모양, set모양] = useState<{ 굵게: boolean; 밑줄: boolean; 크기: 글씨크기 }>({
    굵게: false,
    밑줄: false,
    크기: '보통',
  });
  // 커서가 든 표. 넣기만 되고 **지울 수가 없었다**(사장님 지적).
  const 고른표 = useRef<HTMLTableElement | null>(null);
  const [표자리, set표자리] = useState<{ top: number; left: number } | null>(null);
  // 「표」 단추를 누르면 뜨는 칸 고르개. 2×2로 굳어 있던 것을 고른 크기로 넣는다.
  const [표고르개, set표고르개] = useState(false);
  const [표미리, set표미리] = useState<{ 행: number; 열: number } | null>(null);

  const 알리기 = () => {
    const el = 판.current;
    if (!el) return;
    const r = 읽기판(el);
    onChange(r.글, r.사진들);
  };

  // ⚠️ contenteditable을 리액트가 값으로 쥐면(controlled) 글자를 칠 때마다 커서가
  //    맨 앞으로 튄다. 처음 한 번만 채우고 그 뒤로는 브라우저에 맡긴다.
  useEffect(() => {
    if (처음채움.current || !판.current) return;
    처음채움.current = true;
    판.current.innerHTML = 마커를html로(처음글, 처음사진);
    // ⚠️ 예전 글에는 **본문에 자리를 안 잡은 사진**이 있을 수 있다(그때는 글 맨 아래에
    //    묶여 나왔다). 그대로 두면 이 편집기가 사진 목록을 다시 세면서 **빠뜨린다** —
    //    글을 고치기만 했는데 사진이 사라지는 꼴이다. 그래서 맨 뒤에 붙여 놓는다.
    const 쓴번호 = new Set([...처음글.matchAll(/\[사진\s*(\d+)/g)].map((m) => Number(m[1])));
    const 남은사진 = 처음사진.filter((_u, i) => !쓴번호.has(i + 1));
    if (남은사진.length) {
      판.current.innerHTML += 남은사진.map((u) => `<p>${사진태그(u, '보통')}</p>`).join('');
    }
    // 폼이 든 사진 목록을 지금 내용과 맞춘다(안 하면 고치기로 들어온 글이 첫 글자를
    // 칠 때까지 사진 없는 글로 보인다).
    알리기();
    try {
      // 브라우저가 사진에 제 나름의 크기 손잡이를 붙이는 것을 막는다(우리 도구막대와 겹친다).
      document.execCommand('enableObjectResizing', false, 'false');
      // ⚠️ **꾸밈을 style이 아니라 태그(<b>·<u>)로 넣게 한다.** style로 들어오면 저장할 때
      //    읽어 내기가 훨씬 까다롭다(그래도 읽도록 받침은 해 뒀지만, 안 만드는 게 낫다).
      document.execCommand('styleWithCSS', false, 'false');
    } catch {
      // 이 명령을 모르는 브라우저도 있다. 없어도 나머지는 그대로 된다.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    읽기: () => (판.current ? 읽기판(판.current) : { 글: '', 사진들: [] }),
  }));

  // ── 커서 자리 챙기기 ─────────────────────────────────────────────────────
  function 범위기억() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && 판.current?.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      마지막범위.current = sel.getRangeAt(0).cloneRange();
    }
  }

  /** 화면의 한 점을 커서 자리로 삼는다(끌어다 놓기). */
  function 점을커서로(x: number, y: number) {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let r: Range | null = null;
    if (doc.caretRangeFromPoint) r = doc.caretRangeFromPoint(x, y);
    else if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      if (p) {
        r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
        r.collapse(true);
      }
    }
    if (r && 판.current?.contains(r.startContainer)) {
      마지막범위.current = r.cloneRange();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  }

  // 사진·표·가로줄처럼 **한 덩어리**를 넣는다.
  // ⚠️⚠️ 커서 자리에 그대로 꽂으면 안 된다. 목록을 쓰던 중이면 사진이 <li> **안**으로
  //    들어가고, 그러면 저장할 때 목록 한 줄로 뭉개지면서 **사진이 통째로 사라진다**
  //    (실제로 그랬다). 커서가 든 덩어리를 찾아 그 **뒤**에 놓는다.
  function 끼우기(node: Node) {
    const el = 판.current;
    if (!el) return;
    const sel = window.getSelection();
    let r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    // 파일 고르기 창을 거치면 커서가 편집판 밖으로 나가 있다 — 적어 둔 자리를 쓴다.
    if (!r || !el.contains(r.commonAncestorContainer)) r = 마지막범위.current;
    let 놓았나 = false;
    // ⚠️⚠️ 커서가 **덩어리와 덩어리 사이**에 있을 때가 있다(방금 넣은 사진 바로 뒤가 그렇다).
    //    그때는 아래 「덩어리를 찾아 그 뒤에」가 안 먹혀서 **글 맨 끝으로 날아갔다** —
    //    사진을 석 장 이어 넣으면 첫 장만 제자리, 나머지는 표 뒤로 갔다(찍어 보고 잡았다).
    if (r && r.commonAncestorContainer === el) {
      el.insertBefore(node, el.childNodes[r.startOffset] ?? null);
      놓았나 = true;
    }
    if (!놓았나 && r && el.contains(r.commonAncestorContainer)) {
      let 기준: Node | null = r.commonAncestorContainer;
      if (기준.nodeType === Node.TEXT_NODE) 기준 = 기준.parentNode;
      let 덩어리 = 기준 as HTMLElement | null;
      while (덩어리 && 덩어리 !== el && 덩어리.parentElement && 덩어리.parentElement !== el) {
        덩어리 = 덩어리.parentElement;
      }
      if (덩어리 && 덩어리 !== el && 덩어리.parentElement === el) {
        덩어리.after(node);
        놓았나 = true;
      }
    }
    if (!놓았나) el.appendChild(node);
    // 이어서 쓸 수 있게 커서를 그 뒤로 옮긴다.
    const 뒤 = document.createRange();
    뒤.setStartAfter(node);
    뒤.collapse(true);
    마지막범위.current = 뒤.cloneRange();
    sel?.removeAllRanges();
    sel?.addRange(뒤);
  }

  // ── 사진 넣기 ────────────────────────────────────────────────────────────
  function 사진끼우기(url: string) {
    const p = document.createElement('p');
    p.innerHTML = 사진태그(url, '보통');
    끼우기(p);
  }

  /** 고른 파일들을 차례로 올려 커서 자리에 넣는다. */
  async function 파일넣기(files: File[]) {
    const 그림 = files.filter((f) => f.type.startsWith('image/'));
    if (!그림.length) return;
    const 지금 = 판.current?.querySelectorAll('img').length ?? 0;
    const 남은 = Math.max(0, 최대사진 - 지금);
    if (!남은) {
      onError(`사진은 글 하나에 ${최대사진}장까지 넣을 수 있습니다.`);
      return;
    }
    const 할것 = 그림.slice(0, 남은);
    onError(그림.length > 남은 ? `사진은 글 하나에 ${최대사진}장까지입니다. ${남은}장만 넣었습니다.` : '');
    set올리는중({ 한것: 0, 전체: 할것.length });
    try {
      for (let i = 0; i < 할것.length; i++) {
        try {
          사진끼우기(await 올리기(할것[i]));
        } catch (e) {
          // 한 장이 막히면 뒤엣것도 대개 같은 이유로 막힌다(용량·한도). 거기서 멈춘다.
          onError(e instanceof Error ? e.message : '사진을 올리지 못했습니다.');
          break;
        }
        set올리는중({ 한것: i + 1, 전체: 할것.length });
      }
    } finally {
      set올리는중(null);
      알리기();
    }
  }

  // ── 넣은 사진 고르기 ─────────────────────────────────────────────────────
  function 사진고르기(img: HTMLImageElement) {
    판.current?.querySelectorAll('img[data-sel]').forEach((x) => x.removeAttribute('data-sel'));
    img.setAttribute('data-sel', '1');
    고른사진.current = img;
    set도구자리({ top: img.offsetTop, left: img.offsetLeft, 크기: img.getAttribute('data-size') ?? '보통' });
  }

  function 고르기풀기() {
    판.current?.querySelectorAll('img[data-sel]').forEach((x) => x.removeAttribute('data-sel'));
    고른사진.current = null;
    set도구자리(null);
  }

  function 크기바꾸기(크기: 사진크기) {
    const img = 고른사진.current;
    if (!img) return;
    img.setAttribute('data-size', 크기);
    알리기();
    // 크기가 바뀌면 사진 자리도 움직인다 — 그려진 뒤에 도구막대를 다시 붙인다.
    requestAnimationFrame(() => set도구자리({ top: img.offsetTop, left: img.offsetLeft, 크기 }));
  }

  function 사진지우기() {
    const img = 고른사진.current;
    const el = 판.current;
    if (!img || !el) return;
    // 사진만 든 문단이면 문단째로 지운다(빈 문단이 남으면 줄이 뜬다).
    let 덩어리: HTMLElement = img;
    while (덩어리.parentElement && 덩어리.parentElement !== el && !덩어리.parentElement.textContent?.trim()) {
      덩어리 = 덩어리.parentElement;
    }
    덩어리.remove();
    고르기풀기();
    알리기();
  }

  // ── 지금 글씨가 어떤 모양인가 ────────────────────────────────────────────
  const 켜짐 = (명: string) => {
    try {
      return document.queryCommandState(명);
    } catch {
      return false;
    }
  };

  function 모양갱신() {
    const el = 판.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount || !el.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
    let 크기: 글씨크기 = '보통';
    try {
      const 덩어리 = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
      크기 = 덩어리 === 'h2' ? '아주 크게' : 덩어리 === 'h3' ? '크게' : '보통';
    } catch {
      /* 모르는 브라우저면 보통으로 둔다 */
    }
    set모양({ 굵게: 켜짐('bold'), 밑줄: 켜짐('underline'), 크기 });
    // 커서가 표 안에 있으면 표 고치는 막대를 띄운다.
    const 표 = 표찾기();
    고른표.current = 표;
    set표자리(표 ? { top: 표.offsetTop, left: 표.offsetLeft } : null);
  }

  // 커서가 든 표. 편집판 밖의 표는 건드리지 않는다.
  function 표찾기(): HTMLTableElement | null {
    const el = 판.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount) return null;
    let n: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    if (n.nodeType === Node.TEXT_NODE) n = n.parentNode;
    const t = (n as HTMLElement | null)?.closest?.('table') ?? null;
    return t && el.contains(t) ? (t as HTMLTableElement) : null;
  }

  function 지금칸(): HTMLTableCellElement | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    if (n.nodeType === Node.TEXT_NODE) n = n.parentNode;
    return ((n as HTMLElement | null)?.closest?.('th,td') ?? null) as HTMLTableCellElement | null;
  }

  function 표고친뒤() {
    알리기();
    const 표 = 고른표.current;
    if (표) requestAnimationFrame(() => set표자리({ top: 표.offsetTop, left: 표.offsetLeft }));
  }

  function 행추가() {
    const 칸 = 지금칸();
    const 줄 = 칸?.parentElement as HTMLTableRowElement | null;
    if (!줄) return;
    const 새 = document.createElement('tr');
    for (let i = 0; i < 줄.children.length; i++) {
      const td = document.createElement('td');
      td.textContent = '내용';
      새.appendChild(td);
    }
    // 머리글 줄 뒤에 넣을 때는 몸통(tbody) 맨 앞으로 — thead 안에 td가 들어가면 안 된다.
    if (줄.parentElement?.tagName === 'THEAD') {
      const 몸 = 고른표.current?.querySelector('tbody');
      몸 ? 몸.prepend(새) : 줄.after(새);
    } else {
      줄.after(새);
    }
    표고친뒤();
  }

  function 행지우기() {
    const 표 = 고른표.current;
    const 줄 = 지금칸()?.parentElement as HTMLElement | null;
    if (!표 || !줄) return;
    if (표.querySelectorAll('tr').length <= 1) return; // 마지막 한 줄은 남긴다
    줄.remove();
    표고친뒤();
  }

  function 열추가() {
    const 표 = 고른표.current;
    const 칸 = 지금칸();
    if (!표 || !칸) return;
    const 자리 = [...(칸.parentElement?.children ?? [])].indexOf(칸);
    for (const 줄 of 표.querySelectorAll('tr')) {
      const 옆 = 줄.children[자리];
      const 새 = document.createElement(옆?.tagName === 'TH' ? 'th' : 'td');
      새.textContent = 옆?.tagName === 'TH' ? '칸' : '내용';
      옆 ? 옆.after(새) : 줄.appendChild(새);
    }
    표고친뒤();
  }

  function 열지우기() {
    const 표 = 고른표.current;
    const 칸 = 지금칸();
    if (!표 || !칸) return;
    const 자리 = [...(칸.parentElement?.children ?? [])].indexOf(칸);
    if ((표.querySelector('tr')?.children.length ?? 0) <= 1) return; // 마지막 한 칸은 남긴다
    for (const 줄 of 표.querySelectorAll('tr')) 줄.children[자리]?.remove();
    표고친뒤();
  }

  function 표지우기() {
    고른표.current?.remove();
    고른표.current = null;
    set표자리(null);
    알리기();
  }

  /** 고른 크기로 표를 넣는다. 첫 줄은 머리글이다. */
  function 표넣기(행: number, 열: number) {
    const 머리 = `<thead><tr>${'<th>칸</th>'.repeat(열)}</tr></thead>`;
    const 몸 = `<tbody>${`<tr>${'<td>내용</td>'.repeat(열)}</tr>`.repeat(Math.max(1, 행 - 1))}</tbody>`;
    const t = document.createElement('table');
    t.innerHTML = 머리 + 몸;
    끼우기(t);
    set표고르개(false);
    set표미리(null);
    알리기();
  }

  function 명령(run: () => void) {
    판.current?.focus();
    run();
    알리기();
    모양갱신();
  }

  /** 글씨 크기 바꾸기. 고르개(select)를 거치며 커서가 풀리므로 적어 둔 자리를 되살린다. */
  function 글씨크기적용(값: 글씨크기) {
    const el = 판.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const r = 마지막범위.current;
    if (r && el.contains(r.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    document.execCommand('formatBlock', false, 크기태그[값]);
    알리기();
    모양갱신();
  }


  return (
    <div className="rounded-lg border border-neutral-300 focus-within:ring-2 focus-within:ring-black">
      {/* 도구막대. 글상자와 한 덩어리로 붙여 둔다 — 따로 떠 있으면 무엇에 걸리는 단추인지 안 읽힌다.
          ⚠️ 사진을 여러 장 넣으면 글상자가 화면보다 길어진다. 그때 단추가 저 위에 남아 있으면
             글 중간에서 사진 한 장을 더 넣으려고 맨 위까지 올라가야 한다 — 붙여 둔다. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 rounded-t-lg border-b border-neutral-200 bg-neutral-50 px-2 py-1.5">
        {/* ⚠️ **사진이 맨 앞이다.** 폰에서는 단추가 두 줄로 접히는데, 뒤에 두면 제일 많이
            누르는 단추가 둘째 줄로 밀린다(실제로 그렇게 접혔다). */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            범위기억();
            파일칸.current?.click();
          }}
          disabled={올리는중 != null}
          className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-bold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          <사진아이콘 />
          사진
        </button>
        <span className="mx-1 h-4 w-px bg-neutral-300" />

        {/* ⚠️ 글씨 크기. 「제목·작은 제목」이라고 부르던 것이다(사장님 2026-08-27). */}
        <select
          value={모양.크기}
          onChange={(e) => 글씨크기적용(e.target.value as 글씨크기)}
          aria-label="글씨 크기"
          className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs font-semibold text-neutral-700"
        >
          {글씨크기들.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        {/* ⚠️⚠️ **워드처럼 굵은 B·밑줄 그은 U로 보인다**(사장님 2026-08-27: 「굵게 이렇게가
            아니라 굵은 알파벳이나 밑줄 그어져 있는 걸로 표시하잖아」). 켜져 있으면
            눌린 모양이 되고, 그 뒤로 치는 글씨가 그 모양으로 나간다. */}
        <도구단추 눌림={모양.굵게} 이름="굵게" onClick={() => 명령(() => document.execCommand('bold'))}>
          <span className="font-bold">B</span>
        </도구단추>
        <도구단추 눌림={모양.밑줄} 이름="밑줄" onClick={() => 명령(() => document.execCommand('underline'))}>
          <span className="underline decoration-2 underline-offset-2">U</span>
        </도구단추>

        <span className="mx-1 h-4 w-px bg-neutral-300" />

        <도구단추 이름="목록" onClick={() => 명령(() => document.execCommand('insertUnorderedList'))}>
          <목록아이콘 />
        </도구단추>

        {/* ⚠️ 표는 **크기를 골라서** 넣는다. 예전엔 2×2로 굳어 있었다(사장님 지적). */}
        <도구단추
          눌림={표고르개}
          이름="표"
          onClick={() => {
            범위기억();
            set표고르개((v) => !v);
          }}
        >
          <표아이콘 />
        </도구단추>

        <도구단추 이름="가로줄" onClick={() => 명령(() => 끼우기(document.createElement('hr')))}>
          <span className="block h-px w-4 bg-current" />
        </도구단추>
        <input
          ref={파일칸}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = ''; // 같은 파일을 다시 골라도 반응하도록 비운다
            void 파일넣기(files);
          }}
          className="hidden"
        />
        {올리는중 && (
          <span className="ml-1 text-[11px] font-semibold text-neutral-500">
            사진 올리는 중… {올리는중.한것}/{올리는중.전체}
          </span>
        )}

        {/* 표 칸 고르개.
            ⚠️⚠️ **단추가 아니라 도구막대에 붙인다.** 단추에 붙였더니 폰(430)에서 표
               단추가 오른쪽에 있어 **고르개가 화면 밖으로 442px까지 삐져나갔다**
               (오른쪽 한 줄이 잘려 안 눌렸다 · 2026-08-27 실측). 도구막대는 화면 폭을
               다 쓰므로 그 왼쪽에 붙이면 어떤 폭에서도 안 넘친다.
            ⚠️ `w-max`가 없으면 칸끼리 겹쳐서 아예 못 누른다(이것도 찍어 보고 잡았다). */}
        {표고르개 && (
          <div
            className="absolute left-2 top-full z-30 mt-1 w-max rounded-lg border border-neutral-300 bg-white p-2 shadow-lg"
            onMouseLeave={() => set표미리(null)}
          >
            <div className="grid grid-cols-6 gap-0.5">
              {Array.from({ length: 36 }, (_, i) => {
                const 행 = Math.floor(i / 6) + 1;
                const 열 = (i % 6) + 1;
                const 든다 = !!표미리 && 행 <= 표미리.행 && 열 <= 표미리.열;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`${행}줄 ${열}칸`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => set표미리({ 행, 열 })}
                    onClick={() => 표넣기(행, 열)}
                    className={`h-5 w-5 rounded-[2px] border ${
                      든다 ? 'border-neutral-800 bg-neutral-800' : 'border-neutral-300 bg-white'
                    }`}
                  />
                );
              })}
            </div>
            <p className="mt-1.5 text-center text-[11px] font-semibold text-neutral-600">
              {표미리 ? `${표미리.행}줄 × ${표미리.열}칸` : '표 크기를 고르세요'}
            </p>
          </div>
        )}
      </div>

      <div className="relative">
        {/* 보이는 모양을 글보기(PostBody)와 맞춘다 — 쓰면서 보는 그대로 올라간다. */}
        <div
          ref={판}
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            고르기풀기();
            알리기();
            모양갱신();
          }}
          onBlur={알리기}
          onKeyUp={() => {
            범위기억();
            모양갱신();
          }}
          onMouseUp={() => {
            범위기억();
            모양갱신();
          }}
          onFocus={모양갱신}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'IMG') 사진고르기(t as HTMLImageElement);
            else 고르기풀기();
            set표고르개(false);
            모양갱신();
          }}
          // 붙여넣기 — 사진이 들어 있으면 사진으로, 아니면 글자만.
          // 남의 사이트 HTML이 들어오면 우리가 모르는 꼴이 섞인다.
          onPaste={(e) => {
            const files = [...(e.clipboardData.files ?? [])].filter((f) => f.type.startsWith('image/'));
            e.preventDefault();
            if (files.length) {
              범위기억();
              void 파일넣기(files);
              return;
            }
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
          onDragOver={(e) => {
            if (![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            set끄는중(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set끄는중(false);
          }}
          onDrop={(e) => {
            const files = [...(e.dataTransfer.files ?? [])].filter((f) => f.type.startsWith('image/'));
            if (!files.length) return;
            e.preventDefault();
            set끄는중(false);
            점을커서로(e.clientX, e.clientY);
            void 파일넣기(files);
          }}
          data-빈칸="내용을 입력하세요"
          className="post-editor min-h-[320px] w-full rounded-b-lg px-3 py-2 text-sm leading-relaxed text-neutral-800 focus:outline-none"
        />

        {/* 고른 사진 위에 뜨는 도구막대. 사진을 누른 그 자리에서 크기를 바꾸고 지운다. */}
        {도구자리 && (
          // ⚠️⚠️ 색을 **직접 적는다**(neutral-900·white 같은 이름 대신). 이 막대는 회원이
          //    올린 **사진 위**에 얹히는데, 사진 밝기는 밝은 화면이든 어두운 화면이든
          //    똑같다. 이름을 쓰면 어두운 화면에서 값이 뒤집혀(neutral-900 → #ededed)
          //    **흰 바탕에 흰 글씨**가 된다.
          <div
            className="absolute z-10 flex items-center gap-0.5 rounded-lg bg-[#171717] p-1 shadow-lg"
            style={{ top: 도구자리.top + 8, left: 도구자리.left + 8 }}
          >
            {크기들.map((크기) => (
              <button
                key={크기}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => 크기바꾸기(크기)}
                className={`rounded px-2 py-1 text-[11px] font-bold hover:bg-[#404040] ${
                  도구자리.크기 === 크기 ? 'bg-[#404040] text-[#ffffff]' : 'text-[#d4d4d4]'
                }`}
              >
                {크기}
              </button>
            ))}
            <span className="mx-0.5 h-3.5 w-px bg-[#525252]" />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={사진지우기}
              className="rounded px-2 py-1 text-[11px] font-bold text-[#fda4af] hover:bg-[#404040]"
            >
              삭제
            </button>
          </div>
        )}

        {/* 커서가 표 안에 있을 때 뜨는 막대. ⚠️ 예전엔 표를 **넣기만 되고 지울 수가
            없었다**(사장님 2026-08-27). 줄·칸을 늘리고 줄이는 것도 여기서 한다. */}
        {표자리 && !도구자리 && (
          <div
            className="absolute z-10 flex items-center gap-0.5 rounded-lg bg-[#171717] p-1 shadow-lg"
            style={{ top: Math.max(0, 표자리.top - 34), left: 표자리.left }}
          >
            {(
              [
                ['줄 +', 행추가],
                ['줄 −', 행지우기],
                ['칸 +', 열추가],
                ['칸 −', 열지우기],
              ] as const
            ).map(([이름, 하기]) => (
              <button
                key={이름}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={하기}
                className="rounded px-2 py-1 text-[11px] font-bold text-[#d4d4d4] hover:bg-[#404040]"
              >
                {이름}
              </button>
            ))}
            <span className="mx-0.5 h-3.5 w-px bg-[#525252]" />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={표지우기}
              className="rounded px-2 py-1 text-[11px] font-bold text-[#fda4af] hover:bg-[#404040]"
            >
              표 삭제
            </button>
          </div>
        )}

        {/* 끌어다 놓는 동안만 뜬다. ⚠️ pointer-events-none이 없으면 이 판이 놓기를 가로챈다. */}
        {끄는중 && (
          <div className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-lg border-2 border-dashed border-black bg-white/70 text-sm font-bold text-black">
            여기에 놓으면 사진이 들어갑니다
          </div>
        )}
      </div>
    </div>
  );
});
