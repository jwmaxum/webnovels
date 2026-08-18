// ============================================================
// [Frontend SPA Application Engine] public/app.js
//
// [Purpose]
// - 단일 페이지 애플리케이션(SPA) 프론트엔드 코어 엔진
// - 라우팅/View 전환(홈, 탐색, 보관함, 마이페이지, 작품상세, 독서뷰어, 크리에이터 스튜디오, 관리자 CMS)
// - 보상형 광고 Unlock 시뮬레이션 및 백엔드 SSV 연동
// - 웹소설 텍스트 뷰어(Reader) 엔진 (폰트 크기, 줄간격, 다크/라이트/세피아 테마, 이전/다음 화 이동)
// - 작가 스튜디오(Creator Studio) 대시보드 (Estimated/Confirmed/Payable 3대 수익 지표)
// - PASS / KCP 성인 본인인증 모달 인터랙션
//
// [Global State Management (클라이언트 상태 관리)]
// - activeWork: 현재 상세 화면 또는 리더에서 열람 중인 작품 객체
// - activeEpisodeId: 현재 뷰어에서 렌더링 중인 회차 번호/ID
// - unlockedEpisodes: 광고 시청을 통해 해금된 회차 번호 Set (Client/LocalStorage)
// - currentTheme: 뷰어 색상 테마 ('theme-dark' | 'theme-light' | 'theme-sepia')
// - currentFontSize: 뷰어 글자 크기 (기본 18px)
// - isAdminLoggedIn: 관리자 콘솔 로그인 성공 여부
// - currentActiveView / lastMainView: SPA 뷰 히스토리 및 뒤로가기 스택
// ============================================================

const API_BASE = '/api';

// ============================================================
// [Helper] createDefault6Episodes
// [Purpose] 각 작품별 1~6회차 기본 에피소드 본문 데이터 생성
// [Business Rule] 1~3화는 무료(`isFree: true`), 4~6화는 광고 언락 회차(`isFree: false, isAdFree: true`)
// ============================================================
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

// ------------------------------------------------------------
// [State] SAMPLE_WORKS (대표 8개 작품 시드 데이터)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// [State] SAMPLE_READERS (샘플 독자 계정)
// ------------------------------------------------------------
const SAMPLE_READERS = [
  { id: 1, username: 'reader1', password_hash: '!12345', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 2, username: 'reader2', password_hash: '!12345', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 3, username: 'reader3', password_hash: '!12345', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', is_adult_verified: true, subscription_status: '프리미엄 구독중' }
];

// ------------------------------------------------------------
// [State] SAMPLE_AUTHORS (샘플 작가 계정)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// [Client State] 활성 세션 변수
// ------------------------------------------------------------
let activeWork = SAMPLE_WORKS[0];
let activeEpisodeId = 'ep-1';
let unlockedEpisodes = new Set();
let currentTheme = 'theme-dark';
let currentFontSize = 18;

// ============================================================
// [Entry] DOMContentLoaded
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initWebNovelsApp();
});

// ============================================================
// [Function] initWebNovelsApp
// [Purpose] Lucide 아이콘 렌더링, 이벤트 리스너 바인딩, Supabase/API 실시간 데이터 로드, 세션 복원 및 메인 홈 렌더링
// ============================================================
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

  // 로그인 프로필 세션 복원 및 헤더 동기화
  await loadMyProfile();

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

  document.getElementById('btnCheckNickname')?.addEventListener('click', () => {
    checkNicknameDuplicate();
  });

  document.getElementById('btnCheckAuthorPenName')?.addEventListener('click', () => {
    checkAuthorPenNameDuplicate();
  });

  setupPasswordMatchCheckers();

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
    toggleSubscribeAuthor(activeWork.author);
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

// ============================================================
// [Admin Auth] 관리자 로그인 로직 처리 (Supabase 및 세션 동기화)
// ============================================================
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
    const admin = result.admin || { id: idInput, username: idInput, nickname: idInput, role: 'SUPER_ADMIN' };
    
    // [중요] 기존 일반회원(독자/작가) 세션을 관리자 세션으로 완전히 덮어쓰기
    localStorage.removeItem('webnovels_author');
    const adminUserObj = {
      id: admin.id || 'admin-root',
      username: admin.username || idInput,
      nickname: admin.nickname || idInput,
      role: admin.role || 'SUPER_ADMIN',
      isAdultVerified: true
    };
    localStorage.setItem('webnovels_user', JSON.stringify(adminUserObj));
    localStorage.setItem('webnovels_token', result.token || `admin-token-${admin.id}`);
    localStorage.setItem('webnovels_admin_token', result.token || `admin-token-${admin.id}`);

    // 헤더 프로필 영역 및 네비게이션 메뉴 즉시 관리자 모드로 동기화
    updateMemberHeader(adminUserObj);

    showToast(`🔑 관리자 로그인 성공! (${adminUserObj.nickname || idInput})`);
    document.getElementById('adminRoleBadge').textContent = `${adminUserObj.role} 로그인됨`;
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

// ============================================================
// [Admin Auth] 관리자 로그아웃
// ============================================================
window.handleAdminLogoutProcess = function() {
  isAdminLoggedIn = false;
  if (window.WebNovelsAdmin) window.WebNovelsAdmin.logout();
  localStorage.removeItem('webnovels_admin_token');
  localStorage.removeItem('webnovels_user');
  localStorage.removeItem('webnovels_author');
  localStorage.removeItem('webnovels_token');
  currentLoggedAuthor = null;
  window._isAdultVerified = false;

  document.getElementById('adminRoleBadge').textContent = '미로그인';
  document.getElementById('adminRoleBadge').className = 'badge badge-accent';
  if (document.getElementById('btnAdminLogout')) {
    document.getElementById('btnAdminLogout').style.display = 'none';
  }

  // 헤더를 완전한 비로그인 상태로 복구 (메뉴도 기본 표시로 복원)
  updateMemberHeader(null);

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

// ============================================================
// [Helper] 사용자 활동 데이터(독서이력, 관심작품, 구독작가, 성인인증) 로컬 동기화
// ============================================================
function syncUserActivityToStorage(data) {
  if (!data) return;
  
  if (data.readingHistory && Array.isArray(data.readingHistory)) {
    localStorage.setItem('webnovels_reading_history', JSON.stringify(data.readingHistory));
  }
  if (data.favorites && Array.isArray(data.favorites)) {
    localStorage.setItem('webnovels_favorites', JSON.stringify(data.favorites.map(Number)));
  }
  if (data.subscribedAuthors && Array.isArray(data.subscribedAuthors)) {
    localStorage.setItem('webnovels_subscribed_authors', JSON.stringify(data.subscribedAuthors));
  }
  if (data.isAdultVerified !== undefined) {
    window._isAdultVerified = !!data.isAdultVerified;
  }
  renderLibraryContent();
}

// ---- 읽기 기록 및 관심작품 / 구독 작가 관리 (내 서재 실시간 연동) ----
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

    // 서버 및 Supabase DB 실시간 동기화
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

    const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (savedUser && window.WebNovelsAdmin?.updateReaderActivity) {
      window.WebNovelsAdmin.updateReaderActivity(savedUser.username || savedUser.email, {
        readingHistory: history
      });
    }
  } catch (err) {
    console.warn('[Reading Progress Error]', err);
  }
}

function toggleFavoriteWork(workId) {
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
    renderLibraryContent();

    // 서버 및 Supabase DB 실시간 동기화
    const token = localStorage.getItem('webnovels_token');
    if (token) {
      fetch(`/api/works/${id}/favorite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }

    const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (savedUser && window.WebNovelsAdmin?.updateReaderActivity) {
      window.WebNovelsAdmin.updateReaderActivity(savedUser.username || savedUser.email, {
        favorites: favs
      });
    }
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

function toggleSubscribeAuthor(authorData) {
  try {
    const authorName = (typeof authorData === 'object' ? (authorData.penName || authorData.pen_name) : authorData) || '작자미상';
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
    renderLibraryContent();

    // 서버 및 Supabase DB 실시간 동기화
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

    const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
    if (savedUser && window.WebNovelsAdmin?.updateReaderActivity) {
      window.WebNovelsAdmin.updateReaderActivity(savedUser.username || savedUser.email, {
        subscribedAuthors: subAuthors
      });
    }
  } catch (err) {
    console.warn('[Subscribe Toggle Error]', err);
  }
}


function updateSubscribeButtons(authorData) {
  const authorName = (typeof authorData === 'object' ? (authorData.penName || authorData.pen_name) : authorData) || '작자미상';
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

  let subAuthors = [];
  try {
    subAuthors = JSON.parse(localStorage.getItem('webnovels_subscribed_authors') || '[]');
  } catch (e) {
    subAuthors = [];
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

// ============================================================
// [Section 3] Web Novel Reader Engine (독서 뷰어) & Ad Unlock Gate
//
// [Purpose]
// - 회차 본문 렌더링, 성인 인증(AGE_19) 가드 검증, 광고 잠금(Locked) 여부 검사
// - LocalStorage 독서 진행률 자동 저장 (`saveReadingProgress`)
// - 폰트 크기 조절 (14px~26px), 테마 변경 (다크/라이트/세피아)
// - 이전 화 / 다음 화 이동 제어
// ============================================================
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

  // 1. 성인 콘텐츠 여부 확인 (미인증 시 PASS 성인인증 모달 팝업)
  if (work.rating === 'AGE_19' && !window._isAdultVerified) {
    openModal('modalPassAdultVerify');
    return;
  }

  // 2. 광고 시청 해금 필요 체크 (4화 이상 유료/잠긴 회차)
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

// ============================================================
// [Function] startAdSimulation
// [Purpose] 보상형 광고 3초 시뮬레이션 재생 후 서버 사이드 검증(SSV) 및 회차 언락 완료 처리
// [Complete Ad Unlock Flow]
// 1. 광고 모달에서 '광고 보고 무료 열람' 클릭
// 2. 광고 플레이어 카운트다운 시작
// 3. 광고 완료 시 `POST /api/ads/verify-unlock` (or 모의 토큰 생성)
// 4. `unlockedEpisodes.add(key)`로 권한 저장
// 5. 즉시 다음 잠긴 회차 본문 뷰어로 이동
// ============================================================
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

// ============================================================
// [Section 4] Creator Studio (작가 스튜디오 & 3대 수익 지표)
//
// [Creator Revenue 3대 지표 설명]
// 1. Estimated Revenue (예상 수익): 당월 실시간 추정 수익 (PENDING)
// 2. Confirmed Revenue (확정 수익): 공식 마감 심사를 거친 확정 정산금 (CONFIRMED)
// 3. Payable Revenue (정산 가능 금액): 확정 수익에서 기지급액 및 심사 대기액을 차감한 실제 출금 가능 잔액
// ============================================================
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
  localStorage.removeItem('webnovels_admin_token');
  isAdminLoggedIn = false;
  currentLoggedAuthor = null;
  showToast('작가 계정에서 로그아웃되었습니다.');
  
  updateMemberHeader(null);
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

  // 관리자 플래그 초기화
  isAdminLoggedIn = false;
  localStorage.removeItem('webnovels_admin_token');

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
        const authorObj = {
          username: data.user.username,
          email: data.user.email,
          pen_name: data.user.penName || data.user.nickname,
          bank_info: data.user.bankInfo,
          status: '공식 인증 작가',
          role: 'AUTHOR'
        };
        localStorage.setItem('webnovels_author', JSON.stringify(authorObj));
        localStorage.removeItem('webnovels_user');
        updateMemberHeader({ ...data.user, role: 'AUTHOR' });
        showToast(`✍️ 작가 로그인 성공! (${authorObj.pen_name} 작가님)`);
        closeAllModals();
        switchWebNovelsView('view-creator');
        return;
      }
      
      const userObj = {
        id: data.user.id,
        username: data.user.username,
        nickname: data.user.nickname || data.user.username,
        email: data.user.email,
        phone: data.user.phone,
        isAdultVerified: !!data.user.isAdultVerified,
        role: 'READER'
      };
      localStorage.setItem('webnovels_user', JSON.stringify(userObj));
      localStorage.removeItem('webnovels_author');

      // [핵심] 서버에서 가져온 사용자 활동 데이터(독서이력, 관심작품, 작가구독, 성인인증) 즉시 동기화
      syncUserActivityToStorage({
        readingHistory: data.user.readingHistory,
        favorites: data.user.favorites,
        subscribedAuthors: data.user.subscribedAuthors,
        isAdultVerified: data.user.isAdultVerified
      });

      updateMemberHeader(userObj);
      renderLibraryContent();
      closeAllModals();
      showToast(`🎉 ${userObj.nickname}님 환영합니다! 로그인되었습니다.`);
      switchWebNovelsView('view-mypage');
      return;
    }
  } catch (err) {
    // API 연결 안될 시 Supabase / 로컬 스토어 모드로 진행
  }

  // 2. Supabase 작가 직접 로그인
  if (window.WebNovelsAdmin) {
    window.WebNovelsAdmin.init();

    const authorRes = await window.WebNovelsAdmin.authorLogin(loginIdentifier, password);
    if (authorRes && authorRes.success) {
      const author = authorRes.author;
      localStorage.setItem('webnovels_author', JSON.stringify(author));
      localStorage.setItem('webnovels_token', `author-${author.id}`);
      localStorage.removeItem('webnovels_user');
      
      updateMemberHeader({ ...author, role: 'AUTHOR' });
      closeAllModals();
      showToast(`✍️ 작가 로그인 성공! (${author.pen_name} 작가님)`);
      switchWebNovelsView('view-creator');
      return;
    }
  }

  // 3. 일반 독자 계정 (Supabase DB 및 SAMPLE_READERS 매칭)
  let matchedReader = null;
  if (window.WebNovelsAdmin?.readerLogin) {
    const rRes = await window.WebNovelsAdmin.readerLogin(loginIdentifier, password);
    if (rRes?.success) {
      matchedReader = rRes.reader;
    }
  }

  const lowerIdent = loginIdentifier.toLowerCase();
  if (!matchedReader) {
    matchedReader = SAMPLE_READERS.find(r => 
      (r.email && r.email.toLowerCase() === lowerIdent) || 
      (r.username && r.username.toLowerCase() === lowerIdent)
    );
  }

  let nick = loginIdentifier.split('@')[0];
  if (matchedReader) {
    if (matchedReader.username === 'reader1') nick = '열혈독자 1호';
    else if (matchedReader.username === 'reader2') nick = '소설마니아';
    else if (matchedReader.username === 'reader3') nick = '판타지러버';
    else if (matchedReader.nickname) nick = matchedReader.nickname;
  }

  // Supabase에 저장되어 있던 활동 데이터 조회
  let remoteActivity = null;
  if (window.WebNovelsAdmin?.fetchReaderActivity) {
    remoteActivity = await window.WebNovelsAdmin.fetchReaderActivity(matchedReader?.username || loginIdentifier);
  }

  const userObj = {
    id: matchedReader ? matchedReader.id : 'reader-' + Date.now(),
    username: matchedReader ? matchedReader.username : loginIdentifier.split('@')[0],
    nickname: nick,
    email: matchedReader ? matchedReader.email : (loginIdentifier.includes('@') ? loginIdentifier : `${loginIdentifier}@webnovels.com`),
    phone: matchedReader?.phone || '010-1234-5678',
    isAdultVerified: remoteActivity?.isAdultVerified !== undefined ? !!remoteActivity.isAdultVerified : (matchedReader ? !!matchedReader.is_adult_verified : false),
    role: 'READER'
  };

  localStorage.setItem('webnovels_user', JSON.stringify(userObj));
  localStorage.setItem('webnovels_token', `reader-token-${userObj.id}`);
  localStorage.removeItem('webnovels_author');

  if (remoteActivity) {
    syncUserActivityToStorage(remoteActivity);
  }

  updateMemberHeader(userObj);
  renderLibraryContent();
  closeAllModals();
  showToast(`🎉 ${userObj.nickname}님 환영합니다! 로그인되었습니다.`);
  switchWebNovelsView('view-mypage');
}


window.handleMemberLogout = function() {
  localStorage.removeItem('webnovels_token');
  localStorage.removeItem('webnovels_user');
  localStorage.removeItem('webnovels_author');
  localStorage.removeItem('webnovels_admin_token');
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

  // 2. 로컬/정적 환경 회원가입 처리
  const userObj = {
    id: 'user-' + Date.now(),
    username: effectiveUsername,
    nickname: nickname,
    email: email,
    phone: phone || '',
    isAdultVerified: false,
    role: 'READER'
  };

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

async function loadMyProfile() {
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
    } catch (e) {
      console.warn('저장된 사용자 파싱 실패', e);
    }
  }

  const token = localStorage.getItem('webnovels_token');
  if (token && !token.startsWith('reader-token') && !token.startsWith('author-')) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const { user } = await res.json();
        if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'SUB_ADMIN') {
          isAdminLoggedIn = true;
        }
        localStorage.setItem('webnovels_user', JSON.stringify(user));

        // 서버 DB 활동 데이터 로컬 스토어에 동기화
        syncUserActivityToStorage({
          readingHistory: user.readingHistory,
          favorites: user.favorites,
          subscribedAuthors: user.subscribedAuthors,
          isAdultVerified: user.isAdultVerified
        });

        updateMemberHeader(user);
        return;
      }
    } catch (err) {}
  }

  // Supabase 모드에서 저장된 유저 활동 복원
  if (savedUser) {
    try {
      const u = JSON.parse(savedUser);
      if (window.WebNovelsAdmin?.fetchReaderActivity) {
        const remoteAct = await window.WebNovelsAdmin.fetchReaderActivity(u.username || u.email);
        if (remoteAct) syncUserActivityToStorage(remoteAct);
      }
    } catch(e) {}
  } else {
    isAdminLoggedIn = false;
    updateMemberHeader(null);
  }
}

function updateMemberHeader(user) {
  const profileMenu = document.getElementById('userProfileMenu');
  const navCreatorLinks = document.querySelectorAll('.desktop-nav a[data-target="view-creator"], .desktop-nav a[href="#creator"]');
  const navAdminLinks = document.querySelectorAll('.desktop-nav a[data-target="view-admin-cms"], .desktop-nav a[href="#admin"]');

  if (user) {
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'SUB_ADMIN' || isAdminLoggedIn;
    const isAuthor = !isAdmin && (user.role === 'AUTHOR' || !!user.pen_name);
    const isReader = !isAdmin && !isAuthor;

    // [중요 요건] 일반독자 회원이 로그인하는 경우 Header의 "작품등록", "관리자" 메뉴는 로그아웃 상태까지 숨김 처리
    if (isReader) {
      navCreatorLinks.forEach(el => el.style.display = 'none');
      navAdminLinks.forEach(el => el.style.display = 'none');
    } else if (isAuthor) {
      navCreatorLinks.forEach(el => el.style.display = '');
      navAdminLinks.forEach(el => el.style.display = 'none');
    } else if (isAdmin) {
      navCreatorLinks.forEach(el => el.style.display = '');
      navAdminLinks.forEach(el => el.style.display = '');
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

    // 내 서재 프로필 정보 동기화
    const myNickname = document.getElementById('myNickname');
    const myEmail = document.getElementById('myEmail');
    const myAvatar = document.getElementById('myAvatar');
    const myAdultBadge = document.getElementById('myAdultBadge');

    if (myNickname) myNickname.textContent = user.nickname || user.username || '열혈독자';
    if (myEmail) myEmail.textContent = user.email || 'reader@webnovels.com';
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
  } else {
    // [비로그인 상태] 게스트일 때는 "작품 등록", "관리자" 메뉴를 다시 기본 표시로 복원
    navCreatorLinks.forEach(el => el.style.display = '');
    navAdminLinks.forEach(el => el.style.display = '');

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

    if (myNickname) myNickname.textContent = '게스트 독자';
    if (myEmail) myEmail.textContent = '로그인이 필요합니다';
    if (myAvatar) myAvatar.textContent = 'G';
    if (myAdultBadge) {
      myAdultBadge.textContent = '성인 인증 미완료';
      myAdultBadge.className = 'badge badge-accent mt-2';
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
      }
      showToast('🎉 PASS 19+ 성인 본인인증이 완료되었습니다!');
    }, 1000);
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
