# 토큰 갱신 후 실제 서비스 점검 — 2026-09-25

## 확인된 상태

**관리 API 401은 해결됐다.** 갱신된 PAT로 읽기 SQL 요청이 HTTP 201을 반환했고 실제 DDL·정합성·권한·백업 조회를 완료했다. 운영 API는 아직 `503 SECURE_API_NOT_ACTIVATED`다. Cloudflare 설정은 사용자가 직접 변경하기로 했다.

| 실제 DB 확인 | 결과 / 필요한 조치 |
|---|---|
| 작품 / 회차 / 작가 / 독자 | 30 / 180 / 30 / 11. 삭제·재시드하지 않음 |
| 작품 소유자 | 20개 작품의 `author_id`가 NULL. 검증된 작가 ID와 연결 근거가 필요 |
| 본문 원본 | `episodes.content`와 `episode_contents.text_content`가 180개 회차에서 다름. 전자는 78개가 비어 있고, 102개는 양쪽에 서로 다른 내용이 있음 |
| 기존 초안 | 2개, 기존 이력 0개. 작품과 초안의 작가 불일치는 0개 |
| Supabase Auth | 계정 0개, 독자·작가·관리자의 검증된 Auth 연결도 0개 |
| 새 DB 구조 | `public.p0_migration_status`, `authoring.migrations` 모두 없음. 2~10단계 SQL 미적용 |
| 현재 브라우저 권한 | 사용자 승인 후 보호 SQL 적용. 감사 대상 민감 열 SELECT 허용 0개, public 테이블 쓰기 권한 0개. 직접 쓰기 요청은 보내지 않음 |
| 제공업체 백업 | 목록 0개, PITR 비활성, 물리 복구 지점 없음. 별도 전체 DB 백업·격리 복원 증거도 미확보 |
| Supabase Storage | 버킷·객체 모두 0개. 외부 URL에 보관된 파일까지 없다는 의미는 아님 |

[재현 가능한 감사 결과](../../artifacts/launch-readiness-audit.json), [접근 진단](../../artifacts/launch-access-diagnostic.json).

## 이번 수정과 검증

1. `npm run audit:launch`를 추가했다. 토큰 정상 여부와 실제 DB 전환 가능 여부를 분리하고, 미해결 데이터·계정·권한·백업 조건이 있으면 종료 코드 2를 반환한다. 실제 서비스·복원 인수는 별도로 표시한다.
2. DDL 감사의 ACL 조회를 PostgreSQL 카탈로그 기반으로 수정했다. `information_schema.role_*_grants`는 현재 읽기 감사 역할에서 다른 역할의 권한을 누락시켰다. 공개·열 단위 권한을 이제 확인할 수 있다.
3. P0 확장 SQL에 본문 충돌 차단 검사를 추가했다. 서로 다른 두 본문을 두고 한쪽을 임의로 새 공개 원본으로 복제하지 않는다. 로컬 PostgreSQL 회귀에서 실패 시 원본·새 테이블 상태가 보존됨을 확인했다.
4. [유지보수 권한 차단 SQL](../../database/p0/003_maintenance_containment.sql)을 사용자 승인 후 실제 운영 DB에 적용했다. P0 잠금 완료 표시나 기능 활성화는 하지 않았으며 기존 행을 보존했다.

검증: 전체 출시 회귀와 Cloudflare Functions 번들 통과. `npm run build`의 마지막 Prisma 생성은 로컬 샌드박스 `spawn EPERM`으로 중단됐고, 같은 코드의 `npm run build:compile`을 허용된 환경에서 재실행해 Prisma 생성·TypeScript 컴파일이 통과했다. 실제 DB 검증은 아래 ROLLBACK 리허설이며 브라우저 인수는 실행하지 않았다.

## 권한 차단 SQL — 사용자 승인 후 운영 적용 완료

현재 권한 복구 GRANT 716개와 정책 목록을 `scratch/p0/maintenance-20260925/`에 저장했다. public 테이블 42개의 행 수·전체 행 해시도 저장했다. 실제 DB에서 차단 SQL과 복구 SQL을 각각 실행한 트랜잭션을 ROLLBACK했고 데이터 해시 일치를 확인했다. 이 자료는 **권한 변경 복구 자료이며 전체 DB 백업·복원 검증은 아니다.**

최초 영구 적용은 자동 승인 검토에서 거절됐다. 사유는 public 테이블·시퀀스·함수 권한과 RLS를 넓게 제한하면 기존 서비스 접근이 중단될 수 있어 별도 승인이 필요하다는 것이었다. 이후 사용자가 `sql 적용 자동승인합니다`라고 명시 승인하여, 2026-09-25 07:13 KST에 검토한 SQL 그대로 적용했다. 적용 직전 스키마·권한 무변경과 SQL 해시 일치를 확인했다.

- 익명·인증 사용자의 직접 테이블 쓰기, 비밀번호/설정/본문·비공개 테이블 조회, 기존 public RPC 실행을 차단한다.
- 공개된 일반 웹소설·무료 회차와 승인 작가의 명시적 메타데이터 조회는 유지한다.
- 기존 계정·작품·원고·소유자·기능 플래그는 바꾸지 않는다. 기존 구 경로에 의존한 기능은 접근이 중단될 수 있다.

적용 후 public 테이블 42개의 행 수·전체 행 해시가 모두 일치했다. 작품 30개·회차 180개·작가 30개·독자 11개·초안 2개를 보존했다. 익명/인증 역할의 감사 대상 민감 SELECT 허용은 0개, public 테이블 쓰기 권한도 0개다. 구 본문 RPC 실행 권한도 차단됐다.

실제 익명 HTTP HEAD 검증에서 민감 열·본문·초안 등 7개 경로는 401로 거절됐고, 공개 메타데이터 3개 경로는 정상 범위 응답 206이었다. 현재 공개 범위는 작품 16개·무료 회차 48개·승인 작가 30개이며 전체 데이터 수와 다르다. 이 401은 관리 토큰 오류가 아니라 의도한 접근 거절이다.

[실제 SQL 적용·데이터 보존 증거](../../artifacts/maintenance-containment-verification.json) · [HTTP 권한 검증](../../artifacts/maintenance-containment-http.json). 서비스 API는 여전히 503이다. 전체 서비스 전환에는 아래 데이터·계정 작업이 필요하며, 이번 승인을 소유자·본문 원본의 임의 결정으로 해석하지 않는다.

## 운영자가 준비할 실제 입력

### 1. 작품 소유자 확인

로컬 `scratch/launch/owner-reconciliation.csv`에 미연결 작품 20개를 추출했다. `work_id`와 제목을 확인하고 `verified_author_id`, `evidence_ref`, `verified_by`를 채운다. 기존 작가 ID는 Supabase Table Editor의 `public.authors`에서 소유 확인 자료와 대조한다. 이름·필명·제목 일치만으로 확정하지 않는다. 작성한 CSV는 Git에 넣지 않는다.

### 2. 공개 본문 원본 확정

로컬 `scratch/launch/body-reconciliation.csv`에 180개 회차의 두 본문 길이·해시를 기록했다. 본문 원문은 CSV에 넣지 않았다. Table Editor에서 각 원본을 확인하고 `verified_source`를 `episodes.content` 또는 `episode_contents.text_content`로 지정하며 근거·확인자를 적는다. 공통 이관 정책을 확인할 수 있으면 그 근거 문서를 함께 제공한다. 비어 있지 않다는 이유만으로 다른 원본을 덮어쓰지 않는다. 백업 후 승인된 버전만 정합화하고 기존 두 원본은 보관한다.

### 3. 전체 백업과 최초 계정 연결

- [마이그레이션 절차](migration-runbook.md)의 DB 덤프·격리 복원을 수행한다. Supabase Dashboard → Connect의 DB 접속 정보는 보안 저장소/로컬 비공개 환경에 두고, 비밀번호·덤프를 채팅이나 Git에 올리지 않는다. 현재 로컬에는 DB 접속 비밀번호·덤프 도구·격리 대상이 없다.
- 초기 관리자·작가·독자로 사용할 실제 계정과 기존 프로필의 소유자를 확인한다. Supabase Authentication에 검증된 계정을 만든 뒤 그 Auth UUID와 기존 프로필 ID, 확인 근거를 준비한다.
- 현재 구 `handle_new_user` 트리거는 Auth UUID를 integer `readers.id`에 넣는 구현이므로 그대로 가입부터 시도하지 않는다. 백업·본문/소유자 정합화 후 001~004를 검토 적용하면 004가 이 구 트리거를 제거하고 확인 후 프로필 생성으로 전환한다.
- `authoring.link_verified_identity`로 검증된 연결을 수행한다. 관리자 권한을 임의 계정에 부여하거나 기존 계정을 이름·이메일만으로 합치지 않는다.

### 4. SQL 및 Cloudflare 설정

입력 검증·백업·격리 복원이 끝나면 [실제 서비스 활성화 절차](production-activation.md)의 001~011과 최종 P0 잠금 순서를 따른다. 현재 상태에서는 본문 충돌과 미연결 작품으로 적용이 중단되는 것이 정상이다.

사용자가 직접 변경할 Cloudflare 위치는 Workers & Pages → `webnovels` → Settings → Variables and Secrets / Bindings, 환경은 **Production**이다. 프로젝트 URL/공개 키, 서버 전용 secret, Images binding을 확인한다. 실제 DB 잠금·권한 인수 전에는 `P0_API_ENABLED` 및 관련 기능 플래그를 일괄 켜지 않는다. 검증 후 [설정표](production-activation.md#5-cloudflare-pages와-예약-실행기)에 따라 기능별로 활성화하고 재배포한다. 예약 발행 Worker는 Pages와 별도 배포다.

## 재확인 명령

```powershell
npm run diagnose:launch
npm run audit:p0-schema
npm run audit:launch
npm run build
npm run release:status -- <40자리-커밋-SHA>
```

현재 `diagnose:launch`의 관리 접근은 성공하며 `audit:launch`는 실제 미완료 조건 때문에 실패한다. `/api/v2/health` 200, 무료 본문·인증·작가 원고·게시의 실제 정상 동작과 권한 거절까지 확인해야 서비스 구동 완료다. 브라우저/localhost 인수는 프로젝트 규칙에 따라 명시 요청 전에는 수행하지 않는다.
