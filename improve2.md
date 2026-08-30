# [Step 2] Header, Navigation & Home 큐레이션 모바일 UI/UX 고도화

> **목표:** 모바일 환경에서 한 손 조작이 편안하도록 상단 헤더, 서브 카테고리 스티키 탭 바, 하단 바텀 내비게이션 및 홈 7대 큐레이션 카드의 비주얼과 인터랙션을 CDG PLAY 감성으로 완성한다.

---

## 1. 주요 작업 내용

### 1.1. 모바일 상단 헤더 & 검색 UI
- **CDG Play Heart Logo**: SVG 핑크 심볼 + 모던 굵은 레터링(`webnovels`) 배치
- **실시간 포인트 뱃지**: `🪙 1,000P` 캡슐형 뱃지, 은은한 핑크 글로우 효과
- **검색 바 & 모달**: 원터치 전체 화면 검색 오버레이, 최근 검색어 칩, 실시간 자동완성

### 1.2. 서브 카테고리 스티키 탭 바 (`웹소설` | `웹툰` | `장르` | `랭킹` | `신작` | `완결작`)
- **가로 스크롤 칩 (Horizontal Snap Scroll)**: 끊김 없는 부드러운 스크롤, 스크롤바 숨김(`scrollbar-width: none`)
- **Active Indicator**: 선택된 탭 아래 볼드한 CDG 핑크 언더라인(`height: 3px`, `border-radius: 2px`)

### 1.3. 하단 바텀 내비게이션 바 (Mobile Bottom Bar)
- **높이**: `60px` + `env(safe-area-inset-bottom)`
- **메뉴 구성**: 홈 (`home`), 웹툰/소설 탐색 (`compass`), 내 서재 (`book-marked`), 작가센터 (`feather`), 마이/관리 (`user`)
- **Active State**: 핑크 아이콘 점등 + 미세 햅틱/바운스 애니메이션

### 1.4. 홈 7대 큐레이션 카드 그리드 & 랭킹 리스트
- **HERO 캐러셀 배너**: `16:9` 또는 `4:3` 모바일 풀 와이드 종횡비, 그라디언트 오버레이와 핑크 뱃지
- **작품 표지 카드**: 표준 `3:4` 종횡비(`aspect-ratio: 3/4`), `border-radius: 12px`, 호버/터치 확대 효과
- **실시간 랭킹 Top 4**: 1~4위 볼드 랭킹 넘버링(핑크 그라데이션) + 한 줄 소개 + 조회수/좋아요 뱃지
- **장르 필터 칩**: 모바일 가로 칩 리스트 (전체, 판타지, 무협, 로맨스, SF, 현대, 공포)

---

## 2. 변경 대상 파일
- [`public/index.html`](file:///D:/Antigravity/webnovels/public/index.html): 헤더/바텀 내비/홈 마크업 구조 정돈
- [`public/styles.css`](file:///D:/Antigravity/webnovels/public/styles.css): 헤더, 서브탭, 바텀바, 홈 카드 스타일 고도화
- [`public/app.js`](file:///D:/Antigravity/webnovels/public/app.js): 홈 탭 전환 및 캐러셀 터치 스와이프 연동

---

## 3. 검증 방법
- 모바일 뷰포트에서 스티키 서브탭 스크롤, 바텀 내비 탭 전환, 카드 레이아웃 검증
- `npx tsc --noEmit`
