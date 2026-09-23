# 1단계 — 기능·권한·삭제 대상과 출시 기준선 확정

[전체 계획](improve.md) · 다음: [2단계](improve2.md)

## 목표와 선행 조건

기준 분석 문서를 실제 호출 관계와 대조해 무엇을 작가에게 옮기고 무엇을 관리자에게 남길지 확정한다. 이 단계에서 기능을 대량 삭제하지 않는다.

## 현재 근거와 수정 대상

- `public/index.html`: 관리자/작가 메뉴, 공용 모달, 인라인 이벤트.
- `public/js/admin/admin.js`: 작품·회차 등록/수정/삭제, Action Queue, 신고, 운영 함수.
- `public/js/creator/creator.js`: 관리자 등록 모달 호출, 7개 탭, 클라이언트 작품 필터.
- `public/js/core/router.js`, `public/app.js`, `public/supabase-admin.js`: 라우트·초기화·직접 DB 호출.
- `src/routes/*`, `server/secure-api.mjs`, `functions/api/*`, `database/*`: 신구 API·스키마.
- 신규 산출물 제안: `docs/launch/function-inventory.md`, `permission-matrix.md`, `baseline.md`.

## 순차 작업

- [x] 메뉴, 버튼, URL, 이벤트, JS 함수, API, 테이블/RPC를 연결한 기능 목록을 작성한다.
- [x] 모든 항목에 `작가 이관 / 관리자 유지 / 통합 / 초기 비활성 / 호출 제거 후 삭제` 중 하나를 지정한다.
- [x] 각 삭제 항목에 대체 화면·API, 선행 단계, 실제 호출자, 제거 검증을 기록한다.
- [x] 익명·독자·작가·제한 관리자·최고 관리자 권한을 표로 정의한다. 관리자 콘텐츠 열람과 수정 권한도 분리한다.
- [x] 작가는 본인 원고만 관리하고 관리자 제재는 해제할 수 없다는 경계를 확정한다.
- [x] 기존 유료/성인/웹툰·정산 기록을 보존하며 신규 무료 연재와 어떻게 분리할지 명시한다.
- [x] 로컬 파일·기존 점검 기록과 실제 원격 상태를 구분한다. 관리 접근이 있으면 읽기 전용으로 DDL·RLS·Storage·계정 연결·데이터 수 기준선을 수집한다.
- [x] 작가 가입, 원고 보존, 게시, 예약, 계정 복구, 신고 처리의 인수 시나리오에 ID를 부여한다.
- [x] 부족한 관리 접근·백업·메일·예약 실행 환경을 의존성 목록에 기록한다. 비밀값을 문서에 복사하지 않는다.
- [x] 기존 `improve1.md` 언급 등 코드 주석·문서 참조가 새 번호를 잘못 뜻하지 않도록 이관 대상을 기록한다.

## 검증과 완료 조건

- [x] 현재 관리자 메뉴와 작가 주요 동작이 목록에 빠짐없이 대응한다.
- [x] 제거 대상마다 대체 동작 또는 제거 이유가 있다. 기능을 이름만 보고 중복이라고 판정하지 않는다.
- [x] 기존 데이터 보존·초기 서비스 범위·권한 표가 다음 단계 설계에 사용 가능한 수준이다.
- [x] 원격 미조회 항목은 미확인으로 표시한다. 이미 확인된 운영 노출은 즉시 완화할 작업으로 분리한다.

## 복구·주의 사항

소스와 운영 데이터를 변경하지 않는 기준선 단계다. 비밀이 포함될 수 있는 정책 덤프는 공개 문서·Git에 저장하지 않는다. 기준선 숫자가 없으면 가정으로 채우지 않는다.

## 산출물과 검증 근거

- [1단계 결과 안내](docs/launch/README.md)
- [기능·호출·데이터 목록](docs/launch/function-inventory.md): 관리자 메뉴 15개·작가 탭 7개 전수 대응.
- [권한 행렬](docs/launch/permission-matrix.md): 역할별 권한, 원고 열람/수정/제재 분리, 기존 권한 문자열 이관.
- [삭제·이관 대장](docs/launch/removal-and-migration.md): D01~D18과 옛 문서 참조 24개 처리 방향.
- [기준선](docs/launch/baseline.md) 및 [외부 의존성](docs/launch/dependencies.md).
- [인수 시나리오](docs/launch/acceptance-scenarios.md): 41개 정의, 서비스 인수 테스트는 아직 미실행.
- [정적 조사 결과](docs/launch/static-inventory.json), [원격 HEAD 요약](docs/launch/step1-remote-summary.json), [정합성 검사 결과](docs/launch/step1-verification.json).
- 재생성 도구: `node scripts/audit_launch_inventory.cjs`. 환경변수 파일을 읽거나 네트워크에 접속하지 않는 오프라인 소스 조사다.

## 실행 기록

- 상태: 완료 — 기능·권한·기준선 명세 단계 완료. 운영 보안 전환 완료를 뜻하지 않는다.
- 시작일 / 완료일: 2026-09-23 / 2026-09-23.
- 변경 파일 / 커밋: `docs/launch/*`, `scripts/audit_launch_inventory.cjs`, `improve1.md`, `improve.md`; 커밋 미생성.
- 검증: 오프라인 목록 생성, 메뉴/탭 전수 대응, 소스 74개 해시 일치, 문서 링크·시나리오 ID·삭제 항목 검사, `node --check scripts/audit_launch_inventory.cjs`, `git diff --check` 통과.
- 원격 점검: 관리 SELECT 요청 HTTP 401. REST HEAD 집계만 수행, 실제 행 값·원고·비밀번호 미조회.
- DB·Storage 적용 환경 / 버전: 적용 없음. 브라우저·DB 쓰기·마이그레이션·배포 미실행.
- 외부 의존성·미해결 사항: DEP-01~13; SEC-R01 민감 열/비무료 본문 열 선택 수용 위험은 미해결·출시 차단.
- 다음 단계 진입 판정: 2단계 로컬 모델/격리 환경 설계 진행 가능. 실제 운영 DDL·계정 연결·백업 완료 처리는 유효한 관리 접근과 기준선 확인 후 진행.
