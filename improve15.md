# 15단계 — 작가의 첫 웹소설 연재 완성

기준일: 2026-10-08. [후속 계획](docs/launch/development-roadmap-2026-10-08.md)의 15단계를 실행한다. 14단계의 운영 DB 적용·배포·복원 게이트가 남아 있으므로 이번 변경은 로컬 개발과 회귀 검증이며 운영 출시 완료와 구분한다.

## 적용 계약과 범위

[명칭·신원](docs/launch/author-creator-contract.md), [작품](docs/launch/creator-works-contract.md), [원고](docs/launch/creator-drafts-contract.md), [파일](docs/launch/creator-files-contract.md), [게시](docs/launch/creator-publication-contract.md), [연재 방식](docs/launch/creator-distribution-contract.md)을 유지한다. Author의 서버 검증 신원과 기존 Creator 경로·별칭·ID를 보존한다.

기존 Cloudflare/JS/Supabase와 DraftEngine을 확장한다. 패키지·DB 테이블·원고 형식을 교체하지 않는다. 웹소설 첫 연재를 대상으로 하며 웹툰 제작은 18단계다. 제목만으로 비공개 생성, TXT/DOCX 변환 검토·원본 보존·재시도·취소·표지·내보내기, 공용 독자 미리보기, 공개/예약/수정/독자 링크/새 원고 기능을 재사용한다.

## 구현 묶음

1. **연속 입력 저장:** 700ms 로컬 저장과 2.5초 서버 debounce를 유지하며 첫 미동기 변경부터 30초 최대 대기를 추가한다. IME 조합 중 서버 전송을 유예하고 deadline을 보존한다. 실행 중 sync, pending의 정확한 payload·멱등키, revision·seq, 충돌 사본, 계정·작품 전환을 존중한다. 수동 저장·online·게시 준비도 조합을 검사한다. 변경 없는 서버 저장과 실패/충돌의 무한 재시도는 금지한다.
2. **첫 공개 안내:** 작품 정보·원고·저장된 버전·권리 확인·활성화/제한 상태를 별도 항목으로 안내한다. 정보 누락은 서버 `publication_missing`에 근거하며 공개 허가는 서버가 판정한다. 작품 설정·원고 복구·파일/표지·미리보기로 연결한다. 표지와 연재 방식은 선택 사항이고 권리 진술은 전자 계약이 아니다.
3. **선택 입력:** 기존 독자 장르 값과 표준 태그 slug를 선택 UI로 제공한다. 기존/사용자 지정 값은 다른 필드만 수정할 때 그대로 보존하며 10개 상한 초과를 조용히 잘라내지 않는다.
4. **첫 발행의 경계:** 저장 후 원격 대조의 늦은 결과를 다시 검사한다. 게시 응답 유실은 같은 키·payload로 확인하고 새 체크리스트가 이 재시도를 막지 않는다. 게시 확정 이후 목록 갱신 장애는 확정 결과를 보존한다. 발행 중 새 입력은 별도 로컬 사본으로 보존한다.
5. **파일 기능 연결:** 공개 runtime config의 allowlist에 `authorFilesEnabled`를 추가한다. 서버 환경값이 정확히 `true`일 때만 제공하고 기본은 false다. 비밀·다른 환경값은 내보내지 않고 실제 플래그는 변경하지 않는다.

30초는 실행 가능한 탭에서 조합·실행 중 요청이 해소된 뒤 저장 **요청**의 최대 대기 목표다. 서버 성공이나 잠든 기기·중단된 탭의 정시 실행을 보장하지 않는다.

## 검증과 완료 구분

fake clock + 실제 DraftEngine/UI 대역으로 연속 입력, idle, IME, 느린 요청, 정확한 재전송, 충돌, 계정/원고 전환, 원격 대조 경쟁을 검증한다. 체크리스트·선택 입력·게시 확정/재시도·다음 원고·runtime allowlist를 검증한다. `test:naming`, `test:auth`, `test:creator-works`, `test:drafts`, `test:files`, `test:publication`, 추가 `test:stage15`, 전체 `test:release`, 타입/컴파일 및 Cloudflare bundle을 수행한다.

명시 요청 없는 localhost/브라우저 검증, 실제 DB/Storage 적용, 플래그 활성화는 수행하지 않는다. 작가 A 등록→발행→독자 B 열람→다음 원고→다른 기기 복구와 타 작가 접근 거절은 별도 실환경 인수에 남긴다. 구현·검증 완료 후 단계별 Git 규칙에 따라 커밋·push한다.

## 실행 기록

- 구현 시작. 기존 파일·게시 흐름과 소유권/revision 계약을 확인했다. search-first 조사 결과 새 의존성 없이 기존 스케줄러를 확장한다.
- 구현: `CreatorReadiness` 안내/선택 입력, 최대 대기 저장, 기존 파일 runtime 플래그 전달, 미리보기 경쟁 검사, 게시 결과 재확인/확정 후 장애 보존, 보관 사본의 새 UUID 복사를 추가했다. 상세 동작은 [15단계 계약](docs/launch/creator-first-serial-contract.md)을 따른다.
- 2026-10-09 마무리: 로컬 구현·검증 완료, 실환경 인수 대기. [검증 기록](artifacts/stage15-first-serial-verification.json)에 전체 17개 출시 검사 그룹과 최종 영향 범위 재검사를 기록했다. 최초 전체 실행은 250개 통과, 마지막 수정 후 36개 영향 범위 재검사도 통과했으며 중복을 제외한 최종 검사 항목은 256개다. 실패·건너뜀은 0개다.
- 최종 검토에서 다른 기기의 예약 취소, 기기 checkpoint 대기 중 시작된 한글 조합, 충돌 중 후속 입력의 기기 저장을 보완했다. 취소 결과는 서버 lifecycle을 확인하고 본문·기준 revision을 보존한다.
- Prisma/TypeScript 컴파일, `tsc --noEmit`, Cloudflare 번들 3개, 변경 JavaScript 구문·diff·비밀 패턴 검사를 통과했다. 별도 lint 명령은 미설정이다. 계측한 편집기·게시·체크리스트 3개 모듈의 줄 커버리지는 85.27%이며 전체 프로젝트나 실제 브라우저 커버리지를 의미하지 않는다.
- 실제 DB/Storage 적용·기능 활성화·배포·브라우저/기기 인수는 수행하지 않았다. 기존 14단계 공개 전환·백업과 5~7단계 실환경 조건은 남아 있다. Git 커밋 ID와 push 결과는 완료 보고에서 제공한다.
- 다음 개발: 16단계 독자 탐색·이어보기·공개 회차 이동 및 랭킹 의미 개선.
