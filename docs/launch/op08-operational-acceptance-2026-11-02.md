# OP-08 제공자 TEST 준비·네이티브 경쟁·복원 검증

2026-11-02. [OP-07 계약](op07-payouts-contract-2026-11-02.md), [OP-07 구현](op07-payouts-implementation-2026-11-02.md), [관리자 CMS 계획](admin-cms-minimal-ux-plan-2026-11-01.md)을 확장한다.

사용자는 Toss TEST 키가 아직 없으며 연동 준비와 검증을 먼저 진행하도록 결정했다. 실제 제공자 호출·은행 송금·운영 DB 적용·운영 플래그 변경은 수행하지 않는다. 기존 작품·원고·계정·권리와 사용자 변경 파일을 보존한다.

## 이번 변경

- 기존 관리자 **설정 → API 연결**에 준비 상태를 추가한다. 설정 입력, 실제 결제 증빙, 작가 지급 제공자, 계좌·신원, 개인정보·세무·배분 계약, 운영 복원을 구분한다. 새 최상위 메뉴나 LIVE 활성화 버튼은 만들지 않는다.
- `GET /api/v2/admin/providers`의 최고 관리자 경계를 유지하고 허용된 상태 문자열만 반환한다. 키 원문·부분 문자열·지문은 준비 상태에 포함하지 않는다. DB 설정을 선택했으면 환경 변수의 키로 준비 완료를 대체하지 않는다. 저장 후 새로고침으로 상태를 조회한다.
- OP-05의 Toss TEST 전송·영수증 대조를 재사용한 **조회 전용** 인수 도구를 추가한다. TEST 키·상점·주문·금액·통화·거래 상태를 대조하며 승인·취소·송금을 요청하지 않는다. LIVE·문서 예제 키, 리다이렉트, 불확실 응답은 검증 성공으로 처리하지 않는다.
- 기존 합성 fixture에 선택적 `dbFactory`를 전달해 PGlite와 네이티브 PostgreSQL이 동일한 SQL·시나리오 기반을 사용한다. 제품 DB 경로나 공개 API에는 이 주입 지점이 없다.
- `pg@8.23.1`은 개발 의존성이다. 네이티브 도구는 전용 scratch 경로, 임의 비밀번호·포트, `127.0.0.1` 연결만 사용한다. `.env.local`이나 운영 DB URL을 읽지 않는다. 개별 연결에서 BEGIN/COMMIT을 수행하고 실제 잠금 대기를 `pg_blocking_pids`로 확인한다.

## 제공자 준비와 제한

| 항목 | 이번 상태 | 이후 필요한 증거 |
|---|---|---|
| Toss TEST 키·상점 ID | 미준비 | 개발자센터에서 발급한 동일 상점 TEST 설정 |
| 결제 승인·조회·취소 | 기존 OP-05 코드와 조회 도구 준비 | 실제 checkout 후 제공자 응답·원장 왕복 |
| 작가 지급대행 | 별도 인수 필요 | 지급 계약·개별 키/보안 키·셀러·지급 결과·웹훅 대조 |
| 계좌·PASS | 실제 금융/신원 검증 미완료 | 서비스 계약과 실제 검증 증빙 |
| 개인정보·세무 | 기존 조건 유지 | 개인/사업자/법인별 처리와 국외 보관 조건, 실제 배분 계약 |
| 네이티브 DB 경쟁·합성 복원 | 아래 명령의 실행 보고서로 판정 | 운영 복원과 별도 |
| Supabase/Auth/private Storage 복원 | 미실행 | 운영과 별도인 복원 대상·바이트·역할·접근 인수 |
| LIVE 전환 | 보류 | 각 서비스별 증거 검토·승인과 되돌리기 계획 |

Toss TEST는 법인 셀러만 등록 가능하고 TEST KYC를 완료할 수 없다. TEST 계좌 인증의 모의 성공은 실제 예금주 검증이 아니다. 지급 TEST 전체가 불가능하다고 단정하거나 과거 `PAYOUT_STATUS_CHANGED` 제한을 v2 `payout.changed`에 그대로 적용하지 않는다. 실제 상점에서 지원 범위를 확인한다. PG가 플랫폼에 정산하는 것과 플랫폼이 작가에게 지급하는 것은 별도다. [공식 환경 안내](https://docs.tosspayments.com/guides/v2/get-started/environment), [지급대행 안내](https://docs.tosspayments.com/guides/v2/payouts)

이번 실제 제공자 연결 준비는 기존 OP-05 결제 전송과 신규 조회 도구 범위다. 작가 지급은 OP-07의 모의 원장·증빙을 유지한다. 실제 지급 제공자 adapter, 전용 키 저장·JWE, v2 지급 웹훅 및 외부 증빙의 원장 반영은 아직 구현하지 않았으며 계약 규격과 대상이 확정된 뒤 OP-09의 별도 구현·인수 대상으로 둔다. 결제 키만 저장해 작가 송금을 실행할 수는 없다.

## 실행 방법

`npm run test:op08`은 합성 요청으로 준비 상태·관리자 경계·키 제한·조회 응답 대조를 검증한다. 외부 키나 서비스가 필요하지 않다.

`npm run verify:op08:native`는 전용 PostgreSQL을 생성하고 검증 후 종료한다. Windows 기본 도구 경로는 `scratch/tools/postgresql-17/pgsql/bin`이다. 필요한 경우 `OP08_PG_BIN`에 서버 실행 도구 디렉터리를 지정한다. `initdb`, `pg_ctl`, `postgres`, `psql`, `pg_dump`, `pg_restore`와 같은 배포판의 share/lib 지원 파일이 필요하다. 도구나 공유 디렉터리가 없으면 실패하며 다운로드·운영 DB 대체 접속을 하지 않는다.

결과는 Git 제외 경로 `scratch/op08/native-report.json`, 합성 archive와 로그는 해당 `native-*` 폴더에 남긴다. 재현 결과를 확인한 뒤 보관 정책에 따라 정리한다. 실제 사용자 자료를 fixture나 이 도구에 넣지 않는다.

GitHub CI는 별도 `native-settlement-recovery` 작업으로 실행한다. `ubuntu-24.04`에 포함된 PostgreSQL 16을 사용하고, 이 PC의 PostgreSQL 17 결과와 버전을 구분해 기록한다. 시스템 PostgreSQL 서비스를 시작하지 않는다. [공식 runner 목록](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)

`npm run verify:op08:provider`는 `.env.local`의 `TOSS_TEST_CLIENT_KEY`, `TOSS_TEST_SECRET_KEY`, `TOSS_TEST_MERCHANT_ID`를 사용한다. 미준비는 종료 코드 **2 / BLOCKED**이며 제공자 인수 성공이 아니다. 실제 조회가 일치한 경우에만 **0 / VERIFIED_QUERY**이고 이것도 전체 결제/지급 인수 완료가 아니다.

조회할 TEST 결제의 원요청 자료를 `scratch/op08/inputs/` 아래 JSON 파일에 보관하고 `OP08_PROVIDER_RECEIPT_FILE`로 지정한다. 파일은 8KiB 이하이며 이 디렉터리 밖이나 심볼릭 링크로 밖에 있는 자료는 거절한다. 허용 필드는 `orderId`, `checkoutId`, `operationId`, `paymentKey`, `merchantId`, `amountKrw`, `operationCreatedAt`, 필요한 취소 대조의 `refundAmountKrw`, `expectedBalanceKrw`다. ID는 기존 OP-05 원주문·원작업 식별자를 사용하며 임의 재발급하지 않는다. 원문 파일과 결제 키를 채팅이나 Git에 올리지 않는다.

## 경쟁·복원 인수 범위

1. 동일 requestId의 두 연결은 하나의 신청과 같은 결과를 재현한다.
2. 서로 다른 동시 신청은 확정 수익을 초과하지 않는다.
3. 같은 revision의 승인·취소는 순서와 충돌을 보존한다.
4. 지급 대상 변경 후 기존 승인으로 발송을 시작할 수 없다.
5. 감액 후 초과 지급을 승인할 수 없다.
6. 성공·실패 증빙이 동일 신청을 이중 종결하지 않는다.
7. 환불이 예약한 포인트를 동시에 소비할 수 없다.
8. 연결 강제 종료로 미커밋 지급 증빙을 잃어도 UNKNOWN 예약이 유지되며, 같은 원요청으로 최종 결과를 한 번만 적용한다.
9. native custom archive를 빈 별도 DB에 복원하여 행·함수 정의/소유자/권한·RLS 정책·트리거·제약·시퀀스 상태를 대조한다. 복원 후 실제 SET ROLE로 직접 접근 거절과 서비스 RPC 허용, UNKNOWN 대사·멱등 재현을 다시 확인한다.

합성 복원 대상은 같은 임시 클러스터의 별도 DB다. 클러스터 역할은 공유하며 이를 외부 장애 영역·hosted Supabase·실제 Auth·Storage 파일 복원이라고 보고하지 않는다. `pg_dump`는 단일 DB만 포함하므로 운영 복원에서는 역할과 외부 Storage 바이트·암호화 키·배포 설정을 별도로 인수해야 한다. [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [pg 트랜잭션](https://node-postgres.com/features/transactions)

## 보안·운영 전환 조건

로컬 PostgreSQL 17.11에서 9개 경쟁·복원 흐름과 복원 카탈로그 대조를 통과했다. 복원 대조 대상은 테이블 103개·함수 98개·RLS 정책 3개·시퀀스 4개다. 명시 ACL과 동일한 기본 ACL은 유효 권한 기준으로 비교하고 CHECK 조건은 PostgreSQL의 pretty deparse로 불필요한 괄호 차이를 제거한다. 별도 실제 SET ROLE 검증도 통과했다. 초기 Windows 프로세스 대기·종료 시간과 카탈로그 표현 차이로 발생한 검증 도구 오류를 수정한 후 최종 실행 종료 코드 0을 확인했다.

조사에는 기존 소스, npm, PostgreSQL·Toss·node-postgres 공식 문서와 공식 GitHub 저장소를 사용했다. Codebase Memory는 연결 종료 오류로 사용할 수 없어 저장소 범위의 소스 검색으로 대체했으며 ai-memory 조회 도구는 현재 노출되지 않았다. 정산 전용 MCP는 없었고 Python 의존성은 필요하지 않아 PyPI 검색은 생략했다.

새 pg 의존성 관련 감사 경고는 없다. 기존 `body-parser` 1.20.8과 `qs` 6.16.0은 허용 범위 내 보안 패치로 갱신한다. 기존 Zod 3.25.76의 high 경고 1건은 메이저 호환 검토가 필요하므로 `audit fix --force`로 바꾸지 않는다. 이 잔여 위험과 외부 인수 미완료를 LIVE 준비 완료로 표시하지 않는다. [Zod 권고](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

다음 OP-09는 **Zod 보안 업데이트·호환 검증과 실제 제공자/독립 복원 인수**다. 키와 별도 복원 대상이 준비되면 TEST 승인/취소/미확정 재조회, 은행 대사, 계좌/세무 조건, 외부 백업 복원과 서비스별 RPO/RTO를 인수한다. 개별 서비스의 검증된 버전·대상·운영자·되돌리기 근거를 확정한 후 제한된 범위로 전환한다. 미확정 지급은 재송금하지 않고 예약을 유지한 채 외부 거래를 대조한다.

## 로컬 검증 기록

전체 릴리스 58개 명령, 컴파일과 독립 타입 검사, 네이티브 9개 흐름 및 카탈로그 대조가 통과했다. OP08 준비 상태·조회 검증 6개와 제공자 UI 3개 테스트도 통과했다. 로컬 전체 검사는 OP-02의 이전 로더 캐시 버전 기대값을 수정한 뒤 중단 지점부터 이어 완료했으며, 최종 소스의 연속 전체 실행은 GitHub CI에서 별도로 확인한다. 별도 lint 명령은 없고 구문·비밀 패턴·변경 검토를 수행한다. 브라우저나 실기기는 실행하지 않았다. 최종 npm 감사는 기존 Zod high 1건이며 보안 무결점으로 보고하지 않는다. 실제 종료 코드·소스 해시·배포 결과는 [검증 집계](../../artifacts/op08-verification-2026-11-02.json)에 기록한다.

## 배포 후 확인

제품 커밋 `7245007`의 [전체 빌드·네이티브 복원 CI](https://github.com/jwmaxum/webnovels/actions/runs/41407474534)와 Cloudflare 배포가 성공했다. 두 도메인의 변경 JS 총 4건은 원본과 일치했다. Pages HTML은 원본과 일치하고 사용자 도메인 HTML은 Cloudflare 회사 이메일 보호 변환 1건과 해제 스크립트만 정확히 복원하면 전체 원본과 일치했다. 관리자 설정 API는 비인증 접근을 거절했다. 금융/광고/정산 TEST 기능은 비활성이며 운영 DB·플래그는 변경하지 않았다. 실제 제공자 호출과 hosted 복원은 사용자 결정에 따라 준비 상태로 남긴다.
