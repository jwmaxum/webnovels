-- ============================================================
-- 04_reader_activity.sql: 독자 활동 정규화 테이블
-- (독서 이력, 관심 작품, 작가 팬 구독)
-- ============================================================

-- 1. 독서 진행률 및 최근 열람 기록 (reading_history)
CREATE TABLE IF NOT EXISTS reading_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  progress NUMERIC DEFAULT 0,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_episode_read UNIQUE(user_id, episode_id)
);

-- 2. 독자 관심 작품 등록/북마크 (favorites)
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_work_favorite UNIQUE(user_id, work_id)
);

-- 3. 작가 팬 구독 (author_subscriptions)
CREATE TABLE IF NOT EXISTS author_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  author_id INT REFERENCES authors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_author_subscription UNIQUE(user_id, author_id)
);
