# 14단계 — 작가 연재 방식·외부 링크 계약

2026-10-08. **첫 스프린트의 추가 설정 로컬 구현·검증 완료.** 실제 DB 적용·배포·활성화·브라우저 인수는 대기다. [검증 기록](../../artifacts/stage14-sprint1-verification.json).

2026-10-09 확장: [16단계](reader-discovery-contract.md)에서 공개 무료 작품의 비독점 링크 전용 투영·독자 배지를 구현하고 로컬 검증했다. 작가 설정 API/신원·권리 진술 계약은 유지한다. 발견 기능은 기본 false이며 운영 적용은 별도다.

## 범위와 사용자 의미

기존 Supabase 인증, 제목만으로 비공개 작품 생성, `/creator/works/:id/settings`, 작품·원고 ID와 revision을 유지한다. 설정은 저장 이후에도 작품을 공개하지 않는다. 웹툰 생성·유료화·독점 계약 체결을 이 설정으로 우회하지 않는다.

연재 방식은 `UNSET`(기존 작품/미선택), `NON_EXCLUSIVE`(비독점 연재), `EXCLUSIVE_INTEREST`(독점 연재 상담 희망)이다. 기존 작품을 자동 비독점으로 분류하지 않는다. 상담 희망은 작가의 의사 기록이며 상담 접수·승인·독점/오리지널 인증이 아니다. 원작 권리·기존 계약·유통권은 이 선택만으로 변경되지 않는다.

저장 시 작가는 “이 작품의 게시 권한이 있으며, 다른 플랫폼 계약에 위배되지 않음을 확인합니다.”를 직접 확인한다. 서버가 `author-declaration-v1`과 서버 시각을 기록한다. 이는 권리자 확인 진술이며, 아직 확정되지 않은 전자 이용/유통 계약에 동의한 것으로 기록하지 않는다. 플랫폼 이용·비독점 유통·독점 계약의 실제 문구와 적용 절차는 별도 정책 검토 후 추가한다.

외부 연재 링크는 선택 사항으로 최대 5개, 각각 HTTPS URL 2,048자 이하다. 문피아(`www.munpia.com`, `novel.munpia.com`), 네이버(`novel.naver.com`, `comic.naver.com`), 카카오(`page.kakao.com`, `webtoon.kakao.com`), 조아라(`www.joara.com`), 레진(`www.lezhin.com`)의 정확한 호스트만 허용한다. 사용자 정보·명시적 포트·공백·제어문자·역슬래시·중복 URL은 거절한다. 서버에서 링크를 가져오지 않는다. 플랫폼 이름은 검증된 호스트로 결정하며 작가 입력 HTML이나 임의 배지 문구를 표시하지 않는다.

첫 스프린트는 작가 설정·링크 확인까지 구현한다. 독자용 외부 연재 배지는 16단계에서 공개 작품·이용등급·제한 상태와 함께 검증한 전용 공개 응답에 연결한다. 비공개 설정을 직접 읽거나 기존 전체 작품 조회에 합치지 않는다.

## API·데이터 계약

`GET/PATCH /api/v2/creator/works/:id/distribution`은 서버 검증된 `actor.userId`와 `actor.author`를 사용한다. 기존 전체 작품 관리 또는 검증된 비공개 작업실 준비 조건에 더해 `AUTHOR_DISTRIBUTION_ENABLED=true`가 필요하다. 기본값은 false다. 비공개 작업실에서도 같은 소유권 RPC를 사용한다.

- GET은 `{distribution: {workId, mode, externalLinks, version, declarationVersion, declaredAt}}`를 반환한다. 미설정은 `UNSET`, `[]`, `"0"`, null, null이다.
- PATCH는 `{mode, externalLinks, version, rightsConfirmed: true}`만 받는다. `mode`는 선택한 두 값만 허용한다. 외부 링크는 문자열 배열이다. 정확한 same-origin Origin과 JSON이 필요하다.
- 작품 ID와 설정 version은 bigint 범위의 10진 문자열이다. Auth UUID를 작품/작가 ID로 변환하거나 혼용하지 않는다.
- 설정 version은 작품 정보 version·원고 revision과 독립이다. 최초 `"0"`에서 시작하여 성공 시 증가한다. 오래된 version은 409 `DISTRIBUTION_CONFLICT`이며 입력을 보존한다. 응답 유실 뒤에는 명시적으로 최신 설정을 조회하고 비교한다. 조용한 덮어쓰기나 자동 재전송을 하지 않는다.
- 다른 작가 작품은 404, 비활성 계정은 403, 제한 작품의 저장은 403, 휴지통 작품의 저장은 409, 미적용/장애는 503이다. 제한/휴지통 작품의 기존 설정은 소유 작가가 조회할 수 있다. GET 오류를 빈 설정으로 대체하지 않는다.

연재 방식에 저장하지 않은 입력이나 진행 중인 저장이 있으면 작품 정보/상태 변경이 화면을 새로 그려 입력을 잃지 않도록 먼저 연재 방식 저장·명시적 초기화를 안내한다. 두 설정의 version을 합치거나 한 요청의 성공을 다른 설정의 저장 성공으로 표시하지 않는다.

추가 SQL [012_creator_distribution.sql](../../database/authoring/012_creator_distribution.sql)은 기존 `public.works`/`authors`를 재생성하지 않는다. `authoring.work_distribution`과 append-only `work_distribution_events`, 서비스 전용 `public.creator_work_distribution` RPC를 추가한다. 원고·회차·공개 상태·기존 권리·계정 연결은 변경하지 않는다. 테이블 직접 권한과 anon/authenticated RPC 실행 권한은 없다.

RPC도 승인 작가·확인 이메일·계정 차단 여부·현재 소유자·work_state 정합·휴지통/제한·허용 필드/URL/version을 재검사한다. 작가→작품→상태 잠금 순서를 기존 작품 RPC와 맞춰 동시 수정/휴지통 경쟁을 직렬화한다. 성공한 변경과 선언의 전후 값·작가 ID·Auth UUID·시각을 같은 트랜잭션으로 기록한다.

## 적용·복구·인수

012의 실제 선행 조건은 검토 적용된 `authoring-005`와 기존 Auth/작업실 매핑이다. 번호가 012라는 이유로 미적용 002/007~011을 일괄 실행하지 않는다. 실제 스키마·권한·백업·격리 복원을 확인하고 `webnovels.authoring_apply_verified=true` 검토 세션에서 적용한 뒤 작가 A/B·일반 독자·관리자의 직접 접근을 확인한다. 기능 활성화는 별도 운영 기록이 필요하다.

문제가 있으면 신규 기능 플래그를 끄고 추가 테이블/이력을 보존한다. 기존 작품/원고 API는 유지한다. 테이블 삭제·권리 초기화·기존 작품 재분류로 복구하지 않는다.

검증은 신규 API/URL 검증, 합성 PGlite 마이그레이션·소유권·권한·동시 version·감사 이력·보존, DOM 대역의 실패 입력/늦은 응답·계정 전환 테스트와 기존 naming/auth/works/drafts 회귀·TypeScript 검사다. 실제 Supabase/호스팅/브라우저 인수와 구분한다. localhost·브라우저는 프로젝트 규칙의 명시 요청 조건을 따른다.
