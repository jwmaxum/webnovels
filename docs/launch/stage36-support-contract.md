# 36단계 베타 지원함 계약

## 목적과 범위

로그인한 작가·독자가 문의, 오류 제보, 개선 제안, 저작권 분쟁, 탈퇴 요청을 직접 접수하고 자신의 처리 이력을 확인한다. 관리자는 기존 `CASE_READ`·`CASE_RESOLVE` 권한으로 지원함을 처리한다. 작가 신원은 기존 Author 계약을 따른다. 계정 소유권은 검증된 Auth UUID이며 작가 bigint ID, 독자 프로필 UUID, 작품 ID와 혼용하지 않는다.

기존 9·17단계의 콘텐츠 신고·이의제기·공개 제한은 해당 콘텐츠 사건을 처리하는 별도 경로다. 지원함의 답변·상태 변경은 작품 제재를 해제하거나 원고·회원·작품을 삭제하지 않는다. 저작권 분쟁은 접수·증빙 요청·안내를 기록한 후 기존 관리자 콘텐츠 절차로 판단한다. 탈퇴도 검토 요청이며, 운영자가 보존·정산·분쟁 범위를 검토한 별도 승인 절차 없이 계정을 삭제하지 않는다.

공개 베타 가입·발행 플래그가 꺼져 있어도 기존 활성 계정은 지원함을 사용할 수 있다. 계정 API 인증과 DB migration readiness만 사용한다. PASS·Toss 신청이나 SMTP 발송은 이 기능의 선행 조건이 아니며, 이 단계에서 이메일·외부 서비스 알림을 발송하지 않는다.

## API

모든 응답은 계정 API의 비공개·캐시 금지 계약을 따른다. 서버는 세션을 검증한 `user.id`만 RPC에 전달한다. 클라이언트의 계정 ID, 관리자 권한, 파일·원고 내용은 자동으로 수집하지 않는다. 첨부 파일 기능은 제공하지 않는다.

| 호출 | 권한·입력 | 응답 |
| --- | --- | --- |
| `GET /api/v2/support?action=list` | 본인, 선택 `offset`, `status` | `items`, `nextOffset` |
| `GET /api/v2/support?action=detail&id=UUID` | 본인 사건만 | `case`, `messages` |
| `POST /api/v2/support?action=create` | `requestId`, `category`, `title`, `message`, 선택 `workId`, `withdrawalConfirmed` | 상세와 `saved`, `replayed` |
| `POST /api/v2/support?action=reply/reopen/cancel` | `requestId`, `id`, `revision`, `message` | 상세와 `saved`, `replayed` |
| `GET /api/v2/admin/support?action=list/detail` | `CASE_READ`; 목록은 추가 `category` 필터 | 같은 형태의 목록·상세 |
| `POST /api/v2/admin/support?action=reply/transition` | `CASE_READ`와 `CASE_RESOLVE`; 공통 수정 입력, transition은 추가 `status` | 상세와 `saved`, `replayed` |

`SUPER_ADMIN`은 두 권한을 가진다. 비활성 관리자, 확인되지 않은 이메일, 익명·정지·삭제 Auth 계정, 비활성 연결 프로필은 DB에서도 차단한다. 권한이 변경된 후에는 이전에 저장된 requestId도 권한 검사를 우회하지 못한다.

카테고리는 `QUESTION`, `BUG`, `IDEA`, `COPYRIGHT`, `WITHDRAWAL`이다. `WITHDRAWAL` 생성 시 `withdrawalConfirmed: true`가 반드시 필요하다. UI는 요청 접수만 이루어지며 자동 삭제되지 않음을 설명한다. 제목은 3~120자, 본문은 3~4,000자다. 제어 문자를 차단하고 일반 텍스트로 저장한다. 화면에서는 HTML로 실행하지 않고 텍스트로 표시한다. 운영자는 비밀번호·API 키·전체 원고·주민등록번호를 요청하지 않는다.

`workId`는 양수 십진 문자열이며 본인 작품 또는 현재 독자에게 공개 가능한 작품만 연결할 수 있다. 소설·웹툰 모두 허용한다. 타인의 비공개 작품과 없는 작품은 동일한 `WORK_NOT_FOUND`로 처리한다. 지원 사건 본문에 작품 데이터가 자동으로 복사되지 않는다.

`case` 필드: `id`, `category`, `title`, `status`, 십진 문자열 `revision`, `workId`, `createdAt`, `updatedAt`, `replyCount`, `reopenCount`.

`messages` 항목: `id`, `kind`, `authorKind`(`USER`/`ADMIN`), `message`, `createdAt`, `previousStatus`, `status`. Auth ID·이메일·실명·필명은 응답에 포함하지 않는다. 접수와 상태 변경 사유도 메시지 이력으로 남고 수정·삭제 API는 없다.

## 상태와 재시도

| 동작 | 허용 상태 | 결과 |
| --- | --- | --- |
| 사용자 추가 답변 | OPEN, IN_REVIEW, WAITING_USER | WAITING_USER는 OPEN으로 전환 |
| 관리자 답변 | OPEN, IN_REVIEW, WAITING_USER | 상태 유지 |
| 관리자 상태 변경 | OPEN, IN_REVIEW, WAITING_USER | 다른 활성 상태 또는 RESOLVED/CLOSED |
| 관리자 종결 | RESOLVED | CLOSED |
| 사용자 이의제기·재개 | RESOLVED, CLOSED | OPEN, 사건당 최대 2회 |
| 사용자 취소 | OPEN, IN_REVIEW, WAITING_USER | CANCELLED, 재개 불가 |

모든 수정은 본문 사유, 예상 `revision`, UUID `requestId`를 요구한다. 사건 행의 `FOR UPDATE`와 revision 비교로 동시 수정 충돌을 `CONFLICT`로 반환한다. 클라이언트는 상세를 다시 읽고 작성자가 재검토한 뒤 새 요청을 전송한다.

Auth 사용자별 트랜잭션 잠금과 `(actor_id, request_id)` 기본 키로 동일한 요청의 중복 반영을 막는다. 같은 키·다른 입력은 `CONFLICT`; 같은 키·같은 입력은 재적용 없이 현재 상세와 `replayed:true`를 반환한다. 재시도 시 기존 requestId를 유지하고, 성공 확인 후 새 작업에 새 키를 사용한다.

쓰기 성공은 사용자당 1시간에 30회, 동시에 미종결 사건은 10개, 사건 이력은 최대 200개다. 동일 요청 재시도는 한도를 다시 소비하지 않는다. `RATE_LIMITED`, `OPEN_CASE_LIMIT`, `CASE_MESSAGE_LIMIT`는 자동 반복하지 않고 안내한다. 목록은 20건씩, offset 상한은 999,999다. 목록의 정렬은 최근 갱신 순서이므로 처리 도중의 새로운 사건은 새로고침 시 반영된다.

## 저장·권한·운영

마이그레이션 `026_beta_support.sql`은 검토 세션과 `authoring-014` 선행을 요구한다. `support_cases`, `support_messages`, `support_receipts`, `support_limits`는 비공개 `authoring` 스키마에 생성하며 각각 RLS를 활성화한다. 같은 마이그레이션에서 `PUBLIC`, `anon`, `authenticated`, `service_role` 직접 테이블 권한을 명시적으로 회수한다. 공개 스키마의 `beta_support(uuid,boolean,text,jsonb)` RPC만 `service_role`에 EXECUTE를 부여한다. `SECURITY DEFINER`의 search_path는 비어 있고 모든 객체를 스키마로 한정한다. 내부 상세 헬퍼도 서비스 역할에서 직접 실행할 수 없다.

메시지·요청 영수증은 기존 append-only 트리거를 사용한다. 각 메시지에는 실제 처리자 Auth UUID가 감사용으로 비공개 저장된다. 외부 표시에는 역할 구분만 제공한다. 계정·작품 참조는 RESTRICT이며 자동 연쇄 삭제는 없다.

이 단계에서는 기존 기록·계정을 정리하지 않으며 보존기간을 임의 확정하지 않는다. 운영 전 개인정보처리방침과 분쟁 보존 요건에 맞춰 지원 기록·멱등 영수증의 보존기간, 삭제/비식별화 승인 절차와 백업 복원 절차를 확정해야 한다. 수정 불가 감사 이력의 삭제는 일반 앱 RPC로 수행할 수 없으며 별도 검토된 관리 마이그레이션이 필요하다.

## 검증과 다음 단계

`scripts/verify_stage36_support.test.mjs`는 API 입력·출처·스트림 크기 검증, 합성 DB의 본인/타인 격리, 현재 관리자 권한, 비활성 계정 차단, append-only 이력, 탈퇴 시 데이터 보존, 재개 횟수, 속도 제한, 멱등 요청, revision 충돌, 실제 `SET ROLE` ACL 거절/허용을 검증한다. 합성 PGlite의 동시 Promise 호출은 두 연결을 가진 실제 PostgreSQL 동시성 인수를 대체하지 않는다.

실제 DB 적용, 배포, 브라우저 인수 결과는 단계 실행 보고에서 별도로 기록한다. 후속 운영 인수에서는 실제 PostgreSQL 두 세션으로 동일 요청/동일 revision 경쟁, 계정 정지와 지원 쓰기 경합, 회원→관리자→회원 처리 흐름을 확인한다. 콘텐츠 제재의 이의제기는 기존 콘텐츠 사건 절차를 유지한다. 메일을 준비한 뒤에는 최소 정보 알림과 실패 재시도, 지원 기록 보존 정책, 운영 대응시간 대시보드를 별도 개발한다.

`scripts/prepare_stage36.mjs <논리 백업 디렉터리>`는 검증된 snapshot을 별도 PGlite에 복원하여 026·027 마이그레이션만 두 번 실행하고, 모든 기존 행과 서비스 설정 보존·신규 비공개 권한을 검사한다. `--apply --native-backup=<네이티브 백업 디렉터리>`를 명시한 운영 실행에서만 원격 변경한다. 해당 실행은 24시간 이내 논리/네이티브 백업, dump 해시와 TOC, 프로젝트와 전체 백업 범위의 일치를 요구한다. 적용 트랜잭션에서는 실제 원본 범위와 행 해시를 다시 비교하고 변경되었다면 중단한다. 35단계 초기화 도구를 호출하지 않는다.

원본 검사 전에 `REPEATABLE READ` 격리 수준과 잠금·실행 제한 시간을 설정한다. 앱 스키마는 `SHARE ROW EXCLUSIVE`, 공급자 관리 `auth`·`storage` 스키마는 기존 SELECT 권한으로 가능한 `ACCESS SHARE`를 사용한다. 모든 잠금을 먼저 획득한 뒤 동일 트랜잭션 snapshot에서 전체 테이블 범위와 행 해시를 검사한다. 관리형 테이블의 소유권·권한을 변경하지 않으며 026·027은 해당 테이블을 쓰지 않는다. 공급자의 Auth·Storage 동시 쓰기는 정지시키지 않는다. 적용 후 별도 읽기 검증에서 원본 변화가 확인되면 적용 사실은 보존하되 검토 실패로 중단하고 배포 준비 완료로 표시하지 않는다. 공급자 활동을 동결했거나 두 개 연결의 운영 동시성을 인수했다고 해석하면 안 된다.

잠금 권한과 실행 순서는 [PostgreSQL 17 LOCK 공식 문서](https://www.postgresql.org/docs/17/sql-lock.html)를 따른다. SELECT만 가진 역할은 ACCESS SHARE를 사용할 수 있고, REPEATABLE READ에서는 잠금 대기 이후 최신 커밋을 검사하려면 SELECT·데이터 변경보다 잠금을 먼저 획득해야 한다.

`artifacts/stage36-preparation.json`은 집계 검증 결과와 적용 여부만 기록한다. 운영 적용이 성공하면 `applied`, `productionApplied`, `projectRef`와 후속 읽기 검증 결과를 제공한다. 독립적으로 찍힌 두 백업이 같은 행 상태라는 보증이나 실제 Supabase 복원 인수를 뜻하지는 않는다. `scripts/verify_stage36_preparation.test.mjs`는 이 준비 도구와 잘못된 백업·범위·해시·시점 거절을 합성 데이터로 검증한다.
