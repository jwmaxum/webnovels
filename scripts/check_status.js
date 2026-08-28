const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.local
const envLocal = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.local')));
const SUPABASE_URL = envLocal.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = envLocal.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OPENROUTER_KEY = envLocal.OpenRouter_API_Key;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSupabase() {
  console.log('=== Checking Supabase Tables ===');
  const tables = [
    'works', 'episodes', 'readers', 'authors', 'admin_users',
    'revenue_events', 'author_settlements', 'system_config',
    'platform_stats', 'comments', 'comment_likes', 'content_reviews',
    'reports', 'point_transactions'
  ];

  for (const table of tables) {
    try {
      const { data, count, error } = await supabase.from(table).select('*', { count: 'exact' }).limit(5);
      if (error) {
        console.log(`Table [${table}]: Error -> ${error.message} (code: ${error.code})`);
      } else {
        console.log(`Table [${table}]: OK -> count=${count || data?.length || 0}, sampleIds=${data?.map(d => d.id || d.work_id || d.period_month).slice(0, 3)}`);
      }
    } catch (e) {
      console.log(`Table [${table}]: Exception -> ${e.message}`);
    }
  }
}

async function testGeminiOpenRouter() {
  console.log('\n=== Testing Gemini API via OpenRouter ===');
  if (!OPENROUTER_KEY) {
    console.log('No OpenRouter_API_Key found');
    return;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: 'Say "Gemini connected successfully" in Korean and English.' }],
        max_tokens: 50
      })
    });
    const json = await res.json();
    console.log('Gemini/OpenRouter Response:', JSON.stringify(json, null, 2));
  } catch (e) {
    console.error('OpenRouter call error:', e.message);
  }
}

async function main() {
  await checkSupabase();
  await testGeminiOpenRouter();
}

main().then(() => {
  console.log('Done check.');
}).catch(console.error);
