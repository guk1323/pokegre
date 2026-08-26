// 대전쟁 소리 — **파일이 없다. 그때그때 만들어 낸다(WebAudio).**
//
// ⚠️⚠️ 왜 파일을 안 쓰나:
//   ① **용량이 0이다.** mp3를 넣으면 배포 이미지가 커지고, 소리 하나가 수십 KB다.
//   ② **저작권이 깨끗하다.** 받아 온 효과음은 출처를 늘 따져야 한다.
//   ③ 도트 그림에 맞는 8비트풍 소리는 **합성이 더 잘 어울린다.**
//
// ⚠️ **AudioContext는 사람이 누르기 전에 못 만든다.** 브라우저가 막는다(자동재생 정책).
//    그래서 첫 소리를 낼 때 만든다(`따기`). 만들기 전에는 조용히 아무것도 안 한다.
// ⚠️ **소리는 기본이 꺼짐이다.** 시세 보러 온 사람 화면에서 갑자기 소리가 나면 안 된다.

const 열쇠 = 'pokegre_battle_sound';

let 통: AudioContext | null = null;
let 켬 = false;
/**
 * ⚠️⚠️ **폰 스피커는 작다.** 값을 0.05~0.11로 잡아 뒀는데 PC 스피커 기준이었다 —
 *    폰에서는 "소리가 안 난다"에 가깝게 들린다. 소리는 **기본이 꺼짐**이고 사람이 켜야
 *    나오므로 조금 키워도 놀랄 일이 없다.
 * ⚠️ 너무 키우면 스무 마리가 때릴 때 귀가 아프다 — 때리는 소리는 초당 12번으로 막혀 있다.
 */
const 크기배 = 2;

/** 저장해 둔 설정을 읽는다. 기본은 **꺼짐**. */
export function 소리켜졌나(): boolean {
  try { return localStorage.getItem(열쇠) === '1'; } catch { return false; }
}
export function 소리설정(v: boolean) {
  켬 = v;
  try { localStorage.setItem(열쇠, v ? '1' : '0'); } catch { /* 비공개 모드 */ }
  // ⚠️ **이 함수는 사람이 단추를 누른 그 순간에 불린다** — 폰에서 소리통을 열 수 있는
  //    거의 유일한 때다. 만들기만 하지 말고 **깨우기까지** 해야 한다.
  if (v) 깨우자();
}

/**
 * ⚠️⚠️⚠️ **폰에서 소리가 안 나던 까닭**(2026-08-18 사장님 지적).
 *
 * 폰 브라우저는 **사람이 누르는 그 순간에만** 소리통(AudioContext)을 열어 준다.
 * 그런데 이 게임의 첫 소리는 대개 **셈에서** 나온다 — 적이 나오거나, 3·2·1이 끝나거나,
 * 유닛이 때릴 때다. 그때 만들어진 통은 **잠긴 채(suspended)로 태어나고**, 그 자리에서
 * 부른 `resume()`은 사람이 누른 것이 아니라서 **거절당한다.** 한 번 그렇게 되면
 * 그 뒤로는 영영 조용하다 — 오류도 안 난다.
 *
 * → **사람이 누를 때마다 깨운다.** 이 게임은 카드를 누르지 않으면 진행이 안 되므로
 *   반드시 한 번은 걸린다. 이미 깨어 있으면 아무 일도 안 한다(값이 거의 0이다).
 * ⚠️ `once`를 쓰지 않는다 — 나중에 소리를 켜는 사람도 있고, 탭을 갔다 오면 또 잠긴다.
 */
function 깨우자() {
  if (!켬) return;
  const c = 따기();
  if (c && c.state === 'suspended') void c.resume();
}

let 손붙임 = false;
function 손붙이기() {
  if (손붙임 || typeof window === 'undefined') return;
  손붙임 = true;
  for (const 이름 of ['pointerdown', 'touchend', 'keydown'] as const) {
    window.addEventListener(이름, 깨우자, { passive: true });
  }
  // 탭을 갔다 오면 잠겨 있다 — 돌아왔을 때도 깨운다.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) 깨우자(); });
}

/**
 * 모든 소리가 지나가는 **마스터**. 지금은 그냥 통과시키지만, 소리를 한꺼번에 줄이거나
 * 끄는 일이 생기면 여기 한 곳만 만지면 된다.
 *
 * ⚠️ 여기 **분석기를 달아 「진짜로 소리가 나가는지」를 재던 때가 있었다**(2026-08-18).
 *    폰에서 소리가 안 난다는 말이 나왔을 때, 「내보내라고 시킨 횟수」와 「실제로 나간 것」이
 *    다르다는 것을 가르려고 붙였다. 원인이 **아이폰 무음 스위치**로 밝혀져 걷어냈다 —
 *    소리 하나마다 타이머를 열두 개씩 돌리는 것이라 판이 도는 동안 값이 싸지 않다.
 *    다시 필요하면 `.claude/게임.md`의 「소리가 진짜 나가는지 재는 법」을 보라.
 */
let 마스터: GainNode | null = null;

function 따기(): AudioContext | null {
  if (통) return 통;
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    통 = new C();
    마스터 = 통.createGain();
    마스터.gain.value = 1;
    // ⚠️ 새 소리는 스피커(`destination`)가 아니라 **`끝단()`**에 연결할 것.
    마스터.connect(통.destination);
  } catch { 통 = null; }
  return 통;
}

/** 소리를 이어 붙일 끝단. 마스터가 없으면(아주 옛 브라우저) 스피커로 바로 간다. */
function 끝단(c: AudioContext): AudioNode {
  return 마스터 ?? c.destination;
}

/**
 * 소리 한 번. 아주 짧은 음 하나를 만들어 내고 버린다.
 *
 * ⚠️ **끝에 반드시 페이드를 준다.** 갑자기 끊으면 「딱」 하는 잡음(클릭)이 난다 —
 *    한 판에 수백 번 나므로 이게 제일 거슬린다.
 * ⚠️ 소리가 겹칠 때를 대비해 볼륨을 낮게 둔다. 한 판에 유닛이 스무 마리씩 때린다.
 */
function 삑(꼴: OscillatorType, 시작Hz: number, 끝Hz: number, 길이: number, 크기: number) {
  if (!켬) return;
  const c = 따기();
  if (!c) return;
  // ⚠️ 탭을 갔다 오면 멈춰 있다. 깨워 주지 않으면 그 뒤로 영영 소리가 안 난다.
  if (c.state === 'suspended') void c.resume();
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 꼴;
  o.frequency.setValueAtTime(시작Hz, t);
  if (끝Hz !== 시작Hz) o.frequency.exponentialRampToValueAtTime(Math.max(1, 끝Hz), t + 길이);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(크기 * 크기배, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 길이);
  o.connect(g).connect(끝단(c));
  o.start(t);
  o.stop(t + 길이 + 0.02);
}

/** 잡음(노이즈) 한 번 — 때리는 소리처럼 「퍽」 하는 것은 음이 아니라 잡음이다. */
function 퍽(길이: number, 크기: number, 자름Hz: number) {
  if (!켬) return;
  const c = 따기();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  const t = c.currentTime;
  const 칸 = Math.max(1, Math.floor(c.sampleRate * 길이));
  const 버퍼 = c.createBuffer(1, 칸, c.sampleRate);
  const d = 버퍼.getChannelData(0);
  for (let i = 0; i < 칸; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / 칸);
  const src = c.createBufferSource();
  src.buffer = 버퍼;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(자름Hz, t);
  const g = c.createGain();
  // ⚠️ 여기에도 `크기배`를 먹인다 — 2026-08-18에 소리를 2배로 올리면서 **이 줄만 빠졌었다.**
  //    하필 때리는 소리(제일 자주 나는 것)가 그대로여서 「올렸는데 그대로다」가 됐다.
  g.gain.setValueAtTime(크기 * 크기배, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 길이);
  src.connect(f).connect(g).connect(끝단(c));
  src.start(t);
}

// ⚠️ 때리는 소리는 **너무 자주 난다.** 한 판에 스무 마리가 1초에 한 번씩 때리면 귀가 아프다.
//    그래서 **초당 몇 번까지만** 낸다(나머지는 조용히 버린다).
let 마지막때림 = 0;

export const 소리 = {
  /** 유닛을 내보냄 */
  소환: () => 삑('triangle', 420, 700, 0.09, 0.05),
  /**
   * 서로 때림 — 너무 잦아 초당 12번으로 막는다.
   *
   * ⚠️⚠️ **상성을 소리로도 알린다**(사장님 2026-08-18 할 일 12번). 상성이 이 게임의
   *    알맹이인데 여태 **눈으로만** 갈렸다 — 화면을 안 보고 있어도 손끝으로 알아야 한다.
   *    잘 통하면 **높고 밝게**(자름 4200Hz + 짧은 종소리), 안 통하면 **낮고 먹먹하게**(900Hz).
   * ⚠️ 종소리를 매번 얹지 않는다 — 잘 통할 때만이라 드물게 난다. 늘 나면 그냥 시끄럽다.
   * ⚠️ `배`를 안 주면 예전 그대로다(부르는 자리를 다 안 고쳐도 안 깨진다).
   */
  때림: (배 = 1) => {
    const 지금 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (지금 - 마지막때림 < 80) return;
    마지막때림 = 지금;
    if (배 >= 2) {
      퍽(0.05, 0.05, 4200);
      삑('triangle', 880, 1320, 0.06, 0.035);
    } else if (배 < 1) {
      퍽(0.06, 0.035, 900);
    } else {
      퍽(0.05, 0.045, 2200);
    }
  },
  /** 적을 잡음 */
  잡음: () => 삑('square', 660, 990, 0.11, 0.05),
  /** 성이 맞음 — 낮고 묵직하게 */
  성맞음: () => { 퍽(0.16, 0.09, 500); 삑('sine', 150, 70, 0.18, 0.07); },
  /** 못 냄(돈 모자람·대기 중) */
  안됨: () => 삑('sine', 220, 160, 0.08, 0.03),
  /** 이김 — 올라가는 세 음 */
  이김: () => { 삑('triangle', 523, 523, 0.12, 0.07); setTimeout(() => 삑('triangle', 659, 659, 0.12, 0.07), 110); setTimeout(() => 삑('triangle', 880, 880, 0.24, 0.08), 220); },
  /** 짐 — 내려가는 두 음 */
  짐: () => { 삑('sawtooth', 330, 330, 0.16, 0.06); setTimeout(() => 삑('sawtooth', 165, 110, 0.4, 0.06), 150); },
  /** 별 하나가 켜질 때 */
  별: (n: number) => 삑('triangle', 700 + n * 220, 900 + n * 260, 0.16, 0.07),
  /**
   * 무리가 오기 직전 — 낮게 두 번.
   * ⚠️ **쉬는 참이 끝난다는 신호다.** 화면을 안 보고 있어도 이걸 듣고 대비할 수 있어야 한다.
   */
  무리옴: () => { 삑('square', 300, 300, 0.09, 0.05); setTimeout(() => 삑('square', 300, 300, 0.09, 0.05), 130); },
  /** 성이 무너질 때 — 길고 낮게 */
  성무너짐: () => { 퍽(0.5, 0.11, 320); 삑('sawtooth', 110, 40, 0.6, 0.08); },
};

// 처음 불러올 때 저장된 설정을 반영한다(소리를 내지는 않는다 — 통은 누를 때 만든다).
켬 = 소리켜졌나();
// ⚠️ **사람이 누를 때 깨우는 손을 미리 붙여 둔다.** 이게 없으면 폰에서 소리가 안 난다
//    (위 `깨우자` 설명 참고). 이 파일은 게임 화면에서만 불러오므로 다른 화면에는 안 붙는다.
손붙이기();
