import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/api/[[path]].js';
import { onRequest as secureRequest } from '../functions/api/v2/[[path]].js';

test('Pages .js config URL returns only public fields, not SPA HTML or bindings', async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example', SUPABASE_SECRET_KEY: 'PRIVATE_VALUE_MUST_NEVER_APPEAR' };
  const response = onRequest({ request: new Request('https://webnovels-db4.pages.dev/api/public-config.js'), env });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  const source = await response.text(); assert.ok(!source.includes(env.SUPABASE_SECRET_KEY));
  const context = { window: {} }; vm.runInNewContext(source, context);
  assert.deepEqual(Object.keys(context.window.WEBNOVELS_CONFIG).sort(),
    ['adminOperationsEnabled','adminRoleChangesEnabled','adminWorkflowEnabled','authorFilesEnabled','authorOperationsEnabled','authorPublishEnabled','readerDiscoveryEnabled','readerServiceEnabled','supabaseAnonKey','supabaseUrl']);
  assert.equal(context.window.WEBNOVELS_CONFIG.authorPublishEnabled,false);
  assert.equal(context.window.WEBNOVELS_CONFIG.authorFilesEnabled,false);
  assert.equal(context.window.WEBNOVELS_CONFIG.readerServiceEnabled,false);
  assert.equal(context.window.WEBNOVELS_CONFIG.readerDiscoveryEnabled,false);
  assert.equal(context.window.WEBNOVELS_CONFIG.authorOperationsEnabled,false);
  assert.equal(context.window.WEBNOVELS_CONFIG.adminOperationsEnabled,false);
  assert.equal(context.window.WEBNOVELS_CONFIG.adminWorkflowEnabled,false);
  assert.equal(context.window.WEBNOVELS_CONFIG.adminRoleChangesEnabled,false);
});
test('wrongly configured secret key cannot be served as public key', async () => {
  const response = onRequest({ request: new Request('https://webnovels-db4.pages.dev/api/public-config.js'), env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_bad' } });
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('sb_secret_bad'));
});
test('file runtime flag requires exact true and never serializes private environment fields',async()=>{
  for(const [flag,expected]of [['true',true],['false',false],['TRUE',false],[true,false]]){
    const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_example',AUTHOR_FILES_ENABLED:flag,PRIVATE_TEST_BINDING:'must-remain-private'};
    const response=onRequest({request:new Request('https://app.test/api/public-config.js'),env}),source=await response.text(),context={window:{}};
    vm.runInNewContext(source,context);assert.equal(context.window.WEBNOVELS_CONFIG.authorFilesEnabled,expected);assert.ok(!source.includes(env.PRIVATE_TEST_BINDING));
  }
});
test('reader discovery runtime flag is opt-in and exposes only its public boolean', async () => {
  for (const [flag, expected] of [[undefined, false], ['true', true], ['false', false], ['TRUE', false], [' true ', false], [true, false], [1, false]]) {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example',
      READER_DISCOVERY_ENABLED: flag, READER_DISCOVERY_PRIVATE_KEY: 'private-discovery-binding',
      SUPABASE_SECRET_KEY: 'private-server-binding' };
    const response = onRequest({ request: new Request('https://app.test/api/public-config.js'), env });
    const source = await response.text(), context = { window: {} };
    assert.equal(response.status, 200);
    vm.runInNewContext(source, context);
    assert.equal(context.window.WEBNOVELS_CONFIG.readerDiscoveryEnabled, expected);
    assert.equal(context.window.WEBNOVELS_CONFIG.readerServiceEnabled, false);
    assert.equal(context.window.WEBNOVELS_CONFIG.authorPublishEnabled, false);
    assert.ok(Object.isFrozen(context.window.WEBNOVELS_CONFIG));
    assert.ok(!source.includes(env.READER_DISCOVERY_PRIVATE_KEY));
    assert.ok(!source.includes(env.SUPABASE_SECRET_KEY));
    assert.ok(!source.includes('READER_DISCOVERY_ENABLED'));
  }
});
test('static configuration keeps reader discovery disabled when runtime config is unavailable', async () => {
  const context = { window: {} };
  vm.runInNewContext(await readFile(new URL('../public/supabase-public-config.js', import.meta.url), 'utf8'), context);
  const fallback = context.window.WEBNOVELS_CONFIG;
  assert.equal(fallback.readerDiscoveryEnabled, false);
  const response = onRequest({ request: new Request('https://app.test/api/public-config.js'), env: { READER_DISCOVERY_ENABLED: 'true' } });
  assert.equal(response.status, 503);
  vm.runInNewContext(await response.text(), context);
  assert.equal(context.window.WEBNOVELS_CONFIG, fallback);
  assert.equal(context.window.WEBNOVELS_CONFIG.readerDiscoveryEnabled, false);
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^READER_DISCOVERY_ENABLED=false$/m);
});
test('Cloudflare legacy API returns explicit error instead of static HTML', async () => {
  const response = onRequest({ request: new Request('https://webnovels-db4.pages.dev/api/payments/toss/confirm', { method: 'POST' }), env: {} });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'LEGACY_API_NOT_AVAILABLE_ON_CLOUDFLARE');
});
test('new API remains unavailable until DB and Cloudflare cutover are ready', async () => {
  const response = await secureRequest({ request: new Request('https://webnovels-db4.pages.dev/api/v2/me'), env: {} });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'SERVER_CONFIGURATION_REQUIRED');
});
