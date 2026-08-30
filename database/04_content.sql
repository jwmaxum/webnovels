-- WebNovels Production DB: 04_content.sql
-- 작품 메타데이터, 회차 메타데이터 및 보호된 본문(Protected Content) 분리

-- 1. 작품 메타데이터
CREATE TABLE IF NOT EXISTS public.works (
  id BIGSERIAL PRIMARY KEY,
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content_type public.content_type NOT NULL DEFAULT 'NOVEL',
  genre TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  cover_image TEXT,
  rating TEXT NOT NULL DEFAULT 'ALL' CHECK (rating IN ('ALL', '15', '18')),
  status public.work_status NOT NULL DEFAULT 'DRAFT',
  is_completed BOOLEAN NOT NULL DEFAULT false,
  is_top_recommended BOOLEAN NOT NULL DEFAULT false,
  is_popular_work BOOLEAN NOT NULL DEFAULT false,
  is_new_work BOOLEAN NOT NULL DEFAULT true,
  ai_usage_type TEXT NOT NULL DEFAULT 'NONE',
  view_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 회차 메타데이터 (Metadata Only - 본문 컬럼 제외)
CREATE TABLE IF NOT EXISTS public.episodes (
  id BIGSERIAL PRIMARY KEY,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT NOT NULL,
  access_policy public.access_policy NOT NULL DEFAULT 'FREE',
  author_comment TEXT,
  status public.episode_status NOT NULL DEFAULT 'DRAFT',
  scheduled_at TIMESTAMPTZ,
  view_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(work_id, episode_number)
);

-- 3. 회차 보호 본문 (Protected Text Content)
CREATE TABLE IF NOT EXISTS public.episode_contents (
  episode_id BIGINT PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  text_content TEXT,
  content_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 웹툰 회차 컷 이미지 (Protected Panels)
CREATE TABLE IF NOT EXISTS public.episode_panels (
  id BIGSERIAL PRIMARY KEY,
  episode_id BIGINT NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  panel_number INT NOT NULL,
  image_url TEXT NOT NULL,
  width INT,
  height INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(episode_id, panel_number)
);
