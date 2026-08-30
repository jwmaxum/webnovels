-- WebNovels Production DB: 06_advertisement.sql
-- 광고 유닛 및 광고 이벤트 원장

-- 1. 광고 지면 및 네트워크 단위
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

-- 2. 광고 발생 및 보상 검증 이벤트 원장
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
