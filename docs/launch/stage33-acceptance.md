# 33단계 — 등록 적용과 신규 공개 경로 검증

2026-10-21. 현재 Supabase DB를 유지한다. **웹소설·웹툰 등록 지원은 실제 DB에 적용했고,
신규 공개 경로는 코드·로컬 검증까지 완료한 상태다.** 공개 서비스의 hosted 인수는 남아 있다.

## 실제 적용

- `launch/010_multiformat_registration.sql`: 기존 005 작업실에 015의 작품별 유형·소유권·
  멱등 계약을 재사용한다. 하나의 Author에서 NOVEL/WEBTOON 모두 생성할 수 있다. 유형 변경은
  거절하며 같은 생성 키의 제목/유형 변경은 충돌로 처리한다. 과거 발행작 변경은 계속 차단한다.
- `launch/011_new_serial_foundation.sql`: 현재 작품 30개·회차 180개 ID를 불변 기준으로 기록한다.
  이후 검증된 생성 RPC가 새 생성 receipt를 기록할 때만 신규 작품 범위에 등록한다. 과거 요청
  재시도·관리자 직접 INSERT·과거 작품에 새 회차 추가는 편입 조건이 아니다.
- `.env.local`의 기존 연결을 사용해 새 논리/native 백업을 만들고, 적용 직전 public·authoring·
  launch_recovery 및 Auth users/identities 전체 행 CAS를 검사했다. 중간 변경은 전체 SQL을 중단한다.
- 적용 후 실제 DB 105개 기존 테이블의 원래 열/행 해시가 백업과 일치했다. 원고 6개·버전 21개,
  Auth·작가 연결과 두 과거 본문 경로를 보존했다. 추가 migration 기록/신규 범위 테이블은 별도다.
- 실제 service_role API에서 계정·작업실·복수 유형 등록 readiness가 모두 `true`다. 공개 활성화
  값은 `false`이고 P0 잠금 표식은 생성하지 않았다. 운영 데이터로 만든 테스트 작품도 없다.

증거: [논리 백업 집계](../../artifacts/stage33-data-backup.json),
[native 백업 집계](../../artifacts/stage33-native-backup.json),
[원본 복원 대조](../../artifacts/stage33-data-restore.json),
[적용·리허설·실제 사후 검증](../../artifacts/stage33-acceptance.json).
원본 백업·원고·계정 행과 비밀은 `scratch`의 비공개 파일로 보존하고 Git에 넣지 않는다.

## 신규 무료 공개 후보

`scripts/prepare_stage33.mjs`의 `publicationFiles` 순서가 실제 의존 순서다.
`launch/013_free_serial_prerequisites.sql` → authoring 002/007/008/009/010/011/
012/013/014/015/021/022 → **마지막에** `launch/012_new_serial_publication_scope.sql`.
번호만 정렬하여 실행하지 않는다. `--apply`는 **등록용 010/011만** 적용한다.

013은 실제 legacy DB에서 없는 회차/댓글 수정 시각, 검토자/신고 처리자 열을 보완한다.
과거 수정 시각은 null로 남기고 새 작성 이후 기본값을 설정한다. 문자열로 보존된 과거 댓글/
신고 사용자 ID는 변환·추정 연결하지 않는다. 009/010은 검증된 UUID와의 비교만 문자열로
정규화하며 댓글 목록의 SQL 별칭/변수 충돌을 제거한다.

012는 공개본 version/head와 일치하는 신규 작품만 `stage8_visible`로 통과시킨다. 이 공통
판정이 탐색·목록·본문·댓글·이미지와 SEO/sitemap의 `stage18_work_rows`에 적용된다. 표지
경로에도 같은 조건을 추가한다. metadata RLS는 제한 정책과 열별 SELECT를 사용하고,
옛 `secure_episode_contents` REST 본문 접근은 service_role에서도 닫는다. 공개본 insert/
head 변경 트리거는 과거 범위 우회를 차단한다. 예약 워커는 과거 대기 예약을 변경하거나
재시도 횟수를 소모하지 않고 건너뛴다.

`NEW_SERIALS_ENABLED` 경로는 실제 `new_serials_ready()`와 서식/변경 검토·웹툰·독자/작가
필수 기능 설정을 확인한다. 공개 설정 일부를 끄면 503으로 닫히며 옛 본문으로 대체하지 않는다.
별도의 기존 P0 전환 경로는 유지하지만 scoped DB에서 옛 본문을 읽을 권한은 없다.

## 검증 범위와 남은 인수

합성 PostgreSQL 테스트는 같은 작가의 양방향 등록, 중복/유형 충돌, 타인/정지 계정 거절,
첫/예약 발행, 기존 공개본 변경 검토, 역할별 metadata·본문 접근, 이전 웹툰 head/표지/이미지/
대기 예약 격리, 관리자 직접 생성의 미편입, 재실행·공개 중단 시 자료 보존을 검사한다.

실제 백업 105개 테이블·1,418개 행을 격리 복원한 뒤 등록과 무료 공개 SQL 전체를 적용했다.
테스트 트랜잭션에서 신규 발행·독자 본문/탐색/댓글·공개 후 검토를 실행하고 rollback했다.
원래 열/행·초안·버전의 동일성을 다시 대조했다. 이는 **별도 hosted Supabase 복원, 실제 Auth
세션, 다중 DB 연결, Storage 파일 바이트, Cloudflare Images, Cron, 브라우저 인수의 대체가 아니다.**

현재 적용은 등록/범위 준비에 한정된다. Storage 3개 버킷·Images·예약 Worker, 나머지 공개 SQL,
위 기능 플래그는 실제 인수 후 순서대로 적용한다. GitHub main push는 Cloudflare Pages 코드
배포만 연결하며 별도 Worker Cron 배포를 의미하지 않는다. Vercel 배포는 하지 않는다.

공개 전환을 되돌릴 때는 DB 공개 활성화와 공개/발행/Cron부터 닫는다. 새 원고·버전·등록
receipt·범위 기록·검토 이력을 삭제하지 않는다. foundation 재실행으로 신규 작품을 과거 범위로
재분류하지 않으며, 예전 005 함수나 오래된 백업을 덮어쓰지 않는다.

다음 34단계는 [저작권 확약·PASS 본인확인·복수 ID/필명 가입](../../improve34.md)이다.
제공자 계약과 LIVE 인수 전에는 가입 인증이 완료된 서비스로 안내하지 않는다.

## 코드 검증 결과

[검증 기록](../../artifacts/stage33-verification.json)에 전체 릴리스 항목, 컴파일·타입·Functions
번들, 역할/소유권·보존·UI 회귀 결과를 기록했다. 초기 전체 명령은 신규 합성 표지 fixture의
UUID/text 파라미터 문제로 중단됐고, 수정 후 33단계와 남은 모든 릴리스 항목을 재실행해 통과했다.
마지막 API/Auth/UI 43개와 선별 coverage 36개가 통과했다. 변경 서버 4파일의 라인 90.51%,
분기 78.46%, 함수 95.45%이며 전체 저장소 coverage로 해석하지 않는다. 별도 lint gate는 없다.
