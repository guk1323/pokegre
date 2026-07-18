import { useEffect, useRef, useState } from 'react';

// 반자동 센터링 측정. 사진을 자동으로 인식하지 않고(빛 반사·원근·보더리스 카드 때문에
// 자동은 잘 틀린다), 사용자가 카드 바깥 테두리와 안쪽 테두리(그림 프레임)에 네모 두 개를
// 맞추면 여백 비율을 계산한다. 계산만 하므로 유지보수할 데이터가 없다.

type Rect = { l: number; t: number; r: number; b: number }; // 이미지 대비 0~1 비율
type Corner = 'tl' | 'tr' | 'bl' | 'br';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 두 여백(a,b)의 비율을 [큰쪽, 작은쪽]이 아니라 [앞, 뒤] 순서 그대로 정수 %로.
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

// PSA가 공개한 앞면 센터링 허용치(대략). 가장 치우친 쪽 %를 넣으면 센터링만으로 도달
// 가능한 최고 등급을 알려준다. 실제 등급은 모서리·표면 등도 함께 보므로 참고용이다.
function psaCentering(worst: number): string {
  if (worst <= 55) return 'PSA 10 센터링 기준(55/45)까지 충족';
  if (worst <= 60) return 'PSA 9 센터링 기준(60/40)까지 충족';
  if (worst <= 65) return 'PSA 8 센터링 기준(65/35)까지 충족';
  if (worst <= 70) return 'PSA 7 센터링 기준(70/30)까지 충족';
  if (worst <= 80) return 'PSA 6 센터링 기준(80/20)까지 충족';
  return 'PSA 6 센터링 기준(80/20)에도 못 미침';
}

// 사진에서 카드의 바깥 테두리를 대략 찾는다. 네 모서리(=대개 배경)의 평균색을 배경으로
// 보고, 배경과 충분히 다른 픽셀이 많은 열/행의 범위를 카드로 잡는다. 완벽하지 않지만
// 시작 네모 위치를 잡아주는 용도다(사용자가 이어서 미세 조정). 실패하면 null.
function detectCardRect(img: HTMLImageElement): Rect | null {
  const W = 160;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  let px: Uint8ClampedArray;
  try {
    px = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return null;
  }
  const patch = (x0: number, y0: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y0 + 5; y++)
      for (let x = x0; x < x0 + 5; x++) {
        const i = (y * W + x) * 4;
        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      }
    return [r / n, g / n, b / n];
  };
  const cs = [patch(0, 0), patch(W - 5, 0), patch(0, H - 5), patch(W - 5, H - 5)];
  const bg = [0, 1, 2].map((k) => (cs[0][k] + cs[1][k] + cs[2][k] + cs[3][k]) / 4);
  const TH = 48; // 배경과의 색 거리(맨해튼) 임계
  const col = new Array(W).fill(0);
  const row = new Array(H).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
      if (d > TH) {
        col[x]++;
        row[y]++;
      }
    }
  const colTh = H * 0.25;
  const rowTh = W * 0.25;
  let l = 0;
  while (l < W && col[l] < colTh) l++;
  let r = W - 1;
  while (r > l && col[r] < colTh) r--;
  let t = 0;
  while (t < H && row[t] < rowTh) t++;
  let b = H - 1;
  while (b > t && row[b] < rowTh) b--;
  if (r - l < W * 0.2 || b - t < H * 0.2) return null; // 검출 영역이 너무 작으면 실패
  return { l: l / W, t: t / H, r: (r + 1) / W, b: (b + 1) / H };
}

export function CenteringTool() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [outer, setOuter] = useState<Rect>({ l: 0.06, t: 0.06, r: 0.94, b: 0.94 });
  const [inner, setInner] = useState<Rect>({ l: 0.2, t: 0.2, r: 0.8, b: 0.8 });
  const [zoom, setZoom] = useState(1);
  const [cameraOn, setCameraOn] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ rect: 'outer' | 'inner'; corner: Corner } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 자동 인식은 버튼을 눌렀을 때만 시도한다(로드하자마자 자동으로 얹으면, 슬리브·케이스
  // 테두리를 자신 있게 잡아 오히려 헷갈린다). 실패하거나 빗나가면 수동 드래그가 정답.
  function redetect() {
    const img = imgRef.current;
    if (!img) return;
    const rect = detectCardRect(img);
    if (!rect) {
      window.alert('카드를 자동으로 찾지 못했어요. 슬리브·케이스에서 뺀 카드를 단색 배경에 놓고 찍으면 잘 돼요. 안 되면 네모를 직접 맞춰 주세요.');
      return;
    }
    applyDetected(rect);
  }

  function loadFromBlob(blob: Blob) {
    setImgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setOuter({ l: 0.06, t: 0.06, r: 0.94, b: 0.94 });
    setInner({ l: 0.14, t: 0.12, r: 0.86, b: 0.88 });
    setZoom(1);
  }

  // 검출된 카드(바깥)에서 안쪽 네모는 얇은 테두리에 가깝게(약 5%) 시작점만 준다. 카드마다
  // 테두리 두께가 달라 이건 어디까지나 출발점이고, 실제 안쪽 테두리 선은 사용자가 맞춘다.
  function applyDetected(rect: Rect) {
    setOuter(rect);
    const iw = rect.r - rect.l;
    const ih = rect.b - rect.t;
    setInner({ l: rect.l + iw * 0.05, t: rect.t + ih * 0.05, r: rect.r - iw * 0.05, b: rect.b - ih * 0.05 });
  }

  async function openCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
    } catch {
      window.alert('카메라를 열 수 없어요. 권한을 허용했는지 확인하거나, 앨범에서 사진을 골라 주세요.');
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // 화면의 가이드 틀 영역만 잘라 캡처한다. video는 object-contain이라 컨테이너 안에서
    // 레터박스로 표시되므로, 가이드(컨테이너 좌표)를 실제 영상 픽셀 좌표로 변환한다.
    const VW = v.videoWidth;
    const VH = v.videoHeight;
    const CW = v.clientWidth;
    const CH = v.clientHeight;
    const scale = Math.min(CW / VW, CH / VH);
    const offX = (CW - VW * scale) / 2;
    const offY = (CH - VH * scale) / 2;
    const gH = 0.68 * CH;
    const gW = gH * (2.5 / 3.5);
    const gX = (CW - gW) / 2;
    const gY = (CH - gH) / 2;
    const cl = (val: number, hi: number) => Math.max(0, Math.min(hi, val));
    const sx = cl((gX - offX) / scale, VW);
    const sy = cl((gY - offY) / scale, VH);
    const sw = cl(gW / scale, VW - sx);
    const sh = cl(gH / scale, VH - sy);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    canvas.getContext('2d')?.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) loadFromBlob(blob);
        closeCamera();
      },
      'image/jpeg',
      0.92,
    );
  }

  // 카메라 모달이 뜬 뒤 video에 스트림을 연결한다(요소가 렌더된 다음이라야 함).
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => undefined);
    }
  }, [cameraOn]);

  // 언마운트 시 카메라를 확실히 끈다(트랙이 켜진 채 남으면 안 된다).
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
          // 포인터 캡처가 있으면 핸들 밖으로 나가도 계속 드래그된다. 실패해도 드래그는 동작.
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
        카드를 <span className="font-semibold text-neutral-700">슬리브·케이스에서 꺼내</span> 흰 틀에 맞춰
        정면·수평으로 찍으세요. <span className="text-[#2a78d6] font-semibold">파란 네모</span>는 카드 바깥
        테두리에, <span className="text-emerald-600 font-semibold">초록 네모</span>는 안쪽 그림 테두리에 맞추면 여백
        비율이 나와요. 참고용이에요. (테두리 없는 풀아트 카드는 측정이 어려워요.)
      </p>

      {!imgUrl ? (
        <button
          type="button"
          onClick={openCamera}
          className="w-full rounded-xl bg-black py-4 text-sm font-semibold text-white hover:opacity-90"
        >
          📷 카메라로 촬영 (가이드 틀에 맞춰서)
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
              자동 인식 시도
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
            <span className="text-[11px] text-neutral-400">확대하면 작은 카드도 정밀하게 맞출 수 있어요</span>
          </div>
          {/* 확대 시 넘치는 부분은 스크롤(폰은 손가락)로 이동. 네모를 확대하지 않고 stage
              폭을 키워 이미지·네모가 함께 커지므로 좌표 비율 계산은 그대로 정확하다. */}
          <div className="max-h-[70vh] overflow-auto rounded-xl bg-neutral-100">
            <div ref={wrapRef} className="relative select-none" style={{ width: `${zoom * 100}%` }}>
              <img ref={imgRef} src={imgUrl} alt="측정할 카드" className="block w-full" draggable={false} />
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

      {/* 가이드 틀이 있는 자체 카메라. 네이티브 카메라엔 틀을 못 얹어서 직접 만든다.
          전체 프레임을 그대로 찍고(자르지 않음), 사용자는 흰 틀에 카드를 맞춰 정면으로
          찍으면 된다. 찍은 사진은 위 측정 도구로 그대로 넘어간다. */}
      {cameraOn && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
          <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm font-semibold text-white/90">
            카드를 흰 틀에 꽉 채워 <span className="text-white">정면·수평</span>으로 찍으세요
          </p>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" style={{ height: '68%', aspectRatio: '2.5 / 3.5' }} />
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
