-- ============================================================
-- Supabase Setup Script (Consolidated Production Baseline)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_type') THEN
    CREATE TYPE public.content_type AS ENUM ('NOVEL', 'WEBTOON');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_status') THEN
    CREATE TYPE public.work_status AS ENUM (
      'DRAFT', 'REVIEW', 'PUBLISHED', 'ONGOING', 'PAUSED', 'COMPLETED', 'REJECTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'episode_status') THEN
    CREATE TYPE public.episode_status AS ENUM (
      'DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'HIDDEN', 'DELETED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_policy') THEN
    CREATE TYPE public.access_policy AS ENUM (
      'FREE', 'REWARDED_AD', 'POINT', 'PURCHASE', 'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unlock_type') THEN
    CREATE TYPE public.unlock_type AS ENUM (
      'FREE', 'REWARDED_AD', 'POINT', 'PURCHASE', 'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'settlement_status') THEN
    CREATE TYPE public.settlement_status AS ENUM (
      'PENDING', 'CONFIRMED', 'PROCESSING', 'PAID', 'REJECTED', 'ON_HOLD', 'CANCELLED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status') THEN
    CREATE TYPE public.review_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
    CREATE TYPE public.report_status AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');
  END IF;
END $$;

-- 1. READERS
CREATE TABLE IF NOT EXISTS public.readers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  nickname TEXT,
  email TEXT,
  phone TEXT,
  subscription_status TEXT NOT NULL DEFAULT '일반 회원',
  is_adult_verified BOOLEAN NOT NULL DEFAULT false,
  adult_verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'WITHDRAWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. AUTHORS
CREATE TABLE IF NOT EXISTS public.authors (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  username TEXT UNIQUE NOT NULL,
  pen_name TEXT NOT NULL,
  profile_image TEXT,
  bio TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. AUTHOR PRIVATE PROFILES
CREATE TABLE IF NOT EXISTS public.author_private_profiles (
  author_id BIGINT PRIMARY KEY REFERENCES public.authors(id) ON DELETE CASCADE,
  email TEXT,
  birthdate DATE,
  address TEXT,
  tax_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. AUTHOR SETTLEMENT ACCOUNTS
CREATE TABLE IF NOT EXISTS public.author_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  bank_name TEXT,
  account_number_encrypted TEXT,
  account_holder TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  verified_at TIMESTAMPTZ,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. WORKS
CREATE TABLE IF NOT EXISTS public.works (
  id BIGSERIAL PRIMARY KEY,
  author_id BIGINT,
  title TEXT NOT NULL,
  content_type public.content_type NOT NULL DEFAULT 'NOVEL',
  genre TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  cover_image TEXT,
  rating TEXT NOT NULL DEFAULT 'ALL',
  status public.work_status NOT NULL DEFAULT 'DRAFT',
  is_completed BOOLEAN NOT NULL DEFAULT false,
  is_top_recommended BOOLEAN NOT NULL DEFAULT false,
  is_popular_work BOOLEAN NOT NULL DEFAULT false,
  is_new_work BOOLEAN NOT NULL DEFAULT true,
  ai_usage_type TEXT NOT NULL DEFAULT 'NONE',
  view_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.works ADD COLUMN IF NOT EXISTS author_id BIGINT;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS content_type public.content_type DEFAULT 'NOVEL';
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS genre TEXT[] DEFAULT '{}';
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS cover_image TEXT;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT 'ALL';
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS status public.work_status DEFAULT 'DRAFT';
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS is_top_recommended BOOLEAN DEFAULT false;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS is_popular_work BOOLEAN DEFAULT false;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS is_new_work BOOLEAN DEFAULT true;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS ai_usage_type TEXT DEFAULT 'NONE';
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS view_count BIGINT DEFAULT 0;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS like_count BIGINT DEFAULT 0;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- 6. EPISODES (Metadata)
CREATE TABLE IF NOT EXISTS public.episodes (
  id BIGSERIAL PRIMARY KEY,
  work_id BIGINT,
  episode_number INT,
  title TEXT NOT NULL,
  access_policy public.access_policy NOT NULL DEFAULT 'FREE',
  author_comment TEXT,
  status public.episode_status NOT NULL DEFAULT 'DRAFT',
  scheduled_at TIMESTAMPTZ,
  view_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS work_id BIGINT;
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS episode_number INT;
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS access_policy public.access_policy DEFAULT 'FREE';
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS author_comment TEXT;
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS status public.episode_status DEFAULT 'DRAFT';
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS view_count BIGINT DEFAULT 0;

-- 7. EPISODE CONTENTS (Protected)
CREATE TABLE IF NOT EXISTS public.episode_contents (
  episode_id BIGINT PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  text_content TEXT,
  content_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. EPISODE PANELS (Protected)
CREATE TABLE IF NOT EXISTS public.episode_panels (
  id BIGSERIAL PRIMARY KEY,
  episode_id BIGINT NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  panel_number INT NOT NULL,
  image_url TEXT NOT NULL,
  width INT,
  height INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(episode_id, panel_number)
);

-- 9. READING HISTORY
CREATE TABLE IF NOT EXISTS public.reading_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  episode_id BIGINT NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  progress NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, episode_id)
);

-- 10. FAVORITES
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, work_id)
);

-- 11. AUTHOR SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS public.author_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  notification_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, author_id)
);

-- 12. EPISODE UNLOCKS
CREATE TABLE IF NOT EXISTS public.episode_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  episode_id BIGINT NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  unlock_type public.unlock_type NOT NULL,
  source_event_id UUID,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED'))
);

-- 13. POINT ACCOUNTS & TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.point_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('CHARGE', 'USE', 'REFUND', 'BONUS', 'AD_REWARD')),
  amount BIGINT NOT NULL,
  work_id BIGINT REFERENCES public.works(id) ON DELETE SET NULL,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE SET NULL,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. AD UNITS & EVENTS
CREATE TABLE IF NOT EXISTS public.ad_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ad_network TEXT NOT NULL,
  placement TEXT NOT NULL,
  ad_unit_code TEXT,
  is_rewarded BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  work_id BIGINT REFERENCES public.works(id) ON DELETE SET NULL,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE SET NULL,
  ad_unit_id UUID REFERENCES public.ad_units(id) ON DELETE SET NULL,
  ad_network TEXT NOT NULL,
  external_event_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('REQUEST', 'IMPRESSION', 'START', 'COMPLETE', 'REWARD', 'SKIP', 'VERIFY_FAILED')
  ),
  reward_granted BOOLEAN NOT NULL DEFAULT false,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KRW',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. REVENUE & EARNINGS
CREATE TABLE IF NOT EXISTS public.revenue_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month DATE NOT NULL,
  gross_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  network_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  writer_pool_ratio NUMERIC(6,4) NOT NULL DEFAULT 0.625,
  writer_pool NUMERIC(14,2) NOT NULL DEFAULT 0,
  platform_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period_month)
);

CREATE TABLE IF NOT EXISTS public.revenue_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_period_id UUID REFERENCES public.revenue_periods(id) ON DELETE SET NULL,
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  work_id BIGINT REFERENCES public.works(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (
    transaction_type IN (
      'AD_REVENUE', 'NETWORK_FEE', 'WRITER_POOL', 'AUTHOR_ALLOCATION',
      'PLATFORM_REVENUE', 'ADJUSTMENT', 'SETTLEMENT_RESERVED', 'SETTLEMENT_PAID'
    )
  ),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  reference_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.author_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  work_id BIGINT REFERENCES public.works(id) ON DELETE SET NULL,
  period_date DATE NOT NULL,
  ad_impressions BIGINT NOT NULL DEFAULT 0,
  rewarded_views BIGINT NOT NULL DEFAULT 0,
  gross_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  author_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ESTIMATED' CHECK (status IN ('ESTIMATED', 'CONFIRMED', 'SETTLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(author_id, work_id, period_date)
);

CREATE TABLE IF NOT EXISTS public.author_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE RESTRICT,
  author_name_snapshot TEXT NOT NULL,
  bank_name_snapshot TEXT,
  account_number_snapshot TEXT,
  account_holder_snapshot TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status public.settlement_status NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reject_reason TEXT
);

-- 16. COMMUNITY & COMMERCE & SYSTEM
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname_snapshot TEXT NOT NULL,
  work_id BIGINT REFERENCES public.works(id) ON DELETE CASCADE,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  likes_count INT NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.content_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id BIGINT REFERENCES public.works(id) ON DELETE CASCADE,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE CASCADE,
  work_title_snapshot TEXT NOT NULL,
  author_name_snapshot TEXT NOT NULL,
  status public.review_status NOT NULL DEFAULT 'PENDING',
  reject_reason TEXT,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('COMMENT', 'WORK', 'EPISODE', 'USER', 'AUTHOR')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status public.report_status NOT NULL DEFAULT 'PENDING',
  resolved_action TEXT,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '!123456',
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SUB_ADMIN' CHECK (role IN ('SUPER_ADMIN', 'SUB_ADMIN')),
  permissions JSONB NOT NULL DEFAULT '["DASHBOARD"]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.platform_stats (
  id TEXT PRIMARY KEY DEFAULT 'current',
  total_users BIGINT NOT NULL DEFAULT 0,
  total_authors BIGINT NOT NULL DEFAULT 0,
  total_works BIGINT NOT NULL DEFAULT 0,
  total_episodes BIGINT NOT NULL DEFAULT 0,
  total_ad_views BIGINT NOT NULL DEFAULT 0,
  total_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_author_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  service_name TEXT NOT NULL DEFAULT 'WebNovels',
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  default_writer_pool_ratio NUMERIC(6,4) NOT NULL DEFAULT 0.625,
  minimum_settlement_amount NUMERIC(14,2) NOT NULL DEFAULT 10000,
  reward_ad_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fan_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  ticket_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  capacity INT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fan_meeting_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.fan_meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.goods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ON_SALE', 'SOLD_OUT', 'HIDDEN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.goods_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  total_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RPC Functions: Sub-Admin CRUD & Management
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_admin_user(p_username TEXT, p_password TEXT, p_email TEXT, p_nickname TEXT, p_permissions TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
  v_pw_hash TEXT;
BEGIN
  BEGIN
    v_pw_hash := crypt(p_password, gen_salt('bf'));
  EXCEPTION WHEN OTHERS THEN
    v_pw_hash := p_password;
  END;

  INSERT INTO public.admin_users (username, email, password_hash, nickname, permissions, role)
  VALUES (
    p_username,
    p_email,
    v_pw_hash,
    p_nickname,
    p_permissions::jsonb,
    'SUB_ADMIN'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sub_admins()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'username', username,
      'nickname', nickname,
      'email', email,
      'role', role,
      'permissions', permissions,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ) INTO v_result
  FROM public.admin_users
  WHERE role = 'SUB_ADMIN';

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_sub_admin(p_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.admin_users WHERE id::text = p_id AND role = 'SUB_ADMIN';
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_admin_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sub_admins() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_sub_admin(TEXT) TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_users TO anon, authenticated, service_role;

