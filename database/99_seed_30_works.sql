-- ============================================================
-- 99_seed_30_works.sql: 30개 작품, 180회차, 30명 작가, 10명 독자 실데이터 시드
-- (platform_stats 10독자 / 30작가 / 30작품 / 180회차 1:1 완벽 일치)
-- ============================================================

-- 1. 최고 관리자 계정 시드
INSERT INTO admin_users (email, username, password_hash, nickname, role, permissions, is_active)
VALUES (
  'jwmaxum@gmail.com',
  'super_admin',
  crypt('SUPER_ADMIN_INITIAL_PASSWORD', gen_salt('bf')),
  '최고관리자',
  'SUPER_ADMIN',
  '["DASHBOARD","USER_MGMT","AUTHOR_MGMT","WORK_MGMT","EPISODE_MGMT","CONTENT_REVIEW","COMMENT_REPORT","AD_MGMT","AD_REVENUE","AUTHOR_SETTLEMENT","FAN_MEETING","GOODS_MGMT","EVENT_MGMT","ANALYTICS","SYSTEM_MGMT","SECURITY_MGMT"]'::jsonb,
  true
) ON CONFLICT (email) DO UPDATE 
SET role = 'SUPER_ADMIN',
    permissions = '["DASHBOARD","USER_MGMT","AUTHOR_MGMT","WORK_MGMT","EPISODE_MGMT","CONTENT_REVIEW","COMMENT_REPORT","AD_MGMT","AD_REVENUE","AUTHOR_SETTLEMENT","FAN_MEETING","GOODS_MGMT","EVENT_MGMT","ANALYTICS","SYSTEM_MGMT","SECURITY_MGMT"]'::jsonb,
    is_active = true;

-- 2. 시스템 설정 및 KPI 통계 시드
INSERT INTO system_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

INSERT INTO platform_stats (id, total_users, total_authors, total_works, total_episodes, total_ad_views)
VALUES ('current', 10, 30, 30, 180, 18)
ON CONFLICT (id) DO UPDATE SET
  total_users = 10,
  total_authors = 30,
  total_works = 30,
  total_episodes = 180,
  total_ad_views = 18;

-- 3. 독자 회원 10명 실데이터 시드 (readers)
INSERT INTO readers (id, username, password_hash, email, phone, is_adult_verified, subscription_status) VALUES
(1, 'reader1', '!12345', 'reader1@webnovels.com', '+82-010-111-1111', false, '일반 회원'),
(2, 'reader2', '!12345', 'reader2@webnovels.com', '+82-010-111-1112', true, '프리미엄 구독중'),
(3, 'reader3', '!12345', 'reader3@webnovels.com', '+82-010-111-1113', true, '프리미엄 구독중'),
(4, 'reader4', '!12345', 'reader4@webnovels.com', '+82-010-111-1114', false, 'VIP 회원'),
(5, 'reader5', '!12345', 'reader5@webnovels.com', '+82-010-111-1115', true, '일반 회원'),
(6, 'reader6', '!12345', 'reader6@webnovels.com', '+82-010-111-1116', false, '일반 회원'),
(7, 'reader7', '!12345', 'reader7@webnovels.com', '+82-010-111-1117', true, '프리미엄 구독중'),
(8, 'reader8', '!12345', 'reader8@webnovels.com', '+82-010-111-1118', false, 'VIP 회원'),
(9, 'reader9', '!12345', 'reader9@webnovels.com', '+82-010-111-1119', true, '일반 회원'),
(10, 'reader10', '!12345', 'reader10@webnovels.com', '+82-010-111-1120', true, '프리미엄 구독중')
ON CONFLICT (id) DO UPDATE SET 
  email = EXCLUDED.email, 
  phone = EXCLUDED.phone, 
  is_adult_verified = EXCLUDED.is_adult_verified,
  subscription_status = EXCLUDED.subscription_status;

-- 4. 등록 작가 30명 실데이터 시드 (authors)
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
(10, 'writer10', '!12345', 'writer10@webnovels.com', '로즈코믹스', '[웹툰] 황후의 비밀 화원', '1996-09-18', '서울특별시 강남구 학동로 20', '신한은행 333-444-555666', '공식 인증 작가'),
(11, 'writer11', '!12345', 'writer11@webnovels.com', '밤샘작가', 'SSS급 헌터의 편의점', '1990-01-15', '서울특별시 강남구 테헤란로 100', '카카오뱅크 3333-00-123456', '공식 인증 작가'),
(12, 'writer12', '!12345', 'writer12@webnovels.com', '청명검', '화산파 막내 제자의 검', '1991-02-15', '서울특별시 강남구 테헤란로 101', '카카오뱅크 3333-01-123456', '공식 인증 작가'),
(13, 'writer13', '!12345', 'writer13@webnovels.com', '로즈가든', '악녀는 조용히 살고 싶다', '1992-03-15', '서울특별시 강남구 테헤란로 102', '카카오뱅크 3333-02-123456', '공식 인증 작가'),
(14, 'writer14', '!12345', 'writer14@webnovels.com', '영혼술사', '네크로맨서로 살아남기', '1993-04-15', '서울특별시 강남구 테헤란로 103', '카카오뱅크 3333-03-123456', '공식 인증 작가'),
(15, 'writer15', '!12345', 'writer15@webnovels.com', '초코라떼', '달콤한 오피스 스캔들', '1994-05-15', '서울특별시 강남구 테헤란로 104', '카카오뱅크 3333-04-123456', '공식 인증 작가'),
(16, 'writer16', '!12345', 'writer16@webnovels.com', '메카닉스', '사이버펑크 2099: 네온 서울', '1995-06-15', '서울특별시 강남구 테헤란로 105', '카카오뱅크 3333-05-123456', '공식 인증 작가'),
(17, 'writer17', '!12345', 'writer17@webnovels.com', '퇴마사', '퇴마록: 어둠의 사냥꾼', '1996-07-15', '서울특별시 강남구 테헤란로 106', '카카오뱅크 3333-06-123456', '공식 인증 작가'),
(18, 'writer18', '!12345', 'writer18@webnovels.com', '룬마스터', '아카데미 천재 마법사', '1997-08-15', '서울특별시 강남구 테헤란로 107', '카카오뱅크 3333-07-123456', '공식 인증 작가'),
(19, 'writer19', '!12345', 'writer19@webnovels.com', '머니파워', '재벌집 막내아들의 비밀투자', '1998-09-15', '서울특별시 강남구 테헤란로 108', '카카오뱅크 3333-08-123456', '공식 인증 작가'),
(20, 'writer20', '!12345', 'writer20@webnovels.com', '홀리나이트', '망겜의 성기사가 되었다', '1999-10-15', '서울특별시 강남구 테헤란로 109', '카카오뱅크 3333-09-123456', '공식 인증 작가'),
(21, 'writer21', '!12345', 'writer21@webnovels.com', '블랙툰', '[웹툰] 그림자 군주의 재림', '1990-11-15', '서울특별시 강남구 테헤란로 110', '카카오뱅크 3333-10-123456', '공식 인증 작가'),
(22, 'writer22', '!12345', 'writer22@webnovels.com', '핑크베리', '[웹툰] 공작가의 시한부 영애', '1991-12-15', '서울특별시 강남구 테헤란로 111', '카카오뱅크 3333-11-123456', '공식 인증 작가'),
(23, 'writer23', '!12345', 'writer23@webnovels.com', '썬더스튜디오', '[웹툰] 던전 브레이크 헌터', '1992-01-15', '서울특별시 강남구 테헤란로 112', '카카오뱅크 3333-12-123456', '공식 인증 작가'),
(24, 'writer24', '!12345', 'writer24@webnovels.com', '코믹스쿨', '[웹툰] 마왕님은 카페 알바중', '1993-02-15', '서울특별시 강남구 테헤란로 113', '카카오뱅크 3333-13-123456', '공식 인증 작가'),
(25, 'writer25', '!12345', 'writer25@webnovels.com', '무협코믹스', '[웹툰] 천하제일 마교교주', '1994-03-15', '서울특별시 강남구 테헤란로 114', '카카오뱅크 3333-14-123456', '공식 인증 작가'),
(26, 'writer26', '!12345', 'writer26@webnovels.com', '디멘션', '차원 이동자의 레벨업', '1995-04-15', '서울특별시 강남구 테헤란로 115', '카카오뱅크 3333-15-123456', '공식 인증 작가'),
(27, 'writer27', '!12345', 'writer27@webnovels.com', '고메마스터', '비선실세가 된 셰프', '1996-05-15', '서울특별시 강남구 테헤란로 116', '카카오뱅크 3333-16-123456', '공식 인증 작가'),
(28, 'writer28', '!12345', 'writer28@webnovels.com', '스칼렛', '버림받은 황녀의 복수극', '1997-06-15', '서울특별시 강남구 테헤란로 117', '카카오뱅크 3333-17-123456', '공식 인증 작가'),
(29, 'writer29', '!12345', 'writer29@webnovels.com', '드래곤랩', '[웹툰] 드래곤 하트', '1998-07-15', '서울특별시 강남구 테헤란로 118', '카카오뱅크 3333-18-123456', '공식 인증 작가'),
(30, 'writer30', '!12345', 'writer30@webnovels.com', '미드나잇', '심야 라디오 괴담', '1999-08-15', '서울특별시 강남구 테헤란로 119', '카카오뱅크 3333-19-123456', '공식 인증 작가')
ON CONFLICT (id) DO UPDATE SET 
  pen_name = EXCLUDED.pen_name,
  work_title = EXCLUDED.work_title,
  email = EXCLUDED.email, 
  address = EXCLUDED.address, 
  bank_info = EXCLUDED.bank_info;

-- 5. 연재 작품 30개 실데이터 시드 (works - author_id 1:1 매핑)
INSERT INTO works (id, author_id, title, author, content_type, genre, tags, description, cover_image, view_count, is_completed, is_top_recommended, is_popular_work, is_new_work) VALUES
(1, 1, '대적자: 신을 삼킨 기사', '판타지마스터', 'NOVEL', ARRAY['판타지', '전체이용가'], ARRAY['AI NONE', '기사', '성장'], '신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'stormqueen_oath.jpg', 42, false, true, true, false),
(2, 2, '천마의 귀환', '무협의신', 'NOVEL', ARRAY['무협', '전체이용가'], ARRAY['AI NONE', '천마', '회귀'], '천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'sword_dao_supreme.jpg', 38, false, true, true, false),
(3, 3, '금기의 계약', '나이트로즈', 'NOVEL', ARRAY['성인', '19세 이상'], ARRAY['AI NONE', '치명적', '로맨스'], '금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'velvet_and_thorns.jpg', 29, false, false, true, false),
(4, 4, '황제의 유일한 후궁', '로맨스퀸', 'NOVEL', ARRAY['로맨스', '전체이용가'], ARRAY['AI NONE', '궁중', '애절'], '황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'flower_blooming.jpg', 35, false, true, true, false),
(5, 5, '성간 항로: 마지막 항해사', '스페이스로그', 'NOVEL', ARRAY['SF', '전체이용가'], ARRAY['AI NONE', '우주', '생존'], '인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'stellar_horizon.jpg', 18, false, false, false, true),
(6, 6, '서울에 나타난 마왕', '도시마법사', 'NOVEL', ARRAY['현대 판타지', '전체이용가'], ARRAY['AI NONE', '현대', '마왕'], '현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'seoul_sorcerer.jpg', 24, false, false, true, true),
(7, 7, '죽은 자들의 학교', '공포작가', 'NOVEL', ARRAY['호러', '전체이용가'], ARRAY['AI NONE', '폐교', '미스터리'], '폐교에 남은 것들. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'darkness_swallowed_classroom.jpg', 12, true, false, false, true),
(8, 8, '검의 전설: 천하제일인', '검성', 'NOVEL', ARRAY['무협', '전체이용가'], ARRAY['AI NONE', '검술', '절대자'], '천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'sword_dao_defies_heavens.jpg', 31, true, false, true, false),
(9, 9, '[웹툰] 신의 기사단', '스튜디오노바', 'WEBTOON', ARRAY['판타지', '액션'], ARRAY['웹툰', '풀컬러', '고화질'], '대적자 스핀오프 공식 웹툰! 화려한 작화로 펼쳐지는 기사단의 모험.', 'stormqueen_oath.jpg', 26, false, false, true, true),
(10, 10, '[웹툰] 황후의 비밀 화원', '로즈코믹스', 'WEBTOON', ARRAY['로맨스', '순정'], ARRAY['웹툰', '궁중로맨스', '풀컬러'], '황실 최고의 비밀이 담긴 화원에서 피어나는 은밀하고 달콤한 로맨스 웹툰.', 'flower_blooming.jpg', 22, false, false, true, true),
(11, 11, 'SSS급 헌터의 편의점', '밤샘작가', 'NOVEL', ARRAY['현대 판타지', '전체이용가'], ARRAY['헌터', '각성', '힐링'], '던전 앞 편의점에서 물건을 팔았을 뿐인데 세계 최강이 되었다.', 'novel_1.svg', 40, false, true, true, false),
(12, 12, '화산파 막내 제자의 검', '청명검', 'NOVEL', ARRAY['무협', '전체이용가'], ARRAY['화산파', '검술', '환생'], '멸망한 화산을 재건하기 위해 300년 전으로 환생한 매화검객의 전설.', 'novel_3.svg', 37, false, true, true, false),
(13, 13, '악녀는 조용히 살고 싶다', '로즈가든', 'NOVEL', ARRAY['로맨스', '전체이용가'], ARRAY['로판', '악녀빙의', '사이다'], '소설 속 악녀로 빙의했다. 파멸을 피하기 위해 조용히 살려는데 황태자가 집착한다.', 'novel_2.svg', 33, false, false, true, false),
(14, 14, '네크로맨서로 살아남기', '영혼술사', 'NOVEL', ARRAY['판타지', '전체이용가'], ARRAY['네크로맨서', '언데드', '성장'], '죽은 자들을 이끌고 최악의 미궁을 탈출하는 어둠의 마도사 일대기.', 'novel_1.svg', 25, false, false, false, true),
(15, 15, '달콤한 오피스 스캔들', '초코라떼', 'NOVEL', ARRAY['성인', '19세 이상'], ARRAY['오피스', '비밀연애', '사내로맨스'], '냉철한 대표님과 야근 중 벌어진 아찔하고 은밀한 하룻밤.', 'novel_2.svg', 28, false, false, true, false),
(16, 16, '사이버펑크 2099: 네온 서울', '메카닉스', 'NOVEL', ARRAY['SF', '전체이용가'], ARRAY['사이버펑크', '해커', '디스토피아'], '인공지능과 거대 기업이 지배하는 2099년 서울, 한 해커의 마지막 저항.', 'novel_4.svg', 16, false, false, false, true),
(17, 17, '퇴마록: 어둠의 사냥꾼', '퇴마사', 'NOVEL', ARRAY['호러', '전체이용가'], ARRAY['퇴마', '오컬트', '괴담'], '도심 속에 숨어든 악귀들을 사냥하는 퇴마 기사단의 처절한 사투.', 'novel_4.svg', 14, true, false, false, false),
(18, 18, '아카데미 천재 마법사', '룬마스터', 'NOVEL', ARRAY['판타지', '전체이용가'], ARRAY['아카데미', '마법', '먼치킨'], '마법 명문 아카데미에 입학한 낙제생, 사실은 마법의 근원을 본 자였다.', 'novel_1.svg', 45, false, true, true, false),
(19, 19, '재벌집 막내아들의 비밀투자', '머니파워', 'NOVEL', ARRAY['현대 판타지', '전체이용가'], ARRAY['재벌', '투자', '회귀'], '과거로 돌아간 흙수저, 미래의 지식으로 대한민국 1위 재벌이 되다.', 'novel_3.svg', 39, false, false, true, false),
(20, 20, '망겜의 성기사가 되었다', '홀리나이트', 'NOVEL', ARRAY['판타지', '전체이용가'], ARRAY['게임빙의', '성기사', '사이다'], '서비스 종료 직전의 망겜 속 최고 난이도 성기사 캐릭터에 빙의했다.', 'novel_1.svg', 21, false, false, false, true),
(21, 21, '[웹툰] 그림자 군주의 재림', '블랙툰', 'WEBTOON', ARRAY['판타지', '액션'], ARRAY['웹툰', '군주', '풀컬러'], '그림자를 지배하는 군주가 현대에 다시 깨어났다! 박진감 넘치는 액션 웹툰.', 'webtoon_1.svg', 34, false, true, true, false),
(22, 22, '[웹툰] 공작가의 시한부 영애', '핑크베리', 'WEBTOON', ARRAY['로맨스', '순정'], ARRAY['웹툰', '시한부', '로판'], '시한부 판정을 받은 영애의 후회 없는 인생 역전과 눈부신 로맨스.', 'webtoon_2.svg', 30, false, false, true, false),
(23, 23, '[웹툰] 던전 브레이크 헌터', '썬더스튜디오', 'WEBTOON', ARRAY['현대 판타지', '액션'], ARRAY['웹툰', '헌터', '던전'], '서울 한복판에 터진 SS급 던전 브레이크를 막아선 유일한 헌터의 이야기.', 'webtoon_3.svg', 23, false, false, false, true),
(24, 24, '[웹툰] 마왕님은 카페 알바중', '코믹스쿨', 'WEBTOON', ARRAY['일상', '개그'], ARRAY['웹툰', '개그', '일상힐링'], '마계에서 쫓겨나 홍대 카페에서 라떼를 만드는 마왕님의 좌충우돌 일상.', 'webtoon_4.svg', 27, false, false, true, true),
(25, 25, '[웹툰] 천하제일 마교교주', '무협코믹스', 'WEBTOON', ARRAY['무협', '액션'], ARRAY['웹툰', '마교', '절대자'], '무림을 전율케 한 마교 교주의 통쾌한 무협 액션 활극.', 'webtoon_1.svg', 32, false, false, true, false),
(26, 26, '차원 이동자의 레벨업', '디멘션', 'NOVEL', ARRAY['판타지', '전체이용가'], ARRAY['차원이동', '상태창', '먼치킨'], '이세계로 소환되어 끝없는 한계를 돌파하는 레벨업 판타지 대서사시.', 'novel_1.svg', 20, false, false, false, false),
(27, 27, '비선실세가 된 셰프', '고메마스터', 'NOVEL', ARRAY['현대 판타지', '전체이용가'], ARRAY['요리', '전문직', '회귀'], '환상의 맛으로 전 세계 VVIP들을 사로잡은 천재 요리사의 이야기.', 'novel_3.svg', 36, false, false, true, false),
(28, 28, '버림받은 황녀의 복수극', '스칼렛', 'NOVEL', ARRAY['로맨스', '전체이용가'], ARRAY['궁중암투', '복수', '걸크러시'], '독주를 마시고 죽었던 황녀가 5년 전 과거로 회귀하여 제국을 뒤흔든다.', 'novel_2.svg', 17, true, false, false, false),
(29, 29, '[웹툰] 드래곤 하트', '드래곤랩', 'WEBTOON', ARRAY['판타지', '모험'], ARRAY['웹툰', '드래곤', '모험'], '고대 드래곤의 심장을 품은 소년의 대륙 횡단 대모험.', 'webtoon_3.svg', 22, false, false, false, true),
(30, 30, '심야 라디오 괴담', '미드나잇', 'NOVEL', ARRAY['호러', '전체이용가'], ARRAY['괴담', '라디오', '단편'], '자정이 되면 주파수를 맞추세요. 당신만을 위한 섬뜩한 사연이 흘러나옵니다.', 'novel_4.svg', 11, true, false, false, true)
ON CONFLICT (id) DO UPDATE SET 
  author_id = EXCLUDED.author_id,
  title = EXCLUDED.title, 
  author = EXCLUDED.author,
  content_type = EXCLUDED.content_type, 
  cover_image = EXCLUDED.cover_image, 
  description = EXCLUDED.description,
  is_completed = EXCLUDED.is_completed;

-- 6. 회차 180개 (30개 작품 x 6회차) 시드 생성
DO $$
DECLARE
  w_id INT;
  ep_num INT;
  is_free_val BOOLEAN;
  is_ad_val BOOLEAN;
  w_title TEXT;
  w_type TEXT;
  ep_content TEXT;
  ep_imgs JSONB;
BEGIN
  FOR w_id IN 1..30 LOOP
    SELECT title, content_type INTO w_title, w_type FROM works WHERE id = w_id;
    
    FOR ep_num IN 1..6 LOOP
      is_free_val := (ep_num <= 3);
      is_ad_val := (ep_num > 3);
      
      IF w_type = 'WEBTOON' THEN
        ep_content := '';
        ep_imgs := '["/images/stormqueen_oath.jpg", "/images/sword_dao_supreme.jpg"]'::jsonb;
      ELSE
        ep_content := '본 회차는 ' || ep_num || '회차 입니다.\n\n[' || w_title || ' - 제 ' || ep_num || ' 화]\n' ||
          '주인공은 불길하게 타오르는 붉은 하늘을 바라보며 검 자루를 쥐었다. 바람이 부는 순간, 차가운 강철의 감촉이 손바닥에 선명하게 전해졌다.\n\n' ||
          CASE WHEN ep_num <= 3 THEN '1~3화는 무료로 즉시 열람하실 수 있습니다.' ELSE '💡 광고를 시청하여 성공적으로 해금된 ' || ep_num || '회차 본문입니다.' END;
        ep_imgs := '[]'::jsonb;
      END IF;

      INSERT INTO episodes (work_id, episode_number, title, is_free, is_ad_free, content, image_urls, author_comment, status)
      VALUES (
        w_id,
        ep_num,
        '제 ' || ep_num || ' 화',
        is_free_val,
        is_ad_val,
        ep_content,
        ep_imgs,
        '제 ' || ep_num || ' 화를 읽어주셔서 감사합니다!',
        'PUBLISHED'
      )
      ON CONFLICT (work_id, episode_number) DO UPDATE SET
        title = EXCLUDED.title,
        is_free = EXCLUDED.is_free,
        is_ad_free = EXCLUDED.is_ad_free,
        content = EXCLUDED.content,
        image_urls = EXCLUDED.image_urls;
    END LOOP;
  END LOOP;
END $$;
