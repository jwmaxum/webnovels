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
  const cover = getWorkCover(w);
  const authorName = getAuthorName(w);
  const rawViews = Number(w.viewCount ?? w.view_count ?? 0);
  const viewFormatted = rawViews >= 1000 ? `${(rawViews / 1000).toFixed(1)}K` : `${rawViews}회`;

  let rankBadgeHtml = '';
  if (options.rank) {
    rankBadgeHtml = `<div class="cdg-rank-badge rank-${options.rank}">${options.rank}</div>`;
  }

  let cornerBadgeHtml = '';
  if (options.badge === 'NEW') {
    cornerBadgeHtml = `<div class="cdg-corner-badge"><span class="cdg-badge-pink">NEW</span></div>`;
  } else if (options.badge === 'FREE') {
    cornerBadgeHtml = `<div class="cdg-corner-badge"><span class="cdg-badge-pink" style="background:#10B981;">FREE</span></div>`;
  } else if (isAdult) {
    cornerBadgeHtml = `<div class="cdg-corner-badge"><span class="cdg-badge-dark" style="color:var(--cdg-pink);">19+</span></div>`;
  }

  return `
    <article class="cdg-work-card" onclick="openWorkDetailDirect('${w.id}')" title="${w.title}">
      <div class="cdg-card-cover">
        <img class="cdg-card-cover-img" src="${cover}" alt="${w.title}" loading="lazy">
        ${rankBadgeHtml}
        ${cornerBadgeHtml}
      </div>
      <div class="cdg-card-info">
        <span class="cdg-card-tag">${w.genre || '웹소설'}</span>
        <h3 class="cdg-card-title">${w.title}</h3>
        <div class="cdg-card-meta">
          <span>${authorName}</span>
          <span><i data-lucide="eye" style="width:11px;height:11px;display:inline;vertical-align:middle;"></i> ${viewFormatted}</span>
        </div>
      </div>
    </article>
  `;
}

// 1. HERO / Featured Works Slider
function renderCdgHeroSlider(heroWorks) {
  const slider = document.getElementById('cdgHeroSlider');
  if (!slider || !heroWorks || heroWorks.length === 0) return;

  if (cdgHeroInterval) {
    clearInterval(cdgHeroInterval);
    cdgHeroInterval = null;
  }

  const slidesHtml = heroWorks.map((w, index) => {
    const cover = getWorkCover(w);
    const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
    return `
      <div class="cdg-hero-slide ${index === 0 ? 'active' : ''}" data-hero-index="${index}">
        <div class="cdg-hero-bg" style="background-image: url('${cover}');"></div>
        <div class="cdg-hero-gradient"></div>
        <div class="cdg-hero-body">
          <div class="cdg-hero-badges">
            <span class="cdg-badge-pink">🔥 실시간 추천 TOP ${index + 1}</span>
            <span class="cdg-badge-dark">${w.genre}</span>
            ${isAdult ? '<span class="cdg-badge-dark" style="color:var(--cdg-pink);">19+ 성인</span>' : '<span class="cdg-badge-dark">100% 무료해금</span>'}
          </div>
          <h2 class="cdg-hero-title">${w.title}</h2>
          <p class="cdg-hero-desc">${w.description || '광고를 시청하면 다음 회차가 100% 무료로 해금됩니다!'}</p>
          <div class="cdg-hero-actions">
            <button class="btn btn-primary" onclick="openWorkDetailDirect('${w.id}')">
              <i data-lucide="play"></i> 지금 감상하기
            </button>
            <button class="btn btn-outline" onclick="openWorkDetailDirect('${w.id}')">
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

  let filtered = SAMPLE_WORKS;
  if (selectedGenre !== '전체') {
    if (selectedGenre === '19+ 성인') {
      filtered = SAMPLE_WORKS.filter(w => w.rating === 'AGE_19' || w.genre === '성인' || (Array.isArray(w.genre) && w.genre.includes('성인')));
    } else {
      filtered = SAMPLE_WORKS.filter(w => {
        if (!w.genre) return false;
        if (Array.isArray(w.genre)) return w.genre.some(g => String(g).includes(selectedGenre));
        return String(w.genre).includes(selectedGenre);
      });
    }
  }

  if (!filtered || filtered.length === 0) {
    filtered = SAMPLE_WORKS.slice(0, 4);
  }

  container.innerHTML = filtered.map(w => renderCdgWorkCardHtml(w)).join('');
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

// Main Home Works Orchestrator (CMS Curation Flags Driven)
async function renderHomeWorks() {
  try {
    if (!SAMPLE_WORKS || SAMPLE_WORKS.length === 0) {
      console.warn('[renderHomeWorks] SAMPLE_WORKS가 비어있습니다.');
      return;
    }

    const isTop = (w) => !!(w.isTopRecommended || w.is_top_recommended);
    const isPopular = (w) => !!(w.isPopularWork || w.is_popular_work);
    const isNew = (w) => !!(w.isNewWork || w.is_new_work);
    const isComp = (w) => !!(w.isCompleted || w.is_completed);

    // 1. HERO Carousel
    const topRecommended = SAMPLE_WORKS.filter(isTop);
    const heroWorks = topRecommended.length >= 2 
      ? topRecommended 
      : [...topRecommended, ...SAMPLE_WORKS.filter(w => !isTop(w))].slice(0, 3);
    renderCdgHeroSlider(heroWorks.length > 0 ? heroWorks : SAMPLE_WORKS.slice(0, 3));

    // 2. 🔥 지금 가장 많이 읽는 작품
    const trendingContainer = document.getElementById('trendingWorksGrid');
    if (trendingContainer) {
      const populars = SAMPLE_WORKS.filter(isPopular);
      const top4 = populars.length >= 4 
        ? populars.slice(0, 4) 
        : [...populars, ...SAMPLE_WORKS.filter(w => !isPopular(w))].slice(0, 4);

      trendingContainer.innerHTML = (top4.length > 0 ? top4 : SAMPLE_WORKS.slice(0, 4)).map((w, idx) => {
        return renderCdgWorkCardHtml(w, { rank: idx + 1 });
      }).join('');
    }

    // 3. ✨ 새로운 작품
    const newWorksContainer = document.getElementById('newWorksGrid');
    if (newWorksContainer) {
      const news = SAMPLE_WORKS.filter(isNew);
      const new4 = news.length >= 4 
        ? news.slice(0, 4) 
        : [...news, ...SAMPLE_WORKS.filter(w => !isNew(w))].slice(0, 4);

      newWorksContainer.innerHTML = (new4.length > 0 ? new4 : SAMPLE_WORKS.slice(0, 4)).map(w => {
        return renderCdgWorkCardHtml(w, { badge: 'NEW' });
      }).join('');
    }

    // 4. 장르별 추천 (기본: 전체)
    renderGenreRecommendations('전체');

    // 5. 🎨 인기 웹툰
    const webtoonsContainer = document.getElementById('webtoonsGrid');
    if (webtoonsContainer) {
      const webtoons = SAMPLE_WORKS.filter(w => w.contentType === 'WEBTOON' || w.content_type === 'WEBTOON');
      const list = webtoons.length > 0 ? webtoons : SAMPLE_WORKS.slice(0, 2);
      webtoonsContainer.innerHTML = list.map(w => renderCdgWorkCardHtml(w, { badge: 'NEW' })).join('');
    }

    // 6. 🏆 완결 명작 모음
    const completedContainer = document.getElementById('completedWorksGrid');
    if (completedContainer) {
      const completed = SAMPLE_WORKS.filter(isComp);
      const list = completed.length > 0 ? completed : SAMPLE_WORKS.slice(2, 4);
      completedContainer.innerHTML = list.map(w => renderCdgWorkCardHtml(w, { badge: 'FREE' })).join('');
    }

    // 7. 오늘의 무료 작품
    const todayFreeContainer = document.getElementById('todayFreeGrid');
    if (todayFreeContainer) {
      const free4 = SAMPLE_WORKS.slice(0, 4);
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



// --- 2. 탐색(Discover) & 실시간 검색(Search) ---

// ----------------------------------------------------
// Discover Works View Renderer
// ----------------------------------------------------
function renderDiscoverWorks(genreFilter = 'ALL') {
  const container = document.getElementById('discoverWorksGrid');
  if (!container) return;

  const filtered = SAMPLE_WORKS.filter(w => {
    if (genreFilter === 'ALL' || genreFilter === '전체') return true;
    if (genreFilter === '19+ 성인') return w.rating === 'AGE_19' || w.genre === '성인' || (Array.isArray(w.genre) && w.genre.includes('성인'));
    const gStr = Array.isArray(w.genre) ? w.genre.join(' ') : (w.genre || '');
    return gStr.includes(genreFilter);
  });

  container.innerHTML = filtered.map(w => {
    const isAdult = w.rating === 'AGE_19' || w.genre === '성인' || (Array.isArray(w.genre) && w.genre.includes('성인'));
    const tagClass = isAdult ? 'tag-solid style-danger' : 'tag-outline';
    const tagText = isAdult ? '19+ 성인' : (Array.isArray(w.genre) ? w.genre[0] : (w.genre || '판타지'));
    const cover = getWorkCover(w);
    const rawViews = Number(w.viewCount ?? w.view_count ?? 0);
    const viewFormatted = rawViews >= 1000 ? `${(rawViews / 1000).toFixed(1)}K` : `${rawViews}회`;
    return `
      <article class="feature-card" onclick="openWorkDetailDirect(${w.id})" style="cursor:pointer;">
        <div class="art" style="background-image: url('${cover}'); background-size: cover; background-position: center; height: 180px; border-radius: 8px;"></div>
        <div class="copy p-2">
          <span class="tag ${tagClass}">${tagText}</span>
          <h3 style="font-size: 1rem; margin: 4px 0;">${w.title}</h3>
          <p class="text-muted small">${getAuthorName(w)} · 조회 ${viewFormatted}</p>
        </div>
      </article>
    `;
  }).join('');
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

// ----------------------------------------------------
// Global Search Results Renderer
// ----------------------------------------------------
function renderSearchResults(query = '') {
  const container = document.getElementById('searchResults');
  if (!container) return;

  const normalized = normalizeSearchText(query);
  let results = SAMPLE_WORKS.filter(work => {
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
    results = results.sort((a, b) => Number(b.id) - Number(a.id));
  }

  if (results.length === 0) {
    const fallback = SAMPLE_WORKS.slice().sort((a, b) => b.viewCount - a.viewCount).slice(0, 3);
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
  const cover = getWorkCover(work);
  return `
    <button class="search-result-item glass-panel p-2 mb-2 flex-between" onclick="closeAllModals(); openWorkDetailDirect(${work.id});" style="width: 100%; border-radius: 8px; text-align: left; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); color: #fff;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <img src="${cover}" alt="${work.title}" style="width: 40px; height: 52px; object-fit: cover; border-radius: 4px;">
        <div>
          <strong>${work.title}</strong>
          <div class="text-muted small">${getAuthorName(work)} · ${isAdult ? '19+ 성인' : work.genre} · 조회 ${(work.viewCount / 1000).toFixed(1)}K</div>
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

function saveReadingProgress(workId, epNum) {
  try {
    let history = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]');
    const id = Number(workId);
    const num = Number(epNum);

    // 기존 해당 작품 기록 제거 후 최신 순으로 상단에 추가
    history = history.filter(item => Number(item.workId) !== id);
    history.unshift({
      workId: id,
      episodeNumber: num,
      updatedAt: new Date().toISOString()
    });

    // 최대 20개까지만 보관
    if (history.length > 20) history = history.slice(0, 20);
    localStorage.setItem('webnovels_reading_history', JSON.stringify(history));

    console.log(`[Reading Progress Saved] Work ${id}, Episode ${num}`);

    // Supabase DB 실시간 즉시 저장 (readers 테이블 및 reading_history 테이블)
    const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (savedUser) {
      const userIdent = savedUser.username || savedUser.email || savedUser.id;
      if (window.WebNovelsAdmin?.recordReadingProgressInDB) {
        window.WebNovelsAdmin.recordReadingProgressInDB(userIdent, id, num);
      }
      if (window.WebNovelsAdmin?.updateReaderActivity) {
        window.WebNovelsAdmin.updateReaderActivity(userIdent, { readingHistory: history });
      }
    }

    // 서버 Express API 동기화 시도
    const token = localStorage.getItem('webnovels_token');
    if (token) {
      fetch('/api/auth/reading-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ workId: id, episodeNumber: num })
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[Reading Progress Error]', err);
  }
}

async function toggleFavoriteWork(workId) {
  try {
    let favs = JSON.parse(localStorage.getItem('webnovels_favorites') || '[]');
    const id = Number(workId);
    let isFav = false;
    if (favs.includes(id)) {
      favs = favs.filter(f => f !== id);
      showToast('💔 관심 작품에서 해제되었습니다.');
      isFav = false;
    } else {
      favs.push(id);
      showToast('💖 관심 작품에 등록되었습니다.');
      isFav = true;
    }
    localStorage.setItem('webnovels_favorites', JSON.stringify(favs));
    updateFavoriteButtons(id);
    renderLibraryContent(true);

    // Supabase DB 실시간 즉시 저장 (readers 테이블 favorites 컬럼)
    const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (savedUser) {
      const userIdent = savedUser.username || savedUser.email || savedUser.id;
      if (window.WebNovelsAdmin?.toggleFavoriteInDB) {
        await window.WebNovelsAdmin.toggleFavoriteInDB(userIdent, id, isFav);
      } else if (window.WebNovelsAdmin?.updateReaderActivity) {
        await window.WebNovelsAdmin.updateReaderActivity(userIdent, { favorites: favs });
      }
    }

    // 서버 Express API 동기화 시도
    const token = localStorage.getItem('webnovels_token');
    if (token) {
      fetch(`/api/works/${id}/favorite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[Favorite Toggle Error]', err);
  }
}
window.toggleFavoriteWork = toggleFavoriteWork;

function updateFavoriteButtons(workId) {
  const favs = JSON.parse(localStorage.getItem('webnovels_favorites') || '[]');
  const isFav = favs.includes(Number(workId));
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
  try {
    const authorName = (typeof authorData === 'object' ? (authorData.penName || authorData.pen_name || authorData.name) : authorData) || '작자미상';
    let subAuthors = JSON.parse(localStorage.getItem('webnovels_subscribed_authors') || '[]');
    let isSub = false;

    if (subAuthors.includes(authorName)) {
      subAuthors = subAuthors.filter(a => a !== authorName);
      showToast(`👤 ${authorName} 작가 구독을 취소했습니다.`);
      isSub = false;
    } else {
      subAuthors.push(authorName);
      showToast(`🎉 ${authorName} 작가를 구독했습니다! 내 서재에서 확인하세요.`);
      isSub = true;
    }
    
    localStorage.setItem('webnovels_subscribed_authors', JSON.stringify(subAuthors));
    updateSubscribeButtons(authorName);
    renderLibraryContent(true);

    // Supabase DB 실시간 즉시 저장 (readers 테이블 subscribed_authors 컬럼)
    const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (savedUser) {
      const userIdent = savedUser.username || savedUser.email || savedUser.id;
      if (window.WebNovelsAdmin?.toggleSubscriptionInDB) {
        await window.WebNovelsAdmin.toggleSubscriptionInDB(userIdent, authorName, isSub);
      } else if (window.WebNovelsAdmin?.updateReaderActivity) {
        await window.WebNovelsAdmin.updateReaderActivity(userIdent, { subscribedAuthors: subAuthors });
      }
    }

    // 서버 Express API 동기화 시도
    const token = localStorage.getItem('webnovels_token');
    if (token) {
      fetch('/api/auth/subscribe-author', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ authorName })
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[Subscribe Toggle Error]', err);
  }
}
window.toggleSubscribeAuthor = toggleSubscribeAuthor;

function updateSubscribeButtons(authorData) {
  const authorName = (typeof authorData === 'object' ? (authorData.penName || authorData.pen_name || authorData.name) : authorData) || '작자미상';
  const subAuthors = JSON.parse(localStorage.getItem('webnovels_subscribed_authors') || '[]');
  const isSubbed = subAuthors.includes(authorName);
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
  const matchedWorks = SAMPLE_WORKS.filter(w => {
    const aName = (typeof w.author === 'object' ? (w.author.penName || w.author.pen_name) : w.author) || '';
    return aName.toLowerCase() === String(authorName).toLowerCase();
  });

  // 해당 작가로 등록된 작품이 있으면 표시하고, 없으면 전체 연재작 중 관련 작품 매핑
  let worksToShow = [...matchedWorks];
  if (worksToShow.length === 0) {
    const defaultWork = SAMPLE_WORKS.find(w => Number(w.id) === 1) || SAMPLE_WORKS[0];
    worksToShow.push(defaultWork);
  }

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
      const cover = work.coverUrl || (work.cover_image ? `/images/${work.cover_image}` : '/images/stormqueen_oath.jpg');
      const epCount = work.episodes?.length || 6;
      return `
        <div class="author-work-item glass-panel" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 14px; flex: 1;">
            <img src="${cover}" alt="${work.title} 표지" style="width: 56px; height: 76px; object-fit: cover; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
            <div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span class="badge badge-accent" style="font-size: 0.75rem;">${work.genre || '판타지'}</span>
                <span class="badge" style="font-size: 0.72rem; background: rgba(255,255,255,0.08); color: #fff;">총 ${epCount}화 연재</span>
              </div>
              <h4 style="margin: 0 0 4px; font-size: 1.05rem; color: #fff; font-weight: 700;">${work.title}</h4>
              <p class="text-muted small" style="margin: 0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; max-width: 320px;">
                ${work.description || '작품 소개글이 준비 중입니다.'}
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
  const continueContainer = document.getElementById('libraryContinueList');
  const favoriteContainer = document.getElementById('libraryFavoritesList');
  const authorContainer = document.getElementById('libraryAuthorsList');
  const statReadingEl = document.getElementById('statReadingCount');
  const statFavEl = document.getElementById('statFavoriteCount');
  const statAuthorEl = document.getElementById('statAuthorCount');

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
    subAuthors = JSON.parse(localStorage.getItem('webnovels_subscribed_authors') || '[]');
  } catch (e) {
    subAuthors = [];
  }

  // [Self-Healing] 로그인 상태에서 로컬 활동 데이터가 결측되어 있다면, DB에서 즉시 Fetch 및 복원
  if (!skipRemote && savedUser && (history.length === 0 || favs.length === 0 || subAuthors.length === 0) && window.WebNovelsAdmin?.fetchReaderActivity && !window._isFetchingLibrary) {
    window._isFetchingLibrary = true;
    try {
      const userIdent = savedUser.username || savedUser.email || savedUser.id;
      const remote = await window.WebNovelsAdmin.fetchReaderActivity(userIdent);
      if (remote) {
        if (history.length === 0 && remote.readingHistory && Array.isArray(remote.readingHistory) && remote.readingHistory.length > 0) {
          history = remote.readingHistory;
          localStorage.setItem('webnovels_reading_history', JSON.stringify(history));
        }
        if (favs.length === 0 && remote.favorites && Array.isArray(remote.favorites) && remote.favorites.length > 0) {
          favs = remote.favorites.map(Number);
          localStorage.setItem('webnovels_favorites', JSON.stringify(favs));
        }
        if (subAuthors.length === 0 && remote.subscribedAuthors && Array.isArray(remote.subscribedAuthors) && remote.subscribedAuthors.length > 0) {
          subAuthors = remote.subscribedAuthors;
          localStorage.setItem('webnovels_subscribed_authors', JSON.stringify(subAuthors));
        }
        if (remote.isAdultVerified !== undefined) {
          window._isAdultVerified = !!remote.isAdultVerified;
        }
      }
    } catch (err) {
      console.warn('[renderLibraryContent Auto-Fetch Error]', err);
    } finally {
      window._isFetchingLibrary = false;
    }
  }

  // 좌측 프로필 통계 숫자 실시간 반영
  if (statReadingEl) statReadingEl.textContent = String(history.length);
  if (statFavEl) statFavEl.textContent = String(favs.length);
  if (statAuthorEl) statAuthorEl.textContent = String(subAuthors.length);

  // 1. 실제 읽었던 실시간 내역 렌더링 (진행도 % 및 프로그레스 바 적용)
  if (continueContainer) {
    if (history.length > 0) {
      const validHistoryItems = history.map(item => {
        const work = SAMPLE_WORKS.find(w => Number(w.id) === Number(item.workId));
        if (!work) return null;
        const totalEps = work.episodes?.length || 6;
        const readEpNum = Number(item.episodeNumber) || 1;
        const pct = Math.min(100, Math.round((readEpNum / totalEps) * 100));
        const cover = work.coverUrl || (work.cover_image ? `/images/${work.cover_image}` : '/images/stormqueen_oath.jpg');
        return { work, totalEps, readEpNum, pct, cover };
      }).filter(Boolean);

      if (validHistoryItems.length > 0) {
        const topItem = validHistoryItems[0];
        const restItems = validHistoryItems.slice(1);

        let html = `
          <!-- 최신 읽은 대표 작품 (상단 하이라이트 카드) -->
          <div class="library-reading-card glass-panel mb-4" style="border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); border-radius: 14px; margin-bottom: 16px;">
            <img src="${topItem.cover}" alt="${topItem.work.title} 표지">
            <div>
              <span class="badge badge-accent" style="font-weight: 600;">${topItem.pct}% 읽음</span>
              <h3 style="margin: 6px 0 4px; font-size: 1.15rem; color: #fff;">${topItem.work.title}</h3>
              <p class="text-muted small" style="margin-bottom: 10px;">
                제 ${topItem.readEpNum}화 읽는 중 (총 ${topItem.totalEps}화) · ${topItem.work.genre}
              </p>
              <div class="progress-bar-bg" style="height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); overflow: hidden; width: 100%;">
                <div class="progress-bar-fill" style="width: ${topItem.pct}%; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #6D5EF5 0%, #8B5CF6 50%, #25D1FF 100%); box-shadow: 0 0 12px rgba(109, 94, 245, 0.7);"></div>
              </div>
            </div>
            <button class="btn btn-primary" onclick="openReaderDirect(${topItem.work.id}, ${topItem.readEpNum})" style="white-space: nowrap;">
              계속 읽기 <i data-lucide="chevron-right"></i>
            </button>
          </div>
        `;

        // 2번째 이후의 읽은 작품 목록
        if (restItems.length > 0) {
          html += `
            <div class="rest-history-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${restItems.map(item => `
                <button class="library-row" onclick="openReaderDirect(${item.work.id}, ${item.readEpNum})" style="display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; padding: 12px 14px; border-radius: 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); cursor: pointer; transition: all 0.2s;">
                  <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <img src="${item.cover}" alt="${item.work.title} 표지" style="width: 48px; height: 64px; object-fit: cover; border-radius: 6px;">
                    <div style="flex: 1; max-width: 400px;">
                      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                        <strong style="font-size: 0.95rem; color: #fff;">${item.work.title}</strong>
                        <span class="badge" style="font-size: 0.75rem; padding: 2px 6px; background: rgba(109, 94, 245, 0.2); color: #a5b4fc;">${item.pct}%</span>
                      </div>
                      <small class="text-muted" style="display: block; font-size: 0.82rem; margin-bottom: 6px;">
                        제 ${item.readEpNum}화 읽는 중 · ${item.work.genre}
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
      const favWorks = SAMPLE_WORKS.filter(w => favs.includes(Number(w.id)));
      favoriteContainer.innerHTML = favWorks.map(work => {
        const cover = work.coverUrl || (work.cover_image ? `/images/${work.cover_image}` : '/images/stormqueen_oath.jpg');
        return `
          <button class="library-row" onclick="openWorkDetailDirect(${work.id})" style="display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; padding: 12px; margin-bottom: 8px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); cursor: pointer; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${cover}" alt="${work.title} 표지" style="width: 52px; height: 68px; object-fit: cover; border-radius: 6px;">
              <div>
                <strong style="display: block; font-size: 1rem; color: #fff; margin-bottom: 4px;">${work.title}</strong>
                <small class="text-muted">${work.author} · ${work.genre}</small>
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
        const workFound = SAMPLE_WORKS.find(w => {
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
window.openWorkDetailDirect = function(workId, shouldPushState = true) {
  const targetId = Number(workId);
  const work = SAMPLE_WORKS.find(w => Number(w.id) === targetId) || SAMPLE_WORKS[0];
  activeWork = work;

  // 만약 회차가 없거나 비어있는 경우 1~6회차 기본 생성
  if (!work.episodes || work.episodes.length === 0) {
    work.episodes = createDefault6Episodes(work.title);
  }

  const cover = work.coverUrl || work.coverImageUrl || (work.cover_image ? `/images/${work.cover_image}` : '/images/stormqueen_oath.jpg');
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
  updateSubscribeButtons(work.author);

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
      <div class="episode-row" onclick="openReaderDirect(${work.id}, ${ep.episodeNumber})" style="transition: background 0.2s ease;">
        <div class="ep-left">
          <span class="ep-number">${ep.episodeNumber}화</span>
          <span class="ep-title">${ep.title}</span>
        </div>
        <div class="ep-right">
          ${isUnlocked 
            ? '<span class="badge badge-accent">FREE (열람 가능)</span>' 
            : '<span class="badge badge-warning">🔓 광고보고 무료열람</span>'}
        </div>
      </div>
    `;
  });

  // 7회차부터 10회차까지 "연재예정 Coming Soon" UI 추가
  const maxAvailableEp = sortedEpisodes.length > 0 ? Math.max(...sortedEpisodes.map(e => e.episodeNumber)) : 6;
  const comingSoonStart = Math.max(7, maxAvailableEp + 1);
  const comingSoonEnd = Math.max(comingSoonStart + 3, 10);

  for (let epNum = comingSoonStart; epNum <= comingSoonEnd; epNum++) {
    epHtml += `
      <div class="episode-row coming-soon-row" onclick="handleComingSoonEpisode(${epNum})" style="opacity: 0.55; cursor: pointer; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1);">
        <div class="ep-left">
          <span class="ep-number" style="color: var(--text-muted);">${epNum}화</span>
          <span class="ep-title" style="color: var(--text-muted);">제 ${epNum} 화</span>
        </div>
        <div class="ep-right">
          <span class="badge" style="background: rgba(255, 255, 255, 0.08); color: #aaa; border: 1px solid rgba(255,255,255,0.15);">🔒 연재예정 Coming Soon</span>
        </div>
      </div>
    `;
  }

  epList.innerHTML = epHtml;
  switchWebNovelsView('view-work-detail', null, false);
  if (shouldPushState) {
    const targetUrl = `/works/${work.id}`;
    if (window.location.pathname !== targetUrl) {
      try { window.history.pushState({ path: targetUrl }, '', targetUrl); } catch (e) {}
    }
  }
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
window.openReaderDirect = async function(workId, epNumber, shouldPushState = true) {
  const targetWorkId = Number(workId);
  const work = SAMPLE_WORKS.find(w => Number(w.id) === targetWorkId) || SAMPLE_WORKS[0];
  activeWork = work;

  if (!work.episodes || work.episodes.length === 0) {
    work.episodes = createDefault6Episodes(work.title);
  }

  const epNum = Number(epNumber);

  // 7회차 이상일 경우 연재예정 안내
  if (epNum >= 7 && !work.episodes.find(e => Number(e.episodeNumber) === epNum)) {
    handleComingSoonEpisode(epNum);
    return;
  }

  const ep = work.episodes.find(e => Number(e.episodeNumber) === epNum) || work.episodes[0];
  const unlockKey = `${work.id}-${epNum}`;

  // 1. 성인 콘텐츠 여부 확인 (비로그인 차단 및 PASS 성인인증 모달)
  const isAdultWork = work.rating === 'AGE_19' || work.genre === '성인' || (Array.isArray(work.genre) && (work.genre.includes('성인') || work.genre.includes('19세 이상')));
  if (isAdultWork) {
    let savedUser = null;
    try {
      savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    } catch(e) {}

    if (!savedUser) {
      showToast('🔒 19세 미만 이용불가 성인 콘텐츠입니다. 회원 로그인 후 이용해주세요.');
      closeAllModals();
      switchWebNovelsView('view-auth');
      return;
    }

    const isVerified = !!(savedUser.isAdultVerified || savedUser.is_adult_verified || window._isAdultVerified);
    if (!isVerified) {
      openModal('modalPassAdultVerify');
      return;
    }
  }

  // 2. 광고/포인트 해금 필요 체크 (4화 이상 유료/잠긴 회차)
  if (!ep.isFree && !unlockedEpisodes.has(unlockKey)) {
    window._pendingAdUnlockEpKey = unlockKey;
    window._pendingAdUnlockWorkId = work.id;
    window._pendingAdUnlockEpNum = epNum;
    
    // 포인트 모달 보유 포인트 표시 동기화
    const pointsEl = document.getElementById('modalCurrentPoints');
    if (pointsEl) pointsEl.textContent = `${userPoints.toLocaleString()}P`;
    
    openModal('modalAdUnlock');
    return;
  }

  activeEpisodeId = String(epNum);
  window._currentReadingWorkId = work.id;
  window._currentReadingEpNum = epNum;

  document.getElementById('readerWorkTitle').textContent = work.title;
  document.getElementById('readerEpTitle').textContent = ep.title;
  document.getElementById('readerHeading').textContent = `${ep.title} (${ep.episodeNumber}화)`;

  // 작가의 말 업데이트
  const authorCommentEl = document.getElementById('readerAuthorComment');
  if (authorCommentEl) {
    authorCommentEl.innerHTML = `<strong>작가의 말:</strong> ${ep.authorComment || '재미있게 읽으셨다면 구독과 댓글 부탁드립니다!'}`;
  }

  // 실시간 읽기 내역 저장 및 조회수 카운트
  saveReadingProgress(work.id, epNum);
  if (window.WebNovelsAdmin?.recordWorkReadingView) {
    window.WebNovelsAdmin.recordWorkReadingView(work.id, epNum);
  }

  // 3. 온디맨드 보안 회차 본문 로드 (episode_contents / episode_panels)
  let loadedText = ep.content || null;
  let loadedPanels = ep.imageUrls || [];

  if (window.WebNovelsAdmin?.fetchEpisodeContentSecure) {
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

  // 4. 웹툰 vs 웹소설 분기 렌더링
  const textBodyEl = document.getElementById('readerBody');
  const webtoonViewerEl = document.getElementById('readerWebtoonViewer');

  if (work.contentType === 'WEBTOON' || (loadedPanels && loadedPanels.length > 0)) {
    if (textBodyEl) textBodyEl.style.display = 'none';
    if (webtoonViewerEl) {
      webtoonViewerEl.style.display = 'block';
      const images = (loadedPanels && loadedPanels.length > 0) ? loadedPanels : [work.coverUrl || '/images/stormqueen_oath.jpg'];
      webtoonViewerEl.innerHTML = images.map(imgSrc => `
        <div class="webtoon-cut" style="margin: 0 auto; max-width: 720px; text-align: center;">
          <img src="${imgSrc}" alt="${work.title} ${ep.title}" style="width: 100%; height: auto; display: block; margin-bottom: 2px; border-radius: 4px;" loading="lazy">
        </div>
      `).join('');
    }
  } else {
    if (webtoonViewerEl) webtoonViewerEl.style.display = 'none';
    if (textBodyEl) {
      textBodyEl.style.display = 'block';
      const rawContent = loadedText || `본 회차는 ${ep.episodeNumber}회차 입니다.\n\n[${work.title} - ${ep.title}]\n광고를 보면 다음 회차가 연속으로 해금되어 계속 읽을 수 있습니다.`;
      const paragraphs = rawContent.split('\n\n').filter(p => p.trim().length > 0);
      textBodyEl.innerHTML = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
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

  // 5. 회차별 독자 댓글 및 대댓글 렌더링 (Step 4 연동)
  loadEpisodeComments(workId, epNum);

  // 6. 추천 작품 렌더링
  renderReaderRecommendations(work.id);

  switchWebNovelsView('view-reader');
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (window.lucide) window.lucide.createIcons();
};

// 회차별 댓글 렌더링 (대댓글 트리 지원)
function renderReaderComments(workId, epNum) {
  loadEpisodeComments(workId, epNum);
}

// 독자 댓글 등록 (하위 호환)
window.submitReaderComment = function() {
  const workId = window._currentReadingWorkId || 1;
  const epNum = window._currentReadingEpNum || 1;
  handleReaderCommentSubmit(workId, epNum);
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

  const others = SAMPLE_WORKS.filter(w => Number(w.id) !== Number(currentWorkId)).slice(0, 4);
  container.innerHTML = others.map(w => renderCdgWorkCardHtml(w)).join('');
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons({ root: container });
}

// 🪙 포인트로 회차 즉시 열람 (100P 차감)
window.handlePointUnlockEpisode = function() {
  if (userPoints < 100) {
    showToast('❌ 보유 포인트가 부족합니다. (최소 100P 필요)');
    return;
  }

  userPoints -= 100;
  localStorage.setItem('webnovels_user_points', String(userPoints));
  
  // 헤더 포인트 뱃지 업데이트
  const badgeVal = document.getElementById('headerPointsValue');
  if (badgeVal) badgeVal.textContent = `${userPoints.toLocaleString()}P`;

  const unlockKey = window._pendingAdUnlockEpKey;
  if (unlockKey) {
    unlockedEpisodes.add(unlockKey);
  }

  // Supabase episode_unlocks 및 ad_unlocks 테이블 실시간 동기화
  const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  const userId = savedUser ? (savedUser.username || savedUser.email) : 'guest';
  if (window._pendingAdUnlockWorkId && window._pendingAdUnlockEpNum) {
    if (window.WebNovelsAdmin?.recordEpisodeUnlock) {
      window.WebNovelsAdmin.recordEpisodeUnlock(userId, window._pendingAdUnlockEpNum, 'POINT');
    }
  }

  showToast('🪙 100P를 사용하여 회차를 즉시 해금했습니다!');
  closeAllModals();

  if (window._pendingAdUnlockWorkId && window._pendingAdUnlockEpNum) {
    openReaderDirect(window._pendingAdUnlockWorkId, window._pendingAdUnlockEpNum);
  }
};

// 보상형 광고 시뮬레이션 및 회차 언락
async function startAdSimulation() {
  const playerBox = document.getElementById('adPlayerBox');
  const timerText = document.getElementById('adTimerText');
  const btnWatch = document.getElementById('btnWatchAdSubmit');

  if (playerBox) playerBox.style.display = 'block';
  if (btnWatch) btnWatch.disabled = true;

  const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  const userId = savedUser ? (savedUser.username || savedUser.email) : 'guest';
  if (window.WebNovelsAdmin?.logAdEvent && window._pendingAdUnlockWorkId && window._pendingAdUnlockEpNum) {
    window.WebNovelsAdmin.logAdEvent(userId, window._pendingAdUnlockWorkId, window._pendingAdUnlockEpNum, 'START');
  }

  let seconds = 3;
  if (timerText) timerText.textContent = `📺 보상형 광고 시청 중... ${seconds}초`;

  const interval = setInterval(async () => {
    seconds--;
    if (seconds > 0) {
      if (timerText) timerText.textContent = `📺 보상형 광고 시청 중... ${seconds}초`;
    } else {
      clearInterval(interval);
      if (timerText) timerText.textContent = `⚡ 광고 완료! 작가에게 수익이 배분되었습니다.`;

      const unlockKey = window._pendingAdUnlockEpKey;
      if (unlockKey) {
        unlockedEpisodes.add(unlockKey);
      }

      // Supabase episode_unlocks 및 ad_events 실시간 동기화
      if (window._pendingAdUnlockWorkId && window._pendingAdUnlockEpNum) {
        if (window.WebNovelsAdmin?.recordEpisodeUnlock) {
          window.WebNovelsAdmin.recordEpisodeUnlock(userId, window._pendingAdUnlockEpNum, 'REWARDED_AD');
        }
        if (window.WebNovelsAdmin?.logAdEvent) {
          window.WebNovelsAdmin.logAdEvent(userId, window._pendingAdUnlockWorkId, window._pendingAdUnlockEpNum, 'REWARD', 'ADMOB', 25);
        }
      }

      showToast('🎉 광고 시청 완료! 회차가 무료 해금되었습니다.');
      closeAllModals();

      if (window._pendingAdUnlockWorkId && window._pendingAdUnlockEpNum) {
        openReaderDirect(window._pendingAdUnlockWorkId, window._pendingAdUnlockEpNum);
      }

      if (playerBox) playerBox.style.display = 'none';
      if (btnWatch) btnWatch.disabled = false;
    }
  }, 1000);
}

// Reader Theme Controls
window.setReaderTheme = function(themeClass) {
  const reader = document.getElementById('view-reader');
  if (reader) {
    reader.className = `main-view full-screen-reader ${themeClass} active`;
  }
  currentTheme = themeClass;
  localStorage.setItem('webnovels_reader_theme', themeClass);

  document.querySelectorAll('.theme-selector-grid .theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.classList.contains(themeClass));
  });
};

window.changeFontSize = function(delta) {
  currentFontSize += delta;
  if (currentFontSize < 14) currentFontSize = 14;
  if (currentFontSize > 26) currentFontSize = 26;

  const paper = document.getElementById('readerPaper');
  if (paper) paper.style.fontSize = `${currentFontSize}px`;
  const disp = document.getElementById('fontSizeDisplay');
  if (disp) disp.textContent = `${currentFontSize}px`;
};



// --- 5. 독자 인증, 프로필 수정 및 PASS 성인인증 ---



async function handleMemberLogin() {
  const loginIdentifier = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value.trim();
  
  if (!loginIdentifier || !password) {
    showToast('아이디 또는 이메일과 비밀번호를 입력해주세요.');
    return;
  }

  isAdminLoggedIn = false;
  localStorage.removeItem('webnovels_admin_token');

  try {
    // 1. 관리자 계정 로그인 시도
    if (window.WebNovelsAdmin?.login) {
      try {
        const adminRes = await window.WebNovelsAdmin.login(loginIdentifier, password);
        if (adminRes && adminRes.success && adminRes.admin) {
          isAdminLoggedIn = true;
          closeAllModals();
          const admin = adminRes.admin;
          localStorage.removeItem('webnovels_author');
          const adminEmail = admin.email || (loginIdentifier.includes('@') ? loginIdentifier : `${loginIdentifier}@webnovels.com`);
          const adminNickname = admin.nickname || (admin.role === 'SUPER_ADMIN' ? '최고관리자' : (admin.username || loginIdentifier));
          
          const adminUserObj = {
            id: admin.id || 'admin-root',
            username: admin.username || loginIdentifier,
            nickname: adminNickname,
            email: adminEmail,
            role: admin.role || 'SUPER_ADMIN',
            isAdultVerified: true
          };
          localStorage.setItem('webnovels_user', JSON.stringify(adminUserObj));
          localStorage.setItem('webnovels_token', `admin-token-${admin.id}`);
          localStorage.setItem('webnovels_admin_token', `admin-token-${admin.id}`);
          
          updateMemberHeader(adminUserObj);
          showToast(`🔑 관리자 로그인 성공! (${adminUserObj.nickname})`);
          switchWebNovelsView('view-admin-cms');
          return;
        }
      } catch (adminErr) {
        console.warn('[Admin Login Check]', adminErr);
      }
    }

    // 2. 작가 계정 로그인 시도
    if (window.WebNovelsAdmin?.authorLogin) {
      try {
        const authorRes = await window.WebNovelsAdmin.authorLogin(loginIdentifier, password);
        if (authorRes && authorRes.success && authorRes.author) {
          const author = authorRes.author;
          const authorObj = {
            id: author.id,
            username: author.username,
            email: author.email || (loginIdentifier.includes('@') ? loginIdentifier : `${author.username}@webnovels.com`),
            pen_name: author.pen_name || author.username,
            bio: author.bio || '',
            status: author.status || 'APPROVED',
            role: 'AUTHOR'
          };
          localStorage.setItem('webnovels_author', JSON.stringify(authorObj));
          localStorage.setItem('webnovels_token', `author-${authorObj.id}`);
          localStorage.removeItem('webnovels_user');
          
          updateMemberHeader({ ...authorObj, role: 'AUTHOR' });
          closeAllModals();
          showToast(`✍️ 작가 로그인 성공! (${authorObj.pen_name} 작가님)`);
          switchWebNovelsView('view-creator');
          return;
        }
      } catch (authErr) {
        console.warn('[Author Login Check]', authErr);
      }
    }

    // 3. 일반 독자 계정 로그인 시도
    if (window.WebNovelsAdmin?.readerLogin) {
      try {
        const rRes = await window.WebNovelsAdmin.readerLogin(loginIdentifier, password);
        if (rRes?.success && rRes.reader) {
          const reader = rRes.reader;
          const userObj = {
            id: reader.id,
            username: reader.username,
            nickname: reader.nickname || reader.username,
            email: reader.email || loginIdentifier,
            phone: reader.phone || '',
            subscription_status: reader.subscription_status || '일반 회원',
            isAdultVerified: !!reader.is_adult_verified,
            role: 'READER'
          };

          localStorage.setItem('webnovels_user', JSON.stringify(userObj));
          localStorage.setItem('webnovels_token', `reader-${reader.id}`);
          localStorage.removeItem('webnovels_author');

          // Supabase DB에서 최신 활동 내역(독서이력, 관심작품, 구독작가) 즉시 조회 및 동기화
          if (window.WebNovelsAdmin?.fetchReaderActivity) {
            try {
              const remoteAct = await window.WebNovelsAdmin.fetchReaderActivity(reader.username || reader.email || reader.id);
              if (remoteAct) {
                syncUserActivityToStorage(remoteAct);
                if (remoteAct.nickname) userObj.nickname = remoteAct.nickname;
                if (remoteAct.isAdultVerified !== undefined) userObj.isAdultVerified = remoteAct.isAdultVerified;
              }
            } catch (actErr) {
              console.warn('[fetchReaderActivity on Login]', actErr);
            }
          } else {
            syncUserActivityToStorage({
              readingHistory: reader.reading_history || [],
              favorites: reader.favorites || [],
              subscribedAuthors: reader.subscribed_authors || [],
              isAdultVerified: reader.is_adult_verified
            });
          }

          updateMemberHeader(userObj);
          renderLibraryContent();
          closeAllModals();
          showToast(`🎉 ${userObj.nickname}님 환영합니다! 로그인되었습니다.`);
          switchWebNovelsView('view-mypage');
          return;
        }
      } catch (rErr) {
        console.warn('[Reader Login Check]', rErr);
      }
    }

    showToast('❌ 아이디 또는 비밀번호가 일치하지 않거나 등록되지 않은 계정입니다.');
  } catch (err) {
    console.error('[handleMemberLogin Error]', err);
    showToast(`❌ 로그인 처리 오류: ${err.message}`);
  }
}


window.handleMemberLogout = function() {
  localStorage.removeItem('webnovels_token');
  localStorage.removeItem('webnovels_user');
  localStorage.removeItem('webnovels_author');
  localStorage.removeItem('webnovels_admin_token');
  localStorage.removeItem('webnovels_reading_history');
  localStorage.removeItem('webnovels_favorites');
  localStorage.removeItem('webnovels_subscribed_authors');
  isAdminLoggedIn = false;
  currentLoggedAuthor = null;
  window._isAdultVerified = false;

  updateMemberHeader(null);
  renderLibraryContent();
  showToast('로그아웃되었습니다.');
  switchWebNovelsView('view-home');
};



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
      msgEl.innerHTML = `❌ <strong>${nickname}</strong> 은(는) 이미 사용 중인 별명입니다.`;
    } else {
      msgEl.style.color = '#10b981';
      msgEl.innerHTML = `✓ <strong>${nickname}</strong> 은(는) 사용 가능한 멋진 별명입니다!`;
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
      msgEl.innerHTML = `❌ <strong>${penName}</strong> 은(는) 이미 등록된 필명입니다.`;
    } else {
      msgEl.style.color = '#10b981';
      msgEl.innerHTML = `✓ <strong>${penName}</strong> 은(는) 등록 가능한 작가 필명입니다!`;
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

async function handleMemberSignup() {
  const nickname = document.getElementById('signupNickname')?.value.trim();
  const email = document.getElementById('signupEmail')?.value.trim();
  const password = document.getElementById('signupPassword')?.value.trim();
  const passwordConfirm = document.getElementById('signupPasswordConfirm')?.value.trim();
  const phone = document.getElementById('signupPhone')?.value.trim();

  if (!nickname || !email || !password) {
    showToast('Nickname(별명), email ID, 비밀번호는 필수 입력 항목입니다.');
    return;
  }

  if (password.length < 6) {
    showToast('비밀번호는 최소 6자 이상이어야 합니다.');
    return;
  }

  if (password !== passwordConfirm) {
    showToast('❌ 입력하신 두 비밀번호가 일치하지 않습니다. 다시 확인해주세요.');
    document.getElementById('signupPasswordConfirm')?.focus();
    return;
  }

  const effectiveUsername = nickname;

  // 0. 가입 전 Supabase 중복 체크 (기존 활동 내역 초기화 방지)
  if (window.WebNovelsAdmin?.checkReaderExists) {
    const isExists = await window.WebNovelsAdmin.checkReaderExists(effectiveUsername, email);
    if (isExists) {
      showToast('❌ 이미 가입된 이메일 또는 별명(아이디)입니다. [로그인] 메뉴를 이용해주세요.');
      return;
    }
  }

  // 1. 백엔드 API 회원가입 시도
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        nickname, 
        username: effectiveUsername, 
        email, 
        password, 
        phone, 
        role: 'READER' 
      })
    });
    if (res.ok) {
      const data = await res.json();
      const userObj = {
        id: data.user?.id || 'user-' + Date.now(),
        username: data.user?.username || effectiveUsername,
        nickname: data.user?.nickname || nickname,
        email: data.user?.email || email,
        phone: phone || '',
        isAdultVerified: false,
        role: 'READER'
      };
      localStorage.setItem('webnovels_token', data.token || `token-${userObj.id}`);
      localStorage.setItem('webnovels_user', JSON.stringify(userObj));
      localStorage.removeItem('webnovels_author');

      // Supabase readers 테이블 실시간 등록 동기화
      if (window.WebNovelsAdmin?.createReaderInDB) {
        const createdRes = await window.WebNovelsAdmin.createReaderInDB({
          username: userObj.username,
          email: userObj.email,
          nickname: userObj.nickname,
          password: password,
          phone: userObj.phone,
          isAdultVerified: false,
          readingHistory: [],
          favorites: [],
          subscribedAuthors: []
        });
        if (createdRes?.success && createdRes.reader) {
          userObj.id = createdRes.reader.id;
          localStorage.setItem('webnovels_user', JSON.stringify(userObj));
        }
      }

      updateMemberHeader(userObj);
      renderLibraryContent();
      closeAllModals();
      showToast(`🎉 ${userObj.nickname}님 회원가입이 완료되었습니다!`);
      switchWebNovelsView('view-mypage');
      return;
    }
  } catch (err) {
    // Cloudflare Pages 등 정적 호스팅 환경에서는 로컬 세션으로 자동 처리
  }

  // 2. 로컬/정적 환경 회원가입 처리 (Supabase DB 직접 생성)
  const userObj = {
    id: 'user-' + Date.now(),
    username: effectiveUsername,
    nickname: nickname,
    email: email,
    phone: phone || '',
    isAdultVerified: false,
    role: 'READER'
  };

  // Supabase readers 테이블 실시간 등록
  if (window.WebNovelsAdmin?.createReaderInDB) {
    try {
      const createdRes = await window.WebNovelsAdmin.createReaderInDB({
        username: userObj.username,
        email: userObj.email,
        nickname: userObj.nickname,
        password: password,
        phone: userObj.phone,
        isAdultVerified: false,
        readingHistory: [],
        favorites: [],
        subscribedAuthors: []
      });
      if (createdRes?.success && createdRes.reader) {
        userObj.id = createdRes.reader.id;
      }
    } catch (e) {
      console.warn('[Signup createReaderInDB Error]', e);
    }
  }

  localStorage.setItem('webnovels_token', `token-${userObj.id}`);
  localStorage.setItem('webnovels_user', JSON.stringify(userObj));
  localStorage.removeItem('webnovels_author');

  updateMemberHeader(userObj);
  renderLibraryContent();
  closeAllModals();
  showToast(`🎉 ${userObj.nickname}님 회원가입이 완료되었습니다!`);
  switchWebNovelsView('view-mypage');
}


async function handleAuthorSignup() {
  const penName = document.getElementById('authorPenName')?.value.trim();
  const email = document.getElementById('authorEmail')?.value.trim();
  const password = document.getElementById('authorPassword')?.value.trim();
  const passwordConfirm = document.getElementById('authorPasswordConfirm')?.value.trim();
  const workTitle = document.getElementById('authorWorkTitle')?.value.trim();
  const bankInfo = document.getElementById('authorBankInfo')?.value.trim();

  if (!penName || !email || !password) {
    showToast('Nickname/필명, email ID, 비밀번호는 필수 입력 항목입니다.');
    return;
  }

  if (password.length < 6) {
    showToast('비밀번호는 최소 6자 이상이어야 합니다.');
    return;
  }

  if (password !== passwordConfirm) {
    showToast('❌ 입력하신 두 비밀번호가 일치하지 않습니다. 다시 확인해주세요.');
    document.getElementById('authorPasswordConfirm')?.focus();
    return;
  }

  const authorObj = {
    id: Date.now(),
    username: penName,
    pen_name: penName,
    email: email,
    work_title: workTitle || '신규 등록작품',
    bank_info: bankInfo || '',
    status: '공식 인증 작가'
  };

  localStorage.setItem('webnovels_token', `author-${authorObj.id}`);
  localStorage.setItem('webnovels_author', JSON.stringify(authorObj));
  localStorage.removeItem('webnovels_user');

  updateMemberHeader({ ...authorObj, role: 'AUTHOR' });
  closeAllModals();
  showToast(`✍️ ${penName} 작가님 회원가입이 완료되었습니다!`);
  switchWebNovelsView('view-creator');
}

function getCurrentAuthorSession() {
  try {
    const raw = localStorage.getItem('webnovels_author');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function loadMyProfile() {
  try {
    const authorSession = getCurrentAuthorSession();
    if (authorSession) {
      isAdminLoggedIn = false;
      updateMemberHeader({ ...authorSession, role: 'AUTHOR' });
      return;
    }

    const savedUser = localStorage.getItem('webnovels_user');
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUB_ADMIN') {
          isAdminLoggedIn = true;
          user.email = user.email || (user.username && user.username.includes('@') ? user.username : `${user.username || 'admin'}@webnovels.com`);
          user.nickname = user.nickname || (user.role === 'SUPER_ADMIN' ? '최고관리자' : (user.username || '운영관리자'));
          localStorage.setItem('webnovels_user', JSON.stringify(user));
          
          const badge = document.getElementById('adminRoleBadge');
          if (badge) {
            badge.textContent = `${user.role} 로그인됨`;
            badge.className = 'badge badge-primary';
          }
          if (document.getElementById('btnAdminLogout')) {
            document.getElementById('btnAdminLogout').style.display = 'inline-block';
          }
        } else {
          isAdminLoggedIn = false;
        }
        updateMemberHeader(user);

        if (window.WebNovelsAdmin?.fetchReaderActivity) {
          const remoteAct = await window.WebNovelsAdmin.fetchReaderActivity(user.username || user.email || user.id);
          if (remoteAct) {
            syncUserActivityToStorage(remoteAct);
            if (remoteAct.isAdultVerified !== undefined) user.isAdultVerified = remoteAct.isAdultVerified;
            if (remoteAct.nickname) user.nickname = remoteAct.nickname;
            localStorage.setItem('webnovels_user', JSON.stringify(user));
            updateMemberHeader(user);
          }
        }
        return;
      } catch (e) {
        console.warn('저장된 사용자 파싱 실패', e);
      }
    } else {
      isAdminLoggedIn = false;
      updateMemberHeader(null);
    }
  } catch(err) {
    console.warn('[loadMyProfile] 에러 방지:', err);
  }
}

function updateMemberHeader(user) {
  const profileMenu = document.getElementById('userProfileMenu');
  const navCreatorLinks = document.querySelectorAll('.desktop-nav a[data-target="view-creator"], .desktop-nav a[href="#creator"], .cp-nav-link.nav-highlight');
  const navAdminLinks = document.querySelectorAll('.desktop-nav a[data-target="view-admin-cms"], .desktop-nav a[href="#admin"], .cp-nav-link.nav-admin');

  if (user) {
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'SUB_ADMIN' || isAdminLoggedIn;
    const isAuthor = !isAdmin && (user.role === 'AUTHOR' || !!user.pen_name);
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
        const adminName = user.nickname || user.username || user.role || 'SUPER_ADMIN';
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
        const displayName = `${user.pen_name || user.nickname} 작가님`;
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
        const displayName = `${user.nickname || user.username}님`;
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
      boxPassVerify.style.display = (user.isAdultVerified || window._isAdultVerified) ? 'none' : 'block';
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
      boxPassVerify.style.display = 'block';
    }
    window._isAdultVerified = false;
  }

  if (window.lucide) window.lucide.createIcons();
}


// ----------------------------------------------------
// 5. PASS Adult Verification
// ----------------------------------------------------
async function handlePassAdultVerify() {
  if (confirm('PASS / KCP 본인인증 팝업을 실행하시겠습니까? (성인 19세 이상 확인)')) {
    showToast('📲 PASS 인증 검증 중...');

    // 서버 API 호출
    const token = localStorage.getItem('webnovels_token');
    if (token) {
      try {
        const res = await fetch('/api/auth/verify-adult', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) localStorage.setItem('webnovels_token', data.token);
        }
      } catch (e) {}
    }

    setTimeout(() => {
      window._isAdultVerified = true;
      let user = null;
      try {
        user = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
      } catch(e) {}

      if (user) {
        user.isAdultVerified = true;
        localStorage.setItem('webnovels_user', JSON.stringify(user));
        updateMemberHeader(user);

        // Supabase DB 동기화
        if (window.WebNovelsAdmin?.updateReaderActivity) {
          window.WebNovelsAdmin.updateReaderActivity(user.username || user.email, {
            isAdultVerified: true
          });
        }
      } else {
        const badge = document.getElementById('myAdultBadge');
        if (badge) {
          badge.textContent = '🔞 19+ 성인 인증 완료';
          badge.className = 'badge badge-primary mt-2';
        }
        const boxPass = document.getElementById('boxPassVerify');
        if (boxPass) boxPass.style.display = 'none';
      }
      showToast('🎉 PASS 19+ 성인 본인인증이 완료되었습니다!');
    }, 1000);
  }
}

// ----------------------------------------------------
// 6. 독자 회원 정보 수정 (닉네임 & 기존 비밀번호 확인 후 새 비밀번호 변경)
// ----------------------------------------------------
window.openEditProfileModal = function() {
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  } catch(e) {}

  if (!user) {
    showToast('로그인이 필요한 서비스입니다.');
    openModal('modalAuth');
    return;
  }

  const nickInput = document.getElementById('editProfileNickname');
  const curPwInput = document.getElementById('editProfileCurrentPassword');
  const newPwInput = document.getElementById('editProfileNewPassword');
  const confirmPwInput = document.getElementById('editProfileConfirmPassword');

  if (nickInput) nickInput.value = user.nickname || user.username || '';
  if (curPwInput) curPwInput.value = '';
  if (newPwInput) newPwInput.value = '';
  if (confirmPwInput) confirmPwInput.value = '';

  openModal('modalEditProfile');
};

window.handleSaveProfile = async function(event) {
  if (event) event.preventDefault();

  const nick = document.getElementById('editProfileNickname')?.value.trim();
  const currentPassword = document.getElementById('editProfileCurrentPassword')?.value.trim();
  const newPassword = document.getElementById('editProfileNewPassword')?.value.trim();
  const confirmPassword = document.getElementById('editProfileConfirmPassword')?.value.trim();

  if (!nick) {
    showToast('닉네임을 입력해주세요.');
    return;
  }

  if (newPassword) {
    if (!currentPassword) {
      showToast('비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.');
      return;
    }
    if (newPassword.length < 6) {
      showToast('새 비밀번호는 최소 6자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
  }

  const token = localStorage.getItem('webnovels_token');
  const reqBody = { nickname: nick };
  if (newPassword) {
    reqBody.currentPassword = currentPassword;
    reqBody.newPassword = newPassword;
  }

  try {
    if (token && !token.startsWith('reader-token') && !token.startsWith('author-')) {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(reqBody)
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(`❌ ${data.error || '정보 수정에 실패했습니다.'}`);
        return;
      }

      let user = JSON.parse(localStorage.getItem('webnovels_user') || '{}');
      user.nickname = data.user.nickname;
      localStorage.setItem('webnovels_user', JSON.stringify(user));
      updateMemberHeader(user);
      closeAllModals();
      showToast('🎉 회원 정보가 성공적으로 수정되었습니다.');
      return;
    }

    // 로컬/Supabase 모드
    let user = JSON.parse(localStorage.getItem('webnovels_user') || '{}');
    user.nickname = nick;
    localStorage.setItem('webnovels_user', JSON.stringify(user));
    if (window.WebNovelsAdmin?.updateReaderProfileInDB) {
      window.WebNovelsAdmin.updateReaderProfileInDB(user.username || user.email || user.id, { nickname: nick });
    }
    updateMemberHeader(user);
    closeAllModals();
    showToast('🎉 회원 정보가 성공적으로 수정되었습니다.');
  } catch (err) {
    showToast('회원 정보 수정 중 오류가 발생했습니다.');
  }
};




// --- 6. 실시간 계층형 댓글(Nested Comments) 시스템 ---

// ============================================================
// [Step 4] 대댓글 (Nested Comments) 계층형 렌더링 및 등록
// ============================================================
window.loadEpisodeComments = async function(workId, episodeId) {
  const container = document.getElementById('readerCommentsList');
  if (!container) return;

  container.innerHTML = `<div class="p-3 text-center text-muted small"><span class="spinner-border spinner-border-sm mr-2"></span>댓글을 불러오는 중입니다...</div>`;

  try {
    let comments = [];
    if (window.WebNovelsAdmin?.fetchCommentsByEpisode) {
      comments = await window.WebNovelsAdmin.fetchCommentsByEpisode(workId, episodeId);
    }

    if (!comments || comments.length === 0) {
      // 기본 데모 댓글 제공
      comments = [
        {
          id: 'demo-c1',
          parent_id: null,
          nickname: '달빛독자',
          content: '주인공 검술 묘사가 너무 생생하고 박진감 넘치네요! 다음 화가 정말 기대됩니다.',
          created_at: new Date(Date.now() - 3600000).toISOString(),
          likes_count: 14
        },
        {
          id: 'demo-c2',
          parent_id: 'demo-c1',
          nickname: '무협매니아',
          content: '맞아요, 특히 마지막 검기 폭발 장면은 역대급 연출이었습니다.',
          created_at: new Date(Date.now() - 1800000).toISOString(),
          likes_count: 5
        },
        {
          id: 'demo-c3',
          parent_id: null,
          nickname: '소설러버',
          content: '광고 보고 바로 5화까지 정주행 완료했습니다. 작가님 응원합니다!',
          created_at: new Date(Date.now() - 7200000).toISOString(),
          likes_count: 21
        }
      ];
    }

    // 최상위 댓글과 대댓글 분리
    const rootComments = comments.filter(c => !c.parent_id);
    const replyMap = {};
    comments.filter(c => c.parent_id).forEach(r => {
      if (!replyMap[r.parent_id]) replyMap[r.parent_id] = [];
      replyMap[r.parent_id].push(r);
    });

    let html = `
      <!-- 댓글 입력창 -->
      <div class="comment-input-box card glass-panel p-3 mb-4" style="border: 1px solid var(--border-color); border-radius: 8px;">
        <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 6px;">💬 독자 한줄 감상평 남기기</div>
        <textarea id="readerCommentInput" class="form-control" rows="2" placeholder="작품과 작가님을 응원하는 따뜻한 댓글을 남겨주세요." style="width:100%; background:rgba(255,255,255,0.05); color:#fff; border-radius:6px; padding:8px; border:1px solid var(--border-color); font-size:0.9rem;"></textarea>
        <div class="flex-between mt-2" style="display:flex; justify-content:space-between; align-items:center;">
          <small class="text-muted">클린 댓글 문화에 동참해 주세요.</small>
          <button class="btn btn-primary btn-sm" onclick="handleReaderCommentSubmit(${workId}, ${episodeId})">
            댓글 등록
          </button>
        </div>
      </div>
    `;

    if (rootComments.length === 0) {
      html += `<div class="text-center text-muted p-4">아직 작성된 댓글이 없습니다. 첫 번째 감상평의 주인공이 되어보세요!</div>`;
    } else {
      rootComments.forEach(c => {
        const timeStr = new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const replies = replyMap[c.id] || [];

        html += `
          <div class="comment-item" id="comment-${c.id}">
            <div class="comment-header">
              <span class="comment-author">👤 ${c.nickname || '독자'}</span>
              <span class="comment-time">${timeStr}</span>
            </div>
            <div class="comment-content">${c.content}</div>
            <div class="comment-actions">
              <button class="btn-like-comment" onclick="handleLikeComment('${c.id}')" id="btnLike-${c.id}">
                ❤️ 공감 <span id="likeCount-${c.id}">${c.likes_count || 0}</span>
              </button>
              <button class="btn-reply-toggle" onclick="toggleReplyInput('${c.id}')">
                💬 답글 (${replies.length})
              </button>
            </div>

            <!-- 대댓글 입력창 -->
            <div class="reply-input-wrapper" id="replyInput-${c.id}">
              <textarea id="replyText-${c.id}" class="form-control" rows="2" placeholder="답글을 입력하세요..." style="width:100%; background:rgba(255,255,255,0.05); color:#fff; border-radius:6px; padding:6px; border:1px solid var(--border-color); font-size:0.85rem;"></textarea>
              <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:6px;">
                <button class="btn btn-ghost btn-sm" onclick="toggleReplyInput('${c.id}')">취소</button>
                <button class="btn btn-primary btn-sm" onclick="handleReaderReplySubmit(${workId}, ${episodeId}, '${c.id}')">답글 등록</button>
              </div>
            </div>
          </div>
        `;

        // 대댓글 렌더링
        replies.forEach(r => {
          const rTimeStr = new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          html += `
            <div class="comment-item is-reply" id="comment-${r.id}">
              <div class="comment-header">
                <span class="comment-author" style="color:var(--cdg-pink);">↳ 👤 ${r.nickname || '독자'}</span>
                <span class="comment-time">${rTimeStr}</span>
              </div>
              <div class="comment-content">${r.content}</div>
              <div class="comment-actions">
                <button class="btn-like-comment" onclick="handleLikeComment('${r.id}')" id="btnLike-${r.id}">
                  ❤️ 공감 <span id="likeCount-${r.id}">${r.likes_count || 0}</span>
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

window.handleLikeComment = function(commentId) {
  const countEl = document.getElementById(`likeCount-${commentId}`);
  const btnEl = document.getElementById(`btnLike-${commentId}`);
  if (countEl) {
    let cur = parseInt(countEl.textContent, 10) || 0;
    cur += 1;
    countEl.textContent = String(cur);
    if (btnEl) {
      btnEl.style.color = 'var(--cdg-pink)';
    }
    showToast('💖 감상평에 공감(좋아요)을 남겼습니다.');
  }
};

window.toggleReplyInput = function(commentId) {
  const el = document.getElementById(`replyInput-${commentId}`);
  if (el) {
    el.classList.toggle('active');
  }
};

window.handleReaderCommentSubmit = async function(workId, episodeId) {
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

  const userId = savedUser.username || savedUser.email || String(savedUser.id);
  const nickname = savedUser.nickname || savedUser.username || '독자';

  if (window.WebNovelsAdmin?.addCommentToEpisode) {
    await window.WebNovelsAdmin.addCommentToEpisode(workId, episodeId, userId, nickname, input.value.trim(), null);
  }

  showToast('🎉 감상평이 성공적으로 등록되었습니다.');
  input.value = '';
  loadEpisodeComments(workId, episodeId);
};

window.handleReaderReplySubmit = async function(workId, episodeId, parentId) {
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

  if (window.WebNovelsAdmin?.addCommentToEpisode) {
    await window.WebNovelsAdmin.addCommentToEpisode(workId, episodeId, userId, nickname, input.value.trim(), parentId);
  }

  showToast('💬 답글이 등록되었습니다.');
  input.value = '';
  loadEpisodeComments(workId, episodeId);
};


// ============================================================
// [Global Window Namespace Exports for Reader]
// ============================================================
if (typeof window !== 'undefined') {
  window.renderHomeWorks = renderHomeWorks;
  window.renderDiscoverWorks = renderDiscoverWorks;
  window.renderSearchResults = renderSearchResults;
  window.renderLibraryContent = renderLibraryContent;
  window.renderLibraryContinueList = renderLibraryContinueList;
  window.renderLibraryFavoritesList = renderLibraryFavoritesList;
  window.renderLibraryAuthorsList = renderLibraryAuthorsList;
  window.handleMemberLogin = handleMemberLogin;
  window.handleMemberSignup = handleMemberSignup;
  window.handleAuthorSignup = handleAuthorSignup;
  window.handleMemberLogout = typeof handleMemberLogout !== 'undefined' ? handleMemberLogout : undefined;
  window.handlePassAdultVerify = handlePassAdultVerify;
  window.loadMyProfile = loadMyProfile;
  window.updateMemberHeader = updateMemberHeader;
  window.saveReadingProgress = saveReadingProgress;
  window.handlePointUnlockEpisode = handlePointUnlockEpisode;
  window.startAdSimulation = startAdSimulation;
}
