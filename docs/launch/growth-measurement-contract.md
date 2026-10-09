# 22단계 계측·검색 계약

2026-10-09. [계획](../../improve22.md), [21단계 성장 계약](growth-experiments-contract.md),
[19단계 품질·복원 계약](stage19-quality-contract.md)을 확장한다. Author/Creator 신원·경로와
기존 원고/공개본·계정·관심작·진행률·원장을 변경하지 않는다.

## 적용과 별도 동의

018은 검토된 017 이후 추가 SQL이며 `webnovels.authoring_apply_verified` 세션 게이트가 필요하다.
016 결제 준비는 무료 서비스의 선행 조건이 아니다. 운영 백업·격리 DB/Storage 복원·권한 인수는
별도 증거로 확인한다. 이번 실제 감사는 읽기 전용이며 SQL 적용·P0 잠금·플래그 변경은 없다.

`GROWTH_MEASUREMENT_ENABLED`는 기본 false이며 P0·발행·독자 서비스·발견·성장 gate도 모두 필요하다.
기존 `analyticsConsent`와 별개로 `measurementConsent`와 `measurement_since`를 추가한다.
기존 분석 동의가 true여도 새 계측은 자동 동의되지 않는다. 두 동의를 함께 선택해야 계측한다.
기존 3필드 설정 요청은 새 동의를 보존하며 분석 동의 철회는 새 계측도 철회한다.
018의 DB 트리거는 플래그를 끈 뒤 구 017 RPC로 철회해도 새 개인 계측을 삭제한다.
동의/계측/본문 RPC는 동일 사용자 advisory lock으로 철회 이후 삽입을 직렬화한다.

## 지표 정의와 데이터 보존

| 기록 | 정의 | 보존·중복 방지 |
|---|---|---|
| 카드 receipt | 인증 계정에 서버가 제공한 공개 무료 카드. 계정/작품/동의 구간/실험/KST일에 묶인 UUID | 24시간 유효. 같은 키 재시도는 같은 receipt |
| VIEWPORT | receipt를 가진 카드가 화면의 50% 이상, 활성 탭에서 연속 1초 보였다는 클라이언트 신고 | 첫 본문 제공 전의 첫 신고, 계정/작품/동의 구간/종류별 1행 |
| SHARE | `/works/:id?source=share`의 고정 공유 표식 신고 | 첫 본문 제공 전의 첫 신고. 같은 키 재시도 멱등, 계정당 KST일 신규 공유 신고 최대 30작품 |
| 첫 본문 제공 | 공개 무료 본문 RPC가 실제 반환한 episode/work/version으로 만든 동의 구간의 최초 기준점 | 계정/작품/동의 구간별 1행. 다른 회차/재시도/공개본 교체로 다시 만들지 않음 |

모두 확인된 비익명·미차단 Auth의 활성 독자를 재검증한다. 현재 공개 무료 head·작가 상태·제재·등급을
다시 검사하고 본인 작품을 제외한다. 웹툰 비활성 시 웹툰 본문/신고/SEO를 제외한다.
단일 작품의 계측 자격은 해당 작품의 공개 무료 회차 조회로 확인하여 전체 카탈로그 순위 집계를 피한다.
본문과 첫 기준점을 같은 RPC 트랜잭션에서 처리하고 클라이언트의 작품·버전·시각을 본문 기준으로 신뢰하지 않는다.
본문 발급은 수신/화면 표시 완료·실제 독서·생애 최초 이용을 증명하지 않는다.
기존 OPEN/COMPLETE/D7/D28 진행률 대리지표는 재해석하거나 소급하지 않는다.

화면 노출은 클라이언트 조작을 완전히 방지할 수 없는 대리지표다. 관찰기와 타이머는 탭 숨김/카드 이탈,
홈 이탈·계정 reset 때 해제하고 늦은 응답/콜백은 무시한다. 실패한 신고를 자동 반복하지 않으며 다음 조회에서
재시도할 수 있다. SHARE는 검증된 외부 사이트나 캠페인 유입이 아니다. 익명 visitor ID·IP·기기 지문·쿠키·
원본 referrer URL·UTM·이메일을 추가 수집하지 않는다. 공유 페이지 canonical은 표식 없는 작품 URL이다.

최초 신고 후 **24시간 내 첫 본문 제공**만 전환으로 센다. 최근 28일 신고 중 24시간 관찰을 마친
분모만 포함하고 고유 독자 5명 미만의 분모/분자/비율은 null과 상태로 숨긴다.
이미 첫 본문을 제공한 작품은 이후 신고의 신규 전환 분모에 들어가지 않는다. VIEWPORT/SHARE는
독립 채널로 같은 독자가 양쪽에 포함될 수 있어 합산하지 않는다. 관리자 실험/대조군 증거도
고유 독자 5명 이상일 때 사용자/작품 쌍으로 집계한다. 개인 UUID·receipt·본문은 보고서에 반환하지 않는다.
현재 공개 상태/동의/계정 상태로 재검사하며 과거 상태를 재구성하지 않는다.

만료 receipt와 90일 지난 첫 신고는 Cron이 각각 최대 20행씩 삭제한다(운영 지연 가능).
계정별 보관 receipt는 최대 200행이며 상한이면 새 receipt 없이 추천을 계속 제공한다.
관리자 노출/대조군 증거는 최근 28일의 가장 최근 30개 실험·최대 60개 그룹으로 제한하고 이 범위를 표시한다.
관측 원자료가 90일 이내라도 보고 범위는 최근 28일이다. 첫 본문 기준점은 동의를 유지하는 동안
중복 방지를 위해 보존한다. 계측 동의 철회 시 receipt/첫 신고/첫 본문 기준점은 모두 삭제한다.
재동의는 새 timestamp 구간이며 과거 기록을 복구하지 않는다. 구 reader_events/관심작/진행률은 보존한다.
새 표본이 없는 경우 실험 성공·전환율 0·GO로 바꾸지 않는다.

## 서버 경로와 검색 분할

기존 `/api/v2/reader/growth`에 POST `viewport {receiptId}`, `referral {workId,source:'SHARE'}`를 추가한다.
설정 저장은 새 플래그가 켜진 경우에만 4번째 boolean `measurementConsent`를 받는다.
서버가 검증한 actor UUID와 웹툰 gate만 RPC로 전달한다. 정확한 필드·origin·메서드·중복 query를 검사한다.
본문 경로는 유지하며 계측이 켜진 경우 `stage22_episode_content`를 쓴다. 플래그 off는 기존 경로다.
작가 소유 보고와 최고 관리자 보고는 기존 검증에 018 집계를 추가한다.

`/sitemap.xml`은 index, `/sitemaps/:bucket/index.xml`은 작품 sitemap이다.
bucket은 bigint `(work_id-1)/1000`의 고정 구간으로 각 child에 최대 1,000작품이 포함된다.
OFFSET 이동을 사용하지 않고 bigint 문자열·마지막 구간을 검증하여 overflow를 피한다.
index는 현재 공개 무료 작품이 있는 최대 50,000구간을 열거하며 초과하면 503으로 중단한다.
child가 비었거나 사라지면 404다. 각 요청 시 현재 공개 head/무료/비성인/제재/웹툰 gate를 다시 검사한다.
고정 HTTPS canonical origin과 escape된 XML만 반환하며 사설 이미지/원고/임의 Host는 쓰지 않는다.
index/child는 같은 시점의 고정 snapshot이 아니다. 새 구간은 다음 index 수집 때 발견되고
비공개 전환은 child 재요청 시 제외된다. DB 조회 부하·검색 엔진 수집은 실환경 인수 대상이다.

## 실제 출시 차단과 검증 경계

[읽기 전용 감사](../../artifacts/stage22-launch-readiness.json): Auth 42, 연결 작가 30, 본문 충돌 78,
Storage 객체 0, authoring 007~015/017/018 미적용, P0 잠금 미완료, 공개 health 503.
이 숫자는 실제 DB 집계이며 PGlite 합성 결과와 구분한다. Storage 객체 0은 Storage 복원 인수 완료를 뜻하지 않는다.
실제 복원/권한/PC·모바일·Cron/동의 UX 인수와 28일 동의 표본은 미실행이다.
서비스 판정은 NO_GO다. 도구는 승인·SQL 적용·플래그 활성화를 수행하지 않는다.

23단계는 78건 충돌의 원본·소유자 확인과 보류 원본 보존, 일관된 DB+Storage 백업/격리 복원,
실제 RLS/RPC/Auth/역할·무료 원고/웹툰·예약 인수, 승인된 무료 서비스 전환을 먼저 수행한다.
그 뒤 계측 동의와 별도 가설/대조 기준으로 28일 표본·재방문·연재 공급·비용을 관찰하고
KEEP/CHANGE/STOP 근거를 남긴다. 코드/배포 성공은 서비스 출시나 성장 성공이 아니다.

조사: [MDN 가시성 시간](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API/Timing_element_visibility),
[W3C IntersectionObserver](https://w3c.github.io/IntersectionObserver/),
[W3C 데이터 최소화](https://www.w3.org/TR/privacy-principles/#data-minimization),
[sitemap 프로토콜](https://www.sitemaps.org/protocol.html).
기존 RPC·네이티브 관찰 API를 확장했으며 새 외부 계측 서비스나 의존성을 추가하지 않았다.
