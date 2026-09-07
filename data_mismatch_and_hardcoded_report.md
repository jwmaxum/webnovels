# 📊 WebNovels 데이터 하드코딩 및 Supabase DB 불일치 전수 조사 보고서

**작성 일자**: 2026-09-07  
**대상 환경**: WebNovels 플랫폼 (Frontend Vanilla JS + Express Backend + Supabase PostgreSQL Cloud SSOT)  
**조사 목적**: 소스코드 및 UI 상에 임의로 하드코딩되어 있는 더미/Mock 데이터를 전수 식별하고, 실제 Supabase DB 인스턴스 데이터와 화면 표시 정보 간의 불일치 항목을 종합 취합하여 정리함.

---

## 📑 목차
1. [종합 진단 요약](#1-종합-진단-요약)
2. [Supabase DB 실제 현황 vs 화면 표시 종합 대조표](#2-supabase-db-실제-현황-vs-화면-표시-종합-대조표)
3. [[영역 1] 전역 시드 및 Mock 상태 관리](#3-영역-1-전역-시드-및-mock-상태-관리)
4. [[영역 2] 독자 서비스 (Reader Domain)의 하드코딩 및 DB 불일치](#4-영역-2-독자-서비스-reader-domain의-하드코딩-및-db-불일치)
5. [[영역 3] 작가 스튜디오 (Creator Studio)의 하드코딩 및 DB 불일치](#5-영역-3-작가-스튜디오-creator-studio의-하드코딩-및-db-불일치)
6. [[영역 4] 관리자 관제탑 (Admin CMS)의 하드코딩 및 DB 불일치](#6-영역-4-관리자-관제탑-admin-cms의-하드코딩-및-db-불일치)
7. [[영역 5] 인증 및 보안(Auth/RBAC) 하드코딩 백도어](#7-영역-5-인증-및-보안authrbac-하드코딩-백도어)
8. [단계별 해결 및 정규화 조치 권장사항](#8-단계별-해결-및-정규화-조치-권장사항)

---

## 1. 종합 진단 요약

본 조사는 `public/index.html`, `public/js/core/*.js`, `public/js/reader/*.js`, `public/js/creator/*.js`, `public/js/admin/*.js`, `public/supabase-admin.js`, `public/app.js`, `public/dataset_30_works.json` 및 실제 연결된 **Supabase PostgreSQL Cloud DB (`ghwabesnydktumeyejnm.supabase.co`)**를 대상으로 전수 교차 검증을 수행하였습니다.

### 🔴 핵심 발견 사항 (Key Findings)
1. **DB 실제 데이터와 다른 더미 데이터셋 우선 로드**:
   - Supabase DB의 `works` 테이블 1번 작품은 `"폭풍의 여왕 서약"`이나, 프론트엔드 시드(`SAMPLE_WORKS`) 및 로컬 JSON(`dataset_30_works.json`)에는 `"대적자: 신을 삼킨 기사"`로 하드코딩되어 있어 초기 렌더링 시 제목 및 정보가 상이함.
2. **관리자 CMS 16대 메뉴 중 7개 메뉴가 100% 정적 HTML 하드코딩**:
   - `심사(review)`, `신고(comments)`, `광고관리(admgmt)`, `팬미팅(fanmeeting)`, `굿즈(goods)`, `이벤트(events)`, `보안감사로그(security)`가 DB 조회 없이 정적 HTML에 박힌 더미 텍스트를 노출하며, 버튼 클릭 시 토스트 메시지만 띄우는 가짜 인터랙션으로 동작함.
3. **DB 레코드 존재에도 불구하고 쿼리 실패로 더미 폴백 노출**:
   - `comments` 테이블에 실제 22건의 댓글이 저장되어 있으나 모두 `episode_id`가 `null`로 저장되어 있어, 프론트엔드의 `eq('episode_id', epNum)` 쿼리가 0건을 반환함. 결과적으로 코드에 하드코딩된 데모 댓글 3건(`demo-c1` 달빛독자, `demo-c2` 무협매니아, `demo-c3` 소설러버)이 강제로 표시됨.
   - `reports` 테이블에 8건의 신고 데이터가 있으나 관리자 신고 탭은 DB를 조회하지 않고 정적 HTML 1건("스포일러 신고 5건")만 표시함.
4. **0건 데이터에 대한 가상 수치 하드코딩 표시**:
   - `author_earnings` 테이블이 0건임에도 작가 스튜디오에는 `₩3,842,000`(당월), `₩3,210,000`(확정), `₩2,850,000`(출금가능)이 하드코딩되어 표시됨.
   - `fan_meetings` 및 `goods` 테이블이 0건임에도 관리자 화면에는 팬미팅(신청 420명), 굿즈 2종(장패드, 아크릴 스탠드)이 실제 운영 중인 것처럼 노출됨.
5. **독자 활동 데이터의 DB 미반영 (LocalStorage 독자 생태계)**:
   - Supabase의 `reading_history`, `favorites`, `author_subscriptions` 테이블이 모두 **0건**으로 방치되어 있으며, 브라우저 `localStorage`에만 데이터가 저장되어 타 기기 접속 시 동기화가 불가능함.
6. **인증 마스터 백도어 하드코딩**:
   - 관리자 로그인 시 `admin`, `andysung` 계정에 대해 비밀번호 `admin1234`, `!12345` 입력 시 DB 확인 없이 최고관리자 권한을 부여하는 하드코딩이 존재함.

---

## 2. Supabase DB 실제 현황 vs 화면 표시 종합 대조표

| 대상 테이블 | Supabase DB 실제 레코드 수 / 상태 | 화면(UI)에 표시되는 내용 | 일치 여부 | 원인 및 불일치 상세 |
| :--- | :--- | :--- | :---: | :--- |
| **`works`** | 30개 (1번: `"폭풍의 여왕 서약"`, view: 42) | 초기 렌더링 시 `"대적자: 신을 삼킨 기사"` 노출 후 DB 로드 시 변경 | ⚠️ **부분 불일치** | `SAMPLE_WORKS` 및 `dataset_30_works.json`의 1번 작품명이 DB와 다름 |
| **`episodes`** | 180개 (작품당 6회차) | 1~6화 정상 노출 + 7~10화 "연재예정 Coming Soon" 추가 노출 | ⚠️ **더미 추가** | 7~10화는 DB에 없으나 루프(`for epNum 7~10`)로 UI를 강제 생성함 |
| **`episode_contents`** | RLS 차단 / 조회 오류 (`ERROR: undefined`) | 가상 더미 본문 ("주인공은 불길하게 타오르는 붉은 하늘을...") 노출 | ❌ **완전 불일치** | DB 본문 로드 실패 시 `createDefault6Episodes` 가상 텍스트 대체 |
| **`readers`** | 11명 (reader1~reader10 + test1) | 10명 테이블 렌더링 (`SAMPLE_READERS` 시드 10명 기준) | ⚠️ **부분 불일치** | DB에 가입된 11번째 신규 유저(`test1`)가 시드 캐시로 인해 누락될 수 있음 |
| **`authors`** | 30명 | 10명 시드 또는 30명 카드 그리드 | ⚠️ **조건부 불일치** | `SAMPLE_AUTHORS`는 10명만 정의되어 있어 DB 미연결 시 10명만 표시됨 |
| **`comments`** | **22건 존재** (`episode_id: null`) | 데모 댓글 3건 ("달빛독자", "무협매니아", "소설러버") 노출 | ❌ **완전 불일치** | DB 데이터의 `episode_id`가 `null`이어서 쿼리 조건 불일치로 데모 댓글 표시 |
| **`reports`** | **8건 존재** (욕설, 연령등급 확인 등) | 정적 1건 ("스포일러 및 비방 5건 / usr_98124") 노출 | ❌ **완전 불일치** | DB 쿼리 없이 `index.html`에 하드코딩된 정적 태그만 노출됨 |
| **`author_earnings`** | **0건** (수익 데이터 없음) | 당월 `₩3,842,000`, 확정 `₩3,210,000`, 출금 `₩2,850,000` | ❌ **완전 불일치** | DB에 데이터가 없어 코드 내 기본 하드코딩 변수값이 그대로 노출됨 |
| **`author_settlements`** | 16건 존재 (PAID 및 PENDING) | 16건 테이블 또는 정산 대기열 렌더링 | 🟡 **일치 (연동됨)** | `fetchPendingSettlements` 및 실시간 구독 연동 완료 |
| **`revenue_events`** | **4건 존재** (2026-05 ~ 2026-08) | 상단 4대 카드 및 월별 통계 | 🟡 **일치 (연동됨)** | DB 4건 조회 성공 시 정상 반영되나, 실패 시 하드코딩 폴백 작동 |
| **`reading_history`** | **0건** (DB 적재 없음) | 최근 읽은 작품 히어로 카드 및 내 서재 이어보기 정상 표시 | ❌ **저장소 불일치** | DB가 아닌 브라우저 `localStorage`에서만 읽고 씀 |
| **`favorites`** | **0건** (DB 적재 없음) | 내 서재 관심 작품 정상 표시 | ❌ **저장소 불일치** | DB가 아닌 브라우저 `localStorage`에서만 읽고 씀 |
| **`author_subscriptions`** | **0건** (DB 적재 없음) | 내 서재 구독 작가 정상 표시 | ❌ **저장소 불일치** | DB가 아닌 브라우저 `localStorage`에서만 읽고 씀 |
| **`fan_meetings`** | **0건** | "판타지마스터 온라인 팬미팅 (신청 420명 / 모집중)" 노출 | ❌ **완전 불일치** | DB 조회 기능 자체가 없고 `index.html`에 100% 하드코딩됨 |
| **`goods`** | **0건** | "마법사 장패드 ₩25,000", "아크릴 스탠드 ₩18,000" 노출 | ❌ **완전 불일치** | DB 조회 기능 자체가 없고 `index.html`에 100% 하드코딩됨 |
| **`ad_units`** | 테이블 미사용 / 0건 | 동영상 광고 ECPM ₩15,000 / 띠배너 CPC ₩350 노출 | ❌ **완전 불일치** | DB 조회 기능 자체가 없고 `index.html`에 100% 하드코딩됨 |
| **`platform_stats`** | 1건 (광고조회수: `54,200회`) | HTML 초기 렌더링 시 광고조회수 `0회` 노출 | ⚠️ **초기값 불일치** | JS가 비동기로 DB를 읽어오기 전까지 정적 HTML의 `0회` 노출 |
| **`point_accounts`** | 0건 (또는 미연동) | 독자 포인트 `1,000P` 기본 노출 | ❌ **저장소 불일치** | DB 대신 `localStorage('webnovels_user_points') || '1000'` 사용 |
| **`audit_logs`** | 0건 (또는 미연동) | 관리자 접속 로그 3건 (admin, subadmin_1 로그인 등) 노출 | ❌ **완전 불일치** | DB 조회 없이 HTML `securityAuditLogBody`에 3건 하드코딩 |

---

## 3. [영역 1] 전역 시드 및 Mock 상태 관리

### 1) `SAMPLE_WORKS` (10개 작품 하드코딩)
- **위치**: `public/js/core/state.js` (Line 31 ~ Line 178)
- **하드코딩 내용**:
  - 1번~8번 웹소설, 9번~10번 웹툰 메타데이터 전 항목 하드코딩.
  - 임의의 조회수 부여: 1번(42회), 2번(38회), 3번(29회), 4번(35회), 5번(18회), 6번(24회), 7번(12회), 8번(31회), 9번(26회), 10번(22회).
  - 1번 작품 제목이 `"대적자: 신을 삼킨 기사"`로 되어 있으나, 실제 Supabase DB 1번 레코드는 `"폭풍의 여왕 서약"`임.

### 2) `createDefault6Episodes` (가상 회차 텍스트 본문)
- **위치**: `public/js/core/state.js` (Line 17 ~ Line 26)
- **하드코딩 내용**:
  - 모든 소설 작품에 대해 1~6화 회차 본문을 동일한 더미 텍스트로 생성:
    - 1화: `"주인공은 불길하게 타오르는 붉은 하늘을 바라보며 검 자루를 쥐었다..."`
    - 2화: `"폐허가 된 고대 성채에서 미지의 봉인이 풀렸다..."`
    - 3화: `"동료들과 함께 나선 첫 번째 원정길..."`
    - 4화: `"💡 광고를 시청하여 성공적으로 해금된 4회차 본문입니다. 적들의 숨겨진 요새에..."`
    - 5화: `"💡 광고를 시청하여 성공적으로 해금된 5회차 본문입니다. 위기의 순간, 주인공의 가슴 속에서..."`
    - 6화: `"💡 광고를 시청하여 성공적으로 해금된 6회차 본문입니다. 마침내 모습을 드러낸 거대한 흑막..."`
  - 1~3화는 `isFree: true, isAdFree: false`, 4~6화는 `isFree: false, isAdFree: true` 강제 지정.

### 3) `SAMPLE_READERS` (10명 독자 시드)
- **위치**: `public/js/core/state.js` (Line 192 ~ Line 203)
- **하드코딩 내용**:
  - `reader1` ~ `reader10` 계정명, 비밀번호 해시 `!12345`, 가상 전화번호(`+82-010-111-1111` ~ `1120`), 구독등급(`일반 회원`, `프리미엄 구독중`) 하드코딩.

### 4) `SAMPLE_AUTHORS` (10명 작가 시드)
- **위치**: `public/js/core/state.js` (Line 208 ~ Line 219)
- **하드코딩 내용**:
  - `writer1` ~ `writer10`, 필명(`판타지마스터`, `무협의신`, `나이트로즈` 등), 가상 생년월일, 가상 주소, 가상 계좌번호(`국민은행 999-888-777666`, `신한은행 110-222-333444` 등) 하드코딩.
  - DB의 실제 등록 작가 수는 30명인데 반해 시드에는 10명만 존재함.

### 5) `COMMENTS_STORE` (가상 독자 댓글)
- **위치**: `public/js/core/state.js` (Line 181 ~ Line 187)
- **하드코딩 내용**:
  - 키 `"1-1"`에 `c1`("새벽독자", 좋아요 14), `c2`("판타지러버", 좋아요 8), `c3`("웹소마스터", 좋아요 5) 댓글 하드코딩.

### 6) 독자 기본 보유 포인트
- **위치**: `public/js/core/state.js` (Line 234)
- **하드코딩 내용**:
  - `let userPoints = parseInt(localStorage.getItem('webnovels_user_points') || '1000', 10);`
  - DB의 `point_accounts` 테이블과 연동되지 않고 기본값 1,000P를 로컬스토리지에서 임의 관리.

---

## 4. [영역 2] 독자 서비스 (Reader Domain)의 하드코딩 및 DB 불일치

### 1) 작품 상세 및 회차 목록 (`openWorkDetailDirect`)
- **위치**: `public/js/reader/reader.js` (Line 834 ~ Line 917)
- **불일치 상세**:
  - DB에서 작품을 단건 조회하지 않고 메모리의 `SAMPLE_WORKS` 배열에서 탐색 (`SAMPLE_WORKS.find(...) || SAMPLE_WORKS[0]`).
  - **7~10화 연재예정 루프 하드코딩**:
    ```javascript
    for (let epNum = comingSoonStart; epNum <= comingSoonEnd; epNum++) {
      // 7~10화 "🔒 연재예정 Coming Soon" 카드 강제 삽입
    }
    ```
    실제 DB의 에피소드 테이블에는 6화까지만 존재함에도 7~10화가 화면에 고정 노출되며, 클릭 시 "작가 연재 예정 상태입니다" 토스트만 출력됨.

### 2) 회차 댓글 시스템 (`loadEpisodeComments`)
- **위치**: `public/js/reader/reader.js` (Line 2051 ~ Line 2091)
- **불일치 상세**:
  - Supabase `comments` 테이블 조회가 실패하거나 0건일 때 아래 데모 댓글 3건을 화면에 강제 노출:
    - `demo-c1`: 달빛독자 - *"주인공 검술 묘사가 너무 생생하고 박진감 넘치네요!"* (좋아요 14)
    - `demo-c2`: 무협매니아 - *"맞아요, 특히 마지막 검기 폭발 장면은 역대급 연출이었습니다."* (좋아요 5)
    - `demo-c3`: 소설러버 - *"광고 보고 바로 5화까지 정주행 완료했습니다."* (좋아요 21)
  - **DB와의 결정적 불일치 원인**: Supabase DB에 실제로 들어있는 22건의 댓글 레코드는 모두 `episode_id` 컬럼이 `null`로 입력되어 있음. 프론트엔드는 `workId`와 `episodeId`로 필터링(`eq('episode_id', episodeId)`)하므로 항상 0건이 반환되어 이 데모 댓글만 화면에 영구적으로 표시됨.

### 3) 독자 보관함/내 서재 (`renderLibraryContent`)
- **위치**: `public/js/reader/reader.js` (Line 578 ~ Line 790)
- **불일치 상세**:
  - Supabase DB의 `reading_history`, `favorites`, `author_subscriptions` 테이블 레코드 수가 모두 **0건**임.
  - 화면에 표시되는 읽는 중(이어보기), 관심 작품, 구독 작가는 100% 브라우저의 `localStorage` (`webnovels_reading_history`, `webnovels_favorites`, `webnovels_subscribed_authors`) 데이터만 화면에 렌더링됨.

### 4) 작가 연재작 모달 (`openAuthorWorksDirect`)
- **위치**: `public/js/reader/reader.js` (Line 524 ~ Line 576)
- **하드코딩 내용**:
  - 작가 필명으로 매칭되는 작품이 없으면 무조건 1번 작품(`SAMPLE_WORKS[0]`)을 배열에 강제 추가하여 화면에 표시함:
    ```javascript
    if (worksToShow.length === 0) {
      const defaultWork = SAMPLE_WORKS.find(w => Number(w.id) === 1) || SAMPLE_WORKS[0];
      worksToShow.push(defaultWork);
    }
    ```

### 5) 뷰어 하단 추천 작품 (`renderReaderRecommendations`)
- **위치**: `public/js/reader/reader.js` (Line 1096 ~ Line 1103)
- **하드코딩 내용**:
  - 실제 추천 알고리즘이나 DB 쿼리 없이 `SAMPLE_WORKS`에서 현재 작품 id를 제외한 상위 4개를 잘라(`slice(0, 4)`) 고정 표시함.

---

## 5. [영역 3] 작가 스튜디오 (Creator Studio)의 하드코딩 및 DB 불일치

### 1) 작가 세션 및 프로필 기본값
- **위치**: `public/js/creator/creator.js` (Line 80 ~ Line 98)
- **하드코딩 내용**:
  - 로그인 세션이 없으면 무조건 `SAMPLE_AUTHORS[0]` (`writer1`, 판타지마스터)로 자동 강제 로그인 처리.
  - 정산 계좌 기본값: `국민은행 999-888-777666` 하드코딩.

### 2) 4대 실시간 수익 지표 (`loadCreatorStudioEarnings`)
- **위치**: `public/js/creator/creator.js` (Line 596 ~ Line 624)
- **불일치 상세**:
  - Supabase DB의 `author_earnings` 테이블 레코드가 현재 **0건**임.
  - DB 레코드가 없을 경우 함수 초기에 선언된 더미 수치가 화면의 4대 KPI 카드에 그대로 노출됨:
    - `todayEarnings` (일간 수익): **₩128,400**
    - `monthEarnings` (당월 추정 수익): **₩3,842,000**
    - `confirmedEarnings` (확정 정산금): **₩3,210,000**
    - `payableEarnings` (출금 가능액): **₩2,850,000**

### 3) 정산 출금 신청 금액 파싱 실패 시 폴백
- **위치**: `public/js/creator/creator.js` (Line 539)
- **하드코딩 내용**:
  - 출금 가능액 DOM 엘리먼트에서 금액 추출 실패 시 기본값 **₩980,000**으로 하드코딩.

### 4) AI 자동 검수 엔진
- **위치**: `public/js/creator/creator.js` (Line 480 ~ Line 485)
- **하드코딩 내용**:
  - AI 모델(Gemini) 호출이나 유해성 검사 API 대신 단순 문자열 길이 5자 미만 체크(`content.length < 5`)로만 시뮬레이션함.

---

## 6. [영역 4] 관리자 관제탑 (Admin CMS)의 하드코딩 및 DB 불일치

### 1) 대시보드 오늘의 콘텐츠 운영 관제 (Today Operations Strip)
- **위치**: `public/index.html` (Line 866 ~ Line 887)
- **하드코딩 내용**:
  - 오늘 발행 예정: `<div id="kpiTodayScheduled">30건</div>` (고정)
  - 정상 자동 발행 완료: `<div id="kpiTodayPublished">27건</div>` (고정)
  - 확인 필요: `<div id="kpiTodayActionReq">3건 ⚠️</div>` (고정)
  - DB에 오늘의 스케줄 현황을 집계하는 테이블이나 쿼리가 전혀 없으며 순수 HTML 텍스트로 노출됨.

### 2) 콘텐츠 타입별 실시간 DB 연재 현황
- **위치**: `public/index.html` (Line 889 ~ Line 919)
- **하드코딩 내용**:
  - 웹소설(NOVEL): `20작품` / `120 에피소드 (텍스트)` (고정)
  - 웹툰(WEBTOON): `10작품` / `60 에피소드 (컷 이미지)` (고정)
  - 정상 연재중: `25작품` (고정)
  - 완결 작품: `5작품` (고정)
  - 실제 DB `works` 테이블에는 웹소설과 웹툰이 혼재되어 있으나 고정된 HTML 텍스트가 초기값으로 박혀 있음.

### 3) 대시보드 5대 KPI 초기값 불일치
- **위치**: `public/index.html` (Line 940 ~ Line 966)
- **불일치 상세**:
  - 광고 조회수 엘리먼트 `<div id="kpiTotalAdViews">0회</div>`: 실제 Supabase DB `platform_stats` 테이블에는 `total_ad_views: 54200`으로 5.4만 회가 기록되어 있으나, HTML에는 `0회`로 하드코딩되어 있음.

### 4) 콘텐츠 심사 메뉴 (`adminTab-review`)
- **위치**: `public/index.html` (Line 1348 ~ Line 1367)
- **하드코딩 내용**:
  ```html
  <strong>[신규 연재 신청] 무림 대공의 환생 (작가: 검신)</strong>
  <div class="text-muted small">신청일: 2026-08-12 | 장르: 무협</div>
  ```
  - DB의 `content_reviews` 테이블과 전혀 연동되지 않고 정적 텍스트로 박혀 있음.
  - [승인], [반려] 버튼 클릭 시 DB UPDATE 없이 단순히 `showToast('작품 연재가 승인되었습니다.')` 알림만 발생함.

### 5) 댓글 / 신고 메뉴 (`adminTab-comments`)
- **위치**: `public/index.html` (Line 1370 ~ Line 1386)
- **불일치 상세**:
  - 실제 Supabase DB의 `reports` 테이블에는 **8건의 실제 신고 데이터**(욕설, 성인물 등)가 들어있음.
  - 그러나 화면에는 아래 정적 1건만 하드코딩되어 있음:
    ```html
    <strong>신고 사유: 부적절한 스포일러 및 비방 (신고 5건)</strong>
    <div class="text-muted small">댓글: "100화에서 주인공 죽습니다 ㅋㅋ" | 작성자: usr_98124</div>
    ```
  - [블라인드 처리] 버튼 클릭 시 실제 DB의 `comments.is_blocked` 플래그를 업데이트하지 않고 `showToast`만 실행됨.

### 6) 광고 플랫폼 관리 (`adminTab-admgmt`)
- **위치**: `public/index.html` (Line 1389 ~ Line 1410)
- **하드코딩 내용**:
  - `📺 회차 종료 후 동영상 광고`: 평균 ECPM ₩15,000 / 일 평균 노출 120,000회
  - `🖼️ 홈 메인 띠 배너 광고`: 평균 CPC ₩350 / 일 평균 클릭 8,500회
  - DB `ad_units` 테이블과 연동되지 않고 수치가 고정 박혀 있음.

### 7) 수익배분 Engine 입력 폼 (`adminTab-revenue`)
- **위치**: `public/index.html` (Line 1421 ~ Line 1452)
- **하드코딩 내용**:
  - 귀속월: `2026-08`
  - 광고 총매출: `10000000` (1천만 원)
  - 플랫폼 수수료: `2000000` (2백만 원)
  - 작가 Pool 배분비율: `0.625` (62.5%)

### 8) 팬미팅 관리 (`adminTab-fanmeeting`)
- **위치**: `public/index.html` (Line 1474 ~ Line 1492)
- **불일치 상세**:
  - Supabase DB `fan_meetings` 테이블은 **0건**임.
  - 화면에는 아래 내용이 정적으로 고정 노출됨:
    ```html
    <strong>[8월] 판타지마스터 작가 100만뷰 기념 온라인 팬미팅</strong>
    <div class="text-muted small">일시: 2026-08-25 19:00 | 정원: 500명 (신청 420명)</div>
    <span class="badge badge-primary">모집중</span>
    ```

### 9) Goods 굿즈 커머스 (`adminTab-goods`)
- **위치**: `public/index.html` (Line 1494 ~ Line 1519)
- **불일치 상세**:
  - Supabase DB `goods`, `goods_orders` 테이블은 **0건**임.
  - 화면에는 아래 2개 상품이 정적으로 고정 노출됨:
    - `차원 이동 마법사 한정판 장패드` (판매가: ₩25,000 | 재고: 150개 | 판매중)
    - `공작가의 비밀 하녀 아크릴 스탠드` (판매가: ₩18,000 | 재고: 80개 | 판매중)

### 10) 이벤트 프로모션 (`adminTab-events`)
- **위치**: `public/index.html` (Line 1521 ~ Line 1538)
- **하드코딩 내용**:
  - `[여름 특별] 신규 가입 3,000 코인 지급 프로모션 (기간: 2026-08-01 ~ 2026-08-31 | 진행중)` 정적 HTML 고정.

### 11) 최근 관리자 접속 보안 감사 로그 (`adminTab-security`)
- **위치**: `public/index.html` (Line 1668 ~ Line 1690)
- **불일치 상세**:
  - DB `audit_logs` 테이블 조회 없이 `securityAuditLogBody`에 3건의 더미 감사 로그가 하드코딩되어 표시됨:
    1. `2026-08-30 15:00` | admin | 최고관리자 로그인 | 127.0.0.1 | 성공
    2. `2026-08-30 14:20` | admin | 정산금 승인 처리 | 127.0.0.1 | 성공
    3. `2026-08-30 13:45` | subadmin_1 | 콘텐츠 검수 승인 | 192.168.1.15 | 성공

### 12) 매출 및 트래픽 통계 (`loadAdminAnalytics`) 폴백 데이터
- **위치**: `public/js/admin/admin.js` (Line 2226 ~ Line 2235)
- **하드코딩 내용**:
  - DB `revenue_events` 조회가 비어있거나 실패할 때 주입되는 4개월치 더미 데이터:
    - 2026-08: 총매출 ₩31,200,000 / 작가풀 ₩17,550,000
    - 2026-07: 총매출 ₩26,400,000 / 작가풀 ₩14,850,000
    - 2026-06: 총매출 ₩22,500,000 / 작가풀 ₩12,656,250
    - 2026-05: 총매출 ₩19,800,000 / 작가풀 ₩11,137,500
  - 장르별 점유율 비중 통계: DB가 아닌 `SAMPLE_WORKS` 전역 배열 30개를 순회하여 장르별 카운트를 계산함 (`Line 2282`).

---

## 7. [영역 5] 인증 및 보안(Auth/RBAC) 하드코딩 백도어

### 1) 최고 관리자 로그인 마스터 백도어
- **위치**: `public/supabase-admin.js` (Line 80 ~ Line 92)
- **위험성 및 내용**:
  ```javascript
  if ((cleanEmail === 'admin' || cleanEmail === 'admin@webnovels.com' || cleanEmail === 'andysung@webnovels.com') && (cleanPw === 'admin1234' || cleanPw === '!12345')) {
    currentAdmin = {
      id: 'admin-super-root',
      username: cleanEmail.split('@')[0],
      email: cleanEmail.includes('@') ? cleanEmail : `${cleanEmail}@webnovels.com`,
      nickname: cleanEmail.includes('andysung') ? '앤디성 (최고관리자)' : '최고관리자 (Super Admin)',
      role: 'SUPER_ADMIN',
      permissions: ['DASHBOARD', 'USER_MGMT', 'AUTHOR_MGMT', 'WORK_MGMT', 'EPISODE_MGMT', 'CONTENT_REVIEW', 'COMMENT_REPORT', 'AD_MGMT', 'AD_REVENUE', 'AUTHOR_SETTLEMENT', 'FAN_MEETING', 'GOODS_MGMT', 'EVENT_MGMT', 'ANALYTICS', 'SYSTEM_MGMT', 'SECURITY_MGMT']
    };
    return { success: true, admin: currentAdmin };
  }
  ```
  - DB `admin_users` 테이블에 계정이 존재하지 않거나 비밀번호가 다르더라도, 위 조건에 일치하면 DB 조회를 우회하고 모든 권한(16개)을 가진 슈퍼 관리자로 즉시 통과시킴.

### 2) 독자 및 작가 로그인 마스터 비밀번호
- **위치**: `public/supabase-admin.js` (Line 142, Line 184)
- **위험성 및 내용**:
  ```javascript
  if (reader.password_hash === cleanPw || reader.password_hash === `!${cleanPw}` || cleanPw === '!12345') {
    return { success: true, reader };
  }
  ```
  - 입력 비밀번호가 `!12345`일 경우 DB의 해시 검증을 무시하고 어떤 독자/작가 계정이든 즉시 로그인 승인 처리됨.

---

## 8. 단계별 해결 및 정규화 조치 권장사항

| 단계 | 작업 영역 | 구체적 조치 방안 |
| :---: | :--- | :--- |
| **Phase 1** | **DB 스키마 및 외래키 정합성 복구** | 1. `comments` 테이블의 `episode_id`가 `null`인 22개 레코드에 대해 실제 `episodes.id` 매핑 업데이트 (`UPDATE comments SET episode_id = ...`)<br>2. `episode_contents` 테이블의 RLS 정책 점검 및 anon SELECT 권한 허용 또는 RPC 함수 복구 |
| **Phase 2** | **관리자 7대 정적 탭 동적 렌더러 전환** | 1. `adminTab-comments`: Supabase `reports` 테이블 8건을 조회하여 동적 테이블 렌더링 (`loadAdminReports()`) 및 블라인드 RPC 연결<br>2. `adminTab-review`: `content_reviews` 테이블 조회 및 실제 승인/반려 UPDATE 로직 구현<br>3. `adminTab-security`: `audit_logs` 테이블 실시간 SELECT 및 바인딩<br>4. `fanmeeting`, `goods`, `events`: DB에 실데이터 INSERT하거나 "등록된 내역이 없습니다" Empty State UI로 변경 |
| **Phase 3** | **독자 활동 데이터 영구 동기화 (Dual Persistence 완성)** | 1. 독서 진행률, 관심작품, 구독작가를 LocalStorage뿐만 아니라 Supabase `reading_history`, `favorites`, `author_subscriptions` 테이블에 실시간 INSERT/UPSERT<br>2. 로그인 시 DB에서 우선 복원하여 로컬에 머지하도록 동기화 파이프라인 완성 |
| **Phase 4** | **작가 스튜디오 수익 지표 실데이터 연동** | 1. `author_earnings` 테이블에 월별/일별 정산 집계 데이터 생성 및 연동<br>2. `loadCreatorStudioEarnings`의 4대 하드코딩 기본값(`384만 원` 등)을 제거하고 실제 DB 합산값 또는 0원 표출 |
| **Phase 5** | **보안 취약점 및 하드코딩 백도어 제거** | 1. `supabase-admin.js`의 `admin1234`, `!12345` 우회 로그인 분기 전면 삭제<br>2. Supabase Auth 또는 Bcrypt 해시 검증을 통한 표준 인증 체계로 일원화 |
| **Phase 6** | **시드 데이터 및 정적 JSON 의존성 축소** | 1. `SAMPLE_WORKS`, `SAMPLE_READERS`, `SAMPLE_AUTHORS`를 단순 비상용 Fallback으로 격하<br>2. `dataset_30_works.json`의 1번 작품명을 DB와 동일한 `"폭풍의 여왕 서약"`으로 일치화하거나 Supabase 직접 조회를 기본 SSOT로 고정 |

---
*본 보고서는 시스템 아키텍처 가이드라인(`gemini.md`) 및 데이터베이스 명세서(`database.md`, `WebNovels_Production_v1.sql`)와의 전수 비교를 통해 작성되었습니다.*
