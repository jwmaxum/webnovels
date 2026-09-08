// ============================================================
// [Core UI Utilities] public/js/core/ui-utils.js
//
// [Purpose]
// - 모달(Modal) 제어 (openModal, closeModal, closeAllModals)
// - 토스트(Toast) 메시지 알림 (showToast, showAdminMenuNotice)
// - 텍스트 이스케이프 및 정규화 (escapeHtml, normalizeSearchText)
// - 표지 이미지/작가명 추출 헬퍼 (getWorkCover, getAuthorName)
// - 관심작품/구독작가 버튼 상태 UI 렌더러
// ============================================================

// 모달 열기
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
window.openModal = openModal;

// 특정 모달 닫기
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}
window.closeModal = closeModal;

// 모든 모달 닫기
function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
}
window.closeAllModals = closeAllModals;

// 토스트 메시지 표시 (3초 후 자동 소멸)
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
window.showToast = showToast;

// 관리자 관제 메뉴 진입 안내
function showAdminMenuNotice(menuKey) {
  showToast(`📌 [${menuKey}] 관리자 메뉴로 진입했습니다.`);
}
window.showAdminMenuNotice = showAdminMenuNotice;

// HTML 이스케이프 유틸리티
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

// 검색어 정규화 (소문자 변환 및 공백 제거)
function normalizeSearchText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}
window.normalizeSearchText = normalizeSearchText;

// 작품 표지 이미지 URL 추출 헬퍼
const getWorkCover = (w) => {
  if (!w) return '/images/stormqueen_oath.jpg';
  const raw = w.coverUrl || w.coverImageUrl || w.cover_image || w.coverImage || '/images/stormqueen_oath.jpg';
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) return raw;
  return `/images/${raw}`;
};
window.getWorkCover = getWorkCover;

// 작품 작가명/크리에이터명 추출 헬퍼
const getAuthorName = (w) => (typeof (w?.author || w?.creator) === 'object' ? ((w?.author || w?.creator)?.penName || (w?.author || w?.creator)?.pen_name || (w?.author || w?.creator)?.name) : (w?.author || w?.creator)) || '작자미상';
const getCreatorName = getAuthorName;
window.getAuthorName = getAuthorName;
window.getCreatorName = getCreatorName;

// 관심작품 버튼 UI 상태 갱신
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
window.updateFavoriteButtons = updateFavoriteButtons;

// 작가 구독 버튼 UI 상태 갱신
function updateSubscribeButtons(authorData) {
  const authorName = (typeof authorData === 'object' ? (authorData?.penName || authorData?.pen_name || authorData?.name) : authorData) || '작자미상';
  const subAuthors = JSON.parse(localStorage.getItem('webnovels_subscribed_authors') || localStorage.getItem('webnovels_subscribed_creators') || '[]');
  const isSubbed = subAuthors.includes(authorName);
  const btnSub = document.getElementById('btnDetailSubscribe');

  if (btnSub) {
    btnSub.innerHTML = isSubbed
      ? '<i data-lucide="user-check" style="color: var(--primary-color);"></i> 작가 구독중'
      : '<i data-lucide="user-plus"></i> 작가 구독';
  }
  if (window.lucide) window.lucide.createIcons();
}
window.updateSubscribeButtons = updateSubscribeButtons;

