-- ============================================================
-- [WebNovels Supabase 최종 정규화 패치 & 마이그레이션 SQL]
-- (episode_unlocks, ad_events, author_earnings, author_settlements 스냅샷, 대댓글 지원)
-- Supabase Dashboard > SQL Editor 에서 복사하여 [RUN] 실행하세요.
-- ============================================================

-- 1. 신규 정규화 테이블 생성
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

-- 2. 기존 테이블 컬럼 보강
ALTER TABLE works ADD COLUMN IF NOT EXISTS author_id INT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS like_count INT DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_works_author'
  ) THEN
    ALTER TABLE works ADD CONSTRAINT fk_works_author FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_id INT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS bank_name_snapshot TEXT;
ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS account_number_snapshot TEXT;

ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. platform_stats 30작품/180회차/30작가/10독자 일관화
INSERT INTO platform_stats (id, total_users, total_authors, total_works, total_episodes, total_ad_views)
VALUES ('current', 10, 30, 30, 180, 54200)
ON CONFLICT (id) DO UPDATE SET
  total_users = 10,
  total_authors = 30,
  total_works = 30,
  total_episodes = 180,
  total_ad_views = 54200;

-- 4. RLS 정책 일괄 보장
ALTER TABLE episode_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon full access episode_unlocks" ON episode_unlocks;
DROP POLICY IF EXISTS "Allow anon full access ad_events" ON ad_events;
DROP POLICY IF EXISTS "Allow anon full access author_earnings" ON author_earnings;

CREATE POLICY "Allow anon full access episode_unlocks" ON episode_unlocks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access ad_events" ON ad_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access author_earnings" ON author_earnings FOR ALL USING (true) WITH CHECK (true);

-- 5. 인덱스
CREATE INDEX IF NOT EXISTS idx_episode_unlocks_user_ep ON episode_unlocks(user_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_ad_events_user_id ON ad_events(user_id);
CREATE INDEX IF NOT EXISTS idx_author_earnings_author_date ON author_earnings(author_id, period_date);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
