import { useState } from 'react';
import { LegalModal } from './LegalModal';
import { TermsOfServiceContent } from './TermsOfServiceContent';
import { PrivacyPolicyContent } from './PrivacyPolicyContent';

type LegalDoc = 'terms' | 'privacy' | null;

export function Footer() {
  const [open, setOpen] = useState<LegalDoc>(null);

  return (
    <footer className="border-t border-neutral-200 px-4 py-6 text-center">
      <p className="text-xs text-neutral-400">
        pokegre는 개인이 운영하는 <strong>비공식 팬 사이트</strong>로, Nintendo · Creatures · GAME FREAK ·
        주식회사 포켓몬 · 포켓몬코리아 · SNKRDUNK(스니커덩크)와 제휴·승인·후원 관계가 없습니다.
        Pokémon 및 포켓몬 카드 게임은 각 권리자의 등록상표이며, 카드 이미지와 상표의 권리는 모두 각
        권리자에게 있습니다. 표시되는 시세는 참고용이며 실제 거래가와 다를 수 있습니다.
        권리 침해 신고는 guk132312@gmail.com 으로 보내 주시면 확인 후 조치하겠습니다.
      </p>
      <div className="mt-2 flex justify-center gap-3 text-xs text-neutral-400">
        <button type="button" onClick={() => setOpen('terms')} className="hover:text-neutral-600 hover:underline">
          이용약관
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => setOpen('privacy')} className="hover:text-neutral-600 hover:underline">
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
