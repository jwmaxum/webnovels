const version='2026-11-01-settlement-v1';
const privacyText='정산 준비를 신청한 작가의 은행명·예금주·계좌번호, 본인 정보·서류 확인을 신청한 경우 성명·생년월일·주소와 신청 유형에 따른 상호·사업자등록번호, 번호를 가린 신분증 및 사업자등록 증빙을 정산 계좌 관리와 수동 서류 검토 목적으로 처리합니다. 동의를 거부할 수 있으며, 거부하면 정산 준비 신청이 제한됩니다. 작품 작성·무료 발행에는 영향을 주지 않습니다. 서류 확인은 PASS 인증이나 금융기관 예금주 조회를 대신하지 않으며 실제 지급은 별도로 준비합니다.';
const retentionText='신청 중인 서류와 본인 정보는 최대 7일, 서류 확인 종료 시 첨부 이미지는 즉시 파기합니다. 확인한 본인 신청 정보는 제출일부터 최대 90일 또는 해당 신청 철회 시까지 보관합니다. 계좌 정보는 등록을 유지하는 동안 보관하고 별도의 계좌 삭제 요청 시 파기합니다. 본인 정보·서류 신청 철회와 계좌 삭제는 별도입니다. 원문 없는 접근·처리 감사 기록은 2년, 중복 요청 확인 기록은 30일 보관합니다.';
const redactionText='이름·사진·생년월일만 확인할 수 있도록 주민등록번호 뒷자리, 면허번호, 여권번호, MRZ·바코드·서명 등 불필요한 항목을 가려 제출해주세요. 사업자 증빙에서도 계좌·연락처 등 불필요한 정보를 가려주세요. 전체 주민등록번호를 이미지나 주소·메모에 입력하지 마세요.';
const taxText='전체 주민등록번호는 현재 신청에서 수집하지 않습니다. 개인의 실제 원천징수·지급명세서 제출이 필요한 단계에서 법적 근거와 보관 기간을 별도로 안내합니다. 개인사업자·법인은 사업자 유형에 맞는 세무 자료를 별도로 확인합니다.';
const transferNoticeVersion='2026-11-01-transfer-draft-v1';
const transferNoticeText='국외 보관·처리 안내 초안: 현재 운영 Supabase 데이터베이스 리전은 인도(뭄바이)입니다. Cloudflare Pages/Functions는 글로벌 인프라에서 요청을 처리할 수 있습니다. 실제 이전받는 자와 연락처, 처리 국가·목적·항목, 이전 시기·방법, 보유 기간, 거부 방법과 영향 및 적용 법적 근거는 운영자가 계약과 처리 조건을 확인한 뒤 확정해야 합니다. 이 초안이나 체크박스만으로 수집을 시작하지 않습니다.';
const collectionInfoText='국외 보관 안내·동의와 계약·처리 조건의 검토가 끝나기 전에는 계좌·본인 정보·신분증 제출을 받지 않습니다. 검토가 끝나면 최종 안내를 확인하고 별도로 동의한 뒤 신청할 수 있습니다.';
export function settlementTransferNoticeReady(env){
 const noticeVersion=env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION,noticeText=env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT;
 return typeof noticeVersion==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(noticeVersion)&&!/draft/i.test(noticeVersion)&&
  typeof noticeText==='string'&&noticeText.trim().length>=200&&noticeText.length<=8000&&!noticeText.includes('\0');
}
export async function settlementPolicy(env={}){
 const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
 const texts={version,privacyText,retentionText,redactionText,taxText},finalized=settlementTransferNoticeReady(env);
 const noticeVersion=finalized?env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION:transferNoticeVersion,noticeText=finalized?env.AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT:transferNoticeText;
 return {...texts,hash:await hash(JSON.stringify(texts)),transferNoticeVersion:noticeVersion,transferNoticeHash:await hash(noticeVersion+'\n'+noticeText),transferNoticeText:noticeText,transferNoticeFinalized:finalized,collectionInfoText};
}
