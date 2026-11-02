# OP-09 보안 업데이트·지급 TEST 전송·독립 복원

2026-11-02 (Asia/Seoul). [OP-08](op08-operational-acceptance-2026-11-02.md)과 [OP-07 정산 계약](op07-payouts-contract-2026-11-02.md)을 확장한다.

## 범위와 운영 상태

사용자가 TEST 키를 아직 준비하지 않았으므로 코드·합성 검증·읽기 전용 인수 도구를 개발한다. 운영 DB 마이그레이션, 금융 플래그 변경, 실제 지급, 셀러 등록, 개인정보 수집은 수행하지 않는다. OP-07의 LOCAL_SIMULATED 원장에 외부 결과를 섞지 않는다.

- Zod를 3.25.76에서 패치된 **4.6.7**로 고정한다. 복구 증빙의 `z.record`에 문자열 키 스키마를 명시한다. 기존 엄격한 증빙 필드·해시·경로 제한을 유지한다. 큰 배열의 길이 위반 시 원소 검증을 시작하지 않는 회귀 검사를 추가한다.
- GitHub CI에 `npm audit --audit-level=high`를 추가해 high/critical 의존성 취약점이 생기면 빌드를 차단한다.
- `jose@6.2.15`의 Compact JWE를 사용한다. ESM/WebCrypto 기반, MIT, 추가 의존성 없는 패키지다. 자체 암호 알고리즘을 구현하지 않는다.
- 독립된 `server/providers/payouts-toss-test.mjs`에 TEST 생성·조회 전송을 구현한다. **공개 API·관리자 버튼·예약 워커·정산 원장과 연결하지 않는다.** 외부 계약 인수와 영속 요청 기록이 없는 현재 상태에서 관리자 UI로 지급할 수 없다.
- 기존 복원 카탈로그 대조 함수를 공유 모듈로 추출한다. OP-08의 기존 경쟁 검사는 유지하고, OP-09는 원본 클러스터를 종료한 후 새로운 클러스터에서 역할을 새로 생성하고 archive를 복원한다.

## 지급 TEST 계약

PG 수납용 `TOSS_TEST_SECRET_KEY`와 작가 지급용 키를 혼용하지 않는다. 신규 조회 도구는 `TOSS_PAYOUT_TEST_SECRET_KEY`만 사용한다. 지급 생성 전송의 보안 키는 별도 인자로 받으며 64자리 hex를 32바이트로 해석한다. 관리자 DB의 지급 전용 암호화 키 저장·회전은 아직 구현하지 않는다.

생성 전송은 고정 HTTPS `/v2/payouts`에 단일 지급 배열을 JWE로 암호화해 보낸다. `dir/A256GCM`, ISO 시각 `iat`, 임의 `nonce`, `text/plain`, ENCRYPTION 헤더를 적용한다. 조회는 고정 `/v2/payouts/{id}`의 GET만 허용한다. LIVE·문서 예제 키, 리다이렉트, 잘못된 금액·대상·날짜를 거절한다. 이 단계의 TEST 금액 상한은 1,000,000원으로 제한한다.

전송 호출자는 **호출 전에** operationId·refPayoutId·셀러·금액·일정·상점 키 버전을 영속적으로 동결해야 한다. 현재 모듈은 전송 계층이며 이 영속 저장을 대신하지 않는다. 멱등키는 operationId로 고정하고, 15일이 지난 생성이나 이미 지급 ID가 있는 생성은 거절한다. 전송 함수 안에 재시도는 없다. UNKNOWN에서 새 식별자를 발급해 다시 보내지 않고 원거래를 조회·대사한다.

응답 유실로 providerPayoutId를 받지 못하면 현재 단건 조회 도구를 사용할 수 없다. 상점의 원거래 대사로 ID를 확인해야 하며, 참조 ID를 찾는 제한된 목록 조회와 영속 outbox 복구는 OP-10 대상이다. 확인되지 않은 ID를 생성하거나 다른 거래 ID를 대입하지 않는다.

응답은 64KiB로 제한하고 생성 응답의 JWE 인증 및 알고리즘을 검증한다. 수취인·참조·금액·통화·일정·적요·지급 ID를 원요청과 대조한다. 접수/처리 중은 PENDING, COMPLETED만 완료 관측, 실패·취소·알 수 없는 상태는 REVIEW다. 완료를 관측해도 `ledgerApplyAllowed:false`이며 원장 지급 완료나 예약 해제를 자동 수행하지 않는다. 원문 응답·키·셀러 개인정보를 로그에 기록하지 않는다. 제공자가 문서화하지 않은 응답 nonce 일치 조건은 추가하지 않는다.

## 실행 명령

- `npm run test:op09`: 지급 암호화/변조/대조/실패/조회 결과 가림과 Zod 호환·크기 제한 검사. 외부 호출 없음.
- `npm run verify:op09:native`: 전용 scratch PostgreSQL 두 클러스터로 합성 복원. `.env.local`이나 운영 URL을 읽지 않는다. 기본 PostgreSQL 경로 및 `OP08_PG_BIN`은 OP-08과 같다.
- `node scripts/verify_op09_prerequisites.mjs`: 지급 **조회 전용**·기존 Supabase 대상 읽기 전용 사전 검사. 키/대상 미준비는 BLOCKED, 종료 코드 2다. 빈 대상 확인도 복원 성공이 아니므로 이 명령은 운영 GO를 반환하지 않는다.

실제 TEST 조회가 필요하면 `.env.local`에 `TOSS_PAYOUT_TEST_SECRET_KEY`를 넣고, `scratch/op09/inputs/` 아래 8KiB 이하 JSON 원요청 파일을 `OP09_PAYOUT_RECEIPT_FILE`로 지정한다. 허용 필드는 operationId, refPayoutId, destination, amountKrw, operationCreatedAt, scheduleType, payoutDate(예약인 경우), transactionDescription, providerPayoutId다. 제공자가 실제 발급한 TEST 지급 ID와 원요청을 사용하고 임의 식별자를 만들어 실제 증빙으로 삼지 않는다. 파일과 비밀은 Git/채팅에 올리지 않는다. 이 CLI에는 생성/취소/송금 옵션이 없다.

## 독립 복원 검증 범위

1. OP-07까지의 합성 fixture로 UNKNOWN 예약을 만든다.
2. 103개 테이블과 관련 함수·ACL·RLS·제약·트리거·시퀀스를 스냅샷하고 custom archive를 생성한다.
3. Storage 메타데이터마다 **새로 만든 합성 파일**의 바이트·해시를 기록한다.
4. 원본 서버를 종료하고 다른 데이터 디렉터리·임의 비밀번호·포트의 클러스터를 생성한다. 알려진 합성 역할 3개만 재생성한다. 임의 글로벌 SQL을 실행하지 않는다.
5. archive 해시·복원 DB 전체 스냅샷·복사한 파일 바이트와 메타데이터를 대조한다.
6. SET ROLE 직접 접근 거절, 비공개 원고·웹툰 Storage 메타데이터의 anon/authenticated RLS 차단, 서비스 RPC, UNKNOWN 예약 유지와 동일 증빙의 1회 적용/멱등 재현을 확인한다.

두 클러스터는 **같은 PC**에 있다. 이는 독립 클러스터 복원이며 외부 장애 영역, hosted Supabase Auth, Storage 서비스 HTTP/RLS, 실제 이미지 또는 개인정보 복원 성공이 아니다. 합성 파일은 운영 파일을 수집한 것이 아니다. 실행 시간은 합성 리허설 수치이며 운영 RPO/RTO를 보장하지 않는다. 보고서는 `scratch/op09/recovery-report.json`에 저장하며 종료 정리 실패도 FAIL이다.

## 조사·검증·후속

search-first → 구현 → security-review → verification-loop 흐름을 적용했다. Codebase Memory 연결이 종료되어 현재 소스 `rg` 검색으로 대체했다. 공식 npm 패키지를 설치했으며 MCP에 지급 전용 기능은 없었다. Python 의존성은 필요하지 않다.

근거: [Zod 보안 권고](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [Zod 마이그레이션](https://zod.dev/v4/changelog), [jose](https://github.com/panva/jose), [Toss 지급 가이드](https://docs.tosspayments.com/guides/v2/payouts), [부가 API](https://docs.tosspayments.com/reference/additional), [요청·응답](https://docs.tosspayments.com/reference/using-api/req-res), [인증·멱등키](https://docs.tosspayments.com/reference/using-api/authorization).

외부 지급 TEST 키와 별도 Supabase 복원 대상은 사전 검사에서 각각 `PAYOUT_TEST_KEY_MISSING`, `ISOLATED_TARGET_NOT_CONFIGURED`로 확인했다. 외부 제공자를 호출하지 않았으며 운영 DB를 변경하지 않았다. 최종 검사 및 Git 반영 결과는 아래에 기록한다.

로컬 전체 검사는 26단계의 임시 심볼릭 링크 생성이 Windows 샌드박스에서 EPERM으로 차단되어 중단됐다. 기존 테스트를 완화하지 않고 26단계부터 권한을 확보해 재실행한다. 따라서 로컬 검사는 구간별 실행이며, 최종 소스의 연속 전체 실행 결과는 GitHub CI와 구분한다.

다음 **OP-10**은 지급 전용 설정·권한과 영속 outbox/상점 바인딩, 조회 증빙 원장, 웹훅 재조회/중복 처리 구현이다. 실제 키·계약이 준비되면 TEST 원거래와 왕복 검증하고, 별도 hosted 대상에서 Auth·private Storage·역할을 인수한다. 기존 모의 원장을 실제 지급으로 변환하지 않는다. 개인/사업자/법인·은행·세무·국외 보관 조건과 운영자 승인·되돌리기 기준이 모두 충족된 서비스부터 전환한다.

## 최종 로컬 검증

전체 릴리스 59개 명령과 컴파일, 독립 타입 검사, 신규 OP-09 8개 테스트가 통과했다. npm 감사는 전체 0건이다. PostgreSQL 17.11 독립 클러스터 검사에서 테이블 103개·함수 98개·정책 3개·시퀀스 4개와 합성 파일 3개(237바이트)를 대조했고 비공개 원고/웹툰 메타데이터의 anon/authenticated RLS 차단을 확인했다. 초기 샌드박스의 로컬 TCP 차단 후 승인된 전용 합성 환경에서 재실행해 종료 코드 0을 확인했다. 별도 lint 명령과 수치 커버리지 측정은 없으며 구문·비밀 패턴·diff 검토를 수행했다. 브라우저/localhost HTTP 인수, 실제 제공자 호출, 운영 DB 적용은 하지 않았다. 결과는 [검증 집계](../../artifacts/op09-verification-2026-11-02.json)에 남긴다.
