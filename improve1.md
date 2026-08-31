# 🚀 [Improve Step 1] DB 스키마 & 핵심 데이터 정합성 정규화

## 1. 목적 및 배경
`improve.md` 2, 3, 4, 5, 6, 14항목에서 지적된 실제 DB 불일치, 더미 데이터 덮어쓰기, 조회수 동시성 누락 문제를 해결합니다.

---

## 2. 세부 작업 항목

### [작업 1-1] 대시보드 KPI 더미 데이터 폴백 제거
* **대상 파일**: `public/supabase-admin.js` (`fetchDashboardKPI`)
* **내용**: 
  - `let totalUsers = 10, totalAuthors = 30...` 식의 하드코딩 기본값 제거.
  - DB 조회 실패 시 임의 숫자가 아닌 `null` 또는 명확한 에러 상태 반환.
  - UI에서 DB 연결 실패 시 "실시간 DB 연결 실패" 안내 표출.

### [작업 1-2] 매출/정산금 가짜 계산식(`* 200원`) 제거
* **대상 파일**: `public/supabase-admin.js` (`fetchDashboardKPI`, `calculateRevenue`)
* **내용**:
  - `finalAdViews * 200` 식의 임의 추산치 제거.
  - 실제 `revenue_ledger` 및 DB 이벤트에 기록된 실매출 집계치만 반영.

### [작업 1-3] 작품/회차 조회수 원자적(Atomic) 증가 처리
* **대상 파일**: `public/supabase-admin.js` (`recordWorkReadingView`)
* **내용**:
  - `SELECT -> +1 -> UPDATE`의 Race Condition 제거.
  - Supabase RPC `increment_work_view(p_work_id)` 또는 SQL Atomic Update 적용.

### [작업 1-4] 작품 등록 시 수동 MAX(ID) 생성 제거 및 `author_id` 일치
* **대상 파일**: `public/supabase-admin.js` (`createWorkInDB`), `public/app.js`
* **내용**:
  - 클라이언트에서 `max(id) + 1` 계산하여 `id`를 전송하던 방식 제거 (DB IDENTITY 자동 생성 위임).
  - `works.author`(문자열) 대신 `works.author_id`(FK) 및 `pen_name` 정규화 적용.

### [작업 1-5] 독자 활동 데이터 단일 원본(SSOT) 정규화
* **대상 파일**: `public/supabase-admin.js`, `public/app.js`
* **내용**:
  - `readers` 테이블의 중복 JSONB 컬럼 의존도를 낮추고, `reading_history`, `favorites`, `author_subscriptions` 테이블을 단일 진실 공급원(SSOT)으로 동기화.

---

## 3. 검증 기준
- [ ] DB 조회 실패 시 하드코딩된 숫자(10명, 30작품 등)가 노출되지 않는지 확인.
- [ ] 작품 등록 시 ID 충돌 없이 자동 채번되는지 확인.
- [ ] `npx tsc --noEmit` 통과.
