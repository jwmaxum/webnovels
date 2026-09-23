# 7단계 미리보기·무료 게시·예약 계약

기록일: 2026-09-23. **로컬 구현·합성 DB 검증 진행 / 실제 Supabase·Cloudflare Cron·브라우저 인수 대기**.

[명칭 계약](author-creator-contract.md), [작품](creator-works-contract.md), [원고](creator-drafts-contract.md), [파일](creator-files-contract.md) 계약을 따른다. 작가 신원은 서버가 검증한 `actor.author`이고 UI/API 이름은 기존 Creator 계열을 유지한다. 이 문서는 이전 분석 문서의 제안을 7단계의 실제 코드·제한으로 구체화한다.

## 게시 흐름

1. 작가는 ACTIVE 초안을 서버에 저장한다. 미리보기는 편집기의 현재 계정·작품·원고 ID와 서버 revision·본문을 대조한 뒤 공용 `ReaderContent` 렌더러를 사용한다. PC/모바일 폭을 전환할 수 있다.
2. 작품 소개·장르·확인된 등급/AI 표기, 회차 번호, 원고 제목·본문·작가의 말·무료 정책·권리 확인을 요약한다. 등급 자동 판정이나 AI 자동 검수를 약속하지 않는다. 초기 신규 게시에는 ALL/AGE_15 NOVEL만 허용하고 AGE_19 및 신규 유료/광고 회차는 거절한다. 기존 유료 회차의 정책은 변경하지 않는다.
3. `POST /api/v2/creator/publications/publish/:draftId?workId=…`는 저장된 특정 revision을 사용한다. 원고 본문은 요청에서 받지 않는다. 같은 요청 UUID와 payload는 동일 공개본/예약 결과를 반환한다. 회차 번호는 DB가 max+1로 제안하고 작품 잠금·`(work_id,episode_number)` 유일 제약으로 경쟁을 막는다. 결번을 배열 길이로 추정하지 않는다.
4. 즉시 게시와 공개본 재게시에서 회차 본문·보호 본문 mirror·`publication_versions`·`publication_heads`·초안 lifecycle·작품 공개 상태가 한 DB 트랜잭션에서 바뀐다. 기존 공개본 편집은 `begin-edit`가 만든 별도 ACTIVE 초안에서 수행한다. 기존 유료 회차를 재게시할 때 접근 정책을 유지한다. 이전 방식의 공개 회차에 head가 없으면 현재 보호 본문을 최초 불변 버전으로 보존한 뒤 초안을 만든다. 보호 본문이 없거나 형식이 맞지 않으면 자동 수정하지 않고 검토 오류를 반환한다. 초안 저장 중 독자에게는 이전 head가 유지된다.
5. 응답이 유실되면 탭의 `sessionStorage`에 남긴 요청 키와 정확한 payload로 다시 확인한다. 성공이 확인되면 보관 원고를 읽기 전용으로 표시하고, 다음 회차는 새 UUID 초안을 연다. 탭 저장소가 사라졌다면 원고·공개 목록을 먼저 조회해야 하며 임의 새 요청으로 중복 게시하지 않는다.

## 예약

- UI는 한국 시간(UTC+9) 또는 UTC 입력을 명시하고 UTC ISO 시각을 서버로 보낸다. 서버는 최소 2분 뒤부터 1년 이내만 허용한다. 예약은 불변 publication version을 가리킨다. 예약 후 원고의 새 수정은 대상 버전을 바꾸지 않는다.
- `scheduler/worker.mjs`는 Pages와 분리한 Cloudflare Cron Worker다. HTTP 요청은 404이며 cron만 service key로 `run_creator_schedules` RPC를 호출한다. 1분 주기 배치 최대 20건이다. DB 함수는 작품→상태→회차→예약 순으로 잠그고 시각·작가 상태·이용등급·필수 작품 정보·제재를 재확인한다. 실행 중 프로세스 중단으로 DB 트랜잭션이 완료되지 않으면 작업은 PENDING으로 남는다. 반복 실행은 SUCCEEDED를 건너뛴다.
- 일시적 전이 오류는 원자적으로 롤백하고 1/2/4/8분 뒤 최대 5회 재시도한다. 제재·휴지통·공개 상태 불일치 작품은 FAILED와 사유를 남기고 공개하지 않는다. `authoring.schedule_events`는 생성·변경·취소·성공·재시도·실패를 보존한다. Worker 로그에는 실패 건수만 남기며 원고 내용은 기록하지 않는다. 실제 운영 알림 연동과 지연 감시는 배포 인수 항목이다.
- 예약 시각 변경·취소는 generation 조건을 요구한다. 실행과 경쟁하면 작품/예약 잠금에서 한쪽 결과만 확정된다. 실패한 예약은 문제 해소 후 새 시각으로 재시도하거나 취소할 수 있다. 취소해도 버전·원고를 삭제하지 않으며, 미공개 초안은 다시 ACTIVE로 편집할 수 있다. 번호를 예약했다가 취소한 회차 행은 보존하며 동일 번호로 다시 예약·게시할 수 있다.

## 독자 접근과 캐시

- 기능 플래그가 켜진 경우 새 게시의 독자 본문은 `/api/v2/episodes/:id/content`의 공개/등급/소유권 검사를 거쳐 가져온다. 공개 회차는 기존 메타데이터 RLS에 따라 목록에 나타나고, 비공개·제재·휴지통·예약 회차는 공개되지 않는다.
- 독자 화면과 미리보기는 동일한 텍스트/작가의 말 렌더러를 사용한다. HTML을 실행하지 않으며 연속 빈 줄·한글·따옴표를 보존한다. 게시 또는 비공개 전환 뒤 현재 탭의 작품 캐시를 갱신하고, 독자 탭이 다시 보이거나 회차를 열 때 목록을 갱신한다. 이미 열린 독자 화면은 서버 상태를 실시간으로 구독하지 않으므로 즉시 강제 제거는 보장하지 않는다.
- 작품 전체 비공개·휴지통 전환은 기존 `creator_works` API를 사용한다. 해당 API가 PENDING 예약을 취소하며 공개 목록·본문 권한은 같은 작품 상태를 검사한다.

## 적용·검증 경계

`P0_API_ENABLED`, `AUTHOR_WORKS_ENABLED`, `AUTHOR_DRAFTS_ENABLED`, `AUTHOR_PUBLISH_ENABLED`가 필요하다. 모든 예제 플래그는 기본 false다. 2~6단계 실환경 백업·Auth 매핑·권한·Storage/Images 검증을 마치고 007 이후 008을 검토 적용한다. 운영 DB/Worker에는 이번 로컬 작업으로 적용하지 않는다. DB 적용 뒤 RPC 권한과 PostgREST 스키마 갱신을 확인하고 Worker의 Supabase URL/service secret을 별도로 설정한다. Worker와 Pages를 모두 활성화하기 전에 스테이징에서 중복 cron·취소 경쟁·제재·실제 다른 계정·브라우저 종료 후 예약 실행을 확인한다.

`npm run test:publication`은 공용 렌더러, UI 대역의 응답 유실 재시도, API/권한 대역, Cron 호출 대역, PGlite 합성 PostgreSQL의 트랜잭션/중복/예약/수정/취소/재시도를 검사한다. 실제 Cloudflare cron 배포, Supabase DB/RLS·PostgREST, 브라우저 PC/모바일 미리보기·다음 회차 재접속, 모니터링 알림은 이 테스트로 증명되지 않는다. localhost/브라우저 검증은 프로젝트 규칙에 따라 명시 요청이 있을 때만 한다.

롤백은 Pages와 Worker의 게시 플래그를 내리고 cron 실행을 중지한다. 공개본·버전·receipt·초안·예약·운영 이벤트를 삭제하거나 이전 직접 DB 게시 경로로 되돌리지 않는다.
