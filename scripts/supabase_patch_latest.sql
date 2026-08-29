-- ============================================================
-- [WebNovels Supabase 패치 & 마이그레이션 통합 SQL]
-- Supabase Dashboard > SQL Editor 에서 복사하여 [RUN] 실행하세요.
-- ============================================================

-- 1. 회차(episodes) 테이블: Zero-Touch 예약 연재 지원 컬럼 추가
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PUBLISHED';
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS author_comment TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT true;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_ad_free BOOLEAN DEFAULT false;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS content TEXT;

-- 2. 작품(works) 테이블: 연령등급, AI 활용 유형, 추천수 컬럼 추가
ALTER TABLE works ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'NOVEL';
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_top_recommended BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_popular_work BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_new_work BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT 'ALL';
ALTER TABLE works ADD COLUMN IF NOT EXISTS ai_usage_type TEXT DEFAULT 'NONE';
ALTER TABLE works ADD COLUMN IF NOT EXISTS like_count INT DEFAULT 0;

-- 3. 독자(readers) 테이블: 닉네임, 독서 이력, 찜, 구독, 기본 암호 설정
ALTER TABLE readers ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS is_adult_verified BOOLEAN DEFAULT false;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT '일반 회원';
ALTER TABLE readers ADD COLUMN IF NOT EXISTS reading_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS favorites JSONB DEFAULT '[]'::jsonb;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS subscribed_authors JSONB DEFAULT '[]'::jsonb;
ALTER TABLE readers ALTER COLUMN password_hash SET DEFAULT '!12345';

-- 4. 작가(authors) 테이블: 필명, 대표작, 정산 계좌, 인증 상태
ALTER TABLE authors ADD COLUMN IF NOT EXISTS pen_name TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS work_title TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS bank_info TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '공식 인증 작가';

-- 5. 작가 정산(author_settlements) 테이블 제약조건 및 컬럼 보장
CREATE TABLE IF NOT EXISTS author_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'REJECTED')),
  bank_info TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- 6. 콘텐츠 심사(content_reviews) 및 독자 신고(reports) 테이블 보장
CREATE TABLE IF NOT EXISTS content_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id INT,
  episode_id INT,
  work_title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reject_reason TEXT,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'REJECTED')),
  resolved_action TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. RLS 정책 일괄 갱신 (익명 클라이언트 쓰기 및 읽기 전체 허용)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon full access admin_users" ON admin_users;
DROP POLICY IF EXISTS "Allow anon full access revenue_events" ON revenue_events;
DROP POLICY IF EXISTS "Allow anon full access author_settlements" ON author_settlements;
DROP POLICY IF EXISTS "Allow anon full access system_config" ON system_config;
DROP POLICY IF EXISTS "Allow anon full access platform_stats" ON platform_stats;
DROP POLICY IF EXISTS "Allow anon full access works" ON works;
DROP POLICY IF EXISTS "Allow anon full access episodes" ON episodes;
DROP POLICY IF EXISTS "Allow anon full access readers" ON readers;
DROP POLICY IF EXISTS "Allow anon full access authors" ON authors;
DROP POLICY IF EXISTS "Allow anon full access content_reviews" ON content_reviews;
DROP POLICY IF EXISTS "Allow anon full access reports" ON reports;

CREATE POLICY "Allow anon full access admin_users" ON admin_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access revenue_events" ON revenue_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access author_settlements" ON author_settlements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access system_config" ON system_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access platform_stats" ON platform_stats FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access works" ON works FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access episodes" ON episodes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access readers" ON readers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access authors" ON authors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access content_reviews" ON content_reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access reports" ON reports FOR ALL USING (true) WITH CHECK (true);

-- 8. 쿼리 속도 최적화 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_author_settlements_author_name ON author_settlements(author_name);
CREATE INDEX IF NOT EXISTS idx_author_settlements_status ON author_settlements(status);
CREATE INDEX IF NOT EXISTS idx_content_reviews_status ON content_reviews(status);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_episodes_work_id ON episodes(work_id);
CREATE INDEX IF NOT EXISTS idx_works_content_type ON works(content_type);
CREATE INDEX IF NOT EXISTS idx_revenue_events_period ON revenue_events(period_month);
