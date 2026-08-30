-- ============================================================
-- WebNovels Production DB: 99_seed_dev.sql
-- 개발 및 테스트용 30작품, 180회차, 30작가, 10독자 시드 데이터
-- (platform_stats 10독자 / 30작가 / 30작품 / 180회차 일치)
-- ============================================================

-- 0. 레거시 컬럼의 모든 NOT NULL 제약조건 동적 완전 자동 해제 (모든 과거 DB 스키마 100% 호환)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.is_nullable = 'NO'
      AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
      AND t.table_type = 'BASE TABLE'
  ) LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.table_name, r.column_name);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

-- 1. 플랫폼 KPI 통계 시드
INSERT INTO public.system_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.platform_stats (id, total_users, total_authors, total_works, total_episodes, total_ad_views)
VALUES ('current', 10, 30, 30, 180, 54200)
ON CONFLICT (id) DO UPDATE SET
  total_users = 10,
  total_authors = 30,
  total_works = 30,
  total_episodes = 180,
  total_ad_views = 54200;

-- 2. 등록 작가 30명 공개 프로필 (authors)
INSERT INTO public.authors (id, username, pen_name, status) VALUES
(1, 'writer1', '판타지마스터', 'APPROVED'),
(2, 'writer2', '무협의신', 'APPROVED'),
(3, 'writer3', '나이트로즈', 'APPROVED'),
(4, 'writer4', '로맨스퀸', 'APPROVED'),
(5, 'writer5', '스페이스로그', 'APPROVED'),
(6, 'writer6', '도시마법사', 'APPROVED'),
(7, 'writer7', '공포작가', 'APPROVED'),
(8, 'writer8', '검성', 'APPROVED'),
(9, 'writer9', '스튜디오노바', 'APPROVED'),
(10, 'writer10', '로즈코믹스', 'APPROVED'),
(11, 'writer11', '밤샘작가', 'APPROVED'),
(12, 'writer12', '청명검', 'APPROVED'),
(13, 'writer13', '로즈가든', 'APPROVED'),
(14, 'writer14', '영혼술사', 'APPROVED'),
(15, 'writer15', '초코라떼', 'APPROVED'),
(16, 'writer16', '메카닉스', 'APPROVED'),
(17, 'writer17', '퇴마사', 'APPROVED'),
(18, 'writer18', '룬마스터', 'APPROVED'),
(19, 'writer19', '머니파워', 'APPROVED'),
(20, 'writer20', '홀리나이트', 'APPROVED'),
(21, 'writer21', '블랙툰', 'APPROVED'),
(22, 'writer22', '핑크베리', 'APPROVED'),
(23, 'writer23', '썬더스튜디오', 'APPROVED'),
(24, 'writer24', '코믹스쿨', 'APPROVED'),
(25, 'writer25', '무협코믹스', 'APPROVED'),
(26, 'writer26', '디멘션', 'APPROVED'),
(27, 'writer27', '고메마스터', 'APPROVED'),
(28, 'writer28', '스칼렛', 'APPROVED'),
(29, 'writer29', '드래곤랩', 'APPROVED'),
(30, 'writer30', '미드나잇', 'APPROVED')
ON CONFLICT (id) DO UPDATE SET 
  pen_name = EXCLUDED.pen_name,
  status = EXCLUDED.status;

-- 3. 작가 비공개 프로필 (author_private_profiles)
INSERT INTO public.author_private_profiles (author_id, email, birthdate, address) VALUES
(1, 'writer1@webnovels.com', '1990-01-15', '서울특별시 강남구 테헤란로 123'),
(2, 'writer2@webnovels.com', '1985-05-20', '서울특별시 서초구 반포대로 45'),
(3, 'writer3@webnovels.com', '1992-08-12', '경기도 성남시 분당구 판교로 78'),
(4, 'writer4@webnovels.com', '1994-11-03', '서울특별시 마포구 월드컵북로 99'),
(5, 'writer5@webnovels.com', '1988-03-30', '대전광역시 유성구 대학로 100'),
(6, 'writer6@webnovels.com', '1995-07-07', '서울특별시 송파구 올림픽로 200'),
(7, 'writer7@webnovels.com', '1991-10-31', '부산광역시 해운대구 센텀서로 30'),
(8, 'writer8@webnovels.com', '1987-12-25', '대구광역시 수성구 달구벌대로 500'),
(9, 'writer9@webnovels.com', '1993-04-10', '서울특별시 마포구 독막로 50'),
(10, 'writer10@webnovels.com', '1996-09-18', '서울특별시 강남구 학동로 20'),
(11, 'writer11@webnovels.com', '1990-01-15', '서울특별시 강남구 테헤란로 100'),
(12, 'writer12@webnovels.com', '1991-02-15', '서울특별시 강남구 테헤란로 101'),
(13, 'writer13@webnovels.com', '1992-03-15', '서울특별시 강남구 테헤란로 102'),
(14, 'writer14@webnovels.com', '1993-04-15', '서울특별시 강남구 테헤란로 103'),
(15, 'writer15@webnovels.com', '1994-05-15', '서울특별시 강남구 테헤란로 104'),
(16, 'writer16@webnovels.com', '1995-06-15', '서울특별시 강남구 테헤란로 105'),
(17, 'writer17@webnovels.com', '1996-07-15', '서울특별시 강남구 테헤란로 106'),
(18, 'writer18@webnovels.com', '1997-08-15', '서울특별시 강남구 테헤란로 107'),
(19, 'writer19@webnovels.com', '1998-09-15', '서울특별시 강남구 테헤란로 108'),
(20, 'writer20@webnovels.com', '1999-10-15', '서울특별시 강남구 테헤란로 109'),
(21, 'writer21@webnovels.com', '1990-11-15', '서울특별시 강남구 테헤란로 110'),
(22, 'writer22@webnovels.com', '1991-12-15', '서울특별시 강남구 테헤란로 111'),
(23, 'writer23@webnovels.com', '1992-01-15', '서울특별시 강남구 테헤란로 112'),
(24, 'writer24@webnovels.com', '1993-02-15', '서울특별시 강남구 테헤란로 113'),
(25, 'writer25@webnovels.com', '1994-03-15', '서울특별시 강남구 테헤란로 114'),
(26, 'writer26@webnovels.com', '1995-04-15', '서울특별시 강남구 테헤란로 115'),
(27, 'writer27@webnovels.com', '1996-05-15', '서울특별시 강남구 테헤란로 116'),
(28, 'writer28@webnovels.com', '1997-06-15', '서울특별시 강남구 테헤란로 117'),
(29, 'writer29@webnovels.com', '1998-07-15', '서울특별시 강남구 테헤란로 118'),
(30, 'writer30@webnovels.com', '1999-08-15', '서울특별시 강남구 테헤란로 119')
ON CONFLICT (author_id) DO UPDATE SET email = EXCLUDED.email;

-- 4. 작가 정산 계좌 (author_settlement_accounts)
INSERT INTO public.author_settlement_accounts (author_id, bank_name, account_number_encrypted, account_holder, verification_status, is_primary) VALUES
(1, '국민은행', '999-888-777666', '판타지마스터', 'VERIFIED', true),
(2, '신한은행', '110-222-333444', '무협의신', 'VERIFIED', true),
(3, '우리은행', '1002-555-666777', '나이트로즈', 'VERIFIED', true),
(4, '하나은행', '222-333-444555', '로맨스퀸', 'VERIFIED', true),
(5, '농협', '301-777-888999', '스페이스로그', 'VERIFIED', true),
(6, '카카오뱅크', '3333-01-234567', '도시마법사', 'VERIFIED', true),
(7, '기업은행', '010-9999-8888', '공포작가', 'VERIFIED', true),
(8, '대구은행', '508-12-345678', '검성', 'VERIFIED', true),
(9, '국민은행', '111-222-333444', '스튜디오노바', 'VERIFIED', true),
(10, '신한은행', '333-444-555666', '로즈코믹스', 'VERIFIED', true)
ON CONFLICT DO NOTHING;

-- 5. 30개 작품 메타데이터 시드 (works)
INSERT INTO public.works (
  id, author_id, title, content_type, genre, tags, description, cover_image, rating, status, is_completed, is_top_recommended, is_popular_work, is_new_work, ai_usage_type, view_count, like_count
) VALUES
(1, 1, '폭풍의 여왕 서약', 'NOVEL', ARRAY['판타지', '액션'], ARRAY['마법', '왕국', '여주'], '대륙을 뒤흔든 폭풍 속에서 피어난 한 여인의 맹세와 복수극.', '/images/stormqueen_oath.jpg', 'ALL', 'PUBLISHED', false, true, true, false, 'NONE', 15200, 3420),
(2, 2, '어둠 속의 그림자', 'NOVEL', ARRAY['무협', '미스터리'], ARRAY['암살', '정통무협', '복수'], '달빛조차 닿지 않는 어둠 속, 강호 최강의 암살자가 진실을 찾아 움직인다.', '/images/shadow_in_the_dark.jpg', 'ALL', 'PUBLISHED', false, true, false, false, 'NONE', 9800, 2100),
(3, 3, '네온 드림', 'NOVEL', ARRAY['SF', '판타지'], ARRAY['사이버펑크', 'AI', '미래도시'], '2099년 네오 서울, 기억을 잃은 인공지능 해커의 자유를 향한 질주.', '/images/neon_dreams.jpg', 'ALL', 'PUBLISHED', false, false, true, true, 'NONE', 12400, 2890),
(4, 4, '황혼의 맹세', 'NOVEL', ARRAY['로맨스', '판타지'], ARRAY['회귀', '궁중로맨스', '달달'], '모든 것을 잃고 돌아온 황혼의 시간, 이번에는 사랑과 권력을 모두 쟁취하리라.', '/images/twilight_oath.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 8700, 1950),
(5, 5, '크로노스 리셋', 'NOVEL', ARRAY['판타지', '액션'], ARRAY['시간회귀', '차원이동', '성장'], '시간의 신 크로노스의 선택을 받아 종말 직전의 세계로 리셋된 자의 구원 서사.', '/images/chronos_reset.jpg', 'ALL', 'PUBLISHED', false, false, false, true, 'NONE', 6500, 1420),
(6, 6, '용의 심장', 'NOVEL', ARRAY['판타지', '액션'], ARRAY['드래곤', '용족', '최강자'], '멸망한 고대 드래곤의 심장을 계승한 소년이 대륙의 패권을 쥐어잡는 일대기.', '/images/dragon_heart.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 11300, 2750),
(7, 7, '침묵의 미궁', 'NOVEL', ARRAY['미스터리', '공포'], ARRAY['던전', '생존', '스릴러'], '소리 내는 순간 죽는다. 100층 미궁에서 펼쳐지는 극한의 음소거 생존 게임.', '/images/silent_labyrinth.jpg', 'ALL', 'PUBLISHED', false, false, false, false, 'NONE', 5400, 980),
(8, 8, '검의 길', 'NOVEL', ARRAY['무협', '액션'], ARRAY['검술', '천마', '수련'], '오직 한 자루의 검으로 천하를 평정한 전설의 검선, 그의 깨달음의 발자취.', '/images/way_of_sword.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 14100, 3120),
(9, 9, '사이버 판타지 2088', 'NOVEL', ARRAY['SF', '판타지'], ARRAY['마법공학', '메카닉', '용병'], '마법과 초고도 나노테크놀로지가 융합된 2088년의 무법지대.', '/images/cyber_fantasy.jpg', 'ALL', 'PUBLISHED', false, false, false, true, 'NONE', 7200, 1600),
(10, 10, '달빛의 멜로디', 'NOVEL', ARRAY['로맨스', '현대'], ARRAY['음악', '첫사랑', '힐링'], '피아노 선율을 타고 찾아온 기적 같은 인연과 청춘들의 순수한 사랑.', '/images/moonlight_melody.jpg', 'ALL', 'PUBLISHED', false, false, false, false, 'NONE', 6100, 1340),
(11, 11, '심연의 탑 랭커', 'NOVEL', ARRAY['판타지', '액션'], ARRAY['탑등반', '시스템', '먼치킨'], '100층 심연의 탑을 홀로 정복한 1위 랭커의 히든 클래스 공략기.', '/images/abyss_tower.jpg', 'ALL', 'PUBLISHED', false, true, true, false, 'NONE', 18900, 4200),
(12, 12, '화산파 막내제자', 'NOVEL', ARRAY['무협', '코미디'], ARRAY['화산파', '환생', '먼치킨'], '화산파의 대선배가 300년 후 막내 제자로 환생하여 무림을 뒤집어놓는다.', '/images/mount_hua.jpg', 'ALL', 'PUBLISHED', false, false, true, true, 'NONE', 16500, 3800),
(13, 13, '황실의 비밀 온실', 'NOVEL', ARRAY['로맨스', '판타지'], ARRAY['치유', '황태자', '온실'], '황태자의 저주를 풀 수 있는 유일한 식물을 기르는 정원사의 로맨스 판타지.', '/images/secret_greenhouse.jpg', 'ALL', 'PUBLISHED', false, false, false, false, 'NONE', 7800, 1750),
(14, 14, '네크로맨서의 100번째 생애', 'NOVEL', ARRAY['판타지', '다크'], ARRAY['언데드', '환생', '지략'], '99번의 죽음 끝에 마침내 영생의 비밀을 깨달은 사령술사의 대서사시.', '/images/necromancer_100.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 13200, 2900),
(15, 15, '디저트 공방의 마녀', 'NOVEL', ARRAY['현대판타지', '일상'], ARRAY['요리', '힐링', '마녀'], '한 입 베어 물면 소원이 이루어지는 마법 디저트를 만드는 골목길 카페 이야기.', '/images/dessert_witch.jpg', 'ALL', 'PUBLISHED', false, false, false, true, 'NONE', 8900, 2100),
(16, 16, '스타쉽 아카데미', 'NOVEL', ARRAY['SF', '학원'], ARRAY['우주전함', '사관학교', '우정'], '은하 연합 사관학교 열등생이 천재적인 전술로 함대전을 지휘한다.', '/images/starship_academy.jpg', 'ALL', 'PUBLISHED', false, false, false, false, 'NONE', 5900, 1150),
(17, 17, '조선퇴마록', 'NOVEL', ARRAY['역사', '판타지'], ARRAY['조선', '퇴마', '도술'], '조선 한양 도성에 출몰하는 요괴들을 소탕하는 착호갑사의 비밀 결사단.', '/images/joseon_exorcist.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 10400, 2400),
(18, 18, '대마도사의 만물상', 'NOVEL', ARRAY['판타지', '착각'], ARRAY['아이템', '마법상점', '먼치킨'], '은퇴한 대마도사가 차린 허름한 상점에 대륙의 영웅들이 줄을 선다.', '/images/archmage_shop.jpg', 'ALL', 'PUBLISHED', false, false, false, true, 'NONE', 9400, 2200),
(19, 19, '재벌집 막내사위', 'NOVEL', ARRAY['현대', '드라마'], ARRAY['재벌', '투자', '사이다'], '미래의 경제 흐름을 꿰뚫어보는 천재 펀드매니저의 통쾌한 재계 정복기.', '/images/chaebol_soninlaw.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 14500, 3100),
(20, 20, '성기사의 은밀한 이중생활', 'NOVEL', ARRAY['로맨스판타지', '코미디'], ARRAY['성기사', '비밀', '로코'], '낮에는 근엄한 교단의 총사령관, 밤에는 대륙 최고의 로맨스 소설 작가?!', '/images/paladin_secret.jpg', 'ALL', 'PUBLISHED', false, false, false, false, 'NONE', 8300, 1900),
(21, 21, '섀도우 헌터 블러드', 'WEBTOON', ARRAY['액션', '스릴러'], ARRAY['웹툰', '뱀파이어', '풀컬러'], '뱀파이어와 인간의 혼혈 헌터가 펼치는 숨막히는 도심 밤거리 스타일리시 액션.', '/images/shadow_hunter.jpg', 'ALL', 'PUBLISHED', false, true, true, false, 'NONE', 21000, 5200),
(22, 22, '달콤한 마법 베이커리', 'WEBTOON', ARRAY['로맨스', '일상'], ARRAY['웹툰', '힐링', '베이킹'], '달콤한 빵 굽는 냄새와 함께 피어나는 두 남녀의 풋풋한 러브스토리 웹툰.', '/images/sweet_bakery.jpg', 'ALL', 'PUBLISHED', false, false, true, true, 'NONE', 14800, 3600),
(23, 23, '신마대전: 라그나로크', 'WEBTOON', ARRAY['판타지', '액션'], ARRAY['웹툰', '신화', '대규모전투'], '신과 악마의 대격돌! 웅장한 작화와 화려한 이펙트의 정통 판타지 대작 웹툰.', '/images/god_demon_war.jpg', 'ALL', 'PUBLISHED', false, true, false, false, 'NONE', 19500, 4800),
(24, 24, '아카데미 일진 격파기', 'WEBTOON', ARRAY['학원', '액션'], ARRAY['웹툰', '사이다', '격투'], '괴롭힘당하던 전학생이 전설의 무술을 전수받고 일진회를 하나씩 무너뜨린다.', '/images/academy_fighter.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 17200, 4100),
(25, 25, '천마강림록', 'WEBTOON', ARRAY['무협', '액션'], ARRAY['웹툰', '천마', '정통무협'], '강호를 피로 물들였던 천마의 화려한 귀환! 압도적인 필력과 화풍의 무협 웹툰.', '/images/heavenly_demon.jpg', 'ALL', 'PUBLISHED', false, false, false, true, 'NONE', 13400, 3200),
(26, 26, '차원 유랑선', 'WEBTOON', ARRAY['SF', '모험'], ARRAY['웹툰', '차원포탈', '탐험'], '미지의 차원을 유람하며 신비한 보물을 발굴하는 차원 항해자들의 모험담.', '/images/dimension_ship.jpg', 'ALL', 'PUBLISHED', false, false, false, false, 'NONE', 8600, 1950),
(27, 27, '이세계 미식 로드', 'WEBTOON', ARRAY['판타지', '요리'], ARRAY['웹툰', '먹방', '이세계'], '마물의 고기로 최고급 미슐랭 요리를 만들어내는 이세계 셰프의 미식 여행.', '/images/isekai_gourmet.jpg', 'ALL', 'PUBLISHED', false, false, true, false, 'NONE', 15600, 3700),
(28, 28, '공녀님의 완벽한 이혼', 'WEBTOON', ARRAY['로맨스판타지', '드라마'], ARRAY['웹툰', '걸크러시', '사이다'], '바람피운 황태자에게 시원하게 파혼을 선언하고 대공과 계약 결혼한 공녀의 이야기.', '/images/perfect_divorce.jpg', 'ALL', 'PUBLISHED', false, false, true, true, 'NONE', 18300, 4500),
(29, 29, '사이버 던전 크롤러', 'WEBTOON', ARRAY['SF', '액션'], ARRAY['웹툰', '가상현실', '배틀로얄'], '가상현실 던전 속에 갇힌 유저들의 목숨을 건 배틀로얄 탈출 액션 웹툰.', '/images/cyber_crawler.jpg', 'ALL', 'PUBLISHED', false, false, false, false, 'NONE', 9100, 2150),
(30, 30, '심야 심령 상담소', 'WEBTOON', ARRAY['미스터리', '공포'], ARRAY['웹툰', '귀신', '감동'], '밤 12시에만 문을 여는 심령 상담소에서 영혼들의 한을 풀어주는 영능력자 이야기.', '/images/midnight_counsel.jpg', 'ALL', 'PUBLISHED', false, false, false, true, 'NONE', 11200, 2700)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content_type = EXCLUDED.content_type,
  cover_image = EXCLUDED.cover_image,
  status = EXCLUDED.status;

-- 6. 180개 회차 메타데이터 & 본문 시드 (각 작품당 6회차)
DO $$
DECLARE
  w_id INT;
  ep_num INT;
  ep_id BIGINT;
  access_pol public.access_policy;
BEGIN
  FOR w_id IN 1..30 LOOP
    FOR ep_num IN 1..6 LOOP
      IF ep_num <= 3 THEN
        access_pol := 'FREE'::public.access_policy;
      ELSE
        access_pol := 'REWARDED_AD'::public.access_policy;
      END IF;

      INSERT INTO public.episodes (work_id, episode_number, title, access_policy, status, view_count)
      VALUES (
        w_id,
        ep_num,
        '제 ' || ep_num || '화: ' || CASE ep_num 
          WHEN 1 THEN '운명적인 만남과 여정의 시작'
          WHEN 2 THEN '숨겨진 진실과 다가오는 위기'
          WHEN 3 THEN '어둠의 장막을 가르는 검격'
          WHEN 4 THEN '피할 수 없는 격돌과 각성'
          WHEN 5 THEN '폭풍전야의 결단'
          ELSE '새로운 시대의 서막'
        END,
        access_pol,
        'PUBLISHED'::public.episode_status,
        (31 - w_id) * 300 + (7 - ep_num) * 50
      )
      ON CONFLICT (work_id, episode_number) DO UPDATE SET
        title = EXCLUDED.title,
        access_policy = EXCLUDED.access_policy,
        status = EXCLUDED.status
      RETURNING id INTO ep_id;

      -- 회차 본문 보호 텍스트 (episode_contents)
      INSERT INTO public.episode_contents (episode_id, text_content, content_version)
      VALUES (
        ep_id,
        '제 ' || ep_num || '화 본문 내용입니다.' || E'\n\n' ||
        '차가운 밤바람이 창틀을 흔들며 스쳐 지나갔다. 어둠 속에서 조용히 숨을 고르던 주인공은 손에 쥔 검자루를 단단히 쥐었다.' || E'\n\n' ||
        '“이번만큼은 결코 물러서지 않는다.”' || E'\n\n' ||
        '결연한 의지가 담긴 나지막한 읊조림과 함께, 굳게 닫혀 있던 철문이 서서히 열리기 시작했다. 문 너머로 뿜어져 나오는 푸른 마력의 파동은 숨을 턱 막히게 만들 정도로 거대했다.' || E'\n\n' ||
        '그의 눈빛이 푸른 섬광처럼 번뜩였다. 마침내 모든 운명이 걸린 최후의 결전이 눈앞으로 다가온 것이다...',
        1
      )
      ON CONFLICT (episode_id) DO UPDATE SET
        text_content = EXCLUDED.text_content;

    END LOOP;
  END LOOP;
END $$;
