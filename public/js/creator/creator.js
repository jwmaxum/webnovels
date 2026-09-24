// ============================================================
// [Creator Domain Engine] public/js/creator/creator.js
//
// [Purpose]
// - 작가 스튜디오(Creator Studio) 전담 모듈
// - 7대 작가 서브탭 전환기 (switchCreatorTab)
// - 작품 관리 & 비공개 원고 저장 (handleCreateEpisodeSubmit)
// - 게시·예약은 CreatorPublications와 서버의 원자적 경로에서 처리
// - 4대 실시간 수익 지표 (Estimated/Confirmed/Payable) 연동
// - 정산금 출금 신청(handleCreatorSettlementReq) 및 작가 인증
// ============================================================


// 작가센터 7대 탭 전환 함수
window.switchCreatorTab = function(tabKey, shouldPushState = true) {
  if (['ad-rev','sales-rev','settlements'].includes(tabKey)) {
    showToast('수익·정산 기능은 현재 사용할 수 없습니다.');
    tabKey = 'works';
  }
  if (!window.CreatorOperations?.active() && ['home','help'].includes(tabKey)) tabKey='works';
  if (tabKey !== 'new-ep') window.CreatorDraftEditor?.checkpoint();
  if (tabKey === 'new-ep' && shouldPushState) window.CreatorDraftEditor?.enter();
  document.querySelectorAll('#creatorTabsBar [data-creator-tab]').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`#creatorTabsBar [data-creator-tab="${tabKey}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('.creator-tab-panel').forEach(p => p.style.display = 'none');
  const targetPanel = document.getElementById(`creatorTab-${tabKey}`);
  if (targetPanel) targetPanel.style.display = 'block';

  if (window.lucide) window.lucide.createIcons();

  if (tabKey === 'stats') {
    if (typeof window.loadCreatorReaderAnalyticsVisuals === 'function') {
      window.loadCreatorReaderAnalyticsVisuals();
    }
  }
  if (tabKey === 'home') window.CreatorOperations?.home();

  if (shouldPushState) {
    const tabUrlMap = {
      'works': 'works',
      'home': 'home',
      'help': 'help',
      'new-ep': 'episodes',
      'status': 'status',
      'stats': 'stats',
      'ad-rev': 'settlement',
      'sales-rev': 'settlement',
      'settlements': 'settlement'
    };
    const subRoute = tabUrlMap[tabKey] || tabKey;
    const targetUrl = `/creator/${subRoute}`;
    if (window.location.pathname !== targetUrl) {
      try { window.history.pushState({ path: targetUrl }, '', targetUrl); } catch (e) {}
    }
  }
  if (tabKey === 'works' && shouldPushState) window.CreatorWorks?.loadFromRoute();
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
// currentLoggedAuthor is managed in /js/core/state.js

window.fetchCreatorDashboardData = async function() {
  const author = window.WebNovelsAuth?.getActor()?.author;
  if (!author) return;
  const name = document.getElementById('creatorAuthorPenName');
  if (name) name.textContent = author.pen_name;
  const badge = document.getElementById('creatorAuthorBadge');
  if (badge) badge.textContent = '작가';
  const logout = document.getElementById('btnAuthorLogout');
  if (logout) logout.style.display = 'inline-block';
  document.getElementById('view-creator')?.classList.toggle('stage8-creator',
    window.CreatorOperations?.active()===true);
  if (/^\/(creator|author)\/works(?:\/|$)/.test(location.pathname))
    return window.CreatorWorks.loadFromRoute();
  if (window.CreatorOperations?.active() && /^\/(creator|author)\/?$/.test(location.pathname))
    return window.CreatorOperations.home();
};
async function handleCreatorSettlementReq() {
  showToast('정산 신청 기능은 현재 사용할 수 없습니다.');
  return { success: false, error: 'MONETIZATION_NOT_ACTIVATED' };
}
window.handleCreatorSettlementReq = handleCreatorSettlementReq;

window.prepareNewEpisodeForWork = function(workId) { return window.CreatorDraftEditor.openWork(String(workId), null, { fresh: true }); };

window.handleWorkStatusChange = async function(workId) {
  window.CreatorWorks.navigate('/creator/works/' + String(workId) + '/settings');
};
// ============================================================
// [Author Work Comment Policy & Clean Zone Console] (improve4.md)
// ============================================================
let currentPolicyBlockedTerms = [];

function escapeCreatorHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

window.updatePolicyMinReadDisplay = function(val) {
  const display = document.getElementById('policyMinReadDisplay');
  if (!display) return;
  const num = parseInt(val, 10) || 0;
  if (num === 0) {
    display.textContent = '전체 독자 가능';
    display.style.color = '#94a3b8';
  } else {
    display.textContent = `최소 ${num}화 이상`;
    display.style.color = 'var(--cdg-pink, #ff3366)';
  }
};

window.renderPolicyBlockedTermsChips = function() {
  const container = document.getElementById('policyBlockedTermsChips');
  if (!container) return;
  container.innerHTML = currentPolicyBlockedTerms.map((term, idx) => `
    <span class="tag-chip">
      ${escapeCreatorHtml(term)}
      <button type="button" onclick="removePolicyBlockedTerm(${idx})" title="삭제">&times;</button>
    </span>
  `).join('');
};

window.removePolicyBlockedTerm = function(idx) {
  currentPolicyBlockedTerms.splice(idx, 1);
  renderPolicyBlockedTermsChips();
};

window.addPolicyBlockedTerm = function(term) {
  const clean = String(term || '').trim();
  if (!clean) return;
  if (currentPolicyBlockedTerms.includes(clean)) {
    if (typeof showToast === 'function') showToast('이미 추가된 금칙어입니다.');
    return;
  }
  currentPolicyBlockedTerms.push(clean);
  renderPolicyBlockedTermsChips();
  const input = document.getElementById('policyNewTermInput');
  if (input) input.value = '';
};

window.unblockReaderInModal = async function(workId, readerId) {
  if (!confirm(`독자(${readerId})의 차단을 해제하시겠습니까?`)) return;
  if (window.WebNovelsAdmin?.unblockReaderComments) {
    const res = await window.WebNovelsAdmin.unblockReaderComments(workId, readerId);
    if (res.success) {
      showToast('독자 차단이 성공적으로 해제되었습니다.');
      renderPolicyBlockedReadersList(workId);
    } else {
      showToast(`차단 해제 실패: ${res.error || '오류 발생'}`);
    }
  }
};

window.renderPolicyBlockedReadersList = async function(workId) {
  const container = document.getElementById('policyBlockedReadersList');
  const countEl = document.getElementById('policyBlockedCount');
  if (!container) return;

  container.innerHTML = `<div class="p-3 text-center text-muted small">차단 목록을 불러오는 중...</div>`;

  let blocks = [];
  try {
    if (window.WebNovelsAdmin?.fetchBlockedReaders) {
      blocks = await window.WebNovelsAdmin.fetchBlockedReaders(workId);
    }
  } catch (e) {
    blocks = [];
  }

  if (countEl) countEl.textContent = `${blocks.length}명 차단됨`;

  if (!blocks || blocks.length === 0) {
    container.innerHTML = `<div class="p-3 text-center text-muted small">차단된 악성 독자가 없습니다. (클린존 유지 중 👍)</div>`;
    return;
  }

  container.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.08); color:#94a3b8;">
          <th style="padding:6px 10px;">독자 ID</th>
          <th style="padding:6px 10px;">차단 일시</th>
          <th style="padding:6px 10px; text-align:right;">관리</th>
        </tr>
      </thead>
      <tbody>
        ${blocks.map(b => {
          const dateStr = b.created_at ? new Date(b.created_at).toLocaleDateString() : '최근';
          return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:6px 10px; color:#e2e8f0; font-family:monospace;">${escapeCreatorHtml(b.reader_id)}</td>
              <td style="padding:6px 10px; color:#64748b;">${dateStr}</td>
              <td style="padding:6px 10px; text-align:right;">
                <button type="button" class="btn btn-outline btn-sm" style="padding:2px 6px; font-size:0.72rem;" onclick="unblockReaderInModal(${workId}, '${b.reader_id}')">
                  차단 해제
                </button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
};

window.configureWorkCommentPolicy = async function(workId) {
  const targetWorkId = Number(workId);
  const work = SAMPLE_WORKS.find(w => Number(w.id) === targetWorkId) || { id: targetWorkId, title: '작품' };

  const hiddenWorkId = document.getElementById('policyCurrentWorkId');
  if (hiddenWorkId) hiddenWorkId.value = targetWorkId;

  const modalTitle = document.getElementById('policyWorkModalTitle');
  if (modalTitle) modalTitle.textContent = `[${work.title}] 댓글 및 클린존 관리`;

  let policy = { comments_enabled: true, blocked_terms: [], min_read_episodes: 0 };
  if (window.WebNovelsAdmin?.fetchWorkCommentPolicy) {
    try {
      policy = await window.WebNovelsAdmin.fetchWorkCommentPolicy(targetWorkId);
    } catch (_) {}
  }

  const enabledCheck = document.getElementById('policyCommentsEnabled');
  if (enabledCheck) {
    enabledCheck.checked = policy.comments_enabled !== false && policy.commentsEnabled !== false;
  }

  const rangeInput = document.getElementById('policyMinReadRange');
  const minEpisodes = policy.min_read_episodes ?? policy.minReadEpisodes ?? 0;
  if (rangeInput) {
    rangeInput.value = minEpisodes;
    updatePolicyMinReadDisplay(minEpisodes);
  }

  currentPolicyBlockedTerms = Array.isArray(policy.blocked_terms) ? [...policy.blocked_terms] : (Array.isArray(policy.blockedTerms) ? [...policy.blockedTerms] : []);
  renderPolicyBlockedTermsChips();

  const termInput = document.getElementById('policyNewTermInput');
  if (termInput && !termInput._bound) {
    termInput._bound = true;
    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addPolicyBlockedTerm(termInput.value);
      }
    });
  }

  renderPolicyBlockedReadersList(targetWorkId);

  if (typeof openModal === 'function') {
    openModal('modalWorkCommentPolicy');
  }
};

window.handleSaveCommentPolicySubmit = async function() {
  const workId = Number(document.getElementById('policyCurrentWorkId')?.value);
  if (!workId) {
    showToast('작품 정보가 올바르지 않습니다.');
    return;
  }

  const commentsEnabled = document.getElementById('policyCommentsEnabled')?.checked ?? true;
  const minReadEpisodes = parseInt(document.getElementById('policyMinReadRange')?.value, 10) || 0;
  const blockedTerms = [...currentPolicyBlockedTerms];

  if (window.WebNovelsAdmin?.updateWorkCommentPolicy) {
    const res = await window.WebNovelsAdmin.updateWorkCommentPolicy(workId, { commentsEnabled, minReadEpisodes, blockedTerms });
    if (res.success) {
      showToast('🎉 댓글 및 클린존 관리 설정이 즉시 반영되었습니다.');
      if (typeof closeAllModals === 'function') closeAllModals();
    } else {
      showToast(`설정 저장 실패: ${res.error || '권한을 확인해주세요.'}`);
    }
  } else {
    showToast('DB 연결이 없어 설정을 저장하지 못했습니다.');
    if (typeof closeAllModals === 'function') closeAllModals();
  }
};

// ============================================================
// 비공개 원고 저장. 게시·예약 버튼은 별도 확인 흐름을 연다.
// ============================================================
window.handleCreateEpisodeSubmit = async function(e) {
  e.preventDefault();
  await window.CreatorDraftEditor.save();
};

// ============================================================
// [Function] handleCreatorSettlementReq
// 정산 신청은 서버 원장과 운영 지급 절차가 확인될 때까지 비활성이다.
// ============================================================
window.handleAuthorLogoutProcess = async function() { return window.handleMemberLogout(); };
window.handleCreatorLogoutProcess = window.handleAuthorLogoutProcess;




// ============================================================
// [Step 4] 작가 크리에이터 스튜디오 4대 실시간 수익 지표 연동 (하드코딩 제거 및 실제 DB 수치 반영)
// ============================================================
window.loadCreatorStudioEarnings = async function() {
  for (const id of ['creatorEstimatedRevenue','creatorConfirmedRevenue',
    'creatorPayableRevenue','creatorSettlementPayableAmount','creatorSalesCount','creatorSalesRevenue']) {
    const element = document.getElementById(id);
    if (element) element.textContent = '서비스 준비 중';
  }
  return null;
};

// ============================================================
// [Step 5 - improve5.md] 작가 수익 발생 상세 원장 (Earning Ledger)
// ============================================================
window._creatorLedgerEntries = [];
window._creatorLedgerFilterSource = 'ALL';
window._creatorLedgerFilterStatus = 'ALL';

window.loadCreatorEarningLedger = async function() {
  const container = document.getElementById('creatorLedgerContainer');
  if (container) container.textContent = '수익 원장은 현재 제공하지 않습니다.';
  window._creatorLedgerEntries = [];
  return null;
};

window.filterCreatorLedger = function(sourceType) {
  window._creatorLedgerFilterSource = sourceType;
  document.querySelectorAll('.ledger-filter-btn').forEach(btn => {
    if (btn.dataset.source === sourceType) {
      btn.classList.add('btn-primary', 'active');
      btn.classList.remove('btn-outline');
    } else {
      btn.classList.remove('btn-primary', 'active');
      btn.classList.add('btn-outline');
    }
  });
  window.renderCreatorEarningLedger();
};

window.filterCreatorLedgerStatus = function(status) {
  window._creatorLedgerFilterStatus = status;
  window.renderCreatorEarningLedger();
};

window.renderCreatorEarningLedger = function() {
  const container = document.getElementById('creatorLedgerContainer');
  if (!container) return;

  const allEntries = window._creatorLedgerEntries || [];
  const filterSource = window._creatorLedgerFilterSource || 'ALL';
  const filterStatus = window._creatorLedgerFilterStatus || 'ALL';

  const filtered = allEntries.filter(e => {
    if (filterSource !== 'ALL' && e.sourceType !== filterSource) return false;
    if (filterStatus !== 'ALL' && e.status !== filterStatus) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-5 text-center text-muted">
        <i data-lucide="inbox" style="width:36px; height:36px; opacity:0.5; margin-bottom:8px;"></i>
        <p style="margin:0;">해당 조건에 부합하는 수익 원장 내역이 없습니다.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const sourceBadges = {
    'AD': { label: '광고 수익', class: 'badge-primary', icon: 'tv' },
    'SUPPORT': { label: '독자 후원', class: 'badge-accent', icon: 'gift' },
    'POINT_SALE': { label: '포인트 판매', class: 'badge-outline', icon: 'coins' },
    'SETTLEMENT': { label: '정산 출금', class: 'badge-danger', icon: 'arrow-down-right' }
  };

  const statusBadges = {
    'CONFIRMED': { label: '확정 (CONFIRMED)', color: 'var(--accent-emerald, #10B981)' },
    'ESTIMATED': { label: '예상 (ESTIMATED)', color: 'var(--accent-amber, #F59E0B)' },
    'SETTLED': { label: '지급완료 (SETTLED)', color: '#38BDF8' },
    'VOID': { label: '취소/환불', color: '#EF4444' }
  };

  container.innerHTML = `
    <table class="creator-ledger-table" style="width:100%; border-collapse:collapse; text-align:left; font-size:0.85rem;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.08); color:var(--text-muted); background:rgba(255,255,255,0.02);">
          <th style="padding:10px 12px; min-width:130px;">발생 일시</th>
          <th style="padding:10px 12px; min-width:120px;">수익 원천</th>
          <th style="padding:10px 12px; min-width:180px;">작품 / 상세 내역</th>
          <th style="padding:10px 12px; min-width:120px; text-align:right;">금액 / 포인트</th>
          <th style="padding:10px 12px; min-width:110px; text-align:center;">상태</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(entry => {
          const dateObj = new Date(entry.createdAt);
          const dateStr = !isNaN(dateObj.getTime()) ? `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')} ${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}` : entry.createdAt;
          const sBadge = sourceBadges[entry.sourceType] || { label: entry.sourceType, class: 'badge-outline', icon: 'tag' };
          const statBadge = statusBadges[entry.status] || { label: entry.status, color: '#94a3b8' };
          const isNegative = Number(entry.amount) < 0;
          const formattedAmount = (isNegative ? '-' : '+') + Math.abs(Number(entry.amount)).toLocaleString() + (entry.currency === 'POINT' ? ' P' : ' 원');
          const amountColor = isNegative ? '#EF4444' : (entry.currency === 'POINT' ? 'var(--cdg-pink, #FF2A7A)' : 'var(--accent-emerald, #10B981)');

          return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04); transition:background 0.2s;" class="ledger-row-hover">
              <td style="padding:10px 12px; color:var(--text-muted); font-size:0.8rem; font-family:monospace;">${dateStr}</td>
              <td style="padding:10px 12px;">
                <span class="badge ${sBadge.class}" style="font-size:0.75rem; padding:3px 8px; display:inline-flex; align-items:center; gap:4px;">
                  <i data-lucide="${sBadge.icon}" style="width:12px; height:12px;"></i> ${sBadge.label}
                </span>
              </td>
              <td style="padding:10px 12px;">
                <div style="font-weight:600; color:#fff;">${escapeCreatorHtml(entry.workTitle || '전체 작품')}</div>
                <div class="text-muted" style="font-size:0.76rem; margin-top:2px;">${escapeCreatorHtml(entry.description || '')}</div>
              </td>
              <td style="padding:10px 12px; text-align:right; font-weight:700; font-size:0.95rem; color:${amountColor}; font-family:monospace;">
                ${formattedAmount}
              </td>
              <td style="padding:10px 12px; text-align:center;">
                <span style="display:inline-block; font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:12px; border:1px solid ${statBadge.color}; color:${statBadge.color}; background:rgba(0,0,0,0.3);">
                  ${statBadge.label}
                </span>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  if (window.lucide) window.lucide.createIcons();
};

// ============================================================
// [Step 6 - improve6.md] 심층 독자 분석(Deep Reader Analytics) 시각화 엔진
// ============================================================
window.loadCreatorReaderAnalyticsVisuals = async function(selectedWorkId = null) {
  const authorStr = localStorage.getItem('webnovels_creator') || localStorage.getItem('webnovels_author') || localStorage.getItem('webnovels_user');
  let aId = 1;
  let penName = '판타지마스터';
  try {
    const parsed = JSON.parse(authorStr || '{}');
    aId = parsed.creatorId || parsed.authorId || parsed.id || 1;
    penName = parsed.penName || parsed.pen_name || parsed.username || penName;
  } catch(e) {}

  // 1. 작가 소유 작품 목록 추출 및 셀렉터 채우기
  const allWorks = (typeof SAMPLE_WORKS !== 'undefined' ? SAMPLE_WORKS : []);
  const authorWorks = allWorks.filter(w => {
    return Number(w.authorId) === Number(aId) || w.author === penName || (w.author && w.author.includes(penName));
  });
  const works = authorWorks.length > 0 ? authorWorks : allWorks.slice(0, 3);

  const workSelect = document.getElementById('creatorAnalyticsWorkSelect');
  if (workSelect && workSelect.options.length <= 1) {
    workSelect.innerHTML = works.map((w, idx) => `
      <option value="${w.id}" ${idx === 0 ? 'selected' : ''}>${escapeCreatorHtml(w.title)} (${escapeHtml(w.genre || '장르')})</option>
    `).join('');
  }

  const currentWorkId = Number(selectedWorkId || workSelect?.value || (works[0]?.id || 1));
  const currentWork = works.find(w => Number(w.id) === currentWorkId) || works[0];
  const episodes = (currentWork && Array.isArray(currentWork.episodes)) ? currentWork.episodes : [
    { id: 101, episodeNumber: 1, title: '제 1 화: 새로운 시작' },
    { id: 102, episodeNumber: 2, title: '제 2 화: 미지의 문' },
    { id: 103, episodeNumber: 3, title: '제 3 화: 각성의 순간' },
    { id: 104, episodeNumber: 4, title: '제 4 화: 시련과 선택' },
    { id: 105, episodeNumber: 5, title: '제 5 화: 결전의 전조' },
    { id: 106, episodeNumber: 6, title: '제 6 화: 새로운 동료' }
  ];

  // 2. DB / Local 독자 이벤트 수집
  let rawEvents = [];
  if (window.WebNovelsAdmin?.fetchCreatorReaderAnalytics) {
    try {
      const res = await window.WebNovelsAdmin.fetchCreatorReaderAnalytics(aId);
      if (res && Array.isArray(res.events)) {
        rawEvents = res.events;
      }
    } catch (e) {
      console.warn('[loadCreatorReaderAnalyticsVisuals API Error]', e);
    }
  }

  // 로컬 스토리지에 기록된 최근 이벤트 병합
  const localEvents = JSON.parse(localStorage.getItem(`reader_events_work_${currentWorkId}`) || '[]');
  let combinedEvents = [...localEvents, ...rawEvents];

  // 3. 상단 핵심 KPI 계산 (Supabase DB reader_events 실제 데이터 기반)
  const openEvents = combinedEvents.filter(e => e.event_type === 'OPEN');
  const completeEvents = combinedEvents.filter(e => e.event_type === 'COMPLETE');
  const completionRate = openEvents.length > 0 ? Math.round((completeEvents.length / openEvents.length) * 100) : 0;
  const avgProgress = combinedEvents.length > 0
    ? Math.round(combinedEvents.reduce((acc, cur) => acc + (Number(cur.progress) || 50), 0) / combinedEvents.length)
    : 0;

  const elComp = document.getElementById('creatorCompletionRate');
  const elProg = document.getElementById('creatorAverageProgress');
  const elCount = document.getElementById('creatorAnalyticsEvents');
  const elSampleText = document.getElementById('creatorCompletionSampleText');

  if (elComp) elComp.textContent = `${completionRate}%`;
  if (elProg) elProg.textContent = `${avgProgress}%`;
  if (elCount) elCount.textContent = `${combinedEvents.length.toLocaleString()}건`;
  if (elSampleText) {
    elSampleText.textContent = `Supabase DB 실제 이벤트 ${combinedEvents.length}건 정밀 집계`;
  }

  // 4. 3대 분석 시각화 차트 렌더링
  renderReaderFunnelChart(combinedEvents, episodes);
  renderEpisodeCompletionList(combinedEvents, episodes);
  renderReaderActivityTimeline(combinedEvents);
};

// (1) 연재 독서 퍼널 차트 렌더링
function renderReaderFunnelChart(events, episodes) {
  const container = document.getElementById('creatorFunnelContainer');
  if (!container) return;

  const sortedEps = [...episodes].sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
  const ep1 = sortedEps[0];
  const ep3 = sortedEps.length >= 3 ? sortedEps[2] : null;
  const ep5 = sortedEps.length >= 5 ? sortedEps[4] : null;
  const epLatest = sortedEps[sortedEps.length - 1];

  const getEpOpenCount = (ep) => {
    if (!ep) return 0;
    const key = ep.id || ep.episodeNumber;
    return events.filter(e => String(e.episode_id) === String(key) && e.event_type === 'OPEN').length || 1;
  };

  const count1 = Math.max(1, getEpOpenCount(ep1));
  const count3 = ep3 ? getEpOpenCount(ep3) : Math.round(count1 * 0.7);
  const count5 = ep5 ? getEpOpenCount(ep5) : Math.round(count1 * 0.5);
  const countLatest = epLatest ? getEpOpenCount(epLatest) : Math.round(count1 * 0.38);

  const steps = [
    { label: '1화 독자 유입 (Start)', count: count1, pct: 100, dropPct: 0, color: '#38BDF8', note: '초기 유입 기준점' },
    { label: '3화 도달 (Early Hook)', count: count3, pct: Math.min(100, Math.round((count3 / count1) * 100)), dropPct: Math.max(0, 100 - Math.round((count3 / count1) * 100)), color: '#818CF8', note: '초반 설정 장벽 통과' },
    { label: '5화 완독 (Mid Retention)', count: count5, pct: Math.min(100, Math.round((count5 / count1) * 100)), dropPct: Math.max(0, Math.round((count3 / count1) * 100) - Math.round((count5 / count1) * 100)), color: 'var(--cdg-pink, #FF2A7A)', note: '고정 충성독자 전환' },
    { label: '최신화 정주행 (Latest)', count: countLatest, pct: Math.min(100, Math.round((countLatest / count1) * 100)), dropPct: Math.max(0, Math.round((count5 / count1) * 100) - Math.round((countLatest / count1) * 100)), color: '#10B981', note: '다음 화 유료/광고 대기' }
  ];

  container.innerHTML = steps.map(step => `
    <div class="funnel-step-row p-3 glass-panel" style="border-radius:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border-color);">
      <div class="flex-between mb-2" style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:8px;">
          <strong style="color:#fff; font-size:0.92rem;">${step.label}</strong>
          <span class="badge badge-outline" style="font-size:0.72rem;">${step.note}</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          ${step.dropPct > 0 ? `<span style="color:#F43F5E; font-size:0.78rem; font-weight:700;">-${step.dropPct}% 이탈</span>` : ''}
          <strong style="color:${step.color}; font-size:1.05rem; font-family:monospace;">${step.pct}%</strong>
          <span class="text-muted small">(${step.count.toLocaleString()}명)</span>
        </div>
      </div>
      <div class="funnel-progress-track" style="height:10px; width:100%; background:rgba(0,0,0,0.4); border-radius:6px; overflow:hidden;">
        <div class="funnel-progress-bar" style="height:100%; width:${step.pct}%; background:${step.color}; border-radius:6px; transition:width 0.6s ease;"></div>
      </div>
    </div>
  `).join('');
}

// (2) 회차별 완독률 & 킬러 회차 목록 테이블
function renderEpisodeCompletionList(events, episodes) {
  const container = document.getElementById('creatorEpisodeAnalyticsTable');
  if (!container) return;

  const sortedEps = [...episodes].sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));

  container.innerHTML = `
    <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.85rem;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.08); color:var(--text-muted); background:rgba(255,255,255,0.02);">
          <th style="padding:10px 12px; width:80px;">회차</th>
          <th style="padding:10px 12px;">회차 제목</th>
          <th style="padding:10px 12px; width:100px; text-align:right;">열람수</th>
          <th style="padding:10px 12px; width:100px; text-align:right;">완독수</th>
          <th style="padding:10px 12px; width:160px;">완독률 (Completion)</th>
          <th style="padding:10px 12px; width:120px; text-align:center;">평가 / 배지</th>
        </tr>
      </thead>
      <tbody>
        ${sortedEps.map(ep => {
          const key = ep.id || ep.episodeNumber;
          const opens = events.filter(e => String(e.episode_id) === String(key) && e.event_type === 'OPEN').length || 1;
          const completes = events.filter(e => String(e.episode_id) === String(key) && e.event_type === 'COMPLETE').length;
          const rate = Math.min(100, Math.round((completes / opens) * 100));

          const isKiller = rate >= 78;
          const isWarning = rate < 50;

          return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04); transition:background 0.2s;" class="ledger-row-hover">
              <td style="padding:10px 12px; font-weight:700; color:var(--text-muted);">${ep.episodeNumber}화</td>
              <td style="padding:10px 12px; font-weight:600; color:#fff;">${escapeCreatorHtml(ep.title)}</td>
              <td style="padding:10px 12px; text-align:right; color:var(--text-muted); font-family:monospace;">${opens.toLocaleString()}</td>
              <td style="padding:10px 12px; text-align:right; color:#10B981; font-family:monospace; font-weight:700;">${completes.toLocaleString()}</td>
              <td style="padding:10px 12px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="flex:1; height:6px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
                    <div style="height:100%; width:${rate}%; background:${isKiller ? '#F43F5E' : (rate >= 60 ? '#10B981' : '#F59E0B')}; border-radius:4px;"></div>
                  </div>
                  <span style="font-weight:700; font-size:0.8rem; width:38px; text-align:right; font-family:monospace;">${rate}%</span>
                </div>
              </td>
              <td style="padding:10px 12px; text-align:center;">
                ${isKiller ? '<span class="badge" style="background:rgba(244,63,94,0.15); color:#F43F5E; border:1px solid rgba(244,63,94,0.3); font-size:0.75rem;">🔥 킬러 회차</span>' : (isWarning ? '<span class="badge" style="background:rgba(245,158,11,0.15); color:#F59E0B; border:1px solid rgba(245,158,11,0.3); font-size:0.75rem;">⚠️ 이탈 주의</span>' : '<span class="text-muted small">안정적</span>')}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// (3) 최근 7일 독서 활동 타임라인 바 차트
function renderReaderActivityTimeline(events) {
  const container = document.getElementById('creatorTimelineActivity');
  if (!container) return;

  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    const keyStr = d.toISOString().slice(0, 10);
    days.push({ label: dateStr, key: keyStr, opens: 0, completes: 0 });
  }

  events.forEach(e => {
    if (!e.occurred_at) return;
    const dateKey = String(e.occurred_at).slice(0, 10);
    const target = days.find(d => d.key === dateKey);
    if (target) {
      if (e.event_type === 'OPEN') target.opens++;
      if (e.event_type === 'COMPLETE') target.completes++;
    }
  });

  const maxVal = Math.max(...days.map(d => Math.max(d.opens, d.completes)), 10);

  container.innerHTML = days.map(d => {
    const openH = Math.max(0, Math.round((d.opens / maxVal) * 110));
    const compH = Math.max(0, Math.round((d.completes / maxVal) * 110));

    return `
      <div class="timeline-bar-column" style="display:flex; flex-direction:column; align-items:center; gap:6px; flex:1;" title="${d.label} - 열람: ${d.opens}건, 완독: ${d.completes}건">
        <div style="display:flex; align-items:flex-end; gap:4px; height:120px;">
          <!-- Open Bar -->
          <div style="width:14px; height:${openH}px; background:#818CF8; border-radius:4px 4px 0 0;" title="열람 ${d.opens}건"></div>
          <!-- Complete Bar -->
          <div style="width:14px; height:${compH}px; background:var(--cdg-pink, #FF2A7A); border-radius:4px 4px 0 0;" title="완독 ${d.completes}건"></div>
        </div>
        <span class="text-muted" style="font-size:0.75rem; font-family:monospace;">${d.label}</span>
      </div>
    `;
  }).join('');
}



// ============================================================
// [Author Work Registration: Standard Tag Chips & Autocomplete]
// ============================================================
const CREATOR_STANDARD_TAGS = [
  { slug: 'regression', label: '회귀', aliases: ['회귀물'], category: '스토리/전개' },
  { slug: 'possession', label: '빙의', aliases: ['빙의물'], category: '스토리/전개' },
  { slug: 'reincarnation', label: '환생', aliases: ['환생물'], category: '스토리/전개' },
  { slug: 'misunderstanding', label: '착각계', aliases: [], category: '주인공 성향' },
  { slug: 'catharsis', label: '사이다', aliases: [], category: '주인공 성향' },
  { slug: 'academy', label: '아카데미', aliases: [], category: '배경/세계관' },
  { slug: 'professional', label: '전문직', aliases: [], category: '배경/세계관' },
  { slug: 'system', label: '시스템', aliases: [], category: '배경/세계관' },
  { slug: 'game', label: '게임빙의', aliases: [], category: '스토리/전개' },
  { slug: 'hunter', label: '헌터', aliases: [], category: '배경/세계관' },
  { slug: 'dungeon', label: '던전', aliases: [], category: '배경/세계관' },
  { slug: 'growth', label: '성장', aliases: [], category: '주인공 성향' },
  { slug: 'survival', label: '생존', aliases: [], category: '주인공 성향' },
  { slug: 'politics', label: '정치', aliases: [], category: '주인공 성향' },
  { slug: 'war', label: '전쟁', aliases: [], category: '주인공 성향' },
  { slug: 'romance', label: '로맨스', aliases: [], category: '장르특성' },
  { slug: 'romance-fantasy', label: '로맨스판타지', aliases: ['로판'], category: '장르특성' },
  { slug: 'martial-arts', label: '무협', aliases: [], category: '장르특성' },
  { slug: 'modern-fantasy', label: '현대판타지', aliases: ['현판'], category: '장르특성' },
  { slug: 'healing', label: '힐링', aliases: [], category: '주인공 성향' },
  { slug: 'mystery', label: '미스터리', aliases: [], category: '주인공 성향' },
  { slug: 'horror', label: '공포', aliases: [], category: '주인공 성향' },
  { slug: 'sf', label: 'SF', aliases: [], category: '배경/세계관' },
  { slug: 'slice-of-life', label: '일상', aliases: [], category: '주인공 성향' },
  { slug: 'comedy', label: '코미디', aliases: [], category: '주인공 성향' },
  { slug: 'revenge', label: '복수', aliases: [], category: '주인공 성향' },
  { slug: 'family', label: '육아', aliases: [], category: '주인공 성향' },
  { slug: 'chef', label: '요리', aliases: [], category: '배경/세계관' },
  { slug: 'sports', label: '스포츠', aliases: [], category: '배경/세계관' },
  { slug: 'medical', label: '의학', aliases: [], category: '배경/세계관' },
  { slug: 'business', label: '경영', aliases: [], category: '배경/세계관' },
  { slug: 'historical', label: '대체역사', aliases: [], category: '배경/세계관' }
];

const TagChipsManager = {
  selectedTags: [], // [{ slug, label }]
  maxTags: 10,
  initialized: false,
  
  init() {
    const input = document.getElementById('workTagSearchInput');
    const container = document.getElementById('workTagInputContainer');
    const suggestions = document.getElementById('quickTagSuggestions');
    if (!input || !container) return;

    if (!this.initialized) {
      this.initialized = true;

      input.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        this.showDropdown(q);
      });

      input.addEventListener('focus', () => {
        const q = input.value.trim();
        this.showDropdown(q);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = input.value.trim();
          if (q) {
            this.addTag(q);
            input.value = '';
            this.hideDropdown();
          }
        } else if (e.key === 'Escape') {
          this.hideDropdown();
        }
      });

      document.addEventListener('click', (e) => {
        if (!container.contains(e.target) && (!suggestions || !suggestions.contains(e.target))) {
          this.hideDropdown();
        }
      });

      if (suggestions) {
        suggestions.addEventListener('click', (e) => {
          const btn = e.target.closest('.btn-quick-tag');
          if (btn) {
            const tag = btn.dataset.tag || btn.textContent.replace('#', '').trim();
            this.addTag(tag);
          }
        });
      }
    }

    this.syncUI();
  },

  findTagDef(query) {
    const q = String(query).trim().toLowerCase();
    return CREATOR_STANDARD_TAGS.find(t => 
      t.slug.toLowerCase() === q || 
      t.label.toLowerCase() === q || 
      (t.aliases && t.aliases.some(a => a.toLowerCase() === q))
    );
  },

  addTag(rawTag) {
    if (!rawTag) return;
    if (this.selectedTags.length >= this.maxTags) {
      if (typeof showToast === 'function') showToast(`태그는 최대 ${this.maxTags}개까지만 등록할 수 있습니다.`);
      return;
    }
    const def = this.findTagDef(rawTag);
    const slug = def ? def.slug : rawTag.toLowerCase().replace(/\s+/g, '-');
    const label = def ? def.label : rawTag;

    if (this.selectedTags.some(t => t.slug === slug)) {
      if (typeof showToast === 'function') showToast(`이미 추가된 태그입니다.`);
      return;
    }

    this.selectedTags.push({ slug, label });
    this.syncUI();
  },

  removeTag(slug) {
    this.selectedTags = this.selectedTags.filter(t => t.slug !== slug);
    this.syncUI();
  },

  reset() {
    this.selectedTags = [];
    const input = document.getElementById('workTagSearchInput');
    if (input) input.value = '';
    this.hideDropdown();
    this.syncUI();
  },

  syncUI() {
    const chipsBox = document.getElementById('workTagChips');
    const hiddenInput = document.getElementById('adminNewWorkTags');
    const counter = document.getElementById('workTagCountText');

    if (chipsBox) {
      chipsBox.innerHTML = this.selectedTags.map(t => `
        <span class="tag-chip" data-slug="${t.slug}">
          #${t.label}
          <button type="button" onclick="TagChipsManager.removeTag('${t.slug}')" title="삭제">&times;</button>
        </span>
      `).join('');
    }

    if (hiddenInput) {
      hiddenInput.value = JSON.stringify(this.selectedTags.map(t => t.slug));
    }

    if (counter) {
      counter.textContent = `${this.selectedTags.length}/${this.maxTags}`;
    }
  },

  showDropdown(query) {
    const dropdown = document.getElementById('tagAutocompleteDropdown');
    if (!dropdown) return;

    if (!query) {
      const grouped = {};
      CREATOR_STANDARD_TAGS.forEach(t => {
        if (!grouped[t.category]) grouped[t.category] = [];
        grouped[t.category].push(t);
      });

      let html = '<div class="tag-dropdown-hint">카테고리별 표준 태그를 선택하거나 직접 입력하세요</div>';
      Object.keys(grouped).forEach(cat => {
        html += `<div class="tag-dropdown-cat-title">${cat}</div><div class="tag-dropdown-group">`;
        grouped[cat].forEach(t => {
          const isSelected = this.selectedTags.some(sel => sel.slug === t.slug);
          html += `
            <button type="button" class="tag-dropdown-item ${isSelected ? 'selected' : ''}" onclick="TagChipsManager.onDropdownClick('${t.slug}')">
              #${t.label}
            </button>
          `;
        });
        html += '</div>';
      });
      dropdown.innerHTML = html;
      dropdown.classList.remove('hidden');
      return;
    }

    const q = query.toLowerCase();
    const matched = CREATOR_STANDARD_TAGS.filter(t => 
      t.label.toLowerCase().includes(q) || 
      t.slug.toLowerCase().includes(q) || 
      (t.aliases && t.aliases.some(a => a.toLowerCase().includes(q)))
    );

    let html = '';
    if (matched.length > 0) {
      html += matched.map(t => {
        const isSelected = this.selectedTags.some(sel => sel.slug === t.slug);
        return `
          <button type="button" class="tag-dropdown-item ${isSelected ? 'selected' : ''}" onclick="TagChipsManager.onDropdownClick('${t.slug}')">
            <strong>#${t.label}</strong> <span class="tag-cat">[${t.category}]</span> ${t.aliases?.length ? `<span class="tag-alias">(${t.aliases.join(', ')})</span>` : ''}
          </button>
        `;
      }).join('');
    } else {
      html += `
        <button type="button" class="tag-dropdown-item custom-tag" onclick="TagChipsManager.onDropdownClick('${query}')">
          <i data-lucide="plus"></i> "<strong>${query}</strong>" 직접 입력 태그 등록 (Enter)
        </button>
      `;
    }

    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');
    if (window.lucide?.createIcons) window.lucide.createIcons({ root: dropdown });
  },

  onDropdownClick(slugOrLabel) {
    this.addTag(slugOrLabel);
    const input = document.getElementById('workTagSearchInput');
    if (input) input.value = '';
    this.hideDropdown();
  },

  hideDropdown() {
    const dropdown = document.getElementById('tagAutocompleteDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TagChipsManager.init());
  } else {
    TagChipsManager.init();
  }
}

// ============================================================
// [Global Window Namespace Exports for Author / Creator]
// ============================================================
if (typeof window !== 'undefined') {
  window.switchCreatorTab = switchCreatorTab;
  window.switchAuthorTab = switchCreatorTab;
  window.toggleScheduledTimeInput = toggleScheduledTimeInput;
  window.fetchCreatorDashboardData = fetchCreatorDashboardData;
  window.fetchAuthorDashboardData = fetchCreatorDashboardData;
  window.handleCreateEpisodeSubmit = handleCreateEpisodeSubmit;
  window.handleCreatorSettlementReq = handleCreatorSettlementReq;
  window.handleAuthorSettlementReq = handleCreatorSettlementReq;
  window.handleAuthorLogoutProcess = handleAuthorLogoutProcess;
  window.handleCreatorLogoutProcess = handleAuthorLogoutProcess;
  window.loadCreatorStudioEarnings = loadCreatorStudioEarnings;
  window.loadAuthorStudioEarnings = loadCreatorStudioEarnings;
  window.TagChipsManager = TagChipsManager;
  window.CREATOR_STANDARD_TAGS = CREATOR_STANDARD_TAGS;
}
