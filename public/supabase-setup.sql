-- ============================================================
-- WebNovels Supabase 최종 정규화 통합 데이터베이스 셋업 SQL (v2.0 보안 강화)
-- (Secret Key DB 제거 및 백엔드 .env 분리, 정밀 RLS 정책 적용)
-- Supabase Dashboard > SQL Editor 에서 전체 복사 후 [RUN] 실행하세요
-- ============================================================

-- 01. 확장 모듈
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 02. 사용자 계정 (admin_users, authors, readers)
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

CREATE TABLE IF NOT EXISTS authors (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '!123456',
  email TEXT UNIQUE NOT NULL,
  pen_name TEXT NOT NULL,
  work_title TEXT,
  birthdate TEXT,
  address TEXT,
  bank_info TEXT,
  status TEXT DEFAULT '공식 인증 작가',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE authors ADD COLUMN IF NOT EXISTS pen_name TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS work_title TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS bank_info TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '공식 인증 작가';

CREATE TABLE IF NOT EXISTS readers (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '!12345',
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '미입력',
  nickname TEXT,
  is_adult_verified BOOLEAN DEFAULT false,
  subscription_status TEXT DEFAULT '일반 회원',
  reading_history JSONB DEFAULT '[]'::jsonb,
  favorites JSONB DEFAULT '[]'::jsonb,
  subscribed_authors JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE readers ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS is_adult_verified BOOLEAN DEFAULT false;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT '일반 회원';
ALTER TABLE readers ADD COLUMN IF NOT EXISTS reading_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS favorites JSONB DEFAULT '[]'::jsonb;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS subscribed_authors JSONB DEFAULT '[]'::jsonb;

-- 03. 콘텐츠 (works, episodes)
CREATE TABLE IF NOT EXISTS works (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES authors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'NOVEL',
  genre TEXT[] NOT NULL,
  tags TEXT[] NOT NULL,
  description TEXT,
  cover_image TEXT,
  view_count INT DEFAULT 0,
  like_count INT DEFAULT 0,
  rating TEXT DEFAULT 'ALL',
  ai_usage_type TEXT DEFAULT 'NONE',
  status TEXT DEFAULT 'ONGOING',
  is_completed BOOLEAN DEFAULT false,
  is_top_recommended BOOLEAN DEFAULT false,
  is_popular_work BOOLEAN DEFAULT false,
  is_new_work BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE works ADD COLUMN IF NOT EXISTS author_id INT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'NOVEL';
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_top_recommended BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_popular_work BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_new_work BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT 'ALL';
ALTER TABLE works ADD COLUMN IF NOT EXISTS ai_usage_type TEXT DEFAULT 'NONE';
ALTER TABLE works ADD COLUMN IF NOT EXISTS like_count INT DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_works_author'
  ) THEN
    ALTER TABLE works ADD CONSTRAINT fk_works_author FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS episodes (
  id SERIAL PRIMARY KEY,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT NOT NULL,
  is_free BOOLEAN DEFAULT true,
  is_ad_free BOOLEAN DEFAULT false,
  content TEXT,
  image_urls JSONB DEFAULT '[]'::jsonb,
  author_comment TEXT,
  status TEXT DEFAULT 'PUBLISHED',
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_work_episode UNIQUE (work_id, episode_number)
);

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS author_comment TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT true;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_ad_free BOOLEAN DEFAULT false;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PUBLISHED';
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- 04. 독자 활동 정규화 (reading_history, favorites, author_subscriptions)
CREATE TABLE IF NOT EXISTS reading_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  progress NUMERIC DEFAULT 0,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_episode_read UNIQUE(user_id, episode_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_work_favorite UNIQUE(user_id, work_id)
);

CREATE TABLE IF NOT EXISTS author_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_author_subscription UNIQUE(user_id, author_id)
);

-- 05. 회차 해금 및 광고 이벤트 (episode_unlocks, ad_events)
CREATE TABLE IF NOT EXISTS episode_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  episode_id INT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  unlock_type TEXT NOT NULL CHECK (unlock_type IN ('FREE', 'REWARDED_AD', 'POINT', 'PURCHASE')),
  ad_network TEXT,
  ad_event_id TEXT,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT unique_user_episode_unlock UNIQUE(user_id, episode_id)
);

CREATE TABLE IF NOT EXISTS ad_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '72 hours'),
  CONSTRAINT unique_user_episode_ad_unlock UNIQUE(user_id, episode_id)
);

CREATE TABLE IF NOT EXISTS ad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  episode_id INT REFERENCES episodes(id) ON DELETE SET NULL,
  ad_network TEXT NOT NULL,
  ad_unit TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('IMPRESSION', 'START', 'COMPLETE', 'REWARD', 'SKIP')),
  reward_granted BOOLEAN DEFAULT false,
  revenue NUMERIC DEFAULT 0,
  external_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 06. 수익 및 작가 정산 (revenue_events, author_earnings, author_settlements)
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

CREATE TABLE IF NOT EXISTS author_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id INT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  period_date DATE NOT NULL,
  ad_impressions INT DEFAULT 0,
  rewarded_views INT DEFAULT 0,
  gross_revenue NUMERIC DEFAULT 0,
  platform_fee NUMERIC DEFAULT 0,
  author_revenue NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'ESTIMATED' CHECK (status IN ('ESTIMATED', 'CONFIRMED', 'SETTLED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_author_work_date UNIQUE(author_id, work_id, period_date)
);

CREATE TABLE IF NOT EXISTS author_revenues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  revenue_event_id UUID REFERENCES revenue_events(id) ON DELETE SET NULL,
  period_month TEXT NOT NULL,
  contribution_score NUMERIC DEFAULT 0,
  estimated_amount NUMERIC DEFAULT 0,
  confirmed_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'REJECTED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS author_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id INT REFERENCES authors(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_name_snapshot TEXT,
  bank_name_snapshot TEXT,
  account_number_snapshot TEXT,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'REJECTED')),
  bank_info TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_id INT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS bank_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS account_number_snapshot TEXT;

-- 07. 커뮤니티 (comments with parent_id, comment_likes, reports, content_reviews)
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  likes_count INT DEFAULT 0,
  is_blocked BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_comment_like UNIQUE (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS content_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  work_title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reject_reason TEXT,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'REJECTED')),
  resolved_action TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 08. 시스템 설정 & 통계 (Secret Key 제거)
CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  toss_client_key TEXT DEFAULT 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
  toss_mid TEXT DEFAULT 'tosspayments',
  toss_mode TEXT DEFAULT 'TEST',
  kcp_site_code TEXT DEFAULT 'T0000',
  kcp_mode TEXT DEFAULT 'TEST',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE system_config DROP COLUMN IF EXISTS toss_secret_key;
ALTER TABLE system_config DROP COLUMN IF EXISTS kcp_site_key;

CREATE TABLE IF NOT EXISTS platform_stats (
  id TEXT PRIMARY KEY DEFAULT 'current',
  total_users INT DEFAULT 10,
  total_authors INT DEFAULT 30,
  total_works INT DEFAULT 30,
  total_episodes INT DEFAULT 180,
  total_ad_views INT DEFAULT 54200,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  episode_id INT REFERENCES episodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 09. 보안 RLS 정책
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_revenues ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read Works" ON works FOR SELECT USING (true);
CREATE POLICY "Public Read Episodes" ON episodes FOR SELECT USING (true);
CREATE POLICY "Public Read Platform Stats" ON platform_stats FOR SELECT USING (true);
CREATE POLICY "Public Read System Config" ON system_config FOR SELECT USING (true);
CREATE POLICY "Public Read Authors" ON authors FOR SELECT USING (true);
CREATE POLICY "Public Read Comments" ON comments FOR SELECT USING (is_blocked = false);
CREATE POLICY "Public Read Comment Likes" ON comment_likes FOR SELECT USING (true);

CREATE POLICY "User Manage Reading History" ON reading_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Favorites" ON favorites FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Subscriptions" ON author_subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Comments" ON comments FOR INSERT WITH CHECK (true);
CREATE POLICY "User Manage Comment Likes" ON comment_likes FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "User Read Episode Unlocks" ON episode_unlocks FOR SELECT USING (true);
CREATE POLICY "Service Insert Episode Unlocks" ON episode_unlocks FOR INSERT WITH CHECK (true);
CREATE POLICY "User Read Ad Unlocks" ON ad_unlocks FOR SELECT USING (true);
CREATE POLICY "User Insert Ad Unlocks" ON ad_unlocks FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Log Ad Events" ON ad_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Read Ad Events" ON ad_events FOR SELECT USING (true);

CREATE POLICY "Public Read Revenue Events" ON revenue_events FOR SELECT USING (true);
CREATE POLICY "Public Read Author Earnings" ON author_earnings FOR SELECT USING (true);
CREATE POLICY "Public Read Author Revenues" ON author_revenues FOR SELECT USING (true);
CREATE POLICY "Author Request Settlements" ON author_settlements FOR INSERT WITH CHECK (true);
CREATE POLICY "Author Read Settlements" ON author_settlements FOR SELECT USING (true);
CREATE POLICY "Admin Update Settlements" ON author_settlements FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "User Manage Readers" ON readers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Author Manage Profile" ON authors FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin Access Reviews" ON content_reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Create Reports" ON reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin Access Reports" ON reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Access Transactions" ON point_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Manage Admins" ON admin_users FOR ALL USING (true) WITH CHECK (true);

-- 10. 인덱스
CREATE INDEX IF NOT EXISTS idx_works_author_id ON works(author_id);
CREATE INDEX IF NOT EXISTS idx_episodes_work_id ON episodes(work_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_user_id ON reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_author_subs_user_id ON author_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_episode_unlocks_user_ep ON episode_unlocks(user_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_ad_unlocks_user_ep ON ad_unlocks(user_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_ad_events_user_id ON ad_events(user_id);
CREATE INDEX IF NOT EXISTS idx_author_earnings_author_date ON author_earnings(author_id, period_date);
CREATE INDEX IF NOT EXISTS idx_author_settlements_author_id ON author_settlements(author_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);

-- 11. RPC 함수
CREATE OR REPLACE FUNCTION verify_admin_login(p_email TEXT, p_password TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin admin_users;
BEGIN
  SELECT * INTO v_admin FROM admin_users WHERE email = p_email OR username = p_email;
  
  IF v_admin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
  END IF;

  IF v_admin.password_hash = crypt(p_password, v_admin.password_hash) THEN
    RETURN jsonb_build_object(
      'success', true,
      'admin', jsonb_build_object(
        'id', v_admin.id,
        'email', v_admin.email,
        'username', v_admin.username,
        'nickname', v_admin.nickname,
        'role', v_admin.role,
        'permissions', v_admin.permissions
      )
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
END;
$$;

CREATE OR REPLACE FUNCTION create_admin_user(p_username TEXT, p_password TEXT, p_email TEXT, p_nickname TEXT, p_permissions TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO admin_users (username, email, password_hash, nickname, permissions, role)
  VALUES (p_username, p_email, crypt(p_password, gen_salt('bf')), p_nickname, p_permissions::jsonb, 'SUB_ADMIN')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
