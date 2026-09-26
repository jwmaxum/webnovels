# 작가 작품·원고 작업실 및 하단 모달 수정 — 2026-09-26

## 제공 메뉴

작가 로그인 → [내 작품](https://webnovels-db4.pages.dev/creator/works).

- 내 작품: 서버가 검증한 Auth UUID와 `authors.auth_user_id`로 본인 작품만 조회.
- 새 작품 등록: 제목을 입력해 비공개 작품 생성. 같은 요청 재시도는 중복 생성하지 않음.
- 작품 설정: 제목·소개·장르·태그·등급·AI 표기·연재 상태 저장. 수정 버전 충돌 감지.
- 원고 작성·복구: 비공개 초안의 기기/서버 저장 상태, 서버 원고 목록, 버전 비교·복구, 원고 다운로드.
- 휴지통·복구: 기존 작품 관리 계약을 사용하며 원고를 물리 삭제하지 않음.

독자 공개·예약 발행, 파일 업로드·표지, 독자 반응·통계, 신규 가입 및 수익 지급은 각각의 전체 전환 조건을 유지한다. 사용 불가능한 작가 메뉴는 이 작업실에서 숨긴다. 기존 본문 불일치 78건은 두 원본을 보존하며 검토 대기다.

## 하단에 파일 입력 창이 보인 원인

`modalCreatorFiles`와 `modalCreatorPublication`에 `modal`/`modal-content` 클래스가 붙어 있었으나 실제 사이트 스타일과 닫기 처리는 `modal-backdrop`/`modal-dialog`에 연결되어 있었다. 그 결과 두 창이 일반 문서 내용처럼 페이지 하단에 노출되었다.

- 기존 모달 클래스에 통합하고 HTML의 `hidden`과 CSS 숨김 규칙을 추가했다.
- 열기에는 승인된 작가·작가 화면 경로·해당 기능 활성 여부가 필요하다.
- 닫기, 화면 이동, 로그아웃/계정 변경 때 창과 임시 파일 상태를 정리한다.
- 공통 파일 안내문은 사용자가 작가 파일 기능을 열었을 때만 표시된다.

## DB·API 구성

전체 콘텐츠 전환 전에도 본인 소유 작품과 비공개 원고를 저장할 수 있도록 범위를 제한한 준비 검사를 추가했다. 관리자 CRUD나 구형 초안 upsert를 사용하지 않는다.

1. `database/launch/007_author_workspace_prerequisite.sql`: 백업 검토 근거, 기존 계정 서비스, 브라우저 직접 쓰기와 본문 읽기 차단, 작품/초안 소유자 정합성을 확인한다.
2. 기존 `database/authoring/001`, `003`, `004`, `005`, `006`을 적용한다. 001은 전체 P0 확장 또는 위 제한 범위의 준비 검사를 요구한다. 005는 ID 자동 생성 설정이 없는 기존 `works.id`에 안전한 identity를 추가한다.
3. `database/launch/008_author_workspace_activation.sql`: 기존 계정 연결 근거를 `authoring.identity_evidence`에 보존하고 기존 서버 초안과 버전을 canonical 원고 저장소에 복사·대조한다. 기존 프로필·초안·회차 행은 변경하지 않는다.
4. `/api/v2/me`의 `authorWorkspaceReady`는 서버 DB 검사로만 결정한다. `/api/v2/creator/works`와 `/api/v2/creator/drafts`는 기존 소유권·revision API/RPC를 재사용한다. 독자와 작가 프로필이 없는 관리자는 원고 경로에 접근할 수 없다.

이 적용은 `p0_migration_status`를 생성하지 않고 콘텐츠 플래그를 변경하지 않는다. P0 001/002, authoring 002/007~011 및 전체 공개본 전환은 별도다. 004의 가입 RPC 설치도 공개 가입 활성화를 뜻하지 않는다.

작업실은 DB의 `launch_recovery.author_workspace_service.enabled=false` 또는 서버 `AUTHOR_WORKSPACE_DISABLED=true`로 중지할 수 있다. 기존 데이터·이력을 삭제하지 않는다. 비공개 원고 DB와 기존 본문 78건의 정합화는 별도 절차다.

## 검증과 운영 적용 기록

- 변경 전 데이터 백업: `scratch/launch/backups/2026-09-26T06-27-34-739Z/`, 85개 테이블. SHA-256 `5556689dfa7c586a1c89ed649defaad82577a6c59d8616e6943c6e98c782fa4e`.
- `node scripts/prepare_author_workspace.mjs <백업 폴더>`: 실제 데이터 복사본에 적용, private 신규 작품 등록·설정 수정·원고 저장·재조회·버전 이력·멱등성·충돌·다른 작가/독자 차단, 기존 public 42개 테이블 보존 확인. `--apply`는 리허설 이후 변경되지 않은 원본 행을 재검사하고 한 트랜잭션으로 운영 적용한다.
- 운영 SQL 적용 완료. `authoring-001/003/004/005/006`, 기존 초안 2건과 계정 연결 근거 41건을 확인했다. 실제 운영 트랜잭션에서 작품 생성·수정, 원고 저장·재조회·이력·재시도·충돌 및 타 작가/독자 차단을 검증한 후 롤백했다. 기존 public 42개 테이블의 전체 행이 보존되었다. [SQL 적용·검증 결과](../../artifacts/author-workspace-rollout.json).
- 변경 전 네이티브 백업: `native-2026-09-26T06-39-59-874Z/`, pg_dump 17.11, 85개 TABLE DATA, SHA-256 `d8e7cb58f16ed311105f44eb5fde85ec17b93d6cbb6ecc12b61ccf63f9801d2b`, 아카이브 목차 검증 완료.
- 적용 후 데이터 백업: `2026-09-26T06-48-29-401Z/`, 102개 테이블, SHA-256 `4c00b49b033fcbdcbe02dc3265d9e27e0bfb3a4854eaf5c3bf391e705f0a3381`.
- 작가 2·독자 1·최고 관리자 1의 실제 Supabase Auth/PostgREST를 새 서버 핸들러에 연결해 검증했다. 작가 `/me`·작품·원고 목록 200, 독자/관리자의 작가 경로 403, 타 작가 작품 404, 위조 필드 400. 비밀번호 변경/메일 발송 없이 검증 세션만 종료했다. [실제 인증 통합 결과](../../artifacts/author-workspace-auth-integration.json). 로컬 서버 핸들러 실행이며 배포된 Pages HTTP 확인과 구분한다.
- 전체 `npm run build`와 새로운 DB/API/UI 회귀 테스트 4개 통과.
- 브라우저/localhost 인수 및 호스팅 Supabase 전체 복원은 실행하지 않았다. 로컬 PGlite 시험, 실제 DB, Auth/HTTP 검증 결과를 구분한다.

사용 확인: 작가 로그인 후 내 작품 → 새 작품 등록 → 작품 설정 저장 → 원고 작성·복구 → 제목/본문 입력 → 초안 저장. `기기·서버 저장 완료`를 확인하고 새로고침 후 서버 원고를 다시 연다. 일반 독자·관리자·로그아웃 상태에서는 파일 가져오기 창이 하단에 없어야 한다.

## 배포 결과

- 커밋 `aeac74f4c0158fd45e6884b75e4562be1b503a92`, main push 완료.
- [GitHub CI](https://github.com/jwmaxum/webnovels/actions/runs/36224843868) 및 [Cloudflare Pages](https://dash.cloudflare.com/?to=/7c88b2d2b3fe9baf32dc744ac0a631b3/pages/view/webnovels/f27962a1-eff1-4cad-8215-5380fb08d292) 성공. 2026-09-26 15:52 KST 확인.
- 관련 CSS/JS의 캐시 버전을 114로 올렸다. 기존 로그인 세션의 기능 정보는 새로고침 시 `/api/v2/me`에서 다시 확인한다.
- 배포 후 이 작업 환경에서 운영 도메인의 TLS 연결이 `ECONNRESET`으로 중단되어, 배포된 자산 및 Pages HTTP 최종 확인은 대기다. Supabase 직접 DB와 실제 Auth/PostgREST 통합 검증은 위 기록대로 완료했다. 브라우저 확인을 완료했다고 기록하지 않는다.
- [배포 확인 자료](../../artifacts/author-workspace-deployment.json). 화면에서 이전 안내가 남아 있으면 Ctrl+Shift+R 후 작가 계정으로 로그인하여 위 사용 절차를 확인한다.
