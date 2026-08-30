# [Step 3] Hybrid Reader 뷰어 & Dual Unlock 모바일 인터랙션 고도화

> **목표:** 웹소설(텍스트)과 웹툰(세로 스크롤)을 매끄럽게 지원하는 하이브리드 리더 뷰어의 모바일 독서 몰입도를 극대화하고, 보상형 광고 vs 포인트 이중 해금 바텀 시트(Bottom Sheet) 모달 및 댓글 UI를 현대화한다.

---

## 1. 주요 작업 내용

### 1.1. 웹소설(Novel) 모바일 텍스트 뷰어 가독성 최적화
- **타이포그래피**: `Noto Serif KR` 기반 정갈한 서체, 본문 기본 `18px`, 행간 `1.85`, 문단 간격 `1.2rem`
- **화면 좌우 여백 (Gutter)**: 모바일 `20px` (글자가 화면 가장자리에 닿지 않도록 편안한 여백 확보)
- **퀵 설정 바텀 시트**: 폰트 크기 조절 (14px ~ 24px), 배경 테마 (다크 `#0A0A0C`, 웜 세피아 `#1C1917`, 라이트 `#F8F9FA`), 줄간격 조절
- **상하단 플로팅 컨트롤 바**: 스크롤 시 자동 숨김 / 화면 탭 시 부드럽게 등장 (Autohide Controls)

### 1.2. 웹툰(Webtoon) 모바일 무여백 세로 스크롤 뷰어
- **Zero-Gutter Vertical Image Flow**: 가로 여백 없이 모바일 화면 폭을 100% 채우는 고화질 컷 이미지 연속 렌더링
- **이미지 로딩 플레이스홀더 & 에러 방어**: 지연 로딩(`loading="lazy"`), 스켈레톤 UI, 로드 실패 시 재시도 버튼

### 1.3. 이중 해금 (Dual Unlock) 모바일 바텀 시트 모달
- **Bottom Sheet Drawer**: 화면 하단에서 슬라이드업되는 모던 바텀 시트 애니메이션
- **선택지 1 (광고 해금)**: `▶ 광고 30초 시청하고 무료로 읽기` (CDG 핑크 그라데이션 볼드 버튼 + 보상 카운트다운 타이머)
- **선택지 2 (포인트 해금)**: `🪙 100P로 즉시 보기` (잔여 포인트 표시 + 원터치 해금)
- **보안 연동**: `private.get_episode_content` 및 `private.grant_rewarded_ad_unlock` RPC 완벽 연동

### 1.4. 회차별 모바일 댓글 & 대댓글(Nested Comments) UI
- **계층형 들여쓰기**: 원댓글 좌측 핑크 라인 + 대댓글 `16px` 들여쓰기 구조
- **원터치 공감**: `❤️ 공감` 버튼 터치 시 핑크 하트 애니메이션 및 카운트 즉시 반영
- **고정 댓글 입력창**: 키보드 올라올 때 화면 하단에 고정되는 인풋 바

---

## 2. 변경 대상 파일
- [`public/index.html`](file:///D:/Antigravity/webnovels/public/index.html): 뷰어 템플릿, 바텀시트 모달 마크업
- [`public/styles.css`](file:///D:/Antigravity/webnovels/public/styles.css): 뷰어 타이포그래피, 바텀시트 애니메이션, 댓글 스타일
- [`public/app.js`](file:///D:/Antigravity/webnovels/public/app.js): 뷰어 컨트롤러, 폰트/테마 변경 로직, 해금 모달 인터랙션

---

## 3. 검증 방법
- 웹소설 1화 열람 시 폰트 조절/테마 변경 동작 확인
- 웹소설 4화(잠긴 회차) 접근 시 광고/포인트 바텀 시트 해금 테스트
- `npx tsc --noEmit`
