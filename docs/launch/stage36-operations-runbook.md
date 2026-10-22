# 36단계 운영 대응·복원 실행서

이 문서는 실제 운영 설정의 읽기 점검과 이후 운영 절차를 구분한다. 공개 베타의 가입·메일·이미지·예약 발행 인수 완료를 뜻하지 않는다. 기준 계획은 [improve36.md](../../improve36.md), 이전 적용 기록은 [35단계](stage35-free-beta.md)다.

## 1. 이번에 확인한 운영 상태

2026-10-22 13:57 KST에 관리 API를 읽기 전용으로 조회했다. 토큰·비밀번호·암호화 키의 값은 출력하지 않았고, 설정 변경·메일 발송·데이터 삭제·브라우저 인수는 하지 않았다.

| 항목 | 확인 결과 |
|---|---|
| GitHub 기준 커밋 | `5f5e934128b902b2c369e9c21a8bcbb1472d7caf` |
| CI | 해당 커밋의 `build-and-test`, 워크플로, Cloudflare Pages 체크 모두 `completed/success` |
| Pages 운영 배포 | 프로젝트 `webnovels`, `webnovels-db4.pages.dev`; latest와 canonical production 모두 위 커밋, `success` |
| Pages 배포 ID | `8e9a0ef4-4ff0-4521-8640-40873d64af95` |
| 이미지 처리 연결 | Pages의 `webnovels-image-processor` production 서비스 바인딩, shared secret 존재, Worker의 `IMAGES` 바인딩 확인 |
| 설정 암호화 | Pages의 provider master secret 존재 확인. 복호화나 키 교체를 시험한 것은 아님 |
| Worker 접근 | 이미지 처리·scheduler 모두 `workers.dev`와 preview URL 공개 비활성 |
| 예약 실행 | scheduler의 `* * * * *` Cron 존재; 발행 활성화 플래그는 꺼짐 |
| 가입·무료 베타 | 활성화 플래그 꺼짐 유지 |
| SMTP | `BETA_SMTP_HOST/PORT/USER/PASS/ADMIN_EMAIL/SENDER_NAME` 모두 미설정 |
| 격리 복원 대상 | `SUPABASE_RESTORE_TARGET_REF` 및 별도 restore/staging/test 대상 설정 없음 |

CI 조회에는 `scripts/release_status.cjs`, Cloudflare 조회에는 기존 35단계 읽기 점검 도구를 사용했다. 위 상태는 36단계 변경을 push하기 **전**의 기준점이다. 최종 변경의 커밋·CI·배포 결과는 36단계 완료 기록에 별도로 남긴다.

## 2. 기존 도구 조사와 선택

로컬 코드·계약, 공개 npm 메타데이터, 공식 GitHub 저장소와 공급자 문서를 조사했다. `search-first`, `security-review`, `verification-loop` 스킬을 확인했다. 현재 도구 목록에는 ai-memory 조회 도구가 없어 기억 저장소 내용은 근거로 사용하지 않았다. Python 런타임 도입이 필요한 작업이 아니므로 PyPI 패키지는 조사하지 않았다.

| 필요 기능 | 기존 구현·외부 후보 | 선택 |
|---|---|---|
| 업무 오류 계측 | 기존 서버 actor/소유권 검증, service-role RPC, SQL 감사, Web Crypto | 기존 계약 확장. 허용한 작업·오류 코드와 처리시간만 기록하고 원고·이미지·토큰을 복사하지 않음 |
| 인프라 오류 탐색 | Cloudflare Workers Logs/Issues | 보조 채널 후보. 실제 관측 설정과 접근·보존 범위를 확인한 뒤 사용. 앱 내 문의·처리 이력을 대체하지 않음 |
| 분산 추적 | `@opentelemetry/api` 1.10.0, `@opentelemetry/sdk-node` 0.300.0 (2026-10-22 npm 조회), Apache-2.0 | API는 직접 의존성 0개, Node SDK는 23개. 현 Worker의 제한된 오류 집계에 설치하지 않음. 여러 서비스 추적이 필요할 때 workerd 호환·수집처·개인정보 범위를 먼저 검증 |
| DB 백업 | `backup_launch_postgres.cjs`, native PostgreSQL 17 `pg_dump`/`pg_restore` | 재사용. 일관된 DB 스냅샷·archive 목록·해시 확인을 새 npm 래퍼로 대체하지 않음 |
| 복원 대상·산출물 확인 | `audit_restore_target.mjs`, `restore-target.mjs`, `recovery-bundle.mjs`의 zod/sha256 검사 | 재사용. 실제 복원 실행·Auth/RLS/Storage 인수는 추가 필요 |

Cloudflare는 구조화 로그와 오류 조사 기능을 제공하며 토큰·개인정보를 로그나 span에 넣지 않도록 안내한다. OpenTelemetry는 API와 SDK를 구분하고 런타임별 설정을 요구한다. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Issues 조사](https://developers.cloudflare.com/workers/observability/issues/investigate/), [OpenTelemetry 공식 저장소](https://github.com/open-telemetry/opentelemetry-js).

## 3. 장애·문의 처리

운영자는 작업 종류, 발생 시각, 오류 코드, 재시도 상태와 요청 식별자를 확인한다. 신고·저작권·탈퇴의 접수 내용은 권한 있는 담당자가 해당 사건에서만 열람한다. 작업 로그에 Authorization/Cookie, 비밀번호, 제공자 설정, CI/DI, 계좌, 원고 본문, 이미지 바이트, 외부 URL의 query를 복사하지 않는다. 알 수 없는 예외는 정해진 일반 코드로 바꾸고 원문 예외를 사용자에게 반환하지 않는다.

| 상황 | 처리 절차 |
|---|---|
| 원고 저장 충돌 | 서버 revision과 기기 사본을 보존 → 작가가 비교·복구 → 최신 revision으로 재시도. 운영자가 오래된 본문을 강제 덮어쓰지 않음 |
| 이미지 업로드 실패 | 인증·소유 작품·자산 상태·용량/MIME·처리기 연결 확인 → 현재 업로드 상태 재조회 → 확정되지 않은 자산을 기존 멱등성 계약으로 재시도. 실패만 보고 원본·연관 이미지를 삭제하지 않음 |
| 예약 발행 지연/실패 | Cron 실행 여부·발행 플래그·마지막 성공·`authoring.schedules`의 상태/`last_error_code`/시도 이력 확인 → 현재 공개 head와 대조 → 기존 재예약·재시도 경로 사용. 같은 회차를 직접 INSERT하지 않음 |
| 신고·저작권 분쟁 | 접수 번호 → 담당자 검토 사유·상태 → 필요한 공개 제한/복원은 기존 관리자 권한·revision 계약으로 별도 수행 → 처리 이력과 이의제기 연결 |
| 탈퇴 문의 | 접수·답변 완료와 개인정보 삭제 완료를 분리. 아래 보존/삭제 절차와 증빙을 갖춘 뒤 실제 삭제 완료로 기록 |
| 전역 장애 | 영향 범위·발생/복구 시각·검증한 최근 배포·비식별 오류 코드 기록. 정지/롤백은 기존 차단 설정과 검토된 배포 절차로 수행. 원고·공개 이력을 지워서 복구하지 않음 |

최초 발행은 작가 권한을 유지한다. 공개 후 수정·삭제의 관리자 검토와 신고 처리는 서로 다른 상태 전이이며, 문의 종료로 공개본을 자동 변경하지 않는다. 이의제기는 기존 `server/stage9-appeal-api.mjs`와 대응 SQL의 권한·연결 계약을 재사용한다.

오류 건수와 실패율을 혼동하지 않는다. 수집한 실패 이벤트만 있다면 실패 **건수**로 표시한다. 실패율은 같은 수집 범위의 실제 성공·실패 분모가 있을 때만 계산하고, 누락·샘플링·플래그 비활성 구간을 알린다. 실제 운영 데이터가 없으면 빈 상태를 표시한다.

36단계 기술 관측은 `BETA_OPERATIONS_ENABLED`가 켜진 대상의 완료 응답·409 충돌·5xx 실패를 집계한다. 세부 오류는 분야별 분당 최대 100건 표본으로 제한하고, 분 집계와 오류 기록은 7일이 지난 뒤 정리 대상으로 삼는다. 이는 제한된 기술 관측의 운영 보존 설정이며 원고·문의·신원·거래의 법정 보존기간을 정한 것이 아니다. 실제 제거는 정리 작업의 실행/성공과 batch 처리에 따라 지연될 수 있다. heartbeat는 운영 정리 작업이 DB에 도달했다는 신호이며 예약 회차가 성공적으로 발행되었다는 증거가 아니다.

## 4. 탈퇴·보존·관리자 접근

현재 `authoring.retention_policy`의 원고 버전/휴지통 기간은 승인된 값이 없으면 NULL이며, 이때 자동 purge를 하지 않는 계약이다. 기간을 새로 정하는 작업과 삭제 기능 구현을 분리한다. 이 문서는 법정 보존기간을 새로 확정하지 않는다. [데이터 계약](data-contract.md), [권한 계약](permission-matrix.md).

1. 담당자와 검토자가 계정 Auth UUID, 작가 프로필 ID, 소유 작품, 공개 이력, 진행 중 분쟁과 거래를 구분한다. 같은 실명을 인증한 다른 ID·필명 계정의 작품과 권한을 합치지 않는다.
2. 계정 접근을 서버에서 먼저 제한한다. 로그인 차단·세션 처리·원고 제공 가능 범위를 검토하고 결과를 기록한다.
3. 원고/버전, 업로드 원본/변환 이미지, 공개본, 문의/분쟁 증빙, 동의·신원 연결, 거래 기록별 삭제 또는 보존 근거·기간·책임자를 확인한다. 법률 검토가 필요한 기간은 확정 전 자동화하지 않는다. 보존 예외는 근거·범위·재검토일을 기록하며 무기한 기본값으로 만들지 않는다.
4. 기존 `authoring.erase_author_enrollment(auth_uuid)`는 운영자 전용이다. 접근 제한 확인과 `webnovels.author_erasure_verified=true` 검토 게이트를 통과해야 하며, 다른 계정이 참조하는 person 연결은 보존한다. 이것만 실행했다고 계정·원고·Storage의 전체 삭제가 완료되는 것은 아니다.
5. 원본·이미지 참조와 공개 이력, 타 계정의 연결을 확인한 후 검토된 삭제 작업을 수행한다. 활성 DB 삭제와 백업의 만료·접근 차단을 별도 기록하고 백업 복원 시 삭제 결정을 재적용할 절차를 마련한다.
6. 처리 결과에는 대상 범주, 근거 참조, 실행자, 검토자, 시각, 삭제/보존 개수, 실패/재시도 상태만 남긴다. 삭제한 민감정보 원문을 감사 로그에 복사하지 않는다.

PASS 미완료 인증은 기존 동의 문안의 24시간 내 파기 정책과 23시간 경과 정리 함수를 따른다. 수집 활성화 전에 최소 매시간 정리·실패 감지를 실제로 인수한다. 완료된 신원 연결·동의의 탈퇴 처리는 위 검토 절차에 포함한다. 현재 PASS 계약·수집 활성화는 미완료다. [34단계 신원 계약](stage34-author-enrollment.md).

관리자 화면·API는 서버의 현재 관리자 신분과 권한으로 매번 판정한다. 화면 숨김이나 localStorage 역할값으로 권한을 대신하지 않는다. 제공자 설정은 최고 관리자 재인증·revision·시도 제한을 유지하고, 지원 담당에게 비밀 설정이나 전체 DB 권한을 추가하지 않는다. 관리자 퇴사/권한 회수 시 세션·API 자격증명·공유 비밀 접근을 함께 검토하고 실제 거절 검증을 남긴다.

## 5. 암호화 키 교체

| 키 | 영향과 현재 한계 |
|---|---|
| `PROVIDER_SETTINGS_MASTER_KEY` / 버전 | provider/mode/keyVersion을 AAD로 묶은 AES-256-GCM 암호문. 현 코드에는 자동 재암호화/다중 키 읽기가 없으므로 값·버전만 바꾸면 기존 설정을 읽지 못함 |
| `AUTHOR_IDENTITY_HMAC_KEY` / 버전 | CI/DI 원문을 저장하지 않는 본인 연결 지문. 원문 없는 기존 지문을 새 키로 재계산할 수 없음. 이름·이메일로 연결을 추정하거나 기존 person을 자동 병합하면 안 됨 |
| `AUTHOR_BANK_ENCRYPTION_KEY` | 계좌 전용 키가 없으면 Supabase 서버 secret을 사용한 기존 경로가 있음. Supabase API 키 교체 전 실제 사용 키를 비밀 저장소에 보존·고정하거나 검증된 재암호화 필요 |
| 이미지 shared secret / Supabase API 자격증명 | 호출 인증용. 양쪽 바인딩·최소 권한·배포 순서와 실패 시 복귀를 검증. 데이터 암호화 키와 같은 개념으로 취급하지 않음 |

제공자 master 키 교체의 후속 구현 순서는 다음과 같다.

1. 변경 대상 암호문 수·버전만 조사하고 검토된 백업과 기존 키의 별도 접근 제한 보관을 확인한다. 비밀값은 DB·Git·로그에 남기지 않는다.
2. 격리 환경에서 구 키 읽기/신 키 쓰기, provider/mode AAD 검증, 실패·중단·동시 수정·복귀를 시험한다. 기존 revision을 조건으로 갱신하고 예상 개수가 맞지 않으면 중단한다.
3. 변경 창과 설정 쓰기 잠금 또는 검증된 다중 키 읽기 전환을 설계한다. 현재 단일 키 구현에 환경 변수 변경만 적용하지 않는다.
4. 모든 활성 암호문과 복구에 필요한 백업의 키 참조를 검증한 뒤 새 읽기 키를 전환한다. 백업 보존·복원에 구 키가 필요한 동안 구 키를 임의 파기하지 않는다.
5. 키를 잃은 암호문을 복호화했다고 간주하지 않는다. 최고 관리자의 재인증 후 제공자 자격증명 재입력 또는 별도 재확인 절차로 복구한다.

PASS HMAC 회전은 별도 설계가 필요하다. 실제 제공자 재확인으로 기존 person과 연결할 증거, 동의·식별자 버전, 중복 계정 허용, 구/신 키 전환 기간을 검증해야 한다. 현재 이 절차를 완료하기 전 PASS 수집을 켜지 않는다. 무료 베타에서 정산 계좌 수집도 활성화하지 않는다. [제공자 설정 계약](stage35-provider-settings.md), [계좌 키 계약](author-dashboard-rollout.md), [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

## 6. 별도 환경에서 DB·Storage 복원

**이번 실행 상태: 미실행.** 별도 Supabase 대상이 설정되어 있지 않다. 운영 프로젝트를 격리 대상으로 간주하거나 합성 DB 통과를 실제 복원 성공으로 기록하지 않는다.

Supabase DB 백업에는 Storage 메타데이터가 들어가지만 파일 바이트는 포함되지 않는다. 새 프로젝트 복사도 Storage 객체와 외부 설정을 별도로 준비해야 한다. DB dump 하나로 이미지와 Cloudflare 비밀까지 복구된다고 가정하지 않는다. [Supabase 백업](https://supabase.com/docs/guides/platform/backups), [프로젝트 복사](https://supabase.com/docs/guides/platform/clone-project).

| 순서 | 실행·검증 기준 | 기존 도구 |
|---|---|---|
| A. 대상 격리 | 운영과 다른 project ref·소유권 확인. Auth 가입/메일, Cron·Webhook·외부 결제·발행 중단. 대상의 기존 데이터가 없는지 확인 | `npm run audit:restore-target` (`SUPABASE_RESTORE_TARGET_REF` 준비 후; 읽기 감사) |
| B. 백업 범위 | 현재 schema/table/sequence/권한/RPC/Auth 범위와 스냅샷 기준 시각 검토. 테스트 초기화용 이전 백업으로 현재 운영 데이터가 모두 포함된다고 가정하지 않음 | `backup_launch_postgres.cjs`, `backup_launch_data.cjs`, `launch-backup-scope.cjs` |
| C. 파일 백업 | private bucket 설정·객체 경로·바이트·MIME·크기·해시·작품 참조를 같은 복구 기준으로 목록화하고 별도 저장. 변환본뿐 아니라 보존 대상 원본 포함 | 기존 recovery manifest 계약 확장; 실제 객체 추출·전송 인수 필요 |
| D. DB 복원 | archive 목록·DDL·role/extension 의존성을 먼저 검토. source와 target 재대조 후 검토된 restore 수행. 오류 시 중단하고 기록 | native `pg_restore`, 대상별 검토된 owner/ACL 매핑 |
| E. 객체 복원 | 대상 Storage API로 바이트와 bucket 정책을 복원. DB에 객체 metadata만 INSERT해서 파일 복원으로 대체하지 않음 | Supabase Storage API; inventory/sha256 대조 |
| F. 권한·기능 인수 | 스키마/FK/행수/공개 head·revision·소유권 대조. 실제 anon/authenticated/service_role의 허용·거절, Auth 계정 분리, private 이미지 접근, 비밀 설정 복구 확인 | 기존 SET ROLE·RPC 테스트를 격리 환경에 맞춰 실행 |
| G. 증빙 | 소스/복원 경로와 snapshot ID, archive/객체 해시, target ref, 실제 작업/검증 시각, 실패·복구 소요시간을 기록. 승인한 RPO/RTO가 없다면 수치 임의 약속 금지 | `npm run verify:recovery -- <source-dir> <restored-dir>` + 실제 hosted 인수 기록 |

`recovery-bundle.mjs`는 경로 이탈·symlink·해시·크기·상태 fingerprint를 검증하지만 `pg_restore` 실행이나 증빙의 출처를 인증하지 않는다. 반환하는 `hostedRestoreAccepted:false`를 실제 실행 증거 없이 뒤집지 않는다. `prepare:legacy-publications` 등 과거 원본 이관 도구는 전체 서비스 재해복구 도구가 아니다.

기존 native 백업은 역할·공급자 설정·Storage 바이트·외부 보관소까지 모두 보장하지 않는다. 일관된 DB archive와 데이터베이스 밖의 객체 스냅샷을 함께 검토한다. `pg_dump`의 custom archive와 `pg_restore`는 기존 도구를 그대로 사용하되, `auth`/`storage` 소유자를 임의 변경하거나 명시적 ACL을 생략해 복원 오류를 우회하지 않는다. [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [Supabase 시스템 권한](https://supabase.com/docs/guides/platform/permissions), [명시적 권한 계약](supabase-explicit-grants-2026-10-21.md).

## 7. 다음 단계의 완료 조건

- **외부 베타 가입:** SMTP 설정 후 실수신·복구·반송/제한 대응 인수. 이메일 확인을 우회해 공개 가입을 열지 않는다.
- **실제 사용 흐름:** 사용자의 브라우저 검증 요청을 받은 뒤 모바일/데스크톱에서 가입→웹소설/웹툰 등록→붙여넣기/이미지 순서→저장·충돌복구→즉시/예약 발행→독자 탐색·열람을 확인한다.
- **복구 훈련:** 별도 Supabase target과 제한된 백업 보관소를 준비하고 위 A–G 실행 결과, 실제 복구 시간과 담당자를 기록한다.
- **보존·키 교체:** 탈퇴 대상별 보존 근거와 예외 처리, 암호문 재암호화 및 PASS 지문 전환 도구를 격리 환경에서 검증한다.
- **유료·PASS:** 계약·사업자 운영 요건과 실제 채널을 준비한 다음 별도 단계로 인수한다. 관리자 설정 저장이나 이번 배포 성공만으로 활성화하지 않는다.

이 조건이 남아 있는 동안 코드 검증, 운영 DB 적용, Cloudflare 배포, 외부 사용자 인수의 상태를 각각 보고한다.
