# 34단계 — 작가 가입 구현과 PASS 연동 준비

2026-10-21. 사용자는 PASS **미계약, 구현 후 연동 준비**를 선택했다. 실제 인증 계약이나
TEST/LIVE 제공자 거래가 완료되었다고 간주하지 않는다. Cloudflare를 사용하며 Vercel은 사용하지 않는다.

## 구현한 가입 절차

1. Supabase에서 각 로그인 이메일을 확인한다. 다른 ID로 가입하려면 별도 확인 이메일이 필요하다.
2. 기존 가입 마무리 화면에서 본인 창작 또는 공동 창작·이용허락 권리 확약을 선택한다.
   저작권 확약과 본인확인 개인정보 동의는 별도 체크박스이며 기본 선택하지 않는다.
3. 서버가 현재 동의 문서 버전·SHA-256, Auth UUID, 동의 시각을 기록하고 10분 유효한
   무작위 인증 거래를 발급한다. 같은 요청 키는 같은 거래를 돌려준다. 새 거래는 이전 미완료 거래를 취소한다.
4. 공식 PortOne SDK로 본인확인을 요청한다. 모바일 복귀와 응답 유실은 서버 상태 조회와
   `인증 결과 다시 확인`으로 복구한다. URL·팝업의 성공 표시는 인증 증거로 사용하지 않는다.
5. 서버가 PortOne 거래를 조회하여 본인 계정·목적·거래번호·상점·채널·PG·LIVE/TEST·시각·만료를
   확인한다. 검증된 실명과 계약한 CI/DI가 없으면 완료하지 않는다. 기존 성인 인증과는 별도 목적이다.
6. LIVE 인증만 필명 등록과 작가 프로필 생성을 완료한다. 인증 소비·본인 연결·프로필 생성은
   한 트랜잭션이다. 재전송은 최초 결과를 유지하며 필명이나 작품을 덮어쓰지 않는다.

같은 본인의 A/B 계정은 각각 자기 세션에서 새 인증을 한다. 사람 하나에 여러 Auth UUID/Author를
연결할 수 있으며 Auth UUID당 Author 하나라는 기존 계약은 유지한다. 이름·전화번호로 병합하지 않는다.
`person_id`는 작품 소유권 검사에 사용하지 않는다. 외부 응답에는 본인 식별값과 연결된 다른 계정을 노출하지 않는다.
소설·웹툰 등록은 각 계정의 작품 단위로 계속 허용한다.

기존 `/api/v2/onboarding`의 `kind: author`와 기존 작가 생성 RPC로 새 인증을 우회할 수 없다.
독자 가입 경로는 유지한다. 작가 신원은 여전히 검증된 `WebNovelsAuth.getActor().author`이며
`/creator`, `/api/v2/creator/*`, Author/Creator 별칭을 보존한다.

## DB·권한·개인정보

적용 파일은 `database/authoring/023_author_enrollment.sql`과
`database/launch/014_author_enrollment_accounts.sql`이다. 전자는 authoring-004 이후 독립 적용 가능하고,
후자는 기존 제한 계정 서비스와 새 가입 증빙을 연결한다. 현재 DB의 수동 작가 ID는 보존하고
최댓값 이후를 발급하는 identity를 보완한다. 가입된 작가를 관리자 승인 대기로 만들지 않는다.

인증 거래·동의·본인·계정 연결·발행 동의 연결은 비공개 authoring schema의 RLS 테이블이다.
PUBLIC/anon/authenticated/service_role의 직접 테이블 접근을 모두 회수하고 서비스 전용 RPC만 허용한다.
동의 UPDATE를 금지하며 문서의 버전·내용·해시는 불변이다. 작품 발행의 기존 `rightsConfirmed` 검증은
유지하고 해당 발행 요청과 가입 문서 버전을 연결한다. 과거 작가에게 동의 이력을 소급 생성하지 않는다.

실명과 CI/DI 원문은 서버 메모리에서만 확인하며 저장·응답·로그에 남기지 않는다. CI/DI는
`provider + store + identifierType + mode + keyVersion` 범위로 HMAC 처리한다. HMAC도 개인정보다.
동일 키 버전의 비밀키를 임의 교체하면 같은 본인이 분리되므로 교체 전 별도 이관 계획이 필요하다.

정책 문안은 `server/author-enrollment-policy.mjs`와 SQL의 동일 해시로 고정한다. 현재 문안은
**활성화 전 검토 대상**이다. 권리 확약은 플랫폼의 법정 책임을 이전하지 않는다. 공동 창작·이용허락
선택지는 타인의 저작권을 자기 소유로 허위 확약하지 않게 한다. 작품별 기여자·라이선스 증빙의
상세 수집 및 분쟁 처리는 후속 운영 기능이다.

미완료 거래·동의는 23시간 경과 후 정리 대상으로 하며, 최소 매시간 정리해 24시간 내 파기하는
운영 정책이다. Cloudflare scheduler의 `AUTHOR_IDENTITY_ENABLED`를 별도로 설정하고 실패 알림을
인수해야 수집을 시작한다. 완료된 연결·동의는 작가 계정 유지 동안 보관한다. 탈퇴 시 운영자가
계정 접근을 먼저 제한하고, 검토된 트랜잭션에서 `webnovels.author_erasure_verified=true`와
`authoring.erase_author_enrollment(auth_uuid)`로 해당 계정의 정보를 지운다. 다른 계정이 참조하는
person은 남긴다. 일반 API에는 삭제 권한이 없다. 작품 보존·권리 분쟁 자료의 별도 법적 근거와
보존은 탈퇴 처리 전에 확인하며 무기한 보존을 약관에 숨기지 않는다.

## 계약 후 활성화 순서

1. 제공자·요금·상점·채널·실명/CI/DI 제공 범위와 이용 목적을 확정한다. `DANAL`은 CI/DI,
   `INICIS_UNIFIED`는 CI 경로를 지원한다. 누락 식별자는 이름이나 전화번호로 대체하지 않는다.
2. 제공자의 실제 PASS 허용 설정을 확인한다. INICIS SDK는 `directAgency: PASS`를 요청하지만,
   일반 REST 검증 응답에는 선택된 인증 방식 필드가 없다. 클라이언트 bypass만으로 PASS-only를
   서버에서 강제했다고 주장하지 않는다. 계약/채널에서 이를 보장할 수 있는지 실제 인수가 필요하다.
3. 개인정보 목적·항목·보유/파기·거부권·위탁/제3자 제공 구분, 미성년·국외·법인 작가 정책과
   저작권 문안을 확정한다. 문안을 바꾸면 SQL/서버의 버전과 해시도 함께 개정한다. 과거 동의를 덮어쓰지 않는다.
4. Cloudflare 비밀 설정에 `.env.example`의 `PORTONE_API_SECRET`, `PORTONE_STORE_ID`,
   `AUTHOR_IDENTITY_*`를 등록한다. HMAC 키는 32개 임의 바이트의 64자리 hex다. 클라이언트 설정으로 배포하지 않는다.
5. 격리 TEST 환경에서 실패·취소·만료·복귀·다른 계정 재사용·응답 유실을 확인한다.
   TEST 완료는 실제 Author 생성/실명 인증 완료로 승격되지 않는다.
6. 실제 LIVE 채널·이메일 콜백·정리 Cron·탈퇴 처리를 인수한다. DB `enrollment_settings`의
   상점/채널/PG/모드/식별자/키 버전을 서버와 일치시키고 `provider_review_ref`, `legal_review_ref`를
   실제 검토 근거로 기록한다. 기본 enabled=false와 Pages의 두 가입 플래그는 이때만 변경한다.
7. 기존 작가는 우선 선택적 추가 인증으로 안내한다. 재확인 강제 기한은 아직 설정하지 않았다.
   공지·유예·지원 경로를 확정하기 전 원고 읽기·저장·백업을 차단하지 않는다. 최초 발행의 관리자 사전 검수도 추가하지 않는다.

## 검증의 범위

[검증 보고서](../../artifacts/stage34-verification.json): 전체 `npm run build`의 Node 테스트 692개,
타입 검사, 변경 JavaScript 17개 구문 검사와 diff 검사를 통과했다. 새 가입 서버/정책·PortOne·
scheduler 선택 범위의 12개 테스트 코드 커버리지는 라인 98.56%, 분기 77.50%, 함수 96.15%다.
저장소 전체 커버리지로 해석하지 않는다. 비밀 토큰 패턴 검사 결과는 0건이다.

현재 DB에는 위 두 마이그레이션을 **비활성 상태로 적용**했다. 새 가입 거래·인증 계정은 0건이며,
계정/스튜디오/작품 등록 readiness는 유지된다. 기존 110개 테이블 1,631행을 로컬 복원·대조했고,
실제 적용 후에도 기존 110개 테이블의 원본 행 해시가 모두 일치한다. 논리 백업과 PostgreSQL
17.11 네이티브 백업을 확보했다. 인증 테이블의 브라우저·service_role 직접 권한은 0건이다.
실제 PASS 계약·제공자 거래·모바일 기기·hosted 복원·다중 DB 연결 인수는 아직 수행하지 않았다.

합성 PGlite에서 동의 누락/위조, 동일인 복수 계정, 필명 보존, 계정 간 작품 접근 거절,
타 계정 거래 재사용, 만료/취소/TEST 거절, 제한 상태, 응답 유실 재시도, 권한과 정리 작업을 검증한다.
VM DOM 대역으로 동의 UI·SDK 호출·복귀·계정 변경 시 늦은 응답 차단을 검사한다.
이는 실제 PASS 인증이나 브라우저/기기 인수가 아니다. PGlite의 동시 요청 검사는 단일 엔진 내
직렬화된 호출이며, PostgreSQL 다중 연결 경쟁 검증은 별도 인수 사항이다.

`scripts/prepare_stage34.mjs <검증된 백업 폴더>`는 실제 행·제약과 애플리케이션 함수/트리거를
로컬 복원하여 검증한다. `--apply`는 원본 전체 행 해시가 백업과 같을 때만 위 두 파일을 적용하며
가입/공개 기능을 켜지 않는다. 결과는 [인수 결과](../../artifacts/stage34-acceptance.json)에 기록한다.
백업 원문·Auth 정보·CI/DI·비밀키는 Git에 포함하지 않는다.

참고: [PortOne 서버 응답](https://portone-io.github.io/server-sdk/js/types/IdentityVerification.IdentityVerificationVerifiedCustomer.html),
[PG 구분](https://portone-io.github.io/server-sdk/js/types/Common.PgProvider.html),
[본인인증 SDK](https://developers.portone.io/sdk/ko/v2-sdk/identity-verification-request?v=v2),
[이니시스 통합인증](https://developers.portone.io/opi/ko/integration/pg/v2/inicis-unified-identity-verification?v=v2),
[개인정보 보호법 제15조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1029334809).
