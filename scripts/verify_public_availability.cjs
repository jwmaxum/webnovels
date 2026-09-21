// Run after npm run build. Reproduce production without private/runtime settings.
const assert = require('node:assert/strict');
const vm = require('node:vm');
process.env.NODE_ENV = 'production';
for (const name of ['JWT_SECRET', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[name] = '';
const { app } = require('../dist/src/app.js');
const serve = process.argv.includes('--serve');
const server = app.listen(serve ? 3987 : 0, '127.0.0.1', async () => {
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const home = await fetch(base);
    assert.equal(home.status, 200, 'Public page must boot without JWT_SECRET');
    const html = await home.text();
    assert.ok(html.indexOf('/supabase-public-config.js') < html.indexOf('/api/public-config.js'));
    const context = { window: {} };
    const config = await fetch(base + '/supabase-public-config.js');
    assert.equal(config.status, 200);
    vm.runInNewContext(await config.text(), context);
    const publicConfig = context.window.WEBNOVELS_CONFIG;
    assert.deepEqual(Object.keys(publicConfig).sort(), ['supabaseAnonKey', 'supabaseUrl']);
    assert.ok(publicConfig.supabaseAnonKey.startsWith('sb_publishable_'));
    const override = await fetch(base + '/api/public-config.js');
    assert.equal(override.status, 503);
    vm.runInNewContext(await override.text(), context);
    assert.equal(context.window.WEBNOVELS_CONFIG, publicConfig, 'Failed override must preserve the DB connection');
    assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 503, 'Private APIs must fail closed');
    console.log('PASS: production page survives missing settings; public DB config retained; private APIs fail closed.');
    if (serve) console.log('Availability reproduction server: ' + base);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (!serve || process.exitCode) { server.closeAllConnections(); server.close(); }
  }
});
