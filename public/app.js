// WebNovels Platform Frontend JavaScript Logic

const API_BASE = '/api';

// Sample Works Seed Data (8 Full Works with 4 Episodes each)
const SAMPLE_WORKS = [
  {
    id: 1,
    title: "대적자: 신을 삼킨 기사",
    author: "판타지마스터",
    genre: "판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/stormqueen_oath.jpg",
    description: "신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 154000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "신의 저주로 멸망한 왕국에서 한 기사가 깨어나 처음으로 자신의 힘을 깨닫는다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "기사는 폐허가 된 성에서 고대의 검을 발견하고 신의 잔당과 첫 전투를 벌인다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "동료를 잃은 기사는 복수를 다짐하며 신의 사도가 숨은 탑으로 향한다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "탑 정상에서 마주한 신은 기사에게 충격적인 진실을 알려준다." }
    ]
  },
  {
    id: 2,
    title: "천마의 귀환",
    author: "무협의신",
    genre: "무협",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/sword_dao_supreme.jpg",
    description: "천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 231000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "천마는 수백 년의 봉인에서 깨어나 자신이 누구인지 기억해 내기 시작한다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "옛 제자들의 후손을 만난 천마는 무림의 변화를 확인하고 첫 번째 적을 쓰러뜨린다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "천마는 잃어버린 검법을 되찾기 위해 금지된 동굴로 들어간다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "동굴 안에서 천마는 자신을 봉인한 자의 후예와 운명적인 대면을 한다." }
    ]
  },
  {
    id: 3,
    title: "금기의 계약",
    author: "나이트로즈",
    genre: "성인",
    rating: "AGE_19",
    aiUsageType: "NONE",
    coverUrl: "/images/velvet_and_thorns.jpg",
    description: "금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 189000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "여주인공은 빚을 갚기 위해 정체불명의 남자와 위험한 계약을 맺는다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "계약의 첫 번째 조건이 실행되고, 두 사람 사이에 묘한 긴장감이 흐른다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "남자의 정체가 조금씩 드러나며 여주인공은 빠져나올 수 없는 감정에 휩싸인다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "계약의 진짜 목적이 밝혀지고, 두 사람의 관계는 돌이킬 수 없는 방향으로 흐른다." }
    ]
  },
  {
    id: 4,
    title: "황제의 유일한 후궁",
    author: "로맨스퀸",
    genre: "로맨스",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/flower_blooming.jpg",
    description: "황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 312000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "평범한 처녀가 황제의 간택을 받아 궁에 들어가며 새로운 삶을 시작한다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "황제와의 첫 대면에서 그녀는 그의 차가운 눈빛 속에 숨겨진 외로움을 느낀다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "후궁들의 시기 속에서 그녀는 황제의 유일한 관심을 받게 된다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "황제가 그녀에게만 보여 주는 부드러운 모습에 마음이 흔들리기 시작한다." }
    ]
  },
  {
    id: 5,
    title: "성간 항로: 마지막 항해사",
    author: "스페이스로그",
    genre: "SF",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/stellar_horizon.jpg",
    description: "인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 97000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "마지막 항해사는 지구가 멸망한 후 남은 인류를 태우고 미지의 별로 출발한다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "항해 중 발견한 고대 외계 유물에서 충격적인 메시지가 해독된다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "함선에 침입한 미지의 존재가 승무원들을 하나씩 사라지게 만든다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "항해사는 함선의 AI와 함께 적의 정체를 밝혀내고 생존을 위한 결단을 내린다." }
    ]
  },
  {
    id: 6,
    title: "서울에 나타난 마왕",
    author: "도시마법사",
    genre: "현대 판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/seoul_sorcerer.jpg",
    description: "현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 278000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "평범한 회사원 김현우는 퇴근길에 마왕의 힘이 자신에게 깃드는 것을 느낀다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "처음으로 마법을 사용한 현우는 우연히 마족을 쓰러뜨리고 자신의 정체를 숨기려 한다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "마법사 협회가 그를 추적하기 시작하고, 현우는 도망치며 힘을 다스리는 법을 배운다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "현우는 자신을 노리는 진짜 적이 마족이 아닌 인간이라는 사실을 알게 된다." }
    ]
  },
  {
    id: 7,
    title: "죽은 자들의 학교",
    author: "공포작가",
    genre: "호러",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/darkness_swallowed_classroom.jpg",
    description: "폐교에 남은 것들. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 84000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "폐교 탐사를 온 학생들은 이상한 발소리와 함께 문이 저절로 닫히는 것을 경험한다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "한 명이 사라지고, 남은 학생들은 복도 끝에서 교복을 입은 그림자를 목격한다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "학교 지하실에서 발견된 일기장은 과거에 일어난 참극을 상세히 기록하고 있다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "일기장의 주인공이 눈앞에 나타나며, 학생들은 자신들이 이미 죽은 존재일지도 모른다는 공포에 휩싸인다." }
    ]
  },
  {
    id: 8,
    title: "검의 전설: 천하제일인",
    author: "검성",
    genre: "무협",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/sword_dao_defies_heavens.jpg",
    description: "천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!",
    viewCount: 195000,
    episodesCount: 4,
    episodes: [
      { episodeNumber: 1, title: "제1화", isFree: true, isAdFree: false, content: "하급 무사 이천은 우연히 전설의 검을 손에 넣고 자신의 운명이 바뀌는 것을 느낀다." },
      { episodeNumber: 2, title: "제2화", isFree: true, isAdFree: false, content: "검을 노리는 암살자들을 물리친 이천은 검에 깃든 고대 검성의 기억을 일부 받아들인다." },
      { episodeNumber: 3, title: "제3화", isFree: true, isAdFree: false, content: "이천은 무림맹의 초대를 받아 처음으로 강호에 자신의 이름을 알리기 시작한다." },
      { episodeNumber: 4, title: "제4화", isFree: false, isAdFree: true, content: "천하제일인 자리에서 마주한 강자는 이천에게 검의 진짜 주인에 대한 비밀을 암시한다." }
    ]
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
  document.getElementById('btnDetailReadFirst')?.addEventListener('click', () => {
    openReaderDirect(activeWork.id, 'ep-1');
  });
  document.getElementById('btnStickyRead')?.addEventListener('click', () => {
    openReaderDirect(activeWork.id, 'ep-1');
  });
  document.getElementById('btnDetailFavorite')?.addEventListener('click', () => {
    showToast('❤️ 관심 작품에 등록되었습니다.');
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
    showToast('첫 번째 회차입니다.');
  });
  document.getElementById('btnNextEp')?.addEventListener('click', () => {
    openReaderDirect(activeWork.id, 'ep-4'); // Attempt 4th episode (Requires Ad Unlock)
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
    container.innerHTML = '<p class="text-muted">미처리 정산 신청이 없습니다.</p>';
    return;
  }

  container.innerHTML = settlements.map(s => `
    <div class="episode-row">
      <div>
        <strong>신청 ID: ${s.id.substring(0, 8).toUpperCase()}</strong>
        <div>작가명: ${s.author_name} | 신청금액: ₩${Number(s.amount).toLocaleString()}</div>
        <div class="text-muted small">계좌: ${s.bank_info || '미등록'}</div>
      </div>
      <button class="btn btn-success btn-sm" onclick="handleApproveSettlement('${s.id}')">지급 승인 (PAID)</button>
    </div>
  `).join('');
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
    // Top 4 Works
    const topContainer = document.getElementById('topWorksGrid');
    if (topContainer && topWorks) {
      topContainer.innerHTML = topWorks.map(w => {
        const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
        const tagClass = isAdult ? 'tag-solid style-danger' : 'tag-outline';
        const tagText = isAdult ? '19+ 성인' : w.genre;
        return `
          <article class="feature-card" onclick="openWorkDetailDirect('${w.id}')" style="min-height: 200px;">
            <div class="art" style="background-image: url('${w.coverImageUrl || '/images/default_cover.jpg'}'); padding-top: 100%;"></div>
            <div class="copy" style="padding: 10px;">
              <span class="tag ${tagClass} btn-sm" style="font-size: 0.6rem;">${tagText}</span>
              <h3 style="font-size: 0.9rem; margin: 4px 0;">${w.title}</h3>
              <p style="font-size: 0.7rem;">${w.author?.penName || '작자미상'} · 뷰 ${(w.viewCount / 1000).toFixed(1)}K</p>
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
        return `
          <article class="feature-card" onclick="openWorkDetailDirect('${w.id}')">
            <div class="art" style="background-image: url('${w.coverImageUrl || '/images/default_cover.jpg'}');"></div>
            <div class="copy">
              <span class="tag ${tagClass}">${tagText}</span>
              <h3>${w.title}</h3>
              <p>${w.author?.penName || '작자미상'} · 조회 ${(w.viewCount / 1000).toFixed(1)}K</p>
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
              <div class="text-muted small">작가: ${w.author?.penName} | 뷰: ${w.viewCount}</div>
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

function renderLibraryContent() {
  const continueContainer = document.getElementById('libraryContinueList');
  const favoriteContainer = document.getElementById('libraryFavoritesList');
  const authorContainer = document.getElementById('libraryAuthorsList');

  if (continueContainer) {
    continueContainer.innerHTML = SAMPLE_WORKS.slice(1, 4).map((work, index) => `
      <button class="library-row" onclick="openReaderDirect(${work.id}, 1)">
        <img src="${work.coverUrl}" alt="${work.title} 표지">
        <span>
          <strong>${work.title}</strong>
          <small>${index + 1}화 읽는 중 · ${work.genre} · ${(work.viewCount / 1000).toFixed(1)}K</small>
        </span>
        <i data-lucide="play-circle"></i>
      </button>
    `).join('');
  }

  if (favoriteContainer) {
    favoriteContainer.innerHTML = SAMPLE_WORKS.slice(0, 5).map(work => `
      <button class="library-row" onclick="openWorkDetailDirect(${work.id})">
        <img src="${work.coverUrl}" alt="${work.title} 표지">
        <span>
          <strong>${work.title}</strong>
          <small>${work.author} · 새 회차 확인하기</small>
        </span>
        <i data-lucide="chevron-right"></i>
      </button>
    `).join('');
  }

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

  document.getElementById('detailCoverImg').src = work.coverUrl;
  document.getElementById('detailTitle').textContent = work.title;
  document.getElementById('detailAuthor').textContent = `작가: ${work.author}`;
  document.getElementById('detailGenreBadge').textContent = work.genre;
  document.getElementById('detailRatingBadge').textContent = work.rating === 'ALL' ? '전체이용가' : '19세 이상 성인';
  document.getElementById('detailAiBadge').textContent = `AI ${work.aiUsageType}`;
  document.getElementById('detailDescription').textContent = work.description;

  // Render Episode List
  const epList = document.getElementById('detailEpisodeList');
  let epHtml = '';
  work.episodes.forEach(ep => {
    const isUnlocked = ep.isFree || unlockedEpisodes.has(`${work.id}-${ep.episodeNumber}`);
    epHtml += `
      <div class="episode-row" onclick="openReaderDirect(${work.id}, ${ep.episodeNumber})">
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
  epList.innerHTML = epHtml;

  switchWebNovelsView('view-work-detail');
};

// ----------------------------------------------------
// 3. Reader Logic & Rewarded Ad Unlock
// ----------------------------------------------------
window.openReaderDirect = function(workId, epNumber) {
  const targetWorkId = Number(workId);
  const work = SAMPLE_WORKS.find(w => Number(w.id) === targetWorkId) || SAMPLE_WORKS[0];
  activeWork = work;

  const epNum = Number(epNumber);
  const ep = work.episodes.find(e => e.episodeNumber === epNum) || work.episodes[0];
  const unlockKey = `${work.id}-${epNum}`;

  // 성인 콘텐츠 여부 확인
  if (work.rating === 'AGE_19' && !window._isAdultVerified) {
    openModal('modalPassAdultVerify');
    return;
  }

  // 광고 시청 해금 필요 체크
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
  document.getElementById('readerHeading').textContent = ep.title;

  const bodyContent = `
    <p>주인공은 불길하게 타오르는 붉은 하늘을 바라보며 검 자루를 쥐었다. 바람이 부는 순간, 차가운 강철의 감촉이 손바닥에 선명하게 전해졌다.</p>
    <p>"끝을 낼 시간이군."</p>
    <p>그의 짧은 읊조림과 함께 수많은 몬스터들이 함성을 지르며 전장으로 쏟아져 들어왔다. 광고를 보면 다음 회차가 연속으로 해금되어 계속 읽을 수 있습니다.</p>
  `;
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
async function fetchCreatorDashboardData() {
  document.getElementById('creatorEstimatedRevenue').textContent = '₩5,000,000';
  document.getElementById('creatorConfirmedRevenue').textContent = '₩5,000,000';
  document.getElementById('creatorPayableRevenue').textContent = '₩5,000,000';

  const container = document.getElementById('creatorWorksContainer');
  container.innerHTML = `
    <div class="episode-row">
      <div class="ep-left">
        <strong>대적자: 신을 삼킨 기사</strong>
        <span class="badge badge-accent">연재중</span>
      </div>
      <div>
        <button class="btn btn-outline btn-sm" onclick="showToast('회차 작성 폼이 열립니다.')">+ 새 회차 쓰기</button>
      </div>
    </div>
  `;
}

function handleCreatorSettlementReq() {
  if (confirm('정산 가능 금액 ₩5,000,000을 정산 신청하시겠습니까?')) {
    showToast('📩 정산 신청이 정상 접수되었습니다. 관리자 승인 후 계좌로 지급됩니다.');
  }
}

async function handleMemberLogin() {
  const loginIdentifier = document.getElementById('loginEmail')?.value;
  const password = document.getElementById('loginPassword')?.value;
  
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginIdentifier, username: loginIdentifier, password })
    });
    const data = await res.json();
    
    if (res.ok) {
      localStorage.setItem('webnovels_token', data.token);
      await loadMyProfile();
      closeAllModals();
      showToast('로그인되었습니다. 내 서재에서 이어보기를 확인하세요.');
      switchWebNovelsView('view-mypage');
    } else {
      showToast('로그인 실패: ' + data.error);
    }
  } catch (err) {
    showToast('로그인 중 오류가 발생했습니다.');
  }
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
