const test = require('node:test');
const assert = require('node:assert/strict');
const { connection, managementToken, managementProbe } = require('./lib/launch-access.cjs');
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ACCESS_TOKEN: ' sbp_test-token ' };

test('management diagnostics reject app keys and untrusted project URLs before sending credentials', async () => {
  for (const token of ['', 'sb_secret_test', 'sb_publishable_test', 'eyJfake']) {
    const result = await managementProbe({ ...env, SUPABASE_ACCESS_TOKEN: token }, () => assert.fail('must not fetch'));
    assert.equal(result.ok, false);
  }
  assert.equal(managementToken(env), 'sbp_test-token');
  for (const url of ['https://example.com', 'http://example.supabase.co', 'https://user:pass@example.supabase.co'])
    assert.throws(() => connection({ SUPABASE_URL: url }));
});
test('401, 403 and network errors have distinct diagnoses without echoing provider bodies or tokens', async () => {
  for (const [status, code] of [[401, 'MANAGEMENT_TOKEN_REJECTED'], [403, 'MANAGEMENT_PROJECT_PERMISSION_DENIED']]) {
    const result = await managementProbe(env, async (url, init) => {
      assert.equal(url, 'https://api.supabase.com/v1/projects/example/database/query/read-only');
      assert.equal(JSON.parse(init.body).query, 'select 1 as access_ok');
      return new Response('sensitive-provider-body', { status });
    });
    assert.equal(result.code, code);
    assert.ok(!JSON.stringify(result).includes('sbp_'));
    assert.ok(!JSON.stringify(result).includes('sensitive'));
  }
  assert.equal((await managementProbe(env, async () => { throw Error('private details'); })).code, 'MANAGEMENT_NETWORK_UNREACHABLE');
  assert.equal((await managementProbe(env, async () => Response.json([{access_ok:1}]))).ok, true);
});
