// ============================================================
// [Core State Management] public/js/core/state.js
// 
// [Purpose]
// - 전역 애플리케이션 시드 데이터 및 런타임 활성 세션 상태 관리
// - 10명 작가(SAMPLE_AUTHORS), 10명 독자(SAMPLE_READERS), 대표 8개+ 작품(SAMPLE_WORKS)
// - 실시간 동기화 상태 및 LocalStorage/Supabase 양방향 활동 데이터 동기화
// ============================================================

const API_BASE = '/api';
var cdgHeroInterval = null;

// ============================================================
// [Helper] createDefault6Episodes
// [Business Rule] 1~3화 무료(isFree: true), 4~6화 광고/포인트 언락(isFree: false, isAdFree: true)
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
// [State] SAMPLE_WORKS (비상용 Fallback 시드 데이터 - SSOT는 Supabase DB)
// ------------------------------------------------------------
const SAMPLE_WORKS = [
  {
    id: 1,
    title: "폭풍의 여왕 서약",
    creator: "판타지마스터",
    author: "판타지마스터",
    genre: "판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/stormqueen_oath.jpg",
    description: "신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 42,
    episodesCount: 6,
    episodes: createDefault6Episodes("폭풍의 여왕 서약")
  },
  {
    id: 2,
    title: "천마의 귀환",
    creator: "무협의신",
    author: "무협의신",
    genre: "무협",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/sword_dao_supreme.jpg",
    description: "천마가 다시 눈을 떴다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 38,
    episodesCount: 6,
    episodes: createDefault6Episodes("천마의 귀환")
  },
  {
    id: 3,
    title: "금기의 계약",
    creator: "나이트로즈",
    author: "나이트로즈",
    genre: "성인",
    rating: "AGE_19",
    aiUsageType: "NONE",
    coverUrl: "/images/velvet_and_thorns.jpg",
    description: "금지된 계약으로 시작된 위험한 욕망. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 29,
    episodesCount: 6,
    episodes: createDefault6Episodes("금기의 계약")
  },
  {
    id: 4,
    title: "황제의 유일한 후궁",
    creator: "로맨스퀸",
    author: "로맨스퀸",
    genre: "로맨스",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/flower_blooming.jpg",
    description: "황제의 후궁이 된 그녀, 그리고 금지된 사랑. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 35,
    episodesCount: 6,
    episodes: createDefault6Episodes("황제의 유일한 후궁")
  },
  {
    id: 5,
    title: "성간 항로: 마지막 항해사",
    creator: "스페이스로그",
    author: "스페이스로그",
    genre: "SF",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/stellar_horizon.jpg",
    description: "인류 최후의 항해사가 별들을 건너다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 18,
    episodesCount: 6,
    episodes: createDefault6Episodes("성간 항로: 마지막 항해사")
  },
  {
    id: 6,
    title: "서울에 나타난 마왕",
    creator: "도시마법사",
    author: "도시마법사",
    genre: "현대 판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/seoul_sorcerer.jpg",
    description: "현대 서울에 마왕이 강림했다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 24,
    episodesCount: 6,
    episodes: createDefault6Episodes("서울에 나타난 마왕")
  },
  {
    id: 7,
    title: "죽은 자들의 학교",
    creator: "공포작가",
    author: "공포작가",
    genre: "호러",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/darkness_swallowed_classroom.jpg",
    description: "폐교에 남은 것들. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 12,
    episodesCount: 6,
    episodes: createDefault6Episodes("죽은 자들의 학교")
  },
  {
    id: 8,
    title: "검의 전설: 천하제일인",
    creator: "검성",
    author: "검성",
    genre: "무협",
    rating: "ALL",
    aiUsageType: "NONE",
    coverUrl: "/images/sword_dao_defies_heavens.jpg",
    description: "천하를 제패할 검이 깨어난다. 1~3화 즉시 무료 & 4~6화 광고 보고 연속 무료 열람!",
    viewCount: 31,
    episodesCount: 6,
    isCompleted: true,
    contentType: "NOVEL",
    episodes: createDefault6Episodes("검의 전설: 천하제일인")
  },
  {
    id: 9,
    title: "[웹툰] 신의 기사단",
    creator: "판타지마스터",
    author: "판타지마스터",
    genre: "판타지",
    rating: "ALL",
    aiUsageType: "NONE",
    contentType: "WEBTOON",
    coverUrl: "/images/stormqueen_oath.jpg",
    description: "대적자 스핀오프 공식 웹툰! 화려한 작화로 펼쳐지는 기사단의 모험.",
    viewCount: 26,
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
    creator: "로맨스퀸",
    author: "로맨스퀸",
    genre: "로맨스",
    rating: "ALL",
    aiUsageType: "NONE",
    contentType: "WEBTOON",
    coverUrl: "/images/flower_blooming.jpg",
    description: "황실 최고의 비밀이 담긴 화원에서 피어나는 은밀하고 달콤한 로맨스 웹툰.",
    viewCount: 22,
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

// ------------------------------------------------------------
// [State] SAMPLE_READERS (비상용 Fallback 시드 독자 - SSOT는 Supabase DB)
// ------------------------------------------------------------
const SAMPLE_READERS = [
  { id: 1, username: 'reader1', password_hash: '!12345', email: 'reader1@webnovels.com', phone: '+82-010-111-1111', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 2, username: 'reader2', password_hash: '!12345', email: 'reader2@webnovels.com', phone: '+82-010-111-1112', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 3, username: 'reader3', password_hash: '!12345', email: 'reader3@webnovels.com', phone: '+82-010-111-1113', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 4, username: 'reader4', password_hash: '!12345', email: 'reader4@webnovels.com', phone: '+82-010-111-1114', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 5, username: 'reader5', password_hash: '!12345', email: 'reader5@webnovels.com', phone: '+82-010-111-1115', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 6, username: 'reader6', password_hash: '!12345', email: 'reader6@webnovels.com', phone: '+82-010-111-1116', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 7, username: 'reader7', password_hash: '!12345', email: 'reader7@webnovels.com', phone: '+82-010-111-1117', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 8, username: 'reader8', password_hash: '!12345', email: 'reader8@webnovels.com', phone: '+82-010-111-1118', is_adult_verified: false, subscription_status: '일반 회원' },
  { id: 9, username: 'reader9', password_hash: '!12345', email: 'reader9@webnovels.com', phone: '+82-010-111-1119', is_adult_verified: true, subscription_status: '프리미엄 구독중' },
  { id: 10, username: 'reader10', password_hash: '!12345', email: 'reader10@webnovels.com', phone: '+82-010-111-1120', is_adult_verified: false, subscription_status: '일반 회원' }
];

// ------------------------------------------------------------
// [State] SAMPLE_AUTHORS (비상용 Fallback 시드 작가 - SSOT는 Supabase DB)
// ------------------------------------------------------------
const SAMPLE_AUTHORS = [
  { id: 1, username: 'creator1', password_hash: '!12345', email: 'creator1@webnovels.com', pen_name: '판타지마스터', work_title: '대적자: 신을 삼킨 기사', birthdate: '1990-01-15', address: '서울특별시 강남구 테헤란로 123', bank_info: '국민은행 999-888-777666', status: '공식 인증 작가' },
  { id: 2, username: 'creator2', password_hash: '!12345', email: 'creator2@webnovels.com', pen_name: '무협의신', work_title: '천마의 귀환', birthdate: '1985-05-20', address: '서울특별시 서초구 반포대로 45', bank_info: '신한은행 110-222-333444', status: '공식 인증 작가' },
  { id: 3, username: 'creator3', password_hash: '!12345', email: 'creator3@webnovels.com', pen_name: '나이트로즈', work_title: '금기의 계약', birthdate: '1992-08-12', address: '경기도 성남시 분당구 판교로 78', bank_info: '우리은행 1002-555-666777', status: '공식 인증 작가' },
  { id: 4, username: 'creator4', password_hash: '!12345', email: 'creator4@webnovels.com', pen_name: '로맨스퀸', work_title: '황제의 유일한 후궁', birthdate: '1994-11-03', address: '서울특별시 마포구 월드컵북로 99', bank_info: '하나은행 222-333-444555', status: '공식 인증 작가' },
  { id: 5, username: 'creator5', password_hash: '!12345', email: 'creator5@webnovels.com', pen_name: '스페이스로그', work_title: '성간 항로: 마지막 항해사', birthdate: '1988-03-30', address: '대전광역시 유성구 대학로 100', bank_info: '농협 301-777-888999', status: '공식 인증 작가' },
  { id: 6, username: 'creator6', password_hash: '!12345', email: 'creator6@webnovels.com', pen_name: '도시마법사', work_title: '서울에 나타난 마왕', birthdate: '1995-07-07', address: '서울특별시 송파구 올림픽로 200', bank_info: '카카오뱅크 3333-01-234567', status: '공식 인증 작가' },
  { id: 7, username: 'creator7', password_hash: '!12345', email: 'creator7@webnovels.com', pen_name: '공포작가', work_title: '죽은 자들의 학교', birthdate: '1991-10-31', address: '부산광역시 해운대구 센텀서로 30', bank_info: '기업은행 010-9999-8888', status: '공식 인증 작가' },
  { id: 8, username: 'creator8', password_hash: '!12345', email: 'creator8@webnovels.com', pen_name: '검성', work_title: '검의 전설: 천하제일인', birthdate: '1987-12-25', address: '대구광역시 수성구 달구벌대로 500', bank_info: '대구은행 508-12-345678', status: '공식 인증 작가' },
  { id: 9, username: 'creator9', password_hash: '!12345', email: 'creator9@webnovels.com', pen_name: '스튜디오노바', work_title: '[웹툰] 신의 기사단', birthdate: '1993-04-10', address: '서울특별시 마포구 독막로 50', bank_info: '국민은행 111-222-333444', status: '공식 인증 작가' },
  { id: 10, username: 'creator10', password_hash: '!12345', email: 'creator10@webnovels.com', pen_name: '로즈코믹스', work_title: '[웹툰] 황후의 비밀 화원', birthdate: '1996-09-18', address: '서울특별시 강남구 학동로 20', bank_info: '신한은행 333-444-555666', status: '공식 인증 작가' }
];

// ------------------------------------------------------------
// [Client State] 활성 세션 변수
// ------------------------------------------------------------
let activeWork = SAMPLE_WORKS[0];
let activeEpisodeId = 'ep-1';
let unlockedEpisodes = new Set();
let currentTheme = 'theme-dark';
let currentFontSize = 18;
let currentActiveView = 'view-home';
let lastMainView = 'view-home';
let currentLoggedCreator = null;
let currentLoggedAuthor = currentLoggedCreator;

// 독자 보유 포인트 상태 (기본 1,000P)
let userPoints = parseInt(localStorage.getItem('webnovels_user_points') || '1000', 10);

// Action Queue 실시간 예외 관제 센터 데이터
let ACTION_QUEUE_ITEMS = [];

// CMS: 작품 연재 관리 필터 상태
let adminWorkFilterState = {
  status: 'ALL',
  genre: 'ALL',
  rating: 'ALL',
  searchQuery: ''
};

// ============================================================
// [Helper] 사용자 활동 데이터(독서이력, 관심작품, 구독작가, 성인인증) 로컬/DB 양방향 동기화
// ============================================================
function syncUserActivityToStorage(data) {
  if (!data) return;
  const savedUser = JSON.parse(localStorage.getItem('webnovels_user') || 'null');
  const userIdent = savedUser ? (savedUser.username || savedUser.email || savedUser.id) : null;

  // 1. [Dual Persistence Merge] 독서 진행률 동기화
  if (data.readingHistory && Array.isArray(data.readingHistory)) {
    const remoteHist = data.readingHistory;
    let localHist = [];
    try {
      localHist = JSON.parse(localStorage.getItem('webnovels_reading_history') || '[]');
    } catch(e) {}

    const histMap = new Map();
    // 로컬 기록 먼저 맵에 등록
    for (const item of localHist) {
      if (item && item.workId) histMap.set(Number(item.workId), item);
    }
    // 원격 기록으로 머지 (원격 또는 로컬 중 더 최신 updatedAt 보존)
    let hasLocalNewer = false;
    for (const rItem of remoteHist) {
      if (!rItem || !rItem.workId) continue;
      const wId = Number(rItem.workId);
      const prev = histMap.get(wId);
      if (!prev) {
        histMap.set(wId, rItem);
      } else {
        const rTime = new Date(rItem.updatedAt || 0).getTime();
        const lTime = new Date(prev.updatedAt || 0).getTime();
        if (rTime >= lTime) {
          histMap.set(wId, rItem);
        } else {
          hasLocalNewer = true;
        }
      }
    }

    const mergedHist = Array.from(histMap.values())
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, 30);

    localStorage.setItem('webnovels_reading_history', JSON.stringify(mergedHist));

    // 로컬에만 있는 최신 기록이 있거나 원격이 비어있었다면 DB에 실시간 푸시
    if ((hasLocalNewer || (remoteHist.length === 0 && localHist.length > 0)) && userIdent && window.WebNovelsAdmin?.updateReaderActivity) {
      window.WebNovelsAdmin.updateReaderActivity(userIdent, { readingHistory: mergedHist });
    }
  }

  // 2. [Dual Persistence Merge] 관심작품 동기화
  if (data.favorites && Array.isArray(data.favorites)) {
    const remoteFavs = data.favorites.map(Number);
    let localFavs = [];
    try {
      localFavs = JSON.parse(localStorage.getItem('webnovels_favorites') || '[]').map(Number);
    } catch(e) {}

    // 합집합 머지
    const mergedFavs = Array.from(new Set([...remoteFavs, ...localFavs])).filter(id => !isNaN(id) && id > 0);
    localStorage.setItem('webnovels_favorites', JSON.stringify(mergedFavs));

    // 로컬에만 있던 관심작품이 포함되어 원격보다 늘어난 경우 DB에 실시간 동기화
    if (mergedFavs.length > remoteFavs.length && userIdent && window.WebNovelsAdmin?.updateReaderActivity) {
      window.WebNovelsAdmin.updateReaderActivity(userIdent, { favorites: mergedFavs });
    }
  }

  // 3. [Dual Persistence Merge] 구독 크리에이터 동기화
  const incomingSubs = data.subscribedCreators || data.subscribedAuthors;
  if (incomingSubs && Array.isArray(incomingSubs)) {
    const remoteSubs = incomingSubs.map(String);
    let localSubs = [];
    try {
      localSubs = JSON.parse(localStorage.getItem('webnovels_subscribed_creators') || localStorage.getItem('webnovels_subscribed_authors') || '[]').map(String);
    } catch(e) {}

    // 합집합 머지
    const mergedSubs = Array.from(new Set([...remoteSubs, ...localSubs])).filter(Boolean);
    localStorage.setItem('webnovels_subscribed_creators', JSON.stringify(mergedSubs));
    localStorage.setItem('webnovels_subscribed_authors', JSON.stringify(mergedSubs));

    // 로컬에만 있던 구독 크리에이터가 포함되어 원격보다 늘어난 경우 DB에 실시간 동기화
    if (mergedSubs.length > remoteSubs.length && userIdent && window.WebNovelsAdmin?.updateReaderActivity) {
      window.WebNovelsAdmin.updateReaderActivity(userIdent, { subscribedCreators: mergedSubs, subscribedAuthors: mergedSubs });
    }
  }

  if (data.isAdultVerified !== undefined) {
    window._isAdultVerified = !!data.isAdultVerified;
  }

  if (typeof renderLibraryContent === 'function') {
    renderLibraryContent(true);
  }
}

// 브라우저 전역 노출 바인딩
if (typeof window !== 'undefined') {
  window.API_BASE = API_BASE;
  window.createDefault6Episodes = createDefault6Episodes;
  window.SAMPLE_WORKS = SAMPLE_WORKS;
  window.COMMENTS_STORE = COMMENTS_STORE;
  window.SAMPLE_READERS = SAMPLE_READERS;
  window.SAMPLE_CREATORS = SAMPLE_CREATORS;
  window.SAMPLE_AUTHORS = SAMPLE_CREATORS;
  window.activeWork = activeWork;
  window.activeEpisodeId = activeEpisodeId;
  window.unlockedEpisodes = unlockedEpisodes;
  window.currentTheme = currentTheme;
  window.currentFontSize = currentFontSize;
  window.currentActiveView = currentActiveView;
  window.lastMainView = lastMainView;
  window.currentLoggedCreator = currentLoggedCreator;
  window.currentLoggedAuthor = currentLoggedCreator;
  window.userPoints = userPoints;
  window.ACTION_QUEUE_ITEMS = ACTION_QUEUE_ITEMS;
  window.adminWorkFilterState = adminWorkFilterState;
  window.syncUserActivityToStorage = syncUserActivityToStorage;
}
