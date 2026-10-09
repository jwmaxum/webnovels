# 25단계 무료 전환 패키지 계약

검토자가 서로 다른 시점의 원본·승인·SQL·공개본 증거를 혼용하지 않도록 연결한다.
도구는 private 파일 준비와 증거 연결만 수행하며 DB 적용·프로젝트 생성·플래그 활성화·
출시 승인 기능이 없다. 기존 Author/Creator·원고 revision·권리·등급/AI·무료 이관 계약을 유지한다.

## 후보와 보존

`npm run prepare:free-cutover -- prepare <logical-backup-dir> <native-backup-dir> <candidate-40-SHA> <https-origin> <NOVEL_FREE|NOVEL_WEBTOON_FREE> [isolated-target-ref]`

검증된 23단계 논리 백업과 native archive, 기존 원본 검토/24단계 이관 영향 packet을
`scratch/launch/backups/<logical>/cutover-stage25/<candidate>/`에 새로 복사한다.
원본 파일과 이미 존재하는 패키지를 덮어쓰지 않는다. 실패한 부분 패키지를 이어 쓰지 말고 조사 후
새 백업/후보로 재준비한다. SQL은 해당 Git 후보의 고정 파일을 `git cat-file --batch`로 읽어
정확한 바이트를 보관한다. 001~015/017/018, P0 확장/잠금, 검토 004·이관 005만 허용한다.
002는 007에, 012는 013에 선행한다. 기존 적용 marker는 재적용 대신 실제 스키마 검증을 요구한다.
016 수익화·개발 seed·임의 SQL 경로를 받지 않는다.

초기 packet은 **계획용**이다. 복원 후 원본 검토 packet, 정합화/마이그레이션 후 이관 packet을
각각 새 검증 snapshot으로 다시 생성한다. 논리/native 백업은 독립 시각의 캡처이며
같은 테이블 수나 각각의 SHA가 두 캡처의 동일한 데이터 상태를 증명하지 않는다.
native 복원 후 논리 기준과 대조·정합화한 근거를 별도로 확보한다.

## 순서와 증거

| 단계 | 필요한 실제 근거 | 결과 대조 |
| --- | --- | --- |
| RESTORE | 별도 hosted 프로젝트·외부 작업 격리·native/논리 대조·Auth/Storage/ACL/RLS/RPC 인수 | 기존 논리 데이터의 전체 테이블/행 보존 |
| CONTENT | 새 target 원본 packet·확정 결정·원작자 권리/이미지 파일·생성 SQL | 승인한 두 본문 일치·미선택 행/원고 보존 |
| MIGRATIONS | 고정 후보 SQL 순서/해시·기존/신규 스키마·private 버킷 | 전체 필수 marker·P0 확장·충돌 0·기존 필드 보존 |
| IMPORT | 마이그레이션 후 target packet·권리/최초 공개시각/전환 증거·생성 SQL/UUID | 새 head/version·BASELINE·private 이력 수·기존 행 보존 |
| LOCKDOWN | 검토한 P0 잠금·직접 접근 거절·교차 역할/무료 RPC | locked marker·기존 데이터 보존 |
| BETA | 같은 후보/origin/scope의 19단계 전체 실제 증거·참여/운영 확인 | 읽기 전용 최종 snapshot·사람의 승인 대기 |

`proofs/`에 필요한 원문/승인/실행/결과 파일을 먼저 놓고, 해당 descriptor의 상대 경로·
바이트 수·SHA-256을 기록한다. 경로 이탈·심볼릭 링크·비정상 크기·바이트 변조는 거절한다.
각 `webnovels-cutover-step-v1` 기록은 stage/candidate/origin/scope/sourceRef/targetRef,
status/kind/observedAt, previousRecordSha256, beforeSnapshotSha256, afterSnapshotSha256,
proof와 resultSnapshot을 갖는다. 첫 previousRecordSha256은 manifest 원문 바이트 SHA이며
다음 기록은 직전 기록의 **실제 바이트** SHA다. 모든 변경 단계는 새 전체 논리 snapshot을,
BETA는 같은 최종 snapshot과 `resultSnapshot:null`을 요구한다. 결과 snapshot은
`webnovels-logical-data-v1` 전체 메타데이터·7개 requested schema·핵심 테이블·컬럼/행/수/
fingerprint와 선행 데이터 보존을 확인한다. 14일 이내의 순서 있는 실제 관찰만 허용한다.
행 fingerprint는 기존 백업 exporter의 정렬된 행 문자열 MD5 계약을 따르며 파일 전체의
SHA-256으로 별도 보호한다. bigint와 NUMERIC 소수는 JSON 숫자 원문·타입을 보존해
비교한다. 잠금 SQL의 applied_at 갱신은 이전/현재 snapshot 사이 시각만 허용한다.

CONTENT/IMPORT proof에는 packet/decisions/executedSql descriptor가 추가된다.
CONTENT SQL은 승인 결정과 고정 후보 template으로 재생성해 바이트를 비교한다.
IMPORT SQL은 같은 방식으로 재생성하되 원래 생성한 `legacyImportSql().versionIds` 순서를
proof에 기록해 UUID를 재사용한다. 승인 회차가 0이면 executedSql은 null, IMPORT versionIds는
빈 배열이어야 한다. 임의 SQL을 정상 template hash 옆에 첨부해 통과시킬 수 없다.
권리·이미지·cutover 파일까지 바이트를 확인하고 PENDING/HOLD를 완료로 처리하지 않는다.

`npm run prepare:free-cutover -- record <package-dir> proofs/<next-record>.json`
명령은 모든 기존 기록과 새 기록을 검증한 뒤 `steps/01-RESTORE.json`부터 지정 순서로
새 파일을 추가한다. 기존 기록 교체·중복/단계 건너뛰기·source snapshot 재사용은 거절한다.
`npm run prepare:free-cutover -- check <package-dir>`는 전체 파일과 후보 Git blob을 재검증한다.
status는 BLOCKED, READY_FOR_NEXT_REVIEW, READY_FOR_HUMAN_APPROVAL 중 하나이며
activationAllowed/sqlExecuted/flagsChanged/hostedRestoreAccepted는 항상 false다.

## 실제 인수와 한계

빈 target 점검은 복원 전 preflight다. 데이터가 채워진 복원 결과에 빈 조건을 다시 적용하지 않는다.
로컬 PGlite/합성 snapshot/단위 테스트는 실제 hosted 복원·파일 바이트·교차 역할·기기 인수를
대신하지 않는다. 이 validator는 첨부 자료의 완전성과 연결을 검사하며 운영자 신원·권리/
hosted 증거의 진위를 인증하지 않는다. 데이터 비교는 논리 행과 marker 기준이고 실행 DDL,
ACL/RLS/RPC·메일·외부 파일 권리는 실제 인수 기록과 사람의 검토가 필요하다.
read-only beta 평가는 마지막에 수행하므로 잠금/권한 인수의 선행 조건으로 순환하지 않는다.

25단계에서 만든 실제 준비 패키지는 24단계 기준 후보 `04a0318...`의 **계획 자료**다.
격리 대상과 원본 승인 파일이 없으므로 hosted 완료 기록은 0개이고 무료 출시 NO_GO를 유지한다.
26단계에는 새 후보 패키지·실제 별도 프로젝트·원본/권리 승인·단계별 새 백업과 hosted 인수를
확보한 뒤 검토된 무료 전환을 진행한다.

## 26단계 원본 결정 입력 보조

[워크벤치](content-review-workbench-contract.md)의 finalization 결과는 기존 CONTENT
decisions schema다. 패키지에는 `review-.../final-.../decisions-reviewed.json`의 정확한
backup-root 상대 경로를 제공한다. private evidence 경로도 같은 backup root를 기준으로
유지한다. PENDING/HOLD 잔여·권리/등급/AI·hosted 인수 게이트와 단계별 새 snapshot 요건은
그대로이며, 화면/파일 검증 성공으로 CONTENT 실행 완료나 BETA GO를 기록하지 않는다.
