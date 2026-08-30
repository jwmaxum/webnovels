-- WebNovels Production DB: 09_community.sql
-- 댓글(계층형 parent_id 지원), 댓글 공감, 유저 신고 및 콘텐츠 검수

-- 1. 독자 댓글 및 대댓글
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname_snapshot TEXT NOT NULL,
  work_id BIGINT REFERENCES public.works(id) ON DELETE CASCADE,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  likes_count INT NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 댓글 공감/좋아요
CREATE TABLE IF NOT EXISTS public.comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);

-- 3. 콘텐츠 심사/검수 (Action Queue)
CREATE TABLE IF NOT EXISTS public.content_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id BIGINT REFERENCES public.works(id) ON DELETE CASCADE,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE CASCADE,
  work_title_snapshot TEXT NOT NULL,
  author_name_snapshot TEXT NOT NULL,
  status public.review_status NOT NULL DEFAULT 'PENDING',
  reject_reason TEXT,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 유저 신고 관리
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('COMMENT', 'WORK', 'EPISODE', 'USER', 'AUTHOR')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status public.report_status NOT NULL DEFAULT 'PENDING',
  resolved_action TEXT,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
