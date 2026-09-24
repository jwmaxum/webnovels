# Cloudflare Pages 배포와 P0 전환

## 2026-09-24: 12단계 배포 보류 기록

[출시 기록](docs/launch/release-record.md)의 판정은 **NO GO**다. 이번 읽기 전용 확인에서 운영 주소 HEAD는 200, `/api/public-config.js`는 200이고 공개 설정의 `authorPublishEnabled`는 `false`였다. 다른 새 기능 플래그는 해당 응답에 없어서 실제 Pages 바인딩을 확인할 수 없었다. `/api/v2/health`는 JSON 503이었다. 이는 서비스 인수나 DB 보안 상태의 증명이 아니다. 실제 배포·플래그 변경·SQL 적용은 수행하지 않았다.

아래의 기존 P0 순차 절차는 역사적 계획이다. 현재 v2에는 작가 원고·파일·게시, 독자 및 관리자 운영 API의 로컬 구현이 추가됐지만 [10단계 전환](docs/launch/stage10-cutover-audit.md)과 [11단계 인수](docs/launch/acceptance-results.md)가 완료되지 않았다. `main` 자동 Pages 배포가 문서대로 설정됐다면 GitHub Actions CI 실패와 별개로 배포가 시작될 수 있으므로, 원격 브랜치 보호·Pages 빌드 게이트를 확인하기 전에는 CI 통과를 배포 차단 보장으로 취급하지 않는다.

실제 운영: https://webnovels-db4.pages.dev/

- Production branch: `main`
- Build command: `npm run build`
- Build output: `public`
- 프로젝트 루트의 `functions/`는 Pages가 별도로 번들링한다. Express/Prisma SQLite는 Cloudflare 업무 API로 실행하지 않는다.
- `_worker.js` 고급 모드와 혼용하지 않는다. `functions/api/v2/[[path]].js`가 새 보안 API이며 기존 미구현 `/api/*`는 JSON 503을 반환한다.
- Pages는 함수 파일 확장자를 URL에서 제거하므로 기존 `/api/public-config.js` 주소는 catch-all에서 명시적으로 처리한다. 이 경로는 HTML 대신 공개 설정 JavaScript를 반환한다.

## 현재 등록된 설정

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`를 그대로 사용한다. 공개 URL·publishable 키 두 항목만 브라우저에 전달한다. `SUPABASE_SECRET_KEY`는 함수의 서버 바인딩으로만 읽는다. Git의 `.env.local`은 Cloudflare에 전달되지 않는다.

`P0_API_ENABLED`는 현재 등록하지 않거나 `false`로 유지한다. 이것을 `true`로 바꾸는 것만으로 보안 적용이 완료되지 않는다. API는 DB의 `p0_migration_status`가 `p0-20260921 / locked`인지도 확인한다.

## 순차 전환 절차

1. `npm run audit:p0-schema`로 실제 스키마를 확인한다. 결과는 Git에서 제외된 `scratch/p0/schema-audit.json`에 저장된다. 함수 정의에는 비밀값이 있을 수 있으므로 외부에 공유하지 않는다. 현재 관리 토큰은 401이다.
2. Supabase 백업 생성·복원 가능 여부를 확인하고 백업 식별자를 운영 기록에 남긴다. 읽기 점검 결과 파일은 백업이 아니다.
3. `database/p0/001_expand_identity_content.sql`을 실제 스키마와 대조한 뒤 적용한다. SQL은 현재 미실행·미검증이다. 콘텐츠를 보호 테이블로 복제하고 편집 동기화 트리거를 만든다. 기존 콘텐츠는 삭제하지 않는다.
4. 기존 계정을 검증된 Auth UUID에 연결한다. 최소한 독자 2명, 작가 2명, 최고/제한 관리자 계정의 로그인·권한을 검증한다. 매핑되지 않은 기존 계정은 삭제하거나 이메일만으로 자동 연결하지 않는다.
5. 프론트의 모든 개인/쓰기/본문 경로를 새 API로 옮긴다. 현재 구현한 v2는 신원 조회, 공개 작품, 관리자 독자/설정 조회, 작품/회차 수정, 본문 권한 검사에 한정된다. 가입·활동·댓글·기타 CMS·정산 전환은 남아 있다.
6. 별도 테스트 프로젝트에서 권한 차단 SQL과 교차 계정 테스트를 수행한다. 준비가 끝난 뒤 유지보수 시간에 `webnovels.p0_cutover_verified` 확인값을 설정하고 `002_lockdown_after_cutover.sql`을 적용한다. 전체 기존 RPC와 뷰 접근이 닫히므로 이 단계를 먼저 실행하면 기존 기능이 중단된다.
7. 새 프론트 전환과 `P0_API_ENABLED=true`를 함께 적용한다. 익명 개인정보/본문/RPC 직접 접근, 조작된 브라우저 토큰, 타 계정 변경, 만료/중지 계정 거절을 실제 Cloudflare 주소에서 재검증한다.
8. Storage의 비공개 원고·웹툰 이미지 공개 URL도 점검한다. DB 본문 권한만 막아도 공개 Storage URL은 보호되지 않는다. 보호 버킷과 단기 서명 URL 전환은 별도 검증이 필요하다.

## 결제·성인인증 설정 예정

- 결제: `TOSS_CLIENT_KEY`(공개), `TOSS_SECRET_KEY`(서버 비밀), `TOSS_MODE`(`TEST`/`LIVE`). 상점의 실제 발급키 사용. 클라이언트 키와 비밀 키는 동일한 상점·환경이어야 한다.
- 본인확인 제안: PortOne V2의 KG이니시스 통합인증. 카카오·PASS 등을 선택할 수 있다. 가장 많이 사용된다는 시장 순위는 확인되지 않았으므로 그런 전제로 업체를 확정하지 않는다.
- 필요한 설정: `PORTONE_STORE_ID`, `PORTONE_IDENTITY_CHANNEL_KEY`, `PORTONE_API_SECRET`(서버 비밀). 서비스 계약과 채널 발급이 필요하며 카카오 CI 제공은 추가 계약 절차를 확인해야 한다.
- 브라우저가 보낸 생년월일이나 성공 플래그로 성인 처리하지 않는다. 서버가 발급한 인증 요청 ID를 사용자에 연결하고 업체의 인증 완료 내역을 서버에서 재조회한 뒤 처리해야 한다.
- **현재는 키 입력만으로 결제·성인인증 운영이 완료되는 상태가 아니다.** 주문/인증요청 저장, 원자적 원장 반영, 재시도, 환불, 사용자 연결과 실제 테스트가 선행되어야 한다. 기존 결제 모의 승인 경로는 차단한다.

근거: [Cloudflare 라우팅](https://developers.cloudflare.com/pages/functions/routing/), [PortOne 통합인증](https://developers.portone.io/opi/ko/integration/pg/v2/inicis-unified-identity-verification), [본인인증 서버 조회](https://developers.portone.io/opi/ko/extra/identity-verification/readme-v2), [토스 결제 API](https://docs.tosspayments.com/reference).
