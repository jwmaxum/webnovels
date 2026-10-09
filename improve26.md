# 26단계 — 원본 승인 병목을 줄이는 비공개 검토 워크벤치

## 목표와 기준선

main `b474788eb4f5c911dd7e5ecacde6fac651c60a3f`에서 이어간다.
25단계 전환 패키지에 필요한 사람의 원본 결정·권리 근거와 별도 hosted 대상이
아직 없다. 이를 추정하지 않고, 검토자가 두 원본과 선택 불가 사유를 확인하고
기존 결정 계약에 맞는 파일을 만들 수 있도록 한다.

## 개발 범위

1. `.env.local`과 private 준비 자료를 비밀 출력 없이 재확인한다.
2. 검증된 snapshot으로 CONTENT packet을 재생성한다. 계정/Auth/identity 전체 행을
   제외하고 최소 문자열 ID·두 본문·해시·차단 사유만 private HTML에 투영한다.
3. 네트워크 없는 단일 HTML에서 검색·차단 사유 필터·원본 나란히 보기·PENDING/HOLD/
   명시 선택·부분 검토 세션 내보내기를 지원한다. seed·빈 소설·미검증 소유자는
   선택할 수 없고, HOLD는 미해결 상태다. 웹툰 원격 이미지는 자동 요청하지 않는다.
4. 별도 private 근거 파일을 제한된 경로로 불변 복사하고 descriptor를 생성한다.
   세션을 원래 전체 template에 병합한 뒤 기존 검증기와 실제 근거 바이트를 재검증한다.
   미검토 회차는 PENDING으로 유지하고 결과를 새 경로에만 기록한다.
5. 실제 78건의 초기 검토 화면을 생성하고 기존 백업 파일 보존을 검증한다.
   Node VM/DOM 대역·단위/교차 계약·전체 build·타입·보안/diff 검증 후 커밋/push한다.

## 먼저 읽은 계약과 제한

[Author/Creator](docs/launch/author-creator-contract.md),
[원본 검토·복원](docs/launch/content-review-restore-contract.md),
[무료 공개본](docs/launch/legacy-free-cutover-contract.md),
[전환 패키지](docs/launch/cutover-package-contract.md),
[검증 규칙](.agents/rules/testing_rules.md)를 따른다.
원고·계정 연결·버전·원장·백업을 보존한다. 파일 검증은 저작권 인증이나 실제
DB 적용·hosted 복원·역할/브라우저 인수가 아니다. 기능 플래그는 변경하지 않는다.
원고를 외부 파일로 바꾸거나 HOLD를 자동 숨김 처리하지 않는다.

## 다음 단계

27단계는 검토자가 확정한 원본/권리 자료와 별도 Supabase 대상을 받아 실제 복원·
역할/Storage 증거를 확보하고, 새 snapshot으로 승인된 정합화와 무료 공개본 이관을
검증한다. 원본이 없는 소설은 작가의 실제 원고를 복구한 후 다시 검토한다.

## 구현과 실제 준비 결과

- `review:content-workbench`의 prepare/check/stage-evidence/finalize를 추가했다.
  원본 계정 행을 제외한 투영, 두 전문·검색/필터, 선택 불가 원본 차단, 부분 검토 세션,
  근거 파일 불변 staging과 기존 전체 결정/바이트 검증을 연결한다. 의존성 추가는 없다.
- 검토 중 발견한 staging 우회와 Windows CRLF/CSP 해시 문제를 수정하고 회귀를 추가했다.
  전용 18/18·새 core/helper/UI 라인/함수 100%·분기 92.88%를 통과했다.
  Node VM/DOM 대역 결과이며 실제 브라우저/모바일/CSP 인수 결과는 아니다.
- 지정 `.env.local` 재확인: 접근 가능한 운영 프로젝트 1개, 별도 target/검토 결정 0.
  10:17 UTC 실제 읽기 감사는 Auth 42/작가 30·본문 충돌 78·Storage 객체 0·미적용
  마이그레이션 12개·health 503을 확인했다. 실제 SQL/플래그는 변경하지 않았다.
- 기존 23단계 백업(105테이블/1,381행)으로 private `review-stage26-final` 검토 자료를
  생성/재검증했다. 소설 36건은 원본 복구가 필요하고 웹툰 42건은 권리·이미지 근거가
  필요하다. 사람의 입력 없는 PENDING 78건 세션은 준비 검증용이며 승인 자료가 아니다.
  기존 원본 8파일의 바이트를 보존했다. 실제 준비 집계는
  [산출물](artifacts/stage26-content-workbench.json)에 기록했다.
- 로컬 env/초기 scratch 없는 새 소스 복사에서 전체 build 520/520·Functions 번들·
  Prisma/TypeScript 컴파일을 통과했다. 별도 tsc --noEmit·구문·비밀/충돌·diff도 통과했고
  lint는 미구성이다. [검증 기록](artifacts/stage26-verification.json)에 실제 준비와
  합성/VM 검증을 구분했다. 실제 출시 판정은 NO_GO이며 다음 단계의 인수가 남아 있다.
