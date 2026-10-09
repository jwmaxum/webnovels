# 25단계 — 후보와 단계별 증거를 연결하는 무료 전환 패키지

## 목표와 기준선

main `04a0318e44198a46a239df4282d2de5527af827e`에서 이어간다.
24단계 도구를 실제 전환에 사용할 때 원본 검토 전 snapshot과 정합화/마이그레이션 후
snapshot을 혼용하거나 빈 대상 점검을 실제 hosted 복원 증거로 오인하지 않도록 한다.
기존 검토·복원·무료 공개본·베타 도구를 후보/환경/SQL/선후 증거로 연결한다.

## 개발 범위

1. 지정 `.env.local`을 비밀 출력 없이 참조해 실제 원본 승인 파일·격리 대상·운영
   준비 상태를 재확인한다. 자료가 없으면 실제 승인·복원·SQL·플래그를 추정하지 않는다.
2. 검증된 논리/native 백업으로 private 불변 전환 패키지를 만든다. 후보 SHA·origin·
   범위·운영/격리 ref·백업 바이트·고정 SQL 경로와 해시·선행 계약을 묶는다.
   002 private Storage 의존성을 포함하고 016 수익화·재시드·임의 SQL은 포함하지 않는다.
3. 복원 → 원본 정합화 → 마이그레이션 → 최초 공개본 → P0 잠금 → 베타의 append-only
   증거 사슬을 검증한다. 각 단계의 이전/다음 snapshot 해시, 후보/대상, 수행 SQL과
   증거 파일 바이트를 확인한다. 단계가 바뀌면 새 snapshot을 요구한다.
   PENDING/HOLD·합성 결과·빈 target preflight로 hosted 단계가 완료됐다고 판단하지 않는다.
4. 기존 19단계 베타 평가를 마지막 단계에 재사용한다. 준비/다음 검토 가능과 최종
   사람의 승인 대기를 구분하고, 패키지는 적용 명령·GO·기능 플래그 변경을 제공하지 않는다.
5. 실제 백업으로 승인 없는 준비 패키지와 필요한 순서를 만들고 원본 파일 보존을
   확인한다. 의미 있는 교차 계약/변조/경로/순서 검증·전체 build/타입/보안/diff 후
   커밋·일반 main push·CI/배포 상태를 확인한다.

## 먼저 읽은 계약

[Author/Creator](docs/launch/author-creator-contract.md),
[원본 검토·복원](docs/launch/content-review-restore-contract.md),
[무료 공개본](docs/launch/legacy-free-cutover-contract.md),
[베타 증거](docs/launch/stage19-quality-contract.md),
[마이그레이션](docs/launch/migration-runbook.md),
[검증 규칙](.agents/rules/testing_rules.md).
기존 원고·버전·Auth/작가 연결·원장·백업·승인 기록을 보존한다.
실제 DB 적용/hosted 복원/브라우저 인수와 로컬 파일·합성 검증을 구분한다.

## 다음 단계

26단계는 준비 패키지에 실제 원본/권리·등급/AI 승인과 별도 hosted 복원·역할/Storage
증거를 채우고 단계별 새 snapshot으로 정합화·마이그레이션·공개본 이관을 검토한다.
마지막 잠금·배포 설정과 작가/독자 실환경 인수 후 무료 서비스 전환을 진행한다.

## 구현과 실제 준비 결과

- `prepare:free-cutover`의 prepare/check/record를 추가했다. private 불변 패키지·고정 Git
  SQL·전체 논리 snapshot·실제 기록 바이트를 검증한다. 승인된 결정과 후보 template으로
  CONTENT/IMPORT SQL을 재생성 비교하며 이관 UUID를 보존한다. 도구에 원격 적용은 없다.
- 007→002와 013→012 의존성을 포함했다. 기존 운영 감사의 002 누락도 수정했다.
- `.env.local` 참조 재점검: 운영 프로젝트 1개·별도 target/승인 파일 0. 09:20 UTC
  실제 감사는 Auth 42/작가 30·본문 충돌 78·미적용 authoring 12개·Storage 객체 0·health 503이다.
- 기존 23단계 logical/native 백업의 원본 8파일과 105테이블/1,381행 기준으로 24단계 후보
  `04a0318...`용 계획 패키지를 생성/재검증했다. hosted 기록 0이며 BLOCKED를 유지한다.
  초기 78건 검토/180회차 영향 packet은 후속 단계의 승인/공개본 검증 자료를 대신하지 않는다.
- 전용 순서/후보/경로/변조/권리/SQL/전체 snapshot/원고 보존/UUID/베타 회귀 17개를 통과했다.
  전체 build·타입/구문·보안/diff와 실제 상태의 구분은
  [검증 산출물](artifacts/stage25-verification.json)에 기록한다.
- 최종 깨끗한 소스 복사의 전체 build 502/502·Functions 번들·Prisma/TypeScript 컴파일과
  별도 tsc --noEmit·구문/비밀/충돌/diff를 통과했다. 새 helper 커버리지는 라인 100%·
  분기 93.27%·함수 98.73%이며 lint는 미구성이다. 실제 운영 적용/hosted/브라우저 인수는 없다.
- push 확인 중 append 테스트의 실제 날짜 의존성을 수정하고 최종 전용 17/17를 재검증했다.
  전체 build 이후 서비스/도구 코드 변경은 없으며 테스트 시계만 격리했다.
