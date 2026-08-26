import { useCallback, useEffect, useRef, useState } from 'react';
import { FLEA_SET_SET } from '../lib/fleaSets';
import {
  answerOffer,
  closeListing,
  createListing,
  EDITION_LABEL,
  fetchCardsWithListings,
  fetchListings,
  searchCards,
  fetchOffers,
  fetchBids,
  createBid,
  cancelBid,
  openChat,
  fetchChats,
  fetchChatMessages,
  sendChatMessage,
  proposeDeal,
  answerDeal,
  isSlab,
  PHOTO_COUNT,
  PHOTO_SLOTS,
  RAW_GRADE_HINT,
  RAW_GRADE_TITLE,
  RAW_GRADES,
  sendOffer,
  SLAB_COMPANIES,
  type Edition,
  type FleaBid,
  type FleaCardRow,
  type FleaChatMsg,
  type FleaChatRoom,
  type FleaListing,
  type FleaSearchRow,
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

// 사진 한 칸. 비었으면 이름표 있는 점선 상자, 채우면 썸네일 + 지우기.
function 사진칸({
  이름, url, 올리는중, onPick, onClear, 크게,
}: {
  이름: string; url: string | null; 올리는중: boolean; onPick: () => void; onClear: () => void; 크게?: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onPick}
        disabled={올리는중}
        className={`w-full overflow-hidden rounded-lg border ${크게 ? 'aspect-[63/88]' : 'aspect-square'} ${
          url ? 'border-neutral-200' : 'border-dashed border-neutral-300 hover:bg-neutral-50'
        }`}
      >
        {url ? (
          <img src={url} alt={이름} className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center px-1 text-center">
            <span>
              <span className="block text-lg text-neutral-300">＋</span>
              <span className={`block ${크게 ? 'text-xs' : 'text-[10px]'} leading-tight text-neutral-500`}>
                {올리는중 ? '올리는 중…' : 이름}
              </span>
            </span>
          </span>
        )}
      </button>
      {url && (
        <>
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-neutral-900/70 px-1 py-0.5 text-[9px] font-semibold text-white">
            {이름}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label={`${이름} 지우기`}
            className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-neutral-900 text-xs text-white"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

// ── 매물 올리기 ──────────────────────────────────────────────────────────────

function NewListingForm({
  initialCard,
  initialPrice,
  onDone,
  onCancel,
}: {
  // 어느 카드인지는 카드 페이지에서 이미 정해져 들어온다.
  initialCard: PickedCard;
  // 구매 희망(매수)의 「이 값에 팔기」로 들어오면 그 값이 미리 채워진다.
  initialPrice?: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  // 카드는 반드시 카탈로그에서 고른다. 자유 입력이면 같은 카드가 여러 갈래로
  // 흩어져 시세가 안 모인다.
  const card = initialCard;
  // 판본은 어느 탭(일본판·한글판)에서 들어왔는지로 이미 정해져 있다.
  const edition = initialCard.ed;
  // 미감정(A~D)이 기본. 감정 카드는 회사부터 고른다 — 어느 회사 감정인지가
  // 데이터로 정확히 남아야 나중에 회사별 시세를 가를 수 있다(사장님 2026-08-21).
  const [rawGrade, setRawGrade] = useState<'' | (typeof RAW_GRADES)[number]>('A');
  const [company, setCompany] = useState<'' | (typeof SLAB_COMPANIES)[number]['name']>('');
  const [slabGrade, setSlabGrade] = useState('');
  const [certNo, setCertNo] = useState('');
  const [price, setPrice] = useState(() => (initialPrice ? String(initialPrice) : ''));
  const [note, setNote] = useState('');
  // ⚠️ 사진은 자유 나열이 아니라 **칸 10개 고정**이다(PHOTO_SLOTS 차례 그대로).
  //    배열 차례가 곧 「앞 전체·뒤 전체·앞 모서리…」 자리라, 채운 것만 골라 보내면 안 된다.
  const [images, setImages] = useState<(string | null)[]>(() => Array(PHOTO_COUNT).fill(null));
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const 고르는칸 = useRef(0);

  const slab = company !== '';
  const grade = slab ? (slabGrade ? `${company === '기타' ? '기타' : company} ${slabGrade}` : '') : rawGrade;
  const 채운수 = images.filter(Boolean).length;

  async function pickFile(files: FileList | null) {
    const f = files?.[0];
    const i = 고르는칸.current;
    if (!f) return;
    setUploadingIdx(i);
    setError('');
    try {
      const url = await uploadPostImage(f);
      setImages((prev) => prev.map((v, k) => (k === i ? url : v)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '사진을 올리지 못했습니다.');
    } finally {
      setUploadingIdx(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (!card) return;
      const 빈칸 = images.findIndex((u) => !u);
      if (빈칸 >= 0) {
        setError(`사진이 비었습니다 — ${PHOTO_SLOTS[빈칸].label}부터 채워 주세요.`);
        return;
      }
      if (!grade) {
        setError('감정 등급을 골라 주세요.');
        return;
      }
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
        images: images.filter((u): u is string => !!u),
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
          <label className="mb-1 block text-xs font-semibold text-neutral-600">상태</label>
          {/* 미감정은 A~D 넷 중 하나. 글자만 보여 주면 다들 후하게 매기므로,
              기준을 칸 안에 같이 적는다 — 사는 쪽도 상세에서 같은 글을 본다. */}
          {!slab && (
            <div className="space-y-1.5">
              {RAW_GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setRawGrade(g)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
                    rawGrade === g ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-sm font-bold ${
                      rawGrade === g ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {g}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-black">{RAW_GRADE_TITLE[g]}</span>
                    <span className="block text-xs leading-relaxed text-neutral-500">{RAW_GRADE_HINT[g]}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 감정 카드는 **회사부터** 드롭다운으로 정확히 고른다. 회사가 데이터로 남아야
              나중에 PSA·BGS 값을 갈라 볼 수 있다. */}
          <div className={`${slab ? 'mt-2' : 'mt-3'} flex gap-2`}>
            <select
              value={company}
              onChange={(e) => {
                const c = e.target.value as typeof company;
                setCompany(c);
                setSlabGrade(c ? SLAB_COMPANIES.find((x) => x.name === c)!.grades[0] : '');
              }}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">감정 카드면 회사를 고르세요</option>
              {SLAB_COMPANIES.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name === '기타' ? '기타 감정사' : c.name}
                </option>
              ))}
            </select>
            {slab && (
              <select
                value={slabGrade}
                onChange={(e) => setSlabGrade(e.target.value)}
                className="w-40 flex-shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              >
                {SLAB_COMPANIES.find((c) => c.name === company)!.grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
          </div>
          {slab && (
            <button type="button" onClick={() => { setCompany(''); setSlabGrade(''); }} className="mt-1 text-xs text-neutral-400 hover:text-black">
              감정 카드가 아니에요 → 미감정(A~D)으로
            </button>
          )}
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
            사진 {채운수}/{PHOTO_COUNT}장 <span className="font-normal text-neutral-400">— 열 칸을 다 채워야 올라갑니다</span>
          </label>
          <p className="mb-2 text-xs leading-relaxed text-neutral-500">
            슬리브를 벗기고 찍어 주세요. 모서리 사진은 그 귀퉁이가 화면에 꽉 차게 — 사는 분이 상태를
            판단하는 근거가 됩니다.
          </p>
          <input ref={fileRef} type="file" accept="image/*" onChange={(e) => pickFile(e.target.files)} className="hidden" />

          {/* 앞·뒤 전체 두 칸은 크게, 모서리 여덟 칸은 4열로. 칸마다 이름표가 붙는다. */}
          <div className="grid grid-cols-2 gap-2">
            {PHOTO_SLOTS.slice(0, 2).map((slot, i) => (
              <사진칸 key={slot.key} 이름={slot.label} url={images[i]} 올리는중={uploadingIdx === i}
                onPick={() => { 고르는칸.current = i; fileRef.current?.click(); }}
                onClear={() => setImages((p) => p.map((v, k) => (k === i ? null : v)))} 크게 />
            ))}
          </div>
          <p className="mb-1 mt-3 text-xs font-semibold text-neutral-600">앞면 모서리 (4분의 1씩)</p>
          <div className="grid grid-cols-4 gap-2">
            {PHOTO_SLOTS.slice(2, 6).map((slot, k) => {
              const i = k + 2;
              return (
                <사진칸 key={slot.key} 이름={slot.label.replace('앞 · ', '')} url={images[i]} 올리는중={uploadingIdx === i}
                  onPick={() => { 고르는칸.current = i; fileRef.current?.click(); }}
                  onClear={() => setImages((p) => p.map((v, j) => (j === i ? null : v)))} />
              );
            })}
          </div>
          <p className="mb-1 mt-3 text-xs font-semibold text-neutral-600">뒷면 모서리 (4분의 1씩)</p>
          <div className="grid grid-cols-4 gap-2">
            {PHOTO_SLOTS.slice(6, 10).map((slot, k) => {
              const i = k + 6;
              return (
                <사진칸 key={slot.key} 이름={slot.label.replace('뒤 · ', '')} url={images[i]} 올리는중={uploadingIdx === i}
                  onPick={() => { 고르는칸.current = i; fileRef.current?.click(); }}
                  onClear={() => setImages((p) => p.map((v, j) => (j === i ? null : v)))} />
              );
            })}
          </div>
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
          disabled={busy || uploadingIdx !== null || !card || 채운수 < PHOTO_COUNT}
          onClick={submit}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? '올리는 중…' : 채운수 < PHOTO_COUNT ? `사진 ${PHOTO_COUNT - 채운수}장 더 필요합니다` : '올리기'}
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
  onOpenChat,
}: {
  listing: FleaListing;
  onBack: () => void;
  onChanged: () => void;
  onOpenChat: () => void;
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
          "이 카드가 맞다"는 표시일 뿐이라 아래에 작게 둔다.
          ⚠️ 10장 규격(PHOTO_SLOTS 차례)으로 올라온 매물은 자리 이름표를 붙여 나눠 보인다 —
          앞·뒤 전체 크게, 모서리 여덟 장은 4칸씩. 옛 매물(10장 미만)은 예전처럼 한 줄로. */}
      {listing.images.length >= PHOTO_COUNT ? (
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-neutral-600">실물 사진 — 전체</p>
            <div className="grid grid-cols-2 gap-2">
              {[0, 1].map((i) => (
                <figure key={i}>
                  <img src={listing.images[i]} alt={PHOTO_SLOTS[i].label} className="aspect-[63/88] w-full rounded-xl border border-neutral-200 object-cover" />
                  <figcaption className="mt-1 text-center text-[11px] text-neutral-400">{PHOTO_SLOTS[i].label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
          {([['앞면 모서리', 2], ['뒷면 모서리', 6]] as const).map(([제목, 시작]) => (
            <div key={제목}>
              <p className="mb-1.5 text-xs font-semibold text-neutral-600">{제목} (4분의 1씩)</p>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((k) => {
                  const i = 시작 + k;
                  return (
                    <figure key={i}>
                      <img src={listing.images[i]} alt={PHOTO_SLOTS[i].label} className="aspect-square w-full rounded-lg border border-neutral-200 object-cover" />
                      <figcaption className="mt-0.5 truncate text-center text-[10px] text-neutral-400">
                        {PHOTO_SLOTS[i].label.replace(/^[앞뒤] · /, '')}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : listing.images.length > 0 ? (
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
      ) : null}

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
        {!isSlab(listing.grade) && listing.grade in RAW_GRADE_HINT && (
          <p className="mt-1.5 rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-600">
            <b>{RAW_GRADE_TITLE[listing.grade as keyof typeof RAW_GRADE_TITLE]}</b> —{' '}
            {RAW_GRADE_HINT[listing.grade as keyof typeof RAW_GRADE_HINT]}
          </p>
        )}
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
          {/* ⚠️ 내 매물에도 대화 단추가 보인다 — 운영자 혼자 시험하는 단계(자기 대화 허용).
              회원 공개 전에 !mine 조건을 걸 것. */}
          <button
            type="button"
            onClick={onOpenChat}
            className="mb-3 w-full rounded-lg border border-neutral-900 py-2.5 text-sm font-bold text-black hover:bg-neutral-50"
          >
            판매자와 대화하기
          </button>
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


// ── 매물 피드 ────────────────────────────────────────────────────────────────
// 실제 마켓의 첫 화면은 "지금 올라온 물건들"이다(당근·번개장터가 그렇다). 카드 도감부터
// 보여 주면 매물이 몇 개 없는 초기에 텅 빈 가게처럼 보인다 — 피드가 기본 탭인 까닭.

function ListingCard({ listing, onOpen }: { listing: FleaListing; onOpen: (l: FleaListing) => void }) {
  // 파는 물건은 실물 사진이 먼저다. 없으면 카탈로그 그림으로 물러선다.
  const 사진 = listing.images[0] ?? (listing.cardImg ? thumb(cardImg(listing.cardImg), 480) : CARD_BACK);
  const sold = listing.status === 'sold';
  return (
    <button type="button" onClick={() => onOpen(listing)} className="text-left">
      <div className="relative overflow-hidden rounded-xl border border-neutral-200">
        <img
          src={사진}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = CARD_BACK;
          }}
          className={`aspect-[63/88] w-full object-cover ${sold ? 'opacity-40' : ''}`}
        />
        <span className="absolute left-1.5 top-1.5">
          <GradeBadge grade={listing.grade} />
        </span>
        {sold && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="rounded-lg bg-neutral-900/80 px-3 py-1.5 text-sm font-bold text-white">거래완료</span>
          </span>
        )}
        {!sold && (listing.offers ?? 0) > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-neutral-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
            제안 {listing.offers ?? 0}
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-xs font-semibold text-black">{listing.cardName}</p>
      <p className="truncate text-[11px] text-neutral-400">
        {listing.setName} · {EDITION_LABEL[listing.edition]}
      </p>
      <p className={`text-sm font-bold ${sold ? 'text-neutral-400 line-through' : 'text-black'}`}>{won(listing.price)}</p>
      <p className="text-[11px] text-neutral-400">
        {listing.seller} · {relTime(listing.createdAt)}
      </p>
    </button>
  );
}

function MarketFeed({
  reloadKey,
  onOpen,
  onGoBrowse,
}: {
  reloadKey: number;
  onOpen: (l: FleaListing) => void;
  onGoBrowse: () => void;
}) {
  const [rows, setRows] = useState<FleaListing[] | null>(null);
  const [error, setError] = useState('');
  const [판, set판] = useState<'all' | Edition>('all');
  const [등급, set등급] = useState<'all' | 'slab' | 'raw'>('all');
  const [정렬, set정렬] = useState<'new' | 'cheap' | 'pricey'>('new');
  const [팔린것도, set팔린것도] = useState(true);

  useEffect(() => {
    setError('');
    fetchListings()
      .then(setRows)
      .catch(() => setError('매물을 불러오지 못했습니다.'));
  }, [reloadKey]);

  const 목록 = (rows ?? [])
    .filter((l) => 판 === 'all' || l.edition === 판)
    .filter((l) => 등급 === 'all' || (등급 === 'slab' ? isSlab(l.grade) : !isSlab(l.grade)))
    .filter((l) => 팔린것도 || l.status === 'open')
    .sort((a, b) => {
      // 팔린 것은 어느 정렬에서든 뒤로 — 사러 온 사람이 먼저 볼 것은 살 수 있는 물건이다.
      if ((a.status === 'sold') !== (b.status === 'sold')) return a.status === 'sold' ? 1 : -1;
      if (정렬 === 'cheap') return a.price - b.price;
      if (정렬 === 'pricey') return b.price - a.price;
      return b.createdAt - a.createdAt;
    });

  const 칩 = (켬: boolean) =>
    `flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${켬 ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'}`;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-rose-500">{error}</p>}

      {/* 거르개 한 줄. 폰에서는 옆으로 민다. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {([['all', '전체'], ['jp', EDITION_LABEL.jp], ['kr', EDITION_LABEL.kr]] as const).map(([v, 라벨]) => (
          <button key={v} type="button" onClick={() => set판(v)} className={칩(판 === v)}>
            {라벨}
          </button>
        ))}
        <span className="my-1 w-px flex-shrink-0 bg-neutral-200" />
        {([['all', '모든 등급'], ['slab', '감정품'], ['raw', '미감정']] as const).map(([v, 라벨]) => (
          <button key={v} type="button" onClick={() => set등급(v)} className={칩(등급 === v)}>
            {라벨}
          </button>
        ))}
        <span className="my-1 w-px flex-shrink-0 bg-neutral-200" />
        {([['new', '최신순'], ['cheap', '싼 값부터'], ['pricey', '비싼 값부터']] as const).map(([v, 라벨]) => (
          <button key={v} type="button" onClick={() => set정렬(v)} className={칩(정렬 === v)}>
            {라벨}
          </button>
        ))}
        <span className="my-1 w-px flex-shrink-0 bg-neutral-200" />
        <button type="button" onClick={() => set팔린것도((v) => !v)} className={칩(!팔린것도)}>
          판매중만
        </button>
      </div>

      {rows === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">불러오는 중...</p>
      ) : 목록.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 py-14 text-center">
          <p className="text-sm font-semibold text-neutral-500">조건에 맞는 매물이 없습니다.</p>
          <p className="mt-1 text-xs text-neutral-400">파실 카드가 있다면 첫 매물을 올려 보세요.</p>
          <button
            type="button"
            onClick={onGoBrowse}
            className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
          >
            카드 찾아서 올리기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {목록.map((l) => (
            <ListingCard key={l.id} listing={l} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 내 거래 ──────────────────────────────────────────────────────────────────

function MyTrades({
  reloadKey,
  onOpen,
  onGoBrowse,
  onOpenChat,
}: {
  reloadKey: number;
  onOpen: (l: FleaListing) => void;
  onGoBrowse: () => void;
  onOpenChat: (roomId: number) => void;
}) {
  const [rows, setRows] = useState<FleaListing[] | null>(null);
  const [myBids, setMyBids] = useState<FleaBid[]>([]);
  const [chats, setChats] = useState<FleaChatRoom[]>([]);
  useEffect(() => {
    fetchListings()
      .then((all) => setRows(all.filter((l) => l.mine)))
      .catch(() => setRows([]));
    fetchBids()
      .then(setMyBids)
      .catch(() => setMyBids([]));
    fetchChats()
      .then(setChats)
      .catch(() => setChats([]));
  }, [reloadKey]);

  if (rows === null) return <p className="py-16 text-center text-sm text-neutral-400">불러오는 중...</p>;
  if (rows.length === 0 && myBids.length === 0 && chats.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 py-14 text-center">
        <p className="text-sm font-semibold text-neutral-500">올린 매물이 없습니다.</p>
        <button
          type="button"
          onClick={onGoBrowse}
          className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
        >
          카드 찾아서 올리기
        </button>
      </div>
    );

  const 파는중 = rows.filter((l) => l.status === 'open');
  const 끝난것 = rows.filter((l) => l.status !== 'open');
  const 줄 = (l: FleaListing) => (
    <button
      key={l.id}
      type="button"
      onClick={() => onOpen(l)}
      className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left"
    >
      <img
        src={l.images[0] ?? (l.cardImg ? thumb(cardImg(l.cardImg), 120) : CARD_BACK)}
        alt=""
        onError={(e) => {
          e.currentTarget.onerror = null;
          e.currentTarget.src = CARD_BACK;
        }}
        className="h-16 w-12 flex-shrink-0 rounded-lg border border-neutral-100 object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-black">{l.cardName}</p>
        <p className="truncate text-xs text-neutral-400">
          {l.setName} · <GradeBadge grade={l.grade} />
        </p>
        <p className="text-sm font-bold text-black">{won(l.price)}</p>
      </div>
      {l.status === 'open' ? (
        (l.offers ?? 0) > 0 ? (
          <span className="flex-shrink-0 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-bold text-amber-800">
            제안 {l.offers ?? 0}건
          </span>
        ) : (
          <span className="flex-shrink-0 text-xs text-neutral-400">{relTime(l.createdAt)}</span>
        )
      ) : (
        <span className="flex-shrink-0 rounded bg-neutral-200 px-2 py-1 text-xs font-bold text-neutral-600">거래완료</span>
      )}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* 대화가 맨 위다 — 답을 기다리는 사람이 있는 자리라서. */}
      {chats.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-black">대화 {chats.length}건</p>
          <div className="space-y-2">
            {chats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenChat(c.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-3 text-left"
              >
                <img
                  src={c.cardImg ? thumb(cardImg(c.cardImg), 120) : CARD_BACK}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = CARD_BACK;
                  }}
                  className="h-16 w-12 flex-shrink-0 rounded-lg border border-neutral-100 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-black">
                    {c.상대} <span className="font-normal text-neutral-400">· {c.cardName}</span>
                  </p>
                  <p className="truncate text-xs text-neutral-500">{c.lastText || '대화를 시작해 보세요'}</p>
                  {c.성사가 != null && <p className="text-xs font-bold text-black">거래 확정 {won(c.성사가)}</p>}
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span className="text-[11px] text-neutral-400">{relTime(c.lastAt)}</span>
                  {!!c.안읽음 && (
                    <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{c.안읽음}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {파는중.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-black">파는 중 {파는중.length}건</p>
          <div className="space-y-2">{파는중.map(줄)}</div>
        </div>
      )}
      {myBids.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-rose-600">걸어 둔 구매 희망 {myBids.length}건</p>
          <div className="space-y-2">
            {myBids.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-xl border border-rose-200 p-3">
                <img
                  src={b.cardImg ? thumb(cardImg(b.cardImg), 120) : CARD_BACK}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = CARD_BACK;
                  }}
                  className="h-16 w-12 flex-shrink-0 rounded-lg border border-neutral-100 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-black">{b.cardName}</p>
                  <p className="truncate text-xs text-neutral-400">{b.setName}</p>
                  <p className="text-sm font-bold text-rose-600">{won(b.price)}에 삽니다</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('구매 희망을 내릴까요?')) return;
                    try {
                      await cancelBid(b.id);
                      setMyBids((p) => p.filter((x) => x.id !== b.id));
                    } catch { /* 새로고침으로 정리된다 */ }
                  }}
                  className="flex-shrink-0 text-xs font-semibold text-neutral-400 hover:text-rose-500"
                >
                  내리기
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {끝난것.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-black">끝난 거래 {끝난것.length}건</p>
          <div className="space-y-2">{끝난것.map(줄)}</div>
        </div>
      )}
    </div>
  );
}

// ── 목록 ─────────────────────────────────────────────────────────────────────

// ── 카드 페이지 ──────────────────────────────────────────────────────────────
// 카드 한 장이 하나의 페이지다. 매물이 0건이어도 페이지는 있다 — 스니커덩크·크림처럼
// 카탈로그가 먼저 있고 거기에 매물이 붙는 구조라야 시세가 카드 단위로 쌓인다.

// ── 거래 대화방 ──────────────────────────────────────────────────────────────
// 구매 희망의 「판매하기」·매물의 「판매자와 대화하기」로 두 사람이 이어진다.
// 글·사진은 자유지만 **최종 금액만은 「거래 확정」 버튼으로** 남긴다 — 그래야
// 합의 금액이 시스템에 남아 시세 자료가 된다(이 마켓의 존재 이유).
// 새 글은 5초마다 물어 온다. 푸시 알림은 없다 — 사이트에 들어와야 보인다.

function ChatRoomView({ roomId, onBack, onChanged }: { roomId: number; onBack: () => void; onChanged: () => void }) {
  const [room, setRoom] = useState<FleaChatRoom | null>(null);
  const [msgs, setMsgs] = useState<FleaChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dealOpen, setDealOpen] = useState(false);
  const [dealPrice, setDealPrice] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastIdRef = useRef(0);

  const load = useCallback(() => {
    fetchChatMessages(roomId)
      .then(({ room: r, messages }) => {
        setRoom(r);
        setMsgs(messages);
        setError('');
      })
      .catch(() => setError('대화를 불러오지 못했습니다.'));
  }, [roomId]);

  useEffect(() => {
    load();
    // 5초 폴링. 다른 탭에 가 있으면 쉰다 — 헛요청을 줄인다.
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 5000);
    return () => clearInterval(t);
  }, [load]);

  // 새 글이 붙었을 때만 바닥으로 내린다 — 폴링마다 내리면 위로 못 올라간다.
  useEffect(() => {
    const last = msgs[msgs.length - 1]?.id ?? 0;
    if (last !== lastIdRef.current && listRef.current) {
      lastIdRef.current = last;
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [msgs]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const 시각 = (ts: number) => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const sendText = () => {
    const t = text.trim();
    if (!t || busy) return;
    void act(async () => {
      await sendChatMessage(roomId, { text: t });
      setText('');
    });
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-xs font-semibold text-neutral-500 hover:text-black">
        ← 돌아가기
      </button>

      {/* 무슨 카드 이야기인지 위에 박아 둔다 — 대화가 길어져도 안 헷갈리게. */}
      <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <img
          src={room?.cardImg ? thumb(cardImg(room.cardImg), 120) : CARD_BACK}
          alt=""
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = CARD_BACK;
          }}
          className="h-14 w-10 flex-shrink-0 rounded object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-black">{room?.cardName ?? '불러오는 중...'}</p>
          <p className="truncate text-xs text-neutral-500">
            {room ? `${room.상대}님과 대화 · ${room.source === 'bid' ? '구매 희망' : '매물'} ${won(room.refPrice)}` : ''}
          </p>
        </div>
      </div>

      {room?.성사가 != null ? (
        <div className="rounded-xl bg-neutral-900 p-3 text-white">
          <p className="text-xs text-neutral-300">거래 확정</p>
          <p className="text-lg font-bold">{won(room.성사가)}</p>
          <p className="mt-0.5 text-xs text-neutral-400">이 금액이 시세 자료로 남습니다. 주고받기는 대화로 이어서 정하시면 됩니다.</p>
        </div>
      ) : room?.제안 ? (
        room.제안.내가냈나 ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <b>{won(room.제안.price)}</b> 확정 제안을 보냈습니다 — 상대의 답을 기다립니다.
          </p>
        ) : (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              상대가 <b>{won(room.제안.price)}</b>에 거래 확정을 제안했습니다.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => act(async () => { await answerDeal(roomId, true); onChanged(); })}
                className="flex-1 rounded-lg bg-neutral-900 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                수락 — 이 값에 거래
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => answerDeal(roomId, false))}
                className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-600 disabled:opacity-40"
              >
                거절
              </button>
            </div>
          </div>
        )
      ) : null}

      {/* 말풍선. 내 것은 오른쪽 짙은 색, 상대는 왼쪽 옅은 색, 안내는 가운데 작게. */}
      <div ref={listRef} className="h-[52vh] min-h-[300px] space-y-2 overflow-y-auto rounded-xl border border-neutral-200 p-3">
        {msgs.length === 0 && (
          <p className="py-10 text-center text-xs leading-relaxed text-neutral-400">
            대화를 시작해 보세요. 사진을 주고받으며 상태를 확인하고,
            <br />값이 맞으면 <b>거래 확정</b> 버튼으로 마무리합니다.
          </p>
        )}
        {msgs.map((m) =>
          m.type === 'system' ? (
            <p
              key={m.id}
              className="mx-auto w-fit max-w-[85%] rounded-full bg-neutral-100 px-3 py-1 text-center text-[11px] text-neutral-500"
            >
              {m.text}
            </p>
          ) : (
            <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] ${m.mine ? 'text-right' : 'text-left'}`}>
                {m.type === 'image' ? (
                  <img src={m.image} alt="주고받은 사진" className="max-h-64 rounded-xl border border-neutral-200" />
                ) : (
                  <p
                    className={`inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm ${
                      m.mine ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-black'
                    }`}
                  >
                    {m.text}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-neutral-400">{시각(m.createdAt)}</p>
              </div>
            </div>
          ),
        )}
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {room != null && room.성사가 == null &&
        (dealOpen ? (
          <div className="rounded-xl border border-neutral-900 p-3">
            <p className="text-sm font-bold text-black">거래 확정 제안</p>
            <p className="mb-2 mt-0.5 text-xs text-neutral-500">상대가 수락하면 거래가 성사되고, 이 금액이 시세 자료로 남습니다.</p>
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={dealPrice}
                onChange={(e) => setDealPrice(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy || !dealPrice}
                onClick={() =>
                  act(async () => {
                    await proposeDeal(roomId, Number(dealPrice));
                    setDealOpen(false);
                  })
                }
                className="flex-shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                보내기
              </button>
              <button type="button" onClick={() => setDealOpen(false)} className="flex-shrink-0 text-xs font-semibold text-neutral-400">
                닫기
              </button>
            </div>
          </div>
        ) : (
          !room.제안 && (
            <button
              type="button"
              onClick={() => {
                setDealOpen(true);
                setDealPrice(String(room.refPrice || ''));
              }}
              className="w-full rounded-lg border border-neutral-900 py-2 text-sm font-bold text-black hover:bg-neutral-50"
            >
              거래 확정 제안
            </button>
          )
        ))}

      <div className="flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void act(async () => {
              const url = await uploadPostImage(f);
              await sendChatMessage(roomId, { image: url });
            });
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex-shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 disabled:opacity-40"
        >
          사진
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 한글 입력 중의 엔터(조합 중)는 보내지 않는다 — 마지막 글자가 잘린다.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendText();
          }}
          placeholder="메시지 보내기"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={sendText}
          className="flex-shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          보내기
        </button>
      </div>
    </div>
  );
}

function CardMarket({
  card,
  onBack,
  onOpenListing,
  reloadKey,
  onChanged,
  onOpenChat,
}: {
  card: PickedCard;
  onBack: () => void;
  onOpenListing: (l: FleaListing) => void;
  reloadKey: number;
  onChanged: () => void;
  onOpenChat: (source: 'bid' | 'listing', refId: number) => void;
}) {
  const [rows, setRows] = useState<FleaListing[] | null>(null);
  const [bids, setBids] = useState<FleaBid[]>([]);
  const [grade, setGrade] = useState('전체');
  // null = 목록 · {가격} = 올리기 폼(구매 희망에서 「이 값에 팔기」로 오면 값이 실려 온다)
  const [selling, setSelling] = useState<{ 가격?: number } | null>(null);
  const [bidOpen, setBidOpen] = useState(false);
  const [bidPrice, setBidPrice] = useState('');
  const [bidBusy, setBidBusy] = useState(false);
  const [bidError, setBidError] = useState('');

  useEffect(() => {
    setRows(null);
    fetchListings({ slug: card.slug, no: card.n })
      .then(setRows)
      .catch(() => setRows([]));
    fetchBids({ slug: card.slug, no: card.n })
      .then(setBids)
      .catch(() => setBids([]));
  }, [card.slug, card.n, reloadKey]);

  if (selling) {
    return (
      <NewListingForm
        initialCard={card}
        initialPrice={selling.가격}
        onCancel={() => setSelling(null)}
        onDone={() => {
          setSelling(null);
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
        {/* 호가 두 칸. 주식 관례대로 **매수(사려는 값)는 빨강, 매도(파는 값)는 파랑**이다
            (사장님 지시 2026-08-21). 이 색은 다크에서도 그대로 둔다 — 뜻이 색 자체다. */}
        <div className="mt-3 grid w-full max-w-sm grid-cols-2 gap-2">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold text-blue-700">팔려는 값 (최저)</p>
            <p className="text-lg font-bold text-blue-700">
              {lowest != null ? `${lowest.toLocaleString()}원` : '없음'}
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center">
            <p className="text-[11px] font-semibold text-rose-600">사려는 값 (최고)</p>
            <p className="text-lg font-bold text-rose-600">
              {bids.length ? `${Math.max(...bids.map((b) => b.price)).toLocaleString()}원` : '없음'}
            </p>
          </div>
        </div>
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

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSelling({})}
          className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
        >
          팔기
        </button>
        <button
          type="button"
          onClick={() => setBidOpen((v) => !v)}
          className="flex-1 rounded-lg bg-rose-600 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
        >
          이 값에 사고 싶어요
        </button>
      </div>

      {bidOpen && (
        <div className="rounded-xl border border-rose-200 p-3">
          <p className="mb-1 text-sm font-bold text-rose-600">구매 희망 걸기</p>
          <p className="mb-2 text-xs leading-relaxed text-neutral-500">
            사고 싶은 값을 걸어 두면 이 카드 페이지에 남습니다. 파는 분이 그 값에 응하면 매물이 올라옵니다.
            카드당 하나만 걸리고, 다시 걸면 값이 바뀝니다.
          </p>
          {bidError && <p className="mb-2 text-xs text-rose-500">{bidError}</p>}
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              value={bidPrice}
              onChange={(e) => setBidPrice(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="예: 38000"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={bidBusy || !bidPrice}
              onClick={async () => {
                setBidBusy(true);
                setBidError('');
                try {
                  await createBid({
                    cardSlug: card.slug, cardNo: card.n, cardName: card.name,
                    setName: card.setName, cardImg: card.img, edition: card.ed,
                    price: Number(bidPrice),
                  });
                  setBidOpen(false);
                  setBidPrice('');
                  onChanged();
                } catch (e) {
                  setBidError(e instanceof Error ? e.message : '걸지 못했습니다.');
                } finally {
                  setBidBusy(false);
                }
              }}
              className="flex-shrink-0 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              걸기
            </button>
          </div>
        </div>
      )}

      {/* 사고 싶은 사람들(매수 호가) — 비싼 값부터. 파는 쪽이 여기서 바로 응할 수 있다. */}
      {bids.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold text-rose-600">사고 싶은 사람 {bids.length}명</p>
          <ul className="space-y-2">
            {bids.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 p-3">
                <div className="min-w-0">
                  <p className="text-base font-bold text-rose-600">{won(b.price)}</p>
                  <p className="text-xs text-neutral-400">
                    {b.buyer} · {relTime(b.createdAt)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {b.mine && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('구매 희망을 내릴까요?')) return;
                        try {
                          await cancelBid(b.id);
                          onChanged();
                        } catch { /* 새로고침으로 정리된다 */ }
                      }}
                      className="text-xs font-semibold text-neutral-400 hover:text-rose-500"
                    >
                      내리기
                    </button>
                  )}
                  {/* ⚠️ 내 구매 희망에도 「판매하기」가 보인다 — 지금은 운영자 혼자
                      시험하는 단계라 자기 자신과 대화해 봐야 흐름이 확인된다.
                      회원 공개 전에 !b.mine 조건을 걸 것(서버의 자기-방 허용도 함께 막는다). */}
                  <button
                    type="button"
                    onClick={() => onOpenChat('bid', b.id)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                  >
                    판매하기
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 매물(매도) 그리드. 여기서는 판매자 실물 사진이 주인공이다 — 실제 파는 물건이라서. */}
      <div>
        <p className="mb-2 text-sm font-bold text-blue-700">파는 사람 {shown.filter((r) => r.status === 'open').length}명</p>
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

export function FleaListings() {
  // 첫 화면은 매물 피드다 — 실제 마켓처럼 "지금 올라온 물건"부터 보인다(2026-08-21 개편).
  const [tab, setTab] = useState<'feed' | 'browse' | 'mine'>('feed');
  // 판본을 먼저 고른다. 한글판은 카탈로그가 따로 없고, 일본판 세트에 포켓몬코리아
  // 공식 그림·이름을 붙여 둔 것을 쓴다(한국은 일본판 세트를 그대로 낸다).
  const [ed, setEd] = useState<Edition>('jp');
  const [koSets, setKoSets] = useState<string[]>([]);
  const [sets, setSets] = useState<SetIndexEntry[] | null>(null);
  const [setIdx, setSetIdx] = useState(0);
  const [cards, setCards] = useState<SetCard[] | null>(null);
  const [query, setQuery] = useState('');
  // 검색어를 넣으면 세트를 가리지 않고 전체에서 찾는다(서버가 색인으로 찾아 준다).
  const [found, setFound] = useState<{ rows: FleaSearchRow[]; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [market, setMarket] = useState<PickedCard | null>(null);
  const [openListing, setOpenListing] = useState<FleaListing | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [withListings, setWithListings] = useState<Map<string, FleaCardRow>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    loadKoSets().then(setKoSets).catch(() => undefined);
  }, []);

  // 다룰 확장팩만 골라 발매일 최근 순으로.
  useEffect(() => {
    loadSetIndex()
      .then((list) => {
        const live = list
          // ⚠️ 어느 확장팩을 다루는지는 **src/lib/fleaSets.ts 한 곳**에서 정한다(서버도
          //    같은 것을 본다). 여기서 따로 고르면 화면과 서버가 어긋난다.
          .filter((s) => FLEA_SET_SET.has(s.slug))
          // 한글판은 그중에서도 **한글 자료가 실제로 붙은 세트**만. 한국 미발매 세트가
          // 섞이면 카드 그림이 빈 칸으로 나온다.
          .filter((s) => ed !== 'kr' || koSets.includes(s.slug))
          .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
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

  // 타이핑할 때마다 서버를 두드리지 않게 잠깐 기다렸다 찾는다.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchCards(q, ed)
        .then(setFound)
        .catch(() => setFound({ rows: [], total: 0 }))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, ed, reloadKey]);

  const refresh = () => {
    setReloadKey((n) => n + 1);
    loadCounts();
  };

  // 대화방 열기. 방이 이미 있으면 서버가 그 방을 돌려준다.
  const openChatFor = async (source: 'bid' | 'listing', refId: number) => {
    try {
      const r = await openChat({ source, refId });
      setChatId(r.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '대화를 열지 못했습니다.');
    }
  };

  // 대화방이 맨 위다 — 매물 상세나 카드 페이지에서 열어도 그 위에 얹힌다.
  if (chatId != null) {
    return <ChatRoomView roomId={chatId} onBack={() => setChatId(null)} onChanged={refresh} />;
  }

  if (openListing) {
    return (
      <ListingDetail
        listing={openListing}
        onBack={() => setOpenListing(null)}
        onChanged={refresh}
        onOpenChat={() => openChatFor('listing', openListing.id)}
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
        onOpenChat={openChatFor}
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
      {/* 큰 탭 셋. 매물(피드) · 카드로 찾기 · 내 거래 */}
      <div className="flex gap-2 border-b border-neutral-200">
        {([['feed', '매물'], ['browse', '카드로 찾기'], ['mine', '내 거래']] as const).map(([v, 라벨]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={`-mb-px border-b-2 px-2 py-2 text-sm font-bold ${
              tab === v ? 'border-neutral-900 text-black' : 'border-transparent text-neutral-400 hover:text-neutral-600'
            }`}
          >
            {라벨}
          </button>
        ))}
      </div>

      {tab === 'feed' && <MarketFeed reloadKey={reloadKey} onOpen={setOpenListing} onGoBrowse={() => setTab('browse')} />}
      {tab === 'mine' && (
        <MyTrades reloadKey={reloadKey} onOpen={setOpenListing} onGoBrowse={() => setTab('browse')} onOpenChat={setChatId} />
      )}

      {tab === 'browse' && (
      <>
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

      {/* 검색 중에는 세트 탭이 의미가 없다 — 전체에서 찾고 있으니 감춘다. */}
      <div className={`-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 ${query.trim() ? 'hidden' : ''}`}>
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
        placeholder="카드 이름으로 전체에서 찾기 (예: 개굴닌자)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />

      {/* 검색 중이면 세트 목록 대신 전체 검색 결과를 보여준다. */}
      {query.trim() ? (
        searching && !found ? (
          <p className="py-12 text-center text-sm text-neutral-400">찾는 중...</p>
        ) : !found || found.rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-200 py-12 text-center text-sm text-neutral-400">
            "{query.trim()}"로 찾은 카드가 없습니다.
          </p>
        ) : (
          <>
            <p className="text-xs text-neutral-500">
              {found.total.toLocaleString()}장 찾음
              {found.total > found.rows.length && ` · 앞의 ${found.rows.length}장만 보여줍니다`}
            </p>
            <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {found.rows.map((c) => (
                <button
                  key={`${c.slug}-${c.n}`}
                  type="button"
                  onClick={() =>
                    setMarket({ slug: c.slug, ed: c.ed, setName: c.setName, n: c.n, name: c.name, img: c.img })
                  }
                  className="text-left"
                >
                  <div className="relative">
                    <img
                      src={c.img ? thumb(cardImg(c.img), 240) : CARD_BACK}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = CARD_BACK;
                      }}
                      className="aspect-[63/88] w-full rounded-lg border border-neutral-200 object-cover"
                    />
                    {!!c.onSale && (
                      <span className="absolute left-1 top-1 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {c.onSale}건
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] font-semibold text-black">{c.name}</p>
                  {/* 전체에서 찾은 결과라 어느 세트인지가 중요하다. */}
                  <p className="truncate text-[11px] text-neutral-400">{c.setName}</p>
                  {c.lowest != null && (
                    <p className="text-[11px] font-bold text-black">{c.lowest.toLocaleString()}원~</p>
                  )}
                </button>
              ))}
            </div>
          </>
        )
      ) : !currentSet || cards === null ? (
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
      </>
      )}
    </div>
  );
}
