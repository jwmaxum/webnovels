# 1단계 기능·호출·데이터 목록

기준일: 2026-09-23. 정적 소스 조사이며 운영 동작 완료 목록이 아니다.

## 조사 범위와 읽는 법

- 재생성 명령: `node scripts/audit_launch_inventory.cjs`.
- [기계 판독 목록](static-inventory.json): 소스 74개 해시, 관리자 메뉴 15개, 작가 탭 7개, HTML 인라인 이벤트 198개, 함수 정의 425개, 구 Express 라우트 선언 57개, 정적 테이블/RPC 참조 178개, 옛 계획 참조 24개.
- JSON의 `inlineEvents`에서 버튼/폼 이벤트와 줄 번호를 찾고 `functions`의 호출·테이블·RPC·fetch를 따라간다. 동일 함수명은 파일/줄로 구분한다. JS 템플릿의 동적 이벤트·동적 URL·별칭은 아래 수동 조사와 원문 확인을 병행한다.
- 정적 추출은 실행 순서, 런타임 권한, 원격 정책 적용을 입증하지 않는다. 공용 라우터 미들웨어는 개별 route 배열과 별도로 확인한다.
- 아래 `DB`는 **브라우저 Supabase 직접 호출**이다. 안전한 서버 API를 뜻하지 않는다. 표의 정책은 이후 구현할 목표이며 현재 보장 사항이 아니다.
- 모든 기능은 `작가 이관 / 관리자 유지 / 통합 / 초기 비활성 / 호출 제거 후 삭제`로 처리한다. 독자 공용 기능은 `통합`으로 분류하고 독자 서비스로 유지한다.

## A. 관리자 메뉴 전수 대응

메뉴 클릭은 `index.html`의 `switchAdminSubTab(tab)` → `admin.js`의 권한 표/로더 → 아래 데이터 함수로 연결된다. URL은 dashboard만 `/admin`, 나머지는 `/admin/{tab}`이다.

| ID / tab | 버튼·로더·주요 동작 | 현재 데이터 경로 | 결정 / 책임 단계 |
|---|---|---|---|
| A01 dashboard | `loadDashboardKPIs`, `loadAdminDashboard`, 대기열 미리보기 | `fetchDashboardKPI` → DB works/episodes/readers/authors/ad_events/revenue_periods; 대기열 함수 누락 | 통합: 서비스 운영 요약, 가상 가동 표시 제거 / 9 |
| A02 users | `loadAdminUsers`, `openReaderDetailModal`, `handleSaveReaderInfo`, `handleChangeReaderPassword`, `handleDeleteReader` | DB readers; `updateReaderByAdmin`, `changeReaderPasswordByAdmin`, `deleteReaderByAdmin` | 통합: 계정 지원. 비밀번호 직접 변경/일반 삭제는 안전한 복구·탈퇴 처리로 대체 / 3·9 |
| A03 authors | `loadAdminAuthors`, `renderAuthorsAdminGrid`, 신청 승인 안내 버튼 | `fetchAuthorsFromSupabase` → DB authors | 통합: 계정 지원의 작가 탭. 안내만 하는 승인 버튼 제거 / 3·9 |
| A04 works | `renderAdminWorks`, 생성·설정·일괄 상태/삭제·캘린더·연재 상세·큐레이션 | `fetchWorksFromSupabase`, `createWorkInDB`, `updateWorkAdminSetting`, `deleteWorkFromDB`, `fetchPublishingCalendarEvents`, `fetchWorkSeriesDashboardData` → works/authors/episodes/author_earnings/favorites | 작가 이관: 창작·연재 관리. 관리자 유지: 사유 있는 노출 제한·큐레이션 / 4·7·8·9 |
| A05 episodes | `renderAdminEpisodes`, 검색·요약·생성·본문 편집·무료 토글·일괄 삭제 | `fetchEpisodesByWorkId`, `createEpisodeInDB`, `updateEpisodeSetting`, `deleteEpisodeFromDB` → DB episodes | 작가 이관: 편집/게시/휴지통. 관리자 유지: 제한적 검수 열람·제재 / 7·9 |
| A06 actionqueue | `renderActionQueue`, `handleActionQueueItem`, `handleActionDismiss` | 참조하는 `fetchActionQueueFromDB`, `resolveActionQueueItemInDB`는 WebNovelsAdmin에 정의/내보내기 없음 | 통합: 검수·신고 처리함을 실제 서버 상태 기반으로 재구축 / 9 |
| A07 comments | `loadAdminReports`, `handleReportAction` | `fetchReportsFromDB`, `resolveReportInDB` → DB reports | 통합: 처리함. 현재 보고서 상태 변경과 실제 댓글/작품 차단이 연결되는지 별도 구현 필요 / 8·9 |
| A08 admgmt | `loadAdminAdUnits`, 광고 설정 UI | `fetchAdUnitsFromDB` → DB ad_units | 초기 비활성 / 9·13 |
| A09 settlements | `loadSettlementsList`, 계산·확정·지급 승인 | DB author_settlements/revenue_periods/author_earnings; RPC request_author_settlement; 일부 구 `/api/admin`, `/api/revenue` 경로 | 초기 비활성. 확장 시 수익 운영으로 통합 / 9·13 |
| A10 fanmeeting | `loadAdminFanMeetings`와 생성 안내 | `fetchFanMeetingsFromDB` → DB fan_meetings | 초기 비활성, 메뉴/조회 제거 후 이력 보존 / 9·13 |
| A11 goods | `loadAdminGoods`와 상품 안내 | `fetchGoodsFromDB` → DB goods | 초기 비활성 / 9·13 |
| A12 events | `loadAdminEvents`와 이벤트 안내 | `fetchEventsFromDB` → DB events | 초기 비활성 / 9·13 |
| A13 analytics | `loadAdminAnalytics`, 갱신 | fetchRevenueEvents → revenue_periods, fetchDashboardKPI → 작품/계정/광고 집계 | 통합: 서비스 장애·가입·게시 지표만 초기 제공; 고급 매출 차트 비활성 / 9·11·13 |
| A14 subadmins | `loadSubAdminList`, 생성·삭제·권한 편집·암호 UI | DB admin_users; RPC get_sub_admins/create_admin_user/delete_sub_admin | 관리자 유지: 최고 관리자 권한 관리. 비밀번호는 Auth 복구로 대체 / 3·9 |
| A15 security | `loadSystemConfig`, `loadAdminAuditLogs`, PG 설정/핑 | DB system_config/audit_logs; 구 `/api/admin/config/pg` | 관리자 유지: 비밀값 없는 운영 설정·감사. 결제 핑은 초기 비활성 / 3·9·13 |

### 메뉴 외 관리자 경로

| ID | 진입·현재 경로 | 결정 |
|---|---|---|
| A16 review | `switchAdminSubTab('review')` → `loadAdminContentReviews` → content_reviews; `handleReviewAction` → `updateContentReviewInDB` | 통합: A06 처리함으로 이동. 사이드바에는 독립 메뉴가 없지만 라우터 분기가 있어 제거 목록에 포함 / 9 |
| A17 creators 별칭 | `/admin/creators`, `loadAdminCreators = loadAdminAuthors` | 통합: authors 표준 경로로 안내·호환 처리 / 9 |
| A18 로그인/로그아웃 | `handleAdminLoginProcess` → WebNovelsAdmin.login → verify_admin_login RPC 및 Auth/프로필 경로 | 관리자 유지: Auth 단일 신원으로 변경 / 3·10 |
| A19 홈페이지 검색/발견 공용 함수 | admin.js의 `renderDiscoverWorks`, `renderSearchResults`, `renderSearchResultItem`, 검색 정규화 | 통합: 공용 독자 모듈로 분리. 관리자 파일 전체 삭제 금지 / 9 |

## B. 작가 탭과 주요 작업

공통 진입: `router.js` → `/creator/{sub}` → `switchCreatorTab` → `fetchCreatorDashboardData`. 현재 웹 세션은 여러 localStorage 키와 클라이언트 필터를 사용한다.

| ID / 탭·작업 | 이벤트·함수 연결 | 현재 저장 경로 / 목표 |
|---|---|---|
| C01 works | 첫 작품/상단 등록 → `openAdminCreateWorkModal`; 작품 목록 → `fetchCreatorDashboardData` | DB 전체 작품 배열에서 필명/ID 필터. 작가 이관: 자기 작품 API·작가 전용 폼 / 4 |
| C02 new-ep | 다음 회차 → `prepareNewEpisodeForWork`; submit → `handleCreateEpisodeSubmit` → `createEpisodeInDB` | DB episodes 직접 INSERT. 작가 이관: 안전한 게시 API / 7 |
| C03 status | 연재 상태 → `updateWorkSerialStatus` → `updateWorkAdminSetting` | DB works 업데이트. 통합: 작품 설정 / 8 |
| C04 stats | `loadCreatorReaderAnalyticsVisuals` → `fetchCreatorReaderAnalytics` | reader_events/works. 통합: 자기 작품 집계 / 8 |
| C05 ad-rev | `loadCreatorStudioEarnings` → `fetchAuthorRevenueSummary` | author_earnings/author_settlements; 함수 부재 시 가상 수익 경로도 잔존. 초기 비활성 / 9·13 |
| C06 sales-rev | 수익 요약·`loadCreatorEarningLedger` | earning_ledger. 초기 비활성 / 9·13 |
| C07 settlements | `handleCreatorSettlementReq` → `requestSettlementSecure`; 원장 필터 | author_settlements 및 RPC. 초기 비활성 / 9·13 |
| C08 가입·프로필·로그아웃 | `handleAuthorSignup`은 준비 중 안내; `handleAuthorLogoutProcess` → 공용 로그아웃 | 작가 이관: Auth 가입·프로필·정상 로그아웃 / 3 |
| C09 자동저장·복구 | input → `saveSoon` → `saveLocal`; change → `loadDraft`; `syncServer`; 버전 비교/복원 | IndexedDB + DB episode_drafts/episode_draft_revisions 우선; 구 `/api/creator/drafts` 대체. 통합: 안정적인 초안 API / 5 |
| C10 서식·글자 수·모바일 | 정리 버튼·`updateCounts`·visualViewport·beforeunload | 로컬 원고. 통합: 기존 기능 유지·백업/조합 입력 보강 / 5·11 |
| C11 예약 | `toggleScheduledTimeInput` + C02 제출 | SCHEDULED/scheduled_at 저장, 실행기 미확인. 작가 이관: 실행·취소·재처리 포함 / 7 |
| C12 댓글 정책·차단 | `handleSaveCommentPolicySubmit`, 차단 목록/해제 → updateWorkCommentPolicy/fetchBlockedReaders/unblockReaderComments | work_comment_policies/creator_comment_blocks/comments. 작가 이관: 본인 작품 범위 / 8 |
| C13 파일·표지·내보내기 | 현재 TXT/DOCX 가져오기 흐름 미확인, 표지는 관리자 고정 목록 | 작가 이관: 파일 API·Storage·내보내기 신규 / 6 |
| C14 미리보기·공개본 수정·휴지통 | 통합 흐름 미완성 | 작가 이관: 불변 공개본/초안 분리·복구 / 4·7 |

C03 관련 `handleWorkStatusChange`는 정의되어 있으나 없는 `updateWorkStatusInDB`를 참조한다. 실제 UI는 다른 `updateWorkSerialStatus`로 연결되고 파일 말미에서 다시 정의되므로, 전자를 활성 장애라고 단정하지 않는다. 구 함수/별칭을 호출 검색 후 제거한다.

## C. 독자·공통 기능 보존 목록

| ID | 기능·현재 호출 | 데이터 | 결정 / 단계 |
|---|---|---|---|
| R01 홈·검색·태그·상세 | `fetchWorksFromSupabase`, 공용 검색/렌더링 | works/authors/episodes 메타데이터 | 통합: 공개 메타데이터·기본 검색 유지 / 8·10 |
| R02 본문·다음 화 | `fetchEpisodeContentSecure` | RPC get_episode_content, episode_contents/episode_panels/episodes fallback | 통합: 권한 검사 v2 본문 API, 우회 fallback 제거 / 7·10 |
| R03 로그인·가입·개인 프로필 | readerLogin/createReaderInDB/updateReaderProfileInDB | readers 직접 접근 | 통합: Auth·자기 프로필 API / 3·10 |
| R04 관심작·구독·이어보기 | fetchReaderActivity/updateReaderActivity/recordReadingProgressInDB/toggleFavoriteInDB/toggleSubscriptionInDB | reading_history/favorites/author_subscriptions/episodes | 통합: 자기 계정 범위 API / 8·10 |
| R05 댓글·문단 반응·신고 | fetchCommentsByEpisode/addCommentToEpisode; 구 community API | comments/reports 및 정책·차단 | 통합: 문맥 버전·신고 보존 / 8·9·10 |
| R06 리더 환경설정 | fetchReaderPreferencesFromDB/saveReaderPreferencesToDB | readers.reader_preferences 및 localStorage | 통합: 기존 테마·글꼴 등 유지, 자기 계정 동기화 / 8·10 |
| R07 독서 이벤트 | recordReaderEventInDB/recordWorkReadingView | RPC record_reader_event/increment_work_view, episodes | 통합: 남용 방지 집계 / 8·10 |
| R08 광고·포인트·후원·성인 | unlockEpisodeWithAdSecure/supportCreator 및 업체 API | episode_unlocks/ad_events/creator_supports/earning_ledger, RPC grant_rewarded_ad_unlock/support_creator | 초기 비활성 / 9·13 |
| R09 신인 추천·후원 명예의 전당 | fetchGoldenBestFromDB/fetchWorkTopSupporters | v_golden_best_current/golden_best_snapshots/creator_supports | 초기 비활성: 검증된 기본 노출만 유지, 확장 재검증 / 9·13 |
| R10 공개 설정·Realtime·세션 | initSupabaseAdmin/setupRealtimeSubscriptions, `/api/public-config.js` | 공개 설정 및 DB 변경 구독 | 통합: 비밀값 격리·허용 테이블만 구독 / 3·10 |

8단계 코드 기준으로 새 독자 플래그가 켜지면 R01, R04~R07의 독서 활동·댓글·환경설정은 v2 API를 사용한다. `fetchGoldenBestFromDB`, `fetchWorkTopSupporters`, `supportCreator`는 새 독자 경로에서 호출하지 않는다. 10단계에서 개인 프로필 변경 `updateReaderProfileInDB`를 제거하고 검증된 Auth UUID의 닉네임 변경을 서버 전용 `stage10_reader_profile`로 옮겼다. 플래그가 꺼진 구 경로의 `fetchReaderActivity`, `recordReadingProgressInDB`, `toggleFavoriteInDB`, `toggleSubscriptionInDB`, `fetchCommentsByEpisode`, `recordReaderEventInDB`, `fetchReaderPreferences`, `saveReaderPreferences`와 남은 관리자·정산·Realtime 직접 접근은 계속 감사 대상이다. [10단계 전환 감사](stage10-cutover-audit.md)를 참고한다. 구형 독서기록·관심·댓글 데이터는 신원 매핑과 중복 대조 전 자동 이관하지 않는다.

## D. 런타임/API 경계

| 경로 | 현재 코드 | 1단계 판단 |
|---|---|---|
| 브라우저 → Supabase REST/RPC | public/supabase-admin.js | 주요 현재 경로. 함수명의 Secure는 보호 보증이 아님 |
| `/api/v2/health`, `/me`, `/admin/readers`, `/admin/config`, `/works` GET | server/secure-api.mjs | 코드 존재. 활성화 플래그와 locked 마이그레이션 필요. 운영 활성 여부 미조회 |
| `/api/v2/works/:id` PATCH | 동일 | 소유자 또는 CONTENT_WRITE 관리자. 작가 허용 필드 제한 |
| `/api/v2/episodes/:id/content` GET | 동일 | 본문 권한 판정. CONTENT_WRITE 관리자는 편집자로 취급해 비공개 본문 열람 가능하므로 목표와 차이 |
| `/api/v2/episodes/:id` PATCH | 동일 | 작가는 DRAFT만 수정 가능. 목표의 작가 재게시 흐름 추가 필요 |
| v2 payments/ads/adult-verification/points/support/settlements | 동일 | 업체/원장 미완료 503 경로 |
| Cloudflare 구 `/api/*` | functions/api/[[path]].js | 공개 설정 예외 외 미구현 JSON 503. Express 기능 존재와 구분 |
| Express `/api/auth`, `/works`, `/episodes`, `/ads`, `/creator`, `/admin`, `/community`, `/payments`, `/revenue` | src/app.ts + 57개 라우트 선언 | SQLite 기반 구 경로. 개별 선언의 middleware 빈 배열만으로 무인증 단정 금지: adminRouter.use 등 별도 적용 |

주의: `/api/revenue`의 조회·정산·마감 경로는 라우터 수준 인증이 없고 src/app.ts의 `/api` 가드는 JWT 설정 유무만 확인한다. 현재 Cloudflare catch-all이 이 Express 라우터를 실행하지 않는다는 사실과 별개로, 구 서버를 재배포하기 전에 폐쇄해야 한다. 운영 악용 재현은 수행하지 않았다.

## E. 새로 확인한 정리 우선 항목

1. 작가 관리 권한 문자열의 HTML/탭/v2 불일치: [권한 표](permission-matrix.md).
2. 대기열 로드/처리 함수 부재인데 조치 성공처럼 항목을 로컬 제거하는 코드: A06, 9단계 필수 수정.
3. `resolveReportInDB`는 reports 상태만 바꾼다. 실제 콘텐츠 제한 성공을 대신할 수 없음: A07.
4. 관리자 파일에 독자 검색 함수가 섞임: A19. 파일 전체 삭제 금지.
5. 관리자 정산 함수와 작가 출금 함수의 중복 정의·별칭: 이름만 보고 삭제하지 않고 최종 등록과 호출 인자를 확인.
6. 원격 열 접근 위험 신호 및 Auth 매핑 미완료: [기준선](baseline.md). 이번 단계에서 실제 원고/비밀번호 값은 읽지 않았다.

## F. 9단계 로컬 정리 상태

- 관리자 작품·회차 생성, 회차 본문 편집·무료 전환·물리 삭제, 작품 대량 상태 변경·삭제의 UI와 `WebNovelsAdmin` 직접 쓰기 export를 제거했다. 작가의 오래된 `updateWorkSerialStatus` 관리자 쓰기 별칭도 제거했다.
- 새 관리자 화면은 `ADMIN_OPERATIONS_ENABLED`가 참일 때만 `/api/v2/admin/operations`를 사용한다. 인증된 Auth UUID와 최신 DB 권한은 서버 RPC에서 다시 검사한다. 플래그 비활성 구 화면은 인수·복구를 위해 남아 있고 직접 DB/RLS 폐쇄는 10단계 대상이다.
- 구 정산 함수 중 `loadSettlementsList`는 전역 `window` 정의와 지역 함수가 병존한다. `handleRevenueCalculation`, `handleRevenueConfirm`, `handleApproveSettlement`도 두 차례 `window`에 할당된다. 하단 할당이 최종 전역 호출을 받으며 상단 조각은 과거 처리 흐름이다. 새 운영 화면은 어느 함수도 호출하지 않으며 초기 수익 메뉴를 제공하지 않는다. 구 코드 삭제는 거래 이력·13단계 운영 이관 검증과 함께 진행한다.
- `case-resolve`는 상태 행 잠금과 고유 처리 이력으로 중복 처리를 막는다. 이의제기는 `/api/v2/appeals`와 별도 관리자 처리함에서 제출·재신청·심사하며 원 사건과 제재 기록을 보존한다.
