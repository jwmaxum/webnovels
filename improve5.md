# 🚀 [Improve Step 5] 인증 보안 정규화 & Supabase Realtime 실시간 동기화

## 1. 목적 및 배경
`improve.md` 15, 16, 17, 18, 19, 20항목에서 지적된 "하드코딩된 백도어 로그인", "LocalStorage에 의존하는 영구 저장", "진정한 Realtime 브로드캐스트 부재"를 해결합니다.

---

## 2. 세부 작업 항목

### [작업 5-1] 하드코딩된 테스트/백도어 관리자 로그인 완전 제거
* **대상 파일**: `public/supabase-admin.js` (`adminLogin`), `public/app.js`
* **내용**:
  - `cleanEmail === 'admin'`, `cleanPw === 'admin1234' || '!12345'` 등 하드코딩된 인증 조건 전면 제거.
  - Supabase `admin_users` 테이블의 Bcrypt 해시 검증 및 RPC(`verify_admin_login`) 기반 단일 인증으로 통일.

### [작업 5-2] Supabase Auth / Bcrypt 기반 독자 및 작가 인증 정규화
* **대상 파일**: `public/supabase-admin.js`, `public/app.js`
* **내용**:
  - 평문 비밀번호 비교 로직을 배제하고, 안전한 해시 검증 및 세션 토큰 체계 적용.
  - LocalStorage는 영구 DB의 대체수단이 아닌 순수 "클라이언트 UI 캐시" 용도로만 사용.

### [작업 5-3] Supabase Realtime 채널 구독 (`postgres_changes`) 연동
* **대상 파일**: `public/supabase-admin.js`, `public/app.js` (`initWebNovelsApp`)
* **내용**:
  - `works`, `episodes`, `content_reviews`, `reports`, `author_settlements` 테이블 변경 시 `supabase.channel('public-db-changes').on('postgres_changes', ...)`를 통해 타 브라우저에서도 새로고침 없이 즉시 UI가 자동 갱신되도록 WebSocket Realtime 리스너 구축.

---

## 3. 검증 기준
- [ ] 하드코딩된 비밀번호로 로그인이 시도되지 않고 DB에 등록된 정규 계정만 로그인되는지 확인.
- [ ] 브라우저 A에서 작품/회차/정산 등록 시 브라우저 B에서 새로고침 없이 실시간 반영되는지 확인.
- [ ] `npx tsc --noEmit` 통과.
