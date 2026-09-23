# 서비스 오픈 개발 산출물

작성일: 2026-09-23. [전체 로드맵](../../improve.md) · [1단계 실행 기록](../../improve1.md)

| 문서 | 내용 |
|---|---|
| [기능·호출 목록](function-inventory.md) | 관리자 15개 메뉴, 메뉴 외 경로, 작가 7개 탭, 독자 공통 기능·API·테이블/RPC |
| [권한 행렬](permission-matrix.md) | 익명·독자·작가·제한/최고 관리자, 원고 열람/수정/제재 분리와 권한 이름 이관 |
| [삭제·이관 대장](removal-and-migration.md) | 삭제 단위 D01~D18, 실제 호출자·대체 기능·단계·검증, 옛 문서 참조 처리 |
| [기준선](baseline.md) | 소스/과거 기록/이번 원격 확인 구분, 데이터 수, 보안 위험과 적용 제한 |
| [인수 시나리오](acceptance-scenarios.md) | 가입·원고·파일·게시·예약·권한·운영 검증 ID와 기대 결과 |
| [의존성](dependencies.md) | 관리 접근·Auth·백업·메일·예약·배포 등 후속 조건 |
| [정적 조사 JSON](static-inventory.json) | 원문 위치와 함수 호출·소스 해시; 오프라인 재생성 가능 |
| [정합성 검사 결과](step1-verification.json) | 메뉴/탭 대응·해시·링크·ID 검사 통과, 서비스 인수 테스트와 별개 |
| [원격 요약 JSON](step1-remote-summary.json) | HEAD 상태/집계만 기록, 민감한 행 값 없음 |

1단계는 명세·기준선 확정 단계다. 서비스 코드는 변경하지 않았다. 관리 API 401과 민감 열 선택 수용 위험이 남아 있어 운영 보안이나 서비스 오픈 완료를 뜻하지 않는다. 다음은 2단계 데이터 모델·계정 이관·백업 준비이며, 운영 적용 전 의존성을 해소해야 한다.

## 2단계 — 로컬 구현·검증 완료 / 실환경 확인 대기

- [데이터 계약](data-contract.md), [마이그레이션·백업 절차](migration-runbook.md), [백업 양식](backup-manifest.example.json).
- [증분 SQL 목록](../../database/authoring/README.md), [테스트 결과](../../artifacts/step2-schema-verification.json), [2단계 진행 기록](../../improve2.md).
- 원격 관리 요청은 여전히 HTTP 401이다. 실제 DB/Storage 적용·복원·Auth 이관을 완료했다고 판단하지 않는다.

## 3단계 — 로컬 구현·검증 완료 / 실제 메일·DB 통합 대기

- [인증·가입 계약 및 실행 기록](auth-contract.md), [3단계 진행 기록](../../improve3.md).
- [검증 결과](../../artifacts/step3-auth-verification.json). 실제 DB 적용·SMTP/메일·브라우저 인수 시험은 수행하지 않았다.

## 4단계 — 작가 작품 관리 로컬 구현·검증

- [작품 관리 계약](creator-works-contract.md), [4단계 진행 기록](../../improve4.md), [검증 증거](../../artifacts/step4-creator-works-verification.json).
- 실제 DB/브라우저 통합 검증과 운영 활성화는 대기다.

## 5단계 — 원고 자동저장·복구 로컬 구현·검증

- [원고 저장·복구 계약](creator-drafts-contract.md), [5단계 기록](../../improve5.md), [검증 증거](../../artifacts/step5-draft-verification.json).
- 실제 DB·브라우저/기기 인수 및 7단계 발행 보관 연결은 대기다.
