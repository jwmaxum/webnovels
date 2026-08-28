const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

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
  console.log('SQL Execution Result:', JSON.stringify(data, null, 2));
  return data;
}

const fixRlsSql = `
-- Allow anon full access for readers and authors for test/demo dataset
DROP POLICY IF EXISTS "Allow anon read readers" ON readers;
DROP POLICY IF EXISTS "Allow anon read authors" ON authors;
DROP POLICY IF EXISTS "Allow anon full access readers" ON readers;
DROP POLICY IF EXISTS "Allow anon full access authors" ON authors;

CREATE POLICY "Allow anon full access readers" ON readers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access authors" ON authors FOR ALL USING (true) WITH CHECK (true);
`;

runSql(fixRlsSql).catch(console.error);
