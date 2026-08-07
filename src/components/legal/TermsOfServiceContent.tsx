export function TermsOfServiceContent() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-neutral-700">
      <p>
        이 약관은 pokegre(이하 "서비스")가 제공하는 일본판·영문판 포켓몬 카드 시세 조회 및 커뮤니티 서비스의 이용 조건과
        절차, 이용자와 서비스 제공자의 권리·의무 및 책임사항을 규정합니다.
      </p>

      <section>
        <h3 className="font-bold text-black mb-1">제1조 (서비스의 성격 및 비공식 고지)</h3>
        <p>
          서비스는 개인이 운영하는 비영리 사이트로, ㈜ 포켓몬코리아, SNKRDUNK(스니커덩크), Pokémon Company 또는
          그 밖의 관련 상표권자와 아무런 제휴·후원·인증 관계가 없습니다. 서비스가 제공하는 카드 시세, 뉴스 등
          정보는 위 외부 사이트에서 공개적으로 제공하는 정보를 요약·인용한 것입니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">제2조 (정보 제공의 한계 및 면책)</h3>
        <p>
          서비스가 제공하는 가격 정보는 참고용이며 실제 매매·투자 판단의 근거로 사용해서는 안 됩니다. 서비스
          제공자는 정보의 정확성·완전성·최신성을 보장하지 않으며, 이용자가 이 정보를 신뢰하여 발생한 손해에 대해
          책임을 지지 않습니다. 외부 사이트의 사정으로 서비스 일부 기능이 예고 없이 중단되거나 변경될 수 있습니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">제3조 (이용자의 의무)</h3>
        <p>이용자는 다음 행위를 해서는 안 됩니다.</p>
        <ol className="list-decimal list-inside space-y-0.5 mt-1">
          <li>타인의 명예를 훼손하거나 개인정보를 무단으로 게시하는 행위</li>
          <li>불법 정보, 음란물, 욕설·혐오 표현 등을 게시하는 행위</li>
          <li>서비스에 부당한 부하를 주는 자동화된 접근(크롤링, 매크로 등)</li>
          <li>서비스를 영리 목적으로 무단 재배포하는 행위</li>
          <li>관계 법령을 위반하는 행위</li>
        </ol>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">제4조 (게시물의 관리)</h3>
        <p>
          이용자가 작성한 게시물의 저작권은 작성자 본인에게 있으나, 서비스 운영을 위해 필요한 범위 내에서 이를
          게시·저장·전송할 수 있는 권리를 서비스에 부여한 것으로 봅니다. 서비스 제공자는 제3조를 위반하거나 관계
          법령에 반하는 게시물에 대해 이용자의 신고 또는 자체 판단에 따라 사전 통지 없이 삭제하거나 게시를 중단할
          수 있습니다. 이용자는 게시물의 신고 기능을 통해 불법·부적절한 게시물을 신고할 수 있습니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">제5조 (계정 및 소셜 로그인)</h3>
        <p>
          서비스는 카카오, 네이버 등 외부 소셜 로그인을 통한 가입을 지원할 수 있으며, 이 경우 해당 사업자의
          이용약관 및 개인정보처리방침이 함께 적용됩니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">제6조 (약관의 변경)</h3>
        <p>서비스 제공자는 필요한 경우 이 약관을 변경할 수 있으며, 변경된 약관은 서비스 내 공지 후 효력이 발생합니다.</p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">제7조 (문의)</h3>
        <p>서비스 이용 및 게시물 신고와 관련한 문의는 아래 연락처로 접수합니다.</p>
        <p className="mt-1">이메일: guk132312@gmail.com</p>
      </section>

      <p className="text-xs text-neutral-400 pt-2 border-t border-neutral-200">시행일자: 2026년 7월 17일</p>
    </div>
  );
}
