/* URL-backed public catalog UI. Text/links are built as DOM nodes, never author HTML. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let listRequest = 0, homeRequest = 0, detailRequest = 0, searchRequest = 0, genreRequest = 0;
  let currentQuery = new URLSearchParams(), detailId = null, episodeCursor = null, episodeBusy = false;
  let searchTimer;
  let searchSortReady = false;
  const defaultTitle = document.title || 'WebNovels - 웹소설 연재 플랫폼';
  const defaultDescription = document.querySelector('meta[name="description"]')?.content || 'WebNovels에서 공개된 무료 웹소설을 읽고 연재하세요.';
  const allowed = new Set(['q', 'genre', 'status', 'rating', 'epRange', 'tag', 'sort', 'type', 'cursor']);
  const active = () => window.ReaderCatalog?.active() === true;
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (label, action) => { const el = node('button', label, 'btn btn-outline btn-sm'); el.type = 'button'; el.onclick = action; return el; };
  function link(label, path, cls) {
    const el = node('a', label, cls); el.href = path;
    el.onclick = event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      event.preventDefault(); window.closeAllModals?.(); window.navigateTo(path); };
    return el;
  }
  const status = (el, message) => { if (!el) return; el.replaceChildren(node('p', message, 'text-muted')); el.setAttribute('role', 'status'); };
  function failure(el, retry) {
    status(el, '목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    el?.append(button('다시 시도', retry));
  }
  function date(value) {
    const parsed = new Date(value || '');
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('ko-KR') : '기록 없음';
  }
  function rankingText(info) {
    return `최근 ${info?.periodDays || 7}일 인증 독자 고유 수 · 작품별 최소 ${info?.minSample || 5}명 · ${date(info?.asOf)} 기준. 스크롤/열람 이벤트 집계이며 실제 완독이나 구매를 뜻하지 않습니다.`;
  }
  function card(work, popular = false) {
    const el = link('', '/works/' + encodeURIComponent(work.id), 'cdg-work-card discovery-card');
    const art = node('div', null, 'cdg-card-cover'), image = node('img');
    image.src = work.coverUrl; image.alt = ''; image.loading = 'lazy'; image.className = 'cdg-card-cover-img'; art.append(image);
    const info = node('div', null, 'cdg-card-info');
    info.append(node('span', work.genre || '웹소설', 'cdg-card-tag'), node('h3', work.title, 'cdg-card-title'),
      node('p', work.author, 'text-muted small'), node('p', `${work.isCompleted ? '완결 · ' : ''}공개 ${work.episodeCount}화`, 'small'));
    if (popular && Number.isInteger(work.rankingReaders) && work.rankingReaders >= 5)
      info.append(node('p', `최근 7일 독자 ${work.rankingReaders}명`, 'small'));
    else info.append(node('p', `최근 공개 ${date(work.lastPublishedAt)}`, 'small text-muted'));
    el.append(art, info); return el;
  }
  function cards(el, works, popular = false) {
    if (!el) return;
    el.replaceChildren(...works.map(work => card(work, popular)));
    if (!works.length) status(el, popular ? '공개 기준을 충족한 독자 집계가 아직 없습니다.' : '조건에 맞는 공개 작품이 없습니다.');
  }
  function parse(search) {
    const source = new URLSearchParams(search), result = new URLSearchParams();
    for (const [key, value] of source) if (allowed.has(key) && value && (key === 'tag' || !result.has(key))) result.append(key, value);
    return result;
  }
  function configure() {
    if ($('discoverySearchForm')) $('discoverySearchForm').hidden = false;
    if ($('discoveryNewSort')) $('discoveryNewSort').hidden = false;
    if ($('homePopularHeading')) $('homePopularHeading').textContent = '최근 7일 많이 읽은 작품';
    const popular = $('selectDiscoverSort')?.querySelector('option[value="popular"]');
    if (popular) popular.textContent = '최근 7일 독자순';
    const views = $('selectDiscoverSort')?.querySelector('option[value="views"]');
    if (views) { views.textContent = '최근 7일 독자순'; views.hidden = true; }
    if ($('searchSuggestionNote')) $('searchSuggestionNote').textContent = '작품명·작가명으로 검색하세요.';
    if ($('searchSortSelect') && !searchSortReady) {
      const select = $('searchSortSelect');
      select.replaceChildren(...[['latest','최신 공개순'],['new','첫 공개순'],['popular','최근 7일 독자순']].map(([value,label]) => {
        const option = node('option', label); option.value = value; return option;
      }));
      select.value = 'latest'; searchSortReady = true;
    }
    for (const [id, route] of [['trendingWorksSection','/discover?sort=popular'],['newWorksSection','/discover?sort=new'],
      ['completedWorksSection','/discover?status=COMPLETED'],['webtoonsSection','/discover?type=WEBTOON']]) {
      const more = $(id)?.querySelector('.cdg-more-link');
      if (more && more.tagName !== 'A') more.replaceWith(link('더보기', route, 'cdg-more-link'));
    }
  }
  function values(params) {
    const result = Object.fromEntries(params); delete result.tag;
    const tags = [...new Set(params.getAll('tag'))].sort(); if (tags.length) result.tag = tags;
    return result;
  }
  function path(params) { const query = params.toString(); return '/discover' + (query ? '?' + query : ''); }
  function syncControls() {
    const groups = [['discoverGenreFilters','genre','ALL'], ['filterStatusGroup','status','ALL'],
      ['filterEpRangeGroup','epRange','ALL'], ['filterRatingGroup','rating','ALL']];
    for (const [id, key, fallback] of groups) for (const el of $(id)?.querySelectorAll('button') || []) {
      const match = el.dataset[key === 'epRange' ? 'eprange' : key] || (key === 'genre' ? (el.textContent.trim() === '전체' ? 'ALL' : el.textContent.trim()) : '');
      const selected = match === (currentQuery.get(key) || fallback);
      el.classList.toggle('active', selected); el.setAttribute('aria-pressed', String(selected));
    }
    for (const el of $('discoverTagFilters')?.querySelectorAll('[data-discover-tag]') || []) {
      const selected = currentQuery.getAll('tag').includes(el.dataset.discoverTag);
      el.classList.toggle('active', selected); el.setAttribute('aria-pressed', String(selected));
    }
    if ($('activeTagsCounter')) $('activeTagsCounter').textContent = `선택된 태그: ${currentQuery.getAll('tag').length}개`;
    if ($('selectDiscoverSort')) $('selectDiscoverSort').value = currentQuery.get('sort') || 'latest';
    if ($('discoverQuery')) $('discoverQuery').value = currentQuery.get('q') || '';
    if ($('discoverType')) $('discoverType').value = currentQuery.get('type') || 'NOVEL';
  }
  async function discover(search = window.location.search) {
    configure();
    const request = ++listRequest;
    currentQuery = parse(search); syncControls();
    const query = values(currentQuery), el = $('discoverWorksGrid');
    status(el, '공개 작품을 찾고 있습니다.'); $('discoverPager')?.replaceChildren();
    if ($('discoverResultsCount')) $('discoverResultsCount').textContent = '검색 중';
    try {
      const result = await window.ReaderCatalog.list(query);
      if (request !== listRequest) return;
      cards(el, result.works, query.sort === 'popular' || query.sort === 'views');
      if ($('discoverResultsCount')) $('discoverResultsCount').textContent = `이 페이지 ${result.works.length}개 작품`;
      if ($('discoveryRankingNote')) $('discoveryRankingNote').textContent = query.type === 'WEBTOON' ? '웹툰 공개 서비스는 준비 중입니다.' :
        ['popular','views'].includes(query.sort) ? rankingText(result.ranking) : '최신 공개순은 최근 회차 공개 시각, 신작순은 첫 공개 시각을 기준으로 합니다.';
      const pager = $('discoverPager');
      if (currentQuery.has('cursor')) { const first = new URLSearchParams(currentQuery); first.delete('cursor'); pager?.append(link('처음 페이지', path(first), 'btn btn-outline')); }
      if (result.nextCursor) { const next = new URLSearchParams(currentQuery); next.set('cursor', result.nextCursor); pager?.append(link('다음 페이지', path(next), 'btn btn-primary')); }
      if ($('discoverQueryStatus')) $('discoverQueryStatus').textContent = '검색 결과를 표시했습니다.';
    } catch (error) {
      if (request !== listRequest) return;
      if ($('discoverResultsCount')) $('discoverResultsCount').textContent = '조회 실패';
      failure(el, () => discover(search));
      if (currentQuery.has('cursor')) el?.append(button('처음 페이지부터 다시 검색', () => filter('cursor', '')));
    }
  }
  function filter(key, value) {
    const params = new URLSearchParams(currentQuery); params.delete('cursor');
    if (!value || value === 'ALL' || value === '전체') params.delete(key); else params.set(key, value);
    window.navigateTo(path(params));
  }
  function toggleTag(tag) {
    const tags = new Set(currentQuery.getAll('tag')); tags.has(tag) ? tags.delete(tag) : tags.add(tag);
    const params = new URLSearchParams(currentQuery); params.delete('tag'); params.delete('cursor');
    [...tags].sort().forEach(item => params.append('tag', item)); window.navigateTo(path(params));
  }
  async function home() {
    configure();
    const request = ++homeRequest;
    const genreAtStart = genreRequest;
    const grids = ['trendingWorksGrid','newWorksGrid','completedWorksGrid','todayFreeGrid','genreWorksGrid'];
    try {
      const result = await window.ReaderCatalog.home(); if (request !== homeRequest) return;
      const hero = $('cdgHeroSlider');
      if (typeof cdgHeroInterval !== 'undefined' && cdgHeroInterval) { clearInterval(cdgHeroInterval); cdgHeroInterval = null; }
      cards(hero, result.sections.recommended); hero?.classList.add('discovery-recommendations');
      cards($('trendingWorksGrid'), result.sections.popular, true);
      cards($('newWorksGrid'), result.sections.new); cards($('completedWorksGrid'), result.sections.completed);
      cards($('todayFreeGrid'), result.sections.new);
      if (genreAtStart === genreRequest) cards($('genreWorksGrid'), result.sections.recommended);
      status($('webtoonsGrid'), '웹툰 공개 서비스는 준비 중입니다.');
      if ($('goldenBestSection')) $('goldenBestSection').hidden = true;
      if ($('homeRankingNote')) $('homeRankingNote').textContent = rankingText(result.ranking);
      if ($('homeRecommendationNote')) $('homeRecommendationNote').textContent = '편집 추천 · 운영자가 선정한 작품입니다.';
    } catch {
      if (request === homeRequest) ['cdgHeroSlider', ...grids].forEach(id => {
        if (id !== 'genreWorksGrid' || genreAtStart === genreRequest) failure($(id), home);
      });
    }
  }
  async function genre(value) {
    const request = ++genreRequest;
    try {
      const result = await window.ReaderCatalog.list({ genre: value === '전체' ? undefined : value, limit: 4 });
      if (request === genreRequest) cards($('genreWorksGrid'), result.works);
    } catch { if (request === genreRequest) failure($('genreWorksGrid'), () => genre(value)); }
  }
  function meta(work) {
    document.title = `${work.title} · webnovels`;
    const description = document.querySelector('meta[name="description"]'); if (description) description.content = String(work.description || '').slice(0, 160);
    for (const [property, content] of [['og:title',work.title], ['og:description',String(work.description || '').slice(0, 160)], ['og:url',new URL('/works/' + work.id, window.location.origin).href]]) {
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', property); document.head.append(el); } el.content = content;
    }
  }
  function resetMeta() {
    document.title = defaultTitle;
    const description = document.querySelector('meta[name="description"]'); if (description) description.content = defaultDescription;
    for (const property of ['og:title','og:description','og:url']) {
      const el = document.querySelector(`meta[property="${property}"]`); if (el) el.remove();
    }
  }
  function distribution(work) {
    const el = $('detailExternalLinks'); if (!el) return; el.replaceChildren();
    if (work.distribution?.mode !== 'NON_EXCLUSIVE') return;
    const labels = {'www.munpia.com':'문피아','novel.munpia.com':'문피아','novel.naver.com':'네이버','comic.naver.com':'네이버','page.kakao.com':'카카오','webtoon.kakao.com':'카카오','www.joara.com':'조아라','www.lezhin.com':'레진'};
    for (const item of (work.distribution.externalLinks || []).slice(0, 5)) {
      try {
        const url = new URL(item.url);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !labels[url.hostname] || /[\s\\\x00-\x1f\x7f]/.test(item.url) || /https:\/\/[^/]*:/.test(item.url)) continue;
        const badge = node('a', `${labels[url.hostname]}에서 연재 중 ↗`, 'btn btn-outline btn-sm');
        badge.href = url.href; badge.target = '_blank'; badge.rel = 'noopener noreferrer'; badge.setAttribute('aria-label', `${labels[url.hostname]} 연재 페이지, 새 탭`); el.append(badge);
      } catch { /* Invalid public links are omitted. */ }
    }
  }
  async function loadEpisodes(id, request, append = false) {
    if (episodeBusy) return; episodeBusy = true;
    const el = $('detailEpisodeList'), pager = $('detailEpisodePager');
    pager?.replaceChildren(node('p', '회차를 불러오는 중입니다.', 'text-muted'));
    try {
      const result = await window.ReaderCatalog.episodes(id, append ? episodeCursor : undefined);
      if (request !== detailRequest || id !== detailId) return;
      const rows = result.episodes.map(ep => link(`${ep.episodeNumber}화 · ${ep.title} · 무료`, `/read/${id}/${ep.episodeNumber}`, 'episode-row discovery-episode'));
      if (append) el?.append(...rows); else el?.replaceChildren(...rows);
      if (!rows.length && !append) status(el, '공개된 회차가 없습니다.');
      episodeCursor = result.nextCursor; pager?.replaceChildren();
      if (episodeCursor) pager?.append(button('회차 더 보기', () => loadEpisodes(id, request, true)));
    } catch { if (request === detailRequest) failure(pager, () => loadEpisodes(id, request, append)); }
    finally { if (request === detailRequest) episodeBusy = false; }
  }
  async function detail(id, push = true) {
    window.switchWebNovelsView('view-work-detail', null, false);
    resetMeta();
    const request = ++detailRequest; detailId = String(id); episodeBusy = false; episodeCursor = null;
    if (push && window.location.pathname !== '/works/' + id) window.history.pushState({}, '', '/works/' + encodeURIComponent(id));
    activeWork = null; status($('detailEpisodeList'), '작품 정보를 불러오는 중입니다.');
    $('detailEpisodePager')?.replaceChildren(); $('detailExternalLinks')?.replaceChildren();
    ['detailTitle','detailAuthor','detailGenreBadge','detailRatingBadge','detailAiBadge','detailDescription','detailDates'].forEach(key => { if ($(key)) $(key).textContent = ''; });
    if ($('detailCoverImg')) $('detailCoverImg').removeAttribute('src');
    for (const key of ['btnDetailReadFirst','btnStickyRead']) if ($(key)) $(key).disabled = true;
    try {
      const work = await window.ReaderCatalog.work(id);
      if (request !== detailRequest) return;
      activeWork = work;
      const text = { detailTitle: work.title, detailAuthor: `작가: ${work.author}`, detailGenreBadge: work.genre,
        detailRatingBadge: work.rating === 'AGE_15' ? '15세 이상' : '전체이용가', detailAiBadge: `AI ${work.aiUsageType}`,
        detailDescription: work.description, detailDates: `등록 ${date(work.createdAt)} · 첫 공개 ${date(work.firstPublishedAt)} · 최근 공개 ${date(work.lastPublishedAt)}` };
      for (const [key, value] of Object.entries(text)) if ($(key)) $(key).textContent = value || '';
      if ($('detailCoverImg')) { $('detailCoverImg').src = work.coverUrl; $('detailCoverImg').alt = work.title; }
      for (const key of ['btnDetailReadFirst','btnStickyRead']) if ($(key)) { $(key).disabled = !work.firstEpisodeNumber; $(key).textContent = work.firstEpisodeNumber ? `첫 공개 회차 읽기 (${work.firstEpisodeNumber}화)` : '공개 회차 없음'; }
      window.updateFavoriteButtons?.(work.id); window.updateSubscribeButtons?.(work);
      distribution(work); meta(work);
      $('detailTitle')?.setAttribute('tabindex', '-1'); $('detailTitle')?.focus({ preventScroll: true });
      await loadEpisodes(String(id), request);
    } catch (error) {
      if (request !== detailRequest) return;
      if (error.status === 404) status($('detailEpisodeList'), '현재 공개된 작품을 찾을 수 없습니다.');
      else failure($('detailEpisodeList'), () => detail(id, false));
    }
  }
  function search(query = '') {
    configure();
    const request = ++searchRequest; clearTimeout(searchTimer);
    const sort = $('searchSortSelect')?.value || 'latest';
    status($('searchResults'), '검색 중입니다.');
    searchTimer = setTimeout(async () => {
      try {
        const result = await window.ReaderCatalog.list({ q: query.trim(), sort, limit: 8 });
        if (request !== searchRequest) return;
        const el = $('searchResults'); cards(el, result.works, sort === 'popular');
        if (sort === 'popular') el?.append(node('p', rankingText(result.ranking), 'text-muted small'));
        el?.append(link('전체 검색 결과 보기', path(new URLSearchParams({ ...(query.trim() ? { q: query.trim() } : {}), sort })), 'btn btn-primary'));
      } catch { if (request === searchRequest) failure($('searchResults'), () => search(query)); }
    }, 200);
  }
  function leave(view) {
    if (view !== 'view-work-detail') { ++detailRequest; detailId = null; episodeBusy = false; resetMeta(); }
    if (view !== 'view-discover') ++listRequest;
    if (view !== 'view-home') { ++homeRequest; ++genreRequest; }
  }
  window.ReaderDiscovery = Object.freeze({ active, home, discover, detail, genre, search, filter, toggleTag, leave, parse, values, path,
    reset: () => window.navigateTo('/discover'), submit: event => { event?.preventDefault(); filter('q', $('discoverQuery')?.value.trim() || ''); } });
})();
