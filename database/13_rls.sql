-- WebNovels Production DB: 13_rls.sql
-- 25개 전 테이블 Row Level Security (RLS) 활성화 및 세부 정책 정의

-- 1. RLS 활성화
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


-- 2. PUBLIC READ POLICIES (누구나 조회 가능한 공개 데이터)

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


-- 3. READER POLICIES (독자 본인 데이터 제어)

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


-- 4. AUTHOR POLICIES (작가 본인 데이터 제어)

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


-- 5. ADMIN POLICIES (관리자 전용 제어)

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
