# 28단계 — 가져온 원고와 원래 회차의 비공개 복구 검토 요청

## 목표와 기준선

main `92a0e06ce359b3d45f4296f9f83aaf6eb7d8386e`에서 이어간다.
27단계 HWPX/TXT/DOCX 가져오기는 새 초안과 불변 원본 파일을 보존한다. 누락 원고를
기존 게시 편집 경로로 연결하면 최초 공개본/본문 검토 계약에 영향을 줄 수 있다.
28단계에서는 작가가 저장된 원고 버전·원본 파일·대상 회차를 명시적으로 선택해
비공개 복구 검토 요청을 제출하는 경로를 제공한다.

## 개발 범위

1. 지정 .env.local·실제 검토 자료·격리 대상과 운영 상태를 읽기 전용으로 확인한다.
2. 기존 /api/v2/creator/drafts/:uuid/recovery GET/POST와 service-only RPC를 확장한다.
   Auth/작가/작품·초안·원본 파일·회차 소유권 및 bigint/UUID/revision을 구분한다.
3. 별도 검토된 additive SQL에 불변 요청/receipt를 둔다. 저장 revision과 원본 업로드
   lineage, 회차 변경 해시를 고정하고 멱등 재전송·동시 변경·계정/작품 격리를 검사한다.
   drafts.episode_id·원고/원본/공개본/기존 이력은 변경하지 않는다. 검토 요청은 권리 승인이나
   원래 회차 복구·발행 결과가 아니며 출시 충돌/P0 게이트를 완화하지 않는다.
4. CreatorFiles의 저장 원고에서 선택 UI·확인·재시도·제출 결과를 연결한다. 파일명이나
   회차 번호로 대상을 자동 추정하지 않고 불명확/유실 응답은 동일 요청으로 확인한다.
   계정/작품/원고 전환의 늦은 응답과 미동기 입력을 차단하고 기기 자료를 보존한다.
5. API/UI/합성 PostgreSQL의 보존·권한·revision/회차 변경·멱등 검증, 관련 회귀·컴파일·
   타입·Functions 번들·구문/비밀/diff를 마친 뒤 커밋·일반 main push와 전체 CI/배포를 확인한다.

## 먼저 읽은 계약

[Author/Creator](docs/launch/author-creator-contract.md),
[원고](docs/launch/creator-drafts-contract.md), [파일](docs/launch/creator-files-contract.md),
[HWPX](docs/launch/creator-hwpx-import-contract.md), [게시](docs/launch/creator-publication-contract.md),
[원본 검토](docs/launch/content-review-restore-contract.md),
[무료 전환](docs/launch/legacy-free-cutover-contract.md),
[검증 규칙](.agents/rules/testing_rules.md)을 따른다.
원본·계정·원장·기존 초안/버전을 보존하며 비밀을 출력/커밋하지 않는다.
운영 SQL/플래그·hosted 복원·브라우저 인수는 별도 실제 자료와 조건이 필요하다.

## 다음 단계

29단계는 실제 제출 원고·원본/권리·이미지/등급/AI 자료의 운영자 검토 및 원래 회차
관계를 인수한다. 별도 hosted 대상의 소유/비용·메일/역할/Storage 격리와 native 복원을
검증한 뒤 새 snapshot 기준 검토된 정합화·무료 공개본/잠금·기기 베타 전환을 진행한다.

## 구현 결과와 운영 한계

[비공개 복구 검토 계약](docs/launch/creator-recovery-request-contract.md)에 따라 기존 경로를 확장했다.
별도 AUTHOR_RECOVERY_ENABLED는 기존 P0/작품/원고/파일 prerequisites와 함께 정확히 true일
때만 허용한다. reviewed 019를 먼저 인수해야 하며 실제 환경 플래그는 변경하지 않았다.
읽기 전용 운영 감사: Auth 42·연결 작가 30·충돌 78·Storage 0·기존 미적용 12개·health 503.
새 019도 미적용, 확정 검토 파일 0·별도 hosted 후보 0이다. 출시 NO_GO를 유지한다.
Node VM/DOM·API 대역·PGlite 합성 검증과 실제 운영/브라우저 인수를 구분한다.
수정 범위 로컬 회귀·컴파일/타입·Functions 번들 뒤 일반 main push, 전체 build는 CI에서 확인한다.
실제 승인·운영 SQL·원본 복구·hosted/브라우저 인수를 완료로 기록하지 않는다.

28단계 로컬 검증: 관련 회귀 149/149, 전용 21/21, 새 UI/원고 API 라인 100.00%·분기 91.58%·함수 97.22%.
env/초기 scratch 없는 소스 복사에서 Prisma/TypeScript 컴파일·별도 타입·6개 Functions 번들,
변경 JS 구문·비밀/충돌·diff를 통과했다. lint는 미구성이며 전체 release build는 push 이후 CI에서 확인한다.
[검증 기록](artifacts/stage28-verification.json)은 합성/대역과 운영 적용을 구분한다.
