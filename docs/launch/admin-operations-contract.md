# 9단계 관리자 운영 계약

## 적용 경계

`ADMIN_OPERATIONS_ENABLED`와 `ADMIN_ROLE_CHANGES_ENABLED`는 기본 `false`다. `authoring-009`까지 실제 DB에 적용되고 4~8단계 작가·독자 대체 경로가 계정별로 검증된 뒤, 기존 검수·신고·감사 테이블 형태와 복원 백업을 대조하여 `010_admin_operations.sql`을 검토 적용한다. 검토 세션에 `webnovels.authoring_apply_verified=true`를 설정해야 실행된다. 합성 PGlite 통과는 운영 DB 적용 증거가 아니다. 운영 플래그 활성화는 별도 인수 후 수행한다.

기존 작품·회차·원고·수익·신고 행은 삭제하거나 일괄 변환하지 않는다. 새 SQL은 처리 이력, 권한 변경 이력, 이의제기 상태를 추가하고 작가 알림 종류에 `MODERATION`을 추가한다. 기존 RLS 잠금과 직접 Supabase 쓰기 폐쇄는 10단계 작업이다.

## API와 권한

`/api/v2/admin/operations`는 서버가 검증한 Auth UUID 및 최신 관리자 매핑을 사용한다. 쓰기는 같은 출처의 JSON POST이며 서버 전용 RPC `stage9_admin`으로만 실행한다. 브라우저에 service role 키를 제공하지 않는다.

| 동작 | 권한 | 결과 |
|---|---|---|
| `dashboard` | `OPERATIONS_READ`, 기존 `DASHBOARD` | 실제 작품·회원·대기 건수, 예약 실패 건수 |
| `accounts?kind=reader/author` | `ACCOUNTS_READ`, 범위별 기존 `USER_MGMT`/`CREATOR_MGMT` | 최소 필드 100건, 비밀번호·비공개 정보 제외 |
| `account-moderate` | `ACCOUNT_MODERATE` | 기존 활성 계정 정지·복구, 본인 조치 금지, 사유·담당·이력 |
| `work-list` | `CONTENT_METADATA_READ`, 기존 `WORK_MGMT` | 작품 운영 상태·큐레이션 목록 |
| `cases?source=CONTENT_REVIEW/REPORT/COMMENT_REPORT` | 각 기존 권한 또는 `CASE_READ` | 대기 건 200건 이하 |
| `case-resolve` | `CASE_RESOLVE` 또는 종류별 기존 권한 | 행 잠금, 상태 확인, 조치·사유·담당·영속 이력 |
| `appeals` / `appeal-resolve` | `CASE_READ` / `CASE_RESOLVE` | 이의제기 별도 처리함, 접수·기각 및 처리 사유 |
| `moderate` | `CONTENT_MODERATE` | 작품 노출 제한·해제, version 확인, 작가 알림·이력. 원고 수정 없음 |
| `curate` | `CURATION_WRITE` | 추천·인기·신작 플래그만 변경, version 확인·이력 |
| `roles` / `role-update` | 최고 관리자 | 제한 관리자 9단계 권한만 편집, 과거 권한 보존·이력 |
| `audit` | `AUDIT_READ`, 기존 `SECURITY_MGMT` | 9단계 사건·작품·권한 변경 기록 |

`CASE_RESOLVE`는 처리함 읽기 권한과 별개다. 기존 `CONTENT_REVIEW`/`COMMENT_REPORT` 담당자는 해당 종류를 계속 처리할 수 있다. 기존 `CONTENT_WRITE`를 새 운영 권한으로 자동 이관하지 않는다. `role-update`는 최고 관리자 자신과 최고 관리자 대상 변경을 거절하며 허용된 9단계 권한 문자열만 받는다.

권한 변경 API와 화면 편집은 `ADMIN_ROLE_CHANGES_ENABLED=true`일 때만 열린다. 최고 관리자 재인증 경로와 대상 관리자 권한 갱신의 실환경 검증이 끝나기 전에는 이 플래그를 켜지 않는다.

동일 사건은 `PENDING`에서 한 번만 처리되고 `(source, source_id)`가 고유하다. 두 번째 요청은 409다. 댓글 신고의 `RESOLVE`는 댓글을 차단하고 기존 댓글/신고 증거를 보존한다. 기존 일반 신고의 `RESOLVE`는 확인된 댓글 대상에만 적용하고 다른 대상은 409로 보류한다. 콘텐츠 검수의 승인·반려는 검수 상태만 변경한다. 모든 처리 사유는 3~500자다.

`/api/v2/appeals`는 로그인한 독자·작가에게 본인 관련 완료 사건만 보여준다. 기존 검수·신고 및 현재 제한 중인 자신의 작품에 대해 이의제기를 접수한다. 같은 사건의 대기 신청은 하나이며 최대 두 번 제출할 수 있다. 관리자의 `ACCEPT`는 이의 검토를 접수한 상태 기록이며 제재를 자동 해제하지 않는다. 해제는 별도 `moderate` 조치와 이력을 거친다.

## 화면과 제거 범위

활성화 시 기존 `/admin/*` 링크는 7개 운영 화면 또는 미제공 안내로 연결된다. 광고·수익·정산·팬미팅·굿즈·프로모션 메뉴와 자동 로더는 새 화면과 구 화면에서 제거했다. 구 화면의 해당 URL도 안내 후 대시보드로 이동한다. 구 Action Queue는 DB 로더가 없고 실패해도 완료로 표시하던 경로여서 제거했다. 구 대시보드는 실제 DB 기본 건수만 표시하며 조회에 실패하면 숫자를 표시하지 않는다. 새 운영 요약은 응답 대기, 0건, 오류를 구분한다. 관리자 작품·회차 대행 생성, 회차 본문 편집·무료 전환·삭제, 작품 대량 삭제 및 브라우저의 관련 직접 쓰기 함수는 제거했다. 구 관리자 쉘의 남은 기능은 인수 전 롤백을 위해 플래그 비활성 상태에서만 남아 있다.

작가 직접 작성은 `CreatorWorks`/`CreatorDraftEditor`/게시 API가 담당한다. 독자 검색·작가 스튜디오가 사용하는 `WebNovelsAdmin`의 공용 읽기 함수는 이 단계에서 지우지 않는다.

## 남은 인수 항목

- 4~8단계 실제 Supabase/Storage 및 브라우저·다른 계정 검증, 010 운영 적용, 기능 플래그 전환.
- Auth 재설정 초대와 사건별 비공개 원고 예외 열람. 이의제기 접수 후 실제 제재 해제 여부는 별도 사건 조치가 필요하다.
- 기존 `audit_logs`와 새 운영 이력의 통합 열람, 구 관리자 직접 DB 경로와 서버 API 폐쇄는 10단계 보안 잠금으로 확인한다.
- 권한 변경 시 대상 관리자 재인증·기기별 최신 권한 반영을 실환경에서 확인한다. 서버는 요청마다 DB 권한을 다시 검사한다.

로컬 검증: `npm run test:admin-operations`, `npm run test:p0`, `npm run test:auth`, `npm run test:creator-works`, `npm run test:drafts`, `npm run test:publication`, `npm run test:operations`, `npx tsc --noEmit`. 브라우저/localhost 검증은 프로젝트 규칙에 따라 명시 요청이 있을 때 수행한다.
