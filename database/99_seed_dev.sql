-- ============================================================
-- WebNovels Production DB: 99_seed_dev.sql
-- 개발 및 테스트용 30작품, 180회차, 30작가, 10독자 시드 데이터
-- (platform_stats 10독자 / 30작가 / 30작품 / 180회차 일치)
-- ============================================================

-- 0. 레거시 NOT NULL 제약조건 안전하게 해제 (과거 테이블 호환성)
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.authors ALTER COLUMN password_hash DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.authors ALTER COLUMN password DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.readers ALTER COLUMN password_hash DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.readers ALTER COLUMN password DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.works ALTER COLUMN author DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
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

-- 5. 연재 작품 30개 (works - author_id 1:1 매핑)
INSERT INTO public.works (id, author_id, title, content_type, genre, tags, description, cover_image, rating, status, view_count, is_completed, is_top_recommended, is_popular_work, is_new_work) VALUES
(1, 1, '대적자: 신을 삼킨 기사', 'NOVEL', ARRAY['판타지', '전체이용가'], ARRAY['AI NONE', '기사', '성장'], '신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'stormqueen_oath.jpg', 'ALL', 'PUBLISHED', 154000, false, true, true, false),
(2, 2, '천마의 귀환', 'NOVEL', ARRAY['무협', '전체이용가'], ARRAY['AI NONE', '천마', '회귀'], '천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'sword_dao_supreme.jpg', 'ALL', 'PUBLISHED', 231000, false, true, true, false),
(3, 3, '금기의 계약', 'NOVEL', ARRAY['성인', '19세 이상'], ARRAY['AI NONE', '치명적', '로맨스'], '금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'velvet_and_thorns.jpg', '18', 'PUBLISHED', 189000, false, false, true, false),
(4, 4, '황제의 유일한 후궁', 'NOVEL', ARRAY['로맨스', '전체이용가'], ARRAY['AI NONE', '궁중', '애절'], '황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'flower_blooming.jpg', 'ALL', 'PUBLISHED', 312000, false, true, true, false),
(5, 5, '성간 항로: 마지막 항해사', 'NOVEL', ARRAY['SF', '전체이용가'], ARRAY['AI NONE', '우주', '생존'], '인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'stellar_horizon.jpg', 'ALL', 'PUBLISHED', 97000, false, false, false, true),
(6, 6, '서울에 나타난 마왕', 'NOVEL', ARRAY['현대 판타지', '전체이용가'], ARRAY['AI NONE', '현대', '마왕'], '현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'seoul_sorcerer.jpg', 'ALL', 'PUBLISHED', 278000, false, false, true, true),
(7, 7, '죽은 자들의 학교', 'NOVEL', ARRAY['호러', '전체이용가'], ARRAY['AI NONE', '폐교', '미스터리'], '폐교에 남은 것들. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'darkness_swallowed_classroom.jpg', 'ALL', 'PUBLISHED', 84000, true, false, false, true),
(8, 8, '검의 전설: 천하제일인', 'NOVEL', ARRAY['무협', '전체이용가'], ARRAY['AI NONE', '검술', '절대자'], '천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!', 'sword_dao_defies_heavens.jpg', 'ALL', 'PUBLISHED', 195000, true, false, true, false),
(9, 9, '[웹툰] 신의 기사단', 'WEBTOON', ARRAY['판타지', '액션'], ARRAY['웹툰', '풀컬러', '고화질'], '대적자 스핀오프 공식 웹툰! 화려한 작화로 펼쳐지는 기사단의 모험.', 'stormqueen_oath.jpg', 'ALL', 'PUBLISHED', 89000, false, false, true, true),
(10, 10, '[웹툰] 황후의 비밀 화원', 'WEBTOON', ARRAY['로맨스 판타지', '드라마'], ARRAY['웹툰', '궁중', '화려함'], '꽃들이 만발한 황후의 정원에 감춰진 비밀스런 로맨스 웹툰.', 'flower_blooming.jpg', 'ALL', 'PUBLISHED', 142000, false, true, true, false),
(11, 11, 'SSS급 헌터의 편의점', 'NOVEL', ARRAY['현대 판타지', '일상'], ARRAY['헌터', '각성', '치유'], '마왕을 잡고 은퇴한 최강 헌터의 힐링 편의점 라이프.', 'stormqueen_oath.jpg', 'ALL', 'PUBLISHED', 120000, false, false, false, true),
(12, 12, '화산파 막내 제자의 검', 'NOVEL', ARRAY['무협', '정통무협'], ARRAY['화산파', '천재', '성장'], '매화검존의 환생, 다시 한번 천하를 매화향으로 물들이다.', 'sword_dao_supreme.jpg', 'ALL', 'PUBLISHED', 180000, false, false, true, false),
(13, 13, '악녀는 조용히 살고 싶다', 'NOVEL', ARRAY['로맨스 판타지', '빙의'], ARRAY['악녀', '사이다', '역하렘'], '원작에서 사형당한 악녀로 빙의했다. 이번엔 조용히 부자로 살겠다.', 'velvet_and_thorns.jpg', 'ALL', 'PUBLISHED', 210000, false, true, true, false),
(14, 14, '네크로맨서로 살아남기', 'NOVEL', ARRAY['판타지', '다크판타지'], ARRAY['네크로맨서', '생존', '언데드'], '모두가 기피하는 금기의 직업, 그러나 나에겐 유일한 무기였다.', 'darkness_swallowed_classroom.jpg', 'ALL', 'PUBLISHED', 165000, false, false, false, false),
(15, 15, '달콤한 오피스 스캔들', 'NOVEL', ARRAY['로맨스', '현대물'], ARRAY['사내연애', '직진남', '비밀'], '완벽주의 까칠 본부장님과 어쩌다 하룻밤 스캔들이 터졌다.', 'flower_blooming.jpg', 'ALL', 'PUBLISHED', 95000, false, false, false, true),
(16, 16, '사이버펑크 2099: 네온 서울', 'NOVEL', ARRAY['SF', '사이버펑크'], ARRAY['해커', '신체개조', '디스토피아'], '거대 기업이 지배하는 미래 서울, 반역의 해커가 시스템을 부순다.', 'stellar_horizon.jpg', 'ALL', 'PUBLISHED', 88000, false, false, false, true),
(17, 17, '퇴마록: 어둠의 사냥꾼', 'NOVEL', ARRAY['오컬트', '현대판타지'], ARRAY['퇴마', '도사', '퇴마록'], '도심 속 번지는 악령의 그림자, 전통 도술로 세상을 구한다.', 'seoul_sorcerer.jpg', 'ALL', 'PUBLISHED', 135000, false, false, true, false),
(18, 18, '아카데미 천재 마법사', 'NOVEL', ARRAY['판타지', '아카데미'], ARRAY['마법', '천재', '학원물'], '마법 서클의 공식을 뒤엎은 시골 소년의 아카데미 정복기.', 'stormqueen_oath.jpg', 'ALL', 'PUBLISHED', 175000, false, true, true, false),
(19, 19, '재벌집 막내아들의 비밀투자', 'NOVEL', ARRAY['현대 판타지', '재벌'], ARRAY['회귀', '투자', '사이다'], 'IMF 직전으로 회귀했다. 미래의 모든 대기업을 인수한다.', 'seoul_sorcerer.jpg', 'ALL', 'PUBLISHED', 320000, false, true, true, false),
(20, 20, '망겜의 성기사가 되었다', 'NOVEL', ARRAY['판타지', '게임빙의'], ARRAY['성기사', '신앙', '구원'], '극악의 난이도 망겜 속, 몰락한 교단의 마지막 성기사로 빙의했다.', 'sword_dao_defies_heavens.jpg', 'ALL', 'PUBLISHED', 145000, false, false, false, false),
(21, 21, '[웹툰] 그림자 군주의 재림', 'WEBTOON', ARRAY['판타지', '액션'], ARRAY['웹툰', '군주', '각성'], '최하위 헌터에서 그림자 군단으로 부활한 헌터의 신화적 웹툰.', 'stormqueen_oath.jpg', 'ALL', 'PUBLISHED', 290000, false, true, true, false),
(22, 22, '[웹툰] 공작가의 시한부 영애', 'WEBTOON', ARRAY['로맨스 판타지', '순정'], ARRAY['웹툰', '시한부', '후회물'], '시한부 판정을 받고 마음대로 살기로 결심한 영애의 이야기.', 'velvet_and_thorns.jpg', 'ALL', 'PUBLISHED', 230000, false, true, true, false),
(23, 23, '[웹툰] 던전 브레이크 헌터', 'WEBTOON', ARRAY['액션', '판타지'], ARRAY['웹툰', '레이드', '스킬'], '전 세계에 터진 던전 브레이크, 인류 최후의 방어선.', 'seoul_sorcerer.jpg', 'ALL', 'PUBLISHED', 160000, false, false, true, true),
(24, 24, '[웹툰] 마왕님은 카페 알바중', 'WEBTOON', ARRAY['코미디', '일상'], ARRAY['웹툰', '마왕', '알바'], '차원이동으로 힘을 잃은 마왕님의 고단한 홍대 카페 알바기.', 'flower_blooming.jpg', 'ALL', 'PUBLISHED', 110000, false, false, false, true),
(25, 25, '[웹툰] 천하제일 마교교주', 'WEBTOON', ARRAY['무협', '액션'], ARRAY['웹툰', '마교', '패왕'], '무림맹의 계략에 빠져 환생한 마교교주의 천하제일 무림 정벌기.', 'sword_dao_supreme.jpg', 'ALL', 'PUBLISHED', 270000, false, true, true, false),
(26, 26, '차원 이동자의 레벨업', 'NOVEL', ARRAY['판타지', '차원이동'], ARRAY['레벨업', '상태창', '이세계'], '다른 차원으로 소환된 평범한 회사원의 압도적인 레벨업 질주.', 'stormqueen_oath.jpg', 'ALL', 'PUBLISHED', 105000, false, false, false, true),
(27, 27, '비선실세가 된 셰프', 'NOVEL', ARRAY['현대 판타지', '요리'], ARRAY['요리', '미식', '성장'], '궁극의 미각을 얻은 요리사가 정재계 거물들의 입맛을 지배한다.', 'flower_blooming.jpg', 'ALL', 'PUBLISHED', 130000, false, false, true, false),
(28, 28, '버림받은 황녀의 복수극', 'NOVEL', ARRAY['로맨스 판타지', '복수'], ARRAY['황녀', '흑화', '정략결혼'], '배신당하고 독살된 황녀, 죽음에서 돌아와 제국을 무너뜨린다.', 'velvet_and_thorns.jpg', 'ALL', 'PUBLISHED', 190000, false, false, true, false),
(29, 29, '[웹툰] 드래곤 하트', 'WEBTOON', ARRAY['판타지', '모험'], ARRAY['웹툰', '드래곤', '마법'], '드래곤의 심장을 물려받은 소년의 대륙을 뒤흔드는 모험.', 'stellar_horizon.jpg', 'ALL', 'PUBLISHED', 155000, false, false, true, true),
(30, 30, '심야 라디오 괴담', 'NOVEL', ARRAY['공포', '미스터리'], ARRAY['괴담', '라디오', '심령'], '자정에만 방송되는 비밀 라디오 채널에서 들려오는 진짜 괴담들.', 'darkness_swallowed_classroom.jpg', 'ALL', 'PUBLISHED', 82000, true, false, false, false)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  author_id = EXCLUDED.author_id,
  content_type = EXCLUDED.content_type,
  genre = EXCLUDED.genre,
  status = EXCLUDED.status;

-- 6. 30개 작품 x 6회차 = 180회차 메타데이터 (episodes) 및 본문 (episode_contents) 자동 생성
DO $$
DECLARE
  w_rec RECORD;
  ep_num INT;
  v_ep_id BIGINT;
  v_is_free BOOLEAN;
  v_policy public.access_policy;
BEGIN
  FOR w_rec IN SELECT id, title, content_type FROM public.works ORDER BY id LOOP
    FOR ep_num IN 1..6 LOOP
      v_is_free := (ep_num <= 3);
      v_policy := CASE WHEN v_is_free THEN 'FREE'::public.access_policy ELSE 'REWARDED_AD'::public.access_policy END;
      
      INSERT INTO public.episodes (work_id, episode_number, title, access_policy, status, author_comment)
      VALUES (
        w_rec.id,
        ep_num,
        '제 ' || ep_num || ' 화',
        v_policy,
        'PUBLISHED'::public.episode_status,
        '재미있게 감상하셨다면 구독과 따뜻한 댓글 부탁드립니다!'
      )
      ON CONFLICT (work_id, episode_number) DO UPDATE SET
        title = EXCLUDED.title,
        access_policy = EXCLUDED.access_policy,
        status = EXCLUDED.status
      RETURNING id INTO v_ep_id;

      -- 보호된 텍스트 본문 (episode_contents)
      IF w_rec.content_type = 'NOVEL' THEN
        INSERT INTO public.episode_contents (episode_id, text_content)
        VALUES (
          v_ep_id,
          '[' || w_rec.title || ' 제 ' || ep_num || ' 화]\n\n어둠이 짙게 깔린 밤, 운명의 수레바퀴가 천천히 회전하기 시작했다.\n\n"더 이상 물러설 곳은 없다."\n\n주인공은 결연한 눈빛으로 검을 뽑아 들었다. 찬란한 빛과 함께 전장의 공기가 급격히 냉각되었다.\n\n(본 회차는 ' || ep_num || '화 본문입니다. 다음 회차도 흥미진진한 스토리가 이어집니다.)'
        )
        ON CONFLICT (episode_id) DO UPDATE SET text_content = EXCLUDED.text_content;
      ELSE
        -- 웹툰 컷 패널 (episode_panels)
        INSERT INTO public.episode_panels (episode_id, panel_number, image_url)
        VALUES 
          (v_ep_id, 1, '/images/stormqueen_oath.jpg'),
          (v_ep_id, 2, '/images/sword_dao_supreme.jpg')
        ON CONFLICT (episode_id, panel_number) DO NOTHING;
      END IF;

    END LOOP;
  END LOOP;
END $$;
