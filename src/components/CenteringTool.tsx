import { useRef, useState } from 'react';

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

export function CenteringTool() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [outer, setOuter] = useState<Rect>({ l: 0.06, t: 0.06, r: 0.94, b: 0.94 });
  const [inner, setInner] = useState<Rect>({ l: 0.2, t: 0.2, r: 0.8, b: 0.8 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ rect: 'outer' | 'inner'; corner: Corner } | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setOuter({ l: 0.06, t: 0.06, r: 0.94, b: 0.94 });
    setInner({ l: 0.2, t: 0.2, r: 0.8, b: 0.8 });
  }

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
        카드 정면 사진을 올리고, <span className="text-[#2a78d6] font-semibold">파란 네모</span>는 카드 바깥
        테두리에, <span className="text-emerald-600 font-semibold">초록 네모</span>는 안쪽 그림 테두리에 맞추면 여백
        비율이 나와요. 참고용이며, 사진이 정면·수평일수록 정확해요. (테두리 없는 풀아트 카드는 측정이 어려워요.)
      </p>

      {!imgUrl ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-neutral-300 py-16 text-sm text-neutral-500 hover:bg-neutral-50"
        >
          카드 사진 올리기 (촬영 또는 앨범)
        </button>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              다른 사진
            </button>
          </div>
          <div ref={wrapRef} className="relative w-full select-none overflow-hidden rounded-xl bg-neutral-100">
            <img src={imgUrl} alt="측정할 카드" className="block w-full" draggable={false} />
            {/* 바깥(파랑)·안쪽(초록) 네모 */}
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
            <p className="mt-1 text-[11px] text-neutral-400">
              50 : 50에 가까울수록 중앙에 잘 맞은 카드예요. 가장 치우친 쪽을 기준으로 판단했어요. 감정 등급을 보장하는
              값은 아니고 참고용입니다.
            </p>
          </div>
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
    </div>
  );
}
