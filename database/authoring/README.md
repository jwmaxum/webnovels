# 작가 저장 모델 증분 마이그레이션

현재 상태(2026-09-26): **001/003/004/005/006은 비공개 작가 작업실 범위로 실제 Supabase 적용 완료.** 기존 초안 2건·계정 연결 근거 41건을 보존했다. 002/007~011 및 전체 공개 전환은 미적용이다. [최신 적용·검증 기록](../../docs/launch/author-workspace-rollout.md). 아래 단계별 기록은 최초 구현 당시 기준이다.

| 파일 | 용도 |
|---|---|
| [000_integrity_audit.sql](000_integrity_audit.sql) | 읽기 전용 원본 참조·중복·결번·상태 집계 |
| [001_authoring_foundation.sql](001_authoring_foundation.sql) | 고정 초안 ID, 불변 revision/공개본, 예약, 파일·보관·멱등키 |
| [002_private_storage.sql](002_private_storage.sql) | 기존 다른 버킷을 보존하는 두 private 버킷·제한 정책 |
| [003_verified_identity_link.sql](003_verified_identity_link.sql) | 기존 ID를 보존하는 검증된 Auth 연결·증거 원자 기록 |

기존 P0 001과 실제 스키마 대조·복원 가능한 백업이 선행되어야 한다. 마이그레이션 세션의 `webnovels.authoring_apply_verified` 검토 게이트가 없으면 중단한다. 이 게이트나 테스트 성공이 실제 백업 검증을 대신하지 않는다.

전체 절차는 [migration-runbook](../../docs/launch/migration-runbook.md), 모델은 [data-contract](../../docs/launch/data-contract.md)를 따른다. `database/*.sql` 전체 실행, P0 잠금 조기 적용, 운영 자동 seed를 하지 않는다.

로컬 검증: `npm run test:authoring-schema`. 테스트는 `.env.local`/네트워크/운영 DB를 사용하지 않고 합성 데이터만 생성한다. PGlite datadir 복원은 실제 Supabase 백업이나 Storage 파일 바이트 복원 증거가 아니다.

3단계 추가: [004_auth_onboarding.sql](004_auth_onboarding.sql). 확인 후 프로필 생성·서비스 전용 RPC·가입 횟수 제한 및 알려진 자동 프로필 트리거 전환. [적용 조건](../../docs/launch/auth-contract.md)을 검토한 뒤 003 이후 적용하며 운영 활성화는 하지 않는다. 로컬 검증은 `npm run test:auth`.

4단계 추가: [005_creator_works.sql](005_creator_works.sql). 실제 소유자 기준 작품 관리, 제목만으로 비공개 생성, 요청 멱등키·수정 version, 휴지통/비공개 복구·예약 취소 기록. [적용/복구 조건](../../docs/launch/creator-works-contract.md)을 확인한다. 로컬 검증은 `npm run test:creator-works`.

5단계 추가: [006_creator_drafts.sql](006_creator_drafts.sql). 소유 원고의 고정 ID·조건부 revision·멱등 요청 receipt·불변 이력 조회. [적용/복구 조건](../../docs/launch/creator-drafts-contract.md)을 확인한 뒤 005 이후 적용한다. 기능 플래그는 기본 비활성으로 유지하며 로컬 검증은 `npm run test:drafts`.

6단계 추가: [007_creator_files.sql](007_creator_files.sql). 업로드 prepare/commit·취소 tombstone·revision 원본 연결·표지 version 조건부 교체·소유자 내보내기·참조 없는 정리 후보 조회. [적용/복구 조건](../../docs/launch/creator-files-contract.md)을 확인하고 private Storage 002와 006 이후 적용한다. 실제 객체 자동 삭제는 하지 않는다. 로컬 검증은 `npm run test:files`이며 실제 Supabase/Storage에는 미적용이다.

7단계 추가: [008_creator_publications.sql](008_creator_publications.sql). 저장 revision 기반 무료 게시·예약·공개본 수정, 예약 상태 전이·실행 결과와 운영 이벤트를 추가한다. [게시 계약](../../docs/launch/creator-publication-contract.md)을 확인하고 007 이후 검토 적용한다. 별도 Cloudflare Cron Worker가 필요하며 기본 플래그는 비활성이다. 로컬 검증은 `npm run test:publication`이다.

8단계 추가: [009_creator_reader_operations.sql](009_creator_reader_operations.sql). Auth UUID별 독서기록·관심·구독·환경설정, 서버 전용 공개 카탈로그·댓글 정책/문단 버전·작품별 차단/신고·통계·알림·연재 상태를 추가한다. [운영 계약](../../docs/launch/creator-reader-operations-contract.md)을 확인하고 실제 백업·스키마 감사·008 적용 뒤 검토한다. 기본 플래그는 비활성이다. 로컬 검증은 `npm run test:operations`이다.

9단계 추가: [010_admin_operations.sql](010_admin_operations.sql). 관리자 사건·작품 제한·권한 변경 이력과 제한적 서버 전용 운영 RPC를 추가한다. [관리자 운영 계약](../../docs/launch/admin-operations-contract.md)을 확인하고 실제 legacy 신고·검수·감사 테이블 및 009 적용 상태를 검토한 뒤 실행한다. 운영 DB에는 미적용이며 `ADMIN_OPERATIONS_ENABLED`는 기본 비활성이다. 로컬 검증은 `npm run test:admin-operations`다.

10단계 진행 중: [011_reader_profile_cutover.sql](011_reader_profile_cutover.sql). 검증된 Auth UUID의 활성 독자 닉네임만 서버 전용 RPC로 수정한다. 실제 `readers`/`auth.users` 열·제약과 010 적용을 감사하고 백업한 뒤 검토 세션 게이트로 실행한다. [전환 감사](../../docs/launch/stage10-cutover-audit.md)의 직접 접근·Storage 잔여 경로가 닫히기 전에는 전환 완료나 플래그 활성화로 해석하지 않는다. 실제 DB에는 미적용이다.
