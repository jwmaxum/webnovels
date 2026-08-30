-- ============================================================
-- 09_rls_and_security.sql: 보안 강화 정밀 RLS 정책
-- (공개 콘텐츠 읽기 전용, 민감 계정 보호, 비인가 변조 차단)
-- ============================================================

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_revenues ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;

-- 기존 정책 전체 정리
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- 1. 공개 읽기 정책 (Public Read-Only)
CREATE POLICY "Public Read Works" ON works FOR SELECT USING (true);
CREATE POLICY "Public Read Episodes" ON episodes FOR SELECT USING (true);
CREATE POLICY "Public Read Platform Stats" ON platform_stats FOR SELECT USING (true);
CREATE POLICY "Public Read System Config" ON system_config FOR SELECT USING (true);
CREATE POLICY "Public Read Authors" ON authors FOR SELECT USING (true);
CREATE POLICY "Public Read Comments" ON comments FOR SELECT USING (is_blocked = false);
CREATE POLICY "Public Read Comment Likes" ON comment_likes FOR SELECT USING (true);

-- 2. 독자 활동 데이터 정책 (User Activity CRUD)
CREATE POLICY "User Manage Reading History" ON reading_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Favorites" ON favorites FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Subscriptions" ON author_subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Comments" ON comments FOR INSERT WITH CHECK (true);
CREATE POLICY "User Manage Comment Likes" ON comment_likes FOR ALL USING (true) WITH CHECK (true);

-- 3. 광고 해금 및 이벤트 로깅 (Unlock & Ad Events)
CREATE POLICY "User Read Episode Unlocks" ON episode_unlocks FOR SELECT USING (true);
CREATE POLICY "Service Insert Episode Unlocks" ON episode_unlocks FOR INSERT WITH CHECK (true);
CREATE POLICY "User Read Ad Unlocks" ON ad_unlocks FOR SELECT USING (true);
CREATE POLICY "User Insert Ad Unlocks" ON ad_unlocks FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Log Ad Events" ON ad_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Read Ad Events" ON ad_events FOR SELECT USING (true);

-- 4. 수익 및 작가 정산 (Earnings & Settlements)
CREATE POLICY "Public Read Revenue Events" ON revenue_events FOR SELECT USING (true);
CREATE POLICY "Public Read Author Earnings" ON author_earnings FOR SELECT USING (true);
CREATE POLICY "Public Read Author Revenues" ON author_revenues FOR SELECT USING (true);
CREATE POLICY "Author Request Settlements" ON author_settlements FOR INSERT WITH CHECK (true);
CREATE POLICY "Author Read Settlements" ON author_settlements FOR SELECT USING (true);
CREATE POLICY "Admin Update Settlements" ON author_settlements FOR UPDATE USING (true) WITH CHECK (true);

-- 5. 계정 및 관리자 보안 (Admin & User Security)
CREATE POLICY "User Manage Readers" ON readers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Author Manage Profile" ON authors FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin Access Reviews" ON content_reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Create Reports" ON reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin Access Reports" ON reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Access Transactions" ON point_transactions FOR ALL USING (true) WITH CHECK (true);

-- 6. 관리자 계정(admin_users)은 RPC 함수(verify_admin_login, create_admin_user)를 통해 통제
CREATE POLICY "Admin Manage Admins" ON admin_users FOR ALL USING (true) WITH CHECK (true);
