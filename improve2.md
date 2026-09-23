# 2단계 — 데이터 모델·계정 이관·백업 기반

[전체 계획](improve.md) · 이전: [1단계](improve1.md) · 다음: [3단계](improve3.md)

## 목표와 선행 조건

1단계 목록을 기준으로 Supabase 단일 저장소, Auth 연결, 안정적인 초안·공개본·예약 모델을 설계하고 격리된 환경에 적용한다. 운영 마이그레이션은 12단계의 검증된 절차로 수행한다.

## 대상 파일과 산출물

- 기존: `database/p0/000_preflight.sql`, `001_expand_identity_content.sql`, `002_lockdown_after_cutover.sql`.
- 참고: `database/18_author_growth_phase2_3.sql`, `prisma/schema.prisma`, `P0_IMPLEMENTATION_PLAN.md`.
- 신규 제안: 순서가 명확한 증분 SQL, `docs/launch/data-contract.md`, `migration-runbook.md`.
- 서로 다른 세대의 `database/*.sql` 전체를 순서대로 실행하지 않는다.

## 순차 작업

- [ ] 실제 스키마·제약·뷰·트리거·RPC와 코드 가정을 비교한다. 중복 계정·잘못된 회차 참조·결번을 보고한다.
- [ ] DB와 Storage 백업을 만들고 격리 환경에서 복원하여 기준선과 대조한다. 백업 위치·식별자·복원 시간을 기록한다.
- [x] 기존 독자/작가/관리자 ID를 유지하며 Auth UUID 연결 방식을 정한다. 이메일 일치만으로 자동 병합하지 않는다.
- [x] 기존 계정은 검증된 재설정/본인 확인 절차로 연결하고 미연결·충돌 계정은 보존한다. **절차·연결 함수 구현 및 합성 데이터 검사 완료; 실제 계정 이관 미실행.**
- [x] 안정적인 `draft_id`, 소유 작가·작품, revision, 저장 시각을 설계한다. 회차 번호를 초안의 영구 키로 쓰지 않는다.
- [x] 공개본과 편집 초안을 분리한다. 예약은 초안의 특정 revision/불변 본문 스냅샷을 참조하도록 한다.
- [x] 작품 공개 상태, 연재 상태, 운영자 제재 상태를 분리한다. 작가 공개 요청이 운영자 제한을 덮어쓰지 못하게 한다.
- [x] 작품별 회차 번호 고유 제약, 게시 멱등키, 예약 작업 상태·재시도, 휴지통·복구 관계를 정의한다.
- [x] 원고 버전 보관·휴지통 기간·영구 삭제 절차와 파일 참조 정리를 정한다. 승인된 보관 일수가 없으므로 기간 NULL(자동 삭제 금지)로 구현했다. 실제 일수·영구 삭제 정책 확정은 운영 담당 확인 후 진행한다.
- [x] 개인 원고/원본 파일 버킷과 공개 표지 파생 이미지 정책을 분리한다. 초안 본문·revision·원본에 제한 정책을 마련한다.
- [x] 새 스키마를 격리 환경에 반복 적용하고 부분 실패 후 재실행을 시험한다. **로컬 PGlite에서 검증; 별도 Supabase 프로젝트 검증은 대기.**
- [x] 현재 v2의 `locked` 마이그레이션 확인과 호환되도록 전환 절차를 문서화한다. 테스트를 위해 운영 보호 조건을 완화하지 않는다.

## 검증과 완료 조건

- [ ] 기존 작품·회차·계정 ID와 본문 내용이 유지된다. 예시 수익은 실제 거래로 합산하지 않는다.
- [ ] 두 작업이 같은 회차 번호/게시 키를 만들면 하나만 성공한다.
- [ ] 원고 수정은 공개본을 바꾸지 않고, 예약 대상 원고가 무엇인지 식별된다.
- [ ] 삭제/복구 시 작품·회차·파일·독서기록 관계가 정의되어 있다.
- [ ] 격리 DB 복원과 버전별 증분 적용 기록이 있다. 원격 미적용은 완료 기록과 구분한다.

## 복구·주의 사항

기존 열·테이블·원고를 먼저 지우지 않는다. 확장 마이그레이션 실패 시 신규 기능을 닫고 기존 데이터를 보존한다. 개인정보 공개 정책으로 되돌리는 롤백은 사용하지 않는다.

## 이번 구현과 검증

- [데이터 계약](docs/launch/data-contract.md): 기존 스키마 차이, 고정 초안 ID, 불변 revision·공개본·예약, 파일 참조와 계정 연결 규칙.
- [마이그레이션·백업 실행 절차](docs/launch/migration-runbook.md): 실DDL 확인, 실제 DB+파일 백업/복원, 적용 순서와 실패 복구.
- [증분 SQL](database/authoring/README.md): 읽기 조사 000, 저장 모델 001, private Storage 002, 검증된 계정 연결 003.
- [격리 PostgreSQL 검증](scripts/verify_authoring_schema.test.mjs), [합성 레거시 fixture](scripts/fixtures/authoring_legacy.sql).
- `npm run test:authoring-schema`: 22개 테스트 통과(부모 테스트 포함). 기존 ID·본문 보존, 반복 적용, 충돌·중복·교차 작품 거절, 계정 연결 원자성, DB 덤프 복원 등을 확인했다.
- [검증 결과](artifacts/step2-schema-verification.json)는 주 보존 계약 18개 결과를 기록한다. 추가 스키마 변형·충돌·적용 게이트 검사는 테스트 실행 결과에 포함된다.
- 새 검증을 CI 필수 명령에 추가했다. 테스트 런타임은 devDependency이며 운영 API 의존성이 아니다.
- 실제 Supabase 백업/Storage 파일 바이트 복원·실제 다중 연결 동시성·원격 정책 적용은 미검증이다. 로컬 성공을 해당 항목의 완료로 체크하지 않았다.

## 실행 기록

- 상태: 진행 중 — 로컬 구현·검증 완료, 실제 스키마·백업 확인 대기.
- 시작일 / 완료일: 2026-09-23 / 전체 단계 미완료.
- 변경 파일 / 커밋: database/authoring/*, scripts/fixtures/authoring_legacy.sql, scripts/verify_authoring_schema.test.mjs, package.json/lock, CI, 관련 실행 문서·검증 결과. 커밋 미생성.
- 검증: `npm run test:authoring-schema` 22/22 통과. 합성 데이터와 격리 PostgreSQL만 사용.
- 원격 관리 재확인: `node scripts/p0_schema_audit.cjs` → HTTP 401. 실제 DDL/RLS·백업·계정 연결 확인 불가.
- DB·Storage 적용 환경 / 버전: 로컬 authoring-001/002/003. 실제 Supabase 적용 없음, 기존 데이터·배포 설정 변경 없음.
- 외부 의존성·미해결 사항: 유효한 관리 접속, 실제 스키마/계정 연결 조사, DB+Storage 백업과 격리 복원. SEC-R01은 여전히 미해결.
- 다음 단계 진입 판정: 3단계 로컬 API 설계는 준비 가능하나, 2단계 전체 완료/운영 적용·오픈 판정은 실제 환경 검증 후에만 가능.
