-- ============================================================
-- WebNovels Supabase 관리자 테이블 셋업 SQL
-- Supabase Dashboard > SQL Editor 에서 실행하세요
-- ============================================================

-- 1. 관리자 사용자 테이블 (Supabase Auth와 별도의 관리자 전용 테이블)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SUB_ADMIN' CHECK (role IN ('SUPER_ADMIN', 'SUB_ADMIN')),
  permissions JSONB DEFAULT '["DASHBOARD"]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 수익 이벤트 테이블
CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month TEXT NOT NULL,
  gross_revenue NUMERIC NOT NULL DEFAULT 0,
  ad_network_fee NUMERIC NOT NULL DEFAULT 0,
  net_revenue NUMERIC NOT NULL DEFAULT 0,
  writer_pool_ratio NUMERIC NOT NULL DEFAULT 0.625,
  writer_pool NUMERIC NOT NULL DEFAULT 0,
  platform_revenue NUMERIC NOT NULL DEFAULT 0,
  is_closed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 작가 정산 테이블
CREATE TABLE IF NOT EXISTS author_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'REJECTED')),
  bank_info TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- 4. 시스템 설정 테이블
CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  toss_client_key TEXT DEFAULT 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
  toss_secret_key TEXT DEFAULT 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z',
  toss_mid TEXT DEFAULT 'tosspayments',
  toss_mode TEXT DEFAULT 'TEST',
  kcp_site_code TEXT DEFAULT 'T0000',
  kcp_site_key TEXT DEFAULT '3383f5080e729a67a57a8a1c0d48',
  kcp_mode TEXT DEFAULT 'TEST',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 통계 요약 뷰 (대시보드 KPI용)
CREATE TABLE IF NOT EXISTS platform_stats (
  id TEXT PRIMARY KEY DEFAULT 'current',
  total_users INT DEFAULT 0,
  total_authors INT DEFAULT 0,
  total_works INT DEFAULT 0,
  total_episodes INT DEFAULT 0,
  total_ad_views INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. RLS 비활성화 (관리자 전용 테이블이므로 anon key로 접근 허용)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;

-- anon key로 전체 접근 허용 정책 (관리자 CMS 전용)
CREATE POLICY "Allow anon full access" ON admin_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON revenue_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON author_settlements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON system_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON platform_stats FOR ALL USING (true) WITH CHECK (true);

-- 7. 초기 시스템 설정 삽입
INSERT INTO system_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- 8. 초기 통계 삽입
INSERT INTO platform_stats (id, total_users, total_authors, total_works, total_episodes, total_ad_views)
VALUES ('current', 1250, 48, 127, 1893, 54200)
ON CONFLICT (id) DO NOTHING;

-- 9. 비밀번호 해싱 함수 (pgcrypto 확장)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 10. 최고 관리자 계정 시드 (비밀번호: 환경변수에서 설정한 값 사용)
-- 주의: 실제 운영 시 Supabase Dashboard에서 직접 생성하세요
INSERT INTO admin_users (email, username, password_hash, nickname, role, permissions)
VALUES (
  'admin@webnovels.com',
  'super_admin',
  crypt('admin1234!', gen_salt('bf')),
  '최고관리자',
  'SUPER_ADMIN',
  '["DASHBOARD","USER_MGMT","AUTHOR_MGMT","WORK_MGMT","EPISODE_MGMT","CONTENT_REVIEW","COMMENT_REPORT","AD_MGMT","AD_REVENUE","AUTHOR_SETTLEMENT","FAN_MEETING","GOODS_MGMT","EVENT_MGMT","ANALYTICS","SYSTEM_MGMT","SECURITY_MGMT"]'::jsonb
) ON CONFLICT (email) DO NOTHING;
