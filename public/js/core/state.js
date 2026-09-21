// ============================================================
// [Core State Management] public/js/core/state.js
// 
// [Purpose]
// - Supabase에서 조회한 데이터의 화면 캐시 및 런타임 상태
// - SAMPLE_* 이름은 기존 호출부 호환용이며 정적 시드 데이터는 포함하지 않음
// ============================================================

const API_BASE = '/api';
var cdgHeroInterval = null;

// DB response caches only. Empty means no records, never fabricated content.
const SAMPLE_WORKS = [];
const SAMPLE_READERS = [];
const SAMPLE_AUTHORS = [];
const COMMENTS_STORE = {};

// Display filtering is not authorization. The DB must enforce the same policy.
function getPublishedWorks() {
  return SAMPLE_WORKS.filter(w => ['PUBLISHED', 'ONGOING', 'PAUSED', 'COMPLETED'].includes(w.status))
    .map(w => ({ ...w, episodes: (w.episodes || []).filter(ep =>
      ep.status === 'PUBLISHED' && (!ep.scheduledAt || new Date(ep.scheduledAt) <= new Date())) }));
}

// ------------------------------------------------------------
// [Client State] 활성 세션 변수
// ------------------------------------------------------------
let activeWork = null;
let activeEpisodeId = null;
let unlockedEpisodes = new Set();
let currentTheme = 'theme-dark';
let currentFontSize = 18;
let currentActiveView = 'view-home';
let lastMainView = 'view-home';
let currentLoggedAuthor = null;
let currentLoggedCreator = currentLoggedAuthor;

// 잔액은 DB 프로필 조회 후 반영
let userPoints = 0;

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
  // Local storage is a render cache; never merge another account's cached records.
  localStorage.setItem('webnovels_reading_history', JSON.stringify(data.readingHistory || []));
  localStorage.setItem('webnovels_favorites', JSON.stringify(data.favorites || []));
  const subscriptions = data.subscribedCreators || data.subscribedAuthors || [];
  localStorage.setItem('webnovels_subscribed_creators', JSON.stringify(subscriptions));
  localStorage.setItem('webnovels_subscribed_authors', JSON.stringify(subscriptions));
  window._isAdultVerified = !!data.isAdultVerified;
  userPoints = Number(data.points || 0);
  window.userPoints = userPoints;
  const badge = document.getElementById('headerPointsValue');
  if (badge) badge.textContent = userPoints.toLocaleString() + 'P';
  if (typeof renderContinueReadingHome === 'function') renderContinueReadingHome();
  if (typeof renderLibraryContent === 'function') renderLibraryContent(true);
}

// 브라우저 전역 노출 바인딩
if (typeof window !== 'undefined') {
  window.API_BASE = API_BASE;
  window.SAMPLE_WORKS = SAMPLE_WORKS;
  window.COMMENTS_STORE = COMMENTS_STORE;
  window.SAMPLE_READERS = SAMPLE_READERS;
  window.SAMPLE_AUTHORS = SAMPLE_AUTHORS;
  window.SAMPLE_CREATORS = SAMPLE_AUTHORS;
  window.activeWork = activeWork;
  window.activeEpisodeId = activeEpisodeId;
  window.unlockedEpisodes = unlockedEpisodes;
  window.currentTheme = currentTheme;
  window.currentFontSize = currentFontSize;
  window.currentActiveView = currentActiveView;
  window.lastMainView = lastMainView;
  window.currentLoggedAuthor = currentLoggedAuthor;
  window.currentLoggedCreator = currentLoggedAuthor;
  window.userPoints = userPoints;
  window.ACTION_QUEUE_ITEMS = ACTION_QUEUE_ITEMS;
  window.adminWorkFilterState = adminWorkFilterState;
  window.syncUserActivityToStorage = syncUserActivityToStorage;
}
