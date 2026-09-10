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
  console.log('Result:', JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  console.log('Inserting into creator_supports...');
  const sql1 = `
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
    RETURNING id, work_id, display_name, amount_points;
  `;
  await runSql(sql1);

  console.log('Inserting into earning_ledger...');
  const sql2 = `
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
    RETURNING id, author_id, source_type, amount, status;
  `;
  await runSql(sql2);
}

main().catch(console.error);
