# 20단계 유료 회차 시험 계약

상태: **로컬 준비 / 운영 NO_GO**, 2026-10-09. [20단계 계획](../../improve20.md), [수익화 계약](monetization-contract.md), [계좌 계약](author-dashboard-rollout.md)을 확장한다.

## 환경과 적용

- 첫 모델: 일반 카드, KRW, 유료 웹소설 한 회차 소장/기간 대여. 광고·포인트·후원·구독·성인·가상계좌·부분 환불·실제 지급은 미지원이다.
- 기존 fetch 어댑터를 확장했다. 공식 browser SDK는 향후 checkout 화면 후보이며 지금은 의존성을 추가하지 않는다. 이 조사에서 npm/gh CLI가 PATH에 없어 공개 npm/GitHub와 공식 문서를 사용했다. Toss MCP는 현재 도구에 없다.
- `MONETIZATION_SANDBOX_ENABLED=false`가 기본이다. 명시적 TEST 환경, 증거 출처, TEST 키, TEST 상점 ID, P0 서버 경계가 모두 맞아야 새 API가 열리고 LIVE는 열리지 않는다. `public-config`에는 서버 키·상점·sandbox 설정을 노출하지 않는다.
- LOCAL_SIMULATED와 PROVIDER_TEST를 정책/주문에 기록한다. 이번 테스트·리허설은 전부 **LOCAL_SIMULATED**이며 실제 TEST 업체 검증이 아니다. 정책·가격 seed는 마이그레이션에 없다. fixture의 101원·수수료 300bps·작가 7000bps는 합성 검증 값이다.
- `016_paid_episodes.sql`은 검토 후 적용할 추가 스키마다. 검토 gate와 authoring-014가 선행되며 PGlite fixture에서만 실행했다. 실제 미적용 마이그레이션을 번호순으로 일괄 적용하지 않는다. commerce 자료에는 브라우저와 service-role 직접 테이블 권한이 없고 서비스 전용 SECURITY DEFINER RPC만 사용한다.
- 이전 `author_earnings`, `earning_ledger`, 계좌와 `p0_episode_entitlements`를 조회·합산·변경하지 않는다. 시험 권리는 독자 목록/검색/본문/이미지에 연결하지 않았다. 현재 무료 오픈 경계가 유지된다.

## 주문·원장

서버가 로그인 사용자와 확인된 이메일/활성 독자를 검증한다. RPC가 상태와 권한을 재확인한다. 작가는 본인 author_id로만 수익을 조회하며 기존 SUPER_ADMIN만 시험 운영 재조회·전액 환불을 실행한다. 새 역할/영속 권한을 만들지 않는다.

견적은 회차 가격·KRW·무료 범위·소장/대여·승인 후 기간·정책/offer 버전을 제공한다. 주문 요청의 금액은 기대값 비교용이며 실제 값은 DB 정책에서 복사한다. 이전 견적의 가격/버전이 바뀌면 409다. Auth UUID·작가 bigint·작품/회차 bigint를 각각 저장한다. 공개된 일반 소설의 검증된 publication head와 소유자를 확인하며 숨김·성인·제한 작품은 판매 대상으로 보지 않는다.

- 사용자+요청 ID와 사용자+회차 advisory transaction lock으로 동일 요청을 재현하고 다른 payload는 거절한다. 활성 권리/미확정 주문이 있으면 새 구매를 막는다. 시작하지 않은 주문은 30분 후 만료되며 기존 기록을 보존한다.
- 외부 호출 전에 결제키와 90초 lease를 DB에 예약한다. 다른 작업자는 처리 중 결과를 받는다. lease 만료 후 query로 복구한다. DB transaction 안에서 네트워크를 기다리지 않는다. 서버 작업은 계정당 분당 10회로 제한한다.
- 원장은 SALE/REVERSAL 불변 이력이며 주문별 종류·상점/환경별 결제 승인키·취소 거래키/transaction 참조가 고유하다. 외부 승인 사실과 원장·권리 발급, 전액 취소 사실과 원승인 정확 역분개·해당 주문 권리 회수를 각각 한 transaction으로 반영한다.
- 수수료는 floor(gross×feeBps/10000), 작가 몫은 floor((gross−fee)×authorBps/10000), 나머지는 플랫폼 몫이다. 각 분개의 gross=fee+author+platform을 제약으로 강제한다. 별도 포인트 잔액은 없다.
- 승인 응답 유실은 UNKNOWN, 환불 유실은 REFUND_UNKNOWN이다. 확인되지 않은 환불은 권리를 임의 회수하지 않는다. 부분/지원 밖 상태는 REVIEW다. 오래된 lease와 환불된 주문의 늦은 DONE은 권리를 재발급할 수 없다. 환불 후 재구매는 새로운 주문/권리 이력이다.
- 취소가 로컬 승인 기록보다 먼저 확인되면 조회된 원승인과 전액 취소를 같은 transaction에서 기록하여 순액 0을 보존한다. 이때 원승인 transaction 참조가 조회에 없으면 NULL이며 승인 결제키와 승인 시각을 근거로 남긴다. 실제 회계 대사 인수에서 이 증거 형식도 확인해야 한다.

## 제공업체와 복구

승인/조회/전액 취소 응답의 orderId·paymentKey·mId·금액·통화·NORMAL/카드를 서버 주문과 대조한다. 취소 후에도 totalAmount는 원금이며 balanceAmount=0 및 단일 완료 취소의 금액·거래키·시각을 확인해야 전액 환불로 반영한다. [Toss 공식 API](https://docs.tosspayments.com/reference).

승인과 취소는 서로 다른 주문 UUID 기반 멱등키를 재사용한다. 업체 키 보존은 15일이며 DB 고유 제약을 영구 재전송 방지 기준으로 삼는다. 409 처리 중·5xx·타임아웃·해석 실패를 실패 확정으로 보지 않는다. 확인되지 않은 승인은 새 confirm 대신 query로 복구한다. [공식 인증·멱등성](https://docs.tosspayments.com/reference/using-api/authorization).

일반 결제 웹훅의 HMAC를 가정하지 않는다. 지급대행 서명/가상계좌 secret은 별도 계약이다. 이번에는 webhook 수신을 열지 않았으며 payload·브라우저 성공값을 원장에 반영하는 경로가 없다. 운영 전 durable inbox·재전송·작업 큐·서버 query·알림과 미확정 대사 기한을 추가해야 한다. [공식 웹훅 종류](https://docs.tosspayments.com/reference/using-api/webhook-events), [연결·재전송](https://docs.tosspayments.com/guides/v2/webhook).

## API와 UI

모든 경로는 `/api/v2/payments/` 아래에 있고 기본 환경에서는 기존 503을 유지한다. 상태 변경은 same-origin JSON과 서버 Auth가 필요하며 client author/user/receipt/lease 필드는 받지 않는다.

| 동작 | 메서드/경로 | 허용 |
|---|---|---|
| 견적 | GET quote?episodeId | 활성 독자 |
| 주문 생성 | POST create | 견적 버전·기대 가격·requestId |
| 주문/목록 | GET order?orderId / orders | 본인 독자 |
| 확인/재조회 | POST confirm / reconcile | 본인 독자 |
| 수익 | GET earnings | APPROVED 작가의 본인 시험 원장 |
| 미확정/감사 | GET review / audit?orderId | SUPER_ADMIN |
| 운영 재조회/전액 환불 | POST admin-reconcile / refund | SUPER_ADMIN, 환불 이유 |

`PurchaseContract`는 quote/order/earnings 응답을 textContent로 표시하는 **분리된 시험 미리보기 모듈**이다. DOM 대역으로 가격·무료 범위·대여 만료·불명확 상태·수익 구분을 검증했다. 현재 index/독자 checkout에 로드하거나 연결하지 않았고 실제 구매 UI 인수는 미실시다. 운영 정책 확정 후 공식 SDK와 접근 권한을 함께 연결해야 한다.

작가 수익은 예상 null(집계 전), 확정 시험액(신규 원장 순액), 지급 가능 0, 지급 완료 0이다. 최근 주문 50개와 본인 분개 100개에서 총액·수수료·작가/플랫폼 몫·원승인 참조를 대조할 수 있다. 결제키/계좌는 응답하지 않는다. 결제 주문의 PAID는 시험 승인 상태이며 **작가 지급 완료 상태가 아니다**. 계좌 검증·별도 암호화 키 보존/회전·변경 재인증·분리 승인·실송금 증빙·실패/중복 지급 방지를 인수하기 전에는 출금 경로를 만들거나 이전 계좌/수익을 사용하지 않는다.

## 검증과 다음 승인

`npm run test:stage20`은 RPC 합성 DB/HTTP·provider fetch 대역/VM UI만 사용한다. `npm run verify:monetization-sandbox`는 네트워크나 .env.local 없이 UNKNOWN→PAID→REFUND_UNKNOWN→REFUNDED 리허설을 실행하고 `scratch/stage20-sandbox/report.json`에 근거를 기록한다. 실제 PostgreSQL 동시성/업체 TEST/브라우저/계좌/지급 검증을 대신하지 않는다.

운영 장애 대응은 신규 거래 중단, 원장·권리·미확정 주문 보존, query 대사 우선이다. 성공 플래그나 잔액 숫자를 고쳐 복구하지 않는다. 19단계 실제 무료 인수·이전 거래 감사·운영 사업 정책/약관·실 업체 카드/환불·유료 본문 전체 경로·웹훅/정산 인수와 기능별 GO를 남긴 뒤 유료 출시를 진행한다.
