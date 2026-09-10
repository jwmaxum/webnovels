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
  console.log('1. Allowing SETTLEMENT in earning_ledger check constraint...');
  const sqlAlter = `
    ALTER TABLE public.earning_ledger DROP CONSTRAINT IF EXISTS earning_ledger_source_type_check;
    ALTER TABLE public.earning_ledger ADD CONSTRAINT earning_ledger_source_type_check
      CHECK (source_type IN ('AD', 'POINT_SALE', 'SUPPORT', 'ADJUSTMENT', 'SETTLEMENT'));
  `;
  await runSql(sqlAlter);

  console.log('2. Inserting into earning_ledger...');
  const sqlInsert = `
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
      (2, 12, 'AD', 'ad-seed-aut2', 320000, 'KRW', 'CONFIRMED', now() - interval '2 days'),
      (3, 3, 'AD', 'ad-seed-aut3', 280000, 'KRW', 'CONFIRMED', now() - interval '3 days'),
      (1, 1, 'SUPPORT', 'sup-seed-5', 3000, 'POINT', 'CONFIRMED', now() - interval '20 minutes')
    ON CONFLICT (source_type, source_id, author_id) DO NOTHING
    RETURNING id, author_id, work_id, source_type, amount, status;
  `;
  await runSql(sqlInsert);

  console.log('3. Inserting episode_drafts & revisions...');
  const sqlDraft = `
    INSERT INTO public.episode_drafts (author_id, work_id, episode_number, title, content, author_comment, server_revision, updated_at)
    VALUES
      (1, 1, 7, '제 7 화: 폭풍의 중심에서', '대기 중의 마나가 소용돌이치며 푸른 불꽃을 일으켰다.\n"이 힘은... 전설로만 전해지던 고대 마법인가?"', '다음 연재분 작성 중입니다.', 2, now())
    ON CONFLICT (author_id, work_id, episode_number) DO NOTHING
    RETURNING id, title, server_revision;
  `;
  await runSql(sqlDraft);
}

main().catch(console.error);
