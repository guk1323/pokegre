// pokegre 마스코트 개구리. 공지 배너에서 인사말 옆에 세워 둔다.
//
// 포켓몬 캐릭터는 저작권이 있어 쓸 수 없으므로 직접 그린 그림이다. 색까지 넣은 이유는
// 개구리는 초록이어야 개구리로 읽히기 때문이고, 사이트에서 색이 들어가는 유일한 그림이다.
// 파일이 아니라 SVG로 그려 두면 어떤 크기로 키워도 안 뭉개지고 용량도 거의 안 든다.
const GREEN = '#a3ce6e';
const LINE = '#241f1c';
const BELLY = '#f7f8e3';
const BLUSH = '#ef7070';

export function PokegreFrog({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 104" className={className} role="img" aria-label="인사하는 pokegre 개구리">
      {/* 뒷다리·발 — 몸 뒤에 먼저 그려 아래쪽만 보이게 한다. 끝을 둥글려야
          네모난 상자처럼 보이지 않는다. */}
      <path
        d="M33 78 C29 78 27 82 27 87 C27 93 30 96 36 96 L44 96 C48 96 50 93 50 88 L50 78 Z"
        fill={GREEN}
        stroke={LINE}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M67 78 C71 78 73 82 73 87 C73 93 70 96 64 96 L56 96 C52 96 50 93 50 88 L50 78 Z"
        fill={GREEN}
        stroke={LINE}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* 발가락 */}
      <path d="M34 96 L34 92 M40 96 L40 92 M60 96 L60 92 M66 96 L66 92" stroke={LINE} strokeWidth="2.8" strokeLinecap="round" />

      {/* 팔 — 몸 옆에 붙여 아래로 내린 공손한 자세 */}
      <path
        d="M30 60 C22 62 19 70 20 78 C20.5 82 23 84 26 83 C29 82 30 79 29.5 75 C29 70 30 65 32 62 Z"
        fill={GREEN}
        stroke={LINE}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M70 60 C78 62 81 70 80 78 C79.5 82 77 84 74 83 C71 82 70 79 70.5 75 C71 70 70 65 68 62 Z"
        fill={GREEN}
        stroke={LINE}
        strokeWidth="4"
        strokeLinejoin="round"
      />

      {/* 몸통 */}
      <path
        d="M31 58 C31 78 37 87 50 87 C63 87 69 78 69 58 Z"
        fill={GREEN}
        stroke={LINE}
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      {/* 배 */}
      <ellipse cx="50" cy="72" rx="14" ry="10" fill={BELLY} />

      {/* 머리 — 위쪽 두 봉우리가 개구리 눈두덩이다 */}
      <path
        d="M11 44
           C11 24 18 9 32 9
           C42 9 47 16 50 23
           C53 16 58 9 68 9
           C82 9 89 24 89 44
           C89 62 73 72 50 72
           C27 72 11 62 11 44 Z"
        fill={GREEN}
        stroke={LINE}
        strokeWidth="4.5"
        strokeLinejoin="round"
      />

      {/* 감은 눈 */}
      <path d="M22 33 C27 25 37 25 42 33" stroke={LINE} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M58 33 C63 25 73 25 78 33" stroke={LINE} strokeWidth="4" strokeLinecap="round" fill="none" />

      {/* 볼 */}
      <ellipse cx="20" cy="44" rx="9" ry="6" fill={BLUSH} />
      <ellipse cx="80" cy="44" rx="9" ry="6" fill={BLUSH} />

      {/* 입 */}
      <path d="M31 43 C37 58 63 58 69 43" stroke={LINE} strokeWidth="4" strokeLinecap="round" fill="none" />

      {/* 머리 위 반짝임 */}
      <ellipse cx="24" cy="19" rx="4" ry="2.6" fill="#e8f4cf" transform="rotate(-28 24 19)" />
    </svg>
  );
}
