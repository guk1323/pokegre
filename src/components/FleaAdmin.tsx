import { useEffect, useState } from 'react';
import {
  fetchFleaStatus,
  saveFleaConfig,
  STAGE_LABEL,
  STAGE_NOTE,
  type FleaConfig,
  type FleaStatus,
} from '../api/flea';

// 운영자 전용 플리마켓 관리 화면.
//
// 아직 매물·쪽지 기능은 없다. 그런데도 이 화면을 먼저 만든 이유는 스위치 때문이다 —
// 기능을 만든 뒤에 스위치를 붙이면 문제가 터졌을 때 배포(약 7초 정지)를 해야 닫히는데,
// 스위치가 먼저 있으면 여기서 즉시 닫을 수 있다.
//
// 화면을 감춰봐야 보안은 아니다. 서버가 운영자가 아니면 설정 자체를 안 준다.

const STAGES: FleaConfig['stage'][] = [0, 1, 2, 3];

function formatDate(ts: number): string {
  if (!ts) return '아직 바꾼 적 없음';
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-black">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function FleaAdmin() {
  const [status, setStatus] = useState<FleaStatus | null>(null);
  const [draft, setDraft] = useState<FleaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchFleaStatus()
      .then((s) => {
        setStatus(s);
        setDraft(s.config);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  // 저장 전 상태와 다른 게 있는지. 없으면 저장 버튼을 잠가 둔다.
  const dirty = !!(draft && status && JSON.stringify(draft) !== JSON.stringify(status.config));

  function patch(next: Partial<FleaConfig>) {
    setDraft((d) => (d ? { ...d, ...next } : d));
    setSaved(false);
    setError('');
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const next = await saveFleaConfig(draft);
      setStatus((s) => (s ? { ...s, config: next } : s));
      setDraft(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-12 text-center text-sm text-neutral-400">불러오는 중...</p>;
  if (!draft || !status) return <p className="py-12 text-center text-sm text-rose-500">{error || '불러오지 못했습니다.'}</p>;

  const live = draft.open && draft.stage > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-base font-bold text-black">플리마켓</h2>
        <p className="text-xs leading-relaxed text-neutral-500">
          회원끼리 실물 카드를 거래하고, 그 거래가로 우리 시세를 만드는 기능입니다. 아직 만드는
          중이라 매물·쪽지 화면은 없고 여기서 여는 단계만 정합니다.
        </p>
      </div>

      {/* 지금 상태를 맨 위에 크게. 열려 있는지부터 한눈에 보여야 한다. */}
      <div
        className={`rounded-xl border p-4 ${
          live ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-neutral-50'
        }`}
      >
        <p className={`text-xs font-semibold ${live ? 'text-neutral-300' : 'text-neutral-400'}`}>지금 상태</p>
        <p className={`mt-0.5 text-lg font-bold ${live ? 'text-white' : 'text-black'}`}>
          {live ? `열림 · ${STAGE_LABEL[draft.stage]}` : '닫힘'}
        </p>
        <p className={`mt-1 text-xs ${live ? 'text-neutral-400' : 'text-neutral-500'}`}>
          마지막 변경 {formatDate(status.config.updatedAt)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-400">올라온 매물</p>
          <p className="mt-0.5 text-xl font-bold text-black">{status.counts.listings.toLocaleString()}건</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-400">성사된 거래</p>
          <p className="mt-0.5 text-xl font-bold text-black">{status.counts.deals.toLocaleString()}건</p>
        </div>
      </div>

      {/* 여는 단계 */}
      <div className="rounded-xl border border-neutral-200 p-4">
        <p className="text-sm font-bold text-black">여는 단계</p>
        <p className="mt-0.5 mb-3 text-xs leading-relaxed text-neutral-500">
          한 번에 다 열지 않습니다. 앞 단계에서 데이터가 얼마나 지저분한지 보고 다음으로 넘어갑니다.
        </p>
        <div className="space-y-2">
          {STAGES.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                draft.stage === s ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'
              }`}
            >
              <input
                type="radio"
                name="flea-stage"
                checked={draft.stage === s}
                onChange={() => patch({ stage: s })}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-black">
                  {s}단계 · {STAGE_LABEL[s]}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">{STAGE_NOTE[s]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* 스위치·시세 규칙 */}
      <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 px-4">
        <Row
          label="지금 열어 두기"
          hint="단계와 따로 도는 즉시 차단 스위치입니다. 끄면 단계가 몇이든 닫힙니다. 문제가 생겼을 때 배포 없이 바로 막는 용도입니다."
        >
          <button
            type="button"
            onClick={() => patch({ open: !draft.open })}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
              draft.open ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'
            }`}
          >
            {draft.open ? '열림' : '닫힘'}
          </button>
        </Row>

        <Row
          label="시세로 쓸 최소 건수"
          hint="같은 카드·같은 등급으로 이만큼 모여야 시세를 보여줍니다. 미만이면 '표본 부족'으로 둡니다."
        >
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={100}
              value={draft.minSamples}
              onChange={(e) => patch({ minSamples: Number(e.target.value) })}
              className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-right text-sm"
            />
            <span className="text-xs text-neutral-500">건</span>
          </div>
        </Row>

        <Row
          label="이상값 걸러내기"
          hint="스니커덩크·이베이 시세 대비 이 범위를 벗어난 거래는 시세 집계에서 뺍니다. 시세 조작을 막는 장치입니다."
        >
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={100}
              step={5}
              value={Math.round(draft.outlierLow * 100)}
              onChange={(e) => patch({ outlierLow: Number(e.target.value) / 100 })}
              className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-right text-sm"
            />
            <span className="text-xs text-neutral-500">~</span>
            <input
              type="number"
              min={100}
              max={1000}
              step={10}
              value={Math.round(draft.outlierHigh * 100)}
              onChange={(e) => patch({ outlierHigh: Number(e.target.value) / 100 })}
              className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-right text-sm"
            />
            <span className="text-xs text-neutral-500">%</span>
          </div>
        </Row>

        <Row
          label="중개 고지문 붙임"
          hint="전자상거래법 제20조 제1항. '저희는 거래 당사자가 아닙니다'를 회원이 쉽게 알 수 있게 붙여야 합니다. 안 붙이면 판매자 잘못으로 생긴 손해를 함께 물어야 합니다(제20조의2). 이걸 켜지 않으면 3단계로 못 갑니다."
        >
          <button
            type="button"
            onClick={() => patch({ noticeShown: !draft.noticeShown })}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
              draft.noticeShown ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'
            }`}
          >
            {draft.noticeShown ? '붙임' : '아직'}
          </button>
        </Row>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        {dirty && !saving && <span className="text-xs text-neutral-500">바뀐 내용이 있습니다.</span>}
        {saved && !dirty && <span className="text-xs text-neutral-500">저장했습니다.</span>}
      </div>

      {/* 만들 것 목록. 문서를 따로 열지 않아도 여기서 남은 일이 보이게 둔다. */}
      <div className="rounded-xl border border-dashed border-neutral-300 p-4">
        <p className="text-sm font-bold text-black">아직 만들지 않은 것</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-neutral-600">
          <li>· 매물 등록·목록 (카드 상세 화면에 "판매중 N건"으로 붙임)</li>
          <li>· 1:1 쪽지</li>
          <li>· 제안 → 수락 → 완료 흐름 (거래가가 여기서 남는다)</li>
          <li>· 후기·거래 신뢰도 (이게 없으면 아무도 완료를 안 누른다)</li>
          <li>· 자전거래 검사 (같은 사람끼리 반복·신규 계정·같은 기기)</li>
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          등급 기준(생카 A·B·C·D, 감정 카드, 필수 사진)은 <code>docs/플리마켓-등급기준.md</code>에
          정리해 두었습니다.
        </p>
      </div>
    </div>
  );
}
