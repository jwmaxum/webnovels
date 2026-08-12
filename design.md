# 광고 기반 웹소설 플랫폼 Front-end Design System & Implementation Specification

> **File:** `design.md`\
> **Version:** 1.0.0\
> **Date:** 2026-08-12\
> **Target:** Next.js + React + TypeScript + Tailwind CSS + Radix UI +
> TanStack Query + Zustand + PWA\
> **Design Direction:** Mobile-First / Reading-First / Rewarded-Ad /
> Creator Transparency

------------------------------------------------------------------------

## 0. Document Purpose

본 문서는 광고 기반 웹소설 플랫폼의 Front-end 구축을 위한 **실행 가능한
UI/UX 및 Design System 명세서**다.

단순한 화면 목록이 아니라 다음 항목을 개발자가 바로 구현할 수 있도록
정의한다.

-   정보구조(IA)
-   사용자 흐름(User Flow)
-   화면 구조
-   디자인 토큰
-   반응형 Breakpoint
-   Typography
-   Component 규칙
-   Reader UX
-   Rewarded Ad UX
-   Creator Studio
-   My Page
-   PWA
-   접근성
-   상태 관리
-   API 연동 원칙
-   Loading / Empty / Error 상태
-   Analytics Event
-   SEO
-   성능 최적화
-   Front-end 폴더 구조
-   개발 우선순위
-   QA Acceptance Criteria

------------------------------------------------------------------------

# 1. Product Design Principles

## 1.1 핵심 디자인 원칙

### Principle 01 --- Reading First

사용자가 플랫폼에 방문하는 가장 중요한 이유는 **읽기**다.

모든 주요 화면은 다음 질문에 답해야 한다.

> "사용자가 지금 읽고 싶은 작품을 얼마나 빨리 찾고 읽을 수 있는가?"

핵심 Funnel:

``` text
DISCOVER
  ↓
WORK DETAIL
  ↓
READ
  ↓
NEXT EPISODE
  ↓
AD UNLOCK
  ↓
READ AGAIN
```

------------------------------------------------------------------------

## 1.2 Principle 02 --- 광고는 방해가 아니라 보상

광고를 일반 Display Ad처럼 취급하지 않는다.

잘못된 UX:

``` text
작품 열람
 ↓
갑작스러운 팝업 광고
 ↓
광고 닫기
 ↓
본문 읽기
```

권장 UX:

``` text
무료 회차 읽기
 ↓
다음 회차 잠김
 ↓
"광고 보고 무료로 읽기"
 ↓
사용자 선택
 ↓
광고 시청
 ↓
해금
 ↓
즉시 다음 회차
```

광고는 **User Intent 이후에만** 발생한다.

------------------------------------------------------------------------

## 1.3 Principle 03 --- Reader Control

사용자는 다음을 스스로 선택할 수 있어야 한다.

-   광고를 볼지 여부
-   글자 크기
-   줄간격
-   배경 테마
-   페이지/스크롤 방식
-   알림 수신 여부
-   작품 관심등록
-   작가 구독

------------------------------------------------------------------------

## 1.4 Principle 04 --- Creator Transparency

작가는 플랫폼의 가장 중요한 공급자다.

Creator Studio에서 다음 세 가지를 항상 명확하게 구분한다.

``` text
예상 수익
Estimated Revenue

확정 수익
Confirmed Revenue

정산 가능 금액
Payable Revenue
```

이 세 금액을 하나의 숫자로 합치지 않는다.

------------------------------------------------------------------------

# 2. Target Users

## 2.1 Reader

주요 행동:

-   작품 탐색
-   작품 검색
-   회차 읽기
-   광고 시청
-   회차 Unlock
-   관심등록
-   작가 구독
-   댓글
-   팬미팅/굿즈 구매

------------------------------------------------------------------------

## 2.2 Creator

주요 행동:

-   작가 등록
-   작품 등록
-   회차 작성
-   예약 발행
-   독자 통계 확인
-   광고 수익 확인
-   정산 신청
-   팬미팅/커머스 관리

------------------------------------------------------------------------

## 2.3 Admin

관리자는 별도의 Admin Web App으로 분리한다.

Reader/Creator Front-end와 디자인 토큰은 공유할 수 있지만 인증과
Routing은 분리한다.

------------------------------------------------------------------------

# 3. Information Architecture

``` text
/
├── home
├── discover
│   ├── ranking
│   ├── latest
│   ├── genres
│   └── recommendations
│
├── search
│
├── works
│   └── [workId]
│       ├── episodes
│       ├── comments
│       └── author
│
├── reader
│   └── [workId]
│       └── [episodeId]
│
├── author
│   └── [authorId]
│
├── my
│   ├── library
│   ├── history
│   ├── following
│   ├── comments
│   ├── ad-history
│   ├── orders
│   └── settings
│
├── creator
│   ├── dashboard
│   ├── works
│   ├── works/new
│   ├── works/[workId]
│   ├── episodes
│   ├── analytics
│   ├── revenue
│   ├── settlements
│   └── settings
│
├── auth
│   ├── login
│   ├── signup
│   ├── verify-email
│   └── adult-verification
│
└── legal
    ├── terms
    ├── privacy
    └── content-policy
```

------------------------------------------------------------------------

# 4. Global Navigation

## 4.1 Mobile Navigation

Mobile에서는 Bottom Navigation을 기본으로 한다.

``` text
┌──────────────────────────────┐
│ Logo                  Search  │
├──────────────────────────────┤
│                              │
│        PAGE CONTENT          │
│                              │
├──────────────────────────────┤
│  홈   탐색   보관함   알림   MY │
└──────────────────────────────┘
```

Bottom Navigation:

1.  홈
2.  탐색
3.  보관함
4.  알림
5.  MY

Creator 모드에서는 별도 Creator Navigation을 사용한다.

------------------------------------------------------------------------

## 4.2 Desktop Navigation

``` text
┌──────────────────────────────────────────────────────────┐
│ LOGO   홈   탐색   랭킹   장르                 검색  MY  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                    CONTENT                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 5. Responsive Breakpoints

Tailwind 기준:

  Name        Width Target
  ------ ---------- ------------------
  xs       \< 640px small mobile
  sm          640px mobile landscape
  md          768px tablet
  lg         1024px tablet/desktop
  xl         1280px desktop
  2xl        1536px large desktop

기본 개발 기준:

``` text
Mobile First
↓
640
↓
768
↓
1024
↓
1280
```

------------------------------------------------------------------------

# 6. Layout Grid

## Mobile

-   화면 좌우 padding: 16px
-   Section gap: 28\~40px
-   Card gap: 12px
-   Bottom navigation 높이: 64px 이상

## Tablet

-   좌우 padding: 24px
-   최대 콘텐츠 폭: 960px

## Desktop

-   최대 콘텐츠 폭: 1200\~1280px
-   Reader 최대 본문 폭: 720\~780px

------------------------------------------------------------------------

# 7. Design Tokens

## 7.1 Color

브랜드 컬러는 특정 색에 종속되지 않도록 CSS Variable로 관리한다.

``` css
:root {
  --color-brand-primary: #6D5EF5;
  --color-brand-secondary: #8B7CF6;

  --color-bg-primary: #FFFFFF;
  --color-bg-secondary: #F7F7FA;
  --color-bg-tertiary: #F0F0F4;

  --color-text-primary: #17171A;
  --color-text-secondary: #66666F;
  --color-text-tertiary: #9999A3;

  --color-border: #E6E6EB;

  --color-success: #18A566;
  --color-warning: #E6A100;
  --color-error: #D64545;
  --color-info: #3B82F6;
}
```

실제 브랜드 컬러 확정 후 Token만 변경한다.

------------------------------------------------------------------------

# 8. Reader Theme Tokens

Reader는 일반 UI와 독립적인 Theme System을 사용한다.

## Light

``` css
--reader-bg: #FAFAF7;
--reader-text: #242424;
--reader-muted: #777777;
```

## Dark

``` css
--reader-bg: #111111;
--reader-text: #EAEAEA;
--reader-muted: #9B9B9B;
```

## Sepia

``` css
--reader-bg: #F3EBDD;
--reader-text: #40372F;
--reader-muted: #817468;
```

Reader Theme은 CSS Variable로 전환한다.

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

``` text
┌──────────────────────┐
│                      │
│      COVER           │
│                      │
├──────────────────────┤
│ 작품 제목            │
│ 작가명               │
│ 장르 · 태그          │
│ ★ 4.8   조회 12.4K   │
│ [무료] [광고 Unlock] │
└──────────────────────┘
```

Mobile에서는 2열 Grid를 기본으로 한다.

Desktop에서는 4\~6열을 상황에 따라 사용한다.

------------------------------------------------------------------------

# 16. Main Home

## Screen Structure

``` text
Header
 ↓
Hero
 ↓
Continue Reading
 ↓
Today's Updates
 ↓
Trending
 ↓
Ad Unlock Recommended
 ↓
Genre Recommendation
 ↓
Native Ad
 ↓
Popular Authors
 ↓
Footer
```

------------------------------------------------------------------------

## 16.1 Hero

Hero는 단순 배너가 아니라 작품 상세로 이동하는 CTA를 포함한다.

필수 요소:

-   Cover/Key Visual
-   작품명
-   한 줄 소개
-   장르
-   CTA
-   Pagination indicator

Mobile에서는 Hero 높이를 과도하게 키우지 않는다.

------------------------------------------------------------------------

# 17. Continue Reading

로그인 사용자에게 가장 중요한 개인화 영역.

``` text
이어보기
────────────────────
[Cover] 작품 A
       23화 읽는 중
       ███████░░ 72%
       [계속 읽기]
```

독서 진행률은 Episode 단위로 표시한다.

------------------------------------------------------------------------

# 18. Today's Updates

오늘 업데이트된 작품을 시간순 또는 개인화 기준으로 보여준다.

Filter:

``` text
전체
월
화
수
목
금
토
일
```

------------------------------------------------------------------------

# 19. Ranking

Ranking 화면:

``` text
1위  작품 A
2위  작품 B
3위  작품 C
...
```

Ranking 기준:

-   실시간 인기
-   일간
-   주간
-   월간
-   급상승

Ranking Algorithm은 UI와 분리한다.

------------------------------------------------------------------------

# 20. Discover

탐색 화면은 검색보다 **발견**을 강조한다.

``` text
탐색
│
├─ 장르
├─ 인기
├─ 신규
├─ 완결
├─ 무료
├─ 광고로 무료
└─ 추천
```

------------------------------------------------------------------------

# 21. Search

검색 UX:

``` text
[ 🔍 작품명, 작가명을 검색하세요 ]
```

검색 결과 Filter:

-   작품
-   작가
-   장르
-   태그

검색 결과는 입력 즉시 무리하게 API를 호출하지 않고 debounce를 적용한다.

권장:

``` text
300~400ms debounce
```

------------------------------------------------------------------------

# 22. Work Detail Page

구조:

``` text
Header
 ↓
Hero Work Info
 ↓
CTA
 ↓
Description
 ↓
Author
 ↓
Tags
 ↓
Episode List
 ↓
Comments
 ↓
Related Works
```

------------------------------------------------------------------------

# 23. Work Hero

Mobile:

``` text
┌──────────────────────┐
│       COVER          │
│                      │
│ 작품명               │
│ 작가명               │
│ ★ 4.8               │
│ 로맨스 · 현대        │
│                      │
│ [이어 읽기]          │
│ [♡ 관심] [작가 구독] │
└──────────────────────┘
```

Desktop에서는 Cover와 Description을 2-column으로 배치한다.

------------------------------------------------------------------------

# 24. Episode List

각 Episode는 다음 상태를 표시한다.

``` text
FREE
READ
LOCKED
AD_UNLOCK_AVAILABLE
UNLOCKED
UPCOMING
```

예:

``` text
24화 새로운 시작
어제 18:00
[읽음]

25화 흔들리는 마음
오늘 18:00
[무료]

26화 뜻밖의 만남
[광고로 무료 열람]

27화 새로운 사건
[잠김]
```

------------------------------------------------------------------------

# 25. Sticky CTA

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
