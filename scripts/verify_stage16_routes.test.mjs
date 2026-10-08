import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const routerUrl = new URL('../public/js/core/router.js', import.meta.url);
const source = await readFile(routerUrl, 'utf8');
function fixture(path = '/home') {
  const queries = [], reads = [], details = [], pushes = [], leaves = [], listeners = new Map(), nodes = new Map(); let homes = 0, checkpoints = 0, legacyRefreshes = 0;
  const element = () => { const classes = new Set(); return { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }, getAttribute: () => null }; };
  for (const id of ['view-home','view-discover','view-reader','view-work-detail','view-mypage']) nodes.set(id, element());
  const context = {
    URL, URLSearchParams, console: { log() {} }, currentActiveView: 'view-home', lastMainView: 'view-home',
    WEBNOVELS_CONFIG: { readerDiscoveryEnabled: true, readerServiceEnabled: true, authorPublishEnabled: true },
    location: new URL(path, 'https://app.test'), document: { body: element(), getElementById: id => nodes.get(id) || null,
      querySelectorAll: selector => selector === '.main-view' ? [...nodes.values()] : [], querySelector: () => null },
    history: { pushState: (_state, _title, path) => { pushes.push(path); context.location = new URL(path, context.location); } },
    ReaderDiscovery: { active: () => true, discover: search => { queries.push(search ?? context.location.search); return Promise.resolve(); }, home: () => { homes++; return Promise.resolve(); },
      leave: view => leaves.push(['discovery', view]) },
    ReaderSession: { leave: view => leaves.push(['session', view]) }, CreatorDraftEditor: { checkpoint: () => checkpoints++ },
    WebNovelsAuth: { getActor: () => ({ userId: 'reader-account', reader: { status: 'ACTIVE' } }) },
    getCurrentCreatorSession: () => null, showToast() {}, openModal() {}, scrollTo() {}, setTimeout() {},
    refreshReaderCatalog: () => { legacyRefreshes++; return Promise.resolve(); },
    openReaderDirect: (...args) => reads.push(args), openWorkDetailDirect: (...args) => details.push(args),
    addEventListener: (event, handler) => listeners.set(event, handler), localStorage: { getItem: () => null }
  };
  context.window = context; vm.createContext(context); vm.runInContext(source, context, { filename: fileURLToPath(routerUrl) });
  return { context, queries, reads, details, pushes, leaves, nodes, listeners, homes: () => homes, checkpoints: () => checkpoints, legacyRefreshes: () => legacyRefreshes,
    location: path => { context.location = new URL(path, 'https://app.test'); } };
}

test('navigateTo preserves query casing, repeated tags and opaque cursor without a duplicate history entry', () => {
  const app = fixture();
  const path = '/discover?q=CaseSensitive+%EC%A0%9C%EB%AA%A9&tag=Fantasy&tag=%EB%AA%A8%ED%97%98&cursor=Aa_Z-19';
  app.context.navigateTo(path);
  assert.equal(app.queries.length, 1); assert.equal(app.legacyRefreshes(), 0); assert.equal(app.context.currentActiveView, 'view-discover');
  let query = new URLSearchParams(app.queries[0]);
  assert.equal(query.get('q'), 'CaseSensitive 제목'); assert.deepEqual(query.getAll('tag'), ['Fantasy','모험']); assert.equal(query.get('cursor'), 'Aa_Z-19');
  assert.deepEqual(app.pushes, [path]); app.context.navigateTo(path); assert.deepEqual(app.pushes, [path]); assert.equal(app.queries.length, 2);
  app.context.navigateTo('/Discover?q=KeepCASE'); query = new URLSearchParams(app.queries.at(-1)); assert.equal(query.get('q'), 'KeepCASE');
});
test('initial routing and popstate each issue one discovery load with the exact restored URL state', () => {
  const original = '/discover?q=OriginalCASE&sort=popular&tag=%EC%84%B1%EC%9E%A5&cursor=SERVER_Page2', app = fixture(original);
  app.context.initRouteHandler(); assert.equal(app.queries.length, 1); assert.equal(app.pushes.length, 0);
  app.context.navigateTo('/discover?q=ChangedCASE&status=COMPLETED'); assert.equal(app.queries.length, 2); assert.equal(app.pushes.length, 1);
  app.location(original); app.listeners.get('popstate')(); assert.equal(app.queries.length, 3); assert.equal(app.pushes.length, 1);
  const query = new URLSearchParams(app.queries.at(-1)); assert.equal(query.get('q'), 'OriginalCASE'); assert.equal(query.get('cursor'), 'SERVER_Page2'); assert.equal(query.get('tag'), '성장');
  assert.equal(app.legacyRefreshes(), 0);
});
test('semantic work and read paths take precedence over an old discovery hash', () => {
  const app = fixture('/works/9007199254740993#discover');
  app.context.resolveRoute(app.context.location.pathname + app.context.location.search);
  assert.deepEqual(app.details, [['9007199254740993', false]]); assert.equal(app.queries.length, 0);
  app.location('/read/9007199254740993/9#discover'); app.context.resolveRoute(app.context.location.pathname);
  assert.deepEqual(app.reads, [['9007199254740993', 9, false]]); assert.equal(app.queries.length, 0);
  app.location('/discover?q=StillHere#home'); app.context.resolveRoute(app.context.location.pathname + app.context.location.search);
  assert.equal(new URLSearchParams(app.queries.at(-1)).get('q'), 'StillHere'); assert.equal(app.homes(), 0);
  app.location('/?q=LegacyCASE#discover'); app.context.resolveRoute(app.context.location.pathname + app.context.location.search);
  assert.equal(new URLSearchParams(app.queries.at(-1)).get('q'), 'LegacyCASE'); assert.equal(app.context.currentActiveView, 'view-discover');
});
test('legacy episode alias and direct reader routes retain the caller history flag and actual episode number', () => {
  const app = fixture('/read/10/9');
  app.context.openEpisodeDirect('10', 9, false); assert.deepEqual(app.reads[0], ['10', 9, false]);
  app.context.openEpisodeDirect('10', 15); assert.deepEqual(app.reads[1], ['10', 15, true]);
  app.context.resolveRoute('/read/10/21'); assert.deepEqual(app.reads[2], ['10', 21, false]); assert.equal(app.pushes.length, 0);
});
test('view transitions call reader cancellation hooks and load the intended discovery surface only once', () => {
  const app = fixture('/read/10/9'); app.context.currentActiveView = 'view-reader';
  app.context.switchWebNovelsView('view-home');
  assert.deepEqual(app.leaves, [['session','view-home'],['discovery','view-home']]); assert.equal(app.checkpoints(), 1); assert.equal(app.homes(), 1);
  assert.equal(app.nodes.get('view-home').classList.contains('active'), true); assert.equal(app.context.location.pathname, '/home');
  app.context.switchWebNovelsView('view-discover'); assert.equal(app.queries.length, 1); assert.equal(app.context.location.pathname, '/discover');
  assert.deepEqual(app.leaves.slice(-2), [['session','view-discover'],['discovery','view-discover']]); assert.equal(app.legacyRefreshes(), 0);
  app.context.switchWebNovelsView('view-admin-cms'); assert.equal(app.context.currentActiveView, 'view-discover'); assert.equal(app.leaves.length, 4);
});
test('genre and section navigation use shareable discovery filters rather than local catalog scrolling', () => {
  const app = fixture(); app.context.openGenreDiscover('SF & 판타지');
  assert.equal(new URLSearchParams(app.queries.at(-1)).get('genre'), 'SF & 판타지');
  app.context.openNovelFilterHome(); assert.equal(new URLSearchParams(app.queries.at(-1)).get('type'), 'NOVEL');
  app.context.scrollToSection('trendingWorksSection'); assert.equal(new URLSearchParams(app.queries.at(-1)).get('sort'), 'popular');
  app.context.scrollToSection('newWorksSection'); assert.equal(new URLSearchParams(app.queries.at(-1)).get('sort'), 'new');
  app.context.scrollToSection('completedWorksSection'); assert.equal(new URLSearchParams(app.queries.at(-1)).get('status'), 'COMPLETED');
  assert.equal(app.queries.length, 5); assert.equal(app.legacyRefreshes(), 0);
});
