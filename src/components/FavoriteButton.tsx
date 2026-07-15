// 이모지(❤️/🤍)를 쓰면 OS·브라우저마다 다른 그림이 나오고, 흰 하트는 밝은 카드
// 그림 위에서 묻힌다. 아이콘은 SVG로 직접 그리고, 어떤 카드 이미지 위에서도 똑같이
// 읽히도록 뒤에 흰 칩을 깐다.
function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px]"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z" />
    </svg>
  );
}

// PriceChart의 선 색과 같은 값. 즐겨찾기해둔 카드가 곧 그래프로 시세를 추적하는
// 카드라, 표시와 그래프를 같은 색으로 묶어둔다. 한쪽을 바꾸면 같이 바꿔야 한다.
const ACTIVE = '#2a78d6';

// 카드 타일 전체가 <button>이라 그 안에 <button>을 중첩할 수 없다. 그래서
// role="button"인 span으로 만들고 키보드 조작을 직접 연결한다.
export function FavoriteButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  function activate(e: React.SyntheticEvent) {
    e.stopPropagation();
    e.preventDefault();
    onToggle();
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={active ? '즐겨찾기에서 빼기' : '즐겨찾기에 담기'}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') activate(e);
      }}
      style={active ? { backgroundColor: ACTIVE, borderColor: ACTIVE } : undefined}
      className={`absolute top-1.5 right-1.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border transition ${
        active ? 'text-white' : 'border-neutral-200 bg-white/90 text-neutral-700 hover:bg-white hover:text-black'
      }`}
    >
      <BookmarkIcon filled={active} />
    </span>
  );
}
