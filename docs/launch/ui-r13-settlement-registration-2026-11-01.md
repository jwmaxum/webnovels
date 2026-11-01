# UI-R13 — 정산 계좌 관리와 수동 서류 확인

2026-11-01. 작가의 정산 계좌 등록·수정·삭제, 본인 정보와 신분증 제출, 관리자 검토 요청을 구현한다. 대상은 사용자 회신에 따라 **개인 작가·개인사업자·법인**이다. 기존 Supabase를 유지하되 **국외 보관 안내·동의와 처리 조건을 먼저 확정**한다는 회신을 적용한다.

## 작가와 관리자 흐름

작가 상단의 `정산 정보 관리`에서 내 정보·정산 준비 화면으로 이동한다. 정적 `미등록` 문구를 서버의 현재 계좌 상태와 연결하며 계좌번호는 끝 4자리만 표시한다. 계좌 등록·수정·삭제는 현재 비밀번호를 재확인하고 기존 소유권·revision 계약으로 처리한다. 기존 이전 계좌 자료를 현재 등록 계좌로 자동 이관하거나 검증된 자료로 간주하지 않는다.

서류 신청은 성명·생년월일·주소·신청 유형과 번호를 가린 신분증을 사용한다. 개인사업자·법인은 상호·사업자등록번호와 사업자 증빙을 추가한다. 브라우저에서 불필요한 식별번호·MRZ·바코드 등을 가리고 확정한 이미지만 JPEG로 평탄화해 전송한다. 원본 파일과 이미지 URL, 비밀번호·신청 내용을 localStorage나 전역 작가 목록에 보관하지 않는다. 화면 전환·로그아웃·계정 변경 시 개인정보와 이미지 URL을 지운다.

최고 관리자는 기존 `/admin/settlements`에서 정산 서류를 검토한다. 열람 사유와 현재 비밀번호를 확인하고, 제출 서류를 직접 확인한 후 `서류 확인 완료` 또는 `보완 필요`로 처리한다. 일반 정산 목록 조회 권한으로 신분증을 열 수 없다. 열람·검토 기록에는 원문 자료를 넣지 않는다.

서류 확인은 **수동 자료 확인**이다. PASS 인증·CI/DI 생성·금융기관 예금주 조회·송금 완료가 아니다. 같은 본인의 복수 ID·필명 가입을 유지하고 이름·생년월일로 다른 계정을 병합하지 않는다. 새 계좌의 금융기관 확인 상태는 별도 `PENDING`이며 서류 승인으로 자동 승격하지 않는다. 무료 연재에는 정산 신청을 요구하지 않는다.

## 주민등록번호와 국외 처리 조건

전체 주민등록번호를 현재 신청에서 수집하지 않는다. 단순 신원 확인에 대한 동의만으로 주민등록번호 처리가 허용되지는 않는다. 실제 개인 소득 지급·원천징수·지급명세서 제출 단계에서 필요한 법적 근거와 항목·보관 기간을 별도로 정한다. 사업자·법인은 유형별 세무 자료를 구분한다.

근거: [개인정보 보호법 제24조의2](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1029335165), [국세기본법 시행령 제68조](https://www.law.go.kr/lsLinkProc.do?chrClsCd=010202&datClsCd=010102&gubun=admRul&joNo=006800000&lsId=21038&lsNm=%EA%B5%AD%EC%84%B8%EA%B8%B0%EB%B3%B8%EB%B2%95%EC%8B%9C%ED%96%89%EB%A0%B9&mode=10). 세무 사무에 관한 근거가 있다는 사실을 무료 베타의 사전 신원 확인에 자동 적용하지 않는다.

운영 API에서 확인한 DB 리전은 `ap-south-1`(인도 뭄바이)다. Supabase 일반 직접 계약의 수탁 법인과 AWS Marketplace 계약 법인이 다를 수 있고, 지원·운영·재수탁 처리는 저장 리전과 다를 수 있다. Cloudflare Pages Functions도 기본 실행 국가가 미국이나 한국에 고정되지 않는다.

- Supabase: [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [데이터 위치·이전 FAQ](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq), [계약 주체](https://supabase.com/terms). 일반 직접 계약은 Supabase Pte. Ltd., 문의 `privacy@supabase.com`; 실제 계약 확인 필요.
- Cloudflare: [DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [실행 위치 문서](https://developers.cloudflare.com/workers/configuration/placement/). Cloudflare, Inc., 문의 `privacyquestions@cloudflare.com`.
- 국외이전 안내 항목: [개인정보 보호법 제28조의8](https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1029332501). 어떤 이전 근거를 사용할지와 실제 항목·국가·시기·방법·수령자·연락처·목적·기간·거부 방법/영향을 확정한다. 별도 동의가 모든 경우의 유일한 근거라고 단정하지 않는다.

현재 준비 안내를 [공개 안내 페이지](https://webnovels-db4.pages.dev/policies/settlement/)에 둔다. 계약과 실제 처리 국가·재수탁 범위·백업 보유 조건이 미확정이므로 **이번 배포에서 신규 정산 개인정보 접수는 닫아 둔다.** 기능 화면과 암호화 키를 준비하더라도 일반 동의·초안 확인만으로 열지 않는다. 실제 접수 개방에는 아래 설정과 최종 안내가 모두 필요하다.

## 저장·접근·파기

`database/launch/016_author_settlement_registration.sql`은 비공개 `launch_recovery` 테이블과 서버 전용 RPC를 추가한다. 신규 테이블은 RLS를 켜고 `PUBLIC`·`anon`·`authenticated`·`service_role` 직접 접근을 회수한다. 서비스 RPC는 검증된 Auth UUID와 작가 프로필 소유권 또는 최고 관리자 역할을 다시 확인한다.

성명·주소 등 신청 정보와 가린 이미지도 AES-GCM으로 암호화한다. 전용 32바이트 키를 사용하며 API 서비스키나 제공자 설정키를 대체 키로 사용하지 않는다. AAD는 계정·작가·revision·용도를 구분한다. 이미지는 크기·실제 형식·치수·불필요한 메타데이터를 검증하고 최대 150KiB씩 받으며, 암호화된 형태로 private DB에 보관한다. 공개 Storage·작품 업로드·공개 URL을 사용하지 않는다.

기존 계좌 envelope의 키 선택 방식과 `keyId`는 호환성을 위해 보존했다. 실제 지급이나 키 교체 전에 과거 계좌의 키를 잃지 않도록 키 목록·이관 절차를 정해야 한다. 신규 계좌 저장·삭제는 단조 증가하는 비공개 revision 시퀀스를 사용해 삭제 후 같은 revision이 다시 사용되는 충돌을 막는다.

대기 자료는 최대 7일, 검토 후 이미지는 즉시 삭제한다. 검토한 본인 신청 정보는 제출일부터 최대 90일 또는 철회 시까지다. 본인 신청 철회와 정산 계좌 삭제는 별도 동작이며, 현재 계좌 정보는 등록 유지 기간 보관하고 계좌 삭제 요청 시 파기한다. 기존 이전 계좌 자료는 자동 삭제하지 않는다. 원문 없는 감사 기록은 2년, 중복 요청 확인 기록은 30일이다. 별도 삭제 Cron은 신규 접수 중단 여부와 독립적으로 동작한다. 백업의 보유·복구·삭제 조건은 실제 수집 전 추가 확정 대상이다. 현재 읽기 전용 백업/복원 검증을 hosted 전체 복원이나 법적 보관 체계 완료로 표시하지 않는다.

## 활성화 계약

| 설정 | 의미 |
| --- | --- |
| `AUTHOR_SETTLEMENT_REGISTRATION_ENABLED` | 새 정산 준비 화면/API capability. 지급·결제·PASS와 별도 |
| `AUTHOR_SETTLEMENT_ENCRYPTION_KEY` | 전용 64자리 hex 비밀. 출력·커밋 금지, 기존 키 임의 교체 금지 |
| `AUTHOR_SETTLEMENT_KEY_VERSION=v1` | 현재 암호화 형식 |
| `AUTHOR_SETTLEMENT_PRIVACY_REVIEWED` | 실제 국외 처리·보유 조건 검토 완료 여부. 이번 배포 `false` |
| `AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION/TEXT` | 최종 확정 안내의 버전·본문. 초안·공란은 접수 개방 조건을 충족하지 않음 |
| `AUTHOR_SETTLEMENT_CLEANUP_ENABLED` | private scheduler의 만료 자료 정리. 접수 종료 시에도 유지 |

사용자에게 내부 설정값을 입력하도록 요구하지 않는다. 신청 화면은 서버의 `collectionEnabled`를 확인해 접수 준비 상태를 표시하며, 서버도 개인정보 body를 읽기 전에 개방 조건을 검사한다. 기존 자료의 철회·계좌 삭제와 보존 기간 정리는 신규 수집 중단과 구분한다. 최종 안내는 일반 개인정보 동의와 별도 확인하고 버전·해시를 기록한다.

## 검증·Git·다음 단계

합성 PostgreSQL에서 실제 `SET ROLE` 접근 허용/거절, 타 작가 접근, 관리자 범위, revision·재전송·문서 삭제·만료를 검증한다. API·암호화·작가·관리자 VM·레이아웃·Cron 검사를 함께 수행하고, 기존 대시보드·무료 베타·인증·명칭·발행·Cloudflare 번들을 회귀 검증한다. 브라우저/localhost/실기기·실제 신분증 제출은 이번에 수행하지 않는다.

검증 결과는 `artifacts/ui-r13-verification-2026-11-01.json`, 운영 DB·GitHub·Cloudflare 반영 결과는 완료 보고를 따른다. 환경 파일·신분증·계좌 원문·백업을 커밋하지 않는다.

다음 **UI-R14**는 실제 국외 처리·수탁·백업 조건 확정과 최종 고지 반영 후 정산 정보 접수를 개방하고, 별도 허가받은 자료로 작가·관리자 왕복을 인수하는 단계다. 실제 지급을 시작하기 전 개인/사업자/법인 세무 분류·증빙·원천징수·정산 원장·계좌 금융 검증을 별도로 구현한다. R12 CMS 실기기 인수, SMTP 외부 가입/복구 메일 수신, 독립 Supabase/private Storage 복원도 남은 서비스 준비 항목이다.
