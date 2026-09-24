# 12단계 출시 기록 — 2026-09-24

## 2026-09-25 코드 배포 후속 작업

이하 12단계 표는 당시 기준선이다. 8~13단계 누적 변경과 후속 구동 수정을 `main`에 배포하는 작업을 진행한다. 관리 API 401, 운영 보안 API 503, 실제 백업·DB 전환·브라우저 인수 미완료로 **공개 오픈은 계속 NO GO**다.

- 진단·오류 구분, 안전한 본문/목록 조회, 점검 안내 및 Pages 빌드 검증을 추가했다. `npm run build`가 전체 출시 검증을 선행한다.
- 이 작업의 `npm run build`는 종료 코드 0으로 통과했다. 데이터·인증·Author/Creator·원고·파일·게시·독자·관리자·XSS·수익화 차단·접근 진단 회귀, Cloudflare Functions 번들 및 TypeScript 컴파일을 포함한다. DB 검증은 격리 PGlite이며 실제 SQL 적용/브라우저 검증은 수행하지 않았다.
- GitHub 저장소 접근·push 권한과 workflow 권한을 읽기 확인했다. CI와 Pages는 push된 커밋에 대해 각각 확인해야 한다.
- 관리 PAT 교체부터 실제 SQL·Cloudflare 적용까지는 [실제 서비스 활성화 절차](production-activation.md)를 따른다. 토큰·백업·검증된 계정 연결·Cloudflare 설정 권한이 없는 상태에서 운영 SQL이나 플래그를 변경하지 않았다.
- `npm run release:status -- <전체 SHA>` 결과는 Git에서 제외한 `scratch/github-release-status.json`에 저장된다. 관리 접근 재확인은 [진단 JSON](../../artifacts/launch-access-diagnostic.json)에 기록된다.

## 판정

**NO GO — 제한 베타·운영 전환·공개 오픈 모두 미실행.** 12단계는 1~11단계의 완료 근거가 연결된 출시 후보를 요구한다. [10단계 전환 감사](stage10-cutover-audit.md)와 [11단계 출시 게이트](release-checklist.md)에 필수 미검증 항목이 남아 있다. 코드를 빌드하거나 Cloudflare Pages 주소가 존재한다는 사실은 출시 승인 근거가 아니다.

## 후보·환경 기준선

| 항목 | 2026-09-24 확인 내용 | 상태 |
|---|---|---|
| 후보 커밋 | 현재 `main`의 HEAD는 `d74d67eb5789`이나 작업 트리에 8~12단계 수정·미추적 파일이 있다. 고정된 후보 커밋 없음 | 미확정 |
| 운영 주소 | 문서상 `https://webnovels-db4.pages.dev/` | 읽기 전용 HEAD 200. 기본 샌드박스 프록시에서는 연결 실패했으며 별도 읽기 전용 요청에서 접근 확인. 화면 인수 결과 아님 |
| Pages 구성 | 문서상 production branch `main`, build `npm run build`, output `public`, `functions/` 별도 번들 | 원격 설정·배포 ID 미확인 |
| CI | 로컬 `npm test`와 `npm run build` 통과 기록은 [11단계 결과](acceptance-results.md) 참조 | 동일 후보 커밋의 GitHub Actions 결과 미확인 |
| 데이터·Storage | 합성 PGlite만 검증. 실제 Supabase 관리 스키마 감사가 HTTP 401로 중단된 기록 | 실제 백업·적용·격리 복원 없음 |
| 기능 플래그 | `.env.example`은 P0/가입/작가/독자/관리자 기능을 모두 `false`로 예시 | 공개 설정 GET 200에서 `authorPublishEnabled=false`; 독자/작가 운영/관리자 플래그는 응답에 없어 원격 값 미확인. v2 health GET 503. 바인딩 자체는 읽지 않았고 변경하지 않음 |
| Auth·메일·Cron·모니터링 | 운영 리디렉션, 메일, 예약 실행기, 장애 알림·지원 담당 증거 없음 | 미확인 |

## 원격 설정 확인표

이름과 기대 역할만 기록한다. 실제 값·비밀 키는 이 문서에 쓰지 않는다.

| 설정 | 코드상 역할 | 운영 확인 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 공개 Supabase 연결 | 공개 설정 응답 200만 확인. 프로젝트 일치 여부 미확인 |
| `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` | Pages Functions 서버 전용 접근 | 바인딩·권한·회전 상태 미확인 |
| `P0_API_ENABLED`, `AUTH_ONBOARDING_ENABLED`, `AUTHOR_WORKS_ENABLED`, `AUTHOR_DRAFTS_ENABLED`, `AUTHOR_FILES_ENABLED`, `AUTHOR_PUBLISH_ENABLED` | 보안 전환·가입·작가 기능 게이트 | 공개 게시 플래그 `false` 외에는 실제 값 미확인 |
| `READER_SERVICE_ENABLED`, `AUTHOR_OPERATIONS_ENABLED`, `ADMIN_OPERATIONS_ENABLED`, `ADMIN_ROLE_CHANGES_ENABLED` | 독자/작가/관리자 운영 게이트 | 공개 설정 응답에 없어 실제 값 미확인 |
| `IMAGES` binding | 표지 서버 재인코딩 | 실제 binding·실행 미확인 |
| `scheduler/wrangler.toml`의 매분 Cron | 브라우저 밖 예약 발행 실행기 | 설정 파일만 확인. 배포·실행·알림 미확인 |
| Auth 허용 리디렉션 `/?auth=confirm`, `/?auth=recovery` | 가입 확인·비밀번호 재설정 | 운영 도메인 허용 목록·실제 메일 미확인 |

## 출시 차단 항목

1. 실제 DDL/RLS/RPC/Storage 감사·백업·복원 후 10단계 전환 리허설이 필요하다. 현재 직접 DB/Storage 경로와 일부 구 API가 남아 있다.
2. 11단계의 실제 계정·원고·게시·예약·역할별 접근·PC/모바일·장애 알림 검증이 미실행이다. 브라우저/localhost 검증은 프로젝트 규칙에 따라 명시 요청 없이 수행하지 않았다.
3. `public/index.html`에는 광고 무료 해금, 포인트, 후원, 출금·정산, 성인 인증 문구와 조작 화면이 남아 있다. `/api/v2/(payments|ads|adult-verification|points|support|settlements)`는 서버에서 503을 반환한다. 화면·URL·서버의 출시 범위가 일치할 때까지 베타 대상을 받지 않는다.
4. `stage8_catalog`는 작품 최대 5,000건·회차 최대 100,000건을 한 응답에 모으고, HTML은 독자·작가·관리자 스크립트를 모두 로드한다. 실제 부하와 기기 측정 및 페이지 조회 전환이 남아 있다.
5. 문서상 Pages는 `main` 자동 배포다. 현재 GitHub CI는 검증만 실행하므로 CI 실패가 Pages 자동 배포를 실제로 차단한다는 근거가 없다. 배포 브랜치 보호/Pages 빌드 게이트를 원격 설정에서 확인하고 시험해야 한다.
6. 로컬 Git remote URL에 들어 있던 인증 자격 증명은 이번에 URL에서 제거했다. 기존 Credential Manager가 설정돼 있다. 노출됐을 수 있는 기존 자격 증명의 회전은 아직 확인되지 않았다. 값은 기록하지 않는다.

## 전환 전 실행 순서

1. [릴리스 체크리스트](release-checklist.md)의 항목별 담당자·증거·완료 시각을 채운다. 실제 환경의 도메인/프로젝트·Auth 리디렉션·메일·Cron·알림·보관 설정을 **이름과 상태만** 확인하고 비밀값은 남기지 않는다.
2. 고객 데이터가 아닌 시험 계정·원고를 준비한다. 독자 A/B, 작가 A/B, 제한/최고 관리자 계정을 각각 검증한다.
3. 유지보수·쓰기 제한 창과 고객 공지를 확정한다. 동일 시점 DB와 Storage 객체 바이트의 백업/격리 복원, 작품·회차·Auth 연결·원고 해시·거래 기록 기준선을 기록한다.
4. [마이그레이션 절차](migration-runbook.md)와 [10단계 전환 감사](stage10-cutover-audit.md)의 순서로 실제 스키마·프론트/API·RLS·기능 플래그를 일관되게 적용한다. 관리 감사 401이나 불일치가 있으면 중단한다.
5. 실제 Cloudflare 주소에서 공개 메타데이터와 보호 원고, 구 RPC/Storage 직접 접근, 기존·신규 계정, 게시·예약 중복 및 다른 기기 복구를 확인한다. 배포 기록과 공개 오픈 판단을 별도로 남긴다.
6. [베타 관찰표](beta-observation-sheet.md)에 소수 작가의 첫 작품부터 수정까지의 결과와 운영 문의/신고/복구 훈련을 기록한 뒤 최종 오픈을 결정한다.

## 실패 시 중단·복구

원고 손실·잘못된 공개·권한 우회·기준선 불일치가 확인되면 신규 쓰기와 게시를 제한한다. 확정된 원고·버전·공개 결과를 보존하고 격리 복원에서 검증한 기준으로 전진 복구한다. 구 공개 RLS를 다시 열거나 테스트용 데이터로 덮어쓰지 않는다. 요청 ID, 영향 범위, 복구 시각, 재검증 결과만 사건 기록에 남긴다.

실제 배포 ID, 커밋, 백업 식별자, 검증 계정, 담당자, 공지·지원 채널, 베타/오픈 승인자는 **미정**이다. 미실행 항목을 성공으로 표시하지 않는다.

## 13단계 이후 갱신 — 2026-09-25

구형 브라우저 광고 이벤트·해금·후원·정산 경로를 비활성화하고 관련 독자/작가 진입점 일부를 숨겼다. 독자 화면의 성인 작품·비무료 회차도 제외했다. 이는 로컬 코드 변경이며 기존 운영 배포에 적용되지 않았다. 실제 DB 정책과 콘텐츠/파일 직접 접근은 확인하지 못했다. 출시 판정은 **NO GO**로 유지한다. [차단 이슈와 완료 증거](open-issues-after-stage13.md)를 우선순위별로 관리한다.
