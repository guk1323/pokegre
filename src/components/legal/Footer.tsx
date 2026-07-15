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
        pokegre는 개인이 운영하는 시세 참고용 사이트로, 포켓몬코리아·SNKRDUNK(스니커덩크) 및 관련 상표권자와
        제휴·후원·인증 관계가 없습니다. 표시되는 시세는 참고용이며 실제 거래가와 다를 수 있습니다.
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
