# 🚀 WebNovels 개발 가이드라인 & 시스템 아키텍처 표준 (v3.0)

본 문서는 `WebNovels` 프로젝트의 프론트엔드 모듈화 구조, 계층적 Semantic URL 라우팅, PC 및 모바일 반응형 UI/UX, Supabase 클라우드 DB 실시간 연동, 독자 서재 영구 보존(Dual Persistence), 작가 스튜디오 및 관리자 CMS 16대 관제탑 표준을 정의하는 최우선 개발 가이드라인입니다.

---

## 0. 핵심 개발 원칙 (Core Principles)

1. **언어**: 모든 소통, 커밋 메시지 설명, UI 레이블 및 기술 문서는 **한국어**를 표준으로 합니다.
2. **Node.js**: `v24` 런타임 표준을 준수합니다.
3. **메인 AI 엔진**: **gemini-3-flash**를 사용하여 빠른 응답성, 비용 최적화 및 고품질 추론을 유지합니다.
4. **외과적 변경 (Surgical Changes)**: 요청받은 기능과 직결된 코드만 수정하며, 기존 정상 동작 코드를 임의로 리팩토링하지 않습니다.
5. **Git Push 필수 원칙**: 코드 수정 및 검증(`npx tsc --noEmit`) 완료 후 항상 `git push origin main`을 수행합니다.
6. **Localhost 검증 원칙**: Localhost 및 브라우저 검증(브라우저 서브에이전트 구동 등)은 **사용자가 명시적으로 요청한 경우에만 수행**하며, 요청이 없을 때는 임의로 실행하지 않습니다. 코드 문법 검사(`node -c`, `npx tsc --noEmit`) 중심으로 신속히 처리합니다.
7. **참조 우선순위**: 프로젝트 루트의 `gemini.md` 파일이 존재할 경우, 이를 항상 최우선으로 참조합니다.

---

## 1. 아키텍처 개요 & 기술 스택 (Architecture Overview)

* **Frontend**: Pure Vanilla HTML5 + CSS3 (**CDG PLAY 테마**: Deep Black `#0B0C10`, Pure White `#FFFFFF`, Neon Pink `#FF2A7A` 액센트, Glassmorphism) + 4대 물리 분할 모듈 + 경량 부트스트랩 엔트리
* **Backend API**: Node.js v24 + Express + TypeScript (`src/server.ts`, `src/app.ts`, `src/routes/*`)
* **Database (Dual Engine)**:
  * **Supabase PostgreSQL (Primary Cloud SSOT)**: Cloudflare Pages 및 실시간 배포 환경에서 실시간 쿼리 및 WebSocket 구독 수행
  * **Prisma ORM (Local / Staging)**: SQLite / PostgreSQL 통합 스키마 관리 (`prisma/schema.prisma`)
* **External Integrations**:
  * **본인/성인인증**: KCP / PASS API 연동 (`is_adult_verified` 플래그 관리 및 모달 인터랙션)
  * **결제(PG)**: Toss Payments 연동 (포인트 충전 및 모드 설정)
  * **광고 리워드**: 보상형 광고(Rewarded Ad) 시청 검증 후 4~6화 열람권 부여 (72시간 유지)

---

## 2. 프론트엔드 물리적 모듈 분할 구조 (Modular Architecture)

거대해진 `public/app.js`를 부작용(Side Effect) 및 기존 기능 회귀(Zero-Regression) 없이 역할별 **4대 의미 단위 모듈 + 경량 부트스트랩 엔트리**로 물리 분할하여 운영합니다.

```
public/
├── js/
│   ├── core/           # 라우터, 전역 상태, 모달, 토스트, 공통 유틸리티
│   │   ├── state.js    # 시드 데이터(SAMPLE_WORKS/AUTHORS/READERS), 활성 세션 상태, 양방향 동기화
│   │   ├── ui-utils.js # 모달(open/closeModal), 토스트(showToast), 텍스트/표지 이스케이프 헬퍼
│   │   └── router.js   # 계층적 Semantic URL 라우터(resolveRoute, navigateTo, switchWebNovelsView)
│   ├── reader/         # 독자 전담 모듈 (웹소설/웹툰 뷰어, 댓글, 내 서재, 성인인증)
│   │   └── reader.js   # 홈 큐레이션, 실시간 탐색/검색, 작품상세, 뷰어 엔진, 대댓글, 회원인증
│   ├── creator/        # 작가 스튜디오 모듈 (원고 에디터, AI 자동검수, 회차발행, 정산신청)
│   │   └── creator.js  # 7대 작가 서브탭, 원고 발행/AI검수, 4대 실시간 수익 지표, 출금 신청
│   └── admin/          # 관리자 관제탑 모듈 (16대 관제 메뉴, 5대 콘텐츠 검수, 회원관리)
│       └── admin.js    # 16대 서브탭 라우팅, 실시간 Action Queue, 대시보드 KPI, CMS 연재/검수
├── supabase-admin.js   # Supabase 실시간 DB 클라이언트 및 관리자 확장 연동
└── app.js              # 통합 이벤트 바인딩(bindWebNovelsEvents) 및 다단계 안전 부트스트랩 엔트리 (~420줄)
```

### 2.1. `index.html` 스크립트 로드 순서 & 캐시 버스팅
번들러 없이 브라우저 순차 로드로 구동되므로, 의존성 순서에 따라 다음 순서로 스크립트를 로드합니다:
```html
<!-- Core Architecture Modules -->
<script src="/js/core/state.js?v=100"></script>
<script src="/js/core/ui-utils.js?v=100"></script>
<script src="/js/core/router.js?v=100"></script>
<!-- Domain Functional Modules -->
<script src="/js/reader/reader.js?v=100"></script>
<script src="/js/creator/creator.js?v=100"></script>
<script src="/js/admin/admin.js?v=100"></script>
<!-- Supabase Extension & Bootstrap Entry -->
<script src="/supabase-admin.js?v=100"></script>
<script src="/app.js?v=100"></script>
```

---

## 3. 계층적 Semantic URL 라우팅 & 딥링크 체계 (Routing Engine)

사용자 친화적인 표준 계층형 URL을 채택하여 브라우저 뒤로가기/앞으로가기 및 직접 접속(Direct Deep Link)을 완벽 지원합니다.

### 3.1. URL 경로 매핑 규칙

| 엔드포인트 경로 | 대상 뷰 (View ID) | 서브탭 / 파라미터 | 설명 |
| :--- | :--- | :--- | :--- |
| `/` 또는 `/home` | `view-home` | - | 메인 홈 (계속 읽기, CDG 큐레이션) |
| `/discover` | `view-discover` | - | 탐색 및 장르별 큐레이션 그리드 |
| `/works/:id` | `view-work-detail` | `workId` | 특정 작품 상세 페이지 & 회차 목록 |
| `/read/:workId/:epNum` | `view-reader` | `workId`, `epNum` | 웹소설/웹툰 뷰어 엔진 |
| `/library` | `view-mypage` | `continue` (기본) | 내 서재 (이어보기) |
| `/library/:tab` | `view-mypage` | `favorites`, `authors` | 내 서재 탭 (관심작, 구독작가) |
| `/creator` | `view-creator` | `works` (기본) | 작가 스튜디오 (포털 분리 모드) |
| `/creator/:sub` | `view-creator` | `episodes`, `stats`, `settlement` | 작가 스튜디오 서브탭 |
| `/admin` | `view-admin-cms` | `dashboard` (기본) | 관리자 CMS 관제탑 (포털 분리 모드) |
| `/admin/:sub` | `view-admin-cms` | `users`, `works`, `episodes`, ... | 관리자 16대 서브 메뉴 라우팅 |

### 3.2. 백엔드 SPA Fallback 라우터 (`src/app.ts`)
Express 백엔드에서 `FRONTEND_ROUTES`를 등록하여, 페이지 새로고침 시 404 에러 없이 `public/index.html`을 즉시 서빙하고 프론트엔드 `resolveRoute()`가 딥링크를 파싱하도록 합니다:
```typescript
const FRONTEND_ROUTES = ['/', '/home', '/discover', '/works', '/read', '/library', '/creator', '/admin'];
```

### 3.3. 포털 분리 풀스크린 모드 (`portal-fullscreen-mode`)
`/creator` 및 `/admin` 접속 시 `document.body`에 `portal-fullscreen-mode` 클래스를 적용하여, 일반 독자용 헤더/모바일 하단 탭바를 자동으로 숨기고 스튜디오/관제탑 전용 풀스크린 작업 환경을 제공합니다.

---

## 4. UI/UX 디자인 시스템 (PC & 모바일 반응형 완성판)

### 4.1. PC 데스크톱 환경 (`UI_pc.md`)
1. **좌측 240px 고정 사이드바**:
   - 로고 및 12개 메뉴 바로가기 (`홈`, `웹소설`, `웹툰`, `장르별`, `실시간 랭킹`, `신작`, `완결작`, `보관함(이어보기/관심작/구독작가)`, `크리에이터 스튜디오(/creator)`, `관리자 관제탑(/admin)`)
2. **상단 2단 헤더 & 빠른 검색바**:
   - 데스크톱 검색창(`desktopHeaderSearchInput`) 및 검색 모달(`modalSearch`) 연동
3. **홈 최상단 "계속 읽기(Continue Reading)" 히어로 카드**:
   - 최근 읽은 작품의 표지 썸네일, 읽음 진행률(%), 총 회차 정보 및 **[이어보기] 원클릭 액션 버튼** 배치

### 4.2. 스마트폰 / 모바일 환경 (`UI_mobile.md`)
1. **상단 헤더 전용 검색바**:
   - 모바일 전용 상단 검색바(`mobileSearchInput`)를 헤더에 고정 노출하여 즉시 검색 모달 진입 지원
2. **하단 5탭 고정 네비게이션**:
   - `홈` (`view-home`), `탐색` (`view-discover`), `랭킹` (실시간 랭킹 섹션 스크롤), `내 서재` (`view-mypage`), `더보기` (바텀시트)
3. **모바일 더보기 바텀시트 모달 (`modalMobileMore`)**:
   - 로그인 사용자 정보(닉네임, 이메일), 🔞 성인인증 상태, 보유 포인트(`🪙 P`), 19+ 성인 필터링 토글
   - 포털 분리 바로가기: `✍️ 작가 전용 스튜디오(/creator)`, `🛡️ 관리자 관제탑(/admin)`

---

## 5. 독자 경험 & 서재 영구 보존 (Dual Persistence)

1. **내 서재 3대 탭 영구 동기화**:
   - **읽는 중 (Continue)**: 회차 열람 시 `saveReadingProgress(workId, epNum)`가 LocalStorage와 Supabase DB(`reading_history`, `readers.reading_history`)에 동시 저장
   - **관심 작품 (Favorites)**: 작품 상세/스티키 바에서 토글 시 `webnovels_favorites`와 DB 양방향 머지
   - **구독 작가 (Subscribed Authors)**: 작가 구독 시 `webnovels_subscribed_authors`와 DB 실시간 머지
   - 새로고침 및 다른 브라우저에서 로그인 접속 시에도 `syncUserActivityToStorage()`를 통해 100% 영구 복원
2. **19+ PASS 성인 본인인증**:
   - 성인 작품 열람 시 비로그인 차단 및 성인인증 모달(`modalPassAdultVerify`) 호출
   - 인증 완료 시 `readers.is_adult_verified = true` 및 LocalStorage 영구 동기화
3. **웹소설 & 웹툰 하이브리드 리더 Engine**:
   - **웹소설(NOVEL)**: `Noto Serif KR`, `18px`, 행간 `1.85`, 라이트/세피아/다크 3대 테마, 이전/다음 회차 네비게이션
   - **웹툰(WEBTOON)**: 이미지 무여백 연속 스크롤 레이아웃
   - **1~3화 무료** / **4~6화 보상형 광고 또는 포인트 언락** / **7~10화 작가 연재예정(Coming Soon)** 상태 안내
4. **실시간 계층형 대댓글 (Nested Comments)**:
   - 회차별 2단계 계층형 댓글 구조 및 `❤️ 공감(Likes)` 실시간 토글 지원

---

## 6. 작가 스튜디오 (Creator Studio)

1. **7대 작가 서브탭 (`switchCreatorTab`)**:
   - `works`: 내 연재작 목록 관리
   - `new-ep`: 회차 신규 등록 및 원고 에디터
   - `status`: 연재 상태 관리 (연재중/휴재/완결 원클릭 전환)
   - `stats`: 작품별 통계 분석
   - `settlements`: 정산금 출금 신청 및 내역 조회
2. **회차 발행 & AI 자동검수 Engine**:
   - 회차 등록 시 즉시 발행(`PUBLISHED`) 또는 예약 발행(`SCHEDULED`) 지원
   - 유해성, 금칙어, 맞춤법, 스포일러 검사 AI 시뮬레이션 및 Supabase DB 영구 저장
3. **4대 실시간 수익 지표 (Creator Earnings KPI)**:
   - `당월 추정 수익 (Estimated Revenue)`
   - `확정 정산금 (Confirmed Revenue)`
   - `출금 가능액 (Payable Revenue)`
   - `누적 총수익 (Cumulative Total)`
4. **정산금 출금 신청 (`handleCreatorSettlementReq`)**:
   - 최소 출금액(₩10,000) 이상 출금 신청 시 관리자 Action Queue와 즉각 연동

---

## 7. 관리자 CMS 16대 관제 메뉴 & RBAC 관제탑

### 7.1. 16대 관제 메뉴 체계 (`switchAdminSubTab`)
* **`01. Dashboard`**: 5대 핵심 KPI, 플랫폼별 통계, 실시간 Action Queue 프리뷰
* **`02. 회원 관리 (users)`**: 독자 회원 실시간 목록 테이블 렌더링 (`loadAdminUsers`)
* **`03. 작가 관리 (authors)`**: 30명 등록 작가 및 정산 계좌 카드 그리드 (`loadAdminAuthors`)
* **`04. 작품 연재 관리 (works)`**: 연재 상태 필터, 연재 캘린더 토글, 작품별 상세 대시보드 모달
* **`05. 회차 관리 (episodes)`**: 5대 콘텐츠 심사 & 검수 Workflow 모달 (`openAdminEpisodeDetailModal`)
* **`06. 콘텐츠 검수 (actionqueue)`**: 미처리 심사/신고/정산 대기열 원터치 승인/반려
* **`07. 댓글 / 신고 (comments)`**: 독자 신고 댓글 목록 및 원터치 블라인드 조치
* **`08. 광고 관리 (admgmt)`**: 동영상 및 배너 광고 구좌 / 단가(CPM/CPC) 관리
* **`09. 수익 / 정산 (settlements)`**: 작가 출금 신청 목록 조회 및 즉시 입금 승인 (`handleApproveSettlement`)
* **`10. 팬미팅 (fanmeeting)`**: 온/오프라인 팬미팅 개설 및 신청 티케팅 관리
* **`11. Goods (goods)`**: 웹소설 IP 굿즈 상품 등록, 재고 및 배송 관리
* **`12. 프로모션 / 이벤트 (events)`**: 가입 프로모션 및 무료 쿠폰 이벤트 관리
* **`13. Analytics (analytics)`**: 당월 총매출, 62.5% 작가 정산풀, 장르별 비중 분석 (`loadAdminAnalytics`)
* **`14. System / RBAC (subadmins)`**: 서브 관리자 생성 및 16개 메뉴 접근 권한 제어판
* **`15. Security 로그 (security)`**: 결제 모드 설정 및 실시간 관리자 보안 감사 로그
* **`16. 공지사항 (notices)`**: 플랫폼 전체 공지사항 등록 및 팝업 설정

### 7.2. RBAC (Role-Based Access Control) 권한 제어
* **`SUPER_ADMIN`**: 16대 모든 메뉴 및 서브관리자 생성/삭제 전권 보유 (`🛡️ SUPER_ADMIN (전체 권한)` 뱃지).
* **`SUB_ADMIN`**: 부여된 접근 권한(1~16개 메뉴)에 한해서만 진입 허용 (미부여 메뉴 접근 차단).
* **RPC 보안 제어**: Supabase `create_admin_user`, `get_sub_admins`, `delete_sub_admin`, `verify_admin_login`을 통해 패스워드 Bcrypt 해시 및 무결성 보장.

---

## 8. 품질 보증 및 배포 체크리스트 (QA & Deployment Checklist)

* [ ] `node -c public/js/core/*.js`, `public/js/reader/*.js`, `public/js/creator/*.js`, `public/js/admin/*.js`, `public/app.js` 전 모듈 구문 에러 0건.
* [ ] `npx tsc --noEmit` 실행 시 0 에러 (TypeScript 타입 무결성 통과).
* [ ] 모바일(375px~430px) 및 PC 데스크톱(1024px~1920px) 뷰포트 반응형 레이아웃 깨짐 없음.
* [ ] Semantic URL 경로(`/works/1`, `/read/1/1`, `/creator`, `/admin`, `/library`) 새로고침 시 404 없이 정상 로드.
* [ ] 내 서재(읽는 중, 관심작, 구독작가) 새로고침 및 타 브라우저 로그인 시에도 영구 동기화 유지.
* [ ] 변경 사항 커밋 및 `git push origin main` 완료.
