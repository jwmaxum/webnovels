# 35단계 외부 서비스 설정

결제·PASS 미계약 상태에서 무료 베타를 운영한다. `FREE_BETA_ENABLED=true`에서는 저장된 키와
다른 기능 플래그가 있더라도 Toss/PASS 실행 경로가 닫힌다. 실제 결제나 본인확인을 완료한 것으로 표시하지 않는다.

## 관리자가 사용할 메뉴

최고 관리자 → 서비스 운영 설정 → 외부 서비스 연결 준비에서 토스 카드결제 또는 PASS의
TEST/LIVE 환경을 골라 키를 입력한다. 현재 최고 관리자 비밀번호를 다시 확인한 뒤 저장한다.
빈 입력은 기존 값을 유지하며, 저장된 키를 다시 보여주지 않는다. 저장 항목과 입력 완료 여부만 표시한다.
환경별 삭제는 해당 환경의 키를 비우고 연결을 비활성화한다. 다른 관리자와 동시에 수정하면 최신 상태를 다시 읽어야 한다.

키 저장은 계약 확인이나 실제 연동 시험 성공을 의미하지 않는다. 무료 베타에서는 키가 없어도 가입·무료 연재를 제공한다.

## 서버 설치와 보관

- `database/authoring/025_provider_settings.sql`은 비공개 설정·감사·시도 제한 테이블을 생성한다.
  테이블의 RLS를 켜고 anon/authenticated/service_role 직접 권한을 모두 제거하며, service_role에만 RPC 실행을 부여한다.
- Cloudflare Secrets에 `PROVIDER_SETTINGS_MASTER_KEY` (무작위 32바이트의 64자리 16진수)를 설정한다.
  `PROVIDER_SETTINGS_KEY_VERSION`은 해당 키의 버전(예: `v1`)이다. 이 서버 키는 관리자 입력값을 암호화하는 용도다.
  DB, 브라우저 설정, Git, 로그에 넣지 않는다. 설정되지 않으면 상태 조회는 가능하고 키 쓰기는 거절된다.
- WebCrypto AES-256-GCM과 매 저장마다 새 12바이트 IV를 사용한다. 제공자·TEST/LIVE·키 버전을
  추가 인증 데이터에 포함한다. DB에는 암호문만 저장하며 감사에는 변경한 관리자·제공자·환경·버전·시각만 남긴다.
- 서버는 Supabase에서 검증한 활성 최고 관리자만 허용한다. POST Origin·입력 허용 목록·16KB 제한·
  분당 5회 DB 제한·현재 관리자 비밀번호 재확인·revision 검사를 적용한다. 재확인에 사용한 임시 로그인 세션은 종료한다.
- 암호화 키를 바꿀 때 기존 암호문을 새 키로 재암호화하는 운영 절차가 필요하다. 키/버전 불일치 시 자동 복호화·활성화하지 않는다.
  기존 키 복구가 불가능하면 재인증 후 해당 설정을 삭제하고 공급자 키를 다시 입력한다.

## 추후 계약 후 활성화

1. 관리자 메뉴에서 환경별 키를 입력한다. Toss는 clientKey, secretKey, MID를 받는다.
   PASS는 PortOne storeId/channelKey/apiSecret, DANAL 또는 INICIS_UNIFIED, CI/DI, HMAC 키와 버전을 받는다.
   INICIS_UNIFIED는 CI만 허용한다. 실명·CI/DI 원문을 설정으로 받거나 저장하지 않는다.
2. TEST 연동, 실패·취소·만료·중복 요청, 환불/정산(결제), 개인정보/동의 및 가입 복귀(PASS)를 인수한다.
3. 검증한 **정확한 provider/mode/revision**을 운영 담당자가 `review_ref`, `reviewed_revision`으로 기록하고
   해당 설정의 `enabled`를 켠다. 이 작업은 일반 관리 API가 제공하지 않으며, 사전 검증을 마친 DB 운영 변경이다.
   설정 저장·삭제 시 승인은 항상 해제된다.
4. 서버의 `PROVIDER_SETTINGS_SOURCE=database`와 해당 서비스의 기존 활성화 조건을 함께 설정한다.
   PASS는 `AUTHOR_IDENTITY_MODE`에 맞는 저장값을 읽고, 기존 `enrollment_settings`의 계약 채널·식별자·키 버전·
   동의 문서와 일치해야 한다. 인증 전용 키를 입력했다고 무료 베타 계정이 실명 인증 계정으로 바뀌지 않는다.
5. Toss의 기존 결제/원장 경로는 **TEST 전용**이다. 저장된 TEST 키와 MID를 실제 어댑터에 공급하지만,
   LIVE 키를 저장하거나 승인해도 LIVE 결제는 열리지 않는다. 운영 PG·환불·정산 단계에서 LIVE 원장 인수를 별도로 완료한다.

`provider_runtime_config`는 승인된 현재 revision의 암호문만 서버에 제공한다. 입력값 저장만으로
`enrollment_settings`나 결제 정책, 서비스 플래그를 바꾸지 않는다. 무료 베타 종료/유료 서비스 전환도 별도의 운영 결정이다.

## 검증 범위

`scripts/verify_stage35_providers.test.mjs`는 PGlite 합성 DB에서 실제 역할을 바꿔 직접 접근 거절·
RPC 허용, 관리자 자격/재인증, 암호화·변조·환경 바꿔치기, 저장/삭제/경쟁/빈 값 유지/빈도 제한을 검증한다.
검토된 암호화 설정이 기존 Toss TEST 및 PASS 어댑터로 전달되는 경로와 무료 베타의 차단도 시험한다.
외부 제공자 응답은 대역이므로 계약한 실제 제공자의 시험 성공 또는 hosted DB 적용으로 보고하지 않는다.

확인한 공식 자료: [Cloudflare WebCrypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/),
[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Toss API 키](https://docs.tosspayments.com/reference/using-api/api-keys).
기존 WebCrypto·Supabase RPC 기반을 확장하여 새 암호화 패키지는 추가하지 않았다.
