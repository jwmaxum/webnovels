# Supabase 2026-10-30 명시적 권한 변경 대응

확인일: 2026-10-21 KST. 32단계 후속 권한 점검이며 서비스 공개/DB 전환 완료 기록이 아니다.

## 공지의 의미

[Supabase 공식 공지](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)에
따르면 기존 프로젝트도 2026-10-30부터 새 `public` 테이블·시퀀스의 API 역할 자동 권한에
의존할 수 없다. 기존 객체의 권한은 유지된다. 새 프로젝트, preview branch, DB reset처럼
객체를 재생성하는 경우에도 마이그레이션의 명시적 GRANT가 필요하다.

테이블 권한과 RLS는 별개다. `service_role`도 RLS 우회만으로 테이블 ACL을 통과하지 못한다.
공지의 anon SELECT / authenticated CRUD 예시는 모든 서비스에 적용할 권한 정책이 아니다.
이 프로젝트의 원고·계정·관리자 데이터에는 그대로 적용하지 않는다.

## 현재 운영 DB의 읽기 전용 확인

2026-10-21 08:21 KST에 `.env.local`로 지정된 기존 DB의 카탈로그와 유효 권한을 확인했다.
관리 SQL의 `/database/query/read-only`만 사용했다. 데이터·권한·기본 권한·기능 플래그는 변경하지 않았다.

| 항목 | 확인 결과 |
|---|---|
| public 테이블 | 42개 |
| PUBLIC / anon / authenticated 전체 테이블 권한 | 0건 |
| 브라우저 열 단위 권한이 있는 테이블 | authors, episodes, works |
| 브라우저 유효 테이블 쓰기 권한(INSERT/UPDATE/DELETE/TRUNCATE) | 0건 |
| 서버의 works/episodes/authors/readers/admin_users SELECT 누락 | 0건 |
| 계정·작업실 RPC 5개 | service_role EXECUTE 허용, anon/authenticated 거절 |
| public 시퀀스 | 3개, ACL 감사에 포함 |
| 생성 역할의 기본 권한 | 기존 postgres/supabase_admin 자동 권한이 아직 존재 |

RPC 5개는 `launch_accounts_ready`, `launch_account_actor`, `launch_author_workspace_ready`,
`creator_works`, `creator_drafts`다. 현재 객체의 서비스 접근 권한 누락은 발견하지 못했으므로
운영 DB에 추가 GRANT를 실행하지 않았다. 기존 기본 권한이 남아 있다는 사실을 신규 객체의
접근 보장으로 사용하지 않는다.

`npm run audit:p0-schema`가 사용하는 `database/p0/000_preflight.sql`에
`sequence_grants`, `default_privileges`를 추가했다. 제한된 감사 역할에서도 볼 수 있는
PostgreSQL 카탈로그 ACL을 사용한다. 기본 권한은 생성 역할별로 다르며, 전역(`schema=null`)과
public 스키마 항목이 합산된다. 기본 권한 항목이 없더라도 기존 객체에는 명시 권한이 있을 수 있다.

원문은 함수 정의에 비밀을 포함할 수 있어 Git 제외 경로 `scratch/p0/schema-audit.json`에
보관한다. 이번 비밀 없는 집계와 유효 권한 결과는 `scratch/p0/october-grants-summary.json`에
보관했다. 운영 테이블에 시험 행을 만들거나 RPC로 원고를 저장하지 않았다.

## 지원하는 마이그레이션 경로

| 경로 | 권한 처리 |
|---|---|
| `p0/001_expand_identity_content.sql` | 새 public 테이블 4개에 같은 파일에서 service_role 권한 부여, 브라우저 권한 제거 및 RLS |
| `p0/002_lockdown_after_cutover.sql` | 검증된 전체 전환 시 기존 public 테이블·시퀀스 서버 권한과 브라우저 공개 열 권한 명시 |
| `launch/004`, `launch/007~008`, `authoring/001/003~006` | 현재 비공개 작업실: 서비스 전용 SECURITY DEFINER RPC를 통한 작품·원고 접근 |
| 후속 authoring/launch/growth/commerce 객체 | 비공개 스키마 및 각 마이그레이션의 명시적 RPC/객체 권한 계약 사용 |

현재 작업실은 비공개 테이블을 브라우저에 개방할 필요가 없다. 특히 `launch_recovery`의
계정 근거 테이블은 service_role의 직접 접근도 의도적으로 막고 RPC 내부에서만 접근한다.

루트의 과거 `database/*.sql`은 순서대로 모두 실행하는 신규 구축/복원 경로가 아니다.
과거 관리자 공개 권한을 되살릴 수 있으므로 권한 오류 해결용으로 재실행하지 않는다.
[실제 활성화 절차](production-activation.md), 검토된 백업과 단계별 SQL을 따른다.

## 추가한 회귀 검증

- P0 시험: 자동 테이블·시퀀스 권한이 없음을 먼저 확인한다. 생성 SQL만으로 새 public 테이블
  4개를 서버가 읽고, 최종 잠금 이후 실제 service_role로 서버 조회와 시퀀스 사용이 성공한다.
  브라우저는 공개 메타데이터만 읽고 비공개 데이터는 거절된다.
- 작업실 시험: public 테이블 SELECT가 없는 service_role로 계정 확인, 작품 생성/수정,
  원고 저장/조회/버전/충돌/소유권 검증을 수행한다. 직접 본문·계정 근거 접근과 브라우저 RPC는 거절된다.
- 감사 시험: 제한된 감사 역할로 테이블/열/시퀀스 ACL과 전역·스키마 기본 권한을 확인한다.
  기본 권한을 없앤 후에도 기존 시퀀스의 명시 권한이 유지되는지 확인한다.

기존 `test:admin-operations`와 `test:launch`에 포함되므로 `npm run build`와 GitHub CI가 실행한다.
새 의존성은 추가하지 않았다. 이 검증은 PGlite 합성 DB에서 실행하며, hosted Supabase 복원이나
PostgREST/GraphQL HTTP 인수 시험을 대신하지 않는다.

검증 결과: 변경 범위의 15개 테스트 통과. 전체 릴리스 항목, Cloudflare 번들 및
`build:compile`(Prisma 생성·TypeScript 컴파일)도 통과했다. 첫 `npm run build`는 기존 26단계
시험용 junction 생성이 Windows 샌드박스에서 EPERM으로 거절되어 중단됐다. 25단계까지의
성공을 보존하고, 필요한 실행 권한으로 26단계부터 남은 모든 항목과 컴파일을 재실행해 통과했다.
테스트 생략이나 제품 코드 변경은 없었다. 변경 JS 구문 검사, 비밀 패턴 점검과 diff 검사도
통과했다. 별도 lint/coverage 설정은 없어 해당 수치를 산출하지 않았다. localhost/브라우저
시험은 실행하지 않았다.

## 다음 개발·운영 반영

새 테이블을 만드는 같은 마이그레이션에 호출 역할에 필요한 권한을 포함한다. 서버 전용 객체는
브라우저 권한을 제거하고, 직접 테이블 접근 대신 RPC를 사용하는 경우 EXECUTE와 소유권 검증을
함께 유지한다. 테이블 소유자 역할로만 시험하지 않고 API 역할별 허용·거절을 검증한다.

다음 DB 적용/격리 복원 때 이 감사를 다시 실행하고 실제 PostgREST 역할·시퀀스·RLS 접근을
인수 항목에 포함한다. 이번 공지 대응으로 기존 본문 충돌, 업로드/발행 활성화, 예약 워커,
hosted 복원 인수가 해결되지는 않는다. 다음 기능 개발은 [32단계 인수 기록](stage32-acceptance.md)의
잔여 항목과 **동일 DB에서 신규 작품부터 공개하는 범위 분리** 계획을 따른다.
