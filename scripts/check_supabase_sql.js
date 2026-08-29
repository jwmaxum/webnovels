const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://ghwabesnydktumeyejnm.supabase.co',
  'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c'
);

(async () => {
  const tables = [
    'readers',
    'authors',
    'works',
    'episodes',
    'admin_users',
    'revenue_events',
    'author_settlements',
    'system_config',
    'platform_stats',
    'content_reviews',
    'reports',
    'point_transactions',
    'comments',
    'comment_likes'
  ];

  console.log('=== [1] 테이블별 SELECT 테스트 및 컬럼 확인 ===');
  for (const tbl of tables) {
    const { data, error } = await supabase.from(tbl).select('*').limit(1);
    if (error) {
      console.log(`[FAIL] [${tbl}] SELECT Error:`, error.message);
    } else {
      console.log(`[OK] [${tbl}] SELECT OK, columns:`, data && data.length > 0 ? Object.keys(data[0]) : '(empty table)');
    }
  }

  console.log('\n=== [2] 주요 쓰기(INSERT/UPDATE/DELETE) RLS 권한 테스트 ===');
  // 1. author_settlements INSERT test
  const testSettlement = {
    author_name: '__test_author__',
    amount: 1000,
    status: 'PENDING',
    bank_info: '테스트은행 123-456'
  };
  const { data: insSett, error: setErr } = await supabase.from('author_settlements').insert(testSettlement).select();
  if (setErr) {
    console.log('[FAIL] author_settlements INSERT Error:', setErr.message);
  } else {
    console.log('[OK] author_settlements INSERT OK, id:', insSett[0].id);
    await supabase.from('author_settlements').delete().eq('id', insSett[0].id);
  }

  // 2. readers UPDATE test
  const { data: readOne } = await supabase.from('readers').select('id, username, is_adult_verified').limit(1);
  if (readOne && readOne.length > 0) {
    const { data: updRead, error: readUpdErr } = await supabase.from('readers').update({ is_adult_verified: readOne[0].is_adult_verified }).eq('id', readOne[0].id).select();
    if (readUpdErr) {
      console.log('[FAIL] readers UPDATE Error (RLS blocked?):', readUpdErr.message);
    } else {
      console.log('[OK] readers UPDATE OK, count:', updRead ? updRead.length : 0);
    }
  }

  // 3. readers INSERT test
  const testReader = {
    id: 999999,
    username: '__test_reader_9999__',
    email: '__test_reader_9999__@test.com',
    nickname: '임시테스트',
    is_adult_verified: false
  };
  const { data: insRead, error: readInsErr } = await supabase.from('readers').insert(testReader).select();
  if (readInsErr) {
    console.log('[FAIL] readers INSERT Error (RLS blocked?):', readInsErr.message);
  } else {
    console.log('[OK] readers INSERT OK');
    await supabase.from('readers').delete().eq('id', 999999);
  }

  // 4. content_reviews UPDATE test
  const { data: revOne } = await supabase.from('content_reviews').select('id').limit(1);
  if (revOne && revOne.length > 0) {
    const { data: updRev, error: revUpdErr } = await supabase.from('content_reviews').update({ reviewer_name: '최고관리자' }).eq('id', revOne[0].id).select();
    if (revUpdErr) {
      console.log('[FAIL] content_reviews UPDATE Error (RLS blocked?):', revUpdErr.message);
    } else {
      console.log('[OK] content_reviews UPDATE OK');
    }
  }

  // 5. reports UPDATE test
  const { data: repOne } = await supabase.from('reports').select('id').limit(1);
  if (repOne && repOne.length > 0) {
    const { data: updRep, error: repUpdErr } = await supabase.from('reports').update({ resolved_action: '검토' }).eq('id', repOne[0].id).select();
    if (repUpdErr) {
      console.log('[FAIL] reports UPDATE Error (RLS blocked?):', repUpdErr.message);
    } else {
      console.log('[OK] reports UPDATE OK');
    }
  }
})();
