# 30단계 — 제출 원고 복원 증거 패키지와 향후 개발 계획

작성일: 2026-10-10. 29단계 복구 검토를 실제 원본 근거·새 snapshot의 복원 계획 검증으로 연결한다.

## 개발 범위

1. 기존 verified logical backup·private 경로·Zod·PGlite를 재사용하는 offline `prepare/check/rehearse` 도구를 개발한다. legacy 두 본문 선택 schema와 제출 원고 패키지는 구분한다.
2. SQL019/020이 포함된 snapshot에서 고정 제출 revision/source revision·원본 lineage·최신 READY 검토·현재 작가/Auth/최고 관리자·감사/멱등 기록을 대조한다. 검토된 기존 SQL의 순수 helper만 격리 DB에 설치해 현재 context를 다시 계산한다. 누락·HOLD·반려·변경·빈 원고·seed는 준비 불가다.
3. 검토 입력은 기본 PENDING이다. 실제 original/rights/rating/AI 및 필요한 이미지 근거 파일의 경로·크기·SHA256을 확인하며, 대상/packet/snapshot/제출 전문 해시를 고정한다. 체크박스나 해시를 실제 권리자 신원 인증으로 간주하지 않는다.
4. private 후보 계획에만 제출 원고와 대상 snapshot을 보존한다. 격리 PGlite에서 모든 원본 행 보존과 선택별 증거·context를 재검증한다. 운영 적용 SQL·원격 쓰기·플래그 활성화·일반 공개·hosted 복원 완료 판정은 제공하지 않는다.
5. 실제 DB 입력·승인·격리 환경 유무를 읽기 전용으로 확인한다. 구 snapshot에 019/020이 없으면 요청 0건/전제 미충족으로 기록하며 성공한 복원 패키지로 계산하지 않는다.
6. 추가 개발은 별도 후속 계획 문서에 우선순위·입력·의존 단계·완료 조건·서비스 오픈 기준으로 정리하고 로드맵에 연결한다.

## 검증·Git

전용 테스트는 고정 버전·latest review·권한 철회·변조·빅인트·seed/빈 원고·file SHA/경로·새 snapshot·보존·재실행·비밀 비출력을 검사한다. 관련 23/24/26/29단계 회귀·컴파일·타입·Functions 번들·커버리지·정적 보안·diff를 검증한다. env/초기 scratch가 없는 소스 복사에서 실행하고, 커밋·정상 main push 후 전체 release CI/배포를 확인한다. localhost/브라우저·운영 DB 쓰기는 실행하지 않는다.

## 다음 단계

31단계는 실제 원고·권리·등급·AI 증거와 격리 hosted 대상을 확보한 뒤, 이 패키지에서 승인된 제출본을 대상으로 트랜잭션·전체 행 CAS·원본 보관·rollback을 갖춘 복원 적용 후보와 별도 hosted 인수를 개발한다. 근거/환경이 없으면 자동 승인하거나 운영에 적용하지 않는다.

30단계 검증: 관련 회귀 124/124, 전용 13/13, 도구 라인 100.00%·분기 94.41%·함수 95.12%.
env/초기 scratch 없는 소스 복사에서 컴파일·타입·Functions 번들·구문·비밀/충돌·diff를 통과했다. lint는 미구성이며 전체 release는 push 후 CI에서 확인한다.
[검증 기록](artifacts/stage30-verification.json)은 합성 검증과 실제 인수를 구분한다. 기존 실제 백업의 패키지 prepare/check는 전제 누락12·요청/선택0·종료2이며 원본 승인/복원 완료가 아니다. 실제 운영 SQL/원고/플래그·hosted/브라우저 인수는 변경/실행하지 않았고 NO_GO다.
