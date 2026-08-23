-- ============================================================
-- WebNovels Supabase 관리자 테이블 셋업 SQL
-- Supabase Dashboard > SQL Editor 에서 실행하세요
-- ============================================================

-- 1. 관리자 사용자 테이블 (Supabase Auth와 별도의 관리자 전용 테이블)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SUB_ADMIN' CHECK (role IN ('SUPER_ADMIN', 'SUB_ADMIN')),
  permissions JSONB DEFAULT '["DASHBOARD"]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 수익 이벤트 테이블
CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month TEXT NOT NULL,
  gross_revenue NUMERIC NOT NULL DEFAULT 0,
  ad_network_fee NUMERIC NOT NULL DEFAULT 0,
  net_revenue NUMERIC NOT NULL DEFAULT 0,
  writer_pool_ratio NUMERIC NOT NULL DEFAULT 0.625,
  writer_pool NUMERIC NOT NULL DEFAULT 0,
  platform_revenue NUMERIC NOT NULL DEFAULT 0,
  is_closed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 작가 정산 테이블
CREATE TABLE IF NOT EXISTS author_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'REJECTED')),
  bank_info TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- 4. 시스템 설정 테이블
CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  toss_client_key TEXT DEFAULT 'test_ck_docs_O7l2mZ1N3p81A2jL3b5z',
  toss_secret_key TEXT DEFAULT 'test_sk_docs_O7l2mZ1N3p81A2jL3b5z',
  toss_mid TEXT DEFAULT 'tosspayments',
  toss_mode TEXT DEFAULT 'TEST',
  kcp_site_code TEXT DEFAULT 'T0000',
  kcp_site_key TEXT DEFAULT '3383f5080e729a67a57a8a1c0d48',
  kcp_mode TEXT DEFAULT 'TEST',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 통계 요약 뷰 (대시보드 KPI용)
CREATE TABLE IF NOT EXISTS platform_stats (
  id TEXT PRIMARY KEY DEFAULT 'current',
  total_users INT DEFAULT 0,
  total_authors INT DEFAULT 0,
  total_works INT DEFAULT 0,
  total_episodes INT DEFAULT 0,
  total_ad_views INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. RLS 활성화 및 관리자 전용 테이블 anon key 접근 허용
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_stats ENABLE ROW LEVEL SECURITY;

-- 멱등성 보장을 위해 기존 정책이 있으면 삭제 후 재생성 (재실행 시 에러 방지)
DROP POLICY IF EXISTS "Allow anon full access" ON admin_users;
DROP POLICY IF EXISTS "Allow anon full access" ON revenue_events;
DROP POLICY IF EXISTS "Allow anon full access" ON author_settlements;
DROP POLICY IF EXISTS "Allow anon full access" ON system_config;
DROP POLICY IF EXISTS "Allow anon full access" ON platform_stats;

CREATE POLICY "Allow anon full access" ON admin_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON revenue_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON author_settlements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON system_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON platform_stats FOR ALL USING (true) WITH CHECK (true);

-- 7. 초기 시스템 설정 삽입
INSERT INTO system_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- 8. 초기 통계 삽입
INSERT INTO platform_stats (id, total_users, total_authors, total_works, total_episodes, total_ad_views)
VALUES ('current', 1250, 48, 127, 1893, 54200)
ON CONFLICT (id) DO NOTHING;

-- 9. 비밀번호 해싱 함수 (pgcrypto 확장)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 10. 최고 관리자 계정 시드 (ID: jwmaxum@gmail.com, PW: SUPER_ADMIN_PASSWORD_REDACTED)
INSERT INTO admin_users (email, username, password_hash, nickname, role, permissions, is_active)
VALUES (
  'jwmaxum@gmail.com',
  'super_admin',
  crypt('SUPER_ADMIN_PASSWORD_REDACTED', gen_salt('bf')),
  '최고관리자',
  'SUPER_ADMIN',
  '["DASHBOARD","USER_MGMT","AUTHOR_MGMT","WORK_MGMT","EPISODE_MGMT","CONTENT_REVIEW","COMMENT_REPORT","AD_MGMT","AD_REVENUE","AUTHOR_SETTLEMENT","FAN_MEETING","GOODS_MGMT","EVENT_MGMT","ANALYTICS","SYSTEM_MGMT","SECURITY_MGMT"]'::jsonb,
  true
) ON CONFLICT (email) DO UPDATE 
SET password_hash = crypt('SUPER_ADMIN_PASSWORD_REDACTED', gen_salt('bf')),
    role = 'SUPER_ADMIN',
    permissions = '["DASHBOARD","USER_MGMT","AUTHOR_MGMT","WORK_MGMT","EPISODE_MGMT","CONTENT_REVIEW","COMMENT_REPORT","AD_MGMT","AD_REVENUE","AUTHOR_SETTLEMENT","FAN_MEETING","GOODS_MGMT","EVENT_MGMT","ANALYTICS","SYSTEM_MGMT","SECURITY_MGMT"]'::jsonb,
    is_active = true;

-- 11. 작품(works) 및 회차(episodes) 스키마 생성 및 시드 데이터 (웹소설 & 웹툰 지원)
CREATE TABLE IF NOT EXISTS works (
  id INT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'NOVEL', -- 'NOVEL'(웹소설), 'WEBTOON'(웹툰)
  genre TEXT[] NOT NULL,
  tags TEXT[] NOT NULL,
  description TEXT,
  cover_image TEXT,
  view_count INT DEFAULT 0,
  status TEXT DEFAULT 'ONGOING', -- 'ONGOING', 'PAUSED', 'COMPLETED'
  is_completed BOOLEAN DEFAULT false,
  is_top_recommended BOOLEAN DEFAULT false,
  is_popular_work BOOLEAN DEFAULT false,
  is_new_work BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 works 테이블이 이미 생성되어 있을 경우를 대비한 컬럼 마이그레이션
ALTER TABLE works ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'NOVEL';
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_top_recommended BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_popular_work BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_new_work BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS episodes (
  id SERIAL PRIMARY KEY,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT NOT NULL,
  is_free BOOLEAN DEFAULT true,
  is_ad_free BOOLEAN DEFAULT false,
  content TEXT, -- 웹소설 텍스트 본문
  image_urls JSONB DEFAULT '[]'::jsonb, -- 웹툰 컷 이미지 URL 배열
  author_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_work_episode UNIQUE (work_id, episode_number)
);

-- 기존 episodes 테이블이 이미 생성되어 있을 경우를 대비한 컬럼 마이그레이션
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS author_comment TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT true;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_ad_free BOOLEAN DEFAULT false;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS content TEXT;

-- 12. 독자 포인트 거래 내역 테이블 (point_transactions)
CREATE TABLE IF NOT EXISTS point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'CHARGE', 'USE', 'REFUND'
  amount INT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  episode_id INT REFERENCES episodes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. 회차별 댓글 및 좋아요 테이블 (comments, comment_likes)
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  likes_count INT DEFAULT 0,
  is_blocked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_comment_like UNIQUE (comment_id, user_id)
);

-- 14. 콘텐츠 심사/검수 테이블 (content_reviews - 운영자용)
CREATE TABLE IF NOT EXISTS content_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_id INT REFERENCES episodes(id) ON DELETE CASCADE,
  work_title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reject_reason TEXT,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. 신고/제재 관리 테이블 (reports - 운영자용)
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL, -- 'COMMENT', 'WORK', 'EPISODE'
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'REJECTED')),
  resolved_action TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon full access works" ON works;
DROP POLICY IF EXISTS "Allow anon full access episodes" ON episodes;
DROP POLICY IF EXISTS "Allow anon full access point_transactions" ON point_transactions;
DROP POLICY IF EXISTS "Allow anon full access comments" ON comments;
DROP POLICY IF EXISTS "Allow anon full access comment_likes" ON comment_likes;
DROP POLICY IF EXISTS "Allow anon full access content_reviews" ON content_reviews;
DROP POLICY IF EXISTS "Allow anon full access reports" ON reports;

CREATE POLICY "Allow anon full access works" ON works FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access episodes" ON episodes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access point_transactions" ON point_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access comments" ON comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access comment_likes" ON comment_likes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access content_reviews" ON content_reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access reports" ON reports FOR ALL USING (true) WITH CHECK (true);

-- 10개 대표 작품 시드 데이터 (웹소설 8개 + 웹툰 2개)
INSERT INTO works (id, title, author, content_type, genre, tags, description, cover_image, view_count, is_completed, is_top_recommended, is_popular_work, is_new_work) VALUES
(1, '대적자: 신을 삼킨 기사', '판타지마스터', 'NOVEL', ARRAY['판타지', '전체이용가'], ARRAY['AI NONE', '기사', '성장'], '신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'stormqueen_oath.jpg', 154000, false, true, true, false),
(2, '천마의 귀환', '무협의신', 'NOVEL', ARRAY['무협', '전체이용가'], ARRAY['AI NONE', '천마', '회귀'], '천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'sword_dao_supreme.jpg', 231000, false, true, true, false),
(3, '금기의 계약', '나이트로즈', 'NOVEL', ARRAY['성인', '19세 이상'], ARRAY['AI NONE', '치명적', '로맨스'], '금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'velvet_and_thorns.jpg', 189000, false, false, true, false),
(4, '황제의 유일한 후궁', '로맨스퀸', 'NOVEL', ARRAY['로맨스', '전체이용가'], ARRAY['AI NONE', '궁중', '애절'], '황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'flower_blooming.jpg', 312000, false, true, true, false),
(5, '성간 항로: 마지막 항해사', '스페이스로그', 'NOVEL', ARRAY['SF', '전체이용가'], ARRAY['AI NONE', '우주', '생존'], '인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'stellar_horizon.jpg', 97000, false, false, false, true),
(6, '서울에 나타난 마왕', '도시마법사', 'NOVEL', ARRAY['현대 판타지', '전체이용가'], ARRAY['AI NONE', '현대', '마왕'], '현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'seoul_sorcerer.jpg', 278000, false, false, true, true),
(7, '죽은 자들의 학교', '공포작가', 'NOVEL', ARRAY['호러', '전체이용가'], ARRAY['AI NONE', '폐교', '미스터리'], '폐교에 남은 것들. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'darkness_swallowed_classroom.jpg', 84000, true, false, false, true),
(8, '검의 전설: 천하제일인', '검성', 'NOVEL', ARRAY['무협', '전체이용가'], ARRAY['AI NONE', '검술', '절대자'], '천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'sword_dao_defies_heavens.jpg', 195000, true, false, true, false),
(9, '[웹툰] 신의 기사단', '판타지마스터', 'WEBTOON', ARRAY['판타지', '액션'], ARRAY['웹툰', '풀컬러', '고화질'], '대적자 스핀오프 공식 웹툰! 화려한 작화로 펼쳐지는 기사단의 모험.', 'stormqueen_oath.jpg', 89000, false, false, true, true),
(10, '[웹툰] 황후의 비밀 화원', '로맨스퀸', 'WEBTOON', ARRAY['로맨스', '순정'], ARRAY['웹툰', '궁중로맨스', '풀컬러'], '황실 최고의 비밀이 담긴 화원에서 피어나는 은밀하고 달콤한 로맨스 웹툰.', 'flower_blooming.jpg', 124000, false, false, true, true)
ON CONFLICT (id) DO UPDATE SET 
  title = EXCLUDED.title, 
  content_type = EXCLUDED.content_type, 
  cover_image = EXCLUDED.cover_image, 
  description = EXCLUDED.description,
  is_completed = EXCLUDED.is_completed;

-- 50+개 에피소드 시드 데이터 (웹소설 본문 & 웹툰 이미지)
INSERT INTO episodes (work_id, episode_number, title, is_free, is_ad_free, content, image_urls, author_comment) VALUES
(1, 1, '제 1 화', true, false, '본 회차는 1회차 입니다. 신의 저주로 멸망한 왕국에서 한 기사가 깨어나 처음으로 자신의 힘을 깨닫는다.', '[]'::jsonb, '첫 화를 읽어주셔서 감사합니다!'),
(1, 2, '제 2 화', true, false, '본 회차는 2회차 입니다. 기사는 폐허가 된 성에서 고대의 검을 발견하고 신의 잔당과 첫 전투를 벌인다.', '[]'::jsonb, '구독과 댓글은 큰 힘이 됩니다.'),
(1, 3, '제 3 화', true, false, '본 회차는 3회차 입니다. 동료를 잃은 기사는 복수를 다짐하며 신의 사도가 숨은 탑으로 향한다.', '[]'::jsonb, '3화까지 무료입니다! 4화부터는 광고 시청 또는 포인트로 즐겨주세요.'),
(1, 4, '제 4 화', false, true, '본 회차는 4회차 입니다. 탑 정상에서 마주한 신은 기사에게 충격적인 진실을 알려준다.', '[]'::jsonb, '광고를 시청해 주셔서 감사합니다.'),
(1, 5, '제 5 화', false, true, '본 회차는 5회차 입니다. 진실을 마주한 기사는 새로운 각성을 맞이하고 반격에 나선다.', '[]'::jsonb, '치열한 전투가 시작됩니다.'),
(1, 6, '제 6 화', false, true, '본 회차는 6회차 입니다. 대륙의 명운을 건 최후의 결전이 눈앞으로 다가온다.', '[]'::jsonb, '다음 시즌도 기대해주세요!'),

(9, 1, '제 1 화: 각성', true, false, '', '["/images/stormqueen_oath.jpg", "/images/sword_dao_supreme.jpg"]'::jsonb, '웹툰 신의 기사단 연재를 시작합니다!'),
(9, 2, '제 2 화: 검의 인도', true, false, '', '["/images/sword_dao_supreme.jpg", "/images/stormqueen_oath.jpg"]'::jsonb, '매주 수요일 풀컬러 업데이트!'),
(9, 3, '제 3 화: 사도의 그림자', true, false, '', '["/images/stormqueen_oath.jpg", "/images/sword_dao_supreme.jpg"]'::jsonb, '재밌게 보셨다면 별점 부탁드립니다!'),
(9, 4, '제 4 화: 결전의 서막', false, true, '', '["/images/sword_dao_supreme.jpg", "/images/stormqueen_oath.jpg"]'::jsonb, '광고 보고 무료로 감상하세요!'),

(10, 1, '제 1 화: 은밀한 만남', true, false, '', '["/images/flower_blooming.jpg", "/images/velvet_and_thorns.jpg"]'::jsonb, '황후의 비밀 화원 첫 회입니다.'),
(10, 2, '제 2 화: 붉은 장미의 향기', true, false, '', '["/images/flower_blooming.jpg", "/images/velvet_and_thorns.jpg"]'::jsonb, '많은 사랑 부탁드립니다.'),
(10, 3, '제 3 화: 밝혀진 정체', true, false, '', '["/images/flower_blooming.jpg", "/images/velvet_and_thorns.jpg"]'::jsonb, '3화 무료 공개!'),
(10, 4, '제 4 화: 피할 수 없는 운명', false, true, '', '["/images/velvet_and_thorns.jpg", "/images/flower_blooming.jpg"]'::jsonb, '다음 이야기가 계속됩니다.')
ON CONFLICT (work_id, episode_number) DO UPDATE SET 
  title = EXCLUDED.title, 
  is_free = EXCLUDED.is_free, 
  is_ad_free = EXCLUDED.is_ad_free, 
  content = EXCLUDED.content,
  image_urls = EXCLUDED.image_urls,
  author_comment = EXCLUDED.author_comment;

-- 독자 및 작가 테이블 마이그레이션 호환
ALTER TABLE readers ADD COLUMN IF NOT EXISTS is_adult_verified BOOLEAN DEFAULT false;
ALTER TABLE readers ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'ACTIVE';
ALTER TABLE authors ADD COLUMN IF NOT EXISTS pen_name TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS work_title TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS bank_info TEXT;
ALTER TABLE authors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'APPROVED';

ALTER TABLE readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read readers" ON readers;
DROP POLICY IF EXISTS "Allow anon read authors" ON authors;

CREATE POLICY "Allow anon read readers" ON readers FOR SELECT USING (true);
CREATE POLICY "Allow anon read authors" ON authors FOR SELECT USING (true);

-- 독자 회원 3명 시드 데이터 (더미 데이터 삭제 및 실데이터 등록)
INSERT INTO readers (id, username, password_hash, email, phone, is_adult_verified, subscription_status) VALUES
(1, 'reader1', '!12345', 'reader1@webnovels.com', '+82-010-111-1111', false, '일반 회원'),
(2, 'reader2', '!12345', 'reader2@webnovels.com', '+82-010-111-1112', true, '프리미엄 구독중'),
(3, 'reader3', '!12345', 'reader3@webnovels.com', '+82-010-111-1113', true, '프리미엄 구독중')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone, is_adult_verified = EXCLUDED.is_adult_verified;

-- 작가 회원 10명 시드 데이터 (작품DB와 1:1 매칭, ID: writer1~10@webnovels.com, PW: !12345)
INSERT INTO authors (id, username, password_hash, email, pen_name, work_title, birthdate, address, bank_info, status) VALUES
(1, 'writer1', '!12345', 'writer1@webnovels.com', '판타지마스터', '대적자: 신을 삼킨 기사', '1990-01-15', '서울특별시 강남구 테헤란로 123', '국민은행 999-888-777666', '공식 인증 작가'),
(2, 'writer2', '!12345', 'writer2@webnovels.com', '무협의신', '천마의 귀환', '1985-05-20', '서울특별시 서초구 반포대로 45', '신한은행 110-222-333444', '공식 인증 작가'),
(3, 'writer3', '!12345', 'writer3@webnovels.com', '나이트로즈', '금기의 계약', '1992-08-12', '경기도 성남시 분당구 판교로 78', '우리은행 1002-555-666777', '공식 인증 작가'),
(4, 'writer4', '!12345', 'writer4@webnovels.com', '로맨스퀸', '황제의 유일한 후궁', '1994-11-03', '서울특별시 마포구 월드컵북로 99', '하나은행 222-333-444555', '공식 인증 작가'),
(5, 'writer5', '!12345', 'writer5@webnovels.com', '스페이스로그', '성간 항로: 마지막 항해사', '1988-03-30', '대전광역시 유성구 대학로 100', '농협 301-777-888999', '공식 인증 작가'),
(6, 'writer6', '!12345', 'writer6@webnovels.com', '도시마법사', '서울에 나타난 마왕', '1995-07-07', '서울특별시 송파구 올림픽로 200', '카카오뱅크 3333-01-234567', '공식 인증 작가'),
(7, 'writer7', '!12345', 'writer7@webnovels.com', '공포작가', '죽은 자들의 학교', '1991-10-31', '부산광역시 해운대구 센텀서로 30', '기업은행 010-9999-8888', '공식 인증 작가'),
(8, 'writer8', '!12345', 'writer8@webnovels.com', '검성', '검의 전설: 천하제일인', '1987-12-25', '대구광역시 수성구 달구벌대로 500', '대구은행 508-12-345678', '공식 인증 작가'),
(9, 'writer9', '!12345', 'writer9@webnovels.com', '스튜디오노바', '[웹툰] 신의 기사단', '1993-04-10', '서울특별시 마포구 독막로 50', '국민은행 111-222-333444', '공식 인증 작가'),
(10, 'writer10', '!12345', 'writer10@webnovels.com', '로즈코믹스', '[웹툰] 황후의 비밀 화원', '1996-09-18', '서울특별시 강남구 학동로 20', '신한은행 333-444-555666', '공식 인증 작가')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, address = EXCLUDED.address, bank_info = EXCLUDED.bank_info;

-- 14. 관리자용 RPC 함수 (보안 검증 및 생성)
CREATE OR REPLACE FUNCTION verify_admin_login(p_email TEXT, p_password TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin admin_users;
BEGIN
  SELECT * INTO v_admin FROM admin_users WHERE email = p_email OR username = p_email;
  
  IF v_admin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
  END IF;

  -- 1. Bcrypt 해시 검증 (SUPER_ADMIN 및 신규 생성된 SUB_ADMIN)
  IF v_admin.password_hash = crypt(p_password, v_admin.password_hash) THEN
    RETURN jsonb_build_object(
      'success', true,
      'admin', jsonb_build_object(
        'id', v_admin.id,
        'email', v_admin.email,
        'username', v_admin.username,
        'nickname', v_admin.nickname,
        'role', v_admin.role,
        'permissions', v_admin.permissions
      )
    );
  END IF;
  
  -- 2. 평문 암호 검증 (RPC 적용 전 과거에 생성된 호환성 SUB_ADMIN)
  IF v_admin.password_hash = p_password THEN
    RETURN jsonb_build_object(
      'success', true,
      'admin', jsonb_build_object(
        'id', v_admin.id,
        'email', v_admin.email,
        'username', v_admin.username,
        'nickname', v_admin.nickname,
        'role', v_admin.role,
        'permissions', v_admin.permissions
      )
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Invalid credentials');
END;
$$;

CREATE OR REPLACE FUNCTION create_admin_user(p_username TEXT, p_password TEXT, p_email TEXT, p_nickname TEXT, p_permissions TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO admin_users (username, email, password_hash, nickname, permissions, role)
  VALUES (p_username, p_email, crypt(p_password, gen_salt('bf')), p_nickname, p_permissions::jsonb, 'SUB_ADMIN')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


