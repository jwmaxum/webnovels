# 27단계 HWPX 평문 가져오기 계약

2026-10-09. 로컬 코드·합성 ZIP/XML·Node VM·API 대역·PGlite 검증 대상이다.
실제 한컴 작성 파일, 브라우저·모바일, hosted DB/Storage 인수는 별도다.
[파일 계약](creator-files-contract.md)과 [원고 보존 계약](creator-drafts-contract.md)을 확장한다.

## 작가 흐름

기존 `CreatorFiles`의 파일 선택/드래그에서 TXT·DOCX·HWPX를 받는다. 변환은
브라우저에서 수행하며 원격 변환 서비스나 문서 내부 URL에 접근하지 않는다.
문단·빈 문단·한글/이모지·탭·줄바꿈을 미리보기하고 서식·표/그림·각주 등의
누락 경고를 확인한 뒤 기존 확인 체크를 선택해야 저장할 수 있다.

기본 저장은 새 비공개 초안이다. 원본 바이트·원본 SHA·요청/초안/batch UUID와
순서를 유지하며 기존 소유권 검사→prepare→불변 Storage 업로드 확인→commit을
사용한다. 유실 응답 재시도는 동일 receipt/바이트로 처리한다. 기존 회차를
파일명·제목으로 추정하여 대체하거나 공개하지 않는다.

`현재 원고 대체`는 기존 CreatorDraftEditor/DraftEngine의 계정·원고 ID·seq와
변경 전 백업 계약을 따른다. 이 경로의 원본은 로컬 가져오기 기록에 남는다.
서버 원본↔revision 연결은 새 초안 저장 경로에서 제공한다.

## 지원 구조와 제한

[한컴의 형식 설명](https://tech.hancom.com/hwpxformat/)과
[파싱 설명](https://tech.hancom.com/python-hwpx-parsing-1/)에 따라 ZIP/XML 기반
HWPX의 본문을 읽는다. mimetype은 `application/hwp+zip`이며 컨테이너에서
`application/hwpml-package+xml`의 `Contents/content.hpf`를 하나 선택한다.
Preview 등 다른 rootfile은 본문으로 사용하지 않는다. OPF manifest와 spine을
대조하여 모든 본문 구역을 spine 순서대로 읽고 header의 secCnt와 일치시킨다.
다중 rootfile과 package media-type은
[한컴 공식 모델](https://github.com/hancom-io/hwpx-owpml-model/blob/main/OWPMLApi/OWPMLSerialize.cpp)의 구조를 따른다.

- 2011 Hancom section/paragraph/head namespace, OCF container, OPF URI(끝 `/` 유무)를
  지원한다. prefix 이름은 고정하지 않는다. 미지원 본문 p/run/t namespace는 실패한다.
- 본문 구역의 직속 문단과 run/t만 평문으로 변환한다. 표·그림·OLE 표시·각주/미주·
  머리글/바닥글·필드·주석/변경 추적·알 수 없는 블록은 누락 경고를 표시한다.
  Preview 텍스트, 중첩 표/각주 문단, 외부 리소스를 대체 본문으로 사용하지 않는다.
- 암호화 문서/ZIP, 스크립트 파일, 삽입 실행/OLE 바이너리, DTD/entity 선언은 거절한다.
  Unicode prefix의 암호화 표시도 차단한다. 외부 본문 참조는 실패하며 외부 부속
  리소스는 경고 후 무시한다. Scripts 파일이 있는 HWPX는 TXT/DOCX로 저장해 가져온다.
- 파일 2 MiB·최대 256 entry·entry별 4 MiB·전체 해제 16 MiB·본문 200,000 UTF-16
  코드 단위 한도다. 실제 해제 출력과 선언 크기, CRC, 경로/대소문자 별칭을 검사한다.
  레이아웃 재현·자동 회차 분리·HWP 바이너리와 모든 버전의 HWPX 지원은 포함하지 않는다.

서버도 동일 fflate ZIP 검사로 HWPX envelope·용량/CRC·필수 파일·active/encryption을
확인한 뒤 원본을 private `application/octet-stream`으로 저장한다. 서버 운영 경로에는
DOMParser를 추가하지 않는다. 서버가 변환 평문의 의미상 동일성이나 모든 XML 구조를
검증하는 것은 아니며 백신 기능도 아니다. 클라이언트의 문서 전체 구조/namespace
검사와 작가의 미리보기 확인을 유지한다.

## 실제 원본과 서비스 적용

[27단계 기존 백업 조사](../../artifacts/stage27-original-recovery.json)의 범위는 SHA로
검증한 23단계 snapshot이다. 누락 소설 36화와 연결된 초안/버전/복구 이력은 0건이었다.
이는 모든 과거 백업·디스크나 현재 운영 DB 전체의 원고 부재를 증명하지 않는다.
TXT/HWPX 변환 성공은 원본·권리 승인 또는 원래 회차 연결 근거가 아니다.

기능 플래그·운영 SQL/원고를 변경하지 않았다. 기존 002 private Storage와 007 files,
Auth/작품/초안 계약의 실제 적용·격리 hosted 인수 후 기존 활성화 절차를 따른다.
28단계에서 실제 작가 파일의 누락/모바일·원본 다운로드·복구 초안↔원래 회차 관계와
권리/이미지·등급/AI 검토, 별도 DB/Auth/Storage 복원·역할 인수를 확보한다.

`npm run test:stage27`은 합성 패키지 검증 14개다. 기존 `npm run test:files`는
HWPX UI/API/초안 DB 보존 회귀를 추가하여 27개다. 상세 결과는
[검증 산출물](../../artifacts/stage27-verification.json)에 기록한다.
