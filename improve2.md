# 🔒 [Improvement Step 2] 보안 강화 및 민감정보 보호 (RLS & Backend SSV)

본 문서는 `needtochange1.md`의 핵심 개선 사항 중 **2단계: RLS 보안 재설계, 민감정보 DB 노출 제거 및 서버 사이드 서명 검증(SSV)** 작업을 위한 명세서입니다.

---

## 1. 개요 및 목적
- **비인가 익명 접근(Anon Full Access) 차단**:
  - `readers`, `authors`, `admin_users`의 비밀번호 해시, 전화번호, 정산 계좌번호 등 민감정보가 브라우저에서 직접 노출/위조되지 않도록 RLS 정책 강화
- **민감 API Key의 DB 저장 제거 및 환경변수 격리**:
  - `system_config` 내 `toss_secret_key`, `kcp_site_key` 등 결제/인증 비밀키를 클라이언트 DB 테이블에서 삭제하고 백엔드 Node.js `.env` 환경변수로 완전 분리
- **광고 보상 및 정산의 Server-Side Verification (SSV)**:
  - 클라이언트에서 임의로 광고 완료/해금을 DB에 INSERT하는 보안 취약점을 방지하고, 서버 검증 API(`POST /api/ads/verify-reward`)를 통해서만 `episode_unlocks` 및 `author_earnings`가 기록되도록 제어
- **비밀번호 저장 보안 표준화**:
  - `readers` 테이블의 평문 암호 기본값(`!12345`)을 제거하고 `pgcrypto` 기반 Bcrypt 해시 의무화

---

## 2. 세부 구현 대상 (Tasks)

### 2.1. Supabase RLS 정책 정밀 재설계
```sql
-- 1. 작품/회차 공개 데이터: Anon 읽기 전용 허용, 쓰기는 관리자/서버에만 허용
ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read works" ON works;
CREATE POLICY "Allow anon read works" ON works FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anon read episodes" ON episodes;
CREATE POLICY "Allow anon read episodes" ON episodes FOR SELECT USING (status = 'PUBLISHED');

-- 2. 독자/작가 프로필: 자신의 데이터만 조회/수정 가능 (Supabase Auth / Session 연동)
DROP POLICY IF EXISTS "Allow anon read readers" ON readers;
CREATE POLICY "Allow user read own profile" ON readers FOR SELECT USING (true); -- 필터링된 view 제공

-- 3. 광고 해금 및 정산: 클라이언트 직접 INSERT 차단, 서버 Service Role Key를 통해서만 안전 기록
```

---

### 2.2. `system_config` 민감 키 분리
- `system_config` 테이블에서 `toss_secret_key`, `kcp_site_key` 컬럼 제거 또는 마스킹
- 백엔드 `src/config/env.ts` 및 `.env.local`을 통해 비밀키 관리:
  ```env
  TOSS_SECRET_KEY=test_sk_...
  KCP_SITE_KEY=3383f508...
  SUPABASE_SERVICE_ROLE_KEY=...
  ```
- 프론트엔드에는 공개 가능한 Client Key(`toss_client_key`, `kcp_site_code`)만 전달

---

### 2.3. 백엔드 광고 보상 검증 서비스 (`src/services/adUnlock.service.ts` 및 `src/routes/ad.router.ts`)
- 클라이언트가 광고 시청 완료 시 발급받은 `rewardToken`을 백엔드로 전달
- 서버에서 유효성 및 중복 여부를 검증한 후 `episode_unlocks` 및 `author_earnings`를 안전하게 생성
- 응답으로 서명된 열람 토큰(JWT) 또는 72시간 권한 반환

---

## 3. 코드 연동 반영
- `src/services/tossPayment.service.ts`, `src/services/kcpVerification.service.ts`: 환경변수 기반 시크릿 키 로드
- `public/supabase-admin.js`: 민감 작업(정산 승인, 결제 확정, 광고 리워드 지급) 시 백엔드 검증 API 경유 처리
- `public/app.js`: 안전한 광고 완료 핸들러 연동

---

## 4. 검증 계획
1. 익명 클라이언트에서 타인의 계좌정보나 패스워드 해시를 조회할 수 없는지 RLS 정책 검증
2. `system_config` 조회 시 시크릿 키가 노출되지 않는지 확인
3. 위조된 광고 완료 요청이 서버 검증 단계에서 정상적으로 차단되는지 테스트
