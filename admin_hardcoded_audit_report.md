# 관리자 화면(Admin CMS) Mock & 하드코딩 데이터 전수 감사 보고서
**문서 경로:** `D:\Antigravity\webnovels\admin_hardcoded_audit_report.md`  
**감사 대상:** 통합 관리자 콘솔 전역 (`public/index.html`, `public/js/admin/admin.js`, `public/supabase-admin.js`)  
**작성 일자:** 2026-09-07  
**작성 목적:** Phase 1~6 조치 이후에도 관리자 화면에 잔존하는 정적 HTML 더미 수치, Mock 데이터, 임의 계산식, Fallback 배열을 100% 전수 파악하여 완전한 동적 DB 연동(Zero-Hardcoded)을 위한 마스터플랜 수립.

---

## Executive Summary (요약)

Phase 1~6을 통해 주요 API와 DB 스키마(reports, content_reviews, audit_logs, fan_meetings, goods 등)의 동적 조회 함수가 추가되었으나, **관리자 화면의 UI 계층(HTML)과 세부 렌더러 로직(JS)에는 여전히 대규모의 하드코딩된 Mock 데이터가 잔존**해 있습니다.

### 핵심 발견 사항 (Top Findings)
1. **회차 관리 상단 4대 통계 요약 바 (L1235~1252)**: `전체 회차 128,421화`, `⏰ 예약 회차 5,238화`, `🟢 발행 완료 123,160화`, `⚠ 확인 필요 23건`이 **100% 정적 HTML로 박혀 있으며**, 실제 Supabase DB의 `episodes` 레코드 수(총 180화)와 수천 배 차이가 납니다.
2. **회차 관리 테이블의 가짜 조회수 & 발행일 (L1220~1221)**: 회차 목록을 DB에서 가져온 후에도 발행일을 `'2026-08-20 18:00'`로 고정하고, 조회수를 실제 컬럼이 아닌 `(epNum * 3420)`으로 임의 곱셈하여 출력하고 있습니다.
3. **연재 캘린더 뷰 (L1019~1039)**: 2026년 8월 기준 8/20 `4개 완료`, 8/22 `오늘 2개`, 8/23 `예약 3개`, 8/25 `2개 예정` 배지가 **순수 반복문(Loop) 안에 하드코딩**되어 있습니다.
4. **작품 상세 연재 Dashboard 모달 (L1094~1140)**: 어떤 작품을 클릭하든 구독자 팬 수 `1,280명`, 연재건강도 `88점` (95점, 84점, 90점, 88점), 최근발행 `08/20`, 다음발행예정 `08/23`이 고정되어 출력됩니다.
5. **이벤트/프로모션 탭 (L2713~2728)**: DB 조회가 전혀 없이 2건의 이벤트(`신규 가입 1,000P`, `보상형 광고 72시간 무료`)가 JS 함수 내 HTML 스트링으로 하드코딩되어 있습니다.
6. **서브 관리자 권한 수정 모달 (L1996~2030)**: DB `admin_users` 테이블에 서브 관리자별 권한 배열이 저장되어 있으나, 모달을 열 때 이를 읽어와 체크박스를 갱신하는 로직이 없고 `index.html`에 고정된 체크박스가 노출됩니다.

---

## 관리자 17개 탭 전수 점검 상태표

| 번호 | 탭 명칭 (Tab ID) | 권한 코드 | 현재 상태 | 하드코딩 / Mock 잔존 여부 |
| :---: | :--- | :--- | :---: | :--- |
| **01** | 대시보드 (`adminTab-dashboard`) | `DASHBOARD` | **부분 동적** | ⚠️ 오늘 운영현황(30건/27건/3건), 5대 KPI 카드 초기 HTML 고정 |
| **02** | 예외 관제 센터 (`adminTab-actionqueue`) | `CONTENT_REVIEW` | **동적 연동** | ✅ DB 대기열 실시간 집계 연동 완료 |
| **03** | 독자 회원 관리 (`adminTab-users`) | `READER_MGMT` | **동적 연동** | ⚠️ 등록일자 fallback `2026-08-15` 잔존 |
| **04** | 작가 회원 관리 (`adminTab-authors`) | `AUTHOR_MGMT` | **동적 연동** | ⚠️ 상단 타이틀 "등록 작가: 30명" 정적 텍스트 |
| **05** | 작품 관리 (`adminTab-works`) | `WORK_MGMT` | **부분 동적** | 🚨 다음 발행일 `'08/23 20:00'` 고정, 캘린더 뷰 100% Mock, 상세모달 100% Mock |
| **06** | 회차 관리 (`adminTab-episodes`) | `EPISODE_MGMT` | **심각한 불일치** | 🚨 요약바(12.8만화), 23건 오류 패널 정적 고정, 조회수 `epNum*3420`, 공개일 고정 |
| **07** | 콘텐츠 심사 (`adminTab-review`) | `CONTENT_REVIEW` | **동적 연동** | ✅ Phase 2에서 `content_reviews` 실데이터 바인딩 완료 |
| **08** | 댓글/신고 관리 (`adminTab-comments`) | `COMMENT_REPORT` | **동적 연동** | ✅ Phase 2에서 `reports` 실데이터 바인딩 완료 |
| **09** | 광고 지면 관리 (`adminTab-admgmt`) | `AD_MGMT` | **부분 동적** | ⚠️ 단가/설정 변경 클릭 시 미구현 토스트 알림 |
| **10** | 수익배분 Engine (`adminTab-revenue`) | `AD_REVENUE` | **부분 동적** | ⚠️ 입력 폼 기본값(총매출 1,000만원, 수수료 200만원, 비율 0.625) 하드코딩 |
| **11** | 정산 관리 (`adminTab-settlements`) | `SETTLEMENT_MGMT` | **동적 연동** | ✅ `author_settlements` DB 연동 완료 |
| **12** | 팬미팅 관리 (`adminTab-fanmeeting`) | `FAN_MEETING` | **동적 연동** | ⚠️ Empty State 시 신규 개설 버튼 미구현 토스트 |
| **13** | 굿즈 커머스 (`adminTab-goods`) | `GOODS_MGMT` | **동적 연동** | ⚠️ Empty State 시 상품 등록 버튼 미구현 토스트 |
| **14** | 이벤트 프로모션 (`adminTab-events`) | `EVENT_MGMT` | **100% 하드코딩** | 🚨 DB 조회 없이 2건 이벤트 정적 HTML 주입 |
| **15** | 통계 분석 (`adminTab-analytics`) | `ANALYTICS` | **부분 동적** | ⚠️ 초기 HTML 수치 고정, DB 실패 시 4개월 더미 fallback 주입 |
| **16** | 보안 감사 로그 (`adminTab-security`) | `SECURITY_MGMT` | **부분 동적** | ⚠️ 초기 HTML 테이블에 3건의 더미 감사 로그 고정 박힘 |
| **17** | 서브 관리자 (`adminTab-subadmins`) | `SYSTEM_MGMT` | **부분 동적** | 🚨 권한 수정 모달의 체크박스가 정적 HTML에 박혀 있으며 DB 동기화 부재 |

---

## 10대 핵심 하드코딩/Mock 영역별 정밀 분석

---

### [영역 1] 회차 관리 상단 4대 요약 바 및 확인 필요 23건 패널 (가장 심각)

* **위치**: `public/index.html` (Line 1235 ~ 1278)
* **하드코딩 내용**:
  ```html
  <!-- L1235~1252: 회차 요약 바 -->
  <div class="kpi-value text-white">128,421화</div> <!-- 전체 회차 -->
  <div class="kpi-value text-indigo">⏰ 5,238화</div> <!-- 예약 회차 -->
  <div class="kpi-value text-emerald">🟢 123,160화</div> <!-- 발행 완료 -->
  <div class="kpi-value text-rose">⚠ 23건</div> <!-- 확인 필요 -->

  <!-- L1255~1278: 확인 필요 23건 세부 내역 -->
  - 발행실패 4건 (DB 트랜잭션 타임아웃)
  - 신고접수 6건 (독자 유해성/저작권 신고)
  - 예약오류/검수실패 5건 (연재 지연 1건 / 예약 시간 충돌 4건)
  - 관리자 승인 대기 8건 (신규 작가 1화 등록 후 미승인)
  ```
* **문제점 및 괴리**:
  1. 실제 Supabase DB의 `episodes` 테이블 전체 레코드는 **180개**에 불과한데, 화면에는 **128,421화**라는 비현실적인 가짜 숫자가 표시됩니다.
  2. 확인 필요 23건 패널 역시 DB의 실제 `content_reviews`, `reports` 대기 건수와 전혀 연결되어 있지 않고 100% 정적 텍스트로 고정되어 있습니다.
* **해결 방안**:
  - `adminTab-episodes` 진입 시 `loadAdminEpisodeSummaryBar()` 함수를 신설하여 `episodes` 테이블의 전체 카운트, `status = 'PUBLISHED'` 카운트, `status = 'SCHEDULED'` 카운트를 `COUNT(*)`로 실시간 집계하여 바인딩.
  - '확인 필요' 카드는 `ACTION_QUEUE_ITEMS` 배열 길이를 연동하여 실제 대기 건수와 동적 아코디언으로 치환.

---

### [영역 2] 회차 테이블의 공개일시 및 조회수 임의 계산식

* **위치**: `public/js/admin/admin.js` (Line 1220 ~ 1221)
* **하드코딩 내용**:
  ```javascript
  // renderAdminEpisodes 함수 내부
  const epNum = ep.episodeNumber || ep.episode_number || 1;
  const pubDate = '2026-08-20 18:00'; // 🚨 모든 회차가 2026-08-20에 발행된 것으로 고정
  const views = (epNum * 3420).toLocaleString(); // 🚨 에피소드 번호에 3,420을 곱한 가짜 계산식
  ```
* **문제점 및 괴리**:
  - 실제 Supabase DB `episodes` 테이블에는 `created_at`, `publish_date`, `view_count` 컬럼이 존재함에도 불구하고 이를 무시하고 모든 회차의 공개일시를 `'2026-08-20 18:00'`으로 고정하고, 조회수를 1화는 3,420회, 2화는 6,840회 등으로 가짜 곱셈식을 노출하고 있습니다.
* **해결 방안**:
  - `pubDate`: `ep.publish_date || ep.created_at ? new Date(ep.publish_date || ep.created_at).toLocaleString() : '-'`
  - `views`: `(Number(ep.view_count || ep.views || 0)).toLocaleString()`으로 실데이터 바인딩.

---

### [영역 3] 연재 캘린더 뷰 (Publishing Calendar)의 100% Mock 데이터

* **위치**: `public/js/admin/admin.js` (Line 1019 ~ 1039)
* **하드코딩 내용**:
  ```javascript
  // renderAdminCalendar 함수 내부
  for (let day = 1; day <= 31; day++) {
    const isToday = day === 22;
    let badgeHtml = '';
    if (day === 20) badgeHtml = `<span class="badge badge-accent">4개 완료</span>`;
    if (day === 22) badgeHtml = `<span class="badge badge-primary">오늘 2개</span>`;
    if (day === 23) badgeHtml = `<span class="badge badge-warning">예약 3개</span>`;
    if (day === 25) badgeHtml = `<span class="badge badge-outline">2개 예정</span>`;
  ...
  ```
* **문제점 및 괴리**:
  - 실제 DB의 작품별 연재 주기(`works.schedule_days`)나 회차 예약 발행일(`episodes.publish_date`)을 전혀 조회하지 않고, 8월 20일, 22일, 23일, 25일에 임의의 가짜 배지를 출력하는 정적 Mock입니다.
* **해결 방안**:
  - 현재 월(`2026-08`)의 실제 발행된 회차 및 예약된 회차를 `episodes` 테이블에서 `publish_date` 기준으로 GROUP BY 집계하여 날짜별 셀에 실제 건수 배지를 렌더링하도록 수정.

---

### [영역 4] 작품 상세 연재 대시보드 모달 (openWorkSeriesDashboard)

* **위치**: `public/js/admin/admin.js` (Line 1094 ~ 1140)
* **하드코딩 내용**:
  ```javascript
  // openWorkSeriesDashboard 함수 내부
  // 1. 구독 독자 팬 수
  <div style="font-size: 1.3rem; font-weight: 800; color: #fff; margin-top: 4px;">1,280명</div>

  // 2. 연재 건강도 지표 88점 고정
  <span class="badge badge-accent">88점 (우수 🟢)</span>
  <div class="flex-between text-muted mb-1"><span>정시 마감률 (D-0 준수)</span><span>95점</span></div>
  <div class="flex-between text-muted mb-1"><span>주간 연재 주기 준수율</span><span>84점</span></div>
  <div class="flex-between text-muted mb-1"><span>독자 이탈 방어율 (Drop-off Rate)</span><span>90점</span></div>
  <div class="flex-between text-muted mb-1"><span>비축 회차 사전 확보량</span><span>88점</span></div>

  // 3. 최근 발행 및 다음 발행 예정일 고정
  <span class="text-muted">최근 발행:</span> <strong>08/20 (제 ${epCount}화) - 정상 완료</strong>
  <span class="text-muted">다음 발행 예정:</span> <strong style="color: var(--color-brand-secondary);">08/23 (제 ${epCount + 1}화) - 예약 대기</strong>
  ```
* **문제점 및 괴리**:
  - 어떤 작품(1화짜리 신작이든 30화 완결작이든)의 대시보드를 열어도 항상 팬 수가 **1,280명**, 건강도가 **88점**, 최근 발행일이 **08/20**, 다음 발행일이 **08/23**으로 고정 출력됩니다.
* **해결 방안**:
  - 팬 수: `author_subscriptions` 또는 `favorites` 테이블에서 `work_id`로 실제 카운트 조회.
  - 최근 발행일/다음 발행일: 해당 작품의 가장 최근 `episodes.publish_date` 및 연재 요일 기반 계산값으로 치환.
  - 건강도 점수: 실제 지연/미발행 회차 유무에 따라 동적 산출.

---

### [영역 5] 이벤트 프로모션 관리 탭 (100% 정적 HTML 주입)

* **위치**: `public/js/admin/admin.js` (Line 2713 ~ 2728)
* **하드코딩 내용**:
  ```javascript
  window.loadAdminEvents = async function(isManualRefresh = false) {
    const container = document.getElementById('adminEventsContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="episode-row mb-3 p-3 glass-panel flex-between" style="border-radius:8px;">
        <div>
          <strong>[웰컴 프로모션] 신규 가입 1,000 포인트 자동 지급</strong>
          <div class="text-muted small mt-1">대상: 전원 신규 가입 독자 | 상태: 상시 운영</div>
        </div>
        <span class="badge badge-accent">진행중</span>
      </div>
      <div class="episode-row mb-3 p-3 glass-panel flex-between" style="border-radius:8px;">
        <div>
          <strong>[보상형 광고] 4~6화 열람 시 72시간 연속 무료 해금</strong>
          <div class="text-muted small mt-1">대상: 웹소설 및 웹툰 독자 | 상태: 상시 가동</div>
        </div>
        <span class="badge badge-primary">가동중</span>
      </div>
    `;
    ...
  };
  ```
* **문제점 및 괴리**:
  - `loadAdminEvents` 함수가 Supabase DB(`events` 또는 `system_config`)를 전혀 조회하지 않고, 정적 HTML 문자열 2개를 innerHTML에 하드코딩으로 박아 넣고 있습니다.
* **해결 방안**:
  - Supabase `events` 테이블을 조회하도록 변경하고, 데이터가 없을 경우 "등록된 진행 중 이벤트가 없습니다" Empty State UI 제공.

---

### [영역 6] 메인 대시보드 오늘 운영 현황 및 5대 KPI 초기값

* **위치**: `public/index.html` (Line 866 ~ 966) & `admin.js` (Line 2057 ~ 2061)
* **하드코딩 내용**:
  ```html
  <!-- index.html L866~887: 오늘 운영 현황 -->
  <div id="kpiTodayScheduled">30건</div>
  <div id="kpiTodayPublished">27건</div>
  <div id="kpiTodayActionReq">3건 ⚠️</div>

  <!-- index.html L897~918: 콘텐츠 타입 현황 초기값 -->
  <div id="kpiNovelsCount">20작품</div> (120 에피소드)
  <div id="kpiWebtoonsCount">10작품</div> (60 에피소드)
  <div id="kpiOngoingCount">25작품</div>
  <div id="kpiCompletedCount">5작품</div>

  <!-- index.html L940~966: 5대 KPI 초기값 -->
  <div id="kpiTotalUsers">10</div>
  <div id="kpiTotalAuthors">30</div>
  <div id="kpiTotalWorks">30</div>
  <div id="kpiTotalEpisodes">180</div>
  <div id="kpiTotalAdViews">0회</div>
  ```
  ```javascript
  // admin.js L2057~2061: 임의 매핑 로직
  const elSched = document.getElementById('kpiTodayScheduled');
  const elPub = document.getElementById('kpiTodayPublished');
  if (elSched) elSched.textContent = `${totalWorksCount}건`; // 전체 작품수 30건을 오늘의 예약건수에 대입
  if (elPub) elPub.textContent = `${ongoingCount}건`; // 연재중 작품수 25건을 오늘의 발행건수에 대입
  ```
* **문제점 및 괴리**:
  - `kpiTodayScheduled`와 `kpiTodayPublished`가 '오늘 실제 예약/발행된 에피소드 수'가 아니라, 전체 작품 수(30건)와 연재 중 작품 수(25건)를 단순 대입하여 보여주는 눈속임 매핑입니다.
  - HTML 파일 자체에도 정적 수치가 박혀 있어 JS 실행 전 깜빡임 또는 로드 지연 시 가짜 데이터가 노출됩니다.
* **해결 방안**:
  - 오늘 날짜(예: `2026-08-22`)에 `publish_date`가 잡힌 실제 `episodes` 레코드 수를 COUNT하여 바인딩.
  - HTML 초기값은 `-` 또는 로딩 스피너로 교체.

---

### [영역 7] 서브 관리자 권한 수정 모달 (modalEditSubAdminPerms)

* **위치**: `public/index.html` (Line 1996 ~ 2030) & `admin.js` (Line 1800 부근)
* **하드코딩 내용**:
  ```javascript
  // admin.js openEditPermsModal
  window.openEditPermsModal = function(id, nickname) {
    window._editingSubAdminId = id;
    const modal = document.getElementById('modalEditSubAdminPerms');
    if (modal) {
      modal.querySelector('h3').textContent = `⚙️ 서브 관리자 권한 수정 (${nickname})`;
    }
    openModal('modalEditSubAdminPerms');
  };
  ```
  ```html
  <!-- index.html L2006~2023 -->
  <label><input type="checkbox" name="perm" value="DASHBOARD" checked> 대시보드</label>
  <label><input type="checkbox" name="perm" value="CONTENT_REVIEW" checked> 콘텐츠 검수</label>
  <label><input type="checkbox" name="perm" value="COMMENT_REPORT" checked> 댓글/신고</label>
  ... (16개 체크박스가 정적 HTML에 박혀 있음)
  ```
* **문제점 및 괴리**:
  - Supabase `admin_users` 테이블에 서브 관리자별 `permissions` (text 배열) 컬럼이 이미 구축되어 있으나, 관리자가 특정 서브 관리자의 "권한 수정"을 눌렀을 때 해당 관리자의 실제 DB 권한을 불러와 체크박스를 동적으로 세팅하지 않습니다. 따라서 어떤 서브 관리자를 눌러도 항상 HTML에 고정된 4~5개 체크박스만 체크된 상태로 열립니다.
* **해결 방안**:
  - `openEditPermsModal(id, nickname)` 호출 시 DB에서 해당 관리자의 `permissions` 배열을 조회하여 16개 체크박스의 `checked` 속성을 동적으로 ON/OFF 하도록 수정.

---

### [영역 8] 통계 분석 탭 (adminTab-analytics)의 Fallback 더미 및 정적 수치

* **위치**: `public/index.html` (Line 1538 ~ 1549) & `admin.js` (Line 2241 ~ 2246, Line 2289 ~ 2310)
* **하드코딩 내용**:
  ```html
  <!-- index.html L1538~1549 -->
  <div class="kpi-value">₩17,550,000</div> <!-- 8월 정산 분배풀 -->
  <div class="kpi-value">₩10,530,000</div> <!-- 플랫폼 순수익 -->
  <div class="kpi-value">142,500회</div> <!-- 8월 누적 트래픽 -->
  ```
  ```javascript
  // admin.js L2241~2246: DB 실패 시 Fallback 더미 배열
  if (!revenueEvents || revenueEvents.length === 0) {
    revenueEvents = [
      { period_month: '2026-08', gross_revenue: 31200000, ad_network_fee: 3120000, net_revenue: 28080000, writer_pool_ratio: 0.625, writer_pool: 17550000 },
      { period_month: '2026-07', gross_revenue: 28500000, ... },
      { period_month: '2026-06', gross_revenue: 24100000, ... },
      { period_month: '2026-05', gross_revenue: 19800000, ... }
    ];
  }
  ```
* **문제점 및 괴리**:
  - DB 조회 실패 시 3,120만 원 등의 대규모 가짜 재무 데이터가 화면에 주입됩니다.
  - 장르별 비중 차트 역시 실제 결제/정산 DB가 아닌 정적 `SAMPLE_WORKS`의 장르 및 viewCount를 집계하여 표출하고 있습니다.
* **해결 방안**:
  - DB 실패 시 더미 배열 주입을 전면 제거하고 "데이터를 집계 중입니다" 또는 0원으로 표출.
  - `index.html`의 1,755만 원 등의 고정 텍스트를 초기 `₩0` 또는 로딩 스피너로 치환.

---

### [영역 9] 수익배분 Engine 입력 폼 기본값 하드코딩

* **위치**: `public/index.html` (Line 1414 ~ 1428) & `admin.js` (Line 449, Line 478)
* **하드코딩 내용**:
  ```html
  <input type="month" id="revPeriodMonth" value="2026-08">
  <input type="number" id="revGrossRevenue" value="10000000"> <!-- 1천만 원 -->
  <input type="number" id="revAdNetworkFee" value="2000000"> <!-- 2백만 원 -->
  <input type="number" id="revWriterPoolRatio" value="0.625" step="0.001">
  <input type="month" id="revConfirmMonth" value="2026-08">
  ```
* **문제점 및 괴리**:
  - 관리자가 수익배분 탭을 열면 자동으로 총매출 1,000만 원, 수수료 200만 원, 작가배분비율 62.5%가 기본 입력값으로 채워져 있어, 실제 광고 정산 시스템과의 연동 없이 관리자가 무의식중에 가짜 값으로 '배분 실행'을 누를 위험이 있습니다.
* **해결 방안**:
  - 당월 광고 플랫폼(AdMob 등)에서 실제 집계된 월 광고 매출 합산액을 Supabase `ad_network_revenues` 등에서 불러와 기본값으로 채우거나, 미집계 시 0원으로 초기화.

---

### [영역 10] 보안 감사 로그 (adminTab-security) 정적 초기 HTML

* **위치**: `public/index.html` (Line 1645 ~ 1667)
* **하드코딩 내용**:
  ```html
  <tbody id="securityAuditLogBody">
    <tr>
      <td>2026-08-30 15:00</td>
      <td>admin</td>
      <td>최고관리자 로그인</td>
      <td>127.0.0.1</td>
      <td><span class="badge badge-primary">성공</span></td>
    </tr>
    <tr>
      <td>2026-08-30 11:20</td>
      <td>sub_admin_01</td>
      <td>작가 정산 승인 (₩1,250,000)</td>
      <td>192.168.1.45</td>
      <td><span class="badge badge-primary">성공</span></td>
    </tr>
    <tr>
      <td>2026-08-29 18:40</td>
      <td>system_cron</td>
      <td>회차 자동 예약 발행 (30건)</td>
      <td>127.0.0.1</td>
      <td><span class="badge badge-primary">성공</span></td>
    </tr>
  </tbody>
  ```
* **문제점 및 괴리**:
  - `admin.js`의 `loadAdminAuditLogs()`가 실행되기 전이나 DB 조회 전 시점에 3건의 더미 감사 로그가 HTML에 그대로 노출됩니다.
* **해결 방안**:
  - `index.html`의 정적 `<tr>` 태그 3개를 제거하고, `<tr><td colspan="5" class="text-center p-4 text-muted">감사 로그를 불러오는 중입니다...</td></tr>` 로딩 상태로 통일.

---

## 전수 조치 권장 로드맵 (Action Plan)

| 순번 | 작업 항목 | 수정 대상 파일 | 상태 | 예상 영향도 |
| :---: | :--- | :--- | :---: | :---: |
| **1** | **회차 관리 4대 요약 바 & 23건 패널 실데이터 동적화** | `public/index.html`, `public/js/admin/admin.js`, `public/supabase-admin.js` | ✅ **조치 완료** | 🚨 최고 (12.8만화 가짜 수치 완전 제거) |
| **2** | **회차 목록 테이블 조회수/발행일 하드코딩 제거** | `public/js/admin/admin.js`, `public/supabase-admin.js` | ✅ **조치 완료** | 🚨 높음 (`epNum*3420` 가짜 곱셈식 제거) |
| **3** | **연재 캘린더 뷰 DB 동적 스케줄링 전환** | `public/js/admin/admin.js`, `public/supabase-admin.js` | ✅ **조치 완료** | 🚨 높음 (가짜 8월 캘린더 배지 제거) |
| **4** | **작품 상세 연재 Dashboard 모달 동적화** | `public/js/admin/admin.js`, `public/supabase-admin.js` | ✅ **조치 완료** | 🚨 높음 (1,280명, 88점 고정 제거) |
| **5** | **이벤트 프로모션 탭 Supabase DB 연동** | `public/js/admin/admin.js`, `public/supabase-admin.js` | ✅ **조치 완료** | ⚠️ 보통 (정적 2건 이벤트 제거) |
| **6** | **대시보드 오늘 운영 현황/KPI 초기값 정리** | `public/index.html`, `public/js/admin/admin.js` | ✅ **조치 완료** | ⚠️ 보통 (단순 복사 매핑 로직 수정) |
| **7** | **서브 관리자 권한 수정 모달 DB 동기화** | `public/index.html`, `public/js/admin/admin.js` | ✅ **조치 완료** | ⚠️ 보통 (선택 서브관리자 권한 바인딩) |
| **8** | **통계 분석 Fallback 더미 및 초기 HTML 수치 정리** | `public/index.html`, `public/js/admin/admin.js` | ✅ **조치 완료** | ⚠️ 보통 (3,120만원 더미 제거) |
| **9** | **수익배분 입력 폼 및 보안 감사 로그 정적 태그 정리** | `public/index.html` | ✅ **조치 완료** | 🟢 낮음 (기본값 0원 및 로딩 상태 통일) |
