import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envLocal = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.local')));
const ACCESS_TOKEN = envLocal.access_token;
const PROJECT_REF = 'ghwabesnydktumeyejnm';

async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  const data = await res.json();
  if (data.error) {
    console.error('SQL Error:', data.error);
    throw new Error(data.error);
  }
  return data;
}

async function main() {
  console.log('🚀 ====================================================');
  console.log('🚀 Supabase RLS 권한 정비 및 Mock -> DB 실제 데이터 변환');
  console.log('🚀 ====================================================\n');

  // 1. RLS 정책 정비 (anon/authenticated에게 필요한 조회/쓰기 권한 허용 및 실시간 publication 등록)
  console.log('▶ [1/4] 신규 테이블 RLS 권한 정비 및 Supabase Realtime Publication 등록');
  const rlsSql = `
    -- 1. creator_supports RLS
    ALTER TABLE public.creator_supports ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "p_supports_select_all" ON public.creator_supports;
    DROP POLICY IF EXISTS "p_supports_insert_all" ON public.creator_supports;
    CREATE POLICY "p_supports_select_all" ON public.creator_supports FOR SELECT USING (true);
    CREATE POLICY "p_supports_insert_all" ON public.creator_supports FOR INSERT WITH CHECK (true);

    -- 2. earning_ledger RLS
    ALTER TABLE public.earning_ledger ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "p_ledger_select_all" ON public.earning_ledger;
    DROP POLICY IF EXISTS "p_ledger_insert_all" ON public.earning_ledger;
    CREATE POLICY "p_ledger_select_all" ON public.earning_ledger FOR SELECT USING (true);
    CREATE POLICY "p_ledger_insert_all" ON public.earning_ledger FOR INSERT WITH CHECK (true);

    -- 3. work_comment_policies RLS
    ALTER TABLE public.work_comment_policies ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "p_comment_policies_select_all" ON public.work_comment_policies;
    DROP POLICY IF EXISTS "p_comment_policies_all" ON public.work_comment_policies;
    CREATE POLICY "p_comment_policies_select_all" ON public.work_comment_policies FOR SELECT USING (true);
    CREATE POLICY "p_comment_policies_all" ON public.work_comment_policies FOR ALL USING (true) WITH CHECK (true);

    -- 4. creator_comment_blocks RLS
    ALTER TABLE public.creator_comment_blocks ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "p_comment_blocks_all" ON public.creator_comment_blocks;
    CREATE POLICY "p_comment_blocks_all" ON public.creator_comment_blocks FOR ALL USING (true) WITH CHECK (true);

    -- 5. golden_best_snapshots RLS
    ALTER TABLE public.golden_best_snapshots ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "p_golden_snapshots_select_all" ON public.golden_best_snapshots;
    DROP POLICY IF EXISTS "p_golden_snapshots_all" ON public.golden_best_snapshots;
    CREATE POLICY "p_golden_snapshots_select_all" ON public.golden_best_snapshots FOR SELECT USING (true);
    CREATE POLICY "p_golden_snapshots_all" ON public.golden_best_snapshots FOR ALL USING (true) WITH CHECK (true);

    -- 6. reader_events RLS
    ALTER TABLE public.reader_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "p_reader_events_all" ON public.reader_events;
    CREATE POLICY "p_reader_events_all" ON public.reader_events FOR ALL USING (true) WITH CHECK (true);

    -- 7. episode_drafts & revisions RLS
    ALTER TABLE public.episode_drafts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.episode_draft_revisions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "p_drafts_all" ON public.episode_drafts;
    DROP POLICY IF EXISTS "p_draft_revisions_all" ON public.episode_draft_revisions;
    CREATE POLICY "p_drafts_all" ON public.episode_drafts FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "p_draft_revisions_all" ON public.episode_draft_revisions FOR ALL USING (true) WITH CHECK (true);

    -- Realtime publication 추가
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.creator_supports'::regclass) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.creator_supports;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.earning_ledger'::regclass) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.earning_ledger;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.reader_events'::regclass) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.reader_events;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.comments'::regclass) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' AND pr.prrelid = 'public.author_settlements'::regclass) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.author_settlements;
      END IF;
    END $$;
  `;
  await runSql(rlsSql);
  console.log('   ✅ RLS 정책 및 Realtime Publication 등록 완료');

  // 2. 작품별 댓글 정책(work_comment_policies) 실제 DB 데이터 시딩
  console.log('\n▶ [2/4] 작품별 댓글 정책(work_comment_policies) 실제 데이터 반영');
  const policySql = `
    INSERT INTO public.work_comment_policies (work_id, comments_enabled, blocked_terms, min_read_episodes, updated_at)
    SELECT id, true, ARRAY['결말스포', '망작', '비추천', '복사글'], 0, now()
    FROM public.works
    ON CONFLICT (work_id) DO NOTHING;
  `;
  await runSql(policySql);
  console.log('   ✅ 30개 작품 전체 댓글 정책 생성 완료');

  // 3. 독자 후원(creator_supports) 및 수익 원장(earning_ledger) 실제 DB 데이터 시딩
  console.log('\n▶ [3/4] 독자 후원(creator_supports) 및 수익 원장(earning_ledger) 실제 데이터 반영');
  const supportAndLedgerSql = `
    -- 1. 독자 후원 데이터 실제 등록 (작품 1, 11, 12, 13 등)
    INSERT INTO public.creator_supports (work_id, author_id, reader_id, amount_points, idempotency_key, display_name, is_anonymous, status, created_at)
    VALUES
      (1, 1, 'reader-star', 10000, gen_random_uuid(), '별빛서재', false, 'COMPLETED', now() - interval '2 hours'),
      (1, 1, 'reader-gold', 5000, gen_random_uuid(), '황금독자', false, 'COMPLETED', now() - interval '5 hours'),
      (1, 1, 'reader-anon1', 5000, gen_random_uuid(), '익명의 후원자', true, 'COMPLETED', now() - interval '1 day'),
      (1, 1, 'reader-novel', 3000, gen_random_uuid(), '소설매니아', false, 'COMPLETED', now() - interval '2 days'),
      (1, 1, 'reader-moon', 1000, gen_random_uuid(), '달빛나그네', false, 'COMPLETED', now() - interval '3 days'),
      (11, 1, 'reader-star', 5000, gen_random_uuid(), '별빛서재', false, 'COMPLETED', now() - interval '4 hours'),
      (11, 1, 'reader-blade', 3000, gen_random_uuid(), '검의달인', false, 'COMPLETED', now() - interval '1 day'),
      (12, 2, 'reader-gold', 10000, gen_random_uuid(), '황금독자', false, 'COMPLETED', now() - interval '6 hours')
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- 2. 수익 원장 (earning_ledger) 실제 데이터 등록 (광고, 판매, 후원, 출금)
    INSERT INTO public.earning_ledger (author_id, work_id, source_type, source_id, amount, currency, status, created_at)
    VALUES
      (1, 1, 'SUPPORT', 'sup-seed-1', 10000, 'POINT', 'CONFIRMED', now() - interval '2 hours'),
      (1, 1, 'SUPPORT', 'sup-seed-2', 5000, 'POINT', 'CONFIRMED', now() - interval '5 hours'),
      (1, 1, 'AD', 'ad-seed-sep', 450000, 'KRW', 'CONFIRMED', now() - interval '1 day'),
      (1, 1, 'POINT_SALE', 'sale-seed-ep5', 38000, 'KRW', 'CONFIRMED', now() - interval '2 days'),
      (1, 1, 'SUPPORT', 'sup-seed-3', 5000, 'POINT', 'CONFIRMED', now() - interval '2 days'),
      (1, 1, 'AD', 'ad-seed-daily', 62000, 'KRW', 'ESTIMATED', now() - interval '3 hours'),
      (1, 1, 'SETTLEMENT', 'set-seed-prev', -300000, 'KRW', 'SETTLED', now() - interval '15 days'),
      (2, 12, 'SUPPORT', 'sup-seed-4', 10000, 'POINT', 'CONFIRMED', now() - interval '6 hours'),
      (2, 12, 'AD', 'ad-seed-aut2', 320000, 'KRW', 'CONFIRMED', now() - interval '2 days')
    ON CONFLICT (source_type, source_id, author_id) DO NOTHING;
  `;
  await runSql(supportAndLedgerSql);
  console.log('   ✅ 독자 후원 및 수익 원장 실제 데이터 등록 완료');

  // 4. 골든 베스트 스냅샷 및 독서 이벤트 실제 데이터 시딩
  console.log('\n▶ [4/4] 골든 베스트 스냅샷 및 독서 이벤트 실제 데이터 반영');
  const analyticsAndGoldenSql = `
    -- 골든 베스트 실시간 스냅샷 등록
    INSERT INTO public.golden_best_snapshots (work_id, period_hour, score, rank, reason, created_at)
    SELECT 
      w.id,
      date_trunc('hour', now()),
      (LEAST(w.view_count, 10000) * 0.01 + 20)::NUMERIC(14,2),
      row_number() OVER (ORDER BY w.view_count DESC),
      '최근 신작 및 독자 활성 지수 상위작',
      now()
    FROM public.works w
    LIMIT 5
    ON CONFLICT (work_id, period_hour) DO NOTHING;

    -- 작품 1, 11 독서 이벤트(reader_events) 실제 데이터 등록 (1화, 3화, 5화 완독/열람)
    INSERT INTO public.reader_events (session_hash, reader_id, work_id, episode_id, event_type, progress, occurred_at)
    SELECT 
      md5(random()::text || clock_timestamp()::text),
      'reader-' || (g % 20),
      1,
      CASE (g % 5)
        WHEN 0 THEN 3
        WHEN 1 THEN 4
        WHEN 2 THEN 101
        ELSE 3
      END,
      CASE (g % 3)
        WHEN 0 THEN 'OPEN'
        WHEN 1 THEN 'PROGRESS'
        ELSE 'COMPLETE'
      END,
      CASE (g % 3)
        WHEN 0 THEN 10
        WHEN 1 THEN 55
        ELSE 100
      END,
      now() - (g || ' hours')::interval
    FROM generate_series(1, 80) g;
  `;
  await runSql(analyticsAndGoldenSql);
  console.log('   ✅ 골든 베스트 스냅샷 및 독서 이벤트 80건 등록 완료');

  console.log('\n✨ ====================================================');
  console.log('✨ Supabase DB 실제 데이터 변환 및 RLS 정비가 완료되었습니다!');
  console.log('✨ ====================================================');
}

main().catch(console.error);
