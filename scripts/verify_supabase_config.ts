import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { publicSupabaseConfig } from '../src/config/supabase.js';
import { ENV } from '../src/config/env.js';
import { app } from '../src/app.js';

async function main() {
  const url = 'https://example.supabase.co';
  assert.equal(publicSupabaseConfig(url, 'sb_publishable_test').supabaseAnonKey, 'sb_publishable_test');
  const jwt = (role: string) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.test';
  assert.equal(publicSupabaseConfig(url, jwt('anon')).supabaseAnonKey, jwt('anon'));
  for (const key of ['sb_secret_test', jwt('service_role'), jwt('authenticated'), 'eyJmalformed', '']) {
    assert.throws(() => publicSupabaseConfig(url, key), 'Server keys must never become public config');
  }
  assert.throws(() => publicSupabaseConfig('https://user:password@example.com', 'sb_publishable_test'));
  const html = readFileSync('public/index.html', 'utf8');
  assert.ok(html.indexOf('/api/public-config.js') >= 0);
  assert.ok(html.indexOf('/api/public-config.js') < html.indexOf('/supabase-admin.js'));

  // Importing app does not invoke server.ts or initialize/seed either database.
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + '/api/public-config.js');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    const context = { window: {} as { WEBNOVELS_CONFIG?: object } };
    vm.runInNewContext(body, context);
    assert.equal(JSON.stringify(context.window.WEBNOVELS_CONFIG), JSON.stringify(publicSupabaseConfig()));
    assert.deepEqual(Object.keys(context.window.WEBNOVELS_CONFIG!).sort(), ['supabaseAnonKey', 'supabaseUrl']);
    for (const secret of [ENV.SUPABASE_SECRET_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.JWT_SECRET, process.env.SUPABASE_ACCESS_TOKEN]) {
      if (secret) assert.ok(!body.includes(secret), 'Secret leaked into public configuration');
    }
    const key = ENV.SUPABASE_PUBLISHABLE_KEY;
    try {
      ENV.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_wrong_setting';
      const invalid = await fetch(base + '/api/public-config.js');
      assert.equal(invalid.status, 503);
      assert.ok(!(await invalid.text()).includes('sb_secret_wrong_setting'));
    } finally { ENV.SUPABASE_PUBLISHABLE_KEY = key; }
    if (process.argv.includes('--live')) {
      const ready = await fetch(base + '/api/ready');
      assert.equal(ready.status, 200, 'Server must reach Supabase using the server-only key');
      assert.deepEqual(await ready.json(), { status: 'ok', supabase: 'connected' });
      const config = publicSupabaseConfig();
      const headers: Record<string, string> = { apikey: config.supabaseAnonKey };
      if (config.supabaseAnonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
      const catalog = await fetch(config.supabaseUrl + '/rest/v1/works?select=id&limit=1', { headers, signal: AbortSignal.timeout(5000) });
      assert.equal(catalog.status, 200);
      assert.ok(Array.isArray(await catalog.json()));
      console.log('Live Supabase server connection passed (read only).');
    }
    console.log('Supabase public configuration and secret isolation checks passed.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(() => { console.error('Supabase configuration checks failed. Credentials withheld.'); process.exitCode = 1; });
