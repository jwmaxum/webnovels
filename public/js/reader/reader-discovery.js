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
  const t = (source, params = {}) => window.ReaderI18n?.t(source, params) ?? source.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
  const localized = (el, label, attribute) => {
    if (!el) return el;
    const render = typeof label === 'function' ? label : () => t(label);
    if (window.ReaderFeatureCopy) window.ReaderFeatureCopy.bind(el, render, attribute);
    else if (attribute) el.setAttribute(attribute, render());
    else el.textContent = render();
    return el;
  };
  const message = (tag, label, cls) => localized(node(tag, null, cls), label);
  const workCopy = work => window.ReaderI18n?.work(work) || work;
  const button = (label, action) => { const el = message('button', label, 'btn btn-outline btn-sm'); el.type = 'button'; el.onclick = action; return el; };
  function link(label, path, cls) {
    const el = label ? message('a', label, cls) : node('a', null, cls); el.href = path;
    el.onclick = event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      event.preventDefault(); window.closeAllModals?.(); window.navigateTo(path); };
    return el;
  }
  const status = (el, label) => { if (!el) return; el.replaceChildren(message('p', label, 'text-muted')); el.setAttribute('role', 'status'); };
  function failure(el, retry) {
    status(el, '목록을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    el?.append(button('다시 시도', retry));
  }
  const locale = () => window.ReaderI18n?.locale() || 'ko-KR';
  function date(value, dateOnly = false) {
    const parsed = new Date(value || '');
    return Number.isFinite(parsed.getTime()) ? (dateOnly ? parsed.toLocaleDateString(locale()) : parsed.toLocaleString(locale())) : t('기록 없음');
  }
  function rankingText(info) {
    return t('최근 {days}일 인증 독자 고유 수 · 작품별 최소 {minimum}명 · {date} 기준. 스크롤/열람 이벤트 집계이며 실제 완독이나 구매를 뜻하지 않습니다.',
      { days: info?.periodDays || 7, minimum: info?.minSample || 5, date: date(info?.asOf) });
  }
  function card(work, popular = false) {
    const el = link('', '/works/' + encodeURIComponent(work.id), 'cdg-work-card discovery-card');
    const art = node('div', null, 'cdg-card-cover'), image = node('img');
    image.src = work.coverUrl; image.alt = ''; image.loading = 'lazy'; image.className = 'cdg-card-cover-img'; art.append(image);
    const info = node('div', null, 'cdg-card-info');
    const kind = work.contentType === 'WEBTOON' ? '웹툰' : '웹소설';
    const title = message('h3', () => workCopy(work).title, 'cdg-card-title');
    title.dir = 'auto';
    localized(title, () => workCopy(work).titleLanguage || work.originalLanguage || 'ko', 'lang');
    info.append(message('span', () => work.genre ? localGenre(work.genre) : t(kind), 'cdg-card-tag'), title,
      message('p', () => work.author === '작가 정보 없음' ? t(work.author) : work.author, 'text-muted small'),
      message('p', () => [t(kind), t(work.isCompleted ? '완결' : work.status === 'PAUSED' ? '휴재' : '연재 중'),
        t(work.rating === 'AGE_15' ? '15세 이상' : '전체이용가'),
        t(work.episodeCount === 1 ? '공개 1화' : '공개 {count}화', { count: work.episodeCount })].join(' · '), 'small'));
    if (popular && Number.isInteger(work.rankingReaders) && work.rankingReaders >= 5)
      info.append(message('p', () => t('최근 7일 독자 {count}명', { count: work.rankingReaders }), 'small'));
    else info.append(message('p', () => t('최근 공개 {date}', { date: date(work.lastPublishedAt) }), 'small text-muted'));
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
    localized($('homePopularHeading'), '최근 7일 많이 읽은 작품');
    const popular = $('selectDiscoverSort')?.querySelector('option[value="popular"]');
    localized(popular, '최근 7일 독자순');
    const views = $('selectDiscoverSort')?.querySelector('option[value="views"]');
    if (views) { localized(views, '최근 7일 독자순'); views.hidden = true; }
    localized($('searchSuggestionNote'), '작품명·작가명으로 검색하세요.');
    if ($('searchSortSelect') && !searchSortReady) {
      const select = $('searchSortSelect');
      select.replaceChildren(...[['latest','최신 공개순'],['new','첫 공개순'],['popular','최근 7일 독자순']].map(([value,label]) => {
        const option = message('option', label); option.value = value; return option;
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
  function localGenre(value) {
    const parts = Array.isArray(value) ? value : String(value).split(',');
    return parts.map(part => t(part.trim())).join(', ');
  }
  function summaries() {
    const el = $('discoverActiveFilters'); if (!el) return;
    el.replaceChildren(message('span', currentQuery.get('type') === 'WEBTOON' ? '웹툰' : '웹소설', 'discovery-type-summary'));
    const labels = { q: '검색', genre: '장르', status: '상태', rating: '등급', epRange: '회차', sort: '정렬' };
    const names = { ONGOING: '연재 중', COMPLETED: '완결', ALL_AGES: '전체이용가', AGE_15: '15세 이상', AGE_19: '19세 이상', latest: '최신 공개순', new: '첫 공개순', popular: '최근 7일 독자순', views: '최근 7일 독자순', episodes: '회차 많은순' };
    for (const key of Object.keys(labels)) {
      const value = currentQuery.get(key);
      if (!value || value === 'ALL' || (key === 'sort' && value === 'latest')) continue;
      const label = () => `${t(labels[key])}: ${key === 'q' ? value : t(names[value] || value)}`;
      const remove = button(() => label() + ' ×', () => filter(key, ''));
      remove.classList.add('discovery-condition'); localized(remove, () => t('{label} 조건 해제', { label: label() }), 'aria-label'); el.append(remove);
    }
    for (const tag of [...new Set(currentQuery.getAll('tag'))].sort()) {
      const control = $('discoverTagFilters')?.querySelectorAll('[data-discover-tag]') || [];
      const label = () => [...control].find(item => item.dataset.discoverTag === tag)?.textContent || '#' + tag;
      const remove = button(() => label() + ' ×', () => toggleTag(tag));
      remove.classList.add('discovery-condition'); localized(remove, () => t('{label} 조건 해제', { label: label() }), 'aria-label'); el.append(remove);
    }
  }
  function syncControls() {
    window.updateDiscoverTypeControls?.(currentQuery.get('type') || 'NOVEL');
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
    localized($('activeTagsCounter'), () => t('선택된 태그: {count}개', { count: currentQuery.getAll('tag').length }));
    if ($('selectDiscoverSort')) $('selectDiscoverSort').value = currentQuery.get('sort') || 'latest';
    if ($('discoverQuery')) $('discoverQuery').value = currentQuery.get('q') || '';
    if ($('discoverType')) $('discoverType').value = currentQuery.get('type') || 'NOVEL';
    if ($('inputSearchHeader')) $('inputSearchHeader').value = currentQuery.get('q') || '';
    if ($('inputSearchMobile')) $('inputSearchMobile').value = currentQuery.get('q') || '';
    summaries(); window.syncReaderNavigation?.();
  }
  async function discover(search = window.location.search) {
    configure();
    const request = ++listRequest;
    currentQuery = parse(search); syncControls();
    const query = values(currentQuery), el = $('discoverWorksGrid');
    status(el, '공개 작품을 찾고 있습니다.'); el?.setAttribute('aria-busy', 'true'); $('discoverPager')?.replaceChildren();
    localized($('discoverResultsCount'), '검색 중');
    localized($('discoverQueryStatus'), '검색 중입니다.');
    try {
      const result = await window.ReaderCatalog.list(query);
      if (request !== listRequest) return;
      cards(el, result.works, query.sort === 'popular' || query.sort === 'views');
      if (!result.works.length) {
        if (query.type === 'WEBTOON' && window.WEBNOVELS_CONFIG?.webtoonServiceEnabled !== true)
          status(el, '웹툰 공개 서비스는 준비 중입니다.');
        else el?.append(button('검색 조건 초기화', () => window.ReaderDiscovery.reset()));
      }
      localized($('discoverResultsCount'), () => t(result.works.length === 1 ? '이 페이지 1개 작품' : '이 페이지 {count}개 작품', { count: result.works.length }));
      localized($('discoveryRankingNote'), query.type === 'WEBTOON' && window.WEBNOVELS_CONFIG?.webtoonServiceEnabled !== true ? '웹툰 공개 서비스는 준비 중입니다.' :
        ['popular','views'].includes(query.sort) ? () => rankingText(result.ranking) : '최신 공개순은 최근 회차 공개 시각, 신작순은 첫 공개 시각을 기준으로 합니다.');
      const pager = $('discoverPager');
      if (currentQuery.has('cursor')) { const first = new URLSearchParams(currentQuery); first.delete('cursor'); pager?.append(link('처음 페이지', path(first), 'btn btn-outline')); }
      if (result.nextCursor) { const next = new URLSearchParams(currentQuery); next.set('cursor', result.nextCursor); pager?.append(link('다음 페이지', path(next), 'btn btn-primary')); }
      localized($('discoverQueryStatus'), '검색 결과를 표시했습니다.');
    } catch (error) {
      if (request !== listRequest) return;
      localized($('discoverResultsCount'), '조회 실패');
      localized($('discoverQueryStatus'), '검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.');
      failure(el, () => discover(search));
      if (currentQuery.has('cursor')) el?.append(button('처음 페이지부터 다시 검색', () => filter('cursor', '')));
    } finally { if (request === listRequest) el?.setAttribute('aria-busy', 'false'); }
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
    const display = window.ReaderDisplay?.home();
    const request = ++homeRequest;
    const genreAtStart = genreRequest;
    const valid = () => request === homeRequest;
    let summary = null, recent = null, summaryFailed = false, recentFailed = false;
    const hasRecent = !!$('recentNovelsGrid');
    const optional = [['heroFeaturedSection','cdgHeroSlider'],['editorialSpotlightSection','editorialSpotlightGrid'],['trendingWorksSection','trendingWorksGrid'],['newWorksSection','newWorksGrid'],['completedWorksSection','completedWorksGrid']];
    for (const [section, grid] of optional) { if ($(section)) $(section).hidden = true; status($(grid), '공개 작품을 불러오는 중입니다.'); }
    for (const id of ['goldenBestSection','todayFreeSection','genreRecSection']) if ($(id)) $(id).hidden = true;
    for (const id of ['recentNovelsGrid','webtoonsGrid']) { status($(id), '공개 작품을 불러오는 중입니다.'); $(id)?.setAttribute('aria-busy', 'true'); }
    if ($('homeCatalogStatus')) { $('homeCatalogStatus').hidden = false; status($('homeCatalogStatus'), '공개 작품을 불러오는 중입니다.'); }
    if (typeof cdgHeroInterval !== 'undefined' && cdgHeroInterval) { clearInterval(cdgHeroInterval); cdgHeroInterval = null; }
    const render = () => {
      if (!valid()) return;
      const used = new Set();
      const unique = (works, limit = 6) => {
        const result = [];
        for (const work of works || []) {
          const id = String(work.id); if (used.has(id)) continue;
          used.add(id); result.push(work); if (result.length === limit) break;
        }
        return result;
      };
      const section = (id, grid, works, popular = false) => {
        cards($(grid), works, popular); if ($(id)) $(id).hidden = works.length === 0;
      };
      if (summary && !window.ReaderDisplay) {
        section('heroFeaturedSection', 'cdgHeroSlider', unique(summary.sections.recommended, 1));
        const hero = $('cdgHeroSlider'); hero?.classList.add('discovery-recommendations');
        hero?.children[0]?.classList.add('discovery-featured');
        section('editorialSpotlightSection', 'editorialSpotlightGrid', unique(summary.sections.spotlight));
      }
      if (hasRecent) {
        const grid = $('recentNovelsGrid'); grid.setAttribute('aria-busy', String(!recent && !recentFailed));
        if (recent) {
          const works = unique(recent.works.filter(work => work.contentType === 'NOVEL'));
          cards(grid, works);
          if (!recent.works.length) status(grid, '아직 공개된 웹소설이 없습니다. 새로운 연재를 기다려 주세요.');
          if ($('recentNovelsSection')) $('recentNovelsSection').hidden = recent.works.length > 0 && works.length === 0;
        } else {
          if ($('recentNovelsSection')) $('recentNovelsSection').hidden = false;
          if (recentFailed) failure(grid, home);
        }
      }
      const webtoon = $('webtoonsGrid');
      if ($('webtoonsSection')) $('webtoonsSection').hidden = false;
      webtoon?.setAttribute('aria-busy', String(!summary && !summaryFailed));
      if (window.WEBNOVELS_CONFIG?.webtoonServiceEnabled !== true) {
        status(webtoon, '웹툰 공개 서비스는 준비 중입니다.'); webtoon?.setAttribute('aria-busy', 'false');
      } else if (summary) {
        const source = summary.sections.webtoons || [], works = unique(source);
        cards(webtoon, works);
        if (!source.length) status(webtoon, '아직 공개된 웹툰이 없습니다. 새로운 연재를 기다려 주세요.');
        if ($('webtoonsSection')) $('webtoonsSection').hidden = source.length > 0 && works.length === 0;
      } else if (summaryFailed) failure(webtoon, home);
      if (summary) {
        section('trendingWorksSection', 'trendingWorksGrid', unique(summary.sections.popular), true);
        section('newWorksSection', 'newWorksGrid', unique(summary.sections.new));
        section('completedWorksSection', 'completedWorksGrid', unique(summary.sections.completed));
        // Hidden legacy grids retain their DOM contract, without duplicating visible shelves.
        cards($('todayFreeGrid'), []);
        if (genreAtStart === genreRequest) cards($('genreWorksGrid'), summary.sections.recommended);
        localized($('homeRankingNote'), () => rankingText(summary.ranking));
        localized($('homeRecommendationNote'), '편집 추천 · 운영자가 선정한 작품입니다.');
      } else if (summaryFailed) {
        for (const [, grid] of optional) failure($(grid), home);
        if (genreAtStart === genreRequest) failure($('genreWorksGrid'), home);
      }
      const notice = $('homeCatalogStatus');
      if (notice) {
        notice.hidden = !!summary;
        if (summaryFailed) { notice.hidden = false; failure(notice, home); }
      }
      window.ReaderDisplay?.syncHome();
    };
    const loadSummary = window.ReaderCatalog.home().then(result => {
      if (!valid()) return; summary = result; render(); if (!window.ReaderDisplay) window.GrowthStudio?.home();
    }, () => { if (valid()) { summaryFailed = true; render(); } });
    const loadRecent = hasRecent ? window.ReaderCatalog.list({ type: 'NOVEL', sort: 'latest', limit: 6 }).then(result => {
      if (!valid()) return; recent = result; render();
    }, () => { if (valid()) { recentFailed = true; render(); } }) : Promise.resolve();
    render(); await Promise.all([loadSummary, loadRecent, display]);
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
        const platform = labels[url.hostname];
        const badge = message('a', () => t('{platform}에서 연재 중 ↗', { platform }), 'btn btn-outline btn-sm');
        badge.href = url.href; badge.target = '_blank'; badge.rel = 'noopener noreferrer';
        localized(badge, () => t('{platform} 연재 페이지, 새 탭', { platform }), 'aria-label'); el.append(badge);
      } catch { /* Invalid public links are omitted. */ }
    }
  }
  function detailStatus(message) {
    localized($('detailLoadStatus'), message);
  }
  function episodeRow(ep, id) {
    const row = link('', `/read/${id}/${ep.episodeNumber}`, 'episode-row discovery-episode');
    const copy = () => window.ReaderI18n?.episode(id, ep) || ep;
    const title = message('span', () => copy().title, 'discovery-episode-title');
    title.dir = 'auto';
    localized(title, () => copy().titleLanguage || ep.originalLanguage || 'ko', 'lang');
    const published = ep.published_at || ep.publishedAt;
    row.append(message('span', () => t('{number}화', { number: ep.episodeNumber }), 'discovery-episode-number'), title,
      message('span', () => Number.isFinite(Date.parse(published)) ? t('무료 · 공개 {date}', { date: date(published, true) }) : t('무료'), 'discovery-episode-meta'));
    return row;
  }
  async function loadEpisodes(id, request, append = false) {
    if (request !== detailRequest || id !== detailId || episodeBusy) return;
    episodeBusy = true;
    const el = $('detailEpisodeList'), pager = $('detailEpisodePager');
    el?.setAttribute('aria-busy', 'true');
    detailStatus(append ? '다음 공개 회차를 불러오는 중입니다.' : '공개 회차를 불러오는 중입니다.');
    pager?.replaceChildren(message('p', '회차를 불러오는 중입니다.', 'text-muted'));
    try {
      const result = await window.ReaderCatalog.episodes(id, append ? episodeCursor : undefined);
      if (request !== detailRequest || id !== detailId) return;
      const rows = result.episodes.map(ep => episodeRow(ep, id));
      if (append) el?.append(...rows); else el?.replaceChildren(...rows);
      if (!rows.length && !append) status(el, '공개된 회차가 없습니다.');
      episodeCursor = result.nextCursor; pager?.replaceChildren();
      if (episodeCursor) pager?.append(button('회차 더 보기', () => loadEpisodes(id, request, true)));
      detailStatus(!rows.length && !append ? '현재 공개된 회차가 없습니다.' : '작품 정보와 공개 회차를 표시했습니다.');
    } catch {
      if (request === detailRequest) {
        if (!append) status(el, '공개 회차 목록을 불러오지 못했습니다. 아래에서 다시 시도해 주세요.');
        failure(pager, () => loadEpisodes(id, request, append));
        detailStatus('공개 회차 목록을 불러오지 못했습니다. 다시 시도할 수 있습니다.');
      }
    } finally { if (request === detailRequest) { episodeBusy = false; el?.setAttribute('aria-busy', 'false'); } }
  }
  function renderWork(work) {
    const copy = () => workCopy(work);
    const text = {
      detailTitle: () => copy().title,
      detailAuthor: () => t('작가: {name}', { name: work.author === '작가 정보 없음' ? t(work.author) : work.author }),
      detailGenreBadge: () => work.genre ? localGenre(work.genre) : '',
      detailRatingBadge: work.rating === 'AGE_15' ? '15세 이상' : '전체이용가',
      detailAiBadge: { NONE: 'AI 미사용', ASSISTED: 'AI 보조', GENERATED: 'AI 생성' }[work.aiUsageType] || 'AI 사용 정보 없음',
      detailPublicationStatus: work.isCompleted ? '완결' : work.status === 'PAUSED' ? '휴재' : '연재 중',
      detailContentType: work.contentType === 'WEBTOON' ? '웹툰' : '웹소설',
      detailDescription: () => copy().description || t('등록된 작품 소개가 없습니다.'),
      detailEpisodesHeading: () => t('공개 회차 · {count}화', { count: work.episodeCount }),
      detailDates: () => t('등록 {created} · 첫 공개 {first} · 최근 공개 {latest}',
        { created: date(work.createdAt), first: date(work.firstPublishedAt), latest: date(work.lastPublishedAt) })
    };
    for (const [key, value] of Object.entries(text)) localized($(key), value);
    localized($('detailTitle'), () => copy().titleLanguage || work.originalLanguage || 'ko', 'lang');
    localized($('detailDescription'), () => copy().description ? copy().descriptionLanguage || work.originalLanguage || 'ko' : '', 'lang');
    if ($('detailCoverImg')) {
      $('detailCoverImg').src = work.coverUrl;
      localized($('detailCoverImg'), () => copy().title, 'alt');
    }
    const original = $('detailOriginalLanguage');
    if (original) {
      const item = copy(), language = item.titleLanguage || work.originalLanguage || 'ko';
      const fallbackLanguage = language !== locale() ? language : item.description && item.descriptionLanguage !== locale() ? item.descriptionLanguage : null;
      original.hidden = !fallbackLanguage || !window.ReaderI18n;
      original.textContent = original.hidden ? '' : t('원문 표시 · {language}', { language: window.ReaderI18n.language(fallbackLanguage) });
    }
    const first = Number.isInteger(work.firstEpisodeNumber) && work.firstEpisodeNumber > 0 ? work.firstEpisodeNumber : null;
    for (const key of ['btnDetailReadFirst','btnStickyRead']) if ($(key)) {
      $(key).disabled = !first;
      localized($(key), first ? () => t('첫 공개 회차 읽기 ({number}화)', { number: first }) : '공개 회차 없음');
    }
    meta(copy());
  }
  async function detail(id, push = true) {
    window.switchWebNovelsView('view-work-detail', null, false);
    resetMeta();
    const request = ++detailRequest; detailId = String(id); episodeBusy = false; episodeCursor = null;
    if (push && window.location.pathname !== '/works/' + id) window.history.pushState({}, '', '/works/' + encodeURIComponent(id));
    activeWork = null; status($('detailEpisodeList'), '작품 정보를 불러오는 중입니다.');
    $('view-work-detail')?.setAttribute('aria-busy', 'true');
    $('detailEpisodeList')?.setAttribute('aria-busy', 'true');
    detailStatus('작품 정보를 불러오는 중입니다.');
    $('detailEpisodePager')?.replaceChildren(); $('detailExternalLinks')?.replaceChildren();
    if($('detailShareLink')){$('detailShareLink').hidden=true;$('detailShareLink').removeAttribute('href');}
    ['detailTitle','detailAuthor','detailGenreBadge','detailRatingBadge','detailAiBadge','detailDescription','detailDates','detailPublicationStatus','detailContentType'].forEach(key => localized($(key), ''));
    if ($('detailOriginalLanguage')) $('detailOriginalLanguage').hidden = true;
    localized($('detailEpisodesHeading'), '공개 회차');
    if ($('detailCoverImg')) { $('detailCoverImg').removeAttribute('src'); localized($('detailCoverImg'), '', 'alt'); }
    for (const key of ['btnDetailReadFirst','btnStickyRead']) if ($(key)) { $(key).disabled = true; localized($(key), '공개 회차 확인 중'); }
    try {
      const work = await window.ReaderCatalog.work(id);
      if (request !== detailRequest) return;
      activeWork = work;
      renderWork(work);
      window.updateFavoriteButtons?.(work.id); window.updateSubscribeButtons?.(work);
      distribution(work);
      window.GrowthStudio?.referral?.(work.id);
      if($('detailShareLink')&&window.WEBNOVELS_CONFIG?.growthServiceEnabled===true){$('detailShareLink').href='/share/'+work.id;$('detailShareLink').hidden=false;}
      $('detailTitle')?.setAttribute('tabindex', '-1'); $('detailTitle')?.focus({ preventScroll: true });
      await loadEpisodes(String(id), request);
    } catch (error) {
      if (request !== detailRequest) return;
      activeWork = null;
      for (const key of ['btnDetailReadFirst','btnStickyRead']) if ($(key)) { $(key).disabled = true; localized($(key), '공개 회차 없음'); }
      if (error.status === 404) { status($('detailEpisodeList'), '현재 공개된 작품을 찾을 수 없습니다.'); detailStatus('현재 공개된 작품을 찾을 수 없습니다.'); }
      else { failure($('detailEpisodeList'), () => detail(id, false)); detailStatus('작품 정보를 불러오지 못했습니다. 다시 시도할 수 있습니다.'); }
    } finally {
      if (request === detailRequest) { $('view-work-detail')?.setAttribute('aria-busy', 'false'); $('detailEpisodeList')?.setAttribute('aria-busy', 'false'); }
    }
  }
  function search(query = '') {
    configure();
    const request = ++searchRequest; clearTimeout(searchTimer);
    const sort = $('searchSortSelect')?.value || 'latest';
    const type = new URLSearchParams(window.location.search).get('type') === 'WEBTOON' ? 'WEBTOON' : 'NOVEL';
    status($('searchResults'), '검색 중입니다.');
    searchTimer = setTimeout(async () => {
      try {
        const result = await window.ReaderCatalog.list({ q: query.trim(), type, sort, limit: 8 });
        if (request !== searchRequest) return;
        const el = $('searchResults'); cards(el, result.works, sort === 'popular');
        if (sort === 'popular') el?.append(message('p', () => rankingText(result.ranking), 'text-muted small'));
        el?.append(link('전체 검색 결과 보기', path(new URLSearchParams({ ...(query.trim() ? { q: query.trim() } : {}), type, sort })), 'btn btn-primary'));
      } catch { if (request === searchRequest) failure($('searchResults'), () => search(query)); }
    }, 200);
  }
  function leave(view) {
    if (view !== 'view-work-detail') { ++detailRequest; detailId = null; episodeBusy = false; resetMeta(); }
    if (view !== 'view-discover') ++listRequest;
    if (view !== 'view-home') { ++homeRequest; ++genreRequest; window.GrowthStudio?.leaveHome(); }
  }
  window.addEventListener?.('reader:localechange', () => {
    if (!active()) return;
    const view = window.currentActiveView;
    if (view === 'view-discover') {
      const pendingText = $('discoverQuery')?.value;
      const next = parse(window.location.search);
      if (next.has('cursor')) {
        next.delete('cursor');
        window.history.replaceState(window.history.state, '', path(next));
      }
      void discover(next);
      if (pendingText != null && $('discoverQuery')) $('discoverQuery').value = pendingText;
    }
    if (view === 'view-home') void home();
    if (view === 'view-work-detail' && detailId) {
      const id = detailId, request = ++detailRequest;
      episodeBusy = false; episodeCursor = null;
      $('detailEpisodePager')?.replaceChildren();
      if (activeWork) renderWork(activeWork);
      void window.ReaderCatalog.work(id).then(work => {
        if (request !== detailRequest || id !== detailId) return;
        activeWork = work; renderWork(work); distribution(work);
        window.updateFavoriteButtons?.(id); window.updateSubscribeButtons?.(work);
        return loadEpisodes(id, request);
      }).catch(error => {
        if (request === detailRequest) {
          if (activeWork && ![403, 404].includes(error?.status)) void loadEpisodes(id, request);
          else void detail(id, false);
        }
      }).finally(() => {
        if (request === detailRequest) {
          $('view-work-detail')?.setAttribute('aria-busy', 'false');
          $('detailEpisodeList')?.setAttribute('aria-busy', 'false');
        }
      });
    }
    if ($('modalSearch')?.classList.contains('active')) search($('globalSearchInput')?.value || '');
  });
  window.ReaderDiscovery = Object.freeze({ active, home, discover, detail, genre, search, filter, toggleTag, leave, parse, values, path,
    reset: () => window.navigateTo('/discover?type=' + (currentQuery.get('type') === 'WEBTOON' ? 'WEBTOON' : 'NOVEL')), submit: event => { event?.preventDefault(); filter('q', $('discoverQuery')?.value.trim() || ''); } });
})();
