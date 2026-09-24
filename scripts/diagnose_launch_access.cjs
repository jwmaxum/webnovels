// Read-only diagnostics. Never print tokens, response bodies, account rows or connection strings.
const fs = require('node:fs');
const { loadEnv, connection, managementProbe } = require('./lib/launch-access.cjs');

async function main() {
  const env = loadEnv();
  const report = { checkedAt: new Date().toISOString(), management: await managementProbe(env), dataApi: {}, production: {} };
  let target;
  try { target = connection(env); } catch { /* reported by managementProbe */ }
  if (target) {
    for (const [name, key] of [['publishable', env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
      ['server', env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY]]) {
      if (!key) { report.dataApi[name] = { code: 'KEY_MISSING' }; continue; }
      try {
        const response = await fetch(`${target.url}/rest/v1/works?select=id&limit=0`, {
          method: 'HEAD', headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) },
          signal: AbortSignal.timeout(15000), redirect: 'error'
        });
        report.dataApi[name] = { status: response.status };
      } catch { report.dataApi[name] = { code: 'NETWORK_UNREACHABLE' }; }
    }
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (secret) {
      try {
        const response = await fetch(`${target.url}/rest/v1/p0_migration_status?select=version,phase`, {
          headers: { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}) },
          signal: AbortSignal.timeout(15000), redirect: 'error'
        });
        report.databaseSecurity = { status: response.status, locked: false };
        if (response.ok) {
          const rows = await response.json();
          report.databaseSecurity.locked = Array.isArray(rows) && rows.some(row => row.version === 'p0-20260921' && row.phase === 'locked');
        }
      } catch { report.databaseSecurity = { code: 'NETWORK_UNREACHABLE' }; }
    }
  }
  for (const path of ['/', '/api/public-config.js', '/api/v2/health']) {
    try {
      const response = await fetch('https://webnovels-db4.pages.dev' + path, {
        method: path === '/' ? 'HEAD' : 'GET', signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      report.production[path] = { status: response.status };
      if (path.endsWith('/health') && response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.json();
        if (typeof data.error === 'string' && /^[A-Z_]+$/.test(data.error)) report.production[path].code = data.error;
      }
    } catch { report.production[path] = { code: 'NETWORK_UNREACHABLE' }; }
  }
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/launch-access-diagnostic.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.management.ok) process.exitCode = 2;
}
main().catch(() => { console.error('ACCESS_DIAGNOSTIC_FAILED (details redacted)'); process.exitCode = 2; });
