import { useEffect, useRef, useState } from 'react';
import { reportCardTitleMiss } from '../api/localStats';

/**
 * 카드 이름(한글화)이 이상할 때 알려주는 자리. 카드 상세 세 곳(스니덩크·이베이·
 * TCGplayer)이 **같이 쓴다.**
 *
 * ⚠️⚠️ **세 곳에 따로 그리지 말 것.** 예전엔 세 파일이 각자 같은 단추를 그리고 있어서
 *    한 곳만 고치면 나머지 둘이 조용히 어긋났다(커뮤니티 좋아요에서 이미 한 번 겪었다).
 *
 * ⚠️⚠️ **「보내기」를 누르기 전에는 아무것도 안 보낸다**(2026-08-18, 사장님 지시).
 *    그전에는 단추를 누르는 즉시 접수돼서 **잘못 눌러도 무를 수가 없었고**, 신고가
 *    들어와도 무엇이 불만인지 알 수가 없었다. 메모 칸은 덤이 아니라 **잘못 눌린 신고를
 *    막는 장치**다 — 그래서 「그만두기」가 반드시 있어야 한다.
 *
 * ⚠️ **메모는 비워도 보낼 수 있다.** 한 글자를 강요하면 쓰기 싫은 사람이 그냥 지나가
 *    버려서, 예전에 알려주던 것마저 못 받게 된다.
 */

// 서버도 같은 길이로 자른다(server/api.ts의 translation-feedback). 여기서 막는 것은
// 사람이 화면에서 알아채라고 두는 것이지, 이것만 믿고 서버를 열어 두면 안 된다.
const 메모최대 = 200;

export function CardNameReport({
  title,
  raw,
  link,
  className = '',
}: {
  /** 화면에 보인 한글 이름 */
  title: string;
  /** 한글로 바꾸기 전 원본 이름 */
  raw: string;
  /** 그 카드의 원본 링크 */
  link: string;
  /** 바깥 여백. 자리마다 위아래 간격이 달라서 부르는 쪽이 정한다. */
  className?: string;
}) {
  // 닫힘 → 열림 → 보냄. 셋뿐이라 따로 상태를 안 나눈다.
  const [상태, 상태바꿈] = useState<'닫힘' | '열림' | '보냄'>('닫힘');
  const [메모, 메모바꿈] = useState('');
  const 칸ref = useRef<HTMLTextAreaElement>(null);

  // ⚠️ 다른 카드를 열면 되살아나야 한다. 안 그러면 앞 카드에서 한 번 보낸 뒤
  //    다음 카드들이 전부 「감사합니다」로 보여 아무도 알려줄 수가 없다.
  useEffect(() => {
    상태바꿈('닫힘');
    메모바꿈('');
  }, [link]);

  // 칸이 열리면 바로 쓸 수 있게 한다.
  useEffect(() => {
    if (상태 === '열림') 칸ref.current?.focus();
  }, [상태]);

  if (상태 === '보냄') {
    return <p className={`text-[11px] text-neutral-400 ${className}`}>알려주셔서 감사합니다. 이름을 고치겠습니다.</p>;
  }

  if (상태 === '닫힘') {
    return (
      <button
        type="button"
        onClick={() => 상태바꿈('열림')}
        // ⚠️ 글줄이 17px이라 누르기 어려웠다(운영자 지시 2026-08-06). 여백으로 40px까지
        //    넓히되 -my로 되돌려 줄 간격은 그대로 둔다.
        className={`-my-3 py-3 text-[11px] text-neutral-400 underline hover:text-neutral-600 ${className}`}
      >
        카드 이름이 이상한가요?
      </button>
    );
  }

  return (
    <div className={`rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 ${className}`}>
      <p className="mb-1.5 text-[11px] text-neutral-600">무엇이 이상한가요? 안 쓰고 보내셔도 됩니다.</p>
      <textarea
        ref={칸ref}
        value={메모}
        onChange={(e) => 메모바꿈(e.target.value.slice(0, 메모최대))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') 상태바꿈('닫힘');
        }}
        rows={2}
        placeholder="예: 파미리마토가 아니라 패밀리마트입니다"
        className="w-full resize-none rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 placeholder:text-neutral-400"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            reportCardTitleMiss(title, raw, link, 메모.trim());
            상태바꿈('보냄');
          }}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-neutral-700"
        >
          보내기
        </button>
        <button
          type="button"
          onClick={() => {
            메모바꿈('');
            상태바꿈('닫힘');
          }}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-[11px] text-neutral-600 hover:bg-neutral-100"
        >
          그만두기
        </button>
        {/* ⚠️ 칸 바탕이 흰색이 아니라 neutral-50이다. neutral-400으로 두었더니 밝은
            화면에서 대비가 2.48이었다(4.5 아래). 한 칸 진하게 쓴다. */}
        <span className="ml-auto text-[10px] tabular-nums text-neutral-500">
          {메모.length} / {메모최대}
        </span>
      </div>
    </div>
  );
}
