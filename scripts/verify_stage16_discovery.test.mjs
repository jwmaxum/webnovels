import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sources = await Promise.all(['reader-catalog.js', 'reader-discovery.js'].map(async name => {
  const url = new URL('../public/js/reader/' + name, import.meta.url);
  return { filename: fileURLToPath(url), code: await readFile(url, 'utf8') };
}));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const rawWork = (id = '10', extra = {}) => ({ id, title: '작품 ' + id, author: '작가', author_id: '9007199254740993', genre: ['판타지'],
  content_type: 'NOVEL', cover_image: '/covers/work.webp', status: 'ONGOING', rating: 'ALL', episode_count: 3,
  created_at: '2026-01-01T00:00:00Z', first_published_at: '2026-02-01T00:00:00Z', last_published_at: '2026-03-01T00:00:00Z',
  firstEpisodeNumber: 4, description: '공개 줄거리', ...extra });
const rawEpisode = (number, id = String(100 + number), workId = '10') => ({ id, work_id: workId, episode_number: number,
  title: number + '번째 공개 회차', is_free: true, access_policy: 'FREE', status: 'PUBLISHED', versionId: '11111111-1111-4111-8111-111111111111' });
const ranking = { periodDays: 7, minSample: 5, asOf: '2026-10-09T00:00:00Z', metric: 'uniqueReaders' };

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this._text = ''; this.value = ''; this.disabled = false;
    const classes = new Set(); this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle: (name, enabled) => { const value = enabled ?? !classes.has(name); value ? classes.add(name) : classes.delete(name); return value; } };
  }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Catalog UI must use text/DOM, not author HTML'); }
  append(...children) { for (const child of children.filter(Boolean)) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; if (key === 'src') delete this.src; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  focus() { this.focused = true; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const found = [], matches = element => selector === 'button' ? element.tagName === 'BUTTON' :
      selector === '[data-discover-tag]' ? !!element.dataset.discoverTag :
      selector.startsWith('option[value="') ? element.tagName === 'OPTION' && selector === `option[value="${element.value}"]` : false;
    const visit = element => { for (const child of element.children) { if (matches(child)) found.push(child); visit(child); } }; visit(this); return found;
  }
}
function setup(handler = () => Response.json({ works: [], ranking, nextCursor: null })) {
  const ids = ['discoverWorksGrid','discoverPager','discoverResultsCount','discoverQueryStatus','discoveryRankingNote','selectDiscoverSort','discoverQuery','discoverType',
    'discoverGenreFilters','filterStatusGroup','filterEpRangeGroup','filterRatingGroup','discoverTagFilters','activeTagsCounter',
    'detailTitle','detailAuthor','detailGenreBadge','detailRatingBadge','detailAiBadge','detailDescription','detailDates','detailCoverImg',
    'btnDetailReadFirst','btnStickyRead','detailEpisodeList','detailEpisodePager','detailExternalLinks',
    'trendingWorksGrid','newWorksGrid','completedWorksGrid','todayFreeGrid','genreWorksGrid','cdgHeroSlider','webtoonsGrid','goldenBestSection','homeRankingNote','homeRecommendationNote','searchResults'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()])), head = new Element('head'), description = new Element('meta'); description.setAttribute('name', 'description'); head.append(description);
  const requests = [], navigations = [], timers = new Map(); let sequence = 0, legacyCalls = 0;
  const context = {
    URL, URLSearchParams, Date, setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id), clearInterval() {},
    activeWork: null, WEBNOVELS_CONFIG: { readerDiscoveryEnabled: true, readerServiceEnabled: true, authorPublishEnabled: true },
    location: new URL('https://app.test/discover'), history: { pushState: (_state, _title, path) => { context.location = new URL(path, context.location); } },
    document: { title: 'webnovels', head, getElementById: id => nodes[id] || null, createElement: tag => new Element(tag),
      querySelector: selector => selector === 'meta[name="description"]' ? description : head.children.find(el => selector === `meta[property="${el.getAttribute('property')}"]`) || null },
    fetch: async (url, init) => { const query = new URL(url, context.location); requests.push({ url: query, init }); return handler(query, init, requests.length); },
    navigateTo: path => { navigations.push(path); context.location = new URL(path, context.location); },
    switchWebNovelsView: view => context.ReaderDiscovery?.leave(view),
    WebNovelsAdmin: { fetchWorksFromSupabase() { legacyCalls++; throw Error('Full catalog fallback forbidden'); } }
  };
  context.window = context; vm.createContext(context); sources.forEach(source => vm.runInContext(source.code, context, { filename: source.filename }));
  return { context, nodes, requests, navigations, catalog: context.ReaderCatalog, ui: context.ReaderDiscovery, legacyCalls: () => legacyCalls,
    runTimers: async () => { const pending = [...timers.values()]; timers.clear(); await Promise.all(pending.map(callback => callback())); },
    addButton: (group, data, label) => { const button = new Element('button'); button.dataset = data; button.textContent = label; nodes[group].append(button); return button; } };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('catalog actions use separate bounded public endpoints and never load the full catalog on failure', async () => {
  const app = setup(url => {
    assert.equal(url.pathname, '/api/v2/catalog');
    if (url.searchParams.get('action') === 'home') return Response.json({ sections: { recommended: [], popular: [], new: [], completed: [] }, ranking });
    if (url.searchParams.get('action') === 'episodes') return Response.json({ episodes: [rawEpisode(4)], nextCursor: null });
    return Response.json({ works: [rawWork()], nextCursor: 'opaque-server-cursor', ranking });
  });
  await app.catalog.list({ q: '한글 & 공백', tag: ['성장', '모험'], limit: 8 }); await app.catalog.home(); await app.catalog.episodes('10', 'opaque-cursor');
  assert.deepEqual(app.requests.map(row => row.url.searchParams.get('action')), ['list', 'home', 'episodes']);
  assert.deepEqual(app.requests[0].url.searchParams.getAll('tag'), ['성장', '모험']);
  assert.equal(app.requests[0].url.searchParams.get('q'), '한글 & 공백');
  assert.equal(app.requests[2].url.searchParams.get('limit'), '24'); assert.equal(app.requests[2].url.searchParams.get('cursor'), 'opaque-cursor');
  assert.ok(app.requests.every(row => row.init.credentials === 'omit' && row.init.cache === 'no-store'));
  app.context.WEBNOVELS_CONFIG.readerDiscoveryEnabled = false;
  await assert.rejects(app.catalog.list(), /NOT_ACTIVATED/); assert.equal(app.requests.length, 3); assert.equal(app.legacyCalls(), 0);
  const failed = setup(() => Response.json({ error: 'CATALOG_UNAVAILABLE' }, { status: 503 }));
  await assert.rejects(failed.catalog.list(), error => error.status === 503); assert.equal(failed.requests.length, 1); assert.equal(failed.legacyCalls(), 0);
});
test('work IDs and actual noncontiguous public chapters retain bigint identity in the reader mapping', async () => {
  const id = '9007199254740993', app = setup(url => url.searchParams.get('action') === 'work' ? Response.json({ work: rawWork(id) }) :
    Response.json({ previous: rawEpisode(4, '101', id), episode: rawEpisode(9, '102', id), next: rawEpisode(15, '103', id) }));
  const result = await app.catalog.reading(id, 9);
  assert.equal(result.work.id, id); assert.equal(result.work.authorId, id);
  assert.deepEqual(plain(result.work.episodes.map(ep => ep.episodeNumber)), [4, 9, 15]);
  assert.equal(result.episode.workId, id); assert.equal(result.episode.id, '102'); assert.equal(result.next.episodeNumber, 15);
  assert.deepEqual(app.requests.map(row => row.url.searchParams.get('action')).sort(), ['chapter', 'work']);
  await assert.rejects(app.catalog.work('9223372036854775808'), error => error.status === 404);
  await assert.rejects(app.catalog.work('../creator'), error => error.status === 404); assert.equal(app.requests.length, 2);
});
test('malformed catalog payloads and HTML responses remain failures rather than empty results', async () => {
  const badList = setup(() => Response.json({ works: {} })); await assert.rejects(badList.catalog.list(), /CATALOG_UNAVAILABLE/);
  const badHome = setup(() => Response.json({ sections: { recommended: [] } })); await assert.rejects(badHome.catalog.home(), /CATALOG_UNAVAILABLE/);
  const badWork = setup(() => Response.json({ work: rawWork('11') })); await assert.rejects(badWork.catalog.work('10'), /CATALOG_UNAVAILABLE/);
  const html = setup(() => new Response('<html>fallback</html>')); await html.ui.discover(); assert.match(html.nodes.discoverWorksGrid.textContent, /불러오지 못/);
  assert.equal(html.legacyCalls(), 0);
});
test('discover restores URL filters, literal query casing, sorted unique tags and opaque cursor', async () => {
  const app = setup(() => Response.json({ works: [rawWork()], nextCursor: 'Next-OPAQUE_123', ranking }));
  const genre = app.addButton('discoverGenreFilters', {}, '판타지'), completed = app.addButton('filterStatusGroup', { status: 'COMPLETED' }, '완결');
  const tag = app.addButton('discoverTagFilters', { discoverTag: '성장' }, '성장');
  app.context.location = new URL('https://app.test/discover?q=Case+%EC%A0%9C%EB%AA%A9&genre=%ED%8C%90%ED%83%80%EC%A7%80&status=COMPLETED&sort=popular&tag=%EC%84%B1%EC%9E%A5&tag=%EB%AA%A8%ED%97%98&tag=%EC%84%B1%EC%9E%A5&cursor=OPAQUE&secret=drop');
  await app.ui.discover();
  const query = app.requests[0].url.searchParams;
  assert.equal(query.get('q'), 'Case 제목'); assert.equal(query.get('cursor'), 'OPAQUE'); assert.equal(query.has('secret'), false);
  assert.deepEqual(query.getAll('tag'), ['모험', '성장']); assert.equal(app.nodes.discoverQuery.value, 'Case 제목');
  assert.equal(app.nodes.selectDiscoverSort.value, 'popular'); assert.equal(genre.getAttribute('aria-pressed'), 'true'); assert.equal(completed.getAttribute('aria-pressed'), 'true'); assert.equal(tag.getAttribute('aria-pressed'), 'true');
  const [first, next] = app.nodes.discoverPager.children;
  assert.equal(new URL(first.href, app.context.location).searchParams.has('cursor'), false);
  assert.equal(new URL(next.href, app.context.location).searchParams.get('cursor'), 'Next-OPAQUE_123');
  assert.match(app.nodes.discoveryRankingNote.textContent, /최소 5명/); assert.match(app.nodes.discoveryRankingNote.textContent, /실제 완독이나 구매를 뜻하지 않습니다/);
  await app.ui.discover('?q=뒤로복원&sort=new'); assert.equal(app.nodes.discoverQuery.value, '뒤로복원'); assert.equal(genre.getAttribute('aria-pressed'), 'false'); assert.equal(app.nodes.selectDiscoverSort.value, 'new');
});
test('filter changes and tag toggles preserve URL state while discarding the server page cursor', async () => {
  const app = setup(); await app.ui.discover('?q=ABC&genre=판타지&tag=성장&cursor=server-token');
  app.ui.filter('status', 'COMPLETED'); let params = new URL(app.navigations.at(-1), app.context.location).searchParams;
  assert.equal(params.get('q'), 'ABC'); assert.equal(params.get('genre'), '판타지'); assert.equal(params.get('status'), 'COMPLETED'); assert.equal(params.has('cursor'), false);
  app.ui.toggleTag('모험'); params = new URL(app.navigations.at(-1), app.context.location).searchParams; assert.deepEqual(params.getAll('tag'), ['모험', '성장']); assert.equal(params.has('cursor'), false);
  app.ui.toggleTag('성장'); params = new URL(app.navigations.at(-1), app.context.location).searchParams; assert.equal(params.has('tag'), false);
});
test('empty catalog and failed request have distinct states and retry reuses the original query', async () => {
  let failure = true;
  const app = setup(() => failure ? Promise.reject(Error('network down')) : Response.json({ works: [], ranking, nextCursor: null }));
  await app.ui.discover('?q=찾기'); assert.match(app.nodes.discoverWorksGrid.textContent, /불러오지 못/); assert.equal(app.nodes.discoverResultsCount.textContent, '조회 실패');
  const retry = app.nodes.discoverWorksGrid.children.find(el => el.tagName === 'BUTTON'); assert.ok(retry);
  failure = false; await retry.onclick(); assert.match(app.nodes.discoverWorksGrid.textContent, /조건에 맞는 공개 작품이 없습니다/);
  assert.deepEqual(app.requests.map(row => row.url.searchParams.get('q')), ['찾기', '찾기']);
});
test('newer discover requests and leaving the page suppress stale success and failure responses', async () => {
  const old = deferred(), newer = deferred(), last = deferred();
  const app = setup((_url, _init, count) => [old, newer, last][count - 1].promise);
  const first = app.ui.discover('?q=old'), second = app.ui.discover('?q=new');
  newer.resolve(Response.json({ works: [rawWork('20')], ranking, nextCursor: null })); await second;
  old.resolve(Response.json({ works: [rawWork('10')], ranking, nextCursor: null })); await first;
  assert.match(app.nodes.discoverWorksGrid.textContent, /작품 20/); assert.doesNotMatch(app.nodes.discoverWorksGrid.textContent, /작품 10/);
  const abandoned = app.ui.discover('?q=abandoned'); app.ui.leave('view-home'); const text = app.nodes.discoverWorksGrid.textContent;
  last.reject(Error('late network failure')); await abandoned; assert.equal(app.nodes.discoverWorksGrid.textContent, text);
});
test('detail exposes distinct publication dates and safe text-only metadata plus actual first public chapter', async () => {
  const title = '<img src=x onerror=alert(1)>', app = setup(url => url.searchParams.get('action') === 'work' ? Response.json({ work: rawWork('10', { title, rating: 'AGE_15', description: '<script>bad()</script>' }) }) :
    Response.json({ episodes: [rawEpisode(4), rawEpisode(9)], nextCursor: 'NEXT_EP' }));
  await app.ui.detail('10');
  assert.equal(app.nodes.detailTitle.textContent, title); assert.equal(app.nodes.detailTitle.children.length, 0);
  assert.equal(app.context.document.title, title + ' · webnovels'); assert.equal(app.context.document.querySelector('meta[property="og:title"]').content, title);
  assert.equal(app.context.document.querySelector('meta[property="og:url"]').content, 'https://app.test/works/10');
  assert.match(app.nodes.detailDates.textContent, /등록.+첫 공개.+최근 공개/); assert.equal(app.nodes.detailRatingBadge.textContent, '15세 이상');
  assert.match(app.nodes.btnDetailReadFirst.textContent, /4화/); assert.equal(app.nodes.btnDetailReadFirst.disabled, false); assert.equal(app.nodes.detailTitle.focused, true);
  assert.deepEqual(app.nodes.detailEpisodeList.children.map(el => el.href), ['/read/10/4', '/read/10/9']); assert.match(app.nodes.detailEpisodePager.textContent, /회차 더 보기/);
});
test('external badges use exact HTTPS platform hosts and fixed labels, with no private or exclusive settings', async () => {
  let links = [
    { url: 'https://www.munpia.com/novel/1', label: '<img src=x>' },
    { url: 'https://www.munpia.com.evil.test/novel/1' },
    { url: 'javascript:alert(1)' },
    { url: 'https://name:password@novel.naver.com/1' },
    { url: 'https://page.kakao.com/content/1' }
  ], mode = 'NON_EXCLUSIVE';
  const app = setup(url => url.searchParams.get('action') === 'work' ? Response.json({ work: rawWork('10', { distribution: { mode, externalLinks: links, rightsDeclaration: 'PRIVATE' } }) }) : Response.json({ episodes: [], nextCursor: null }));
  await app.ui.detail('10'); let badges = app.nodes.detailExternalLinks.children;
  assert.equal(badges.length, 2); assert.equal(badges[0].textContent, '문피아에서 연재 중 ↗'); assert.equal(badges[1].textContent, '카카오에서 연재 중 ↗');
  assert.ok(badges.every(el => el.target === '_blank' && el.rel === 'noopener noreferrer')); assert.doesNotMatch(app.nodes.detailExternalLinks.textContent, /PRIVATE|img/);
  links = [{ url: 'https://www.munpia.com:443/1' }, { url: 'https://www.munpia.com/1\n' }, { url: 'https://www.munpia.com\\@evil.test/1' }];
  await app.ui.detail('10'); assert.equal(app.nodes.detailExternalLinks.children.length, 0);
  mode = 'EXCLUSIVE'; links = [{ url: 'https://www.munpia.com/1' }]; await app.ui.detail('10'); assert.equal(app.nodes.detailExternalLinks.children.length, 0);
});
test('missing work is distinct from request failure and failure retry loads the same work', async () => {
  let status = 404; const app = setup(url => url.searchParams.get('action') === 'episodes' ? Response.json({ episodes: [], nextCursor: null }) :
    status === 200 ? Response.json({ work: rawWork('10') }) : Response.json({ error: status === 404 ? 'WORK_NOT_FOUND' : 'CATALOG_UNAVAILABLE' }, { status }));
  await app.ui.detail('10'); assert.match(app.nodes.detailEpisodeList.textContent, /현재 공개된 작품을 찾을 수 없습니다/); assert.equal(app.nodes.detailEpisodeList.children.some(el => el.tagName === 'BUTTON'), false);
  status = 503; await app.ui.detail('10'); assert.match(app.nodes.detailEpisodeList.textContent, /불러오지 못/);
  const retry = app.nodes.detailEpisodeList.children.find(el => el.tagName === 'BUTTON'); status = 200; await retry.onclick(); assert.equal(app.nodes.detailTitle.textContent, '작품 10');
});
test('stale detail and chapter pages cannot replace the selected work, and chapter cursors stay opaque', async () => {
  const slow = deferred(), oldEpisodes = deferred(); let oldCount = 0;
  const app = setup(url => {
    const action = url.searchParams.get('action'), id = url.searchParams.get('workId');
    if (action === 'work' && id === '10' && ++oldCount === 1) return slow.promise;
    if (action === 'work') return Response.json({ work: rawWork(id) });
    if (id === '10') return oldEpisodes.promise;
    return Response.json({ episodes: [rawEpisode(url.searchParams.has('cursor') ? 15 : 9, undefined, id)], nextCursor: url.searchParams.has('cursor') ? null : 'SERVER_ONLY_TOKEN' });
  });
  const first = app.ui.detail('10'), second = app.ui.detail('20'); await second;
  slow.resolve(Response.json({ work: rawWork('10') })); await first; assert.equal(app.nodes.detailTitle.textContent, '작품 20'); assert.equal(app.context.activeWork.id, '20');
  const olderPage = app.ui.detail('10'); await tick(); const selected = app.ui.detail('30'); await selected;
  oldEpisodes.resolve(Response.json({ episodes: [rawEpisode(4)], nextCursor: null })); await olderPage;
  assert.deepEqual(app.nodes.detailEpisodeList.children.map(el => el.href), ['/read/30/9']);
  await app.nodes.detailEpisodePager.children[0].onclick();
  assert.deepEqual(app.nodes.detailEpisodeList.children.map(el => el.href), ['/read/30/9', '/read/30/15']);
  assert.equal(app.requests.at(-1).url.searchParams.get('cursor'), 'SERVER_ONLY_TOKEN');
});
test('search waits for debounce and suppresses results from the previous query', async () => {
  const old = deferred(); const app = setup(url => url.searchParams.get('q') === 'old' ? old.promise : Response.json({ works: [rawWork('20')], ranking, nextCursor: null }));
  app.ui.search('old'); assert.equal(app.requests.length, 0); const first = app.runTimers();
  app.ui.search(' new '); await app.runTimers(); assert.equal(app.requests.at(-1).url.searchParams.get('q'), 'new'); assert.equal(app.requests.at(-1).url.searchParams.get('limit'), '8');
  old.resolve(Response.json({ works: [rawWork('10')], ranking, nextCursor: null })); await first;
  assert.match(app.nodes.searchResults.textContent, /작품 20/); assert.doesNotMatch(app.nodes.searchResults.textContent, /작품 10/);
  assert.equal(app.nodes.searchResults.children.at(-1).href, '/discover?q=new&sort=latest');
});
test('home distinguishes editorial recommendations from authenticated reader ranking and insufficient samples', async () => {
  const app = setup(() => Response.json({ sections: { recommended: [rawWork('10')], popular: [], new: [rawWork('20')], completed: [] }, ranking }));
  await app.ui.home(); assert.match(app.nodes.homeRecommendationNote.textContent, /편집 추천/); assert.match(app.nodes.homeRankingNote.textContent, /고유 수/);
  assert.match(app.nodes.trendingWorksGrid.textContent, /독자 집계가 아직 없습니다/); assert.match(app.nodes.webtoonsGrid.textContent, /준비 중/); assert.equal(app.nodes.goldenBestSection.hidden, true);
  assert.equal(app.requests.length, 1); assert.equal(app.requests[0].url.searchParams.get('action'), 'home');
});

test('search sort uses supported server ordering and carries it into the full results URL', async () => {
  const app = setup(() => Response.json({ works: [], ranking, nextCursor: null }));
  app.nodes.searchSortSelect = new Element('select');
  app.ui.search('작가'); await app.runTimers();
  assert.equal(app.requests.at(-1).url.searchParams.get('sort'), 'latest');
  app.nodes.searchSortSelect.value = 'popular';
  app.ui.search('작가'); await app.runTimers();
  assert.equal(app.requests.at(-1).url.searchParams.get('sort'), 'popular');
  assert.match(app.nodes.searchResults.textContent, /인증 독자 고유 수/);
  assert.equal(new URL(app.nodes.searchResults.children.at(-1).href, 'https://app.test').searchParams.get('sort'), 'popular');
});
test('opening a missing detail or leaving the detail resets previous work share metadata', async () => {
  const app = setup(url => url.searchParams.get('action') === 'episodes' ? Response.json({ episodes: [], nextCursor: null }) :
    url.searchParams.get('workId') === '10' ? Response.json({ work: rawWork('10') }) : Response.json({ error: 'WORK_NOT_FOUND' }, { status: 404 }));
  await app.ui.detail('10'); assert.match(app.context.document.title, /작품 10/);
  await app.ui.detail('404'); assert.equal(app.context.document.title, 'webnovels');
  assert.doesNotMatch(app.context.document.querySelector('meta[property="og:title"]')?.content || '', /작품 10/);
  assert.doesNotMatch(app.context.document.querySelector('meta[property="og:url"]')?.content || '', /works\/10/);
  await app.ui.detail('10'); app.ui.leave('view-home'); assert.equal(app.context.document.title, 'webnovels');
  assert.doesNotMatch(app.context.document.querySelector('meta[property="og:description"]')?.content || '', /공개 줄거리/);
});
test('a delayed home summary does not overwrite the selected genre recommendation', async () => {
  const pending = deferred();
  const app = setup(url => url.searchParams.get('action') === 'home' ? pending.promise : Response.json({ works: [rawWork('20', { title: '선택 장르 작품' })], ranking, nextCursor: null }));
  const home = app.ui.home(); await app.ui.genre('판타지');
  pending.resolve(Response.json({ sections: { recommended: [rawWork('10', { title: '이전 홈 추천' })], popular: [], new: [], completed: [] }, ranking }));
  await home; assert.match(app.nodes.genreWorksGrid.textContent, /선택 장르 작품/); assert.doesNotMatch(app.nodes.genreWorksGrid.textContent, /이전 홈 추천/);
});
test('home failure clears stale recommendations while preserving a newer genre response', async () => {
  const pending = deferred(); let homes = 0;
  const app = setup(url => url.searchParams.get('action') === 'home' ?
    ++homes === 1 ? Response.json({ sections: { recommended: [rawWork('10')], popular: [], new: [], completed: [] }, ranking }) : pending.promise :
    Response.json({ works: [rawWork('20', { title: '새 장르 추천' })], ranking, nextCursor: null }));
  await app.ui.home(); assert.match(app.nodes.cdgHeroSlider.textContent, /작품 10/);
  const home = app.ui.home(); await app.ui.genre('판타지'); pending.reject(Error('home connection lost')); await home;
  assert.match(app.nodes.genreWorksGrid.textContent, /새 장르 추천/); assert.match(app.nodes.cdgHeroSlider.textContent, /불러오지 못/);
});
