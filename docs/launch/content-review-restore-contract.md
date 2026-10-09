# 원본 검토·복원 준비 계약 — 23단계

[계획](../../improve23.md), [기존 복구 기록](503-recovery-plan.md),
[마이그레이션](migration-runbook.md), [품질·증거 계약](stage19-quality-contract.md)을 확장한다.
기존 20건 소유자·102건 본문 정합화와 그 불변 이력은 유지한다.

## 백업 범위와 실제 검증

논리/native 백업은 `public`, `auth`, `storage`, `authoring`, `launch_recovery`,
`commerce`, `growth`의 공통 범위 계약을 사용한다. 미적용 스키마는 `absentSchemas`로
표시한다. native는 존재하는 스키마만 `--strict-names`로 요청하고 TABLE DATA 목록이
전후 카탈로그와 같아야 성공한다. 논리 백업은 모든 행/메타데이터를 한 MVCC statement에
담고 전후 테이블 목록도 비교한다. 연속 수행한 두 백업은 같은 snapshot의 증거가 아니다.

로컬 복원은 JSON 문자열의 bigint/numeric을 PostgreSQL에서 해석해 모든 행을 비교한다.
서비스 스키마의 check/FK와 FK 참조용 standalone unique index도 복원한다.
hosted ACL/RLS/RPC/Auth/Storage·메일·Cron·기기 인수를 대신하지 않는다.
원본은 private `scratch/launch/backups`에 보관하고 stage23 집계만 Git에 포함한다.

```text
npm run backup:launch-data -- --report-prefix=stage23
npm run backup:launch-postgres -- --report-prefix=stage23
node scripts/verify_launch_backup.mjs <논리-백업-디렉터리> --report-prefix=stage23
npm run prepare:launch-restore -- <논리-백업-디렉터리> <native-백업-디렉터리> [별도-프로젝트-ref]
```

복원 준비는 archive signature·실제 바이트 SHA·크기·테이블 목록·스키마·source ref를
확인하고 운영과 같은 target을 거절한다. 프로젝트 ref는 URL/비밀번호가 아니다.
별도 대상의 소유/비용/접근을 검증하거나 프로젝트 생성/복원 명령을 실행하지 않는다.
역할·managed schema 충돌/trigger·provider 설정은 담당자가 검토하고 격리 native 복원을
수행한다. DB 백업에 Storage 파일 바이트가 포함된다고 가정하지 않는다.
독립 암호화 보관과 외부 이미지/권리 확인도 별도이다.

## 검토 자료와 결정

```text
npm run review:launch-content -- prepare <검증된-논리-백업-디렉터리>
```

`review-stage23/packet.json`은 회차 두 행·이미지·작품·작가·Auth·identity evidence를
보존한다. 비공개 원고/계정 정보를 출력·Git·공유 채널에 넣지 않는다.
`decisions-template.json`을 별도 이름으로 복사해 검토하고 원래 packet/template을
덮어쓰지 않는다. 생성 시 모든 결정은 PENDING이다.

| 결정 | 의미와 필수 자료 |
|---|---|
| PENDING | 확인 대기. SQL 대상이 아니며 미해결 충돌로 남는다. |
| HOLD | 확인자와 보류 사유. 두 원본 보존이며 충돌 해결/P0 승인이 아니다. |
| USE_EPISODES | 검증된 episodes.content. 확인자·권리자/원본 근거 파일·선택 해시 필요. |
| USE_EPISODE_CONTENTS | 검증된 episode_contents.text_content. 동일한 근거 필요. |

결정 필드는 `episodeId`, `sourceDigest`, `decision`, `reviewerRef`, `evidenceRef`,
`rightsEvidence`, `imageEvidence`, `selectedSourceSha256`이다. 근거 descriptor는 backup root
아래 상대 `file`, 실제 `bytes`, `sha256`이다. NULL/공백/줄바꿈을 구분한다.
작품·회차·작가 ID는 bigint 문자열이며 Auth UUID와 다르다. 검토자가 실제 권리자와
원본 파일을 확인한 기록을 첨부해야 한다. **파일 해시나 기존 Auth 연결이 저작권·
이미지 품질·검토자 신원을 자동 인증하지 않는다.**

누락/중복/잘못된 ID·unknown 필드·다른 snapshot/행/선택 해시를 거절한다.
확인된 Auth/identity 연결 없는 소유자, 빈 소설 원본, 개발 seed와 정확히 같은 예시문을
승인하지 않는다. 웹툰은 기존 이미지와 별도 이미지 인수 근거도 필요하다.
작품 유형을 바꾸거나 외부 원고를 새로 쓰지 않는다. 소설 image-only 건은 실제 원본 확보와
유형 검토 후 별도 이관 계획이 필요하다.

## 변경 SQL과 리허설

```text
npm run review:launch-content -- rehearse <검증된-논리-백업-디렉터리> review-stage23/decisions-reviewed.json
```

운영 API 호출/`--apply`는 지원하지 않는다. 도구가 snapshot을 로컬 복원해 packet을
재생성하고 근거 파일 바이트를 검증한다. 승인 건이 없으면 SQL을 만들지 않고 미해결
집계와 종료 코드 2를 반환한다. 승인 건만 `004_reviewed_content_selection.sql`로
리허설한다. 하나의 트랜잭션에서 잠금을 잡고 회차 두 행·작품·작가·Auth·identity 전체
행 MD5를 대조한다. 변경/권한 소실이 하나라도 있으면 전체 rollback한다.
SQL/backup SHA-256도 기록한다. MD5는 변경 비교용이며 원본 인증의 근거가 아니다.

`launch_recovery.content_selection_history`는 두 본문·이미지·전후 행·선택·근거를 보존하며
anon/authenticated/service_role 접근과 UPDATE/DELETE를 거절한다. 기존 역사 테이블과
보류/비대상 행·초안·버전·계정·원장도 보존한다. 전체 행을 비교하고 재실행을 거절한다.
기존 SQL 001의 빈 본문 거절, P0 충돌 차단, beta evidence 게이트는 그대로다.
생성 SQL은 승인 자료 일부이며 hosted 복원·원본 확인·역할/Storage 인수·출시 근거 전에
실행하지 않는다. 보류 회차를 자동 숨기거나 첫 공개본에 넣고 충돌을 무시하지 않는다.

## 2026-10-09 실제 준비

논리 SHA `45c6cf26353d5a5cbfc3ff6e2e4f1e0954d92fb661a594ea2bce0698facdf237`:
105테이블/1,381행 전체 일치, public 제약 99개·서비스 제약 216개·독립 unique index 7개.
native SHA `cf1f6309216fa3a0641fc62fe2c659c25552a4aaa239973780c16993090795cc`:
105 TABLE DATA, 641,133 bytes, PostgreSQL 17.11, verify-full TLS.
commerce/growth는 운영 미적용으로 표시했다.
packet은 78건(소설 36·웹툰 42), 대체 seed 일치 78건, 기존 연결 근거 78건,
승인 0/PENDING 78건이다. 기존 연결은 원본/권리자 확인을 대신하지 않는다.
Storage bucket/object는 0개이고 이미지 바이트 인수는 미완료다.
별도 hosted 복원 대상/증거가 없으며 SQL·플래그·운영 원고를 변경하지 않았다.

## 공식 근거

[PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)의 schema 선택·
snapshot, [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)의 복원,
[Supabase 백업](https://supabase.com/docs/guides/platform/backups)의 Storage 바이트 제외와
[격리 복원 절차](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)를 확인했다.
기존 PGlite/Zod/native 도구를 확장했으며 새 의존성은 추가하지 않았다.
