import { useEffect, useRef, useState } from 'react';

// 센터링 측정. 카메라로 카드를 찍으면 경계선을 자동 검출해 두 네모(바깥=카드 테두리,
// 안쪽=일러스트 테두리)를 얹고, 여백 비율을 계산한다. 자동이 빗나가면 네모를 손으로
// 미세 조정한다. 계산만 하므로 유지보수할 데이터가 없다.

type Rect = { l: number; t: number; r: number; b: number }; // 이미지 대비 0~1 비율
type Corner = 'tl' | 'tr' | 'bl' | 'br';

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

// PSA가 공개한 앞면 센터링 허용치(대략). 가장 치우친 쪽 %로 도달 가능한 최고 등급.
function psaCentering(worst: number): string {
  if (worst <= 55) return 'PSA 10 센터링 기준(55/45)까지 충족';
  if (worst <= 60) return 'PSA 9 센터링 기준(60/40)까지 충족';
  if (worst <= 65) return 'PSA 8 센터링 기준(65/35)까지 충족';
  if (worst <= 70) return 'PSA 7 센터링 기준(70/30)까지 충족';
  if (worst <= 80) return 'PSA 6 센터링 기준(80/20)까지 충족';
  return 'PSA 6 센터링 기준(80/20)에도 못 미침';
}

// 어두운 배경 위 카드를 밝기로 가르는 오츠(Otsu) 임계값.
function otsu(g: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; thr = i; }
  }
  return thr;
}

// 밝은 픽셀 덩어리(연결요소) 중 "가운데 카드"의 바깥 사각형을 고른다. 카드 비율(~0.72)에
// 맞고 충분히 큰 덩어리를 찾되, 이미지 가장자리에 닿는 덩어리(=화면에 걸친 옆 카드)는
// 점수를 크게 깎아 무시한다. 홀로·어두운 배경에 강하다.
function detectOuter(bright: Uint8Array, W: number, H: number): { lo: number; ro: number; to: number; bo: number } | null {
  const label = new Int32Array(W * H);
  const stack: number[] = [];
  let best: { minx: number; maxx: number; miny: number; maxy: number; score: number } | null = null;
  let cur = 0;
  for (let s = 0; s < W * H; s++) {
    if (!bright[s] || label[s]) continue;
    cur++;
    let area = 0, minx = W, maxx = 0, miny = H, maxy = 0, touch = false;
    stack.length = 0;
    stack.push(s);
    label[s] = cur;
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % W;
      const y = (p / W) | 0;
      area++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touch = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (bright[np] && !label[np]) { label[np] = cur; stack.push(np); }
        }
    }
    const w = maxx - minx + 1;
    const h = maxy - miny + 1;
    const ratio = w / h;
    if (area < W * H * 0.03 || w < W * 0.25 || h < H * 0.25 || ratio < 0.5 || ratio > 0.95) continue;
    const score = area * (touch ? 0.3 : 1);
    if (!best || score > best.score) best = { minx, maxx, miny, maxy, score };
  }
  if (!best) return null;
  return { lo: best.minx, ro: best.maxx, to: best.miny, bo: best.maxy };
}

// 바깥 테두리(from)에서 안쪽(to)으로 스캔해 처음 만나는 강한 선(=일러스트 테두리)의 인덱스.
// 깊은 곳의 더 강한 본문·텍스트 선보다, 테두리에 가장 가까운 선을 잡아야 안쪽으로 침범하지
// 않는다. from>to면 반대 방향(우·하)으로 스캔한다. 못 찾으면 null(인셋으로 대체).
function firstStrongInBand(P: Float32Array, from: number, to: number, T: number): number | null {
  const a = Math.round(from);
  const b = Math.round(to);
  const step = b >= a ? 1 : -1;
  for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
    if (i <= 0 || i >= P.length - 1) continue;
    if (P[i] >= T && P[i] >= P[i - 1] && P[i] >= P[i + 1]) return i;
  }
  return null;
}

// 카드 바깥 테두리(밝기 분할)와 안쪽 일러스트 테두리(카드 영역 안 경계선)를 함께 검출.
// 실패하면 null(자동 인식 실패로 처리 → 수동 안내).
function detectCard(img: HTMLImageElement): { outer: Rect; inner: Rect } | null {
  const W = 200;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return null;
  }
  const g = new Float32Array(W * H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  // ── 바깥: 밝기 분할 + 가운데 카드 덩어리 ──
  const thr = Math.max(otsu(g), 40); // 배경이 아주 어두워도 임계가 너무 낮아지지 않게
  const bright = new Uint8Array(W * H);
  for (let i = 0; i < g.length; i++) bright[i] = g[i] > thr ? 1 : 0;
  const box = detectOuter(bright, W, H);
  if (!box) return null;
  const { lo, ro, to, bo } = box;
  const outer: Rect = { l: lo / W, t: to / H, r: (ro + 1) / W, b: (bo + 1) / H };
  const owP = ro - lo;
  const ohP = bo - to;
  // ── 안쪽: 카드 영역 안에서만 경계선 프로파일 → 바깥에서 안으로 첫 강한 선 ──
  const colV = new Float32Array(W);
  for (let x = lo + 1; x <= ro; x++) {
    let s = 0;
    for (let y = to; y <= bo; y++) s += Math.abs(g[y * W + x] - g[y * W + x - 1]);
    colV[x] = s / Math.max(1, ohP);
  }
  const rowH = new Float32Array(H);
  for (let y = to + 1; y <= bo; y++) {
    let s = 0;
    for (let x = lo; x <= ro; x++) s += Math.abs(g[y * W + x] - g[(y - 1) * W + x]);
    rowH[y] = s / Math.max(1, owP);
  }
  let cMax = 0;
  for (let x = lo; x <= ro; x++) if (colV[x] > cMax) cMax = colV[x];
  let rMax = 0;
  for (let y = to; y <= bo; y++) if (rowH[y] > rMax) rMax = rowH[y];
  const cT = cMax * 0.18;
  const rT = rMax * 0.18;
  const li = firstStrongInBand(colV, lo + owP * 0.02, lo + owP * 0.2, cT);
  const ri = firstStrongInBand(colV, ro - owP * 0.02, ro - owP * 0.2, cT);
  const ti = firstStrongInBand(rowH, to + ohP * 0.02, to + ohP * 0.2, rT);
  const bi = firstStrongInBand(rowH, bo - ohP * 0.02, bo - ohP * 0.2, rT);
  const inner: Rect = {
    l: li != null ? li / W : outer.l + (outer.r - outer.l) * 0.05,
    t: ti != null ? ti / H : outer.t + (outer.b - outer.t) * 0.05,
    r: ri != null ? (ri + 1) / W : outer.r - (outer.r - outer.l) * 0.05,
    b: bi != null ? (bi + 1) / H : outer.b - (outer.b - outer.t) * 0.05,
  };
  if (!(inner.l < inner.r - 0.02 && inner.t < inner.b - 0.02)) {
    inner.l = outer.l + (outer.r - outer.l) * 0.05;
    inner.r = outer.r - (outer.r - outer.l) * 0.05;
    inner.t = outer.t + (outer.b - outer.t) * 0.05;
    inner.b = outer.b - (outer.b - outer.t) * 0.05;
  }
  inner.l = clamp(inner.l, outer.l, outer.r);
  inner.r = clamp(inner.r, outer.l, outer.r);
  inner.t = clamp(inner.t, outer.t, outer.b);
  inner.b = clamp(inner.b, outer.t, outer.b);
  return { outer, inner };
}

export function CenteringTool() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [outer, setOuter] = useState<Rect>({ l: 0.06, t: 0.06, r: 0.94, b: 0.94 });
  const [inner, setInner] = useState<Rect>({ l: 0.14, t: 0.12, r: 0.86, b: 0.88 });
  const [zoom, setZoom] = useState(1);
  const [cameraOn, setCameraOn] = useState(false);
  // 기기 기울기(수평계용). 폰을 데스크와 평행하게(수평) 들면 beta·gamma가 0에 가깝다.
  const [tilt, setTilt] = useState<{ beta: number; gamma: number } | null>(null);
  // 자동 인식 성공 여부. 실패면 가짜 50:50 대신 "직접 맞춰주세요" 안내를 띄운다.
  const [autoOk, setAutoOk] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ rect: 'outer' | 'inner'; corner: Corner } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pendingDetect = useRef(false); // 새 이미지 로드 시 자동 검출 1회

  function applyDetected(res: { outer: Rect; inner: Rect }) {
    setOuter(res.outer);
    setInner(res.inner);
  }

  function loadFromBlob(blob: Blob) {
    pendingDetect.current = true;
    setImgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setZoom(1);
  }

  // 이미지가 로드되면 자동 검출을 돌려 두 네모를 얹는다(자동이 메인). 실패하면 기본값 유지.
  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    if (!pendingDetect.current) return;
    pendingDetect.current = false;
    const res = detectCard(e.currentTarget);
    if (res) {
      applyDetected(res);
      setAutoOk(true);
    } else {
      // 실패 시 가짜 50:50이 뜨지 않게, 네모를 중앙의 카드 모양으로 두고 안내를 띄운다.
      setOuter({ l: 0.2, t: 0.12, r: 0.8, b: 0.88 });
      setInner({ l: 0.26, t: 0.18, r: 0.74, b: 0.82 });
      setAutoOk(false);
    }
  }

  function redetect() {
    const img = imgRef.current;
    if (!img) return;
    const res = detectCard(img);
    if (res) {
      applyDetected(res);
      setAutoOk(true);
    } else {
      setAutoOk(false);
    }
  }

  async function openCamera() {
    // iOS 13+는 기울기 센서 권한을 "사용자 제스처 안"(=await 전)에 요청해야 한다. await
    // 뒤에 하면 제스처가 소진돼 무시된다. 그래서 버튼 핸들러 맨 앞에서 바로 요청한다.
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (DOE && typeof DOE.requestPermission === 'function') DOE.requestPermission().catch(() => undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
    } catch {
      window.alert('카메라를 열 수 없어요. 카메라 권한을 허용했는지 확인해 주세요.');
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setTilt(null);
  }

  // 전체 프레임을 그대로 찍는다(가이드에 꽉 채우지 않아도 됨 → 초점 잡기 편함). 카드 주변에
  // 배경이 남아도 자동 검출이 카드 경계를 찾는다.
  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) loadFromBlob(blob);
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

  // 카메라가 켜져 있는 동안 기울기 센서를 듣는다(수평계). 값이 없으면(권한 거부·미지원)
  // 수평계는 그냥 안 뜬다.
  useEffect(() => {
    if (!cameraOn) return;
    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      setTilt({ beta: e.beta, gamma: e.gamma });
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [cameraOn]);

  function move(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !wrapRef.current) return;
    const box = wrapRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - box.left) / box.width, 0, 1);
    const y = clamp((e.clientY - box.top) / box.height, 0, 1);
    const set = d.rect === 'outer' ? setOuter : setInner;
    set((prev) => {
      const n = { ...prev };
      if (d.corner.includes('l')) n.l = Math.min(x, n.r - 0.03);
      if (d.corner.includes('r')) n.r = Math.max(x, n.l + 0.03);
      if (d.corner.includes('t')) n.t = Math.min(y, n.b - 0.03);
      if (d.corner.includes('b')) n.b = Math.max(y, n.t + 0.03);
      return n;
    });
  }

  const lr = ratio(inner.l - outer.l, outer.r - inner.r);
  const tb = ratio(inner.t - outer.t, outer.b - inner.b);
  const worst = Math.max(lr ? Math.max(lr[0], lr[1]) : 50, tb ? Math.max(tb[0], tb[1]) : 50);
  const v = verdict(worst);

  function handles(rect: 'outer' | 'inner', r: Rect, color: string) {
    const pts: { corner: Corner; x: number; y: number }[] = [
      { corner: 'tl', x: r.l, y: r.t },
      { corner: 'tr', x: r.r, y: r.t },
      { corner: 'bl', x: r.l, y: r.b },
      { corner: 'br', x: r.r, y: r.b },
    ];
    return pts.map((p) => (
      <div
        key={rect + p.corner}
        onPointerDown={(e) => {
          dragRef.current = { rect, corner: p.corner };
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

  return (
    <div>
      <h2 className="text-base font-bold text-black mb-1">센터링 측정</h2>
      <p className="text-xs text-neutral-400 mb-4">
        카드를 <span className="font-semibold text-neutral-700">슬리브·케이스에서 꺼내</span>
        <span className="font-semibold text-neutral-700"> 한 장만</span> 어두운/단색 배경에 놓고(옆에 다른 카드 없이),
        <span className="font-semibold text-neutral-700"> 초점이 잡히는 거리</span>에서
        <span className="font-semibold text-neutral-700"> 기울지 않게 똑바로</span> 찍으세요 (틀에 꽉 채울 필요 없어요). 찍으면 <span className="text-[#2a78d6] font-semibold">파란 네모</span>(카드
        테두리)와 <span className="text-emerald-600 font-semibold">초록 네모</span>(일러스트 테두리)를 자동으로
        얹어요. 빗나가면 모서리를 잡아 직접 맞추면 돼요. 참고용이에요.
      </p>

      {!imgUrl ? (
        <button
          type="button"
          onClick={openCamera}
          className="w-full rounded-xl bg-black py-4 text-sm font-semibold text-white hover:opacity-90"
        >
          📷 카메라로 촬영
        </button>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={openCamera}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              📷 다시 촬영
            </button>
            <button
              type="button"
              onClick={redetect}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-[#2a78d6] hover:bg-neutral-50"
            >
              자동 인식 다시
            </button>
          </div>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(z - 0.5, 1, 4))}
              className="h-8 w-8 rounded-lg border border-neutral-300 text-lg font-bold leading-none text-neutral-700 hover:bg-neutral-50"
            >
              −
            </button>
            <span className="w-12 text-center text-xs font-semibold text-neutral-600">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(z + 0.5, 1, 4))}
              className="h-8 w-8 rounded-lg border border-neutral-300 text-lg font-bold leading-none text-neutral-700 hover:bg-neutral-50"
            >
              +
            </button>
            <span className="text-[11px] text-neutral-400">확대해서 선을 정밀하게 맞출 수 있어요</span>
          </div>
          <div className="max-h-[70vh] overflow-auto rounded-xl bg-neutral-100">
            <div ref={wrapRef} className="relative select-none" style={{ width: `${zoom * 100}%` }}>
              <img ref={imgRef} src={imgUrl} alt="측정할 카드" className="block w-full" draggable={false} onLoad={onImgLoad} />
              <div
                className="pointer-events-none absolute border-2 border-[#2a78d6]"
                style={{ left: `${outer.l * 100}%`, top: `${outer.t * 100}%`, width: `${(outer.r - outer.l) * 100}%`, height: `${(outer.b - outer.t) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute border-2 border-emerald-500"
                style={{ left: `${inner.l * 100}%`, top: `${inner.t * 100}%`, width: `${(inner.r - inner.l) * 100}%`, height: `${(inner.b - inner.t) * 100}%` }}
              />
              {handles('outer', outer, '#2a78d6')}
              {handles('inner', inner, '#10b981')}
            </div>
          </div>

          {!autoOk && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-700">
              ⚠️ 자동 인식을 못 했어요. 카드 한 장만 어두운 배경에 놓고 다시 찍거나, 네모 모서리를 직접 맞춰 주세요. (아래 숫자는 아직 참고 안 돼요)
            </div>
          )}
          <div className="mt-4 rounded-xl border border-neutral-200 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-neutral-500">좌우</p>
                <p className="text-2xl font-bold text-black">{lr ? `${lr[0]} : ${lr[1]}` : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">상하</p>
                <p className="text-2xl font-bold text-black">{tb ? `${tb[0]} : ${tb[1]}` : '-'}</p>
              </div>
            </div>
            <p className={`mt-3 text-sm font-semibold ${v.color}`}>{v.label}</p>
            <p className="mt-2 text-xs font-semibold text-neutral-700">센터링 참고(이 면 기준): {psaCentering(worst)}</p>
            <p className="mt-1 text-[11px] text-neutral-400">
              50 : 50에 가까울수록 중앙에 잘 맞은 카드예요. 가장 치우친 쪽을 기준으로 판단했어요. 센터링만 본 값이라
              실제 감정 등급은 모서리·표면·스크래치도 함께 봅니다. 참고용이에요.
            </p>
          </div>
        </>
      )}

      {/* 가이드 틀이 있는 자체 카메라. 틀은 "이 안에 카드가 들어오게" 정도의 안내이고,
          꽉 채우지 않아도 된다(전체 프레임을 찍어 자동 검출이 카드를 찾는다). */}
      {cameraOn && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
          <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm font-semibold text-white/90">
            카드 <span className="text-white">한 장만</span>, <span className="text-white">흐리지 않게(초점)</span>, <span className="text-white">기울지 않게</span> 틀 안에 찍으세요
          </p>
          {/* 수평계: 폰을 데스크와 평행(수평)하게 들면 점이 가운데로 모이고 초록으로 바뀐다.
              센서 값이 없으면(권한 거부·미지원) 안 뜬다. */}
          {tilt && (
            <div className="pointer-events-none absolute inset-x-0 top-16 flex flex-col items-center">
              {(() => {
                const lv = Math.abs(tilt.beta) < 6 && Math.abs(tilt.gamma) < 6;
                const dx = clamp(tilt.gamma * 1.6, -26, 26);
                const dy = clamp(tilt.beta * 1.6, -26, 26);
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
