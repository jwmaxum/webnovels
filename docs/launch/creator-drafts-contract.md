# 5단계 원고 저장·복구 계약

기록일: 2026-09-23. 상태: **로컬 구현·검증 완료 / 실제 DB·브라우저 통합 검증 대기**.

## 사용자 흐름

내 작품의 `원고 작성·복구` 또는 원고 작성 탭에서 작품을 선택한다. 새 원고는 빈 입력과 새 UUID로 시작한다. 제목·본문·작가의 말을 입력하면 700ms debounce로 기기에 저장하고 2.5초 후 서버 저장을 요청한다. 조합 입력 중에는 타이머를 멈추고 조합 완료 후 재개한다. Ctrl/Cmd+S, 원고 저장 버튼으로 바로 저장할 수 있다.

기기 저장과 서버 저장은 별도 표시한다. 작품 이동·화면 이동·페이지 숨김에서 기기 저장을 요청하고, 네트워크 재연결 시 열린 원고들을 동기화한다. 마지막 입력이 기기에 저장되지 않았다면 페이지 이탈 경고를 요청한다. 브라우저 강제 종료·OS 종료 시 마지막 비동기 저장의 완료까지 보장하지는 않는다. 모바일 집중 편집, Escape 종료, visualViewport 크기 대응과 상태 알림을 제공한다.

작품 상세에서 진입하는 버튼, 작품 선택, `prepareNewEpisodeForWork` 모두 같은 전환 함수를 사용한다. 회차 번호를 원고 식별자로 사용하지 않는다. `/creator/episodes?work=<작품 ID>&draft=<UUID>`로 진입하며, 미동기 기기 사본이 있으면 복구 목록을 펼친다. 새로고침 이후 여러 기기 사본 중 하나를 임의로 최신으로 판단하지 않고 사용자가 선택한다. 로그인 및 소유 작품 확인이 선행되어야 하므로 완전 오프라인 상태의 첫 로그인/첫 로드는 지원하지 않는다.

## 상태와 로컬 보존

- `DraftEngine`: 계정 UUID, 작품 ID, 초안 UUID, 탭별 branch UUID, 스냅샷, 수정 seq, localSeq, serverSeq, 기준 revision, 미확정 요청, 충돌 사본을 별도로 관리한다.
- 이전 원고 저장은 이전 context를 고정한다. 로드 epoch와 계정 세대로 늦은 응답을 차단한다. 서버 응답은 전송했던 seq만 확인하며 이후 입력은 계속 미동기로 남긴다.
- IndexedDB `webnovels-creator-drafts` 버전 2. 기존 `drafts`, `revisions`를 유지하고 `draftHeads`, `draftBackups`, `draftImports`를 추가한다. 탭마다 별도 head를 사용한다. request 성공이 아니라 transaction 완료를 기다린다.
- 기기 사본과 백업은 자동 삭제하지 않는다. 기기 저장 실패 시 오류와 다운로드 버튼을 제공한다. 복구·서식·실행 취소는 변경 전 사본 저장이 완료되어야 진행하며, 그 사이 새 입력이 발생하면 변경을 취소한다.
- 기존 `작가:작품:회차` 키는 서버에서 확인한 작가 ID 및 소유 작품에 일치하는 항목만 명시적으로 가져온다. 계정 UUID+기존 키→새 UUID 매핑으로 재시도를 처리하고 이전 버전도 복사한다. 원본은 삭제하지 않는다. `local-author`, 사용자명 등 소유자를 확인하지 못한 키는 임의 계정으로 가져오지 않는다.
- 이전 편집기 백업은 서버 작품 소유 확인 후 동일 작가/작품의 원고·버전만 JSON으로 내보낸다. 버전을 지정하지 않은 읽기 경로를 제공하되, 브라우저가 DB 업그레이드를 대기시키면 다른 탭을 닫아야 할 수 있다. 저장소 삭제/초기화를 복구 방법으로 사용하지 않는다. 소유 불명 자료는 원본을 보존하고 별도 신원 확인 후 이관해야 한다.

## 서버 API와 DB

`P0_API_ENABLED`, `AUTHOR_WORKS_ENABLED`, `AUTHOR_DRAFTS_ENABLED`가 모두 활성화되고 P0 잠금 및 확인된 APPROVED 작가 신원이 있어야 한다. 클라이언트가 보낸 작가/계정 ID는 받지 않는다. 변경 요청에는 같은 Origin이 필요하다.

| 요청 | 동작 |
|---|---|
| GET `/api/v2/creator/drafts?workId=…` | 해당 소유 작품의 원고 메타데이터 |
| GET `/api/v2/creator/drafts/:uuid?workId=…` | 현재 원고 스냅샷·revision·lifecycle·episodeId |
| GET `/api/v2/creator/drafts/:uuid/history?workId=…&before=…` | 불변 버전, 내림차순 20개; before로 이전 페이지 조회 |
| PUT `/api/v2/creator/drafts/:uuid?workId=…` | expectedRevision, title, content, authorComment; UUID Idempotency-Key 필수 |

작품 ID/revision은 bigint 정밀도를 보존하는 문자열이다. 제목 200자, 본문 200,000자, 작가의 말 5,000자로 제한하며 잘라서 저장하지 않는다. 클라이언트의 lifecycle, episodeId, 소유자, 결제/검수/공개 상태 변경은 허용하지 않는다.

`006_creator_drafts.sql`의 service-only `public.creator_drafts` RPC는 Auth·작가·작품 소유를 다시 확인한다. 작가·작품 상태·원고 행을 잠그고 revision 검사, 불변 revision 추가, 포인터 변경, 멱등 receipt를 한 트랜잭션으로 처리한다. 처음에는 expectedRevision=0이며 이후에는 직전 기준 revision이 필요하다. 동일 키/동일 payload는 당시 저장 revision을 반환하고, 같은 키에 다른 내용은 409다. SQL 함수와 테이블은 anon/authenticated에서 접근할 수 없다.

응답이 유실된 요청의 키와 정확한 payload를 먼저 기기에 저장하므로 재시도 시 새 요청으로 바꾸지 않는다. 복구한 사본도 이전 기준 revision으로 저장을 시도한다. 충돌 시 현재 로컬 입력과 원격 사본을 모두 보존하고 Diff에서 비교한 뒤 사용자가 현재 원고 또는 서버 원고를 선택한다. 현재 원고를 선택해도 새 서버 변경이 끼어들면 다시 충돌한다.

휴지통/제재 작품 및 ACTIVE가 아닌 원고는 서버 저장 불가다. 자신의 기존 원고/이력 조회는 보존한다. 서버 본문·공개 회차·예약·결제 상태는 이 API로 수정하지 않는다. 이전 브라우저 Supabase draft upsert와 Express fallback은 편집기에서 제거했고, 기존 어댑터도 명시적으로 거부한다. 과거 Express API 전체 정리는 10단계 전환 범위이며 운영 클라이언트의 대체 저장 경로로 사용하지 않는다.

## 세션과 발행

명시적인 로그아웃/로그인/가입 전 원고 checkpoint를 기다린다. 기기 저장 실패 시 계정 전환을 중단하여 다운로드 기회를 남긴다. 서버 미동기 원고가 있으면 기기 보존 사실을 알린다. 세션 만료/다른 계정 이벤트에서는 폼·비교 내용·목록·타이머·context 캐시를 즉시 비우고 이전 계정 키로 저장한다. 이 저장까지 실패하면 백업 다운로드를 요청하고 다운로드 확인을 안내한다. 새 계정 화면에는 이전 계정 사본을 표시하지 않는다.

발행 직후 물리적으로 로컬 원고를 삭제하던 코드는 제거했다. 기존 `authoring.drafts.lifecycle=PUBLISHED` 및 `episode_id`, 불변 publication_versions의 source draft/revision을 7단계 발행 트랜잭션에서 연결해야 한다. 5단계에서는 이미 연결된 보관 원고를 읽기 전용으로 처리하고 새 원고에 새 UUID를 부여한다. **실제 발행→보관→다음 회차 연결은 7단계 통합 검증 대기**이며, 임의의 로컬 발행 성공 표시를 만들지 않았다.

## 검증과 적용 조건

`npm run test:drafts`: engine 9개, IDB 대역/이관/Diff 4개, UI VM 대역 3개, API mock 4개, PGlite 합성 PostgreSQL 3개, 총 23개. Auth 9개, 기존 secure API 26개, Cloudflare 4개, 작품 API/UI/DB 17개 회귀 검사와 데이터 계약·타입·구문 검사도 수행했다. [검증 증거](../../artifacts/step5-draft-verification.json)에 명령과 소스 해시를 기록한다.

실제 IndexedDB 업그레이드/브라우저 quota/강제 종료, 모바일 키보드·IME·접근성, 여러 실제 기기, Supabase Auth/RLS/PostgREST 조합은 실행하지 않았다. `.agents/rules/testing_rules.md`에 따라 명시 요청 없는 localhost/브라우저 시험을 수행하지 않는다. 단위 대역의 성공을 브라우저 인수 성공으로 해석하지 않는다.

적용 순서:

1. 앞 단계의 실제 스키마·신원 매핑 조사 및 백업 복원 검증을 마친다. 기존 관리 API 401 의존성이 해소됐다고 가정하지 않는다.
2. 검토 게이트와 authoring-005를 확인한 뒤 006을 적용한다. 운영 SQL 일괄 실행이나 자동 seed는 하지 않는다.
3. service-only RPC 권한, 계정 간 격리, 멱등 재전송, 동시 저장, 기존 원고 이관을 스테이징에서 검증한다.
4. 위 실제 브라우저/기기 인수 조건을 확인한 후에만 기능 플래그를 활성화한다. 기본값은 false로 유지한다.
5. 롤백은 플래그를 내려 서버 저장을 닫고 기기 백업 경로를 유지한다. 새 DB 테이블, 이력, receipt, 기존 IndexedDB 원본을 삭제하거나 예전 무조건 upsert로 되돌리지 않는다.

다음은 6단계 파일 가져오기·표지·내보내기 로컬 개발이다. 2~5단계의 실환경 인수와 서비스 오픈 승인은 아직 완료되지 않았다.
