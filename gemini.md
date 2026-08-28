# 🚀 WebNovels 개발 가이드라인 & DB 동기화 원칙 (AI 어시스턴트 필수 참조)

본 문서는 `WebNovels` 프로젝트의 프론트엔드-백엔드 데이터 동기화, Supabase 클라우드 DB 연동, 관리자 CMS 관제탑 구현 및 개발 행동 수칙을 규정하는 최우선 가이드라인입니다.

---

## 1. 프론트엔드: 실시간 DB 우선 동기화 & 로컬 보호 방어벽

*   **실시간 DB 우선 렌더링 (Realtime DB First)**:
    *   Supabase 클라우드 DB에 실제 데이터(`readers` 10명, `authors` 30명, `works` 30작품 180회차 등)가 구축되어 있으므로, 하드코딩된 더미 데이터가 아닌 DB의 실데이터를 우선 fetch하여 화면에 실시간으로 렌더링해야 합니다.
*   **맹목적인 데이터 덮어쓰기 방지 (로컬 보호 방어벽)**:
    *   **증상:** 백엔드 업데이트 실패 또는 네트워크 지연으로 백엔드가 빈 상태(`[]`, `null`)를 반환할 때, 기존 로컬 데이터(로컬 스토리지 등)를 무조건 덮어쓰면 데이터가 손실됩니다.
    *   **원칙:** 백엔드 응답이 비어 있고 로컬에 기존 데이터가 존재하는 경우 **기존 데이터를 보존(SSOT 유지)**해야 합니다.
    *   **검증:** 데이터 병합(Merge) 로직 작성 시 빈 배열이나 null 값이 기존 최신 데이터 구조를 파괴하지 않는지 명시적으로 점검하세요.

---

## 2. 백엔드 & Supabase: DB 스키마, RLS 및 실시간 이벤트

*   **테이블 스키마 및 RLS 권한 누락 체크**:
    *   `UPDATE` 또는 `INSERT` 코드를 작성하거나 디버깅할 때, 페이로드에 포함된 모든 필드(`nickname`, `is_adult_verified`, `subscription_status`, `reading_history`, `favorites` 등)가 **실제 DB 스키마에 존재하는지 반드시 교차 검증**합니다.
    *   RLS(Row Level Security) 정책으로 인해 쓰기 권한이 차단될 수 있으므로, 누락이나 차단이 의심될 경우 **해결을 위한 SQL (ALTER TABLE 및 CREATE POLICY)**을 작성하여 Dashboard에서 실행할 수 있도록 안내합니다.
*   **Event-Driven 실시간 UI 동기화**:
    *   작품, 에피소드, 회원 정보 변경 시 `webnovels:works-changed`, `webnovels:readers-changed`, `webnovels:authors-changed` 이벤트를 발행하여 관련 UI 탭 및 통계 수치를 즉시 재렌더링합니다.

---

## 3. 관리자 CMS (Zero-Touch 관제탑) 구현 원칙

1. **서브탭 전환 시 자동 데이터 로드**:
   - `DASHBOARD`: `loadDashboardKPIs()` - DB 실시간 통계 (25개 연재작, 5개 완결작, 17개 소설 102화, 13개 웹툰 78화, 총 180화, 독자 10명, 작가 30명) 집계 렌더링.
   - `USER_MGMT` (독자 관리): `loadAdminUsers()` - `readers` 테이블 10명 실시간 로드 및 성인인증/구독 상태 표기.
   - `AUTHOR_MGMT` (작가 관리): `loadAdminAuthors()` - `authors` 테이블 30명 작가 실시간 로드 및 계좌/대표작 표기.
   - `WORK_MGMT` (작품 연재 관리): `renderAdminWorks()` & 요약 카드 바 수치 실시간 연동.
2. **목록 갱신 버튼 연동**:
   - 각 관리 탭의 🔄 [목록 갱신] 버튼 클릭 시 `forceRefresh = true` 파라미터와 함께 실시간 DB 재조회를 수행하고 알림 토스트를 표시합니다.

---

## 4. 로컬호스트 자동 검증 수칙

*   **수동 검증 수칙**: 로컬호스트 브라우저 검증(Browser Subagent) 등은 사용자의 명시적인 승인이나 요청이 있을 경우에만 수행하며, 자동 실행하지 않습니다.
