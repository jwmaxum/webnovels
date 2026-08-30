-- ============================================================
-- 10_indexes.sql: 쿼리 속도 및 조인 성능 최적화 인덱스
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_works_author_id ON works(author_id);
CREATE INDEX IF NOT EXISTS idx_works_content_type ON works(content_type);
CREATE INDEX IF NOT EXISTS idx_episodes_work_id ON episodes(work_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_user_id ON reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_history_work_ep ON reading_history(work_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_author_subs_user_id ON author_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_episode_unlocks_user_ep ON episode_unlocks(user_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_ad_unlocks_user_ep ON ad_unlocks(user_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_ad_events_user_id ON ad_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_events_type ON ad_events(event_type);
CREATE INDEX IF NOT EXISTS idx_author_earnings_author_date ON author_earnings(author_id, period_date);
CREATE INDEX IF NOT EXISTS idx_author_settlements_author_id ON author_settlements(author_id);
CREATE INDEX IF NOT EXISTS idx_author_settlements_author_name ON author_settlements(author_name);
CREATE INDEX IF NOT EXISTS idx_author_settlements_status ON author_settlements(status);
CREATE INDEX IF NOT EXISTS idx_comments_work_ep ON comments(work_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_content_reviews_status ON content_reviews(status);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_revenue_events_period ON revenue_events(period_month);
