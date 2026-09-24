const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function browser(responses = [], rpc = { data: null, error: { message: 'not available' } }) {
  const calls = [], storage = new Map();
  const client = {
    from(table) {
      const result = responses.shift() || { data: [], error: null };
      const query = new Proxy({}, { get(_, method) {
        if (method === 'then') return Promise.resolve(result).then.bind(Promise.resolve(result));
        return (...args) => { calls.push({ table, method, args }); return query; };
      }});
      return query;
    },
    rpc: async () => rpc,
    auth: { signInWithPassword: async () => ({ data: { user: { id: 'ordinary-user' } } }), signOut: async () => {} }
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    crypto: { randomUUID },
    document: { getElementById: () => null },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    supabase: { createClient: () => client },
    WEBNOVELS_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_test' },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/js/core/state.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/supabase-admin.js', 'utf8'), context);
  return { context, api: context.WebNovelsAdmin, calls, storage };
}
async function main() {
  let b = browser();
  assert.equal(b.context.SAMPLE_WORKS.length, 0);
  assert.equal(b.context.SAMPLE_READERS.length, 0);
  assert.equal(b.context.SAMPLE_AUTHORS.length, 0);
  assert.equal((await b.api.fetchWorksFromSupabase()).length, 0);

  b = browser([{ data: [{ id: 1, title: 'DB work', status: 'PUBLISHED', author_id: 2 }], error: null }, { data: [{ id: 2, pen_name: 'DB author' }] }, { data: [], error: null }]);
  const works = await b.api.fetchWorksFromSupabase();
  assert.equal(works[0].episodes.length, 0, 'No manufactured episodes for empty DB result');
  assert.equal(works[0].author, 'DB author');
  assert.ok(!b.calls.find(c => c.table === 'episodes' && c.method === 'select').args[0].split(', ').includes('content'), 'Catalog must not preload paid content');

  b = browser([{ data: null, error: { message: 'database unavailable' } }]);
  await assert.rejects(b.api.fetchWorksFromSupabase(), error => error.message === 'database unavailable');
  for (const method of ['createWorkInDB','updateWorkAdminSetting','deleteWorkFromDB',
    'createEpisodeInDB','updateEpisodeSetting','deleteEpisodeFromDB'])
    assert.equal(b.api[method], undefined, `Administrator proxy writer ${method} must be removed`);

  b = browser([{ data: null, error: null }]);
  assert.equal((await b.api.login('reader@example.test', 'password')).success, false, 'Ordinary Auth user cannot become super admin');
  b = browser();
  assert.equal((await b.api.supportCreator(1, 1000)).success, false);
  assert.equal(b.storage.size, 0, 'Failed support must not manufacture a local ledger');

  b.context.SAMPLE_WORKS.push({ id: 1, status: 'DRAFT', episodes: [] }, { id: 2, status: 'PUBLISHED', episodes: [
    { status: 'DRAFT' }, { status: 'PUBLISHED', scheduledAt: '2999-01-01' },
    { status: 'PUBLISHED', isFree: true, accessPolicy: 'FREE' }
  ] });
  const visible = b.context.getPublishedWorks();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].episodes.length, 1);
  b.storage.set('webnovels_favorites', '[999]');
  b.context.syncUserActivityToStorage({ favorites: [], subscribedAuthors: [], readingHistory: [], points: 0 });
  assert.equal(b.storage.get('webnovels_favorites'), '[]', 'Remote removal must clear cached favorites');
  console.log('PASS: empty/error DB states, no fake content, metadata-only catalog, removed administrator writers, admin role denial, no fake support, publication filtering, remote cache replacement');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
