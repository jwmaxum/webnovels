# 17단계 관리자 업무 계약

2026-10-09. [실행 계획](../../improve17.md), [9단계 계약](admin-operations-contract.md), [계정 전용 콘솔](admin-console-rollout.md), [이전 편집 추천](admin-home-curation.md)을 확장한다. 기능 플래그는 기본 비활성이다.

## 진입점과 권한

`/api/v2/admin/workflow?action=…`는 `P0_API_ENABLED`, `ADMIN_OPERATIONS_ENABLED`, `ADMIN_WORKFLOW_ENABLED`가 모두 `true`여야 한다. 서버의 검증된 Auth UUID를 RPC에 전달한다. SQL은 활성 관리자·인증 이메일·차단 상태와 **현재 권한**을 다시 검사한 뒤 영수증을 조회한다. 담당자는 관리자 프로필 ID이며 배정으로 권한이 생기지 않는다.

| 업무 | 읽기 / 변경 권한 | 보존 계약 |
|---|---|---|
| 사건·담당 후보 | `CASE_READ` 또는 종류별 기존 `CONTENT_REVIEW`/`COMMENT_REPORT` | 원본 종류와 UUID 유지, 50개 단위 조회 |
| 담당·기한·근거·중복 참조·종결 | `CASE_RESOLVE` 또는 종류별 기존 처리 권한 | revision 비교, 근거 없으면 종결 불가 |
| 이의제기 조회 / 심사 | `CASE_READ` / `CASE_RESOLVE` | 심사만으로 제한 해제 불가 |
| 이의제기 후속 유지·해제 / 작품 제한 | `CONTENT_MODERATE` | 현재 대상 버전과 원조치 확인, 후속 조치 1회 |
| 계정 지원 / 정지·해제 | `ACCOUNTS_READ` 또는 해당 기존 계정 조회 권한 / `ACCOUNT_MODERATE` | reader UUID, author bigint 분리, 현재 상태 비교 |
| 작품 상태 | `CONTENT_METADATA_READ`, `WORK_MGMT` 또는 `CURATION_WRITE` | 최근 작품 100건 메타데이터, 본문 수정 없음 |
| 예약 큐레이션·미리보기 | `CURATION_WRITE` | 독자 랭킹과 다른 예약 데이터 |
| 통합 감사 | `AUDIT_READ` 또는 `SECURITY_MGMT` | 안전한 요약, 대상 필터, 50개 단위 조회 |
| 예외 초안 열람 | 최고 관리자만 | 대기 검수 사건·작품/회차 연결·초안 UUID·사유·열람 감사 |

최고 관리자는 위 업무를 수행할 수 있다. 역할 편집은 기존 `/api/v2/admin/console?action=role-update`의 비밀번호 재인증·revision 계약을 유지한다. 새 모드에서는 `/admin/operations`의 모든 구형 변경과 `/admin/console`의 `curation-update`를 409로 막는다. 계정 전용 모드(P0 비활성)의 기존 콘솔은 유지한다. 정산·수익은 기존 조회만 제공한다.

## 사건 처리와 예외 열람

`case_workflow`는 원본 `(source, source_id)` 옆에 revision·담당·우선순위·UTC 기한·근거를 보관한다. 같은 종류·같은 작품 또는 회차/댓글 대상만 중복 참조할 수 있다. 그래프 잠금과 순환 검사로 반대 방향 동시 참조를 막으며 원본을 자동 종결/삭제하지 않는다.

신고 대상 댓글은 해당 사건 화면에서 텍스트로 검토한다. 조회 당시 fingerprint를 근거 저장 요청에 포함한다. 근거 저장 또는 종결 전에 내용·삭제/차단 상태가 바뀌면 `REVIEW_TARGET_CHANGED`로 다시 확인한다. 검수 승인도 작품 공개를 대신하지 않는다.

모든 변경은 요청 UUID·사유를 요구한다. 같은 사용자/UUID/내용의 재전송은 기존 결과를 반환하고 내용이 다르면 `REQUEST_CONFLICT`다. UI는 응답 불명 시 입력과 UUID를 고정하여 재확인하고, 409에서는 입력을 보존한 채 최신 조회를 안내한다. 조치·추가 감사·작가 스튜디오 통지·영수증은 같은 트랜잭션이다. 메일 발송을 완료했다고 표시하지 않는다.

이의 인정 후 `MAINTAIN`, `UNRESTRICT`, `UNBLOCK` 중 적용 가능한 후속 조치를 별도로 실행한다. 작품은 현재 revision과 마지막 제재가 원조치인지 확인한다. 댓글은 현재 fingerprint와 다른 미해결 제재를 확인한다. 이의제기 당사자는 기존 자기 신청 화면에서 심사 사유와 후속 조치를 읽는다. 콘텐츠 검수의 이의 인정은 공개나 초안 수정 권한을 부여하지 않으며, 유지 판단 또는 별도 검수 사건으로 재접수한다.

초안 예외 열람은 현재 revision을 특정하여 반환한다. 감사·영수증에는 초안 UUID와 revision만 있고 본문은 없다. 재시도 시 검수 상태나 revision이 바뀌었으면 409다. UI는 화면 이동·계정 전환·로그아웃에서 본문을 지운다. 일반 관리자와 읽기 전용 권한에는 열람 폼이 없다. 기존 작가 저장/버전 API를 수정하지 않는다.

## 계정 지원과 기존 세션

지원 조회는 연결 유무·이메일 인증 유무·Auth 제한·프로필 상태만 제공하며 이메일/비밀번호/Auth UUID를 노출하지 않는다. 본인은 로그인 화면에서 자신의 이메일 입력 → 비밀번호 재설정 → 받은 링크 → 새 비밀번호 → 재로그인 → 작품/계정 확인 순서로 복구한다. 이메일 접근 불가·잘못된 계정 연결은 기존 본인 확인과 계정 연결 절차로 이관한다. 관리자가 대신 메일을 발송하거나 비밀번호/연결을 바꾸지 않는다.

권한 회수·정지는 서버와 DB가 요청마다 현재 상태를 확인하여 기존 JWT에서도 다음 요청에 반영한다. 이는 모든 기기의 토큰을 강제로 폐기했다는 의미가 아니다. 실제 메일·리디렉션·다른 기기 확인은 운영 인수 항목이다. 가상 계정 메뉴는 최고 관리자 시험 도구로 명시한다.

## 기간별 편집 추천

`editorial_placements`는 작품·위치(`HOME_RECOMMENDED`, `HOME_SPOTLIGHT`)·순서 1~8·UTC 시작/종료·활성 여부·revision을 갖는다. 기간은 `[시작, 종료)`다. 활성 예약끼리 같은 위치/순서 또는 같은 위치/작품의 기간이 겹치면 409다. 예약 저장은 현재 무료 공개 회차가 있는 작품만 허용하며 비활성화는 이후 제한된 작품에도 가능하다.

미리보기와 홈은 같은 공개 projection을 사용한다. 미리보기는 선택 시각의 예약을 **현재** 공개 상태로 확인하므로 미래 공개를 예측하지 않는다. 홈은 조회 당시 공개/등급/무료 회차 정책을 다시 적용한다. 새 모드의 편집 추천은 기존 수동 추천 플래그를 대체하고 `popular`의 실제 최근 7일 인증 독자 랭킹은 유지한다. 예약이 없으면 편집 추천은 비어 있다. 기존 플래그 값은 삭제하지 않는다.

## 감사와 적용 절차

추가 테이블은 RLS를 켜고 공개·인증·service_role의 직접 테이블 접근을 회수한다. RPC만 service_role에 실행 권한을 준다. `workflow_events`, `workflow_receipts`, `appeal_followups`는 UPDATE/DELETE 트리거로 변경을 막는다. 기존 사건·작품·계정·권한 이벤트와 `public.audit_logs`, 계정 전용 `account_audit`/`admin_permission_audit`/`work_curation_audit` 요약을 합친다. 비밀번호·본문·기존 before/after 원본 payload를 감사 응답에 복제하지 않는다. 계정 전용 감사 테이블이 없는 환경은 `missingSources`로 명시한다.

1. 대상 프로젝트·스키마와 010·012·013 적용 근거, 백업과 격리 복원 근거를 확인한다. Auth 연결·작품·원고·이력 기준선을 보관한다.
2. `014_admin_workflow.sql`을 검토하고 검증 설정이 있는 승인된 DB 세션에서 증분 적용한다. 운영 DB에 이번 개발 도구로 적용하지 않았다.
3. API/정적 파일을 함께 배포하고 새 플래그는 `false`로 유지한 채 계정 전용 콘솔 회귀를 확인한다.
4. 제한/최고 관리자, 작가, 독자로 신고 → 근거 → 종결 → 스튜디오 통지 → 이의제기 → 심사 → 별도 유지/해제 → 감사의 실환경 인수를 한다. 두 DB 연결의 실제 잠금 경쟁, 기존 다른 기기의 권한 회수, 메일 복구, 시간대 경계를 확인한다.
5. 승인 후 새 플래그를 활성화한다. 장애 시 플래그를 끄고 새 예약·이력·원본은 보존한다. 비활성 시 구 추천 플래그가 다시 사용되므로 그 값도 운영자가 확인한다.

검증 근거: [17단계 기록](../../artifacts/stage17-admin-workflow-verification.json). PGlite는 실제 PostgreSQL 다중 연결·RLS 배포·Auth/메일/브라우저 인수의 대체가 아니다. 패키지 추가 없이 기존 구현을 확장했다. 연구 근거는 [PostgreSQL 잠금](https://www.postgresql.org/docs/current/explicit-locking.html), [원자적 INSERT](https://www.postgresql.org/docs/current/sql-insert.html), [Supabase 이메일 복구](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)다.

다음은 18단계 웹툰 업로드 manifest·이미지 처리·권한·예약 공개·세로 뷰어다. 실제 관리자 인수와 기존 출시 차단 조건도 병행해 해소한다.
