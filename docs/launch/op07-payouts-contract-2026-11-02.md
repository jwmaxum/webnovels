# OP-07 작가 정산 요청·확정 수익·지급 TEST 계약

2026-11-02 (Asia/Seoul). OP05 원충전 소비와 OP06의 권리 구분을 확장한다. 신규 022 SQL은 검토 후 합성 DB에서만 적용한다. 운영 DB·기능 플래그·실제 계좌·개인정보 접수·외부 이체·광고사 매출은 변경하지 않는다. R13 수동 서류 확인을 PASS·은행·세무 검증으로 승격하지 않는다.

## 수익·예약·지급

수익 후보는 `op05_allocations` 중 TOPUP lot의 양수 `amount_krw`다. 구매 스냅샷의 author_id/work_id에 귀속한다. 원충전 수납과 소비 매출을 중복 합산하지 않는다. TEST 선물·이전 잔액·무료권·내부 광고 증빙·구형 author_earnings/author_settlements는 수익에 자동 포함하지 않는다. 정책은 기본 비활성이며 authorBps/deductionBps를 명시하고 활성화해야 한다. 이 비율은 합성 정책으로 실제 계약·세율이 아니다.

확정 분개는 allocation별 한 번, 정책 버전·원금·작가 배분·공제·순액을 불변으로 저장한다. 작가 배분=floor(원금×authorBps/10000), 정책 공제=floor(작가 배분×deductionBps/10000)이며 두 비율은0~10000이다. 명시적인0원 순액 결정도 재확정하지 않도록 고정한다. 원거래 UNKNOWN/REVIEW/REFUND_UNKNOWN 또는 불완전 승인에서는 확정하지 않는다. 확정 후 같은 불확실성이 생겨도 현재 신청·지급 직전에 원거래를 다시 검사한다. 미사용분 정상 환불은 소비 분개를 삭제하지 않는다. 감액은 원분개에 연결한 불변 조정이며 원순액을 초과하지 않는다. 이미 지급한 금액은 역사에서 삭제하지 않고 부족액을 표시한다.

신청 가능액=max(확정 순액−감액−기지급−유효 예약−원천 보류,0). 부족액=max(기지급+유효 예약−조정 후 순액,0). 전체 관리자 합계는 각 작가의 신청 가능액·부족액을 따로 합산하며 다른 작가의 수익으로 부족액을 상계하지 않는다. REQUESTED/APPROVED/UNKNOWN은 예약이다. 정산 요청·감액·승인·지급은 작가별 transaction advisory lock을 공유하고 원주문을 일정 순서로 잠근다. 승인만으로 지급하지 않는다. begin은 실제 전송 없이 UNKNOWN 모의 상태로 이동하고 예약을 유지한다. UNKNOWN·시간 경과·이동은 취소·예약 해제 사유가 아니다. 정확한 실패 증빙이나 성공 증빙으로만 종료한다. fail의 금액은 동결 신청 금액, 시각은 서버 현재 시각으로 기록하는 LOCAL_SIMULATED 결과다.

payee는 실제 계좌가 아닌 `TEST-` 접두 참조와 별도 단조 revision이다. 기존 R13 계좌를 복사·검증하지 않는다. 발송 전 현재 payee revision 불일치·미준비·작가 정지는 보류하고 취소 후 재신청한다. UNKNOWN 이후에는 실행 당시 동결 payee에 맞는 증빙을 대조하며, 뒤의 계좌 변경·정지·수익 조정은 이미 실행한 결과의 기록을 막거나 재발송 근거가 되지 않는다. 성공/확정 실패 거래 참조는 전체 결과에서 고유하고 같은 증빙의 재현은 중복 지급하지 않는다.

## API·DTO

서버 경로는 작가 `/api/v2/creator/payouts-test`, 최고 관리자 `/api/v2/admin/payouts-test`다. 서비스 전용 RPC `public.op07_payouts(p_user uuid,p_action text,p_data jsonb)`를 사용한다. API와 DB가 현재 계정·작가/최고 관리자 권한을 재검증한다. 새 private 테이블/보조 함수는 브라우저와 service_role 직접 접근을 금지하고 이 RPC만 서비스 EXECUTE한다. 기존 routine 본문·ACL·행은 변경하지 않는다.

모든 결과의 공통 필드는 `{mode:'TEST',provenance:'LOCAL_SIMULATED',currency:'KRW',livePayouts:false}`다. ID/정책 버전/requestId는 UUID, authorId/workId와 revision은 십진 문자열, 금액·bps·offset은 정수다. reason은 제어문자 없는 3~300자이며 개인정보를 입력하지 않는다. testReference/reference는 `TEST-[A-Za-z0-9_-]{1,72}`다. 쓰기는 requestId별 지문 멱등·행 revision과 모든 신규 쓰기 분당60회 제한을 적용한다. 서버의 분 단위 고정 창 카운터는 회원당1행이며 업무 거절도 횟수를 소비한다. 정확한 재시도는 제한 전에 원결과를 재현하며 내용 변경은409다.

policy: `{id,enabled,authorBps,deductionBps}`. payee: `{revision,ready,testReference}`(미등록은 revision:'0',ready:false,testReference:null). summary: `{confirmedKrw,deductedKrw,netKrw,paidKrw,reservedKrw,heldKrw,availableKrw,debtKrw}`. confirmedKrw는 정책 공제 후 감액 전 순액, deductedKrw는 이후 감액, netKrw는 차액이다. heldKrw는 불확실한 원천의 조정 후 순액이다. 순액과 금액은 TEST 정수 KRW다.

payout: `{id,authorId,authorName,amountKrw,status,revision,policyVersion,payeeRevision,testReference,createdAt,approvedAt,dispatchedAt,completedAt,evidence}`. evidence는 null 또는 `{outcome:'PAID'|'FAILED',reference,testReference,amountKrw,occurredAt,source:'LOCAL_SIMULATED'}`다. 목록 응답은 `{items,offset,limit:50,total,hasMore,nextOffset}`다.

| 작가 action | 입력 | 결과 |
| --- | --- | --- |
| summary | {} | authorId,policy,payee,summary,eligibility:{canRequest,authorActive,accountReady,sourceHold} |
| earnings | {offset:0} | 원천·정책·공제·조정의 명세 페이지 |
| requests | {status:'ALL',offset:0} | 본인 payout 페이지 |
| request-detail | {payoutId} | payout |
| request | {amountKrw,policyVersion,payeeRevision,requestId} | payout,summary,replayed |
| cancel | {payoutId,revision,reason,requestId} | payout,summary,replayed (REQUESTED/APPROVED만) |

| 관리자 action (RPC에는 admin- 접두) | 입력 | 결과 |
| --- | --- | --- |
| state | {} | revision,policy,summary (전체 작가 합계) |
| policy | {enabled,authorBps,deductionBps,revision,reason,requestId} | revision,policy,summary,saved,replayed |
| authors | {offset:0,query:''} | id,penName,status,payee,summary 페이지 |
| payee | {authorId,ready,testReference,revision,reason,requestId} | authorId,payee,summary,replayed |
| sources | {offset:0,authorId?:문자열} | allocationId,purchaseId,authorId,authorName,workId,workTitle,sourceAmountKrw,points,createdAt,orderStatus,eligible,earningId 페이지 |
| earnings | {offset:0,authorId?:문자열} | 확정 수익과 감액 근거 페이지 |
| confirm | {allocationId,policyVersion,reason,requestId} | earning,summary,replayed |
| adjust | {earningId,amountKrw,reason,requestId} | earning,summary,replayed (양수 감액) |
| requests | {status:'ALL',offset:0,authorId?:문자열} | payout 페이지 |
| detail | {payoutId} | payout |
| approve/reject/begin | {payoutId,revision,reason,requestId} | payout,summary,replayed |
| paid | {payoutId,revision,reference,testReference,amountKrw,paidAt,reason,requestId} | payout,summary,replayed |
| fail | {payoutId,revision,reference,testReference,reason,requestId} | payout,summary,replayed (UNKNOWN의 모의 확정 실패) |

earning: `{id,allocationId,authorId,workId,workTitle,sourceAmountKrw,authorGrossKrw,policyDeductionKrw,netKrw,adjustedKrw,availableNetKrw,sourceHeld,policyVersion,createdAt,adjustments:[{id,amountKrw,reason,createdAt}]}`. 원분개마다 감액 최대100개로 응답 크기를 제한한다. availableNetKrw는 해당 원분개 순액−감액이며 전체 신청 가능액과는 구분한다. 목록 상태는 ALL/REQUESTED/APPROVED/UNKNOWN/PAID/FAILED/REJECTED/CANCELLED다.

## 검증·후속

합성 DB의 실제 SET ROLE, 명시 ACL/RLS, 기존 SQL·행·routine 보존, 위조·타 작가·재시도·초과 신청·승인/지급 분리·불확실 예약·계좌 변경·증빙 고유·후속 감액과 부족액을 검증한다. PGlite 단일 인스턴스는 네이티브 PostgreSQL 다중 연결·실제 은행·브라우저 인수가 아니다.

다음 OP08은 실제 제공자 TEST/은행 대사·다중 연결 경쟁·독립 복원과 R13 개인정보·계좌/세무 준비 인수다. 확정 광고 매출 importer와 외부 지급 계약도 별도로 검토한다. 신규 TEST 정책을 실제 비율이나 세율로 전환하지 않는다.

조사: [Toss 지급대행](https://docs.tosspayments.com/guides/v2/payouts), [멱등성](https://docs.tosspayments.com/en/api-guide), [PostgreSQL 잠금](https://www.postgresql.org/docs/17/explicit-locking.html), [공식 결제 예제](https://github.com/tosspayments/payment-samples)를 확인했다. 지급 접수와 최종 성공을 구분하고, 미확정 요청에서 멱등키를 바꿔 재전송하지 않는다. 새 의존성 없이 기존 SQL/WebCrypto/Node/PGlite를 확장한다. npm/PyPI는 추가 패키지가 필요하지 않아 생략했고 정산 전용 MCP는 없었다.
