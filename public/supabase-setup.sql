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

-- 10. 최고 관리자 계정 시드
INSERT INTO admin_users (email, username, password_hash, nickname, role, permissions)
VALUES (
  'jwmaxum@gmail.com',
  'super_admin',
  crypt('sang@4478000', gen_salt('bf')),
  '최고관리자',
  'SUPER_ADMIN',
  '["DASHBOARD","USER_MGMT","AUTHOR_MGMT","WORK_MGMT","EPISODE_MGMT","CONTENT_REVIEW","COMMENT_REPORT","AD_MGMT","AD_REVENUE","AUTHOR_SETTLEMENT","FAN_MEETING","GOODS_MGMT","EVENT_MGMT","ANALYTICS","SYSTEM_MGMT","SECURITY_MGMT"]'::jsonb
) ON CONFLICT (email) DO NOTHING;

-- 11. 작품(works) 및 회차(episodes) 스키마 생성 및 시드 데이터
CREATE TABLE IF NOT EXISTS works (
  id INT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  genre TEXT[] NOT NULL,
  tags TEXT[] NOT NULL,
  description TEXT,
  cover_image TEXT,
  view_count INT DEFAULT 0,
  status TEXT DEFAULT 'ONGOING',
  is_top_recommended BOOLEAN DEFAULT false,
  is_popular_work BOOLEAN DEFAULT false,
  is_new_work BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS episodes (
  id SERIAL PRIMARY KEY,
  work_id INT REFERENCES works(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT NOT NULL,
  is_free BOOLEAN DEFAULT true,
  is_ad_free BOOLEAN DEFAULT false,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon read works" ON works;
DROP POLICY IF EXISTS "Allow anon read episodes" ON episodes;
DROP POLICY IF EXISTS "Allow anon full access works" ON works;
DROP POLICY IF EXISTS "Allow anon full access episodes" ON episodes;

CREATE POLICY "Allow anon full access works" ON works FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access episodes" ON episodes FOR ALL USING (true) WITH CHECK (true);

-- 8개 작품 시드 데이터
INSERT INTO works (id, title, author, genre, tags, description, cover_image, view_count) VALUES
(1, '대적자: 신을 삼킨 기사', '판타지마스터', ARRAY['판타지', '전체이용가'], ARRAY['AI NONE'], '신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'stormqueen_oath.jpg', 154000),
(2, '천마의 귀환', '무협의신', ARRAY['무협', '전체이용가'], ARRAY['AI NONE'], '천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'sword_dao_supreme.jpg', 231000),
(3, '금기의 계약', '나이트로즈', ARRAY['성인', '19세 이상'], ARRAY['AI NONE'], '금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'velvet_and_thorns.jpg', 189000),
(4, '황제의 유일한 후궁', '로맨스퀸', ARRAY['로맨스', '전체이용가'], ARRAY['AI NONE'], '황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'flower_blooming.jpg', 312000),
(5, '성간 항로: 마지막 항해사', '스페이스로그', ARRAY['SF', '전체이용가'], ARRAY['AI NONE'], '인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'stellar_horizon.jpg', 97000),
(6, '서울에 나타난 마왕', '도시마법사', ARRAY['현대 판타지', '전체이용가'], ARRAY['AI NONE'], '현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'seoul_sorcerer.jpg', 278000),
(7, '죽은 자들의 학교', '공포작가', ARRAY['호러', '전체이용가'], ARRAY['AI NONE'], '폐교에 남은 것들. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'darkness_swallowed_classroom.jpg', 84000),
(8, '검의 전설: 천하제일인', '검성', ARRAY['무협', '전체이용가'], ARRAY['AI NONE'], '천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!', 'sword_dao_defies_heavens.jpg', 195000)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, cover_image = EXCLUDED.cover_image, description = EXCLUDED.description;

-- 32개 에피소드 시드 데이터
INSERT INTO episodes (work_id, episode_number, title, is_free, is_ad_free, content) VALUES
(1, 1, '제1화', true, false, '신의 저주로 멸망한 왕국에서 한 기사가 깨어나 처음으로 자신의 힘을 깨닫는다.'),
(1, 2, '제2화', true, false, '기사는 폐허가 된 성에서 고대의 검을 발견하고 신의 잔당과 첫 전투를 벌인다.'),
(1, 3, '제3화', true, false, '동료를 잃은 기사는 복수를 다짐하며 신의 사도가 숨은 탑으로 향한다.'),
(1, 4, '제4화', false, true, '탑 정상에서 마주한 신은 기사에게 충격적인 진실을 알려준다.'),
(2, 1, '제1화', true, false, '천마는 수백 년의 봉인에서 깨어나 자신이 누구인지 기억해 내기 시작한다.'),
(2, 2, '제2화', true, false, '옛 제자들의 후손을 만난 천마는 무림의 변화를 확인하고 첫 번째 적을 쓰러뜨린다.'),
(2, 3, '제3화', true, false, '천마는 잃어버린 검법을 되찾기 위해 금지된 동굴로 들어간다.'),
(2, 4, '제4화', false, true, '동굴 안에서 천마는 자신을 봉인한 자의 후예와 운명적인 대면을 한다.'),
(3, 1, '제1화', true, false, '여주인공은 빚을 갚기 위해 정체불명의 남자와 위험한 계약을 맺는다.'),
(3, 2, '제2화', true, false, '계약의 첫 번째 조건이 실행되고, 두 사람 사이에 묘한 긴장감이 흐른다.'),
(3, 3, '제3화', true, false, '남자의 정체가 조금씩 드러나며 여주인공은 빠져나올 수 없는 감정에 휩싸인다.'),
(3, 4, '제4화', false, true, '계약의 진짜 목적이 밝혀지고, 두 사람의 관계는 돌이킬 수 없는 방향으로 흐른다.'),
(4, 1, '제1화', true, false, '평범한 처녀가 황제의 간택을 받아 궁에 들어가며 새로운 삶을 시작한다.'),
(4, 2, '제2화', true, false, '황제와의 첫 대면에서 그녀는 그의 차가운 눈빛 속에 숨겨진 외로움을 느낀다.'),
(4, 3, '제3화', true, false, '후궁들의 시기 속에서 그녀는 황제의 유일한 관심을 받게 된다.'),
(4, 4, '제4화', false, true, '황제가 그녀에게만 보여 주는 부드러운 모습에 마음이 흔들리기 시작한다.'),
(5, 1, '제1화', true, false, '마지막 항해사는 지구가 멸망한 후 남은 인류를 태우고 미지의 별로 출발한다.'),
(5, 2, '제2화', true, false, '항해 중 발견한 고대 외계 유물에서 충격적인 메시지가 해독된다.'),
(5, 3, '제3화', true, false, '함선에 침입한 미지의 존재가 승무원들을 하나씩 사라지게 만든다.'),
(5, 4, '제4화', false, true, '항해사는 함선의 AI와 함께 적의 정체를 밝혀내고 생존을 위한 결단을 내린다.'),
(6, 1, '제1화', true, false, '평범한 회사원 김현우는 퇴근길에 마왕의 힘이 자신에게 깃드는 것을 느낀다.'),
(6, 2, '제2화', true, false, '처음으로 마법을 사용한 현우는 우연히 마족을 쓰러뜨리고 자신의 정체를 숨기려 한다.'),
(6, 3, '제3화', true, false, '마법사 협회가 그를 추적하기 시작하고, 현우는 도망치며 힘을 다스리는 법을 배운다.'),
(6, 4, '제4화', false, true, '현우는 자신을 노리는 진짜 적이 마족이 아닌 인간이라는 사실을 알게 된다.'),
(7, 1, '제1화', true, false, '폐교 탐사를 온 학생들은 이상한 발소리와 함께 문이 저절로 닫히는 것을 경험한다.'),
(7, 2, '제2화', true, false, '한 명이 사라지고, 남은 학생들은 복도 끝에서 교복을 입은 그림자를 목격한다.'),
(7, 3, '제3화', true, false, '학교 지하실에서 발견된 일기장은 과거에 일어난 참극을 상세히 기록하고 있다.'),
(7, 4, '제4화', false, true, '일기장의 주인공이 눈앞에 나타나며, 학생들은 자신들이 이미 죽은 존재일지도 모른다는 공포에 휩싸인다.'),
(8, 1, '제1화', true, false, '하급 무사 이천은 우연히 전설의 검을 손에 넣고 자신의 운명이 바뀌는 것을 느낀다.'),
(8, 2, '제2화', true, false, '검을 노리는 암살자들을 물리친 이천은 검에 깃든 고대 검성의 기억을 일부 받아들인다.'),
(8, 3, '제3화', true, false, '이천은 무림맹의 초대를 받아 처음으로 강호에 자신의 이름을 알리기 시작한다.'),
(8, 4, '제4화', false, true, '천하제일인 자리에서 마주한 강자는 이천에게 검의 진짜 주인에 대한 비밀을 암시한다.');

-- 12. 독자 회원(readers) 및 작가 회원(authors) 스키마 & 실데이터 시드
CREATE TABLE IF NOT EXISTS readers (
  id INT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_adult_verified BOOLEAN DEFAULT false,
  subscription_status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS authors (
  id INT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  pen_name TEXT NOT NULL,
  work_title TEXT NOT NULL,
  birthdate DATE NOT NULL,
  address TEXT NOT NULL,
  bank_info TEXT NOT NULL,
  status TEXT DEFAULT 'APPROVED',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- 작가 회원 8명 시드 데이터 (작품DB와 1:1 매칭)
INSERT INTO authors (id, username, password_hash, email, pen_name, work_title, birthdate, address, bank_info, status) VALUES
(1, 'writer1', '!123456', 'writer1@webnovels.com', '판타지마스터', '대적자: 신을 삼킨 기사', '1990-01-15', '서울특별시 강남구 테헤란로 123', '국민은행 999-888-777666', '공식 인증 작가'),
(2, 'writer2', '!123456', 'writer2@webnovels.com', '무협의신', '천마의 귀환', '1985-05-20', '서울특별시 서초구 반포대로 45', '신한은행 110-222-333444', '공식 인증 작가'),
(3, 'writer3', '!123456', 'writer3@webnovels.com', '나이트로즈', '금기의 계약', '1992-08-12', '경기도 성남시 분당구 판교로 78', '우리은행 1002-555-666777', '공식 인증 작가'),
(4, 'writer4', '!123456', 'writer4@webnovels.com', '로맨스퀸', '황제의 유일한 후궁', '1994-11-03', '서울특별시 마포구 월드컵북로 99', '하나은행 222-333-444555', '공식 인증 작가'),
(5, 'writer5', '!123456', 'writer5@webnovels.com', '스페이스로그', '성간 항로: 마지막 항해사', '1988-03-30', '대전광역시 유성구 대학로 100', '농협 301-777-888999', '공식 인증 작가'),
(6, 'writer6', '!123456', 'writer6@webnovels.com', '도시마법사', '서울에 나타난 마왕', '1995-07-07', '서울특별시 송파구 올림픽로 200', '카카오뱅크 3333-01-234567', '공식 인증 작가'),
(7, 'writer7', '!123456', 'writer7@webnovels.com', '공포작가', '죽은 자들의 학교', '1991-10-31', '부산광역시 해운대구 센텀서로 30', '기업은행 010-9999-8888', '공식 인증 작가'),
(8, 'writer8', '!123456', 'writer8@webnovels.com', '검성', '검의 전설: 천하제일인', '1987-12-25', '대구광역시 수성구 달구벌대로 500', '대구은행 508-12-345678', '공식 인증 작가')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, address = EXCLUDED.address, bank_info = EXCLUDED.bank_info;

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


