-- Phase 2/3: Discovery, creator moderation, reader analytics, direct support and immutable earnings ledger.
-- Apply after database/01_extensions.sql through database/17_creators_view.sql.

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS is_hidden_by_author BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS anchor_paragraph INT;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS quote_text TEXT;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS content_version TEXT;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS is_spoiler BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_quote_limit') THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_quote_limit CHECK (char_length(COALESCE(quote_text, '')) <= 300);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.episode_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  episode_number INT NOT NULL CHECK (episode_number > 0),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  author_comment TEXT NOT NULL DEFAULT '',
  server_revision INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(author_id, work_id, episode_number)
);

CREATE TABLE IF NOT EXISTS public.episode_draft_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.episode_drafts(id) ON DELETE CASCADE,
  server_revision INT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, author_comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(draft_id, server_revision)
);

CREATE TABLE IF NOT EXISTS public.work_comment_policies (
  work_id BIGINT PRIMARY KEY REFERENCES public.works(id) ON DELETE CASCADE,
  comments_enabled BOOLEAN NOT NULL DEFAULT true,
  blocked_terms TEXT[] NOT NULL DEFAULT '{}',
  min_read_episodes INT NOT NULL DEFAULT 0 CHECK (min_read_episodes BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_comment_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  creator_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  reader_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(work_id, reader_id)
);

CREATE TABLE IF NOT EXISTS public.golden_best_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  period_hour TIMESTAMPTZ NOT NULL,
  score NUMERIC(14,2) NOT NULL,
  rank INT NOT NULL CHECK (rank > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(work_id, period_hour)
);

-- Live fallback for the home surface; an hourly worker may snapshot this view for audit history.
CREATE OR REPLACE VIEW public.v_golden_best_current AS
WITH eligible AS (
  SELECT w.id AS work_id, w.title, w.author, w.genre, w.tags, w.cover_image, w.view_count,
    count(DISTINCT e.id) AS episode_count,
    count(c.id) FILTER (WHERE NOT c.is_deleted AND NOT c.is_blocked AND NOT c.is_hidden_by_author) AS valid_comments
  FROM public.works w
  LEFT JOIN public.episodes e ON e.work_id = w.id AND (e.status = 'PUBLISHED' OR e.status IS NULL)
  LEFT JOIN public.comments c ON c.work_id = w.id
  WHERE w.created_at >= now() - interval '30 days'
  GROUP BY w.id
)
SELECT *, row_number() OVER (ORDER BY ((LEAST(view_count, 10000) * 0.01) + (valid_comments * 2)) DESC, work_id) AS rank,
  ((LEAST(view_count, 10000) * 0.01) + (valid_comments * 2))::NUMERIC(14,2) AS score,
  format('최근 신작 · 유효 댓글 %s', valid_comments) AS reason
FROM eligible WHERE episode_count BETWEEN 1 AND 15;
GRANT SELECT ON public.v_golden_best_current TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.reader_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash TEXT NOT NULL,
  reader_id TEXT,
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('OPEN', 'PROGRESS', 'COMPLETE', 'EXIT')),
  progress NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  content_version TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_supports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id BIGINT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  reader_id TEXT NOT NULL,
  amount_points INT NOT NULL CHECK (amount_points BETWEEN 1000 AND 50000),
  idempotency_key UUID NOT NULL UNIQUE,
  display_name TEXT,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED', 'REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.readers ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 0 CHECK (points >= 0);

CREATE TABLE IF NOT EXISTS public.earning_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id BIGINT NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  work_id BIGINT REFERENCES public.works(id) ON DELETE SET NULL,
  episode_id BIGINT REFERENCES public.episodes(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('AD', 'POINT_SALE', 'SUPPORT', 'ADJUSTMENT')),
  source_id TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  status TEXT NOT NULL DEFAULT 'ESTIMATED' CHECK (status IN ('ESTIMATED', 'CONFIRMED', 'SETTLED', 'VOID')),
  correction_of UUID REFERENCES public.earning_ledger(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_type, source_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_comments_public_episode ON public.comments(episode_id, created_at DESC) WHERE NOT is_deleted AND NOT is_blocked AND NOT is_hidden_by_author;
CREATE INDEX IF NOT EXISTS idx_comment_blocks_work_reader ON public.creator_comment_blocks(work_id, reader_id);
CREATE INDEX IF NOT EXISTS idx_golden_best_period_rank ON public.golden_best_snapshots(period_hour DESC, rank);
CREATE INDEX IF NOT EXISTS idx_reader_events_work_episode_time ON public.reader_events(work_id, episode_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_supports_author_time ON public.creator_supports(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_earning_ledger_author_time ON public.earning_ledger(author_id, created_at DESC);

-- These RPCs keep points and support/analytics records consistent even with concurrent requests.
CREATE OR REPLACE FUNCTION public.record_reader_event(
  p_work_id BIGINT, p_episode_id BIGINT, p_event_type TEXT, p_progress NUMERIC DEFAULT 0, p_content_version TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  INSERT INTO public.reader_events (session_hash, reader_id, work_id, episode_id, event_type, progress, content_version)
  VALUES (encode(digest(auth.uid()::TEXT || clock_timestamp()::TEXT, 'sha256'), 'hex'), auth.uid()::TEXT, p_work_id, p_episode_id, p_event_type, LEAST(100, GREATEST(0, p_progress)), p_content_version)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.support_creator(
  p_work_id BIGINT, p_amount_points INT, p_idempotency_key UUID, p_is_anonymous BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reader UUID := auth.uid(); v_author_id BIGINT; v_existing public.creator_supports; v_support public.creator_supports;
BEGIN
  IF v_reader IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_amount_points NOT BETWEEN 1000 AND 50000 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  SELECT * INTO v_existing FROM public.creator_supports WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('support_id', v_existing.id, 'duplicate', true); END IF;
  SELECT author_id INTO v_author_id FROM public.works WHERE id = p_work_id;
  IF v_author_id IS NULL THEN RAISE EXCEPTION 'WORK_NOT_FOUND'; END IF;
  UPDATE public.readers SET points = points - p_amount_points WHERE id = v_reader AND points >= p_amount_points;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_POINTS'; END IF;
  INSERT INTO public.creator_supports (work_id, author_id, reader_id, amount_points, idempotency_key, is_anonymous)
  VALUES (p_work_id, v_author_id, v_reader::TEXT, p_amount_points, p_idempotency_key, p_is_anonymous) RETURNING * INTO v_support;
  INSERT INTO public.earning_ledger (author_id, work_id, source_type, source_id, amount, currency, status)
  VALUES (v_author_id, p_work_id, 'SUPPORT', v_support.id::TEXT, p_amount_points, 'POINT', 'CONFIRMED');
  RETURN jsonb_build_object('support_id', v_support.id, 'duplicate', false);
END $$;

ALTER TABLE public.reader_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_supports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earning_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_comment_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_comment_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_draft_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_author_episode_drafts ON public.episode_drafts;
CREATE POLICY p_author_episode_drafts ON public.episode_drafts FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.authors a WHERE a.id = author_id AND a.auth_user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.authors a WHERE a.id = author_id AND a.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS p_author_draft_revisions ON public.episode_draft_revisions;
CREATE POLICY p_author_draft_revisions ON public.episode_draft_revisions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.episode_drafts d JOIN public.authors a ON a.id = d.author_id WHERE d.id = draft_id AND a.auth_user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.episode_drafts d JOIN public.authors a ON a.id = d.author_id WHERE d.id = draft_id AND a.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS p_author_work_policy ON public.work_comment_policies;
CREATE POLICY p_author_work_policy ON public.work_comment_policies FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.works w JOIN public.authors a ON a.id = w.author_id WHERE w.id = work_id AND a.auth_user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.works w JOIN public.authors a ON a.id = w.author_id WHERE w.id = work_id AND a.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS p_author_comment_blocks ON public.creator_comment_blocks;
CREATE POLICY p_author_comment_blocks ON public.creator_comment_blocks FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.works w JOIN public.authors a ON a.id = w.author_id WHERE w.id = work_id AND a.auth_user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.works w JOIN public.authors a ON a.id = w.author_id WHERE w.id = work_id AND a.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS p_author_hide_comments ON public.comments;
CREATE POLICY p_author_hide_comments ON public.comments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.episodes e JOIN public.works w ON w.id = e.work_id JOIN public.authors a ON a.id = w.author_id WHERE e.id = episode_id AND a.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS p_reader_events_insert ON public.reader_events;
CREATE POLICY p_reader_events_insert ON public.reader_events FOR INSERT TO authenticated WITH CHECK (reader_id = auth.uid()::TEXT);
DROP POLICY IF EXISTS p_reader_events_author_select ON public.reader_events;
CREATE POLICY p_reader_events_author_select ON public.reader_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.works w JOIN public.authors a ON a.id = w.author_id WHERE w.id = work_id AND a.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS p_support_reader_select ON public.creator_supports;
CREATE POLICY p_support_reader_select ON public.creator_supports FOR SELECT TO authenticated USING (reader_id = auth.uid()::TEXT);
DROP POLICY IF EXISTS p_support_author_select ON public.creator_supports;
CREATE POLICY p_support_author_select ON public.creator_supports FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.authors a WHERE a.id = author_id AND a.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS p_ledger_author_select ON public.earning_ledger;
CREATE POLICY p_ledger_author_select ON public.earning_ledger FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.authors a WHERE a.id = author_id AND a.auth_user_id = auth.uid()));
GRANT EXECUTE ON FUNCTION public.record_reader_event(BIGINT, BIGINT, TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_creator(BIGINT, INT, UUID, BOOLEAN) TO authenticated;

-- Realtime subscriptions are intentionally enabled for reader events and support receipts.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.reader_events'::regclass) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.reader_events; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.creator_supports'::regclass) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.creator_supports; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.golden_best_snapshots'::regclass) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.golden_best_snapshots; END IF;
END $$;
