// Read-only management audit. Definitions may contain secrets: output stays under ignored scratch/.
const fs = require('node:fs');
const { loadEnv, connection, managementToken, managementProbe } = require('./lib/launch-access.cjs');
const env = loadEnv();
async function main() {
  const probe = await managementProbe(env);
  if (!probe.ok) {
    console.error(`Schema audit blocked: ${probe.code}${probe.status ? ' (HTTP ' + probe.status + ')' : ''}. See docs/launch/production-activation.md. No DB changes made.`);
    process.exitCode = 2; return;
  }
  const response = await fetch('https://api.supabase.com/v1/projects/' + connection(env).ref + '/database/query/read-only', {
    method: 'POST', headers: { Authorization: 'Bearer ' + managementToken(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: fs.readFileSync('database/p0/000_preflight.sql', 'utf8') }), signal: AbortSignal.timeout(20000), redirect: 'error'
  });
  if (!response.ok) { console.error('Schema audit blocked: HTTP ' + response.status + '. No DB changes made.'); process.exitCode = 2; return; }
  const data = await response.json();
  fs.mkdirSync('scratch/p0', { recursive: true });
  fs.writeFileSync('scratch/p0/schema-audit.json', JSON.stringify(data, null, 2));
  console.log('Read-only schema audit saved to ignored scratch/p0/schema-audit.json. No definitions or secrets printed.');
}
main().catch(() => { console.error('Schema audit failed. No DB changes made.'); process.exitCode = 2; });
