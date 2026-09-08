import { useState } from 'react';
import { LegalModal } from './LegalModal';
import { TermsOfServiceContent } from './TermsOfServiceContent';
import { PrivacyPolicyContent } from './PrivacyPolicyContent';

type LegalDoc = 'terms' | 'privacy' | null;

export function Footer() {
  const [open, setOpen] = useState<LegalDoc>(null);

  return (
    <footer className="border-t border-neutral-200 px-4 py-6 text-center">
      {/* ⚠️⚠️ **data-nosnippet — 구글이 이 글을 검색 결과 발췌로 쓰지 못하게 막는다.**
          2026-08-31에 `pokegre`로 검색해 보니 하위 링크 여섯 개가 **전부** 이 고지문이었다
          ("pokegre는 개인이 운영하는 비공식 팬 사이트로, Nintendo …"). 까닭을 재 보니
          세트 화면 1,451자 중 **문장다운 문장이 이 고지문뿐**이었다 — 나머지는 카드 이름
          목록이라 구글이 가져갈 게 이것밖에 없었다.
          ⚠️ 사람에게는 그대로 보인다. 검색 발췌로만 안 쓰인다.
          ⚠️ 이걸 막으면 구글은 대개 우리가 적어 둔 설명(meta description)을 쓴다.
             그래서 **설명을 제대로 적어 두는 것이 짝**이다. */}
      <p className="text-xs text-neutral-400" data-nosnippet>
        pokegre는 개인이 운영하는 <strong>비공식 팬 사이트</strong>로, Nintendo · Creatures · GAME FREAK ·
        주식회사 포켓몬 · 포켓몬코리아 · SNKRDUNK(스니커덩크)와 제휴·승인·후원 관계가 없습니다.
        Pokémon 및 포켓몬 카드 게임은 각 권리자의 등록상표이며, 카드 이미지와 상표의 권리는 모두 각
        권리자에게 있습니다. 표시되는 시세는 참고용이며 실제 거래가와 다를 수 있습니다.
        권리 침해 신고는 guk132312@gmail.com 으로 보내 주시면 확인 후 조치하겠습니다.
      </p>
      <div className="mt-2 flex justify-center gap-3 text-xs text-neutral-400">
        <button type="button" onClick={() => setOpen('terms')} className="-my-2 py-2 hover:text-neutral-600 hover:underline">
          이용약관
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => setOpen('privacy')} className="-my-2 py-2 hover:text-neutral-600 hover:underline">
          개인정보처리방침
        </button>
      </div>

      {open === 'terms' && (
        <LegalModal title="이용약관" onClose={() => setOpen(null)}>
          <TermsOfServiceContent />
        </LegalModal>
      )}
      {open === 'privacy' && (
        <LegalModal title="개인정보처리방침" onClose={() => setOpen(null)}>
          <PrivacyPolicyContent />
        </LegalModal>
      )}
    </footer>
  );
}
