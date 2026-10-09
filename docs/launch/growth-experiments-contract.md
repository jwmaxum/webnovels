# 21단계 발견·성장 계약

2026-10-09. [실행 계획](../../improve21.md), [독자 탐색](reader-discovery-contract.md),
[명칭·호환](author-creator-contract.md), [관리자 업무](admin-workflow-contract.md),
[웹툰](webtoon-contract.md)을 확장한다. 기존 Cloudflare·private RPC를 사용하며 새 외부 의존성은 없다.

## 실행 범위와 권한

`GROWTH_SERVICE_ENABLED`, `P0_API_ENABLED`, `AUTHOR_PUBLISH_ENABLED`, `READER_SERVICE_ENABLED`,
`READER_DISCOVERY_ENABLED`가 모두 문자열 `true`여야 API/UI가 열린다. 기본은 false다.
웹툰 노출은 기존 웹툰 게이트도 만족해야 한다. 실제 SQL/기능 활성화는 수행하지 않았다.

| 경로 | 읽기 / 쓰기 | 신원·권한 |
|---|---|---|
| `/api/v2/reader/growth` | GET feed(비기록), preferences / POST feed, save-preferences, reset | GET feed 익명 가능, 나머지 서버 검증 ACTIVE 독자 |
| `/api/v2/creator/growth?workId=…` | GET report | APPROVED 작가의 소유 작품만; Auth UUID와 author bigint 별도 |
| `/api/v2/admin/growth` | GET admin / POST configure, evaluate, decide | 현재 활성 SUPER_ADMIN; SQL에서 신원·권한 재검사 |
| `/api/v2/growth/seo` | GET | 공개 무료 메타데이터만 |
| `/share/:id`, `/sitemap.xml` | GET | 같은 P0 marker·공개 predicate; 플래그/원본 오류는 503 |

모든 쓰기는 정확한 Origin, 엄격한 키/자료형/숫자 범위를 검사한다. 요청의 userId/authorId/variant는
받지 않는다. 민감 응답은 no-store이며 Auth UUID·원고 본문·private asset URL을 반환하지 않는다.
growth 스키마의 직접 접근은 anon/authenticated/service_role 모두 막고 서비스 전용 definer RPC만 연다.

## 추천과 동의

홈의 별도 신인 영역은 최초 공개 시각이 최근 30일인 공개 무료 작품을 대상으로 한다.
작가당 1작품, **주 장르**당 최대 3작품, 총 8작품으로 제한한다. 추천 이유를 표시하며
장르 제외·OFF/WEEKLY/DAILY 알림 선호·추천 초기화를 제공한다. 이번 단계에 알림은 발송하지 않는다.
초기화는 분석 동의·관심작·열람 위치·기존 뷰어 설정을 바꾸지 않는다.

분석 동의 기본 false. 동의 이후 기록만 쓰며 철회하면 새 집계에서 제외하고 해당 카드 제공 기록을
삭제한다. 재동의는 새 metricsSince를 사용한다. 기존 reader_events_v2/관심작/초안/원장은 보존한다.
동의한 POST feed의 응답 카드를 SERVER_PROVIDED_NOT_VIEWPORT로 기록한다.
사용자·작품·KST일·실험별 중복을 제한하고 오래된 기록은 Cron마다 최대 1,000개 삭제한다.
90일 초과 삭제는 Cron 실행에 의존하므로 실제 삭제 지연 모니터링은 인수 조건이다.

실험은 정책 버전별 Auth 기반 결정적 CONTROL/NEWCOMER 배정이다. 동일 필터와 작가/장르 제한 아래
CONTROL은 작품 번호 역순, NEWCOMER는 최초 공개 시각 역순이다. **유효한 대조 실험이나 개선 성공을
증명하지 않는다.** 작가/주 장르 제한에 따른 미노출·소수 장르와 공급 수를 실제 표본으로 검토한다.
실험과 동의가 있을 때 정책의 콘텐츠 유형으로 추천 대상을 제한한다.

## 지표 정의

- OPEN/COMPLETE는 기존 서버 검증 **진행률 요청 대리지표**다. >=90% 요청을 COMPLETE로 기록하며
  체류시간·실제 독서·봇 제거를 보장하지 않는다. Auth 확인/비익명/미차단·ACTIVE 독자·동의와
  현재 공개 무료 head를 다시 검사하며 작품 소유 작가 본인을 제외한다.
- 최근 14일의 사용자/회차 쌍을 OPEN·COMPLETE로 중복 합산하지 않는다. 고유 독자 5명 미만은
  수치와 완독 대리 비율을 숨긴다. 기존 제안의 3,000뷰와 새 고유 독자 수는 서로 다른 지표다.
- 현재 관심은 동의 후 등록된 현재 남아 있는 행만 센다. 해제된 행의 과거 전환율은 복원하지 않는다.
- 작품별 D0는 동의 후 최초 기록된 현재 유효 회차 열람의 KST 날짜다. **KST Return On D7/D28**는
  정확히 D0+7/+28일에 열람했는지 센다. 대상일 종료 이후만 분모에 넣으며 EMPTY/PENDING/
  INSUFFICIENT/READY와 null을 구분한다. 서비스 첫 가입/첫 이용 또는 과거 공개 상태를 재현하는 지표가 아니다.
- 카드 제공 후 7일 열람은 관찰을 마친 카드 제공 사용자/작품에 대한 후속 열람이다. 실제 화면 노출·
  외부 유입·첫 열람 전환으로 표시하지 않는다. 외부 출처/첫 열람 퍼널은 22단계 계측 범위다.
- 017 이후 공개 head의 새 회차와 기존 head 교체를 분리해 기록한다. 기존 공개본은 BASELINE이며
  새 공급으로 계산하지 않는다. 연재 지속은 완료된 KST 7일 구간 두 개에서 앞 구간에 새 회차를
  공개한 작가 중 뒤 구간에도 공개한 비율의 분자/분모다. 14일 관찰 전·작가 5명 미만은 숨긴다.
  관리자 작품 목록은 최근 50개 표본이며 전체 장르 공급 분포로 오해하지 않도록 표시한다.

날짜·표본 처리 참고: [Amplitude 달력 재방문](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-time),
[미성숙 표본](https://amplitude.com/docs/analytics/charts/retention-analysis/faq),
[PostgreSQL 시간대](https://www.postgresql.org/docs/current/functions-datetime.html).

## 후보 dry-run과 재실행

정책은 HYPOTHESIS이며 seed가 없다. 가설·고정 대조 규칙·최대 90일 기간·비용 예산·타입과 각
분모/표본/기준을 최고 관리자가 입력한다. 같은 버전의 다른 config, 같은 타입의 열린 실험 기간
중복은 거절한다. KEEP/CHANGE/STOP·관찰 표본/일수/비용·재방문/공급/편향 근거는 불변 기록으로 남긴다.
이 수기 판단은 실사용 실험 인수나 출시 GO가 아니다.

소설은 현재 무료 immutable 공개본의 PostgreSQL char_length(공백 포함)를 사용한다.
웹툰은 검증된 manifest의 공개 회차와 원본 이미지 수를 별도로 표시하며 소설 글자 조건은 0이어야 한다.
로드맵의 10화/45,000자/3,000뷰/100관심/65%는 미확정 가설이다. 실제 분포·부정 트래픽·편중을
검토해야 하며 유료 공개본·비공개 초안·구매/권리 원장을 후보 평가에 포함하지 않는다.

평가일은 KST 오늘, cutoff는 KST 0시이며 그 전에 공개 head가 있는 작품만 평가한다.
평가 당시 **현재** 공개 상태·Auth·동의·관심 행에서 cutoff 이전 기록을 집계한다.
과거 상태/취소된 관심을 완전히 재구성한다고 주장하지 않는다. 공개 head UUID와 기준을 snapshot에 보존한다.
작품/KST일/정책 버전 고유 키와 xact advisory lock으로 같은 평가 snapshot과 DRY_RUN outbox를 재사용한다.
현재 영속 등급 매핑이 없으므로 previousTier=UNCLASSIFIED, tierRevision=0을 명시하고
기준 충족도 HYPOTHESIS_MATCH_MAPPING_REQUIRED로 남긴다. 실제 등급/권한/독점/유료화 변경과 발송은 없다.

Cloudflare minute Cron은 별도 기본 false gate로 최대 20작품을 처리하고 다음 tick에서 미평가 작품을
찾는다. 발행 작업 오류와 성장 작업은 독립 실행한다. 누락된 과거 날짜의 자동 catch-up·실제 DB 경합을
보장하지 않는다. [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).
실제 승격은 검증된 이전 등급 CAS·새 outbox 상태/수신자·권한 재확인·발송 멱등과 별도 승인이 필요하다.

## 공유·검색과 운영 인수

GROWTH_CANONICAL_ORIGIN은 자격 증명/경로/쿼리 없는 고정 https origin이다. 공유 페이지는 제목·설명·
canonical/OG와 공개 표지의 안전한 URL만 escape해 반환한다. private signed URL·외부 임의 이미지는 제거한다.
공유 페이지는 noindex, follow이며 canonical은 `/works/:id`다. 22단계의
[계측·검색 계약](growth-measurement-contract.md)이 기존 1,000작품 전체 sitemap을 index와
ID 구간별 최대 1,000작품 child로 확장한다. 성장 SEO 활성화에는 검토된 018도 필요하다.
[Google sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

017은 검토된 015·P0/Auth 매핑·백업/격리 복원을 확인하고 review gate 세션에서 별도 적용한다.
016 결제 SQL은 필요하지 않다. rollback은 새 플래그를 끄고 관찰/정책/snapshot을 보존한다.
실제 RLS/PostgREST·Cron/삭제 지연·공유 crawler·동의 철회·장르 편향·28일 실제 표본·성장 비용·
KEEP/CHANGE/STOP 판단은 실환경 인수 대기다. localhost/브라우저 검증은 명시 요청 전 실행하지 않는다.

22단계는 별도 동의의 신고 기반 화면 노출/공유 표식·첫 본문 제공과 sitemap 분할을 구현했다.
다음 23단계는 기존 무료 출시 차단과 실제 DB/복원/권한 인수를 먼저 해소하고,
승인된 무료 서비스의 동의 표본과 28일 대조 실험을 관찰한다. 실제 배지 승격은 등급 매핑/CAS/알림 인수 후 분리한다.
