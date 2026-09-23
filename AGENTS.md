# 프로젝트 개발 규칙

작업 시작 시 해당 단계의 `improveN.md`와 관련 계약 문서를 읽는다.

## Author / Creator 호환 계약 — 6단계부터 필수

- 상세 기준: [명칭·호환 계약](docs/launch/author-creator-contract.md). `Author`와 `Creator`는 별도 사용자/권한이 아니다.
- 작가 도메인·신원은 `Author`, `author`, `authors`, `author_id` 기준이다. 인증 원천은 서버 검증을 거친 `WebNovelsAuth.getActor().author`다.
- 기존 스튜디오 경로 `/creator`, API `/api/v2/creator/*`, `CreatorWorks`, `CreatorDraftEditor`, `creator-*` DOM ID 및 파일 이름은 유지한다. 이름을 맞추려고 `/author` API나 `creators` 테이블을 새로 만들지 않는다.
- 호환 별칭은 같은 함수/데이터를 가리켜야 한다. 호출자·HTML 이벤트·스크립트 로드 순서·라우터·테스트를 함께 확인하지 않고 일괄 치환하거나 별칭을 삭제하지 않는다.
- Auth UUID(`actor.userId`), 작가 프로필 ID(`actor.author.id`), 작품 ID, 원고 UUID를 혼용하지 않는다. 이름·필명·localStorage·기본 ID `1`로 소유자를 추정하지 않는다.
- 6단계 파일 가져오기/업로드/내보내기는 5단계의 `CreatorDraftEditor`/`DraftEngine` 및 서버 소유권·revision 계약을 확장한다. 관리자 CRUD나 예전 초안 upsert로 우회하지 않는다.
- 관련 변경 후 `npm run test:naming`, `npm run test:auth`, `npm run test:creator-works`, `npm run test:drafts`, `npx tsc --noEmit` 중 변경 범위에 맞는 검증을 실행한다.
- 기존 `CREATOR_MGMT`, `CreatorCommentBlock.creatorId` 등 영속 계약은 검증된 마이그레이션 없이 변경하지 않는다. 후속 정리 대상은 상세 계약에 기록한다.

## 검증·보존

- [.agents/rules/testing_rules.md](.agents/rules/testing_rules.md)를 준수한다. 명시 요청 없이 localhost/브라우저 검증을 실행하지 않는다.
- 실제 DB 적용·브라우저 인수와 로컬 대역/합성 DB 검증을 구분해 보고한다. 기능 플래그를 임의로 활성화하지 않는다.
- 기존 작업 트리 변경, 초안·버전·계정 매핑을 보존한다. `.env.local`이나 인증 비밀을 출력·커밋하지 않는다.
