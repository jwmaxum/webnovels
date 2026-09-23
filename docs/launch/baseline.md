# 1단계 기준선 및 원격 확인 기록

작성일: 2026-09-23. 소스 기준 HEAD: `3d44d9e624f977c447a8b6cb4e8749f5c5bb0fd1`.

## 범위

작업 시작 시 기존 개선 문서 수정과 미추적 분석/계획 파일이 있었다. 이를 보존하고 `docs/launch` 산출물, 오프라인 조사 스크립트, 1단계 진행 상태만 추가/갱신한다. 서비스 JS/HTML/SQL·원격 데이터·배포 설정은 변경하지 않는다.

현재 운영 대상으로 기존 문서에 기록된 주소는 `https://webnovels-db4.pages.dev/`이다. 이번에는 해당 사이트 브라우저나 Cloudflare 설정을 열지 않았다. 로컬 설정이 가리키는 Supabase의 읽기 요청 결과이며, 실제 Cloudflare 환경변수와 동일한 프로젝트를 쓰는지는 아직 재확인하지 못했다.

## 증거 구분

| 분류 | 확인한 내용 | 한계 |
|---|---|---|
| 정적 소스 | 74개 파일 해시·15개 관리자 메뉴·7개 작가 탭·198개 인라인 이벤트·425개 함수·57개 구 라우트 | 실행/권한 보장 아님 |
| 과거 점검 | LAUNCH_READINESS / P0_IMPLEMENTATION_PLAN의 2026-09-21 기록 | 현재 정책 적용 증거로 사용하지 않음 |
| 이번 원격 관리 요청 | `node scripts/p0_schema_audit.cjs` → HTTP 401 | 관리 토큰이 존재해도 유효한 관리 접근 아님. DDL·RLS·함수·뷰·Storage 덤프 없음 |
| 이번 원격 REST 요청 | 2026-09-23 01:38:12 UTC 시작, HEAD + Prefer count=exact만 사용 | 행 값·비밀번호·원고 본문을 내려받지 않음. HEAD가 수용되었다는 범위에서만 판단 |
| 운영 쓰기/로그인/브라우저 | 실행하지 않음 | 서비스 사용성·새 API 활성·배포 여부 미검증 |

원격 요약 원본: [step1-remote-summary.json](step1-remote-summary.json). 비밀값·프로젝트 식별자·개인 정보 값은 넣지 않았다. 관리 요청은 읽기 전용 SELECT인 `database/p0/000_preflight.sql`만 사용했고 실패했다.

## 데이터 수: 이번 HEAD 조회

서버 키를 요청 헤더에 사용했지만 실제 키 종류/역할의 모든 범위를 이번에 보증하지 않는다. 성공한 요청과 실패한 요청을 그대로 구분한다.

| 테이블 | HTTP | 수 |
|---|---|---:|
| works | 200 | 30 |
| episodes | 200 | 180 |
| authors | 200 | 30 |
| readers | 200 | 11 |
| admin_users | 200 | 4 |
| episode_drafts | 200 | 2 |
| episode_draft_revisions | 200 | 0 |
| author_earnings | 200 | 90 |
| reports | 200 | 8 |
| content_reviews | 200 | 12 |
| author_settlements | 401 | 미확인 |

`author_settlements` 401을 0건·테이블 부재라고 해석하지 않는다. 거래/정산 이관 전 서버 키 권한·정책·실제 스키마를 다시 확인해야 한다. 본문 무결성/해시·전체 FK·파일 수·보관 정책은 이번 숫자 확인만으로 검증되지 않는다.

## Auth 연결 확인 범위

HEAD `select=auth_user_id&auth_user_id=not.is.null` 결과:

- authors: HTTP 200, 0행. 현재 조회 경로에서 연결된 작가 행을 확인하지 못했다.
- readers, admin_users: HTTP 400. 컬럼·스키마·권한 등 정확한 원인은 미확인이다. Auth 계정이 없다고 단정하지 않는다.
- Auth 사용자 실제 목록과 기존 계정 매핑은 관리 접근 확보 후 확인한다. 이메일 일치로 연결하지 않는다.

## 우선 보안 조치 등록: SEC-R01

익명 공개 키로 아래 HEAD 열 선택이 HTTP 200을 반환했다.

| 요청 | 결과 | 의미 |
|---|---|---|
| readers select=password_hash | 11행 | 민감 열 선택이 거절되지 않음 |
| authors select=password_hash | 30행 | 민감 열 선택이 거절되지 않음 |
| admin_users select=password_hash | 4행 | 민감 열 선택이 거절되지 않음 |
| episodes select=content, is_free=eq.false | 90행 | 비무료 본문 열 선택이 거절되지 않음 |

이는 우선 조사·차단해야 하는 신호다. 실제 값은 요청하지 않았으므로 **비밀번호 값이나 비무료 원고 90건이 실제로 읽혔다고 보고하지 않는다.** 과거 기록의 '본문 있는 유료 회차 51개'와 이번 비무료 행 수 90개는 다른 지표다.

### 즉시 완화 작업과 현재 제약

- SEC-R01은 일반 UX 개발보다 우선한다. 유효한 DB 관리 접근 확보 후 정책·역할·뷰/RPC를 확인하고 최소 조회 차단 또는 준비된 보안 전환을 적용해야 한다.
- 프론트 메뉴 숨김·Cloudflare 페이지 유지보수만으로 직접 Supabase 접근을 막을 수 없다. 보안 전환 전 서버 보호가 없는 원고를 추가 업로드하도록 안내하지 않는다.
- 이번 단계는 읽기 기준선 확정 범위이며 실제 접근 정책 변경은 수행하지 않았다. 관리 조회가 401이므로 정책 적용/복원 가능성도 확인되지 않았다. 기존 lockdown SQL을 무조건 실행하면 미전환 기능이 중단될 수 있다.
- 담당 단계: 2(관리 접근·실제 정책/백업), 3(신원), 10(전환); 차단 검증은 SEC-01~04. **미해결·출시 차단** 상태로 유지한다.

## 재검증 방법

- 소스 조사: `node scripts/audit_launch_inventory.cjs`.
- 관리 접근: `node scripts/p0_schema_audit.cjs` — 읽기 전용, 정의는 Git 제외 scratch에 저장.
- REST 기준선: `.env.local`/실행 환경의 키를 메모리에서 읽어 `/rest/v1/{table}?select=id`에 HEAD, `Prefer: count=exact`를 사용한다. 위 Auth/민감 열 검사는 표의 select/filter를 사용하며 값 반환 GET을 하지 않는다.
- 결과는 상태 코드·content-range의 수·시각만 저장한다. API 에러 전체·응답 행·키를 문서에 복사하지 않는다.

## 보존과 다음 단계 진입

1단계의 기능·권한·제거·검증 명세는 완료할 수 있다. **2단계의 실제 DB 적용·백업 검증은 별도 선행 조건**이다. 현재 관리 접근 401, author_settlements 접근 실패, Auth 연결 미확인이 해소되기 전 운영 DDL/계정 연결을 진행하지 않는다. 로컬 모델 설계·격리 환경 준비는 진행 가능하다.
