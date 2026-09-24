# 실제 서비스 활성화 절차와 현재 차단 원인

2026-09-25 확인. 이 문서는 실행 방법이며 DB 전환 완료 기록이 아니다. 실제 상태는 [접근 진단 JSON](../../artifacts/launch-access-diagnostic.json)과 [출시 기록](release-record.md)을 함께 확인한다.

## 1. 이번에 확인한 원인

| 대상 | 실제 결과 | 의미와 조치 |
|---|---|---|
| Supabase 관리 SQL API | HTTP 401, `MANAGEMENT_TOKEN_REJECTED` | 로컬 `SUPABASE_ACCESS_TOKEN`이 거절된다. 만료·폐기·잘못된 값 중 어느 원인인지는 이 응답만으로 구분할 수 없다. 계정 소유자가 새 PAT를 발급해야 한다 |
| Supabase 공개 키 / 서버 키의 메타데이터 HEAD | 각각 HTTP 200 | 프로젝트 데이터 API 연결은 된다. 이 성공은 관리 SQL 권한이나 RLS 안전성의 증거가 아니다 |
| 서버 키로 `p0_migration_status` 조회 | HTTP 404 | 필요한 보안 전환 상태를 API에서 찾지 못한다. SQL Editor에서 객체 존재·권한·스키마 캐시를 확인해야 한다 |
| 운영 `/api/v2/health` | HTTP 503, `SECURE_API_NOT_ACTIVATED` | Pages의 보안 API 활성화 조건이 충족되지 않았다. Git push만으로 DB/비밀 설정/기능 플래그가 바뀌지 않는다 |
| GitHub 저장소 | 접근 성공, push 권한 확인 | 코드 push 가능. 이후 GitHub Actions와 Cloudflare의 실제 배포 결과는 별도 확인한다 |
| Cloudflare 관리 접근 | 로컬 API 토큰/계정 설정과 Wrangler CLI 없음 | 현재 세션에서는 Pages 변수·Images binding·Cron을 관리 API로 변경할 수 없다. 아래 Dashboard 또는 Wrangler 절차가 필요하다 |

## 2. 401 해결 — 계정 소유자가 한 번 해야 할 일

1. 해당 Supabase 프로젝트에 권한이 있는 계정으로 [Access Tokens](https://supabase.com/dashboard/account/tokens)를 연다.
2. 새 PAT를 발급한다. 프로젝트 범위를 선택할 수 있으면 `ghwabesnydktumeyejnm`만 선택하고 읽기 감사에는 **Database / Read** 권한을 준다. 실제 변경 단계에는 검토된 SQL 실행에 필요한 Database 쓰기 권한이 별도로 필요하다. 토큰 권한은 계정이 가진 권한을 넘을 수 없다. [Supabase PAT 공식 문서](https://supabase.com/docs/guides/platform/personal-access-tokens).
3. 로컬 편집기로 `D:\Antigravity\webnovels\.env.local`의 `SUPABASE_ACCESS_TOKEN`을 교체한다. 채팅·명령줄 인자·Git·스크린샷에 값을 남기지 않는다. `sb_secret_...`, service-role JWT, publishable 키는 관리 PAT의 대체가 아니다.
4. 아래 명령을 저장소 루트에서 실행한다. 진단은 값이나 고객 행을 출력하지 않는다. 관리 요청은 [읽기 전용 SQL endpoint](https://supabase.com/docs/reference/api/v1-read-only-query)를 사용한다.

```powershell
npm run diagnose:launch
npm run audit:p0-schema
```

`management.ok=true`와 `MANAGEMENT_SQL_ACCESS_OK`가 성공 기준이다. 401이면 토큰 재발급/붙여넣기·실행 프로세스의 오래된 환경변수를 점검한다. 403이면 프로젝트 멤버십과 Database 권한을 확인한다. `NETWORK_UNREACHABLE`은 프록시/방화벽 문제다. 정상 토큰을 반복 재발급하여 네트워크 문제를 해결하려고 하지 않는다.

관리 권한을 줄 수 없다면 프로젝트 관리자가 SQL Editor에서 `database/p0/000_preflight.sql`과 `database/authoring/000_integrity_audit.sql`을 읽기 전용으로 실행하고 결과를 비공개 저장소로 제공해야 한다. 함수 정의에 비밀이 있을 수 있으므로 결과 원문은 Git에 넣지 않는다. 감사 결과만으로 백업·복원이 완료되지는 않는다.

## 3. 실제 DB 적용 전 조사와 백업

프로젝트 관리자가 SQL Editor에서 먼저 확인한다.

```sql
select to_regclass('public.p0_migration_status') as security_marker,
       to_regclass('authoring.migrations') as authoring_marker;
```

객체가 존재할 때만 각각 조회한다.

```sql
select version, phase from public.p0_migration_status;
select version from authoring.migrations order by version;
```

404를 없애기 위해 상태 행을 수동으로 `locked`로 만들면 안 된다. 잠금 SQL의 권한/정책 변경과 검증이 완료되어야 한다.

[마이그레이션 절차](migration-runbook.md)의 A~C를 수행한다. 실제 DB 덤프·Auth 연결·Storage 파일 바이트와 해시를 같은 기준 시점으로 확보하고 격리 프로젝트에서 복원한다. 기존 작품/회차/원고/버전/계정/거래를 보존한다. 현재 이 백업 ID와 복원 증거는 없다.

## 4. 검토한 SQL의 순서

스테이징에서 아래 파일을 실제 스키마와 대조한 뒤 순서대로 적용한다. 각 파일은 자체 트랜잭션이며 오류가 나면 다음 파일로 넘어가지 않는다. 기존 `database/*.sql`을 일괄 실행하거나 seed를 운영에 넣지 않는다.

| 순서 | 파일 | 확인 사항 |
|---|---|---|
| 1 | `database/p0/001_expand_identity_content.sql` | 기존 ID·본문·계정 보존, 확장 상태 |
| 2 | `database/authoring/001_authoring_foundation.sql` | 원고·불변 버전·공개본 기초 |
| 3 | `database/authoring/002_private_storage.sql` | private 버킷 충돌·객체 보존 |
| 4 | `database/authoring/003_verified_identity_link.sql` | 검증된 Auth UUID와 기존 프로필 연결 |
| 5 | `database/authoring/004_auth_onboarding.sql` | 가입 RPC·프로필 생성 정책 |
| 6 | `database/authoring/005_creator_works.sql` | 소유 작품·비공개 생성·멱등성 |
| 7 | `database/authoring/006_creator_drafts.sql` | revision 저장·충돌·복구 |
| 8 | `database/authoring/007_creator_files.sql` | 원본·표지·파일 내보내기 |
| 9 | `database/authoring/008_creator_publications.sql` | 게시·예약·공개본 보존 |
| 10 | `database/authoring/009_creator_reader_operations.sql` | 독자 활동·댓글·작가 운영 |
| 11 | `database/authoring/010_admin_operations.sql` | 관리자 권한·감사·신고/이의제기 |
| 12 | `database/authoring/011_reader_profile_cutover.sql` | 자기 닉네임 변경 |
| 13 | `database/p0/002_lockdown_after_cutover.sql` | 전 경로·역할·Storage 전환 검증 후 최종 잠금 |

authoring SQL은 검토 완료 세션의 `webnovels.authoring_apply_verified='true'`, 최종 P0 잠금은 `webnovels.p0_cutover_verified='true'`가 필요하다. SQL Editor가 실행 사이에 같은 연결을 유지한다고 가정하지 않는다. **감사·백업·스테이징 검증을 실제로 마친 뒤에만** 해당 `SET`을 파일 내용 앞에 붙이고 마지막에 `RESET`을 붙여 같은 실행 배치로 실행한다. 플래그를 설정하는 행위가 검증을 대신하지 않는다.

초기 독자·작가·최고관리자의 Auth 연결은 기존 소유자 확인 자료에 따라 `authoring.link_verified_identity`로 수행한다. 이메일/이름만으로 자동 연결하거나 임의 관리자 권한을 부여하지 않는다. 잠금 SQL은 이 검증된 연결이 없으면 중단한다.

## 5. Cloudflare Pages와 예약 실행기

Cloudflare Dashboard → Workers & Pages에서 운영 주소 `webnovels-db4.pages.dev`를 제공하는 실제 프로젝트를 선택한다. 프로젝트 이름을 도메인만 보고 추정하지 않는다. Settings에서 production branch=`main`, build command=`npm run build`, output directory=`public`, repository root를 확인한다. 새 `build` 명령은 테스트 전체가 성공해야 컴파일까지 진행한다. Git 연결 설정은 [Cloudflare 공식 문서](https://developers.cloudflare.com/pages/configuration/git-integration/)를 따른다.

이번 push의 GitHub Check가 반환한 실제 Pages 프로젝트는 `webnovels`다. [이번 배포의 Cloudflare Dashboard](https://dash.cloudflare.com/?to=/7c88b2d2b3fe9baf32dc744ac0a631b3/pages/view/webnovels/c59720a2-635a-4bfc-8961-7ffbbcb8f8f1)에서 로그·환경·도메인을 대조할 수 있다. Git 연결 배포는 실행되었지만 설정 변경 권한이 확보된 것은 아니다.

Production 환경에 공개 연결과 서버 비밀을 서로 다른 항목으로 넣는다.

| 설정 | 적용 방법/조건 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 감사한 동일 Supabase 프로젝트의 공개 URL·publishable/anon 키 |
| `SUPABASE_SECRET_KEY` | 서버 전용 secret binding. `NEXT_PUBLIC_` 이름 금지 |
| `P0_API_ENABLED` | 실제 P0 잠금·교차 권한 시험 후 `true` |
| `AUTH_ONBOARDING_ENABLED` | 004 적용, 메일·callback·가입 인수 후 `true` |
| `AUTHOR_WORKS_ENABLED`, `AUTHOR_DRAFTS_ENABLED` | 005·006 적용과 작가 A/B 원고 격리·복구 인수 후 `true` |
| `AUTHOR_FILES_ENABLED` | 002·007 및 실제 private Storage·서명 URL·`IMAGES` binding 검증 후 `true` |
| `AUTHOR_PUBLISH_ENABLED` | 008 적용·게시/예약·보호 본문 인수 후 `true` |
| `READER_SERVICE_ENABLED`, `AUTHOR_OPERATIONS_ENABLED` | 009·011 적용과 독자/작가 운영 인수 후 `true` |
| `ADMIN_OPERATIONS_ENABLED` | 010 적용과 제한/최고관리자 인수 후 `true` |
| `ADMIN_ROLE_CHANGES_ENABLED` | 권한 변경 분리 검증 전에는 `false` 유지 |

이 표는 최종 활성화 조건이다. 지금 모든 값을 일괄 `true`로 바꾸지 않는다. Preview는 격리 Supabase를 사용한다. 변수 변경 후 해당 환경에 재배포하고 공개 설정 응답에 서버 비밀이 없는지 확인한다.

Supabase Auth의 Site URL과 허용 Redirect URLs에 실제 운영 도메인 및 `/?auth=confirm`, `/?auth=recovery` 경로를 등록한다. 가입 확인/비밀번호 재설정 메일의 실제 발송·만료·재시도를 시험한다.

예약 발행은 Pages 배포에 포함되지 않는다. `scheduler/wrangler.toml`의 별도 Worker에 `SUPABASE_URL`과 secret `SUPABASE_SECRET_KEY`를 설정하고, 008 적용·예약 테스트가 끝난 뒤 `AUTHOR_PUBLISH_ENABLED=true`로 배포한다. 매분 Cron 실행 로그와 실패 알림 수신을 확인한다. 인증키는 Wrangler의 `secret put` 대화형 입력이나 Dashboard에 입력한다.

## 6. 배포와 실제 구동 확인

```powershell
npm run build
git push origin main
npm run release:status -- <전체-40자리-커밋-SHA>
npm run diagnose:launch
```

GitHub 상태 결과는 `scratch/github-release-status.json`, 접근 결과는 `artifacts/launch-access-diagnostic.json`에 저장된다. Git push 성공, GitHub Actions 성공, Pages 배포 성공, 서비스 활성화 성공은 각각 확인한다. Pages 상태가 나타나지 않으면 Dashboard의 연결 저장소·자동 production 배포 설정과 Deployments 로그를 확인한다.

Git push에서 `Permission ... denied to ...`와 HTTP 403이 나오면 Windows Credential Manager가 선택한 GitHub 계정의 저장소 권한을 확인한다. 이번 첫 시도도 이 문제였으며 쓰기 권한을 확인한 다른 로컬 PAT를 일회성 Git askpass로 전달해 성공했다. 재발 시 자격 증명 관리자의 해당 GitHub 항목을 올바른 계정으로 갱신한다. workflow 파일을 변경하는 토큰에는 workflow 권한도 필요하다. 토큰을 remote URL에 넣거나 셸 명령에 직접 붙이지 않는다.

최종 기준은 `/api/v2/health`의 JSON 200, 공개 카탈로그·무료 본문 정상, 익명/다른 작가의 보호 데이터 거절, 실제 가입→작품→원고→게시→독자 열람, 예약 중복 방지, 파일 복구 및 운영 알림 수신이다. [인수 시나리오](acceptance-scenarios.md)를 실제 환경에서 완료해야 한다. 프로젝트 규칙상 브라우저/localhost 인수는 사용자 명시 요청 후 실행한다.

현재 새 관리 PAT, 백업/격리 복원 증거, 검증된 계정 연결, Cloudflare 설정 권한이 없어 운영 SQL/기능 활성화까지 진행할 수 없다. 제공업체 수익화·성인 기능은 계속 별도 출시 대상이다. 이 조건이 해소되면 2절 진단부터 이어서 진행한다.
