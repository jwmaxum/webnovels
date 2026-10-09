# 기존 무료 소설 공개본 이관 계약 — 24단계

기존 `episodes`가 있어도 새 독자 API는 `publication_heads`와 불변 버전을 요구한다.
작가의 편집 RPC가 수행하던 legacy `source_draft_id/source_revision=NULL` 최초 버전
계약을 승인된 기존 무료 소설의 일괄 이관으로 확장한다. 허위 초안·revision을 만들거나
관리자 CRUD로 우회하지 않는다. [Author/Creator](author-creator-contract.md),
[원본 검토·복원](content-review-restore-contract.md), [출시 게이트](stage19-quality-contract.md)를 따른다.

## 준비와 검토

```text
npm run audit:restore-target -- <별도-Supabase-project-ref>
npm run audit:stage24
npm run prepare:legacy-publications -- prepare <검증된-논리-백업-디렉터리>
npm run prepare:legacy-publications -- rehearse <검증된-논리-백업-디렉터리> import-stage24/decisions-reviewed.json
```

도구는 지정된 `.env.local`을 조용히 읽으며, 복원 대상은 인자 또는
`SUPABASE_RESTORE_TARGET_REF`로 받는다. 관리 API는 고정된 Supabase HTTPS 호스트의
읽기 전용 SQL/Auth 설정 GET만 사용한다. 누락·잘못된 ref·운영 ref는 네트워크 요청 전
거절한다. 유효하지 않은 ref 원문은 보고서에 넣지 않아 잘못 입력된 URL/키도 출력하지 않는다.
기존 서비스 relation/Auth/Storage 데이터, 외부 서버/커스텀 hook, 활성 Cron,
가입·메일 provider가 격리되지 않은 대상은 BLOCKED다. SMTP/OAuth 비밀 응답은 저장하지 않는다.
빈 대상 관찰도 `restoreAllowed=false`이며 소유·원본 덤프의 외부 작용·격리 역할 계획·
암호화 외부 백업·실제 hosted 복원 및 Storage/역할 인수가 별도로 필요하다.

논리 백업 SHA·전체 행 복원 증거를 검증하고 로컬 복원한 DB에서 packet을 생성한다.
원고/계정 포함 packet, 결정 파일, 근거와 SQL은 Git 제외 `scratch/launch/backups` 아래
`import-stage24`에만 보관한다. 기존 파일을 덮어쓰지 않는다. 공개 artifact에는 개수·해시·
차단 코드만 기록한다. bigint ID는 문자열로 유지하고 Auth UUID/작가 ID/작품 ID를 혼용하지 않는다.

검토 형식은 `webnovels-legacy-import-decisions-v1`이다. snapshot/packet SHA,
`cutoverEvidence`와 모든 회차별 `episodeId`, `sourceDigest`, `decision`, `reviewerRef`,
`evidenceRef`, `rightsEvidence`, `originalPublishedAt`을 담는다. 기본 결정은 전부 PENDING이다.
HOLD는 보존하며 IMPORT는 확인자·권리/출시 근거 파일(상대 경로, bytes, SHA-256)과
증명된 최초 공개 시각이 필요하다. 공개 시각은 회차 생성 이후·snapshot 이전이어야 한다.
파일 해시·Auth 연결은 권리자와 검토자 신원을 자동 인증하지 않는다.

P0 확장/잠금·authoring 008과 전체 원문 충돌 0이 전제다. 검증된 APPROVED 작가/Auth/
identity, 공개/비제재 작품, 확인된 등급·AI 정보와 소개·장르, 일반 등급 NOVEL,
PUBLISHED/FREE/무료·작품/회차 공개 시각 경과·비어 있지 않은 일치 원문만 대상이다.
미래 작품의 첫 head를 만들어 회차 직접 API가 카탈로그보다 먼저 공개하는 경로를 거절한다.
개발 예시문·성인/유료·웹툰·확인하지 않은 이미지·기존 head·활성 예약은 제외한다.
기존 head가 없는 웹툰은 18단계 private asset/manifest 인수 경로가 별도로 필요하다.

## 원자적 추가와 보존

[SQL 005](../../database/launch/005_import_verified_legacy_novels.sql)는 준비 상태다.
실제 적용 명령/`--apply` 경로는 없다. 운영자가 hosted 복원·권한·출시 증거를 검토한
같은 세션에서 `webnovels.legacy_publication_import_verified=true`를 설정해야 한다.
생성 SQL은 이 플래그를 설정하지 않는다. 실패 시 ROLLBACK 후 원인을 해결한다.

작품/작가/회차/본문 두 경로/Auth/identity/state/버전/head/예약을 잠그고 전체 행 MD5로
승인 시점과 일치하는지 비교한다. 하나의 변경·권한 소실·기존 head·예약 충돌도 전체 취소한다.
MD5는 변경 비교이며 원본 인증은 근거 파일 SHA와 사람의 검토를 요구한다.
기존 행·계정·초안·원장·이미지·버전은 수정하지 않는다. 새 불변 버전과 head를 추가하고
원래 공개 시각을 보존한다. 원본의 NULL 이미지 값은 그대로 두며 새 소설 버전은 빈 배열이다.

성장 SQL 017이 있으면 이관 버전의 `growth.publication_activity`를 먼저 BASELINE으로
추가해 기존 head 트리거가 NEW_EPISODE를 만들지 않게 한다. 기존 활동 행은 보존한다.
private `launch_recovery.legacy_publication_imports`는 원본 전체 행·추가 버전/head·권리/
출시 근거·백업 해시를 보관하고 anon/authenticated/service_role 조회와 UPDATE/DELETE를
거절한다. 재실행은 기존 head 때문에 거절한다. 복구를 위해 공개본을 삭제하지 않는다.

리허설은 원본 테이블 전체와 기존 공개본의 행이 그대로인지 비교하고 추가 수, private
불변 이력, 역할 거절·재실행 거절·성장 BASELINE을 검증한다. 실제 migrated 합성 스키마에서
독자 본문 RPC와 작가 편집→초안 호환을 별도 검증한다. PGlite의 행 복원은 실제 역할/
RPC/트리거/Storage 바이트의 hosted 복원과 동일하지 않다. 플래그/실제 운영 SQL은 변경하지 않는다.

## 실제 전환 순서

원본/권리·등급·AI 승인 → 격리 DB/Auth/Storage 복원 및 역할 인수 → 78건 충돌 정합화 →
현재 DB 기준 새 백업/packet → 검토한 누락 authoring SQL → 새 기준 packet 승인/리허설 →
승인 무료 소설 이관 → 기존/신규 작가·독자 인수 → P0 최종 잠금/기능 플래그와 출시 승인.
스키마나 원고가 바뀌면 오래된 packet은 다시 생성한다. 대상이 없으면 운영을 복원 대상으로 쓰지 않는다.

## 공식 자료

[Supabase clone](https://supabase.com/docs/guides/platform/clone-project),
[백업](https://supabase.com/docs/guides/platform/backups),
[격리 복원](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)를 확인했다.
기존 PGlite/Zod/관리 API를 확장했으며 새 의존성은 없다.
