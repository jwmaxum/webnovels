# 원고 복구 요청 검토 계약 — 29단계

기록일: 2026-10-10. [계획](../../improve29.md), [28단계 접수](creator-recovery-request-contract.md),
[관리자 워크플로](admin-workflow-contract.md), [Author/Creator 호환](author-creator-contract.md)을 확장한다.

## 권한과 범위

기존 `/admin/recovery` 메뉴와 `/api/v2/admin/workflow?action=recovery-*`를 사용한다.
새 권한·작가 신원·역할을 만들지 않는다. 서버 actor의 Auth UUID를 전달하고 RPC가 현재 활성
관리자·확인된 이메일·비익명·정지 여부·DB 권한을 검사한다. CASE_READ/CONTENT_REVIEW는 조회,
CASE_RESOLVE/CONTENT_REVIEW는 보류·반려를 허용한다. 비공개 제출 원고·원본 열람과 후속 복원
검증 준비 결정은 SUPER_ADMIN만 허용한다. 감사 조회 권한으로 전문을 열람하지 못한다.

26단계 offline packet은 계속 비공개 워크벤치에서 처리한다. 29단계는 작가가 명시적으로 제출한
SQL019 요청에 한해 인증·사유·감사가 있는 증거 열람을 추가한다. offline packet을 관리자 API에
올리거나 legacy 본문 선택 결정으로 자동 변환하지 않는다.

## 보존과 파생 상태

SQL020은 reviewed 014+019 이후만 적용한다. recovery_review_events/source_access/receipts는
append-only·RLS·직접 테이블 접근 금지(public/anon/authenticated/service_role)이며 한정 RPC만 service_role이 호출한다.
019 요청/result/status=PENDING은 불변이다. 최신 검토 disposition과 문자열 bigint revision은 별도 파생 값이다.

| 상태 | 의미 |
|---|---|
| HOLD | 자료·근거 보완 사유 전달 |
| REJECTED | 반려 의견, 원본·원고 보존 |
| READY_FOR_RESTORE_REVIEW | 제출본 열람·명시적 권리/등급/AI 체크·근거를 기록한 후속 검증 준비 |

준비 상태는 권리 증명·복원 승인·출시 GO가 아니다. 근거 파일 바이트·새 snapshot·격리 hosted
리허설·DB/Storage 인수·P0 잠금·일반 공개 게이트를 유지한다. draft episode_id·현재 원고·
version/head·예약·회차·작품·권리/등급/AI·성장 지표를 수정하지 않는다.

## 조회·열람·결정

GET recovery-list(offset 0~100000, 50건+hasMore), recovery-detail(recoveryId UUID)는 metadata만 반환한다.
target_snapshot·전문·Auth UUID·Storage 경로는 포함하지 않는다. POST source/decide는 같은 Origin,
requestId UUID, 사유 3~500자, contextDigest를 요구한다. decide는 expected review revision,
evidence 최대2000자, accessId와 명시적 boolean 체크를 받는다. READY는 같은 관리자·요청·context의
manuscript access와 비어 있지 않은 제출 전문이 필요하다. 체크박스는 실제 권리 근거 바이트 검증을 대신하지 않는다.

현재 권한 → user/key advisory lock → 정확한 action/payload 영수증 비교 → 대상 잠금/검사 순서다.
동일 결정 replay는 원래 결과이며 감사/이력이 중복 생성되지 않는다. 권한 철회 후 replay도 거절한다.
같은 키 다른 payload·stale review revision·변경된 context는409다. 후속 재검토도 append-only다.
잠금은 request → author/work/state/draft → episode/protected/head/alternate → file/job 순서다.
소유자 Auth·활성/승인·NOVEL/CLEAR·활성 unbound draft·원본 목적/private bucket·고정 SHA/size·
COMMITTED IMPORT user/work/draft·revision_files·전체 대상 snapshot을 검사한다.
context MD5는 변경 토큰이며 무결성 증명이 아니다. 후속 원고 편집은 rr.revision을 대체하지 않는다.
source_revision은 원본 연결 버전이다.

manuscript는 rr.revision의 draft_revisions 전문을 응답 시 재구성한다. original은 요청의 파일만
서버 private Storage GET으로 읽고 manual redirect에서3xx를 거절한다. 스트림을 최대2MiB/고정 크기로
제한하고 SHA256+크기 대조 후 고정 파일명의 attachment/no-store/nosniff로 반환한다.
Storage 경로·signed URL·토큰을 클라이언트에 전달하지 않는다. source_access/감사는 접근 승인·시도
기록이며 수신 성공을 증명하지 않는다. 전문·경로·URL·바이트는 영수증/감사에 저장하지 않는다.
열람 replay도 현재 context·권한을 재검사한다.

## UI·작가 피드백·활성화

요청 metadata/key만 계정+요청별 sessionStorage에 dispatch 전에 보존한다. 불명확한 실패·403/소유권404는
새 요청으로 바꾸지 않는다. 알려진 거절 결과는 명시적으로 최신 자료를 확인한 후 새 검토를 시작한다.
저장 실패 시 요청을 보내지 않는다. 전문/파일/URL/token은 로컬 저장하지 않으며 DOM은 textContent를 쓴다.
메뉴·메인 뷰 이탈·로그아웃·계정/context 변경에서 전문과 늦은 응답을 제거하고 Blob URL은 즉시 폐기한다.

작가는 기존 recovery GET/POST의 creator_recovery_review_status 결과로 최신20건 또는 재전송한 특정 요청의 상태·사유를 확인한다.
현재 승인 작가·Auth·work/draft 소유권과 원래 요청 user_id를 모두 검사한다. 관리자 evidence/신원/전문은
포함하지 않으며 다른 Auth 연결로 과거 요청을 노출하지 않는다. 비활성 시 reviewAvailable=false다.

ADMIN_RECOVERY_REVIEW_ENABLED 기본false. admin workflow/operations/P0 및 author works/drafts/files/recovery가
모두 정확히true일 때만 공개 boolean adminRecoveryReviewEnabled가 true다. 실제 플래그는 바꾸지 않는다.
롤백은 추가 플래그를 끄고 접수·원본·감사·검토 이력을 보존한다. PGlite는 독립 DB 잠금 경쟁·실제
ACL/Auth/Storage 인수를 대신하지 않는다. Node VM·다운로드 대역도 실제 파일·브라우저·기기 인수가 아니다.

Storage 인증 다운로드 경로는 [Supabase 공식 문서](https://supabase.com/docs/guides/storage/serving/downloads)를 참조했다.
