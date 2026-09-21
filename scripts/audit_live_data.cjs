// Read-only audit. Never prints profile values, hashes, or configuration secrets.
const fs = require('node:fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function main() {
  const tables = ['works', 'episodes', 'readers', 'authors', 'admin_users', 'system_config', 'comments', 'reading_history', 'favorites', 'author_subscriptions', 'author_earnings', 'fan_meetings', 'goods', 'events', 'ad_units', 'audit_logs'];
  const report = { checkedAt: new Date().toISOString(), tables: {} };
  for (const name of tables) {
    const { count, error } = await db.from(name).select('*', { count: 'exact', head: true });
    const sample = await db.from(name).select('*').limit(1);
    report.tables[name] = { count, error: error?.message, columns: Object.keys(sample.data?.[0] || {}) };
  }
  const episodes = await db.from('episodes').select('id, work_id, episode_number, status, content, image_urls, is_free');
  report.episodes = {
    missingContent: episodes.data?.filter(e => !e.content?.trim() && !e.image_urls?.length).map(e => e.id),
    anonymousPaidContentReadable: episodes.data?.filter(e => !e.is_free && !!e.content).length,
    states: [...new Set(episodes.data?.map(e => e.status))]
  };
  const works = await db.from('works').select('status');
  report.workStates = [...new Set(works.data?.map(w => w.status))];
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/live-data-audit.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
