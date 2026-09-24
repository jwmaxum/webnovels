// ============================================================
// [Admin Domain Engine] public/js/admin/admin.js
//
// [Purpose]
// - 이전 관리자 화면 호환 모듈
// - 관리자 로그인/로그아웃 및 세션 검증
// - 관리자 좌측 사이드바 서브탭 라우팅 (switchAdminSubTab)
// - 대시보드 운영 지표 (loadDashboardKPIs)
// - 작품 연재 관리(CMS), 연재 캘린더, 5대 콘텐츠 심사 & 검수 Workflow
// - 서브 관리자 권한 관리
// ============================================================


// --- 1. 관리자 CMS 핵심 (인증, 작품 연재, 에피소드 검수, 캘린더) ---

// ============================================================
// [Admin Auth] 관리자 로그인 로직 처리 (Supabase 및 세션 동기화)
// ============================================================
window.handleAdminLoginProcess = async function() {
  try {
    const actor = await window.WebNovelsAuth.login(document.getElementById('adminLoginId').value, document.getElementById('adminLoginPw').value);
    if (!actor.admin) { await window.WebNovelsAuth.logout(); showToast('관리자 권한이 없습니다.'); return; }
    closeAllModals();
    switchWebNovelsView('view-admin-cms');
  } catch(error) { showToast(window.WebNovelsAuth.message(error)); }
};

// ============================================================
// [Admin Auth] 관리자 로그아웃
// ============================================================
window.handleAdminLogoutProcess = async function() { return window.handleMemberLogout(); };

// ---- 관리자 대시보드 KPI 로더는 하단(Line 2100대) 마스터 구현체(window.loadDashboardKPIs)로 일원화됨 ----

async function loadAdminDashboard() {
  await window.loadDashboardKPIs();
}

// 독자 회원 (readers) 실시간 DB 로드 및 렌더링
window.loadAdminUsers = async function(forceRefresh = false) {
  const container = document.getElementById('adminReadersTableBody') || document.querySelector('#adminTab-users table tbody');
  if (!container) return;

  if (forceRefresh || SAMPLE_READERS.length === 0) {
    if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.fetchReadersFromSupabase === 'function') {
      try {
        const dbReaders = await window.WebNovelsAdmin.fetchReadersFromSupabase();
        if (Array.isArray(dbReaders)) {
          SAMPLE_READERS.length = 0;
          SAMPLE_READERS.push(...dbReaders);
        }
      } catch(err) {
        console.warn('[loadAdminUsers] DB 로드 실패:', err);
      }
    }
  }

  renderReadersAdminTable();
};

window.renderReadersAdminTable = function() {
  const container = document.getElementById('adminReadersTableBody') || document.querySelector('#adminTab-users table tbody');
  if (!container) return;

  if (!SAMPLE_READERS || SAMPLE_READERS.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="7" class="p-4 text-center text-muted">
          등록된 독자 회원이 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = SAMPLE_READERS.map(r => {
    const userIdDisplay = escapeHtml(r.username || (r.id ? `usr_${r.id}` : 'usr_guest'));
    const nicknameDisplay = escapeHtml(r.nickname || '-');
    const emailDisplay = escapeHtml(r.email || '-');
    const subStatus = escapeHtml(r.subscription_status || '일반 회원');
    const isSubscribed = subStatus.includes('프리미엄') || subStatus.includes('VIP');
    const badgeClass = isSubscribed ? 'badge-primary' : 'badge-accent';
    const adultBadge = r.is_adult_verified 
      ? '<span class="badge badge-accent" style="font-size:0.75rem; padding:2px 6px;">🔞 성인인증 완료</span>' 
      : '<span class="badge badge-outline" style="font-size:0.75rem; padding:2px 6px; color:var(--text-muted);">미인증</span>';
    const createdAtDisplay = escapeHtml(r.created_at ? String(r.created_at).substring(0, 10) : '-');
    const readerId = String(r.id || '');
    const detailButton = /^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(readerId)
      ? `<button class="btn btn-ghost btn-sm" onclick="openReaderDetailModal('${readerId}')">상세</button>` : '';

    return `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td class="p-3"><strong>${userIdDisplay}</strong></td>
        <td class="p-3">${nicknameDisplay}</td>
        <td class="p-3">${emailDisplay}</td>
        <td class="p-3"><span class="badge ${badgeClass}">${subStatus}</span></td>
        <td class="p-3">${adultBadge}</td>
        <td class="p-3">${createdAtDisplay}</td>
        <td class="p-3">
          ${detailButton}
        </td>
      </tr>
    `;
  }).join('');
};

// ---- 독자 회원 상세 모달 열기 ----
window.openReaderDetailModal = async function(readerId) {
  let reader = (SAMPLE_READERS || []).find(r => String(r.id) === String(readerId));
  if (!reader && window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient.from('readers').select('*').eq('id', readerId).single();
      if (data) reader = data;
    } catch(e) {}
  }
  if (!reader) {
    showToast('독자 회원 정보를 찾을 수 없습니다.');
    return;
  }

  const modal = document.getElementById('modalReaderDetail');
  if (!modal) return;

  const username = reader.username || `usr_${reader.id}`;
  const titleEl = document.getElementById('readerDetailModalTitle');
  if (titleEl) titleEl.textContent = `독자 회원 상세 정보 및 계정 관리 (${username})`;

  const elId = document.getElementById('readerDetailId');
  if (elId) elId.value = reader.id;
  const elDispId = document.getElementById('readerDetailDisplayId');
  if (elDispId) elDispId.value = reader.id;
  const elUser = document.getElementById('readerDetailUsername');
  if (elUser) elUser.value = username;
  const elNick = document.getElementById('readerDetailNickname');
  if (elNick) elNick.value = reader.nickname || '';
  const elMail = document.getElementById('readerDetailEmail');
  if (elMail) elMail.value = reader.email || '';
  const elPhone = document.getElementById('readerDetailPhone');
  if (elPhone) elPhone.value = reader.phone || '';
  const elCreated = document.getElementById('readerDetailCreatedAt');
  if (elCreated) elCreated.value = reader.created_at ? new Date(reader.created_at).toLocaleString() : '-';

  const subSelect = document.getElementById('readerDetailSubStatus');
  if (subSelect) subSelect.value = reader.subscription_status || '일반 회원';

  const adultSelect = document.getElementById('readerDetailAdultVerified');
  if (adultSelect) adultSelect.value = String(!!reader.is_adult_verified);

  const statusSelect = document.getElementById('readerDetailStatus');
  if (statusSelect) statusSelect.value = reader.status || 'ACTIVE';

  const pwInput = document.getElementById('readerDetailNewPassword');
  if (pwInput) pwInput.value = '';

  openModal('modalReaderDetail');
};

// ---- 독자 기본 인적정보 수정 저장 ----
window.handleSaveReaderInfo = function(event) {
  if (event) event.preventDefault();
  showToast('기존 독자 정보 수정은 종료되었습니다. 계정 지원 메뉴를 이용해 주세요.');
};

window.handleChangeReaderPassword = function(event) {
  if (event) event.preventDefault();
  showToast('관리자 비밀번호 직접 변경은 제공하지 않습니다. Auth 비밀번호 재설정을 안내해 주세요.');
};

window.handleDeleteReader = function() {
  showToast('기존 독자 계정 삭제는 종료되었습니다. 계정 지원 메뉴를 이용해 주세요.');
};

// Registered authors (legacy admin view)
function safeAdminInlineId(value) {
  const id = String(value ?? '');
  return /^(?:[1-9]\d{0,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id) ? id : '';
}
window.loadAdminAuthors = async function(forceRefresh = false) {
  const container = document.getElementById('adminCreatorsContainer') || document.getElementById('adminAuthorsContainer') || document.querySelector('#adminTab-creators .card') || document.querySelector('#adminTab-authors .card');
  if (!container) return;

  if (forceRefresh || SAMPLE_AUTHORS.length === 0) {
    if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.fetchAuthorsFromSupabase === 'function') {
      try {
        const dbAuthors = await window.WebNovelsAdmin.fetchAuthorsFromSupabase();
        if (Array.isArray(dbAuthors)) {
          SAMPLE_AUTHORS.length = 0;
          SAMPLE_AUTHORS.push(...dbAuthors);
        }
      } catch(err) {
        console.warn('[loadAdminAuthors] DB 로드 실패:', err);
      }
    }
  }

  if (typeof renderAuthorsAdminGrid === "function") renderAuthorsAdminGrid(); else renderCreatorsAdminGrid();
};

window.renderAuthorsAdminGrid = function() {
  const container = document.getElementById('adminCreatorsContainer') || document.getElementById('adminAuthorsContainer') || document.querySelector('#adminTab-creators .card') || document.querySelector('#adminTab-authors .card');
  if (!container) return;

  if (!SAMPLE_AUTHORS || SAMPLE_AUTHORS.length === 0) {
    container.innerHTML = `<p class="text-muted p-4 text-center">등록된 작가가 없습니다.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="grid-2-col gap-4">
      ${SAMPLE_AUTHORS.map(a => `
        <div class="p-4 glass-panel border-radius-md" style="border: 1px solid var(--border-color);">
          <div class="flex-between">
            <strong>${escapeHtml(a.pen_name || a.username)} (${escapeHtml(a.username || `writer_${a.id}`)})</strong>
            <span class="badge badge-primary">${escapeHtml(a.status || '공식 인증 작가')}</span>
          </div>
          <div class="text-muted small mt-2" style="line-height:1.6;">
            <div>📧 이메일: ${escapeHtml(a.email || '-')}</div>
            <div>📚 대표작: ${escapeHtml(a.work_title || '연재 준비중')}</div>
            <div>💳 정산계좌: ${escapeHtml(a.bank_info || '계좌 등록 완료')}</div>
          </div>
          <div class="mt-3" style="display:flex; justify-content:flex-end; gap:6px;">
            <button class="btn btn-outline btn-sm" onclick="showToast('작가 프로필 조회는 준비 중입니다.');">프로필</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
};

// ---- 서브 관리자 목록 로드 (순수 Supabase DB 실시간 조회) ----
window.loadSubAdminList = async function() {
  const container = document.getElementById('adminSubAdminContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="admin-loading-placeholder p-4 text-center">
      <div class="spinner mb-2"></div>
      <p class="text-muted">서브 관리자 목록 DB 조회 중...</p>
    </div>
  `;

  let subAdmins = [];
  try {
    if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.fetchSubAdmins === 'function') {
      subAdmins = await window.WebNovelsAdmin.fetchSubAdmins();
    } else if (window.supabaseClient) {
      const { data } = await window.supabaseClient
        .from('admin_users')
        .select('*')
        .eq('role', 'SUB_ADMIN')
        .order('created_at', { ascending: false });
      if (data) subAdmins = data;
    }
  } catch(e) {
    console.error('[Sub-Admin] 목록 로드 오류:', e);
  }

  if (!subAdmins || subAdmins.length === 0) {
    container.innerHTML = '<p class="text-muted p-4">등록된 서브 관리자가 없습니다. "신규 서브 관리자 생성" 버튼을 클릭하세요.</p>';
    return;
  }

  container.innerHTML = subAdmins.map(admin => {
    let perms = admin.permissions || [];
    if (typeof perms === 'string') {
      try { perms = JSON.parse(perms); } catch(e) { perms = []; }
    }
    const permsList = Array.isArray(perms) ? perms : [];

    return `
      <div class="card glass-panel p-4 mb-3" style="border: 1px solid var(--border-color); border-radius: 8px;">
        <div class="flex-between">
          <div>
            <strong style="font-size: 1.1rem; color: #fff;">${admin.nickname || admin.username} (${admin.username})</strong>
            <div class="text-muted small" style="margin-top: 4px;">Role: <span class="badge badge-primary">${admin.role}</span> | Email: ${admin.email}</div>
          </div>
          <div class="action-buttons-group" style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-sm" onclick="openEditPermsModal('${admin.id}', '${admin.nickname || admin.username}')">⚙️ 권한 수정</button>
            <button class="btn btn-ghost btn-sm" onclick="openChangePwModal('${admin.id}', '${admin.nickname || admin.username}')">🔑 PW 변경</button>
            <button class="btn btn-outline btn-sm style-danger" onclick="handleDeleteSubAdmin('${admin.id}', '${admin.nickname || admin.username}')">🗑️ 삭제</button>
          </div>
        </div>
        <hr class="divider" style="margin: 12px 0; border-color: rgba(255,255,255,0.1);">
        <small class="text-muted">부여된 접근 권한 (${permsList.length}/16):</small>
        <div class="perm-tags mt-2" style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${permsList.map(p => `<span class="badge badge-accent" style="font-size: 0.75rem;">${p}</span>`).join('')}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
};

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
// CMS: 작품 연재 관리 (Content Operations Platform 실시간 DB 연동)
// ----------------------------------------------------
adminWorkFilterState = {
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
      if (Array.isArray(dbWorks)) {
        worksList = dbWorks;
        SAMPLE_WORKS.length = 0;
        SAMPLE_WORKS.push(...dbWorks);
      }
    }
  } catch(error) {
    tableBody.innerHTML = '<tr><td colspan="8">작품 조회에 실패했습니다. 다시 시도해 주세요.</td></tr>';
    return;
  }

  // 1. 상태별 카운트 계산 및 상단 탭 업데이트
  updateWorkStatusPillCounts(worksList);

  // 2. 다차원 필터링 적용
  const filtered = worksList.filter(w => {
    // Status Filter
    if (adminWorkFilterState.status !== 'ALL') {
      const currentStatus = w.status || (w.isCompleted ? 'COMPLETED' : 'ONGOING');
      if (adminWorkFilterState.status === 'NEED_ACTION') {
        if (!['DELAYED', 'REVIEW', 'PENDING_REVIEW'].includes(currentStatus)) return false;
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
    const isTop = !!(w.isTopRecommended || w.is_top_recommended);
    const isPop = !!(w.isPopularWork || w.is_popular_work);

    // Status Badge & Selector
    const statusBadge = getStatusBadgeHtml(curStatus);
    const nextEpDate = curStatus === 'ONGOING' ? '08/23 20:00' : (curStatus === 'COMPLETED' ? '완결' : '-');

    // Issue / Action (work_management_2.md 1.2)
    let issueHtml = '<span class="text-muted">-</span>';
    if (curStatus === 'DELAYED') {
      issueHtml = `<span class="badge badge-warning" style="cursor:pointer;" onclick="showToast('작가에게 연재 독촉 알림이 발송되었습니다.')">⚠ 작가 알림</span>`;
    } else if (curStatus === 'PENDING_REVIEW') {
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
                <strong style="color: #fff; cursor: pointer;" onclick="openWorkSeriesDashboard(${w.id})">${escapeHtml(w.title)}</strong>
              </div>
              <div class="text-muted small">ID: ${w.id} · ${escapeHtml(w.genre)}</div>
            </div>
          </div>
        </td>
        <td style="padding: 10px 12px; color: var(--text-secondary); font-weight: 600;">${authorName}</td>
        <td style="padding: 10px 12px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${statusBadge}
          </div>
        </td>
        <td style="padding: 10px 12px; text-align: center;">
          <div style="display: flex; gap: 4px; justify-content: center; align-items: center;">
            <span class="badge badge-outline">추천 ${isTop ? 'ON' : 'OFF'}</span>
            <span class="badge badge-outline">인기 ${isPop ? 'ON' : 'OFF'}</span>
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

  // 상단 요약 카드 바 실시간 갱신
  const elWorkTotal = document.getElementById('workSummaryTotalCount');
  if (elWorkTotal) elWorkTotal.textContent = worksList.length;

  const ongoingCount = worksList.filter(w => {
    const s = w.status || (w.isCompleted ? 'COMPLETED' : 'ONGOING');
    return s === 'ONGOING';
  }).length;
  const elWorkOngoing = document.getElementById('workSummaryOngoingCount');
  if (elWorkOngoing) elWorkOngoing.textContent = ongoingCount;

  const actionCount = worksList.filter(w => {
    const s = w.status || (w.isCompleted ? 'COMPLETED' : 'ONGOING');
    return s === 'DELAYED' || s === 'PENDING_REVIEW';
  }).length;
  const elWorkAction = document.getElementById('workSummaryActionCount');
  if (elWorkAction) elWorkAction.textContent = actionCount;

  const completedCount = worksList.filter(w => {
    const s = w.status || (w.isCompleted ? 'COMPLETED' : 'ONGOING');
    return s === 'COMPLETED' || s === 'PAUSED';
  }).length;
  const elWorkCompleted = document.getElementById('workSummaryCompletedCount');
  if (elWorkCompleted) elWorkCompleted.textContent = completedCount;
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

window.toggleWorkCalendarView = function() {
  const panel = document.getElementById('adminWorkCalendarPanel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderAdminCalendar();
};

async function renderAdminCalendar(targetYear = new Date().getFullYear(), targetMonth = new Date().getMonth() + 1) {
  const grid = document.getElementById('adminCalendarGrid');
  if (!grid) return;

  grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-secondary);"><span class="spinner-border spinner-border-sm mr-2"></span>실시간 DB에서 연재 발행 일정을 집계하고 있습니다...</div>';

  let eventMap = {};
  try {
    if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.fetchPublishingCalendarEvents === 'function') {
      eventMap = await window.WebNovelsAdmin.fetchPublishingCalendarEvents(targetYear, targetMonth);
    }
  } catch (e) {
    console.warn('[renderAdminCalendar] DB 집계 실패:', e);
  }

  const daysOfWeek = ['일', '월', '화', '수', '목', '금', '토'];
  let html = daysOfWeek.map(d => `<div style="font-weight: 700; color: var(--text-secondary); padding: 4px 0;">${d}</div>`).join('');

  // 1일의 요일 인덱스 (0: 일요일 ~ 6: 토요일)
  const firstDayIndex = new Date(targetYear, targetMonth - 1, 1).getDay();
  for (let empty = 0; empty < firstDayIndex; empty++) {
    html += `<div></div>`;
  }

  // 해당 월의 총 일수 계산 (예: 8월 = 31일)
  const totalDays = new Date(targetYear, targetMonth, 0).getDate();
  const currentDay = new Date().getDate(); // 시스템 기준 오늘 (2026-08-22)

  for (let day = 1; day <= totalDays; day++) {
    const isToday = day === currentDay;
    const dayData = eventMap[day] || { published: 0, scheduled: 0, total: 0 };

    let badgeHtml = '';
    if (dayData.total > 0) {
      if (isToday) {
        badgeHtml = `<span class="badge badge-primary" style="font-size:0.65rem;">오늘 ${dayData.total}개</span>`;
      } else if (dayData.scheduled > 0) {
        badgeHtml = `<span class="badge badge-warning" style="font-size:0.65rem;">예약 ${dayData.scheduled}개</span>`;
      } else {
        badgeHtml = `<span class="badge badge-accent" style="font-size:0.65rem;">${dayData.published}개 완료</span>`;
      }
    }

    const clickAction = dayData.total > 0
      ? `showToast('${targetMonth}월 ${day}일: 총 ${dayData.total}개 회차 발행 (완료 ${dayData.published}화 / 예약 ${dayData.scheduled}화)')`
      : `showToast('${targetMonth}월 ${day}일에는 등록된 발행 일정이 없습니다.')`;

    html += `
      <div class="calendar-day-cell ${isToday ? 'today' : ''}" style="cursor: pointer;" onclick="${clickAction}">
        <div style="font-weight: ${isToday ? '800' : '500'}; color: ${isToday ? 'var(--color-brand-secondary)' : '#fff'};">${day}</div>
        ${badgeHtml}
      </div>
    `;
  }

  grid.innerHTML = html;
}
window.renderAdminCalendar = renderAdminCalendar;

// ----------------------------------------------------
// 작품 상세 연재 Dashboard 모달 (Series Dashboard)
// ----------------------------------------------------
window.openWorkSeriesDashboard = async function(workId) {
  const titleEl = document.getElementById('dashWorkHeaderTitle');
  const bodyEl = document.getElementById('dashWorkModalBody');
  if (!bodyEl) return;

  // 1. 모달 열기 및 로딩 스피너 표출
  if (titleEl) titleEl.innerHTML = `<i data-lucide="layout-dashboard" class="icon-indigo"></i> 연재 상황 관제 Dashboard 로딩 중...`;
  bodyEl.innerHTML = `
    <div style="padding: 48px; text-align: center; color: var(--text-secondary);">
      <span class="spinner-border spinner-border-sm mr-2"></span>실시간 DB에서 작품 연재 현황 및 독자 지표를 분석 중입니다...
    </div>
  `;
  openModal('modalWorkSeriesDashboard');

  let dashData = null;
  try {
    if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.fetchWorkSeriesDashboardData === 'function') {
      dashData = await window.WebNovelsAdmin.fetchWorkSeriesDashboardData(workId);
    }
  } catch (e) {
    console.warn('[openWorkSeriesDashboard] DB 로드 실패, Fallback 적용:', e);
  }

  // Fallback 처리
  const fallbackWork = (typeof SAMPLE_WORKS !== 'undefined') ? SAMPLE_WORKS.find(w => w.id == workId) : null;
  const work = dashData?.work || fallbackWork;
  if (!work) {
    bodyEl.innerHTML = `<div class="p-4 text-center text-muted">작품 정보를 불러올 수 없습니다.</div>`;
    return;
  }

  const title = work.title || '무제';
  if (titleEl) titleEl.innerHTML = `<i data-lucide="layout-dashboard" class="icon-indigo"></i> [${title}] 연재 상황 관제 Dashboard`;

  const authorName = (typeof work.author === 'object' ? work.author?.penName : work.author) || '작자미상';
  const coverUrl = work.coverUrl || work.cover_image || '/images/stormqueen_oath.jpg';
  const contentType = work.contentType || work.content_type;
  const platformLabel = contentType === 'WEBTOON' ? '웹툰' : '웹소설';
  const genreLabel = Array.isArray(work.genre) ? work.genre.join(', ') : (work.genre || '판타지');
  const statusBadgeHtml = getStatusBadgeHtml(work.status || 'ONGOING');

  const epCount = dashData ? dashData.epCount : (work.episodes?.length || 1);
  const viewTotal = (dashData ? dashData.viewTotal : (work.viewCount || 0)).toLocaleString();
  const fansCount = (dashData ? dashData.fansCount : (work.likeCount || 0)).toLocaleString();
  const revenueStr = (dashData ? dashData.totalRevenue : 0).toLocaleString();

  const healthScore = dashData ? dashData.healthScore : 85;
  const scoreSchedule = dashData ? dashData.scoreSchedule : 90;
  const scoreTraffic = dashData ? dashData.scoreTraffic : 80;
  const scoreRetention = dashData ? dashData.scoreRetention : 85;
  const scoreStock = dashData ? dashData.scoreStock : 80;

  const healthGrade = healthScore >= 85 ? '우수 🟢' : (healthScore >= 70 ? '보통 🟡' : '주의 🔴');
  const latestPub = dashData?.latestPubText || `${epCount}화 정상 완료`;
  const nextPub = dashData?.nextPubText || `제 ${epCount + 1}화 연재 준비중`;

  bodyEl.innerHTML = `
    <!-- 1. 작품 기본 정보 헤더 -->
    <div style="display: flex; gap: 16px; align-items: center; padding-bottom: 16px; border-bottom: 1px solid var(--border-color);">
      <img src="${coverUrl}" style="width: 64px; height: 88px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color);">
      <div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0; font-size: 1.25rem;">${title}</h3>
          ${statusBadgeHtml}
        </div>
        <div class="text-muted small mt-1">
          작가: <strong>${authorName}</strong> | 장르: ${escapeHtml(genreLabel)} | 플랫폼: ${platformLabel} | 상태: ${work.status || 'ONGOING'}
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

    <!-- 2. 핵심 4대 KPI 카드 (실시간 DB 연동) -->
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
        <div style="font-size: 1.3rem; font-weight: 800; color: #fff; margin-top: 4px;">${fansCount}명</div>
      </div>
      <div class="card glass-panel p-3 text-center" style="border-radius: 6px;">
        <div class="text-muted small">누적 정산 수익</div>
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--accent-emerald); margin-top: 4px;">₩${revenueStr}</div>
      </div>
    </div>

    <!-- 3. 연재 건강도 지표 (동적 산출) -->
    <div class="card glass-panel p-4 mb-3" style="border-radius: 8px;">
      <div class="flex-between mb-2">
        <strong style="display: flex; align-items: center; gap: 6px;">
          <i data-lucide="activity" class="icon-indigo"></i> 연재 건강도 (Series Health Score)
        </strong>
        <span class="badge badge-accent" style="font-size: 0.85rem; font-weight: 800;">${healthScore}점 (${healthGrade})</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; margin-top: 10px;">
        <div>
          <div class="flex-between text-muted mb-1"><span>연재 일정 준수율</span><span>${scoreSchedule}점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: ${scoreSchedule}%;"></div></div>
        </div>
        <div>
          <div class="flex-between text-muted mb-1"><span>최근 조회수 및 독자 유입도</span><span>${scoreTraffic}점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: ${scoreTraffic}%;"></div></div>
        </div>
        <div>
          <div class="flex-between text-muted mb-1"><span>독자 완독률 &amp; 호응도</span><span>${scoreRetention}점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: ${scoreRetention}%;"></div></div>
        </div>
        <div>
          <div class="flex-between text-muted mb-1"><span>비축 회차 사전 확보량</span><span>${scoreStock}점</span></div>
          <div class="health-meter-bar"><div class="health-meter-fill" style="width: ${scoreStock}%;"></div></div>
        </div>
      </div>
    </div>

    <!-- 4. 연재 일정 현황 (실데이터) -->
    <div class="card glass-panel p-3" style="border-radius: 8px; font-size: 0.85rem;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div>
          <span class="text-muted">최근 발행:</span> <strong>${latestPub}</strong>
        </div>
        <div>
          <span class="text-muted">다음 발행 예정:</span> <strong style="color: var(--color-brand-secondary);">${nextPub}</strong>
        </div>
      </div>
    </div>
  `;

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
    return `<option value="${w.id}">${typeLabel} ${escapeHtml(w.title)} (ID: ${w.id})</option>`;
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

// ============================================================
// [Function] loadAdminEpisodeSummaryBar
// [Purpose] Supabase DB 실시간 통계로 회차 관리 상단 4대 요약 바 및 Action Panel 동적 렌더링
// ============================================================
window.loadAdminEpisodeSummaryBar = async function() {
  try {
    let total = 0;
    let published = 0;
    let scheduled = 0;

    // 1. Supabase 실시간 회차 집계
    if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.fetchEpisodeSummaryStats === 'function') {
      const stats = await window.WebNovelsAdmin.fetchEpisodeSummaryStats();
      if (stats) {
        total = stats.total;
        published = stats.published;
        scheduled = stats.scheduled;
      }
    } else if (window.supabaseClient) {
      const [allRes, pubRes, schedRes] = await Promise.all([
        window.supabaseClient.from('episodes').select('*', { count: 'exact', head: true }),
        window.supabaseClient.from('episodes').select('*', { count: 'exact', head: true }).or('status.eq.PUBLISHED,status.is.null'),
        window.supabaseClient.from('episodes').select('*', { count: 'exact', head: true }).eq('status', 'SCHEDULED')
      ]);
      total = allRes.count ?? 0;
      published = pubRes.count ?? 0;
      scheduled = schedRes.count ?? 0;
    } else if (typeof SAMPLE_WORKS !== 'undefined') {
      SAMPLE_WORKS.forEach(w => {
        const eps = w.episodes || [];
        total += eps.length;
        published += eps.filter(e => e.status !== 'SCHEDULED').length;
        scheduled += eps.filter(e => e.status === 'SCHEDULED').length;
      });
    }

    // 회차 요약 바 DOM 바인딩
    const elTotal = document.getElementById('epSummaryTotal');
    const elScheduled = document.getElementById('epSummaryScheduled');
    const elPublished = document.getElementById('epSummaryPublished');
    if (elTotal) elTotal.textContent = Number(total).toLocaleString();
    if (elScheduled) elScheduled.textContent = Number(scheduled).toLocaleString();
    if (elPublished) elPublished.textContent = Number(published).toLocaleString();

  } catch (err) {
    console.warn('[loadAdminEpisodeSummaryBar Error]', err);
  }
};

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

  if (targetWork && Array.isArray(episodes)) targetWork.episodes = episodes;

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
    const epStatus = ep.status || 'PUBLISHED';
    let statusBadge = `<span class="badge badge-status-ongoing">공개중</span>`;
    if (epStatus === 'SCHEDULED') {
      statusBadge = `<span class="badge badge-status-scheduled">예약중</span>`;
    } else if (epStatus === 'DRAFT') {
      statusBadge = `<span class="badge badge-outline">임시저장</span>`;
    }

    // 실제 DB의 scheduled_at 또는 created_at 기반 공개일시
    let pubDate = '-';
    const dateVal = ep.scheduledAt || ep.scheduled_at || ep.createdAt || ep.created_at;
    if (dateVal) {
      try {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const h = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          pubDate = `${y}-${m}-${day} ${h}:${min}`;
        }
      } catch (e) {
        pubDate = String(dateVal).substring(0, 16);
      }
    }

    // 실제 DB의 view_count 컬럼 바인딩 (임의 곱셈 epNum * 3420 완전 제거)
    const rawViews = ep.viewCount !== undefined ? ep.viewCount : (ep.view_count !== undefined ? ep.view_count : (ep.views !== undefined ? ep.views : 0));
    const views = Number(rawViews).toLocaleString();

    return `
      <tr class="ep-table-row" style="border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s ease;">
        <td style="padding: 10px 12px; text-align: center;">
          <input type="checkbox" class="ep-item-cb" value="${ep.id || epNum}" onchange="updateSelectedEpisodesCount()">
        </td>
        <td style="padding: 10px 12px; font-weight: 800; color: var(--color-brand-secondary);">#${epNum}</td>
        <td style="padding: 10px 12px;">
          <strong style="color: #fff;">${ep.title}</strong>
          ${ep.imageUrls && ep.imageUrls.length > 0 ? `<span class="badge badge-outline" style="font-size:0.7rem; margin-left: 6px;"><i data-lucide="image"></i> 웹툰 ${ep.imageUrls.length}컷</span>` : ''}
        </td>
        <td style="padding: 10px 12px;">${statusBadge}</td>
        <td style="padding: 10px 12px;">${badgeFreeHtml}</td>
        <td style="padding: 10px 12px; font-size: 0.8rem; color: var(--text-secondary);">${pubDate}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #fff;">${views}</td>
        <td style="padding: 10px 12px; text-align: center;">
          <span class="text-muted small">조회 전용</span>
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
          <span class="tag ${tagClass}">${escapeHtml(tagText)}</span>
          <h3>${escapeHtml(w.title)}</h3>
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
      <img src="${work.coverUrl}" alt="${escapeHtml(work.title)} 표지">
      <span>
        <strong>${escapeHtml(work.title)}</strong>
        <small>${work.author} · ${escapeHtml(isAdult ? '19+ 성인' : work.genre)} · 조회 ${(work.viewCount / 1000).toFixed(1)}K</small>
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



// --- 2. 이전 관리자 화면의 기본 운영 지표와 메뉴 ---

// 신규 서브 관리자 생성 (Supabase 연동)
window.handleCreateSubAdminSubmit = async function() {
  const newId = document.getElementById('newSubAdminId')?.value.trim();
  const newPw = document.getElementById('newSubAdminPw')?.value.trim();
  const newName = document.getElementById('newSubAdminName')?.value.trim();
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
    // 입력창 초기화
    if (document.getElementById('newSubAdminId')) document.getElementById('newSubAdminId').value = '';
    if (document.getElementById('newSubAdminPw')) document.getElementById('newSubAdminPw').value = '';
    if (document.getElementById('newSubAdminName')) document.getElementById('newSubAdminName').value = '';
  } else {
    showToast(`❌ 서브 관리자 생성 실패: ${result?.error || 'DB 저장 실패'}`);
    return;
  }

  closeAllModals();
  await window.loadSubAdminList();
  if (typeof window.loadDashboardKPIs === 'function') {
    window.loadDashboardKPIs();
  }
};

// 서브 관리자 삭제
window.handleDeleteSubAdmin = async function(id, nickname) {
  if (!confirm(`서브 관리자 "${nickname}"을 삭제하시겠습니까?`)) return;

  const result = window.WebNovelsAdmin ? await window.WebNovelsAdmin.deleteSubAdmin(id) : null;
  showToast(result?.success ? `🗑️ 서브 관리자 "${nickname}" 삭제 완료` : '삭제 처리되었습니다.');
  await window.loadSubAdminList();
  if (typeof window.loadDashboardKPIs === 'function') {
    window.loadDashboardKPIs();
  }
};

// 권한 수정 모달 열기 (DB 실시간 동기화)
window.openEditPermsModal = async function(id, nickname) {
  window._editingSubAdminId = id;
  const modal = document.getElementById('modalEditSubAdminPerms');
  if (!modal) return;

  const titleEl = document.getElementById('modalEditSubAdminTitle') || modal.querySelector('h3');
  if (titleEl) {
    titleEl.textContent = `⚙️ 서브 관리자 권한 수정 (${nickname})`;
  }

  // 체크박스 초기화 (조회 전까지 임시 비활성화)
  const checkboxes = modal.querySelectorAll('input[name="subAdminPerm"]');
  checkboxes.forEach(cb => { cb.checked = false; cb.disabled = true; });

  openModal('modalEditSubAdminPerms');

  // Supabase DB에서 해당 서브 관리자의 실제 permissions 배열 조회
  let permissions = [];
  try {
    if (window.supabaseClient) {
      const { data, error } = await window.supabaseClient
        .from('admin_users')
        .select('permissions')
        .eq('id', id)
        .single();
      if (!error && data && Array.isArray(data.permissions)) {
        permissions = data.permissions;
      }
    } else if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.fetchSubAdmins === 'function') {
      const subAdmins = await window.WebNovelsAdmin.fetchSubAdmins();
      const target = (subAdmins || []).find(a => String(a.id) === String(id));
      if (target && Array.isArray(target.permissions)) {
        permissions = target.permissions;
      }
    }
  } catch (err) {
    console.warn('[openEditPermsModal] DB 권한 조회 에러:', err);
  }

  // 체크박스 동적 바인딩 및 활성화
  const permSet = new Set(permissions);
  // SETTLEMENT 와 AUTHOR_SETTLEMENT 상호 호환 지원
  if (permSet.has('SETTLEMENT')) permSet.add('AUTHOR_SETTLEMENT');
  if (permSet.has('AUTHOR_SETTLEMENT')) permSet.add('SETTLEMENT');

  checkboxes.forEach(cb => {
    cb.disabled = false;
    cb.checked = permSet.has(cb.value);
  });
};

// 권한 전체 선택 / 전체 해제 헬퍼
window.toggleAllSubAdminPerms = function(checked) {
  const modal = document.getElementById('modalEditSubAdminPerms');
  if (!modal) return;
  const checkboxes = modal.querySelectorAll('input[name="subAdminPerm"]');
  checkboxes.forEach(cb => { cb.checked = !!checked; });
};

// 권한 수정 사항 DB 저장 핸들러
window.handleSaveSubAdminPerms = async function(event) {
  if (event) event.preventDefault();
  const subAdminId = window._editingSubAdminId;
  if (!subAdminId) {
    showToast('선택된 서브 관리자가 없습니다.');
    return;
  }

  const modal = document.getElementById('modalEditSubAdminPerms');
  if (!modal) return;

  const checkboxes = modal.querySelectorAll('input[name="subAdminPerm"]:checked');
  const selectedPerms = Array.from(checkboxes).map(cb => cb.value);

  const saveBtn = document.getElementById('btnSaveSubAdminPerms');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
  }

  try {
    let success = false;
    if (window.WebNovelsAdmin && typeof window.WebNovelsAdmin.updateSubAdminPermissions === 'function') {
      const res = await window.WebNovelsAdmin.updateSubAdminPermissions(subAdminId, selectedPerms);
      success = !!res?.success;
    } else if (window.supabaseClient) {
      const { error } = await window.supabaseClient
        .from('admin_users')
        .update({ permissions: selectedPerms })
        .eq('id', subAdminId);
      success = !error;
    }

    if (success) {
      showToast(`⚙️ 서브 관리자 권한(${selectedPerms.length}개)이 DB에 성공적으로 저장되었습니다.`);
      closeAllModals();
      if (typeof window.loadSubAdminList === 'function') {
        await window.loadSubAdminList();
      }
      if (typeof window.loadDashboardKPIs === 'function') {
        window.loadDashboardKPIs();
      }
    } else {
      showToast('❌ 권한 저장 실패. 잠시 후 다시 시도해주세요.');
    }
  } catch (err) {
    console.error('[handleSaveSubAdminPerms Error]', err);
    showToast('❌ 권한 저장 중 오류 발생: ' + err.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '권한 변경 사항 DB 저장';
    }
  }
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

// 시스템 설정 저장
window.handleSaveSystemConfig = async function() {
  const config = {
    toss_client_key: document.getElementById('cfgTossClientKey')?.value,
    toss_secret_key: document.getElementById('cfgTossSecretKey')?.value,
    kcp_site_code: document.getElementById('cfgKcpSiteCode')?.value,
    toss_mode: document.getElementById('cfgTossMode')?.value
  };
  const result = window.WebNovelsAdmin ? await window.WebNovelsAdmin.updateSystemConfig?.(config) : null;
  showToast(result?.success ? '⚙️ PG/PASS 설정이 Supabase에 저장되었습니다!' : '설정 저장에 실패했습니다.');
};

// PG 핑 테스트
window.handlePgPingTest = function() {
  showToast('외부 결제·본인인증 연결 검증이 구현되지 않았습니다.');
};

// ============================================================
// Admin Dashboard KPIs Loader (실시간 DB 연동 통계)
// ----------------------------------------------------
window.loadDashboardKPIs = async function() {
  const fields = {
    kpiTotalUsers: 'total_users',
    kpiTotalAuthors: 'total_authors',
    kpiTotalWorks: 'total_works',
    kpiTotalEpisodes: 'total_episodes'
  };
  let stats = null;
  try {
    stats = await window.WebNovelsAdmin?.fetchDashboardKPI?.();
  } catch (err) {
    console.warn('[Dashboard KPIs] load failed:', err);
  }
  for (const [id, key] of Object.entries(fields)) {
    const element = document.getElementById(id);
    if (element) element.textContent = Number.isInteger(stats?.[key])
      ? stats[key].toLocaleString() : '-';
  }
};

// ----------------------------------------------------
// Admin Sub-Tab Switcher (Left Sidebar Navigation)
// ----------------------------------------------------
window.switchAdminSubTab = function(tabName, shouldPushState = true) {
  if (tabName === 'actionqueue') {
    showToast('운영 처리함은 9단계 활성화 후 제공됩니다.');
    tabName = 'dashboard';
    shouldPushState = true;
  }
  if (['admgmt', 'revenue', 'settlements', 'fanmeeting', 'goods', 'events', 'analytics'].includes(tabName)) {
    showToast('해당 사업 기능은 현재 제공되지 않습니다.');
    tabName = 'dashboard';
    shouldPushState = true;
  }
  const adminUser = window.WebNovelsAdmin?.getCurrentAdmin?.() || JSON.parse(localStorage.getItem('webnovels_admin_user') || localStorage.getItem('webnovels_user') || 'null');

  // RBAC 권한 매핑
  const permMap = {
    'dashboard': 'DASHBOARD',
    'users': 'USER_MGMT',
    'creators': 'CREATOR_MGMT',
    'authors': 'CREATOR_MGMT',
    'works': 'WORK_MGMT',
    'episodes': 'EPISODE_MGMT',
    'comments': 'COMMENT_REPORT',
    'subadmins': 'SYSTEM_MGMT',
    'security': 'SECURITY_MGMT'
  };

  const requiredPerm = permMap[tabName] || 'DASHBOARD';

  // SUPER_ADMIN은 전체 허용, SUB_ADMIN은 권한 검사
  if (adminUser && adminUser.role === 'SUB_ADMIN') {
    const userPerms = Array.isArray(adminUser.permissions) ? adminUser.permissions : [];
    if (!userPerms.includes(requiredPerm) && requiredPerm !== 'DASHBOARD') {
      showToast(`🚫 [접근 제한] 해당 메뉴(${tabName})에 대한 서브관리자 권한이 없습니다.`);
      return;
    }
  }

  // 1. 모든 서브탭 숨김 & 대상 서브탭 표시
  document.querySelectorAll('.admin-subtab').forEach(t => {
    t.style.display = 'none';
    t.classList.remove('active');
  });

  const target = document.getElementById(`adminTab-${tabName}`);
  if (target) {
    target.style.display = 'block';
    target.classList.add('active');
  }

  // 2. 사이드바 버튼 active 갱신
  document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subtab === tabName);
  });

  if (shouldPushState) {
    const targetUrl = tabName === 'dashboard' ? '/admin' : `/admin/${tabName}`;
    if (window.location.pathname !== targetUrl) {
      try { window.history.pushState({ path: targetUrl }, '', targetUrl); } catch (e) {}
    }
  }

  // 3. 모바일 화면(<=768px)인 경우 탭 클릭 시 메인 컨텐츠로 스크롤
  if (window.innerWidth <= 768) {
    const mainContent = document.querySelector('.admin-main-content');
    if (mainContent) {
      mainContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // 4. Re-render Lucide icons
  if (window.lucide) window.lucide.createIcons();

  // 5. 메뉴별 데이터 로더 실행
  if (tabName === 'dashboard') {
    if (typeof loadDashboardKPIs === 'function') loadDashboardKPIs();
  } else if (tabName === 'users') {
    if (typeof loadAdminUsers === 'function') loadAdminUsers();
  } else if (tabName === 'authors' || tabName === 'creators') {
    if (typeof loadAdminAuthors === 'function') loadAdminAuthors();
    else if (typeof loadAdminCreators === 'function') loadAdminCreators();
  } else if (tabName === 'works') {
    if (typeof renderAdminWorks === 'function') renderAdminWorks();
  } else if (tabName === 'episodes') {
    if (typeof loadAdminEpisodeSummaryBar === 'function') loadAdminEpisodeSummaryBar();
    if (typeof populateAdminWorkSelects === 'function') populateAdminWorkSelects(SAMPLE_WORKS);
    const sel = document.getElementById('adminEpisodeWorkSelect');
    if (sel && sel.value) {
      if (typeof renderAdminEpisodes === 'function') renderAdminEpisodes(sel.value);
    } else if (typeof SAMPLE_WORKS !== 'undefined' && SAMPLE_WORKS[0]) {
      if (typeof renderAdminEpisodes === 'function') renderAdminEpisodes(SAMPLE_WORKS[0].id);
    }
  } else if (tabName === 'review') {
    if (typeof loadAdminContentReviews === 'function') loadAdminContentReviews();
  } else if (tabName === 'comments') {
    if (typeof loadAdminReports === 'function') loadAdminReports();
  } else if (tabName === 'subadmins') {
    if (typeof window.loadSubAdminList === 'function') {
      window.loadSubAdminList();
    } else if (typeof loadSubAdminList === 'function') {
      loadSubAdminList();
    }
  } else if (tabName === 'security') {
    if (typeof loadSystemConfig === 'function') loadSystemConfig();
    if (typeof loadAdminAuditLogs === 'function') loadAdminAuditLogs();
  }
};

// ============================================================
// [Legacy Dynamic Renderers] Content Reviews, Reports, Audit Logs
// ============================================================

// 1. Content Review (심사 대기열 동적 렌더링)
window.loadAdminContentReviews = async function(isManualRefresh = false) {
  const container = document.getElementById('adminReviewListContainer');
  if (!container) return;
  container.innerHTML = '<div class="text-center p-4 text-muted small"><span class="spinner-border spinner-border-sm mr-2"></span>실시간 심사 목록 로딩 중...</div>';

  try {
    const reviews = window.WebNovelsAdmin?.fetchContentReviewsFromDB ? await window.WebNovelsAdmin.fetchContentReviewsFromDB() : [];
    if (!reviews || reviews.length === 0) {
      container.innerHTML = '<div class="text-center p-6 text-muted">현재 대기 중인 콘텐츠 심사 항목이 없습니다.</div>';
      return;
    }

    container.innerHTML = reviews.map(r => {
      const isPending = r.status === 'PENDING';
      const reviewId = safeAdminInlineId(r.id);
      const statusBadge = isPending 
        ? '<span class="badge badge-warning">심사 대기중</span>' 
        : (r.status === 'APPROVED' ? '<span class="badge badge-success">승인 완료</span>' : '<span class="badge badge-danger">반려됨</span>');
      const timeStr = r.created_at ? new Date(r.created_at).toLocaleDateString() : '최근';

      return `
        <div class="episode-row mb-3 p-3 glass-panel flex-between" style="border-radius: 8px; background: rgba(255,255,255,0.02);">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong>[연재 심사] ${escapeHtml(r.work_title || '작품명 미정')}</strong>
              ${statusBadge}
            </div>
            <div class="text-muted small mt-1">
              신청 작가: ${escapeHtml(r.author_name || '작가')} | 신청일: ${escapeHtml(timeStr)}
              ${r.reviewer_name ? ` | 심사자: ${escapeHtml(r.reviewer_name)}` : ''}
              ${r.reject_reason ? ` | 사유: <span style="color:var(--accent-rose);">${escapeHtml(r.reject_reason)}</span>` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            ${isPending && reviewId ? `
              <button class="btn btn-success btn-sm" onclick="handleReviewAction('${reviewId}', 'APPROVED')">승인</button>
              <button class="btn btn-outline btn-sm style-danger" onclick="handleReviewAction('${reviewId}', 'REJECTED')">반려</button>
            ` : `
              <span class="text-muted small" style="align-self:center;">조치 완료</span>
            `}
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
    if (isManualRefresh) showToast('콘텐츠 심사 대기열을 실시간 동기화했습니다.');
  } catch (e) {
    console.warn('[loadAdminContentReviews Error]', e);
    container.innerHTML = '<div class="text-center p-4 text-muted small">심사 목록을 불러오지 못했습니다.</div>';
  }
};

window.handleReviewAction = async function(reviewId, status, workTitle = '작품') {
  let rejectReason = null;
  if (status === 'REJECTED') {
    rejectReason = prompt(`[${workTitle}] 반려 사유를 입력해주세요:`, '연재 기준 규격 미충족');
    if (!rejectReason) return;
  } else {
    if (!confirm(`[${workTitle}] 작품 연재를 공식 승인하시겠습니까?`)) return;
  }

  if (window.WebNovelsAdmin?.updateContentReviewInDB) {
    const res = await window.WebNovelsAdmin.updateContentReviewInDB(reviewId, status, rejectReason);
    if (res.success) {
      showToast(status === 'APPROVED' ? `🎉 [${workTitle}] 작품 연재가 승인되었습니다.` : `⚠️ [${workTitle}] 작품 연재가 반려되었습니다.`);
      if (window.WebNovelsAdmin?.recordAuditLogInDB) {
        window.WebNovelsAdmin.recordAuditLogInDB('CONTENT_REVIEW_' + status, 'CONTENT_REVIEW', reviewId, { workTitle, status });
      }
      loadAdminContentReviews(false);
    } else {
      showToast(`❌ 심사 처리 실패: ${res.error || '오류 발생'}`);
    }
  }
};

// 2. Comment & Work Reports (신고 관제 센터 동적 렌더링)
window.loadAdminReports = async function(isManualRefresh = false) {
  const container = document.getElementById('adminReportsListContainer');
  if (!container) return;
  container.innerHTML = '<div class="text-center p-4 text-muted small"><span class="spinner-border spinner-border-sm mr-2"></span>실시간 신고 목록 로딩 중...</div>';

  try {
    const reports = window.WebNovelsAdmin?.fetchReportsFromDB ? await window.WebNovelsAdmin.fetchReportsFromDB() : [];
    if (!reports || reports.length === 0) {
      container.innerHTML = '<div class="text-center p-6 text-muted">현재 접수된 미처리 신고 내역이 없습니다. (클린 커뮤니티 유지중)</div>';
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table style="width:100%; font-size:0.85rem; text-align:left; border-collapse:collapse;">
          <thead>
            <tr style="color:var(--text-muted); border-bottom:1px solid rgba(255,255,255,0.08);">
              <th class="p-2">유형</th>
              <th class="p-2">신고 사유</th>
              <th class="p-2">신고자</th>
              <th class="p-2">접수일</th>
              <th class="p-2">상태</th>
              <th class="p-2" style="text-align:right;">조치</th>
            </tr>
          </thead>
          <tbody>
            ${reports.map(rep => {
              const isPending = rep.status === 'PENDING';
              const reportId = safeAdminInlineId(rep.id);
              const statusBadge = isPending 
                ? '<span class="badge badge-warning">접수 대기</span>' 
                : `<span class="badge badge-primary">${escapeHtml(rep.resolved_action || '조치완료')}</span>`;
              const typeBadge = rep.target_type === 'COMMENT' 
                ? '<span class="badge badge-outline">댓글</span>' 
                : '<span class="badge badge-accent">작품</span>';
              const timeStr = rep.created_at ? new Date(rep.created_at).toLocaleDateString() : '-';

              return `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                  <td class="p-2">${typeBadge}</td>
                  <td class="p-2">
                    <strong style="color:#fff;">${escapeHtml(rep.reason || '신고 접수')}</strong>
                    <div class="text-muted small">대상 ID: ${escapeHtml(rep.target_id || '-')}</div>
                  </td>
                  <td class="p-2 text-muted">${escapeHtml(rep.reporter_id || '익명')}</td>
                  <td class="p-2 text-muted">${escapeHtml(timeStr)}</td>
                  <td class="p-2">${statusBadge}</td>
                  <td class="p-2" style="text-align:right;">
                    ${isPending && reportId ? `
                      <button class="btn btn-outline btn-sm style-danger" onclick="handleReportAction('${reportId}', '블라인드 처리')" style="font-size:0.75rem; padding:3px 8px;">블라인드</button>
                      <button class="btn btn-ghost btn-sm" onclick="handleReportAction('${reportId}', '기각 처리')" style="font-size:0.75rem; padding:3px 8px;">기각</button>
                    ` : `
                      <span class="text-muted small">완결</span>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    if (isManualRefresh) showToast('유저 신고 내역을 실시간 동기화했습니다.');
  } catch (e) {
    console.warn('[loadAdminReports Error]', e);
    container.innerHTML = '<div class="text-center p-4 text-muted small">신고 목록을 불러오지 못했습니다.</div>';
  }
};

window.handleReportAction = async function(reportId, action) {
  if (!confirm(`해당 신고 건에 대해 '${action}' 조치를 적용하시겠습니까?`)) return;

  if (window.WebNovelsAdmin?.resolveReportInDB) {
    const res = await window.WebNovelsAdmin.resolveReportInDB(reportId, action);
    if (res.success) {
      showToast(`🛡️ 신고 건에 대해 '${action}' 조치가 완료되었습니다.`);
      if (window.WebNovelsAdmin?.recordAuditLogInDB) {
        window.WebNovelsAdmin.recordAuditLogInDB('REPORT_RESOLVE', 'REPORT', reportId, { action });
      }
      loadAdminReports(false);
    } else {
      showToast(`❌ 신고 조치 실패: ${res.error || '오류 발생'}`);
    }
  }
};

// 3. Security Audit Logs (보안 감사 로그 동적 렌더링)
window.loadAdminAuditLogs = async function() {
  const tbody = document.getElementById('securityAuditLogBody');
  if (!tbody) return;

  try {
    const logs = window.WebNovelsAdmin?.fetchAuditLogsFromDB ? await window.WebNovelsAdmin.fetchAuditLogsFromDB() : [];
    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-muted">기록된 보안 감사 로그가 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const timeStr = l.created_at ? new Date(l.created_at).toLocaleString() : '-';
      const actionMap = {
        'ADMIN_LOGIN': '관리자 로그인',
        'APPROVE_SETTLEMENT': '정산금 승인 처리',
        'REVIEW_APPROVE': '콘텐츠 검수 승인',
        'CONTENT_REVIEW_APPROVED': '콘텐츠 심사 승인',
        'CONTENT_REVIEW_REJECTED': '콘텐츠 심사 반려',
        'REPORT_RESOLVE': '신고 제재 조치'
      };
      const actionLabel = actionMap[l.action] || l.action || '시스템 작업';

      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
          <td class="p-2 text-muted">${escapeHtml(timeStr)}</td>
          <td class="p-2 text-white">${escapeHtml(l.admin_id ? String(l.admin_id).slice(0, 8) : 'admin')}</td>
          <td class="p-2">${escapeHtml(actionLabel)}</td>
          <td class="p-2 text-muted">${escapeHtml(l.ip_address || '-')}</td>
          <td class="p-2"><span class="badge badge-primary">성공</span></td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.warn('[loadAdminAuditLogs Error]', e);
  }
};

// [Global Window Namespace Exports for Admin]
// ============================================================
if (typeof window !== 'undefined') {
  window.handleAdminLoginProcess = handleAdminLoginProcess;
  window.handleAdminLogoutProcess = handleAdminLogoutProcess;
  window.switchAdminSubTab = switchAdminSubTab;
  window.loadDashboardKPIs = loadDashboardKPIs;
  window.toggleWorkCalendarView = toggleWorkCalendarView;
  window.openWorkSeriesDashboard = openWorkSeriesDashboard;
  window.handleCreateSubAdminSubmit = handleCreateSubAdminSubmit;
  window.loadAdminDashboard = typeof loadAdminDashboard !== 'undefined' ? loadAdminDashboard : undefined;
  window.loadAdminContentReviews = loadAdminContentReviews;
  window.handleReviewAction = handleReviewAction;
  window.loadAdminReports = loadAdminReports;
  window.handleReportAction = handleReportAction;
  window.loadAdminAuditLogs = loadAdminAuditLogs;
  window.loadAdminEpisodeSummaryBar = loadAdminEpisodeSummaryBar;
  window.renderAdminCalendar = renderAdminCalendar;
}


// ============================================================
// [Creator/Author Compatibility Bridge]
// ============================================================
window.loadAdminCreators = window.loadAdminAuthors;
window.renderCreatorsAdminGrid = window.renderAuthorsAdminGrid;
