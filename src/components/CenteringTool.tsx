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

// 바깥→안으로 스캔해 임계값을 넘는 첫 강한 봉우리(=바깥 테두리, 배경↔카드 경계) 인덱스.
function firstPeak(P: Float32Array, lo: number, hi: number, fromLo: boolean, T: number): number | null {
  if (fromLo) {
    for (let i = Math.max(1, lo); i < hi; i++) if (P[i] >= T && P[i] >= P[i - 1] && P[i] >= P[i + 1]) return i;
  } else {
    for (let i = Math.min(P.length - 2, hi - 1); i >= lo; i--) if (P[i] >= T && P[i] >= P[i - 1] && P[i] >= P[i + 1]) return i;
  }
  return null;
}

// 지정한 띠(a~b) 안에서 가장 강한 선의 인덱스. minVal 미만이면 null(뚜렷한 안쪽 테두리가
// 없다고 보고 인셋으로 대체). 안쪽 테두리를 바깥 테두리 근처 띠로 한정해 깊은 내부선을 피한다.
function strongestInBand(P: Float32Array, a: number, b: number, minVal: number): number | null {
  const lo = Math.max(1, Math.round(a));
  const hi = Math.min(P.length - 2, Math.round(b));
  if (lo >= hi) return null;
  let bi = -1;
  let bv = 0;
  for (let i = lo; i <= hi; i++) if (P[i] > bv) { bv = P[i]; bi = i; }
  return bi >= 0 && bv >= minVal ? bi : null;
}

// 카드 바깥 테두리와 안쪽 일러스트 테두리를 함께 검출한다. 세로 경계(좌·우 선)는 열마다
// 세로 방향 밝기 변화 합으로, 가로 경계(상·하 선)는 행마다 가로 방향 변화 합으로 프로파일을
// 만든 뒤, 양쪽 바깥에서 안으로 스캔한다. 실패하면 null(수동으로).
function detectCardEdges(img: HTMLImageElement): { outer: Rect; inner: Rect } | null {
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
  const colV = new Float32Array(W); // 세로 경계 강도(좌우 선)
  for (let x = 1; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) s += Math.abs(g[y * W + x] - g[y * W + x - 1]);
    colV[x] = s / H;
  }
  const rowH = new Float32Array(H); // 가로 경계 강도(상하 선)
  for (let y = 1; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += Math.abs(g[y * W + x] - g[(y - 1) * W + x]);
    rowH[y] = s / W;
  }
  const hw = Math.floor(W * 0.5);
  const hh = Math.floor(H * 0.5);
  const colMax = Math.max(...colV);
  const rowMax = Math.max(...rowH);
  const lo = firstPeak(colV, 0, hw, true, colMax * 0.35);
  const ro = firstPeak(colV, hw, W, false, colMax * 0.35);
  const to = firstPeak(rowH, 0, hh, true, rowMax * 0.35);
  const bo = firstPeak(rowH, hh, H, false, rowMax * 0.35);
  if (lo == null || ro == null || to == null || bo == null) return null;
  if (ro - lo < W * 0.3 || bo - to < H * 0.3) return null; // 카드가 너무 작으면 실패
  const outer: Rect = { l: lo / W, t: to / H, r: (ro + 1) / W, b: (bo + 1) / H };
  const owP = ro - lo;
  const ohP = bo - to;
  // 안쪽 테두리는 바깥에서 가까운 띠(약 1.5~16%) 안의 가장 강한 선으로. 이름줄·본문 같은
  // 깊은 내부선을 피하고 타이트하게 붙는다. 띠 안에 뚜렷한 선이 없으면 얇은 인셋(5%)으로.
  const li = strongestInBand(colV, lo + owP * 0.015, lo + owP * 0.16, colMax * 0.2);
  const ri = strongestInBand(colV, ro - owP * 0.16, ro - owP * 0.015, colMax * 0.2);
  const ti = strongestInBand(rowH, to + ohP * 0.015, to + ohP * 0.16, rowMax * 0.2);
  const bi = strongestInBand(rowH, bo - ohP * 0.16, bo - ohP * 0.015, rowMax * 0.2);
  const inner: Rect = {
    l: li != null ? li / W : outer.l + (outer.r - outer.l) * 0.05,
    t: ti != null ? ti / H : outer.t + (outer.b - outer.t) * 0.05,
    r: ri != null ? (ri + 1) / W : outer.r - (outer.r - outer.l) * 0.05,
    b: bi != null ? (bi + 1) / H : outer.b - (outer.b - outer.t) * 0.05,
  };
  // 안쪽이 뒤집히거나 바깥을 벗어나면 안전한 인셋으로 되돌린다.
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
    const res = detectCardEdges(e.currentTarget);
    if (res) applyDetected(res);
  }

  function redetect() {
    const img = imgRef.current;
    if (!img) return;
    const res = detectCardEdges(img);
    if (!res) {
      window.alert('카드를 자동으로 찾지 못했어요. 배경과 카드가 뚜렷하게 구분되게(단색 배경, 정면, 초점) 다시 찍어 보세요. 안 되면 네모를 직접 맞춰 주세요.');
      return;
    }
    applyDetected(res);
  }

  async function openCamera() {
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
        카드를 <span className="font-semibold text-neutral-700">슬리브·케이스에서 꺼내</span> 어두운/단색 배경에
        놓고, <span className="font-semibold text-neutral-700">초점이 잡히는 거리</span>에서 정면·수평으로 찍으세요
        (틀에 꽉 채울 필요 없어요). 찍으면 <span className="text-[#2a78d6] font-semibold">파란 네모</span>(카드
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
            카드가 <span className="text-white">흐리지 않게(초점)</span> 틀 안에 들어오게 찍으세요
          </p>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border-2 border-white/70" style={{ height: '60%', aspectRatio: '2.5 / 3.5' }} />
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
