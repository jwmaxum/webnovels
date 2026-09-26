# 서비스 오픈 개발 산출물

## 현재 구동 상태와 실행 방법 — 2026-09-25

**2026-09-26 최소 작가 대시보드:** [대시보드·수익 조회·본인 정보·정산 계좌](author-dashboard-rollout.md). 네 가지 메뉴로 정리하고 운영 SQL 적용 및 실제 DB/Auth 검증을 완료했다. 계좌번호는 암호화·마스킹하며 비밀번호 재확인 후 저장한다. 실제 수익 집계는 광고/결제 연동 대기, 이전 수익 기록은 검증 대기로 표시한다. 코드 `a448d06`의 CI·Cloudflare 배포 성공. 작업 환경의 Pages 연결 오류로 화면 인수는 미실시다.

**2026-09-26 작가 작업실:** [내 작품 등록·설정 수정·비공개 원고 저장·복구 및 하단 모달 수정](author-workspace-rollout.md). authoring 001/003/004/005/006을 운영에 적용하고 기존 초안 2건·계정 연결 근거 41건을 보존했다. 실제 DB 저장/충돌/권한과 Supabase Auth 통합 검증, 코드 `aeac74f`의 CI·Cloudflare 배포가 완료되었다. 작업 환경의 TLS 오류로 배포 후 Pages HTTP·화면 확인은 대기다. 전체 콘텐츠 서비스의 공개 전환은 계속 별도 대기다.

**2026-09-26 홈 노출 편집:** [작품 CMS 추천·인기·신작 설정 및 저장](admin-home-curation.md). 작품별 체크박스·저장·되돌리기, 관리자 권한·버전 검사와 감사 기록을 추가했다. 운영 SQL 적용, 실제 DB 저장·충돌 검증 및 코드 `bb288bb`의 CI·Cloudflare 배포가 완료되었다. 이 작업 환경의 TLS 연결 오류로 배포 후 HTTP 저장·화면 확인은 대기이며, 확인 절차를 문서에 기록했다. 콘텐츠 공개 및 지급 기능 활성화와는 별도다.

**관리자 메뉴 후속: [CMS·정산 조회·서브관리자 권한 복구](admin-console-rollout.md).** 가상 계정만 보이던 기본 화면을 운영 대시보드와 11개 업무 메뉴로 구성했다. 실제 등록 데이터 조회와 재인증을 통한 기존 서브관리자 권한 변경을 별도 계정 서비스에 연결했다. 코드 `daf418c`의 CI·운영 배포를 확인했고 실제 관리자 조회 10개가 200 응답했다. [운영 검증](../../artifacts/admin-console-production.json). 정산 승인·지급과 전체 콘텐츠 조치 활성화는 별도 범위다.

**계정 후속 적용: [가상 계정 인증·관리](virtual-accounts-rollout.md).** 사용자 요청으로 가상 작가 30·독자 10과 직접 생성한 최고 관리자 1을 Auth에 연결했다. 계정 로그인·관리와 콘텐츠 서비스 활성화를 구분한다. 아래 503 기록은 콘텐츠 전환에 해당한다.

계정 기능 코드 `805a7a2`의 CI·Cloudflare 배포 성공. 운영 사이트에서 40개 계정 로그인과 관리자 조회·프로필 저장·이력 조회를 실제 API로 확인했다. 관리자 로그인 후 **가상 계정** 메뉴에서 수정·정지·삭제·복구할 수 있다.

**최신: [503 복구 실행 기록·남은 절차](503-recovery-plan.md).** 작품 소유자 누락 20건과 기존 원고 102건을 운영에서 정합화했다. 빈 본문 78건은 사용자 선택에 따라 보존·검토 대기다. Auth 연결 41건과 계정 서비스 준비를 완료했고 적용 후 82개 테이블을 백업했다. 콘텐츠 API는 호스팅 복원·남은 마이그레이션이 미완료여서 `503 SECURE_API_NOT_ACTIVATED`를 유지한다.

**지금 필요한 작업은 [503 복구 절차](503-recovery-plan.md)를 따른다.** 남은 본문/계정 검토표 위치, 백업·격리 복원, 초기 계정 연결과 사용자가 직접 변경할 Cloudflare 설정을 정리했다. `npm run audit:launch`로 남은 전환 조건을 재확인할 수 있다. [토큰 갱신 당시 기록](token-renewal-followup.md)은 이전 기준선이다.

코드 커밋 `2eea8ee`는 `main` push와 GitHub Actions·Cloudflare Pages 배포가 성공했다. 운영 URL에서 새 JS가 커밋 소스와 일치하고 점검 안내가 포함됨을 HTTP로 확인했다. [실제 배포 확인 결과](../../artifacts/production-deployment-verification.json). 공개 오픈 판정은 여전히 NO GO다.

- **[실제 서비스 활성화 절차](production-activation.md)**: 401 토큰 교체 위치, 재검증 명령, SQL 적용 순서·전제, Pages 환경변수·Cron·Auth 설정, 실패 시 담당자가 해야 할 일을 정리했다.
- [접근 진단 결과](../../artifacts/launch-access-diagnostic.json), [남은 오픈 이슈](open-issues-after-stage13.md), [출시 기록](release-record.md).
- 이번 수정: 관리 PAT/프로젝트 API 키와 401/403/네트워크 오류를 구분하는 진단, Pages의 `npm run build`에 전체 출시 검증 포함, 비무료·성인·예약 메타데이터 필터, 본문 조회의 구 DB/RPC 우회 제거, 서버 미활성 안내와 정적 파일 재검증 캐시 정책.
- `npm run diagnose:launch`로 접근 상태를 확인한다. 관리 토큰은 `.env.local`에서 교체하며 Git에 넣지 않는다. `npm run release:status -- <40자리 SHA>`로 해당 커밋의 CI/배포 상태를 확인한다.

아래 단계별 내용은 각 단계 당시 기록이다. 로컬 테스트 통과를 실제 SQL 적용·브라우저 인수 완료로 해석하지 않는다.

후속 개발 공통 규칙: [Author / Creator 명칭·호환 계약](author-creator-contract.md), [프로젝트 지침](../../AGENTS.md). 6단계 착수 전에 확인한다.

작성일: 2026-09-23. [전체 로드맵](../../improve.md) · [1단계 실행 기록](../../improve1.md)

| 문서 | 내용 |
|---|---|
| [기능·호출 목록](function-inventory.md) | 관리자 15개 메뉴, 메뉴 외 경로, 작가 7개 탭, 독자 공통 기능·API·테이블/RPC |
| [권한 행렬](permission-matrix.md) | 익명·독자·작가·제한/최고 관리자, 원고 열람/수정/제재 분리와 권한 이름 이관 |
| [삭제·이관 대장](removal-and-migration.md) | 삭제 단위 D01~D18, 실제 호출자·대체 기능·단계·검증, 옛 문서 참조 처리 |
| [기준선](baseline.md) | 소스/과거 기록/이번 원격 확인 구분, 데이터 수, 보안 위험과 적용 제한 |
| [인수 시나리오](acceptance-scenarios.md) | 가입·원고·파일·게시·예약·권한·운영 검증 ID와 기대 결과 |
| [의존성](dependencies.md) | 관리 접근·Auth·백업·메일·예약·배포 등 후속 조건 |
| [정적 조사 JSON](static-inventory.json) | 원문 위치와 함수 호출·소스 해시; 오프라인 재생성 가능 |
| [정합성 검사 결과](step1-verification.json) | 메뉴/탭 대응·해시·링크·ID 검사 통과, 서비스 인수 테스트와 별개 |
| [원격 요약 JSON](step1-remote-summary.json) | HEAD 상태/집계만 기록, 민감한 행 값 없음 |

1단계는 명세·기준선 확정 단계다. 서비스 코드는 변경하지 않았다. 관리 API 401과 민감 열 선택 수용 위험이 남아 있어 운영 보안이나 서비스 오픈 완료를 뜻하지 않는다. 다음은 2단계 데이터 모델·계정 이관·백업 준비이며, 운영 적용 전 의존성을 해소해야 한다.

## 2단계 — 로컬 구현·검증 완료 / 실환경 확인 대기

- [데이터 계약](data-contract.md), [마이그레이션·백업 절차](migration-runbook.md), [백업 양식](backup-manifest.example.json).
- [증분 SQL 목록](../../database/authoring/README.md), [테스트 결과](../../artifacts/step2-schema-verification.json), [2단계 진행 기록](../../improve2.md).
- 원격 관리 요청은 여전히 HTTP 401이다. 실제 DB/Storage 적용·복원·Auth 이관을 완료했다고 판단하지 않는다.

## 3단계 — 로컬 구현·검증 완료 / 실제 메일·DB 통합 대기

- [인증·가입 계약 및 실행 기록](auth-contract.md), [3단계 진행 기록](../../improve3.md).
- [검증 결과](../../artifacts/step3-auth-verification.json). 실제 DB 적용·SMTP/메일·브라우저 인수 시험은 수행하지 않았다.

## 4단계 — 작가 작품 관리 로컬 구현·검증

- [작품 관리 계약](creator-works-contract.md), [4단계 진행 기록](../../improve4.md), [검증 증거](../../artifacts/step4-creator-works-verification.json).
- 실제 DB/브라우저 통합 검증과 운영 활성화는 대기다.

## 5단계 — 원고 자동저장·복구 로컬 구현·검증

- [원고 저장·복구 계약](creator-drafts-contract.md), [5단계 기록](../../improve5.md), [검증 증거](../../artifacts/step5-draft-verification.json).
- 실제 DB·브라우저/기기 인수 및 7단계 발행 보관 연결은 대기다.

## 6단계 — 파일 가져오기·표지·내보내기 로컬 구현·검증

- [파일 기능 계약](creator-files-contract.md), [6단계 기록](../../improve6.md), [검증 증거](../../artifacts/step6-file-verification.json).
- 실제 DB·private Storage·서명 URL 만료·Cloudflare Images·브라우저 인수는 대기다. 파일 기능 플래그는 비활성으로 유지한다.

## 7단계 — 미리보기·게시·예약 로컬 구현·검증

- [게시·예약 계약](creator-publication-contract.md), [7단계 기록](../../improve7.md), [검증 증거](../../artifacts/step7-publication-verification.json).
- 실제 Supabase 008 적용·Cloudflare Cron 배포·브라우저/기기·운영 알림 인수는 대기다. 게시 플래그는 비활성으로 유지한다.

## 8단계 — 작가 운영·독자 연결 로컬 개발

- [작가 운영·독자 연결 계약](creator-reader-operations-contract.md), [8단계 기록](../../improve8.md), [009 SQL](../../database/authoring/009_creator_reader_operations.sql), [검증 증거](../../artifacts/step8-operations-verification.json).
- 실제 Supabase 적용·브라우저/다른 기기/다른 계정 인수와 구형 독자 활동 이관은 대기다. 새 기능 플래그는 비활성으로 유지한다.

## 9단계 — 관리자 운영 통합 로컬 개발

- [관리자 운영 계약](admin-operations-contract.md), [9단계 기록](../../improve9.md), [010 SQL](../../database/authoring/010_admin_operations.sql), [검증 증거](../../artifacts/step9-admin-verification.json).
- 작가 대행 생성·본문 수정 경로는 제거했고, 새 운영 API·화면은 기본 비활성이다. 실제 DB 적용, 4~8단계 선행 실환경 인수, 관리자 계정별 권한·신고 처리, 브라우저 인수와 구 경로 폐쇄는 대기다.

## 10단계 — 전환 감사 진행 중

- [전환 감사·잔여 경로](stage10-cutover-audit.md), [10단계 기록](../../improve10.md), [011 SQL](../../database/authoring/011_reader_profile_cutover.sql), [검증 요약](../../artifacts/step10-cutover-verification.json).
- 구 v2 수정 경로 일부와 독자 프로필 직접 DB 수정을 닫고 합성 DB에서 P0 잠금을 검증했다. 실제 DDL/Storage 감사와 스테이징 전환 리허설이 남아 있어 단계 완료나 운영 적용으로 해석하지 않는다.

## 11단계 — 로컬 품질 게이트 구축 / 출시 보류

- [인수 검증 결과](acceptance-results.md), [운영·복구 절차](operations-runbook.md), [출시 게이트](release-checklist.md), [11단계 기록](../../improve11.md), [로컬 검증 요약](../../artifacts/step11-quality-verification.json).
- `npm test`를 삭제 동작 없는 mock/격리 PGlite 회귀 묶음으로 바꾸고, CI 필수 실패 무시를 제거했다. Cloudflare Functions 소스 번들, 일부 저장형 XSS와 긴 원고 Diff를 로컬 검증했다.
- 10단계 실환경 전환, 실제 브라우저·Storage·Cloudflare·백업·알림·정책 검토는 대기다. 이 단계와 서비스 출시는 완료로 판정하지 않는다.

## 12단계 — 출시 판정 NO GO / 배포 미실행

- [출시 기록](release-record.md), [제한 베타 관찰표](beta-observation-sheet.md), [12단계 진행 기록](../../improve12.md), [읽기 전용 검증 요약](../../artifacts/step12-release-verification.json).
- 운영 주소의 HTTP 상태만 읽기 확인했다. 실제 기능 플래그·데이터 보호·베타 계정·PC/모바일·백업·지원 인수는 미확인이다. 자동 배포와 CI 간 차단 관계도 원격 확인이 필요하다.

## 13단계 — 수익화 별도 출시 준비 / 미활성

- [수익화·성인 출시 계약](monetization-contract.md), [운영 배포·공개 오픈 이슈](open-issues-after-stage13.md), [13단계 기록](../../improve13.md), [로컬 검증 요약](../../artifacts/step13-monetization-verification.json).
- 브라우저의 구형 광고 해금·후원·정산 쓰기 경로와 근거 없는 수익 표시를 닫았다. 운영 원장·실제 업체 연동, 실 DB 권한 감사와 10~12단계 게이트는 남아 있다. 운영 SQL/배포/공개 오픈은 실행하지 않았다.
