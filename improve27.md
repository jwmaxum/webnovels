# 27단계 — 작가의 한글 원고 복구를 위한 HWPX 가져오기

## 목표와 기준선

main `3f5991af38e9351300001bc598041c285260c12b`에서 이어간다.
실제 전환에 필요한 승인 원고와 별도 Supabase 대상은 여전히 없다. 검증된 23단계
백업에서 누락 소설 36화와 명시적으로 연결된 초안/버전/복구 이력도 0건이다.
이 자료를 추정하여 승인하지 않고, 작가가 실제 한글 원고를 가져오는 수령 경로를 개선한다.

## 개발 범위

1. 지정 `.env.local`·검토 파일·격리 대상과 기존 보존 원고 후보를 비밀 출력 없이
   확인한다. 작품/회차/작가의 명시 관계만 조사하며 이름으로 원본을 매칭하지 않는다.
2. 기존 fflate ZIP 제한과 DOMParser를 재사용해 HWPX의 일반 텍스트를 변환한다.
   mimetype/컨테이너/OPF manifest·spine과 확인된 namespace를 대조한다. 구역 순서,
   문단·빈 문단·한글/이모지·탭/줄바꿈을 보존하고 Preview를 본문으로 대체하지 않는다.
3. 표·이미지·주석/각주·머리글/필드 등 누락 가능성을 경고한다. 암호화·스크립트·OLE/
   실행 요소·외부 본문 참조·DTD/entity·경로/CRC/압축 해제 한도 위반은 거절한다.
4. CreatorFiles 선택/미리보기/확인/원본 보존과 기존 서버 import를 확장한다.
   새 초안이 기본이며 현재 원고 대체는 CreatorDraftEditor/DraftEngine 백업/seq/revision
   계약을 유지한다. HWP 바이너리는 지원하지 않고 원본 회차 자동 교체·공개는 하지 않는다.
5. 실제 운영 감사와 원고 후보 집계, ZIP/XML·UI/서버/초안 DB의 의미 있는 회귀,
   전체 build/타입/구문/보안/diff 후 커밋·일반 main push·CI/배포 상태를 확인한다.

## 먼저 읽은 계약

[Author/Creator](docs/launch/author-creator-contract.md),
[원고 보존](docs/launch/creator-drafts-contract.md),
[파일 가져오기](docs/launch/creator-files-contract.md),
[원본 검토](docs/launch/content-review-restore-contract.md),
[무료 공개본](docs/launch/legacy-free-cutover-contract.md),
[검증 규칙](.agents/rules/testing_rules.md)을 따른다.
원고/버전/계정/원장/백업을 보존한다. 실제 DDL/원고/기능 플래그 변경이나 hosted·브라우저
인수를 합성/VM 검증으로 대체하지 않는다. 파일 변환은 원본·권리 확인이나 출시 승인과 다르다.

## 다음 단계

28단계는 실제 작가의 HWPX/TXT/DOCX 원고와 확정 권리/이미지·등급/AI 자료를 받아
복구 초안·원본 회차 연결을 인수한다. 별도 대상의 소유/비용·메일/역할/Storage 격리와
native 복원을 확인하고 새 snapshot으로 정합화·무료 공개본 이관·잠금/베타를 검증한다.

## 검증과 실제 상태

전용 합성 ZIP/XML 14개와 기존 변환/UI/API/초안 DB의 변경 범위 검증은 37/37을 통과했다.
라인 커버리지 90.56%·분기 77.30%·함수 80.00%이며 별도 TypeScript 타입 검사를 통과했다.
[운영 읽기 전용 감사](artifacts/stage27-launch-readiness.json)는 11:24 UTC에 Auth 42·연결 작가 30·
본문 충돌 78·Storage 0·미적용 12개·health 503을 확인했다. 지정 .env.local에는 별도 대상이
없고 접근 가능한 프로젝트 1개는 운영이다. 원본/권리 승인 입력은 0건이다.
[기존 백업 조사](artifacts/stage27-original-recovery.json)의 36화에 연결된 원고 후보는 0건이며
현재 운영/전체 과거 백업의 전수 원고 부재를 의미하지 않는다. 원본을 추정·타입 변경·삭제하거나
운영 SQL/플래그를 변경하지 않았다. 실제 한컴 문서/브라우저·hosted 인수는 미실행이다.
env/초기 scratch 없는 동일 소스 복사본에서 전체 회귀 537/537·Functions 번들과 Prisma/TypeScript
컴파일을 통과했다. npm run build의 부모 프로세스는 20분 한도에 도달했지만 같은 release 하위
체인이 계속되어 종료 코드 0을 확인한 뒤 동일 복사본에서 build:compile을 완료했다. 검증 결과와
코드 해시는 [검증 산출물](artifacts/stage27-verification.json)에 기록한다. 구문·비밀/충돌·diff도
통과했으며 lint는 미구성이다.
