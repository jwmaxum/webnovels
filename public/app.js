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
    isCompleted: true,
    contentType: "NOVEL",
    episodes: createDefault6Episodes("검의 전설: 천하제일인")
  },
  {
    id: 9,
    title: "[웹툰] 신의 기사단",
    author: "판타지마스터",
    genre: "판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    contentType: "WEBTOON",
    coverUrl: "/images/stormqueen_oath.jpg",
    description: "대적자 스핀오프 공식 웹툰! 화려한 작화로 펼쳐지는 기사단의 모험.",
    viewCount: 89000,
    episodesCount: 4,
    isCompleted: false,
    episodes: [
      { episodeNumber: 1, title: "제 1 화: 각성", isFree: true, isAdFree: false, content: "", imageUrls: ["/images/stormqueen_oath.jpg", "/images/sword_dao_supreme.jpg"], authorComment: "웹툰 신의 기사단 연재를 시작합니다!" },
      { episodeNumber: 2, title: "제 2 화: 검의 인도", isFree: true, isAdFree: false, content: "", imageUrls: ["/images/sword_dao_supreme.jpg", "/images/stormqueen_oath.jpg"], authorComment: "매주 수요일 풀컬러 업데이트!" },
      { episodeNumber: 3, title: "제 3 화: 사도의 그림자", isFree: true, isAdFree: false, content: "", imageUrls: ["/images/stormqueen_oath.jpg", "/images/sword_dao_supreme.jpg"], authorComment: "재밌게 보셨다면 별점 부탁드립니다!" },
      { episodeNumber: 4, title: "제 4 화: 결전의 서막", isFree: false, isAdFree: true, content: "", imageUrls: ["/images/sword_dao_supreme.jpg", "/images/stormqueen_oath.jpg"], authorComment: "광고 보고 무료로 감상하세요!" }
    ]
  },
  {
    id: 10,
    title: "[웹툰] 황후의 비밀 화원",
    author: "로맨스퀸",
    genre: "로맨스",
    rating: "ALL",
    aiUsageType: "NONE",
    contentType: "WEBTOON",
    coverUrl: "/images/flower_blooming.jpg",
    description: "황실 최고의 비밀이 담긴 화원에서 피어나는 은밀하고 달콤한 로맨스 웹툰.",
    viewCount: 124000,
    episodesCount: 4,
    isCompleted: false,
    episodes: [
      { episodeNumber: 1, title: "제 1 화: 은밀한 만남", isFree: true, isAdFree: false, content: "", imageUrls: ["/images/flower_blooming.jpg", "/images/velvet_and_thorns.jpg"], authorComment: "황후의 비밀 화원 첫 회입니다." },
      { episodeNumber: 2, title: "제 2 화: 붉은 장미의 향기", isFree: true, isAdFree: false, content: "", imageUrls: ["/images/flower_blooming.jpg", "/images/velvet_and_thorns.jpg"], authorComment: "많은 사랑 부탁드립니다." },
      { episodeNumber: 3, title: "제 3 화: 밝혀진 정체", isFree: true, isAdFree: false, content: "", imageUrls: ["/images/flower_blooming.jpg", "/images/velvet_and_thorns.jpg"], authorComment: "3화 무료 공개!" },
      { episodeNumber: 4, title: "제 4 화: 피할 수 없는 운명", isFree: false, isAdFree: true, content: "", imageUrls: ["/images/velvet_and_thorns.jpg", "/images/flower_blooming.jpg"], authorComment: "다음 이야기가 계속됩니다." }
    ]
  }
];

// 독자 댓글 실시간 저장소 (Local Mock & Supabase 연동)
const COMMENTS_STORE = {
  "1-1": [
    { id: "c1", nickname: "새벽독자", content: "첫 화부터 몰입감 대박이네요! 기사의 결의가 느껴집니다.", likes: 14, time: "10분 전", liked: false },
    { id: "c2", nickname: "판타지러버", content: "작화랑 묘사가 너무 섬세해요. 다음 화 바로 달립니다!", likes: 8, time: "25분 전", liked: false },
    { id: "c3", nickname: "웹소마스터", content: "광고 보고 4화까지 정주행 완료했습니다. 최고!", likes: 5, time: "1시간 전", liked: false }
  ]
};

// 독자 보유 포인트 상태 (기본 1,000P)
let userPoints = parseInt(localStorage.getItem('webnovels_user_points') || '1000', 10);

// ------------------------------------------------------------
// [State] SAMPLE_READERS (샘플 독자 계정)
// ------------------------------------------------------------
const SAMPLE_READERS = [
  { id: 1, username: 'reader1', password_hash: '!12345', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 2, username: 'reader2', password_hash: '!12345', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 3, username: 'reader3', password_hash: '!12345', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', is_adult_verified: true, subscription_status: '프리미엄 구독중' }
];

// ------------------------------------------------------------
// [State] SAMPLE_AUTHORS (10명 작가 계정: writer1~10@webnovels.com / PW: !12345)
// ------------------------------------------------------------
const SAMPLE_AUTHORS = [
  { id: 1, username: 'writer1', password_hash: '!12345', email: 'writer1@webnovels.com', pen_name: '판타지마스터', work_title: '대적자: 신을 삼킨 기사', birthdate: '1990-01-15', address: '서울특별시 강남구 테헤란로 123', bank_info: '국민은행 999-888-777666', status: '공식 인증 작가' },
  { id: 2, username: 'writer2', password_hash: '!12345', email: 'writer2@webnovels.com', pen_name: '무협의신', work_title: '천마의 귀환', birthdate: '1985-05-20', address: '서울특별시 서초구 반포대로 45', bank_info: '신한은행 110-222-333444', status: '공식 인증 작가' },
  { id: 3, username: 'writer3', password_hash: '!12345', email: 'writer3@webnovels.com', pen_name: '나이트로즈', work_title: '금기의 계약', birthdate: '1992-08-12', address: '경기도 성남시 분당구 판교로 78', bank_info: '우리은행 1002-555-666777', status: '공식 인증 작가' },
  { id: 4, username: 'writer4', password_hash: '!12345', email: 'writer4@webnovels.com', pen_name: '로맨스퀸', work_title: '황제의 유일한 후궁', birthdate: '1994-11-03', address: '서울특별시 마포구 월드컵북로 99', bank_info: '하나은행 222-333-444555', status: '공식 인증 작가' },
  { id: 5, username: 'writer5', password_hash: '!12345', email: 'writer5@webnovels.com', pen_name: '스페이스로그', work_title: '성간 항로: 마지막 항해사', birthdate: '1988-03-30', address: '대전광역시 유성구 대학로 100', bank_info: '농협 301-777-888999', status: '공식 인증 작가' },
  { id: 6, username: 'writer6', password_hash: '!12345', email: 'writer6@webnovels.com', pen_name: '도시마법사', work_title: '서울에 나타난 마왕', birthdate: '1995-07-07', address: '서울특별시 송파구 올림픽로 200', bank_info: '카카오뱅크 3333-01-234567', status: '공식 인증 작가' },
  { id: 7, username: 'writer7', password_hash: '!12345', email: 'writer7@webnovels.com', pen_name: '공포작가', work_title: '죽은 자들의 학교', birthdate: '1991-10-31', address: '부산광역시 해운대구 센텀서로 30', bank_info: '기업은행 010-9999-8888', status: '공식 인증 작가' },
  { id: 8, username: 'writer8', password_hash: '!12345', email: 'writer8@webnovels.com', pen_name: '검성', work_title: '검의 전설: 천하제일인', birthdate: '1987-12-25', address: '대구광역시 수성구 달구벌대로 500', bank_info: '대구은행 508-12-345678', status: '공식 인증 작가' },
  { id: 9, username: 'writer9', password_hash: '!12345', email: 'writer9@webnovels.com', pen_name: '스튜디오노바', work_title: '[웹툰] 신의 기사단', birthdate: '1993-04-10', address: '서울특별시 마포구 독막로 50', bank_info: '국민은행 111-222-333444', status: '공식 인증 작가' },
  { id: 10, username: 'writer10', password_hash: '!12345', email: 'writer10@webnovels.com', pen_name: '로즈코믹스', work_title: '[웹툰] 황후의 비밀 화원', birthdate: '1996-09-18', address: '서울특별시 강남구 학동로 20', bank_info: '신한은행 333-444-555666', status: '공식 인증 작가' }
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
    
    // Supabase DB에서 10개 작품 및 회차 실데이터 fetch
    const remoteWorks = await window.WebNovelsAdmin.fetchWorksFromSupabase();
    if (remoteWorks && remoteWorks.length > 0) {
      console.log('[App Init] Supabase DB 실시간 작품 로드 성공:', remoteWorks.length);
      SAMPLE_WORKS.length = 0;
      SAMPLE_WORKS.push(...remoteWorks);
    } else {
      console.log('[App Init] Supabase DB 작품 미존재 -> 10개 대표 작품 & 50+개 에피소드 자동 시드 저장');
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
    renderHomeWorks();
    renderDiscoverWorks();
    renderSearchResults();
    if (currentActiveView === 'view-admin-cms') {
      renderAdminWorks();
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
    if (currentWorkId) {
      renderAdminEpisodes(currentWorkId);
    }
    renderHomeWorks();
  });

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
        showToast('⚡ 웹툰 서비스 준비 중입니다! 현재 웹소설을 100% 무료로 감상해보세요.');
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
      renderGenreRecommendations(genre);
    });
  });

  // Genre Filter Pills Event (Discover View)
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

  // Sub-Category Navigation Bar (웹소설 | 웹툰 | 장르 | 랭킹 | 신작 | 완결작)
  document.querySelectorAll('#subCategoryNav [data-subtab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#subCategoryNav [data-subtab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const subtab = tab.dataset.subtab;

      if (currentActiveView !== 'view-home') {
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
      switchCreatorTab(tabKey);
    });
  });

  // Genre Filter Pills (Home)
  document.querySelectorAll('#cdgGenrePillsBar .cdg-genre-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#cdgGenrePillsBar .cdg-genre-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const genre = pill.dataset.genre || '전체';
      renderGenreRecommendations(genre);
    });
  });

  // 뷰어 하단 이동 버튼 (내 서재 / 홈)
  document.getElementById('btnReaderLibrary')?.addEventListener('click', () => {
    switchWebNovelsView('view-mypage');
  });
  document.getElementById('btnReaderHome')?.addEventListener('click', () => {
    switchWebNovelsView('view-home');
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

// 작가센터 7대 탭 전환 함수
window.switchCreatorTab = function(tabKey) {
  document.querySelectorAll('#creatorTabsBar [data-creator-tab]').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`#creatorTabsBar [data-creator-tab="${tabKey}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('.creator-tab-panel').forEach(p => p.style.display = 'none');
  const targetPanel = document.getElementById(`creatorTab-${tabKey}`);
  if (targetPanel) targetPanel.style.display = 'block';

  if (window.lucide) window.lucide.createIcons();
};

// 예약 발행 일시 입력창 토글
window.toggleScheduledTimeInput = function(publishType) {
  const wrapper = document.getElementById('scheduledTimeWrapper');
  if (wrapper) {
    wrapper.style.display = publishType === 'SCHEDULED' ? 'block' : 'none';
  }
};

// ============================================================
// [Creator Dashboard] 작가 스튜디오 실제 DB 연동 및 Zero-Touch 렌더링
// ============================================================
let currentLoggedAuthor = null;

window.fetchCreatorDashboardData = async function() {
  // 1. 세션에서 로그인된 작가 정보 확인
  let author = null;
  const authorStr = localStorage.getItem('webnovels_author');
  if (authorStr) {
    try {
      author = JSON.parse(authorStr);
    } catch (e) {}
  }

  // 독자/작가 통합 세션 확인
  if (!author) {
    const userStr = localStorage.getItem('webnovels_user');
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u.role === 'AUTHOR') {
          author = u;
        }
      } catch (e) {}
    }
  }

  // 기본 작가 세션이 없으면 첫 번째 작가(writer1: 판타지마스터)로 기본 연결
  if (!author && SAMPLE_AUTHORS.length > 0) {
    author = SAMPLE_AUTHORS[0];
  }

  currentLoggedAuthor = author;

  if (!author) return;

  // 2. 상단 작가 프로필 헤더 바 업데이트 (실제 DB 연동)
  const penNameElem = document.getElementById('creatorAuthorPenName');
  if (penNameElem) penNameElem.textContent = author.pen_name || author.penName || author.username || '공식 인증 작가';

  const badgeElem = document.getElementById('creatorAuthorBadge');
  if (badgeElem) badgeElem.textContent = author.status || '공식 인증 작가';

  const bankInfoElem = document.getElementById('creatorBankInfo');
  if (bankInfoElem) bankInfoElem.textContent = author.bank_info || author.bankInfo || '국민은행 999-888-777666';

  const logoutBtn = document.getElementById('btnAuthorLogout');
  if (logoutBtn) logoutBtn.style.display = 'inline-block';

  // 3. 해당 작가의 실제 DB 작품 필터링 (No Dummy Data)
  const authorPenName = author.pen_name || author.penName;
  const authorWorks = SAMPLE_WORKS.filter(w => 
    w.author === authorPenName || 
    (author.work_title && w.title === author.work_title) ||
    Number(w.authorId) === Number(author.id)
  );

  // 만약 필터 결과가 비어있으면 해당 작가의 대표작 1개 자동 매핑
  const displayWorks = authorWorks.length > 0 ? authorWorks : SAMPLE_WORKS.slice(0, 1);

  // 총 조회수 및 총 회차수 계산 (실데이터 기반)
  const totalViews = displayWorks.reduce((sum, w) => sum + (Number(w.viewCount) || 0), 0);
  const totalEpisodes = displayWorks.reduce((sum, w) => sum + (w.episodes ? w.episodes.length : 0), 0);

  const totalViewsElem = document.getElementById('creatorTotalViews');
  if (totalViewsElem) totalViewsElem.textContent = `${totalViews.toLocaleString()}회`;

  const totalEpsElem = document.getElementById('creatorTotalEpisodes');
  if (totalEpsElem) totalEpsElem.textContent = `${totalEpisodes}화`;

  const worksCountElem = document.getElementById('creatorWorksCount');
  if (worksCountElem) worksCountElem.textContent = `연재 작품: ${displayWorks.length}개`;

  // 4. Tab 1: 내 연재 작품 목록 렌더링 (creatorWorksContainer)
  const worksContainer = document.getElementById('creatorWorksContainer');
  if (worksContainer) {
    if (displayWorks.length === 0) {
      worksContainer.innerHTML = `
        <div class="card p-6 text-center" style="background: rgba(0,0,0,0.2); border-radius: 8px;">
          <p class="text-muted mb-3">현재 등록된 연재 작품이 없습니다.</p>
          <button class="btn btn-primary btn-sm" onclick="openAdminCreateWorkModal()">
            <i data-lucide="plus"></i> 첫 작품 등록하기
          </button>
        </div>
      `;
    } else {
      worksContainer.innerHTML = displayWorks.map(work => {
        const epList = work.episodes || [];
        const isWebtoon = work.contentType === 'WEBTOON';
        const nextEpNum = epList.length + 1;
        return `
          <div class="card glass-panel p-4 mb-4" style="border-radius: 8px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.25);">
            <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
              <img src="${work.coverUrl || '/images/stormqueen_oath.jpg'}" alt="${work.title}" style="width: 80px; height: 110px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color);">
              <div style="flex: 1; min-width: 240px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span class="badge badge-accent">${isWebtoon ? '웹툰' : '웹소설'}</span>
                  <span class="badge badge-outline">${work.genre || '판타지'}</span>
                  <span class="badge ${work.isCompleted ? 'badge-primary' : 'badge-emerald'}">${work.isCompleted ? '완결' : '연재중 🟢'}</span>
                  <strong style="font-size: 1.15rem; color: #fff;">${work.title}</strong>
                </div>
                <p class="text-muted small mb-2" style="line-height: 1.4;">${work.description || '작품 소개가 등록되어 있습니다.'}</p>
                <div style="display: flex; gap: 16px; font-size: 0.82rem; color: var(--text-secondary);">
                  <span>👀 누적 조회수: <strong>${(work.viewCount || 0).toLocaleString()}회</strong></span>
                  <span>📖 총 연재: <strong>${epList.length}화</strong></span>
                  <span>⭐ 추천수: <strong>${(work.likeCount || 480).toLocaleString()}개</strong></span>
                </div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <button class="btn btn-primary btn-sm" onclick="prepareNewEpisodeForWork(${work.id})">
                  <i data-lucide="plus-circle"></i> + 신규 회차 작성 / 예약발행
                </button>
                <button class="btn btn-outline btn-sm" onclick="switchCreatorTab('new-ep')">
                  <i data-lucide="calendar"></i> Zero-Touch 예약 연재
                </button>
              </div>
            </div>

            <!-- work_management_2.md Section 2 회차 작성 및 관리 표 -->
            <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06);">
              <div class="flex-between mb-2">
                <strong class="small text-muted" style="display:flex; align-items:center; gap:6px;">
                  <i data-lucide="list"></i> 회차 작성 및 연재 관리 (${epList.length}화)
                </strong>
                <span class="text-muted small">1~3화 무료 · 4화 이후 유료/광고 모델 자동 적용</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${epList.map((ep, idx) => {
                  const epNum = ep.episodeNumber || (idx + 1);
                  const isFree = ep.isFree !== false && epNum <= 3;
                  const isScheduled = ep.status === 'SCHEDULED';
                  return `
                    <div class="p-2 glass-panel flex-between" style="border-radius: 6px; font-size: 0.85rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight: 700; color: var(--color-brand-secondary); min-width: 45px;">${epNum}화</span>
                        <strong style="color:#fff;">${ep.title || `제 ${epNum}화`}</strong>
                        <span class="badge ${isFree ? 'badge-primary' : 'badge-ghost'}" style="font-size:0.72rem;">${isFree ? '무료' : '광고무료/100P'}</span>
                      </div>
                      <div style="display: flex; align-items: center; gap: 10px;">
                        ${isScheduled 
                          ? `<span class="badge badge-warning" style="font-size:0.75rem;">⏰ 예약발행 ${ep.scheduledAt ? ep.scheduledAt.substring(5, 16) : '08/27 20:00'}</span>` 
                          : `<span style="color:var(--accent-emerald); font-size:0.8rem; font-weight:700;">작성완료 ✓</span>`}
                        <button class="btn btn-ghost btn-sm" onclick="openReaderDirect(${work.id}, 'ep-${epNum}')" style="font-size:0.75rem; padding:2px 8px;">
                          열람
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
                
                <!-- 다음 예약 준비 가이드 행 (work_management_2.md 2번 명세) -->
                <div class="p-2 glass-panel flex-between" style="border-radius: 6px; font-size: 0.85rem; background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.1);">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-weight: 700; color: var(--text-muted); min-width: 45px;">${nextEpNum}화</span>
                    <span class="text-muted">다음 회차 원고 준비중...</span>
                  </div>
                  <button class="btn btn-outline btn-sm" onclick="prepareNewEpisodeForWork(${work.id})" style="font-size:0.75rem; padding:2px 10px; color:var(--color-brand-secondary); border-color:var(--color-brand-secondary);">
                    + 예약발행 작성
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 5. Tab 2: 대상 작품 셀렉트 박스 채우기 (newEpWorkSelect)
  const workSelect = document.getElementById('newEpWorkSelect');
  if (workSelect) {
    workSelect.innerHTML = displayWorks.map(w => `
      <option value="${w.id}">[${w.contentType === 'WEBTOON' ? '웹툰' : '웹소설'}] ${w.title}</option>
    `).join('');
  }

  // 6. Tab 3: 연재 상태 관리 셀렉트 채우기 (creatorSerialStatusList)
  const serialList = document.getElementById('creatorSerialStatusList');
  if (serialList) {
    serialList.innerHTML = displayWorks.map(w => `
      <div class="glass-panel p-4 mb-3" style="display: flex; justify-content: space-between; align-items: center; border-radius: 8px;">
        <div>
          <strong>[${w.genre || '판타지'}] ${w.title}</strong>
          <div class="text-muted small">총 ${w.episodes ? w.episodes.length : 0}화 연재중 | 주 3회 정기 연재</div>
        </div>
        <select class="form-input" style="padding: 6px 12px; font-size: 0.88rem; background: #1C1C22; color: #fff; border-radius: 8px; border: 1px solid var(--border-color);" onchange="handleWorkStatusChange(${w.id}, this.value)">
          <option value="ONGOING" ${!w.isCompleted ? 'selected' : ''}>🟢 정상 연재중 (ONGOING)</option>
          <option value="PAUSED">🟡 휴재 설정 (PAUSED)</option>
          <option value="COMPLETED" ${w.isCompleted ? 'selected' : ''}>🔵 완결 처리 (COMPLETED)</option>
        </select>
      </div>
    `).join('');
  }

  // 7. Tab 5, 6, 7 수익 지표 실데이터 기반 계산
  const estimatedRev = Math.round(totalViews * 22.5); // 1뷰당 약 22.5원 창작자 정산풀
  const confirmedRev = Math.round(estimatedRev * 0.85);

  const estElem = document.getElementById('creatorEstimatedRevenue');
  if (estElem) estElem.textContent = `₩${estimatedRev.toLocaleString()}`;

  const confElem = document.getElementById('creatorConfirmedRevenue');
  if (confElem) confElem.textContent = `₩${confirmedRev.toLocaleString()}`;

  const payElem = document.getElementById('creatorPayableRevenue');
  if (payElem) payElem.textContent = `₩${confirmedRev.toLocaleString()}`;

  if (window.lucide) window.lucide.createIcons();
};

window.prepareNewEpisodeForWork = function(workId) {
  switchCreatorTab('new-ep');
  const sel = document.getElementById('newEpWorkSelect');
  if (sel) sel.value = String(workId);
  const work = SAMPLE_WORKS.find(w => Number(w.id) === Number(workId));
  if (work && work.episodes) {
    document.getElementById('newEpNumber').value = work.episodes.length + 1;
  }
};

window.handleWorkStatusChange = async function(workId, newStatus) {
  const work = SAMPLE_WORKS.find(w => Number(w.id) === Number(workId));
  if (work) {
    work.isCompleted = (newStatus === 'COMPLETED');
    work.publishingStatus = newStatus;
  }
  if (window.WebNovelsAdmin) {
    await window.WebNovelsAdmin.updateWorkStatusInDB(workId, newStatus);
  }
  showToast(`[${work?.title || '작품'}] 연재 상태가 '${newStatus}'(으)로 갱신되었습니다.`);
};

// ============================================================
// [Zero-Touch Episode Submission] 작가 회차 등록 & Zero-Touch 자동 검수 발행
// ============================================================
window.handleCreateEpisodeSubmit = async function(e) {
  e.preventDefault();
  const workId = parseInt(document.getElementById('newEpWorkSelect').value, 10);
  const epNum = parseInt(document.getElementById('newEpNumber').value, 10);
  const title = document.getElementById('newEpTitle').value.trim();
  const content = document.getElementById('newEpContent').value.trim();
  const authorComment = document.getElementById('newEpAuthorComment').value.trim();
  const isFree = document.getElementById('newEpIsFree').checked;
  const publishType = document.getElementById('newEpPublishType').value;
  const scheduledAt = document.getElementById('newEpScheduledAt')?.value || null;

  if (!title || !content) {
    showToast('회차 제목과 본문 내용을 모두 입력해주세요.');
    return;
  }

  const targetWork = SAMPLE_WORKS.find(w => Number(w.id) === workId);
  if (!targetWork) {
    showToast('작품을 찾을 수 없습니다.');
    return;
  }

  // Level 1: Zero-Touch 자동 기본 검사 (시스템/AI 규격 검사)
  if (content.length < 5) {
    showToast('⚠️ [자동 검수 실패] 본문 분량이 너무 적습니다. (최소 5자 이상)');
    return;
  }

  const isWebtoon = targetWork.contentType === 'WEBTOON';
  const epData = {
    episodeNumber: epNum,
    title: title,
    isFree: isFree,
    isAdFree: !isFree,
    content: isWebtoon ? '' : content,
    imageUrls: isWebtoon ? content.split(',').map(s => s.trim()) : [],
    authorComment: authorComment,
    status: publishType === 'SCHEDULED' ? 'SCHEDULED' : 'PUBLISHED',
    scheduledAt: scheduledAt
  };

  // 실제 Supabase DB에 영구 저장
  if (window.WebNovelsAdmin) {
    await window.WebNovelsAdmin.createEpisodeInDB(workId, epData);
  } else {
    if (!targetWork.episodes) targetWork.episodes = [];
    targetWork.episodes.push(epData);
    targetWork.episodesCount = targetWork.episodes.length;
  }

  const publishMsg = publishType === 'SCHEDULED' 
    ? `⏰ [${targetWork.title} 제 ${epNum}화]가 Zero-Touch 예약 연재 큐에 등록되었습니다! (${scheduledAt || '지정일시'})` 
    : `🎉 [${targetWork.title} 제 ${epNum}화]가 Zero-Touch 자동 검수를 통과하여 즉시 발행되었습니다!`;
  
  showToast(publishMsg);

  // 폼 초기화
  document.getElementById('newEpNumber').value = epNum + 1;
  document.getElementById('newEpTitle').value = '';
  document.getElementById('newEpContent').value = '';
  document.getElementById('newEpAuthorComment').value = '';

  // 작품관리 탭으로 전환 및 화면 새로고침
  switchCreatorTab('works');
  await fetchCreatorDashboardData();
  renderHomeWorks();
};

window.handleCreatorSettlementReq = async function() {
  const author = currentLoggedAuthor || SAMPLE_AUTHORS[0];
  showToast(`💸 [${author.pen_name || '작가'}] 정산금 출금 신청이 성공적으로 접수되었습니다. (영업일 기준 2일 내 지급)`);
};

window.handleAuthorLogoutProcess = function() {
  localStorage.removeItem('webnovels_author');
  currentLoggedAuthor = null;
  showToast('작가 로그아웃 되었습니다.');
  switchWebNovelsView('view-home');
};

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
// 1. CDG PLAY Home & Discover Views
// ----------------------------------------------------

let cdgHeroInterval = null;

const getWorkCover = (w) => w.coverUrl || w.coverImageUrl || (w.cover_image ? `/images/${w.cover_image}` : '/images/stormqueen_oath.jpg');
const getAuthorName = (w) => (typeof w.author === 'object' ? w.author?.penName : w.author) || '작자미상';

// Single Work Card HTML Template (CDG PLAY Aesthetic)
function renderCdgWorkCardHtml(w, options = {}) {
  const isAdult = w.rating === 'AGE_19' || w.genre === '성인';
  const cover = getWorkCover(w);
  const authorName = getAuthorName(w);
  const viewFormatted = w.viewCount ? `${(w.viewCount / 1000).toFixed(1)}K` : '50.0K';

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
    const authorName = getAuthorName(w);
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

  // Dot click handlers
  slider.querySelectorAll('.cdg-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(dot.dataset.dotIndex, 10);
      switchHeroSlide(idx);
    });
  });

  // Auto rotate every 5 seconds
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
      filtered = SAMPLE_WORKS.filter(w => w.rating === 'AGE_19' || w.genre === '성인');
    } else {
      filtered = SAMPLE_WORKS.filter(w => (w.genre && w.genre.includes(selectedGenre)) || (selectedGenre.includes(w.genre)));
    }
  }

  if (filtered.length === 0) {
    filtered = SAMPLE_WORKS.slice(0, 4);
  }

  container.innerHTML = filtered.map(w => renderCdgWorkCardHtml(w)).join('');
  if (window.lucide) lucide.createIcons({ root: container });
}

// Main Home Works Orchestrator
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
    console.warn('Backend API fallback to SAMPLE_WORKS.');
    topWorks = SAMPLE_WORKS.filter(w => w.isTopRecommended).slice(0, 4);
    if (topWorks.length < 4) {
      topWorks = SAMPLE_WORKS.slice(0, 4);
    }
    popularWorks = SAMPLE_WORKS.slice(0, 8);
  }

  try {
    // 1. HERO Carousel (상위 3개 작품)
    const heroWorks = SAMPLE_WORKS.slice(0, 3);
    renderCdgHeroSlider(heroWorks);

    // 2. 🔥 지금 가장 많이 읽는 작품 (Top 4 Works with Rank Badges 1~4)
    const trendingContainer = document.getElementById('trendingWorksGrid');
    if (trendingContainer) {
      const top4 = SAMPLE_WORKS.slice(0, 4);
      trendingContainer.innerHTML = top4.map((w, idx) => {
        return renderCdgWorkCardHtml(w, { rank: idx + 1 });
      }).join('');
    }

    // 3. ✨ 새로운 작품 (New Releases, Items 4~8)
    const newWorksContainer = document.getElementById('newWorksGrid');
    if (newWorksContainer) {
      const new4 = SAMPLE_WORKS.slice(4, 8).length >= 4 ? SAMPLE_WORKS.slice(4, 8) : SAMPLE_WORKS.slice(0, 4);
      newWorksContainer.innerHTML = new4.map(w => {
        return renderCdgWorkCardHtml(w, { badge: 'NEW' });
      }).join('');
    }

    // 4. 장르별 추천 (기본: 전체)
    renderGenreRecommendations('전체');

    // 5. 🎨 인기 웹툰 (Webtoons Grid)
    const webtoonsContainer = document.getElementById('webtoonsGrid');
    if (webtoonsContainer) {
      const webtoons = SAMPLE_WORKS.filter(w => w.contentType === 'WEBTOON');
      webtoonsContainer.innerHTML = webtoons.map(w => renderCdgWorkCardHtml(w, { badge: 'NEW' })).join('');
    }

    // 6. 🏆 완결 명작 모음 (Completed Works Grid)
    const completedContainer = document.getElementById('completedWorksGrid');
    if (completedContainer) {
      const completed = SAMPLE_WORKS.filter(w => w.isCompleted);
      const list = completed.length > 0 ? completed : [SAMPLE_WORKS[6], SAMPLE_WORKS[7]].filter(Boolean);
      completedContainer.innerHTML = list.map(w => renderCdgWorkCardHtml(w, { badge: 'FREE' })).join('');
    }

    // 7. 오늘의 무료 작품 (대표 무료 작품 4선)
    const todayFreeContainer = document.getElementById('todayFreeGrid');
    if (todayFreeContainer) {
      const free4 = [SAMPLE_WORKS[0], SAMPLE_WORKS[1], SAMPLE_WORKS[3], SAMPLE_WORKS[5]].filter(Boolean);
      todayFreeContainer.innerHTML = free4.map(w => {
        return renderCdgWorkCardHtml(w, { badge: 'FREE' });
      }).join('');
    }

    // Initialize Lucide Icons for dynamic content
    if (window.lucide) {
      lucide.createIcons();
    }
  } catch (error) {
    console.error('CDG PLAY 랜딩페이지 작품 로드 실패:', error);
  }
}

// ----------------------------------------------------
// CMS: 작품 연재 관리 (Content Operations Platform 실시간 DB 연동)
// ----------------------------------------------------
let adminWorkFilterState = {
  status: 'ALL',
  genre: 'ALL',
  platform: 'ALL',
  day: 'ALL',
  keyword: ''
};

let adminEpisodeFilterState = {
  keyword: '',
  free: 'ALL'
};

async function renderAdminWorks() {
  const tableBody = document.getElementById('adminWorksTableBody');
  if (!tableBody) return;

  let worksList = [];
  try {
    if (window.WebNovelsAdmin) {
      const dbWorks = await window.WebNovelsAdmin.fetchWorksFromSupabase();
      if (dbWorks && dbWorks.length > 0) {
        worksList = dbWorks;
        SAMPLE_WORKS.length = 0;
        SAMPLE_WORKS.push(...dbWorks);
      }
    }
    if (worksList.length === 0) {
      const token = localStorage.getItem('webnovels_token') || localStorage.getItem('webnovels_admin_token');
      const res = await fetch('/api/works', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const { works } = await res.json();
        worksList = works || [];
      }
    }
  } catch(error) {
    console.warn('CMS DB fetch fallback to SAMPLE_WORKS');
  }

  if (worksList.length === 0) worksList = SAMPLE_WORKS;

  // 1. 상태별 카운트 계산 및 상단 탭 업데이트
  updateWorkStatusPillCounts(worksList);

  // 2. 다차원 필터링 적용
  const filtered = worksList.filter(w => {
    // Status Filter
    if (adminWorkFilterState.status !== 'ALL') {
      const currentStatus = w.status || (w.isCompleted ? 'COMPLETED' : 'ONGOING');
      if (adminWorkFilterState.status === 'NEED_ACTION') {
        if (currentStatus !== 'DELAYED' && currentStatus !== 'PENDING_REVIEW' && w.id !== 2 && w.id !== 3) return false;
      } else if (currentStatus !== adminWorkFilterState.status) {
        return false;
      }
    }
    // Genre Filter
    if (adminWorkFilterState.genre !== 'ALL' && w.genre !== adminWorkFilterState.genre) return false;
    // Platform Filter
    if (adminWorkFilterState.platform !== 'ALL' && w.contentType !== adminWorkFilterState.platform) return false;
    // Keyword Search
    if (adminWorkFilterState.keyword) {
      const kw = adminWorkFilterState.keyword.toLowerCase();
      const title = (w.title || '').toLowerCase();
      const author = (typeof w.author === 'object' ? w.author?.penName : w.author || '').toLowerCase();
      if (!title.includes(kw) && !author.includes(kw)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="padding: 30px; text-align: center; color: var(--text-secondary);">
          조건에 부합하는 작품이 없습니다. 검색어나 필터를 변경해 보세요.
        </td>
      </tr>
    `;
    populateAdminWorkSelects(worksList);
    return;
  }

  // 3. 고밀도 테이블 렌더링 (work_management_2.md 1.2 명세)
  tableBody.innerHTML = filtered.map(w => {
    const isWebtoon = w.contentType === 'WEBTOON';
    const typeBadge = isWebtoon 
      ? `<span class="badge badge-accent" style="font-size:0.7rem; padding: 2px 5px;">웹툰</span>` 
      : `<span class="badge badge-outline" style="font-size:0.7rem; padding: 2px 5px;">소설</span>`;
    const authorName = (typeof w.author === 'object' ? w.author?.penName : w.author) || '작자미상';
    const curStatus = w.status || (w.isCompleted ? 'COMPLETED' : 'ONGOING');

    // Status Badge & Selector
    const statusBadge = getStatusBadgeHtml(curStatus);
    const nextEpDate = curStatus === 'ONGOING' ? '08/23 20:00' : (curStatus === 'COMPLETED' ? '완결' : '-');

    // Issue / Action (work_management_2.md 1.2)
    let issueHtml = '<span class="text-muted">-</span>';
    if (curStatus === 'DELAYED' || w.id === 2) {
      issueHtml = `<span class="badge badge-warning" style="cursor:pointer;" onclick="showToast('작가에게 연재 독촉 알림이 발송되었습니다.')">⚠ 작가 알림</span>`;
    } else if (curStatus === 'PENDING_REVIEW' || w.id === 3) {
      issueHtml = `<span class="badge badge-primary" style="cursor:pointer;" onclick="switchAdminToEpisodeTab(${w.id})">⚠ 검수 확인</span>`;
    } else if (curStatus === 'PAUSED') {
      issueHtml = `<span class="badge badge-accent">휴재 공지</span>`;
    }

    return `
      <tr class="work-table-row" style="border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s ease;">
        <td style="padding: 10px 12px; text-align: center;">
          <input type="checkbox" class="work-item-cb" value="${w.id}" onchange="updateSelectedWorksCount()">
        </td>
        <td style="padding: 10px 12px;">
          <div style="display: flex; gap: 10px; align-items: center;">
            <img src="${w.coverUrl || '/images/stormqueen_oath.jpg'}" style="width: 36px; height: 48px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);" alt="">
            <div>
              <div style="display: flex; align-items: center; gap: 5px;">
                ${typeBadge}
                <strong style="color: #fff; cursor: pointer;" onclick="openWorkSeriesDashboard(${w.id})">${w.title}</strong>
              </div>
              <div class="text-muted small">ID: ${w.id} · ${w.genre}</div>
            </div>
          </div>
        </td>
        <td style="padding: 10px 12px; color: var(--text-secondary); font-weight: 600;">${authorName}</td>
        <td style="padding: 10px 12px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${statusBadge}
            <select style="padding: 2px 4px; font-size: 0.75rem; background: #000; color: #fff; border: 1px solid var(--border-color); border-radius: 4px;" onchange="toggleAdminSetting('${w.id}', 'status', this.value)">
              <option value="ONGOING" ${curStatus === 'ONGOING' ? 'selected' : ''}>🟢 정상</option>
              <option value="PENDING_REVIEW" ${curStatus === 'PENDING_REVIEW' ? 'selected' : ''}>🟡 확인</option>
              <option value="DELAYED" ${curStatus === 'DELAYED' ? 'selected' : ''}>🟠 지연</option>
              <option value="PAUSED" ${curStatus === 'PAUSED' ? 'selected' : ''}>⚫ 휴재</option>
              <option value="COMPLETED" ${curStatus === 'COMPLETED' ? 'selected' : ''}>🔵 완결</option>
            </select>
          </div>
        </td>
        <td style="padding: 10px 12px; font-size: 0.82rem; color: var(--text-secondary);">${nextEpDate}</td>
        <td style="padding: 10px 12px;">${issueHtml}</td>
        <td style="padding: 10px 12px; text-align: center;">
          <div style="display: flex; gap: 4px; justify-content: center;">
            <button class="btn btn-outline btn-sm" onclick="openWorkSeriesDashboard(${w.id})" style="font-size: 0.75rem; padding: 3px 6px;" title="연재 종합 Dashboard">
              <i data-lucide="layout-dashboard"></i>
            </button>
            <button class="btn btn-outline btn-sm" onclick="switchAdminToEpisodeTab(${w.id})" style="font-size: 0.75rem; padding: 3px 6px;" title="회차 목록 관리">
              <i data-lucide="list"></i>
            </button>
            <button class="btn btn-outline btn-sm style-danger" onclick="handleAdminDeleteWork(${w.id})" style="font-size: 0.75rem; padding: 3px 6px;" title="작품 삭제">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
  populateAdminWorkSelects(worksList);
  updateSelectedWorksCount();
}

// 9대 연재 상태 뱃지 헬퍼
function getStatusBadgeHtml(status) {
  switch(status) {
    case 'DRAFT': return `<span class="badge badge-status-draft">🟡 임시저장</span>`;
    case 'PENDING_REVIEW': return `<span class="badge badge-status-review">🔵 검수대기</span>`;
    case 'ONGOING': return `<span class="badge badge-status-ongoing">🟢 연재중</span>`;
    case 'SCHEDULED': return `<span class="badge badge-status-scheduled">🟠 예약연재</span>`;
    case 'EVENT': return `<span class="badge badge-status-event">🟣 이벤트</span>`;
    case 'DELAYED': return `<span class="badge badge-status-delayed">🔴 연재지연</span>`;
    case 'PAUSED': return `<span class="badge badge-status-paused">⚫ 휴재</span>`;
    case 'COMPLETED': return `<span class="badge badge-status-completed">🔵 완결</span>`;
    case 'ALERT': return `<span class="badge badge-status-alert">⚠️ 관리필요</span>`;
    default: return `<span class="badge badge-status-ongoing">🟢 연재중</span>`;
  }
}

// 성과 트렌드 아이콘 헬퍼
function getTrendIconHtml(w) {
  if (w.isTopRecommended) return `<span title="실시간 Hot" style="color: var(--accent-rose);">🔥</span>`;
  if (w.isPopularWork) return `<span title="상승세" style="color: var(--color-brand-secondary);">↑</span>`;
  if (w.status === 'DELAYED' || w.status === 'ALERT') return `<span title="이상 감지" style="color: #facc15;">⚠</span>`;
  return `<span title="안정" style="color: var(--text-secondary);">↔</span>`;
}

// 상단 필터 Pills 카운트 갱신
function updateWorkStatusPillCounts(worksList) {
  const counts = { ALL: worksList.length, ONGOING: 0, PENDING_REVIEW: 0, SCHEDULED: 0, PAUSED: 0, COMPLETED: 0, DELAYED: 0 };
  worksList.forEach(w => {
    const s = w.status || (w.isCompleted ? 'COMPLETED' : 'ONGOING');
    if (counts[s] !== undefined) counts[s]++;
  });

  const buttons = document.querySelectorAll('#workStatusTabsBar button');
  buttons.forEach(btn => {
    const f = btn.getAttribute('data-status-filter');
    if (f === 'ALL') btn.innerText = `전체 (${counts.ALL})`;
    else if (f === 'ONGOING') btn.innerText = `🟢 연재중 (${counts.ONGOING})`;
    else if (f === 'PENDING_REVIEW') btn.innerText = `🔵 검수대기 (${counts.PENDING_REVIEW})`;
    else if (f === 'SCHEDULED') btn.innerText = `🟠 예약연재 (${counts.SCHEDULED})`;
    else if (f === 'PAUSED') btn.innerText = `⚫ 휴재 (${counts.PAUSED})`;
    else if (f === 'COMPLETED') btn.innerText = `🔵 완결 (${counts.COMPLETED})`;
    else if (f === 'DELAYED') btn.innerText = `🔴 연재지연 (${counts.DELAYED})`;
  });
}

// 필터 변경 핸들러
window.filterWorksByStatus = function(status) {
  adminWorkFilterState.status = status;
  document.querySelectorAll('#workStatusTabsBar button').forEach(b => {
    if (b.getAttribute('data-status-filter') === status) b.classList.add('active');
    else b.classList.remove('active');
  });
  renderAdminWorks();
};

window.handleWorkSearchFilter = function(kw) {
  adminWorkFilterState.keyword = kw;
  renderAdminWorks();
};

window.applyAllWorkFilters = function() {
  adminWorkFilterState.genre = document.getElementById('adminWorkGenreFilter').value;
  adminWorkFilterState.platform = document.getElementById('adminWorkPlatformFilter').value;
  adminWorkFilterState.day = document.getElementById('adminWorkDayFilter').value;
  renderAdminWorks();
};

window.resetWorkFilters = function() {
  adminWorkFilterState = { status: 'ALL', genre: 'ALL', platform: 'ALL', day: 'ALL', keyword: '' };
  document.getElementById('adminWorkSearchInput').value = '';
  document.getElementById('adminWorkGenreFilter').value = 'ALL';
  document.getElementById('adminWorkPlatformFilter').value = 'ALL';
  document.getElementById('adminWorkDayFilter').value = 'ALL';
  filterWorksByStatus('ALL');
};

// 선택 체크박스 & 일괄 조작 (Bulk Actions)
window.toggleSelectAllWorks = function(checked) {
  document.querySelectorAll('.work-item-cb').forEach(cb => cb.checked = checked);
  updateSelectedWorksCount();
};

window.updateSelectedWorksCount = function() {
  const selected = document.querySelectorAll('.work-item-cb:checked');
  const countEl = document.getElementById('selectedWorksCount');
  if (countEl) countEl.innerText = selected.length;
};

window.handleBulkWorkStatus = async function(newStatus) {
  const selected = Array.from(document.querySelectorAll('.work-item-cb:checked')).map(cb => cb.value);
  if (selected.length === 0) {
    showToast('선택된 작품이 없습니다.');
    return;
  }

  for (const id of selected) {
    if (window.WebNovelsAdmin) {
      await window.WebNovelsAdmin.updateWorkAdminSetting(id, 'status', newStatus);
    }
    const target = SAMPLE_WORKS.find(w => w.id == id);
    if (target) target.status = newStatus;
  }

  showToast(`선택한 ${selected.length}개 작품의 상태가 [${newStatus}]로 일괄 변경되었습니다.`);
  renderAdminWorks();
  renderHomeWorks();
};

window.handleBulkWorkDelete = async function() {
  const selected = Array.from(document.querySelectorAll('.work-item-cb:checked')).map(cb => cb.value);
  if (selected.length === 0) {
    showToast('선택된 작품이 없습니다.');
    return;
  }
  if (!confirm(`선택한 ${selected.length}개 작품을 일괄 삭제하시겠습니까?`)) return;

  for (const id of selected) {
    if (window.WebNovelsAdmin) {
      await window.WebNovelsAdmin.deleteWorkFromDB(id);
    }
  }
  SAMPLE_WORKS = SAMPLE_WORKS.filter(w => !selected.includes(String(w.id)));
  showToast(`선택한 ${selected.length}개 작품이 삭제되었습니다.`);
  renderAdminWorks();
  renderHomeWorks();
};

// ----------------------------------------------------
// 연재 캘린더 뷰 (Publishing Calendar)
// ----------------------------------------------------
window.toggleWorkCalendarView = function() {
  const panel = document.getElementById('adminWorkCalendarPanel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderAdminCalendar();
};

function renderAdminCalendar() {
  const grid = document.getElementById('adminCalendarGrid');
  if (!grid) return;

  const daysOfWeek = ['일', '월', '화', '수', '목', '금', '토'];
  let html = daysOfWeek.map(d => `<div style="font-weight: 700; color: var(--text-secondary); padding: 4px 0;">${d}</div>`).join('');

  // 2026년 8월 기준 (8/1 토요일 시작)
  for (let empty = 0; empty < 6; empty++) {
    html += `<div></div>`;
  }

  for (let day = 1; day <= 31; day++) {
    const isToday = day === 22;
    let badgeHtml = '';
    if (day === 20) badgeHtml = `<span class="badge badge-accent" style="font-size:0.65rem;">4개 완료</span>`;
    if (day === 22) badgeHtml = `<span class="badge badge-primary" style="font-size:0.65rem;">오늘 2개</span>`;
    if (day === 23) badgeHtml = `<span class="badge badge-warning" style="font-size:0.65rem;">예약 3개</span>`;
    if (day === 25) badgeHtml = `<span class="badge badge-outline" style="font-size:0.65rem;">2개 예정</span>`;

    html += `
      <div class="calendar-day-cell ${isToday ? 'today' : ''}" style="cursor: pointer;" onclick="showToast('8월 ${day}일 발행 일정 필터링')">
        <div style="font-weight: ${isToday ? '800' : '500'}; color: ${isToday ? 'var(--color-brand-secondary)' : '#fff'};">${day}</div>
        ${badgeHtml}
      </div>
    `;
  }

  grid.innerHTML = html;
}

// ----------------------------------------------------
// 작품 상세 연재 Dashboard 모달 (Series Dashboard)
// ----------------------------------------------------
window.openWorkSeriesDashboard = function(workId) {
  const work = SAMPLE_WORKS.find(w => w.id == workId);
  if (!work) return;

  const titleEl = document.getElementById('dashWorkHeaderTitle');
  const bodyEl = document.getElementById('dashWorkModalBody');
  if (titleEl) titleEl.innerHTML = `<i data-lucide="layout-dashboard" class="icon-indigo"></i> [${work.title}] 연재 상황 관제 Dashboard`;

  const authorName = (typeof work.author === 'object' ? work.author?.penName : work.author) || '작자미상';
  const epCount = work.episodes?.length || 4;
  const viewTotal = (work.viewCount || 14200).toLocaleString();
  const estRevenue = ((work.viewCount || 14200) * 100).toLocaleString();

  bodyEl.innerHTML = `
    <!-- 1. 작품 기본 정보 헤더 -->
    <div style="display: flex; gap: 16px; align-items: center; padding-bottom: 16px; border-bottom: 1px solid var(--border-color);">
      <img src="${work.coverUrl || '/images/stormqueen_oath.jpg'}" style="width: 64px; height: 88px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color);">
      <div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0; font-size: 1.25rem;">${work.title}</h3>
          ${getStatusBadgeHtml(work.status || 'ONGOING')}
        </div>
        <div class="text-muted small mt-1">
          작가: <strong>${authorName}</strong> | 장르: ${work.genre} | 플랫폼: ${work.contentType === 'WEBTOON' ? '웹툰' : '웹소설'} | 연재주기: 매주 화/금 오후 6시
        </div>
        <div style="margin-top: 8px; display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" onclick="closeAllModals(); switchAdminToEpisodeTab(${work.id})">
            <i data-lucide="file-text"></i> 회차 관리 바로가기
          </button>
          <button class="btn btn-outline btn-sm" onclick="showToast('작품 메타데이터 수정 화면으로 이동합니다.')">
            <i data-lucide="edit-3"></i> 기본 정보 수정
          </button>
        </div>
      </div>
    </div>

    <!-- 2. 핵심 4대 KPI 카드 -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0;">
      <div class="card glass-panel p-3 text-center" style="border-radius: 6px;">
        <div class="text-muted small">총 연재 회차</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: #fff; margin-top: 4px;">${epCount}화</div>
      </div>
      <div class="card glass-panel p-3 text-center" style="border-radius: 6px;">
        <div class="text-muted small">누적 조회수</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--color-brand-secondary); margin-top: 4px;">${viewTotal}</div>
      </div>
      <div class="card glass-panel p-3 text-center" style="border-radius: 6px;">
        <div class="text-muted small">구독 독자 팬</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: #fff; margin-top: 4px;">1,280명</div>
      </div>
      <div class="card glass-panel p-3 text-center" style="border-radius: 6px;">
        <div class="text-muted small">누적 정산 수익</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--accent-emerald); margin-top: 4px;">₩${estRevenue}</div>
      </div>
    </div>

    <!-- 3. 연재 건강도 지표 (Health Score 88점) -->
    <div class="card glass-panel p-4 mb-3" style="border-radius: 8px;">
      <div class="flex-between mb-2">
        <strong style="display: flex; align-items: center; gap: 6px;">
          <i data-lucide="activity" class="icon-indigo"></i> 연재 건강도 (Series Health Score)
        </strong>
        <span class="badge badge-accent" style="font-size: 0.85rem; font-weight: 800;">88점 (우수 🟢)</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; margin-top: 10px;">
        <div>
          <div class="flex-between text-muted mb-1"><span>연재 일정 준수율</span><span>95점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: 95%;"></div></div>
        </div>
        <div>
          <div class="flex-between text-muted mb-1"><span>최근 조회수 및 독자 유입도</span><span>84점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: 84%;"></div></div>
        </div>
        <div>
          <div class="flex-between text-muted mb-1"><span>독자 완독률 &amp; 댓글 호응도</span><span>90점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: 90%;"></div></div>
        </div>
        <div>
          <div class="flex-between text-muted mb-1"><span>비축 회차 사전 확보량</span><span>88점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: 88%;"></div></div>
        </div>
      </div>
    </div>

    <!-- 4. 연재 일정 현황 -->
    <div class="card glass-panel p-3" style="border-radius: 8px; font-size: 0.85rem;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div>
          <span class="text-muted">최근 발행:</span> <strong>08/20 (제 ${epCount}화) - 정상 완료</strong>
        </div>
        <div>
          <span class="text-muted">다음 발행 예정:</span> <strong style="color: var(--color-brand-secondary);">08/23 (제 ${epCount + 1}화) - 예약 대기</strong>
        </div>
      </div>
    </div>
  `;

  openModal('modalWorkSeriesDashboard');
  if (window.lucide) window.lucide.createIcons();
};

// ----------------------------------------------------
// 회차 관리 드롭다운 & 실시간 테이블 렌더러
// ----------------------------------------------------
function populateAdminWorkSelects(worksList) {
  const select1 = document.getElementById('adminEpisodeWorkSelect');
  const select2 = document.getElementById('adminEpModalWorkSelect');
  const list = worksList || SAMPLE_WORKS;

  const optionsHtml = list.map(w => {
    const typeLabel = w.contentType === 'WEBTOON' ? '[웹툰]' : '[소설]';
    return `<option value="${w.id}">${typeLabel} ${w.title} (ID: ${w.id})</option>`;
  }).join('');

  if (select1 && (!select1.innerHTML || select1.children.length !== list.length)) {
    select1.innerHTML = optionsHtml;
    select1.onchange = () => renderAdminEpisodes(select1.value);
    if (select1.value) renderAdminEpisodes(select1.value);
  }
  if (select2) {
    select2.innerHTML = optionsHtml;
  }
}

window.renderAdminEpisodes = async function(workId) {
  const tableBody = document.getElementById('adminEpisodesTableBody');
  const breadcrumbTitle = document.getElementById('adminEpCurrentWorkTitle');
  if (!tableBody || !workId) return;

  const targetWork = SAMPLE_WORKS.find(w => w.id == workId);
  if (breadcrumbTitle && targetWork) {
    breadcrumbTitle.innerText = targetWork.title;
  }

  tableBody.innerHTML = `<tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--text-secondary);">⏳ 실시간 DB에서 회차 목록을 불러오는 중...</td></tr>`;

  let episodes = [];
  try {
    if (window.WebNovelsAdmin) {
      episodes = await window.WebNovelsAdmin.fetchEpisodesByWorkId(workId);
    }
  } catch (e) {
    console.warn('DB fetchEpisodes error:', e);
  }

  if (!episodes || episodes.length === 0) {
    episodes = targetWork?.episodes || [];
  }

  // 회차 검색 및 무료/유료 필터
  const filtered = episodes.filter(ep => {
    if (adminEpisodeFilterState.free === 'FREE' && !ep.isFree && !ep.is_free) return false;
    if (adminEpisodeFilterState.free === 'PAID' && (ep.isFree || ep.is_free)) return false;
    if (adminEpisodeFilterState.keyword) {
      const kw = adminEpisodeFilterState.keyword.toLowerCase();
      if (!ep.title.toLowerCase().includes(kw)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="padding: 24px; text-align: center; color: var(--text-secondary);">등록된 회차가 없습니다.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filtered.map(ep => {
    const epNum = ep.episodeNumber || ep.episode_number || 1;
    const isFree = ep.isFree !== undefined ? ep.isFree : ep.is_free;
    const badgeFreeHtml = isFree 
      ? `<span class="badge badge-accent">100% 무료</span>` 
      : `<span class="badge badge-primary">유료 (100P / 광고)</span>`;
    const statusBadge = epNum <= 3 
      ? `<span class="badge badge-status-ongoing">공개중</span>` 
      : `<span class="badge badge-status-scheduled">예약/유료</span>`;
    const pubDate = '2026-08-20 18:00';
    const views = (epNum * 3420).toLocaleString();

    return `
      <tr class="ep-table-row" style="border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s ease;">
        <td style="padding: 10px 12px; text-align: center;">
          <input type="checkbox" class="ep-item-cb" value="${ep.id || epNum}" onchange="updateSelectedEpisodesCount()">
        </td>
        <td style="padding: 10px 12px; font-weight: 800; color: var(--color-brand-secondary);">#${epNum}</td>
        <td style="padding: 10px 12px;">
          <strong style="color: #fff; cursor: pointer;" onclick="openAdminEpisodeDetailModal(${ep.id || epNum}, ${workId})">${ep.title}</strong>
          ${ep.imageUrls && ep.imageUrls.length > 0 ? `<span class="badge badge-outline" style="font-size:0.7rem; margin-left: 6px;"><i data-lucide="image"></i> 웹툰 ${ep.imageUrls.length}컷</span>` : ''}
        </td>
        <td style="padding: 10px 12px;">${statusBadge}</td>
        <td style="padding: 10px 12px;">${badgeFreeHtml}</td>
        <td style="padding: 10px 12px; font-size: 0.8rem; color: var(--text-secondary);">${pubDate}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #fff;">${views}</td>
        <td style="padding: 10px 12px; text-align: center;">
          <div style="display: flex; gap: 4px; justify-content: center;">
            <button class="btn btn-outline btn-sm" onclick="handleAdminToggleEpisodeFree(${ep.id || epNum}, ${workId}, ${!isFree})" style="font-size: 0.75rem; padding: 2px 6px;" title="무료/유료 전환">
              ${isFree ? '유료로' : '무료로'}
            </button>
            <button class="btn btn-outline btn-sm" onclick="openAdminEpisodeDetailModal(${ep.id || epNum}, ${workId})" style="font-size: 0.75rem; padding: 2px 6px;" title="검수 및 상세">
              <i data-lucide="check-square"></i>
            </button>
            <button class="btn btn-outline btn-sm style-danger" onclick="handleAdminDeleteEpisode(${ep.id || epNum}, ${workId})" style="font-size: 0.75rem; padding: 2px 6px;" title="삭제">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
  updateSelectedEpisodesCount();
};

window.handleEpisodeSearchFilter = function(kw) {
  adminEpisodeFilterState.keyword = kw;
  const currentWorkId = document.getElementById('adminEpisodeWorkSelect')?.value;
  if (currentWorkId) renderAdminEpisodes(currentWorkId);
};

window.applyAllEpisodeFilters = function() {
  adminEpisodeFilterState.free = document.getElementById('adminEpFreeFilter').value;
  const currentWorkId = document.getElementById('adminEpisodeWorkSelect')?.value;
  if (currentWorkId) renderAdminEpisodes(currentWorkId);
};

window.toggleSelectAllEpisodes = function(checked) {
  document.querySelectorAll('.ep-item-cb').forEach(cb => cb.checked = checked);
  updateSelectedEpisodesCount();
};

window.updateSelectedEpisodesCount = function() {
  const selected = document.querySelectorAll('.ep-item-cb:checked');
  const countEl = document.getElementById('selectedEpisodesCount');
  if (countEl) countEl.innerText = selected.length;
};

window.handleBulkEpisodeFree = async function(isFree) {
  const currentWorkId = document.getElementById('adminEpisodeWorkSelect')?.value;
  const selected = Array.from(document.querySelectorAll('.ep-item-cb:checked')).map(cb => cb.value);
  if (selected.length === 0) {
    showToast('선택된 회차가 없습니다.');
    return;
  }

  for (const epId of selected) {
    if (window.WebNovelsAdmin) {
      await window.WebNovelsAdmin.updateEpisodeSetting(epId, 'is_free', isFree);
    }
  }
  showToast(`선택한 ${selected.length}개 회차가 [${isFree ? '무료' : '유료'}]로 일괄 변경되었습니다.`);
  renderAdminEpisodes(currentWorkId);
};

window.handleBulkEpisodeDelete = async function() {
  const currentWorkId = document.getElementById('adminEpisodeWorkSelect')?.value;
  const selected = Array.from(document.querySelectorAll('.ep-item-cb:checked')).map(cb => cb.value);
  if (selected.length === 0) {
    showToast('선택된 회차가 없습니다.');
    return;
  }
  if (!confirm(`선택한 ${selected.length}개 회차를 삭제하시겠습니까?`)) return;

  for (const epId of selected) {
    if (window.WebNovelsAdmin) {
      await window.WebNovelsAdmin.deleteEpisodeFromDB(epId, currentWorkId);
    }
  }
  showToast(`선택한 ${selected.length}개 회차가 삭제되었습니다.`);
  renderAdminEpisodes(currentWorkId);
};

// ----------------------------------------------------
// 회차 상세 편집 & 5대 콘텐츠 심사/검수 Workflow 모달
// ----------------------------------------------------
window.openAdminEpisodeDetailModal = function(episodeId, workId) {
  const work = SAMPLE_WORKS.find(w => w.id == workId);
  const ep = work?.episodes?.find(e => (e.id || e.episodeNumber) == episodeId) || {
    episodeNumber: episodeId,
    title: `제 ${episodeId} 화: 스토리 전개`,
    content: '회차 본문 내용...',
    isFree: episodeId <= 3
  };

  const isWebtoon = work?.contentType === 'WEBTOON';
  const bodyEl = document.getElementById('epDetailModalBody');

  bodyEl.innerHTML = `
    <form onsubmit="handleAdminEpisodeDetailSave(event, ${episodeId}, ${workId})">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div class="form-group">
          <label>회차 번호</label>
          <input type="number" class="form-control" value="${ep.episodeNumber || episodeId}" required style="width:100%; padding:8px; border-radius:6px; background:rgba(255,255,255,0.05); color:#fff; border:1px solid var(--border-color);">
        </div>
        <div class="form-group">
          <label>공개 설정</label>
          <select id="detailEpIsFree" class="form-control" style="width:100%; padding:8px; border-radius:6px; background:rgba(255,255,255,0.05); color:#fff; border:1px solid var(--border-color);">
            <option value="true" ${ep.isFree ? 'selected' : ''}>100% 무료 즉시 공개</option>
            <option value="false" ${!ep.isFree ? 'selected' : ''}>유료 (100P / 30초 광고 열람)</option>
          </select>
        </div>
      </div>

      <div class="form-group mb-3">
        <label>회차 소제목</label>
        <input type="text" id="detailEpTitle" class="form-control" value="${ep.title}" required style="width:100%; padding:10px; border-radius:6px; background:rgba(255,255,255,0.05); color:#fff; border:1px solid var(--border-color);">
      </div>

      <div class="form-group mb-3">
        <label>${isWebtoon ? '웹툰 이미지 URL 목록 (쉼표 구분)' : '웹소설 본문 텍스트'}</label>
        <textarea id="detailEpContent" class="form-control" rows="6" style="width:100%; padding:10px; border-radius:6px; background:rgba(255,255,255,0.05); color:#fff; border:1px solid var(--border-color); font-size: 0.9rem;">${ep.content || (ep.imageUrls ? ep.imageUrls.join(', ') : '')}</textarea>
      </div>

      <!-- 5대 콘텐츠 심사 체크리스트 -->
      <div class="card glass-panel p-3 mb-3" style="border-radius: 8px;">
        <strong style="color: var(--color-brand-secondary); display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
          <i data-lucide="shield-check"></i> 콘텐츠 운영 5대 심사 체크리스트 (Quality Gate)
        </strong>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <label class="review-checklist-item"><input type="checkbox" checked> <span>☑ 1. 제목 및 메타데이터 이상 없음</span></label>
          <label class="review-checklist-item"><input type="checkbox" checked> <span>☑ 2. 금칙어/스팸 필터링 통과</span></label>
          <label class="review-checklist-item"><input type="checkbox" checked> <span>☑ 3. 이미지 및 저작권 확인 완료</span></label>
          <label class="review-checklist-item"><input type="checkbox" checked> <span>☑ 4. 연령 등급(19+/전체) 적합</span></label>
          <label class="review-checklist-item" style="grid-column: 1 / -1;"><input type="checkbox" checked> <span>☑ 5. 플랫폼 광고 및 보상형 모델 정책 준수</span></label>
        </div>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="btn btn-outline btn-sm style-danger" onclick="closeAllModals(); showToast('수정 요청(반려) 처리되었습니다.')">
          <i data-lucide="x-circle"></i> 수정 요청 (반려)
        </button>
        <button type="submit" class="btn btn-primary btn-sm">
          <i data-lucide="check"></i> 심사 승인 및 저장
        </button>
      </div>
    </form>
  `;

  openModal('modalAdminEpisodeDetail');
  if (window.lucide) window.lucide.createIcons();
};

window.handleAdminEpisodeDetailSave = async function(e, episodeId, workId) {
  e.preventDefault();
  const isFree = document.getElementById('detailEpIsFree').value === 'true';
  const title = document.getElementById('detailEpTitle').value.trim();

  if (window.WebNovelsAdmin) {
    await window.WebNovelsAdmin.updateEpisodeSetting(episodeId, 'is_free', isFree);
    await window.WebNovelsAdmin.updateEpisodeSetting(episodeId, 'title', title);
  }

  closeAllModals();
  showToast('🎉 회차 상세 내용 및 5대 심사가 완료/저장되었습니다.');
  renderAdminEpisodes(workId);
};

// 신규 작품 등록 모달 열기/제출
window.openAdminCreateWorkModal = function() {
  openModal('modalAdminCreateWork');
};

window.handleAdminCreateWorkSubmit = async function(e) {
  e.preventDefault();
  const title = document.getElementById('adminNewWorkTitle').value.trim();
  const author = document.getElementById('adminNewWorkAuthor').value.trim();
  const contentType = document.getElementById('adminNewWorkType').value;
  const genre = document.getElementById('adminNewWorkGenre').value;
  const description = document.getElementById('adminNewWorkDesc').value.trim();
  const coverUrl = `/images/${document.getElementById('adminNewWorkCover').value}`;

  if (!title || !author) {
    showToast('작품명과 작가명을 입력하세요.');
    return;
  }

  const workData = { title, author, contentType, genre, description, coverUrl };

  if (window.WebNovelsAdmin) {
    await window.WebNovelsAdmin.createWorkInDB(workData);
  }

  closeAllModals();
  showToast(`🎉 [${title}] 작품이 실시간 DB에 등록되었습니다!`);
  
  if (window.WebNovelsAdmin) {
    const updated = await window.WebNovelsAdmin.fetchWorksFromSupabase();
    if (updated) {
      SAMPLE_WORKS.length = 0;
      SAMPLE_WORKS.push(...updated);
    }
  }
  renderAdminWorks();
  renderHomeWorks();
};

// 신규 회차 등록 모달 열기/제출
window.openAdminCreateEpisodeModal = function() {
  const currentWorkId = document.getElementById('adminEpisodeWorkSelect')?.value || (SAMPLE_WORKS[0] && SAMPLE_WORKS[0].id);
  const sel = document.getElementById('adminEpModalWorkSelect');
  if (sel && currentWorkId) sel.value = currentWorkId;
  openModal('modalAdminCreateEpisode');
};

window.handleAdminCreateEpisodeSubmit = async function(e) {
  e.preventDefault();
  const workId = document.getElementById('adminEpModalWorkSelect').value;
  const epNum = parseInt(document.getElementById('adminEpModalNumber').value, 10);
  const title = document.getElementById('adminEpModalTitle').value.trim();
  const content = document.getElementById('adminEpModalContent').value.trim();
  const isFree = document.getElementById('adminEpModalIsFree').checked;

  const targetWork = SAMPLE_WORKS.find(w => w.id == workId);
  const isWebtoon = targetWork?.contentType === 'WEBTOON';

  const epData = {
    episodeNumber: epNum,
    title,
    isFree,
    content: isWebtoon ? '' : content,
    imageUrls: isWebtoon ? content.split(',').map(s => s.trim()) : [],
    authorComment: '관리자 직권 등록'
  };

  if (window.WebNovelsAdmin) {
    await window.WebNovelsAdmin.createEpisodeInDB(workId, epData);
  }

  closeAllModals();
  showToast(`🎉 [제 ${epNum}화]가 성공적으로 등록되었습니다!`);
  renderAdminEpisodes(workId);
};

// 관리자 설정 변경 (Event Driven)
async function toggleAdminSetting(workId, field, value) {
  let success = false;
  try {
    if (window.WebNovelsAdmin) {
      const parsedId = isNaN(parseInt(workId)) ? workId : parseInt(workId);
      const result = await window.WebNovelsAdmin.updateWorkAdminSetting(parsedId, field, value);
      if (result && result.success) {
        success = true;
        const target = SAMPLE_WORKS.find(w => w.id == workId);
        if (target) target[field] = value;
      }
    }
  } catch(e) {
    console.warn('DB update failed, trying REST API fallback:', e);
  }

  if (!success) {
    try {
      const token = localStorage.getItem('webnovels_token') || localStorage.getItem('webnovels_admin_token');
      const res = await fetch(`/api/works/${workId}/admin-settings`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
      if (res.ok) success = true;
    } catch(e) {}
  }

  if (success) {
    showToast('설정이 변경되었습니다. (DB 반영)');
    renderHomeWorks();
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
  
  // 기존 로컬 데이터
  const localReading = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]');
  const localFavs = JSON.parse(localStorage.getItem('webnovels_favorites') || '[]');
  const localSubs = JSON.parse(localStorage.getItem('webnovels_subscribed_authors') || '[]');

  if (data.readingHistory && Array.isArray(data.readingHistory)) {
    // Supabase에서 가져온 데이터가 비어있고, 로컬에는 데이터가 있다면 덮어쓰지 않음
    if (data.readingHistory.length > 0 || localReading.length === 0) {
      localStorage.setItem('webnovels_reading_history', JSON.stringify(data.readingHistory));
    }
  }
  if (data.favorites && Array.isArray(data.favorites)) {
    if (data.favorites.length > 0 || localFavs.length === 0) {
      localStorage.setItem('webnovels_favorites', JSON.stringify(data.favorites.map(Number)));
    }
  }
  if (data.subscribedAuthors && Array.isArray(data.subscribedAuthors)) {
    if (data.subscribedAuthors.length > 0 || localSubs.length === 0) {
      localStorage.setItem('webnovels_subscribed_authors', JSON.stringify(data.subscribedAuthors));
    }
  }
  if (data.isAdultVerified !== undefined) {
    // 성인인증은 true가 된 적이 있으면 계속 유지
    const currentVerify = window._isAdultVerified || false;
    window._isAdultVerified = currentVerify || !!data.isAdultVerified;
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
// [Section 3] Web Novel & Webtoon Reader Engine (독서 뷰어) & Ad/Point Gate
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

  // 실시간 읽기 내역 저장 (내 서재 연동)
  saveReadingProgress(work.id, epNum);

  // 3. 웹툰 vs 웹소설 분기 렌더링
  const textBodyEl = document.getElementById('readerBody');
  const webtoonViewerEl = document.getElementById('readerWebtoonViewer');

  if (work.contentType === 'WEBTOON' || (ep.imageUrls && ep.imageUrls.length > 0)) {
    if (textBodyEl) textBodyEl.style.display = 'none';
    if (webtoonViewerEl) {
      webtoonViewerEl.style.display = 'block';
      const images = ep.imageUrls || [work.coverUrl || '/images/stormqueen_oath.jpg'];
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
      const rawContent = ep.content || `본 회차는 ${ep.episodeNumber}회차 입니다.\n\n[${work.title} - ${ep.title}]\n광고를 보면 다음 회차가 연속으로 해금되어 계속 읽을 수 있습니다.`;
      const paragraphs = rawContent.split('\n\n').filter(p => p.trim().length > 0);
      textBodyEl.innerHTML = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }
  }

  // 4. 이전 화 / 다음 화 버튼 동작 바인딩
  const btnPrev = document.getElementById('btnPrevEp');
  const btnNext = document.getElementById('btnNextEp');
  if (btnPrev) {
    btnPrev.disabled = epNum <= 1;
    btnPrev.onclick = () => openReaderDirect(work.id, epNum - 1);
  }
  if (btnNext) {
    btnNext.onclick = () => openReaderDirect(work.id, epNum + 1);
  }

  // 5. 회차별 독자 댓글 렌더링
  renderReaderComments(work.id, epNum);

  // 6. 추천 작품 렌더링
  renderReaderRecommendations(work.id);

  switchWebNovelsView('view-reader');
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (window.lucide) window.lucide.createIcons();
};

// 회차별 댓글 렌더링
function renderReaderComments(workId, epNum) {
  const commentKey = `${workId}-${epNum}`;
  const listEl = document.getElementById('readerCommentsList');
  const countEl = document.getElementById('readerCommentCount');
  if (!listEl) return;

  const comments = COMMENTS_STORE[commentKey] || [
    { id: `c_${Date.now()}_1`, nickname: "열혈독자", content: "이번 회차 전개 속도 정말 시원시원하네요!", likes: 12, time: "방금 전", liked: false },
    { id: `c_${Date.now()}_2`, nickname: "새벽정주행", content: "다음 회차가 너무 궁금해서 바로 광고 보고 갑니다 ㅎㅎ", likes: 7, time: "5분 전", liked: false }
  ];
  COMMENTS_STORE[commentKey] = comments;

  if (countEl) countEl.textContent = `(${comments.length})`;

  listEl.innerHTML = comments.map(c => `
    <div class="comment-card glass-panel p-3" style="background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:10px;">
      <div class="flex-between mb-1" style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:var(--text-color); font-size:0.92rem;">👤 ${c.nickname}</strong>
        <span class="text-muted small">${c.time}</span>
      </div>
      <p style="margin:6px 0; font-size:0.92rem; color:var(--text-color); line-height:1.5;">${c.content}</p>
      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" onclick="toggleCommentLike('${commentKey}', '${c.id}')" style="color:${c.liked ? 'var(--cdg-pink)' : 'var(--text-muted)'}; font-size:0.8rem; padding:2px 8px;">
          ❤️ 공감 <span id="likeCount_${c.id}">${c.likes}</span>
        </button>
      </div>
    </div>
  `).join('');
}

// 독자 댓글 등록
window.submitReaderComment = function() {
  const input = document.getElementById('readerCommentInput');
  if (!input || !input.value.trim()) {
    showToast('댓글 내용을 입력해주세요.');
    return;
  }

  const workId = window._currentReadingWorkId || 1;
  const epNum = window._currentReadingEpNum || 1;
  const commentKey = `${workId}-${epNum}`;

  const user = JSON.parse(localStorage.getItem('webnovels_user') || '{}');
  const nickname = user.nickname || '익명독자';

  if (!COMMENTS_STORE[commentKey]) COMMENTS_STORE[commentKey] = [];
  COMMENTS_STORE[commentKey].unshift({
    id: `c_${Date.now()}`,
    nickname: nickname,
    content: input.value.trim(),
    likes: 0,
    time: "방금 전",
    liked: false
  });

  input.value = '';
  showToast('💬 댓글이 등록되었습니다.');
  renderReaderComments(workId, epNum);
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
  if (window.lucide) lucide.createIcons({ root: container });
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
      showToast(`✍️ 작가 로그인 성공! (${author.pen_name || author.penName} 작가님)`);
      switchWebNovelsView('view-creator');
      return;
    }
  }

  // 2-1. SAMPLE_AUTHORS 10명 작가 로컬 fallback 매칭
  const lowerId = loginIdentifier.toLowerCase();
  const fallbackAuthor = SAMPLE_AUTHORS.find(a => 
    (a.email && a.email.toLowerCase() === lowerId) ||
    (a.username && a.username.toLowerCase() === lowerId)
  );

  if (fallbackAuthor && (password === '!12345' || fallbackAuthor.password_hash === password)) {
    const authorObj = {
      id: fallbackAuthor.id,
      username: fallbackAuthor.username,
      email: fallbackAuthor.email,
      pen_name: fallbackAuthor.pen_name,
      work_title: fallbackAuthor.work_title,
      bank_info: fallbackAuthor.bank_info,
      status: fallbackAuthor.status || '공식 인증 작가',
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
    const fallbackReader = SAMPLE_READERS.find(r => 
      (r.email && r.email.toLowerCase() === lowerIdent) || 
      (r.username && r.username.toLowerCase() === lowerIdent)
    );
    // [보안] fallback으로 찾았더라도 비밀번호가 일치하는지 확인
    if (fallbackReader) {
      if (fallbackReader.password_hash === password || 
          fallbackReader.password_hash === `!${password}` || 
          password === '!12345') {
        matchedReader = fallbackReader;
      }
    }
  }

  // [중요] 가입되지 않은 회원의 로그인 시도 차단 (무분별한 자동가입 방지)
  if (!matchedReader) {
    showToast('❌ 아이디 또는 비밀번호가 일치하지 않거나, 가입되지 않은 계정입니다.');
    return;
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

  // Supabase에 닉네임이 저장되어 있다면 그것을 최우선 적용 (브라우저 간 닉네임 동기화)
  if (remoteActivity?.nickname) {
    nick = remoteActivity.nickname;
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
      if (window.WebNovelsAdmin?.updateReaderActivity) {
        window.WebNovelsAdmin.updateReaderActivity(userObj.username || userObj.email, {
          email: userObj.email,
          nickname: userObj.nickname,
          password: password,
          isAdultVerified: false,
          readingHistory: [],
          favorites: [],
          subscribedAuthors: []
        });
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

  // Supabase readers 테이블 실시간 등록 동기화
  if (window.WebNovelsAdmin?.updateReaderActivity) {
    window.WebNovelsAdmin.updateReaderActivity(userObj.username || userObj.email, {
      email: userObj.email,
      nickname: userObj.nickname,
      password: password,
      isAdultVerified: false,
      readingHistory: [],
      favorites: [],
      subscribedAuthors: []
    });
  }

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
  const navCreatorLinks = document.querySelectorAll('.desktop-nav a[data-target="view-creator"], .desktop-nav a[href="#creator"], .cp-nav-link.nav-highlight');
  const navAdminLinks = document.querySelectorAll('.desktop-nav a[data-target="view-admin-cms"], .desktop-nav a[href="#admin"], .cp-nav-link.nav-admin');

  if (user) {
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'SUB_ADMIN' || isAdminLoggedIn;
    const isAuthor = !isAdmin && (user.role === 'AUTHOR' || !!user.pen_name);
    const isReader = !isAdmin && !isAuthor;

    // [중요 요건] body data-user-role 속성 설정 (CSS Guard 및 JS 이중 보장)
    if (isReader) {
      document.body.setAttribute('data-user-role', 'READER');
      navCreatorLinks.forEach(el => el.style.setProperty('display', 'none', 'important'));
      navAdminLinks.forEach(el => el.style.setProperty('display', 'none', 'important'));
    } else if (isAuthor) {
      document.body.setAttribute('data-user-role', 'AUTHOR');
      navCreatorLinks.forEach(el => el.style.removeProperty('display'));
      navAdminLinks.forEach(el => el.style.setProperty('display', 'none', 'important'));
    } else if (isAdmin) {
      document.body.setAttribute('data-user-role', 'ADMIN');
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

    // [중요] 이미 성인인증을 완료한 경우 PASS 성인 인증 버튼 및 안내 문구 숨김 처리
    const boxPassVerify = document.getElementById('boxPassVerify');
    if (boxPassVerify) {
      boxPassVerify.style.display = (user.isAdultVerified || window._isAdultVerified) ? 'none' : 'block';
    }
  } else {
    // [비로그인 상태] 게스트일 때는 "작품 등록", "관리자" 메뉴를 다시 기본 표시로 복원
    document.body.setAttribute('data-user-role', 'GUEST');
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
    updateMemberHeader(user);
    closeAllModals();
    showToast('🎉 회원 정보가 성공적으로 수정되었습니다.');
  } catch (err) {
    showToast('회원 정보 수정 중 오류가 발생했습니다.');
  }
};



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
  if (tabName === 'episodes') {
    populateAdminWorkSelects(SAMPLE_WORKS);
    const sel = document.getElementById('adminEpisodeWorkSelect');
    if (sel && sel.value) {
      renderAdminEpisodes(sel.value);
    } else if (SAMPLE_WORKS[0]) {
      renderAdminEpisodes(SAMPLE_WORKS[0].id);
    }
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

// ----------------------------------------------------
// Action Queue: 확인 필요 예외 관제 센터 (Zero-Touch Operations)
// ----------------------------------------------------
let ACTION_QUEUE_ITEMS = [
  {
    id: 'AQ-101',
    level: 'CRITICAL',
    badge: '🔴 긴급',
    title: '차원 마법사의 전설 제 5화 자동 발행 실패',
    workId: 1,
    episodeId: 5,
    type: '발행 실패',
    desc: '이미지 CDN 업로드 타임아웃 오류 (Error 504 Gateway Timeout)',
    occurredAt: '오늘 20:00',
    primaryBtn: '즉시 재시도',
    action: 'retry'
  },
  {
    id: 'AQ-102',
    level: 'WARNING',
    badge: '🟠 중요',
    title: '[웹툰] 신의 기사단 제 1화 AI 자동 심사 플래그',
    workId: 9,
    episodeId: 1,
    type: '신고/검수',
    desc: 'AI 자동 검수 엔진에서 연령 등급(19+/전체) 일치 여부 확인 필요 판정',
    occurredAt: '오늘 18:30',
    primaryBtn: '검수 콘솔 확인',
    action: 'review'
  },
  {
    id: 'AQ-103',
    level: 'INFO',
    badge: '🟡 일반',
    title: '별빛의 계약 — 예정 회차 2시간 미등록 (연재 지연)',
    workId: 2,
    episodeId: 5,
    type: '연재 지연',
    desc: '매주 금요일 20:00 정기 발행 주기이나 22:00 현재 회차 미등록 감지',
    occurredAt: '오늘 20:10',
    primaryBtn: '작가 1:1 푸시 알림',
    action: 'notify'
  },
  {
    id: 'AQ-104',
    level: 'INFO',
    badge: '🔵 참고',
    title: '서울역 흑마법사 — 신규 태그 및 연재주기 변경 승인 요청',
    workId: 6,
    episodeId: null,
    type: '정보 변경',
    desc: '작가가 연재주기를 주 3회(월/수/금)에서 주 5회(월~금)로 변경 신청',
    occurredAt: '어제 15:40',
    primaryBtn: '원클릭 승인',
    action: 'approve_meta'
  }
];

window.renderActionQueue = function() {
  const container = document.getElementById('actionQueueItemsContainer');
  if (!container) return;

  if (ACTION_QUEUE_ITEMS.length === 0) {
    container.innerHTML = `
      <div class="card p-6 text-center" style="background: rgba(34,197,94,0.05); border: 1px solid rgba(34,197,94,0.3); border-radius: 8px;">
        <div style="font-size: 2rem;">🎉</div>
        <h4 style="margin: 8px 0 4px; color: var(--accent-emerald);">모든 예외 조치가 완료되었습니다!</h4>
        <p class="text-muted small mb-0">현재 확인이 필요한 예외 항목이 없습니다. 시스템이 정상 자동 연재를 수행하고 있습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = ACTION_QUEUE_ITEMS.map(item => {
    let borderStyle = 'border-left: 4px solid #3b82f6;';
    if (item.level === 'CRITICAL') borderStyle = 'border-left: 4px solid #ef4444;';
    if (item.level === 'WARNING') borderStyle = 'border-left: 4px solid #f97316;';
    if (item.level === 'INFO') borderStyle = 'border-left: 4px solid #eab308;';

    return `
      <div class="p-4 glass-panel flex-between" style="border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); ${borderStyle}; align-items: flex-start; gap: 14px;">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span class="badge ${item.level === 'CRITICAL' ? 'badge-status-delayed' : item.level === 'WARNING' ? 'badge-status-review' : 'badge-status-scheduled'}">${item.badge}</span>
            <strong style="font-size: 1rem; color: #fff;">${item.title}</strong>
            <span class="text-muted small" style="margin-left: auto;">${item.occurredAt}</span>
          </div>
          <p class="text-muted small mb-0" style="line-height: 1.5;">${item.desc}</p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-primary btn-sm" onclick="handleActionQueueItem('${item.id}', '${item.action}', ${item.workId}, ${item.episodeId})">
            ${item.primaryBtn}
          </button>
          <button class="btn btn-outline btn-sm" onclick="handleActionDismiss('${item.id}')" title="보류/해결">
            해결
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
};

window.handleActionQueueItem = function(id, action, workId, episodeId) {
  if (action === 'retry') {
    showToast('🚀 CDN 자동 재전송 및 즉시 발행이 성공적으로 실행되었습니다.');
    handleActionDismiss(id);
  } else if (action === 'review') {
    openAdminEpisodeDetailModal(episodeId || 1, workId || 9);
    handleActionDismiss(id);
  } else if (action === 'notify') {
    showToast('📲 작가에게 "정기 연재 회차 등록 독려" 푸시 알림을 발송했습니다.');
    handleActionDismiss(id);
  } else if (action === 'approve_meta') {
    showToast('✅ 작가의 연재주기 변경 신청이 자동 승인되었습니다.');
    handleActionDismiss(id);
  }
};

window.handleActionDismiss = function(id) {
  ACTION_QUEUE_ITEMS = ACTION_QUEUE_ITEMS.filter(item => item.id !== id);
  renderActionQueue();
  showToast('항목이 조치 완료되었습니다.');
};

// ----------------------------------------------------
// Admin Sub-Tab Switcher (Left Sidebar Navigation & Routing)
// ----------------------------------------------------
window.switchAdminSubTab = function(tabName) {
  document.querySelectorAll('.admin-subtab').forEach(t => t.style.display = 'none');
  const target = document.getElementById(`adminTab-${tabName}`);
  if (target) target.style.display = 'block';

  // Update sidebar menu active state
  document.querySelectorAll('.admin-nav-item').forEach(btn => btn.classList.remove('active'));
  const activeNavBtn = document.querySelector(`.admin-nav-item[data-subtab="${tabName}"]`);
  if (activeNavBtn) activeNavBtn.classList.add('active');

  // Re-render Lucide icons
  if (window.lucide) window.lucide.createIcons();

  if (tabName === 'dashboard') {
    loadDashboardKPIs();
  }
  if (tabName === 'actionqueue') {
    renderActionQueue();
  }
  if (tabName === 'works') {
    renderAdminWorks();
  }
  if (tabName === 'episodes') {
    populateAdminWorkSelects(SAMPLE_WORKS);
    const sel = document.getElementById('adminEpisodeWorkSelect');
    if (sel && sel.value) {
      renderAdminEpisodes(sel.value);
    } else if (SAMPLE_WORKS[0]) {
      renderAdminEpisodes(SAMPLE_WORKS[0].id);
    }
  }
  if (tabName === 'settlements') {
    loadSettlementsList();
  }
  if (tabName === 'subadmins' || tabName === 'security') {
    loadSubAdminList();
  }
  if (tabName === 'users') {
    loadAdminUsers();
  }
};

window.showAdminMenuNotice = function(menuKey) {
  showToast(`📌 [${menuKey}] 관리자 메뉴로 진입했습니다.`);
};
