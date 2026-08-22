# 광고 기반 웹소설·웹툰 플랫폼 Front-end Design System & Implementation Specification

> **File:** `design.md`\
> **Version:** 2.0.0 (CDG PLAY & 3-User Role Edition)\
> **Date:** 2026-08-22\
> **Target:** Vanilla Modern Web (HTML5/CSS3/ES6+ SPA) + Supabase Backend + Responsive PWA\
> **Design Direction:** Comme des Garçons Play ("CDG PLAY") Dark Luxury & Iconic Pink (`#FF2A7A`) / 3-User Architecture (Reader, Creator, Admin) / Rewarded-Ad & Point Unlock / Hybrid Webtoon-Novel Reader

------------------------------------------------------------------------

## 0. Document Purpose

본 문서는 광고 기반 웹소설·웹툰 플랫폼의 Front-end 구축 및 고도화를 위한 **실행 가능한 UI/UX 및 Design System 명세서**다.
`service_structure.md`와 `database.md`, `UX.md`에 정의된 3대 사용자(독자·작가·운영자) 체계 및 CDG PLAY 디자인 시스템을 완벽하게 반영하여 정의한다.

-   **3대 사용자 체계:** 독자(Reader), 작가(Author/Creator), 운영자(Admin)
-   **CDG PLAY 디자인 시스템:** Pure White, Deep Black, Iconic Pink (`#FF2A7A`), Soft Pink Accent
-   **정보구조(IA) & 내비게이션:** 상단 헤더, 서브 카테고리 탭 (웹소설|웹툰|장르|랭킹|신작|완결작), 모바일 하단 내비
-   **홈 7대 큐레이션 섹션:** HERO 캐러셀, 실시간 랭킹 Top 4, 신작 4선, 장르별 필터 칩, 인기 웹툰, 완결 명작, 오늘의 무료 혜택
-   **하이브리드 뷰어:** 웹소설 텍스트 뷰어 + 웹툰 세로 스크롤 이미지 뷰어 + 회차 댓글/공감 + 추천작
-   **이중 해금 시스템 (`UX.md`):** `▶ 광고 30초 보고 무료읽기` vs `🪙 100P 포인트로 즉시 열람`
-   **작가센터 7대 메뉴:** 1. 작품관리, 2. 회차등록, 3. 연재관리, 4. 독자통계, 5. 광고수익, 6. 판매수익, 7. 정산관리
-   **운영자 Admin 9대 메뉴:** 회원관리, 작가관리, 작품연재, 회차관리, 콘텐츠심사, 댓글/신고, 광고플랫폼, 수익배분 Engine, 작가정산

------------------------------------------------------------------------

# 1. Product Design Principles

## 1.1 핵심 디자인 원칙

### Principle 01 --- Reading & Viewing First (독서·열람 최우선)
사용자가 플랫폼에 방문하는 가장 중요한 이유는 **웹소설 및 웹툰 열람**이다.
모든 주요 화면은 "사용자가 지금 읽고 싶은 작품을 얼마나 빠르고 쾌적하게 찾고 감상할 수 있는가?"에 집중한다.

핵심 Funnel:
``` text
DISCOVER (홈/탐색/서브탭)
  ↓
WORK DETAIL (작품소개/회차목록/관심등록/작가구독)
  ↓
READ / VIEW (웹소설 텍스트 & 웹툰 세로 스크롤 뷰어)
  ↓
NEXT EPISODE (다음 회차 이동)
  ↓
DUAL UNLOCK (▶ 광고 30초 무료해금 OR 🪙 100P 포인트 즉시해금)
  ↓
READ AGAIN (지속적인 연재 열람)
```

------------------------------------------------------------------------

## 1.2 Principle 02 --- 광고는 방해가 아니라 보상 (`UX.md`)

광고를 일반 강제 팝업 Display Ad처럼 취급하지 않는다.
- **잘못된 UX:** 작품 열람 중 갑작스러운 전면 팝업 광고 → 사용자 이탈
- **권장 UX:** 무료 회차 열람 종료 → "다음 회차를 무료로 읽으시겠습니까?" 모달 팝업 → 사용자의 능동적 선택 (`광고 시청` 또는 `100P 포인트`) → 작가에게 직접 광고수익 배분 및 즉시 해금

------------------------------------------------------------------------

## 1.3 Principle 03 --- Comme des Garçons Play ("CDG PLAY") Aesthetic

플랫폼 전반에 글로벌 패션 하우스 Comme des Garçons Play의 미니멀리즘과 볼드한 아이코닉 핑크 포인트를 적용한다.
- **Base:** Deep Luxury Black (`#0A0A0C`, `#121216`)과 Pure White (`#FFFFFF`)의 극적인 대비
- **Accent:** Iconic CDG Pink (`#FF2A7A`), Soft Pink (`#FF6B9D`)
- **Symbol:** CDG Play Heart SVG Icon
- **Texture:** Glassmorphism (`backdrop-filter: blur(12px)`, `border: 1px solid rgba(255,42,122,0.2)`)

------------------------------------------------------------------------

## 1.4 Principle 04 --- Creator Transparency (3단계 투명 정산)

작가는 플랫폼의 핵심 창작자다. 작가센터에서 다음 3단계 수익 지표를 명확히 구분하여 표출한다.
1. **실시간 예상 수익 (Estimated Revenue):** 당월 조회수/광고발생 기반 실시간 추정치
2. **마감 확정 수익 (Confirmed Revenue):** 창작자 정산풀(62.5%) 공식 마감 확정액
3. **출금 가능 정산금 (Payable Revenue):** 등록 계좌(국민은행 등)로 즉시 출금 신청 가능한 잔액

------------------------------------------------------------------------

# 2. Target Users & 3-User Architecture

## 2.1 독자 (Reader)
- 홈 탐색 (웹소설, 웹툰, 장르, 랭킹, 신작, 완결작, 검색)
- 작품 상세 (시놉시스, 회차 목록, 관심등록, 작가구독)
- 회차 열람 (소설 텍스트 뷰어, 웹툰 세로 스크롤 뷰어)
- 회차별 독자 댓글 작성 및 `❤️ 공감` 토글
- 다음화 해금 (`▶ 광고 보고 무료읽기` 또는 `🪙 100P 포인트 사용`)
- 내 서재 (이어보기 진행률%, 관심 작품, 구독 작가, PASS 성인인증)

## 2.2 작가 (Author / Creator)
- 작가센터 Creator Studio 7대 메뉴:
  1. `작품관리`: 내 연재 웹소설/웹툰 목록 및 신규 작품 등록
  2. `회차등록`: 회차 텍스트 or 웹툰 이미지 URL 등록, 무료/광고 설정
  3. `연재관리`: 연재중 / 휴재 / 완결 상태 관리
  4. `독자통계`: 완독률(%), 평균 체류시간, 총 조회수, 구독 팬 수
  5. `광고수익`: 실시간 예상 광고수익 및 트래픽 분석
  6. `판매수익`: 포인트 회차 판매 현황
  7. `정산관리`: 정산 출금 신청 및 송금 이력

## 2.3 운영자 (Admin / Operator)
- 관제탑 Admin Console 9대 핵심 메뉴:
  1. `회원관리`: 독자 회원 목록, 성인인증 상태, 제재
  2. `작품관리`: 소설/웹툰 분류, 실시간 HOT/인기/신작 토글
  3. `작가관리`: 공식 인증 작가 승인 및 계좌 정보
  4. `콘텐츠 검수`: 신규 작품/회차 심사 및 승인/반려
  5. `광고관리`: 애드네트워크(AdMob 등), eCPM, 슬롯 관리
  6. `결제관리`: 토스페이먼츠 결제 승인/취소 내역
  7. `정산관리`: 작가 출금 신청 승인(PAID) 및 62.5% 마감
  8. `신고/댓글관리`: 스팸/악플 블라인드 및 신고 처리
  9. `통계/Analytics`: 플랫폼 DAU/MAU 및 총매출 KPI

------------------------------------------------------------------------

# 3. Design Tokens (CDG PLAY Aesthetic)

## 3.1 Color Palette

``` css
:root {
  /* CDG PLAY Core Brand Tokens */
  --cdg-white: #FFFFFF;
  --cdg-black: #0A0A0C;
  --cdg-dark-surface: #121216;
  --cdg-dark-card: #18181E;
  
  --cdg-pink: #FF2A7A;           /* Iconic CDG Pink */
  --cdg-pink-hover: #FF4D91;     /* Interactive Hover Pink */
  --cdg-pink-soft: #FF6B9D;      /* Secondary Pink Accent */
  --cdg-pink-glow: rgba(255, 42, 122, 0.35);
  --cdg-pink-border: rgba(255, 42, 122, 0.25);
  --cdg-pink-bg: rgba(255, 42, 122, 0.08);

  /* Functional Status Colors */
  --accent-emerald: #10B981;     /* 무료/성공/승인 */
  --accent-amber: #F59E0B;       /* 출금가능/경고 */
  --accent-rose: #EF4444;        /* 오류/19+ 성인 */
  --accent-cyan: #06B6D4;        /* 웹툰/정보 */
  
  /* Text & Border Tokens */
  --text-primary: #FFFFFF;
  --text-secondary: #9E9EA8;
  --text-muted: #6B6B78;
  --border-color: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 42, 122, 0.4);
}
```

------------------------------------------------------------------------

# 4. Global Navigation Architecture

## 4.1 상단 통합 헤더 (Desktop & Mobile Header)
- **Brand Logo:** CDG Heart SVG 아이콘 + `webnovels` 타이포그래피
- **3대 사용자 퀵 스위처:** `독자 홈` | `작가센터` | `운영자 Admin` | `내 서재`
- **Header Actions:**
  - `🪙 1,000P` 독자 실시간 보유 포인트 뱃지 (클릭 시 마이페이지/충전)
  - `🔍` 작품/작가 실시간 검색 모달 트리거
  - `로그인 / 프로필` 메뉴

## 4.2 서브 카테고리 내비게이션 바 (`cdg-sub-nav`)
독자 홈 상단에 고정되어 스무스 스크롤 및 섹션 필터링을 제공한다.
``` text
┌─────────────────────────────────────────────────────────────┐
│  [웹소설]  [웹툰]  [장르]  [랭킹]  [신작]  [완결작]        │
└─────────────────────────────────────────────────────────────┘
```

## 4.3 모바일 하단 내비게이션 (`mobile-bottom-nav`)
- `홈` (독자 홈 랜딩)
- `탐색` (장르별/카테고리별 전체 작품 탐색)
- `보관함` (내 서재)
- `스튜디오` (작가 전용 스튜디오)
- `MY` (마이페이지 및 설정)

------------------------------------------------------------------------

# 9. Typography

## 9.1 UI Font

한국어 서비스에서는 다음 우선순위를 권장한다.

``` css
font-family:
  "Pretendard",
  "Noto Sans KR",
  system-ui,
  sans-serif;
```

------------------------------------------------------------------------

## 9.2 Reader Font

Reader에서는 사용자 선택 폰트를 지원한다.

기본:

``` text
Pretendard
```

추가 옵션:

``` text
Noto Sans KR
Noto Serif KR
System Sans
System Serif
```

폰트 추가는 라이선스를 확인한 후 적용한다.

------------------------------------------------------------------------

## 9.3 Fluid Typography

``` css
.reader-body {
  font-size: clamp(1rem, 0.95rem + 0.25vw, 1.25rem);
  line-height: 1.7;
}
```

Reader 기본:

-   Font size: 18px
-   Line height: 1.7
-   Letter spacing: 0
-   Paragraph spacing: 1.2em

------------------------------------------------------------------------

# 10. Spacing Scale

8px Grid를 기본으로 한다.

``` text
4
8
12
16
20
24
32
40
48
64
80
96
```

화면 구성요소 사이의 임의 숫자 사용을 최소화한다.

------------------------------------------------------------------------

# 11. Border Radius

``` text
sm: 6px
md: 10px
lg: 14px
xl: 20px
pill: 999px
```

Card:

``` text
mobile: 14px
desktop: 16px
```

------------------------------------------------------------------------

# 12. Shadow

과도한 그림자를 사용하지 않는다.

``` text
shadow-sm
→ 카드

shadow-md
→ Modal

shadow-lg
→ Floating Layer
```

Reader에서는 그림자를 최소화한다.

------------------------------------------------------------------------

# 13. Core Component Library

다음 Component를 공통 UI Library로 만든다.

``` text
Button
IconButton
Badge
Chip
Avatar
Card
WorkCard
AuthorCard
EpisodeRow
Modal
Drawer
BottomSheet
Toast
Tooltip
Tabs
Dropdown
Select
Input
SearchInput
Textarea
Switch
Slider
Progress
Skeleton
EmptyState
ErrorState
Pagination
InfiniteScroll
ConfirmDialog
DatePicker
FileUploader
Chart
```

------------------------------------------------------------------------

# 14. Button System

## Primary

핵심 행동:

-   읽기
-   광고 보고 무료 열람
-   정산 신청
-   저장

``` text
height: 48px
radius: 12px
font-weight: 600
```

------------------------------------------------------------------------

## Secondary

보조 행동:

-   관심등록
-   작가 구독
-   설정

------------------------------------------------------------------------

## Ghost

Reader 설정 및 secondary action.

------------------------------------------------------------------------

## Destructive

삭제/탈퇴/정산 취소 등.

------------------------------------------------------------------------

# 15. Work Card

작품 카드에는 정보 우선순위를 명확하게 한다.

# 15. Work Card (CDG PLAY Aesthetic)

작품 카드에는 CDG PLAY 스타일의 랭킹 뱃지, 신작/무료 뱃지, 장르 태그를 표출한다.

``` text
┌──────────────────────────────┐
│  [TOP 1] [NEW] [19+]  COVER  │
│                              │
├──────────────────────────────┤
│ 장르 뱃지 (판타지/웹툰/무협) │
│ 작품 제목 (Bold 1.05rem)     │
│ 작가명 · 👁️ 154.0K           │
└──────────────────────────────┘
```

-   **Mobile/Desktop:** 가로 스크롤 캐러셀(`cdg-scroll-row`) 및 2~4열 반응형 그리드
-   **Badges:** Top 1~4 랭킹 뱃지 (`.cdg-rank-badge`), NEW 핑크 뱃지, FREE 에메랄드 뱃지, 19+ 성인 뱃지

------------------------------------------------------------------------

# 16. Main Home (7대 큐레이션 섹션)

``` text
Header (LOGO | 포인트 🪙 1,000P | 검색 🔍 | 로그인)
 ↓
Sub Navigation (웹소설 | 웹툰 | 장르 | 랭킹 | 신작 | 완결작)
 ↓
1. HERO 캐러셀 슬라이더 (5초 자동 롤링, 실시간 추천 1~3위)
 ↓
2. 🔥 지금 가장 많이 읽는 작품 (Top 1~4 랭킹 뱃지)
 ↓
3. ✨ 새로운 작품 (NEW 신작 4선)
 ↓
4. 장르별 추천 (로맨스, 판타지, 무협, 현판, SF, 호러, 19+ 성인 실시간 필터 칩)
 ↓
5. 🎨 인기 웹툰 (공식 풀컬러 웹툰 큐레이션)
 ↓
6. 🏆 완결 명작 모음 (완결 작품 큐레이션)
 ↓
7. 🎁 오늘의 무료 작품 (30초 광고 무료 혜택 배너 & 무료 추천작)
```

------------------------------------------------------------------------

# 17. Hybrid Reader & Viewer UX (웹소설 & 웹툰)

## 17.1 하이브리드 열람 지원
- **웹소설 모드 (`content_type: 'NOVEL'`):**
  - 글자 크기 실시간 조절 (14px ~ 26px)
  - 3대 독서 테마: Light (`#FAFAF7`), Dark (`#0A0A0C`), Sepia (`#F3EBDD`)
  - 단락 줄간격 및 가독성 최적화
- **웹툰 모드 (`content_type: 'WEBTOON'`):**
  - 고화질 컷 이미지 세로 연속 스크롤 뷰어 (`.webtoon-viewer-box`, `.webtoon-cut`)
  - 컷 간 여백 최소화 및 모바일 터치 스크롤 최적화

## 17.2 회차별 독자 댓글 및 공감 (`❤️ 공감`)
- 뷰어 하단 실시간 댓글 목록 및 댓글 작성 폼
- 독자 닉네임, 작성 시간, 공감 수 표시 및 원클릭 좋아요 토글

## 17.3 하단 추천 작품 목록
- "이 작품과 함께 많이 본 추천작" 가로 스크롤 카드 그리드

------------------------------------------------------------------------

# 18. Rewarded Ad & Point Unlock Gate (`UX.md`)

4화 이상의 유료/잠긴 회차 진입 시 노출되는 이중 해금 모달 명세:

``` text
┌─────────────────────────────────────────────────────────────┐
│ 🔓 다음 회차를 무료로 읽으시겠습니까?                       │
│ 광고를 시청하면 작가에게 후원되고 회차가 무료 해금되며,     │
│ 보유 포인트를 사용하여 즉시 열람할 수도 있습니다.            │
│                                                             │
│ [▶ 광고 보고 무료읽기 (30초)]                                │
│ [🪙 100P 포인트로 즉시 열람 (보유: 1,000P)]                 │
│ [나중에 보기]                                               │
└─────────────────────────────────────────────────────────────┘
```

-   **옵션 1 (광고 시청):** 30초(시뮬레이션 3초) 보상형 광고 재생 → SSV 검증 → 100% 무료 해금
-   **옵션 2 (포인트 사용):** 보유 포인트에서 100P 차감 → 즉시 해금 및 뷰어 로드

------------------------------------------------------------------------

# 19. Creator Studio (작가센터 7대 메뉴)

``` text
1. 작품관리: 내 연재 웹소설/웹툰 목록 및 신규 작품 등록
2. 회차등록: 회차 텍스트 or 웹툰 이미지 URL 쉼표 등록, 무료/광고 설정
3. 연재관리: 연재중(ONGOING) / 휴재(PAUSED) / 완결(COMPLETED) 상태 관리
4. 독자통계: 완독률(84.5%), 평균 체류시간(4분 32초), 구독 팬 수(1,280명)
5. 광고수익: 실시간 예상 광고수익 (Estimated ₩1,245,000)
6. 판매수익: 당월 포인트 회차 판매수 (3,420회) 및 정산 누적액 (₩342,000)
7. 정산관리: 등록 정산 계좌(국민은행 999-888-777666) 출금 신청 및 송금 이력
```

------------------------------------------------------------------------

# 20. Admin Management Tower (운영자 관제탑 9대 메뉴)

``` text
1. 회원관리: 독자 계정, KCP PASS 성인인증 상태, 제재 관리
2. 작가관리: 공식 인증 작가 승인 및 정산 계좌 확인
3. 작품연재: 웹소설/웹툰 분류, 실시간 HOT/인기/신작 토글
4. 회차관리: 회차별 무료/광고 공개 상태 관리
5. 콘텐츠심사: 신규 작품/회차 심사 및 승인/반려 (Content Review)
6. 댓글/신고: 스팸/욕설 신고 접수 및 블라인드 조치
7. 광고플랫폼: 애드네트워크(AdMob 등), eCPM, 보상형 슬롯 관리
8. 수익배분 Engine: 62.5% 창작자 정산풀 월별 마감 확정 (Confirmed)
9. 작가정산: 출금 신청 건별 입금 승인 처리 (PAID)
```

------------------------------------------------------------------------

# 21. Sticky CTA (Mobile)

Work Detail에서 Mobile 하단에 다음 CTA를 고정한다.

``` text
┌──────────────────────────────┐
│ [♡]       [첫 화 읽기]       │
└──────────────────────────────┘
```

스크롤 시에도 독서 진입점이 유지된다.

------------------------------------------------------------------------

# 26. Reader Architecture

Reader는 일반 페이지와 별도의 Full Screen Layout을 사용한다.

``` text
┌──────────────────────────────┐
│ ← 작품명          ⚙ Aa       │
├──────────────────────────────┤
│                              │
│          25화                 │
│                              │
│ 본문 본문 본문 본문          │
│                              │
│ 본문 본문 본문 본문          │
│                              │
│ 본문 본문 본문 본문          │
│                              │
├──────────────────────────────┤
│  ◀ 이전         다음 ▶       │
└──────────────────────────────┘
```

------------------------------------------------------------------------

# 27. Reader Header

Header는 스크롤 방향에 따라 숨김/표시할 수 있다.

항목:

-   Back
-   Work Title
-   Episode Number
-   Setting
-   Bookmark

Reader Header는 본문을 가리지 않아야 한다.

------------------------------------------------------------------------

# 28. Reader Content

HTML을 그대로 렌더링하지 않고 허용된 콘텐츠 schema를 사용한다.

권장:

``` text
EpisodeContent
 ├─ Paragraph
 ├─ Image
 ├─ Divider
 ├─ Quote
 └─ Annotation
```

XSS 방어를 위해 서버에서 sanitize하고 Front-end에서도 안전한 rendering
layer를 사용한다.

------------------------------------------------------------------------

# 29. Reader Settings

Floating button:

``` text
[Aa]
```

클릭하면 Bottom Sheet 또는 Drawer:

``` text
읽기 설정

테마
○ Light
○ Sepia
○ Dark

글꼴
○ Sans
○ Serif

글자 크기
−  A  +

줄간격
1.5
1.65
1.8
2.0

좌우 여백
좁게 ─────●───── 넓게

읽기 방식
● 스크롤
○ 페이지
```

설정은 즉시 반영한다.

------------------------------------------------------------------------

# 30. Reader Preferences Persistence

Zustand + localStorage를 사용한다.

저장 대상:

``` text
theme
fontFamily
fontSize
lineHeight
letterSpacing
contentWidth
readingMode
```

로그인 사용자는 서버 동기화를 추가할 수 있다.

------------------------------------------------------------------------

# 31. Reader Progress

사용자의 읽기 진행률을 다음 기준으로 계산한다.

``` text
progress =
current_scroll_position /
total_scrollable_height
```

예:

``` text
72%
```

Debounce하여 API 호출 빈도를 제한한다.

예:

``` text
10~20초
또는
5% progress 변화
```

------------------------------------------------------------------------

# 32. Next Episode Prefetch

다음 회차를 무조건 본문까지 다운로드하지 않는다.

조건:

``` text
현재 회차 progress >= 70%
AND
nextEpisode exists
AND
network available
```

이 경우 다음 회차의 metadata 또는 접근 가능한 최소 데이터만
prefetch한다.

잠긴 회차는 본문을 선취득하지 않는다.

------------------------------------------------------------------------

# 33. Browser Cache

TanStack Query를 활용한다.

권장:

``` text
Work Detail
staleTime: 1~5 min

Episode List
staleTime: 1~5 min

Reader Content
staleTime: session-level

User Profile
staleTime: 5~10 min
```

실제 값은 트래픽과 API 특성에 따라 조정한다.

------------------------------------------------------------------------

# 34. Rewarded Ad Unlock UX

## 핵심 Flow

``` text
Episode Click
 ↓
Access Check
 ↓
Locked
 ↓
Unlock Bottom Sheet
 ↓
User Consent
 ↓
Ad Loading
 ↓
Ad Playing
 ↓
Ad Completed
 ↓
Server Verification
 ↓
Unlock Success
 ↓
Next Episode Reader
```

------------------------------------------------------------------------

# 35. Unlock Modal

``` text
┌──────────────────────────────┐
│                              │
│          🔓                  │
│                              │
│       다음 편을 무료로       │
│          읽어보세요           │
│                              │
│  광고를 시청하면 다음        │
│  회차를 무료로 해금할 수     │
│  있습니다.                   │
│                              │
│     약 30초                   │
│                              │
│ [ 광고 보고 무료 열람 ]       │
│                              │
│ [ 나중에 보기 ]               │
└──────────────────────────────┘
```

광고 시간은 실제 Ad SDK가 제공하는 값과 일치시킨다.

고정적으로 "30초"라고 표시할 경우 실제 광고 포맷과 불일치하지 않도록
한다.

------------------------------------------------------------------------

# 36. Ad Progress State

상태:

``` text
idle
loading
ready
playing
completed
verifying
unlocked
failed
```

UI:

``` text
광고 준비 중...
광고 시청 중...
보상을 확인하고 있습니다...
해금 완료!
```

------------------------------------------------------------------------

# 37. Ad Failure UX

광고 서버 오류가 발생해도 사용자가 원인을 이해할 수 있어야 한다.

``` text
광고를 불러오지 못했습니다.

잠시 후 다시 시도해주세요.

[ 다시 시도 ]
[ 이전으로 ]
```

절대 다음과 같이 표시하지 않는다.

``` text
Error 500
Ad SDK Error Code 7
```

기술 오류는 사용자에게 노출하지 않는다.

------------------------------------------------------------------------

# 38. Ad Verification

Front-end는 광고 완료만 믿으면 안 된다.

``` text
Ad SDK
 ↓
Ad Completion
 ↓
Backend Verification
 ↓
Unlock
```

Front-end 상태:

``` text
completed
```

Backend 승인 후:

``` text
verified
```

로 변경한다.

------------------------------------------------------------------------

# 39. Creator Studio IA

``` text
Creator Studio
│
├── Dashboard
├── Works
│   ├── All Works
│   ├── Draft
│   ├── Published
│   └── Completed
│
├── Episodes
├── Analytics
├── Revenue
├── Settlements
└── Settings
```

------------------------------------------------------------------------

# 40. Creator Dashboard

Top KPI:

``` text
┌──────────────┬──────────────┬──────────────┐
│ 예상 수익    │ 확정 수익    │ 정산 가능액  │
│ ₩1,240,000   │ ₩980,000     │ ₩820,000     │
└──────────────┴──────────────┴──────────────┘
```

각 카드에는 설명 Tooltip을 제공한다.

------------------------------------------------------------------------

# 41. Creator Analytics

Chart:

``` text
조회수
│          ╭──╮
│      ╭───╯  ╰──╮
│  ╭───╯         ╰──
└────────────────────
  1  5  10  15  20
```

Filter:

-   일간
-   주간
-   월간
-   작품별
-   회차별

------------------------------------------------------------------------

# 42. Creator Revenue

수익 화면:

``` text
수익 현황

예상 수익
₩1,240,000

확정 수익
₩980,000

정산 가능
₩820,000

[정산 신청]
```

하단:

``` text
수익 내역
────────────────────
8/11 광고수익       ₩42,000
8/10 광고수익       ₩38,000
8/09 광고수익       ₩51,000
```

------------------------------------------------------------------------

# 43. Settlement UX

정산 신청은 Wizard 형태로 만든다.

``` text
① 계좌 확인
   ↓
② 본인/세무정보 확인
   ↓
③ 정산금액 확인
   ↓
④ 신청
   ↓
⑤ 완료
```

각 단계의 상태를 명확히 표시한다.

------------------------------------------------------------------------

# 44. Creator Work Editor

작품 등록:

``` text
작품 정보
├─ Cover
├─ Title
├─ Description
├─ Genre
├─ Tags
├─ Rating
└─ Serialization
```

자동 저장을 지원한다.

------------------------------------------------------------------------

# 45. Episode Editor

``` text
Episode #26

제목
[________________]

본문
┌──────────────────────────────┐
│                              │
│      Editor Area             │
│                              │
└──────────────────────────────┘

공개 설정
○ 즉시 공개
○ 예약 공개

접근 정책
○ 무료
○ 광고 Unlock
○ Premium
```

Draft 자동 저장을 권장한다.

------------------------------------------------------------------------

# 46. Cover Upload

Drag & Drop:

``` text
┌──────────────────────────────┐
│                              │
│       Cover Upload           │
│                              │
│ 파일을 끌어다 놓거나         │
│ 클릭해서 업로드              │
│                              │
└──────────────────────────────┘
```

검증:

-   파일 타입
-   파일 크기
-   이미지 크기
-   악성 파일
-   서버 업로드 완료 여부

------------------------------------------------------------------------

# 47. My Page

``` text
MY
│
├─ 프로필
├─ 이어보기
├─ 관심 작품
├─ 구독 작가
├─ 댓글
├─ 광고 시청 이력
├─ 구매 내역
├─ 알림
└─ 설정
```

------------------------------------------------------------------------

# 48. Library

Tabs:

``` text
이어보기 | 관심 작품 | 구독 작가
```

Work Card에:

-   최근 회차
-   진행률
-   마지막 읽은 시간
-   새 회차 여부

를 표시한다.

------------------------------------------------------------------------

# 49. Adult Content UX

성인 콘텐츠는 명확한 Gate를 제공한다.

``` text
┌──────────────────────────────┐
│          19+                 │
│                              │
│ 이 작품은 성인 인증이        │
│ 필요한 콘텐츠입니다.        │
│                              │
│ [성인 인증하기]              │
│ [돌아가기]                   │
└──────────────────────────────┘
```

인증되지 않은 사용자는 작품 본문이나 민감한 Preview를 볼 수 없도록 한다.

------------------------------------------------------------------------

# 50. Login / Signup

최소 정보 원칙:

``` text
Email
ID
Password
Nickname
```

성인 콘텐츠 이용 시 별도의 성인 인증 절차.

Social Login은 추후 확장 가능하도록 Auth abstraction을 둔다.

------------------------------------------------------------------------

# 51. Toast / Feedback

사용자 행동 결과를 즉시 알려준다.

예:

``` text
✓ 관심 작품에 저장했습니다.
✓ 작가를 구독했습니다.
✓ 회차가 해금되었습니다.
✓ 댓글이 등록되었습니다.
```

Toast는 화면 하단 또는 상단에 일관되게 배치한다.

------------------------------------------------------------------------

# 52. Loading UX

페이지 전체 Spinner보다 Skeleton을 우선한다.

Work Card:

``` text
┌─────────────┐
│ ███████████ │
│ ███████     │
│ █████████   │
│ ████        │
└─────────────┘
```

Reader에서는 본문 Skeleton보다 최소 Loader를 사용해 독서 지연감을
줄인다.

------------------------------------------------------------------------

# 53. Empty State

예:

``` text
아직 관심 등록한 작품이 없습니다.

새로운 작품을 찾아볼까요?

[작품 둘러보기]
```

Empty State에는 다음 행동을 하나 제공한다.

------------------------------------------------------------------------

# 54. Error State

``` text
문제가 발생했습니다.

잠시 후 다시 시도해주세요.

[다시 시도]
```

개발자용 상세 Error는 로그 시스템으로 보낸다.

------------------------------------------------------------------------

# 55. Offline UX

PWA가 오프라인 상태가 되면:

``` text
현재 오프라인 상태입니다.

저장된 콘텐츠는 계속 읽을 수 있습니다.
```

단, 서버 검증이 필요한 기능은 오프라인에서 허용하지 않는다.

예:

-   광고 Reward
-   Unlock
-   정산 신청
-   결제
-   계좌 변경

------------------------------------------------------------------------

# 56. PWA

## manifest

필수:

``` json
{
  "name": "Web Novel Platform",
  "short_name": "Novel",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "브랜드 컬러",
  "background_color": "#FFFFFF"
}
```

실제 manifest에서는 아이콘, scope, orientation 등을 추가한다.

------------------------------------------------------------------------

# 57. Service Worker Strategy

``` text
Static Asset
→ Cache First

Image
→ Cache First / Stale While Revalidate

API
→ Network First

Reader Content
→ Network First + controlled cache

Unlock / Revenue / Payment
→ Network Only
```

민감한 콘텐츠는 무분별하게 Service Worker cache에 저장하지 않는다.

------------------------------------------------------------------------

# 58. IndexedDB

저장 가능 데이터:

-   Reader preferences
-   최근 읽은 회차 metadata
-   제한된 오프라인 reader cache
-   draft
-   UI state

저장하지 않는 것:

-   Password
-   Access Token
-   정산정보
-   민감한 개인정보
-   광고 Reward 검증 데이터

------------------------------------------------------------------------

# 59. Web Push

Push Permission은 첫 방문 즉시 요청하지 않는다.

권장 Trigger:

``` text
작가 구독
 ↓
"새 회차 알림을 받을까요?"
 ↓
User Consent
 ↓
Browser Permission
```

Notification 예:

``` text
[작품명] 27화가 업데이트되었습니다.
지금 읽어보세요.
```

------------------------------------------------------------------------

# 60. Accessibility

WCAG AA를 기본 목표로 한다.

## 필수

-   Keyboard navigation
-   Focus visible
-   Semantic HTML
-   ARIA label
-   Screen Reader
-   Color contrast
-   Reduced motion
-   Touch target 최소 44px 권장

------------------------------------------------------------------------

# 61. Reader Accessibility

``` html
<article
  role="article"
  aria-label="소설 본문"
>
```

본문 단락은 의미 있는 HTML 구조를 사용한다.

설정 버튼:

``` html
<button
  aria-label="읽기 설정"
>
```

------------------------------------------------------------------------

# 62. Reduced Motion

사용자가 OS에서 motion reduction을 활성화하면 다음을 최소화한다.

-   Page transition
-   Carousel animation
-   Bottom Sheet animation
-   Skeleton shimmer

CSS:

``` css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

------------------------------------------------------------------------

# 63. SEO

SEO 대상:

-   Home
-   Work Detail
-   Author
-   Genre
-   Ranking

CSR 중심으로 처리할 대상:

-   My Page
-   Creator Studio
-   Account
-   Settlement

Work Detail Metadata:

``` text
title
description
og:title
og:description
og:image
canonical
```

구조화 데이터 적용을 검토한다.

------------------------------------------------------------------------

# 64. Next.js Rendering Strategy

권장:

``` text
Home
→ SSR / ISR

Work Detail
→ SSR / ISR

Author
→ SSR / ISR

Genre
→ SSR / ISR

Ranking
→ ISR + client refresh

Reader
→ Server rendered shell + client interaction

My
→ CSR

Creator
→ CSR
```

------------------------------------------------------------------------

# 65. State Management

## TanStack Query

Server State:

``` text
works
episodes
user
author
comments
reading history
revenue
settlement
notifications
```

------------------------------------------------------------------------

## Zustand

Client State:

``` text
reader preferences
modal state
drawer state
ad UI state
temporary editor state
navigation state
```

서버 데이터를 Zustand에 복제하지 않는다.

------------------------------------------------------------------------

# 66. API Layer

API Client를 Component에서 직접 호출하지 않는다.

권장:

``` text
Component
 ↓
Hook
 ↓
Service
 ↓
API Client
 ↓
Backend
```

예:

``` text
useWork()
useEpisodes()
useReader()
useUnlock()
useCreatorRevenue()
```

------------------------------------------------------------------------

# 67. Front-end Folder Structure

``` text
src/
├── app/
│   ├── (public)/
│   ├── (reader)/
│   ├── (auth)/
│   ├── (my)/
│   └── (creator)/
│
├── components/
│   ├── ui/
│   ├── work/
│   ├── reader/
│   ├── ad/
│   ├── creator/
│   ├── my/
│   └── layout/
│
├── features/
│   ├── auth/
│   ├── works/
│   ├── episodes/
│   ├── reader/
│   ├── unlock/
│   ├── creator/
│   └── settlement/
│
├── hooks/
├── services/
├── stores/
├── lib/
├── types/
├── constants/
├── styles/
└── public/
```

------------------------------------------------------------------------

# 68. Component Naming

PascalCase:

``` text
WorkCard
EpisodeList
ReaderToolbar
UnlockModal
RevenueCard
SettlementStepper
```

Hook:

``` text
useWork
useEpisode
useReaderPreferences
useUnlockEpisode
useCreatorRevenue
```

API:

``` text
getWork
getEpisodes
createUnlock
getRevenue
```

------------------------------------------------------------------------

# 69. Component Architecture

Component를 지나치게 크게 만들지 않는다.

잘못된 예:

``` text
WorkPage.tsx
→ 1,500 lines
```

권장:

``` text
WorkPage
 ├─ WorkHero
 ├─ WorkMeta
 ├─ WorkActions
 ├─ EpisodeList
 ├─ CommentSection
 └─ RelatedWorks
```

------------------------------------------------------------------------

# 70. Analytics Event Specification

핵심 Event:

``` text
page_view
work_view
episode_view
episode_start
episode_complete

favorite_add
favorite_remove

author_follow
author_unfollow

ad_unlock_open
ad_unlock_accept
ad_start
ad_complete
ad_verify_success
ad_verify_failed

episode_unlock

comment_create
comment_like

creator_dashboard_view
revenue_view
settlement_request
```

------------------------------------------------------------------------

# 71. Event Properties

모든 Event에 공통:

``` text
event_name
user_id
anonymous_id
session_id
timestamp
page
device
platform
```

Content Event:

``` text
work_id
episode_id
author_id
```

Ad Event:

``` text
ad_session_id
placement_id
```

------------------------------------------------------------------------

# 72. Conversion Funnel

핵심 Funnel을 Analytics로 측정한다.

``` text
Episode Locked
 ↓
Unlock Modal Open
 ↓
Accept
 ↓
Ad Start
 ↓
Ad Complete
 ↓
Server Verify
 ↓
Episode Unlock
 ↓
Next Episode View
```

핵심 KPI:

``` text
Modal → Accept
Accept → Ad Start
Ad Start → Complete
Complete → Verify
Verify → Read
```

------------------------------------------------------------------------

# 73. Performance Budget

Mobile 환경을 최우선으로 한다.

목표:

-   LCP \< 2.5s
-   INP \< 200ms
-   CLS \< 0.1

추가 원칙:

-   이미지 WebP/AVIF
-   Responsive Image
-   Lazy Loading
-   Code Splitting
-   Route Prefetch
-   Font Optimization
-   Third-party script 최소화

------------------------------------------------------------------------

# 74. Image Strategy

Next.js Image를 사용한다.

``` text
Cover
→ responsive sizes

Hero
→ priority loading

Below Fold
→ lazy

Avatar
→ optimized thumbnail
```

원본 이미지를 그대로 브라우저에 전달하지 않는다.

------------------------------------------------------------------------

# 75. Advertisement Performance

광고 SDK는 초기 페이지 로딩을 방해하지 않아야 한다.

원칙:

``` text
User Intent
 ↓
Ad SDK 준비
 ↓
Rewarded Ad Load
```

가능하면 일반 홈 화면의 초기 JS bundle에 광고 SDK 전체를 포함하지 않고
필요 시점에 lazy load한다.

------------------------------------------------------------------------

# 76. Security Rules

Front-end에서 보안을 완성한다고 생각하지 않는다.

다음은 Backend에서 최종 검증:

-   로그인
-   성인인증
-   Episode access
-   Ad reward
-   Unlock
-   Settlement
-   Payment

Front-end는 UX layer다.

------------------------------------------------------------------------

# 77. Sensitive Data Rules

브라우저에 저장하지 않는다.

``` text
Password
Bank Account
Adult Verification Raw Data
Settlement Sensitive Data
Payment Secret
Admin Secret
```

Access Token도 가능하면 HttpOnly Secure Cookie 기반 인증을 우선
검토한다.

------------------------------------------------------------------------

# 78. Error Boundary

Route 단위 Error Boundary:

``` text
HomeError
WorkError
ReaderError
CreatorError
```

Reader 오류가 발생해도 전체 애플리케이션을 종료시키지 않는다.

------------------------------------------------------------------------

# 79. Reader Failure Recovery

Reader API 실패:

``` text
본문을 불러오지 못했습니다.

[다시 시도]
```

Network 재연결 시 자동 재시도한다.

단, 광고 Reward와 Unlock은 자동으로 재실행하지 않는다.

------------------------------------------------------------------------

# 80. Creator Auto Save

Editor에서는:

``` text
입력
 ↓
Local Draft
 ↓
Debounce
 ↓
Server Draft Save
```

상태 표시:

``` text
저장 중...
저장 완료
저장 실패
```

------------------------------------------------------------------------

# 81. Draft Conflict

작가가 여러 Device에서 같은 작품을 편집할 수 있으므로 version을
관리한다.

``` text
content_version
updated_at
```

충돌 발생:

``` text
다른 기기에서 변경된 내용이 있습니다.

[최신 내용 확인]
[내 내용 유지]
```

------------------------------------------------------------------------

# 82. Mobile Creator UX

작가의 주 사용환경이 PC라고 가정하지 않는다.

Mobile에서:

-   KPI
-   작품 상태
-   최근 회차
-   수익
-   알림

을 빠르게 확인할 수 있어야 한다.

긴 Editor 작업은 Desktop을 권장하되 Mobile에서도 최소 기능은 제공한다.

------------------------------------------------------------------------

# 83. Commerce UX

향후 팬미팅/굿즈 확장:

``` text
Author
 ↓
Fan Event
 ↓
Event Detail
 ↓
Ticket Purchase
 ↓
Payment
 ↓
My Orders
```

Work/Author 화면에서 팬덤 Commerce로 자연스럽게 연결한다.

------------------------------------------------------------------------

# 84. Design System Documentation

Storybook을 구축한다.

Stories:

``` text
Button
Card
Modal
BottomSheet
WorkCard
EpisodeRow
ReaderToolbar
UnlockModal
RevenueCard
Chart
```

모든 Component는 다음 상태를 Story로 갖는다.

``` text
Default
Hover
Focus
Disabled
Loading
Error
Empty
Mobile
Desktop
Dark
```

------------------------------------------------------------------------

# 85. Testing

## Unit Test

대상:

-   formatter
-   revenue display
-   progress calculation
-   reader settings
-   validation

------------------------------------------------------------------------

## Component Test

대상:

-   UnlockModal
-   EpisodeList
-   WorkCard
-   CreatorRevenueCard

------------------------------------------------------------------------

## E2E

핵심 Scenario:

### Reader

``` text
Login
→ Work
→ Episode
→ Locked
→ Unlock
→ Ad
→ Verify
→ Next Episode
```

### Creator

``` text
Login
→ Dashboard
→ Work
→ Episode
→ Revenue
→ Settlement
```

------------------------------------------------------------------------

# 86. QA Acceptance Criteria

## Reader

-   [ ] 첫 화면에서 작품 탐색 가능
-   [ ] 작품 상세에서 첫 화 진입 가능
-   [ ] 회차 상태가 정확히 표시됨
-   [ ] Reader 설정이 즉시 반영됨
-   [ ] 뒤로가기/앞으로가기 정상
-   [ ] 다음 회차 이동 정상
-   [ ] 광고 Unlock 정상
-   [ ] 광고 완료 후 서버 검증 상태 반영
-   [ ] Unlock 실패 시 중복 Reward 없음

## Creator

-   [ ] 예상/확정/정산 가능 금액 구분
-   [ ] 작품별 통계 확인
-   [ ] 회차 등록
-   [ ] 예약 발행
-   [ ] 정산 신청
-   [ ] 정산 상태 확인

## PWA

-   [ ] manifest 정상
-   [ ] install 가능
-   [ ] offline shell 동작
-   [ ] push permission UX 정상

------------------------------------------------------------------------

# 87. Recommended Screen Inventory

MVP 기준:

``` text
01 Splash
02 Home
03 Discover
04 Search
05 Search Result
06 Ranking
07 Genre
08 Work Detail
09 Episode List
10 Reader
11 Reader Settings
12 Ad Unlock
13 Ad Playing
14 Unlock Complete
15 Login
16 Signup
17 Adult Verification
18 My Page
19 Library
20 Reading History
21 Following
22 Notifications
23 Creator Dashboard
24 Creator Works
25 Work Editor
26 Episode Editor
27 Creator Analytics
28 Creator Revenue
29 Settlement
30 Creator Settings
```

약 30개 핵심 화면으로 MVP를 구성한다.

------------------------------------------------------------------------

# 88. UI Priority

개발 우선순위:

## P0 --- 반드시 완성

``` text
Home
Work Detail
Episode List
Reader
Ad Unlock
Login
My Library
Creator Dashboard
Creator Revenue
Settlement
```

## P1

``` text
Search
Ranking
Comments
Notifications
Creator Analytics
Work Editor
Episode Editor
```

## P2

``` text
AI Recommendation
Fan Meeting
Goods
Advanced Community
```

------------------------------------------------------------------------

# 89. Design Review Checklist

개발 전 모든 화면에 대해 확인한다.

### UX

-   [ ] 핵심 CTA가 하나인가?
-   [ ] 사용자가 다음 행동을 알 수 있는가?
-   [ ] 광고가 강제로 느껴지지 않는가?
-   [ ] Reader에서 콘텐츠가 가장 중요한가?

### UI

-   [ ] Design Token 사용
-   [ ] 모바일 우선
-   [ ] Touch target 44px 이상
-   [ ] Contrast AA
-   [ ] Loading/Empty/Error 정의

### Performance

-   [ ] 이미지 최적화
-   [ ] Lazy loading
-   [ ] Code splitting
-   [ ] Third-party script 검토

------------------------------------------------------------------------

# 90. Final Design System Rule

본 플랫폼의 UI는 다음 우선순위를 절대적으로 따른다.

``` text
CONTENT
  >
READING EXPERIENCE
  >
USER ACTION
  >
ADVERTISEMENT
  >
DECORATION
```

광고가 콘텐츠보다 앞에 오지 않는다.

또한:

``` text
Reader Trust
      ↓
Longer Reading Time
      ↓
More Episode Consumption
      ↓
More Rewarded Ad Opportunities
      ↓
More Creator Revenue
      ↓
More Creator Content
      ↓
More Reader Choice
```

이 선순환을 Front-end UX의 핵심 목표로 삼는다.

------------------------------------------------------------------------

# 91. Implementation Definition of Done

Front-end Feature는 다음 조건을 모두 충족해야 완료로 본다.

-   UI 구현 완료
-   Mobile Responsive 완료
-   Desktop Responsive 완료
-   Loading State 완료
-   Empty State 완료
-   Error State 완료
-   Accessibility 완료
-   Analytics Event 연결
-   API Error Handling 완료
-   Unit/Component Test 완료
-   E2E 핵심 Scenario 완료
-   Lighthouse 성능 검토
-   SEO Metadata 검토
-   Storybook Component 등록
-   Code Review 완료

------------------------------------------------------------------------

# 92. 최종 Architecture

``` text
                        NEXT.JS APP
                             │
              ┌──────────────┴──────────────┐
              │                             │
           PUBLIC                         PRIVATE
              │                             │
        SSR / ISR                         CSR
              │                             │
      ┌───────┴────────┐          ┌─────────┴─────────┐
      │                │          │                   │
   Discovery         Reader    My Page          Creator Studio
      │                │          │                   │
      └────────────────┼──────────┴───────────────────┘
                       │
                 TanStack Query
                       │
                     API
                       │
              ┌────────┴────────┐
              │                 │
          Backend API       Auth API
              │                 │
              └────────┬────────┘
                       │
                 Revenue / Ad
                       │
                   Analytics
```

------------------------------------------------------------------------

# 93. Final Product UX Flow

전체 서비스의 가장 중요한 Flow는 다음과 같다.

``` text
                DISCOVERY
                    │
                    ▼
             ┌─────────────┐
             │ Work Detail │
             └──────┬──────┘
                    │
                    ▼
                Episode 1
                    │
                    ▼
                  READ
                    │
                    ▼
              Episode 2
                    │
             ┌──────┴──────┐
             │             │
          FREE          LOCKED
                           │
                           ▼
                  Rewarded Ad UX
                           │
                    User Consent
                           │
                           ▼
                     Watch Ad
                           │
                           ▼
                  Server Verify
                           │
                           ▼
                       Unlock
                           │
                           ▼
                   Next Episode
                           │
                           ▼
                       READ
                           │
                           ▼
                    FAN / FOLLOW
                           │
                           ▼
                    CREATOR VALUE
                           │
                           ▼
                  REVENUE / PAYOUT
```

이 Flow가 Front-end 전체 설계의 중심이 되어야 한다.

------------------------------------------------------------------------

# 94. Development Handoff

디자인/개발 착수 시 다음 파일 구조를 권장한다.

``` text
/docs
├── design.md
├── information-architecture.md
├── user-flow.md
├── api-spec.md
├── analytics-events.md
├── accessibility.md
└── qa-checklist.md

/src
├── app
├── components
├── features
├── hooks
├── services
├── stores
├── types
└── styles
```

`design.md`는 UI/UX의 Single Source of Truth로 사용하고, API/DB의 상세
사양은 별도 문서로 분리한다.

------------------------------------------------------------------------

# 95. Conclusion

이 플랫폼의 Front-end는 일반적인 웹소설 사이트가 아니라 **"무료 독서 →
광고 보상 → 회차 Unlock → 지속 독서 → 작가 수익"**이라는 새로운 사용자
경험을 중심으로 설계되어야 한다.

따라서 가장 중요한 화면은 다음 세 가지다.

1.  **Reader**
2.  **Rewarded Ad Unlock**
3.  **Creator Revenue Dashboard**

이 세 화면의 완성도가 플랫폼 전체의 UX와 사업성을 결정한다.

특히 광고는 콘텐츠를 방해하는 요소가 아니라 사용자가 직접 선택하는
**"무료 열람을 위한 교환 가치"**로 인식되어야 하며, 작가에게는 광고
시청과 자신의 수익 사이의 연결이 명확하게 보여야 한다.

최종 디자인 목표는 다음과 같다.

``` text
Reader
"쉽게 찾고, 편하게 읽고, 다음 편을 기다린다."

Creator
"내 작품이 얼마나 읽혔고, 얼마를 벌었는지 바로 안다."

Platform
"독자의 만족과 작가의 수익이 함께 성장한다."
```
