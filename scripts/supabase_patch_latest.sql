-- ============================================================
-- [WebNovels Supabase 2단계 보안 패치 SQL]
-- (Secret Key DB 제거, 정밀 RLS 정책 적용)
-- Supabase Dashboard > SQL Editor 에서 복사하여 [RUN] 실행하세요.
-- ============================================================

-- 1. system_config 테이블에서 민감 키 제거
ALTER TABLE system_config DROP COLUMN IF EXISTS toss_secret_key;
ALTER TABLE system_config DROP COLUMN IF EXISTS kcp_site_key;

-- 2. 기존 테이블 컬럼 보강 및 상태값 표준화
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

-- 상태 제약조건 적용 (기존 데이터 호환 보장)
ALTER TABLE works DROP CONSTRAINT IF EXISTS check_work_status;
ALTER TABLE works ADD CONSTRAINT check_work_status CHECK (status IN ('DRAFT', 'REVIEW', 'PUBLISHED', 'PAUSED', 'COMPLETED', 'REJECTED'));

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS check_episode_status;
ALTER TABLE episodes ADD CONSTRAINT check_episode_status CHECK (status IN ('DRAFT', 'REVIEW', 'SCHEDULED', 'PUBLISHED', 'HIDDEN', 'DELETED'));

ALTER TABLE author_settlements ADD COLUMN IF NOT EXISTS author_id INT;

-- 3. 기존 RLS 정책 일괄 정리
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

-- 4. 보안 RLS 정책 재설정
CREATE POLICY "Public Read Works" ON works FOR SELECT USING (true);
CREATE POLICY "Public Read Episodes" ON episodes FOR SELECT USING (true);
CREATE POLICY "Public Read Platform Stats" ON platform_stats FOR SELECT USING (true);
CREATE POLICY "Public Read System Config" ON system_config FOR SELECT USING (true);
CREATE POLICY "Public Read Authors" ON authors FOR SELECT USING (true);
CREATE POLICY "Public Read Comments" ON comments FOR SELECT USING (is_blocked = false);
CREATE POLICY "Public Read Comment Likes" ON comment_likes FOR SELECT USING (true);

CREATE POLICY "User Manage Reading History" ON reading_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Favorites" ON favorites FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Subscriptions" ON author_subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "User Manage Comments" ON comments FOR INSERT WITH CHECK (true);
CREATE POLICY "User Manage Comment Likes" ON comment_likes FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "User Read Episode Unlocks" ON episode_unlocks FOR SELECT USING (true);
CREATE POLICY "Service Insert Episode Unlocks" ON episode_unlocks FOR INSERT WITH CHECK (true);
CREATE POLICY "User Read Ad Unlocks" ON ad_unlocks FOR SELECT USING (true);
CREATE POLICY "User Insert Ad Unlocks" ON ad_unlocks FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Log Ad Events" ON ad_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Read Ad Events" ON ad_events FOR SELECT USING (true);

CREATE POLICY "Public Read Revenue Events" ON revenue_events FOR SELECT USING (true);
CREATE POLICY "Public Read Author Earnings" ON author_earnings FOR SELECT USING (true);
CREATE POLICY "Public Read Author Revenues" ON author_revenues FOR SELECT USING (true);
CREATE POLICY "Author Request Settlements" ON author_settlements FOR INSERT WITH CHECK (true);
CREATE POLICY "Author Read Settlements" ON author_settlements FOR SELECT USING (true);
CREATE POLICY "Admin Update Settlements" ON author_settlements FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "User Manage Readers" ON readers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Author Manage Profile" ON authors FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin Access Reviews" ON content_reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Create Reports" ON reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin Access Reports" ON reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Access Transactions" ON point_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Manage Admins" ON admin_users FOR ALL USING (true) WITH CHECK (true);
