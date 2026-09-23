# 6단계 파일 가져오기·표지·내보내기 계약

기록일: 2026-09-23. **로컬 구현·검증 완료 / 실제 DB·Storage·Images·브라우저 인수 대기**.

[명칭 호환](author-creator-contract.md), [5단계 원고 보존 계약](creator-drafts-contract.md)을 따른다. 작가 신원은 `actor.author`, UI/경로는 `CreatorFiles`, `CreatorDraftEditor`, `/api/v2/creator/files`다.

## 사용 흐름

작품 상세 또는 원고 편집기의 `파일·표지·내보내기` 버튼을 연다. 작품 제목을 표시하며 모든 요청은 열 때 확인한 작품 ID와 계정에 고정한다.

- TXT/DOCX를 파일 선택 또는 드래그로 추가한다. 파일명 숫자 순서를 제안하고 위/아래 이동으로 조정한다. 제목·본문·인코딩·누락 경고를 확인한 항목만 비공개 초안으로 저장한다.
- 파일별 상태와 저장/재시도/취소를 제공한다. 배치 중단은 진행 중 요청 결과를 확인한 뒤 다음 파일부터 멈춘다. 이미 저장된 원고를 취소 버튼으로 삭제하지 않는다.
- 기본은 새 초안 생성이다. 열어 둔 편집 원고와 같은 작품에 한해 `현재 원고 대체`를 명시적으로 선택할 수 있다. 5단계 엔진이 현재 원고 ID·seq·계정을 다시 확인하고 변경 전 백업을 완료한 뒤 대체한다. 원본 파일은 로컬 가져오기 기록에 남으며, 이 대체 경로의 본문 저장은 기존 초안 자동저장을 사용한다. 서버 원본 파일 연결은 새 초안 가져오기 경로에서 수행한다.
- 이미 시도한 파일은 제목/인코딩/순서를 잠가 재시도 payload를 유지한다. 동일 파일을 다시 선택하는 것은 의도적인 새 가져오기이며 새 batch/요청/원고 UUID를 만든다.
- 표지 JPEG/PNG를 고른 뒤 확대·가로/세로 위치를 조정한다. 600×900 PNG로 자른 후보를 서버에서 JPEG로 재인코딩하고 업로드를 확인한 뒤 작품의 표지 참조를 변경한다. 실패·version 충돌 시 기존 표지를 유지한다.

## 변환 규칙과 제한

| 항목 | 계약 |
|---|---|
| TXT/DOCX | 파일당 2 MiB, 한 번에 20개, 변환 본문 최대 200,000 UTF-16 코드 단위 |
| TXT | UTF-8 기본, UTF-16 LE/BE BOM 감지, UTF-8 실패 시 EUC-KR/CP949 후보와 확인 경고; 인코딩 직접 선택 가능 |
| 개행 | CRLF/CR→LF, 연속 빈 줄 유지, BOM 제거; 대체 문자·NUL·텍스트 외 제어 문자 거부 |
| DOCX | ZIP 시그니처·중앙 디렉터리·중복/위험 경로·CRC 검사. ZIP64/암호화/지원하지 않는 압축은 거부 |
| 압축 해제 | 최대 256개 entry, entry별 4 MiB, 전체 16 MiB. 선언 크기와 실제 스트림 출력량 모두 제한 |
| 본문 | WordprocessingML 본문 직속 문단·빈 문단·따옴표·탭·줄바꿈·XML entity를 일반 텍스트로 변환 |
| 제외 경고 | 표·그림·각주/미주·주석·머리글/바닥글·삭제 추적·필드 코드·지원하지 않는 블록 |
| 외부/실행 요소 | 관계 파일의 외부 참조는 경고 후 무시. 외부 URL을 가져오지 않음. DTD/entity 선언, 매크로·ActiveX·삽입 실행 파일 거부 |
| 미지원 | HWP/HWPX, 하나의 파일에서 자동 회차 분리, 원본 Word 레이아웃 재현; 13단계 검토 |
| 표지 | 원본 4 MiB, 12,000,000픽셀 및 변당 8,192픽셀 이하, PNG/JPEG 실제 헤더 확인. 후보·파생본 각각 2 MiB 이하 |
| ZIP 내보내기 | 서버 본문 합계 500만 자·회차+초안 2,000개 한도. 초과 시 부분 성공으로 표시하지 않고 오류. 저장본 TXT 선택 목록에도 동일 한도 적용; 편집 중 원고 TXT는 독립 동작 |

문서 변환은 브라우저 안에서 수행한다. 브라우저 자체 DOMParser가 XML을 파싱하고, 외부 문서 변환 서비스에 원고를 보내지 않는다. 서버로는 확인한 평문 스냅샷과 비공개 원본 바이트를 전달한다. 원본은 `application/octet-stream`으로 저장하며 서버에서 실행·렌더링하지 않는다. 서버는 역할·작품 소유·크기·스냅샷·확장자·DOCX 시그니처를 확인한다. 클라이언트의 변환 결과가 원본과 의미상 동일한지 또는 악성 문서인지 검사하는 백신 기능은 아니다.

## 런타임·의존성

- [fflate](https://github.com/101arrowz/fflate) **0.8.2**, MIT: 브라우저/Node에서 ZIP 스트림 및 ZIP 내보내기에 사용한다. 브라우저 배포본과 LICENSE는 `public/vendor/fflate/`에 고정 복사했다. CDN 실행 의존성은 없다.
- [xmldom](https://github.com/xmldom/xmldom) **0.9.12**, MIT: Node 테스트에서 실제 XML 파싱을 위한 devDependency다. 브라우저/서버 운영 변환 경로에는 포함하지 않는다.
- 표지 서버 재인코딩은 [Cloudflare Images binding](https://developers.cloudflare.com/images/optimization/binding/)의 `input(stream).transform(...).output({format:'image/jpeg'})`를 사용한다. `env.IMAGES`가 없으면 503으로 중단한다. 클라이언트 Canvas 결과만 신뢰해 공개하는 fallback은 없다.
- IndexedDB·TextDecoder·DOMParser·Canvas·createImageBitmap·Web Crypto 등 실제 브라우저 지원과 모바일 동작은 실환경 인수 대상이다.

## 저장·취소·복구

IndexedDB 버전 3은 기존 v1/v2 저장소를 그대로 두고 `fileImports`만 추가한다. 계정 UUID+요청 UUID 키로 원본 바이트·변환 스냅샷·batch ID·파일별 요청 ID·원고 UUID·확인 여부·진행 상태를 저장한다. 저장 트랜잭션 완료 후에만 서버 요청을 보낸다. 재시작 후 같은 계정·작품에서 미확정 항목을 재시도하며, 완료 항목은 재전송하지 않는다. 성공 응답 후 로컬 기록이 실패해도 서버 receipt로 같은 결과를 재확인한다. 자동 삭제는 하지 않는다.

`007_creator_files.sql`은 `file_jobs`, `file_cancellations`, 표지 참조 및 service-only RPC를 추가한다. prepare는 요청 payload와 원본/파생본 메타데이터를 고정하고, 실제 Storage 업로드 성공 후 commit이 초안·revision_files 연결 또는 표지 참조 변경을 확정한다. 모든 단계에서 서버 작가/작품 신원을 다시 검사한다. Storage와 PostgreSQL은 분산 트랜잭션이 아니므로 중간 실패 파일은 PREPARED로 보존한다. 기존 객체가 있으면 바이트 hash가 같을 때만 재사용한다.

취소 tombstone은 업로드 준비보다 먼저 도착한 취소도 기록하여 늦은 요청의 재개를 차단한다. COMMITTED 항목은 취소로 삭제하지 않는다. `authoring.file_cleanup_candidates`는 ABANDONED이며 revision_files/현재 표지에서 참조하지 않는 파일만 후보로 제공한다. PREPARED 및 확정 참조 파일은 후보가 아니다. **보관 정책·백업 확인 전 실제 객체/DB 행을 자동 삭제하는 작업은 활성화하지 않는다.**

## 접근 경로

| API | 권한·동작 |
|---|---|
| GET `/api/v2/creator/files?workId=…` | 소유 작품의 파일 작업 메타데이터 |
| POST `/api/v2/creator/files/import?workId=…` | 확인한 스냅샷으로 새 비공개 원고 생성, Idempotency-Key 필수 |
| POST `/api/v2/creator/files/cover?workId=…` | version 조건부 표지 교체, Idempotency-Key 필수 |
| POST `/api/v2/creator/files/cancel/:requestId?workId=…` | 미확정 작업 취소 기록 |
| GET `/api/v2/creator/files/read/:fileId?workId=…` | 소유한 COMMITTED 파일만 60초 Storage 서명 URL 발급 |
| GET `/api/v2/creator/files/export?workId=…` | 인증한 소유자에게 현재 DB 스냅샷 JSON; 브라우저에서 ZIP 작성 |
| GET `/api/v2/creator/files/public-cover/:fileId` | 현재 표지 파생본이고 작품이 공개·미삭제·제재 없음인 경우에만 JPEG 전달 |

원본과 파생본 버킷은 모두 private이다. 공개 이미지는 원본 파일명·원본 경로가 아닌 UUID 기반 API로 전달하며 매 요청 공개 상태를 검사하고 `no-store`로 반환한다. 비공개 작품의 새 표지는 작품 카드에서 기본 표지를 표시하고, 작가가 파일 관리의 서명 링크로 미리보기할 수 있다. 발급된 서명 URL은 60초 동안 소지자가 열 수 있으므로 즉시 회수 가능한 인증 요청과는 다르다. 로그아웃 때 화면·링크·메모리 파일·Canvas를 정리한다.

## 내보내기 형식

편집 중 원고 TXT는 현재 스냅샷의 본문을 UTF-8로 내려받는다. 저장본 선택 목록에서 회차/초안·제목·상태를 확인하고 개별 TXT를 내려받을 수도 있다. 작품 ZIP은 서버에 저장된 공개/비공개 회차와 ACTIVE/PUBLISHED/TRASHED 초안을 포함한다. 회차는 회차 번호순, 초안은 가져오기 순서와 안정적인 ID 기준으로 나열하고, `manifest.json`에 작품/회차/원고 ID·제목·상태·revision·작가의 말·이미지 URL 및 가져오기 batch/순서를 보존한다. TXT에는 본문을 그대로 넣는다. 파일명은 Windows 예약어·경로 문자 등을 정리하고 순번으로 중복을 피한다. 이미지 바이트를 외부 URL에서 수집하지는 않는다. 미동기 편집 내용은 서버 ZIP에 포함됐다고 표시하지 않는다.

## 검증·적용

`npm run test:files`: 변환/ZIP/이미지 헤더 6개, 파일 큐 4개, UI VM 5개, API/Storage/Images 대역 5개, 합성 PostgreSQL 4개. 총 24개. [검증 기록](../../artifacts/step6-file-verification.json)에 회귀 검사와 소스 해시도 기록한다.

실제 DB·Storage 업로드, 60초 후 서명 URL의 실제 거절, Images 인코더의 메타데이터 제거 결과, 브라우저 파일 선택/드래그/크롭/다운로드, IndexedDB v2→v3 및 모바일 메모리 검증은 미실행이다. localhost/브라우저 시험은 프로젝트 규칙상 명시 요청이 필요하므로 이번에는 수행하지 않았다.

운영 적용 전 2~5단계의 스키마/백업/매핑/실환경 인수를 마치고 private Storage 002와 authoring-006 뒤에 007을 검토 적용한다. IMAGES binding과 Supabase private Storage 접근을 스테이징에서 확인한다. `AUTHOR_FILES_ENABLED=false`를 기본 유지한다. 활성화에는 P0, AUTHOR_WORKS, AUTHOR_DRAFTS 플래그와 보안 마이그레이션도 필요하다. 롤백은 파일 플래그를 내려 신규 작업을 닫되 DB/원본/작업 journal을 보존한다. 배포·운영 DB 변경은 수행하지 않았다.
