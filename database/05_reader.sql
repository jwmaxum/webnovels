-- WebNovels Production DB: 05_reader.sql
-- 독자 활동, 언락 이력, 포인트 계정 및 트랜잭션 원장

-- 1. 독서 진행 이력
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

-- 2. 관심 작품 (즐겨찾기)
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, work_id)
);

-- 3. 작가 구독 및 알림
CREATE TABLE IF NOT EXISTS public.author_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  notification_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, author_id)
);

-- 4. 회차 언락(해금) 이력
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

-- 5. 포인트 계정 (잔액)
CREATE TABLE IF NOT EXISTS public.point_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. 포인트 거래 원장
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
