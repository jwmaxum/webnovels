# Author / Creator 명칭·호환 계약

작성일: 2026-09-23. 적용: 6단계 착수 전부터 모든 후속 개발. 이 문서는 실제 코드의 기존 이름을 유지하면서 도메인 의미와 변경 원칙을 정한다.

## 명칭 기준

**Author는 작가 신원·데이터 도메인이고 Creator는 기존 작가 스튜디오의 이름이다. 서로 다른 계정 유형이 아니다.** 새 업무 변수/설명은 author/작가를 기준으로 하되 기존 외부·영속·UI 계약을 이름만으로 변경하지 않는다.

| 구분 | 유지할 기준 | 주의 |
|---|---|---|
| 서버 신원 | `actor.userId`, `actor.author` | 검증된 Auth UUID와 작가 프로필은 서로 다른 식별자 |
| DB/모델 | Supabase `authors`, `author_id`; Prisma `Author`, `authorId` | Prisma의 문자열 ID와 Supabase bigint ID도 같은 저장 모델로 가정하지 않음 |
| 역할/가입 | `AUTHOR`, 가입 `kind: 'author'` | 새 `CREATOR` 역할/가입 유형을 추가하지 않음 |
| 스튜디오 URL | `/creator/*` | `/author/*`는 현재 라우터의 호환 진입점; 새 링크는 `/creator` 사용 |
| 보안 API | `/api/v2/creator/works`, `/api/v2/creator/drafts` | `/api/v2/author/*`를 추측해 호출하지 않음 |
| 브라우저 모듈 | `CreatorWorks`, `CreatorDraftEditor`, `DraftEngine`, `DraftStore` | 존재하지 않는 `AuthorWorks`/`AuthorDraftEditor`로 바꾸지 않음 |
| 파일/HTML | `public/js/creator/*`, `view-creator`, `creatorTab-*` 등 | CSS 선택자·이벤트·스크립트 참조를 함께 추적 |
| 현재 작가 표시 상태 | `currentLoggedAuthor`, `currentLoggedCreator` 및 window 속성 | 모두 Auth 갱신/해제와 함께 동일 값으로 유지; 권한 근거는 아님 |
| 공개 작가 캐시 | `SAMPLE_AUTHORS`, `window.SAMPLE_CREATORS` | 동일 배열 참조, 가짜 데이터/로그인 신원이 아님 |
| 세션 조회 | `getCurrentAuthorSession`, `getCurrentCreatorSession` | 모두 서버 검증 actor의 author를 반환 |
| 기존 관리자 권한 | `CREATOR_MGMT` | 현재 운영 계약; 이름만 `AUTHOR_MGMT`로 바꾸지 않음 |
| 과거 영속 모델 | `CreatorCommentBlock.creatorId` | 별도 마이그레이션/호출자 조사 전 이름 유지 |

## 유지할 함수 별칭

`creator.js`의 다음 쌍은 같은 구현을 사용한다. 동일 기능의 별도 구현을 추가하지 않는다.

- `switchAuthorTab` / `switchCreatorTab`
- `fetchAuthorDashboardData` / `fetchCreatorDashboardData`
- `handleAuthorSettlementReq` / `handleCreatorSettlementReq`
- `handleAuthorLogoutProcess` / `handleCreatorLogoutProcess`
- `loadAuthorStudioEarnings` / `loadCreatorStudioEarnings`

`WebNovelsAdmin.fetchCreatorsFromSupabase`는 `fetchAuthorsFromSupabase`의 호환 이름이다. 이것이 관리자 클라이언트의 데이터를 새 작가 기능의 인증 근거로 사용해도 된다는 뜻은 아니다. 새 소유 작품·원고·파일 기능은 보안 API를 사용한다.

`webnovels_author`, `webnovels_creator`, 구독 작가/크리에이터 키는 과거 표시 캐시 이름이다. 토큰이나 소유권 근거가 아니며 계정 변경 시 함께 정리한다. 신규 영속 저장 키를 명칭 통일만을 이유로 추가하지 않는다.

## 6단계 적용

1. 파일 가져오기 UI는 `CreatorDraftEditor`를 확장하고 기존 원고를 바꿀 때 `DraftEngine`의 백업·수정 seq·revision 경로를 사용한다.
2. 소유자는 서버 검증 actor로 결정한다. 요청의 `creatorId`, `authorId`, 파일명/필명, 캐시 ID를 신뢰하지 않는다. Auth UUID를 author_id에 넣거나 작가 ID를 원고 UUID로 사용하지 않는다.
3. 기존 `/api/v2/creator` 경로 아래의 새 파일 API는 6단계 명세에서 명시적으로 정의한다. 아직 구현되지 않은 API·전역 메서드가 있다고 가정하지 않는다.
4. 기존 IndexedDB 계정/작품/원고/branch 키와 legacy 가져오기 매핑을 보존한다. 이름 변경으로 새 빈 저장소를 만들지 않는다.
5. 별칭을 줄일 경우 정의·호출·인라인 이벤트·DOM·CSS·라우터·서버·DB를 조사하고 호환 기간 및 이관을 먼저 정한다. 9·10단계 정리 전 임의 삭제하지 않는다.

## 검증과 남은 범위

`npm run test:naming`은 실제 classic-script 로드에서 전역 별칭의 존재/동일 구현, 작가 캐시 배열 동일성, Auth 로그인·로그아웃 시 두 표시 상태의 동기화, 두 세션 조회 함수의 동일 신원을 확인한다. 브라우저 인수 또는 모든 관리자/정산/댓글 경로의 완전한 전환을 증명하지 않는다.

과거 정산·통계·댓글 경로에는 캐시 기반 작가 조회와 creator 이름의 영속 계약이 남아 있다. 새 기능에서 재사용하지 말고 8~10·13단계 담당 범위에 따라 서버 소유권 검사와 함께 전환한다. 이번 규칙 기록을 전체 코드의 명칭 치환이나 전 경로 무오류 보장으로 해석하지 않는다.

2026-09-23 검증: `npm run test:naming` 3개, `node scripts/verify_auth_session.test.mjs` 9개 통과. `git diff --check` 통과. 실행 코드의 이름을 변경하지 않았으며 실제 브라우저 검증·6단계 기능 개발·DB 적용은 수행하지 않았다. CI에 `test:naming`을 추가했다.
