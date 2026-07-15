export function PrivacyPolicyContent() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-neutral-700">
      <p>
        pokegre(이하 "서비스")는 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」 등 관계 법령을
        준수합니다. 본 방침은 서비스가 어떤 개인정보를 수집·이용·보관하는지 안내합니다.
      </p>

      <section>
        <h3 className="font-bold text-black mb-1">1. 수집하는 개인정보 항목</h3>
        <ul className="list-disc list-inside space-y-0.5">
          <li>소셜 로그인(카카오, 네이버) 이용 시: 닉네임, 프로필 사진, 서비스별 식별자, 이용자가 동의한 경우 이메일 주소</li>
          <li>커뮤니티 게시판 이용 시: 작성자가 직접 입력한 닉네임, 게시글·댓글 내용</li>
          <li>카드 촬영 검색 기능 이용 시: 이용자가 촬영하거나 선택한 카드 이미지</li>
          <li>서비스 이용 과정에서 자동 수집: 접속 IP, 접속 일시, 검색어(개인 식별 없이 인기 검색어 집계 목적으로만 사용)</li>
        </ul>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">2. 개인정보의 수집 및 이용 목적</h3>
        <ul className="list-disc list-inside space-y-0.5">
          <li>회원 식별 및 로그인 서비스 제공</li>
          <li>커뮤니티 게시판 운영(게시물 작성자 표시, 부정 이용 방지)</li>
          <li>카드 이미지에서 카드명·세트 정보를 인식하여 검색어로 제공</li>
          <li>인기 검색어 통계 등 서비스 개선</li>
          <li>불법 게시물 신고 처리 및 이용 제한</li>
        </ul>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">3. 개인정보의 보유 및 이용 기간</h3>
        <p>
          회원 탈퇴 시 지체 없이 파기합니다. 다만 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.
          게시글·댓글은 이용자가 삭제하거나 서비스 운영자가 이용약관 위반을 이유로 삭제할 때까지 보관합니다. 검색어
          통계는 개인을 식별할 수 없는 집계 형태로만 보관합니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">4. 개인정보의 제3자 제공</h3>
        <p>
          서비스는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 카카오·네이버 소셜 로그인 인증
          과정에서 해당 사업자와 필요한 최소한의 정보가 연동될 수 있습니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">5. 개인정보 처리의 위탁</h3>
        <p>서비스는 별도의 개인정보 처리 위탁을 하지 않습니다. 위탁이 발생하는 경우 이 항목을 갱신하여 고지합니다.</p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">6. 개인정보의 국외 이전</h3>
        <p>
          서비스의 <strong>카드 촬영 검색</strong> 기능은 이용자가 촬영한 카드 이미지를 AI 분석 사업자에게 전송하여
          카드명을 인식합니다. 이 과정에서 아래와 같이 개인정보가 국외로 이전됩니다.
        </p>
        <ul className="list-disc list-inside space-y-0.5 mt-2">
          <li>이전받는 자: Anthropic PBC</li>
          <li>이전되는 국가: 미국</li>
          <li>이전되는 항목: 이용자가 촬영하거나 선택한 카드 이미지</li>
          <li>이전 일시 및 방법: 이용자가 카드 촬영 기능을 사용하는 시점에 암호화된 통신(HTTPS)으로 전송</li>
          <li>이전받는 자의 이용 목적: 이미지에서 카드명·세트 코드·카드 번호를 인식</li>
          <li>보유 및 이용 기간: 이전받는 자의 정책에 따르며, 서비스는 전송한 이미지를 별도로 저장하지 않습니다</li>
        </ul>
        <p className="mt-2">
          이용자는 카드 촬영 기능을 사용하지 않음으로써 이 국외 이전을 거부할 수 있으며, 이 경우에도 직접 검색어를
          입력하는 등 서비스의 다른 기능은 정상적으로 이용할 수 있습니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">7. 이용자의 권리</h3>
        <p>
          이용자는 언제든지 자신의 개인정보에 대한 열람, 정정, 삭제, 처리정지를 요구할 수 있으며, 회원 탈퇴를 통해
          서비스 이용을 중단할 수 있습니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">8. 쿠키의 사용</h3>
        <p>
          서비스는 로그인 상태 유지 등을 위해 쿠키를 사용할 수 있습니다. 이용자는 브라우저 설정을 통해 쿠키 저장을
          거부할 수 있으며, 이 경우 일부 서비스 이용에 제한이 있을 수 있습니다.
        </p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">9. 개인정보 보호책임자</h3>
        <p>이메일: guk132312@gmail.com</p>
      </section>

      <section>
        <h3 className="font-bold text-black mb-1">10. 방침의 변경</h3>
        <p>이 개인정보처리방침이 변경되는 경우 서비스 내 공지사항을 통해 고지합니다.</p>
      </section>

      <p className="text-xs text-neutral-400 pt-2 border-t border-neutral-200">시행일자: 2026년 7월 15일</p>
    </div>
  );
}
