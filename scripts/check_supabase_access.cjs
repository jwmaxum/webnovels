const fs = require('node:fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const ref = new URL(url).hostname.split('.')[0];
async function main() {
  for (const [name, key] of [
    ['publishable', env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ['serverSecret', env.SUPABASE_SECRET_KEY || env.NEXT_PUBLIC_SUPABASE_SECRET_KEY],
    ['serviceRole', env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY]
  ]) {
    if (!key) { console.log(name + ': missing'); continue; }
    const headers = { apikey: key };
    if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
    const response = await fetch(url + '/rest/v1/works?select=id&limit=1', { headers });
    console.log(name + ': HTTP ' + response.status);
  }
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + (env.SUPABASE_ACCESS_TOKEN || env.access_token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "select current_database(), current_user" })
  });
  console.log('management: HTTP ' + response.status);
}
main().catch(error => { console.error(error.name + ': connection failed'); process.exitCode = 1; });
