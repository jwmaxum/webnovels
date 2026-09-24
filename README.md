# WebNovels

웹소설 독자 화면, 작가 스튜디오, 관리자 화면을 개발 중인 저장소입니다. **2026-09-25 현재 정식 출시 또는 제한 베타 승인 상태가 아닙니다.** 운영 주소는 [Cloudflare Pages](https://webnovels-db4.pages.dev/)이며, 주소가 응답한다는 사실은 데이터 보호·기능 인수·오픈 완료를 의미하지 않습니다.

## 현재 범위

- 독자·작가·관리자용 화면과 Cloudflare Pages Functions `/api/v2/*`가 있습니다. 새 업무 API는 기능 플래그와 DB 보안 버전이 준비되지 않으면 닫힙니다.
- 계정·작품·원고·파일·게시·예약·독자/관리자 기능은 로컬 mock API와 격리 PostgreSQL에서 계약을 검증했습니다. 실제 Supabase/Auth/Storage, 메일, Cron, PC/모바일 인수는 남아 있습니다.
- 기존 화면에는 광고 해금, 포인트, 후원, 성인인증, 수익·정산 안내가 남아 있습니다. 해당 운영 기능은 검증되지 않았고 새 v2 API는 503으로 닫혀 있습니다. 이를 사용할 수 있다는 안내로 해석하지 마세요.
- 기존 데이터와 계정 매핑은 보존 대상입니다. 운영/공유 DB에서 초기화·재시드·`prisma db push`를 실행하지 않습니다.

출시 결정과 남은 조건은 [12단계 출시 기록](docs/launch/release-record.md), [11단계 출시 체크리스트](docs/launch/release-checklist.md), [10단계 전환 감사](docs/launch/stage10-cutover-audit.md)를 확인하세요. 과거 상태를 담은 [런칭 점검 보고서](LAUNCH_READINESS.md)는 날짜별 기록으로 유지합니다.

**관리 API 401과 서비스 API 503의 해결 순서:** [실제 서비스 활성화 절차](docs/launch/production-activation.md)에 새 관리 PAT 발급·로컬 교체, 읽기 감사, 백업·SQL 순서, Cloudflare 설정과 확인 명령을 정리했습니다. `npm run diagnose:launch`로 비밀값 없이 현재 상태를 확인할 수 있습니다.

## 구조와 로컬 검증

| 경로 | 역할 |
|---|---|
| `public/` | 독자·작가·관리자 SPA 정적 파일 |
| `functions/` | Cloudflare Pages Functions 진입점 |
| `server/` | Worker 호환 v2 업무 API |
| `database/authoring/`, `database/p0/` | 실제 스키마 감사·백업 확인 뒤 적용할 증분 SQL |
| `src/`, `prisma/` | 과거 Express/SQLite 개발 코드. Cloudflare 업무 API가 아님 |

로컬에서 의존성을 설치하고 안전한 회귀 묶음과 빌드를 실행할 수 있습니다.

    npm ci
    npm run build

`npm run build`는 전체 회귀·Functions 번들을 통과한 뒤 컴파일합니다. 검증만 할 때는 `npm test`를 사용하며 mock API와 격리 PGlite에서 실행됩니다. 과거 `scripts/verify_backend.ts`는 SQLite 데이터를 삭제하고 localhost 서버를 시작하므로 이 회귀 묶음에서 제외했습니다. 실환경 검증 명령과 순서는 [마이그레이션·백업 절차](docs/launch/migration-runbook.md)를 따릅니다. 자격 증명은 Git에 넣지 마세요.

## 문서

- [전체 단계](improve.md) · [12단계](improve12.md)
- [Cloudflare 배포·전환 안내](CLOUDFLARE_DEPLOYMENT.md)
- [Author/Creator 호환 계약](docs/launch/author-creator-contract.md)
- [제한 베타 관찰표](docs/launch/beta-observation-sheet.md)
