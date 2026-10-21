// Reviewed activation is required before these versioned documents may collect consent.
export const authorEnrollmentDocuments = Object.freeze([
  {id:'copyright-own', version:'2026-10-21.1', title:'저작권·비도용 확약 (본인 창작)', text:'본인은 게재하는 작품을 직접 창작하였으며 해당 작품의 저작권이 본인에게 귀속됨을 확약합니다. 타인의 창작물을 도용하거나 제3자의 권리를 침해하지 않았음을 확인합니다. 본인의 도용 또는 권리 침해로 발생하는 민사·형사 등 법적 책임은 관련 법령에 따라 본인이 부담하며, 권리 확인 요청과 분쟁 해결 절차에 협조합니다. 작품별 발행 시 권리 관계를 다시 확인합니다. 저작권은 권리자에게 남으며 플랫폼에는 서비스에 필요한 게시·유통 범위의 이용만 허락합니다. 플랫폼 자신의 법정 책임을 작가에게 이전하는 동의가 아닙니다.'},
  {id:'copyright-licensed', version:'2026-10-21.1', title:'공동 창작·이용허락 작품 권리 확약', text:'본인은 공동 창작·각색·이용허락 작품을 게재하는 데 필요한 저작권 또는 정당한 이용 권한을 확보하였음을 확약합니다. 본인에게 없는 타인의 저작권을 본인 소유로 표시하거나 타인의 창작물을 도용하지 않습니다. 작품별로 기여자·원작자와 이용허락 근거를 확인하고 필요한 표시를 하겠습니다. 본인의 도용 또는 권리 침해로 발생하는 민사·형사 등 법적 책임은 관련 법령에 따라 본인이 부담하며, 권리 확인 요청과 분쟁 해결 절차에 협조합니다. 저작권은 해당 권리자에게 남습니다. 플랫폼 자신의 법정 책임을 작가에게 이전하는 동의가 아닙니다.'},
  {id:'identity-privacy', version:'2026-10-21.1', title:'작가 본인확인 개인정보 수집·이용 동의', text:'(주)얼토당토는 작가의 실명 본인확인, 동일 본인의 여러 계정 연결 및 가입 증빙을 위해 본인확인 결과와 거래번호, 확인 시각, 계정 식별자, 동의 문서·시각, 제공자가 제공한 CI 또는 DI의 서버 전용 HMAC 변환값을 처리합니다. 실명과 CI/DI 원문은 서버 확인 과정에서만 사용하고 저장하지 않으며 전화번호·주민등록번호·통신사 비밀번호를 수집하지 않습니다. 동의 및 계정 연결정보는 작가 계정 유지 기간 동안 보관하고 탈퇴 시 삭제합니다. 미완료 인증 정보는 24시간 이내 파기합니다. 제공자의 자체 처리 사항은 인증 화면의 별도 안내를 확인해 주세요. 동의를 거부할 수 있으나 본인확인을 필요로 하는 신규 작가 가입은 완료할 수 없습니다. 동일 본인의 별도 이메일 ID·필명 가입은 허용되며 계정별 작품 권한은 분리됩니다. 개인정보 문의·탈퇴 요청: bazier.stage@gmail.com.'}
]);
export async function enrollmentDocuments() {
  return Promise.all(authorEnrollmentDocuments.map(async doc => ({...doc, hash:
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(doc.text))),n=>n.toString(16).padStart(2,'0')).join('')})));
}
