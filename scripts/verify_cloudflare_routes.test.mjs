import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { onRequest } from '../functions/api/[[path]].js';
import { onRequest as secureRequest } from '../functions/api/v2/[[path]].js';

test('Pages .js config URL returns only public fields, not SPA HTML or bindings', async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example', SUPABASE_SECRET_KEY: 'PRIVATE_VALUE_MUST_NEVER_APPEAR' };
  const response = onRequest({ request: new Request('https://webnovels-db4.pages.dev/api/public-config.js'), env });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  const source = await response.text(); assert.ok(!source.includes(env.SUPABASE_SECRET_KEY));
  const context = { window: {} }; vm.runInNewContext(source, context);
  assert.deepEqual(Object.keys(context.window.WEBNOVELS_CONFIG).sort(), ['authorPublishEnabled','supabaseAnonKey', 'supabaseUrl']);
  assert.equal(context.window.WEBNOVELS_CONFIG.authorPublishEnabled,false);
});
test('wrongly configured secret key cannot be served as public key', async () => {
  const response = onRequest({ request: new Request('https://webnovels-db4.pages.dev/api/public-config.js'), env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_bad' } });
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('sb_secret_bad'));
});
test('Cloudflare legacy API returns explicit error instead of static HTML', async () => {
  const response = onRequest({ request: new Request('https://webnovels-db4.pages.dev/api/payments/toss/confirm', { method: 'POST' }), env: {} });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'LEGACY_API_NOT_AVAILABLE_ON_CLOUDFLARE');
});
test('new API remains unavailable until DB and Cloudflare cutover are ready', async () => {
  const response = await secureRequest({ request: new Request('https://webnovels-db4.pages.dev/api/v2/me'), env: {} });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'SECURE_API_NOT_ACTIVATED');
});
