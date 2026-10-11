# 31단계 — 검토된 제출 원고의 트랜잭션 복구 후보

작성일: 2026-10-11. 30단계의 [증거 계약](docs/launch/recovery-evidence-package-contract.md)과
[후속 계획](docs/launch/future-development-plan-2026-10-10.md)을 확장한다.

## 개발 범위

1. 기존 검증 백업·고정 제출본·최신 READY·권한/감사 사슬·실제 근거 파일 검증을 재사용한다. 새로운 원본 승인이나 합성 자료로 운영 결정을 생성하지 않는다.
2. 운영과 다른 대상 ref에 묶인 SQL 후보를 비공개로 생성하고 격리 PGlite에서만 실행한다. 전체 원본 테이블/행 CAS, 잠금, 현재 권한/검토 재확인, 변경 전후 대조를 하나의 트랜잭션에 넣는다.
3. 소설의 선택 회차 본문만 episodes/secure_episode_contents 및 존재하는 episode_contents에 일치시킨다. 제목/메모/이미지·계정·초안/불변 버전·공개 head·예약은 보존한다. 공개 head 또는 예약이 있는 대상은 차단한다.
4. 제출본/가져오기 원본 내용·원래 대상·근거 참조·전후 상태를 private 불변 이력에 보관한다. UPDATE/DELETE/TRUNCATE와 웹 역할 접근, 같은 요청 재실행을 차단한다.
5. 오래된 snapshot, 권한 철회, 최신 HOLD, 원고/근거 변조, 한 선택의 중간 실패에서 전체 rollback을 검증한다. SQL 후보/증거 패키지의 바이트 변조와 재실행도 거절한다.
6. 실제 env와 hosted 준비 상태는 읽기 전용으로 확인한다. 원본/검토/별도 대상이 없으면 코드 검증과 실제 복구 미실행을 구분한다. 운영 SQL·플래그·PG 결제는 변경하지 않는다.

## 검증·Git·다음 단계

전용 트랜잭션/보존/CLI 테스트, 관련 23/24/26/29/30단계·명칭/Auth 회귀,
컴파일·타입·Functions 번들·보안/diff를 env/초기 scratch 없는 소스 복사에서 검증한다.
localhost/브라우저는 실행하지 않는다. 변경을 커밋·정상 push하고 정확한 커밋 CI/배포를 확인한다.
32단계는 승인된 별도 hosted 대상에서 native/논리·Auth/Storage와 DDL/RLS/RPC·다중 연결을
실제 인수한다. SQL 후보나 PGlite 성공만으로 운영 복구/출시 GO를 선언하지 않는다.

31단계 검증: 관련 회귀 106/106, 전용10/10, 도구 라인 99.35%·분기 89.90%·함수 97.06%. env/초기 scratch 없는 소스 복사에서 컴파일·타입·Functions 번들·구문·비밀/충돌·diff를 통과했다. lint는 미구성이며 전체 release CI/배포는 push 후 별도 확인한다.
실제 읽기 전용 감사는 NO_GO이며 운영 프로젝트1개·별도 대상0개·기존 충돌78·019/020 미적용이다. 기존 실제 백업 assess는 전제 누락12·요청/선택0·종료2이고 실제 SQL 후보/본문 교체는 없다. 합성 트랜잭션 성공과 실제 hosted/원본 승인·브라우저 인수를 구분한다.
[검증 기록](artifacts/stage31-verification.json). 다음32단계는 실제 원본/검토와 별도 hosted DB/Auth/Storage·역할/RLS/RPC·다중 연결 인수다.
