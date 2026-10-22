# 35단계 무료 베타 운영 기록

2026-10-22. 사용자는 Toss·PASS 미계약이며, 관리자를 제외한 현재 자료가 모두 테스트 데이터라고 확인했다.
이에 무료 웹소설·웹툰을 먼저 운영하는 방향으로 35단계를 변경한다.

**현재 실제 무료 베타 공개는 활성화하지 않았다.** 테스트 데이터 초기화, DB 준비 마이그레이션,
Auth 공개 주소 변경과 Cloudflare 이미지 Worker·Cron·Pages 연결 설정은 적용했다. SMTP는 사용자 요청으로 추후 준비하고,
Pages 재배포는 후속 조회에서 성공을 확인했으며 실제 기능 인수가 남아 있다. PASS·PG 계약 없이 무료 베타를 운영할 수 있도록
구현했지만 이메일 확인과 서버·Storage 준비를 생략한 공개를 의미하지 않는다.

## 구현한 제공 범위

- 이메일 확인과 저작권 동의를 거친 작가 가입, 독자 가입. 별도 이메일 ID·필명별 계정과 작품 소유권 분리.
- PASS 증빙이 없는 계정은 본인확인 미완료. 가짜 실명·동일인 연결을 만들지 않으며 PASS 개인정보 동의를 받지 않는다.
- 한 작가의 웹소설·웹툰 등록, 원고 저장·Word 서식·순차 이미지 업로드, 최초 직접 발행·예약 발행.
- 공개된 작품의 수정·삭제는 관리자 검토. 독자 탐색·본문·댓글·선호작은 기존 서버 계약을 사용한다.
- 결제·유료 후원·성인 인증·정산·은행계좌 입력은 베타에서 닫는다.
- 관리자 설정의 Toss/PASS 키는 암호화하여 저장하고 키 원문을 다시 반환하지 않는다.
  저장만으로 서비스를 켜지 않는다. Cloudflare 서버 암호화 키는 설정했으며 Pages 재배포 후 운영 저장 인수가 남아 있다.
  [설정 안내](stage35-provider-settings.md)를 따른다.

위 목록은 코드의 제공 범위다. 실제 공개 가입·이미지 처리·예약 발행 인수를 완료했다는 의미는 아니다.

## 실제 적용 결과

2026-10-22 운영 Supabase 및 Cloudflare 점검 기준이다. 산출물에는 비밀키와 원본 개인정보를 포함하지 않는다.

| 항목 | 확인된 결과 | 근거 |
| --- | --- | --- |
| 원본 백업 | 117개 테이블의 논리 백업과 PostgreSQL custom 아카이브 확보. 네이티브 아카이브의 117개 데이터 항목을 읽을 수 있음 | [논리 백업](../../artifacts/stage35-data-backup.json), [네이티브 백업](../../artifacts/stage35-native-backup.json) |
| 로컬 복원 | 실제 원본 117개 테이블·1,639개 행을 PGlite에 복원하여 일치 확인 | [복원 검증](../../artifacts/stage35-data-restore.json) |
| 테스트 자료 초기화 | 명시한 68개 테이블 정리 및 준비 마이그레이션 적용. 관리자 프로필 4개 보존 | [준비·적용](../../artifacts/stage35-preparation.json) |
| 테스트 Auth 정리 | 삭제 후보 41개 모두 삭제, 연결된 관리자 Auth 1개 보존 | [Auth 정리](../../artifacts/stage35-auth-cleanup.json) |
| 적용 후 DB 상태 | 관리자 행 변경 없음. 작가·독자·작품·회차·원고·베타 계정 0개, 비공개 Storage 버킷 3개 | [DB 인수](../../artifacts/stage35-db-acceptance.json) |
| DB 준비 판정 | `launch_accounts_ready`, `launch_author_workspace_ready`, `launch_work_registration_ready`, `free_beta_enrollment_launch_ready`는 `true`. `new_serials_ready`와 공개 활성화는 `false` | [DB 인수](../../artifacts/stage35-db-acceptance.json) |
| Auth 공개 주소 | 사이트 주소와 이메일 확인·비밀번호 복구 redirect 2개 적용 및 재조회 확인. 이메일 확인 필수 유지 | [Auth 설정](../../artifacts/stage35-auth-config.json) |
| SMTP·메일 수신 | `smtpReady=false`, `emailConfigReady=false`, `deliveryVerified=false`. SMTP 입력 없이 주소만 적용 | [Auth 설정](../../artifacts/stage35-auth-config.json) |
| Cloudflare 인프라 | 새 토큰으로 실제 접근·적용 성공. 비공개 이미지 Worker·예약 Worker 업로드, 매분 Cron, Pages Service binding, 관리자 설정 암호화 master key·공유 비밀값 설정 및 재조회 완료 | [Cloudflare 적용](../../artifacts/stage35-cloudflare.json) |
| Cloudflare 노출·설정 보존 | Workers.dev·preview 공개 접근 차단. 기존 Pages preview 설정과 무관한 변수 보존 재조회 통과 | [Cloudflare 적용 절차](stage35-image-processing.md) 및 실제 적용 재조회 |
| Cloudflare 공개 전환 | `applied=true`, `activated=false`. 산출물 작성 시 재배포가 필요했으나 36단계 시작 시 `5f5e934`의 Pages production 성공 확인. 실제 기능 인수는 미완료 | [Cloudflare 적용](../../artifacts/stage35-cloudflare.json), [후속 조회](stage36-operations-runbook.md) |

관리자 프로필 4개와 관리자 Auth 1개는 서로 다른 수치다. 기존 관리자 행을 보존했다는 사실을
4개의 로그인 계정이나 새 관리자 매핑 생성으로 해석하지 않는다.
준비 산출물의 `authDeletionPending: 41`은 Auth 삭제 **전** 기록이며, 이후 Auth 정리 산출물에서 삭제 완료를 확인했다.

Cloudflare의 기존 Pages·Workers 조회 401(`10000`) 및 토큰 정책 조회 403은 이전 접근 시도의 기록이다.
새 토큰으로 접근 문제를 해결하고 2026-10-22 04:36:15 UTC에 인프라 적용 재조회를 완료했다.
산출물 `workersBefore.*.exists=false`는 생성 전 조사 결과이며, `workers`의 재조회·`steps`의 업로드·설정 완료와 `applied=true`가 적용 결과다.
기존 커밋 `6b8db3f`의 CI·Pages production 배포 성공과 이번 인프라 설정을 반영할 후속 재배포는 별개다.

## 테스트 데이터 정리

`scripts/prepare_stage35.mjs --apply-reset`을 실제 적용했다. 도구는 실제 원본 snapshot을 로컬 PGlite에 복원하여
관리자 보존, 무료 가입, 두 유형 등록, 최초 소설 발행과 독자 본문을 확인하고 논리 백업과 네이티브 pg_dump
아카이브의 해시·대상·최신성을 검사했다. 68개 콘텐츠 테이블을 명시한 `TRUNCATE ... RESTRICT`로 정리했으며
CASCADE와 ID 재사용을 하지 않았다. 관리자 프로필·연결된 Auth·권한 이력과 DB 구조·정책·동의 문서는 보존했다.
테스트 Auth 계정은 별도 관리 API로 관리자 제외를 재검증한 뒤 정리했다.
백업·토큰·개인정보는 `scratch/`에만 저장하고 Git에 포함하지 않는다.

로컬 행 복원과 네이티브 아카이브 읽기 검증은 별도 Supabase 환경에서의 전체 복원을 대신하지 않는다.
플랫폼 설정·클러스터 권한·Storage 파일·외부 자산의 복원과 외부 백업 사본 검증은 별도 인수 항목이다.
원본 행 복원 산출물과 준비 마이그레이션을 실행한 로컬 리허설도 구분한다.

## 공개 전 남은 조건

1. Cloudflare production 재배포 성공은 36단계 시작 시 확인했다. Service binding·서버 설정의 실제 기능 동작 인수를 이어간다.
   [이미지 Worker](stage35-image-processing.md), 예약 발행 Cron, Pages Service binding과 서버 암호화 키 설정은 완료했다.
   `configure_stage35_cloudflare.mjs --apply`는 인프라 준비이며 공개 기능을 켜지 않았다.
2. 사용자 요청에 따라 추후 [SMTP 설정 절차](stage35-auth-email-setup.md)의 여섯 `BETA_SMTP_*` 입력을 준비한다.
   이미 적용한 공개 주소를 유지하면서 SMTP를 연결하고 실제 확인 메일 수신·가입·복구를 인수한다.
   현재 기본 Supabase 발송기의 제한을 일반 공개 베타 준비 완료로 간주하지 않는다.
   설정 도구는 메일을 발송하지 않으므로 `smtpReady=true`만으로 수신 성공을 주장하지 않는다.
3. DB 공개 연재 게이트와 서버 기능 플래그를 검토하여 일치시킨다. 현재 `new_serials_ready()`는 `false`다.
   Cloudflare `--activate`의 동일 프로젝트 SMTP·공개 주소 확인 및 실제 DB 준비 판정 조건을 충족해야 한다.
   설정값을 넣었다는 이유로 이메일 확인이나 준비 판정을 우회하지 않는다.
4. Pages 배포와 실제 API를 통해 이메일 확인 계정의 작가 가입, 웹소설·웹툰 등록, 이미지 업로드·표시,
   즉시·예약 발행, 공개 후 변경 검토를 인수한다. 결제·후원·정산·성인 인증은 계속 닫아둔다.

## 검증 범위와 한계

- 실제 운영 반영: 백업 확보, 테스트 DB 초기화·준비 마이그레이션, Auth 41개 삭제, 관리자 보존 재조회,
  공개 Auth 주소·redirect 적용 및 재조회, Cloudflare 비공개 Worker 2개 업로드·매분 Cron·Pages Service binding·서버 비밀값 설정 및 재조회.
- 로컬 검증: 실제 snapshot의 PGlite 복원·준비 리허설, 서버 대역·VM DOM 기반 기능 및 회귀 검증.
- 후속 확인: 36단계 시작 시 `5f5e934` GitHub CI 및 Cloudflare Pages production 재배포 성공.
- 미수행: 공개 신규 가입 완료, 실제 메일 수신,
  Cloudflare 이미지 디코딩·업로드·독자 표시, 실제 Cron을 통한 예약 원고 발행 인수,
  관리자 제공자 설정의 실제 저장 인수, PASS·PG 호출, 별도 Supabase 전체 복원 인수.
- 브라우저 및 localhost 검증은 수행하지 않았다. 로컬 대역·VM DOM 검증은 실제 사용자 인수를 대신하지 않는다.

전체 release 테스트 722개와 빌드, 별도 `tsc --noEmit`이 통과했다. 마지막 대시보드 수정 이후 관련
UI·DB/API·명칭 호환 14개, 설정 도구 12개, 라우터·권한·초기화 목록 6개 검증도 통과했다.
Cloudflare Pages 조회의 `per_page` 쿼리 제거 이후 설정 도구 회귀 검증 7개도 통과했다.
추가 실행은 전체 테스트와 중복되므로 합산한 고유 테스트 수로 해석하지 않는다.
[검증 결과](../../artifacts/stage35-verification.json)에 적용 범위와 미완료 조건을 기록했다.
이 문서의 DB 준비 완료를 전체 서비스 공개 완료로 해석하지 않는다.

## 후속 개발

우선 위 35단계의 운영 준비와 실제 인수를 완료한다.

36단계: 베타 가입·업로드·발행 실패 기록, 사용자 피드백, 신고·권리 분쟁·문의 운영,
계정 탈퇴와 동의/원고 보존 정책, 별도 환경에서 백업·이미지 복원 및 운영자 대응 인수.
37단계: 실제 이용 지표와 작가 통계, 조작 방지·승격 기준 검증.
38단계: PASS·PG 계약 이후 실기기 본인확인, 통신판매업 등 운영 정보, 결제·환불·원장·정산 인수.
Vercel은 사용하지 않는다. GitHub 연결에 남아 있던 자동 배포를 막기 위해 `vercel.json`의
`git.deploymentEnabled=false`를 설정했다. 이 설정은 기존 배포를 삭제하거나 수동 CLI 배포를 차단하지는 않는다.
설정 기준: [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).
