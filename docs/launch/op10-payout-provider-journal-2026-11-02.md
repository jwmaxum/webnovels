# OP-10 — 지급 TEST 설정·영속 요청·웹훅 조회 대사

## 범위와 원장 경계

승인된 OP-07 모의 정산을 참조하여 외부 제공자의 **TEST 지급 인수**를 준비한다. `commerce.op10_*`에 요청·설정·조회 증빙을 별도로 보관한다. OP-07의 `LOCAL_SIMULATED` 잔액, 예약, PAID, 증빙과 함수는 변경하지 않는다. 외부 TEST의 COMPLETED도 실제 작가 지급 또는 원천징수 완료가 아니다.

실제 지급 TEST 계약·키가 아직 없다는 사용자 결정에 따라, 운영 DB와 모든 금융/정산 플래그는 변경하지 않는다. 023 SQL은 합성 DB에서만 적용한다. 관리자 화면은 기존 설정·정산 메뉴 안에 배치한다. 새 상위 메뉴나 LIVE 활성화 버튼은 없다.

## 구현

- **설정:** 최고 관리자 재인증 후 지급 TEST 시크릿 키, JWE 보안 키, 상점 ID, 웹훅 HMAC 키 바이트를 저장한다. 카드결제 TOSS 설정과 별개이며 `TOSS_PAYOUT/TEST` AAD로 AES-GCM 암호화한다. 응답/로그/브라우저 저장소에는 키를 노출하지 않는다. 새 버전은 CAS로 저장하며, 이전 버전을 유지해 진행 중 요청에 고정한다.
- **요청 준비:** APPROVED 모의 정산에서 출처 ID·revision·작가·금액을 읽는다. 1원~100만원의 TEST 요청만 허용한다. TEST 셀러 ID·즉시/예약일·7자 거래 표시·config ID·고유 참조 ID를 고정한다. 동일 출처로 두 개의 외부 요청을 만들 수 없다. 수정이 필요하면 이미 전송한 요청을 복제하지 않고 담당자가 대사한다.
- **발송:** 현재 최고 관리자·출처 상태와 검토된 config ID를 다시 확인한다. 행 잠금으로 1개 전송 권한만 만들고 `synchronous_commit=on`으로 RPC 커밋 후 네트워크를 호출한다. 생성 요청은 평생 한 번만 시도한다. 결과가 유실되거나 프로세스가 종료되어도 lease 만료 후 재생성하지 않는다.
- **조회:** provider ID가 있으면 GET으로 확인한다. ID가 유실된 경우 `/v2/payouts`를 페이지당 50개, 최대 3페이지로 제한해 정확한 참조 ID를 찾고 필드 대조 후 개별 GET으로 다시 확인한다. 부분 목록·중복 참조·일치 항목 부재·금액/대상 불일치는 재발송의 근거가 아니다. UNKNOWN은 조회 또는 담당자 검토로 남긴다.
- **웹훅:** raw JSON 바이트와 전송 시간에 대한 HMAC-SHA256을 검증한다. 여러 `v1` 서명을 지원하고 헤더를 최대 2KiB까지 받는다. ±5분은 사이트의 재전송 공격 방지 정책이며 제공자의 공식 유효시간이라고 주장하지 않는다. 전송마다 바뀌는 transmission ID 대신 eventId와 payload SHA-256으로 중복/충돌을 판정한다. 이미 발송한 알려진 요청만 최대 100개 이벤트를 저장한다. 웹훅은 조회를 예약할 뿐, payload로 지급 상태를 확정하지 않는다. 콜백의 Supabase 네트워크 호출은 공통 8초 예산을 사용한다.
- **대사:** cron은 한 번에 최대 5개 요청을 조회한다. 요청별 실패가 다른 항목의 조회를 막지 않으며 실패 집계를 호출자에게 알린다. lease가 지난 조회는 재시도할 수 있지만 create 권한은 복구하지 않는다. 요청당 증빙 200개를 넘으면 REVIEW로 보류해 무한 조회를 막는다. 완료 상태는 늦게 도착한 비완료 응답으로 되돌리지 않는다.
- **접근:** 7개 private 테이블은 RLS 및 모든 직접 ACL을 차단한다. `service_role`도 직접 읽을 수 없다. 서비스 전용 SECURITY DEFINER RPC 2개만 고정 search_path로 접근한다. 관리자 RPC는 현재 Auth·최고 관리자 상태를 검증하고 변경·발송 승인 시도를 분당 5회로 제한한다.

송신 직전 DB 기록과 외부 서비스는 한 트랜잭션이 아니다. 따라서 “외부 송금 exactly-once 보장”이라고 표현하지 않는다. 기록 직후 네트워크 전 프로세스가 종료되면 실제 송금 없이 UNKNOWN일 수 있다. 중복 송금을 방지하기 위해 이 경우에도 자동 재발송하지 않는다.

## 운영 준비 계약 — 아직 활성화하지 않음

| 항목 | 용도 |
| --- | --- |
| `PAYOUT_PROVIDER_TEST_SETTINGS_ENABLED=true` | 023이 준비된 환경에서 최고 관리자 설정/조회 API 허용 |
| `PROVIDER_SETTINGS_MASTER_KEY`, `PROVIDER_SETTINGS_KEY_VERSION` | 기존 서버 전용 wrapping key. 브라우저·DB 저장 금지 |
| `PAYOUT_PROVIDER_TEST_ENABLED=true`, `PAYOUT_PROVIDER_TEST_ENVIRONMENT=TEST` | 외부 TEST 전송/조회 허용 |
| `PAYOUT_PROVIDER_TEST_CONFIG_ID` | 담당자가 계약·상점·셀러·서명 샘플을 확인한 정확한 설정 UUID. 다른 설정으로 신규 발송 불가 |
| `PAYOUT_PROVIDER_TEST_WEBHOOK_ENABLED=true` | 서명된 TEST callback 수신 |
| `PAYOUT_PROVIDER_TEST_RECONCILE_ENABLED=true` | 별도 scheduler의 조회 대사 허용 |

콜백 주소 형식은 `https://webnovels.uk/api/v2/payout-provider-test/callback?configId=<검토한-설정-UUID>`다. 키 자체를 URL에 넣지 않는다. 키 교체 후 이전 config URL과 암호화 버전은 진행 중 요청·제공자 재전송이 끝날 때까지 유지한다. 상점 ID는 운영자가 검토한 키/계약의 바인딩이며, 제공자 응답이 상점 ID를 직접 증명한다고 간주하지 않는다.

HMAC 키 문자열이 hex 원문인지 hex-decoded 바이트인지 공식 자료에서 확정하지 못했다. 이 구현은 **검증한 실제 HMAC 바이트를 32바이트 Base64**로 받는다. JWE 보안 키의 hex 규칙을 HMAC에 추정 적용하지 않는다. 실제 서명 샘플 인수 전 활성화하지 않는다. 제공자 규격에 다른 키 길이가 있으면 검증 후 계약을 확장한다.

현재 wrapping key는 한 버전만 읽는다. 이 단계의 제공자 비밀 교체는 같은 wrapping key를 사용한 설정 버전 추가다. master key 자체 회전을 지원한다고 주장하지 않는다. 구키 읽기/신키 쓰기 및 재암호화 인수는 후속 작업이다.

준비 순서: 별도 TEST 대상/복구 백업 준비 → 019~023 의존 관계와 권한 검증 → 023 적용 → 서버 wrapping key 및 설정 UI 허용 → 최고 관리자 지급 TEST 키 입력 → 실제 상점·셀러·서명 샘플 검증 → 정확한 config ID 승인 → TEST 전송/콜백/cron 순차 인수. 기존 연재·회원 DB의 과거 SQL을 일괄 재실행하지 않는다. scheduler는 Pages와 별도 배포이며 이번 Git push가 운영 cron 활성화를 의미하지 않는다.

되돌리기는 신규 TEST 전송·웹훅·cron 게이트를 비활성화한다. 이미 전송한 요청과 암호화 설정·증빙은 삭제하거나 READY로 초기화하지 않는다. 미확인 요청은 제공자 조회와 담당자 대사 대상으로 유지한다.

## 검증 및 조사

`search-first → security-review → verification-loop`를 적용했다. 기존 jose·WebCrypto·서비스 RPC·합성 DB fixture를 확장했으며 새 의존성을 추가하지 않았다. Codebase Memory 연결이 종료되어 필요한 소스는 rg로 읽었다. 기존 연구 에이전트로 공식 지급·웹훅 규격을 조사했다.

근거: [Toss 웹훅 이벤트](https://docs.tosspayments.com/reference/using-api/webhook-events), [웹훅 가이드](https://docs.tosspayments.com/guides/v2/webhook), [지급 부가 API](https://docs.tosspayments.com/reference/additional), [PostgreSQL 비동기 커밋](https://www.postgresql.org/docs/17/wal-async-commit.html), [행 잠금](https://www.postgresql.org/docs/17/explicit-locking.html).

테스트는 API/합성 SQL/가상 DOM과 네이티브 PostgreSQL이다. 브라우저나 localhost HTTP 인수, 실제 제공자 호출, 운영 DB 적용은 수행하지 않는다. 네이티브 검증은 같은 PC의 전용 합성 클러스터에서 실제 두 연결의 발송 경쟁 및 archive 복원 후 발송 마커 보존을 확인한다. 이를 외부 장애 영역 또는 hosted Supabase 복원 인수로 간주하지 않는다. 결과는 OP-10 검증 집계에 기록한다.

로컬 검증: 관련 50개 파일의 624개 회귀 테스트, 최종 OP-10 19개 테스트, PostgreSQL 17.11 경쟁·복원 4개 시나리오가 통과했다. Prisma/TypeScript 컴파일, 독립 타입 검사, 6개 Pages Functions 번들, 변경 모듈 구문 검사를 통과했고 npm 감사는 0건이다. 별도 lint 명령과 수치 커버리지 설정은 없다. 로컬 전체 릴리스 연속 실행은 수행하지 않았으며, GitHub CI의 전체 빌드 결과와 구분한다. 비밀 패턴 및 diff 검토를 완료했다. [검증 집계](../../artifacts/op10-verification-2026-11-02.json)에 결과를 남긴다.

## 다음 OP-11

1. 미계약 상태에서도 진행할 수 있는 **지급 대사 예외 처리·운영 관측**: UNKNOWN/REVIEW 사유·마지막 조회 시각·담당자 메모/처리 이력, 자동 조회 한도 도달 알림, 수동 대사 증빙 검증. 재발송은 기본 금지한다.
2. 암호화 master key의 구키 읽기/신키 쓰기·중단 재개형 재암호화를 합성/복원 환경에서 검증한다. 기존 제공자 설정과 진행 중 요청의 키 버전을 보존한다.
3. 제공자 계약·키가 준비되면 실제 TEST 셀러·지급 생성/조회·서명 웹훅·지연/실패/중복을 인수한다. 기존 모의 수익을 실제 수익으로 변환하지 않는다.
4. 별도 hosted 복원 대상의 Auth·private Storage 바이트·RLS와 SMTP 실제 메일을 인수한다. 실제 수익 출처·개인/사업자/법인 세무·은행·국외 보관 조건과 운영 승인 후에만 LIVE 전환을 별도 개발한다.
