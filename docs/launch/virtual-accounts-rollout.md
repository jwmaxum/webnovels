# 가상 계정 인증과 관리자 관리

2026-09-25. 운영 프로젝트 `ghwabesnydktumeyejnm`.

## 적용 근거와 결과

사용자가 기존 가상 작가·독자에 지정한 공통 비밀번호로 Auth 계정을 생성·연결하도록 명시적으로 요청했다. 비밀번호는 실행 환경에만 전달하며 소스·문서·로그에 저장하지 않는다.

- 작가 `writer1@webnovels.com`~`writer30@webnovels.com`: 30개.
- 독자 `reader1@webnovels.com`~`reader10@webnovels.com`: 10개. 별도 Gmail 주소를 쓰는 `test1`은 제외했다.
- `jwmaxum@gmail.com`: 사용자가 직접 Auth 계정 생성을 확인했고, 이메일 확인이 완료된 UUID를 기존 활성 `SUPER_ADMIN` 프로필에 연결했다. 관리자 비밀번호·역할은 변경하지 않았다.
- 실제 Auth 인증 및 새 핸들러의 프로필 확인 40/40 성공. 토큰은 메모리에서만 사용하고 검증 세션만 종료했다. 배포된 서비스 검증은 별도 `virtual-account-login-production.json`으로 기록한다.

연결은 요청의 대상 목록, 생성 API의 UUID, 실제 Auth 이메일/확인/제한 상태, 백업의 전체 프로필 행 MD5를 대조한다. 트랜잭션에서 변경된 행·기존 연결·충돌을 거절한다. 근거는 비공개 `launch_recovery.account_links`에 보존한다. 후속 `authoring.identity_evidence` 이관에도 이 근거를 사용하며 자동 재연결하지 않는다.

증거: [계정 연결](../../artifacts/virtual-account-provisioning.json), [실제 Auth 통합 검증](../../artifacts/virtual-account-login-integration.json).

## SQL과 백업

1. 변경 전 백업: `scratch/launch/backups/2026-09-25T02-50-00-034Z/`.
2. Auth 준비: `scripts/provision_virtual_accounts.cjs`. 가상 대상만 생성/지정 비밀번호 적용 및 확인 처리. 메일을 발송하거나 전체 가입자의 이메일 확인 정책을 변경하지 않는다.
3. 생성 후·연결 전 백업: `scratch/launch/backups/2026-09-25T03-01-17-530Z/`, SHA-256 `47b8f2627802aa7dd1be7e623e625fc6ea26d80a7c50cadf50a6571076cfb035`.
4. `database/launch/004_virtual_accounts.sql`과 비공개 연결 SQL을 실제 적용했다. `scripts/prepare_virtual_account_links.mjs`는 실제 백업을 격리 PGlite로 복원해 41개 연결과 관리자 수정·삭제를 리허설한 뒤 `--apply`를 수행한다.
5. 기존 프로필 ID·작품 FK·원고·다른 Auth 사용자를 보존했다. 준비 스크립트를 새 목록으로 무조건 재실행하거나 이미 연결된 UUID를 덮어쓰지 않는다.

적용 후 데이터 백업은 `2026-09-25T03-11-58-508Z/`의 82개 테이블/1,278행이며, 격리 PGlite에서 전체 행과 public 제약조건 98개를 복원·대조했다. 네이티브 백업은 `native-2026-09-25T03-12-22-646Z/application-auth-storage.dump`(82개 TABLE DATA 항목, SHA-256 `20140776743837ef92b63fed5a7a02dc403c516c51bd9b6dc2a79fe98f7ec0c1`)다. 외부 파일·제공업체 설정·호스팅 Supabase 전체 복원은 별도 범위다.

## 계정 서비스 준비 조건

P0 콘텐츠 전환이 닫혀 있을 때 `/api/v2/me`는 계정 전용 경로를 사용한다. `launch_accounts_ready()`가 명시적 계정 활성화 기록과 브라우저의 민감 프로필 접근·변경 금지를 확인한다. 서버는 Supabase `/auth/v1/user`를 검증하고, 서비스 역할 전용 RPC가 현재 확인/정지/삭제/프로필 상태를 다시 판정한다.

- `/api/v2/accounts/health`: 계정 서비스 상태.
- `/api/v2/admin/virtual-accounts`: 최고 관리자만 가상 계정 조회·변경 가능.
- 서버 바인딩: `SUPABASE_URL` 또는 `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`. 공개 키를 서버 권한으로 사용할 수 없다.
- 중지: `ACCOUNT_API_DISABLED=true` 또는 DB 운영자가 `account_service.enabled=false`. 연결·원고·계정을 삭제하지 않는다.
- P0 콘텐츠 마커와 기존 기능 플래그는 변경하지 않는다. `/api/v2/health`의 콘텐츠 503과 계정 상태를 구분한다.
- 계정 전용 상태의 작가/독자는 로그인 완료 화면을 이용한다. 작품 편집·개인 서재·신규 가입은 아직 공개하지 않는다. 미완료 기능을 성공으로 표시하거나 브라우저 직접 DB 접근으로 대체하지 않는다.

## 관리자 사용법과 보존

관리자로 로그인 → **가상 계정**. 작가/독자 탭, 이메일·표시 이름 검색, 삭제 계정 목록을 제공한다.

| 기능 | 동작 |
|---|---|
| 수정 | 작가 필명/소개, 독자 별명. 변경 사유 필수. 로그인 이메일·Auth UUID·역할은 편집하지 않음 |
| 정지/해제 | 프로필 상태와 Supabase Auth ban 상태 동기화 |
| 삭제 | 논리 삭제 + 프로필 정지 + Auth ban. 작품·원고·회차·연결 기록 보존 |
| 복구 | 삭제 전 상태 복원. 원래 정지 상태였다면 정지 상태로 복구 |
| 변경 이력 | 최근 100개 변경과 사유. DB 감사·연결 행의 UPDATE/DELETE 금지 |

revision이 다른 동시 요청은 409로 거절한다. Auth ban 동기화 실패 시 추가 변경을 막고 **인증 상태 재동기화**로 재시도한다. 앱에서는 DB 상태로 즉시 접근을 차단한다. 자기 계정과 관리자에 연결된 계정은 조작할 수 없다. 화면은 `textContent`로 표시한다.

## 검증 및 남은 범위

`test:launch`에 가상 계정 DB/API 권한·삭제 보존·동기화 실패·revision·Origin 검증을 포함했다. 기존 Auth·명칭·P0·관리자 운영 테스트와 TypeScript를 함께 실행한다.

브라우저 인수는 실행하지 않았다. 실제 Supabase API, 로컬 핸들러, 격리 DB 검증을 구분한다. 전체 공개 오픈에는 여전히 78개 본문 확인, 콘텐츠 SQL 전환, 격리 Supabase 전체 복원, SMTP/redirect 설정 및 기능별 인수가 필요하다. 공통 비밀번호는 운영자가 요청한 가상 계정에만 적용했다.
