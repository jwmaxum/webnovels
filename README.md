# WebNovels (웹노블즈) - 광고 기반 무료 웹소설 플랫폼

> **WebNovels**는 독자가 유료 결제 없이 **30초 보상형 광고(Rewarded Ad)**를 시청하면 다음 회차를 무료로 즐길 수 있고, 발생한 광고 수익은 **62.5% 작가 Pool**로 투명하게 배분되는 **작가 상생형 웹소설 서비스 플랫폼**입니다.

---

## 🌟 주요 특징 (Key Features)

### 📖 1. Reading-First 독자 웹 플랫폼 (`/`)
* **Mobile-First & Responsive UX**: 모바일 하단 바텀 네비게이션 및 데스크톱 네비게이션 지원.
* **Hero Carousel & 이어보기**: 최근 읽던 작품과 읽기 진행률(예: `1화 75% 완료`)을 메인 홈에서 즉시 계속 읽기.
* **작품 & 회차 연재**: 관람 등급(`ALL`, `15+`, `18+`), AI 사용 표기(`NONE`, `ASSISTED`, `FULL`), 1~3화 무료 & 4화 광고 Unlock 회차 구분.
* **전문 웹소설 리더 (Fullscreen Reader)**:
  * 3가지 독서 테마 지원 (`Light`, `Sepia`, `Dark`)
  * 폰트 및 글자 크기(14px ~ 26px) 실시간 조절 Drawer
* **보상형 광고 Unlock & Server-Side Verification (SSV)**:
  * 4화 열람 시 30초 광고 시청 시뮬레이션 후 백엔드 서버 승인을 거쳐 100% 안전하게 무료 해금.

---

### 🎨 2. 작가 스튜디오 (Creator Studio)
* **3단계 투명 수익 대시보드 (Creator Transparency)**:
  * 📊 **예상 수익 (Estimated)**: 실시간 광고 발생 추정치
  * 🔒 **확정 수익 (Confirmed)**: 월말 마감 승인 완료된 정산금
  * 💳 **정산 가능 금액 (Payable)**: 작가가 출금 가능한 정산금 및 정산 신청 위저드
* **작품 & 회차 연재 관리**: 신규 작품 등록, 예약 발행, 회차 무료/광고 Unlock 설정.

---

### 🛡️ 3. 통합 관리자 CMS (Admin Web Application - `/admin`)
* **최고 관리자 (Super Admin) 세팅**: `.env.local` 기반 자동 계정 세팅 (`jwmaxum@gmail.com`).
* **서브 관리자 권한 매트릭스 (Fine-Grained RBAC)**:
  * 16개 관리자 메뉴(`DASHBOARD`, `USER_MGMT`, `AUTHOR_MGMT`, `WORK_MGMT`, `EPISODE_MGMT`, `CONTENT_REVIEW`, `COMMENT_REPORT`, `AD_MGMT`, `AD_REVENUE`, `AUTHOR_SETTLEMENT`, `FAN_MEETING`, `GOODS_MGMT`, `EVENT_MGMT`, `ANALYTICS`, `SYSTEM_MGMT`, `SECURITY_MGMT`)에 대해 스위치 토글로 접근 권한 지정/수정.
* **광고 수익배분 Engine (Revenue Allocation Engine)**:
  * 월 광고 총매출, 수수료 차감 후 작가 Pool(62.5%) 자동 산정 (`Estimated`) 및 정산 마감 (`Confirmed`).
* **작가 정산 승인 프로세스**: 작가의 출금 신청 확인 후 입금 완료(`PAID`) 승인.
* **PG & PASS 본인인증 시스템 설정**:
  * 토스페이먼츠 (Toss Payments) Secret Key 보안 마스킹 (`test****3b5z`) 및 LIVE/TEST 전환
  * NHN KCP / PASS 성인 본인인증 키 설정 및 핑 테스트.

---

## 🛠️ 기술 스택 (Tech Stack)

* **Backend**: Node.js (v24), Express, TypeScript, Prisma ORM, SQLite / Supabase
* **Frontend**: HTML5, Vanilla CSS (Dark Glassmorphism Design Tokens), JavaScript (ESNext), Lucide Icons
* **CI/CD & Deployment**: GitHub Actions CI, Cloudflare Pages Edge Deployment

---

## 📁 프로젝트 폴더 구조 (Directory Structure)

```text
webnovels/
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions CI 빌드/테스트 워크플로우
├── prisma/
│   └── schema.prisma          # User, Work, Episode, AdImpression, RevenueEvent, SystemConfig DB 스키마
├── public/                    # 메인 웹 서비스 및 관리자 CMS 프론트엔드 static 파일
│   ├── images/                # AI 생성 대표 웹소설 표지 이미지 (cover_fantasy.png, cover_romance.png)
│   ├── index.html             # WebNovels 메인 플랫폼 & Admin CMS SPA 레이아웃
│   ├── styles.css             # 디자인 시스템 토큰, 리더 테마, 글래스모피즘 CSS
│   └── app.js                 # 프론트엔드 비즈니스 로직 & REST API 연동
├── scripts/
│   └── verify_backend.ts      # 8단계 통합 백엔드/프론트엔드 시나리오 자동 검증 스크립트
├── src/
│   ├── app.ts                 # Express 애플리케이션 및 라우터 마운트
│   ├── server.ts              # 서버 실행 및 SuperAdminInit 초기화
│   ├── config/                # DB 및 JWT 환경 설정
│   ├── middlewares/           # auth, requirePermission (RBAC), adultGuard
│   ├── routes/                # auth, admin, creator, work, episode, ad, payment
│   └── services/              # adUnlock, revenueEngine, tossPayment, kcpVerification, config
├── .env.local                 # Super Admin credentials & API secrets
├── design.md                  # Front-end Design System & Implementation Specification
└── tsconfig.json              # TypeScript 컴파일 설정
```

---

## 🚀 시작하기 (Getting Started)

### 1. 의존성 설치
```bash
npm install
```

### 2. 데이터베이스 초기화 (Prisma)
```bash
npx prisma generate
npx prisma db push
```

### 3. 개발 서버 실행
```bash
npm run dev
```

* **메인 서비스 플랫폼**: `http://localhost:4000/`
* **통합 관리자 CMS**: `http://localhost:4000/admin`

### 4. 통합 자동 테스트 실행 (Verification Test)
```bash
npm run test
```

### 5. Production 빌드
```bash
npm run build
```

---

## 🔑 주요 계정 정보 (Initial Credentials)

* **최고 관리자 (Super Admin)**:
  * **ID / Email**: `jwmaxum@gmail.com`
  * **Password**: `sang@4478000`

---

## 📄 라이선스 (License)

Copyright © 2026 WebNovels. All rights reserved.
