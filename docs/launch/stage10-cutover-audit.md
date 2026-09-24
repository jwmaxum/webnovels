# 10단계 전환 감사 — 진행 중

2026-09-24 기준. 아래의 SQL/권한 검증은 합성 PGlite 데이터에만 적용했다. 실제 Supabase, Storage, Cloudflare 배포에는 적용하지 않았다.

## 이번에 닫은 경로

| 영역 | 변경 | 로컬 근거 |
|---|---|---|
| 구 v2 작품·회차 수정 및 관리자 조회 | `/api/v2/works`, `/api/v2/works/:id`, `/api/v2/episodes/:id`, `/api/v2/admin/readers`, `/api/v2/admin/config`가 410을 반환 | `verify_secure_api.test.mjs` |
| 비공개 원고 본문 | `/api/v2/episodes/:id/content`에서 본문 직접 조회는 소유 작가에게만 허용. 관리자 `CONTENT_WRITE`는 본문 열람 권한이 아님 | `verify_secure_api.test.mjs` |
| 독자 닉네임 | `stage10_reader_profile` 서비스 전용 RPC와 Auth UUID를 전달하는 `/api/v2/reader/hub?action=profile`; 기존 브라우저 직접 DB 수정 제거 | `verify_stage8_api.test.mjs`, `verify_stage9_db.test.mjs` |
| 관리자 구 독자 변경 | 정보·성인 인증 플래그·비밀번호 해시·계정 삭제 브라우저 경로를 실패 응답으로 종료. 가짜 부관리자 비밀번호 변경 성공 UI 제거 | `test:admin-operations`, 정적 검토 |
| 모바일 계정 메뉴 | 저장된 `webnovels_user` 대신 검증된 Auth actor를 사용하고, 성인 인증·포인트를 캐시값으로 성공 표시하지 않음 | `test:naming`, 구문 검사 |
| Express/SQLite 구 업무 API | 프로덕션 및 Vercel 런타임에서 `/api` 업무 라우터 503. 로컬 개발 코드는 보존 | `npx tsc --noEmit` |
| 브라우저 Realtime | 독자 또는 관리자 새 서비스 플래그가 켜지면 구 public 테이블 구독을 열지 않음 | 정적 검토 |
| P0 잠금 준비 | 검토 게이트 없는 실행 거부, 공개 메타데이터만 허용, 비공개 행·본문·독자 테이블·서비스 RPC 직접 호출 거부 | `verify_stage9_db.test.mjs`의 합성 PostgreSQL 테스트 |
| Storage 사전 감사 | 읽기 전용 P0 감사에 버킷 공개 여부·객체 수·storage 테이블 권한을 추가 | 합성 PostgreSQL 사전 감사 실행 |

## 아직 닫히지 않은 경로

1. `public/supabase-admin.js`에는 플래그 비활성 시 직접 테이블 접근과 구 RPC가 남아 있다. 독서기록·관심작·구독·댓글·관리자 사건·정산·후원·조회수·광고 언락·작가 댓글 정책 등을 호출처별로 새 API와 대조해야 한다. 읽기 경로도 `fetchEpisodeContentSecure`의 구 RPC/본문 컬럼 fallback을 포함한다.
2. `public/js/admin/admin.js`의 구 독자 상세 조회와 부관리자 권한 직접 수정, `public/supabase-admin.js`의 구 관리자 사건·역할 RPC/테이블 접근이 남아 있다. 새 관리자 화면 이외의 전역 호출처도 조사해야 한다. 독자 정보·비밀번호·삭제 쓰기는 이번에 실패 응답으로 닫았다.
3. 기존 공개 Storage 버킷/객체 URL, 서명 URL과 Realtime publication의 실제 정책 및 캐시를 조사하지 못했다. `authoring-originals`와 `authoring-covers`의 private 정책은 기존 버킷을 자동으로 보호하지 않는다.
4. 실제 DDL·뷰·SECURITY DEFINER 함수·column grant와 `database/p0/002_lockdown_after_cutover.sql`의 일치 여부가 미확인이다. 2026-09-24 읽기 전용 `node scripts/p0_schema_audit.cjs`가 HTTP 401로 중단됐다. 합성 SQL 통과는 실환경 적용 근거가 아니다.
5. 실제 데이터의 Auth 연결, 원고·공개본·버전·독서기록 대조, DB/Storage 백업과 격리 복원, 브라우저/Storage HTTP 인수, Cloudflare/Vercel 배포 의존 확인이 남았다.

## 스테이징 전환 순서와 중단 조건

1. [마이그레이션 실행 절차](migration-runbook.md)의 실제 스키마 감사·백업·격리 복원을 끝내고, 미연결 Auth 계정과 public 원고·Storage 객체를 대조한다. 읽기 전용 관리 API가 401이면 여기서 중단한다.
2. 001~011 증분 SQL을 실제 스키마와 비교해 적용한다. `authoring-011`은 `authoring-010` 기록과 검토된 세션 게이트가 있어야 실행된다. 새 플래그는 아직 켜지 않는다.
3. 활성 UI 호출을 모두 새 `/api/v2` 경로로 바꾸고 구 직접 테이블·RPC·Realtime·Storage 경로의 실패를 확인한다. 구 브라우저 캐시/기존 세션과 구 URL도 점검한다.
4. 일관된 쓰기 중지 창에 `p0_cutover_verified` 검토 게이트를 설정해 P0 잠금을 적용한다. 공개/비공개/제재/성인/예약/해금 권한을 익명·독자·작가·관리자별로 교차 검증한다.
5. `P0_API_ENABLED`와 해당 서비스 플래그를 함께 활성화하고, 작품·회차·본문·계정·독서기록 수와 해시를 백업 기준선과 대조한다. 하나라도 불일치하면 쓰기를 제한하고 보존된 데이터로 전진 복구한다.

현재는 1~5가 실환경에서 수행되지 않았다. 운영 적용과 단계 완료 판정은 보류한다.
