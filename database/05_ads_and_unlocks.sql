-- ============================================================
-- 05_ads_and_unlocks.sql: 회차 해금(Unlock) 및 광고 이벤트(Ad Events)
-- (광고 기반 비즈니스 모델 핵심 마스터 테이블)
-- ============================================================

-- 1. 회차 해금 마스터 테이블 (episode_unlocks)
CREATE TABLE IF NOT EXISTS episode_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  episode_id INT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  unlock_type TEXT NOT NULL CHECK (unlock_type IN ('FREE', 'REWARDED_AD', 'POINT', 'PURCHASE')),
  ad_network TEXT,
  ad_event_id TEXT,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- 보상형 광고의 경우 기본 72시간 후 만료 (NULL이면 영구)
  CONSTRAINT unique_user_episode_unlock UNIQUE(user_id, episode_id)
);

-- 기존 ad_unlocks 테이블과의 호환성을 위한 뷰/동의어 테이블 생성 (하위 호환)
CREATE TABLE IF NOT EXISTS ad_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '72 hours'),
  CONSTRAINT unique_user_episode_ad_unlock UNIQUE(user_id, episode_id)
);

-- 2. 광고 라이프사이클 이벤트 로그 (ad_events)
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
