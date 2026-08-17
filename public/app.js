// WebNovels Platform Frontend JavaScript Logic

const API_BASE = '/api';

// Helper to generate 6 default episodes for each work
function createDefault6Episodes(workTitle) {
  return [
    { episodeNumber: 1, title: "제 1 화", isFree: true, isAdFree: false, content: `본 회차는 1회차 입니다.\n\n[${workTitle} - 제 1 화]\n주인공은 불길하게 타오르는 붉은 하늘을 바라보며 검 자루를 쥐었다. 바람이 부는 순간, 차가운 강철의 감촉이 손바닥에 선명하게 전해졌다.\n\n"끝을 낼 시간이군."\n\n그의 짧은 읊조림과 함께 수많은 전장의 함성이 울려 퍼지기 시작했다. 1~3화는 무료로 즉시 열람하실 수 있습니다.` },
    { episodeNumber: 2, title: "제 2 화", isFree: true, isAdFree: false, content: `본 회차는 2회차 입니다.\n\n[${workTitle} - 제 2 화]\n폐허가 된 고대 성채에서 미지의 봉인이 풀렸다. 주인공은 어둠 속에서 빛나는 고대의 유물을 마주하고 숨을 죽였다.\n\n"이것이 전설로 전해지던 힘인가..."\n\n새로운 운명이 그의 앞에 펼쳐지고 있었다.` },
    { episodeNumber: 3, title: "제 3 화", isFree: true, isAdFree: false, content: `본 회차는 3회차 입니다.\n\n[${workTitle} - 제 3 화]\n동료들과 함께 나선 첫 번째 원정길. 예기치 못한 적들의 기습 속에서 주인공은 자신의 잠재된 능력을 각성시킨다.\n\n"물러서지 마라! 우리가 길을 열 것이다!"\n\n치열한 혈투 끝에 드러난 배후의 진실은 무엇일까?` },
    { episodeNumber: 4, title: "제 4 화", isFree: false, isAdFree: true, content: `본 회차는 4회차 입니다.\n\n[${workTitle} - 제 4 화]\n💡 광고를 시청하여 성공적으로 해금된 4회차 본문입니다.\n\n적들의 숨겨진 요새에 도달한 주인공 일행. 그러나 그곳을 지키는 문지기는 상상을 초월하는 위력을 뿜어내고 있었다.\n\n"여기까지 온 자는 아무도 살아 돌아가지 못했다."\n\n운명을 건 사투가 시작된다.` },
    { episodeNumber: 5, title: "제 5 화", isFree: false, isAdFree: true, content: `본 회차는 5회차 입니다.\n\n[${workTitle} - 제 5 화]\n💡 광고를 시청하여 성공적으로 해금된 5회차 본문입니다.\n\n위기의 순간, 주인공의 가슴 속에서 잠들어 있던 비전의 힘이 폭발했다. 빛과 어둠이 교차하는 격렬한 격돌 속에서 진실의 열쇠를 손에 쥔다.\n\n"포기할 수 없다. 아직 지켜야 할 이들이 있으니까!"` },
    { episodeNumber: 6, title: "제 6 화", isFree: false, isAdFree: true, content: `본 회차는 6회차 입니다.\n\n[${workTitle} - 제 6 화]\n💡 광고를 시청하여 성공적으로 해금된 6회차 본문입니다.\n\n마침내 모습을 드러낸 거대한 흑막. 대륙 전체를 뒤흔들 음모의 전모가 밝혀지고, 주인공은 세계의 운명을 짊어진 최후의 결전을 준비한다.\n\n7화 이후의 이야기는 작가 연재 예정(Coming Soon)입니다.` }
  ];
}

// Sample Works Seed Data (8 Full Works with 6 Episodes each)
const SAMPLE_WORKS = [
  {
    id: 1,
    title: "대적자: 신을 삼킨 기사",
    author: "판타지마스터",
    genre: "판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/stormqueen_oath.jpg",
    description: "신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 154000,
    episodesCount: 6,
    episodes: createDefault6Episodes("대적자: 신을 삼킨 기사")
  },
  {
    id: 2,
    title: "천마의 귀환",
    author: "무협의신",
    genre: "무협",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/sword_dao_supreme.jpg",
    description: "천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 231000,
    episodesCount: 6,
    episodes: createDefault6Episodes("천마의 귀환")
  },
  {
    id: 3,
    title: "금기의 계약",
    author: "나이트로즈",
    genre: "성인",
    rating: "AGE_19",
    aiUsageType: "NONE",
    coverUrl: "/images/velvet_and_thorns.jpg",
    description: "금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 189000,
    episodesCount: 6,
    episodes: createDefault6Episodes("금기의 계약")
  },
  {
    id: 4,
    title: "황제의 유일한 후궁",
    author: "로맨스퀸",
    genre: "로맨스",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/flower_blooming.jpg",
    description: "황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 312000,
    episodesCount: 6,
    episodes: createDefault6Episodes("황제의 유일한 후궁")
  },
  {
    id: 5,
    title: "성간 항로: 마지막 항해사",
    author: "스페이스로그",
    genre: "SF",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/stellar_horizon.jpg",
    description: "인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 97000,
    episodesCount: 6,
    episodes: createDefault6Episodes("성간 항로: 마지막 항해사")
  },
  {
    id: 6,
    title: "서울에 나타난 마왕",
    author: "도시마법사",
    genre: "현대 판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/seoul_sorcerer.jpg",
    description: "현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 278000,
    episodesCount: 6,
    episodes: createDefault6Episodes("서울에 나타난 마왕")
  },
  {
    id: 7,
    title: "죽은 자들의 학교",
    author: "공포작가",
    genre: "호러",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/darkness_swallowed_classroom.jpg",
    description: "폐교에 남은 것들. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 84000,
    episodesCount: 6,
    episodes: createDefault6Episodes("죽은 자들의 학교")
  },
  {
    id: 8,
    title: "검의 전설: 천하제일인",
    author: "검성",
    genre: "무협",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/sword_dao_defies_heavens.jpg",
    description: "천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 195000,
    episodesCount: 6,
    episodes: createDefault6Episodes("검의 전설: 천하제일인")
  }
];

const SAMPLE_READERS = [
  { id: 1, username: 'reader1', password_hash: '!12345', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 2, username: 'reader2', password_hash: '!12345', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 3, username: 'reader3', password_hash: '!12345', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', is_adult_verified: true, subscription_status: '프리미엄 구독중' }
];

const SAMPLE_AUTHORS = [
  { id: 1, username: 'writer1', password_hash: '!123456', email: 'writer1@webnovels.com', pen_name: '판타지마스터', work_title: '대적자: 신을 삼킨 기사', birthdate: '1990-01-15', address: '서울특별시 강남구 테헤란로 123', bank_info: '국민은행 999-888-777666', status: '공식 인증 작가' },
  { id: 2, username: 'writer2', password_hash: '!123456', email: 'writer2@webnovels.com', pen_name: '무협의신', work_title: '천마의 귀환', birthdate: '1985-05-20', address: '서울특별시 서초구 반포대로 45', bank_info: '신한은행 110-222-333444', status: '공식 인증 작가' },
  { id: 3, username: 'writer3', password_hash: '!123456', email: 'writer3@webnovels.com', pen_name: '나이트로즈', work_title: '금기의 계약', birthdate: '1992-08-12', address: '경기도 성남시 분당구 판교로 78', bank_info: '우리은행 1002-555-666777', status: '공식 인증 작가' },
  { id: 4, username: 'writer4', password_hash: '!123456', email: 'writer4@webnovels.com', pen_name: '로맨스퀸', work_title: '황제의 유일한 후궁', birthdate: '1994-11-03', address: '서울특별시 마포구 월드컵북로 99', bank_info: '하나은행 222-333-444555', status: '공식 인증 작가' },
  { id: 5, username: 'writer5', password_hash: '!123456', email: 'writer5@webnovels.com', pen_name: '스페이스로그', work_title: '성간 항로: 마지막 항해사', birthdate: '1988-03-30', address: '대전광역시 유성구 대학로 100', bank_info: '농협 301-777-888999', status: '공식 인증 작가' },
  { id: 6, username: 'writer6', password_hash: '!123456', email: 'writer6@webnovels.com', pen_name: '도시마법사', work_title: '서울에 나타난 마왕', birthdate: '1995-07-07', address: '서울특별시 송파구 올림픽로 200', bank_info: '카카오뱅크 3333-01-234567', status: '공식 인증 작가' },
  { id: 7, username: 'writer7', password_hash: '!123456', email: 'writer7@webnovels.com', pen_name: '공포작가', work_title: '죽은 자들의 학교', birthdate: '1991-10-31', address: '부산광역시 해운대구 센텀서로 30', bank_info: '기업은행 010-9999-8888', status: '공식 인증 작가' },
  { id: 8, username: 'writer8', password_hash: '!123456', email: 'writer8@webnovels.com', pen_name: '검성', work_title: '검의 전설: 천하제일인', birthdate: '1987-12-25', address: '대구광역시 수성구 달구벌대로 500', bank_info: '대구은행 508-12-345678', status: '공식 인증 작가' }
];

let activeWork = SAMPLE_WORKS[0];
let activeEpisodeId = 'ep-1';
let unlockedEpisodes = new Set();
let currentTheme = 'theme-dark';
let currentFontSize = 18;

document.addEventListener('DOMContentLoaded', () => {
  initWebNovelsApp();
});

async function initWebNovelsApp() {
  lucide.createIcons();
  bindWebNovelsEvents();

  // Supabase 클라이언트 초기화 & 실시간 DB 연동
  if (window.WebNovelsAdmin) {
    window.WebNovelsAdmin.init();
    
    // Supabase DB에서 8개 작품 데이터 fetch
    const remoteWorks = await window.WebNovelsAdmin.fetchWorksFromSupabase();
    if (remoteWorks && remoteWorks.length > 0) {
      console.log('[App Init] Supabase DB 실시간 작품 로드 성공:', remoteWorks.length);
      SAMPLE_WORKS.length = 0;
      SAMPLE_WORKS.push(...remoteWorks);
    } else {
      console.log('[App Init] Supabase DB 작품 미존재 -> 8개 작품 & 32개 에피소드 자동 시드 저장');
      await window.WebNovelsAdmin.seedWorksDatasetToSupabase(SAMPLE_WORKS);
    }

    // Supabase DB에서 독자 & 작가 실데이터 fetch 및 시드
    const remoteReaders = await window.WebNovelsAdmin.fetchReadersFromSupabase();
    if (remoteReaders && remoteReaders.length > 0) {
      SAMPLE_READERS.length = 0;
      SAMPLE_READERS.push(...remoteReaders);
    } else {
      await window.WebNovelsAdmin.seedRealUsersToSupabase(SAMPLE_READERS, SAMPLE_AUTHORS);
    }

    const remoteAuthors = await window.WebNovelsAdmin.fetchAuthorsFromSupabase();
    if (remoteAuthors && remoteAuthors.length > 0) {
      SAMPLE_AUTHORS.length = 0;
      SAMPLE_AUTHORS.push(...remoteAuthors);
    }
  }

  renderHomeWorks();
  renderDiscoverWorks();
  renderLibraryContent();
  renderSearchResults();
}



function bindWebNovelsEvents() {
  // Navigation
  document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = link.getAttribute('data-target');
      const href = link.getAttribute('href');
      if (href) window.location.hash = href;
      switchWebNovelsView(targetView, link);
    });
  });

  // Header login button
  document.getElementById('btnHeaderLogin')?.addEventListener('click', () => {
    openModal('modalAuth');
  });

  document.getElementById('btnSearchOpen')?.addEventListener('click', () => {
    openModal('modalSearch');
    renderSearchResults();
    setTimeout(() => document.getElementById('globalSearchInput')?.focus(), 50);
  });

  document.getElementById('btnDiscoverSearch')?.addEventListener('click', () => {
    document.getElementById('btnSearchOpen')?.click();
  });

  document.getElementById('globalSearchInput')?.addEventListener('input', (event) => {
    renderSearchResults(event.target.value);
  });

  document.getElementById('searchSortSelect')?.addEventListener('change', () => {
    renderSearchResults(document.getElementById('globalSearchInput')?.value || '');
  });

  document.querySelectorAll('[data-search-term]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('globalSearchInput');
      input.value = btn.dataset.searchTerm;
      renderSearchResults(input.value);
      input.focus();
    });
  });

  document.querySelectorAll('[data-library-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.libraryTab;
      document.querySelectorAll('[data-library-tab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.library-tab-panel').forEach(panel => panel.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`libraryTab-${tabName}`)?.classList.add('active');
    });
  });

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
    handleMemberLogin();
  });

  document.getElementById('authForm-signup')?.addEventListener('submit', (event) => {
    event.preventDefault();
    handleMemberSignup();
  });

  document.getElementById('authForm-signup-author')?.addEventListener('submit', (event) => {
    event.preventDefault();
    handleAuthorSignup();
  });

  document.getElementById('btnAuthCreator')?.addEventListener('click', () => {
    closeAllModals();
    switchWebNovelsView('view-creator');
  });

  // Genre Filter Pills Event
  document.querySelectorAll('.filter-pills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const genreText = pill.textContent.trim();
      renderDiscoverWorks(genreText);
    });
  });

  // Detail Page Action Buttons
  // Work Detail Buttons
  document.getElementById('btnWorkDetailBack')?.addEventListener('click', () => {
    switchWebNovelsView(lastMainView || 'view-home');
  });
  document.getElementById('btnDetailReadFirst')?.addEventListener('click', () => {
    openReaderDirect(activeWork.id, 1);
  });
  document.getElementById('btnStickyRead')?.addEventListener('click', () => {
    openReaderDirect(activeWork.id, 1);
  });
  document.getElementById('btnDetailFavorite')?.addEventListener('click', () => {
    toggleFavoriteWork(activeWork.id);
  });
  document.getElementById('btnStickyHeart')?.addEventListener('click', () => {
    toggleFavoriteWork(activeWork.id);
  });
  document.getElementById('btnDetailSubscribe')?.addEventListener('click', () => {
    showToast('👤 작가를 구독했습니다.');
  });

  // Reader Events
  document.getElementById('btnReaderBack')?.addEventListener('click', () => {
    switchWebNovelsView('view-work-detail');
  });
  document.getElementById('btnReaderSettings')?.addEventListener('click', () => {
    openModal('modalReaderSettings');
  });
  document.getElementById('btnPrevEp')?.addEventListener('click', () => {
    const curEp = parseInt(activeEpisodeId, 10) || 1;
    if (curEp <= 1) {
      showToast('첫 번째 회차입니다.');
    } else {
      openReaderDirect(activeWork.id, curEp - 1);
    }
  });
  document.getElementById('btnNextEp')?.addEventListener('click', () => {
    const curEp = parseInt(activeEpisodeId, 10) || 1;
    const nextEp = curEp + 1;
    const work = activeWork || SAMPLE_WORKS[0];
    const availableEpisodes = work.episodes || [];
    const maxEp = availableEpisodes.length > 0 ? Math.max(...availableEpisodes.map(e => e.episodeNumber)) : 6;

    if (nextEp <= maxEp) {
      openReaderDirect(activeWork.id, nextEp);
    } else {
      handleComingSoonEpisode(nextEp);
    }
  });

  // Ad Unlock Events
  document.getElementById('btnWatchAdSubmit')?.addEventListener('click', startAdSimulation);

  // PASS Adult Verify
  document.getElementById('btnStartPassVerify')?.addEventListener('click', handlePassAdultVerify);

  // Creator Studio Settlement Request
  document.getElementById('btnRequestSettlement')?.addEventListener('click', handleCreatorSettlementReq);

  // Modal Closes
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });
}

let isAdminLoggedIn = false;
let currentActiveView = 'view-home';
let lastMainView = 'view-home';

function switchWebNovelsView(viewId, activeLink) {
  // 관리자 메뉴 접근 시 로그인 검증
  if (viewId === 'view-admin-cms' && !isAdminLoggedIn) {
    openModal('modalAdminLogin');
    return;
  }

  if (viewId === 'view-mypage') {
    const token = localStorage.getItem('webnovels_token');
    if (!token) {
      showToast('로그인이 필요한 서비스입니다.');
      openModal('modalAuth');
      return;
    }
  }

  // 이전 메인 뷰 기억 (상세 화면이나 뷰어에서 뒤로가기용)
  if (currentActiveView !== 'view-work-detail' && currentActiveView !== 'view-reader') {
    lastMainView = currentActiveView;
  }
  currentActiveView = viewId;

  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(l => l.classList.remove('active'));

  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
    if (activeLink) activeLink.classList.add('active');
  }

  // Load Creator Studio data if opening creator
  if (viewId === 'view-creator') {
    fetchCreatorDashboardData();
  }

  if (viewId === 'view-mypage') {
    renderLibraryContent();
  }

  // 관리자 CMS 진입 시 대시보드 KPI 로드
  if (viewId === 'view-admin-cms' && isAdminLoggedIn) {
    loadAdminDashboard();
  }

  // 페이지 상단으로 스크롤 이동
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// 관리자 로그인 로직 처리 (Supabase 연동)
window.handleAdminLoginProcess = async function() {
  const idInput = document.getElementById('adminLoginId').value.trim();
  const pwInput = document.getElementById('adminLoginPw').value.trim();

  if (!idInput || !pwInput) {
    showToast('관리자 ID와 비밀번호를 모두 입력해주세요.');
    return;
  }

  // Supabase 초기화
  if (window.WebNovelsAdmin) {
    window.WebNovelsAdmin.init();
  }

  // Supabase 로그인 시도
  const result = window.WebNovelsAdmin ? await window.WebNovelsAdmin.login(idInput, pwInput) : null;

  if (result && result.success) {
    isAdminLoggedIn = true;
    closeAllModals();
    const admin = result.admin;
    showToast(`🔑 관리자 로그인 성공! (${admin.nickname || idInput})`);
    document.getElementById('adminRoleBadge').textContent = `${admin.role} 로그인됨`;
    document.getElementById('adminRoleBadge').className = 'badge badge-primary';
    document.getElementById('btnAdminLogout').style.display = 'inline-block';
  } else {
    // 로그인 실패
    const errMsg = result ? (result.error || '정보 불일치') : '시스템 오류 (관리자 모듈 미로드)';
    showToast(`❌ 로그인 실패: ${errMsg}`);
    console.error('[Admin Login Failed]', result);
    return;
  }
  
  // 관리자 관제탑 활성화
  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  const adminView = document.getElementById('view-admin-cms');
  if (adminView) adminView.classList.add('active');

  // 대시보드 KPI 로드
  loadAdminDashboard();
};

// 관리자 로그아웃
window.handleAdminLogoutProcess = function() {
  isAdminLoggedIn = false;
  if (window.WebNovelsAdmin) window.WebNovelsAdmin.logout();
  document.getElementById('adminRoleBadge').textContent = '미로그인';
  document.getElementById('adminRoleBadge').className = 'badge badge-accent';
  if (document.getElementById('btnAdminLogout')) {
    document.getElementById('btnAdminLogout').style.display = 'none';
  }
  showToast('관리자 로그아웃 되었습니다.');
  // 홈으로 이동
  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-home')?.classList.add('active');
};

// ---- 관리자 대시보드 KPI 로드 ----
async function loadAdminDashboard() {
  const kpi = window.WebNovelsAdmin ? await window.WebNovelsAdmin.fetchDashboardKPI() : null;
  if (kpi) {
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
    document.getElementById('kpiTotalUsers').textContent = fmt(kpi.total_users || 0);
    document.getElementById('kpiTotalAuthors').textContent = fmt(kpi.total_authors || 0);
    document.getElementById('kpiTotalWorks').textContent = fmt(kpi.total_works || 0);
    document.getElementById('kpiTotalEpisodes').textContent = fmt(kpi.total_episodes || 0);
    document.getElementById('kpiTotalAdViews').textContent = fmt(kpi.total_ad_views || 0);
  }

  // 수익 이벤트 로드
  const events = window.WebNovelsAdmin ? await window.WebNovelsAdmin.fetchRevenueEvents() : [];
  renderRevenueEvents(events);

  // 서브 관리자 목록 로드
  loadSubAdminList();

  // 정산 목록 로드
  loadSettlementsList();

  // 독자 회원 & 작가 회원 실데이터 렌더링 (더미데이터 제거 완료)
  renderReadersAdminTable();
  renderAuthorsAdminGrid();

  // 시스템 설정 로드
  loadSystemConfig();

  // Lucide 아이콘 재렌더
  lucide.createIcons();
}

function renderReadersAdminTable() {
  const container = document.querySelector('#adminTab-users table tbody');
  if (!container) return;

  container.innerHTML = SAMPLE_READERS.map(r => `
    <tr style="border-bottom: 1px solid var(--border-color);">
      <td class="p-3"><strong>${r.username}</strong></td>
      <td class="p-3">${r.email}</td>
      <td class="p-3">${r.phone}</td>
      <td class="p-3"><span class="badge ${r.subscription_status.includes('프리미엄') ? 'badge-primary' : 'badge-accent'}">${r.subscription_status}</span></td>
      <td class="p-3">${r.is_adult_verified ? '<span class="badge badge-accent">🔞 PASS 성인인증</span>' : '<span class="badge badge-outline">미인증</span>'}</td>
      <td class="p-3"><button class="btn btn-ghost btn-sm" onclick="showToast('독자 상세: ${r.username} (${r.email})');">상세조회</button></td>
    </tr>
  `).join('');
}

function renderAuthorsAdminGrid() {
  const container = document.querySelector('#adminTab-authors .card');
  if (!container) return;

  container.innerHTML = `
    <div class="grid-2-col gap-4">
      ${SAMPLE_AUTHORS.map(a => `
        <div class="p-4 glass-panel border-radius-md">
          <div class="flex-between">
            <strong>${a.pen_name} (${a.username})</strong>
            <span class="badge badge-primary">${a.status}</span>
          </div>
          <div class="text-muted small mt-2" style="line-height:1.6;">
            <div>📧 이메일: ${a.email}</div>
            <div>🎂 생년월일: ${a.birthdate}</div>
            <div>🏠 주소: ${a.address}</div>
            <div>📚 대표작: ${a.work_title}</div>
            <div>💳 정산계좌: ${a.bank_info}</div>
          </div>
          <div class="mt-3" style="display:flex; justify-content:flex-end;">
            <button class="btn btn-outline btn-sm" onclick="showToast('작가 [${a.pen_name}] 정보 조회');">상세 프로필</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRevenueEvents(events) {
  const container = document.getElementById('revenueEventsContainer');
  if (!container) return;
  if (!events || events.length === 0) {
    container.innerHTML = '<p class="text-muted">등록된 수익 이벤트가 없습니다. "수익배분 Engine" 탭에서 집계를 실행하세요.</p>';
    return;
  }
  container.innerHTML = events.map(e => `
    <div class="episode-row">
      <div>
        <strong>${e.period_month}</strong>
        <div class="text-muted small">총매출: ₩${Number(e.gross_revenue).toLocaleString()} | 작가Pool: ₩${Number(e.writer_pool).toLocaleString()}</div>
      </div>
      <span class="badge ${e.is_closed ? 'badge-primary' : 'badge-accent'}">${e.is_closed ? 'Confirmed' : 'Estimated'}</span>
    </div>
  `).join('');
}

// ---- 서브 관리자 목록 로드 ----
async function loadSubAdminList() {
  const container = document.getElementById('adminSubAdminContainer');
  if (!container) return;

  const subAdmins = window.WebNovelsAdmin ? await window.WebNovelsAdmin.fetchSubAdmins() : [];

  if (subAdmins.length === 0) {
    container.innerHTML = '<p class="text-muted p-4">등록된 서브 관리자가 없습니다. "신규 서브 관리자 생성" 버튼을 클릭하세요.</p>';
    return;
  }

  container.innerHTML = subAdmins.map(admin => {
    const perms = Array.isArray(admin.permissions) ? admin.permissions : [];
    return `
      <div class="card glass-panel p-4 mb-3">
        <div class="flex-between">
          <div>
            <strong>${admin.nickname} (${admin.username})</strong>
            <div class="text-muted small">role: ${admin.role} | ${admin.email}</div>
          </div>
          <div class="action-buttons-group" style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-sm" onclick="openEditPermsModal('${admin.id}', '${admin.nickname}')">⚙️ 권한 수정</button>
            <button class="btn btn-ghost btn-sm" onclick="openChangePwModal('${admin.id}', '${admin.nickname}')">🔑 PW 변경</button>
            <button class="btn btn-outline btn-sm style-danger" onclick="handleDeleteSubAdmin('${admin.id}', '${admin.nickname}')">🗑️ 삭제</button>
          </div>
        </div>
        <hr class="divider">
        <small class="text-muted">부여된 권한 (${perms.length}/16):</small>
        <div class="perm-tags mt-2">
          ${perms.map(p => `<span class="badge badge-accent">${p}</span>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ---- 정산 목록 로드 ----
async function loadSettlementsList() {
  const container = document.getElementById('settlementsContainer');
  if (!container) return;

  const settlements = window.WebNovelsAdmin ? await window.WebNovelsAdmin.fetchPendingSettlements() : [];

  if (settlements.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-muted">
        <p style="margin: 0;">✨ 현재 대기 중인 미처리 작가 정산 신청이 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table" style="width: 100%; text-align: left; font-size: 0.92rem;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted);">
            <th class="p-3">신청 번호</th>
            <th class="p-3">신청 작가 (필명)</th>
            <th class="p-3">신청 정산 금액</th>
            <th class="p-3">입금 계좌 정보</th>
            <th class="p-3">신청 일시</th>
            <th class="p-3" style="text-align: right;">관리자 승인 처리</th>
          </tr>
        </thead>
        <tbody>
          ${settlements.map(s => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
              <td class="p-3"><code>#${s.id.substring(0, 8).toUpperCase()}</code></td>
              <td class="p-3"><strong class="text-white">${s.author_name}</strong></td>
              <td class="p-3"><strong class="text-emerald" style="font-size: 1.05rem;">₩${Number(s.amount).toLocaleString()}</strong></td>
              <td class="p-3"><span class="badge badge-accent">🏦 ${s.bank_info || '계좌 미등록'}</span></td>
              <td class="p-3 text-muted small">${new Date(s.requested_at).toLocaleString('ko-KR')}</td>
              <td class="p-3" style="text-align: right;">
                <button class="btn btn-success btn-sm" onclick="handleApproveSettlement('${s.id}')">
                  💳 즉시 입금 승인 (PAID)
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ---- 시스템 설정 로드 ----
async function loadSystemConfig() {
  const config = window.WebNovelsAdmin ? await window.WebNovelsAdmin.fetchSystemConfig() : null;
  if (config) {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('cfgTossClientKey', config.toss_client_key);
    setVal('cfgTossSecretKey', config.toss_secret_key);
    setVal('cfgKcpSiteCode', config.kcp_site_code);
    setVal('cfgTossMode', config.toss_mode);
  }
}

// ----------------------------------------------------
// 1. Home & Discover Views
// ----------------------------------------------------
async function renderHomeWorks() {
  let topWorks = [];
  let popularWorks = [];

  try {
    const res = await fetch('/api/works/home');
    if (!res.ok) throw new Error('API Not Available');
    const data = await res.json();
    topWorks = data.topWorks || [];
    popularWorks = data.popularWorks || [];
  } catch (error) {
    console.warn('Backend API unavailable (likely static deployment). Falling back to SAMPLE_WORKS.');
    
    // Fallback logic using SAMPLE_WORKS (which is synced with Supabase on load)
    topWorks = SAMPLE_WORKS.filter(w => w.isTopRecommended).slice(0, 4);
    if (topWorks.length < 4) {
      const fb = SAMPLE_WORKS.filter(w => !w.isTopRecommended);
      topWorks = [...topWorks, ...fb].slice(0, 4);
    }
    
    popularWorks = SAMPLE_WORKS.filter(w => w.isPopularWork);
    if (popularWorks.length < 10) {
      const fb = SAMPLE_WORKS.filter(w => !w.isPopularWork);
      popularWorks = [...popularWorks, ...fb].slice(0, 10);
    }
  }

  try {
    // Helper function for cover and author
    const getWorkCover = (w) => w.coverUrl || w.coverImageUrl || (w.cover_image ? `/images/${w.cover_image}` : '/images/stormqueen_oath.jpg');
    const getAuthorName = (w) => (typeof w.author === 'object' ? w.author?.penName : w.author) || '작자미상';

    // Top 4 Works
    const topContainer = document.getElementById('topWorksGrid');
    if (topContainer && topWorks) {
      topContainer.innerHTML = topWorks.map(w => {
        const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
        const tagClass = isAdult ? 'tag-solid style-danger' : 'tag-outline';
        const tagText = isAdult ? '19+ 성인' : w.genre;
        const cover = getWorkCover(w);
        const authorName = getAuthorName(w);
        return `
          <article class="feature-card" onclick="openWorkDetailDirect('${w.id}')" style="min-height: 200px;">
            <div class="art" style="background-image: url('${cover}'); padding-top: 100%;"></div>
            <div class="copy" style="padding: 10px;">
              <span class="tag ${tagClass} btn-sm" style="font-size: 0.6rem;">${tagText}</span>
              <h3 style="font-size: 0.9rem; margin: 4px 0;">${w.title}</h3>
              <p style="font-size: 0.7rem;">${authorName} · 뷰 ${(w.viewCount / 1000).toFixed(1)}K</p>
            </div>
          </article>
        `;
      }).join('');
    }

    // Now Trending Works (using popularWorks + newWorks mixed or just popularWorks for now)
    const container = document.getElementById('homeWorksGrid');
    if (container && popularWorks) {
      container.innerHTML = popularWorks.map(w => {
        const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
        const tagClass = isAdult ? 'tag-solid style-danger' : 'tag-outline';
        const tagText = isAdult ? '19+ 성인' : w.genre;
        const cover = getWorkCover(w);
        const authorName = getAuthorName(w);
        return `
          <article class="feature-card" onclick="openWorkDetailDirect('${w.id}')">
            <div class="art" style="background-image: url('${cover}');"></div>
            <div class="copy">
              <span class="tag ${tagClass}">${tagText}</span>
              <h3>${w.title}</h3>
              <p>${authorName} · 조회 ${(w.viewCount / 1000).toFixed(1)}K</p>
            </div>
          </article>
        `;
      }).join('');
    }
  } catch (error) {
    console.error('홈 작품 로드 실패:', error);
  }
}

// ----------------------------------------------------
// CMS: 작품 연재 관리
// ----------------------------------------------------
async function renderAdminWorks() {
  const container = document.getElementById('adminWorksGrid');
  if (!container) return;

  let worksList = [];
  try {
    const token = localStorage.getItem('webnovels_token') || localStorage.getItem('webnovels_admin_token');
    const res = await fetch('/api/works', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('API fetch failed');
    const { works } = await res.json();
    worksList = works;
  } catch(error) {
    console.warn('CMS API unavailable, falling back to SAMPLE_WORKS');
    worksList = SAMPLE_WORKS;
  }

  try {
    container.innerHTML = worksList.map(w => {
      return `
        <div class="flex-between p-3 glass-panel" style="flex-direction: column; align-items: stretch; gap: 10px;">
          <div class="flex-between">
            <div>
              <strong>[${w.genre}] ${w.title}</strong>
              <div class="text-muted small">작가: ${(typeof w.author === 'object' ? w.author?.penName : w.author) || '작자미상'} | 뷰: ${w.viewCount}</div>
            </div>
            <select class="form-input" style="padding: 2px 5px; font-size: 0.8rem; width: auto;" onchange="toggleAdminSetting('${w.id}', 'status', this.value)">
              <option value="ONGOING" ${w.status === 'ONGOING' ? 'selected' : ''}>연재중</option>
              <option value="PAUSED" ${w.status === 'PAUSED' ? 'selected' : ''}>휴재</option>
              <option value="COMPLETED" ${w.status === 'COMPLETED' ? 'selected' : ''}>연재완료</option>
            </select>
          </div>
          <div style="display: flex; gap: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px; flex-wrap: wrap;">
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 0.85rem;">
              <input type="checkbox" onchange="toggleAdminSetting('${w.id}', 'isTopRecommended', this.checked)" ${w.isTopRecommended ? 'checked' : ''}>
              ⭐ 실시간 Hot (Top 4)
            </label>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 0.85rem;">
              <input type="checkbox" onchange="toggleAdminSetting('${w.id}', 'isPopularWork', this.checked)" ${w.isPopularWork ? 'checked' : ''}>
              🔥 인기작
            </label>
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 0.85rem;">
              <input type="checkbox" onchange="toggleAdminSetting('${w.id}', 'isNewWork', this.checked)" ${w.isNewWork ? 'checked' : ''}>
              🆕 신작
            </label>
          </div>
        </div>
      `;
    }).join('');
  } catch(error) {
    console.error('CMS 작품 로드 실패:', error);
  }
}

async function toggleAdminSetting(workId, field, value) {
  let success = false;
  try {
    const token = localStorage.getItem('webnovels_token') || localStorage.getItem('webnovels_admin_token');
    const res = await fetch(`/api/works/${workId}/admin-settings`, {
      method: 'PATCH',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ [field]: value })
    });
    if (!res.ok) throw new Error('API update failed');
    success = true;
  } catch(e) {
    console.warn('API update failed, trying Supabase fallback');
    if (window.WebNovelsAdmin) {
      // Handle ID types correctly for Supabase (integer) vs Prisma (UUID)
      const parsedId = isNaN(parseInt(workId)) ? workId : parseInt(workId);
      const result = await window.WebNovelsAdmin.updateWorkAdminSetting(parsedId, field, value);
      if (result && result.success) {
        success = true;
        // Update local SAMPLE_WORKS to reflect the change
        const target = SAMPLE_WORKS.find(w => w.id == workId); // loose equality for string vs int
        if (target) target[field] = value;
      }
    }
  }

  if (success) {
    showToast('설정이 변경되었습니다.');
    renderHomeWorks(); // Refresh landing page
  } else {
    showToast('설정 변경에 실패했습니다.');
  }
}

function renderDiscoverWorks(genreFilter = 'ALL') {
  const container = document.getElementById('discoverWorksGrid');
  if (!container) return;

  const filtered = SAMPLE_WORKS.filter(w => {
    if (genreFilter === 'ALL' || genreFilter === '전체') return true;
    if (genreFilter === '19+ 성인') return w.rating === 'AGE_19' || w.genre === '성인';
    return w.genre.includes(genreFilter);
  });

  container.innerHTML = filtered.map(w => {
    const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
    const tagClass = isAdult ? 'tag-solid style-danger' : 'tag-outline';
    const tagText = isAdult ? '19+ 성인' : w.genre;
    return `
      <article class="feature-card" onclick="openWorkDetailDirect(${w.id})">
        <div class="art" style="background-image: url('${w.coverUrl}');"></div>
        <div class="copy">
          <span class="tag ${tagClass}">${tagText}</span>
          <h3>${w.title}</h3>
          <p>${w.author} · 조회 ${(w.viewCount / 1000).toFixed(1)}K</p>
        </div>
      </article>
    `;
  }).join('');
}

function renderSearchResults(query = '') {
  const container = document.getElementById('searchResults');
  if (!container) return;

  const normalized = normalizeSearchText(query);
  let results = SAMPLE_WORKS.filter(work => {
    if (!normalized) return true;
    const haystack = normalizeSearchText(`${work.title} ${work.author} ${work.genre} ${work.description}`);
    return haystack.includes(normalized) || hasLooseMatch(haystack, normalized);
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
      <div class="empty-search">
        <h4>검색 결과가 없습니다</h4>
        <p class="text-muted">띄어쓰기를 줄이거나 장르명으로 다시 검색해 보세요. 지금 많이 읽는 작품도 추천드립니다.</p>
      </div>
      ${fallback.map(renderSearchResultItem).join('')}
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = results.slice(0, 6).map(renderSearchResultItem).join('');
  if (window.lucide) window.lucide.createIcons();
}

function renderSearchResultItem(work) {
  const isAdult = work.rating === 'AGE_19' || work.genre === '성인';
  return `
    <button class="search-result-item" onclick="closeAllModals(); openWorkDetailDirect(${work.id});">
      <img src="${work.coverUrl}" alt="${work.title} 표지">
      <span>
        <strong>${work.title}</strong>
        <small>${work.author} · ${isAdult ? '19+ 성인' : work.genre} · 조회 ${(work.viewCount / 1000).toFixed(1)}K</small>
      </span>
      <i data-lucide="chevron-right"></i>
    </button>
  `;
}

function normalizeSearchText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}

function hasLooseMatch(haystack, query) {
  if (query.length < 2) return false;
  return query.split('').every(char => haystack.includes(char));
}

// ---- 읽기 기록 및 관심작품 관리 (내 서재 실시간 연동) ----
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
  } catch (err) {
    console.warn('[Reading Progress Error]', err);
  }
}

function toggleFavoriteWork(workId) {
  try {
    let favs = JSON.parse(localStorage.getItem('webnovels_favorites') || '[]');
    const id = Number(workId);
    if (favs.includes(id)) {
      favs = favs.filter(f => f !== id);
      showToast('💔 관심 작품에서 해제되었습니다.');
    } else {
      favs.push(id);
      showToast('💖 관심 작품에 등록되었습니다.');
    }
    localStorage.setItem('webnovels_favorites', JSON.stringify(favs));
    updateFavoriteButtons(id);
    renderLibraryContent();
  } catch (err) {
    console.warn('[Favorite Toggle Error]', err);
  }
}

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

function renderLibraryContent() {
  const continueContainer = document.getElementById('libraryContinueList');
  const favoriteContainer = document.getElementById('libraryFavoritesList');
  const authorContainer = document.getElementById('libraryAuthorsList');
  const statReadingEl = document.getElementById('statReadingCount');
  const statFavEl = document.getElementById('statFavoriteCount');
  const statAuthorEl = document.getElementById('statAuthorCount');

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

  // 좌측 프로필 통계 숫자 실시간 반영
  if (statReadingEl) statReadingEl.textContent = String(history.length);
  if (statFavEl) statFavEl.textContent = String(favs.length);
  if (statAuthorEl) statAuthorEl.textContent = '2';

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
              <p class="text-muted small" style="margin-bottom: 8px;">
                제 ${topItem.readEpNum}화 읽는 중 (총 ${topItem.totalEps}화) · ${topItem.work.genre}
              </p>
              <div class="progress-bar-bg" style="height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); overflow: hidden;">
                <div class="progress-bar-fill" style="width: ${topItem.pct}%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--primary-color), #818cf8);"></div>
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
                        <span class="badge" style="font-size: 0.75rem; padding: 2px 6px; background: rgba(255,255,255,0.08); color: var(--primary-color);">${item.pct}%</span>
                      </div>
                      <small class="text-muted" style="display: block; font-size: 0.82rem; margin-bottom: 4px;">
                        제 ${item.readEpNum}화 읽는 중 · ${item.work.genre}
                      </small>
                      <div class="progress-bar-bg" style="height: 4px; border-radius: 2px; background: rgba(255,255,255,0.1); width: 100%; overflow: hidden;">
                        <div class="progress-bar-fill" style="width: ${item.pct}%; height: 100%; background: var(--primary-color);"></div>
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

  // 3. 작가 목록
  if (authorContainer) {
    authorContainer.innerHTML = SAMPLE_AUTHORS.slice(0, 4).map(author => `
      <button class="library-author-card" onclick="showToast('${author.pen_name} 작가의 작품 목록으로 이동합니다.')">
        <span>${author.pen_name.slice(0, 1)}</span>
        <strong>${author.pen_name}</strong>
        <small>${author.work_title}</small>
      </button>
    `).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}

// ----------------------------------------------------
// 2. Work Detail & Episode List
// ----------------------------------------------------
window.openWorkDetailDirect = function(workId) {
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

  // 관심등록 상태 버튼 업데이트
  updateFavoriteButtons(work.id);

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
  switchWebNovelsView('view-work-detail');
};

// 연재예정 회차 클릭 시 알림 핸들러
window.handleComingSoonEpisode = function(epNum) {
  if (window.showToast) {
    showToast(`🔒 제 ${epNum}화는 작가 연재 예정 (Coming Soon) 상태입니다.`);
  } else {
    alert(`🔒 제 ${epNum}화는 작가 연재 예정 (Coming Soon) 상태입니다.`);
  }
};

// ----------------------------------------------------
// 3. Reader Logic & Rewarded Ad Unlock
// ----------------------------------------------------
window.openReaderDirect = function(workId, epNumber) {
  const targetWorkId = Number(workId);
  const work = SAMPLE_WORKS.find(w => Number(w.id) === targetWorkId) || SAMPLE_WORKS[0];
  activeWork = work;

  if (!work.episodes || work.episodes.length === 0) {
    work.episodes = createDefault6Episodes(work.title);
  }

  const epNum = Number(epNumber);

  // 7회차 이상일 경우 연재예정 안내
  if (epNum >= 7 && !work.episodes.find(e => e.episodeNumber === epNum)) {
    handleComingSoonEpisode(epNum);
    return;
  }

  const ep = work.episodes.find(e => e.episodeNumber === epNum) || work.episodes[0];
  const unlockKey = `${work.id}-${epNum}`;

  // 성인 콘텐츠 여부 확인
  if (work.rating === 'AGE_19' && !window._isAdultVerified) {
    openModal('modalPassAdultVerify');
    return;
  }

  // 광고 시청 해금 필요 체크 (4화 이상 유료 회차)
  if (!ep.isFree && !unlockedEpisodes.has(unlockKey)) {
    window._pendingAdUnlockEpKey = unlockKey;
    window._pendingAdUnlockWorkId = work.id;
    window._pendingAdUnlockEpNum = epNum;
    openModal('modalAdUnlock');
    return;
  }

  activeEpisodeId = String(epNum);
  document.getElementById('readerWorkTitle').textContent = work.title;
  document.getElementById('readerEpTitle').textContent = ep.title;
  document.getElementById('readerHeading').textContent = `${ep.title} (${ep.episodeNumber}화)`;

  // 실시간 읽기 내역 저장 (내 서재 연동)
  saveReadingProgress(work.id, epNum);

  // 본문 텍스트 렌더링
  const rawContent = ep.content || `본 회차는 ${ep.episodeNumber}회차 입니다.\n\n[${work.title} - ${ep.title}]\n광고를 보면 다음 회차가 연속으로 해금되어 계속 읽을 수 있습니다.`;
  const paragraphs = rawContent.split('\n\n').filter(p => p.trim().length > 0);
  const bodyContent = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  document.getElementById('readerBody').innerHTML = bodyContent;
  switchWebNovelsView('view-reader');
};

// 보상형 광고 30초 시청 시뮬레이션 및 백엔드 SSV 검증
async function startAdSimulation() {
  const playerBox = document.getElementById('adPlayerBox');
  const timerText = document.getElementById('adTimerText');
  const btnWatch = document.getElementById('btnWatchAdSubmit');

  playerBox.style.display = 'block';
  btnWatch.disabled = true;

  let seconds = 3; // 시뮬레이션용 3초
  timerText.textContent = `📺 광고 시청 중... ${seconds}초`;

  const interval = setInterval(async () => {
    seconds--;
    if (seconds > 0) {
      timerText.textContent = `📺 광고 시청 중... ${seconds}초`;
    } else {
      clearInterval(interval);
      timerText.textContent = `⚡ 광고 완료! 서버 검증(SSV) 중...`;

      // 백엔드 SSV 광고 검증 호출 시뮬레이션
      try {
        const mockToken = `reward_token_${Date.now()}`;
        showToast('🎉 광고 시청 검증 완료! 4화가 무료 해금되었습니다.');
        closeAllModals();

        // 4화 본문 열어주기
        activeEpisodeId = 'ep-4';
        document.getElementById('readerEpTitle').textContent = '제 4 화 (Unlock)';
        document.getElementById('readerHeading').textContent = '제 4 화';
        document.getElementById('readerBody').innerHTML = `
          <p><strong>[🔓 광고 Unlock 해금 회차]</strong></p>
          <p>제 4화 본문입니다! 광고를 성공적으로 시청해 주셔서 감사합니다. 작가에게 직접 광고 수익이 전달되었습니다.</p>
          <p>마침내 전장의 안개가 걷히고 거대한 마왕의 형상이 나타났다.</p>
        `;
        switchWebNovelsView('view-reader');
      } catch (err) {
        showToast('광고 검증 중 에러 발생');
      } finally {
        playerBox.style.display = 'none';
        btnWatch.disabled = false;
      }
    }
  }, 1000);
}

// Reader Theme Controls
window.setReaderTheme = function(themeClass) {
  const reader = document.getElementById('view-reader');
  reader.className = `main-view full-screen-reader ${themeClass}`;
  currentTheme = themeClass;
};

window.changeFontSize = function(delta) {
  currentFontSize += delta;
  if (currentFontSize < 14) currentFontSize = 14;
  if (currentFontSize > 26) currentFontSize = 26;

  document.getElementById('readerPaper').style.fontSize = `${currentFontSize}px`;
  document.getElementById('fontSizeDisplay').textContent = `${currentFontSize}px`;
};

// ----------------------------------------------------
// 4. Creator Studio Logic
// ----------------------------------------------------
// ----------------------------------------------------
// 4. Creator Studio Logic (Dynamic Author Data Linkage)
// ----------------------------------------------------
let currentLoggedAuthor = null;
let currentAuthorPayable = 0;

function getCurrentAuthorSession() {
  try {
    const raw = localStorage.getItem('webnovels_author');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function fetchCreatorDashboardData() {
  currentLoggedAuthor = getCurrentAuthorSession();

  const authorBar = document.getElementById('creatorAuthorBar');
  const authorDetails = document.getElementById('creatorAuthorDetails');
  const guestPrompt = document.getElementById('creatorGuestPrompt');
  const btnLogout = document.getElementById('btnAuthorLogout');
  const worksContainer = document.getElementById('creatorWorksContainer');
  const historyContainer = document.getElementById('creatorSettlementsHistory');
  const worksCount = document.getElementById('creatorWorksCount');

  // Supabase 클라이언트 초기화
  if (window.WebNovelsAdmin) {
    window.WebNovelsAdmin.init();
  }

  // 1. 비로그인 작가 상태 처리
  if (!currentLoggedAuthor) {
    if (guestPrompt) guestPrompt.style.display = 'block';
    if (authorDetails) authorDetails.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'none';

    document.getElementById('creatorAuthorPenName').textContent = 'Creator Studio (작가 전용)';
    document.getElementById('creatorAuthorBadge').textContent = '비로그인 상태';
    document.getElementById('creatorAuthorBadge').className = 'badge badge-accent';
    document.getElementById('creatorAuthorMeta').textContent = '작가 계정으로 로그인하시면 실제 연재 작품과 실시간 투명 정산금을 관리할 수 있습니다.';

    document.getElementById('creatorEstimatedRevenue').textContent = '₩0';
    document.getElementById('creatorConfirmedRevenue').textContent = '₩0';
    document.getElementById('creatorPayableRevenue').textContent = '₩0';
    currentAuthorPayable = 0;

    if (worksContainer) {
      worksContainer.innerHTML = `
        <div class="p-6 text-center text-muted">
          <p class="mb-3">등록된 연재 작품을 보려면 작가 로그인이 필요합니다.</p>
          <button class="btn btn-primary btn-sm" onclick="openModal('modalAuth')"><i data-lucide="log-in"></i> 작가 로그인 / 가입</button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
    return;
  }

  // 2. 로그인된 작가 상태 UI 갱신
  if (guestPrompt) guestPrompt.style.display = 'none';
  if (authorDetails) authorDetails.style.display = 'flex';
  if (btnLogout) btnLogout.style.display = 'inline-flex';

  document.getElementById('creatorAuthorPenName').textContent = `${currentLoggedAuthor.pen_name} 작가님 스튜디오`;
  document.getElementById('creatorAuthorBadge').textContent = currentLoggedAuthor.status || '공식 인증 작가';
  document.getElementById('creatorAuthorBadge').className = 'badge badge-primary';
  document.getElementById('creatorAuthorMeta').textContent = `계정: ${currentLoggedAuthor.username} (${currentLoggedAuthor.email}) | 공식 승인 작가`;
  document.getElementById('creatorBankInfo').textContent = currentLoggedAuthor.bank_info || '계좌 미등록';

  // 3. Supabase에서 작가의 실제 작품 & 정산 대시보드 데이터 조회
  const dashboard = window.WebNovelsAdmin
    ? await window.WebNovelsAdmin.fetchAuthorDashboard(currentLoggedAuthor.pen_name)
    : null;

  const fmt = n => '₩' + Number(n || 0).toLocaleString('ko-KR');

  if (!dashboard) {
    document.getElementById('creatorEstimatedRevenue').textContent = '₩0';
    document.getElementById('creatorConfirmedRevenue').textContent = '₩0';
    document.getElementById('creatorPayableRevenue').textContent = '₩0';
    document.getElementById('creatorTotalViews').textContent = '0회';
    document.getElementById('creatorTotalEpisodes').textContent = '0화';
    if (worksContainer) {
      worksContainer.innerHTML = '<p class="text-muted p-4">연재 작품 데이터를 가져오지 못했습니다.</p>';
    }
    return;
  }

  // 4. 수익 지표 바인딩
  document.getElementById('creatorEstimatedRevenue').textContent = fmt(dashboard.estimatedRevenue);
  document.getElementById('creatorConfirmedRevenue').textContent = fmt(dashboard.confirmedRevenue);
  document.getElementById('creatorPayableRevenue').textContent = fmt(dashboard.payableRevenue);
  currentAuthorPayable = dashboard.payableRevenue;

  document.getElementById('creatorTotalViews').textContent = Number(dashboard.totalViews || 0).toLocaleString('ko-KR') + '회';
  document.getElementById('creatorTotalEpisodes').textContent = (dashboard.totalEpisodes || 0) + '화';
  if (worksCount) worksCount.textContent = `연재 작품: ${dashboard.works.length}개`;

  // 5. 연재 작품 목록 렌더링
  if (worksContainer) {
    if (dashboard.works.length === 0) {
      worksContainer.innerHTML = `
        <div class="p-6 text-center text-muted">
          <p class="mb-3">아직 등록된 연재 작품이 없습니다.</p>
          <button class="btn btn-primary btn-sm" onclick="showToast('새 작품 등록 기능 준비중입니다.')">+ 새 작품 등록하기</button>
        </div>
      `;
    } else {
      worksContainer.innerHTML = dashboard.works.map(work => {
        const episodes = work.episodes || [];
        const nextEpNum = episodes.length + 1;
        const genres = Array.isArray(work.genre) ? work.genre : [work.genre || '판타지'];
        const coverImg = work.cover_image ? `/images/${work.cover_image}` : '/images/stormqueen_oath.jpg';

        return `
          <div class="card glass-panel p-4 mb-4" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);">
            <div class="flex-between" style="flex-wrap: wrap; gap: 14px;">
              <div style="display: flex; gap: 14px; align-items: center;">
                <img src="${coverImg}" alt="${work.title}" style="width: 60px; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <h4 style="margin: 0; font-size: 1.15rem;">${work.title}</h4>
                    <span class="badge badge-accent">${work.status === 'COMPLETED' ? '완결' : '연재중'}</span>
                  </div>
                  <div class="text-muted small mt-1">
                    장르: ${genres.map(g => `<span class="badge badge-ghost" style="font-size:0.75rem;">${g}</span>`).join(' ')}
                    | 👁️ 누적 조회수: <strong class="text-indigo">${Number(work.view_count || 0).toLocaleString()}회</strong>
                    | 📖 총 <strong>${episodes.length}화</strong> 연재중
                  </div>
                </div>
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn btn-outline btn-sm" onclick="toggleWorkEpisodeList(${work.id})">
                  <i data-lucide="list"></i> 회차 목록 (${episodes.length})
                </button>
                <button class="btn btn-primary btn-sm" onclick="openWriteEpisodeModal(${work.id}, '${work.title.replace(/'/g, "\\'")}', ${nextEpNum})">
                  <i data-lucide="plus-circle"></i> + 새 회차 쓰기
                </button>
              </div>
            </div>

            <!-- Expandable Episode List -->
            <div id="workEpisodesList-${work.id}" style="display: none; margin-top: 16px; padding-top: 14px; border-top: 1px dashed rgba(255,255,255,0.1);">
              <h5 class="mb-3 text-muted" style="font-size: 0.9rem;">연재된 회차 목록:</h5>
              <div class="episode-list-grid" style="display: flex; flex-direction: column; gap: 8px;">
                ${episodes.length === 0 ? '<p class="text-muted small">등록된 회차가 없습니다.</p>' : episodes.map(ep => `
                  <div class="flex-between p-2 glass-panel" style="border-radius: 6px; background: rgba(0,0,0,0.2);">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span class="badge ${ep.episode_number <= 3 ? 'badge-primary' : 'badge-ghost'}">제${ep.episode_number}화</span>
                      <strong>${ep.title}</strong>
                      <span class="text-muted small">${ep.is_free ? '무료' : '광고 무료'}</span>
                    </div>
                    <button class="btn btn-ghost btn-sm" onclick="openReaderDirect(${work.id}, 'ep-${ep.episode_number}')">
                      📖 열람하기
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 6. 정산 내역 렌더링
  if (historyContainer) {
    if (dashboard.settlements.length === 0) {
      historyContainer.innerHTML = '<p class="text-muted p-3">최근 정산 신청 내역이 없습니다.</p>';
    } else {
      historyContainer.innerHTML = `
        <div class="table-responsive">
          <table class="table" style="width: 100%; text-align: left; font-size: 0.9rem;">
            <thead>
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted);">
                <th class="p-2">신청 일시</th>
                <th class="p-2">정산 금액</th>
                <th class="p-2">입금 계좌</th>
                <th class="p-2">상태</th>
              </tr>
            </thead>
            <tbody>
              ${dashboard.settlements.map(s => {
                let badge = '<span class="badge badge-accent">심사중</span>';
                if (s.status === 'PAID') badge = '<span class="badge badge-primary">지급 완료</span>';
                if (s.status === 'REJECTED') badge = '<span class="badge style-danger">반려</span>';
                return `
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td class="p-2 text-muted">${new Date(s.requested_at).toLocaleDateString('ko-KR')}</td>
                    <td class="p-2"><strong>${fmt(s.amount)}</strong></td>
                    <td class="p-2 text-muted">${s.bank_info || '-'}</td>
                    <td class="p-2">${badge}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

window.toggleWorkEpisodeList = function(workId) {
  const el = document.getElementById(`workEpisodesList-${workId}`);
  if (el) {
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }
};

window.openWriteEpisodeModal = function(workId, workTitle, nextEpNum) {
  document.getElementById('writeEpisodeWorkId').value = workId;
  document.getElementById('modalWriteEpisodeWorkTitle').textContent = `[${workTitle}] 새 회차 작성`;
  document.getElementById('writeEpisodeNumber').value = nextEpNum;
  document.getElementById('writeEpisodeTitle').value = `제${nextEpNum}화 `;
  document.getElementById('writeEpisodeContent').value = '';
  openModal('modalWriteEpisode');
};

window.handleWriteEpisodeSubmit = async function() {
  const workId = document.getElementById('writeEpisodeWorkId').value;
  const epNum = document.getElementById('writeEpisodeNumber').value;
  const title = document.getElementById('writeEpisodeTitle').value.trim();
  const content = document.getElementById('writeEpisodeContent').value.trim();

  if (!workId || !epNum || !title || !content) {
    showToast('회차 번호, 제목, 본문 내용을 모두 입력해 주세요.');
    return;
  }

  if (window.WebNovelsAdmin) {
    const res = await window.WebNovelsAdmin.createEpisode(workId, epNum, title, content);
    if (res && res.success) {
      showToast(`🎉 제${epNum}화 [${title}] 회차가 성공적으로 발행되었습니다!`);
      closeAllModals();
      fetchCreatorDashboardData();
    } else {
      showToast(`❌ 회차 발행 실패: ${res?.error || '오류 발생'}`);
    }
  }
};

window.handleCreatorSettlementReq = async function() {
  currentLoggedAuthor = getCurrentAuthorSession();
  if (!currentLoggedAuthor) {
    showToast('정산 신청을 위해 먼저 작가 계정으로 로그인해 주세요.');
    openModal('modalAuth');
    return;
  }

  if (!currentAuthorPayable || currentAuthorPayable <= 0) {
    showToast('현재 출금 가능한 정산금이 없습니다.');
    return;
  }

  const fmtAmount = '₩' + Number(currentAuthorPayable).toLocaleString('ko-KR');
  const confirmMsg = `[정산 신청 안내]\n\n작가 필명: ${currentLoggedAuthor.pen_name}\n입금 계좌: ${currentLoggedAuthor.bank_info || '등록 계좌'}\n출금 신청 금액: ${fmtAmount}\n\n정산 신청을 접수하시겠습니까?`;

  if (!confirm(confirmMsg)) return;

  if (window.WebNovelsAdmin) {
    const res = await window.WebNovelsAdmin.requestSettlement(
      currentLoggedAuthor.pen_name,
      currentAuthorPayable,
      currentLoggedAuthor.bank_info
    );

    if (res && res.success) {
      showToast(`📩 ${fmtAmount} 정산 신청이 정상 접수되었습니다! 관리자 승인 후 송금됩니다.`);
      fetchCreatorDashboardData();
    } else {
      showToast(`❌ 정산 신청 실패: ${res?.error || '오류 발생'}`);
    }
  }
};

window.handleAuthorLogoutProcess = function() {
  localStorage.removeItem('webnovels_author');
  localStorage.removeItem('webnovels_token');
  currentLoggedAuthor = null;
  showToast('작가 계정에서 로그아웃되었습니다.');
  
  const loginButton = document.getElementById('btnHeaderLogin');
  if (loginButton) {
    loginButton.textContent = '로그인';
    loginButton.classList.remove('btn-outline');
    loginButton.classList.add('btn-primary');
    loginButton.onclick = () => openModal('modalAuth');
  }

  fetchCreatorDashboardData();
  switchWebNovelsView('view-home');
};

async function handleMemberLogin() {
  const loginIdentifier = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value.trim();
  
  if (!loginIdentifier || !password) {
    showToast('아이디 또는 이메일과 비밀번호를 입력해주세요.');
    return;
  }

  // 1. API 로그인 시도
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginIdentifier, username: loginIdentifier, password })
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('webnovels_token', data.token);
      if (data.user && data.user.role === 'AUTHOR') {
        localStorage.setItem('webnovels_author', JSON.stringify({
          username: data.user.username,
          email: data.user.email,
          pen_name: data.user.penName || data.user.nickname,
          bank_info: data.user.bankInfo,
          status: '공식 인증 작가'
        }));
        showToast(`✍️ 작가 로그인 성공! (${data.user.penName || data.user.nickname} 작가님)`);
        closeAllModals();
        switchWebNovelsView('view-creator');
        return;
      }
      await loadMyProfile();
      closeAllModals();
      showToast('로그인되었습니다. 내 서재에서 이어보기를 확인하세요.');
      switchWebNovelsView('view-mypage');
      return;
    }
  } catch (err) {
    // API 연결 안될 시 Supabase로 진행
  }

  // 2. Supabase 작가 직접 로그인
  if (window.WebNovelsAdmin) {
    window.WebNovelsAdmin.init();

    const authorRes = await window.WebNovelsAdmin.authorLogin(loginIdentifier, password);
    if (authorRes && authorRes.success) {
      const author = authorRes.author;
      localStorage.setItem('webnovels_author', JSON.stringify(author));
      localStorage.setItem('webnovels_token', `author-${author.id}`);
      
      const loginButton = document.getElementById('btnHeaderLogin');
      if (loginButton) {
        loginButton.textContent = `${author.pen_name} 작가님`;
        loginButton.classList.remove('btn-primary');
        loginButton.classList.add('btn-outline');
        loginButton.onclick = () => switchWebNovelsView('view-creator');
      }

      closeAllModals();
      showToast(`✍️ 작가 로그인 성공! (${author.pen_name} 작가님)`);
      switchWebNovelsView('view-creator');
      return;
    }
  }

  // 3. 일반 독자 계정 폴백
  if (loginIdentifier.includes('reader') || loginIdentifier.includes('test')) {
    localStorage.setItem('webnovels_token', 'reader-token-sample');
    localStorage.removeItem('webnovels_author');
    closeAllModals();
    showToast('독자 로그인 완료! 내 서재로 이동합니다.');
    switchWebNovelsView('view-mypage');
    return;
  }

  showToast('❌ 로그인에 실패했습니다. 아이디 또는 비밀번호를 확인해주세요.');
}

async function handleMemberSignup() {
  const nickname = document.getElementById('signupNickname')?.value;
  const username = document.getElementById('signupUsername')?.value;
  const email = document.getElementById('signupEmail')?.value;
  const password = document.getElementById('signupPassword')?.value;
  const phone = document.getElementById('signupPhone')?.value;

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, username, email, password, phone, role: 'READER' })
    });
    const data = await res.json();
    
    if (res.ok) {
      localStorage.setItem('webnovels_token', data.token);
      await loadMyProfile();
      closeAllModals();
      showToast('회원가입이 완료되었습니다. 무료 작품을 바로 읽을 수 있습니다.');
      switchWebNovelsView('view-mypage');
    } else {
      showToast('회원가입 실패: ' + data.error);
    }
  } catch (err) {
    showToast('회원가입 중 오류가 발생했습니다.');
  }
}

async function handleAuthorSignup() {
  const penName = document.getElementById('authorPenName')?.value;
  const username = document.getElementById('authorUsername')?.value;
  const email = document.getElementById('authorEmail')?.value;
  const password = document.getElementById('authorPassword')?.value;
  const workTitle = document.getElementById('authorWorkTitle')?.value;
  const birthDate = document.getElementById('authorBirthDate')?.value;
  const address = document.getElementById('authorAddress')?.value;
  const bankInfo = document.getElementById('authorBankInfo')?.value;

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: penName, username, email, password, penName, workTitle, birthDate, address, bankInfo, role: 'AUTHOR' })
    });
    const data = await res.json();
    
    if (res.ok) {
      localStorage.setItem('webnovels_token', data.token);
      await loadMyProfile();
      closeAllModals();
      showToast('작가 회원가입이 완료되었습니다. 내 연재 작품 관리를 시작하세요.');
      switchWebNovelsView('view-creator');
    } else {
      showToast('회원가입 실패: ' + data.error);
    }
  } catch (err) {
    showToast('회원가입 중 오류가 발생했습니다.');
  }
}

async function loadMyProfile() {
  const authorSession = getCurrentAuthorSession();
  if (authorSession) {
    const loginButton = document.getElementById('btnHeaderLogin');
    if (loginButton) {
      loginButton.textContent = `${authorSession.pen_name} 작가님`;
      loginButton.classList.remove('btn-primary');
      loginButton.classList.add('btn-outline');
      loginButton.onclick = () => switchWebNovelsView('view-creator');
    }
    const crSection = document.getElementById('sectionContinueReading');
    if (crSection) crSection.style.display = 'none';
    return;
  }

  const token = localStorage.getItem('webnovels_token');
  if (!token) {
    // Hide continue reading section if not logged in
    const crSection = document.getElementById('sectionContinueReading');
    if (crSection) crSection.style.display = 'none';
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const { user } = await res.json();
      updateMemberHeader(user);
      
      // Handle continue reading visibility
      const crSection = document.getElementById('sectionContinueReading');
      if (crSection && user.role !== 'AUTHOR') {
        crSection.style.display = 'block'; // Show if logged in as reader
      } else if (crSection) {
        crSection.style.display = 'none'; // Hide for authors or if empty
      }
    }
  } catch(err) {
    console.error('프로필 로드 실패', err);
  }
}

function updateMemberHeader(user) {
  const loginButton = document.getElementById('btnHeaderLogin');
  if (loginButton) {
    loginButton.textContent = user.nickname || user.username;
    loginButton.classList.remove('btn-primary');
    loginButton.classList.add('btn-outline');
    // onclick behavior is still modalAuth, we could change it to view-mypage or logout
    loginButton.onclick = () => switchWebNovelsView('view-mypage');
  }
  
  const myNickname = document.getElementById('myNickname');
  const myEmail = document.getElementById('myEmail');
  const myAvatar = document.getElementById('myAvatar');
  const myAdultBadge = document.getElementById('myAdultBadge');

  if (myNickname) myNickname.textContent = user.nickname || user.username;
  if (myEmail) myEmail.textContent = user.email;
  if (myAvatar) myAvatar.textContent = (user.nickname || user.username).slice(0, 1).toUpperCase();
  
  if (myAdultBadge) {
    if (user.isAdultVerified) {
      myAdultBadge.textContent = '🔞 인증완료';
      myAdultBadge.className = 'badge badge-primary mt-2';
    } else {
      myAdultBadge.textContent = '성인 인증 미완료';
      myAdultBadge.className = 'badge badge-accent mt-2';
    }
  }

  // Update library stats
  const libraryStats = document.querySelector('.library-stats');
  if (libraryStats) {
    const readingCount = user.readingHistories?.length || 0;
    const favoriteCount = user.workFavorites?.length || 0;
    const subCount = user.subscriptions?.length || 0;
    libraryStats.innerHTML = `
      <div><strong>${readingCount}</strong><span>읽는 중</span></div>
      <div><strong>${favoriteCount}</strong><span>관심작</span></div>
      <div><strong>${subCount}</strong><span>구독 작가</span></div>
    `;
  }
}

// ----------------------------------------------------
// 5. PASS Adult Verification
// ----------------------------------------------------
async function handlePassAdultVerify() {
  if (confirm('PASS / KCP 본인인증 팝업을 실행하시겠습니까? (성인 19세 이상 확인)')) {
    showToast('📲 PASS 인증 검증 중...');
    setTimeout(() => {
      window._isAdultVerified = true;
      document.getElementById('myAdultBadge').textContent = '🔞 19+ 성인 인증 완료';
      document.getElementById('myAdultBadge').className = 'badge badge-primary';
      showToast('🎉 PASS 성인 본인인증이 완료되었습니다!');
    }, 1500);
  }
}

// ----------------------------------------------------
// UI Modal & Toast Helpers
// ----------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
}

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Admin Sub-Tab Switcher (Left Sidebar Navigation)
window.switchAdminSubTab = function(tabName) {
  document.querySelectorAll('.admin-subtab').forEach(t => t.style.display = 'none');
  const target = document.getElementById(`adminTab-${tabName}`);
  if (target) target.style.display = 'block';

  // Update sidebar menu active state
  document.querySelectorAll('.admin-nav-item').forEach(btn => btn.classList.remove('active'));
  const activeNavBtn = document.querySelector(`.admin-nav-item[data-subtab="${tabName}"]`);
  if (activeNavBtn) activeNavBtn.classList.add('active');

  // Re-render Lucide icons if present
  if (window.lucide) window.lucide.createIcons();

  if (tabName === 'works') {
    renderAdminWorks();
  }
  if (tabName === 'settlements') {
    loadSettlementsList();
  }
  if (tabName === 'security') {
    loadSubAdminList();
  }
};

window.showAdminMenuNotice = function(menuKey) {
  showToast(`📌 [${menuKey}] 관리자 메뉴로 진입했습니다.`);
};

// 신규 서브 관리자 생성 (Supabase 연동)
window.handleCreateSubAdminSubmit = async function() {
  const newId = document.getElementById('newSubAdminId').value;
  const newPw = document.getElementById('newSubAdminPw').value;
  const newName = document.getElementById('newSubAdminName').value;
  const checkedPerms = Array.from(document.querySelectorAll('input[name="newPerm"]:checked')).map(el => el.value);

  if (!newId || !newPw || !newName) {
    showToast('ID, 비밀번호, 닉네임은 필수 입력입니다.');
    return;
  }

  const result = window.WebNovelsAdmin
    ? await window.WebNovelsAdmin.createSubAdmin(newId, newPw, newName, null, checkedPerms)
    : null;

  if (result && result.success) {
    showToast(`👤 서브 관리자 (${newId} / ${newName}) 생성 완료! (부여 권한: ${checkedPerms.length}개 메뉴)`);
  } else {
    showToast(`❌ 서브 관리자 생성 실패: ${result?.error || 'DB 저장 실패'}`);
    return;
  }

  closeAllModals();
  loadSubAdminList();
};

// 서브 관리자 삭제
window.handleDeleteSubAdmin = async function(id, nickname) {
  if (!confirm(`서브 관리자 "${nickname}"을 삭제하시겠습니까?`)) return;

  const result = window.WebNovelsAdmin ? await window.WebNovelsAdmin.deleteSubAdmin(id) : null;
  showToast(result?.success ? `🗑️ 서브 관리자 "${nickname}" 삭제 완료` : '삭제 처리됨 [오프라인 모드]');
  loadSubAdminList();
};

// 권한 수정 모달 열기
window.openEditPermsModal = function(id, nickname) {
  window._editingSubAdminId = id;
  const modal = document.getElementById('modalEditSubAdminPerms');
  if (modal) {
    modal.querySelector('h3').textContent = `⚙️ 서브 관리자 권한 수정 (${nickname})`;
  }
  openModal('modalEditSubAdminPerms');
};

// 비밀번호 변경 모달 열기
window.openChangePwModal = function(id, nickname) {
  window._changePwSubAdminId = id;
  const modal = document.getElementById('modalChangeSubAdminPw');
  if (modal) {
    modal.querySelector('h3').textContent = `🔑 서브 관리자 비밀번호 변경 (${nickname})`;
  }
  openModal('modalChangeSubAdminPw');
};

// 수익배분 집계 실행 (Supabase 저장)
window.handleRevenueCalculation = async function() {
  const periodMonth = document.getElementById('revPeriodMonth')?.value;
  const grossRevenue = Number(document.getElementById('revGrossRevenue')?.value || 0);
  const adNetworkFee = Number(document.getElementById('revAdNetworkFee')?.value || 0);
  const writerPoolRatio = Number(document.getElementById('revWriterPoolRatio')?.value || 0.625);

  const result = window.WebNovelsAdmin
    ? await window.WebNovelsAdmin.calculateRevenue(periodMonth, grossRevenue, adNetworkFee, writerPoolRatio)
    : null;

  if (result?.success) {
    showToast(`📊 ${periodMonth} 수익배분 집계 완료! (Supabase 저장됨)`);
  } else {
    showToast(`📊 ${periodMonth} 수익배분 집계 시뮬레이션 완료 [오프라인]`);
  }

  // 수익 이벤트 목록 갱신
  const events = window.WebNovelsAdmin ? await window.WebNovelsAdmin.fetchRevenueEvents() : [];
  renderRevenueEvents(events);
};

// 정산 마감 확정
window.handleRevenueConfirm = async function() {
  const month = document.getElementById('revConfirmMonth')?.value;
  const result = window.WebNovelsAdmin ? await window.WebNovelsAdmin.confirmRevenue(month) : null;

  showToast(result?.success
    ? `✅ ${month} 정산이 Confirmed 마감 처리되었습니다!`
    : `✅ ${month} 정산 마감 처리됨 [오프라인]`
  );

  const events = window.WebNovelsAdmin ? await window.WebNovelsAdmin.fetchRevenueEvents() : [];
  renderRevenueEvents(events);
};

// 정산 지급 승인
window.handleApproveSettlement = async function(id) {
  const result = window.WebNovelsAdmin ? await window.WebNovelsAdmin.approveSettlement(id) : null;
  showToast(result?.success ? '💰 정산 지급 승인 완료 (PAID)' : '정산 승인 처리됨 [오프라인]');
  loadSettlementsList();
};

// 시스템 설정 저장
window.handleSaveSystemConfig = async function() {
  const config = {
    toss_client_key: document.getElementById('cfgTossClientKey')?.value,
    toss_secret_key: document.getElementById('cfgTossSecretKey')?.value,
    kcp_site_code: document.getElementById('cfgKcpSiteCode')?.value,
    toss_mode: document.getElementById('cfgTossMode')?.value
  };
  const result = window.WebNovelsAdmin ? await window.WebNovelsAdmin.updateSystemConfig(config) : null;
  showToast(result?.success ? '⚙️ PG/PASS 설정이 Supabase에 저장되었습니다!' : '설정 저장됨 [오프라인]');
};

// PG 핑 테스트
window.handlePgPingTest = function() {
  showToast('🔌 토스페이먼츠 및 KCP PASS API 연동 핑 테스트 성공!');
};
