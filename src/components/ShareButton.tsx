import { useState } from 'react';
import { trackEvent } from '../api/localStats';

// 카드 공유 버튼. 폰이면 시스템 공유창(카톡 등), 아니면 링크 복사.
//
// 세 화면(스니커덩크·이베이·TCGplayer)이 같은 버튼을 쓴다. 예전에는 스니커덩크 상세에만
// 버튼이 있어서, 서버가 /e/·/t/ 공유 주소를 처리하는데도 이용자가 그 링크를 만들 방법이
// 없었다. 카드를 찾아 남에게 시세를 알려주는 건 화면과 무관하게 같은 동작이다.
export function ShareButton({ path, name }: { path: string; name: string }) {
  const [copied, setCopied] = useState(false);
  // 스니커덩크 카드(/c/)는 서버가 카드 이름을 스스로 알아내므로 주소에 이름을 안 싣는다.
  // 한글을 주소에 넣으면 %EB%A6%AC…로 늘어나 91자짜리 링크가 되고, 받는 사람 눈에는
  // 알 수 없는 문자가 잔뜩 붙은 주소로 보인다.
  // 이베이·TCGplayer(/e/·/t/)는 시세 호출 한도 때문에 서버가 이름을 못 받아 와서
  // 여기서 실어 보낸다.
  const url = path.startsWith('/c/')
    ? `https://pokegre.com${path}`
    : `https://pokegre.com${path}?n=${encodeURIComponent(shareName(name))}`;

  return (
    <button
      type="button"
      onClick={async () => {
        trackEvent('share');
        if (navigator.share) {
          navigator.share({ title: `${name} 시세 | pokegre`, url }).catch(() => undefined);
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // 클립보드를 막아 둔 브라우저에서는 주소라도 보여 준다(직접 복사하도록).
          window.prompt('이 주소를 복사하세요', url);
        }
      }}
      className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 hover:bg-neutral-50 hover:text-black"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.7 10.7l6.6-3.4m-6.6 6l6.6 3.4M9 12a3 3 0 11-6 0 3 3 0 016 0zm12-6a3 3 0 11-6 0 3 3 0 016 0zm0 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
      {copied ? '복사됨!' : '공유'}
    </button>
  );
}

// 주소가 길면 카톡에서 링크가 두 줄로 접힌다. 뒤에 붙는 괄호 설명(레어도·세트 표기)은
// 떼고 40자까지만 싣는다 — 미리보기 제목에만 쓰이므로 짧아도 알아본다.
function shareName(title: string): string {
  return title
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim()
    .slice(0, 40);
}
