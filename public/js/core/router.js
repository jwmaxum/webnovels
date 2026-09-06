// ============================================================
// [Core Router Engine] public/js/core/router.js
//
// [Purpose]
// - 계층적 Semantic URL 라우터 엔진 (improve1.md 명세 준수)
// - 뷰 전환(switchWebNovelsView), History popstate 및 PushState 동기화
// - 딥링크(/works/:id, /read/:workId/:epNum, /library/:tab, /creator/:sub, /admin/:sub) 해석
// - 사이드바 및 모바일/PC 네비게이션 라우팅 연동
// ============================================================

/**
 * 1. SPA 메인 뷰 전환기 (switchWebNovelsView)
 */
function switchWebNovelsView(viewId, activeLink, shouldPushState = true) {
  // 관리자 메뉴 접근 시 로그인 검증
  const adminLoggedIn = typeof isAdminLoggedIn !== 'undefined' ? isAdminLoggedIn : !!localStorage.getItem('webnovels_admin_token');
  if (viewId === 'view-admin-cms' && !adminLoggedIn) {
    if (typeof openModal === 'function') openModal('modalAdminLogin');
    return;
  }

  // 내 서재 접근 시 로그인 체크
  if (viewId === 'view-mypage') {
    const token = localStorage.getItem('webnovels_token');
    if (!token) {
      if (typeof showToast === 'function') showToast('로그인이 필요한 서비스입니다.');
      if (typeof openModal === 'function') openModal('modalAuth');
      return;
    }
  }

  // 이전 메인 뷰 기억 (상세 화면이나 뷰어에서 뒤로가기용)
  if (currentActiveView !== 'view-work-detail' && currentActiveView !== 'view-reader') {
    lastMainView = currentActiveView;
    window.lastMainView = lastMainView;
  }
  currentActiveView = viewId;
  window.currentActiveView = currentActiveView;

  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));

  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
    if (activeLink) {
      activeLink.classList.add('active');
    }
    // viewId에 매칭되는 모든 상단/하단 네비게이션 링크 활성화
    document.querySelectorAll(`[data-target="${viewId}"]`).forEach(el => el.classList.add('active'));
  }

  // 작가 스튜디오 진입 시 데이터 로드
  if (viewId === 'view-creator' && typeof fetchCreatorDashboardData === 'function') {
    fetchCreatorDashboardData();
  }

  // 내 서재 진입 시 렌더링
  if (viewId === 'view-mypage' && typeof renderLibraryContent === 'function') {
    renderLibraryContent();
  }

  // 관리자 CMS 진입 시 대시보드 로드
  if (viewId === 'view-admin-cms' && adminLoggedIn && typeof loadAdminDashboard === 'function') {
    loadAdminDashboard();
  }

  // 페이지 상단으로 스크롤 이동
  window.scrollTo({ top: 0, behavior: 'instant' });

  // 포털 분리 풀스크린 모드 제어
  if (viewId === 'view-creator' || viewId === 'view-admin-cms') {
    document.body.classList.add('portal-fullscreen-mode');
  } else {
    document.body.classList.remove('portal-fullscreen-mode');
  }

  // Semantic URL 동기화
  if (shouldPushState) {
    let targetPath = null;
    if (viewId === 'view-home') targetPath = '/home';
    else if (viewId === 'view-discover') targetPath = '/discover';
    else if (viewId === 'view-mypage') targetPath = '/library';
    else if (viewId === 'view-creator') targetPath = '/creator';
    else if (viewId === 'view-admin-cms') targetPath = '/admin';

    if (targetPath && !window.location.pathname.startsWith(targetPath)) {
      try { window.history.pushState({ view: viewId, path: targetPath }, '', targetPath); } catch(e) {}
    }
  }

  // 데스크톱 사이드바 활성 탭 동기화
  document.querySelectorAll('.sidebar-nav-item, .cdg-sidebar-item').forEach(item => {
    const target = item.getAttribute('data-side-target') || item.getAttribute('data-target');
    if (target === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // 홈 뷰 복귀 시 최상단 '계속 읽기' 카드 갱신
  if (viewId === 'view-home' && typeof renderContinueReadingHome === 'function') {
    renderContinueReadingHome();
  }
}
window.switchWebNovelsView = switchWebNovelsView;

/**
 * 2. 계층적 Semantic URL 라우터 해석기 (resolveRoute)
 */
function resolveRoute(pathname, isInitial = false) {
  const rawPath = (pathname || window.location.pathname || '/').toLowerCase();
  const hash = (window.location.hash || '').toLowerCase();
  const path = rawPath.replace(/\/$/, '') || '/';
  const parts = path.split('/').filter(Boolean);

  console.log(`🧭 [SPA Semantic Router] Resolving route: "${path}" (initial: ${isInitial})`);

  // 1. 홈 경로 (/ 또는 /home)
  if (parts.length === 0 || parts[0] === 'home' || hash === '#home') {
    switchWebNovelsView('view-home', null, false);
    return;
  }

  // 2. 탐색 경로 (/discover)
  if (parts[0] === 'discover' || hash === '#discover') {
    switchWebNovelsView('view-discover', null, false);
    return;
  }

  // 3. 작품 상세 경로 (/works/:id)
  if (parts[0] === 'works') {
    const workId = parts[1] ? Number(parts[1]) : 1;
    if (typeof openWorkDetailDirect === 'function') {
      openWorkDetailDirect(workId, false);
    } else {
      switchWebNovelsView('view-work-detail', null, false);
    }
    return;
  }

  // 4. 회차 읽기 경로 (/read/:workId/:epNum)
  if (parts[0] === 'read') {
    const workId = parts[1] ? Number(parts[1]) : 1;
    const epNum = parts[2] ? Number(parts[2]) : 1;
    if (typeof openReaderDirect === 'function') {
      openReaderDirect(workId, epNum, false);
    } else if (typeof openEpisodeDirect === 'function') {
      openEpisodeDirect(workId, epNum, false);
    } else {
      switchWebNovelsView('view-reader', null, false);
    }
    return;
  }

  // 5. 내 서재 경로 (/library 또는 /library/:tab)
  if (parts[0] === 'library' || hash === '#library') {
    const subTab = parts[1] || 'continue'; // continue, favorites, authors
    switchWebNovelsView('view-mypage', null, false);
    if (typeof openLibraryTabDirect === 'function') {
      openLibraryTabDirect(subTab, false);
    }
    return;
  }

  // 6. 작가센터 경로 (/creator 또는 /creator/:sub)
  if (parts[0] === 'creator' || hash === '#creator') {
    const subTab = parts[1] || 'works';
    switchWebNovelsView('view-creator', null, false);
    if (typeof switchCreatorTab === 'function') {
      const tabMap = {
        'works': 'works',
        'episodes': 'new-ep',
        'status': 'status',
        'stats': 'stats',
        'settlement': 'settlements',
        'settlements': 'settlements'
      };
      const actualTab = tabMap[subTab] || subTab;
      switchCreatorTab(actualTab, false);
    }
    return;
  }

  // 7. 관리자 CMS 경로 (/admin 또는 /admin/:sub)
  if (parts[0] === 'admin' || hash === '#admin') {
    const subTab = parts[1] || 'dashboard';
    switchWebNovelsView('view-admin-cms', null, false);
    if (typeof switchAdminSubTab === 'function') {
      switchAdminSubTab(subTab, false);
    }
    return;
  }

  // 기본 매칭 실패 시 홈으로 fallback
  switchWebNovelsView('view-home', null, false);
}
window.resolveRoute = resolveRoute;

/**
 * 3. 프로그래밍 방식 URL 이동 (navigateTo)
 */
function navigateTo(path, pushState = true) {
  if (pushState && window.location.pathname !== path) {
    try {
      window.history.pushState({ path }, '', path);
    } catch (e) {}
  }
  resolveRoute(path, false);
}
window.navigateTo = navigateTo;

/**
 * 4. 라우터 리스너 초기화 (initRouteHandler)
 */
function initRouteHandler() {
  resolveRoute(window.location.pathname, true);

  window.addEventListener('popstate', () => {
    resolveRoute(window.location.pathname, false);
  });
}
window.initRouteHandler = initRouteHandler;

/**
 * 5. 내 서재 특정 탭으로 바로 이동 (openLibraryTabDirect)
 */
function openLibraryTabDirect(tabName, shouldPushState = true) {
  if (typeof closeModal === 'function') closeModal('modalMobileMore');
  switchWebNovelsView('view-mypage', null, false);
  if (shouldPushState) {
    const targetUrl = tabName === 'continue' ? '/library' : `/library/${tabName}`;
    if (window.location.pathname !== targetUrl) {
      try { window.history.pushState({ path: targetUrl }, '', targetUrl); } catch (e) {}
    }
  }
  setTimeout(() => {
    const tabBtn = document.querySelector(`.library-tabs button[data-library-tab="${tabName}"]`);
    if (tabBtn) tabBtn.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 50);
}
window.openLibraryTabDirect = openLibraryTabDirect;

/**
 * 6. 장르 탐색 뷰 바로 열기 (openGenreDiscover)
 */
function openGenreDiscover(genre) {
  switchWebNovelsView('view-discover');
  setTimeout(() => {
    const pills = document.querySelectorAll('.filter-pills .pill');
    let matched = false;
    pills.forEach(pill => {
      if (pill.textContent.trim() === genre) {
        pill.click();
        matched = true;
      }
    });
    if (!matched && pills[0]) pills[0].click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 50);
}
window.openGenreDiscover = openGenreDiscover;

/**
 * 7. 기타 사이드바 / 회차 연동 헬퍼
 */
window.openNovelFilterHome = function() {
  switchWebNovelsView('view-discover');
  setTimeout(() => {
    const pills = document.querySelectorAll('.filter-pills .pill');
    if (pills && pills[0]) pills[0].click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 50);
};

window.scrollToSection = function(sectionId) {
  if (currentActiveView !== 'view-home') {
    switchWebNovelsView('view-home');
  }
  setTimeout(() => {
    let el = document.getElementById(sectionId);
    if (!el && sectionId === 'trendingWorksSection') el = document.getElementById('curatedRankingSection') || document.querySelector('.trending-section');
    if (!el && sectionId === 'webtoonsSection') el = document.querySelector('.webtoons-section') || document.getElementById('discoverWorksGrid');
    if (!el && sectionId === 'newWorksSection') el = document.querySelector('.new-works-section') || document.getElementById('homeWorksGrid');
    if (!el && sectionId === 'completedWorksSection') el = document.querySelector('.completed-section') || document.getElementById('homeWorksGrid');

    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 350, behavior: 'smooth' });
    }
  }, 60);
};

window.openLibraryTab = function(tabName) {
  openLibraryTabDirect(tabName);
};

window.openTopContinueReading = function() {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]');
  } catch (e) {}

  if (history && history.length > 0) {
    const latest = history[0];
    openEpisodeDirect(latest.workId, latest.epNum || 1);
  } else {
    openEpisodeDirect(SAMPLE_WORKS[0].id, 1);
  }
};

window.openEpisodeDirect = function(workId, epNum) {
  if (typeof window.openReaderDirect === 'function') {
    window.openReaderDirect(workId, epNum);
  } else if (typeof openWorkDetailDirect === 'function') {
    openWorkDetailDirect(workId);
  }
};
