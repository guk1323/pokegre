import type { ReactNode } from 'react';

export function LegalModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* text-left: 이 모달은 text-center인 푸터 안에서 열려서, 명시하지 않으면
          약관 본문이 전부 가운데 정렬된다. */}
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-black">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
