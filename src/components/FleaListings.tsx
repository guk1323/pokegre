import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answerOffer,
  closeListing,
  createListing,
  EDITION_LABEL,
  fetchCardsWithListings,
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
  type FleaCardRow,
  type FleaListing,
  type FleaOffer,
} from '../api/flea';
import { uploadPostImage } from '../api/community';
import {
  CARD_BACK,
  cardImg,
  koName,
  koSet,
  loadKoSets,
  loadSetCards,
  loadSetIndex,
  thumb,
  usable,
  type SetCard,
  type SetIndexEntry,
} from '../lib/cardCatalog';

// 고른 카드. 카탈로그(public/sets)의 세트 코드 + 카드 번호로 못 박는다 —
// 이름을 자유롭게 받으면 같은 카드가 여러 갈래로 흩어져 시세를 못 만든다.
export interface PickedCard {
  slug: string;
  ed: Edition;
  setName: string;
  n: string;
  name: string;
  // 카탈로그 이미지(공식 렌더). 판매자 실물 사진과는 별개다.
  img: string;
}

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

function NewListingForm({
  initialCard,
  onDone,
  onCancel,
}: {
  // 어느 카드인지는 카드 페이지에서 이미 정해져 들어온다.
  initialCard: PickedCard;
  onDone: () => void;
  onCancel: () => void;
}) {
  // 카드는 반드시 카탈로그에서 고른다. 자유 입력이면 같은 카드가 여러 갈래로
  // 흩어져 시세가 안 모인다.
  const card = initialCard;
  // 판본은 어느 탭(일본판·북미판·한글판)에서 들어왔는지로 이미 정해져 있다.
  const edition = initialCard.ed;
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
              {/* 판본은 어느 탭에서 들어왔는지로 정해진다. 여기서 바꾸게 두면
                  카탈로그 그림과 판본이 어긋난다. */}
              <p className="text-xs text-neutral-400">
                No.{card.n} · {EDITION_LABEL[edition]}
              </p>
            </div>
          </div>
        )}

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

// ── 카드 페이지 ──────────────────────────────────────────────────────────────
// 카드 한 장이 하나의 페이지다. 매물이 0건이어도 페이지는 있다 — 스니커덩크·크림처럼
// 카탈로그가 먼저 있고 거기에 매물이 붙는 구조라야 시세가 카드 단위로 쌓인다.

function CardMarket({
  card,
  onBack,
  onOpenListing,
  reloadKey,
  onChanged,
}: {
  card: PickedCard;
  onBack: () => void;
  onOpenListing: (l: FleaListing) => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<FleaListing[] | null>(null);
  const [grade, setGrade] = useState('전체');
  const [selling, setSelling] = useState(false);

  useEffect(() => {
    setRows(null);
    fetchListings({ slug: card.slug, no: card.n })
      .then(setRows)
      .catch(() => setRows([]));
  }, [card.slug, card.n, reloadKey]);

  if (selling) {
    return (
      <NewListingForm
        initialCard={card}
        onCancel={() => setSelling(false)}
        onDone={() => {
          setSelling(false);
          onChanged();
        }}
      />
    );
  }

  const all = rows ?? [];
  // 등급 칩은 A~D를 늘 보여주고(팔 수 있는 상태니까), 감정 등급은 매물이 있는 것만 붙인다.
  const slabsHere = [...new Set(all.map((r) => r.grade))].filter((g) => isSlab(g));
  const chips = ['전체', ...RAW_GRADES, ...slabsHere];
  const shown = grade === '전체' ? all : all.filter((r) => r.grade === grade);
  const onSale = all.filter((r) => r.status === 'open');
  const lowest = onSale.length ? Math.min(...onSale.map((r) => r.price)) : null;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-semibold text-neutral-500 hover:text-black">
        ← 카드 목록
      </button>

      {/* 카탈로그 이미지 + 카드 정보 */}
      <div className="flex flex-col items-center">
        <img
          src={card.img ? thumb(cardImg(card.img), 480) : CARD_BACK}
          alt=""
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = CARD_BACK;
          }}
          className="w-44 rounded-xl border border-neutral-200"
        />
        <h3 className="mt-3 text-center text-lg font-bold text-black">{card.name}</h3>
        <p className="text-center text-xs text-neutral-500">
          {card.setName} · No.{card.n} · {EDITION_LABEL[card.ed]}
        </p>
        <p className="mt-2 text-xl font-bold text-black">
          {lowest != null ? `${lowest.toLocaleString()}원~` : '판매중인 매물 없음'}
        </p>
      </div>

      {/* 등급 필터 */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {chips.map((g) => {
          const n = g === '전체' ? all.length : all.filter((r) => r.grade === g).length;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                grade === g ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'
              }`}
            >
              {g}
              {n > 0 && <span className="ml-1 opacity-60">{n}</span>}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setSelling(true)}
        className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
      >
        이 카드 팔기
      </button>

      {/* 매물 그리드. 여기서는 판매자 실물 사진이 주인공이다 — 실제 파는 물건이라서. */}
      <div>
        <p className="mb-2 text-sm font-bold text-black">올라온 매물 {shown.length}건</p>
        {rows === null ? (
          <p className="py-10 text-center text-sm text-neutral-400">불러오는 중...</p>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400">
            {grade === '전체' ? '아직 이 카드 매물이 없습니다.' : `${grade}등급 매물이 없습니다.`}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {shown.map((r) => (
              <button key={r.id} type="button" onClick={() => onOpenListing(r)} className="text-left">
                <div className="relative">
                  <img
                    src={r.images[0] ?? CARD_BACK}
                    alt=""
                    loading="lazy"
                    className={`aspect-square w-full rounded-lg border border-neutral-200 object-cover ${
                      r.status === 'sold' ? 'opacity-45' : ''
                    }`}
                  />
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold text-white">
                    {r.grade}
                  </span>
                  {r.status === 'sold' && (
                    <span className="absolute left-1 top-1 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      거래완료
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs font-bold text-black">{won(r.price)}</p>
                {!!r.offers && <p className="text-[11px] text-neutral-400">제안 {r.offers}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 카드 고르기(첫 화면) ─────────────────────────────────────────────────────
// 최신 세트 몇 개만 깔아 둔다. 전체 284개를 다 열면 매물 없는 카드가 3만 장이라
// 둘러볼 수가 없다. 늘리는 건 나중에 매물이 붙는 걸 보고 정한다.
const FEATURED = 4;

export function FleaListings() {
  // 판본을 먼저 고른다. 한글판은 카탈로그가 따로 없고, 일본판 세트에 포켓몬코리아
  // 공식 그림·이름을 붙여 둔 것을 쓴다(한국은 일본판 세트를 그대로 낸다).
  const [ed, setEd] = useState<Edition>('jp');
  const [koSets, setKoSets] = useState<string[]>([]);
  const [sets, setSets] = useState<SetIndexEntry[] | null>(null);
  const [setIdx, setSetIdx] = useState(0);
  const [cards, setCards] = useState<SetCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<PickedCard | null>(null);
  const [openListing, setOpenListing] = useState<FleaListing | null>(null);
  const [withListings, setWithListings] = useState<Map<string, FleaCardRow>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    loadKoSets().then(setKoSets).catch(() => undefined);
  }, []);

  // 판본별로 발매일이 가장 최근인 세트 몇 개.
  useEffect(() => {
    loadSetIndex()
      .then((list) => {
        const live = list
          .filter((s) => !s.slug.includes('pocket'))
          .filter((s) =>
            ed === 'na' ? s.ed === 'en' : ed === 'kr' ? koSets.includes(s.slug) : s.ed === 'ja',
          )
          .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
          .slice(0, FEATURED);
        setSets(live);
        setSetIdx(0);
      })
      .catch(() => setError('세트 목록을 불러오지 못했습니다.'));
  }, [ed, koSets]);

  const currentSet = sets?.[setIdx];

  useEffect(() => {
    if (!currentSet) return;
    setCards(null);
    loadSetCards(currentSet.slug)
      .then(setCards)
      .catch(() => setCards([]));
  }, [currentSet]);

  // 어떤 카드에 매물이 붙어 있는지. 카드 칸에 "N건 · 최저가"를 달아 준다.
  const loadCounts = useCallback(() => {
    fetchCardsWithListings()
      .then((rows) => setWithListings(new Map(rows.map((r) => [`${r.cardSlug}/${r.cardNo}`, r]))))
      .catch(() => undefined);
  }, []);
  useEffect(loadCounts, [loadCounts, reloadKey]);

  const refresh = () => {
    setReloadKey((n) => n + 1);
    loadCounts();
  };

  if (openListing) {
    return (
      <ListingDetail
        listing={openListing}
        onBack={() => setOpenListing(null)}
        onChanged={refresh}
      />
    );
  }

  if (market) {
    return (
      <CardMarket
        card={market}
        reloadKey={reloadKey}
        onBack={() => setMarket(null)}
        onOpenListing={setOpenListing}
        onChanged={refresh}
      />
    );
  }

  // 한글판일 때는 공식 한글명·번호·그림을 쓴다. 자료가 없는 카드(한국 미발매 시크릿 등)는
  // 아예 빼 버린다 — 못 파는 카드를 목록에 두면 헛걸음이 된다.
  const shape = (c: SetCard) => ({
    n: ed === 'kr' ? (c.koNo ?? c.n) : c.n,
    label: ed === 'kr' ? (c.koName ?? '') : koName(currentSet?.ed ?? 'ja', c.name),
    img: ed === 'kr' ? (c.koImg ?? '') : usable(c.img) ? cardImg(c.img) : '',
    raw: c,
  });
  const q = query.trim().toLowerCase();
  const list = (cards ?? [])
    .filter((c) => ed !== 'kr' || !!c.koImg)
    .map(shape)
    .filter((c) => !q || c.label.toLowerCase().includes(q) || c.raw.name.toLowerCase().includes(q) || c.n === q);

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-rose-500">{error}</p>}

      <div className="flex gap-2">
        {(Object.keys(EDITION_LABEL) as Edition[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setEd(v);
              setQuery('');
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              ed === v ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'
            }`}
          >
            {EDITION_LABEL[v]}
          </button>
        ))}
      </div>

      {ed === 'kr' && koSets.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400">
          한글판 자료를 아직 안 받았습니다.
        </p>
      )}

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {(sets ?? []).map((s, i) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => {
              setSetIdx(i);
              setQuery('');
            }}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              setIdx === i ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'
            }`}
          >
            {koSet(s.ed, s.name)}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="카드 이름 또는 번호"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />

      {!currentSet || cards === null ? (
        <p className="py-12 text-center text-sm text-neutral-400">불러오는 중...</p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-200 py-12 text-center text-sm text-neutral-400">
          찾는 카드가 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {list.map((c) => {
            const hit = withListings.get(`${currentSet.slug}/${c.n}`);
            const src = c.img ? thumb(cardImg(c.img), 240) : CARD_BACK;
            return (
              <button
                key={`${c.n}-${c.raw.name}`}
                type="button"
                onClick={() =>
                  setMarket({
                    slug: currentSet.slug,
                    ed,
                    setName: koSet(currentSet.ed, currentSet.name),
                    n: c.n,
                    name: c.label,
                    img: c.img,
                  })
                }
                className="text-left"
              >
                <div className="relative">
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = CARD_BACK;
                    }}
                    className="aspect-[63/88] w-full rounded-lg border border-neutral-200 object-cover"
                  />
                  {!!hit?.onSale && (
                    <span className="absolute left-1 top-1 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {hit.onSale}건
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-[11px] font-semibold text-black">{c.label}</p>
                {hit?.lowest != null ? (
                  <p className="text-[11px] font-bold text-black">{hit.lowest.toLocaleString()}원~</p>
                ) : (
                  <p className="text-[11px] text-neutral-400">No.{c.n}</p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
