-- WebNovels Database Schema (Production)
/* ============================================================
   WebNovels_Production_v1.sql
   Supabase PostgreSQL / Production Baseline

   핵심:
   - Supabase Auth
   - RLS + GRANT
   - Public / Private Data 분리
   - Protected Episode Content
   - Rewarded Ad Verification
   - Revenue Ledger
   - Author Earnings
   - Settlement
   - Admin RBAC
   - Audit Log
   ============================================================ */


/* ============================================================
   01. EXTENSION
   ============================================================ */

CREATE EXTENSION IF NOT EXISTS pgcrypto;


/* ============================================================
   02. PRIVATE SCHEMA
   SECURITY DEFINER 함수는 가능한 private schema에서 관리
   ============================================================ */

CREATE SCHEMA IF NOT EXISTS private;


/* ============================================================
   03. ENUMS
   ============================================================ */

DO $$
BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'content_type'
  ) THEN
    CREATE TYPE public.content_type AS ENUM (
      'NOVEL',
      'WEBTOON'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'work_status'
  ) THEN
    CREATE TYPE public.work_status AS ENUM (
      'DRAFT',
      'REVIEW',
      'PUBLISHED',
      'ONGOING',
      'PAUSED',
      'COMPLETED',
      'REJECTED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'episode_status'
  ) THEN
    CREATE TYPE public.episode_status AS ENUM (
      'DRAFT',
      'REVIEW',
      'SCHEDULED',
      'PUBLISHED',
      'HIDDEN',
      'DELETED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'access_policy'
  ) THEN
    CREATE TYPE public.access_policy AS ENUM (
      'FREE',
      'REWARDED_AD',
      'POINT',
      'PURCHASE',
      'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'unlock_type'
  ) THEN
    CREATE TYPE public.unlock_type AS ENUM (
      'FREE',
      'REWARDED_AD',
      'POINT',
      'PURCHASE',
      'MEMBERSHIP'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'settlement_status'
  ) THEN
    CREATE TYPE public.settlement_status AS ENUM (
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'PAID',
      'REJECTED',
      'ON_HOLD',
      'CANCELLED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'review_status'
  ) THEN
    CREATE TYPE public.review_status AS ENUM (
      'PENDING',
      'APPROVED',
      'REJECTED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'report_status'
  ) THEN
    CREATE TYPE public.report_status AS ENUM (
      'PENDING',
      'RESOLVED',
      'REJECTED'
    );
  END IF;

END $$;


/* ============================================================
   04. READERS
   Auth와 Profile 분리
   ============================================================ */

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


/* ============================================================
   05. AUTHORS PUBLIC PROFILE
   ============================================================ */

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


/* ============================================================
   06. AUTHORS PRIVATE PROFILE
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.author_private_profiles (
  author_id BIGINT PRIMARY KEY REFERENCES public.authors(id) ON DELETE CASCADE,
  email TEXT,
  birthdate DATE,
  address TEXT,
  tax_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   07. AUTHOR SETTLEMENT ACCOUNTS
   ============================================================ */

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


/* ============================================================
   08. WORKS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.works (
  id BIGSERIAL PRIMARY KEY,
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content_type public.content_type NOT NULL DEFAULT 'NOVEL',
  genre TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  cover_image TEXT,
  rating TEXT NOT NULL DEFAULT 'ALL' CHECK (rating IN ('ALL', '15', '18')),
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


/* ============================================================
   09. EPISODES - METADATA ONLY
   본문 없음
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.episodes (
  id BIGSERIAL PRIMARY KEY,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT NOT NULL,
  access_policy public.access_policy NOT NULL DEFAULT 'FREE',
  author_comment TEXT,
  status public.episode_status NOT NULL DEFAULT 'DRAFT',
  scheduled_at TIMESTAMPTZ,
  view_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(work_id, episode_number)
);


/* ============================================================
   10. EPISODE CONTENT
   Protected Content
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.episode_contents (
  episode_id BIGINT PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  text_content TEXT,
  content_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   11. WEBTOON PANELS
   ============================================================ */

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


/* ============================================================
   12. READING HISTORY
   ============================================================ */

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


/* ============================================================
   13. FAVORITES
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, work_id)
);


/* ============================================================
   14. AUTHOR SUBSCRIPTIONS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.author_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  notification_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, author_id)
);


/* ============================================================
   15. EPISODE UNLOCKS
   ============================================================ */

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


/* ============================================================
   16. POINT ACCOUNT
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.point_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   17. POINT TRANSACTIONS
   ============================================================ */

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


/* ============================================================
   18. AD UNITS
   ============================================================ */

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


/* ============================================================
   19. AD EVENTS
   ============================================================ */

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


/* ============================================================
   20. REVENUE PERIODS
   월별 마감
   ============================================================ */

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


/* ============================================================
   21. REVENUE LEDGER
   금액 이동 원장
   ============================================================ */

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


/* ============================================================
   22. AUTHOR EARNINGS
   ============================================================ */

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


/* ============================================================
   23. AUTHOR SETTLEMENTS
   ============================================================ */

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


/* ============================================================
   24. COMMENTS
   ============================================================ */

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


/* ============================================================
   25. COMMENT LIKES
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);


/* ============================================================
   26. CONTENT REVIEWS
   ============================================================ */

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


/* ============================================================
   27. REPORTS
   ============================================================ */

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


/* ============================================================
   28. ADMIN USERS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SUB_ADMIN' CHECK (role IN ('SUPER_ADMIN', 'SUB_ADMIN')),
  permissions JSONB NOT NULL DEFAULT '["DASHBOARD"]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   29. AUDIT LOG
   ============================================================ */

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


/* ============================================================
   30. PLATFORM STATS
   Summary / Cache 용
   ============================================================ */

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


/* ============================================================
   31. SYSTEM CONFIG
   Secret key 저장 금지
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  service_name TEXT NOT NULL DEFAULT 'WebNovels',
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  default_writer_pool_ratio NUMERIC(6,4) NOT NULL DEFAULT 0.625,
  minimum_settlement_amount NUMERIC(14,2) NOT NULL DEFAULT 10000,
  reward_ad_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   32. FAN MEETINGS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.fan_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  ticket_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  capacity INT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   33. FAN MEETING TICKETS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.fan_meeting_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.fan_meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')
  ),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   34. GOODS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.goods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT REFERENCES public.authors(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'ON_SALE', 'SOLD_OUT', 'HIDDEN')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   35. GOODS ORDERS
   ============================================================ */

CREATE TABLE IF NOT EXISTS public.goods_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  total_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


/* ============================================================
   36. INDEXES
   ============================================================ */

CREATE INDEX IF NOT EXISTS idx_works_author ON public.works(author_id);
CREATE INDEX IF NOT EXISTS idx_works_status ON public.works(status);
CREATE INDEX IF NOT EXISTS idx_works_content_type ON public.works(content_type);
CREATE INDEX IF NOT EXISTS idx_works_published ON public.works(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_episodes_work ON public.episodes(work_id, episode_number);
CREATE INDEX IF NOT EXISTS idx_episodes_status ON public.episodes(status);

CREATE INDEX IF NOT EXISTS idx_episode_unlock_user ON public.episode_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_episode_unlock_episode ON public.episode_unlocks(episode_id);

CREATE INDEX IF NOT EXISTS idx_reading_user_recent ON public.reading_history(user_id, last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_user ON public.author_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_author ON public.author_subscriptions(author_id);

CREATE INDEX IF NOT EXISTS idx_ad_events_user ON public.ad_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_events_episode ON public.ad_events(episode_id);
CREATE INDEX IF NOT EXISTS idx_ad_events_created ON public.ad_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_author_earnings_author ON public.author_earnings(author_id);
CREATE INDEX IF NOT EXISTS idx_author_earnings_date ON public.author_earnings(period_date);

CREATE INDEX IF NOT EXISTS idx_settlements_author ON public.author_settlements(author_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON public.author_settlements(status);

CREATE INDEX IF NOT EXISTS idx_comments_episode ON public.comments(episode_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.content_reviews(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);


/* ============================================================
   37. UPDATED_AT FUNCTION
   ============================================================ */

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


/* ============================================================
   38. UPDATED_AT TRIGGERS
   ============================================================ */

DROP TRIGGER IF EXISTS trg_readers_updated ON public.readers;
CREATE TRIGGER trg_readers_updated BEFORE UPDATE ON public.readers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_authors_updated ON public.authors;
CREATE TRIGGER trg_authors_updated BEFORE UPDATE ON public.authors
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_author_private_updated ON public.author_private_profiles;
CREATE TRIGGER trg_author_private_updated BEFORE UPDATE ON public.author_private_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_author_accounts_updated ON public.author_settlement_accounts;
CREATE TRIGGER trg_author_accounts_updated BEFORE UPDATE ON public.author_settlement_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_works_updated ON public.works;
CREATE TRIGGER trg_works_updated BEFORE UPDATE ON public.works
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_episodes_updated ON public.episodes;
CREATE TRIGGER trg_episodes_updated BEFORE UPDATE ON public.episodes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_system_config_updated ON public.system_config;
CREATE TRIGGER trg_system_config_updated BEFORE UPDATE ON public.system_config
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


/* ============================================================
   39. PRIVATE SECURITY DEFINER FUNCTIONS
   ============================================================ */

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = (SELECT auth.uid()) AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = (SELECT auth.uid()) AND role = 'SUPER_ADMIN' AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION private.is_author(p_author_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.authors
    WHERE id = p_author_id AND auth_user_id = (SELECT auth.uid())
  );
$$;


/* ============================================================
   40. EPISODE ACCESS FUNCTION
   Protected Content 접근 여부
   ============================================================ */

CREATE OR REPLACE FUNCTION private.can_read_episode(p_episode_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.episodes e
    WHERE e.id = p_episode_id
      AND e.status = 'PUBLISHED'
      AND (
        e.access_policy = 'FREE'
        OR EXISTS (
          SELECT 1 FROM public.episode_unlocks u
          WHERE u.episode_id = p_episode_id
            AND u.user_id = (SELECT auth.uid())
            AND u.status = 'ACTIVE'
            AND (u.expires_at IS NULL OR u.expires_at > NOW())
        )
        OR ((SELECT private.is_admin()))
      )
  );
$$;


/* ============================================================
   41. SECURE EPISODE CONTENT FUNCTION
   ============================================================ */

CREATE OR REPLACE FUNCTION private.get_episode_content(p_episode_id BIGINT)
RETURNS TABLE (episode_id BIGINT, text_content TEXT, content_version INT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $$
  SELECT c.episode_id, c.text_content, c.content_version
  FROM public.episode_contents c
  WHERE c.episode_id = p_episode_id
    AND (SELECT private.can_read_episode(p_episode_id));
$$;


/* ============================================================
   42. REWARDED AD UNLOCK
   ============================================================ */

CREATE OR REPLACE FUNCTION private.grant_rewarded_ad_unlock(
  p_user_id UUID,
  p_episode_id BIGINT,
  p_ad_event_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_event public.ad_events;
BEGIN
  SELECT * INTO v_event FROM public.ad_events
  WHERE id = p_ad_event_id AND user_id = p_user_id AND episode_id = p_episode_id
    AND event_type = 'REWARD' AND reward_granted = true;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_REWARD');
  END IF;

  INSERT INTO public.episode_unlocks (user_id, episode_id, unlock_type, source_event_id)
  VALUES (p_user_id, p_episode_id, 'REWARDED_AD', v_event.id);

  RETURN jsonb_build_object('success', true);
END;
$$;


/* ============================================================
   43. SETTLEMENT REQUEST
   ============================================================ */

CREATE OR REPLACE FUNCTION private.request_author_settlement(
  p_author_id BIGINT,
  p_amount NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_author public.authors;
  v_account public.author_settlement_accounts;
  v_minimum NUMERIC;
  v_balance NUMERIC;
  v_settlement_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.authors
    WHERE id = p_author_id AND auth_user_id = (SELECT auth.uid()) AND status = 'APPROVED'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT minimum_settlement_amount INTO v_minimum FROM public.system_config WHERE id = 'default';

  IF p_amount < v_minimum THEN
    RETURN jsonb_build_object('success', false, 'error', 'BELOW_MINIMUM');
  END IF;

  SELECT COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN author_revenue ELSE 0 END), 0)
  INTO v_balance FROM public.author_earnings WHERE author_id = p_author_id;

  SELECT * INTO v_account FROM public.author_settlement_accounts
  WHERE author_id = p_author_id AND is_primary = true AND verification_status = 'VERIFIED' LIMIT 1;

  IF v_account.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'SETTLEMENT_ACCOUNT_NOT_VERIFIED');
  END IF;

  IF p_amount > v_balance THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
  END IF;

  SELECT * INTO v_author FROM public.authors WHERE id = p_author_id;

  INSERT INTO public.author_settlements (
    author_id, author_name_snapshot, bank_name_snapshot, account_number_snapshot, account_holder_snapshot, amount
  ) VALUES (
    v_author.id, v_author.pen_name, v_account.bank_name, v_account.account_number_encrypted, v_account.account_holder, p_amount
  ) RETURNING id INTO v_settlement_id;

  RETURN jsonb_build_object('success', true, 'settlement_id', v_settlement_id);
END;
$$;


/* ============================================================
   44. AUTH USER -> READER PROFILE
   Supabase Auth Trigger
   ============================================================ */

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data ->> 'user_type', 'READER') = 'READER' THEN
    INSERT INTO public.readers (id, username, nickname, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
      NEW.raw_user_meta_data ->> 'nickname',
      NEW.email
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


/* ============================================================
   45. DEFAULT CONFIG
   ============================================================ */

INSERT INTO public.system_config (id, service_name, default_writer_pool_ratio, minimum_settlement_amount, reward_ad_enabled)
VALUES ('default', 'WebNovels', 0.625, 10000, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_stats (id)
VALUES ('current')
ON CONFLICT (id) DO NOTHING;


/* ============================================================
   46. RLS ENABLE
   ============================================================ */

ALTER TABLE public.readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_private_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_settlement_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_panels ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reading_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_unlocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.point_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ad_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_ledger ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.author_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author_settlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fan_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fan_meeting_tickets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_orders ENABLE ROW LEVEL SECURITY;


/* ============================================================
   47. PUBLIC READ POLICIES
   ============================================================ */

DROP POLICY IF EXISTS p_public_works ON public.works;
CREATE POLICY p_public_works ON public.works
FOR SELECT TO public
USING (status IN ('PUBLISHED', 'ONGOING', 'COMPLETED'));

DROP POLICY IF EXISTS p_public_episodes ON public.episodes;
CREATE POLICY p_public_episodes ON public.episodes
FOR SELECT TO public
USING (status = 'PUBLISHED');

DROP POLICY IF EXISTS p_public_authors ON public.authors;
CREATE POLICY p_public_authors ON public.authors
FOR SELECT TO public
USING (status = 'APPROVED');

DROP POLICY IF EXISTS p_public_comments ON public.comments;
CREATE POLICY p_public_comments ON public.comments
FOR SELECT TO public
USING (is_deleted = false AND is_blocked = false);

DROP POLICY IF EXISTS p_public_fan_meetings ON public.fan_meetings;
CREATE POLICY p_public_fan_meetings ON public.fan_meetings
FOR SELECT TO public
USING (status = 'OPEN');

DROP POLICY IF EXISTS p_public_goods ON public.goods;
CREATE POLICY p_public_goods ON public.goods
FOR SELECT TO public
USING (status = 'ON_SALE');

DROP POLICY IF EXISTS p_public_platform_stats ON public.platform_stats;
CREATE POLICY p_public_platform_stats ON public.platform_stats
FOR SELECT TO public
USING (true);

DROP POLICY IF EXISTS p_public_system_config ON public.system_config;
CREATE POLICY p_public_system_config ON public.system_config
FOR SELECT TO public
USING (true);


/* ============================================================
   48. READER POLICIES
   ============================================================ */

DROP POLICY IF EXISTS p_reader_self_select ON public.readers;
CREATE POLICY p_reader_self_select ON public.readers
FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_reader_self_update ON public.readers;
CREATE POLICY p_reader_self_update ON public.readers
FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_reading_history_user ON public.reading_history;
CREATE POLICY p_reading_history_user ON public.reading_history
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_favorites_user ON public.favorites;
CREATE POLICY p_favorites_user ON public.favorites
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_subscriptions_user ON public.author_subscriptions;
CREATE POLICY p_subscriptions_user ON public.author_subscriptions
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_unlocks_user ON public.episode_unlocks;
CREATE POLICY p_unlocks_user ON public.episode_unlocks
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_point_accounts_user ON public.point_accounts;
CREATE POLICY p_point_accounts_user ON public.point_accounts
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_point_transactions_user ON public.point_transactions;
CREATE POLICY p_point_transactions_user ON public.point_transactions
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_comments_insert ON public.comments;
CREATE POLICY p_comments_insert ON public.comments
FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_comments_user_update ON public.comments;
CREATE POLICY p_comments_user_update ON public.comments
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_comment_likes_user ON public.comment_likes;
CREATE POLICY p_comment_likes_user ON public.comment_likes
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS p_reports_insert ON public.reports;
CREATE POLICY p_reports_insert ON public.reports
FOR INSERT TO authenticated
WITH CHECK (reporter_id = (SELECT auth.uid()));


/* ============================================================
   49. AUTHOR POLICIES
   ============================================================ */

DROP POLICY IF EXISTS p_author_private_self ON public.author_private_profiles;
CREATE POLICY p_author_private_self ON public.author_private_profiles
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS p_author_accounts_self ON public.author_settlement_accounts;
CREATE POLICY p_author_accounts_self ON public.author_settlement_accounts
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS p_author_works_self ON public.works;
CREATE POLICY p_author_works_self ON public.works
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS p_author_episodes_self ON public.episodes;
CREATE POLICY p_author_episodes_self ON public.episodes
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.works w
    JOIN public.authors a ON a.id = w.author_id
    WHERE w.id = work_id AND a.auth_user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.works w
    JOIN public.authors a ON a.id = w.author_id
    WHERE w.id = work_id AND a.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS p_author_earnings_self ON public.author_earnings;
CREATE POLICY p_author_earnings_self ON public.author_earnings
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS p_author_settlements_self ON public.author_settlements;
CREATE POLICY p_author_settlements_self ON public.author_settlements
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.authors a
    WHERE a.id = author_id AND a.auth_user_id = (SELECT auth.uid())
  )
);


/* ============================================================
   50. ADMIN POLICIES
   ============================================================ */

DROP POLICY IF EXISTS p_admin_all_readers ON public.readers;
CREATE POLICY p_admin_all_readers ON public.readers
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_authors ON public.authors;
CREATE POLICY p_admin_all_authors ON public.authors
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_private_profiles ON public.author_private_profiles;
CREATE POLICY p_admin_all_private_profiles ON public.author_private_profiles
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_accounts ON public.author_settlement_accounts;
CREATE POLICY p_admin_all_accounts ON public.author_settlement_accounts
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_works ON public.works;
CREATE POLICY p_admin_all_works ON public.works
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_episodes ON public.episodes;
CREATE POLICY p_admin_all_episodes ON public.episodes
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_contents ON public.episode_contents;
CREATE POLICY p_admin_all_contents ON public.episode_contents
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_panels ON public.episode_panels;
CREATE POLICY p_admin_all_panels ON public.episode_panels
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_reviews ON public.content_reviews;
CREATE POLICY p_admin_all_reviews ON public.content_reviews
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_reports ON public.reports;
CREATE POLICY p_admin_all_reports ON public.reports
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_ad_units ON public.ad_units;
CREATE POLICY p_admin_all_ad_units ON public.ad_units
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_ad_events ON public.ad_events;
CREATE POLICY p_admin_all_ad_events ON public.ad_events
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_revenue_periods ON public.revenue_periods;
CREATE POLICY p_admin_all_revenue_periods ON public.revenue_periods
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_revenue_ledger ON public.revenue_ledger;
CREATE POLICY p_admin_all_revenue_ledger ON public.revenue_ledger
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_settlements ON public.author_settlements;
CREATE POLICY p_admin_all_settlements ON public.author_settlements
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS p_admin_all_audit_logs ON public.audit_logs;
CREATE POLICY p_admin_all_audit_logs ON public.audit_logs
FOR ALL TO authenticated
USING ((SELECT private.is_admin()))
WITH CHECK ((SELECT private.is_admin()));


/* ============================================================
   51. GRANTS & REVOKES
   ============================================================ */

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ANON GRANTS
GRANT SELECT ON public.works TO anon;
GRANT SELECT ON public.episodes TO anon;
GRANT SELECT ON public.authors TO anon;
GRANT SELECT ON public.comments TO anon;
GRANT SELECT ON public.platform_stats TO anon;
GRANT SELECT ON public.system_config TO anon;
GRANT SELECT ON public.fan_meetings TO anon;
GRANT SELECT ON public.goods TO anon;

-- AUTHENTICATED GRANTS
GRANT SELECT, UPDATE ON public.readers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reading_history TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.favorites TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.author_subscriptions TO authenticated;
GRANT SELECT ON public.episode_unlocks TO authenticated;
GRANT SELECT ON public.point_accounts TO authenticated;
GRANT SELECT ON public.point_transactions TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.comment_likes TO authenticated;
GRANT INSERT ON public.reports TO authenticated;

GRANT SELECT, UPDATE ON public.author_private_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.author_settlement_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.works TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.episodes TO authenticated;
GRANT SELECT ON public.author_earnings TO authenticated;
GRANT SELECT ON public.author_settlements TO authenticated;

GRANT SELECT, INSERT ON public.fan_meeting_tickets TO authenticated;
GRANT SELECT, INSERT ON public.goods_orders TO authenticated;

-- CRITICAL REVOKES
REVOKE ALL ON public.episode_contents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.episode_panels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.author_private_profiles FROM anon;
REVOKE ALL ON public.author_settlement_accounts FROM anon;
REVOKE ALL ON public.revenue_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_users FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;

REVOKE EXECUTE ON FUNCTION private.grant_rewarded_ad_unlock(UUID, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.request_author_settlement(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated;


/* ============================================================
   52. VIEWS (프론트엔드 최적화 뷰)
   ============================================================ */

CREATE OR REPLACE VIEW public.v_public_works AS
SELECT
  w.id,
  w.author_id,
  a.pen_name AS author_name,
  w.title,
  w.content_type,
  w.genre,
  w.tags,
  w.description,
  w.cover_image,
  w.rating,
  w.status,
  w.is_completed,
  w.is_top_recommended,
  w.is_popular_work,
  w.is_new_work,
  w.ai_usage_type,
  w.view_count,
  w.like_count,
  w.published_at,
  w.created_at,
  (
    SELECT COUNT(*)::INT
    FROM public.episodes e
    WHERE e.work_id = w.id AND e.status = 'PUBLISHED'
  ) AS episodes_count
FROM public.works w
JOIN public.authors a ON a.id = w.author_id
WHERE w.status IN ('PUBLISHED', 'ONGOING', 'COMPLETED');

CREATE OR REPLACE VIEW public.v_public_episodes AS
SELECT
  e.id,
  e.work_id,
  w.title AS work_title,
  e.episode_number,
  e.title,
  e.access_policy,
  e.author_comment,
  e.status,
  e.view_count,
  e.created_at
FROM public.episodes e
JOIN public.works w ON w.id = e.work_id
WHERE e.status = 'PUBLISHED';

CREATE OR REPLACE VIEW public.v_author_earnings_summary AS
SELECT
  a.id AS author_id,
  a.pen_name,
  COALESCE(SUM(CASE WHEN e.status = 'ESTIMATED' THEN e.author_revenue ELSE 0 END), 0) AS estimated_revenue,
  COALESCE(SUM(CASE WHEN e.status = 'CONFIRMED' THEN e.author_revenue ELSE 0 END), 0) AS confirmed_revenue,
  COALESCE(SUM(CASE WHEN e.status = 'SETTLED' THEN e.author_revenue ELSE 0 END), 0) AS settled_revenue
FROM public.authors a
LEFT JOIN public.author_earnings e ON e.author_id = a.id
GROUP BY a.id, a.pen_name;

GRANT SELECT ON public.v_public_works TO anon, authenticated;
GRANT SELECT ON public.v_public_episodes TO anon, authenticated;
GRANT SELECT ON public.v_author_earnings_summary TO authenticated;


/* ============================================================
   53. SECURITY NOTE
   ============================================================ */

/*
  반드시 환경변수/Secret 관리:
  SUPABASE_SERVICE_ROLE_KEY
  TOSS_SECRET_KEY
  KCP_SITE_KEY
  AD_NETWORK_SECRET
  WEBHOOK_SECRET

  DB의 system_config에는 Secret을 저장하지 않는다.
*/


