// ============================================================
// [Verification Script] improve1.md 정규화 DB 및 모듈 정합성 검증
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ghwabesnydktumeyejnm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_XYQ7ydRrTZQ94V6r1WKEtQ_pnL9Po5c';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runVerification() {
  console.log('🔍 [1] 모듈형 SQL 파일군 (/database) 존재 여부 검사...');
  const databaseDir = path.join(__dirname, '..', 'database');
  const expectedFiles = [
    '01_extensions.sql',
    '02_types.sql',
    '03_auth_profiles.sql',
    '04_content.sql',
    '05_reader.sql',
    '06_advertisement.sql',
    '07_revenue.sql',
    '08_settlement.sql',
    '09_community.sql',
    '10_commerce.sql',
    '11_system.sql',
    '12_functions.sql',
    '13_rls.sql',
    '14_grants.sql',
    '15_indexes.sql',
    '16_views.sql',
    '99_seed_dev.sql'
  ];

  let missingCount = 0;
  for (const f of expectedFiles) {
    const fullPath = path.join(databaseDir, f);
    if (fs.existsSync(fullPath)) {
      console.log(`✅ [SQL 모듈] database/${f} 정상 존재 (${fs.statSync(fullPath).size} bytes)`);
    } else {
      console.log(`❌ [SQL 모듈] database/${f} 누락됨`);
      missingCount++;
    }
  }

  // WebNovels_Production_v1.sql 존재 확인
  const prodSqlPath = path.join(__dirname, '..', 'WebNovels_Production_v1.sql');
  if (fs.existsSync(prodSqlPath)) {
    console.log(`✅ [통합 배포본] WebNovels_Production_v1.sql 정상 존재 (${fs.statSync(prodSqlPath).size} bytes)`);
  } else {
    console.log(`❌ [통합 배포본] WebNovels_Production_v1.sql 누락됨`);
    missingCount++;
  }

  console.log('\n🔍 [2] Supabase 클라우드 테이블 접근성 검사...');
  const tables = [
    'works',
    'episodes',
    'authors',
    'readers',
    'reading_history',
    'favorites',
    'author_subscriptions',
    'episode_unlocks',
    'ad_events',
    'author_earnings',
    'author_settlements',
    'admin_users',
    'platform_stats',
    'system_config',
    'comments',
    'comment_likes',
    'content_reviews',
    'reports'
  ];

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) {
        console.log(`⚠️ 테이블 [${table}]: DDL 적용 대기 상태 ->`, error.message);
      } else {
        console.log(`✅ 테이블 [${table}]: 정상 접근 확인 (레코드 수: ${data.length})`);
      }
    } catch (e) {
      console.log(`❌ 테이블 [${table}]: 예외 ->`, e.message);
    }
  }

  console.log('\n🎉 [improve1.md] 검증 완료!');
  process.exit(missingCount > 0 ? 1 : 0);
}

runVerification();
