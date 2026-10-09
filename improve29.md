# 29단계 — 복구 요청 검토함과 작가 피드백

작성일: 2026-10-10. 28단계의 불변 복구 요청을 기존 관리자 운영 메뉴에 연결한다.

## 구현 범위

1. 기존 `/api/v2/admin/workflow`에 복구 목록·상세·사유가 있는 제출 원고 열람·원본 다운로드·검토 결정을 추가한다. 목록은 CASE_READ/CONTENT_REVIEW, 처리는 CASE_RESOLVE/CONTENT_REVIEW, 비공개 원고·원본은 SUPER_ADMIN만 허용한다. 인증·현재 권한은 RPC에서 다시 검사한다.
2. SQL020에 append-only 검토 이력과 멱등 영수증을 추가한다. SQL019 요청과 원고·원본·공개 head·예약·권리 상태는 변경하지 않는다. 검토 상태는 보류/반려/후속 복원 검증 준비이며 공개 승인이나 원본 권리 증명이 아니다.
3. 제출 당시 revision과 원본 lineage를 열람한다. 대상 snapshot·원본 checksum/size·현재 소유권·상태를 다시 비교한다. 원본은 서버에서 제한된 바이트를 가져와 SHA256과 크기를 검사한 뒤 no-store attachment로 제공한다. 감사·영수증·목록에 원고 전문이나 Storage 경로를 저장하지 않는다.
4. 새 결정은 expected review revision과 대상 digest를 검사한다. 현재 권한 검사 후 동일 키·동일 payload 재전송은 동일 결과를 반환한다. 불명확한 실패는 같은 요청으로 재시도한다. 화면·계정 전환 시 원고와 늦은 응답을 제거한다.
5. 작가는 기존 복구 UI에서 별도 파생 검토 상태·사유를 확인한다. 불변 접수 영수증의 PENDING은 유지한다. AUTHOR/Creator 호환 계약을 유지한다.
6. ADMIN_RECOVERY_REVIEW_ENABLED는 기본 false이며 기존 admin workflow와 author recovery의 모든 전제 플래그가 필요하다. 실제 DB/Storage/플래그·출시 게이트는 적용하지 않는다.

## 검증과 반영

PGlite 합성 DB로 ACL·권한 철회·고정 revision·변조·멱등·CAS·감사 불변성과 원본 보존을 검사한다. Node VM으로 UI 전환·재시도·비밀 비저장을 검사한다. 관련 회귀·타입·컴파일·Functions 번들·정적 보안·diff 검사를 실행하고 커밋·정상 main push한다. 전체 release는 GitHub CI로 확인한다. 실제 운영 상태는 읽기 전용 집계로 확인하고 합성 검증과 구분한다. localhost/브라우저 인수는 실행하지 않는다.

## 다음 단계

30단계: 실제 제출 자료의 권리·내용·등급·AI 검토 증거와 별도 복원 대상 환경을 확보하고, 검토 요청에서 승인된 원고를 복원 계획으로 연결하는 명시적 증거 패키지·격리 리허설을 개발한다. 검토 준비 상태만으로 본문을 적용하거나 서비스를 활성화하지 않는다.

29단계 검증: 관련 회귀 209/209, 전용 20/20, 새 관리자 UI/API 라인 100.00%·분기 93.81%·함수 97.62%.
env/초기 scratch 없는 소스 복사에서 Prisma/TypeScript 컴파일·타입·6개 Functions 번들·JS 구문·비밀/충돌·diff를 통과했다. lint는 미구성이며 전체 release는 push 이후 CI에서 확인한다.
[검증 기록](artifacts/stage29-verification.json)은 합성/대역과 운영 적용을 구분한다. 운영 읽기 전용 감사는 Auth42·연결 작가30·본문 충돌78·Storage0·미적용 기본12개·health503을 확인했다. 추가019/020도 미적용이고 승인/격리 대상이 없어 NO_GO다.
