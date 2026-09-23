# 작가 저장 모델 증분 마이그레이션

현재 상태: 로컬 구현·합성 PostgreSQL 실행 검증. 실제 Supabase 미적용.

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
