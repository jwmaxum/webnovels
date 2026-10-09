# 19단계 품질·복원·베타 증거 계약

2026-10-09. [단계 계획](../../improve19.md), [출시 체크리스트](release-checklist.md), [출시 기록](release-record.md), [인수 시나리오](acceptance-scenarios.md), [운영 절차](operations-runbook.md)의 후속 계약이다. 코드 검증과 실제 출시 승인 근거를 구분한다.

## 경로별 로딩

독자 공용 코드와 Auth는 먼저 로드한다. `WebNovelsModules`는 검증된 `WebNovelsAuth.getActor()`가 승인 작가/관리자인 경우에만 해당 스크립트 목록을 순서대로 로드한다. `/creator`·호환 `/author`, `/admin`, 딥링크·popstate·공용 뷰 전환이 같은 진입점을 사용한다. 익명에게도 관리자 로그인 함수는 공용 `auth-ui.js`에서 제공한다. 로그인 성공 후에 관리자 업무 코드를 로드한다.

같은 파일은 한 번만 실행하고 같은 그룹 요청은 공유한다. 파일 실패는 그 파일부터 재시도한다. 계정·역할이나 경로가 바뀌면 늦은 진입 결과를 폐기한다. 이미 로드한 정적 코드는 재사용하지만 개인 데이터는 Auth의 기존 reset 계약을 유지한다. 서버 API·RLS 소유권 검사는 별도로 매 요청 수행한다. DOMContentLoaded가 지난 로딩과 Author/Creator 함수 별칭 동일성을 실제 classic script의 VM 실행으로 검증한다. 실기기 네트워크·화면 인수를 대체하지 않는다.

## 공급 코드와 브라우저 정책

Lucide 1.52.0, Supabase JS 2.112.3, fflate 0.8.3의 UMD를 로컬 배포하며 라이선스를 보존한다. [vendor manifest](../../public/vendor/manifest.json)에 출처·npm integrity·파일 SHA-256·SRI SHA-384를 기록한다. HTML/역할 로더의 무결성 값과 바이트를 검증한다. Lucide v1에서 제거된 두 정적 아이콘 별칭은 존재하는 이름으로 교체한다.

공급 JavaScript는 `.gitattributes`에서 `-text`로 지정하여 Windows/Linux checkout의 줄바꿈 변환으로 SRI가 달라지지 않게 한다. 공급 UMD 원본의 공백도 바이트 그대로 유지하므로 해당 자산만 whitespace 검사에서 제외한다. 직접 작성한 코드의 whitespace 검사는 유지한다.

확인된 의존성 취약점은 정상 npm 잠금 파일 재해석으로 수정한다. bcrypt 6은 기존 node-pre-gyp/tar 설치 체인을 제거하며 실제 native hash/compare 회귀를 수행한다. `audit:dependencies`는 공식 registry의 직접 advisory 범위 검사이며 npm의 전이 취약점 계산과 구분한다. 사용할 수 있는 npm CLI로 수행한 전체 `npm audit` 결과도 별도로 기록한다. 검사 실패나 미확인은 깨끗한 결과로 표시하지 않는다.

정적 응답과 Pages Functions 응답에 `base-uri 'self'; object-src 'none'; frame-ancestors 'none'`, nosniff, DENY frame, Referrer/Permissions 정책을 적용한다. Functions에는 `_headers`가 적용되지 않으므로 공통 Response 래퍼/공개 설정 헤더를 사용한다. 바이트 스트림·기존 no-store·request ID는 보존한다.

정적 HTML의 `script-src 'self'; script-src-attr 'none'`는 **Report-Only**다. 기존 인라인 이벤트와 동적 HTML을 조사하는 단계이며 스크립트 XSS 차단을 완료했다는 뜻이 아니다. 원격 reporting endpoint도 연결하지 않았다. 엄격한 강제 정책은 남은 이벤트/템플릿을 외부 코드로 옮기고 실환경 회귀한 후 적용한다. 이 부채는 SEC-05/XSS 출시 게이트에 남는다.

## 키보드 접근

공용 모달은 첫 조작으로 포커스를 이동하고 Tab/Shift+Tab을 최상위 모달 안에 유지한다. Escape는 한글 조합 중이 아닐 때 최상위 모달만 닫고 호출 버튼으로 복귀한다. 중첩 모달도 포커스 순서를 보존한다. DOM 대역 결과는 실제 스크린리더·대비·한글 IME·작은 화면 인수를 대체하지 않는다.

## 베타 증거 판정

실제 결과를 [예시 양식](beta-evidence.example.json)에서 시작해 비공개 `scratch/launch/evidence/`에 기록한다. 예시의 0 커밋·PENDING·표본 0은 승인 증거가 아니다. 원고 전문·이메일·토큰을 넣지 않고 요청 ID·시험 계정의 비식별 ID·해시·측정 결과만 보관한다.

```text
npm run check:beta -- <증거 JSON> <후보 전체 SHA> <HTTPS origin> NOVEL_FREE
npm run check:beta -- <증거 JSON> <후보 전체 SHA> <HTTPS origin> NOVEL_WEBTOON_FREE
```

모든 필수 게이트에 같은 후보·범위·환경, 최근 14일 이내의 PASS, 허용한 실제 증거 종류와 일치하는 파일 SHA가 필요하다. 실제 증거의 진위·담당자 확인은 운영자가 검토한다. `LOCAL_UNIT`·`SYNTHETIC_RESTORE`는 실제 인수 게이트를 닫지 못한다. P0 발생, 중복/누락, 과거·미래 시각, 파일 누락/변조, 경로 탈출·링크, 지원/담당 미확정, 실제 표본 부족은 NO_GO다. 최소 제안 표본은 소설 작가 5명·독자 30명, 웹툰 포함 시 웹툰 작가 3명이다.

도구는 `NO_GO` 또는 `READY_FOR_HUMAN_APPROVAL`만 반환한다. GO 승인이나 기능 플래그 활성화는 하지 않는다. 판정 결과의 gate별 issue와 scenario는 기존 S03/S04/R01~R05 및 인수 ID에 연결된다. 정책 검토·참여 동의·지원 시간·중단 기준과 범위별 실제 승인자를 출시 기록에 남긴다.

## DB + Storage 복원 패키지

기존 `backup:launch-postgres`, `backup:launch-data`를 대체하지 않는다. DB archive에는 Storage 메타데이터만 있으므로 객체 바이트를 별도로 확보한다. 운영 쓰기 제한/일관된 snapshot 기준과 외부 메일·결제·Cron이 꺼진 격리 환경이 선행 조건이다.

복원 전·후 두 디렉터리에 `manifest.json`을 두며 format은 `webnovels-recovery-v1`이다. 같은 UUID snapshotId/capturedAt/kind, `consistentSnapshotConfirmed`, database와 state 파일의 상대경로·bytes·sha256, 전체 객체 `{bucket,object,file,bytes,sha256}` 목록을 기록한다. 원본/미참조 부분 결과도 보존한다. 예시 구조는 [복구 패키지 예시](recovery-bundle.example.json)에 있다.

state 파일에는 `schemaVersion:1`, `schemaSha256`, `securitySha256`, 전체 table의 `{name,rows,sha256}`, bucket의 `{id,public}`, DB의 모든 객체 참조 `{bucket,object,sha256}`를 기록한다. 값은 복원 전/후 각각 실제 DB에서 추출하고 전체 테이블·schema/RPC·ACL/RLS/정책·계정 연결을 포함해야 한다. 동일 자료를 복사하여 추출 결과로 가장하면 안 된다. native archive readability는 별도 `pg_restore --list`, hosted 권한/RPC/Auth/Storage 접근은 별도 인수로 확인한다.

```text
npm run verify:recovery -- <백업 패키지 디렉터리> <격리 복원 패키지 디렉터리>
```

도구는 archive/상태/객체의 실제 파일 바이트·크기·SHA, 전체 객체 목록, DB fingerprint, 참조 존재를 비교한다. 상대경로 탈출/링크·중복·누락·변조·동일 source/target·private bucket 공개를 거절한다. HOSTED_BACKUP에는 PostgreSQL custom archive signature가 필요하며 실제 archive 구조/복원을 확인하는 검사는 아니다. SYNTHETIC은 별도 표시한다. 성공 결과에도 `hostedRestoreAccepted:false`를 유지하며 사람의 실제 서비스 인수와 독립 보관을 요구한다.

로컬 PGlite data-directory dump/load 훈련은 015까지의 합성 스키마와 원고 revision·서버 소유권·private role 거절을 복원하여 검증한다. 실제 Supabase 전체 복원·Storage 서비스·메일·Cron·기기·지원 담당 수신은 미실행이다.

## 조사 근거

[Pages 헤더](https://developers.cloudflare.com/pages/configuration/headers/), [CSP Report-Only](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only), [classic script](https://html.spec.whatwg.org/multipage/scripting.html), [DOMContentLoaded](https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event), [Supabase 백업](https://supabase.com/docs/guides/platform/backups), [Storage 복구](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [Lucide UMD/버전1](https://lucide.dev/guide/version-1), [npm 감사 구현](https://github.com/npm/cli/blob/latest/workspaces/arborist/lib/audit-report.js), [fflate 0.8.3](https://github.com/101arrowz/fflate/releases/tag/v0.8.3), [bcrypt 6](https://github.com/kelektiv/node.bcrypt.js/releases/tag/v6.0.0)을 확인했다. 신규 프레임워크·MCP 서비스는 도입하지 않는다.
