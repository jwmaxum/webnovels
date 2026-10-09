# 24단계 — 무료 공개본 이관과 격리 복원 대상 검증

## 목표와 확인한 입력

23단계 main `4ac2be484068be4fb0f3af7c7f6ef50e14b4829a`에서 이어간다.
지정한 `.env.local`을 비밀 출력 없이 참조했다. 관리 API로 접근 가능한 프로젝트는
운영 프로젝트 1개이며 격리 대상 설정/프로젝트와 확정 원본 검토 결정 파일은 없다.
78건 PENDING과 P0/무료 runtime 차단을 임의 승인으로 우회하지 않는다.

## 개발 범위

1. 기존 source_draft NULL legacy 버전 계약을 확장해 무료 NOVEL 기존 회차의 공개본
   이관 준비와 리허설을 구현한다. 권리/출시 근거·snapshot/행 해시가 없는 승인은 거절한다.
   작품/회차/작가/Auth/identity/state/본문 정책을 재검증하며 원본·초안·계정·기존 head와
   불변 버전을 보존한다. 새 버전/head와 private 불변 이력만 추가한다.
2. 첫 공개본은 정합화 완료·P0 확장·authoring 008 이후, 검증된 공개 무료·일반 등급
   소설로 제한한다. 웹툰/성인/유료/미래 예약/제재/불명 원본/개발 예시문은 제외한다.
   보류 원본을 숨기거나 type/소유자/정책/작가 확인 플래그를 자동 수정하지 않는다.
3. 격리 복원 target의 실제 관리 접근·기존 데이터·Auth/Storage·Cron/webhook 위험을
   읽기 전용으로 점검한다. 운영 ref/미지정/접근 실패/기존 데이터/미확인 외부 작용은
   복원 가능으로 표시하지 않는다. 프로젝트 생성·복원·메일·Cron·SQL 적용은 자동 실행하지 않는다.
4. 지정된 실제 운영을 읽기 전용 재감사하고 검증된 백업에서 실제 이관 준비 자료를
   만든다. source/head 보존·CAS 전체 rollback·재실행·private 이력·타 역할 거절과
   기존 독자 공개 RPC 호환을 합성 PostgreSQL에서 검증한다.
5. 전체 release build·타입·구문/보안/diff 후 main에 커밋하고 일반 push·원격 CI/배포를 확인한다.

## 계약과 인수 구분

[명칭·호환](docs/launch/author-creator-contract.md),
[원본 검토·복원](docs/launch/content-review-restore-contract.md),
[마이그레이션](docs/launch/migration-runbook.md),
[출시 증거](docs/launch/stage19-quality-contract.md),
[검증 규칙](.agents/rules/testing_rules.md)을 먼저 읽고 따른다.
Author/Creator·UUID/bigint/revision 계약을 유지한다. `.env.local`/원고/인증정보는 Git에 넣지 않는다.
실제 hosted 복원·Storage 바이트·운영 역할/기기 인수·원본 승인을 로컬 검증으로 대체하지 않는다.
실제 target/원본 근거가 제공되면 같은 계약에 따라 진행하고, 없어도 독립적인 개발/검증과 push는 완료한다.

## 구현 및 실제 확인

- `005_import_verified_legacy_novels.sql`과 private packet/결정/근거 검증·CAS 리허설을
  준비했다. 검토된 최초 공개 시각, 원본 전체 보존·기존 head/예약 거절·private 불변
  이력, 성장 BASELINE을 검증한다. 원격 적용 경로/자동 검토 플래그는 없다.
  미래 작품의 회차 직접 노출을 packet/SQL에서 거절하고, invalid target 원문은 출력하지 않는다.
- 격리 target 점검은 운영 ref/기존 데이터/외부 hook/Cron/Auth 작용을 거절하며 빈
  대상도 복원 승인으로 표시하지 않는다. `.env.local` 자체는 변경하지 않았다.
- 23단계 검증 백업의 180회차를 이관 packet으로 준비했다. 원문 충돌 78·보호 본문
  180 미확보·008 미적용으로 가능/승인 0, PENDING 180이다. 실제 검토 템플릿은 private 보관했다.
- 08:20 UTC 운영 읽기 재감사: Auth 42·연결 작가 30·충돌 78·Storage 객체 0,
  authoring 007~015/017/018 미적용·health 503. 별도 접근 가능 프로젝트/target/확정 원본
  승인 자료 없음. 실제 SQL/원고/플래그/hosted 복원/브라우저 인수는 실행하지 않았다.

## 검증 결과

- 전용 14/14 테스트, 새 helper 라인/함수 100%·분기 92.99%.
- `.env.local`/초기 scratch 없는 별도 소스 복사에서 `npm run build`: 전체 485/485,
  skip/fail 0, Functions 번들·Prisma·TypeScript 컴파일 통과. `tsc --noEmit`도 종료 0.
- JS 구문 7파일, 비밀/충돌 표식·diff 검사 통과. lint 명령은 미구성이므로 lint 통과로 표시하지 않는다.
- 실제 백업 기준 PENDING 리허설은 종료 2·packet 일치·SQL 생성 0을 확인했다.
- [검증 기록](artifacts/stage24-verification.json)은 로컬 합성 검증과 실제 읽기 감사·
  백업 기준 준비를 구분한다. 운영 전환은 NO_GO이며 Git 배포와 출시 승인은 별개다.

## 다음 단계

25단계에서 원본/등급/AI/권리자 확인과 별도 Supabase 복원·역할/Storage 실제 인수 자료를
완성한다. 기존 충돌 정합화 → 검토한 마이그레이션 → 승인된 기존 무료 소설 공개본 이관 →
P0 최종 잠금·배포 설정 인수 후 무료 전환을 진행한다. 웹툰 원본/이미지 이관은 별도 인수한다.
