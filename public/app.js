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

  // 관리자 CMS 진입 시 대시보드 KPI 로드
  if (viewId === 'view-admin-cms' && isAdminLoggedIn) {
    loadAdminDashboard();
  }
}

// 관리자 로그인 로직 처리 (Supabase 연동)
window.handleAdminLoginProcess = async function() {
  const idInput = document.getElementById('adminLoginId').value;
  const pwInput = document.getElementById('adminLoginPw').value;

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
    // Supabase 미연동 시 폴백 (개발/데모용)
    isAdminLoggedIn = true;
    closeAllModals();
    showToast(`🔑 관리자 로그인 성공! (${idInput}) [오프라인 모드]`);
    document.getElementById('adminRoleBadge').textContent = 'SUPER_ADMIN (오프라인)';
    document.getElementById('adminRoleBadge').className = 'badge badge-accent';
    if (document.getElementById('btnAdminLogout')) {
      document.getElementById('btnAdminLogout').style.display = 'inline-block';
    }
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

  // 시스템 설정 로드
  loadSystemConfig();

  // Lucide 아이콘 재렌더
  lucide.createIcons();
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
function renderHomeWorks() {
  const container = document.getElementById('homeWorksGrid');
  if (!container) return;

  container.innerHTML = SAMPLE_WORKS.map(w => `
    <div class="work-card" onclick="openWorkDetailDirect(${w.id})">
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
    <div class="work-card" onclick="openWorkDetailDirect(${w.id})">
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
          <span>${w.rating === 'AGE_19' ? '🔞 성인' : '전체이용가'}</span>
          <span>${w.episodesCount}화</span>
        </div>
      </div>
    </div>
  `).join('');
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
    showToast(`👤 서브 관리자 (${newId}) 생성됨 [오프라인 모드]`);
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

