const fs = require('node:fs');
const dotenv = require('dotenv');

function loadEnv() {
  const local = fs.existsSync('.env.local') ? dotenv.parse(fs.readFileSync('.env.local')) : {};
  return { ...local, ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value.trim())) };
}
function connection(env) {
  const url = new URL((env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim());
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password)
    throw Error('INVALID_SUPABASE_URL');
  return { url: url.origin, ref: url.hostname.split('.')[0] };
}
function managementToken(env) {
  const token = (env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!token) throw Error('MANAGEMENT_TOKEN_MISSING');
  if (!token.startsWith('sbp_')) throw Error('MANAGEMENT_PAT_REQUIRED');
  return token;
}
async function managementProbe(env, fetcher = fetch) {
  let target, token;
  try { target = connection(env); token = managementToken(env); }
  catch (error) { return { ok: false, code: error.message }; }
  try {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${target.ref}/database/query/read-only`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'select 1 as access_ok' }), signal: AbortSignal.timeout(20000), redirect: 'error'
    });
    const code = response.ok ? 'MANAGEMENT_SQL_ACCESS_OK' : response.status === 401 ? 'MANAGEMENT_TOKEN_REJECTED' :
      response.status === 403 ? 'MANAGEMENT_PROJECT_PERMISSION_DENIED' : response.status === 404 ? 'MANAGEMENT_PROJECT_NOT_FOUND_OR_HIDDEN' : 'MANAGEMENT_REQUEST_FAILED';
    return { ok: response.ok, status: response.status, code, projectRef: target.ref };
  } catch { return { ok: false, code: 'MANAGEMENT_NETWORK_UNREACHABLE', projectRef: target.ref }; }
}
module.exports = { loadEnv, connection, managementToken, managementProbe };
