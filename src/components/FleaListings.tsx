import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answerOffer,
  closeListing,
  createListing,
  EDITION_LABEL,
  fetchListings,
  fetchOffers,
  isSlab,
  photoGuide,
  RAW_GRADE_HINT,
  RAW_GRADES,
  requiredPhotos,
  sendOffer,
  SLAB_GRADES,
  type Edition,
  type FleaListing,
  type FleaOffer,
} from '../api/flea';
import { uploadPostImage } from '../api/community';
import { CardPicker, type PickedCard } from './CardPicker';
import { CARD_BACK, cardImg, thumb } from '../lib/cardCatalog';

// 플리마켓 매물 화면. 아직 운영자만 볼 수 있다(운영 ▾ 안).
//
// 핵심은 "제안 → 수락"이다. 흥정을 쪽지가 아니라 버튼으로 하게 만들어야 합의 금액이
// 시스템에 남고, 그래야 나중에 우리 시세로 쓸 수 있다. 쪽지 안에 숨으면 못 쓴다.

const won = (n: number) => `${n.toLocaleString()}원`;

function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}

function GradeBadge({ grade }: { grade: string }) {
  const slab = isSlab(grade);
  return (
    <span
      className={`inline-block flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
        slab ? 'bg-amber-100 text-amber-800' : 'bg-neutral-900 text-white'
      }`}
    >
      {grade}
    </span>
  );
}

// ── 매물 올리기 ──────────────────────────────────────────────────────────────

function NewListingForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  // 카드는 반드시 카탈로그에서 고른다. 자유 입력이면 같은 카드가 여러 갈래로
  // 흩어져 시세가 안 모인다.
  const [card, setCard] = useState<PickedCard | null>(null);
  const [picking, setPicking] = useState(true);
  // 판본은 고른 카드에서 자동으로 정해진다(한글판만 손으로 바꾼다 — 카탈로그에 없어서).
  const [edition, setEdition] = useState<Edition>('jp');
  const [grade, setGrade] = useState('A');
  const [certNo, setCertNo] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const need = requiredPhotos(grade);
  const slab = isSlab(grade);

  async function pickFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    try {
      for (const f of Array.from(files).slice(0, 6 - images.length)) {
        const url = await uploadPostImage(f);
        setImages((prev) => [...prev, url]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 올리지 못했습니다.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (!card) return;
      await createListing({
        cardSlug: card.slug,
        cardNo: card.n,
        cardImg: card.img,
        cardName: card.name,
        setName: card.setName,
        edition,
        grade,
        certNo: certNo.trim(),
        price: Number(price.replace(/[^0-9]/g, '')),
        images,
        note: note.trim(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '올리지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  // 카드부터 고르게 한다. 이게 정해져야 나머지(등급·사진)가 의미가 있다.
  if (picking) {
    return (
      <div className="rounded-xl border border-neutral-200 p-4">
        <CardPicker
          onCancel={() => (card ? setPicking(false) : onCancel())}
          onPick={(c) => {
            setCard(c);
            // 카탈로그의 판(ja/en)을 매물 판본으로 그대로 옮긴다.
            setEdition(c.ed === 'ja' ? 'jp' : 'na');
            setPicking(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold text-black">매물 올리기</p>
        <button type="button" onClick={onCancel} className="text-xs text-neutral-500 hover:text-black">
          닫기
        </button>
      </div>

      <div className="space-y-3">
        {/* 고른 카드. 카탈로그 이미지는 "이 카드가 맞다"는 표시일 뿐이고,
            실제 파는 물건은 아래에서 올리는 실물 사진이다. */}
        {card && (
          <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            {card.img ? (
              <img
                src={thumb(cardImg(card.img), 120)}
                alt=""
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = CARD_BACK;
                }}
                className="h-16 w-12 flex-shrink-0 rounded object-cover"
              />
            ) : (
              <img src={CARD_BACK} alt="" className="h-16 w-12 flex-shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-black">{card.name}</p>
              <p className="truncate text-xs text-neutral-500">{card.setName}</p>
              <p className="text-xs text-neutral-400">No.{card.n}</p>
            </div>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex-shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700"
            >
              바꾸기
            </button>
          </div>
        )}

        <div>
          {/* 판본이 다르면 시세가 완전히 달라서 반드시 받는다. 카탈로그에서 고르면
              일본판·북미판은 자동으로 맞춰지고, 한글판만 손으로 고른다. */}
          <label className="mb-1 block text-xs font-semibold text-neutral-600">판본</label>
          <div className="flex gap-2">
            {(Object.keys(EDITION_LABEL) as Edition[]).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEdition(e)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  edition === e ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'
                }`}
              >
                {EDITION_LABEL[e]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600">등급</label>
          <div className="mb-2 flex gap-2">
            {RAW_GRADES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrade(g)}
                className={`flex-1 rounded-lg py-2 text-sm font-bold ${
                  grade === g ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-700'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          {/* 고른 등급이 어떤 뜻인지 바로 보여준다 — 후하게 매기는 걸 줄이는 장치다. */}
          {grade in RAW_GRADE_HINT && (
            <p className="mb-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-600">
              {RAW_GRADE_HINT[grade as keyof typeof RAW_GRADE_HINT]}
            </p>
          )}
          <select
            value={slab ? grade : ''}
            onChange={(e) => e.target.value && setGrade(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">감정 카드면 여기서 고르세요</option>
            {SLAB_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        {slab && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600">인증번호</label>
            <input
              value={certNo}
              onChange={(e) => setCertNo(e.target.value)}
              placeholder="라벨에 적힌 번호"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-neutral-500">
              나중에 감정사 공식 조회로 대조해 가짜를 걸러내려고 받습니다.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600">가격</label>
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="38000"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <span className="flex-shrink-0 text-sm text-neutral-500">원</span>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600">
            사진 {images.length}/{need}장
          </label>
          <p className="mb-2 text-xs text-neutral-500">
            {photoGuide(grade)} · 슬리브를 벗기고 카드가 화면의 70% 이상 차게 찍어 주세요.
          </p>
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {images.map((u) => (
                <div key={u} className="relative">
                  <img src={u} alt="" className="h-20 w-20 rounded-lg border border-neutral-200 object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((p) => p.filter((x) => x !== u))}
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-neutral-900 text-xs text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* 기본 파일 입력은 브라우저마다 생김새가 제각각이라(빈 네모로 보이기도 한다)
              숨기고, 사이트 톤에 맞는 버튼으로 대신 연다. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => pickFiles(e.target.files)}
            className="hidden"
          />
          <button
            type="button"
            disabled={uploading || images.length >= 6}
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border border-dashed border-neutral-300 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
          >
            {uploading ? '올리는 중…' : images.length >= 6 ? '사진은 6장까지' : '사진 고르기'}
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600">한마디 (선택)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="보관 상태, 거래 방식 등"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <button
          type="button"
          disabled={busy || uploading || !card}
          onClick={submit}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? '올리는 중…' : '올리기'}
        </button>
      </div>
    </div>
  );
}

// ── 매물 상세 ────────────────────────────────────────────────────────────────

function ListingDetail({
  listing,
  onBack,
  onChanged,
}: {
  listing: FleaListing;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [offers, setOffers] = useState<FleaOffer[]>([]);
  const [offerPrice, setOfferPrice] = useState(String(listing.price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchOffers(listing.id)
      .then(setOffers)
      .catch(() => undefined);
  }, [listing.id]);

  useEffect(load, [load]);

  const mine = listing.mine;
  const pending = offers.filter((o) => o.status === 'pending');
  const accepted = offers.find((o) => o.status === 'accepted');

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-semibold text-neutral-500 hover:text-black">
        ← 매물 목록
      </button>

      {/* 실제 파는 물건은 판매자가 찍은 실물 사진이다. 공식 카드 그림(카탈로그)은
          "이 카드가 맞다"는 표시일 뿐이라 아래에 작게 둔다. */}
      {listing.images.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-600">판매자 실물 사진</p>
          <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
            {listing.images.map((u) => (
              <img
                key={u}
                src={u}
                alt=""
                className="h-56 w-40 flex-shrink-0 snap-start rounded-xl border border-neutral-200 object-cover"
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <img
          src={listing.cardImg ? thumb(cardImg(listing.cardImg), 120) : CARD_BACK}
          alt=""
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = CARD_BACK;
            }}
          className="h-16 w-12 flex-shrink-0 rounded object-cover"
        />
        <div className="min-w-0">
          <p className="text-[11px] text-neutral-400">카탈로그</p>
          <p className="truncate text-sm font-semibold text-black">{listing.cardName}</p>
          <p className="truncate text-xs text-neutral-500">
            {listing.setName} · No.{listing.cardNo}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <GradeBadge grade={listing.grade} />
          <span className="text-xs text-neutral-500">{EDITION_LABEL[listing.edition]}</span>
          {listing.status === 'sold' && (
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-bold text-neutral-700">거래완료</span>
          )}
        </div>
        <h3 className="mt-1 text-lg font-bold text-black">{listing.cardName}</h3>
        {listing.setName && <p className="text-xs text-neutral-500">{listing.setName}</p>}
        <p className="mt-1 text-xl font-bold text-black">{won(listing.price)}</p>
        {listing.certNo && <p className="mt-1 text-xs text-neutral-500">인증번호 {listing.certNo}</p>}
        <p className="mt-1 text-xs text-neutral-400">
          {listing.seller} · {relTime(listing.createdAt)}
        </p>
        {listing.note && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">{listing.note}</p>
        )}
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {accepted ? (
        <div className="rounded-xl border border-neutral-900 bg-neutral-900 p-4 text-white">
          <p className="text-xs text-neutral-300">거래 성사</p>
          <p className="mt-0.5 text-lg font-bold">{won(accepted.price)}</p>
          <p className="mt-1 text-xs text-neutral-400">이 금액이 시세 자료로 남습니다.</p>
        </div>
      ) : listing.status === 'open' ? (
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-sm font-bold text-black">이 값에 사겠다고 제안</p>
          <p className="mt-0.5 mb-2 text-xs leading-relaxed text-neutral-500">
            흥정을 쪽지가 아니라 버튼으로 합니다. 그래야 합의 금액이 남아 시세로 쓸 수 있습니다.
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              value={offerPrice}
              onChange={(e) => setOfferPrice(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy || !offerPrice}
              onClick={() => act(() => sendOffer(listing.id, Number(offerPrice)))}
              className="flex-shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              제안
            </button>
          </div>
        </div>
      ) : null}

      <div>
        {/* 답할 게 남았으면 건수를, 다 처리했으면 그냥 "제안 내역"으로 둔다.
            거래가 끝난 매물에 "들어온 제안 0건"이 뜨면 아래 목록과 어긋나 보인다. */}
        <p className="mb-2 text-sm font-bold text-black">
          {pending.length > 0 ? `들어온 제안 ${pending.length}건` : '제안 내역'}
        </p>
        {offers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-200 py-8 text-center text-sm text-neutral-400">
            아직 제안이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {offers.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-black">{won(o.price)}</p>
                  <p className="text-xs text-neutral-400">
                    {o.buyer} · {relTime(o.createdAt)}
                  </p>
                </div>
                {o.status === 'pending' && o.canAnswer ? (
                  <div className="flex flex-shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => answerOffer(o.id, true))}
                      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      수락
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => answerOffer(o.id, false))}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 disabled:opacity-40"
                    >
                      거절
                    </button>
                  </div>
                ) : (
                  <span className="flex-shrink-0 text-xs text-neutral-400">
                    {o.status === 'accepted' ? '수락됨' : o.status === 'rejected' ? '거절됨' : '기다리는 중'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {mine && listing.status === 'open' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('이 매물을 내릴까요?')) act(async () => { await closeListing(listing.id); onBack(); });
          }}
          className="text-xs font-semibold text-neutral-400 hover:text-rose-500"
        >
          매물 내리기
        </button>
      )}
    </div>
  );
}

// ── 목록 ─────────────────────────────────────────────────────────────────────

export function FleaListings() {
  const [rows, setRows] = useState<FleaListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetchListings()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const open = rows.find((r) => r.id === openId);
  if (open) {
    return <ListingDetail listing={open} onBack={() => setOpenId(null)} onChanged={load} />;
  }

  if (writing) {
    return (
      <NewListingForm
        onCancel={() => setWriting(false)}
        onDone={() => {
          setWriting(false);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setWriting(true)}
        className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
      >
        + 매물 올리기
      </button>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      {loading ? (
        <p className="py-12 text-center text-sm text-neutral-400">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-200 py-12 text-center text-sm text-neutral-400">
          올라온 매물이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpenId(r.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left hover:bg-neutral-50"
              >
                {/* 목록에서는 어떤 카드인지가 먼저다 — 카탈로그 그림을 쓴다.
                    판매자 실물 사진은 눌러 들어가면 크게 보인다. */}
                <img
                  src={r.cardImg ? thumb(cardImg(r.cardImg), 120) : CARD_BACK}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = CARD_BACK;
                  }}
                  className="h-16 w-12 flex-shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <GradeBadge grade={r.grade} />
                    <span className="truncate text-xs text-neutral-500">{EDITION_LABEL[r.edition]}</span>
                    {r.status === 'sold' && (
                      <span className="flex-shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-bold text-neutral-700">
                        거래완료
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm font-semibold text-black">{r.cardName}</p>
                  {r.setName && <p className="truncate text-[11px] text-neutral-400">{r.setName}</p>}
                  <p className="text-sm font-bold text-black">{won(r.price)}</p>
                </div>
                {!!r.offers && (
                  <span className="flex-shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                    제안 {r.offers}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
