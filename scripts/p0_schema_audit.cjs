// Read-only management audit. Definitions may contain secrets: output stays under ignored scratch/.
const fs = require('node:fs');
const dotenv = require('dotenv');
const local = fs.existsSync('.env.local') ? dotenv.parse(fs.readFileSync('.env.local')) : {};
const env = { ...local, ...process.env };
async function main() {
  const url = new URL(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token) { console.error('Missing SUPABASE_ACCESS_TOKEN. No DB changes made.'); process.exitCode = 2; return; }
  const response = await fetch('https://api.supabase.com/v1/projects/' + url.hostname.split('.')[0] + '/database/query', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: fs.readFileSync('database/p0/000_preflight.sql', 'utf8') }), signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) { console.error('Schema audit blocked: HTTP ' + response.status + '. No DB changes made.'); process.exitCode = 2; return; }
  const data = await response.json();
  fs.mkdirSync('scratch/p0', { recursive: true });
  fs.writeFileSync('scratch/p0/schema-audit.json', JSON.stringify(data, null, 2));
  console.log('Read-only schema audit saved to ignored scratch/p0/schema-audit.json. No definitions or secrets printed.');
}
main().catch(() => { console.error('Schema audit failed. No DB changes made.'); process.exitCode = 2; });
