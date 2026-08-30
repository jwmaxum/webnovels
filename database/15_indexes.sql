-- WebNovels Production DB: 15_indexes.sql
-- 고성능 조인 및 검색 인덱스

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
