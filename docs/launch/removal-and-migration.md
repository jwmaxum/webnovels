# 삭제·이관 실행 대장

기준일: 2026-09-23. **이번 단계에서 서비스 함수·메뉴·데이터를 삭제하지 않았다.** 아래의 대상과 검증을 후속 단계의 작업 단위로 사용한다.

## 삭제 조건

대체 기능 구현 → 소유권/실패 시나리오 검증 → 호출자 전환 → 메뉴/모달/함수 제거 → 구 URL/API 폐쇄 순서다. `WebNovelsAdmin` 전체는 독자/작가에서도 사용하므로 이름만 보고 삭제하지 않는다. 아래 목표 API는 신규 제안 계약이며 존재하는 경로가 아니다. 2~3단계에서 데이터 모델에 맞춰 확정한다.

| ID | 대상·현재 호출자 | 대체 화면·API 계약 | 선행 / 제거 단계 | 제거 검증 |
|---|---|---|---|---|
| D01 | `modalAdminCreateWork`, openAdminCreateWorkModal/handleAdminCreateWorkSubmit; index 작가 상단/관리자 버튼·creator.js 첫 작품 버튼 | 작가 작품 폼, POST `/api/v2/creator/works`, 작성자 서버 지정 | 3·4 / 9 | 작가 첫 작품 생성 성공, 해당 ID/함수 활성 참조 0 |
| D02 | `modalAdminCreateEpisode`, openAdminCreateEpisodeModal/handleAdminCreateEpisodeSubmit; 관리자 회차 버튼 | 작가 편집기, POST `/api/v2/creator/drafts/{id}/publish` | 5·7 / 9 | 관리자 대행 등록 UI 없음, 중복 게시 검사 통과 |
| D03 | openAdminEpisodeDetailModal/handleAdminEpisodeDetailSave; 회차 상세 편집 | 작가 공개본 수정 초안, PATCH draft + publish; 관리자 사건별 읽기 전용 | 7 / 9 | 운영 제한과 본문 수정 분리, 과거 호출자 재연결 |
| D04 | handleBulkEpisodeFree/handleAdminToggleEpisodeFree 및 무료 토글 | 초기 신규 무료 정책 서버 고정, 유료 확장은 13 | 7 / 9 | 구 버튼/쓰기 호출 제거, 기존 유료 레코드 불변 |
| D05 | handleBulkWorkDelete/handleBulkEpisodeDelete/handleAdminDeleteEpisode·삭제 버튼 | 작가 휴지통·복구 API; 별도 정책에 따른 영구 삭제 | 4·7 / 9 | 대량 물리 삭제 호출 없음, 회차·파일 복구 가능 |
| D06 | handleBulkWorkStatus/toggleAdminSetting 일부 필드·작품 관리 조작 | 작가 연재 상태 API와 관리자 moderation API 분리 | 4·8 / 9 | 작가가 moderation 상태/큐레이션을 변경 못함 |
| D07 | toggleWorkCalendarView/renderAdminCalendar/openWorkSeriesDashboard; 관리자 작품·연재 상세 버튼 | 작가 회차/예약 화면, GET schedules; 관리자 실패 작업 보기만 | 7·8 / 9 | 공용 로더 분리 후 관리자 중복 화면·전역 참조 제거 |
| D08 | users/authors 메뉴·loadAdminUsers/loadAdminAuthors | 관리자 계정 지원 탭, 최소 필드 조회·지원 API | 3 / 9 | 독자/작가 조회 권한을 혼합·확대하지 않음 |
| D09 | changeReaderPasswordByAdmin·관리자 비밀번호 폼 | Auth 재설정 초대/사용자 본인 재설정 | 3 / 9·10 | 브라우저 password_hash 조회/쓰기 제거, 재설정 검증 |
| D10 | handleDeleteReader/deleteReaderByAdmin | 탈퇴·보관·삭제 요청 처리, 서버 감사 | 2·3 / 9·10 | 거래·신고 증빙을 잘못 연쇄 삭제하지 않음 |
| D11 | actionqueue/review/comments, loadActionQueueFromDB·handleActionDismiss 등 | 사건 처리함, GET `/api/v2/admin/cases`, POST case action | 8 / 9 | 저장 실패 때 항목 유지, 재시도/중복 처리/실제 제재 반영 |
| D12 | 광고·수익·정산 메뉴/자동 로드·중복 정산 함수 | 초기 비활성, 후속 작가 수익·관리자 수익 운영 | 1 범위 / 9·10·13 | 정산 이력 유지, 미제공 호출·가상 수익 없음 |
| D13 | fanmeeting/goods/events 메뉴·loadAdminFanMeetings/loadAdminGoods/loadAdminEvents | 초기 진입·자동 조회 없음, 이력만 보존 | 1 범위 / 9 | 구 URL 안내, 활성 fetch 없음, DB 행 수 보존 |
| D14 | admin.js의 renderDiscoverWorks/renderSearchResults 등 | 독자 공용 모듈 | 8 / 9 | admin.js 없이 독자 검색·작가 페이지 동작 |
| D15 | 과장된 AI 검수/자동화 가동·고정 숫자·가상 수익 fallback | 실제 상태·오류·0건·수집 중 표시 | 7 / 9 | 미검증 성공 문구·수익 추정 상수 제거 |
| D16 | 구 Express 업무/직접 DB 개인 쓰기·인증·미사용 배포 경로 | Cloudflare v2→단일 Supabase | 3~9 / 10 | 활성 호출 0, 직접 RPC/REST 우회 거절, 개발 전용 사용 구분 |
| D17 | 작가 works/new-ep/status와 수익 3탭 | 작품 중심 화면, 초기 수익 숨김 | 4~8 / 8·9 | 깊은 링크·뒤로가기·초안 전환·로더 누락 없음 |
| D18 | 중복 정의·별칭: loadSettlementsList/handleRevenueCalculation/handleRevenueConfirm/handleApproveSettlement/handleCreatorSettlementReq | 실제 최종 등록·호출 인자를 먼저 확정한 단일 함수 또는 미제공 경로 폐쇄 | 호출 조사 / 9 | 상위/하위 정의·window export·inline handler 인자 모두 검증 |

D01~D18의 원문 위치는 [정적 목록](static-inventory.json)에서 함수명/DOM ID 또는 인라인 이벤트를 검색한다. 삭제 전 현재 소스에서 다시 검색해 변경 후 추가된 호출도 포함한다.

## 관리자에게 남길 기능

- 계정 지원·정지·복구 안내, 권한 부여, 최소 개인 정보 조회.
- 신고·검수·이의제기, 사유 있는 제한/해제, 사건 단위 원고 열람.
- 서비스 장애·예약 실패·공지·도움말·지원 대응.
- 감사 기록·운영 설정·최소 큐레이션.
- 수익 기능은 13단계 완료 후 거래 검증·정산 운영만 제공한다.

## 데이터 보존 경계

- 기존 유료·성인·웹툰 작품을 신규 무료 연재 정책으로 일괄 UPDATE하지 않는다.
- 초기 범위 밖 콘텐츠는 권한 검증 완료 전 신규 노출/거래를 제한한다. 기존 사용자의 권리/환불/지원 필요를 조사해 별도 처리한다.
- 거래 원장·정산·신고·검수·감사 이력은 메뉴 제거와 무관하게 보존한다.
- 비공개 전환과 파일 삭제를 분리한다. 공유된 파일 참조·독서기록 FK·예약을 확인한다.
- 작가 소유권 이관은 검증된 계정 연결만 사용한다. 필명·이메일·대표작 일치로 자동 재배정하지 않는다.

## 이전 improve 번호 참조 이관

24개 참조를 정적 목록 `oldPlanReferences`에 파일/줄/문구로 기록했다. 이번에는 서비스 소스 주석을 수정하지 않는다.

| 참조 파일 | 기존 의미 | 후속 처리 |
|---|---|---|
| public/js/core/router.js, src/app.ts | improve1: 라우터/딥링크. 보관된 이전 1단계 내용과도 일치하지 않는 더 오래된 참조 | 4·8단계에서 구 번호 제거, 실제 라우팅 명세로 연결 |
| scripts/verify_normalized_db.js | improve1: DB 정규화 | 2·11단계에서 실제 데이터 계약으로 연결; 과거 번호를 새 단계 증거로 쓰지 않음 |
| index.html 검색 영역 | improve3: 태그·탐색 | 4·8단계 현재 명세로 갱신 |
| index.html·styles.css 리더/해금/바텀시트 | improve3: 과거 UI 설계 | design/현재 리더 명세로 갱신, 번호만 치환하지 않음 |
| index.html·creator.js·reader.js 댓글 | improve4: 댓글 정책 | 새 8단계와 permission-matrix로 연결 |
| index.html·creator.js·reader.js·styles.css 후원/원장 | improve5: 수익/후원 | 새 13단계 또는 보관본으로 연결 |
| index.html·creator.js·styles.css 통계 | improve6: 통계 | 새 8·11단계로 연결 |
| scripts/verify_author_suite.ts | 이전 1~6 기능 검증 | 새 인수 시나리오 ID와 실제 테스트 범위 명시 / 11 |

보관 폴더 원본은 수정하지 않는다. 과거 테스트 이름/주석만으로 새 1~6단계가 완료됐다고 보고하지 않는다.
