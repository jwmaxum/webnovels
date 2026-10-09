# 12단계 출시 기록 — 2026-09-24

## 19단계 CI 실패 후속 — 2026-10-09

코드 push는 성공했지만 98569ddd88ffa3a6583156238c39286fc8b5aa97의 [GitHub Actions](https://github.com/jwmaxum/webnovels/actions/runs/37881750928)와 Pages 빌드는 실패했다. CI에서는 19단계 fixture의 scratch/stage19 미생성으로 6개 ENOENT를 확인했다. 이를 수정하고 Node 24/Actions v7/Ubuntu 24.04로 빌드 환경을 맞춘다. 이전 로컬 387건 기록을 이 후보의 원격 성공 증거로 사용하지 않는다. 새 소스 사본의 후속 로컬 build 387건·번들/컴파일과 별도 타입 검사는 통과했다. [CI 복구 검증](../../artifacts/stage19-ci-repair-verification.json). 실제 후속 후보와 결과는 Git commit/check 상태에서 확인하며 공개 출시 NO GO를 유지한다.

## 19단계 품질 코드·읽기 감사 — 2026-10-09 최신

**공개 출시 판정: NO GO.** [19단계 계약](stage19-quality-contract.md)·[검증 근거](../../artifacts/stage19-quality-verification.json). 단계 코드는 Git에 반영하지만 해당 커밋의 원격 CI/Pages 배포·실기기·베타를 확인한 결과로 표시하지 않는다. 후보 전체 SHA는 반영된 Git 커밋으로 고정하고 그 SHA의 원격 증거를 후속 수집한다.

| 항목 | 확인한 결과 | 범위/한계 |
|---|---|---|
| 품질 코드 | 작가/관리자 지연 로딩, 키보드 모달, local vendor/SRI, 취약 의존성 갱신, 정적/API 보안 헤더 | 단위·VM·합성 DB, 엄격 script CSP는 Report-Only |
| 복원 도구 | archive·전체 객체 바이트/해시·참조·DB fingerprint 대조, PGlite 전체 data-directory dump/load | 실제 Supabase/Auth/Storage 복원·독립 보관·운영 RPO/RTO 미실행 |
| 베타 판정 | 후보/환경/범위·최근 실제 증거·파일 SHA·표본·담당·P0를 확인 | LOCAL_UNIT/SYNTHETIC_RESTORE는 실제 인수로 인정하지 않음, 최종 승인자 미정 |
| 12:30 KST 실제 DB 읽기 | Auth 42개·확인 42개, 작가 연결 30개·독자 10개·관리자 1개; 작품 30개/회차 180개·소유자/FK 누락 0 | 개인 계정 행/비밀 미출력. 해당 계정의 실제 역할/메일/기기 인수는 미실행 |
| 적용 상태 | authoring-001/003/004/005/006, P0 marker 없음, 본문 충돌 78건, Storage bucket/object 0, provider backup 0 | 007~015 SQL·P0 전환·원본 판정·Storage 준비/복원 남음. 과거 native backup은 이번 감사에서 재검증하지 않음 |
| 12:31 KST HTTP | health 503 SECURE_API_NOT_ACTIVATED, requestId 170d7b1f-f3ea-4231-aa4b-52073f70694a; public-config 200 | 웹툰·게시·파일·독자·발견·작가/관리자 운영·workflow·역할변경 false. 설정 변경 없음 |

다음 실행은 유지보수/백업 기준을 확정한 격리 전환·Storage 복원 → 실제 역할/메일/Cron/배포 실패 차단 → PC/모바일 인수 → 제한 베타/지원 훈련 순서다. 19단계 실제 무료 서비스 인수가 끝난 뒤 20단계 단일 거래 모델·원장·정산으로 진행한다. 아래 이전 기록의 Auth 0개/일괄 스크립트 로딩은 당시 상태이며 위 최신 근거로 대체한다.

## 503 복구·데이터 정합화 — 2026-09-25 최신

- 08:22 KST 운영 적용: 작품 소유자 20건(누락 0건), 기존 원고 102건 정합화. 사용자 선택에 따라 빈 본문 78건을 보존했다. 변경 전후 122건은 비공개 DB 이력에 보관한다.
- 08:27 KST 운영 적용: UUID를 정수 독자 ID에 넣던 잘못된 Auth 가입 트리거 제거, 별도 Auth 연결 열/고유 인덱스 준비. 기존 프로필·역할 보존. 실제 Auth 계정 연결은 소유 확인 입력 대기다.
- 08:32 KST: 운영 78개 테이블의 PostgreSQL custom archive 확보. 별도 PGlite 데이터 복원은 1,109행·public 제약조건 98개를 확인했다. Supabase 전체 서비스 복원·독립 백업 보관은 미검증이다.
- 후속 실제 HTTP: 보호 경로 7개 접근 거절, 공개 메타데이터 3개 유지. `/api/v2/health`는 여전히 503이다. 본문 78건, 실제 Auth 연결, P0/authoring 전환 및 Cloudflare 활성화 조건이 남았다.
- 로컬 `test:launch` 8개, `test:auth` 14개, `test:naming` 3개 통과. 실제 데이터의 정합화/가입 오류 리허설도 별도로 통과했다. 브라우저 인수는 수행하지 않았다.

**[실행 결과·백업 경로·남은 입력·503 전환 순서](503-recovery-plan.md)**. 최신 커밋의 GitHub Actions/Pages 결과는 `npm run release:status -- <전체 SHA>`로 확인한다. 공개 오픈 판정은 **NO GO**다. 아래는 각 작업 당시 기록이다.

## 승인된 보호 SQL 운영 적용 — 2026-09-25

사용자의 명시 승인 후 `database/p0/003_maintenance_containment.sql`을 07:13 KST에 운영 Supabase에 적용했다. public 테이블 42개의 행 수·전체 행 해시가 모두 동일하며, 감사 대상 민감 SELECT와 브라우저 테이블 쓰기 권한은 0개다. 실제 HTTP에서 공개 메타데이터 3개 경로는 206, 민감 열·본문·초안 등 7개 경로는 401로 의도대로 응답했다.

[SQL 적용 증거](../../artifacts/maintenance-containment-verification.json) · [HTTP 검증](../../artifacts/maintenance-containment-http.json). 관리 API 401 문제와 달리 여기의 익명 401은 정상 권한 거절이다. 기능 플래그와 authoring 마이그레이션은 변경하지 않았다. 데이터/계정/백업 전환 조건이 남아 운영 health는 503이며 공개 오픈은 NO GO다. 아래 승인 대기 내용은 이 적용 이전 기록이다.

## 토큰 갱신 후 실제 DB 점검 — 2026-09-25

관리 API 401은 해결됐다. 실제 감사에서 작품 소유자 미연결 20개, 두 본문 저장소 불일치 180개(한쪽 빈 본문 78개), Auth 사용자 0개, 새 마이그레이션·백업 부재를 확인했다. 전체 전환을 강행하면 소유자·본문 원본을 임의 결정하게 되므로 공개 오픈은 계속 NO GO다.

[최신 감사 결과](../../artifacts/launch-readiness-audit.json) · [권한 변경/복구 ROLLBACK 리허설](../../artifacts/launch-rehearsal-verification.json) · **[실행할 후속 조치](token-renewal-followup.md)**.

권한 차단 SQL은 로컬 검증과 실 DB 차단/복구 리허설을 통과했으나 영구 적용은 자동 승인 검토가 거절해 사용자 승인을 요청했다. 현재 영구 DB 변경·기능 플래그 활성화는 미실행이다. Cloudflare 설정은 사용자 직접 변경으로 합의했다. 이하 내용은 이전 코드 배포 당시 기록이다.

## 2026-09-25 코드 배포 후속 작업

이하 12단계 표는 당시 기준선이다. 8~13단계 누적 변경과 후속 구동 수정을 `main`에 push했고 코드 배포가 성공했다. 관리 API 401, 운영 보안 API 503, 실제 백업·DB 전환·브라우저 인수 미완료로 **공개 오픈은 계속 NO GO**다.

| 실제 확인 항목 | 결과 |
|---|---|
| 코드 커밋 | `2eea8eeec2e9fbce5702a585ceb15c9a3da01324` |
| Git push | `main` 성공. 첫 시도의 저장된 다른 계정 403은 권한 있는 로컬 토큰의 일회성 askpass로 해결 |
| GitHub Actions | [실행 36058069216](https://github.com/jwmaxum/webnovels/actions/runs/36058069216) — success |
| Cloudflare Pages | 프로젝트 `webnovels`, 배포 `c59720a2-635a-4bfc-8961-7ffbbcb8f8f1` — success |
| 운영 HTTP 확인 | 2026-09-25 05:57 KST. HTML/JS 200, 점검 안내 포함, 수정 JS 두 파일과 커밋 소스 일치, 캐시 재검증 적용 |
| 운영 기능 상태 | health 503 `SECURE_API_NOT_ACTIVATED`, 게시/독자/작가운영/관리자운영/권한변경 공개 플래그 false |
| SQL·브라우저 인수 | 미실행. [운영 HTTP 증거](../../artifacts/production-deployment-verification.json)는 이 인수를 대체하지 않음 |

- 진단·오류 구분, 안전한 본문/목록 조회, 점검 안내 및 Pages 빌드 검증을 추가했다. `npm run build`가 전체 출시 검증을 선행한다.
- 이 작업의 `npm run build`는 종료 코드 0으로 통과했다. 데이터·인증·Author/Creator·원고·파일·게시·독자·관리자·XSS·수익화 차단·접근 진단 회귀, Cloudflare Functions 번들 및 TypeScript 컴파일을 포함한다. DB 검증은 격리 PGlite이며 실제 SQL 적용/브라우저 검증은 수행하지 않았다.
- GitHub 저장소 접근·push 권한과 workflow 권한을 읽기 확인했고, 위 코드 커밋의 CI와 Pages 성공을 각각 확인했다. 이 기록을 담는 후속 문서 커밋과 기능 코드 커밋을 구분한다.
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

2026-10-09 17단계 후속: [관리자 업무 계약](admin-workflow-contract.md), [로컬 검증 근거](../../artifacts/stage17-admin-workflow-verification.json). `014_admin_workflow.sql`과 관리자 API/UI를 추가했지만 실제 DB에 적용하거나 `ADMIN_WORKFLOW_ENABLED`를 활성화하지 않았다. Git 반영은 운영 배포 확인·실제 메일/기기/브라우저 인수·출시 승인을 의미하지 않는다. 기존 출시 차단 조건을 유지한다.

구형 브라우저 광고 이벤트·해금·후원·정산 경로를 비활성화하고 관련 독자/작가 진입점 일부를 숨겼다. 독자 화면의 성인 작품·비무료 회차도 제외했다. 이는 로컬 코드 변경이며 기존 운영 배포에 적용되지 않았다. 실제 DB 정책과 콘텐츠/파일 직접 접근은 확인하지 못했다. 출시 판정은 **NO GO**로 유지한다. [차단 이슈와 완료 증거](open-issues-after-stage13.md)를 우선순위별로 관리한다.

2026-10-09 21단계 후속: [성장 계약](growth-experiments-contract.md), [검증 근거](../../artifacts/stage21-growth-verification.json).
017 private growth·동의/규칙 추천·KST 성장 후보/관찰·공유 검색을 준비했다. SQL과 플래그는 실제 환경에
적용하지 않았고 정책 seed·실제 등급 변경·알림 발송·성장 성공 판정은 없다. 로컬 검증·Git push와 실제 성장/출시 GO를
구분하며 19단계 무료 출시 차단과 실환경 인수 조건을 유지한다. 22단계에서 전환/복원/역할 인수·첫 열람 계측·실제 표본을 우선한다.
