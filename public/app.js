// ============================================================
// [Frontend SPA Bootstrap Entry] public/app.js
//
// [Architecture: Phase 2 Modularization]
// - Core Modules:
//   - /js/core/state.js       : 전역 상태, 시드 데이터, 활동 동기화
//   - /js/core/ui-utils.js    : 모달, 토스트, 공통 포맷터 및 버튼 헬퍼
//   - /js/core/router.js      : Semantic URL 라우터, 딥링크, 뷰 전환기
// - Domain Modules:
//   - /js/reader/reader.js    : 홈, 탐색, 작품상세, 뷰어, 댓글, 내 서재, 성인인증
//   - /js/creator/creator.js  : 작가 스튜디오 대시보드, 회차발행, AI검수, 정산신청
//   - /js/admin/admin.js      : 16대 관제 메뉴, 5대 검수, CMS 작품연재, Action Queue
// - Extension:
//   - /supabase-admin.js      : Supabase 실시간 DB 및 관리자 확장 연동
// ============================================================

/**
 * 1. UI 이벤트 리스너 통합 바인딩 (bindWebNovelsEvents)
 */
function bindWebNovelsEvents() {
  // Navigation (Header nav, Mobile bottom nav, Desktop sidebar)
  document.querySelectorAll('.nav-link, .bottom-nav-item, .cdg-sidebar-item').forEach(link => {
    link.addEventListener('click', (e) => {
      const targetView = link.getAttribute('data-target');
      if (!targetView) return;
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) window.location.hash = href;
      if (typeof switchWebNovelsView === 'function') {
        switchWebNovelsView(targetView, link);
      }
    });
  });

  // PC Desktop & Mobile Header Search Bars
  const bindFastSearch = (inputId) => {
    const el = document.getElementById(inputId);
    if (!el) return;
    const triggerSearchModal = () => {
      if (typeof openModal === 'function') openModal('modalSearch');
      const gInput = document.getElementById('globalSearchInput');
      if (gInput) {
        gInput.value = el.value || '';
        if (typeof renderSearchResults === 'function') renderSearchResults(gInput.value);
        setTimeout(() => gInput.focus(), 50);
      }
    };
    el.addEventListener('focus', triggerSearchModal);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') triggerSearchModal();
    });
  };
  bindFastSearch('desktopHeaderSearchInput');
  bindFastSearch('mobileSearchInput');

  // Header login button
  document.getElementById('btnHeaderLogin')?.addEventListener('click', () => {
    if (typeof openModal === 'function') openModal('modalAuth');
  });

  document.getElementById('btnSearchOpen')?.addEventListener('click', () => {
    if (typeof openModal === 'function') openModal('modalSearch');
    if (typeof renderSearchResults === 'function') renderSearchResults();
    setTimeout(() => document.getElementById('globalSearchInput')?.focus(), 50);
  });

  document.getElementById('btnDiscoverSearch')?.addEventListener('click', () => {
    document.getElementById('btnSearchOpen')?.click();
  });

  document.getElementById('globalSearchInput')?.addEventListener('input', (event) => {
    if (typeof renderSearchResults === 'function') renderSearchResults(event.target.value);
  });

  document.getElementById('searchSortSelect')?.addEventListener('change', () => {
    if (typeof renderSearchResults === 'function') {
      renderSearchResults(document.getElementById('globalSearchInput')?.value || '');
    }
  });

  document.querySelectorAll('[data-search-term]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('globalSearchInput');
      if (input) {
        input.value = btn.dataset.searchTerm;
        if (typeof renderSearchResults === 'function') renderSearchResults(input.value);
        input.focus();
      }
    });
  });

  // Library tabs
  document.querySelectorAll('[data-library-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.libraryTab;
      document.querySelectorAll('[data-library-tab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.library-tab-panel').forEach(panel => panel.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`libraryTab-${tabName}`)?.classList.add('active');
    });
  });

  // Auth tabs
  document.querySelectorAll('[data-auth-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.authTab;
      document.querySelectorAll('[data-auth-tab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`authForm-${tabName}`)?.classList.add('active');
    });
  });

  document.getElementById('authForm-login')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (typeof handleMemberLogin === 'function') handleMemberLogin();
  });

  document.getElementById('authForm-signup')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (typeof handleMemberSignup === 'function') handleMemberSignup();
  });

  (document.getElementById('authForm-signup-creator') || document.getElementById('authForm-signup-author'))?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (typeof handleCreatorSignup === 'function') handleCreatorSignup();
    else if (typeof handleAuthorSignup === 'function') handleAuthorSignup();
  });

  document.getElementById('btnCheckNickname')?.addEventListener('click', () => {
    if (typeof checkNicknameDuplicate === 'function') checkNicknameDuplicate();
  });

  (document.getElementById('btnCheckCreatorPenName') || document.getElementById('btnCheckAuthorPenName'))?.addEventListener('click', () => {
    if (typeof checkAuthorPenNameDuplicate === 'function') checkAuthorPenNameDuplicate();
  });

  if (typeof setupPasswordMatchCheckers === 'function') {
    setupPasswordMatchCheckers();
  }

  document.getElementById('btnAuthCreator')?.addEventListener('click', () => {
    if (typeof closeAllModals === 'function') closeAllModals();
    if (typeof switchWebNovelsView === 'function') switchWebNovelsView('view-creator');
  });

  // CDG Sub-Category Nav Tabs (웹소설 | 웹툰 | 랭킹 | 신작)
  document.querySelectorAll('.cdg-tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cdg-tab-item').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const subtab = tab.dataset.subtab;

      if (subtab === 'novel') {
        if (currentActiveView !== 'view-home') switchWebNovelsView('view-home');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (subtab === 'webtoon') {
        if (typeof showToast === 'function') showToast('⚡ 웹툰 서비스 준비 중입니다! 현재 웹소설을 100% 무료로 감상해보세요.');
      } else if (subtab === 'ranking') {
        if (currentActiveView !== 'view-home') switchWebNovelsView('view-home');
        document.getElementById('trendingWorksSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (subtab === 'new') {
        if (currentActiveView !== 'view-home') switchWebNovelsView('view-home');
        document.getElementById('newWorksSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // CDG Genre Recommendation Pills
  document.querySelectorAll('.cdg-genre-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cdg-genre-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const genre = pill.dataset.genre || '전체';
      if (typeof renderGenreRecommendations === 'function') renderGenreRecommendations(genre);
    });
  });

  // Genre Filter Pills Event (Discover View)
  document.querySelectorAll('.filter-pills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const genreText = pill.textContent.trim();
      if (typeof renderDiscoverWorks === 'function') renderDiscoverWorks(genreText);
    });
  });

  // Work Detail Buttons
  document.getElementById('btnWorkDetailBack')?.addEventListener('click', () => {
    if (typeof switchWebNovelsView === 'function') switchWebNovelsView(lastMainView || 'view-home');
  });
  document.getElementById('btnDetailReadFirst')?.addEventListener('click', () => {
    if (typeof openReaderDirect === 'function' && activeWork) openReaderDirect(activeWork.id, 1);
  });
  document.getElementById('btnStickyRead')?.addEventListener('click', () => {
    if (typeof openReaderDirect === 'function' && activeWork) openReaderDirect(activeWork.id, 1);
  });
  document.getElementById('btnDetailFavorite')?.addEventListener('click', () => {
    if (typeof toggleFavoriteWork === 'function' && activeWork) toggleFavoriteWork(activeWork.id);
  });
  document.getElementById('btnStickyHeart')?.addEventListener('click', () => {
    if (typeof toggleFavoriteWork === 'function' && activeWork) toggleFavoriteWork(activeWork.id);
  });
  document.getElementById('btnDetailSubscribe')?.addEventListener('click', () => {
    if (typeof toggleSubscribeAuthor === 'function' && activeWork) toggleSubscribeAuthor(activeWork.author);
  });

  // Reader Events
  document.getElementById('btnReaderBack')?.addEventListener('click', () => {
    if (typeof switchWebNovelsView === 'function') switchWebNovelsView('view-work-detail');
  });
  document.getElementById('btnReaderSettings')?.addEventListener('click', () => {
    if (typeof openModal === 'function') openModal('modalReaderSettings');
  });
  document.getElementById('btnPrevEp')?.addEventListener('click', () => {
    const curEp = parseInt(activeEpisodeId, 10) || 1;
    if (curEp <= 1) {
      if (typeof showToast === 'function') showToast('첫 번째 회차입니다.');
    } else {
      if (typeof openReaderDirect === 'function' && activeWork) openReaderDirect(activeWork.id, curEp - 1);
    }
  });
  document.getElementById('btnNextEp')?.addEventListener('click', () => {
    const curEp = parseInt(activeEpisodeId, 10) || 1;
    const nextEp = curEp + 1;
    const work = activeWork || SAMPLE_WORKS[0];
    const availableEpisodes = work?.episodes || [];
    const maxEp = availableEpisodes.length > 0 ? Math.max(...availableEpisodes.map(e => e.episodeNumber)) : 6;

    if (nextEp <= maxEp) {
      if (typeof openReaderDirect === 'function' && activeWork) openReaderDirect(activeWork.id, nextEp);
    } else {
      if (typeof handleComingSoonEpisode === 'function') handleComingSoonEpisode(nextEp);
    }
  });

  // Sub-Category Navigation Bar (웹소설 | 웹툰 | 장르 | 랭킹 | 신작 | 완결작)
  document.querySelectorAll('#subCategoryNav [data-subtab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#subCategoryNav [data-subtab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const subtab = tab.dataset.subtab;

      if (currentActiveView !== 'view-home' && typeof switchWebNovelsView === 'function') {
        switchWebNovelsView('view-home');
      }

      if (subtab === 'novel') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (subtab === 'webtoon') {
        document.getElementById('webtoonsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (subtab === 'genre') {
        document.getElementById('genreRecSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (subtab === 'ranking') {
        document.getElementById('trendingWorksSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (subtab === 'new') {
        document.getElementById('newWorksSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (subtab === 'completed') {
        document.getElementById('completedWorksSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Creator Studio 7-Tab Switcher
  document.querySelectorAll('#creatorTabsBar [data-creator-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabKey = btn.dataset.creatorTab;
      if (typeof switchCreatorTab === 'function') switchCreatorTab(tabKey);
    });
  });

  // Genre Filter Pills (Home)
  document.querySelectorAll('#cdgGenrePillsBar .cdg-genre-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#cdgGenrePillsBar .cdg-genre-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const genre = pill.dataset.genre || '전체';
      if (typeof renderGenreRecommendations === 'function') renderGenreRecommendations(genre);
    });
  });

  // 뷰어 하단 이동 버튼 (내 서재 / 홈)
  document.getElementById('btnReaderLibrary')?.addEventListener('click', () => {
    if (typeof switchWebNovelsView === 'function') switchWebNovelsView('view-mypage');
  });
  document.getElementById('btnReaderHome')?.addEventListener('click', () => {
    if (typeof switchWebNovelsView === 'function') switchWebNovelsView('view-home');
  });

  // Ad Unlock Events
  document.getElementById('btnWatchAdSubmit')?.addEventListener('click', () => {
    if (typeof startAdSimulation === 'function') startAdSimulation();
  });

  // PASS Adult Verify
  document.getElementById('btnStartPassVerify')?.addEventListener('click', () => {
    if (typeof handlePassAdultVerify === 'function') handlePassAdultVerify();
  });

  // Creator Studio Settlement Request
  document.getElementById('btnRequestSettlement')?.addEventListener('click', () => {
    if (typeof handleCreatorSettlementReq === 'function') handleCreatorSettlementReq();
  });

  // Modal Closes
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof closeAllModals === 'function') closeAllModals();
    });
  });
}

/**
 * 2. 모바일 네비게이션 & 더보기 모달 헬퍼 함수
 */
window.openRankingFromNav = function(event) {
  if (event) event.preventDefault();
  if (typeof switchWebNovelsView === 'function') switchWebNovelsView('view-home');
  setTimeout(() => {
    const rankingEl = document.getElementById('curatedRankingSection') || document.getElementById('homeRankingSection');
    if (rankingEl) {
      rankingEl.scrollIntoView({ behavior: 'smooth' });
    }
  }, 60);
};

window.openMobileMoreModal = function(event) {
  if (event) event.preventDefault();

  let savedUser = null;
  try {
    savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  } catch (e) {}

  const emailEl = document.getElementById('mMoreUserEmail');
  const adultEl = document.getElementById('mMoreAdultStatus');
  const pointEl = document.getElementById('mMorePointBadge');
  const authLabel = document.getElementById('mMoreAuthLabel');
  const authIcon = document.getElementById('mMoreAuthIcon');

  if (savedUser && savedUser.email) {
    if (emailEl) emailEl.textContent = savedUser.nickname || savedUser.email.split('@')[0];
    const isAdult = !!(savedUser.isAdultVerified || savedUser.is_adult_verified || window._isAdultVerified);
    if (adultEl) adultEl.textContent = isAdult ? '🔞 19+ 성인 인증 완료' : '🔞 성인 미인증';
    const pts = savedUser.points ?? userPoints ?? 1000;
    if (pointEl) pointEl.textContent = `🪙 ${pts.toLocaleString()} P`;
    if (authLabel) authLabel.textContent = '로그아웃';
    if (authIcon) authIcon.setAttribute('data-lucide', 'log-out');
  } else {
    if (emailEl) emailEl.textContent = '로그인이 필요합니다';
    if (adultEl) adultEl.textContent = '🔞 성인 미인증';
    if (pointEl) pointEl.textContent = `🪙 ${(userPoints || 1000).toLocaleString()} P`;
    if (authLabel) authLabel.textContent = '로그인 / 회원가입';
    if (authIcon) authIcon.setAttribute('data-lucide', 'log-in');
  }

  if (typeof openModal === 'function') openModal('modalMobileMore');
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
};

window.handleDirectPortalClick = function(event, portal) {
  if (event) event.preventDefault();
  if (typeof closeModal === 'function') closeModal('modalMobileMore');

  if (portal === 'creator') {
    if (typeof switchWebNovelsView === 'function') switchWebNovelsView('view-creator');
    if (typeof showToast === 'function') showToast('✍️ 작가 전용 스튜디오(/creator)에 접속했습니다.');
  } else if (portal === 'admin') {
    if (typeof switchWebNovelsView === 'function') switchWebNovelsView('view-admin-cms');
    if (typeof showToast === 'function') showToast('🛡️ 관리자 관제탑(/admin)에 접속했습니다.');
  }
};

window.handleMoreAuthClick = function() {
  if (typeof closeModal === 'function') closeModal('modalMobileMore');
  const token = localStorage.getItem('webnovels_token');
  if (token) {
    if (typeof handleUserLogoutProcess === 'function') {
      handleUserLogoutProcess();
    } else {
      localStorage.removeItem('webnovels_token');
      localStorage.removeItem('webnovels_user');
      if (typeof showToast === 'function') showToast('로그아웃 되었습니다.');
      location.reload();
    }
  } else {
    if (typeof openModal === 'function') openModal('modalAuth');
  }
};

window.toggleAdultContentMode = function() {
  const lbl = document.getElementById('mMoreAdultToggleLabel');
  if (lbl) {
    const isCurrentlyOn = lbl.textContent === 'ON';
    lbl.textContent = isCurrentlyOn ? 'OFF' : 'ON';
    lbl.className = isCurrentlyOn ? 'badge badge-outline' : 'badge badge-accent';
    if (typeof showToast === 'function') {
      showToast(isCurrentlyOn ? '19+ 성인 콘텐츠가 필터링(숨김)됩니다.' : '19+ 성인 콘텐츠가 노출됩니다.');
    }
  }
};

/**
 * 3. 전체 애플리케이션 초기화 엔진 (initWebNovelsApp)
 */
async function initWebNovelsApp() {
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  } catch (e) {}

  try {
    bindWebNovelsEvents();
  } catch (e) {
    console.error('[bindWebNovelsEvents Error]', e);
  }

  // 1. [즉시 동기 렌더링] 기본 10개 작품 즉시 화면 표출 (0.01초 렌더링)
  try {
    if (typeof renderHomeWorks === 'function') renderHomeWorks();
    if (typeof renderDiscoverWorks === 'function') renderDiscoverWorks();
    if (typeof renderSearchResults === 'function') renderSearchResults();
    if (typeof renderContinueReadingHome === 'function') renderContinueReadingHome();
    if (typeof initRouteHandler === 'function') initRouteHandler();
  } catch (e) {
    console.error('[Initial Render Error]', e);
  }

  // 2. [비동기 로컬 데이터셋 보강]
  try {
    const localRes = await fetch('/dataset_30_works.json');
    if (localRes.ok) {
      const localData = await localRes.json();
      if (localData.works && localData.works.length >= 30) {
        SAMPLE_WORKS.length = 0;
        SAMPLE_WORKS.push(...localData.works.map(w => ({
          id: Number(w.id),
          title: w.title,
          author: w.author,
          genre: Array.isArray(w.genre) ? w.genre[0] : (w.genre || '판타지'),
          rating: (Array.isArray(w.genre) && w.genre.includes('19세 이상')) || w.rating === 'AGE_19' ? 'AGE_19' : 'ALL',
          aiUsageType: 'NONE',
          contentType: w.contentType || 'NOVEL',
          coverUrl: w.coverImage ? (w.coverImage.startsWith('/') ? w.coverImage : `/images/${w.coverImage}`) : '/images/stormqueen_oath.jpg',
          description: w.description || '',
          viewCount: Number(w.viewCount ?? w.view_count ?? 0),
          episodesCount: 6,
          isCompleted: !!(w.isCompleted || w.is_completed),
          isTopRecommended: !!(w.isTopRecommended || w.is_top_recommended),
          isPopularWork: !!(w.isPopularWork || w.is_popular_work),
          isNewWork: !!(w.isNewWork || w.is_new_work),
          episodes: createDefault6Episodes(w.title)
        })));
        if (localData.readers) {
          SAMPLE_READERS.length = 0;
          SAMPLE_READERS.push(...localData.readers);
        }
        if (localData.creators || localData.authors) {
          const cList = localData.creators || localData.authors;
          if (typeof SAMPLE_CREATORS !== 'undefined') {
            SAMPLE_CREATORS.length = 0;
            SAMPLE_CREATORS.push(...cList);
          }
          if (typeof SAMPLE_AUTHORS !== 'undefined') {
            SAMPLE_AUTHORS.length = 0;
            SAMPLE_AUTHORS.push(...cList);
          }
        }
        if (typeof renderHomeWorks === 'function') renderHomeWorks();
        if (typeof renderDiscoverWorks === 'function') renderDiscoverWorks();
      }
    }
  } catch(e) {}

  // 3. [Supabase 실시간 DB 연동]
  if (window.WebNovelsAdmin) {
    try {
      window.WebNovelsAdmin.init();
      const remoteWorks = await window.WebNovelsAdmin.fetchWorksFromSupabase();
      if (remoteWorks && remoteWorks.length > 0) {
        console.log('⚡ [App Init] Supabase DB 실시간 30개 작품 로드 성공:', remoteWorks.length);
        SAMPLE_WORKS.length = 0;
        SAMPLE_WORKS.push(...remoteWorks);
        if (typeof renderHomeWorks === 'function') renderHomeWorks();
        if (typeof renderDiscoverWorks === 'function') renderDiscoverWorks();
        if (typeof renderSearchResults === 'function') renderSearchResults();
      }
    } catch(err) {
      console.warn('[App Init] Supabase 작품 로드 예외:', err);
    }

    try {
      const remoteReaders = await window.WebNovelsAdmin.fetchReadersFromSupabase();
      if (remoteReaders && remoteReaders.length > 0) {
        SAMPLE_READERS.length = 0;
        SAMPLE_READERS.push(...remoteReaders);
      }
      const fetchCreators = window.WebNovelsAdmin.fetchCreatorsFromSupabase || window.WebNovelsAdmin.fetchAuthorsFromSupabase;
      const remoteCreators = await fetchCreators();
      if (remoteCreators && remoteCreators.length > 0) {
        if (typeof SAMPLE_CREATORS !== 'undefined') {
          SAMPLE_CREATORS.length = 0;
          SAMPLE_CREATORS.push(...remoteCreators);
        }
        if (typeof SAMPLE_AUTHORS !== 'undefined') {
          SAMPLE_AUTHORS.length = 0;
          SAMPLE_AUTHORS.push(...remoteCreators);
        }
      }
    } catch(err) {}
  }

  // Event-Driven 실시간 데이터 변경 리스너 등록
  window.addEventListener('webnovels:works-changed', async (e) => {
    console.log('[Event-Driven Realtime] works-changed 이벤트 수신 -> 전체 UI 동기화');
    if (window.WebNovelsAdmin) {
      const updated = await window.WebNovelsAdmin.fetchWorksFromSupabase();
      if (updated && updated.length > 0) {
        SAMPLE_WORKS.length = 0;
        SAMPLE_WORKS.push(...updated);
      }
    }
    if (typeof renderHomeWorks === 'function') renderHomeWorks();
    if (typeof renderDiscoverWorks === 'function') renderDiscoverWorks();
    if (typeof renderSearchResults === 'function') renderSearchResults();
    if (currentActiveView === 'view-admin-cms') {
      if (typeof renderAdminWorks === 'function') renderAdminWorks();
      if (typeof loadDashboardKPIs === 'function') loadDashboardKPIs();
    }
  });

  window.addEventListener('webnovels:episodes-changed', async (e) => {
    console.log('[Event-Driven Realtime] episodes-changed 이벤트 수신 -> 회차 UI 동기화', e.detail);
    if (window.WebNovelsAdmin) {
      const updated = await window.WebNovelsAdmin.fetchWorksFromSupabase();
      if (updated && updated.length > 0) {
        SAMPLE_WORKS.length = 0;
        SAMPLE_WORKS.push(...updated);
      }
    }
    const currentWorkId = document.getElementById('adminEpisodeWorkSelect')?.value;
    if (currentWorkId && typeof renderAdminEpisodes === 'function') {
      renderAdminEpisodes(currentWorkId);
    }
    if (typeof renderHomeWorks === 'function') renderHomeWorks();
    if (currentActiveView === 'view-admin-cms' && typeof loadDashboardKPIs === 'function') {
      loadDashboardKPIs();
    }
  });

  window.addEventListener('webnovels:readers-changed', async (e) => {
    console.log('[Event-Driven Realtime] readers-changed 이벤트 수신 -> 독자 목록 UI 동기화');
    if (typeof loadAdminUsers === 'function') {
      await loadAdminUsers(true);
    }
  });

  const onCreatorsChanged = async () => {
    console.log('[Event-Driven Realtime] creators-changed 이벤트 수신 -> 크리에이터 목록 UI 동기화');
    if (typeof loadAdminCreators === 'function') {
      await loadAdminCreators(true);
    } else if (typeof loadAdminAuthors === 'function') {
      await loadAdminAuthors(true);
    }
  };
  window.addEventListener('webnovels:creators-changed', onCreatorsChanged);
  window.addEventListener('webnovels:authors-changed', onCreatorsChanged);

  // 로그인 프로필 세션 복원 및 헤더 동기화
  if (typeof loadMyProfile === 'function') await loadMyProfile();
  if (typeof renderLibraryContent === 'function') renderLibraryContent();
}

/**
 * 4. Safe Multi-Stage Bootstrap Runner
 */
function runBootstrap() {
  try {
    initWebNovelsApp();
  } catch (err) {
    console.error('[WebNovels Bootstrap Error]', err);
  }
}

// 5. 웹소켓 기반 다중 브라우저 실시간 UI 자동 동기화
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    if (window.WebNovelsAdmin?.setupRealtimeSubscriptions) {
      window.WebNovelsAdmin.setupRealtimeSubscriptions({
        onWorksChange: async (payload) => {
          console.log('⚡ [Realtime UI] Works 갱신 수신:', payload.eventType);
          if (window.WebNovelsAdmin?.fetchWorksFromSupabase) {
            const dbWorks = await window.WebNovelsAdmin.fetchWorksFromSupabase();
            if (dbWorks && dbWorks.length > 0) {
              SAMPLE_WORKS.length = 0;
              SAMPLE_WORKS.push(...dbWorks);
              if (typeof renderHomeRankingList === 'function') renderHomeRankingList();
              if (typeof renderDiscoverGrid === 'function') renderDiscoverGrid();
            }
          }
          if (typeof window.loadDashboardKPIs === 'function') window.loadDashboardKPIs();
        },
        onEpisodesChange: async (payload) => {
          console.log('⚡ [Realtime UI] Episodes 갱신 수신:', payload.eventType);
          if (typeof window.loadDashboardKPIs === 'function') window.loadDashboardKPIs();
        },
        onSettlementsChange: (payload) => {
          console.log('⚡ [Realtime UI] Settlements 갱신 수신:', payload.eventType);
          if (typeof window.loadSettlementsList === 'function') window.loadSettlementsList();
          if (typeof window.loadDashboardKPIs === 'function') window.loadDashboardKPIs();
        },
        onReportsChange: (payload) => {
          console.log('⚡ [Realtime UI] Reports 갱신 수신:', payload.eventType);
          if (typeof window.renderDashboardActionQueuePreview === 'function') {
            window.renderDashboardActionQueuePreview();
          }
        }
      });
    }
  });
}

// 6. DOMContentLoaded 또는 readyState 기반 즉시 기동
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runBootstrap);
  } else {
    runBootstrap();
  }
}
