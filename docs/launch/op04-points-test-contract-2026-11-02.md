# OP-04 회원 무료 회차·포인트·열람권 TEST 계약

2026-11-02. TEST 구현·합성 검증 완료. 019와 운영 플래그는 미적용 상태다. [최소 운영 CMS 계획](admin-cms-minimal-ux-plan-2026-11-01.md), [기존 카드 TEST](paid-episode-sandbox-contract.md)를 확장한다. 운영 DB·플래그·제공자·실제 잔액·기존 권리를 변경하지 않는다.

## 격리와 경계

- `POINTS_TEST_ENABLED=true`, `POINTS_TEST_ENVIRONMENT=TEST`, `POINTS_TEST_PROVENANCE=LOCAL_SIMULATED`, `P0_API_ENABLED=true`가 모두 맞고 `FREE_BETA_ENABLED`가 `true`가 아닐 때만 새 서버 TEST API를 제공한다. LIVE와 기본 설정은 503이다. PG 키를 요구하거나 호출하지 않는다.
- `commerce.op04_*` 비공개 테이블과 서비스 전용 `public.op04_points_test(uuid,text,jsonb)` RPC를 사용한다. 모든 결과에 `mode:TEST`, `provenance:LOCAL_SIMULATED`를 표시한다. 기존 카드 KRW 원장·구형 포인트·P0 권리와 합산하거나 이관하지 않는다.
- `database/launch/019_points_test.sql`은 검토 gate가 있는 미적용 추가 SQL이다. 합성 DB에서만 실행한다. 새 테이블 직접 접근은 anon/authenticated/service_role 모두 금지하고 RLS, 보조 함수 EXECUTE 회수, RPC의 서비스 전용 권한과 고정 search_path를 명시한다.
- 명시적으로 등록한 TEST 작품만 새 경로에서 제공한다. 현재 공개 head와 승인 작가·비성인·제재/비공개·예약·웹툰 manifest 유효성을 확인한다. 공개 카드/회차 메타데이터에 본문·패널·Storage 주소를 넣지 않는다.
- TEST 환경에서는 기존 소설 본문·웹툰 이미지 경로를 `POINTS_TEST_ROUTE_REQUIRED`로 거절하여 새 경로만 사용한다. 무료 베타 경로로 fallback하지 않는다. OFF일 때 기존 서비스 동작은 유지한다.
- TEST 데이터는 운영에 생성하지 않는다. 별도 환경에서 스키마·계정·작품을 준비한 뒤 명시적으로 켜야 한다. 이번 검증은 합성 DB·API/Storage 대역·UI VM이며 실제 PostgreSQL 병렬성/브라우저 인수와 다르다.
- 별도 TEST 배포에는 기존 Auth·계정 API·발행/Storage 기반도 준비돼 있어야 한다. 통합 관리자 화면의 기존 `ADMIN_OPERATIONS_ENABLED=true` 조건은 유지하며, 이를 운영 환경에서 바꾸어 TEST를 여는 절차는 제공하지 않는다.

## 판정과 거래

- 서버 검증 Auth UUID에 연결된 이메일 확인·ACTIVE 독자만 열람한다. 회차 번호 1·2는 MEMBER_FREE, 이후 기본 100P이다. 숨김 회차를 제외한 목록 순서로 무료 범위를 다시 계산하지 않는다.
- 가격 우선순위는 회차 예외 → 작품 예외 → 플랫폼 기본이다. 포인트는 0~1,000,000 정수다. 정책은 시행 시각·UUID 버전·담당자·사유를 가진 불변 이력이며 전역 revision CAS로 편집한다. 무료 2화 정책은 이번 단계에서 고정한다.
- quote는 사용자·안정 회차 ID·현재 공개 버전·적용 가격 버전·포인트·만료 5분을 DB에 고정한다. purchase는 quoteId와 requestId만 받는다. 가격/공개본 변경이나 만료는 무차감 재확인, 잔액 부족은 무차감 거절이다.
- 기존 유효 권리가 있으면 다른 요청 ID·가격 변경·승인된 head 교체 후에도 재차감하지 않는다. 권리는 episode ID에 연결하고 구매에는 당시 head/가격을 남긴다. 본문·패널은 항상 현재 공개 적격 head를 확인한다.
- 사용자 지갑/요청/회차 잠금과 고유 제약으로 잔액 차감·불변 소비 원장·구매·권리를 한 transaction에 기록한다. 응답 유실 재시도는 같은 사용자/내용/requestId로 같은 결과를 재현하고 다른 payload는 409다. 현재 계정/권한 검증은 영수증 조회보다 먼저다.
- 시험 지급은 최고 관리자의 명시적 credit(1~1,000,000P·사유·requestId)만 지원한다. 실제 결제·충전 수납·작가 수익·정산·환불로 표시하지 않는다. 금액 환산이나 LIVE 출시를 포함하지 않는다.

## API DTO 계약

경로는 `/api/v2/points-test?action=...`, 관리자 `/api/v2/admin/points-test?action=...`이다. 서버 actor에서만 p_user를 생성한다. POST는 동일 Origin·JSON·엄격한 필드·본문 64KiB 제한을 적용한다. GET은 중복/미지원 query를 거절한다.

공통 식별자는 work/episode bigint **문자열**, Auth/quote/policy/publication/request는 UUID, revision은 0부터의 bigint 문자열이다. 날짜는 UTC ISO, UI 입력은 KST이다.

| 독자 동작 | 메서드·입력 | 결과 |
|---|---|---|
| works | GET offset=0 | items: work{id,title,author,contentType}, offset,limit:50,total,hasMore,nextOffset |
| episodes | GET workId,offset=0 | work, items: episode{id,workId,episodeNumber,title,versionId,access,pricePoints,priceVersion}, 같은 50건 페이지 |
| wallet | GET | balancePoints, ledger: [{id,kind:CREDIT/DEBIT,deltaPoints,createdAt}] 최근 50건 |
| quote | POST {episodeId} | quote:{id,episodeId,workId,versionId,priceVersion,pricePoints,access,expiresAt}, balancePoints |
| purchase | POST {quoteId,requestId} | episodeId,access,chargedPoints,balancePoints,entitlementId:null/UUID,replayed:boolean |
| content | GET episodeId | episodeId,workId,versionId,contentType:NOVEL/WEBTOON,title,contentDocument:null/object,content:null/string,panels:[]/{id,order,width,height,format}[] |
| panel | GET episodeId,versionId,panelId,format | RPC 내부 객체 버킷/키/MIME를 서버만 수신하고 브라우저에는 인증된 바이너리 프록시만 제공 |

access는 `MEMBER_FREE`, `OWNED`, `LOCKED`. 본문/이미지 잠금은 403 `EPISODE_LOCKED`이며 본문을 포함하지 않는다. 비공개/옛 head는 404 `CONTENT_NOT_AVAILABLE`, 미등록 작품은 404 `TEST_WORK_NOT_FOUND`이다. 가격 변경 409 `PRICE_CHANGED`, 공개본 변경 409 `PUBLICATION_CHANGED`, 만료 409 `QUOTE_EXPIRED`, 잔액 부족 409 `INSUFFICIENT_POINTS`, CAS 409 `REVISION_CONFLICT`, 재사용 키의 다른 내용 409 `IDEMPOTENCY_CONFLICT`를 사용한다. 모든 데이터 응답은 공통 mode/provenance를 포함한다.

| 관리자 동작 (모두 POST) | 입력 | 결과 |
|---|---|---|
| state | {} | revision, defaults:{freeEpisodes:2,pricePoints:현재기본값(초기100)}, works:[work + enabled:boolean], policies:[{id,scope,targetId,points,startsAt,reason}] 최근 100 |
| search | {q:'',type:ALL/NOVEL/WEBTOON,offset:0} | 공개 적격 work 카드의 50건 페이지 |
| enroll | {workId,enabled,revision,reason,requestId} | 최신 state + saved:true,replayed:boolean |
| policy | {scope:DEFAULT/WORK/EPISODE,targetId:null/bigint문자열,points,startsAt,revision,reason,requestId} | 같은 state |
| credit | {targetUserId:AuthUUID,points,reason,requestId} | targetUserId,balancePoints,creditedPoints,replayed:boolean |

RPC action은 위와 같되 관리자 액션은 `admin-state`, `admin-search`, `admin-enroll`, `admin-policy`, `admin-credit`다. 관리자는 SUPER_ADMIN만 허용한다. 본문 RPC는 안전한 현재 공개 document/이미지 manifest만 제공하며 원고 초안은 읽지 않는다. panel 내부 결과는 `{bucket,path,mimeType,bytes:null/정수}`로 고정하고 API가 브라우저에 직렬화하지 않는다.

## UI와 통합 소유권

- `AdminPointsTest`는 기존 `설정 → 서비스 정책`에서 조회/등록·가격 버전/시험 지급을 제공한다. 상위 관리자 메뉴와 영속 권한을 추가하지 않는다. OFF 상태는 준비 안내다.
- `ReaderPointsTest`는 `/reading-test`에서 TEST 작품·회차·무료/잠금/보유·시험 잔액, 명시적 견적/구매와 본문·웹툰 패널을 제공한다. OFF 상태는 준비 안내다. 기존 무료 독자 화면을 과금 화면으로 바꾸지 않는다.
- 양 모듈은 active/render(root,{isCurrent})/leave/reset 계약, textContent·안전한 문서 렌더러, 계정별 generation·지연 응답 차단, 이미지 object URL 폐기, 미확정 구매의 정확한 payload/requestId 재시도를 사용한다. localStorage 잔액/권리 저장 금지.
- root: 게이트/기존 본문 우회 차단, account-api·router·public-config·메뉴/로더/로그아웃 연결, 통합 검증·문서·release/Git.
- DB worker: 019 SQL, 합성 fixture, DB tests/독립 리허설.
- API worker: server/points-test-api.mjs 및 API tests. gate는 이 모듈에서 export.
- UI worker: admin/reader TEST 모듈 두 개와 CSS·VM tests. 통합 공통 파일은 root만 수정.

다음 OP-05는 실제 충전상품·입금 대조·카드 승인/환불·원거래 대사이다. TEST 원장을 실제 잔액으로 전환하지 않으며, 계약·약관·제공자 검증과 별도 출시 승인 전 LIVE 결제를 열지 않는다.

등록된 TEST 작품은 최대 1,000건, 견적 생성은 회원당 분당 60건으로 제한한다. `TEST_WORK_LIMIT`은 409다. 신규 68개와 전체 릴리스 54개 명령, 컴파일·타입·독립 5단계 리허설을 통과했다. 최초 전체 빌드의 Windows junction 권한 제한은 기존 보안 검사를 같은 내용으로 권한 재실행해 해소했으며 해당 검사나 실패 기록을 생략하지 않았다. [최종 구현·검증 기록](op04-points-test-implementation-2026-11-02.md)을 따른다.
