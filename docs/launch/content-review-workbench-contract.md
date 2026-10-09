# 비공개 원본 검토 워크벤치 — 26단계

## 목적과 권한 경계

검토자가 원본 충돌의 두 본문·선택 불가 사유·소유 연결 상태를 확인하고 기존
[원본 결정 계약](content-review-restore-contract.md)의 입력을 만든다.
Author/Creator·Auth UUID/작가/작품/bigint 회차/원고 UUID 계약은 바꾸지 않는다.
공개 사이트나 관리자 API에 검토 원고를 올리지 않는다. 새 DB·권한·의존성은 없다.
HOLD/PENDING은 미해결이다. 해시·검토자 참조 문자열은 권리자/검토자 신원 인증이 아니다.
실제 SQL·플래그 변경, hosted/역할/Storage/브라우저 인수 또는 베타 GO 기능은 없다.

## 파일 준비와 사용 순서

명령은 프로젝트 루트에서 실행한다. 모든 입력/산출물은 Git에서 제외된
`scratch/launch/backups/<백업>` 아래에 둔다. 디렉터리·파일 링크와 경로 탈출을 거절한다.
원래 packet/template/snapshot을 덮어쓰지 않는다. 새 이름은 영문 소문자·숫자·하이픈
3~64자이며 영문으로 시작한다. 재생성/결과 기록은 기존 디렉터리가 있으면 거절한다.

```text
npm run review:content-workbench -- prepare <검증된-논리-백업> review-stage26
npm run review:content-workbench -- check <검증된-논리-백업> review-stage26
```

snapshot/manifest/전체 행 복원 검증 파일을 확인하고, 기존 isolated PGlite 도구와
동일 seed 식으로 CONTENT packet을 재생성한다. 전체 packet은 Auth·계정의 비공개 행을
포함하므로 HTML에 넣지 않는다. 투영은 두 본문, 제목, 문자열 도메인 ID, 유형,
소유 연결 검증 여부, 이미지 개수, 원본 해시와 차단 사유만 포함한다.
원고 전체를 포함하므로 투영 파일도 비공개이며 웹/공유 채널에 게시하면 안 된다.

`review-stage26/review.html`을 검토자가 로컬 파일로 연다. 작품/회차 검색과 미검토/
보류/복구 필요/근거 필요 목록을 제공한다. 두 본문 전문을 읽기 전용으로 보여 주며
NULL/빈 문자열/CR/LF 개수와 원본 JSON 값의 SHA-256을 함께 표시한다. 숫자 ID를
Number로 변환하거나 본문 공백/줄바꿈을 정규화하지 않는다. 차단된 원본은 선택 불가다.
웹툰 이미지 URL·계정 상세·Auth UUID를 넣지 않고 원격 이미지/링크를 요청하지 않는다.

근거 파일은 권리자가 확인한 자료를 별도 `proofs/input/`에 직접 보관한 후 준비한다.
허용 확장자는 pdf/png/jpeg/jpg/webp/txt/md/json/docx, 최대 16 MiB, 빈 파일은 거절한다.
숨김/환경/키/DB 덤프 파일을 staging 대상으로 받지 않는다. 파일이 실제 권리 근거인지
확인하는 책임은 검토자에게 있으며 도구는 이 사실을 인증하지 않는다.

```text
npm run review:content-workbench -- stage-evidence <검증된-논리-백업> review-stage26 proofs/input/rights.pdf
```

원본 파일을 유지하고 `review-stage26/evidence/<sha>.<확장자>`와 `.descriptor.json`을
불변 기록한다. 재호출은 기존 바이트가 완전히 같을 때만 허용한다. 화면에서 descriptor를
선택한다. descriptor는 파일 상대 경로/bytes/SHA-256만 가지며 실제 파일은 CLI가 확인한다.
권리 자료의 민감 내용 자체를 검토 세션에 넣지 않는다. 웹툰은 이미지 인수 descriptor도
별도 선택한다. 선택한 파일이 실패하면 이전 descriptor를 지워 새 근거가 없는 상태로 둔다.

각 회차의 확인자·근거/보류 사유를 저장하고 **검토 세션 내려받기**를 누른다.
입력은 메모리에만 남고 종료/새로고침하면 사라진다. 기존 세션을 가져오려면 먼저 현재
메모리 검토를 명시적으로 비운다. 가져오기는 완전한 schema/해시 대조 후 일괄 반영한다.
원본을 외부 파일로 바꾸거나 모든 회차를 일괄 승인하는 기능은 없다.
다운로드 파일은 사용자가 같은 백업 아래로 옮긴 뒤 다음 명령으로 검증한다.

```text
npm run review:content-workbench -- finalize <검증된-논리-백업> review-stage26 content-review-session.json final-review01
```

세션은 4 MiB, descriptor는 화면에서 16 KiB, 투영 모델은 32 MiB, HTML은 48 MiB로
제한한다. snapshot/packet/view/source/선택 해시·unknown 필드·누락/중복·bigint ID를 대조한다.
부분 세션을 전체 template에 병합하고 미검토 회차는 PENDING으로 유지한다. HOLD는 원본
선택을 담을 수 없다. 기존 `validateContentDecisions()`와 `verifyReviewEvidence()`가 다시
소유 연결·seed·빈 소설·이미지 조건과 실제 파일 바이트를 검사한다.

`review-stage26/final-review01/decisions-reviewed.json`은 기존 결정 schema 그대로이며
`verification.json`은 세션/결정 해시와 집계를 기록한다. 미해결이 남으면
`FILE_VALIDATED_UNRESOLVED`다. 파일 검증 완료를 실제 원본/권리 인증이나 전환 완료로
계산하지 않는다. 이후 기존 `review:launch-content -- rehearse` 또는 후보 전환 패키지에
정확한 backup-root 상대 경로를 넘긴다. SQL 리허설/적용 계약과 별도 승인 요건은 유지한다.
처리 도중 파일 오류가 나면 남은 디렉터리를 덮어쓰지 말고 새 이름으로 재시도한다.

## HTML 보안과 검증 범위

원고/제목/근거는 `textContent`·입력 `value`로 렌더링한다. 삽입 JSON은 `<`, `>`, `&`,
U+2028/U+2029를 escape한다. trusted JS/CSS의 바이트 SHA-256을 CSP에 고정하며
`default-src/connect-src/img-src/object-src/base-uri/form-action 'none'`을 설정한다.
CDN·fetch·Beacon·localStorage·원격 URL을 사용하지 않는다. 다운로드는 메모리 Blob이다.
meta CSP에서 지원되지 않는 sandbox를 안전 근거로 삼지 않는다.
[CSP connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src),
[sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox).

재사용 후보는 기존 Zod/PGlite/검토 검증기/DOM 테스트가 계약에 맞아 선택했다.
[jsdiff](https://github.com/kpdecker/jsdiff) 등 새 비교 라이브러리는 채택하지 않았다.
줄 비교 생략본 대신 두 전문을 표시한다. Node VM/DOM 대역으로 입력/필터/파일/내보내기와
XSS 경계를 검증하며 실제 브라우저·CSP 동작·모바일 시각 인수는 별도다.
