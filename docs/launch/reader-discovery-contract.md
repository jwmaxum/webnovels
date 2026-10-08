# 16단계 — 독자 탐색·공개 회차·마지막 위치 계약

2026-10-09. 로컬 구현·대역/합성 PostgreSQL 검증 대상이며 실제 Supabase 적용, 배포, 플래그 활성화와 브라우저 인수는 별도다. 기존 [명칭](author-creator-contract.md), [게시](creator-publication-contract.md), [독자 활동](creator-reader-operations-contract.md), [연재 방식](creator-distribution-contract.md) 계약을 유지한다.

## API와 공개 범위

기존 exact route `GET /api/v2/catalog`의 무쿼리 `{works,episodes}`는 호환 경로로 보존한다. 새 화면은 다음 action을 사용하며 전체 작품/회차를 한 번에 받지 않는다. `P0_API_ENABLED`, `AUTHOR_PUBLISH_ENABLED`, `READER_SERVICE_ENABLED`, 기본 false `READER_DISCOVERY_ENABLED`가 필요하다. 새 RPC 장애/미적용을 무쿼리 카탈로그나 직접 DB 경로로 우회하지 않는다.

| action | query | 응답 |
| --- | --- | --- |
| home | action만 | `{sections:{recommended,popular,new,completed},ranking}` |
| list | q,genre,status,epRange,rating,반복 tag,sort,type,limit,cursor | `{works,nextCursor,ranking}` |
| work | workId | `{work}` |
| episodes | workId,limit,cursor | `{episodes,nextCursor}` |
| chapter | workId,episodeNumber | `{episode,previous,next}` |

`limit`은 기본 24, 최대 50이고 home section은 최대 8개다. ID는 bigint 범위의 양의 10진 문자열이며 회차 번호는 실제 양의 정수다. 미허용/중복 query를 거절하고 tag만 반복을 허용한다. 검색은 제목·작가 표시·소개에 대한 리터럴 부분 검색이다. `%`, `_`, 역슬래시는 SQL wildcard로 실행하지 않는다. 검색어는 최대 100자, 장르·태그는 각각 최대 40자, 태그는 최대 10개 AND 조건이다.

기존 snake_case 작품/회차 메타데이터를 유지한다. 요약에는 `episode_count`, `first_published_at`, `last_published_at`, `ranking_readers`를 추가하며 회차 배열·본문을 포함하지 않는다. 상세에는 소개와 `firstEpisodeNumber`를 포함한다. 회차에는 `versionId`와 공개 시각을 포함하며 본문은 기존 content route에서 별도로 받는다. chapter는 결번·유료·예약·미공개·head가 없는 회차를 건너뛰는 실제 앞뒤 공개 회차를 반환한다. 대상 회차가 없으면 404다.

DB의 공통 predicate는 기존 work_state 공개 상태, 미휴지통·CLEAR 제재, 공개 작품 상태와 NOVEL·ALL/AGE_15·성인 장르 제외를 결합한다. 회차는 PUBLISHED, 예약 시각 도래, is_free=true, access_policy=FREE, 현재 immutable publication head/작품 연결을 통과해야 한다. WEBTOON 필터는 받아도 현재 출시 범위에서는 빈 목록이다. 다른 기능의 유료/성인 권한을 새 탐색 경로로 개방하지 않는다.

## 정렬·인기·커서

`latest`는 현재 공개 head 중 최신 공개 시각, `new`는 작품 최초 공개 시각, `episodes`는 현재 열람 가능한 공개 회차 수, `popular`는 최근 7일 인증 독자 고유 수다. `views`는 popular의 호환 별칭이다. 정렬은 scalar key와 bigint 작품 ID로 결정하고 동일 값에도 페이지 경계가 일정하다. 회차는 회차 번호·회차 ID 오름차순이다. 미집계/최소 5명 미만 작품은 `ranking_readers=null`이며 실제 인기 목록에서 제외한다. 편집 추천 `is_top_recommended`는 실제 인기와 별도다.

인기 집계는 OPEN/COMPLETE 이벤트의 사용자 중복을 제거하고 작품 작성자 본인, 비활성 독자, 미확인 이메일·익명·차단 계정을 제외한다. 응답 `ranking={periodDays:7,minSample:5,asOf,metric:'uniqueReaders'}`를 화면에 표시한다. 이 지표는 인증 이벤트의 근사치이며 실제 완독·구매·전환율을 뜻하지 않는다. 작품 등록 시각과 최초/최근 공개 시각을 혼용하지 않는다.

커서는 base64url로 전달하는 버전 1 구조다. API가 action/검색 필터 지문/asOf/정렬 key/ID를 확인하고 DB에는 검증된 값만 전달한다. 다른 작품·검색·정렬에 재사용하면 400이다. 페이지 크기는 변경할 수 있다. 검색 조건에 권한을 넣지 않으며 커서가 공개 범위를 넓힐 수 없다. 집계 시각과 새 공개의 경계는 다음 페이지에도 유지한다. 현재 head 변경, 작품 비공개·제재·활성 독자 상태 변경에 대한 과거 DB snapshot을 보존하지 않으므로 페이지 도중 행이 빠지거나 재정렬될 수 있다. 새로고침으로 최신 목록을 시작한다.

## 공개 비독점 링크

전용 공개 응답의 `distribution`은 공개 무료 회차가 있는 NON_EXCLUSIVE 작품에만 `{mode:'NON_EXCLUSIVE',externalLinks:[{label,url}]}`다. UNSET/EXCLUSIVE_INTEREST는 null이며 기존 작품을 자동 비독점으로 분류하지 않는다. 링크는 기존 14단계 HTTPS 정확한 플랫폼 host 검증기를 재사용해 저장값까지 다시 검사하고, 라벨은 서버의 고정 host 맵으로 만든다. 잘못된 저장 링크 묶음은 외부 링크를 생략한다. 서버는 링크를 가져오지 않는다.

선언 version/declaredAt/권리 확인/비공개 설정·감사 이벤트·작가 Auth UUID는 공개 응답에 넣지 않는다. 독점/오리지널 인증이나 외부 서비스의 계약 승인으로 표시하지 않는다. 새 링크 UI는 HTML 텍스트 삽입과 검증된 URL만 사용하며 새 탭 링크에 `noopener noreferrer`를 둔다.

## 공개본과 마지막 위치

브라우저의 작품 제목·설명·Open Graph 메타는 해당 공개 응답으로 갱신하고 작품 이탈/오류 때 초기화한다. 현재 정적 SPA이므로 JavaScript를 실행하지 않는 외부 공유 크롤러용 서버 메타 렌더링은 제공하지 않는다. 실제 공유 미리보기 인수와 필요 시 서버 렌더링은 19단계 출시 검증에 포함한다.

플래그가 켜진 `/api/v2/episodes/:id/content`는 소유 작가를 포함한 독자 모두 service-only `stage16_episode_content`를 통해 같은 DB snapshot의 현재 head 본문과 `versionId`를 함께 받는다. 새 경로는 공개 무료 출시 범위만 받으며 공개본문 오류를 레거시/private mirror로 대체하지 않는다. 작가 스튜디오의 미리보기는 기존 `preparePublication`의 소유 원고 snapshot과 `ReaderContent.render` 경로를 유지한다. 발견 플래그가 꺼진 기존 content route의 소유 작가 비공개 열람 호환은 유지한다.

같은 reader hub의 activity/progress만 service-only `stage16_reader`로 전환하고, 나머지 활동 RPC를 유지한다. progress POST는 기존 `progress`와 선택적 `position={versionId,paragraphIndex,offset}`만 받으며 Auth UUID는 서버 actor에서 결정한다. offset은 문단 안 0~1 상대 위치, 문단 번호는 CRLF/CR→LF 정규화 후 `\n\n`로 나눈 ReaderContent 렌더러의 0 기반 인덱스다. 빈 문단도 같은 인덱스를 차지한다. 서버는 현재 head와 version/episode/work 연결, 문단 범위·무료/공개 범위를 검사하며 head 공유 잠금을 위치 쓰기 완료까지 유지한다.

기존 최대 progress는 greatest로 보존하고 마지막 위치는 별도 필드에 저장한다. 낮은 위치로 돌아가도 최대 진행률을 낮추지 않는다. position 없는 기존 요청은 위치를 지우지 않는다. activity는 episodeId와 저장 위치를 반환한다. 공개본이 바뀌면 `position=null,positionChanged=true`로 반환하고 이전 저장 버전·최대 진행률은 보존한다. 새 공개본의 처음 위치로 안내한 뒤 실제 이동으로 새 위치를 저장한다. 웹툰 패널 위치는 18단계에서 별도 확장한다.

## 적용·검증·복구

[013 SQL](../../database/authoring/013_reader_discovery.sql)은 검토 적용된 009와 012 및 `webnovels.authoring_apply_verified=true` 세션을 요구한다. 번호만으로 미적용 SQL을 일괄 실행하지 않는다. 원본 DB/Storage 백업과 복원, Auth ID 매핑, private 권한, 기존 공개 회차의 immutable head 보존·연결을 먼저 확인한다. head 없는 기존 공개 회차는 새 독자 목록/본문에서 나오지 않으므로 7단계의 검토 이관을 먼저 인수한다.

로컬 API/합성 PGlite 검증은 운영 PostgREST RPC/RLS, Cloudflare 배포·캐시, 실제 모바일/PC·다른 기기 이어보기, 대량 데이터 query plan/응답 시간을 증명하지 않는다. 운영 인수에서 대표 대량 데이터의 EXPLAIN/시간 제한과 페이지 크기, 실제 계정 간 활동 격리, 공개 철회·재게시·예약 경합, 외부 URL와 URL 복원/키보드 흐름을 검증한다. localhost/브라우저는 프로젝트 규칙의 명시 요청 조건을 따른다.

롤백은 새 발견 플래그를 끄며 이전 공개 목록/활동 경로는 유지한다. 새 위치 필드·공개본·기존 max progress·링크/권리 선언/이력을 삭제하거나 기본값으로 덮어쓰지 않는다. 다음 개발은 17단계 관리자 검수·제재·감사·출시 운영 흐름이다.

## 조사 근거

새 검색·페이지·링크 의존성은 추가하지 않고 기존 RPC/검증기를 확장했다. PostgreSQL의 [LIMIT/정렬 기준](https://www.postgresql.org/docs/current/queries-limit.html), [row 비교의 null 처리](https://www.postgresql.org/docs/current/functions-comparisons.html), [LIKE escape](https://www.postgresql.org/docs/current/functions-matching.html)를 확인했다. 공식 문서 웹 채널은 사용 가능했으며 npm/gh 실행 채널은 현재 PATH에 없었다. 기존 설치된 PGlite와 Node를 합성 검증에 사용한다.
