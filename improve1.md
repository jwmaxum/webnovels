# [Step 1] CDG Play 디자인 토큰 & 모바일 타이포그래피·스페이싱 시스템 구축

> **목표:** Comme des Garçons Play (CDG PLAY: Black, White, Pink) 미학을 바탕으로, 모바일 환경에서 가장 트렌디하고 가독성이 뛰어난 Fluid Typography, Icon Size, Spacing Grid 시스템을 정의하고 CSS 토큰을 전면 쇄신한다.

---

## 1. 주요 작업 내용

### 1.1. CDG PLAY Color Palette & Surface Tokens 정밀화
- **Deep Black Surface**: `--bg-main: #0A0A0C`, `--bg-surface: #121218`, `--bg-card: #181820`, `--bg-glass: rgba(18, 18, 24, 0.8)`
- **Iconic Pink Accent**: `--cdg-pink: #FF2A7A`, `--cdg-pink-hover: #FF478D`, `--cdg-pink-soft: rgba(255, 42, 122, 0.12)`, `--cdg-pink-glow: rgba(255, 42, 122, 0.35)`
- **High-Contrast White**: `--text-primary: #FFFFFF`, `--text-secondary: #A1A1AA`, `--text-tertiary: #71717A`
- **Border & Glass Effect**: `--border-subtle: rgba(255, 255, 255, 0.08)`, `--border-pink: rgba(255, 42, 122, 0.4)`

### 1.2. 2026 모바일 트렌드 Fluid Typography Scale (`clamp()`)
- **Title (Hero/Heading)**: `clamp(1.35rem, 5vw, 1.75rem)` (22~28px, Bold, `Outfit`/`Pretendard`)
- **Section Heading**: `clamp(1.15rem, 4vw, 1.35rem)` (18~22px, Bold)
- **Work Card Title**: `clamp(0.95rem, 3.5vw, 1.05rem)` (15~17px, Semi-Bold, 2줄 말줄임)
- **Body / Meta**: `0.875rem` (14px, Regular, Line-height: 1.6)
- **Caption / Badge**: `0.75rem` (12px, Semi-Bold, 자간 +0.02em)
- **Reader Novel Body**: `clamp(1.05rem, 4.2vw, 1.25rem)` (17~20px, Line-height: 1.85, `Noto Serif KR`)

### 1.3. 모바일 터치 타깃 & 아이콘 크기 규격화
- **Touch Target**: 모든 버튼, 탭, 링크 최소 높이 `44px` (Apple/Google 권장 규격 준수)
- **Header / Bottom Nav Icon**: `22px` (선명도 최적화, Stroke: 2px)
- **Badge / Small Icon**: `14px ~ 16px`
- **Hero Icon / Big Graphic**: `32px ~ 48px`

### 1.4. Spacing & Mobile Safe Area Grid
- **Screen Gutter (좌우 여백)**: 모바일 `16px`, 태블릿 `24px`, 데스크톱 `32px`
- **Card Gap**: 모바일 `12px`, 데스크톱 `16px`
- **Section Margin Bottom**: 모바일 `36px`, 데스크톱 `48px`
- **iOS Safe Area Support**: `padding-bottom: env(safe-area-inset-bottom, 16px)`

---

## 2. 변경 대상 파일
- [`public/styles.css`](file:///D:/Antigravity/webnovels/public/styles.css): `:root` 변수군 전면 쇄신 및 베이스 리셋

---

## 3. 검증 방법
- Chrome DevTools 모바일 뷰포트 (iPhone 14/15 390px, Galaxy S23 360px, iPad 768px)에서 폰트 깨짐 및 여백 검증
- `npx tsc --noEmit`
