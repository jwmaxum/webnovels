# 503 복구 실행 기록과 남은 절차

2026-09-25. 운영 프로젝트 `ghwabesnydktumeyejnm`, Pages `webnovels`.

2026-09-26 후속: [비공개 작가 작업실](author-workspace-rollout.md)을 위한 authoring 001/003/004/005/006 적용과 실제 작품/원고 저장·충돌·권한 검증을 완료했다. 초안 2건 및 기존 계정 연결 근거 41건을 보존했다. 아래 전체 콘텐츠 전환 순서에서는 현재 적용 버전을 대조하며, 78개 본문 확인과 P0/공개본·Storage 전환은 계속 필요하다.

후속 계정 작업: 명시 요청에 따라 가상 작가 30·독자 10과 직접 생성한 최고 관리자 1명을 Auth에 연결했다. [계정 인증·관리 적용 기록](virtual-accounts-rollout.md)을 우선 참고한다. 본문·콘텐츠 서비스의 남은 전환 조건은 계속 적용된다.

## 현재 결과

| 항목 | 실제 수행 결과 |
|---|---|
| 작품 소유자 | 누락 20건 수정, 고아 작품 **0건**. 작품 11~30의 명시적 시드 FK와 운영 작품 ID/제목/유형/상태, 작가 ID/username/필명/상태를 대조했다. 숫자나 이름만 보고 연결하지 않았다. 표지 변경과 다른 필드는 보존했다 |
| 본문 | 사용자 선택에 따라 작품별 기존 원고 **102건**으로 정합화. `episodes` 전체 행은 그대로이고, 대응 `episode_contents`의 본문·버전·수정시각만 변경했다 |
| 보류 본문 | **78건**의 빈 본문과 이미지 참조, 상대 저장소의 예시문을 모두 보존했다. 현재 유형은 NOVEL 36건 / WEBTOON 42건. 13개 작품에 걸쳐 있어 유형/이미지/원문을 함께 검토해야 한다 |
| 변경 이력 | 비공개 `launch_recovery.reconciliation_history`에 변경 전후 **122건** 보존. 브라우저/서비스 역할 접근 거절, UPDATE/DELETE 차단 |
| Auth 준비 | Auth UUID를 integer `readers.id`에 넣던 구 가입 트리거 오류를 재현하고 제거했다. 독자·작가·관리자에 별도 `auth_user_id` 연결 열/고유 인덱스 준비. 기존 프로필 ID·비밀번호·역할 보존 |
| Auth 실제 연결 | **41건**. 후속 명시 요청에 따라 가상 작가 30·독자 10과 확인 완료된 기존 최고 관리자 1 연결. 근거와 변경 전 백업 보존 |
| 백업 | 변경 전 77개 테이블/987행, 변경 후 78개 테이블/1,109행의 동일 시점 데이터 백업. 변경 후 **pg_dump 17.11 custom archive**도 확보(78개 TABLE DATA 항목) |
| 복원 검증 | 실제 행을 격리 PGlite에 복원하여 전체 행 일치와 public 제약조건 **98개** 검증. 네이티브 아카이브는 `pg_restore --list` 통과. **Supabase 전체 스키마·서비스 복원 시험은 미실행** |
| 서비스 | 콘텐츠 API는 `503 SECURE_API_NOT_ACTIVATED` 유지. 계정 전용 API는 별도 DB 준비 검사로 로그인·가상 계정 관리 제공. 기존 기능 플래그 변경 없음 |

증거: [적용 결과](../../artifacts/launch-reconciliation-applied.json), [원본 보존 대조](../../artifacts/launch-reconciliation-preservation.json), [Auth 준비](../../artifacts/launch-auth-preparation.json), [네이티브 백업](../../artifacts/launch-native-backup.json), [데이터 복원](../../artifacts/launch-data-restore.json).

이 작업은 기존 시드 데이터의 관계를 복구한 것이다. 실제 사람의 저작권·Auth 신원 확인을 대신하지 않는다. 재시드, 원고 삭제, 계정 병합, 유료/성인 기능 활성화는 수행하지 않았다.

## 503을 200으로 전환하는 순서

1. **남은 원본 확인:** `scratch/launch/empty-body-review-20260925.csv`의 78개 회차에 작품 유형, 사용할 원본, 확인자/근거를 기록한다. 작품 ID는 9, 10, 12, 14, 17, 19, 21, 22, 23, 24, 25, 26, 28이다. 현재 소설로 분류된 빈 이미지 회차를 반복 예시문으로 채우거나 웹툰으로 자동 재분류하지 않는다. 확인 전 공개 대상에서 보류하는 정책이 필요하면 원본 보존·새 공개본 제외 규칙을 먼저 확정한다.
2. **최초 관리자 본인 확인:** 아래 계정 절차에 따라 관리자 프로필 ID, 확인 완료 Auth UUID, 소유 확인 근거를 준비한다. 독자/작가도 같은 방식으로 확인한다.
3. **격리 Supabase 복원:** 운영과 다른 복원 대상을 준비한다. 이번 덤프의 schema/data/ACL/RLS/RPC/trigger와 원고·초안·계정·원장을 복원하여 실제 역할별 접근을 확인한다. 로컬 행 복원 통과만으로 이 단계를 완료 처리하지 않는다.
4. **증분 SQL 전환:** [활성화 절차의 SQL 순서](production-activation.md#4-sql-적용-순서)에 따라 P0 001 → authoring 001~011을 검토 적용한다. 남은 78개 본문 충돌 때문에 현재 P0 001이 중단되는 것은 정상이다. 충돌 검사를 삭제하거나 잠금 마커를 수동 생성하지 않는다.
5. **계정 연결·공개본 이관·권한 검증:** 검증된 최초 관리자 bootstrap과 `authoring.link_verified_identity`를 실행한다. 기존 원고/초안/공개본 포인터를 이관하고 역할별 읽기·쓰기와 복원을 확인한 뒤 최종 P0 002를 적용한다.
6. **사용자 담당 Cloudflare 설정:** Production의 서버 비밀·프로젝트 URL/공개 키·Images binding·기능별 플래그를 [설정표](production-activation.md#5-cloudflare-pages와-예약-실행기)에 맞추고 재배포한다. Pages `webnovels`와 별도 예약 Worker를 구분한다. 미완료 기능은 활성화하지 않는다.
7. **실제 구동 판정:** `/api/v2/health` JSON 200, 무료 본문 열람, 확인된 계정 로그인/원고 저장/게시, 다른 작가 접근 거절, 예약/파일 복구를 확인한다. 브라우저 인수는 프로젝트 규칙에 따라 별도 명시 요청 후 수행한다.

## Auth 계정 연결을 위한 구체적 입력

로컬 검토표: `scratch/launch/auth-link-review-20260925.csv`. 기존 45개 프로필(독자 11, 작가 30, 관리자 4)의 ID를 보존한 목록이다. 개인정보가 있으므로 Git에 넣지 않는다.

1. 실제 소유자가 제어하는 이메일의 Auth 계정을 Supabase Authentication에서 준비하고 이메일 확인을 완료한다. 현재 잘못된 가입 트리거는 제거되어 있다. 메일 발송·비밀번호 설정은 계정 소유자와 운영자가 수행한다.
2. 검토표의 `auth_user_id`, `evidence_ref`, `verified_by`를 채운다. Auth UUID와 정수 작가/독자 ID를 구분한다. 이메일/필명 일치만으로 매핑하지 않는다.
3. 처음에는 기존 **활성 SUPER_ADMIN** 프로필 하나를 지정한다. 새 역할 승격 없이 [bootstrap SQL](../../database/launch/003_bootstrap_verified_admin.sql)을 사용한다. 이 파일은 **준비·로컬 검증만 완료**했으며, authoring/003 및 소유 확인 전 운영 실행하지 않는다.
4. 같은 SQL 실행 배치에서 `webnovels.bootstrap_profile_id`, `webnovels.bootstrap_auth_user_id`, `webnovels.bootstrap_evidence_ref`, `webnovels.bootstrap_operator_ref`를 설정한다. 확인된 Auth 계정과 기존 SUPER_ADMIN 조건이 아니면 SQL이 중단된다. 충돌 연결은 교체하지 않고 동일 연결 재실행은 기존 증거를 보존한다.
5. 후속 작가/독자/관리자는 이미 검증된 최고관리자를 검증자로 하여 `authoring.link_verified_identity(kind, profile_id, auth_uuid, verified_by_uuid, evidence_ref)`로 연결한다. 상태·역할을 이 과정에서 바꾸지 않는다.

## 백업 위치와 범위

모든 원본/덤프는 Git 제외 폴더 `scratch/launch/backups/` 아래에 있다.

| 디렉터리 | 내용 |
|---|---|
| `2026-09-24T23-14-25-692Z/` | 변경 전 snapshot/manifest, 실제 데이터 복원 결과, 검토 계획, 실행 SQL과 리허설/적용 기록 |
| `2026-09-24T23-30-15-281Z/` | 변경 후 snapshot/manifest, 78개 테이블 데이터 복원 결과 |
| `native-2026-09-24T23-31-39-721Z/` | `application-auth-storage.dump`, manifest, 아카이브 목차, 공개 CA 인증서 |

네이티브 덤프 SHA-256: `988c1e288126be833b307ffc8c3ef03377d1f8aff3a7fd9eb3a587276274ef74`.

네이티브 덤프는 public/auth/storage/launch_recovery와 존재하는 authoring 스키마를 보존한다. 클러스터 역할 정의·제공업체 내부 설정, Storage 파일 바이트, 외부 이미지 파일은 별도 대상이다. 현재 Storage 버킷/객체는 0개다. 독립 저장장소의 암호화 사본 및 호스팅 Supabase 복원은 아직 확인하지 않았다. 제공업체 자동 백업/PITR도 별도로 설정해야 한다.

이번 네이티브 백업은 [공식 임시 로그인 역할 API](https://supabase.com/docs/reference/api/v1-create-login-role)의 읽기 전용 역할(비밀번호 유효기간 300초)을 사용했다. DB 비밀번호를 채팅/환경파일에 추가할 필요 없이 성공했다. 인증서는 [Supabase SSL 절차](https://supabase.com/docs/guides/platform/ssl-enforcement)에 따라 CA와 호스트를 모두 검증했다. 백업/복원 범위는 [공식 복원 절차](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)를 기준으로 확장한다.

```powershell
# 읽기 전용 백업. 파일 내용/비밀은 콘솔에 출력하지 않는다.
npm run backup:launch-data
npm run backup:launch-postgres
node scripts/verify_launch_backup.mjs scratch/launch/backups/<데이터-백업-디렉터리>
npm run audit:launch
```

`PG_DUMP_PATH`는 필요할 때 네이티브 실행 파일 경로로 설정한다. 기본 도구 위치는 `scratch/tools/postgresql-17/pgsql/bin/pg_dump.exe`다. [PostgreSQL 공식 Windows 안내](https://www.postgresql.org/download/windows/)에서 연결한 EDB 바이너리를 사용했으며 시스템 전역 설치는 하지 않았다.

## 변경 복구

본문/소유자 수정에는 낡은 검토표나 변경된 행을 거절하는 전체 행 해시 검사가 있다. 두 SQL은 트랜잭션으로 실행되며 변경 전후 이력을 보존한다. 재적용은 기본적으로 거절한다. 복구가 필요하면 `launch_recovery.reconciliation_history`의 해당 batch/원본과 **현재** 행을 대조한 별도 보상 SQL을 작성한다. 전체 덤프를 운영에 덮어쓰거나 이전의 광범위 브라우저 권한을 다시 열지 않는다.

Auth 준비 변경에는 실제 계정 생성·연결이 없었다. 제거한 구 트리거 정의는 변경 전 snapshot에 있다. 이 트리거를 복구하면 UUID/정수 오류가 다시 생기므로 정상 onboarding 전환 또는 검증된 호환 복구안을 사용한다.
