# OP-05 충전상품·입금 대조·카드 승인/환불 구현 계약

2026-11-02 TEST 구현·합성 검증 완료. [OP-04](op04-points-test-contract-2026-11-02.md)와 [운영 계획](admin-cms-minimal-ux-plan-2026-11-01.md)을 확장한다. 운영 DB·플래그·실제 PG·기존 실제 잔액은 변경하지 않는다. 현재 계약이 없는 LIVE는 닫고, LOCAL_SIMULATED 합성 검증과 주입형 LOCAL 모의 전송과 PROVIDER_TEST 구현을 구분한다.

## 격리·원장

- 기존 `pointsTestEnabled(env)` 조건에 `CHARGING_TEST_ENABLED=true`가 추가되어야 충전 API를 연다. 실제 제공자 호출은 별도로 `CHARGING_TEST_PROVIDER=PROVIDER_TEST` + 검토된 TEST 키/MID/설정 버전 조건이 있어야 한다. 로컬 모의 결과는 서버가 주입한 테스트 전송만 사용하며 브라우저 성공값을 영수증으로 받지 않는다.
- `database/launch/020_topups_test.sql`은 검토 gate가 있는 미적용 추가 SQL이다. 019 원본은 수정하지 않는다. 공유 commerce 스키마 ACL·기존 자료를 보존하고 새 private 테이블/RPC에 명시 ACL·RLS·고정 search_path를 적용한다.
- 020은 public `op04_points_test`의 기존 검증된 본문을 private base로 보존하고 같은 public signature의 wrapper를 둔다. service 역할의 private base 직접 EXECUTE는 금지한다. 기존 구매 경로도 예약액 보호·FIFO lot 소비를 거친다. 기존 API/클라이언트의 CORE 권한은 확장하지 않는다.
- 기존 OP-04 잔액은 시점·원장 해시/건수를 고정한 환불 불가 `OPENING_TEST_BALANCE` lot로만 보존한다. 과거 거래 순서를 UUID로 추정하지 않는다. 이후 `admin-credit`은 환불 불가 `TEST_GIFT`, 검증된 주문 적립은 `TOPUP` 출처다.
- OP-04 포인트 원장을 확장해 TOPUP/REFUND 종류와 원주문/환불 참조를 추가한다. 기존 CREDIT/DEBIT 행과 권리는 보존한다. 별도 KRW 카드 직접구매(stage20)·구형 포인트와 합산하지 않는다.
- 총 잔액 = 사용 가능 P + 환불 예약 P. 원장 합은 총 잔액과 같고, 구매는 사용 가능액만 쓴다. wallet/quote/purchase의 `balancePoints`는 사용 가능액을 의미하며 `totalPoints`·`reservedPoints`를 함께 반환한다. v1 응답은 두 추가 필드가 없는 경우만 총액=balance/예약0으로 취급한다.

## 상품·주문·입금

최고 관리자만 상품을 변경한다. 상품은 UUID와 불변 버전 UUID, 제목·KRW 정수 가격·지급 P·활성 여부·판매 기간·주문 기한(분)을 가진다. 금액과 P는 각각 1~1,000,000, 주문 기한 5~1440분이다. 초기 상품 자동 seed는 없다. 사용자에게 명시한 상품 버전/조건과 현재 버전이 다르면 409이며, 생성된 주문 조건은 나중 상품 변경과 독립된다.

주문은 사용자 UUID·상품 버전·KRW·P·기한·BANK/CARD·판매자 TEST binding을 고정한다. 생성은 본인+requestId 멱등, 주문번호는 UUID, 공개 checkout ID는 `wn05-UUID`이다. 소유자 외 본인 주문 조회·승인 금지, 관리자는 현재 SUPER_ADMIN 재검증 후 업무 조회/변경한다.

수동 입금 확인은 은행 원거래 키·실제 입금액·입금 시각·확인 사유와 주문을 대조한다. 거래 키는 전체 주문에서 한 번만 사용한다. 독자 입금 신고로 적립하지 않는다. 기한 이후 입금·금액 불일치는 REVIEW로 남기고, 허용된 정확한 대조만 원장·lot·잔액에 한 번 반영한다. BANK 환불의 최종 완료는 별도 은행 이체 거래 키·정확한 환불 금액·시각·사유를 확인해야 한다.

## 소비·환불

지갑 잠금 아래 사용자별 단조 lot 순번을 부여하고 FIFO로 소비한다. 구매와 lot별 소비 P·배정 KRW를 같은 transaction에 남긴다. 소비 KRW의 누계는 `ceil(원금 KRW × 누적 소비 P / 발행 P)`이고 각 소비의 배정액은 누계 차이다. 첫 소비 후 전액 현금 환불을 받는 반올림 우회를 막고, 1P=1원을 가정하지 않는다. 이 방식은 TEST 정책으로 표시하며 실제 환불 약관·법적 기준은 LIVE 전 확정한다.

환불은 **원충전 한 건의 현재 미사용 P 전부**를 대상으로 한다. 일부 소비된 충전도 남은 전부를 환불할 수 있다. 환불 KRW는 원금−배정 소비 KRW−기확정 환불액이다. 임의 소량 분할 환불은 받지 않으며 환불액이 0원이면 명확히 거절한다. 예약 P는 먼저 잠그고 외부 전송은 DB transaction 밖에서 한다. 다른 lot는 계속 사용할 수 있다.

성공 시 포인트 회수·REFUND 원장·확정 이력·예약 해제를 한 번에 기록한다. 소비된 회차 권리와 과거 구매는 지우지 않는다. UNKNOWN/REFUND_UNKNOWN/REVIEW와 lease 만료는 예약 해제 근거가 아니다. 현재 DONE 조회만으로 환불을 실패 확정하거나 PAID로 되돌리지 않는다. 카드 환불은 원래 승인 주문·MID·총금액·요청 취소액·취소 거래키·누계·잔액을 대조한다. 현재 단일 서비스 취소 거래만 지원하고 예상 밖 외부 취소나 중복 취소는 REVIEW로 보존한다.

승인·조회·취소 operation은 안정 UUID/lease·90초 만료·영구 DB 거래 고유 제약을 가진다. 동일 requestId의 다른 내용은 409, 동일 결과는 재현한다. 취소 재시도는 같은 refund ID/멱등키만 사용하며 제공자 binding 변경 또는 15일 초과에는 변이 요청을 막는다. 키는 서버가 해시한 설정 binding으로 고정하고 원문 키를 DB·응답에 저장하지 않는다. 모르는 승인/취소는 query 우선이며 동일 operation의 안전한 재시도만 제공한다.

## API 공유 DTO

경로: 독자 `/api/v2/topups-test?action=...`, 최고 관리자 `/api/v2/admin/topups-test?action=...`. 모든 데이터는 `mode:TEST,provenance:LOCAL_SIMULATED`와 `providerMode:LOCAL_SIMULATED/PROVIDER_TEST`를 제공한다. GET은 strict query, POST는 동일 Origin·JSON 64KiB·정확한 필드만 허용한다. IDs/버전/request/lease는 UUID, revision은 bigint 문자열, 날짜는 UTC ISO다.

기본 card product `{id,versionId,title,amountKrw,points,enabled,startsAt,endsAt,expiresMinutes}`. order `{id,checkoutId,userId,productId,productVersion,title,method,amountKrw,points,status,createdAt,expiresAt,credited,refundablePoints,refundAmountKrw,refund:null/refund}`. 독자 DTO의 userId는 생략 가능하며 결제키·binding·은행 거래키·private transport는 직렬화하지 않는다. refund `{id,status,points,amountKrw,createdAt}`. 목록은 items/offset/limit:50/total/hasMore/nextOffset이다.

| 독자 action | 메서드·입력 | 결과 |
|---|---|---|
| products | GET offset=0 | 상품 페이지 |
| orders | GET offset=0 | 본인 주문 페이지 |
| order | GET orderId | order |
| create | POST {productId,productVersion,method,requestId} | order, replayed |
| checkout | POST {orderId} | 검토된 TEST clientKey·본인 customerKey·동결 주문 조건·복귀 URL |
| confirm | POST {orderId,paymentKey,expectedAmountKrw} | order (카드 서버 승인) |
| reconcile | POST {orderId} | order (본인 카드 결과 재조회) |
| refund | POST {orderId,reason,requestId} | order (미사용분 예약·카드 취소 또는 BANK 지급 대기) |
| retry-refund | POST {orderId} | order (같은 카드 취소 재시도, UNKNOWN이면 먼저 query) |

| 관리자 action | POST 입력 | 결과 |
|---|---|---|
| state | {} | revision, products:[product] 최근100 |
| product | {productId:null/UUID,title,amountKrw,points,enabled,startsAt,endsAt,expiresMinutes,revision,reason,requestId} | state, saved,replayed |
| orders | {status:ALL/REVIEW/UNKNOWN/REFUND_UNKNOWN/REFUND_PENDING/PAID/WAITING_DEPOSIT,offset:0} | 주문 페이지 |
| deposit | {orderId,bankReference,amountKrw,receivedAt,reason,requestId} | order,replayed |
| reconcile | {orderId} | order |
| refund | {orderId,reason,requestId} | order |
| retry-refund | {orderId} | order |
| bank-refund | {orderId,bankReference,amountKrw,paidAt,reason,requestId} | order,replayed |

DB RPC: `public.op05_topups(p_user uuid,p_action text,p_data jsonb)`의 action은 위와 같고 관리자 action은 admin-prefix다. provider 준비 작업은 `claim-confirm`,`claim-query`,`claim-refund`,`claim-refund-retry`,`admin-claim-query`,`admin-claim-refund`,`admin-claim-refund-retry`, 최종화는 서비스 전용 `public.op05_apply(p_order uuid,p_operation uuid,p_lease uuid,p_receipt jsonb)`를 사용한다. API가 안전한 일반 order DTO와 private transport를 분리한다. claim data에는 서버가 `{providerMode,merchantId,binding}`을 더하고 브라우저 입력은 받지 않는다. transport `{orderId,checkoutId,operationId,lease,operation:confirm/query/cancel,paymentKey,amountKrw,refundAmountKrw,expectedBalanceKrw,merchantId,binding,providerMode,reason,refundId,operationCreatedAt}`. receipt `{state:APPROVED/PENDING/NOT_PAID/CANCELLED/UNKNOWN/REVIEW,amountKrw,merchantId,paymentKey,approvedAt,transactionKey,cancelledAt,cancelAmountKrw,balanceKrw}`이다. 미해당 값은 null 가능하고 UNKNOWN은 state만 받는다.

핵심 상태: CREATED(CARD)/WAITING_DEPOSIT(BANK), APPROVING, UNKNOWN, PAID, REFUND_PENDING, REFUND_UNKNOWN, REFUNDED, REVIEW, EXPIRED. 주문당 활성 refund 한 개, provider operation lease 한 개이며 같은 취소를 새 환불 ID로 중복 생성하지 않는다. 결제 승인키/승인 거래키/취소 거래키/은행 원거래·환불 거래키는 출처별 영구 고유다.

## UI·소유권·검증

- 기존 6메뉴 유지. `결제·정산 → 결제·입금 / 환불·포인트 / 대사`를 `AdminTopups`로 연결하며 최고 관리자만 OP05 금융 업무를 읽고 변경한다. 기존 작가 정산 권한은 확장하지 않는다.
- `ReaderTopups`는 `/charging-test` 별도 화면에서 상품·본인 주문·카드/입금·환불을 제공한다. OP04 독자 화면에 명시적인 TEST 충전 링크를 둔다. 로컬 모의 카드 UI는 실제 카드 결제로 표시하지 않는다.
- PROVIDER_TEST에서 검토된 TEST client key로 공식 Toss v2 SDK를 사용자 클릭 시에만 로드한다. checkout POST가 SDK 실행 전에 판매자 binding을 동결한다. 복귀 쿼리는 history에서 제거하고 본인 주문/금액과 대조한 뒤 별도 승인 버튼으로 서버 확인한다. 복귀 경로는 no-referrer·no-store다. 기본 LOCAL은 SDK를 로드하지 않는다. 실제 업체 TEST/브라우저 인수는 별도다. 카드번호를 수집하지 않는다. 자동 웹훅/은행 송금은 열지 않고 서버 재조회·은행 증빙 대조를 제공한다. Toss 최신 서명 계약을 구형 비지원 가정으로 대체하지 않는다.
- root: 공통 account/config/router/auth/loader/nav 연결, OP04 wallet DTO/UI의 total/reserved/available·TOPUP/REFUND 호환, 통합 검증·문서·Git.
- DB worker: 020 SQL·fixture·DB tests·독립 리허설. 기존 함수 본문 보존 wrapper와 기존 구매 예약 우회 차단 포함.
- API worker: topups-test-api.mjs·provider transport/verifier·API/provider tests. 기존Toss/설정재사용, 주입형LOCAL 전송은 자동성공 금지·테스트만 주입.
- UI worker: admin-topups.js·reader-topups.js·topups CSS·UI VM tests. 공통파일 수정 금지.

환경변수·운영 DB를 사용하지 않는 합성 DB/API/VM/주입형 provider 검증과 실제 PostgreSQL 병렬성·실제 업체 TEST·브라우저 인수는 구분한다. 다음 OP-06은 광고 보상 세션·제공자 서버 증빙·열람권 발급이다. 실제 결제·환불·개인정보·정산 LIVE는 계약·약관·제공자/은행·복원/대사 인수 후 별도 출시 판정한다.

검증 결과: 신규 89개(DB 24/API·provider 18/UI 34/통합 13), 전체 릴리스 55개 명령·컴파일·독립 타입·5개 흐름 리허설 통과. 공개 providerMode는 현재 설정된 TEST 전송 경로이며 실제 금융 증거는 비공개 binding/영수증으로 검증한다. 실제 운영/업체/브라우저와 다중 연결은 미실행이다. [최종 구현 기록](op05-topups-implementation-2026-11-02.md)을 따른다.
