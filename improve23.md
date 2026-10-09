# 23단계 — 원본 검토와 복원 가능한 출시 준비

## 목표와 현재 조건

22단계 이후 운영에는 본문 충돌 78건(소설 36·웹툰 42)이 남아 있다.
기존 원본 선택 기록과 격리 Supabase 복원 대상이 없으므로 임의 본문 선택,
작품 유형 변경, P0 검사 우회, 기능 플래그 활성화로 출시를 표시하지 않는다.
이번 단계는 실제 데이터의 보존·검토·정합화 리허설 도구를 완성한다.

## 구현 범위

1. 기존 백업 도구의 스키마 계약에 commerce·growth를 포함한다. 논리 백업과
   native pg_dump의 동일 범위를 검사하며 스키마·테이블 변화와 불완전 백업을 거절한다.
2. 검증된 논리 백업에서 충돌 검토 패킷을 생성한다. 원본 두 행, 작품/작가/인증 연결,
   유형과 이미지, 백업·행 해시를 묶고 모든 초기 결정은 PENDING으로 둔다.
   원고/이미지 URL/Auth UUID는 Git 밖 scratch에만 보관한다.
3. 검토자·증거가 있는 HOLD/USE_EPISODES/USE_EPISODE_CONTENTS 결정만 검증한다.
   누락/중복/오래된 해시, 빈 소설 원본, 검증되지 않은 이미지, 개발 시드 예시문,
   소유자/유형 변경을 거절한다. HOLD는 보존이며 충돌 해결이나 출시 승인이 아니다.
4. 승인된 원본 선택만 CAS 트랜잭션 SQL로 준비한다. 두 원본과 작품/작가 행이
   백업 당시와 같은지 재검사하고 불변 private 이력에 전후 행·근거를 보존한다.
   실제 행의 격리 PGlite 복원에서 보류/비대상 행 보존·재실행/변조 거절을 검증한다.
   도구는 운영 SQL을 자동 실행하지 않는다.
5. 실제 운영 읽기 전용 감사, 새 논리/native 백업, 실제 행의 로컬 복원을 수행한다.
   hosted 복원·Storage 원본 바이트·운영 권한/기기 인수는 별도 증거로 구분한다.
6. 범위 검증과 전체 build·타입·보안·diff 후 main 커밋과 일반 git push를 수행한다.

## 계약과 완료 조건

[명칭·호환 계약](docs/launch/author-creator-contract.md),
[복구 계획](docs/launch/503-recovery-plan.md),
[마이그레이션](docs/launch/migration-runbook.md),
[19단계 품질 계약](docs/launch/stage19-quality-contract.md),
[검증 규칙](.agents/rules/testing_rules.md)을 따른다.
Auth UUID·author ID·작품/회차 ID를 구분하고 bigint를 문자열로 보존한다.
기존 초안·버전·계정·원장과 역사적 백업/적용 증거는 덮어쓰지 않는다.
운영 원본 변경, 실제 hosted 복원, 브라우저 인수의 완료를 합성 검사로 주장하지 않는다.

## 다음 단계

24단계에서는 검토 패킷의 권리자/원본 확인을 완료하고 제공된 별도 Supabase에
native 복원을 검증한다. 인수 근거를 갖춘 정합화·공개본 이관·역할/Storage 검증
후 무료 서비스 전환을 진행한다. 동의 표본의 성장 실험은 그 뒤 시작한다.

## 검증 완료 기록

신규 검토/백업/복원 준비 검사 12개와 비밀 없는 소스 사본의 전체 `npm run build`
471/471 테스트·Prisma/TypeScript compile이 통과했다. 별도 tsc --noEmit 오류 0,
핵심 3개 모듈 줄/함수 100%·분기 93.92%, 변경 JavaScript 12개 구문 검사와
비밀/충돌 표식·diff 검사 오류 0을 확인했다. lint 설정은 없어 별도 미설정으로 표시한다.
[검증 근거](artifacts/stage23-verification.json)와
[실제 읽기 전용 감사](artifacts/stage23-launch-readiness.json)를 남겼다.

운영 105테이블/1,381행 로컬 복원 전체 일치·서비스 제약 216개·독립 unique index 7개,
새 native archive 105 TABLE DATA를 검증했다. 실제 78건 PENDING에서 종료 코드 2와
SQL 생성 0건을 확인했다. 실제 원본 승인·운영 SQL/플래그 변경·hosted 복원·브라우저 인수는
수행하지 않았으며 무료 서비스 판정은 NO_GO다.
