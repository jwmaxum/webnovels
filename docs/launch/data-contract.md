# 2단계 데이터 계약 — 초안·공개본·예약·계정

작성일: 2026-09-23. 로컬 확장 스키마 구현·격리 검증 완료, 실제 Supabase 미적용.

## 1. 설계 경계

- 기존 `public`의 계정·작품·회차·원장과 ID를 보존한다. 초기화·재시드·자동 계정 병합을 하지 않는다.
- 새 저장 구조는 `authoring` 스키마에 추가한다. 기존 프론트/서버 경로는 이번에 전환하지 않는다.
- `authoring`은 PostgREST 공개 스키마 목록에 추가하지 않는다. 3단계 서버에서 검증한 전용 함수/접속 계약으로 사용한다. 일반 테이블 프록시를 만들지 않는다.
- 현재 `p0-20260921`의 expanded/locked 상태와 `P0_API_ENABLED`를 바꾸지 않는다.
- 표의 상태 구조는 구현되어 있지만 게시·예약 실행·휴지통 UI·작가 권한 API는 후속 단계다.

## 2. 실제 적용 전 스키마 차이

| 영역 | 저장소에서 확인한 차이 | 이번 대응 / 미확인 사항 |
|---|---|---|
| readers.id | 이전 SQL은 SERIAL, 정규화 SQL은 Auth UUID | 기존 타입 유지. 계정 연결 함수는 기존 ID의 text 표현으로 조회. integer/UUID 모의 스키마 검증 |
| authors/works/episodes.id | SERIAL과 BIGSERIAL 정의가 공존 | 타입 변경 없음. 새 FK는 bigint로 기존 integer/bigint 참조를 검증 |
| authors.status | 한글 인증 문구와 APPROVED/PENDING 체계 공존 | 이번 자동 변환 없음. 3단계 신원 활성 조건을 실제 데이터와 대조해야 함 |
| works/episodes.status | TEXT와 ENUM, REVIEW/REVIEW_REQUESTED, PAUSED 등 혼재 | 원본 불변. 별도 work_state를 만들고 명시적 이관표 승인 후 채움 |
| 이용등급 | 18/19 및 AGE_* 등 표현 혼재 가능 | 원래 등급 보존, 연령 확인 완료 전 기존 성인 콘텐츠를 자동 공개하지 않음 |
| is_ad_free | 기존 프론트는 is_free의 반대, v2 수정 경로는 동일 값으로 취급 | 계약 불일치 기록. 초기 신규 무료 정책과 기존 유료 이관 시 7·10단계에서 정리 |
| 본문 | episodes.content/image_urls, episode_contents/panels, secure_episode_contents 등 세대별 차이 | 현재 P0 확장 SQL은 episodes 본문/이미지 열 필요. 실DDL 대조 전 실행 금지 |
| auth_user_id | 1단계 HEAD에서 authors 연결 0, readers/admin_users 선택 400 | 실제 타입/열 존재·제약 재확인 필요. P0 001은 누락 열 추가와 unique 인덱스만 수행 |
| 원격 DDL/RLS/Storage | 이번 재조회도 HTTP 401 | 정책·제약·함수 덤프와 실데이터 FK/중복 결과 미확인 |

`000_integrity_audit.sql`은 기존 작품·회차 수, 고아 참조, 잘못된 번호, 번호 중복/결번, Auth 연결 중복 그룹, 상태·등급 집계만 반환한다. 비밀번호·이메일·원고 값은 반환하지 않는다. 결번은 오류로 자동 보정하지 않는다. 실제 중복 계정 판정은 이메일 중복 여부뿐 아니라 검증된 소유 증거가 필요하다.

## 3. 테이블과 불변식

| 테이블 | 핵심 키·연결 | 불변식 |
|---|---|---|
| authoring.migrations | version | authoring-001/002/003 적용 기록. P0 잠금 기록과 별개 |
| retention_policy | singleton | 기간 NULL은 자동 삭제 금지. 기간 설정은 승인자/시각 필요 |
| identity_evidence | (profile_kind,profile_id), (profile_kind,auth_user_id) unique | 검증 증거 참조·검증자 보존. UPDATE/DELETE 금지. 인증의 대체 원장 아님 |
| work_state | work_id, (work_id,author_id) FK→works | 실제 작품 소유자와 일치, 공개/연재/제재/휴지통 분리 |
| drafts | UUID id, work_id/author_id, optional episode_id | ID는 회차 번호와 독립. 다른 작품 회차 연결 불가. legacy_draft_id는 이전 초안 연결용 |
| draft_revisions | (draft_id,revision) | 불변 원고 스냅샷. 현재 revision FK는 커밋 시 확인 |
| publication_versions | UUID id, episode_id/work_id, source draft/revision | 불변 공개 후보/역사본. 원천 revision이 있으면 본문·제목·작가의 말·이미지가 일치해야 함 |
| publication_heads | episode_id→version_id | 현재 독자 공개본 포인터. 같은 회차의 버전만 지정 가능 |
| publish_requests | (work_id,idempotency_key), payload_sha256 | 요청 키/내용 해시 변경 금지. 확정 결과 변경 금지. 다른 작품의 결과 연결 불가 |
| schedules | episode_id/version_id, due_at | 대상은 불변 버전. PENDING/RUNNING은 회차별 하나. RUNNING은 lease 토큰/만료가 필요 |
| files | UUID id, work_id/author_id, (bucket_id,object_key) unique | 원본과 표지 파생본 버킷 구분. 해시·크기·소유 작품 보존 |
| revision_files | draft/revision/file/work 복합 FK | 다른 작품 파일 연결 불가, 참조 중 파일 삭제 거절 |

기존 `episodes(work_id,episode_number)`에 고유 인덱스와 양수/필수 번호 제약을 추가한다. 기존 번호가 충돌하면 마이그레이션 전체를 중단하고 원본을 유지한다. 고아 작품·회차도 적용 전 중단한다. 번호 자동 재할당·작품 재배정은 하지 않는다.

## 4. 초안 저장 트랜잭션

신규 초안은 한 트랜잭션에서 drafts와 revision 1을 함께 생성한다. revision 없는 초안은 커밋할 수 없다.

`authoring.save_draft(id, expected_revision, title, content, author_comment)`:

1. 대상 초안 행을 잠근다.
2. ACTIVE와 기준 revision 일치를 확인한다. 불일치는 SQLSTATE 40001, 메시지 DRAFT_CONFLICT다. 서버는 이를 409 충돌로 안내하고 최신 revision으로 원고를 조용히 재시도하지 않는다.
3. 새 불변 revision을 INSERT하고 현재 포인터를 이동한다.
4. 하나라도 실패하면 전체 변경을 롤백한다.

이 함수는 service_role 전용이며 **작가 인증을 대신하지 않는다.** 3·5단계 서버가 신원·소유권·제재를 검사한 뒤 호출한다. 함수 자체를 브라우저 RPC로 공개하지 않는다. 현재 이미지는 이전 revision을 그대로 보존하며 이미지 편집은 6단계의 별도 검증 계약으로 확장한다.

격리 테스트는 이전 revision의 후속 저장이 거절됨을 확인했다. PGlite 단일 연결이므로 실제 여러 PostgreSQL 연결에서의 동시 경쟁/데드락 시험은 아직 하지 않았다.

## 5. 공개·예약 상태

- publication_versions 행 생성은 공개가 아니다. 공개본 포인터, 작품 공개 상태, 회차 공개/등급/해금, moderation 및 휴지통을 서버가 함께 검사해야 한다.
- 공개 회차를 수정해도 새 초안만 변한다. 재게시 트랜잭션에서 publication_heads를 새 버전으로 전환한다.
- 예약은 publication_versions를 참조한다. 예약 후 초안 수정이 예약 원고를 조용히 바꾸지 않는다.
- due_at은 timestamptz, 표시 시간대는 별도 보관한다. IANA 시간대·미래 시각 검증은 예약 API에서 수행한다.
- 예약 상태: PENDING→RUNNING→SUCCEEDED/FAILED, PENDING/실행 경쟁에서 취소·변경은 조건부 갱신으로 구현한다. 실행·취소 API와 lease 재처리는 7단계다.
- 같은 게시 멱등키에 다른 payload 해시가 오면 409로 거절한다. 일치할 때만 저장된 확정 결과를 반환한다. 이 요청 처리 API는 7단계에서 구현한다.
- 예약 실행 중 작가 제재·휴지통 여부를 다시 검사한다. 스키마만으로 공개 시각 보장을 완료했다고 하지 않는다.

## 6. 계정 이관

기존 ID와 비밀번호 데이터를 임의 삭제·복사·변경하지 않는다. Auth 사용자 생성/복구 및 소유 확인 후 검증된 UUID만 연결한다.

`authoring.link_verified_identity(kind, profile_id, auth_user_id, verified_by, evidence_ref)`:

- reader/author/admin 표준 종류만 허용하고 동적 테이블 이름은 whitelist로 제한한다.
- 검증자는 이미 Auth에 연결된 활성 SUPER_ADMIN이어야 한다. 서버가 실제 요청자의 신원을 사용해야 하며 클라이언트의 검증자 입력을 신뢰하면 안 된다.
- 기존 프로필을 잠그고 다른 UUID에 연결되어 있으면 중단한다.
- 연결 변경과 불변 증거 기록을 한 트랜잭션으로 처리한다.
- 동일 연결 재시도는 false를 반환하며 원래 증거를 덮어쓰지 않는다.
- 초기 최고 관리자 연결은 계정 소유를 별도로 확인한 DB 운영자의 제한된 수동 작업이 필요하다. 자동 가입/이메일 일치/이 함수 호출로 bootstrap하지 않는다.
- 계정 상태·역할은 이 함수에서 승격/수정하지 않는다. 잘못 연결된 계정의 정정은 별도 감사 있는 복구 마이그레이션으로 처리한다.

## 7. 보관·파일 정책

- 초기 retention 기간은 NULL이다. 승인된 기간이 없으므로 자동 purge를 구현하거나 실행하지 않는다.
- 휴지통은 trashed_at/lifecycle로 표시한다. 기존 회차 ID·독서기록 FK·원장·신고 증빙을 유지한다.
- revision/publication/evidence는 삭제·수정 방지 트리거로 보호하고 service_role에도 업데이트/삭제 권한을 주지 않는다.
- 실제 영구 삭제는 2단계 기본 함수에 없다. 확정된 보관 정책·법적 보존·공유 참조 검사·감사 절차가 생긴 뒤 전용 작업으로 구현한다.
- authoring-originals: 원고/표지 원본. authoring-covers: 변환한 표지 파생본. **두 버킷 모두 private**로 시작한다.
- 기존 광범위 Storage permissive 정책이 있어도 새 두 버킷의 anon/authenticated 접근은 restrictive 정책으로 막는다. 기존 다른 버킷 정책은 변경하지 않는다.
- 표지 공개 표시는 6단계에서 서버가 승인한 파생본에만 제한된 서명 URL 등을 제공한다. 지금 원본 버킷을 public으로 바꾸지 않는다.

## 8. 기존 데이터 이관 원칙

work_state·새 drafts·publication_heads를 운영 데이터로 자동 채우지 않았다. 기존 상태 의미/본문 저장 위치/계정 연결을 확인하지 못했기 때문이다.

2단계 실제 DB 확인 후: 상태 대응표 확정 → 작품 소유 검증 → 기존 draft_id 유지 또는 legacy_draft_id로 연결 → 각 본문/버전 해시 대조 → 현재 공개본만 포인터 연결 → 예약은 대상 버전 확인 후 생성 순서로 실행한다. 미연결 계정·불명확한 상태·중복 번호는 이관 보류 목록으로 남긴다. 원본 레코드는 그대로 보존한다.

## 검증 범위

`npm run test:authoring-schema`로 실제 PostgreSQL 엔진에서 SQL을 실행한다. PostgreSQL 임베디드 런타임의 백업/복원은 [PGlite API 문서](https://pglite.dev/docs/api)의 dumpDataDir/loadDataDir 기능을 사용하며, 해당 형식은 운영 Supabase 백업의 대체물이 아니다.
