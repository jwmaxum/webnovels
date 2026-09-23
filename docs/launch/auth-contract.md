# 3단계 인증·가입 계약 및 실행 기록

2026-09-23. **로컬 구현·검증 완료, 실환경 통합 검증 대기**. 2단계의 실제 스키마·백업·Auth 매핑 확인은 여전히 선행 조건이다. 운영 DB 적용, 배포, 실제 이메일 전송은 수행하지 않았다.

## 사용자 흐름

1. 이메일·비밀번호·필명(작가)/별명(독자)으로 가입한다. 최초 가입에서 주소·생년월일·계좌·작품명·전화번호를 수집하지 않는다. 표시 이름은 로그인 ID가 아니며 중복을 허용한다.
2. Supabase Auth 확인 메일을 연다. 프로필은 이메일 확인 전 생성하지 않는다. 메일 확인 후 같은 이메일로 로그인하고 `가입 마무리`에서 유형과 이름을 입력한다. 다른 기기에서도 가능하며 비밀번호·가입 신청 개인정보를 별도 localStorage에 저장하지 않는다.
3. `/api/v2/onboarding`이 검증된 Auth UUID로 프로필을 생성한다. Auth 생성 후 네트워크 단절이 발생해도 **다시 가입하지 않고 로그인 → 가입 마무리**로 재개한다. 같은 유형의 프로필 재요청은 기존 프로필을 반환하며 이름/상태를 덮어쓰지 않는다.
4. 작가 상태는 신규 셀프서비스 계정에 한해 `APPROVED`로 생성한다. 기존 정지·거절·탈퇴 상태는 변경하지 않는다. 관리자 프로필은 이 경로로 만들 수 없다.
5. 로그인 창의 비밀번호 재설정으로 메일을 보낸다. SDK `PASSWORD_RECOVERY` 이벤트로 새 비밀번호 화면을 열고, 변경 후 로그아웃한다. URL의 `auth=recovery` 문자열 자체는 변경 권한으로 인정하지 않는다.

기존 계정의 이메일과 같아도 자동 병합하지 않는다. 충돌 시 409로 중단한다. [계정 연결 SQL](../../database/authoring/003_verified_identity_link.sql)의 증거 검증 절차로 기존 ID와 작품 참조를 보존한다. 최초 최고관리자는 DBA가 본인 확인 후 Auth UUID를 연결하고 근거를 기록한다. 이메일 일치·클라이언트 역할·사용자 metadata로 관리자 권한을 만들지 않는다. 기존 암호를 Auth로 복사하지 않으며 본인 메일 재설정을 이용한다.

## 세션과 API

- `public/js/core/auth-session.js`가 단일 Supabase SDK 세션을 사용한다. access/refresh token을 기존 `webnovels_token` 키에 복제하지 않는다. 자동 갱신은 SDK에 맡긴다.
- 화면 역할은 서버 `/me` 결과로만 복원한다. 기존 localStorage 사용자/역할/가짜 토큰을 복원하지 않는다. `webnovels_user`는 미전환 화면 표시용 캐시이며 권한 증거가 아니다.
- `/me`와 변경 API는 매 요청 Auth 사용자·이메일 확인·현재 프로필 상태를 검사한다. 기존 소유권/허용 필드 검사를 유지한다. 다른 작가 ID, role, author_id, 정산 필드를 보내도 권한이 생기지 않는다.
- `Authorization: Bearer` 사용, 브라우저 API 요청은 `credentials: omit`. 인증 쿠키를 쓰지 않는다. 가입 완료는 정확한 same-origin Origin 필수, 다른 변경 API도 외부 Origin 거절. 외부 Origin 허용 CORS 헤더를 발급하지 않는다.
- 모든 v2 응답은 `X-Request-ID`, 오류 본문은 `{error, requestId}`를 제공한다. 비밀번호·토큰·Auth 원문·DB 원문을 로그/오류에 반영하지 않는다.
- 400 입력/필드 오류, 401 세션 없음/만료, 403 권한/이메일 미확인/계정 제한, 409 충돌, 429 횟수 제한, 503 Auth/DB/설정 미준비. 503을 잘못된 비밀번호나 로그인 성공으로 바꾸지 않는다.
- 401에 한해 한 번 refresh 후 재요청한다. 네트워크 단절·503·409 및 결과 불명의 쓰기는 자동 재전송하지 않는다. 가입 완료는 사용자가 같은 요청을 다시 보내도 DB에서 멱등 처리한다. 429에는 `Retry-After: 60`.
- 가입 완료는 DB 원자 카운터로 **사용자당 60초에 5회** 제한한다. 카운터 호출을 별도 트랜잭션으로 커밋하므로 이후 프로필 생성 실패에도 횟수가 유지된다. Auth 이메일 발송/로그인 남용 방지는 Supabase Auth rate limit 설정을 별도로 검증한다. 이 카운터는 전체 트래픽/IP 제한을 대신하지 않는다.

## SQL 및 적용 게이트

[004_auth_onboarding.sql](../../database/authoring/004_auth_onboarding.sql)은 003 뒤에 수동 검토하여 적용한다. `webnovels.authoring_apply_verified=true` 없이 적용되지 않는다. 알려진 `on_auth_user_created` 트리거를 제거하고 확인 후 생성 경로로 전환한다. **실제 트리거 정의·다른 Auth 트리거·상태 enum·필수 열·ID 기본값을 먼저 대조**해야 한다. 예상하지 않은 필수 열/상태는 임의 보정하지 않고 실패한다.

RPC 세 개(`authoring_signup_ready`, `consume_authoring_signup_attempt`, `complete_authoring_signup`)만 public schema에 있으며 PUBLIC/anon/authenticated 실행은 금지하고 service_role에만 허용한다. DEFINER 함수는 빈 search_path, 고정 테이블 이름/파라미터 바인딩을 사용한다. 서버에서 검증한 사용자 ID로만 호출한다. 프로필 생성 함수는 DB의 Auth 확인 상태도 다시 검사하고 사용자 행 잠금으로 같은 계정 재시도를 직렬화한다.

SERIAL/BIGINT ID는 기존 sequence/identity 기본값을 사용하고 UUID 독자 ID는 Auth UUID를 사용한다. 기존 NOT NULL password_hash가 있다면 로그인에 사용할 수 없는 무작위 표식을 넣는다. 실제 비밀번호는 Supabase Auth에만 전달한다.

`P0_API_ENABLED=true`와 기존 P0 `locked` 상태가 먼저 필요하며, 가입은 추가로 `AUTH_ONBOARDING_ENABLED=true`가 필요하다. `/api/v2/auth/readiness`가 004 적용을 확인하기 전 UI는 Auth 가입을 시작하지 않는다. 운영에서는 **10단계 전환 리허설 전 P0 잠금을 조기에 적용하지 않는다**. 격리 환경에서 검증된 매핑/보안 전환 상태로 통합 시험한다.

복구 시 `AUTH_ONBOARDING_ENABLED=false`로 신규 가입 UI/API 경로를 닫는다. Supabase Auth의 직접 signUp까지 중단해야 하는 운영 상황에서는 provider 가입 설정도 별도로 제한한다. 생성된 Auth 계정·기존 프로필·증거를 삭제하지 않는다. RPC 제거/구버전 복귀는 가입 데이터 보존과 Auth 트리거 영향 검토 후 수행한다. 구형 비밀번호 로그인은 재활성화하지 않는다.

## 10단계까지 남은 폐쇄 목록

| 잔여 경로 | 현재 상태 및 후속 작업 |
|---|---|
| `supabase-admin.js`의 직접 works/episodes/readers/설정/권한 CRUD | 공통 Auth 적용만으로 안전해지지 않는다. 4~9단계 대체 구현 후 10단계 API/RLS 전환. 운영 활성화 금지 |
| 독자 활동·프로필·포인트·성인 플래그 직접 쓰기 | 새 인증에서 불러오지 않음. 8·10·13단계 서버 검증 이전 사용 권한 근거로 인정하지 않음 |
| `reader.js` 등의 기존 webnovels_token 소비부 | 신규 토큰을 공급하지 않음. 10단계 공통 API 클라이언트로 전체 전환 필요 |
| 관리자 서브계정/권한 편집 | 생성·독자 비밀번호 변경·구형 독자 가입은 명시적 실패로 폐쇄. 관리자 역할 변경/조회 API는 후속 전환 필요 |
| Express `/api/auth/*` 및 과거 SQL 로그인 RPC | Cloudflare 레거시 catchall은 503 유지. 별도 Express 운영 배포 금지. 10단계 배포 경로/DB 실행 권한 점검 |
| 관리자 CONTENT_WRITE 콘텐츠 수정 | 기존 v2 계약 유지. 8·9단계에서 사건 기반 열람/제재 역할로 분리 |

현재 브라우저 로그인은 테이블 비밀번호 비교·verify_admin_login·가짜 token 발급·기본 최고관리자 대체를 사용하지 않는다. 기존 운영의 익명 열 노출 위험(SEC-R01)은 별도 RLS 검증까지 해소된 것으로 기록하지 않는다.

## 검증 결과와 남은 확인

- `node scripts/verify_secure_api.test.mjs`: 25개 통과. 역할/소유권/상태, 위조 토큰·필드, 가입 게이트·Origin·횟수 제한, 오류/request ID. HTTP 공급자는 mock.
- `npm run test:auth`: 세션 VM 7개 + 합성 PostgreSQL 4개. 재시도·이메일/상태·기존 계정 충돌·UUID 독자·RPC 권한·횟수 제한·갱신·늦은 응답·비밀번호 변경 연결.
- 기존 데이터 계약, Cloudflare 4개, provider 7개, authoring schema 22개, TypeScript 및 수정 JS 구문 검사 통과.
- CI에 `test:auth` 추가. [검증 기록](../../artifacts/step3-auth-verification.json).
- 미실행: localhost/브라우저(프로젝트 규칙), 실제 메일 송수신/링크 재사용/다른 기기, 실제 Supabase 스키마 적용·병렬 네트워크 경쟁·기존 계정 연결·Auth provider 장애·운영 배포.
- 외부 완료 조건: 2단계 스키마/백업/관리 접근, 메일 SMTP·이메일 확인 활성화, 운영/스테이징 redirect allowlist(`/?auth=confirm`, `/?auth=recovery`), Auth 발송/로그인 제한, 실제 스테이징 가입→확인→재로그인→재설정 검증. **4단계 코드 준비는 가능하나 통합 완료/오픈 판정은 대기**.

참고: [Supabase 인증 이벤트](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [Pages 지원 바인딩](https://developers.cloudflare.com/pages/functions/bindings/). Pages 배포에 없는 rate-limit 바인딩을 가정하지 않도록 DB 카운터를 사용했다.
