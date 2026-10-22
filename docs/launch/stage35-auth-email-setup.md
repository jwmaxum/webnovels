# 35단계 무료 베타 가입 메일 설정

2026-10-22 실제 설정의 읽기 전용 점검에서 custom SMTP와 Send Email hook이 없었고,
Site URL은 localhost, 추가 redirect 목록은 비어 있었다. 이메일 확인은 필수였으며
기본 발송 한도는 시간당 2건이었다. 이 기록은 메일 발송·수신 검증이 아니다.

[Supabase SMTP 공식 문서](https://supabase.com/docs/guides/auth/auth-smtp)에 따르면 기본 발송기는
프로젝트 팀에 속한 주소로만 메일을 보낸다. 일반 베타 사용자의 가입 확인·비밀번호 복구를
운영하려면 별도 SMTP 또는 검토된 Send Email hook이 필요하다. 이메일 확인을 끄거나
관리자가 확인되지 않은 주소를 확인 완료로 바꾸어 우회하지 않는다.

## 설정 도구

저장소 루트에서 `node scripts/configure_stage35_auth.mjs`를 실행하면 읽기 전용으로 설정을
조회한다. `--apply`를 붙인 경우에만 아래 범위의 PATCH를 실행한다.

- Site URL을 `https://webnovels-db4.pages.dev`로 설정한다.
- 기존 redirect 항목을 보존하면서 앱의 가입 확인 `/?auth=confirm`, 비밀번호 복구
  `/?auth=recovery`를 추가한다. Supabase allowlist는 glob 문법이므로 query 구분자 `?`를
  `\?`로 이스케이프하여 저장한다. 새 호스트·경로 wildcard는 추가하지 않는다.
- 이메일 자동 확인은 `false`로 유지한다. 회원가입 사용 여부, 메일 공급자 사용 여부,
  기존 email template, 다른 인증 제공자 설정은 바꾸지 않는다.
- 다음 SMTP 값 6개를 **모두** 제공한 경우에만 SMTP 설정을 함께 반영한다.
  일부만 있거나 잘못된 값이 있으면 수정 전에 중단한다. 활성 Send Email hook이 있으면
  SMTP 전환을 별도로 검토하도록 중단하고 기존 hook을 임의로 끄지 않는다.
- SMTP를 처음 추가하며 기존 SMTP 호스트가 없고 발송 한도가 기본값인 시간당 2건인
  경우에만 `rate_limit_email_sent=30`으로 설정한다. 이는
  [공식 custom SMTP 안내](https://supabase.com/docs/guides/auth/auth-smtp)의 초기 한도에 맞춘다.
  이미 SMTP를 쓰고 있거나 관리자가 다른 한도를 설정한 경우에는 그대로 보존한다.
  SMTP를 설정하지 않고 redirect만 수정하는 실행에서는 한도를 변경하지 않는다.

| 비밀을 출력하지 않고 `.env.local`에 입력할 키 | 용도 |
|---|---|
| `BETA_SMTP_HOST` | SMTP 서버 호스트 이름 |
| `BETA_SMTP_PORT` | 제공자가 안내한 포트 번호 |
| `BETA_SMTP_USER` | SMTP 인증 사용자 |
| `BETA_SMTP_PASS` | SMTP 비밀번호 또는 API 키 |
| `BETA_SMTP_ADMIN_EMAIL` | 제공자에서 발신 권한을 확인한 이메일 |
| `BETA_SMTP_SENDER_NAME` | 수신자에게 표시할 발신자 이름 |

SMTP 값이 없을 때도 `--apply`로 Site URL과 redirect를 먼저 고칠 수 있다.
이때 결과의 `smtpReady`와 `emailConfigReady`는 거짓으로 남는다. 사용 중인 SMTP 비밀을
지우거나 빈 값으로 덮어쓰지 않는다. 비밀값은 채팅·커밋·배포 공개 변수에 넣지 않는다.

실제 수정 전 원본 Auth 설정을 Git 제외 경로 `scratch/launch/backups/auth-*/config.json`에
백업한다. 이 파일은 SMTP 및 다른 인증 제공자의 비밀을 포함할 수 있으므로 비공개로
보관해야 한다. 도구는 저장 경로의 심볼릭 링크와 Git 제외 여부를 확인한다. 기존 설정의
수정 대상 필드를 다시 조회하여 중간 변경을 감지하고, PATCH 후 다시 읽어 반영을 확인한다.
원격 API가 원자적 조건부 변경을 제공하지 않으므로 실행 중 대시보드의 동일 설정을 함께
편집하지 않는다. 실패 시 자동으로 오래된 설정을 덮어쓰는 rollback을 하지 않는다.

## 결과 해석

`artifacts/stage35-auth-config.json`에는 비밀 없는 상태·검증 시각만 저장한다.
`applied=true`는 PATCH 성공, `configurationVerified=true`는 설정 재조회 일치를 뜻한다.
`smtpReady=true`는 SMTP 설정 항목이 저장되어 있음을 의미하며 실제 자격증명·수신 성공은
입증하지 않는다. 모든 실행에서 `deliveryVerified=false`로 기록하며 이 도구는 메일을
전송하지 않는다. `emailConfigReady`는 SMTP·공개 redirect·이메일 확인·가입 허용·이메일
공급자 설정을 모두 확인한 설정 준비 상태다.
`emailRateLimit`는 재조회한 발송 한도이며 SMTP 사용자·비밀번호·발신 주소는 결과에 포함하지 않는다.

실제 베타 초대 전에는 승인된 시험 주소로 가입 확인·비밀번호 복구·스팸함 도달과 모바일
복귀를 인수한다. SMTP 발신 주소 및 도메인 인증, 발송 한도는 제공자 설정에서 확인한다.
프로젝트 규칙에 따라 브라우저 검증은 명시적으로 요청받은 뒤 수행한다.

근거: [redirect URL 문법](https://supabase.com/docs/guides/auth/redirect-urls),
[Auth 설정 Management API](https://supabase.com/docs/reference/api/v1-update-auth-service-config),
[Supabase Auth URL 검사 구현](https://github.com/supabase/auth/blob/master/internal/utilities/request.go).

로컬 검증: `node --test scripts/verify_stage35_auth_config.test.mjs`. 합성 설정으로 부분 SMTP
거절·비밀 오류 제거·원본 보존·기본 읽기 전용·중간 변경 거절·PATCH 실패 상태 보존을 확인한다.
