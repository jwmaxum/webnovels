-- WebNovels Production DB: 11_system.sql
-- 플랫폼 캐시 통계, 시스템 환경설정(시크릿 제외), 보안 감사 로그 및 updated_at 트리거

-- 1. 플랫폼 통계 요약 (Cache)
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

-- 2. 시스템 환경설정 (Secret Key 저장 금지)
CREATE TABLE IF NOT EXISTS public.system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  service_name TEXT NOT NULL DEFAULT 'WebNovels',
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  default_writer_pool_ratio NUMERIC(6,4) NOT NULL DEFAULT 0.625,
  minimum_settlement_amount NUMERIC(14,2) NOT NULL DEFAULT 10000,
  reward_ad_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 관리자 보안 감사 로그 (Audit Log)
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

-- 4. UPDATED_AT 트리거 함수 및 바인딩
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

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

-- 기본 레코드 초기화
INSERT INTO public.system_config (id, service_name, default_writer_pool_ratio, minimum_settlement_amount, reward_ad_enabled)
VALUES ('default', 'WebNovels', 0.625, 10000, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_stats (id)
VALUES ('current')
ON CONFLICT (id) DO NOTHING;
