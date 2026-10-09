# 제출 원고 복구 증거 패키지 계약 — 30단계

작성일: 2026-10-10. [작가 접수](creator-recovery-request-contract.md)와
[관리자 검토](admin-recovery-review-contract.md)의 고정 제출본을 복구 후보 계획으로 연결한다.

## 범위와 입력

`scripts/prepare_recovery_evidence.mjs`는 검증된 논리 백업을 PGlite에 복원하여 실행하는
offline 도구다. 환경 비밀·원격 클라이언트·운영 적용 경로를 사용하지 않는다. 기존
[두 본문 선택](content-review-restore-contract.md)이나 [무료 전환 패키지](cutover-package-contract.md)에
외부 원고를 억지로 넣지 않는다. SQL019/020은 기존 무료 전환 allowlist의 적용 완료 항목이 아니다.

입력 디렉터리는 Git에서 제외되는 `scratch/launch/backups` 아래여야 하며 snapshot·manifest·
data-restore-verification의 SHA와 전체 행 검증 기록이 일치해야 한다. 필요한 테이블과
002/007/014/019/020 기록이 없으면 `SOURCE_PREREQUISITES_MISSING`으로 종료한다.
이때 요청 0건은 원본 확보·검토 완료를 의미하지 않는다. 실제 요청이 없는 경우도 승인 0건이다.

```text
npm run prepare:recovery-evidence -- prepare <검증된-백업-디렉터리> review-stage30
npm run prepare:recovery-evidence -- check <검증된-백업-디렉터리> review-stage30
npm run prepare:recovery-evidence -- rehearse <검증된-백업-디렉터리> review-stage30 reviewed.json candidate-stage30
```

`prepare`는 새 디렉터리에 `packet.json`, 전체 `decisions-template.json`, `manifest.json`을
만든다. 모든 결정은 PENDING으로 시작한다. template을 새 `reviewed.json`으로 복사해
운영자가 근거를 확인한 건만 명시적으로 선택한다. 기존 출력은 덮어쓰지 않는다.
`check`는 같은 snapshot과 현재 저장소의 helper/seed에서 재생성한 패키지 바이트를 대조한다.
`rehearse`는 근거 검증과 전체 원본 행 대조 후 새 비공개 계획만 기록한다.

종료 코드 0은 선택한 건의 **계획 검증** 완료다. 2는 전제 누락·선택 없음이고, 1은 입력/
변조/검증 오류다. stdout에는 집계와 해시만, stderr에는 제한된 오류 코드만 출력한다.
운영 원고·계정 상세·인증 비밀·로컬 전체 경로는 공개 검증 기록에 넣지 않는다.

## 고정 제출본과 현재 검토의 연결

Auth UUID, author/work/episode bigint 문자열, draft UUID를 구분한다. bigint를 Number로
변환하지 않는다. 요청이 고정한 `revision`의 title/content/authorComment가 복구 후보이고,
`source_revision`은 최초 파일 가져오기 계보다. 이후 편집은 허용되므로 두 본문 해시는
서로 다를 수 있다. 원본 파일은 처음 수령한 바이트 그대로 SHA·크기를 확인한다.

최신 검토만 사용한다. READY 뒤에 HOLD/반려가 있으면 선택할 수 없다. 현재 작가/Auth와
SUPER_ADMIN/Auth의 활성·확인 상태, 요청과 대상 전체 context, 열람 기록, 세 권리/등급/AI
확인 값, 검토 revision, 멱등 receipt의 전체 payload/result를 연결한다. 감사의 actor/action/
target/work/reason/detail/createdAt도 최신 검토와 일치해야 한다. 이전 READY나 이름/필명으로
권한을 추정하지 않는다. 대상 본문·파일 lineage·계정·검토가 달라지면 새 snapshot이 필요하다.

격리 데이터 복원에는 함수/트리거/RLS가 포함되지 않는다. 도구는 저장소 SQL019/020의
`recovery_target`과 `recovery_review_context` 두 읽기 helper만 설치하고 코드 SHA를 고정한다.
이 결과를 hosted schema/RLS/RPC·다중 연결 동시성 인수로 취급하지 않는다.
빈 제출 소설·개발 seed·전제 누락·invalid context·불완전 감사 사슬은 차단한다.

## 실제 근거 파일

모든 결정은 request/source/packet/snapshot 해시에 연결되며 전체 요청을 포함해야 한다.
`PREPARE_RESTORE`에는 reviewerRef(최소 3자), evidenceRef(최소 10자), submittedSha256 및
다음 `{file, bytes, sha256}` descriptor가 필요하다. descriptor만 적는 것으로 완료되지 않고
해당 로컬 파일의 실제 바이트를 읽어 검증한다.

| 필드 | 경로와 한도 | 확인 목적 |
|---|---|---|
| originalFile | `originals/input/...`의 bin/txt/docx/hwpx, 최대 2MiB | 접수 당시 file SHA·크기와 일치 |
| rightsEvidence | `proofs/input/...` 또는 기존 `<패키지명>/evidence/<sha>.*`, 최대 16MiB | 원작자·유통권·회차 관계 검토 자료 |
| ratingEvidence | 같은 근거 경로·한도 | 공개 등급 검토 자료 |
| aiEvidence | 같은 근거 경로·한도 | AI 관련 표시/내용 검토 자료 |
| imageEvidence | 같은 근거 경로·한도, 기존 이미지가 있으면 필수 | 기존 이미지 권리·보존 검토 자료 |

근거 확장자는 pdf/png/jpg/jpeg/webp/txt/md/json/docx를 허용한다. 절대 경로·`..`·backslash·
제어문자·파일 및 디렉터리 링크는 거절한다. 원본은 같은 snapshot의 파일 ID·SHA·크기에
묶인다. file SHA는 변조 방지 근거이며 권리자 신원이나 원본 파일 형식의 유효성을 인증하지
않는다. 실제 DOCX/HWPX 해석·이미지 수령·내용/권리 인수는 별도 절차다.
HOLD/PENDING에 원본 선택 descriptor를 실을 수 없고 HOLD에는 사유 참조가 필요하다.
서로 다른 요청으로 같은 회차를 중복 선택할 수 없다.

## 계획 출력과 실제 복구의 경계

`candidate-plan.json`은 제출 전문과 보존할 대상 snapshot을 포함하는 **비공개** 파일이다.
검증 보고는 선택/보류/미해결 수와 원본 행 보존 수만 공개한다. 검토 자료와 원고를 Git에
커밋하지 않는다. 요청 수는 기존 78건 전체 충돌의 해결 수가 아니다.

계획 리허설은 snapshot의 모든 테이블/행이 바뀌지 않았음을 대조한다. 본문 교체 SQL,
공개 head 생성, 예약/초안/버전/계정 변경, 원격 적용은 실행하지 않는다. 따라서
`productionChanged`, `hostedRestoreAccepted`, `rightsAuthenticated`, `freeCutoverAccepted`는
항상 false이며 `fullSchemaRestore`와 `bodyReplacementExecuted`도 false다.
부분 선택이 검증되어도 HOLD/PENDING과 전체 출시 차단 사항은 남는다.

31단계에서 새 hosted snapshot에 연결된 전체 행 CAS·원본 보관·불변 복구 이력·rollback
트랜잭션 후보를 개발하고, 별도 대상의 Auth/Storage·DDL/RLS/역할을 실제 인수한다.
적용 직전 검토/소유권/대상 상태를 재확인하고 일반 공개/P0/무료 전환 게이트를 유지한다.

## 실제 준비 상태

2026-10-10 읽기 전용 감사: Auth 42·연결 작가 30·본문 충돌 78·Storage 0, 기본 미적용
12개와 추가019/020 미적용, health503. 지정 env에 별도 대상/확정 결정 파일이 없고,
관리 API로 접근 가능한 프로젝트도 운영 1개뿐이다. 기존 검증 백업은019/020 전이므로
실제 요청 패키지는 전제 미충족이다. 합성 원고·근거의 테스트 성공을 실제 권리/복원
승인으로 기록하지 않는다. [향후 개발계획](future-development-plan-2026-10-10.md)에 입력과 완료 조건을 정리했다.

## 공식 근거

[Supabase 백업 안내](https://supabase.com/docs/guides/platform/backups)의 Storage 바이트 제외,
[PGlite](https://github.com/electric-sql/pglite), [Zod](https://github.com/colinhacks/zod),
[Node24 파일 API](https://nodejs.org/docs/latest-v24.x/api/fs.html)를 참고했다. 기존 도구와
의존성을 확장했으며 새 라이브러리를 추가하지 않았다.
