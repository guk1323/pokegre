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

/** 저장해 둔 설정을 읽는다. 기본은 **꺼짐**. */
export function 소리켜졌나(): boolean {
  try { return localStorage.getItem(열쇠) === '1'; } catch { return false; }
}
export function 소리설정(v: boolean) {
  켬 = v;
  try { localStorage.setItem(열쇠, v ? '1' : '0'); } catch { /* 비공개 모드 */ }
  if (v) 따기();
}

function 따기(): AudioContext | null {
  if (통) return 통;
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    통 = new C();
  } catch { 통 = null; }
  return 통;
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
  g.gain.linearRampToValueAtTime(크기, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 길이);
  o.connect(g).connect(c.destination);
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
  g.gain.setValueAtTime(크기, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 길이);
  src.connect(f).connect(g).connect(c.destination);
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
