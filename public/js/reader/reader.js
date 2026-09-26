// ============================================================
// [Reader Domain Engine] public/js/reader/reader.js
//
// [Purpose]
// - 독자(Reader) 경험 전담 모듈
// - 홈(Home) CDG 스타일 큐레이션 및 계속 읽기(Continue Reading)
// - 탐색(Discover) & 실시간 다차원 검색(Search)
// - 작품 상세(Work Detail) & 1~6화 회차 목록 & 7~10화 연재예정(Coming Soon)
// - 웹소설/웹툰 뷰어(Reader Engine) & 광고/포인트 언락 게이트
// - 계층형 대댓글(Nested Comments) 시스템
// - 내 서재(Library) - 읽는 중, 관심작품, 구독작가 동기화
// - 독자 회원가입/로그인/프로필수정 & PASS 성인인증
// ============================================================


// --- 1. 홈(Home) 큐레이션 & 추천 렌더러 ---

// ============================================================
// [CDG PLAY Aesthetics] Home Works Renderer & Helpers
// ============================================================

// getWorkCover, getAuthorName are defined in /js/core/ui-utils.js

// Single Work Card HTML Template (CDG PLAY Aesthetic - 실제 독자 조회수 실시간 연동)
function renderCdgWorkCardHtml(w, options = {}) {
  const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
  const cover = escapeHtml(getWorkCover(w));
  const workId = /^[1-9]\d{0,18}$/.test(String(w.id)) ? String(w.id) : '';
  const rank = Number.isInteger(Number(options.rank)) && Number(options.rank)>0 && Number(options.rank)<=100000
    ? Number(options.rank) : null;
  const authorName = getAuthorName(w);
  const rawViews = Number(w.viewCount ?? w.view_count ?? 0);
  const viewFormatted = rawViews >= 1000 ? `${(rawViews / 1000).toFixed(1)}K` : `${rawViews}회`;

  let rankBadgeHtml = '';
  if (options.badge === 'GOLDEN' && rank) {
    rankBadgeHtml = `<div class="cdg-rank-badge cdg-badge-golden" title="골든 베스트 ${rank}위">GOLDEN ${rank}위</div>`;
  } else if (rank) {
    rankBadgeHtml = `<div class="cdg-rank-badge rank-${rank}">${rank}</div>`;
  }

  let cornerBadgeHtml = '';
  if (options.badge === 'GOLDEN') {
    cornerBadgeHtml = `<div class="cdg-corner-badge"><span class="cdg-badge-pink" style="background:linear-gradient(135deg, #f59e0b, #d97706);color:#fff;">GOLDEN</span></div>`;
  } else if (options.badge === 'NEW') {
    cornerBadgeHtml = `<div class="cdg-corner-badge"><span class="cdg-badge-pink">NEW</span></div>`;
  } else if (options.badge === 'FREE') {
    cornerBadgeHtml = `<div class="cdg-corner-badge"><span class="cdg-badge-pink" style="background:#10B981;">FREE</span></div>`;
  } else if (isAdult) {
    cornerBadgeHtml = `<div class="cdg-corner-badge"><span class="cdg-badge-dark" style="color:var(--cdg-pink);">19+</span></div>`;
  }

  let goldenReasonHtml = '';
  if (options.badge === 'GOLDEN' && w.goldenBest?.reason) {
    goldenReasonHtml = `<div class="cdg-card-golden-reason" title="최근 독자 반응 품질 기반 투명 추천">${escapeHtml(w.goldenBest.reason)}</div>`;
  }

  return `
    <article class="cdg-work-card ${options.badge === 'GOLDEN' ? 'cdg-card-golden' : ''}" onclick="openWorkDetailDirect('${workId}')" title="${escapeHtml(w.title)}">
      <div class="cdg-card-cover">
        <img class="cdg-card-cover-img" src="${cover}" alt="${escapeHtml(w.title)}" loading="lazy">
        ${rankBadgeHtml}
        ${cornerBadgeHtml}
      </div>
      <div class="cdg-card-info">
        <span class="cdg-card-tag">${escapeHtml(w.genre || '웹소설')}</span>
        <h3 class="cdg-card-title">${escapeHtml(w.title)}</h3>
        <div class="cdg-card-meta">
          <span>${escapeHtml(authorName)}</span>
          <span><i data-lucide="eye" style="width:11px;height:11px;display:inline;vertical-align:middle;"></i> ${viewFormatted}</span>
        </div>
        ${goldenReasonHtml}
      </div>
    </article>
  `;
}

// 1. HERO / Featured Works Slider
function renderCdgHeroSlider(heroWorks) {
  const slider = document.getElementById('cdgHeroSlider');
  if (!slider) return;
  if (!heroWorks?.length) {
    if (cdgHeroInterval) clearInterval(cdgHeroInterval);
    slider.innerHTML = '<p class="text-muted">등록된 추천 작품이 없습니다.</p>';
    return;
  }

  if (cdgHeroInterval) {
    clearInterval(cdgHeroInterval);
    cdgHeroInterval = null;
  }

  const slidesHtml = heroWorks.map((w, index) => {
    const cover = escapeHtml(getWorkCover(w));
    const workId = /^[1-9]\d{0,18}$/.test(String(w.id)) ? String(w.id) : '';
    const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
    return `
      <div class="cdg-hero-slide ${index === 0 ? 'active' : ''}" data-hero-index="${index}">
        <div class="cdg-hero-bg" style="background-image: url('${cover}');"></div>
        <div class="cdg-hero-gradient"></div>
        <div class="cdg-hero-body">
          <div class="cdg-hero-badges">
            <span class="cdg-badge-pink">🔥 실시간 추천 TOP ${index + 1}</span>
            <span class="cdg-badge-dark">${escapeHtml(w.genre)}</span>
            ${isAdult ? '<span class="cdg-badge-dark" style="color:var(--cdg-pink);">19+ 성인</span>' : '<span class="cdg-badge-dark">100% 무료해금</span>'}
          </div>
          <h2 class="cdg-hero-title">${escapeHtml(w.title)}</h2>
          <p class="cdg-hero-desc">${escapeHtml(w.description || '광고를 시청하면 다음 회차가 100% 무료로 해금됩니다!')}</p>
          <div class="cdg-hero-actions">
            <button class="btn btn-primary" onclick="openWorkDetailDirect('${workId}')">
              <i data-lucide="play"></i> 지금 감상하기
            </button>
            <button class="btn btn-outline" onclick="openWorkDetailDirect('${workId}')">
              작품 정보
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const dotsHtml = `
    <div class="cdg-hero-dots">
      ${heroWorks.map((_, i) => `<span class="cdg-dot ${i === 0 ? 'active' : ''}" data-dot-index="${i}"></span>`).join('')}
    </div>
  `;

  slider.innerHTML = slidesHtml + dotsHtml;

  slider.querySelectorAll('.cdg-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(dot.dataset.dotIndex, 10);
      switchHeroSlide(idx);
    });
  });

  let currentHeroIdx = 0;
  function switchHeroSlide(targetIdx) {
    const slides = slider.querySelectorAll('.cdg-hero-slide');
    const dots = slider.querySelectorAll('.cdg-dot');
    if (!slides.length) return;
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));

    currentHeroIdx = (targetIdx + slides.length) % slides.length;
    slides[currentHeroIdx]?.classList.add('active');
    dots[currentHeroIdx]?.classList.add('active');
  }

  cdgHeroInterval = setInterval(() => {
    switchHeroSlide(currentHeroIdx + 1);
  }, 5000);
}

// 4. Genre Recommendation Renderer
function renderGenreRecommendations(selectedGenre = '전체') {
  const container = document.getElementById('genreWorksGrid');
  if (!container) return;

  let filtered = getPublishedWorks();
  if (selectedGenre !== '전체') {
    if (selectedGenre === '19+ 성인') {
      filtered = getPublishedWorks().filter(w => w.rating === 'AGE_19' || w.genre === '성인' || (Array.isArray(w.genre) && w.genre.includes('성인')));
    } else {
      filtered = getPublishedWorks().filter(w => {
        if (!w.genre) return false;
        if (Array.isArray(w.genre)) return w.genre.some(g => String(g).includes(selectedGenre));
        return String(w.genre).includes(selectedGenre);
      });
    }
  }

  if (!filtered || filtered.length === 0) {
    filtered = getPublishedWorks().slice(0, 4);
  }

  container.innerHTML = filtered.map(w => renderCdgWorkCardHtml(w)).join('');
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

// Main Home Works Orchestrator (CMS Curation Flags Driven)
window.applyHomeCuration = function(work) {
  const item=SAMPLE_WORKS.find(w=>String(w.id)===String(work.id));
  if(!item)return;
  for(const [stored,display] of [['is_top_recommended','isTopRecommended'],['is_popular_work','isPopularWork'],['is_new_work','isNewWork']]){
    if(typeof work[stored]==='boolean')item[stored]=item[display]=work[stored];
  }
  // Update only an existing public catalog entry; private CMS rows never enter the catalog.
  renderHomeWorks().catch(()=>{});
};
async function renderHomeWorks() {
  try {
    if (!getPublishedWorks() || getPublishedWorks().length === 0) {
      ['trendingWorksGrid', 'newWorksGrid', 'webtoonsGrid', 'completedWorksGrid', 'todayFreeGrid', 'genreWorksGrid', 'goldenBestWorksGrid'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="text-muted">표시할 작품이 없습니다.</p>';
      });
      renderCdgHeroSlider([]);
      return;
    }

    const isTop = (w) => !!(w.isTopRecommended || w.is_top_recommended);
    const isPopular = (w) => !!(w.isPopularWork || w.is_popular_work);
    const isNew = (w) => !!(w.isNewWork || w.is_new_work);
    const isComp = (w) => !!(w.isCompleted || w.is_completed);

    // 1. HERO Carousel
    const topRecommended = getPublishedWorks().filter(isTop);
    renderCdgHeroSlider(topRecommended);

    // 2. 🔥 지금 가장 많이 읽는 작품
    const trendingContainer = document.getElementById('trendingWorksGrid');
    if (trendingContainer) {
      const populars = getPublishedWorks().filter(isPopular);
      trendingContainer.innerHTML = populars.slice(0, 4).map((w, idx) => {
        return renderCdgWorkCardHtml(w, { rank: idx + 1 });
      }).join('') || '<p class="text-muted">등록된 인기 작품이 없습니다.</p>';
    }

    // 3. ✨ 새로운 작품 (가장 최근 작가가 등록한 최신 신작 우선 정렬)
    const newWorksContainer = document.getElementById('newWorksGrid');
    if (newWorksContainer) {
      const sortedByNewest = [...getPublishedWorks()].sort((a, b) => {
        const timeA = new Date(a.createdAt || a.created_at || 0).getTime() || Number(a.id) || 0;
        const timeB = new Date(b.createdAt || b.created_at || 0).getTime() || Number(b.id) || 0;
        return timeB - timeA;
      });

      const news = sortedByNewest.filter(isNew);
      newWorksContainer.innerHTML = news.slice(0, 4).map(w => {
        return renderCdgWorkCardHtml(w, { badge: 'NEW' });
      }).join('') || '<p class="text-muted">등록된 신작이 없습니다.</p>';
    }

    // 4. 장르별 추천 (기본: 전체)
    renderGenreRecommendations('전체');
    await renderGoldenBest();

    // 5. 🎨 인기 웹툰
    const webtoonsContainer = document.getElementById('webtoonsGrid');
    if (webtoonsContainer) {
      const webtoons = getPublishedWorks().filter(w => w.contentType === 'WEBTOON' || w.content_type === 'WEBTOON');
      const list = webtoons;
      webtoonsContainer.innerHTML = list.map(w => renderCdgWorkCardHtml(w, { badge: 'NEW' })).join('');
    }

    // 6. 🏆 완결 명작 모음
    const completedContainer = document.getElementById('completedWorksGrid');
    if (completedContainer) {
      const completed = getPublishedWorks().filter(isComp);
      const list = completed;
      completedContainer.innerHTML = list.map(w => renderCdgWorkCardHtml(w, { badge: 'FREE' })).join('');
    }

    // 7. 오늘의 무료 작품
    const todayFreeContainer = document.getElementById('todayFreeGrid');
    if (todayFreeContainer) {
      const free4 = getPublishedWorks().filter(w => w.episodes?.some(ep => ep.isFree)).slice(0, 4);
      todayFreeContainer.innerHTML = free4.map(w => {
        return renderCdgWorkCardHtml(w, { badge: 'FREE' });
      }).join('');
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  } catch (error) {
    console.error('CDG PLAY 랜딩페이지 작품 로드 실패:', error);
  }
}



// --- 2. 탐색(Discover) & 다차원 복합 검색(Multi-dimensional Filter) ---

const DISCOVER_TAG_ALIASES = {
  '회귀': 'regression', '회귀물': 'regression',
  '빙의': 'possession', '빙의물': 'possession',
  '환생': 'reincarnation', '환생물': 'reincarnation',
  '착각계': 'misunderstanding',
  '사이다': 'catharsis',
  '아카데미': 'academy',
  '전문직': 'professional',
  '시스템': 'system',
  '게임': 'game', '게임빙의': 'game',
  '헌터': 'hunter',
  '던전': 'dungeon',
  '성장': 'growth',
  '생존': 'survival',
  '정치': 'politics',
  '전쟁': 'war',
  '로맨스': 'romance',
  '로맨스판타지': 'romance-fantasy', '로판': 'romance-fantasy',
  '무협': 'martial-arts',
  '현대판타지': 'modern-fantasy', '현판': 'modern-fantasy',
  '힐링': 'healing',
  '미스터리': 'mystery',
  '공포': 'horror',
  'SF': 'sf',
  '일상': 'slice-of-life',
  '코미디': 'comedy',
  '복수': 'revenge',
  '육아': 'family',
  '요리': 'chef',
  '스포츠': 'sports',
  '의학': 'medical',
  '경영': 'business',
  '대체역사': 'historical'
};

const discoverFilterState = {
  genre: 'ALL',
  status: 'ALL',       // 'ALL' | 'ONGOING' | 'COMPLETED'
  epRange: 'ALL',      // 'ALL' | '1-25' | '26-100' | '101+'
  rating: 'ALL',       // 'ALL' | 'ALL_AGES' | 'AGE_15' | 'AGE_19'
  sortBy: 'latest',    // 'latest' | 'popular' | 'views' | 'episodes'
  tags: new Set()
};

let discoverRenderDebounceTimer = null;

function getDiscoverTags(work) {
  let raw = [];
  if (Array.isArray(work.tags)) {
    raw = work.tags;
  } else if (typeof work.tags === 'string') {
    try {
      const parsed = JSON.parse(work.tags);
      raw = Array.isArray(parsed) ? parsed : work.tags.split(',');
    } catch(_) {
      raw = work.tags.split(',');
    }
  }
  return raw.map((tag) => {
    const t = String(tag).trim();
    return DISCOVER_TAG_ALIASES[t] || t.toLowerCase();
  });
}

function scheduleDiscoverRender() {
  if (discoverRenderDebounceTimer) clearTimeout(discoverRenderDebounceTimer);
  discoverRenderDebounceTimer = setTimeout(() => {
    renderDiscoverWorks();
  }, 200);
}

window.setDiscoverGenreFilter = function(genre, buttonEl) {
  discoverFilterState.genre = genre;
  document.querySelectorAll('#discoverGenreFilters .pill').forEach(btn => btn.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
  scheduleDiscoverRender();
};

window.setDiscoverStatus = function(status, buttonEl) {
  discoverFilterState.status = status;
  document.querySelectorAll('#filterStatusGroup .filter-chip').forEach(btn => btn.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
  scheduleDiscoverRender();
};

window.setDiscoverEpisodeRange = function(range, buttonEl) {
  discoverFilterState.epRange = range;
  document.querySelectorAll('#filterEpRangeGroup .filter-chip').forEach(btn => btn.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
  scheduleDiscoverRender();
};

window.setDiscoverRating = function(rating, buttonEl) {
  discoverFilterState.rating = rating;
  document.querySelectorAll('#filterRatingGroup .filter-chip').forEach(btn => btn.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
  scheduleDiscoverRender();
};

window.setDiscoverSortOrder = function(sortOrder) {
  discoverFilterState.sortBy = sortOrder;
  scheduleDiscoverRender();
};

window.toggleDiscoverTag = function(tag) {
  if (discoverFilterState.tags.has(tag)) {
    discoverFilterState.tags.delete(tag);
  } else {
    discoverFilterState.tags.add(tag);
  }
  
  document.querySelectorAll('#discoverTagFilters [data-discover-tag]').forEach((button) => {
    button.classList.toggle('active', discoverFilterState.tags.has(button.dataset.discoverTag));
  });
  
  const counter = document.getElementById('activeTagsCounter');
  if (counter) {
    counter.textContent = `선택된 태그: ${discoverFilterState.tags.size}개`;
  }
  
  scheduleDiscoverRender();
};

window.resetDiscoverFilters = function() {
  discoverFilterState.genre = 'ALL';
  discoverFilterState.status = 'ALL';
  discoverFilterState.epRange = 'ALL';
  discoverFilterState.rating = 'ALL';
  discoverFilterState.sortBy = 'latest';
  discoverFilterState.tags.clear();

  document.querySelectorAll('#discoverGenreFilters .pill').forEach((btn, idx) => btn.classList.toggle('active', idx === 0));
  document.querySelectorAll('#filterStatusGroup .filter-chip').forEach((btn) => btn.classList.toggle('active', btn.dataset.status === 'ALL'));
  document.querySelectorAll('#filterEpRangeGroup .filter-chip').forEach((btn) => btn.classList.toggle('active', btn.dataset.eprange === 'ALL'));
  document.querySelectorAll('#filterRatingGroup .filter-chip').forEach((btn) => btn.classList.toggle('active', btn.dataset.rating === 'ALL'));
  
  const sortSelect = document.getElementById('selectDiscoverSort');
  if (sortSelect) sortSelect.value = 'latest';

  document.querySelectorAll('#discoverTagFilters [data-discover-tag]').forEach((btn) => btn.classList.remove('active'));
  const counter = document.getElementById('activeTagsCounter');
  if (counter) counter.textContent = '선택된 태그: 0개';

  renderDiscoverWorks();
};

async function renderGoldenBest() {
  const container = document.getElementById('goldenBestWorksGrid');
  if (!container) return;
  if (window.ReaderHub?.active()) {
    document.getElementById('goldenBestSection').style.display = 'none';
    return;
  }
  let works = [];
  try {
    if (window.WebNovelsAdmin?.fetchGoldenBestFromDB) works = await window.WebNovelsAdmin.fetchGoldenBestFromDB();
  } catch (_) {}
  const publicWorks = getPublishedWorks();
  works = works.flatMap(row => {
    const work = publicWorks.find(item => String(item.id) === String(row.id));
    return work ? [{ ...work, goldenBest: row.goldenBest }] : [];
  });
  container.innerHTML = works.slice(0, 6).map((work) => renderCdgWorkCardHtml(work, { rank: work.goldenBest?.rank, badge: 'GOLDEN' })).join('') || '<p class="text-muted">집계된 추천 데이터가 없습니다.</p>';
  if (window.lucide?.createIcons) window.lucide.createIcons({ root: container });
}

// ----------------------------------------------------
// Discover Works View Renderer (다차원 필터링 연동)
// ----------------------------------------------------
function renderDiscoverWorks(explicitGenre = null) {
  const container = document.getElementById('discoverWorksGrid');
  if (!container) return;

  if (explicitGenre && explicitGenre !== 'undefined') {
    discoverFilterState.genre = explicitGenre;
    document.querySelectorAll('#discoverGenreFilters .pill').forEach(btn => {
      btn.classList.toggle('active', btn.textContent.trim() === explicitGenre);
    });
  }

  const { genre, status, epRange, rating, sortBy, tags } = discoverFilterState;

  let filtered = getPublishedWorks().filter(w => {
    // 1. Genre filter
    if (genre !== 'ALL' && genre !== '전체') {
      if (genre === '19+ 성인') {
        const is19 = w.rating === 'AGE_19' || w.genre === '성인' || (Array.isArray(w.genre) && w.genre.includes('성인'));
        if (!is19) return false;
      } else {
        const gStr = Array.isArray(w.genre) ? w.genre.join(' ') : (w.genre || '');
        if (!gStr.includes(genre)) return false;
      }
    }

    // 2. Status filter
    if (status === 'ONGOING') {
      if (w.isCompleted || w.is_completed || w.status === 'COMPLETED') return false;
    } else if (status === 'COMPLETED') {
      if (!(w.isCompleted || w.is_completed || w.status === 'COMPLETED')) return false;
    }

    // 3. Episode Range filter
    const epCount = (w.episodes && w.episodes.length) ? w.episodes.length : (Number(w.episodeCount ?? w.episode_count ?? 1));
    if (epRange === '1-25') {
      if (epCount < 1 || epCount > 25) return false;
    } else if (epRange === '26-100') {
      if (epCount < 26 || epCount > 100) return false;
    } else if (epRange === '101+') {
      if (epCount < 101) return false;
    }

    // 4. Rating filter
    if (rating === 'ALL_AGES') {
      if (w.rating && w.rating !== 'ALL' && w.rating !== '전체이용가') return false;
    } else if (rating === 'AGE_15') {
      if (w.rating !== 'AGE_15' && w.rating !== '15' && w.rating !== '15세 이상') return false;
    } else if (rating === 'AGE_19') {
      const isAdult = w.rating === 'AGE_19' || w.rating === '19' || w.genre === '성인' || (Array.isArray(w.genre) && w.genre.includes('성인'));
      if (!isAdult) return false;
    }

    // 5. Multi-tag AND Intersection filter
    if (tags.size > 0) {
      const workTags = getDiscoverTags(w);
      const allMatched = [...tags].every(t => workTags.includes(t));
      if (!allMatched) return false;
    }

    return true;
  });

  // 6. Sorting
  if (sortBy === 'popular') {
    filtered.sort((a, b) => Number(b.likeCount ?? b.like_count ?? 0) - Number(a.likeCount ?? a.like_count ?? 0));
  } else if (sortBy === 'views') {
    filtered.sort((a, b) => Number(b.viewCount ?? b.view_count ?? 0) - Number(a.viewCount ?? a.view_count ?? 0));
  } else if (sortBy === 'episodes') {
    filtered.sort((a, b) => ((b.episodes || []).length || Number(b.episodeCount ?? 0)) - ((a.episodes || []).length || Number(a.episodeCount ?? 0)));
  } else {
    // latest
    filtered.sort((a, b) => BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0);
  }

  // Update Result Count
  const counter = document.getElementById('discoverResultsCount');
  if (counter) {
    counter.textContent = `총 ${filtered.length}개 작품`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="discover-empty-state" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
        <i data-lucide="filter-x" style="width: 48px; height: 48px; color: #64748b; margin-bottom: 12px; display: inline-block;"></i>
        <h4 style="color: #cbd5e1; margin-bottom: 6px;">선택한 조건에 일치하는 작품이 없습니다</h4>
        <p class="text-muted small mb-4">태그나 필터 조건을 변경하거나 초기화해 보세요.</p>
        <button type="button" class="btn btn-outline btn-sm" onclick="resetDiscoverFilters()">
          <i data-lucide="rotate-ccw"></i> 필터 전체 초기화
        </button>
      </div>
    `;
  } else {
    container.innerHTML = filtered.map(w => {
      const isAdult = w.rating === 'AGE_19' || w.genre === '성인' || (Array.isArray(w.genre) && w.genre.includes('성인'));
      const tagClass = isAdult ? 'tag-solid style-danger' : 'tag-outline';
      const tagText = isAdult ? '19+ 성인' : (Array.isArray(w.genre) ? w.genre[0] : (w.genre || '판타지'));
      const cover = escapeHtml(getWorkCover(w));
      const rawViews = Number(w.viewCount ?? w.view_count ?? 0);
      const viewFormatted = rawViews >= 1000 ? `${(rawViews / 1000).toFixed(1)}K` : `${rawViews}회`;
      const epCount = (w.episodes && w.episodes.length) ? w.episodes.length : (Number(w.episodeCount ?? w.episode_count ?? 1));
      const isCompleted = !!(w.isCompleted || w.is_completed || w.status === 'COMPLETED');
      const statusBadge = isCompleted ? `<span class="badge-status completed" style="background:rgba(16,185,129,0.85);color:#fff;font-size:0.7rem;padding:2px 6px;border-radius:4px;">완결</span>` : `<span class="badge-status ongoing" style="background:rgba(99,102,241,0.85);color:#fff;font-size:0.7rem;padding:2px 6px;border-radius:4px;">${epCount}화</span>`;

      return `
        <article class="feature-card cdg-discover-card" onclick="openWorkDetailDirect('${w.id}')" style="cursor:pointer;">
          <div class="art" style="background-image: url('${cover}'); background-size: cover; background-position: center; height: 180px; border-radius: 8px; position: relative;">
            <div style="position: absolute; top: 8px; right: 8px;">${statusBadge}</div>
          </div>
          <div class="copy p-2">
            <div style="display:flex; gap:4px; margin-bottom:4px;">
              <span class="tag ${tagClass}">${escapeHtml(tagText)}</span>
            </div>
            <h3 style="font-size: 0.95rem; margin: 4px 0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(w.title)}</h3>
            <p class="text-muted small" style="margin:0;">${escapeHtml(getAuthorName(w))} · 조회 ${viewFormatted}</p>
          </div>
        </article>
      `;
    }).join('');
  }

  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons({ root: container });
}

// ----------------------------------------------------
// Global Search Results Renderer
// ----------------------------------------------------
function renderSearchResults(query = '') {
  const container = document.getElementById('searchResults');
  if (!container) return;

  const normalized = normalizeSearchText(query);
  let results = getPublishedWorks().filter(work => {
    if (!normalized) return true;
    const haystack = normalizeSearchText(`${work.title} ${work.author} ${work.genre} ${work.description}`);
    return haystack.includes(normalized);
  });

  const sort = document.getElementById('searchSortSelect')?.value || 'popular';
  if (sort === 'popular') {
    results = results.sort((a, b) => b.viewCount - a.viewCount);
  } else if (sort === 'title') {
    results = results.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  } else {
    results = results.sort((a, b) => BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0);
  }

  if (results.length === 0) {
    const fallback = getPublishedWorks().slice().sort((a, b) => b.viewCount - a.viewCount).slice(0, 3);
    container.innerHTML = `
      <div class="empty-search p-4 text-center text-muted">
        <h4>검색 결과가 없습니다</h4>
        <p class="small">띄어쓰기를 줄이거나 장르명으로 다시 검색해 보세요.</p>
      </div>
      ${fallback.map(renderSearchResultItem).join('')}
    `;
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    return;
  }

  container.innerHTML = results.slice(0, 8).map(renderSearchResultItem).join('');
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

function renderSearchResultItem(work) {
  const isAdult = work.rating === 'AGE_19' || work.genre === '성인';
  const cover = escapeHtml(getWorkCover(work));
  const workId = /^[1-9]\d{0,18}$/.test(String(work.id)) ? String(work.id) : '';
  return `
    <button class="search-result-item glass-panel p-2 mb-2 flex-between" onclick="closeAllModals(); openWorkDetailDirect('${workId}');" style="width: 100%; border-radius: 8px; text-align: left; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); color: #fff;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <img src="${cover}" alt="${escapeHtml(work.title)}" style="width: 40px; height: 52px; object-fit: cover; border-radius: 4px;">
        <div>
          <strong>${escapeHtml(work.title)}</strong>
          <div class="text-muted small">${escapeHtml(getAuthorName(work))} · ${escapeHtml(isAdult ? '19+ 성인' : work.genre)} · 조회 ${(work.viewCount / 1000).toFixed(1)}K</div>
        </div>
      </div>
      <i data-lucide="chevron-right"></i>
    </button>
  `;
}

function normalizeSearchText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}



// --- 3. 내 서재(Library) & 관심작품/구독작가/독서기록 ---

async function saveReadingProgress(workId, epNum, progress = 0) {
  if (window.ReaderHub?.active()) {
    const episode=activeWork?.episodes?.find(e=>Number(e.episodeNumber)===Number(epNum));
    if(!episode||!window.WebNovelsAuth?.getActor()?.reader)return;
    try { await window.ReaderHub.change('progress',{workId,episodeId:episode.id},{progress}); }
    catch(error){ console.warn('독서 이력 저장 실패',error); }
    return;
  }
  const user = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  if (!user) return;
  const key = user.username || user.email || user.id;
  const result = await window.WebNovelsAdmin?.recordReadingProgressInDB(key, workId, epNum, progress);
  if (!result?.success) return;
  try { syncUserActivityToStorage(await window.WebNovelsAdmin.fetchReaderActivity(key)); } catch (error) { console.warn('독서 이력 조회 실패', error); }
}

async function toggleFavoriteWork(workId) {
  if (window.ReaderHub?.active()) {
    try {
      const activity=await window.ReaderHub.activity();
      const adding=!activity.favorites.some(id=>String(id)===String(workId));
      await window.ReaderHub.change('favorite',{workId},{enabled:adding});
      updateFavoriteButtons(workId);
      showToast(adding?'관심 작품에 등록했습니다.':'관심 작품에서 해제했습니다.');
    } catch {showToast('관심 작품 변경에 실패했습니다. 다시 로그인하거나 재시도해주세요.');}
    return;
  }
  try {
    const user = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (!user) return showToast('로그인이 필요합니다.');
    const key = user.username || user.email || user.id;
    const activity = await window.WebNovelsAdmin.fetchReaderActivity(key);
    const adding = !activity.favorites.includes(Number(workId));
    const result = await window.WebNovelsAdmin.toggleFavoriteInDB(key, workId, adding);
    if (!result?.success) throw new Error(result?.error || '저장 실패');
    syncUserActivityToStorage(await window.WebNovelsAdmin.fetchReaderActivity(key));
    updateFavoriteButtons(workId);
    showToast(adding ? '관심 작품에 등록했습니다.' : '관심 작품에서 해제했습니다.');
  } catch (error) { showToast('관심 작품 변경 실패: ' + error.message); }
}
window.toggleFavoriteWork = toggleFavoriteWork;

function updateFavoriteButtons(workId) {
  const favs = window.ReaderHub?.active()
    ? (window.ReaderHub.cached?.favorites||[])
    : JSON.parse(localStorage.getItem('webnovels_favorites') || '[]');
  const isFav = favs.some(id=>String(id)===String(workId));
  const btnDetailFav = document.getElementById('btnDetailFavorite');
  const btnStickyFav = document.getElementById('btnStickyHeart');

  if (btnDetailFav) {
    btnDetailFav.innerHTML = isFav 
      ? '<i data-lucide="heart" style="fill: #ef4444; color: #ef4444;"></i> 관심등록 완료' 
      : '<i data-lucide="heart"></i> 관심등록';
  }
  if (btnStickyFav) {
    btnStickyFav.innerHTML = isFav 
      ? '<i data-lucide="heart" style="fill: #ef4444; color: #ef4444;"></i>' 
      : '<i data-lucide="heart"></i>';
  }
  if (window.lucide) window.lucide.createIcons();
}

async function toggleSubscribeAuthor(authorData) {
  if (window.ReaderHub?.active()) {
    const work=typeof authorData==='object'&&authorData?.authorId?authorData:activeWork;
    if(!work?.authorId)return showToast('작가 ID를 확인할 수 없습니다.');
    try {
      const activity=await window.ReaderHub.activity();
      const adding=!activity.subscriptions.some(s=>String(s.authorId)===String(work.authorId));
      await window.ReaderHub.change('subscribe',{workId:work.id},{enabled:adding});
      updateSubscribeButtons(work);
      showToast(adding?'작가를 구독했습니다.':'구독을 취소했습니다.');
    } catch {showToast('구독 변경에 실패했습니다. 다시 시도해주세요.');}
    return;
  }
  try {
    const user = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (!user) return showToast('로그인이 필요합니다.');
    const name = typeof authorData === 'object' ? authorData.penName || authorData.pen_name || authorData.author : authorData;
    const key = user.username || user.email || user.id;
    const activity = await window.WebNovelsAdmin.fetchReaderActivity(key);
    const adding = !activity.subscribedAuthors.includes(name);
    const result = await window.WebNovelsAdmin.toggleSubscriptionInDB(key, name, adding);
    if (!result?.success) throw new Error(result?.error || '저장 실패');
    syncUserActivityToStorage(await window.WebNovelsAdmin.fetchReaderActivity(key));
    updateSubscribeButtons(name);
    showToast(adding ? '작가를 구독했습니다.' : '구독을 취소했습니다.');
  } catch (error) { showToast('작가 구독 변경 실패: ' + error.message); }
}
window.toggleSubscribeAuthor = toggleSubscribeAuthor;

function updateSubscribeButtons(authorData) {
  const authorName = (typeof authorData === 'object' ? (authorData.penName || authorData.pen_name || authorData.name) : authorData) || '작자미상';
  const subAuthors = JSON.parse((localStorage.getItem('webnovels_subscribed_creators') || localStorage.getItem('webnovels_subscribed_authors')) || '[]');
  const isSubbed = window.ReaderHub?.active()
    ? (window.ReaderHub.cached?.subscriptions||[]).some(s=>String(s.authorId)===String(authorData?.authorId||activeWork?.authorId))
    : subAuthors.includes(authorName);
  const btnSub = document.getElementById('btnDetailSubscribe');

  if (btnSub) {
    btnSub.innerHTML = isSubbed
      ? '<i data-lucide="user-check" style="color: var(--primary-color);"></i> 작가 구독중'
      : '<i data-lucide="user-plus"></i> 작가 구독';
  }
  if (window.lucide) window.lucide.createIcons();
}

// 구독 작가 클릭 시 해당 작가의 모든 연재 소설 리스트를 모달로 표시
window.openAuthorWorksDirect = function(authorName) {
  const matchedWorks = getPublishedWorks().filter(w => {
    const aName = (typeof w.author === 'object' ? (w.author.penName || w.author.pen_name) : w.author) || '';
    return aName.toLowerCase() === String(authorName).toLowerCase();
  });

  // 해당 작가로 등록된 작품이 있으면 표시하고, 없으면 전체 연재작 중 관련 작품 매핑
  let worksToShow = [...matchedWorks];
  // 모달 헤더 정보 업데이트
  const avatarEl = document.getElementById('modalAuthorAvatar');
  const nameEl = document.getElementById('modalAuthorName');
  const statsEl = document.getElementById('modalAuthorStats');
  const listContainer = document.getElementById('modalAuthorWorksList');

  if (avatarEl) avatarEl.textContent = authorName.slice(0, 1);
  if (nameEl) nameEl.textContent = `${authorName} 작가님의 연재 소설 목록`;
  if (statsEl) statsEl.textContent = `총 ${worksToShow.length}개 작품 연재 중 · 작가 구독 중`;

  if (listContainer) {
    listContainer.innerHTML = worksToShow.map((work) => {
      const cover = escapeHtml(getWorkCover(work));
      const epCount = work.episodes?.length || 0;
      return `
        <div class="author-work-item glass-panel" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 14px; flex: 1;">
            <img src="${cover}" alt="${escapeHtml(work.title)} 표지" style="width: 56px; height: 76px; object-fit: cover; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
            <div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span class="badge badge-accent" style="font-size: 0.75rem;">${escapeHtml(work.genre || '판타지')}</span>
                <span class="badge" style="font-size: 0.72rem; background: rgba(255,255,255,0.08); color: #fff;">총 ${epCount}화 연재</span>
              </div>
              <h4 style="margin: 0 0 4px; font-size: 1.05rem; color: #fff; font-weight: 700;">${escapeHtml(work.title)}</h4>
              <p class="text-muted small" style="margin: 0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; max-width: 320px;">
                ${escapeHtml(work.description || '작품 소개글이 준비 중입니다.')}
              </p>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="closeAllModals(); openWorkDetailDirect(${work.id});" style="white-space: nowrap; margin-left: 12px; padding: 8px 14px;">
            작품 읽기 <i data-lucide="chevron-right"></i>
          </button>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
  openModal('modalAuthorWorks');
};

async function renderLibraryContent(skipRemote = false) {
  const appealTab=document.querySelector('[data-library-tab="appeals"]');
  if(appealTab)appealTab.hidden=!(window.WebNovelsAppeals?.active()&&window.WebNovelsAuth?.getActor()?.reader);
  const continueContainer = document.getElementById('libraryContinueList');
  const favoriteContainer = document.getElementById('libraryFavoritesList');
  const authorContainer = document.getElementById('libraryCreatorsList') || document.getElementById('libraryAuthorsList');
  const statReadingEl = document.getElementById('statReadingCount');
  const statFavEl = document.getElementById('statFavoriteCount');
  const statAuthorEl = document.getElementById('statCreatorCount') || document.getElementById('statAuthorCount');

  let savedUser = null;
  try {
    savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  } catch (e) {}

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]');
  } catch (e) {
    history = [];
  }

  let favs = [];
  try {
    favs = JSON.parse(localStorage.getItem('webnovels_favorites') || '[]');
  } catch (e) {
    favs = [];
  }

  let subAuthors = [];
  try {
    subAuthors = JSON.parse((localStorage.getItem('webnovels_subscribed_creators') || localStorage.getItem('webnovels_subscribed_authors')) || '[]');
  } catch (e) {
    subAuthors = [];
  }

  if (window.ReaderHub?.active()) {
    history=[];favs=[];subAuthors=[];
    if (window.WebNovelsAuth?.getActor()?.reader) try {
      const remote=await window.ReaderHub.activity(!skipRemote);
      history=remote.readingHistory||[];
      favs=(remote.favorites||[]).map(String);
      subAuthors=(remote.subscriptions||[]).map(s=>s.name);
    } catch {showToast('서재 데이터를 불러오지 못했습니다. 다시 시도해주세요.');}
  }
  // Legacy path remains until the stage 10 direct-DB cutover.
  else if (!skipRemote && savedUser && window.WebNovelsAdmin?.fetchReaderActivity && !window._isFetchingLibrary) {
    window._isFetchingLibrary = true;
    try {
      const userIdent = savedUser.username || savedUser.email || savedUser.id;
      const remote = await window.WebNovelsAdmin.fetchReaderActivity(userIdent);
      if (remote && typeof syncUserActivityToStorage === 'function') {
        syncUserActivityToStorage(remote);
        try {
          history = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]');
          favs = JSON.parse(localStorage.getItem('webnovels_favorites') || '[]').map(Number);
          subAuthors = JSON.parse((localStorage.getItem('webnovels_subscribed_creators') || localStorage.getItem('webnovels_subscribed_authors')) || '[]');
        } catch(e) {}
      }
    } catch (err) {
      console.warn('[renderLibraryContent Remote Fetch Error]', err);
      history = []; favs = []; subAuthors = [];
      showToast('서재 데이터를 불러오지 못했습니다. 다시 시도해 주세요.');
    } finally {
      window._isFetchingLibrary = false;
    }
  }

  if (window.ReaderHub?.active()?!window.WebNovelsAuth?.getActor()?.reader:!savedUser) {
    history = []; favs = []; subAuthors = [];
  }

  // 좌측 프로필 통계 숫자 실시간 반영
  if (statReadingEl) statReadingEl.textContent = String(history.length);
  if (statFavEl) statFavEl.textContent = String(favs.length);
  if (statAuthorEl) statAuthorEl.textContent = String(subAuthors.length);

  // 1. 실제 읽었던 실시간 내역 렌더링 (진행도 % 및 프로그레스 바 적용)
  if (continueContainer) {
    if (history.length > 0) {
      const validHistoryItems = history.map(item => {
        const work = getPublishedWorks().find(w => String(w.id) === String(item.workId));
        if (!work) return null;
        const totalEps = work.episodes?.length || 0;
        const readEpNum = Number(item.episodeNumber) || 1;
        const pct = Math.min(100, Math.round((readEpNum / totalEps) * 100));
        const cover = escapeHtml(getWorkCover(work));
        return { work, totalEps, readEpNum, pct, cover };
      }).filter(Boolean);

      if (validHistoryItems.length > 0) {
        const topItem = validHistoryItems[0];
        const restItems = validHistoryItems.slice(1);

        let html = `
          <!-- 최신 읽은 대표 작품 (상단 하이라이트 카드) -->
          <div class="library-reading-card glass-panel mb-4" style="border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); border-radius: 14px; margin-bottom: 16px;">
            <img src="${topItem.cover}" alt="${escapeHtml(topItem.work.title)} 표지">
            <div>
              <span class="badge badge-accent" style="font-weight: 600;">${topItem.pct}% 읽음</span>
              <h3 style="margin: 6px 0 4px; font-size: 1.15rem; color: #fff;">${escapeHtml(topItem.work.title)}</h3>
              <p class="text-muted small" style="margin-bottom: 10px;">
                제 ${topItem.readEpNum}화 읽는 중 (총 ${topItem.totalEps}화) · ${escapeHtml(topItem.work.genre)}
              </p>
              <div class="progress-bar-bg" style="height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); overflow: hidden; width: 100%;">
                <div class="progress-bar-fill" style="width: ${topItem.pct}%; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #6D5EF5 0%, #8B5CF6 50%, #25D1FF 100%); box-shadow: 0 0 12px rgba(109, 94, 245, 0.7);"></div>
              </div>
            </div>
            <button class="btn btn-primary" onclick="openReaderDirect('${topItem.work.id}', ${topItem.readEpNum})" style="white-space: nowrap;">
              계속 읽기 <i data-lucide="chevron-right"></i>
            </button>
          </div>
        `;

        // 2번째 이후의 읽은 작품 목록
        if (restItems.length > 0) {
          html += `
            <div class="rest-history-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${restItems.map(item => `
                <button class="library-row" onclick="openReaderDirect('${item.work.id}', ${item.readEpNum})" style="display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; padding: 12px 14px; border-radius: 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); cursor: pointer; transition: all 0.2s;">
                  <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <img src="${item.cover}" alt="${escapeHtml(item.work.title)} 표지" style="width: 48px; height: 64px; object-fit: cover; border-radius: 6px;">
                    <div style="flex: 1; max-width: 400px;">
                      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                        <strong style="font-size: 0.95rem; color: #fff;">${escapeHtml(item.work.title)}</strong>
                        <span class="badge" style="font-size: 0.75rem; padding: 2px 6px; background: rgba(109, 94, 245, 0.2); color: #a5b4fc;">${item.pct}%</span>
                      </div>
                      <small class="text-muted" style="display: block; font-size: 0.82rem; margin-bottom: 6px;">
                        제 ${item.readEpNum}화 읽는 중 · ${escapeHtml(item.work.genre)}
                      </small>
                      <div class="progress-bar-bg" style="height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); width: 100%; overflow: hidden;">
                        <div class="progress-bar-fill" style="width: ${item.pct}%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #6D5EF5, #818cf8, #25D1FF);"></div>
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px; color: var(--primary-color); font-weight: 500; font-size: 0.9rem; margin-left: 12px;">
                    <span>이어보기</span>
                    <i data-lucide="play-circle"></i>
                  </div>
                </button>
              `).join('')}
            </div>
          `;
        }

        continueContainer.innerHTML = html;
      } else {
        continueContainer.innerHTML = `
          <div class="p-6 text-center text-muted" style="background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; padding: 28px;">
            <i data-lucide="book-open" style="width: 36px; height: 36px; margin-bottom: 8px; opacity: 0.6;"></i>
            <p style="margin: 0; font-size: 1rem; color: #fff;">아직 읽은 작품이 없습니다.</p>
            <small class="text-muted">웹소설 회차를 감상하면 이곳에 실시간으로 기록됩니다.</small>
          </div>
        `;
      }
    } else {
      continueContainer.innerHTML = `
        <div class="p-6 text-center text-muted" style="background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; padding: 28px;">
          <i data-lucide="book-open" style="width: 36px; height: 36px; margin-bottom: 8px; opacity: 0.6;"></i>
          <p style="margin: 0; font-size: 1rem; color: #fff;">아직 읽은 작품이 없습니다.</p>
          <small class="text-muted">웹소설 회차를 감상하면 이곳에 실시간으로 기록됩니다.</small>
        </div>
      `;
    }
  }

  // 2. 관심 작품 실시간 렌더링
  if (favoriteContainer) {
    if (favs.length > 0) {
      const favWorks = getPublishedWorks().filter(w => favs.some(id => String(id) === String(w.id)));
      favoriteContainer.innerHTML = favWorks.map(work => {
        const cover = escapeHtml(getWorkCover(work));
        return `
          <button class="library-row" onclick="openWorkDetailDirect('${work.id}')" style="display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; padding: 12px; margin-bottom: 8px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); cursor: pointer; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${cover}" alt="${escapeHtml(work.title)} 표지" style="width: 52px; height: 68px; object-fit: cover; border-radius: 6px;">
              <div>
                <strong style="display: block; font-size: 1rem; color: #fff; margin-bottom: 4px;">${escapeHtml(work.title)}</strong>
                <small class="text-muted">${escapeHtml(work.author)} · ${escapeHtml(work.genre)}</small>
              </div>
            </div>
            <i data-lucide="chevron-right"></i>
          </button>
        `;
      }).join('');
    } else {
      favoriteContainer.innerHTML = `
        <div class="p-6 text-center text-muted" style="background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; padding: 28px;">
          <i data-lucide="heart" style="width: 36px; height: 36px; margin-bottom: 8px; opacity: 0.6;"></i>
          <p style="margin: 0; font-size: 1rem; color: #fff;">등록된 관심 작품이 없습니다.</p>
          <small class="text-muted">작품 상세페이지에서 '관심등록'을 눌러보세요.</small>
        </div>
      `;
    }
  }

  // 3. 실제 구독한 작가 목록 실시간 렌더링
  if (authorContainer) {
    if (subAuthors.length > 0) {
      const authorsData = subAuthors.map(aName => {
        const found = SAMPLE_AUTHORS.find(a => a.pen_name === aName);
        if (found) return found;
        const workFound = getPublishedWorks().find(w => {
          const wAuthor = typeof w.author === 'object' ? (w.author.penName || w.author.pen_name) : w.author;
          return wAuthor === aName;
        });
        return {
          pen_name: aName,
          work_title: workFound ? `대표작: ${workFound.title}` : '연재 작품 보유'
        };
      });

      authorContainer.innerHTML = authorsData.map(author => `
        <div class="library-author-card glass-panel" style="display: flex; flex-direction: column; justify-content: space-between; padding: 18px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px; width: 100%;">
            <div class="library-author-avatar" style="width: 42px; height: 42px; min-width: 42px; border-radius: 50%; background: linear-gradient(135deg, var(--primary-color), #818cf8); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.05rem; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">
              ${author.pen_name.slice(0, 1)}
            </div>
            <div style="flex: 1; min-width: 0; text-align: left;">
              <strong style="display: block; font-size: 1.05rem; color: #fff; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">
                ${author.pen_name}
              </strong>
              <small class="text-muted" style="display: block; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${author.work_title}
              </small>
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-sm w-full" onclick="openAuthorWorksDirect('${author.pen_name}')" style="display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 8px 14px; border-radius: 8px; background: rgba(109, 94, 245, 0.12); border: 1px solid rgba(109, 94, 245, 0.35); color: #a5b4fc; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;">
            <i data-lucide="book-open" style="width: 15px; height: 15px;"></i>
            <span>작품보기</span>
          </button>
        </div>
      `).join('');
    } else {
      authorContainer.innerHTML = `
        <div class="p-6 text-center text-muted" style="grid-column: 1 / -1; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; padding: 28px;">
          <i data-lucide="users" style="width: 36px; height: 36px; margin-bottom: 8px; opacity: 0.6;"></i>
          <p style="margin: 0; font-size: 1rem; color: #fff;">구독 중인 작가가 없습니다.</p>
          <small class="text-muted">작품 상세페이지에서 '작가 구독'을 눌러보세요.</small>
        </div>
      `;
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

// ============================================================


// --- 4. 작품 상세(Detail) & 웹소설/웹툰 독서 뷰어(Reader) ---

// [Section 2] Work Detail & Episode List View
//
// [Purpose]
// - 작품 상세 페이지 정보(표지, 제목, 작가, 장르, 연령가, 소개글, 관심등록/작가구독 상태) 렌더링
// - 1~6화 회차 목록(1~3화 무료 FREE, 4~6화 광고잠금) 및 7~10화 연재예정(Coming Soon) 표시
//
// [User Actions]
// - 첫 화 읽기 (`openReaderDirect(workId, 1)`)
// - 관심등록 토글 (`toggleFavoriteWork(workId)`)
// - 작가 구독 토글 (`toggleSubscribeAuthor(author)`)
// - 개별 회차 클릭 시 뷰어로 이동
// ============================================================
window.openWorkDetailDirect = function(workId, shouldPushState = true, didRefresh = false) {
  const targetId = String(workId);
  const work = getPublishedWorks().find(w => String(w.id) === targetId);
  if(!work&&window.ReaderHub?.active()&&!didRefresh) {
    refreshReaderCatalog(true).then(()=>openWorkDetailDirect(workId,shouldPushState,true))
      .catch(()=>showToast('공개 작품 목록을 확인할 수 없습니다.'));
    return;
  }
  if (!work) return showToast('작품을 찾을 수 없습니다.');
  activeWork = work;

  // 만약 회차가 없거나 비어있는 경우 1~6회차 기본 생성
  if (!work.episodes) work.episodes = [];

  const cover = getWorkCover(work);
  const authorName = (typeof work.author === 'object' ? work.author?.penName : work.author) || '작자미상';

  document.getElementById('detailCoverImg').src = cover;
  document.getElementById('detailTitle').textContent = work.title;
  document.getElementById('detailAuthor').textContent = `작가: ${authorName}`;
  document.getElementById('detailGenreBadge').textContent = work.genre;
  document.getElementById('detailRatingBadge').textContent = work.rating === 'ALL' ? '전체이용가' : '19세 이상 성인';
  document.getElementById('detailAiBadge').textContent = `AI ${work.aiUsageType}`;
  document.getElementById('detailDescription').textContent = work.description;

  // 관심등록 및 작가 구독 상태 버튼 업데이트
  updateFavoriteButtons(work.id);
  updateSubscribeButtons(work);

  // Render Episode List
  const epList = document.getElementById('detailEpisodeList');
  let epHtml = '';

  // 중복 회차 번호 제거 및 정렬
  const uniqueEpisodesMap = new Map();
  work.episodes.forEach(ep => {
    if (!uniqueEpisodesMap.has(ep.episodeNumber)) {
      uniqueEpisodesMap.set(ep.episodeNumber, ep);
    }
  });
  const sortedEpisodes = Array.from(uniqueEpisodesMap.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);

  // 1~6회차 (실제 연재 회차) 렌더링
  sortedEpisodes.forEach(ep => {
    const isUnlocked = ep.isFree || unlockedEpisodes.has(`${work.id}-${ep.episodeNumber}`);
    epHtml += `
      <div class="episode-row" onclick="openReaderDirect('${work.id}', ${ep.episodeNumber})" style="transition: background 0.2s ease;">
        <div class="ep-left">
          <span class="ep-number">${ep.episodeNumber}화</span>
          <span class="ep-title">${escapeHtml(ep.title)}</span>
        </div>
        <div class="ep-right">
          ${isUnlocked 
            ? '<span class="badge badge-accent">FREE (열람 가능)</span>' 
            : '<span class="badge badge-warning">열람 준비 중</span>'}
        </div>
      </div>
    `;
  });

  epList.innerHTML = epHtml || '<p class="text-muted">공개된 회차가 없습니다.</p>';
  switchWebNovelsView('view-work-detail', null, false);
  
  // 명예의 전당 (Top Supporters) 렌더링 (improve5.md)
  for (const id of ['btnDetailSupport','workTopSupportersWidget']) {
    const element=document.getElementById(id);
    if(element)element.style.display='none';
  }

  if (shouldPushState) {
    const targetUrl = `/works/${work.id}`;
    if (window.location.pathname !== targetUrl) {
      try { window.history.pushState({ path: targetUrl }, '', targetUrl); } catch (e) {}
    }
  }
};

// ============================================================
// [Step 5 - improve5.md] 독자 작가 후원 모달 및 작품 명예의 전당(Top Supporters)
// ============================================================
window.renderWorkTopSupporters = async function() {
  // 후원 원장과 검증된 이벤트가 활성화되기 전에는 순위를 표시하지 않는다.
};

window.supportActiveWork = function() {
  return showToast('후원 기능은 현재 사용할 수 없습니다.');
};

window.selectSupportAmount = function(amount) {
  const pts = Number(amount);
  document.querySelectorAll('.support-preset-btn').forEach(btn => {
    if (Number(btn.dataset.points) === pts) {
      btn.classList.add('btn-primary', 'active');
      btn.classList.remove('btn-outline');
    } else {
      btn.classList.remove('btn-primary', 'active');
      btn.classList.add('btn-outline');
    }
  });

  const customInput = document.getElementById('supportCustomAmount');
  if (customInput) customInput.value = pts;

  const btnText = document.getElementById('btnSupportSubmitText');
  if (btnText) btnText.textContent = `${pts.toLocaleString()}P 후원하기`;
};

window.handleSupportCustomInput = function(val) {
  const pts = Number(val) || 0;
  document.querySelectorAll('.support-preset-btn').forEach(btn => {
    if (Number(btn.dataset.points) === pts) {
      btn.classList.add('btn-primary', 'active');
      btn.classList.remove('btn-outline');
    } else {
      btn.classList.remove('btn-primary', 'active');
      btn.classList.add('btn-outline');
    }
  });

  const btnText = document.getElementById('btnSupportSubmitText');
  if (btnText) btnText.textContent = `${pts.toLocaleString()}P 후원하기`;
};

window.handleConfirmSupportSubmit = async function() {
  return showToast('후원 기능은 현재 사용할 수 없습니다.');
};

// 연재예정 회차 클릭 시 알림 핸들러
window.handleComingSoonEpisode = function(epNum) {
  if (window.showToast) {
    showToast(`🔒 제 ${epNum}화는 작가 연재 예정 (Coming Soon) 상태입니다.`);
  } else {
    alert(`🔒 제 ${epNum}화는 작가 연재 예정 (Coming Soon) 상태입니다.`);
  }
};

// ============================================================
// [Section 3] Web Novel & Webtoon Reader Engine (독서 뷰어) & Ad/Point Gate
// ============================================================
function escapeReaderHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

window.selectParagraphComment = function(paragraphIndex, quoteText, contentVersion) {
  window._paragraphComment = { paragraphIndex, quoteText: String(quoteText || '').slice(0, 300),
    paragraphText:String(quoteText||''),contentVersion };
  document.querySelectorAll('#readerBody .reader-paragraph').forEach((element) => element.classList.remove('is-comment-selected'));
  document.querySelector(`#readerBody [data-paragraph-index="${paragraphIndex}"]`)?.classList.add('is-comment-selected');
  if (window._currentReadingWorkId && window._currentReadingEpNum) {
    const episode = activeWork?.episodes?.find((item) => Number(item.episodeNumber) === Number(window._currentReadingEpNum));
    loadEpisodeComments(window._currentReadingWorkId, episode?.id || window._currentReadingEpNum);
  }
};

let readerCatalogFlight = null;
async function refreshReaderCatalog(force = false) {
  if (!window.WEBNOVELS_CONFIG?.authorPublishEnabled || !window.WebNovelsAdmin?.fetchWorksFromSupabase) return;
  if (readerCatalogFlight) return readerCatalogFlight;
  if (!force && Date.now() - (refreshReaderCatalog.lastAt || 0) < 30000) return;
  readerCatalogFlight = (async () => {
    const works = await window.WebNovelsAdmin.fetchWorksFromSupabase();
    if (!Array.isArray(works)) throw Error('PUBLIC_CATALOG_UNAVAILABLE');
    SAMPLE_WORKS.splice(0, SAMPLE_WORKS.length, ...works);
    refreshReaderCatalog.lastAt = Date.now();
    if (activeWork && !works.some(w => String(w.id)===String(activeWork.id) &&
        ['PUBLISHED','ONGOING','PAUSED','COMPLETED'].includes(w.status))) {
      activeWork=null;
      document.getElementById('readerBody')?.replaceChildren();
      if (currentActiveView==='view-reader') switchWebNovelsView('view-home');
    }
    if (currentActiveView==='view-home' && typeof renderHomeWorks==='function') renderHomeWorks();
    if (currentActiveView==='view-discover' && typeof renderDiscoverWorks==='function') renderDiscoverWorks();
    if (typeof renderSearchResults==='function')
      renderSearchResults(document.getElementById('globalSearchInput')?.value || '');
    if (currentActiveView==='view-work-detail' && activeWork && typeof openWorkDetailDirect==='function')
      openWorkDetailDirect(activeWork.id,false);
    return works;
  })();
  try { return await readerCatalogFlight; } finally { readerCatalogFlight = null; }
}
window.refreshReaderCatalog = refreshReaderCatalog;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshReaderCatalog().catch(() => {});
});

window.openReaderDirect = async function(workId, epNumber, shouldPushState = true) {
  if (window.WEBNOVELS_CONFIG?.authorPublishEnabled) {
    try { await refreshReaderCatalog(true); }
    catch { return showToast('공개 회차 목록을 갱신하지 못했습니다. 다시 시도해주세요.'); }
  }
  const targetWorkId = String(workId);
  const work = getPublishedWorks().find(w => String(w.id) === targetWorkId);
  if (!work) return showToast('작품을 찾을 수 없습니다.');
  activeWork = work;

  if (!work.episodes) work.episodes = [];

  const epNum = Number(epNumber);

  // 7회차 이상일 경우 연재예정 안내
  if (epNum >= 7 && !work.episodes.find(e => Number(e.episodeNumber) === epNum)) {
    handleComingSoonEpisode(epNum);
    return;
  }

  const ep = work.episodes.find(e => Number(e.episodeNumber) === epNum);
  if (!ep) return showToast('공개된 회차를 찾을 수 없습니다.');
  // 유료·성인 권한은 서버에서만 판정한다. 레거시 브라우저 해금·성인인증 캐시는 사용하지 않는다.
  const genres = Array.isArray(work.genre) ? work.genre : [work.genre];
  const isAdultWork = ['AGE_19', 'ADULT', '19'].includes(work.rating) ||
    genres.some(genre => ['성인', '19세 이상'].includes(genre));
  const accessPolicy = ep.accessPolicy ?? ep.access_policy;
  const protectedEpisode = isAdultWork || ep.isFree === false || ep.is_free === false ||
    (accessPolicy && accessPolicy !== 'FREE');
  if (protectedEpisode && !window.WEBNOVELS_CONFIG?.authorPublishEnabled) {
    return showToast('이 회차의 열람 기능은 현재 사용할 수 없습니다.');
  }

  activeEpisodeId = String(epNum);
  window._currentReadingWorkId = work.id;
  window._currentReadingEpNum = epNum;

  document.getElementById('readerWorkTitle').textContent = work.title;
  document.getElementById('readerEpTitle').textContent = ep.title;
  document.getElementById('readerHeading').textContent = `${ep.title} (${ep.episodeNumber}화)`;

  const authorCommentEl = document.getElementById('readerAuthorComment');

  // 3. 온디맨드 보안 회차 본문 로드 (episode_contents / episode_panels)
  let loadedText = null;
  let loadedPanels = [];

  if (window.WEBNOVELS_CONFIG?.authorPublishEnabled) {
    try {
      let response;
      if (window.WebNovelsAuth?.getActor()) response = await window.WebNovelsAuth.api('/api/v2/episodes/' + encodeURIComponent(ep.id) + '/content');
      else {
        const raw = await fetch('/api/v2/episodes/' + encodeURIComponent(ep.id) + '/content', {credentials:'omit'});
        if (!raw.ok) throw Error('READER_CONTENT_UNAVAILABLE');
        response = await raw.json();
      }
      loadedText = response.episode?.content;
      loadedPanels = response.episode?.image_urls || [];
      ep.authorComment = response.episode?.author_comment ?? ep.authorComment;
    } catch (error) {
      console.warn('[Secure Content Load]', error);
    }
  } else if (window.WebNovelsAdmin?.fetchEpisodeContentSecure) {
    try {
      const contentRes = await window.WebNovelsAdmin.fetchEpisodeContentSecure(ep.id, work.id, epNum);
      if (contentRes) {
        if (contentRes.textContent) loadedText = contentRes.textContent;
        if (contentRes.imageUrls && contentRes.imageUrls.length > 0) loadedPanels = contentRes.imageUrls;
      }
    } catch (e) {
      console.warn('[Secure Content Load]', e);
    }
  }

  if (!loadedText && !loadedPanels.length) {
    showToast('본문을 불러오지 못했습니다. 접근 권한 또는 연결 상태를 확인해 주세요.');
    return;
  }

  // 실시간 읽기 내역 저장 및 조회수 카운트
  saveReadingProgress(work.id, epNum);
  if (!window.ReaderHub?.active() && window.WebNovelsAdmin?.recordReaderEventInDB) {
    window.WebNovelsAdmin.recordReaderEventInDB(work.id, ep.id || epNum, 'OPEN', 0, `${ep.id || epNum}:${ep.updatedAt || ep.createdAt || 'v1'}`);
  }

  // 4. 웹툰 vs 웹소설 분기 렌더링
  const textBodyEl = document.getElementById('readerBody');
  const webtoonViewerEl = document.getElementById('readerWebtoonViewer');

  if (work.contentType === 'WEBTOON' || (loadedPanels && loadedPanels.length > 0)) {
    if (textBodyEl) textBodyEl.style.display = 'none';
    if (webtoonViewerEl) {
      webtoonViewerEl.style.display = 'block';
      const images = loadedPanels;
      webtoonViewerEl.innerHTML = images.map(imgSrc => `
        <div class="webtoon-cut" style="margin: 0 auto; max-width: 720px; text-align: center;">
          <img src="${imgSrc}" alt="${escapeHtml(work.title)} ${escapeHtml(ep.title)}" style="width: 100%; height: auto; display: block; margin-bottom: 2px; border-radius: 4px;" loading="lazy">
        </div>
      `).join('');
    }
  } else {
    if (webtoonViewerEl) webtoonViewerEl.style.display = 'none';
    if (textBodyEl) {
      textBodyEl.style.display = 'block';
      const contentVersion = `${ep.id || epNum}:${ep.updatedAt || ep.createdAt || 'v1'}`;
      window.ReaderContent.render(textBodyEl, authorCommentEl, {
        content: loadedText || '', authorComment: ep.authorComment || '', version: contentVersion
      }, (index, paragraph, version) => selectParagraphComment(index, paragraph, version));
    }
  }

  // 5. 이전 화 / 다음 화 버튼 동작 바인딩
  const btnPrev = document.getElementById('btnPrevEp');
  const btnNext = document.getElementById('btnNextEp');
  if (btnPrev) {
    btnPrev.disabled = epNum <= 1;
    btnPrev.onclick = () => openReaderDirect(work.id, epNum - 1);
  }
  if (btnNext) {
    btnNext.onclick = () => openReaderDirect(work.id, epNum + 1);
  }

  // 5. 회차별 독자 댓글 및 대댓글 렌더링 (실제 DB 연동)
  loadEpisodeComments(work.id, ep.id || epNum);

  // 6. 추천 작품 렌더링
  renderReaderRecommendations(work.id);

  // 7. 실시간 독서 스크롤 진행률 추적 (DB 실시간 동기화)
  if (window._readerScrollCleanup) window._readerScrollCleanup();
  let scrollTimeout = null;
  const onReaderScroll = () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const container = document.getElementById('view-reader');
      if (!container || container.classList.contains('hidden') || container.style.display === 'none') return;
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight <= 0) return;
      const currentScroll = window.scrollY;
      const pct = Math.min(100, Math.max(10, Math.round((currentScroll / totalHeight) * 100)));
      saveReadingProgress(work.id, epNum, pct);
      if (!window.ReaderHub?.active() && window.WebNovelsAdmin?.recordReaderEventInDB) {
        window.WebNovelsAdmin.recordReaderEventInDB(work.id, ep.id || epNum, pct >= 90 ? 'COMPLETE' : 'PROGRESS', pct, `${ep.id || epNum}:${ep.updatedAt || ep.createdAt || 'v1'}`);
      }
    }, 500);
  };
  window.addEventListener('scroll', onReaderScroll, { passive: true });
  window._readerScrollCleanup = () => window.removeEventListener('scroll', onReaderScroll);

  switchWebNovelsView('view-reader');
  window.ReaderPreferencesManager?.apply();
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (window.lucide) window.lucide.createIcons();
};

// 회차별 댓글 렌더링 (대댓글 트리 지원)
function renderReaderComments(workId, epNum) {
  const currentWork = (typeof activeWork !== 'undefined' && activeWork) ? activeWork : null;
  const targetEp = currentWork?.episodes?.find(e => Number(e.episodeNumber) === Number(epNum));
  loadEpisodeComments(workId, targetEp?.id || epNum);
}

// 독자 댓글 등록 (하위 호환)
window.submitReaderComment = function() {
  const workId = window._currentReadingWorkId || 1;
  const epNum = window._currentReadingEpNum || 1;
  const episode = activeWork?.episodes?.find(item => Number(item.episodeNumber) === Number(epNum));
  handleReaderCommentSubmit(workId, window.ReaderHub?.active() ? episode?.id : epNum);
};

// 댓글 공감/좋아요 토글
window.toggleCommentLike = function(commentKey, commentId) {
  const comments = COMMENTS_STORE[commentKey] || [];
  const target = comments.find(c => c.id === commentId);
  if (!target) return;

  target.liked = !target.liked;
  target.likes += target.liked ? 1 : -1;
  const countEl = document.getElementById(`likeCount_${commentId}`);
  if (countEl) countEl.textContent = target.likes;
  showToast(target.liked ? '💖 댓글에 공감했습니다.' : '공감을 취소했습니다.');
};

// 뷰어 하단 추천 작품 렌더링
function renderReaderRecommendations(currentWorkId) {
  const container = document.getElementById('readerRecommendGrid');
  if (!container) return;

  const others = getPublishedWorks().filter(w => Number(w.id) !== Number(currentWorkId)).slice(0, 4);
  container.innerHTML = others.map(w => renderCdgWorkCardHtml(w)).join('');
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons({ root: container });
}

// 🪙 포인트로 회차 즉시 열람 (100P 차감)
window.handlePointUnlockEpisode = function() {
  showToast('포인트 열람은 결제·차감 서버 연동 준비 중입니다.');
};

async function startAdSimulation() {
  showToast('보상형 광고는 광고사 검증 연동 준비 중입니다.');
}

// ============================================================
// [Reader Preferences Manager] 독자 맞춤 뷰어 환경설정 스토어
// - OLED True Black 테마, 명조/고딕 글꼴, 줄간격, 여백, 문단간격, 글자크기
// - 로컬스토리지 영구 보관 및 Supabase 원격 동기화
// ============================================================
const DEFAULT_READER_PREFERENCES = {
  theme: 'theme-dark',       // 'theme-dark' | 'theme-oled' | 'theme-sepia' | 'theme-light'
  fontFamily: 'serif',       // 'serif' | 'sans'
  fontSize: 18,              // 14 ~ 26 px
  lineHeight: 1.8,           // 1.5 | 1.8 | 2.2
  paddingX: 20,              // 12 | 20 | 36 px
  paragraphGap: 1.2          // 0.8 | 1.2 | 1.6 em
};

class ReaderPreferencesStore {
  constructor() {
    this.pref = { ...DEFAULT_READER_PREFERENCES };
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.load();
    this.apply();
  }

  load() {
    if (window.WEBNOVELS_CONFIG?.readerServiceEnabled) return;
    try {
      const saved = localStorage.getItem('webnovels_reader_preferences');
      if (saved) {
        this.pref = { ...this.pref, ...JSON.parse(saved) };
      } else {
        const legacyTheme = localStorage.getItem('webnovels_reader_theme');
        if (legacyTheme) this.pref.theme = legacyTheme;
        const legacyFont = localStorage.getItem('webnovels_reader_font_size');
        if (legacyFont) this.pref.fontSize = Number(legacyFont) || 18;
      }
    } catch (_) {}
  }

  save() {
    if (window.ReaderHub?.active()) {
      if(window.WebNovelsAuth?.getActor()?.reader)
        window.ReaderHub.change('preferences',{}, {settings:this.pref}).catch(()=>{});
      return;
    }
    try {
      localStorage.setItem('webnovels_reader_preferences', JSON.stringify(this.pref));
      localStorage.setItem('webnovels_reader_theme', this.pref.theme);
      localStorage.setItem('webnovels_reader_font_size', String(this.pref.fontSize));

      const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
      const userIdent = savedUser?.username || savedUser?.email || savedUser?.id;
      if (userIdent && window.WebNovelsAdmin?.saveReaderPreferences) {
        window.WebNovelsAdmin.saveReaderPreferences(userIdent, this.pref).catch(() => {});
      }
    } catch (_) {}
  }

  async syncRemote(identifier) {
    if (window.ReaderHub?.active()) {
      if(!window.WebNovelsAuth?.getActor()?.reader)return;
      try {
        const activity=await window.ReaderHub.activity(true);
        this.pref={...DEFAULT_READER_PREFERENCES,...activity.preferences};
        this.apply();
      } catch { /* Existing local view remains usable while remote settings fail. */ }
      return;
    }
    if (!identifier || !window.WebNovelsAdmin?.fetchReaderPreferences) return;
    try {
      const remotePref = await window.WebNovelsAdmin.fetchReaderPreferences(identifier);
      if (remotePref && typeof remotePref === 'object') {
        this.pref = { ...this.pref, ...remotePref };
        this.save();
        this.apply();
      }
    } catch (_) {}
  }

  apply() {
    const reader = document.getElementById('view-reader');
    if (reader) {
      const themeClasses = ['theme-dark', 'theme-oled', 'theme-sepia', 'theme-light'];
      themeClasses.forEach(tc => reader.classList.remove(tc));
      reader.classList.add(this.pref.theme);
    }

    if (typeof currentTheme !== 'undefined') currentTheme = this.pref.theme;
    if (typeof currentFontSize !== 'undefined') currentFontSize = this.pref.fontSize;

    const root = document.documentElement;
    const fontValue = this.pref.fontFamily === 'serif'
      ? "'Noto Serif KR', 'KoPub 바탕', serif"
      : "'Pretendard', 'Noto Sans KR', sans-serif";

    root.style.setProperty('--reader-font', fontValue);
    root.style.setProperty('--reader-font-size', `${this.pref.fontSize}px`);
    root.style.setProperty('--reader-line-height', String(this.pref.lineHeight));
    root.style.setProperty('--reader-padding-x', `${this.pref.paddingX}px`);
    root.style.setProperty('--reader-paragraph-gap', `${this.pref.paragraphGap}em`);

    const paper = document.getElementById('readerPaper');
    if (paper) {
      paper.style.fontFamily = fontValue;
      paper.style.fontSize = `${this.pref.fontSize}px`;
      paper.style.lineHeight = String(this.pref.lineHeight);
      paper.style.paddingLeft = `${this.pref.paddingX}px`;
      paper.style.paddingRight = `${this.pref.paddingX}px`;
    }

    document.querySelectorAll('#readerBody .reader-paragraph').forEach((p) => {
      p.style.marginBottom = `${this.pref.paragraphGap}em`;
      p.style.lineHeight = String(this.pref.lineHeight);
    });

    this.updateControlsUI();
  }

  updateControlsUI() {
    document.querySelectorAll('.theme-selector-grid .theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === this.pref.theme || btn.classList.contains(this.pref.theme));
    });

    document.querySelectorAll('.pref-btn[data-font]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.font === this.pref.fontFamily);
    });

    const disp = document.getElementById('fontSizeDisplay');
    if (disp) disp.textContent = `${this.pref.fontSize}px`;

    document.querySelectorAll('.pref-btn[data-line-height]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.lineHeight) === Number(this.pref.lineHeight));
    });

    document.querySelectorAll('.pref-btn[data-padding]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.padding) === Number(this.pref.paddingX));
    });

    document.querySelectorAll('.pref-btn[data-gap]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.gap) === Number(this.pref.paragraphGap));
    });
  }

  setTheme(themeClass) {
    this.pref.theme = themeClass;
    this.save();
    this.apply();
  }

  setFontFamily(font) {
    this.pref.fontFamily = font;
    this.save();
    this.apply();
  }

  changeFontSize(delta) {
    this.pref.fontSize = Math.max(14, Math.min(26, this.pref.fontSize + delta));
    this.save();
    this.apply();
  }

  setLineHeight(lh) {
    this.pref.lineHeight = Number(lh);
    this.save();
    this.apply();
  }

  setPaddingX(pad) {
    this.pref.paddingX = Number(pad);
    this.save();
    this.apply();
  }

  setParagraphGap(gap) {
    this.pref.paragraphGap = Number(gap);
    this.save();
    this.apply();
  }
  reset() {
    this.pref={...DEFAULT_READER_PREFERENCES};
    this.apply();
  }
}

window.ReaderPreferencesManager = new ReaderPreferencesStore();

// 기존 함수 하위 호환
window.setReaderTheme = function(themeClass) {
  window.ReaderPreferencesManager.setTheme(themeClass);
};

window.changeFontSize = function(delta) {
  window.ReaderPreferencesManager.changeFontSize(delta);
};

// 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.ReaderPreferencesManager.init());
} else {
  window.ReaderPreferencesManager.init();
}



// --- 5. 독자 인증, 프로필 수정 및 PASS 성인인증 ---



async function handleMemberLogin() {
  try {
    const actor = await window.WebNovelsAuth.login(document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
    closeAllModals();
    switchWebNovelsView(actor.admin ? 'view-admin-cms' : actor.author ? 'view-creator' : 'view-mypage');
    showToast('로그인되었습니다.');
  } catch (error) {
    showToast(window.WebNovelsAuth.message(error));
    if (error.code === 'ACCOUNT_NOT_LINKED') window.showAuthOnboarding();
  }
}
window.handleMemberLogout = async function() {
  try { await window.WebNovelsAuth.logout(); showToast('로그아웃되었습니다.'); }
  catch(error) { showToast(window.WebNovelsAuth.message(error)); }
  switchWebNovelsView('view-home');
};

window.handleAuthorLogoutProcess = window.handleMemberLogout;
window.handleCreatorLogoutProcess = window.handleMemberLogout;



// ----------------------------------------------------
// 중복확인 및 비밀번호 일치 실시간 검증
// ----------------------------------------------------
window.checkNicknameDuplicate = function() {
  const nickname = document.getElementById('signupNickname')?.value.trim();
  const msgEl = document.getElementById('nicknameCheckMsg');
  if (!nickname) {
    showToast('검사할 Nickname(별명)을 입력해주세요.');
    return;
  }
  
  const isDuplicated = SAMPLE_READERS.some(r => 
    (r.nickname && r.nickname.toLowerCase() === nickname.toLowerCase()) || 
    (r.username && r.username.toLowerCase() === nickname.toLowerCase())
  );

  if (msgEl) {
    msgEl.style.display = 'block';
    if (isDuplicated) {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = `❌ ${nickname} 은(는) 이미 사용 중인 별명입니다.`;
    } else {
      msgEl.style.color = '#10b981';
      msgEl.textContent = `✓ ${nickname} 은(는) 사용 가능한 멋진 별명입니다!`;
    }
  }
  showToast(isDuplicated ? '❌ 이미 사용 중인 Nickname입니다.' : '✓ 사용 가능한 Nickname(별명)입니다!');
};

window.checkAuthorPenNameDuplicate = function() {
  const penName = document.getElementById('authorPenName')?.value.trim();
  const msgEl = document.getElementById('authorPenNameCheckMsg');
  if (!penName) {
    showToast('검사할 Nickname/필명을 입력해주세요.');
    return;
  }
  
  const isDuplicated = SAMPLE_AUTHORS.some(a => 
    (a.pen_name && a.pen_name.toLowerCase() === penName.toLowerCase())
  );

  if (msgEl) {
    msgEl.style.display = 'block';
    if (isDuplicated) {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = `❌ ${penName} 은(는) 이미 등록된 필명입니다.`;
    } else {
      msgEl.style.color = '#10b981';
      msgEl.textContent = `✓ ${penName} 은(는) 등록 가능한 작가 필명입니다!`;
    }
  }
  showToast(isDuplicated ? '❌ 이미 등록된 필명입니다.' : '✓ 등록 가능한 작가 필명입니다!');
};

function setupPasswordMatchCheckers() {
  const pw1 = document.getElementById('signupPassword');
  const pw2 = document.getElementById('signupPasswordConfirm');
  const msg = document.getElementById('pwMatchMsg');

  function check() {
    if (!pw2 || !msg) return;
    if (!pw2.value) {
      msg.style.display = 'none';
      return;
    }
    msg.style.display = 'block';
    if (pw1.value === pw2.value) {
      msg.style.color = '#10b981';
      msg.textContent = '✓ 비밀번호가 일치합니다.';
    } else {
      msg.style.color = '#ef4444';
      msg.textContent = '✗ 비밀번호가 일치하지 않습니다.';
    }
  }

  pw1?.addEventListener('input', check);
  pw2?.addEventListener('input', check);

  const aPw1 = document.getElementById('authorPassword');
  const aPw2 = document.getElementById('authorPasswordConfirm');
  const aMsg = document.getElementById('authorPwMatchMsg');

  function aCheck() {
    if (!aPw2 || !aMsg) return;
    if (!aPw2.value) {
      aMsg.style.display = 'none';
      return;
    }
    aMsg.style.display = 'block';
    if (aPw1.value === aPw2.value) {
      aMsg.style.color = '#10b981';
      aMsg.textContent = '✓ 비밀번호가 일치합니다.';
    } else {
      aMsg.style.color = '#ef4444';
      aMsg.textContent = '✗ 비밀번호가 일치하지 않습니다.';
    }
  }

  aPw1?.addEventListener('input', aCheck);
  aPw2?.addEventListener('input', aCheck);
}

async function submitAuthSignup(kind) {
  const author = kind === 'author';
  const value = id => document.getElementById(id)?.value || '';
  const password = value(author ? 'authorPassword' : 'signupPassword');
  if (password !== value(author ? 'authorPasswordConfirm' : 'signupPasswordConfirm')) { showToast('비밀번호가 일치하지 않습니다.'); return; }
  try {
    const message = await window.WebNovelsAuth.signup(kind, value(author ? 'authorEmail' : 'signupEmail'), password, value(author ? 'authorPenName' : 'signupNickname'));
    showToast(message);
  } catch(error) { showToast(window.WebNovelsAuth.message(error)); }
}
async function handleMemberSignup() { return submitAuthSignup('reader'); }
async function handleAuthorSignup() { return submitAuthSignup('author'); }
function getCurrentAuthorSession() { return window.WebNovelsAuth?.getActor()?.author || null; }

function getCurrentCreatorSession() {
  return getCurrentAuthorSession();
}

async function loadMyProfile() { await window.WebNovelsAuth.init(); }

function updateMemberHeader(user) {
  const profileMenu = document.getElementById('userProfileMenu');
  const navCreatorLinks = document.querySelectorAll('.desktop-nav a[data-target="view-creator"], .desktop-nav a[href="#creator"], .cp-nav-link.nav-highlight');
  const navAdminLinks = document.querySelectorAll('.desktop-nav a[data-target="view-admin-cms"], .desktop-nav a[href="#admin"], .cp-nav-link.nav-admin');

  if (user) {
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'SUB_ADMIN' || isAdminLoggedIn;
    const isAuthor = !isAdmin && ((user.role === 'CREATOR' || user.role === 'AUTHOR') || !!user.pen_name);
    const isReader = !isAdmin && !isAuthor;

    // [중요 요건] body data-user-role 속성 설정 (CSS Guard 및 JS 이중 보장)
    if (isReader) {
      document.body?.setAttribute('data-user-role', 'READER');
      navCreatorLinks.forEach(el => el.style.setProperty('display', 'none', 'important'));
      navAdminLinks.forEach(el => el.style.setProperty('display', 'none', 'important'));
    } else if (isAuthor) {
      document.body?.setAttribute('data-user-role', 'AUTHOR');
      navCreatorLinks.forEach(el => el.style.removeProperty('display'));
      navAdminLinks.forEach(el => el.style.setProperty('display', 'none', 'important'));
    } else if (isAdmin) {
      document.body?.setAttribute('data-user-role', 'ADMIN');
      navCreatorLinks.forEach(el => el.style.removeProperty('display'));
      navAdminLinks.forEach(el => el.style.removeProperty('display'));
    }

    // 헤더 우측 상단 프로필 영역 렌더링
    if (profileMenu) {
      if (isAdmin) {
        const adminName = escapeHtml(user.nickname || user.username || user.role || '관리자');
        profileMenu.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-outline btn-sm" onclick="switchWebNovelsView('view-admin-cms')" style="display: flex; align-items: center; gap: 6px; border-color: var(--primary-color); color: #fff;">
              <i data-lucide="shield" style="color: var(--primary-color);"></i>
              <span>${adminName} (${user.role || 'ADMIN'})</span>
            </button>
            <button class="btn btn-ghost btn-sm" onclick="handleAdminLogoutProcess()" title="관리자 로그아웃" style="color: var(--text-muted); padding: 4px 8px;">
              <i data-lucide="log-out"></i>
            </button>
          </div>
        `;
      } else if (isAuthor) {
        const displayName = `${escapeHtml(user.pen_name || user.nickname || "")} 작가님`;
        profileMenu.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-outline btn-sm" onclick="switchWebNovelsView('view-creator')" style="display: flex; align-items: center; gap: 6px;">
              <i data-lucide="feather"></i>
              <span>${displayName}</span>
            </button>
            <button class="btn btn-ghost btn-sm" onclick="handleAuthorLogoutProcess()" title="로그아웃" style="color: var(--text-muted); padding: 4px 8px;">
              <i data-lucide="log-out"></i>
            </button>
          </div>
        `;
      } else {
        const displayName = `${escapeHtml(user.nickname || user.username || "")}님`;
        profileMenu.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-outline btn-sm" onclick="switchWebNovelsView('view-mypage')" style="display: flex; align-items: center; gap: 6px;">
              <i data-lucide="user"></i>
              <span>${displayName}</span>
            </button>
            <button class="btn btn-ghost btn-sm" onclick="handleMemberLogout()" title="로그아웃" style="color: var(--text-muted); padding: 4px 8px;">
              <i data-lucide="log-out"></i>
            </button>
          </div>
        `;
      }
    }

    // 내 서재 프로필 정보 동기화 (관리자 / 작가 / 일반독자 역할별 분기)
    const myNickname = document.getElementById('myNickname');
    const myEmail = document.getElementById('myEmail');
    const myAvatar = document.getElementById('myAvatar');
    const myAdultBadge = document.getElementById('myAdultBadge');

    if (isAdmin) {
      if (myNickname) myNickname.textContent = user.nickname || (user.role === 'SUPER_ADMIN' ? '최고관리자' : (user.username || '운영관리자'));
      if (myEmail) myEmail.textContent = user.email || 'admin@webnovels.com';
      if (myAvatar) myAvatar.textContent = (user.nickname || user.username || '관').slice(0, 1).toUpperCase();
      if (myAdultBadge) {
        myAdultBadge.textContent = `🛡️ ${user.role || 'SUPER_ADMIN'} (전체 권한)`;
        myAdultBadge.className = 'badge badge-primary mt-2';
        window._isAdultVerified = true;
      }
    } else if (isAuthor) {
      const penName = user.pen_name || user.penName || user.nickname || user.username || '작가';
      if (myNickname) myNickname.textContent = `${penName} (공식 작가)`;
      if (myEmail) myEmail.textContent = user.email || `${user.username || 'author'}@webnovels.com`;
      if (myAvatar) myAvatar.textContent = penName.slice(0, 1).toUpperCase();
      if (myAdultBadge) {
        myAdultBadge.textContent = '✍️ 공식 인증 작가';
        myAdultBadge.className = 'badge badge-primary mt-2';
      }
    } else {
      if (myNickname) myNickname.textContent = user.nickname || user.username || '열혈독자';
      if (myEmail) myEmail.textContent = user.email || `${user.username || 'reader'}@webnovels.com`;
      if (myAvatar) myAvatar.textContent = (user.nickname || user.username || 'R').slice(0, 1).toUpperCase();
      if (myAdultBadge) {
        if (user.isAdultVerified) {
          myAdultBadge.textContent = '🔞 19+ 성인 인증 완료';
          myAdultBadge.className = 'badge badge-primary mt-2';
          window._isAdultVerified = true;
        } else {
          myAdultBadge.textContent = '성인 인증 미완료';
          myAdultBadge.className = 'badge badge-accent mt-2';
          window._isAdultVerified = false;
        }
      }
    }

    // [중요] 이미 성인인증을 완료한 경우 PASS 성인 인증 버튼 및 안내 문구 숨김 처리
    const boxPassVerify = document.getElementById('boxPassVerify');
    if (boxPassVerify) {
      boxPassVerify.style.display = 'none';
    }
  } else {
    // [비로그인 상태] 게스트일 때는 "작품 등록", "관리자" 메뉴를 다시 기본 표시로 복원
    document.body?.setAttribute('data-user-role', 'GUEST');
    navCreatorLinks.forEach(el => el.style.removeProperty('display'));
    navAdminLinks.forEach(el => el.style.removeProperty('display'));

    if (profileMenu) {
      profileMenu.innerHTML = `
        <button class="btn btn-primary btn-sm" id="btnHeaderLogin" onclick="openModal('modalAuth')">
          <i data-lucide="log-in"></i> 로그인
        </button>
      `;
    }

    const myNickname = document.getElementById('myNickname');
    const myEmail = document.getElementById('myEmail');
    const myAvatar = document.getElementById('myAvatar');
    const myAdultBadge = document.getElementById('myAdultBadge');
    const boxPassVerify = document.getElementById('boxPassVerify');

    if (myNickname) myNickname.textContent = '게스트 독자';
    if (myEmail) myEmail.textContent = '로그인이 필요합니다';
    if (myAvatar) myAvatar.textContent = 'G';
    if (myAdultBadge) {
      myAdultBadge.textContent = '성인 인증 미완료';
      myAdultBadge.className = 'badge badge-accent mt-2';
    }
    if (boxPassVerify) {
      boxPassVerify.style.display = 'none';
    }
    window._isAdultVerified = false;
  }

  if (window.lucide) window.lucide.createIcons();
}


// ----------------------------------------------------
// 5. PASS Adult Verification
// ----------------------------------------------------
async function handlePassAdultVerify() {
  showToast('본인인증 서비스 연동 준비 중입니다. 인증이 완료되기 전에는 성인 콘텐츠를 열람할 수 없습니다.');
}

// ----------------------------------------------------
// 6. 독자 회원 정보 수정 (검증된 Auth UUID 기반 닉네임 변경)
// ----------------------------------------------------
window.openEditProfileModal = function() {
  const reader = window.WebNovelsAuth?.getActor()?.reader;
  if (!reader) {
    showToast('로그인이 필요한 서비스입니다.');
    openModal('modalAuth');
    return;
  }
  const nickInput = document.getElementById('editProfileNickname');
  if (nickInput) nickInput.value = reader.nickname || reader.username || '';
  openModal('modalEditProfile');
};

window.handleSaveProfile = async function(event) {
  if (event) event.preventDefault();

  const nick = document.getElementById('editProfileNickname')?.value.trim();
  if (!nick || nick.length < 2 || nick.length > 40) {
    showToast('닉네임은 2~40자로 입력해주세요.');
    return;
  }
  if (!window.ReaderHub?.active()) {
    showToast('프로필 변경 기능은 보안 전환 후 제공됩니다.');
    return;
  }
  try {
    await window.ReaderHub.change('profile', {}, { nickname: nick });
    await window.WebNovelsAuth.validate();
    closeAllModals();
    showToast('회원 정보가 수정되었습니다.');
  } catch (err) {
    showToast('회원 정보가 저장되지 않았습니다. 다시 시도해주세요.');
  }
};




// --- 6. 실시간 계층형 댓글(Nested Comments) 시스템 ---

// ============================================================
// [Step 4] 대댓글 (Nested Comments) 계층형 렌더링 및 등록
// ============================================================
// [Step 4] 문단 댓글 & 대댓글 (Nested Comments) & 작가 모더레이션 연동
// ============================================================

window.filterParagraphComments = function(paragraphIndex) {
  if (window._filterParagraphIndex === paragraphIndex) {
    window._filterParagraphIndex = null;
    window._paragraphComment = null;
    document.querySelectorAll('#readerBody .reader-paragraph').forEach((el) => el.classList.remove('is-comment-selected'));
  } else {
    window._filterParagraphIndex = paragraphIndex;
    document.querySelectorAll('#readerBody .reader-paragraph').forEach((el) => el.classList.remove('is-comment-selected'));
    const pEl = document.querySelector(`#readerBody [data-paragraph-index="${paragraphIndex}"]`);
    if (pEl) {
      pEl.classList.add('is-comment-selected');
      const paragraphText = pEl.firstChild?.nodeType === Node.TEXT_NODE ? pEl.firstChild.nodeValue : '';
      const cleanText = paragraphText.trim();
      window._paragraphComment = {
        paragraphIndex,
        quoteText: cleanText.slice(0, 300),
        paragraphText,
        contentVersion: pEl.getAttribute('data-content-version') || 'v1'
      };
    }
  }

  if (window._currentReadingWorkId && window._currentReadingEpNum) {
    const episode = activeWork?.episodes?.find((item) => Number(item.episodeNumber) === Number(window._currentReadingEpNum));
    loadEpisodeComments(window._currentReadingWorkId, episode?.id || window._currentReadingEpNum);
  }

  const commentSection = document.getElementById('readerCommentsDrawer') || document.getElementById('readerCommentsList');
  if (commentSection) {
    commentSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
};

window.loadEpisodeComments = async function(workId, episodeId) {
  const container = document.getElementById('readerCommentsList');
  if (!container) return;

  // These IDs are also used in legacy inline controls. Never interpolate an
  // untrusted identifier into an HTML attribute or event handler.
  const safeId = value => /^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(String(value ?? ''));
  if (!safeId(workId) || !safeId(episodeId)) {
    container.textContent = '댓글을 불러오지 못했습니다.';
    return;
  }

  container.innerHTML = `<div class="p-3 text-center text-muted small"><span class="spinner-border spinner-border-sm mr-2"></span>댓글을 불러오는 중입니다...</div>`;

  try {
    let comments = [];
    if (window.ReaderHub?.active()) {
      const result=await window.ReaderHub.api('comments',{workId,episodeId});
      comments=result.comments||[];
      window._currentContentVersionId=result.versionId||null;
    } else if (window.WebNovelsAdmin?.fetchCommentsByEpisode) {
      comments = await window.WebNovelsAdmin.fetchCommentsByEpisode(workId, episodeId);
    }

    comments = Array.isArray(comments) ? comments.filter(c =>
      safeId(c?.id) && (!c.parent_id || safeId(c.parent_id))) : [];

    // Update paragraph comment count badges in readerBody
    const pCountMap = {};
    const pHashMap = {};
    if(window.ReaderHub?.active()&&window._currentContentVersionId) {
      for(const pEl of document.querySelectorAll('#readerBody .reader-paragraph')) {
        pEl.querySelector('.paragraph-badge')?.remove();
        const raw=new TextEncoder().encode(pEl.textContent);
        const hash=await crypto.subtle.digest('SHA-256',raw);
        pHashMap[pEl.getAttribute('data-paragraph-index')]=Array.from(new Uint8Array(hash))
          .map(b=>b.toString(16).padStart(2,'0')).join('');
      }
    }
    comments.forEach(c => {
      const pIdx = c.anchor_paragraph ?? c.anchorParagraph;
      const matchesCurrent=!window.ReaderHub?.active()||
        (String(c.anchor_version_id)===String(window._currentContentVersionId)&&
          c.anchor_hash===pHashMap[String(pIdx)]);
      if (matchesCurrent && pIdx !== undefined && pIdx !== null && pIdx !== '') {
        pCountMap[pIdx] = (pCountMap[pIdx] || 0) + 1;
      }
    });

    document.querySelectorAll('#readerBody .reader-paragraph').forEach((pEl) => {
      const pIdx = pEl.getAttribute('data-paragraph-index');
      const existingBadge = pEl.querySelector('.paragraph-badge');
      if (existingBadge) existingBadge.remove();

      const count = pCountMap[pIdx];
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'paragraph-badge';
        badge.title = `이 문단의 댓글 ${count}개 보기`;
        badge.innerHTML = `💬 ${count}`;
        badge.onclick = (e) => {
          e.stopPropagation();
          filterParagraphComments(parseInt(pIdx, 10));
        };
        pEl.appendChild(badge);
      }
    });

    // 최상위 댓글과 대댓글 분리
    let rootComments = comments.filter(c => !c.parent_id);
    let activeCreator = null;
    try { activeCreator = JSON.parse(localStorage.getItem('webnovels_creator') || localStorage.getItem('webnovels_author') || 'null'); } catch (_) {}
    const canModerate = !window.ReaderHub?.active() && !!activeCreator && (String(activeCreator.id || activeCreator.authorId || activeCreator.creatorId) === String(activeWork?.authorId || activeWork?.author_id) || String(activeCreator.pen_name || activeCreator.penName) === String(activeWork?.author));
    const replyMap = {};
    comments.filter(c => c.parent_id).forEach(r => {
      if (!replyMap[r.parent_id]) replyMap[r.parent_id] = [];
      replyMap[r.parent_id].push(r);
    });

    // Filter by paragraph if active
    let filterBannerHtml = '';
    if (window._filterParagraphIndex !== null && window._filterParagraphIndex !== undefined) {
      filterBannerHtml = `
        <div class="paragraph-filter-banner mb-3" style="background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.35); border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.84rem; color:#c7d2fe;">
            📌 <strong>문단 #${Number(window._filterParagraphIndex) + 1}</strong>에 남겨진 댓글만 표시 중입니다.
          </span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="filterParagraphComments(${window._filterParagraphIndex})" style="font-size:0.75rem; padding:3px 8px; color:#fff; border:1px solid rgba(255,255,255,0.2);">
            전체 댓글 보기 ✕
          </button>
        </div>
      `;
      rootComments = rootComments.filter(c => (c.anchor_paragraph ?? c.anchorParagraph) == window._filterParagraphIndex &&
        (!window.ReaderHub?.active()||(String(c.anchor_version_id)===String(window._currentContentVersionId)&&
          c.anchor_hash===pHashMap[String(window._filterParagraphIndex)])));
    }

    const selectedParagraph = window._paragraphComment;
    const paragraphContext = selectedParagraph ? `
      <div class="paragraph-comment-context">
        <span>문단 #${Number(selectedParagraph.paragraphIndex) + 1} 인용</span><q>${escapeReaderHtml(selectedParagraph.quoteText)}</q>
        <button type="button" onclick="window._paragraphComment = null; loadEpisodeComments('${workId}', '${episodeId}')">선택 해제</button>
      </div>` : '';

    let html = `
      <!-- 댓글 입력창 -->
      <div class="comment-input-box card glass-panel p-3 mb-4" style="border: 1px solid var(--border-color); border-radius: 8px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 6px;">💬 독자 한줄 감상평 남기기</div>
        ${paragraphContext}
        <textarea id="readerCommentInput" class="form-control" rows="2" placeholder="작품과 작가님을 응원하는 따뜻한 댓글을 남겨주세요." style="width:100%; background:rgba(255,255,255,0.05); color:#fff; border-radius:6px; padding:8px; border:1px solid var(--border-color); font-size:0.9rem;"></textarea>
        <div class="flex-between mt-2" style="display:flex; justify-content:space-between; align-items:center;">
          <label class="text-muted" style="font-size:.78rem; cursor:pointer;"><input id="readerCommentSpoiler" type="checkbox"> ⚠️ 스포일러 포함</label>
          <button class="btn btn-primary btn-sm" onclick="handleReaderCommentSubmit('${workId}', '${episodeId}')">
            댓글 등록
          </button>
        </div>
      </div>
      ${filterBannerHtml}
    `;

    if (rootComments.length === 0) {
      html += `<div class="text-center text-muted p-4">아직 작성된 댓글이 없습니다. 첫 번째 감상평의 주인공이 되어보세요!</div>`;
    } else {
      rootComments.forEach(c => {
        const timeStr = new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const replies = replyMap[c.id] || [];
        const isSpoiler = !!(c.is_spoiler || c.isSpoiler);

        const spoilerBlock = isSpoiler ? `
          <div class="comment-spoiler-blur-wrap is-blurred" id="spoilerWrap-${c.id}">
            <div class="spoiler-reveal-bar">
              <span class="spoiler-notice">⚠️ 스포일러가 포함된 감상평입니다.</span>
              <button type="button" class="btn btn-sm btn-outline btn-reveal-spoiler" onclick="document.getElementById('spoilerWrap-${c.id}').classList.remove('is-blurred'); this.parentElement.remove();">
                내용 보기
              </button>
            </div>
            <div class="comment-content-text">${escapeReaderHtml(c.content)}</div>
          </div>
        ` : `<div class="comment-content-text">${escapeReaderHtml(c.content)}</div>`;

        html += `
          <div class="comment-item" id="comment-${c.id}">
            <div class="comment-header">
              <span class="comment-author">👤 ${escapeReaderHtml(c.nickname || '독자')}</span>
              <span class="comment-time">${timeStr}</span>
            </div>
            ${c.quote_text ? `<div class="comment-quote">${escapeReaderHtml(c.quote_text)}${window.ReaderHub?.active()&&String(c.anchor_version_id)!==String(window._currentContentVersionId)?' · 이전 공개본 문맥':''}</div>` : ''}
            <div class="comment-content">${spoilerBlock}</div>
            <div class="comment-actions">
              <button class="btn-like-comment" onclick="handleLikeComment('${c.id}')" id="btnLike-${c.id}">
                ❤️ 공감 <span id="likeCount-${c.id}">${Math.max(0, Number(c.likes_count) || 0)}</span>
              </button>
              <button class="btn-reply-toggle" onclick="toggleReplyInput('${c.id}')">
                💬 답글 (${replies.length})
              </button>
              ${canModerate ? `<button class="btn-reply-toggle" onclick="authorHideComment('${c.id}')">숨김</button>${safeId(c.user_id) ? `<button class="btn-reply-toggle" onclick="authorBlockCommenter('${workId}', '${c.user_id}')">독자 차단</button>` : ''}` : ''}
            </div>

            <!-- 대댓글 입력창 -->
            <div class="reply-input-wrapper" id="replyInput-${c.id}">
              <textarea id="replyText-${c.id}" class="form-control" rows="2" placeholder="답글을 입력하세요..." style="width:100%; background:rgba(255,255,255,0.05); color:#fff; border-radius:6px; padding:6px; border:1px solid var(--border-color); font-size:0.85rem;"></textarea>
              <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:6px;">
                <button class="btn btn-ghost btn-sm" onclick="toggleReplyInput('${c.id}')">취소</button>
                <button class="btn btn-primary btn-sm" onclick="handleReaderReplySubmit('${workId}', '${episodeId}', '${c.id}')">답글 등록</button>
              </div>
            </div>
          </div>
        `;

        // 대댓글 렌더링
        replies.forEach(r => {
          const rTimeStr = new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const isReplySpoiler = !!(r.is_spoiler || r.isSpoiler);
          const replySpoilerBlock = isReplySpoiler ? `
            <div class="comment-spoiler-blur-wrap is-blurred" id="spoilerWrap-${r.id}">
              <div class="spoiler-reveal-bar">
                <span class="spoiler-notice">⚠️ 스포일러가 포함된 답글입니다.</span>
                <button type="button" class="btn btn-sm btn-outline btn-reveal-spoiler" onclick="document.getElementById('spoilerWrap-${r.id}').classList.remove('is-blurred'); this.parentElement.remove();">
                  내용 보기
                </button>
              </div>
              <div class="comment-content-text">${escapeReaderHtml(r.content)}</div>
            </div>
          ` : `<div class="comment-content-text">${escapeReaderHtml(r.content)}</div>`;

          html += `
            <div class="comment-item is-reply" id="comment-${r.id}">
              <div class="comment-header">
                <span class="comment-author" style="color:var(--cdg-pink);">↳ 👤 ${escapeReaderHtml(r.nickname || '독자')}</span>
                <span class="comment-time">${rTimeStr}</span>
              </div>
              <div class="comment-content">${replySpoilerBlock}</div>
              <div class="comment-actions">
                <button class="btn-like-comment" onclick="handleLikeComment('${r.id}')" id="btnLike-${r.id}">
                  ❤️ 공감 <span id="likeCount-${r.id}">${Math.max(0, Number(r.likes_count) || 0)}</span>
                </button>
              </div>
            </div>
          `;
        });
      });
    }

    container.innerHTML = html;
    const countEl = document.getElementById('readerCommentCount');
    if (countEl) countEl.textContent = `(${comments.length})`;
  } catch (err) {
    console.warn('[Comments Load Error]', err);
    container.innerHTML = `<div class="text-danger p-3">댓글을 불러오지 못했습니다.</div>`;
  }
};

window.handleReaderCommentSubmit = async function(workId, episodeId) {
  if (window.ReaderHub?.active()) {
    const input=document.getElementById('readerCommentInput');
    if(!input?.value.trim())return showToast('댓글 내용을 입력해주세요.');
    if(!window.WebNovelsAuth?.getActor()?.reader)return showToast('독자 로그인이 필요합니다.');
    const data={content:input.value.trim(),isSpoiler:!!document.getElementById('readerCommentSpoiler')?.checked};
    const paragraph=window._paragraphComment;
    if(paragraph) {
      if(!window._currentContentVersionId)return showToast('본문 버전을 확인한 뒤 다시 시도해주세요.');
      const raw=new TextEncoder().encode(paragraph.paragraphText);
      const hash=await crypto.subtle.digest('SHA-256',raw);
      data.anchorIndex=paragraph.paragraphIndex;
      data.anchorHash=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
      data.versionId=window._currentContentVersionId;
    }
    try {
      await window.ReaderHub.change('comment',{workId,episodeId},data);
      input.value='';window._paragraphComment=null;
      await loadEpisodeComments(workId,episodeId);
      showToast('댓글을 등록했습니다.');
    } catch {showToast('댓글을 저장하지 못했습니다. 정책과 본문 버전을 확인해주세요.');}
    return;
  }

  const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  if (!savedUser) {
    showToast('🔒 댓글 작성은 로그인 회원만 가능합니다.');
    switchWebNovelsView('view-auth');
    return;
  }

  const input = document.getElementById('readerCommentInput');
  if (!input || !input.value.trim()) {
    showToast('댓글 내용을 입력해주세요.');
    return;
  }

  const contentText = input.value.trim();

  // 1. 작가 안심 모더레이션 정책 검증 (improve4.md)
  let policy = null;
  if (window.WebNovelsAdmin?.fetchWorkCommentPolicy) {
    try {
      policy = await window.WebNovelsAdmin.fetchWorkCommentPolicy(workId);
    } catch (_) {}
  }

  if (policy) {
    // 1-1. 댓글 허용 여부
    if (policy.comments_enabled === false || policy.commentsEnabled === false) {
      showToast('🚫 작가님의 설정에 의해 이 작품의 신규 댓글 작성이 일시 제한되었습니다.');
      return;
    }

    // 1-2. 최소 열람 회차 요건 (체리피커/분탕 방지)
    const minEpisodes = policy.min_read_episodes ?? policy.minReadEpisodes ?? 0;
    if (minEpisodes > 0) {
      let readHistory = [];
      try {
        readHistory = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]');
      } catch (_) {}
      const readEpsForWork = new Set(
        readHistory.filter(h => Number(h.workId || h.work_id) === Number(workId)).map(h => Number(h.epNum || h.episodeNumber || h.ep_num))
      );
      if (readEpsForWork.size < minEpisodes) {
        showToast(`⚠️ 본 작품은 최소 ${minEpisodes}화 이상 정독한 독자만 댓글 작성이 가능합니다. (현재 ${readEpsForWork.size}화 감상)`);
        return;
      }
    }

    // 1-3. 작가 지정 금칙어 필터링
    const blockedTerms = policy.blocked_terms || policy.blockedTerms || [];
    if (blockedTerms.length > 0) {
      const lowerContent = contentText.toLowerCase();
      const matchedTerm = blockedTerms.find(term => lowerContent.includes(String(term).toLowerCase().trim()));
      if (matchedTerm) {
        showToast(`⚠️ 작가님이 지정한 금칙어("${matchedTerm}")가 포함되어 있어 등록할 수 없습니다.`);
        return;
      }
    }
  }

  const userId = savedUser.username || savedUser.email || String(savedUser.id);
  const nickname = savedUser.nickname || savedUser.username || '독자';

  const paragraph = window._paragraphComment;
  const spoiler = document.getElementById('readerCommentSpoiler')?.checked || false;
  const result = await window.WebNovelsAdmin?.addCommentToEpisode(workId, episodeId, userId, nickname, contentText, null, { anchorParagraph: paragraph?.paragraphIndex, quoteText: paragraph?.quoteText, contentVersion: paragraph?.contentVersion, isSpoiler: spoiler });
  if (!result?.success) return showToast(result?.error || '댓글을 저장하지 못했습니다.');

  showToast('🎉 감상평이 성공적으로 등록되었습니다.');
  input.value = '';
  window._paragraphComment = null;
  loadEpisodeComments(workId, episodeId);
};

window.handleReaderReplySubmit = async function(workId, episodeId, parentId) {
  if (window.ReaderHub?.active()) {
    const input=document.getElementById(`replyText-${parentId}`);
    if(!input?.value.trim())return showToast('답글 내용을 입력해주세요.');
    try {
      await window.ReaderHub.change('comment',{workId,episodeId},{content:input.value.trim(),parentId});
      input.value='';await loadEpisodeComments(workId,episodeId);
      showToast('답글을 등록했습니다.');
    } catch {showToast('답글을 저장하지 못했습니다.');}
    return;
  }
  const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  if (!savedUser) {
    showToast('🔒 답글 작성은 로그인 회원만 가능합니다.');
    switchWebNovelsView('view-auth');
    return;
  }

  const input = document.getElementById(`replyText-${parentId}`);
  if (!input || !input.value.trim()) {
    showToast('답글 내용을 입력해주세요.');
    return;
  }

  const userId = savedUser.username || savedUser.email || String(savedUser.id);
  const nickname = savedUser.nickname || savedUser.username || '독자';

  const result = await window.WebNovelsAdmin?.addCommentToEpisode(workId, episodeId, userId, nickname, input.value.trim(), parentId);
  if (!result?.success) return showToast(result?.error || '답글을 저장하지 못했습니다.');

  showToast('💬 답글이 등록되었습니다.');
  input.value = '';
  loadEpisodeComments(workId, episodeId);
};

window.handleLikeComment = async function(commentId) {
  if(!window.ReaderHub?.active())return showToast('댓글 공감 기능을 다시 확인해주세요.');
  if(!window.WebNovelsAuth?.getActor()?.reader)return showToast('독자 로그인이 필요합니다.');
  const workId=window._currentReadingWorkId;
  const episode=activeWork?.episodes?.find(e=>Number(e.episodeNumber)===Number(window._currentReadingEpNum));
  if(!workId||!episode)return;
  try {
    const result=await window.ReaderHub.change('like',{workId,episodeId:episode.id},{commentId});
    const count=document.getElementById('likeCount-'+commentId);
    if(count)count.textContent=String(result.likes);
    showToast(result.liked?'댓글에 공감했습니다.':'공감을 취소했습니다.');
  } catch {showToast('댓글 공감에 실패했습니다.');}
};


// ============================================================
// [Global Window Namespace Exports for Reader]
// ============================================================
if (typeof window !== 'undefined') {
  window.renderHomeWorks = renderHomeWorks;
  window.renderDiscoverWorks = renderDiscoverWorks;
  window.renderSearchResults = renderSearchResults;
  window.renderGoldenBest = renderGoldenBest;
  window.filterParagraphComments = filterParagraphComments;
  window.loadEpisodeComments = loadEpisodeComments;
  window.setDiscoverGenreFilter = window.setDiscoverGenreFilter;
  window.setDiscoverStatus = window.setDiscoverStatus;
  window.setDiscoverEpisodeRange = window.setDiscoverEpisodeRange;
  window.setDiscoverRating = window.setDiscoverRating;
  window.setDiscoverSortOrder = window.setDiscoverSortOrder;
  window.toggleDiscoverTag = window.toggleDiscoverTag;
  window.resetDiscoverFilters = window.resetDiscoverFilters;
  window.renderLibraryContent = renderLibraryContent;
  window.renderLibraryContinueList = renderLibraryContent;
  window.renderLibraryFavoritesList = renderLibraryContent;
  window.renderLibraryCreatorsList = renderLibraryContent;
  window.renderLibraryAuthorsList = renderLibraryContent;
  window.handleMemberLogin = handleMemberLogin;
  window.handleMemberSignup = handleMemberSignup;
  window.handleCreatorSignup = handleAuthorSignup;
window.handleAuthorSignup = handleAuthorSignup;
window.getCurrentCreatorSession = getCurrentCreatorSession;
window.getCurrentAuthorSession = getCurrentAuthorSession;
window.openCreatorWorksDirect = typeof openAuthorWorksDirect !== 'undefined' ? openAuthorWorksDirect : undefined;
  window.handleMemberLogout = typeof handleMemberLogout !== 'undefined' ? handleMemberLogout : undefined;
  window.handlePassAdultVerify = handlePassAdultVerify;
  window.loadMyProfile = loadMyProfile;
  window.updateMemberHeader = updateMemberHeader;
  window.saveReadingProgress = saveReadingProgress;
  window.handlePointUnlockEpisode = handlePointUnlockEpisode;
  window.startAdSimulation = startAdSimulation;
}
