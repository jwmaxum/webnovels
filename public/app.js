// WebNovels Platform Frontend JavaScript Logic

const API_BASE = '/api';

// Sample Works Seed Data
const SAMPLE_WORKS = [
  {
    id: 'w-fantasy',
    title: '대적자: 신을 삼킨 기사',
    author: '판타지마스터',
    genre: '판타지',
    rating: 'ALL',
    aiUsageType: 'NONE',
    coverUrl: '/images/cover_fantasy.png',
    description: '신들의 몰락과 기사의 재림! 1~3화 즉시 무료 & 4화부터 광고 보고 연속 무료 열람!',
    viewCount: 124500,
    episodesCount: 4
  },
  {
    id: 'w-romance',
    title: '북부 대공의 수수께끼 신부',
    author: '로맨스퀸',
    genre: '로맨스 판타지',
    rating: 'AGE_15',
    aiUsageType: 'ASSISTED',
    coverUrl: '/images/cover_romance.png',
    description: '얼어붙은 북부 대공가에 찾아온 수수께끼 영애의 달콤 살벌한 계약 결혼 이야기.',
    viewCount: 98200,
    episodesCount: 4
  }
];

let activeWork = SAMPLE_WORKS[0];
let activeEpisodeId = 'ep-1';
let currentTheme = 'theme-dark';
let currentFontSize = 18;

document.addEventListener('DOMContentLoaded', () => {
  initWebNovelsApp();
});

function initWebNovelsApp() {
  lucide.createIcons();
  bindWebNovelsEvents();
  renderHomeWorks();
  renderDiscoverWorks();
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
    window.location.hash = '#admin';
    switchWebNovelsView('view-admin-cms');
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
}

// 관리자 로그인 로직 처리
window.handleAdminLoginProcess = function() {
  const idInput = document.getElementById('adminLoginId').value;
  const pwInput = document.getElementById('adminLoginPw').value;

  if (!idInput || !pwInput) {
    showToast('관리자 ID와 비밀번호를 모두 입력해주세요.');
    return;
  }

  isAdminLoggedIn = true;
  closeAllModals();
  showToast(`🔑 관리자 로그인 성공! (${idInput})`);
  
  // 관리자 관제탑 활성화
  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  const adminView = document.getElementById('view-admin-cms');
  if (adminView) adminView.classList.add('active');
};

// ----------------------------------------------------
// 1. Home & Discover Views
// ----------------------------------------------------
function renderHomeWorks() {
  const container = document.getElementById('homeWorksGrid');
  if (!container) return;

  container.innerHTML = SAMPLE_WORKS.map(w => `
    <div class="work-card" onclick="openWorkDetailDirect('${w.id}')">
      <div class="cover-wrapper">
        <img src="${w.coverUrl}" alt="${w.title}" class="cover-img">
        <span class="card-badge">무료 + 광고 해금</span>
      </div>
      <div class="card-info">
        <div>
          <h4 class="card-title">${w.title}</h4>
          <p class="card-author">${w.author}</p>
        </div>
        <div class="card-meta">
          <span>★ 4.9</span>
          <span>조회 ${(w.viewCount / 1000).toFixed(1)}K</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderDiscoverWorks() {
  const container = document.getElementById('discoverWorksGrid');
  if (!container) return;

  container.innerHTML = SAMPLE_WORKS.map(w => `
    <div class="work-card" onclick="openWorkDetailDirect('${w.id}')">
      <div class="cover-wrapper">
        <img src="${w.coverUrl}" alt="${w.title}" class="cover-img">
        <span class="card-badge">${w.genre}</span>
      </div>
      <div class="card-info">
        <div>
          <h4 class="card-title">${w.title}</h4>
          <p class="card-author">${w.author}</p>
        </div>
        <div class="card-meta">
          <span>등급: ${w.rating}</span>
          <span>AI: ${w.aiUsageType}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ----------------------------------------------------
// 2. Work Detail & Episode List
// ----------------------------------------------------
window.openWorkDetailDirect = function(workId) {
  const work = SAMPLE_WORKS.find(w => w.id === workId) || SAMPLE_WORKS[0];
  activeWork = work;

  document.getElementById('detailCoverImg').src = work.coverUrl;
  document.getElementById('detailTitle').textContent = work.title;
  document.getElementById('detailAuthor').textContent = `작가: ${work.author}`;
  document.getElementById('detailGenreBadge').textContent = work.genre;
  document.getElementById('detailRatingBadge').textContent = work.rating === 'ALL' ? '전체이용가' : '15세 제한';
  document.getElementById('detailAiBadge').textContent = `AI ${work.aiUsageType}`;
  document.getElementById('detailDescription').textContent = work.description;

  // Render Episode List (1~3 Free, 4 Ad Unlock)
  const epList = document.getElementById('detailEpisodeList');
  let epHtml = '';
  for (let i = 1; i <= 4; i++) {
    const isFree = i <= 3;
    epHtml += `
      <div class="episode-row" onclick="openReaderDirect('${work.id}', 'ep-${i}')">
        <div class="ep-left">
          <span class="ep-number">${i}화</span>
          <span class="ep-title">제 ${i} 화</span>
        </div>
        <div class="ep-right">
          ${isFree 
            ? '<span class="badge badge-accent">FREE (무료)</span>' 
            : '<span class="badge badge-warning">🔓 광고보고 무료열람</span>'}
        </div>
      </div>
    `;
  }
  epList.innerHTML = epHtml;

  switchWebNovelsView('view-work-detail');
};

// ----------------------------------------------------
// 3. Reader Logic & Rewarded Ad Unlock (design.md Section 26~38)
// ----------------------------------------------------
window.openReaderDirect = function(workId, epId) {
  const epNum = parseInt(epId.replace('ep-', ''), 10);

  // If 4th episode (Requires Ad Unlock)
  if (epNum === 4) {
    openModal('modalAdUnlock');
    return;
  }

  activeEpisodeId = epId;
  document.getElementById('readerWorkTitle').textContent = activeWork.title;
  document.getElementById('readerEpTitle').textContent = `제 ${epNum} 화`;
  document.getElementById('readerHeading').textContent = `제 ${epNum} 화`;

  const bodyContent = `
    <p>이것은 웹소설 『${activeWork.title}』 제 ${epNum}화 본문 내용입니다.</p>
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

// ----------------------------------------------------
// 5. PASS Adult Verification
// ----------------------------------------------------
async function handlePassAdultVerify() {
  if (confirm('PASS / KCP 본인인증 팝업을 실행하시겠습니까? (성인 19세 이상 확인)')) {
    showToast('📲 PASS 인증 검증 중...');
    setTimeout(() => {
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

// Admin Sub-Tab Switcher
window.switchAdminSubTab = function(tabName) {
  document.querySelectorAll('.admin-subtab').forEach(t => t.style.display = 'none');
  const target = document.getElementById(`adminTab-${tabName}`);
  if (target) target.style.display = 'block';

  // update pill active
  const pills = document.querySelectorAll('#view-admin-cms .filter-pills .pill');
  pills.forEach(p => p.classList.remove('active'));
  const activePill = Array.from(pills).find(p => p.getAttribute('onclick')?.includes(tabName));
  if (activePill) activePill.classList.add('active');
};

// 16개 메뉴 클릭 통합 토스트 및 안내 헬퍼
window.showAdminMenuNotice = function(menuKey) {
  const menuNames = {
    'DASHBOARD': '1. DASHBOARD (대시보드)',
    'USER_MGMT': '2. USER_MGMT (회원 관리)',
    'AUTHOR_MGMT': '3. AUTHOR_MGMT (작가 관리)',
    'WORK_MGMT': '4. WORK_MGMT (작품 연재)',
    'EPISODE_MGMT': '5. EPISODE_MGMT (회차 관리)',
    'CONTENT_REVIEW': '6. CONTENT_REVIEW (심사)',
    'COMMENT_REPORT': '7. COMMENT_REPORT (댓글/신고)',
    'AD_MGMT': '8. AD_MGMT (광고 플랫폼)',
    'FAN_MEETING': '11. FAN_MEETING (팬미팅)',
    'GOODS_MGMT': '12. GOODS_MGMT (굿즈 커머스)',
    'EVENT_MGMT': '13. EVENT_MGMT (이벤트)',
    'ANALYTICS': '14. ANALYTICS (매출 통계)'
  };
  const name = menuNames[menuKey] || menuKey;
  showToast(`📌 [${name}] 관리자 메뉴로 진입했습니다.`);
  
  // Update menu 16 navbar active status
  document.querySelectorAll('.menu-16-item').forEach(btn => btn.classList.remove('active'));
  const clickedBtn = Array.from(document.querySelectorAll('.menu-16-item')).find(btn => btn.getAttribute('onclick')?.includes(menuKey));
  if (clickedBtn) clickedBtn.classList.add('active');
};

// 신규 서브 관리자 생성 (16개 메뉴 접근 권한 포함)
window.handleCreateSubAdminSubmit = function() {
  const newId = document.getElementById('newSubAdminId').value;
  const newName = document.getElementById('newSubAdminName').value;
  
  const checkedPerms = Array.from(document.querySelectorAll('input[name="newPerm"]:checked')).map(el => el.value);

  showToast(`👤 신규 서브 관리자 (${newId} / ${newName}) 계정이 생성되었습니다. (부여 권한: ${checkedPerms.length}개 메뉴)`);
  closeAllModals();
};
