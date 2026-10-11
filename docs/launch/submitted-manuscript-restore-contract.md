# 검토된 제출 원고의 트랜잭션 복구 후보 — 31단계

작성일: 2026-10-11. [계획](../../improve31.md), [30단계 증거](recovery-evidence-package-contract.md),
[접수](creator-recovery-request-contract.md), [관리자 검토](admin-recovery-review-contract.md)를 확장한다.

## 입력과 명령

기존 `scratch/launch/backups` 아래의 검증된 snapshot·stage30 패키지·전체 결정 파일과 실제
원본/권리/등급/AI/필요 이미지 증거 바이트를 재사용한다. 외부 원고는 기존 두 본문 선택
schema로 변환하지 않는다. 최초 가져오기 revision, 고정 제출 revision, 현재 편집 초안을 구분한다.
Auth UUID·author/work/episode bigint·draft UUID를 혼용하지 않는다.

```text
npm run prepare:submitted-restore -- assess <검증-백업-디렉터리> <stage30-패키지명>
npm run prepare:submitted-restore -- rehearse <검증-백업-디렉터리> <stage30-패키지명> <결정파일.json> <별도-target-ref> <새-후보명>
npm run prepare:submitted-restore -- check <검증-백업-디렉터리> <stage30-패키지명> <결정파일.json> <별도-target-ref> <후보명>
```

target ref는 20자 프로젝트 ID이며 source와 같으면 거절한다. 연결 URL/비밀번호가 아니다.
`rehearse/check`는 새 in-memory PGlite에 source를 복원하고 후보 SQL을 **격리 실행**한다.
`check`는 같은 입력으로 결과를 다시 생성하여 세 출력 파일 전체 바이트를 비교한다.
CLI는 환경 변수·원격 DB·운영 apply를 지원하지 않는다. 실제 근거가 없거나 선택이 없으면
SQL/출력을 만들지 않는다. 후보 검증 성공은 종료0, 전제 누락/선택 없음은2, 오류는1이다.
stdout은 해시/수량/차단 상태이며 원고·개인정보·계정 상세·전체 로컬 경로는 출력하지 않는다.

## 원자성·전체 행 CAS·보존

`database/launch/005_submitted_manuscript_restore.sql`은 적용 마이그레이션이 아닌 생성용
검토 템플릿이다. 선택된 요청 전부를 하나의 transaction에 넣는다. 모든 snapshot 테이블을
정해진 순서로 ACCESS EXCLUSIVE 잠금하며 lock5초/statement60초 한도를 둔다. 일반 서비스
동작 중 실행하는 도구가 아니며 실패/timeout에는 전부 rollback하고 새 snapshot·검토가 필요하다.

선택/비대상/빈 테이블의 전체 행은 PostgreSQL `to_jsonb(row)::text`의 SHA256 multiset·행수로
비교하고 테이블 집합도 비교한다. 삭제/추가/계정·초안·원고·예약·이력 변경 하나라도 거절한다.
Auth 비밀번호/이메일 원문을 SQL 후보에 넣지 않는다. bigint가 포함된 원본 행은 JS Number로
재직렬화하지 않고 SQL JSONB 연산으로 예상 전후 행을 만든다. SHA는 CAS/변조 확인이며
권리자 신원 인증이나 원본 내용 승인 증명은 아니다.

쓰기를 시작하기 전에 최신 READY revision·현재 SUPER_ADMIN/Auth·작가/작품/파일 lineage·
대상 context와 정확한 원래 target을 재확인한다. 기존 stage30가 고정한 모든 검토/열람/
receipt/감사 행을 포함한 전체 행 CAS와 함께 검증한다. 검토 테이블도 잠그므로 검토 삽입을
다른 transaction이 끼워 넣을 수 없다. PGlite의 단일 연결 실행은 hosted 다중 연결 인수와 다르다.

소설 본문만 `episodes.content`, `secure_episode_contents.content`, 존재하는
`episode_contents.text_content`에 반영한다. 보호 본문이 없거나 공개 head/예약이 있는
선택 대상은 차단한다. 제목·작가 메모는 제출본 이력에 보관하되 기존 회차 메타데이터를
교체하지 않는다. 이미지/시각/본문 버전 번호와 다른 모든 필드는 보존한다. 기존 P0 mirror가
보호 이미지/시각을 갱신하면 선택 대상의 원래 값을 명시적으로 보존하고 트리거는 끄지 않는다.
예상하지 않은 트리거의 다른 행/필드 변경은 쓰기 이후 전체 행 대조에서 실패한다.
공개 head/버전 생성·초안 연결·예약·권리/등급/AI 표시·계정·원장/P0 변경은 하지 않는다.

## 비공개 이력과 출력

`launch_recovery.submitted_restore_history`에 batch/request/episode, source/target/snapshot/
packet/decision 해시, 검토 revision, 원래 전체 target과 실제 변경 후 전체 target, 고정 제출본,
가져온 원본 내용, 원본/근거 descriptor와 검토 참조를 함께 보관한다. 기존 원본 파일 바이트는
private backup root에 그대로 남는다. request unique 제약으로 새 batch에서도 재실행을 거절한다.

이력은 RLS와 schema/table/function revoke로 anon/authenticated/service_role의 직접 접근을
닫고 UPDATE/DELETE/TRUNCATE trigger로 불변성을 보호한다. DB 소유자/슈퍼유저가 보호를
해제하는 행위까지 막았다고 주장하지 않는다. 기존 이력과 보류 요청을 덮어쓰지 않는다.
전후 대조와 이력 삽입도 같은 transaction 안에 있어 중간 실패 시 DDL/본문/이력 전부 rollback한다.

새 후보 디렉터리에 `005_submitted_manuscript_restore.sql`, `verification.json`, `manifest.json`만
작성하며 기존 출력을 덮어쓰지 않는다. SQL에는 비공개 제출 원고가 있으므로 Git/공유 채널에
넣지 않는다. SQL/report/template SHA와 재생성 바이트 대조는 새 입력/템플릿 변경을 감지한다.

## hosted 적용 경계와 다음 단계

SQL 자체는 웹 역할을 거절하며 DB 운영자의 `webnovels.submitted_restore_reviewed=true`,
`webnovels.restore_runtime_disabled=true`, `webnovels.restore_target_ref=<후보의 별도 ref>`를
요구한다. 이 세 설정은 운영자의 명시적 확인/후보 연결 조건이다. 실제 프로젝트 신원이나
서비스 중단·승인 사실을 자동 인증하지 않는다. **이 값을 설정하는 운영 실행 명령을 제공하거나
실제 원격에 적용하지 않는다.** 32단계의 별도 대상 신원/소유·메일/작업 격리, 최신 hosted snapshot,
native DDL/trigger/role/RLS/RPC, 실제 Auth/Storage 파일 바이트·다중 연결 인수가 선행되어야 한다.

실제 적용 직전 원본/근거를 다시 확인하고 후보 `check`를 재실행한다. 기존 78건 전체 충돌,
다른 PENDING/HOLD, 019/020 전제, P0 잠금, 무료 공개본/베타 인수는 별도 게이트로 유지한다.
일부 요청 복구 후보 성공을 전체 출시 가능으로 계산하지 않는다. `productionChanged`,
`hostedRestoreAccepted`, `freeCutoverAccepted`, `rightsAuthenticated`는 false다.

## 2026-10-11 실제 준비 상태

지정 `.env.local`을 비밀 출력 없이 읽고 관리 API를 읽기 전용으로 확인했다. 접근 가능한
프로젝트는 운영1개, 별도 target 설정/대상0개다. Auth42·연결 작가30·기존 본문 충돌78·
Storage0이며 기본 마이그레이션12개와019/020이 미적용이고 health503이다.
[현재 감사](../../artifacts/stage31-launch-readiness.json)는 NO_GO다.

기존 검증된 실제 논리 백업에 대한 `assess` 재생성은 전제 누락12·요청/선택0·종료2다.
이 백업은019/020 이전이며 새로운 hosted 적용 snapshot이 아니다. 요청0은 기존78건 원본/
권리 확보 완료를 의미하지 않는다. 실제 원본/근거를 대신 생성하거나 별도 target을 운영으로
대체하지 않았다. [입력 점검](../../artifacts/stage31-source-readiness.json)에 후보 미생성·
본문 미교체를 기록한다. 운영 SQL·원고·플래그·결제와 실제 hosted/브라우저 인수는 미실행이다.

## 조사·검증 근거

새 의존성 없이 기존 PGlite/Zod/백업/증거 도구를 확장했다. 저장소·스킬·공식 웹/GitHub를
조사했다. npm registry 직접 검색은403/접속 오류, gh CLI·DB/Context7 MCP는 미제공이므로
전체 registry/MCP 검색을 완료한 것으로 기록하지 않는다.

- [PostgreSQL 잠금](https://www.postgresql.org/docs/current/explicit-locking.html), [격리](https://www.postgresql.org/docs/current/transaction-iso.html): transaction 잠금·실패 시 전체 재검토/재시도.
- [내장 SHA256](https://www.postgresql.org/docs/current/functions-binarystring.html): 추가 pgcrypto 없이 전체 행 digest 비교.
- [PGlite transaction](https://pglite.dev/docs/api#transaction), [공식 저장소](https://github.com/electric-sql/pglite): 격리 SQL 실행과 단일 연결 한계.

전용 테스트는 실제 파일 바이트를 가진 합성 입력과 PGlite에서 세 본문 경로, 미선택 전체 행,
권한/검토 철회·변조·중간 실패/트리거 부작용 rollback, bigint/문자열, 불변 이력/웹 권한·
재실행·출력 바이트·CLI를 검증한다. 실제 작가 원본 수령/권리 확인·hosted·브라우저 인수와 구분한다.
