-- ============================================================
-- 03_content.sql: 연재 작품(works) 및 회차(episodes) 스키마
-- ============================================================

-- 1. 연재 작품 테이블 (works - author_id 외래키 연동)
CREATE TABLE IF NOT EXISTS works (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES authors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL, -- 작가 필명 스냅샷 / 하위 호환
  content_type TEXT NOT NULL DEFAULT 'NOVEL', -- 'NOVEL'(웹소설), 'WEBTOON'(웹툰)
  genre TEXT[] NOT NULL,
  tags TEXT[] NOT NULL,
  description TEXT,
  cover_image TEXT,
  view_count INT DEFAULT 0,
  like_count INT DEFAULT 0,
  rating TEXT DEFAULT 'ALL',
  ai_usage_type TEXT DEFAULT 'NONE',
  status TEXT DEFAULT 'ONGOING', -- 'ONGOING', 'PAUSED', 'COMPLETED'
  is_completed BOOLEAN DEFAULT false,
  is_top_recommended BOOLEAN DEFAULT false,
  is_popular_work BOOLEAN DEFAULT false,
  is_new_work BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE works ADD COLUMN IF NOT EXISTS author_id INT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'NOVEL';
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_top_recommended BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_popular_work BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_new_work BOOLEAN DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT 'ALL';
ALTER TABLE works ADD COLUMN IF NOT EXISTS ai_usage_type TEXT DEFAULT 'NONE';
ALTER TABLE works ADD COLUMN IF NOT EXISTS like_count INT DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_works_author'
  ) THEN
    ALTER TABLE works ADD CONSTRAINT fk_works_author FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. 회차 상세 테이블 (episodes - 본문/웹툰컷 & 광고 언락 정책)
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
  status TEXT DEFAULT 'PUBLISHED', -- 'PUBLISHED', 'SCHEDULED', 'REVIEW', 'DRAFT'
  scheduled_at TIMESTAMPTZ, -- Zero-Touch 예약 연재 일시
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_work_episode UNIQUE (work_id, episode_number)
);

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS author_comment TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT true;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_ad_free BOOLEAN DEFAULT false;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PUBLISHED';
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
