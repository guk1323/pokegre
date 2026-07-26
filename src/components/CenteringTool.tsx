import { useEffect, useRef, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { detectCard, type Rect } from '../lib/cardDetect';

// 센터링 측정. 앞면·뒷면 패널을 나란히 두고(넓은 화면은 2열, 폰은 세로), 각 면을 찍으면
// 카드 경계를 자동 검출해 두 네모(바깥=카드 테두리, 안쪽=일러스트 테두리)를 얹는다.
// 두 면 모두 언제든 다시 촬영·드래그 수정이 가능하고, 아래 표에서 회사별 앞/뒤/종합
// 등급을 함께 본다. 검출 로직은 src/lib/cardDetect.ts에 있다(테스트도 그 모듈로 돈다).

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type SideKey = 'front' | 'back';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function ratio(a: number, b: number): [number, number] | null {
  const s = a + b;
  if (s <= 0.0001) return null;
  const p = Math.round((a / s) * 100);
  return [p, 100 - p];
}

function verdict(worst: number): { label: string; color: string } {
  if (worst <= 55) return { label: '아주 좋음 (거의 중앙)', color: 'text-emerald-600' };
  if (worst <= 60) return { label: '좋음', color: 'text-emerald-600' };
  if (worst <= 65) return { label: '보통', color: 'text-amber-600' };
  return { label: '한쪽으로 치우침', color: 'text-rose-500' };
}

// 등급회사별 앞면 센터링 허용치. 가장 치우친 쪽(worst) %가 max 이하면 그 등급까지 가능.
// 좌우·상하 중 나쁜 쪽이 그 회사의 센터링 서브등급이 된다. 세 곳 다 공개된 기준이다.
// (BRG는 등급별 센터링 기준을 공식 공개하지 않아 넣지 않는다 — 확인되면 추가.)
const COMPANY_LADDERS: { name: string; ladder: [number, string][]; fail: string }[] = [
  { name: 'PSA', ladder: [[55, '10'], [60, '9'], [65, '8'], [70, '7'], [80, '6']], fail: '6 미만' },
  { name: 'BGS', ladder: [[50, '10'], [55, '9.5'], [60, '8'], [65, '7']], fail: '7 미만' },
  { name: 'CGC', ladder: [[50, '10 P'], [55, '10'], [60, '9.5'], [65, '8.5']], fail: '8.5 미만' },
];
function companyGrade(ladder: [number, string][], fail: string, worst: number): string {
  for (const [max, label] of ladder) if (worst <= max) return label;
  return fail;
}

// 뒷면 센터링 허용치(공개 기준). 뒷면은 어느 회사나 앞면보다 훨씬 관대하다.
const COMPANY_BACK: Record<string, { ladder: [number, string][]; fail: string }> = {
  PSA: { ladder: [[75, '10'], [90, '9']], fail: '9 미만' },
  BGS: { ladder: [[55, '10'], [60, '9.5'], [70, '9'], [80, '8'], [90, '7']], fail: '7 미만' },
  CGC: { ladder: [[50, '10 P'], [75, '10'], [90, '9.5']], fail: '9.5 미만' },
};

// 등급 라벨을 숫자로 바꿔 비교한다("10 P"는 10보다 위, "N 미만"은 최하).
function gradeValue(label: string): number {
  if (label.includes('미만')) return 0;
  if (label === '10 P') return 10.5;
  return parseFloat(label) || 0;
}

// 면(앞/뒤) 하나의 측정 상태.
type SideState = { imgUrl: string | null; outer: Rect; inner: Rect; zoom: number; autoOk: boolean };
const DEFAULT_OUTER: Rect = { l: 0.2, t: 0.12, r: 0.8, b: 0.88 };
const DEFAULT_INNER: Rect = { l: 0.26, t: 0.18, r: 0.74, b: 0.82 };
const initSide = (): SideState => ({ imgUrl: null, outer: DEFAULT_OUTER, inner: DEFAULT_INNER, zoom: 1, autoOk: true });
const SIDE_LABEL: Record<SideKey, string> = { front: '앞면', back: '뒷면' };

export function CenteringTool({ onSearchByPhoto }: { onSearchByPhoto?: (file: File) => void | Promise<void> }) {
  const [sides, setSides] = useState<Record<SideKey, SideState>>({ front: initSide(), back: initSide() });
  const [cameraOn, setCameraOn] = useState(false);
  const [howto, setHowto] = useState(false); // 사용법 펼침 여부
  const [scanning, setScanning] = useState(false); // 시세 보러 가기(사진 스캔) 진행 중
  const [scanErr, setScanErr] = useState<string | null>(null);
  // 기기 기울기(수평계용). 폰을 데스크와 평행하게(수평) 들면 beta·gamma가 0에 가깝다.
  const [tilt, setTilt] = useState<{ beta: number; gamma: number } | null>(null);
  // "자동 인식 다시"는 같은 사진이면 결과도 같아 변화가 없어 보인다. 눌렀다는 걸 알 수
  // 있게 잠깐 메시지를 띄운다.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 카메라·앨범이 어느 면을 채울지.
  const targetRef = useRef<SideKey>('front');
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imgRefs = useRef<Record<SideKey, HTMLImageElement | null>>({ front: null, back: null });
  const wrapRefs = useRef<Record<SideKey, HTMLDivElement | null>>({ front: null, back: null });
  const dragRef = useRef<{ side: SideKey; rect: 'outer' | 'inner'; corner: Corner } | null>(null);
  const pendingDetect = useRef<Record<SideKey, boolean>>({ front: false, back: false });

  const patch = (side: SideKey, p: Partial<SideState>) =>
    setSides((prev) => ({ ...prev, [side]: { ...prev[side], ...p } }));

  function showFlash(msg: string) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  }

  function loadFromBlob(side: SideKey, blob: Blob) {
    trackEvent('centering'); // 측정 사진이 들어온 횟수만 센다(사진·개인정보는 안 보냄)
    pendingDetect.current[side] = true;
    setSides((prev) => {
      const old = prev[side].imgUrl;
      if (old) URL.revokeObjectURL(old);
      return { ...prev, [side]: { ...prev[side], imgUrl: URL.createObjectURL(blob), zoom: 1 } };
    });
  }

  // 이미지가 로드되면 자동 검출을 돌려 두 네모를 얹는다(자동이 메인). 실패하면 중앙
  // 기본 네모 + 안내를 띄운다(가짜 50:50 방지).
  function onImgLoad(side: SideKey, e: React.SyntheticEvent<HTMLImageElement>) {
    if (!pendingDetect.current[side]) return;
    pendingDetect.current[side] = false;
    const res = detectCard(e.currentTarget, { backSide: side === 'back' });
    if (res) patch(side, { outer: res.outer, inner: res.inner, autoOk: true });
    else patch(side, { outer: DEFAULT_OUTER, inner: DEFAULT_INNER, autoOk: false });
  }

  function redetect(side: SideKey) {
    const img = imgRefs.current[side];
    if (!img) return;
    const res = detectCard(img, { backSide: side === 'back' });
    if (res) {
      patch(side, { outer: res.outer, inner: res.inner, autoOk: true });
      showFlash(`${SIDE_LABEL[side]} 자동 인식 완료 ✓ (같은 사진이면 결과가 같을 수 있습니다)`);
    } else {
      patch(side, { autoOk: false });
      showFlash(`${SIDE_LABEL[side]} 자동 인식 실패 — 네모를 직접 맞춰 주세요`);
    }
  }

  async function openCamera(side: SideKey) {
    targetRef.current = side;
    // iOS 13+는 기울기 센서 권한을 "사용자 제스처 안"(=await 전)에 요청해야 한다.
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (DOE && typeof DOE.requestPermission === 'function') DOE.requestPermission().catch(() => undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
    } catch {
      window.alert('카메라를 열 수 없습니다. 카메라 권한을 허용했는지 확인해 주세요.');
    }
  }

  function pickFile(side: SideKey) {
    targetRef.current = side;
    fileRef.current?.click();
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setTilt(null);
  }

  // 전체 프레임을 그대로 찍는다(가이드에 꽉 채우지 않아도 됨 → 초점 잡기 편함).
  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) loadFromBlob(targetRef.current, blob);
        closeCamera();
      },
      'image/jpeg',
      0.92,
    );
  }

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => undefined);
    }
  }, [cameraOn]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // 카메라가 켜져 있는 동안 기울기 센서를 듣는다(수평계).
  useEffect(() => {
    if (!cameraOn) return;
    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      setTilt({ beta: e.beta, gamma: e.gamma });
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [cameraOn]);

  // 앨범에서 고른 사진도 같은 흐름(자동 검출 → 드래그 조정)으로 태운다.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) loadFromBlob(targetRef.current, f);
  }

  function move(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const wrap = wrapRefs.current[d.side];
    if (!wrap) return;
    const box = wrap.getBoundingClientRect();
    const x = clamp((e.clientX - box.left) / box.width, 0, 1);
    const y = clamp((e.clientY - box.top) / box.height, 0, 1);
    setSides((prev) => {
      const st = prev[d.side];
      const n = { ...(d.rect === 'outer' ? st.outer : st.inner) };
      if (d.corner.includes('l')) n.l = Math.min(x, n.r - 0.03);
      if (d.corner.includes('r')) n.r = Math.max(x, n.l + 0.03);
      if (d.corner.includes('t')) n.t = Math.min(y, n.b - 0.03);
      if (d.corner.includes('b')) n.b = Math.max(y, n.t + 0.03);
      return { ...prev, [d.side]: { ...st, [d.rect]: n } };
    });
  }

  // 한 면의 측정값(좌우/상하/최악치). 이미지가 없으면 null.
  function calc(side: SideKey) {
    const st = sides[side];
    if (!st.imgUrl) return null;
    const lr = ratio(st.inner.l - st.outer.l, st.outer.r - st.inner.r);
    const tb = ratio(st.inner.t - st.outer.t, st.outer.b - st.inner.b);
    const worst = Math.max(lr ? Math.max(lr[0], lr[1]) : 50, tb ? Math.max(tb[0], tb[1]) : 50);
    return { lr, tb, worst, v: verdict(worst) };
  }
  const fr = calc('front');
  const bk = calc('back');

  // 측정 화면(사진+네모+수치)을 이미지로 만들어 내려받는다.
  function saveResult(side: SideKey) {
    const img = imgRefs.current[side];
    const st = sides[side];
    const res = calc(side);
    if (!img || !img.naturalWidth || !res) return;
    const W0 = Math.min(1200, img.naturalWidth);
    const scale = W0 / img.naturalWidth;
    const H0 = Math.round(img.naturalHeight * scale);
    const footer = Math.max(90, Math.round(W0 * 0.14));
    const c = document.createElement('canvas');
    c.width = W0;
    c.height = H0 + footer;
    const x = c.getContext('2d');
    if (!x) return;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W0, H0 + footer);
    x.drawImage(img, 0, 0, W0, H0);
    const lw = Math.max(3, Math.round(W0 * 0.004));
    const drawRect = (r: Rect, color: string) => {
      x.strokeStyle = color;
      x.lineWidth = lw;
      x.strokeRect(r.l * W0, r.t * H0, (r.r - r.l) * W0, (r.b - r.t) * H0);
    };
    drawRect(st.outer, '#2a78d6');
    drawRect(st.inner, '#10b981');
    x.fillStyle = '#111111';
    x.font = `bold ${Math.round(footer * 0.3)}px sans-serif`;
    x.fillText(
      `${SIDE_LABEL[side]}  좌우 ${res.lr ? `${res.lr[0]}:${res.lr[1]}` : '-'}   상하 ${res.tb ? `${res.tb[0]}:${res.tb[1]}` : '-'}`,
      Math.round(W0 * 0.04),
      H0 + Math.round(footer * 0.42),
    );
    x.fillStyle = '#666666';
    x.font = `${Math.round(footer * 0.2)}px sans-serif`;
    const ladders =
      side === 'front'
        ? COMPANY_LADDERS.map((cc) => `${cc.name} ${companyGrade(cc.ladder, cc.fail, res.worst)}`)
        : COMPANY_LADDERS.map((cc) => `${cc.name} ${companyGrade(COMPANY_BACK[cc.name].ladder, COMPANY_BACK[cc.name].fail, res.worst)}`);
    x.fillText(ladders.join('  ·  '), Math.round(W0 * 0.04), H0 + Math.round(footer * 0.75));
    x.textAlign = 'right';
    x.fillStyle = '#999999';
    x.fillText('pokegre.com', Math.round(W0 * 0.96), H0 + Math.round(footer * 0.75));
    x.textAlign = 'left';
    c.toBlob((b) => {
      if (!b) return;
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u;
      a.download = `pokegre-centering-${side}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 3000);
    }, 'image/png');
  }

  // 찍어둔 앞면(없으면 뒷면) 사진을 스캔해 시세 화면으로 넘긴다.
  async function goPrices() {
    if (!onSearchByPhoto) return;
    const url = sides.front.imgUrl ?? sides.back.imgUrl;
    if (!url) return;
    setScanning(true);
    setScanErr(null);
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], 'card.jpg', { type: blob.type || 'image/jpeg' });
      await onSearchByPhoto(file);
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : '카드 인식에 실패했습니다.');
    } finally {
      setScanning(false);
    }
  }

  function resetAll() {
    setSides((prev) => {
      if (prev.front.imgUrl) URL.revokeObjectURL(prev.front.imgUrl);
      if (prev.back.imgUrl) URL.revokeObjectURL(prev.back.imgUrl);
      return { front: initSide(), back: initSide() };
    });
  }

  function handles(side: SideKey, rect: 'outer' | 'inner', r: Rect, color: string) {
    const pts: { corner: Corner; x: number; y: number }[] = [
      { corner: 'tl', x: r.l, y: r.t },
      { corner: 'tr', x: r.r, y: r.t },
      { corner: 'bl', x: r.l, y: r.b },
      { corner: 'br', x: r.r, y: r.b },
    ];
    return pts.map((p) => (
      <div
        key={side + rect + p.corner}
        onPointerDown={(e) => {
          dragRef.current = { side, rect, corner: p.corner };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* 무시 */
          }
        }}
        onPointerMove={move}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, borderColor: color, touchAction: 'none' }}
        className="absolute z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 bg-white/70 active:cursor-grabbing"
      />
    ));
  }

  // 면 하나의 패널(촬영/수정/수치). 넓은 화면에선 앞·뒷면이 나란히 놓인다.
  function renderPanel(side: SideKey) {
    const st = sides[side];
    const res = calc(side);
    return (
      <div className="rounded-xl border border-neutral-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${side === 'front' ? 'bg-neutral-900 text-white' : 'bg-emerald-600 text-white'}`}>
            {SIDE_LABEL[side]}
          </span>
          {res && (
            <span className={`text-xs font-semibold ${res.v.color}`}>{res.v.label}</span>
          )}
        </div>

        {!st.imgUrl ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => openCamera(side)}
              className="w-full rounded-xl bg-black py-4 text-sm font-semibold text-white hover:opacity-90"
            >
              {SIDE_LABEL[side]} 촬영 (수평계 지원)
            </button>
            <button
              type="button"
              onClick={() => pickFile(side)}
              className="w-full rounded-xl border border-dashed border-neutral-300 py-3 text-sm text-neutral-500 hover:bg-neutral-50"
            >
              앨범에서 올리기
            </button>
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openCamera(side)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                다시
              </button>
              <button
                type="button"
                onClick={() => pickFile(side)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                앨범
              </button>
              <button
                type="button"
                onClick={() => redetect(side)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-[#2a78d6] hover:bg-neutral-50"
              >
                자동 인식
              </button>
              <button
                type="button"
                onClick={() => saveResult(side)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                저장
              </button>
              <span className="ml-auto inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => patch(side, { zoom: clamp(st.zoom - 0.5, 1, 4) })}
                  className="h-7 w-7 rounded-lg border border-neutral-300 text-base font-bold leading-none text-neutral-700 hover:bg-neutral-50"
                >
                  −
                </button>
                <span className="w-10 text-center text-[11px] font-semibold text-neutral-600">{Math.round(st.zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => patch(side, { zoom: clamp(st.zoom + 0.5, 1, 4) })}
                  className="h-7 w-7 rounded-lg border border-neutral-300 text-base font-bold leading-none text-neutral-700 hover:bg-neutral-50"
                >
                  +
                </button>
              </span>
            </div>
            <div className="max-h-[62vh] overflow-auto rounded-xl bg-neutral-100">
              <div
                ref={(el) => {
                  wrapRefs.current[side] = el;
                }}
                className="relative select-none"
                style={{ width: `${st.zoom * 100}%` }}
              >
                <img
                  ref={(el) => {
                    imgRefs.current[side] = el;
                  }}
                  src={st.imgUrl}
                  alt={`${SIDE_LABEL[side]} 카드`}
                  className="block w-full"
                  draggable={false}
                  onLoad={(e) => onImgLoad(side, e)}
                  // 네모를 드래그할 때 크롬이 이미지 일부를 안 지우고 지나가 흰 줄이 남는
                  // 리페인트 버그가 있다. 이미지를 별도 합성 레이어로 올려 깨끗이 다시 그리게 한다.
                  style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
                />
                <div
                  className="pointer-events-none absolute border-2 border-[#2a78d6]"
                  style={{ left: `${st.outer.l * 100}%`, top: `${st.outer.t * 100}%`, width: `${(st.outer.r - st.outer.l) * 100}%`, height: `${(st.outer.b - st.outer.t) * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute border-2 border-emerald-500"
                  style={{ left: `${st.inner.l * 100}%`, top: `${st.inner.t * 100}%`, width: `${(st.inner.r - st.inner.l) * 100}%`, height: `${(st.inner.b - st.inner.t) * 100}%` }}
                />
                {handles(side, 'outer', st.outer, '#2a78d6')}
                {handles(side, 'inner', st.inner, '#10b981')}
              </div>
            </div>
            {!st.autoOk && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] font-semibold text-amber-700">
                ⚠️ 자동 인식에 실패했습니다. 어두운 배경에 한 장만 놓고 다시 찍거나, 네모를 직접 맞춰 주세요.
              </div>
            )}
            {res && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] text-neutral-500">좌우</p>
                  <p className="text-xl font-bold text-black">{res.lr ? `${res.lr[0]} : ${res.lr[1]}` : '-'}</p>
                </div>
                <div>
                  <p className="text-[11px] text-neutral-500">상하</p>
                  <p className="text-xl font-bold text-black">{res.tb ? `${res.tb[0]} : ${res.tb[1]}` : '-'}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-bold text-black">센터링 측정</h2>
        <button
          type="button"
          onClick={() => setHowto((v) => !v)}
          className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs font-semibold text-neutral-500 hover:bg-neutral-50"
        >
          사용법 {howto ? '▲' : '▾'}
        </button>
      </div>
      {howto && (
        <div className="mb-4 rounded-xl bg-neutral-50 p-4 text-xs text-neutral-600">
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>카드를 슬리브·케이스에서 꺼내 <b>어두운 배경</b>에 한 장만 놓고, 기울지 않게 똑바로 찍습니다.</li>
            <li><span className="font-semibold text-[#2a78d6]">파란 네모</span>(카드 테두리)·<span className="font-semibold text-emerald-600">초록 네모</span>(일러스트 테두리)가 자동으로 얹힙니다. 빗나가면 <b>모서리를 잡아 직접 맞추면</b> 됩니다.</li>
            <li><b>앞·뒷면 모두</b> 재면 회사별 종합 등급이 나옵니다. 참고용입니다.</li>
          </ol>
        </div>
      )}

      {flash && <p className="mb-2 text-xs font-semibold text-[#2a78d6]">{flash}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {renderPanel('front')}
        {renderPanel('back')}
      </div>

      {(fr || bk) && (
        <div className="mt-4 rounded-xl border border-neutral-200 p-4">
          <p className="mb-2 text-xs font-bold text-neutral-500">회사별 센터링 등급 (참고)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="text-[11px] text-neutral-500">
                  <th className="py-1 text-left font-semibold">회사</th>
                  <th className="py-1 font-semibold">앞면</th>
                  <th className="py-1 font-semibold">뒷면</th>
                  <th className="py-1 font-semibold">종합</th>
                </tr>
              </thead>
              <tbody>
                {COMPANY_LADDERS.map((c) => {
                  const fg = fr ? companyGrade(c.ladder, c.fail, fr.worst) : null;
                  const back = COMPANY_BACK[c.name];
                  const bg = bk ? companyGrade(back.ladder, back.fail, bk.worst) : null;
                  const overall = fg && bg ? (gradeValue(bg) < gradeValue(fg) ? bg : fg) : (fg ?? bg);
                  return (
                    <tr key={c.name} className="border-t border-neutral-100">
                      <td className="py-1.5 text-left font-semibold text-neutral-700">{c.name}</td>
                      <td className="py-1.5 font-bold text-black">{fg ?? '-'}</td>
                      <td className="py-1.5 font-bold text-black">{bg ?? '-'}</td>
                      <td className="py-1.5 font-extrabold text-black">{overall ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-neutral-400">
            종합은 앞·뒷면 중 낮은 등급이에요(실제 감정 방식). 센터링만 본 값이라 실제 등급은 모서리·표면·스크래치도
            함께 봅니다.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onSearchByPhoto && (
              <button
                type="button"
                onClick={goPrices}
                disabled={scanning}
                className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {scanning && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {scanning ? '카드 인식 중…' : '이 카드 시세 보러 가기'}
              </button>
            )}
            <button
              type="button"
              onClick={resetAll}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-400 hover:bg-neutral-50"
            >
              처음부터
            </button>
            {scanErr && <span className="text-xs text-rose-500">{scanErr}</span>}
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />

      {/* 가이드 틀이 있는 자체 카메라. 틀은 "이 안에 카드가 들어오게" 정도의 안내이고,
          꽉 채우지 않아도 된다(전체 프레임을 찍어 자동 검출이 카드를 찾는다). */}
      {cameraOn && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
          <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm font-semibold text-white/90">
            {SIDE_LABEL[targetRef.current]} — 카드 <span className="text-white">한 장만</span>,{' '}
            <span className="text-white">흐리지 않게(초점)</span>, <span className="text-white">기울지 않게</span> 틀 안에 찍으세요
          </p>
          {/* 수평계: 폰을 데스크와 평행(수평)하게 들면 점이 가운데로 모이고 초록으로 바뀐다. */}
          {tilt && (
            <div className="pointer-events-none absolute inset-x-0 top-16 flex flex-col items-center">
              {(() => {
                const lv = Math.abs(tilt.beta) < 3 && Math.abs(tilt.gamma) < 3;
                const dx = clamp(tilt.gamma * 2.6, -26, 26);
                const dy = clamp(tilt.beta * 2.6, -26, 26);
                return (
                  <>
                    <div className={`relative h-16 w-16 rounded-full border-2 ${lv ? 'border-emerald-400' : 'border-white/50'}`}>
                      <div
                        className={`absolute left-1/2 top-1/2 h-4 w-4 rounded-full ${lv ? 'bg-emerald-400' : 'bg-white/90'}`}
                        style={{ transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }}
                      />
                    </div>
                    <p className={`mt-1 text-xs font-semibold ${lv ? 'text-emerald-400' : 'text-white/80'}`}>{lv ? '수평 맞음 ✓' : '수평 맞추기'}</p>
                  </>
                );
              })()}
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border-2 border-white/70" style={{ height: '44%', aspectRatio: '2.5 / 3.5' }} />
          </div>
          <div className="absolute inset-x-0 bottom-8 flex items-center justify-center gap-10">
            <button type="button" onClick={closeCamera} className="text-sm font-semibold text-white/90">
              취소
            </button>
            <button
              type="button"
              onClick={capture}
              aria-label="촬영"
              className="h-16 w-16 rounded-full border-4 border-white bg-white/30 active:bg-white/50"
            />
            <span className="w-8" />
          </div>
        </div>
      )}
    </div>
  );
}
