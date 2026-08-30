# 🚀 WebNovels 개발 가이드라인 & 시스템 아키텍처 표준 (v2.5)

본 문서는 `WebNovels` 프로젝트의 프론트엔드-백엔드 데이터 동기화, Supabase 클라우드 DB 연동, 관리자 CMS 15대 관제탑 및 RBAC 권한 제어, 웹소설/웹툰 하이브리드 리더, 작가 스튜디오 및 개발자 협업 규정을 정의하는 최우선 표준 가이드라인입니다.

---

## 0. 핵심 개발 원칙 (Core Principles)
1. **언어**: 모든 소통, 커밋 메시지 설명, UI 레이블 및 문서는 **한국어**를 표준으로 합니다.
2. **Node.js**: `v24` 표준을 준수합니다.
3. **메인 AI 엔진**: **gemini-3-flash**를 사용하여 빠른 응답성, 비용 최적화 및 고품질 추론을 유지합니다.
4. **외과적 변경 (Surgical Changes)**: 요청받은 기능과 직결된 코드만 수정하며, 기존 정상 동작 코드를 임의로 리팩토링하지 않습니다.
5. **Git Push 필수 원칙**: 코드 수정 및 검증(`npx tsc --noEmit`) 완료 후 항상 `git push origin main`을 수행합니다.

---

## 1. 아키텍처 개요 & 기술 스택 (Architecture Overview)

* **Frontend**: Pure Vanilla HTML5 + CSS3 (**CDG PLAY 테마**: Deep Black `#0B0C10`, Pure White, Neon Pink `#FF2A7A` 액센트, Glassmorphism) + Vanilla JavaScript SPA Engine (`public/app.js`, `public/supabase-admin.js`)
* **Backend API**: Node.js v24 + Express + TypeScript (`src/server.ts`, `src/routes/*`)
* **Database (Dual Engine)**:
  * **Supabase PostgreSQL (Primary Cloud SSOT)**: Cloudflare Pages 및 실시간 배포 환경에서 실시간 쿼리 수행
  * **Prisma ORM (Local / Staging)**: SQLite / PostgreSQL 통합 스키마 관리 (`prisma/schema.prisma`)
* **External Integrations**:
  * **본인/성인인증**: KCP / PASS API 연동 (`is_adult_verified` 플래그 관리)
  * **결제(PG)**: Toss Payments 연동 (포인트 충전 및 모드 설정)
  * **광고 리워드**: 보상형 광고(Rewarded Ad) 시청 검증 후 4~6화 열람권 부여 (72시간 유지)

---

## 2. 프론트엔드: 실시간 DB 우선 동기화 & 하이브리드 영구 보존 (Dual Persistence)

1. **실시간 DB 우선 렌더링 (Realtime DB First)**:
   * Supabase 클라우드 DB에 구축된 실데이터(`readers`, `authors`, `works` 30작품 180회차, `content_reviews`, `reports`, `author_settlements`, `admin_users`)를 우선 fetch하여 화면에 실시간으로 렌더링합니다.
   * 불필요한 하드코딩 목업/시드 데이터 사용을 배제하고, DB의 실시간 상태를 UI에 반영합니다.
2. **하이브리드 영구 동기화 (Dual Persistence SSOT)**:
   * 네트워크 지연이나 DB 권한 설정 과도기에도 사용자가 생성한 중요 데이터(서브 관리자 계정, 독서 히스토리, 보관함 등)가 유실되지 않도록 **Supabase DB ➔ LocalStorage 양방향 실시간 병합(Merge)** 아키텍처를 적용합니다.
3. **Event-Driven 실시간 UI 동기화**:
   * 작품 생성/수정/삭제, 회차 추가, 회원 활동 발생 시 커스텀 이벤트를 발행하여 관련 UI 컴포넌트를 즉각 재렌더링합니다.

---

## 3. 관리자 CMS 15대 메뉴 & RBAC 서브 관리자 관제탑

### 3.1. 15대 관리자 서브 메뉴 체계
* **`01. Dashboard`**: 5대 KPI 배너, 콘텐츠 타입별(소설/웹툰) 실시간 현황, Action Queue 프리뷰, 서브 관리자 현황 요약
* **`02. 회원 관리 (users)`**: 독자 회원(`readers`) 실시간 목록 테이블 렌더링 (`loadAdminUsers`)
* **`03. 작가 관리 (authors)`**: 30명 등록 작가 및 정산 계좌 카드 그리드 렌더링 (`loadAdminAuthors`)
* **`04. 작품 관리 (works)`**: 연재 작품 목록 테이블, 다차원 필터, 연재 캘린더 토글 (`renderAdminWorks`)
* **`05. 회차 관리 (episodes)`**: 작품별 회차 테이블, 무료↔유료 전환, 일괄 관리 (`renderAdminEpisodes`)
* **`06. 콘텐츠 검수 (actionqueue)`**: 4개 레벨 요약 배너, 원터치 긴급 조치 큐 (`renderActionQueue`)
* **`07. 댓글 / 신고 (comments)`**: 독자 신고 댓글 목록 및 원터치 블라인드 조치
* **`08. 광고 관리 (admgmt)`**: 동영상 및 메인 띠 배너 광고 구좌 / 단가(CPM/CPC) 관리
* **`09. 수익 / 정산 (settlements)`**: 미처리 작가 출금 신청 목록 및 즉시 입금 승인 (`loadSettlementsList`)
* **`10. 팬미팅 (fanmeeting)`**: 온/오프라인 팬미팅 개설 및 신청 티케팅 관리
* **`11. Goods (goods)`**: 웹소설 IP 굿즈 상품 등록, 재고 및 배송 관리
* **`12. 프로모션 / 이벤트 (events)`**: 가입 프로모션 및 무료 쿠폰 이벤트 관리
* **`13. Analytics (analytics)`**: 당월 총매출, 62.5% 작가 정산풀, 장르별 비중 (`loadAdminAnalytics`)
* **`14. System / RBAC (subadmins)`**: 서브 관리자 생성 및 16개 메뉴 접근 권한 제어판 (`loadSubAdminList`)
* **`15. Security 로그 (security)`**: PG/PASS 결제 설정 및 실시간 관리자 보안 감사 로그 (`loadSystemConfig`)

### 3.2. RBAC (Role-Based Access Control) 권한 제어 원칙
* **`SUPER_ADMIN`**: 15대 모든 관리자 메뉴 및 서브관리자 생성/수정/삭제 전권 보유 (`🛡️ SUPER_ADMIN (전체 권한)` 뱃지 표시).
* **`SUB_ADMIN`**: 부여된 접근 권한(1~16개 메뉴)에 한해서만 메뉴 진입 허용 (미부여 메뉴 클릭 시 `showToast`로 즉시 접근 차단).
* **RPC 보안 제어**: `create_admin_user`, `get_sub_admins`, `delete_sub_admin`, `verify_admin_login`을 통해 패스워드 Bcrypt 해시 및 무결성 보장.

---

## 4. 콘텐츠 리더 & 작가 스튜디오 & 비즈니스 모델

### 4.1. 하이브리드 리더 (Reader Engine)
* **웹소설(NOVEL)**: 전용 텍스트 리더 엔진 (`Noto Serif KR`, `18px`, 행간 `1.85`, 좌우 `20px` 여백, 다크/라이트/세피아 3대 테마, 이전/다음 화 이동).
* **웹툰(WEBTOON)**: 무여백 세로 연속 스크롤 뷰어 레이아웃.
* **계층형 대댓글 & 공감**: 회차별 2단계 계층형 댓글 및 `❤️ 공감` 인터랙션 실시간 동기화.

### 4.2. 작가센터 (Creator Studio)
* **7대 탭 칩 스와이프**: `개요`, `연재작품`, `수익정산`, `신규등록`, `회차관리`, `팬소통`, `설정`.
* **4대 실시간 수익 지표 (모바일 2x2 그리드)**: `당월 추정 수익(Estimated)`, `확정 정산금(Confirmed)`, `출금 가능액(Payable)`, `누적 총수익(Cumulative)`.

### 4.3. 회차 공개 및 수익배분 엔진 (Revenue Engine)
* **1~3화**: 무조건 무료 공개 (`isFree: true, isAdFree: false`) — 즉시 열람.
* **4~6화**: 보상형 광고 시청 후 해금 (`isFree: false, isAdFree: true`) — 30초 광고 완료 후 72시간 열람 권한 부여.
* **62.5% 작가 배분 풀**: 순수익(Net Revenue)의 62.5%를 작가 풀로 배정하고, 완독률/체류시간/조회수 기여도 점수에 비례하여 분배.

---

## 5. 개발자 협업 및 코드 주석 표준 (Commenting Standard)

모든 소스 코드에 다음 표준 헤더 주석을 필수로 적용합니다:

```javascript
// ============================================================
// [Function] fetchSubAdmins
// [Purpose] Supabase DB 및 로컬스토리지에서 서브 관리자 목록을 조회 및 병합하여 반환
// [Returns] Promise<Array<SubAdminItem>> - 정규화된 권한 배열을 포함한 서브 관리자 목록
// [Business Rule] SUPER_ADMIN은 모든 권한, SUB_ADMIN은 지정된 메뉴 접근 권한만 허용
// ============================================================
```

---

## 6. 품질 보증 및 배포 체크리스트 (QA & Deployment Checklist)

* [ ] `npx tsc --noEmit` 실행 시 0 에러 (TypeScript 타입 무결성 통과).
* [ ] 모바일(375px~430px) 및 데스크톱 뷰포트 반응형 레이아웃 깨짐 없음.
* [ ] 관리자 15대 메뉴 클릭 시 패널 정상 전환 및 데이터 즉각 렌더링 확인.
* [ ] 서브 관리자 생성/삭제 시 새로고침 후에도 영구 유지 확인.
* [ ] 변경 사항 커밋 및 `git push origin main` 완료.

