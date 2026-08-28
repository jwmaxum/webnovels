const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.local')));
const supabase = createClient(envLocal.NEXT_PUBLIC_SUPABASE_URL, envLocal.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fixAdditionalData() {
  console.log('--- Seeding revenue_events ---');
  const revenueEvents = [
    { period_month: '2026-05', gross_revenue: 19800000, ad_network_fee: 1980000, net_revenue: 17820000, writer_pool_ratio: 0.625, writer_pool: 11137500, platform_revenue: 6682500, is_closed: true },
    { period_month: '2026-06', gross_revenue: 22500000, ad_network_fee: 2250000, net_revenue: 20250000, writer_pool_ratio: 0.625, writer_pool: 12656250, platform_revenue: 7593750, is_closed: true },
    { period_month: '2026-07', gross_revenue: 26400000, ad_network_fee: 2640000, net_revenue: 23760000, writer_pool_ratio: 0.625, writer_pool: 14850000, platform_revenue: 8910000, is_closed: true },
    { period_month: '2026-08', gross_revenue: 31200000, ad_network_fee: 3120000, net_revenue: 28080000, writer_pool_ratio: 0.625, writer_pool: 17550000, platform_revenue: 10530000, is_closed: false }
  ];

  for (const rev of revenueEvents) {
    const { data: existing } = await supabase.from('revenue_events').select('id').eq('period_month', rev.period_month).limit(1);
    if (existing && existing.length > 0) {
      await supabase.from('revenue_events').update(rev).eq('id', existing[0].id);
    } else {
      const { error } = await supabase.from('revenue_events').insert(rev);
      if (error) console.error('revenue insert error:', error.message);
    }
  }

  console.log('--- Seeding point_transactions ---');
  const pointTxs = [
    { user_id: 'reader1', type: 'CHARGE', amount: 5000, work_id: null, episode_id: null },
    { user_id: 'reader1', type: 'USE', amount: -200, work_id: 1, episode_id: 4 },
    { user_id: 'reader2', type: 'CHARGE', amount: 10000, work_id: null, episode_id: null },
    { user_id: 'reader2', type: 'USE', amount: -200, work_id: 3, episode_id: 4 },
    { user_id: 'reader3', type: 'CHARGE', amount: 30000, work_id: null, episode_id: null },
    { user_id: 'reader3', type: 'USE', amount: -200, work_id: 2, episode_id: 5 },
    { user_id: 'reader5', type: 'CHARGE', amount: 50000, work_id: null, episode_id: null },
    { user_id: 'reader9', type: 'CHARGE', amount: 20000, work_id: null, episode_id: null }
  ];

  for (const p of pointTxs) {
    const { error } = await supabase.from('point_transactions').insert(p);
    if (error) console.error('point_transaction insert error:', error.message);
  }

  console.log('--- Seeding comment_likes ---');
  const { data: allComments } = await supabase.from('comments').select('id').limit(5);
  if (allComments) {
    for (const c of allComments) {
      await supabase.from('comment_likes').upsert({
        comment_id: c.id,
        user_id: 'reader1'
      }, { onConflict: 'comment_id,user_id' });
    }
  }

  console.log('Done additional seeding.');
}

fixAdditionalData().catch(console.error);
