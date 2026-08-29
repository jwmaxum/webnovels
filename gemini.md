# 🚀 WebNovels 개발 가이드라인 & DB 동기화 원칙 (AI 어시스턴트 및 개발자 필독)

본 문서는 `WebNovels` 프로젝트의 프론트엔드-백엔드 데이터 동기화, Supabase 클라우드 DB 연동, 관리자 CMS 관제탑 구현, 웹소설/웹툰 1:1 분리 뷰어 및 개발자 코드 협업 규정을 정의하는 최우선 표준 가이드라인입니다.

---

## 1. 아키텍처 개요 & 기술 스택 (Architecture Overview)

*   **Frontend**: Pure Vanilla HTML5 + CSS3 (Glassmorphism Dark Theme) + Vanilla JavaScript SPA Engine (`public/app.js`, `public/supabase-admin.js`)
*   **Backend API**: Node.js v24 + Express + TypeScript (`src/server.ts`, `src/routes/*`)
*   **Database (Dual Engine)**:
    *   **Supabase PostgreSQL (Primary Cloud SSOT)**: Cloudflare Pages 및 실시간 배포 환경에서 실시간 쿼리 수행
    *   **Prisma ORM (Local / Staging)**: SQLite / PostgreSQL 통합 스키마 관리 (`prisma/schema.prisma`)
*   **External Integrations**:
    *   **본인/성인인증**: KCP / PASS API 연동 (`is_adult_verified` 플래그 관리)
    *   **결제(PG)**: Toss Payments 연동 (포인트 충전 및 모드 설정)
    *   **광고 리워드**: 보상형 광고(Rewarded Ad) 시청 검증 후 4~6화 열람권 부여 (72시간 유지)

---

## 2. 프론트엔드: 실시간 DB 우선 동기화 & 로컬 보호 방어벽 (Realtime DB First)

1.  **실시간 DB 우선 렌더링 (Realtime DB First)**:
    *   Supabase 클라우드 DB에 구축된 실데이터(`readers` 10명, `authors` 30명, `works` 30작품 180회차, `content_reviews`, `reports`, `author_settlements`)를 우선 fetch하여 화면에 실시간으로 렌더링해야 합니다.
    *   하드코딩된 가상 목업 데이터 사용은 지양하며, 항상 DB의 실시간 상태를 UI에 반영합니다.
2.  **맹목적인 데이터 덮어쓰기 방지 (로컬 보호 방어벽)**:
    *   백엔드 통신 지연이나 일시적 오류로 백엔드가 빈 상태(`[]`, `null`)를 반환할 때 기존 유효 로컬 데이터가 소실되지 않도록 **안전 병합(Safe Merge / SSOT 유지)** 로직을 반드시 준수합니다.
3.  **Event-Driven 실시간 UI 동기화**:
    *   작품 생성/수정/삭제, 회차 추가, 회원 활동 발생 시 커스텀 이벤트(`webnovels:works-changed`, `webnovels:readers-changed`, `webnovels:actionqueue-changed`)를 발행하여 관련 UI 컴포넌트를 즉각 재렌더링합니다.

---

## 3. 관리자 CMS & Zero-Touch 관제탑 (Admin Dashboard & Action Queue)

### 3.1. 5대 KPI 및 연재 현황 카드 실시간 집계
*   **웹소설 (NOVEL)**: `works` 테이블에서 `content_type === 'NOVEL'` 필터링 집계 (17작품 / 102 에피소드)
*   **웹툰 (WEBTOON)**: `works` 테이블에서 `content_type === 'WEBTOON'` 필터링 집계 (13작품 / 78 에피소드)
*   **정상 연재 / 완결**: `is_completed === false` (25작품) / `is_completed === true` (5작품)
*   **독자 / 작가 회원**: `readers` (10명) / `authors` (30명) 실시간 DB 카운트 연동

### 3.2. 실시간 Action Queue (예외 관제 센터)
*   **심사 대기 콘텐츠 (`content_reviews`)**: 신규 등록 작품/회차에 대한 운영자 승인 심사 대기열 (`status: 'PENDING'`)
*   **독자 신고 항목 (`reports`)**: 댓글/작품 스포일러 및 비방 신고 건 미처리 목록 (`status: 'PENDING'`)
*   **작가 출금 정산 신청 (`author_settlements`)**: 확정 수익에 대한 작가 출금 요청 건 (`status: 'PENDING'`)
*   **원클릭 조치 기능**: 관리자가 [심사 승인], [블라인드 조치], [송금 승인] 버튼 클릭 시 Supabase DB에 `APPROVED`, `RESOLVED`, `PAID`로 즉시 업데이트 반영

---

## 4. 콘텐츠 뷰어 & 비즈니스 모델 (Reader Engine & Monetization)

1.  **웹소설(NOVEL) vs 웹툰(WEBTOON) 1:1 완벽 분리**:
    *   **웹소설**: 전용 텍스트 리더 엔진 구동 (다크/라이트/세피아 테마, 폰트 크기 및 줄간격 조절, 양옆 패딩 최적화)
    *   **웹툰**: 연속 스크롤 컷 이미지 뷰어 구동 (고화질 이미지 세로 스크롤 레이아웃 및 줌 최적화)
2.  **회차 공개 정책 (1~6화 표준 구조)**:
    *   **1~3화**: 무조건 무료 공개 (`isFree: true, isAdFree: false`) — 즉시 열람
    *   **4~6화**: 보상형 광고 시청 후 해금 (`isFree: false, isAdFree: true`) — 30초 광고 완료 후 72시간 열람 권한 부여
3.  **월 광고 총매출 작가풀 수익배분 엔진 (Revenue Engine)**:
    *   월 광고 총매출(Gross)에서 애드네트워크 수수료(Fee)를 공제한 순수익(Net) 산출
    *   순수익의 **62.5%**를 작가 정산 배분 풀(Writer Pool)로 자동 배정
    *   작품별 완독률/체류시간/조회수 기반 기여도 점수(Contribution Score)에 비례하여 작가별 **추정 정산금(Estimated)** 산출
    *   월 마감(Confirm) 시 **확정 정산금(Confirmed)**으로 전환되어 작가 출금 신청 가능

---

## 5. 개발자 협업 및 코드 주석 표준 (Code Commenting & Documentation Standard)

다른 개발자가 코드를 처음 보더라도 5초 이내에 역할을 파악할 수 있도록 모든 소스 코드에 다음 표준 주석을 필수 적용합니다:

### 5.1. 함수 및 메서드 헤더 주석 (JSDoc / TSDoc)
```javascript
// ============================================================
// [Function] fetchActionQueueFromDB
// [Purpose] Supabase DB의 content_reviews, reports, author_settlements를 통합 조회하여 실시간 Action Queue 목록 생성
// [Returns] Promise<Array<ActionQueueItem>> - 정렬 및 포맷팅된 예외 항목 배열
// [Business Rule] PENDING 상태인 항목만 필터링하여 긴급도(CRITICAL, WARNING, INFO) 부여
// ============================================================
```

### 5.2. 라우터 및 엔드포인트 헤더 주석
```typescript
// ============================================================
// [Route] POST /api/admin/revenue/calculate
// [Purpose] 월 광고 총매출액 및 수수료 입력 후 작가 Pool 기여도 배분(Estimated) 계산 실행
// [Security] authenticateToken, requireRole(['ADMIN']), requirePermission('AD_REVENUE')
// ============================================================
```

### 5.3. 인라인 비즈니스 로직 주석
```javascript
// [Business Rule] 순수익(Net Revenue)의 기본 62.5%를 작가 배분 Pool로 할당
const writerPool = netRevenue * (writerPoolRatio || 0.625);
```

---

## 6. 개발 및 배포 원칙

1.  **언어**: 모든 소통, 커밋 메시지 설명, UI 레이블 및 문서는 한국어를 표준으로 합니다.
2.  **외과적 변경 (Surgical Changes)**: 요청받은 기능과 직결된 코드만 수정하며, 기존 정상 동작 코드를 임의로 리팩토링하지 않습니다.
3.  **검증 수칙**:
    *   코드 변경 후 `node` 스크립트 기반 문법 검사 및 DB 쿼리 정합성 검증을 반드시 수행합니다.
    *   브라우저 Subagent 자동 실행은 사용자의 명시적 요청이 있을 때만 진행합니다.
