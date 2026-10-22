/* Authenticated support remains available while public beta enrollment is closed. */
(function () {
  'use strict';
  const categories = { QUESTION: '이용 문의', BUG: '오류 제보', IDEA: '개선 제안', COPYRIGHT: '저작권 분쟁', WITHDRAWAL: '탈퇴 요청' };
  const statuses = { OPEN: '접수', IN_REVIEW: '검토 중', WAITING_USER: '추가 답변 요청', RESOLVED: '답변 완료', CLOSED: '종결', CANCELLED: '취소' };
  const terminal = new Set(['RESOLVED', 'CLOSED', 'CANCELLED']);
  const roots = new Map();
  let returnFocus = null;
  const actor = () => window.WebNovelsAuth?.getActor();
  const permitted = permission => actor()?.admin?.is_active === true && (actor()?.admin?.role === 'SUPER_ADMIN' || actor()?.admin?.permissions?.includes(permission));
  const canRead = admin => !!actor()?.userId && (!admin || permitted('CASE_READ'));
  const canWrite = admin => canRead(admin) && (!admin || permitted('CASE_RESOLVE'));
  function el(parent, tag, value, cls) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = String(value);
    if (cls) node.className = cls;
    parent.append(node); return node;
  }
  function button(parent, label, action, primary = false) {
    const node = el(parent, 'button', label, 'btn btn-sm ' + (primary ? 'btn-primary' : 'btn-outline'));
    node.type = 'button'; node.onclick = action; return node;
  }
  function notice(parent, value, error = false) {
    const node = el(parent, 'p', value, error ? 'beta-support-error' : 'beta-support-note');
    node.setAttribute('role', error ? 'alert' : 'status'); return node;
  }
  function field(parent, title, name, tag = 'input') {
    const label = el(parent, 'label', null, 'beta-support-field'); el(label, 'span', title);
    const input = el(label, tag); input.name = name;
    if (tag === 'input') { input.type = 'text'; input.autocomplete = 'off'; }
    return input;
  }
  function select(parent, title, name, choices) {
    const input = field(parent, title, name, 'select');
    for (const [value, label] of Object.entries(choices)) { const option = el(input, 'option', label); option.value = value; }
    input.value = Object.keys(choices)[0]; return input;
  }
  function date(value) { const time = new Date(value); return Number.isNaN(time.getTime()) ? '' : time.toLocaleString('ko-KR'); }
  function dispose(state) {
    state.alive = false; state.seq++; state.retry = null;
    if (roots.get(state.root) === state) {
      for (const node of state.root.querySelectorAll('input,textarea')) { node.value = ''; node.checked = false; }
      state.root.replaceChildren(); roots.delete(state.root);
    }
  }
  function current(state, seq = state.seq) {
    if (!state.alive || roots.get(state.root) !== state || seq !== state.seq || !state.isCurrent()) return false;
    if (actor()?.userId !== state.user || !canRead(state.admin)) { dispose(state); return false; }
    return true;
  }
  function start(state) {
    if (!current(state)) return null;
    state.seq++; state.retry = null; state.conflict = false; state.root.replaceChildren();
    return state.seq;
  }
  function heading(state, title, back = false) {
    const row = el(state.root, 'div', null, 'beta-support-toolbar'); el(row, 'h3', title);
    if (back) button(row, state.admin ? '지원함 목록' : '내 문의 목록', () => showList(state));
    return row;
  }
  const messages = {
    CONFLICT: '다른 답변이나 처리가 먼저 저장되었습니다. 입력한 내용은 유지됩니다. 최신 내용을 불러온 뒤 다시 확인해 주세요.',
    CASE_NOT_FOUND: '이 문의를 찾을 수 없거나 볼 권한이 없습니다.',
    INVALID_SUPPORT_REQUEST: '입력 항목과 글자 수를 확인해 주세요.', CASE_CLOSED: '현재 처리 상태에서는 이 작업을 할 수 없습니다. 최신 내용을 확인해 주세요.',
    REOPEN_LIMIT: '이 문의의 재검토 요청 횟수(2회)를 모두 사용했습니다.', RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    WORK_NOT_FOUND: '관련 작품 번호를 확인해 주세요. 공개 작품 또는 본인의 작품만 연결할 수 있습니다.',
    OPEN_CASE_LIMIT: '진행 중인 문의가 10개입니다. 기존 문의의 답변을 확인한 후 다시 접수해 주세요.',
    CASE_MESSAGE_LIMIT: '이 문의의 기록 한도에 도달했습니다. 새 문의에 기존 문의 번호를 적어 주세요.',
    BODY_TOO_LARGE: '문의 내용이 너무 깁니다. 제목과 내용의 글자 수를 확인해 주세요.',
    ADMIN_FORBIDDEN: '이 작업을 처리할 관리자 권한이 없습니다.', ACCOUNT_REQUIRED: '로그인한 회원 계정에서 문의할 수 있습니다.',
    AUTH_REQUIRED: '다시 로그인한 후 이용해 주세요.', INVALID_SESSION: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    SUPPORT_NOT_READY: '문의 서비스가 준비 중입니다. 잠시 후 다시 확인해 주세요.'
  };
  function errorText(error) {
    const text = messages[error?.code] || '요청 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도하면 중복 접수를 방지합니다.';
    return text + (/^[a-zA-Z0-9_-]{1,80}$/.test(error?.requestId || '') ? ' 확인 번호: ' + error.requestId : '');
  }
  function endpoint(state, action, params = {}) {
    return (state.admin ? '/api/v2/admin/support?' : '/api/v2/support?') + new URLSearchParams({ action, ...params });
  }
  async function get(state, action, params) { return window.WebNovelsAuth.api(endpoint(state, action, params)); }
  function formMessage(form) {
    const input = field(form, '내용 (3~4,000자)', 'message', 'textarea'); input.rows = 7; input.required = true; input.minLength = 3; input.maxLength = 4000;
    return input;
  }
  async function save(state, seq, form, status, action, payload, done) {
    if (!current(state, seq) || state.busy || state.conflict || !canWrite(state.admin)) return;
    const key = JSON.stringify({ action, ...payload });
    if (!state.retry || state.retry.key !== key) state.retry = { key, requestId: window.crypto.randomUUID() };
    state.busy = true; const controls = [...form.querySelectorAll('input,textarea,select,button')];
    controls.forEach(control => { control.disabled = true; }); status.textContent = '저장하고 있습니다…';
    let conflict = false;
    try {
      const result = await window.WebNovelsAuth.api(endpoint(state, action), {
        method: 'POST', body: JSON.stringify({ ...payload, requestId: state.retry.requestId })
      });
      if (!current(state, seq)) return;
      state.retry = null; state.busy = false; done(result);
    } catch (error) {
      if (!current(state, seq)) return;
      status.textContent = errorText(error); status.setAttribute('role', 'alert');
      conflict = ['CONFLICT', 'CASE_CLOSED', 'REOPEN_LIMIT'].includes(error?.code); state.conflict = conflict;
      if (conflict) {
        state.retry = null;
        // Keep the author's unsent message; replace only the displayed conversation on explicit reload.
        button(status, '최신 내용 불러오기', () => showDetail(state, payload.id, null, form.querySelector('textarea')?.value || ''));
      }
    } finally {
      state.busy = false;
      if (current(state, seq)) controls.forEach(control => { control.disabled = conflict && control.tagName === 'BUTTON'; });
    }
  }
  async function showList(state, offset = 0) {
    const seq = start(state); if (seq == null) return;
    const toolbar = heading(state, state.admin ? '회원 문의·피드백 지원함' : '내 문의·피드백');
    if (!state.admin) button(toolbar, '새 문의', () => showCreate(state), true);
    button(toolbar, '새로고침', () => showList(state, offset));
    const filters = el(state.root, 'div', null, 'beta-support-filters');
    const status = select(filters, '처리 상태', 'status', { '': '전체 상태', ...statuses }); status.value = state.status;
    status.onchange = () => { state.status = status.value; showList(state); };
    if (state.admin) {
      const category = select(filters, '문의 유형', 'category', { '': '전체 유형', ...categories }); category.value = state.category;
      category.onchange = () => { state.category = category.value; showList(state); };
    }
    notice(state.root, '문의에는 비밀번호·인증번호·주민등록번호·API 키를 입력하지 마세요. 원고나 기기 정보는 자동 첨부하지 않습니다.');
    const list = el(state.root, 'div', null, 'beta-support-list'); notice(list, '문의 내역을 불러오는 중입니다…');
    try {
      const result = await get(state, 'list', { offset: String(offset), ...(state.status ? { status: state.status } : {}), ...(state.admin && state.category ? { category: state.category } : {}) });
      if (!current(state, seq)) return; list.replaceChildren();
      if (!result.items?.length) notice(list, '등록된 문의가 없습니다.');
      for (const item of result.items || []) {
        const card = el(list, 'article', null, 'beta-support-card');
        el(card, 'span', `${categories[item.category] || '문의'} · ${statuses[item.status] || '상태 확인 필요'}`, 'beta-support-badge');
        button(card, item.title, () => showDetail(state, item.id));
        el(card, 'p', `최근 변경 ${date(item.updatedAt)} · 답변 ${item.replyCount || 0}개`, 'beta-support-meta');
      }
      const nav = el(list, 'div', null, 'beta-support-toolbar');
      if (offset) button(nav, '처음 목록', () => showList(state));
      if (Number.isInteger(result.nextOffset) && result.nextOffset > offset) button(nav, '다음 목록', () => showList(state, result.nextOffset));
    } catch (error) { if (current(state, seq)) { list.replaceChildren(); notice(list, errorText(error), true); } }
  }
  function showCreate(state) {
    const seq = start(state); if (seq == null) return;
    heading(state, '새 문의·피드백', true);
    notice(state.root, '발생한 상황과 원하는 도움을 적어 주세요. 문의 접수는 작품 공개 승인이나 PASS 본인확인을 대신하지 않습니다.');
    const form = el(state.root, 'form', null, 'beta-support-form');
    const category = select(form, '문의 유형', 'category', categories);
    const title = field(form, '제목 (3~120자)', 'title'); title.required = true; title.minLength = 3; title.maxLength = 120;
    const message = formMessage(form);
    const workId = field(form, '관련 작품 번호 (선택)', 'workId'); workId.inputMode = 'numeric'; workId.pattern = '[1-9][0-9]{0,17}'; workId.maxLength = 18;
    const help = notice(form, '작품 번호는 작품 주소에서 확인할 수 있습니다. 저작권 분쟁은 대상 작품과 권리 관계를 적어 주세요. 작품별 신고·제재 이의제기는 기존 신고·이의제기 메뉴와 연결해 검토합니다.');
    const label = el(form, 'label', null, 'beta-support-check');
    const confirm = el(label, 'input'); confirm.type = 'checkbox'; confirm.name = 'withdrawalConfirmed';
    el(label, 'span', '탈퇴 검토를 요청합니다. 이 접수만으로 계정이나 원고가 삭제되지 않으며, 보존 범위와 처리 결과를 관리자 답변으로 확인하겠습니다.');
    label.hidden = true;
    category.onchange = () => { label.hidden = category.value !== 'WITHDRAWAL'; confirm.required = !label.hidden; confirm.checked = false; help.hidden = category.value === 'WITHDRAWAL'; };
    const status = notice(form, '답변은 내 문의 목록에서 확인할 수 있습니다. 이 화면을 닫으면 보내지 않은 내용은 지워집니다.');
    const submit = button(form, '문의 접수', null, true); submit.type = 'submit';
    form.onsubmit = event => {
      event.preventDefault(); if (!current(state, seq) || state.busy) return;
      const data = { category: category.value, title: title.value.trim(), message: message.value.trim() };
      if (!categories[data.category] || data.title.length < 3 || data.title.length > 120 || data.message.length < 3 || data.message.length > 4000 ||
          (workId.value.trim() && !/^[1-9]\d{0,17}$/.test(workId.value.trim())) || (data.category === 'WITHDRAWAL' && !confirm.checked)) {
        status.textContent = '제목·내용의 글자 수, 작품 번호 및 필요한 동의를 확인해 주세요.'; status.setAttribute('role', 'alert'); return;
      }
      if (workId.value.trim()) data.workId = workId.value.trim();
      if (data.category === 'WITHDRAWAL') data.withdrawalConfirmed = true;
      return save(state, seq, form, status, 'create', data, result => showDetail(state, result.case.id, result, '', '문의가 접수되었습니다.'));
    };
    title.focus();
  }
  async function showDetail(state, id, supplied = null, draft = '', saved = '') {
    const seq = start(state); if (seq == null) return;
    heading(state, state.admin ? '문의 검토' : '문의 내역', true);
    const body = el(state.root, 'section', null, 'beta-support-detail'); notice(body, '문의 내용을 불러오는 중입니다…');
    try {
      const result = supplied || await get(state, 'detail', { id });
      if (!current(state, seq)) return; body.replaceChildren();
      const item = result.case; if (!item) throw Error('INVALID_SUPPORT_RESPONSE');
      el(body, 'h4', item.title); el(body, 'p', `${categories[item.category] || '문의'} · ${statuses[item.status] || '상태 확인 필요'}`, 'beta-support-badge');
      el(body, 'p', `문의 번호 ${item.id} · 접수 ${date(item.createdAt)}`, 'beta-support-meta');
      if (item.workId) el(body, 'p', '관련 작품 번호: ' + item.workId, 'beta-support-meta');
      if (saved) notice(body, saved);
      if (item.category === 'WITHDRAWAL') notice(body, '탈퇴 검토 요청입니다. 답변 완료·종결 상태도 실제 계정 삭제 완료를 뜻하지 않습니다. 처리 범위와 보존 안내는 관리자 답변을 확인해 주세요.');
      const history = el(body, 'ol', null, 'beta-support-history');
      for (const entry of result.messages || []) {
        const card = el(history, 'li', null, 'beta-support-message');
        el(card, 'p', `${entry.authorKind === 'ADMIN' ? '관리자' : '문의자'} · ${date(entry.createdAt)}`, 'beta-support-meta');
        if (entry.previousStatus && entry.status) el(card, 'p', `${statuses[entry.previousStatus] || '이전 상태'} → ${statuses[entry.status] || '변경 상태'}`, 'beta-support-badge');
        el(card, 'p', entry.message, 'beta-support-message-body');
      }
      if (state.admin) notice(body, '이 지원함의 답변·상태 변경은 계정 삭제, 콘텐츠 제재 또는 제재 해제를 실행하지 않습니다. 필요한 조치는 기존 신고·이의제기 메뉴에서 검토하세요.');
      if (!canWrite(state.admin)) { notice(body, '문의 조회 권한만 있습니다. 답변·처리에는 처리함 조회와 신고 처리 권한이 모두 필요합니다.'); return; }
      const actions = state.admin ? (['CLOSED', 'CANCELLED'].includes(item.status) ? {} : item.status === 'RESOLVED' ? { transition: '종결 및 사유 기록' } : { reply: '관리자 답변', transition: '상태 변경 및 사유 기록' }) : !terminal.has(item.status) ?
        { reply: '추가 답변', cancel: '문의 취소' } : ['RESOLVED', 'CLOSED'].includes(item.status) && Number(item.reopenCount || 0) < 2 ? { reopen: '처리 결과 재검토 요청' } : {};
      if (!Object.keys(actions).length) { notice(body, '이 문의에는 추가 답변을 보낼 수 없습니다. 재검토는 답변 완료·종결 후 최대 2회 가능합니다.'); return; }
      const form = el(body, 'form', null, 'beta-support-form');
      const action = select(form, '처리 방법', 'action', actions);
      let nextStatus;
      if (state.admin) {
        const transitions = item.status === 'RESOLVED' ? { CLOSED: statuses.CLOSED } : Object.fromEntries(Object.entries(statuses).filter(([value]) => value !== item.status && value !== 'CANCELLED'));
        nextStatus = select(form, '변경할 상태 (상태 변경을 선택한 경우)', 'nextStatus', transitions);
      }
      const message = formMessage(form); message.value = draft;
      const status = notice(form, state.admin ? '답변과 처리 사유는 문의자에게 표시됩니다.' : '답변 또는 재검토·취소 사유를 적어 주세요.');
      const submit = button(form, '선택한 내용 보내기', null, true); submit.type = 'submit';
      form.onsubmit = event => {
        event.preventDefault(); if (!current(state, seq) || state.busy) return;
        const content = message.value.trim();
        if (!actions[action.value] || content.length < 3 || content.length > 4000) { status.textContent = '내용을 3~4,000자로 입력해 주세요.'; status.setAttribute('role', 'alert'); return; }
        return save(state, seq, form, status, action.value, { id: item.id, revision: String(item.revision), message: content,
          ...(action.value === 'transition' ? { status: nextStatus.value } : {}) },
        result => showDetail(state, result.case.id, result, '', '저장했습니다. 아래 처리 상태와 이력을 확인해 주세요.'));
      };
    } catch (error) { if (current(state, seq)) { body.replaceChildren(); notice(body, errorText(error), true); button(body, '다시 불러오기', () => showDetail(state, id, null, draft)); } }
  }
  async function render(root, options = {}) {
    if (roots.has(root)) dispose(roots.get(root));
    root.replaceChildren();
    if (!canRead(!!options.admin)) { notice(root, options.admin ? '처리함 조회 권한이 필요합니다.' : '로그인한 회원은 문의·피드백을 이용할 수 있습니다. 먼저 로그인해 주세요.'); return; }
    const state = { root, admin: !!options.admin, user: actor().userId, isCurrent: options.isCurrent || (() => true), alive: true, seq: 0, busy: false, retry: null, status: '', category: '' };
    roots.set(root, state); await showList(state);
  }
  function close() {
    const modal = document.getElementById('betaSupportModal'), root = document.getElementById('betaSupportContent');
    if (root && roots.has(root)) dispose(roots.get(root)); else root?.replaceChildren();
    if (modal) modal.hidden = true;
    if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus(); returnFocus = null;
  }
  async function open() {
    const modal = document.getElementById('betaSupportModal'), root = document.getElementById('betaSupportContent');
    if (!modal || !root) return;
    if (modal.hidden) {
      returnFocus = document.activeElement;
      if (returnFocus?.closest?.('#modalMobileMore')) {
        window.closeModal?.('modalMobileMore');
        returnFocus = document.getElementById('bnavMore');
      }
    }
    modal.hidden = false; document.getElementById('betaSupportClose')?.focus();
    await render(root);
  }
  function reset(root) { if (root) { if (roots.has(root)) dispose(roots.get(root)); return; } for (const state of [...roots.values()]) dispose(state); close(); }
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-beta-support-open]')) { event.preventDefault(); open(); }
    if (event.target.closest?.('#betaSupportClose')) close();
  });
  document.addEventListener('keydown', event => {
    const modal = document.getElementById('betaSupportModal'); if (!modal || modal.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(node => !node.disabled && !node.hidden && !node.closest('[hidden]'));
      if (!focusable.length) { event.preventDefault(); modal.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });
  window.BetaSupport = Object.freeze({ open, close, render, reset });
})();
