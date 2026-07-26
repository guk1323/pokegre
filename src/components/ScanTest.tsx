import { useEffect, useRef, useState } from 'react';
import { scanCard, type CardScanResult } from '../api/cardScan';
import { trackEvent } from '../api/localStats';
import { koreanizeTitle } from '../lib/koreanizeTitle';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';

// 운영자 전용 실험실. 사진 → 스캔(AI가 읽은 원본값) → 번호+세트로 우리 데이터에서 "딱 그 카드"를
// 찾아 보여준다. 공개 사진검색(이름 목록)은 그대로 두고, 여기서 정확도만 검증한다.
// 매칭이 성공/실패한 이유를 그대로 노출해, 어디서 막히는지(세트 코드 형식 등) 파악한다.

type SetIndexEntry = { slug: string; ed: 'ja' | 'en'; id?: string; name: string; serie?: string };
type SetCard = { n: string; name: string; img?: string };

const thumb = (url: string, w: number) => (url ? `/api/img?u=${encodeURIComponent(url)}&w=${w}` : '');

type MatchResult =
  | { ok: true; set: SetIndexEntry; card: SetCard }
  | { ok: false; reason: string };

async function matchExactCard(index: SetIndexEntry[], r: CardScanResult): Promise<MatchResult> {
  const numTarget = r.cardNumber ? parseInt(r.cardNumber, 10) : NaN;
  if (!Number.isFinite(numTarget)) return { ok: false, reason: '카드 번호(예: 015/100)를 읽지 못했습니다.' };
  const code = (r.setCode ?? '').trim().toLowerCase();
  if (!code) return { ok: false, reason: '세트 코드를 읽지 못했습니다.' };
  const ed = r.edition === 'english' ? 'en' : 'ja';
  // 같은 판(일본판/북미판)에서 세트 id가 코드와 일치하는 세트를 찾는다.
  const cand = index.filter((s) => s.ed === ed && (s.id ?? '').toLowerCase() === code);
  if (cand.length === 0) {
    return { ok: false, reason: `세트 '${r.setCode}'(${ed === 'en' ? '북미판' : '일본판'})를 우리 목록에서 찾지 못했습니다.` };
  }
  const set = cand[0];
  let data: { cards?: SetCard[] };
  try {
    data = await fetch(`/sets/${set.slug}.json`).then((res) => res.json());
  } catch {
    return { ok: false, reason: `세트 데이터(${set.slug})를 불러오지 못했습니다.` };
  }
  const card = (data.cards ?? []).find((c) => parseInt(c.n, 10) === numTarget);
  if (!card) return { ok: false, reason: `세트 '${set.name}'에 ${numTarget}번 카드가 없습니다.` };
  return { ok: true, set, card };
}

export function ScanTest() {
  const [index, setIndex] = useState<SetIndexEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState<CardScanResult | null>(null);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/sets/index.json')
      .then((r) => r.json())
      .then((d: SetIndexEntry[]) => setIndex(d))
      .catch(() => setErr('세트 목록을 불러오지 못했습니다.'));
  }, []);

  async function onPick(file: File) {
    // 실험실도 몇 번 썼는지는 남긴다(운영자 사용은 서버가 제외).
    trackEvent('scantest');
    setBusy(true);
    setErr('');
    setRaw(null);
    setMatch(null);
    setPreview(URL.createObjectURL(file));
    try {
      const result = await scanCard(file);
      setRaw(result);
      if (index) setMatch(await matchExactCard(index, result));
    } catch {
      setErr('스캔에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const koName = (ed: 'ja' | 'en', name: string) =>
    ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name);
  const koSet = (ed: 'ja' | 'en', name: string) => (ed === 'ja' ? koreanizeTitle(name) : name);

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-base font-bold text-black">
        스캔 테스트 <span className="align-middle text-[11px] font-semibold text-amber-600">운영자</span>
      </h2>
      <p className="mt-1 text-xs text-neutral-400">
        사진을 넣으면 AI가 읽은 값과, 번호+세트로 찾은 "딱 이 카드"를 보여줍니다. 공개 사진검색과 별개인 실험용입니다.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy || !index}
        className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-bold text-white disabled:opacity-40"
      >
        {busy ? '읽는 중…' : '카드 사진 찍기 / 올리기'}
      </button>

      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}

      {(preview || raw) && (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* 왼쪽: 넣은 사진 + AI 원본값 */}
          <div className="rounded-xl border border-neutral-200 p-3">
            <p className="mb-2 text-xs font-bold text-neutral-500">AI가 읽은 값</p>
            {preview && (
              <img src={preview} alt="스캔한 사진" className="mb-3 aspect-[5/7] w-full rounded-lg object-contain bg-neutral-100" />
            )}
            {raw ? (
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">이름</dt>
                  <dd className="font-semibold text-neutral-800">{raw.pokemonNameEn ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">번호</dt>
                  <dd className="font-semibold text-neutral-800">{raw.cardNumber ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">세트 코드</dt>
                  <dd className="font-semibold text-neutral-800">{raw.setCode ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-neutral-400">판</dt>
                  <dd className="font-semibold text-neutral-800">{raw.edition === 'english' ? '북미판' : '일본판/한글판'}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-neutral-400">아직 없음</p>
            )}
          </div>

          {/* 오른쪽: 매칭 결과 */}
          <div className="rounded-xl border border-neutral-200 p-3">
            <p className="mb-2 text-xs font-bold text-neutral-500">매칭 결과 (딱 이 카드)</p>
            {!match ? (
              <p className="text-xs text-neutral-400">아직 없음</p>
            ) : match.ok ? (
              <div>
                <div className="aspect-[5/7] w-full overflow-hidden rounded-lg bg-neutral-100">
                  {match.card.img && (
                    <img src={thumb(match.card.img, 400)} alt="" className="h-full w-full object-contain" />
                  )}
                </div>
                <p className="mt-2 text-sm font-bold text-black">{koName(match.set.ed, match.card.name)}</p>
                <p className="text-xs text-neutral-500">
                  {koSet(match.set.ed, match.set.name)} · {match.card.n}
                </p>
                <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  ✓ 특정 성공
                </span>
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-700">매칭 실패</p>
                <p className="mt-1 text-xs text-amber-600">{match.reason}</p>
                <p className="mt-2 text-[11px] text-neutral-400">
                  → 공개 사진검색은 이런 경우 이름 목록으로 보여줍니다(폴백).
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
