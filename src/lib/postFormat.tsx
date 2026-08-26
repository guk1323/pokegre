import type { ReactNode } from 'react';

// 게시판 글 꾸미기(2026-08-23 · 사장님 지시 「앞으로 정보글을 계속 올리려면 게시 유동성이 필요하다」).
//
// 정보글에는 소제목·표·사진 위치가 필요한데 지금까지는 줄글밖에 안 됐다. 그렇다고 HTML을
// 그대로 받으면 그게 곧 보안 구멍이라(누구나 글을 쓴다), **우리가 직접 읽어 리액트 조각으로
// 바꾼다.** 아래 문법 말고는 전부 그냥 글자다 — `<script>`를 적어도 글자로만 보인다.
//
//   ## 큰 제목        ### 작은 제목
//   **굵게**
//   - 목록
//   | 칸 | 칸 |      (다음 줄에 |---|---| 를 두면 머리글이 된다)
//   ---               (가로줄)
//   [사진1]           올린 사진 1번을 그 자리에 넣는다
//   [사진1 작게]      작게 / 보통 / 크게
//
// ⚠️ **본문에 넣은 사진은 아래 사진 묶음에서 뺀다**(같은 사진이 두 번 나오면 안 된다).
//    그 판단은 `본문에쓴사진()`이 한다 — 화면 쪽에서 이걸로 걸러야 한다.
// ⚠️ 이 글투를 모르고 쓴 회원 글도 그대로 잘 나와야 한다. 그래서 아무 표시가 없으면
//    예전과 똑같이 줄글로 보인다.

const 사진표시 = /\[사진\s*(\d+)(?:\s+(작게|보통|크게))?\]/g;

/** 본문이 자리를 지정해 쓴 사진 번호(1부터). 아래 사진 묶음에서 빼는 데 쓴다. */
export function 본문에쓴사진(content: string): Set<number> {
  const out = new Set<number>();
  for (const m of content.matchAll(사진표시)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

const 사진크기: Record<string, string> = {
  작게: 'max-w-[220px]',
  보통: 'max-w-md',
  크게: 'w-full',
};

// **굵게**만 처리한다. 나머지는 글자 그대로.
function 인라인(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  const re = /\*\*(.+?)\*\*/g;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <strong key={`${key}-b${i++}`} className="font-bold text-black">
        {m[1]}
      </strong>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * 글 본문을 꾸며서 그린다.
 * @param images 글에 올린 사진 주소들(1번이 첫 장).
 */
export function PostBody({ content, images = [] }: { content: string; images?: string[] }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  let k = 0;

  const 문단비우기 = () => {
    if (!para.length) return;
    const text = para.join('\n');
    blocks.push(
      <p key={`p${k++}`} className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
        {text.split('\n').map((줄, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {인라인(줄, `p${k}-${i}`)}
          </span>
        ))}
      </p>,
    );
    para = [];
  };
  const 목록비우기 = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`u${k++}`} className="mb-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-neutral-800">
        {list.map((항목, i) => (
          <li key={i}>{인라인(항목, `u${k}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const 표비우기 = () => {
    if (!table.length) return;
    // 둘째 줄이 |---|---| 꼴이면 첫 줄은 머리글이다.
    const 머리글 = table.length > 1 && table[1].every((c) => /^:?-{2,}:?$/.test(c.trim()));
    const 줄들 = 머리글 ? table.slice(2) : table;
    blocks.push(
      // ⚠️ 표는 좁은 화면에서 넘칠 수 있다. 옆으로 밀어 볼 수 있게 감싼다.
      <div key={`t${k++}`} className="mb-3 -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[320px] border-collapse text-left text-sm">
          {머리글 && (
            <thead>
              <tr className="border-b border-neutral-300">
                {table[0].map((c, i) => (
                  <th key={i} className="py-2 pr-3 font-semibold text-black">
                    {인라인(c.trim(), `th${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {줄들.map((행, r) => (
              <tr key={r} className="border-b border-neutral-100">
                {행.map((c, i) => (
                  <td key={i} className="py-2 pr-3 align-top text-neutral-800">
                    {인라인(c.trim(), `td${r}-${i}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = [];
  };
  const 다비우기 = () => {
    문단비우기();
    목록비우기();
    표비우기();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();

    // 사진 한 장만 있는 줄
    const 사진 = t.match(/^\[사진\s*(\d+)(?:\s+(작게|보통|크게))?\]$/);
    if (사진) {
      다비우기();
      const url = images[Number(사진[1]) - 1];
      if (url) {
        blocks.push(
          <a key={`i${k++}`} href={url} target="_blank" rel="noreferrer" className="mb-3 block">
            {/* ⚠️ loading="lazy"를 쓰면 안 된다 — 높이를 안 정해 둔 사진이라 불러오기 전
                높이가 0이고, 그러면 브라우저가 "화면 밖"으로 보고 영영 안 부른다(아래 사진
                묶음에서 이미 겪은 함정이다). */}
            <img
              src={url}
              alt=""
              className={`${사진크기[사진[2] ?? '보통']} w-full rounded-xl bg-neutral-50 object-contain ring-1 ring-neutral-200`}
            />
          </a>,
        );
      }
      continue;
    }

    if (!t) {
      다비우기();
      continue;
    }
    if (/^---+$/.test(t)) {
      다비우기();
      blocks.push(<hr key={`h${k++}`} className="my-4 border-neutral-200" />);
      continue;
    }
    if (t.startsWith('### ')) {
      다비우기();
      blocks.push(
        <h3 key={`h3${k++}`} className="mb-2 mt-4 text-sm font-bold text-black">
          {인라인(t.slice(4), `h3${k}`)}
        </h3>,
      );
      continue;
    }
    if (t.startsWith('## ')) {
      다비우기();
      blocks.push(
        <h2 key={`h2${k++}`} className="mb-2 mt-5 text-base font-bold text-black">
          {인라인(t.slice(3), `h2${k}`)}
        </h2>,
      );
      continue;
    }
    if (t.startsWith('- ')) {
      문단비우기();
      표비우기();
      list.push(t.slice(2));
      continue;
    }
    if (t.startsWith('|') && t.endsWith('|') && t.length > 2) {
      문단비우기();
      목록비우기();
      table.push(t.slice(1, -1).split('|'));
      continue;
    }
    목록비우기();
    표비우기();
    para.push(line);
  }
  다비우기();

  return <>{blocks}</>;
}
