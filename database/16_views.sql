-- WebNovels Production DB: 16_views.sql
-- 프론트엔드 UI 조회 및 성능 최적화 전용 데이터베이스 뷰

-- 1. 공개 작품 목록 뷰 (작가명 및 메타데이터 조인)
CREATE OR REPLACE VIEW public.v_public_works AS
SELECT
  w.id,
  w.author_id,
  a.pen_name AS author_name,
  w.title,
  w.content_type,
  w.genre,
  w.tags,
  w.description,
  w.cover_image,
  w.rating,
  w.status,
  w.is_completed,
  w.is_top_recommended,
  w.is_popular_work,
  w.is_new_work,
  w.ai_usage_type,
  w.view_count,
  w.like_count,
  w.published_at,
  w.created_at,
  (
    SELECT COUNT(*)::INT
    FROM public.episodes e
    WHERE e.work_id = w.id AND e.status = 'PUBLISHED'
  ) AS episodes_count
FROM public.works w
JOIN public.authors a ON a.id = w.author_id
WHERE w.status IN ('PUBLISHED', 'ONGOING', 'COMPLETED');

-- 2. 공개 회차 메타데이터 뷰
CREATE OR REPLACE VIEW public.v_public_episodes AS
SELECT
  e.id,
  e.work_id,
  w.title AS work_title,
  e.episode_number,
  e.title,
  e.access_policy,
  e.author_comment,
  e.status,
  e.view_count,
  e.created_at
FROM public.episodes e
JOIN public.works w ON w.id = e.work_id
WHERE e.status = 'PUBLISHED';

-- 3. 작가별 수익 대시보드 요약 뷰
CREATE OR REPLACE VIEW public.v_author_earnings_summary AS
SELECT
  a.id AS author_id,
  a.pen_name,
  COALESCE(SUM(CASE WHEN e.status = 'ESTIMATED' THEN e.author_revenue ELSE 0 END), 0) AS estimated_revenue,
  COALESCE(SUM(CASE WHEN e.status = 'CONFIRMED' THEN e.author_revenue ELSE 0 END), 0) AS confirmed_revenue,
  COALESCE(SUM(CASE WHEN e.status = 'SETTLED' THEN e.author_revenue ELSE 0 END), 0) AS settled_revenue
FROM public.authors a
LEFT JOIN public.author_earnings e ON e.author_id = a.id
GROUP BY a.id, a.pen_name;

-- 뷰 권한 부여
GRANT SELECT ON public.v_public_works TO anon, authenticated;
GRANT SELECT ON public.v_public_episodes TO anon, authenticated;
GRANT SELECT ON public.v_author_earnings_summary TO authenticated;
