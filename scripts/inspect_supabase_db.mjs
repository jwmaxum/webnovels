import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLES = [
  'readers',
  'authors',
  'works',
  'episodes',
  'comments',
  'comment_likes',
  'revenue_events',
  'author_settlements',
  'creator_supports',
  'earning_ledger',
  'reader_events',
  'work_comment_policies',
  'creator_comment_blocks',
  'episode_drafts',
  'golden_best_snapshots',
  'admin_users',
  'system_config',
  'platform_stats'
];

async function inspect() {
  console.log('🔍 ====================================================');
  console.log('🔍 Supabase DB 상태 및 테이블 실시간 데이터 점검');
  console.log('🔍 URL:', SUPABASE_URL);
  console.log('🔍 ====================================================\n');

  const results = {};

  for (const tbl of TABLES) {
    try {
      const { count, error: countErr } = await supabase.from(tbl).select('*', { count: 'exact', head: true });
      if (countErr) {
        results[tbl] = { exists: false, error: countErr.message };
        console.log(`❌ [${tbl}] 조회 실패 (테이블 미존재 또는 권한 없음): ${countErr.message}`);
      } else {
        const { data: sample, error: sampleErr } = await supabase.from(tbl).select('*').limit(2);
        results[tbl] = {
          exists: true,
          count: count || 0,
          sample: sample || [],
          columns: sample && sample.length > 0 ? Object.keys(sample[0]) : []
        };
        console.log(`✅ [${tbl}] 레코드 수: ${count}개 | 컬럼: [${results[tbl].columns.join(', ')}]`);
      }
    } catch (e) {
      results[tbl] = { exists: false, error: e.message };
      console.log(`❌ [${tbl}] 예외 발생: ${e.message}`);
    }
  }

  console.log('\n--- 작품(works) 상위 3건 점검 ---');
  const { data: works } = await supabase.from('works').select('id, title, author, genre, view_count, is_completed').limit(3);
  console.log(JSON.stringify(works, null, 2));

  console.log('\n--- 회차(episodes) 상위 3건 점검 ---');
  const { data: episodes } = await supabase.from('episodes').select('id, work_id, episode_number, title').limit(3);
  console.log(JSON.stringify(episodes, null, 2));
}

inspect();
