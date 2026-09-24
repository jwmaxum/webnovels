import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('legacy reader content never falls back to direct tables or RPC after API denial', async () => {
  let direct = 0, status = 200;
  const context = { console: { log() {}, warn() {}, error() {} }, addEventListener() {},
    fetch: async (url, init) => {
      assert.equal(url, '/api/v2/episodes/9007199254740993/content');
      assert.equal(init.credentials, 'omit');
      return Response.json({ episode: { content: 'server body', image_urls: [] } }, { status });
    }, dbTrap: { from() { direct++; throw Error('forbidden'); }, rpc() { direct++; throw Error('forbidden'); } } };
  context.window = context; vm.createContext(context);
  vm.runInContext(await read('public/supabase-admin.js'), context);
  vm.runInContext('supabaseClient = dbTrap', context);
  const api = context.WebNovelsAdmin;
  assert.equal((await api.fetchEpisodeContentSecure('9007199254740993')).textContent, 'server body');
  for (status of [403, 503]) assert.equal(await api.fetchEpisodeContentSecure('9007199254740993'), null);
  assert.equal(await api.fetchEpisodeContentSecure(null, 10, 1), null, 'work/episode numbers cannot guess an ID');
  assert.equal(direct, 0);
});

test('service notice distinguishes backend readiness and cannot treat HTML 200 as ready', async () => {
  const nodes = Object.fromEntries(['serviceStatus', 'serviceStatusMessage', 'serviceStatusRetry'].map(id => [id, { hidden: true }]));
  let response = Response.json({ error: 'SECURE_API_NOT_ACTIVATED' }, { status: 503 });
  const context = { AbortSignal, document: { getElementById: id => nodes[id], addEventListener() {} },
    fetch: async () => response, WEBNOVELS_CONFIG: { authorPublishEnabled: true, readerServiceEnabled: true } };
  context.window = context; vm.createContext(context);
  vm.runInContext(await read('public/js/core/service-status.js'), context);
  await context.WebNovelsServiceStatus.refresh();
  assert.equal(nodes.serviceStatus.hidden, false);
  response = new Response('<html>SPA fallback</html>');
  await context.WebNovelsServiceStatus.refresh();
  assert.equal(nodes.serviceStatus.hidden, false);
  response = Response.json({ status: 'ok' });
  await context.WebNovelsServiceStatus.refresh();
  assert.equal(nodes.serviceStatus.hidden, true);
});
