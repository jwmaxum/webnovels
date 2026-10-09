// Detached TEST preview component. No checkout/SDK, browser receipts or live content unlock.
(function(root){
 'use strict';
 const labels={CREATED:'결제 전',APPROVING:'확인 중',UNKNOWN:'결과 확인 필요',PAID:'시험 결제 확인',
  REFUNDING:'환불 확인 중',REFUND_UNKNOWN:'환불 결과 확인 필요',REFUNDED:'시험 전액 환불 확인',FAILED:'결제되지 않음',REVIEW:'운영 검토 필요'};
 const won=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('ko-KR')+'원':'확인 필요';
 const add=(parent,tag,value)=>{const node=parent.ownerDocument.createElement(tag);node.textContent=value;parent.appendChild(node);return node;};
 function renderQuote(parent,quote){
  parent.replaceChildren();
  if(!quote||quote.mode!=='TEST'||quote.liveContentAccess!==false||quote.currency!=='KRW'||
   !Number.isSafeInteger(quote.amountKrw)||quote.amountKrw<1||!['OWN','RENT'].includes(quote.accessKind)||
   (quote.accessKind==='RENT'&&(!Number.isInteger(quote.durationHours)||quote.durationHours<1||quote.durationHours>8760))||
   typeof quote.terms!=='string'||typeof quote.policyVersion!=='string'||typeof quote.freeScope!=='string'){
   add(parent,'p','구매 조건을 확인할 수 없습니다.');return false;
  }
  add(parent,'strong','시험 구매 조건 · 실제 결제와 콘텐츠 해금은 제공되지 않습니다.');
  add(parent,'p','회차 가격: '+won(quote.amountKrw));
  add(parent,'p',quote.accessKind==='OWN'?'소장 · 이용 기간 제한 없음':'대여 · 승인 시점부터 '+quote.durationHours+'시간');
  add(parent,'p',quote.freeScope);add(parent,'p','정책 버전: '+quote.policyVersion);add(parent,'p',quote.terms);return true;
 }
 function renderOrder(parent,order){
  parent.replaceChildren();
  if(!order||order.mode!=='TEST'||order.liveContentAccess!==false||!Object.hasOwn(labels,order.status)){
   add(parent,'p','주문 상태를 확인할 수 없습니다.');return false;
  }
  add(parent,'strong',labels[order.status]);add(parent,'p','시험 주문 금액: '+won(order.amountKrw));
  if(['UNKNOWN','REFUND_UNKNOWN','APPROVING','REFUNDING','REVIEW'].includes(order.status))
   add(parent,'p','재구매하기 전에 서버 조회로 결과를 확인하세요.');
  if(order.expiresAt){const date=new Date(order.expiresAt);add(parent,'p','시험 권리 만료: '+(Number.isFinite(date.getTime())?date.toISOString():'확인 필요'));}
  add(parent,'p','이 시험 권리는 실제 독자 본문에 적용되지 않습니다.');return true;
 }
 function renderEarnings(parent,data){
  parent.replaceChildren();
  if(!data||data.mode!=='TEST'||data.payableKrw!==0||data.paidKrw!==0||data.payoutStatus!=='NOT_AVAILABLE'||
   !Number.isSafeInteger(data.confirmedTestKrw)) {add(parent,'p','수익 정보를 확인할 수 없습니다.');return false;}
  add(parent,'strong','시험 원장 수익 · 이전 수익 자료와 별도');
  add(parent,'p','예상 수익: 집계 전');add(parent,'p','확정 시험액: '+won(data.confirmedTestKrw));
  add(parent,'p','지급 가능: 0원 · 지급 완료: 0원');add(parent,'p','계좌 검증·운영 정책·송금 증빙 연결 전에는 정산을 신청할 수 없습니다.');return true;
 }
 root.PurchaseContract=Object.freeze({renderQuote,renderOrder,renderEarnings});
})(window);
