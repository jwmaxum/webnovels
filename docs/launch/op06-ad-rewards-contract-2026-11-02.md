# OP-06 광고 보상 서버 검증·열람권 TEST 계약

2026-11-02 TEST 구현·전체 합성 검증 완료. 사용자는 광고 제공자 미계약으로 TEST 구현 후 연동 준비를 선택했다. 광고가 없으면 **포인트 구매가 기본 대안**이며 기본 충전상품은 **10,000원 → 10,000P**, 회차 기본 차감은 OP-04의 100P다. 상품·회차의 실제 조건은 서버 버전으로 확인하고 명시적 주문/구매 후 반영한다. 자동 충전·자동 차감은 없다.

019·020·새 021 SQL과 금융/광고 운영 플래그는 적용하지 않는다. 기존 실제 계정·작품·원고·구매권·포인트·정산은 보존한다. 새 의존성 없이 fetch/WebCrypto/PGlite/Node test/VM을 재사용한다.

## 격리와 제공자

- `adRewardsTestEnabled(env)` = 기존 `pointsTestEnabled(env)` + `AD_REWARDS_TEST_ENABLED==='true'` + `AD_REWARDS_TEST_ENVIRONMENT==='TEST'` + `AD_REWARDS_TEST_PROVIDER` 생략/NONE/INTERNAL_TEST만 허용. LIVE는 거절한다. CHARGING_TEST 활성은 광고 TEST의 선행 조건이 아니다.
- 기본 NONE은 광고 없음이다. 광고 미연결·미충전·거절·중단·만료에는 포인트 충전/가격 확인을 안내한다. 광고 없음에 무료권을 자동 발급하지 않는다.
- INTERNAL_TEST는 별도 내부 테스트 증빙 프로토콜 `OP06_INTERNAL_TEST_V1`이다. Google 인증·실제 광고 완료·광고 매출로 표시하지 않는다. 외부 광고 SDK·실제 업체 callback은 열지 않는다.
- 내부 TEST 증빙은 `AD_REWARDS_TEST_CHANNEL_ID`(1~80 ASCII 안전 문자), `AD_REWARDS_TEST_KEY_ID`(1~32 안전 문자), `AD_REWARDS_TEST_SECRET`(64 hex), `AD_REWARDS_TEST_CALLBACK_ENABLED==='true'`가 모두 준비됐을 때만 수신한다. 비밀은 서버 환경 전용이며 공개 설정/DB/응답에 저장하지 않는다. binding은 secret/channel/keyId의 SHA-256이다.
- 공개 runtime config에는 effective `adRewardsTestEnabled` boolean만 추가한다. 제공자/키 저장 UI는 실제 업체 규격 선택 후 기존 암호화 설정 체계에 별도 연결한다.

Google Ad Manager는 웹 SSV를 지원하지만 공개 웹 문서만으로 서명·세션 매핑 계약을 확정하지 못했다. AdMob 모바일 ECDSA 규격을 웹에 이식하거나 `rewardedSlotGranted`를 서버 증빙으로 사용하지 않는다. 기존 자체 생성 HMAC/3초 모달도 광고 완료 검증으로 재사용하지 않는다.

## 권리와 보상 정책

별도 비공개 광고/무료 캠페인 권리를 안정 episode ID에 연결한다. 기존 구매 entitlement/원장에는 넣지 않는다. `commerce.op04_access`의 우선순위는 회원 무료(회차1·2) → 구매권 OWNED → 가격0 무료 → 유효 AD_REWARD → 유효 CAMPAIGN_FREE → LOCKED다. 실제 본문/패널은 기존 공개 적격성·현재 head·소유권 판정을 계속 거친다.

광고·캠페인 기본 유효기간은 **완료 증빙 시각부터 24시간**이다. 정책으로 1~168시간, 세션 1~30분(기본5), 지연 증빙 유예 0~60분(기본10), 일일 세션 한도1~100(기본20)을 버전화한다. 시작 시 조건·현재 공개본·정책·제공자/channel/binding을 동결하고 정책 변경으로 과거 세션 약속을 바꾸지 않는다. 광고·캠페인은 기본 비활성이다.

운영자 무료 캠페인은 별도 명시 opt-in `EXPLICIT_CLAIM` 방식만 지원하며 시작/종료 기간·제목을 관리자가 설정한다. 스크롤·광고 클릭을 광고사 증빙으로 만들지 않는다. 같은 회원/회차/캠페인 버전은 한 번만 청구한다. 이를 광고 매출이나 유상 충전으로 기록하지 않는다.

현재 구매권/무료권이 있으면 불필요한 광고를 시작하지 않는다. 같은 회원/회차에 미확정 광고 세션은 증빙 수신 유예가 끝날 때까지 하나만 유지한다. 사용자별 잠금으로 분당5건·정책의 한국시간 일일 한도를 적용하고 정확한 requestId 재시도는 중복 생성하지 않는다. 세션/증빙의 조회만으로 권리를 발급하지 않는다. 시작은 options에서 확인한 `policyVersion`을 요구하며 신규 요청 사이 정책이 바뀌면 `REWARD_POLICY_CHANGED` 409 후 조건 재확인·재동의를 요구한다. 신규 조건과 기존 미확정 세션의 조건이 다르면 `REWARD_SESSION_PENDING` 409로 기존 결과 조회/포인트 구매를 안내한다. 이미 접수한 정확한 요청은 옛 snapshot을 재현한다.

`AD_REWARD`·`CAMPAIGN_FREE`는 구매 영구권과 구분한다. OP-04 episodes/quote/purchase 응답에서 해당 access일 때 `rewardAccess:{kind,grantId,expiresAt}`를 제공한다. 광고권은 0P이며 기존 구매/보유권을 덮거나 포인트 환불을 만들지 않는다. 만료된 임시권의 옛 0P 구매 영수증 재현은 권리를 연장하지 않는다. 필요한 경우 wrapper는 `REWARD_EXPIRED` 409를 반환하고 새 가격 확인을 요구한다.

## 세션·증빙·상태

세션 DTO: `{id,episodeId,kind:AD_REWARD/CAMPAIGN_FREE,status,createdAt,expiresAt,acceptUntil,closedAt,rewardHours,policyVersion,grant:null/{id,kind,expiresAt}}`. private 사용자 UUID·binding·secret·provider event 원문은 응답에서 제거한다. 내부 TEST 시작 응답에만 `{protocol,sessionId,nonce,channelId,policyVersion}` challenge를 제공할 수 있다. nonce는 64 hex 난수이며 브라우저는 서명할 수 없다.

기본 상태는 WAITING_EVIDENCE, CLOSED_PENDING, GRANTED, NO_FILL, REJECTED, EXPIRED다. 브라우저 닫기/취소는 closedAt만 기록하며 완료를 확정하지 않는다. 닫기 전에 완료한 검증 증빙은 유예 기한 내 늦게 도착해도 인정한다. completedAt가 closedAt 이후이면 거절한다. 이미 GRANTED이면 닫기·늦은 오류·재전송으로 회귀하지 않는다.

증빙 completedAt는 세션 생성 이후·세션 expiresAt 이전이며 미래30초 이내, 수신은 acceptUntil 이전이어야 한다. GRANTED/NO_FILL/REJECTED는 제공자 증빙의 outcome이다. 검증한 완료만 권리를 발급한다. 동일 provider+안정 channel+eventId는 전체 세션에서 한 번만 사용하며 binding revision을 고유키 범위에 넣지 않는다. 다른 내용 재사용은 409다. 동일 증빙은 재현하고 유효기간을 늘리지 않는다.

시작 당시 공개 적격 회차에 대한 검증된 보상은 안정 episode에 기록한다. 이후 비공개/공개본 변경은 본문·패널의 현재 판정으로 제한하며 구매권과 마찬가지로 보상 기록을 지우지 않는다. 증빙 적용 시 현재 활성 Auth/독자 연결을 다시 검증한다. 계정 정지/권한 회수는 과거 영수증으로 우회하지 않는다.

## API와 내부 TEST 서명

독자 `/api/v2/ad-rewards-test?action=...`, 최고 관리자 `/api/v2/admin/ad-rewards-test?action=...`를 계정 API에 연결한다. POST는 동일 Origin JSON·16KiB·정확 필드, GET은 strict query다. marker는 `{mode:TEST,provenance:LOCAL_SIMULATED,provider: NONE/INTERNAL_TEST}`다.

| 독자 action | 입력 | 결과 |
| --- | --- | --- |
| options | GET episodeId | availability:UNAVAILABLE/INTERNAL_TEST/ALREADY_ACCESSIBLE, adAvailable, campaignAvailable, policy·fallback |
| start | POST {episodeId,kind,policyVersion,consent:true,requestId} | session/challenge 또는 광고 없음 fallback. 자동 발급 없음(명시 무료 캠페인 청구 제외) |
| status | GET sessionId | 현재 본인 session |
| close | POST {sessionId,requestId} | 현재 session, 닫기 전 완료 증빙 유예 유지 |

fallback DTO는 `{kind:POINTS,chargePath:'/charging-test',amountKrw:10000,points:10000,defaultEpisodePoints:100}`다. 실제 판매 상품과 현재 회차 가격은 각 서버 snapshot이 우선한다. 준비되지 않은 충전을 성공으로 표시하지 않는다.

| 관리자 action (모두 POST) | 입력 | 결과 |
| --- | --- | --- |
| state | {} | revision, policy, 준비 상태 |
| policy | {revision,adEnabled,campaignEnabled,rewardHours,sessionMinutes,graceMinutes,dailyLimit,campaignTitle,campaignStartsAt,campaignEndsAt,reason,requestId} | state, saved,replayed |
| sessions | {status:ALL/WAITING_EVIDENCE/CLOSED_PENDING/GRANTED/NO_FILL/REJECTED/EXPIRED,offset:0} | 최대50개 페이지. admin만 검증된 userId 포함 가능 |

서비스 RPC는 `public.op06_rewards(p_user uuid,p_action text,p_data jsonb)`이며 관리자 action은 `admin-` prefix다. 서버가 `options/start`에 `{provider,channelId,binding}`을 추가하고 브라우저는 이 필드를 보내지 못한다. campaign은 PG/광고 키 없이 처리한다. 증빙 적용은 서비스 전용 `public.op06_apply_reward(p_evidence jsonb)`다.

내부 callback은 `POST /api/v2/ad-rewards-test/callback`이다. query를 허용하지 않는다. 본문 UTF-8 원바이트(16KiB), `X-WN-Test-Key-Id`, `X-WN-Test-Timestamp`(Unix초, ±300초), `X-WN-Test-Signature`(64 hex)를 검증한다. 서명은 `HMAC-SHA256(hexSecret, UTF8(timestamp+'.') || rawBody)`이며 WebCrypto verify를 사용한다. 인증된 TEST callback만 계정 세션 없이 호출하고, 위조 서명은 DB 접근 전에 거절한다.

본문은 `{protocol:'OP06_INTERNAL_TEST_V1',eventId,sessionId,nonce,channelId,outcome:'GRANTED'/'NO_FILL'/'REJECTED',completedAt,reward:{type:'EPISODE_ACCESS',quantity:1}}` 정확 필드다. eventId는 1~128 ASCII 안전 문자, session/nonce/channel과 보상 종류·수량은 시작 snapshot과 대조한다. API가 현재 provider/key binding과 bodyDigest를 더해 RPC에 보낸다. 비밀·서명 원문은 저장하지 않는다. 외부 Google callback 규격으로 명명하지 않는다.

## DB·UI·소유권

021은 검토 gate·019/020 원본 해시/함수 보존 검증 후 비공개 config/policy/session/event/grant/receipt/audit를 추가한다. 기존 원장·스키마 ACL을 보존하며 새 객체에 RLS·명시적 권한·고정 search_path를 적용한다. 원본 private `op05_points_base` 본문은 보존하고 access 함수와 public wrapper의 필요한 의미만 검토하여 확장한다. 구매/보상은 기존 wallet→episode 잠금 순서를 맞춘다.

- DB 작업자 소유: `database/launch/021_ad_rewards_test.sql`, `scripts/fixtures/op06-db.mjs`, `scripts/verify_op06_rewards_db.test.mjs`, `scripts/verify_op06_rewards_sandbox.mjs`.
- API 작업자 소유: `server/ad-rewards-test-api.mjs`, `server/providers/internal-test-reward.mjs`, `scripts/verify_op06_rewards_api.test.mjs`, `scripts/verify_op06_rewards_provider.test.mjs`.
- UI 작업자 소유: `public/js/admin/admin-rewards-test.js`, `public/js/reader/reader-rewards-test.js`, `public/css/rewards-test.css`, `scripts/verify_op06_rewards_ui.test.mjs`. 추가로 기존 `reader-topups.js`와 OP05 UI test의 기본10000 상품 선택 동선만 담당한다.
- root 소유: 공통 gateway/config/auth/loader/HTML·라우터 캐시, 기존 points API/reader의 임시권 metadata·영구/임시권 표시와 child lifecycle, admin service tab sibling host 통합, 기본충전 fallback/문서·통합검증·Git.

광고 부재 시 포인트 구매를 기본 표시한다. INTERNAL_TEST는 모의 광고 영상·카운트다운 없이 서버 증빙 대기만 표시한다. 최고 관리자 정책 패널은 기존 `설정→서비스 정책` 안에 둔다. 캠페인은 명시 별도 선택이고 자동 무료 fallback이 아니다. 기존 legacy 광고 모달의 3초·정산 보장 문구는 준비 안내로 정리하며 FREE 베타 차단은 유지한다.

상태 조회·미확인 요청 재시도·키보드 조작·계정/화면 폐기·권리 만료·중복/지연/위조 증빙·실제 SET ROLE·구매/환불 보존을 합성 검증한다. 실제 광고·PostgreSQL 병렬·브라우저·운영 DB/플래그는 별도 미실행으로 기록한다. 다음 OP-07은 확정 수익 근거·공제·예약·작가 정산 요청/승인/실제 지급 증빙이다.

검증 결과: 신규85개(DB27/API12/provider8/UI25/통합13), 전체 릴리스56개 명령·컴파일·독립 타입·6개 흐름 리허설 통과. 관련 OP05 UI 회귀36개(기본 SKU 선택2개 추가)도 통과했다. 운영019·020·021/플래그·실제 광고·금융·브라우저와 PostgreSQL 다중 연결은 미실행이다. [최종 구현 기록](op06-ad-rewards-implementation-2026-11-02.md)을 따른다.

광고 없음·기존 권리 보유·중단 등 신규 쓰기도 회원별 잠금 아래 분당60건으로 제한한다. 정확한 requestId 재현은 이 제한 전에 처리하여 결과 재확인을 유지한다. 새 테스트로 미제공 요청·중단 요청의 공통 제한, 다른 회원 격리와 포인트/권리 불변을 확인했다. 전체 릴리스56개 명령 이후 이 보완에 대해 신규85개와6개 흐름 리허설을 다시 통과했다.
