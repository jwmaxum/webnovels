/* Read-only operational observations and a separately authorized support inbox. */
(function () {
  'use strict';
  const roots = new Map();
  const actor = () => window.WebNovelsAuth?.getActor();
  const can = permission => actor()?.admin?.is_active === true && (actor()?.admin?.role === 'SUPER_ADMIN' || actor()?.admin?.permissions?.includes(permission));
  function el(parent, tag, value, cls) { const node = document.createElement(tag); if (value != null) node.textContent = String(value); if (cls) node.className = cls; parent.append(node); return node; }
  const areaNames = { DRAFT: '원고 저장', UPLOAD: '이미지 업로드', PUBLICATION: '발행', ONBOARDING: '가입', SCHEDULER: '예약 작업' };
  const count = value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value).toLocaleString('ko-KR') : '확인 필요';
  const duration = value => value == null ? '관측 없음' : count(value) + 'ms';
  function current(state, seq) {
    if (roots.get(state.root) !== state || !state.isCurrent() || seq !== state.seq) return false;
    if (actor()?.userId !== state.user || !actor()?.admin) { reset(state.root); return false; }
    return true;
  }
  async function observations(state) {
    if (!current(state, state.seq)) return;
    const seq = ++state.seq, root = state.observations; root.replaceChildren();
    if (!can('OPERATIONS_READ')) { el(root, 'p', '운영 현황 조회 권한이 필요합니다.', 'beta-support-note'); return; }
    const heading = el(root, 'div', null, 'beta-support-toolbar'); el(heading, 'h3', '최근 24시간 운영 관측');
    const refresh = el(heading, 'button', '새로고침', 'btn btn-outline btn-sm'); refresh.type = 'button'; refresh.disabled = true; refresh.onclick = () => observations(state);
    const body = el(root, 'div'); const status = el(body, 'p', '운영 기록을 불러오는 중입니다…', 'beta-support-note'); status.setAttribute('role', 'status');
    try {
      const result = await window.WebNovelsAuth.api('/api/v2/admin/beta-operations');
      if (!current(state, seq) || !can('OPERATIONS_READ')) return; body.replaceChildren();
      if (!result.enabled) { el(body, 'p', '운영 관측이 아직 활성화되지 않았습니다. 문의 지원함은 별도로 이용할 수 있습니다.', 'beta-support-note'); return; }
      el(body, 'p', '수집된 대상 요청만 표시합니다. 전체 방문·가입 수 또는 사이트 전체 실패율을 뜻하지 않습니다. 문의 본문·원고·사용자 ID·IP·토큰은 이 관측 기록에 수집하지 않습니다.', 'beta-support-note');
      const cards = el(body, 'div', null, 'beta-operations-metrics');
      for (const [label, value] of [['관측 요청', count(result.summary.observedRequests)], ['실패', count(result.summary.failures)], ['저장 충돌', count(result.summary.conflicts)], ['평균 처리시간', duration(result.summary.averageDurationMs)]]) {
        const card = el(cards, 'div', null, 'beta-support-card'); el(card, 'span', label); el(card, 'strong', value);
      }
      const areas = el(body, 'ul', null, 'beta-operations-areas');
      for (const item of result.areas || []) el(areas, 'li', `${areaNames[item.area] || '기타'}: 요청 ${count(item.requests)} · 실패 ${count(item.failures)} · 충돌 ${count(item.conflicts)} · 평균 ${duration(item.averageDurationMs)}`);
      const queue = result.queue || {};
      el(body, 'p', `예약 대기 ${count(queue.pendingSchedules)} · 예약 실패 ${count(queue.failedSchedules)} · 이미지 처리 실패 ${count(queue.failedWebtoonAssets)}`, 'beta-support-note');
      el(body, 'p', '최근 운영 점검 신호: ' + (result.lastSchedulerHeartbeat ? new Date(result.lastSchedulerHeartbeat).toLocaleString('ko-KR') : '수신 기록 없음') + '. 점검 신호는 예약 발행 성공을 뜻하지 않습니다.', 'beta-support-meta');
      el(body, 'h4', '최근 오류 확인 번호');
      if (!result.recentErrors?.length) el(body, 'p', '수집된 오류가 없습니다.', 'beta-support-note');
      for (const item of result.recentErrors || []) {
        const card = el(body, 'div', null, 'beta-support-card');
        el(card, 'p', `${areaNames[item.area] || '기타'} · ${item.code} · HTTP ${item.status} · ${duration(item.durationMs)}`);
        el(card, 'p', `확인 번호 ${item.requestId} · ${new Date(item.createdAt).toLocaleString('ko-KR')}`, 'beta-support-meta');
      }
      el(body, 'p', `관측 기록 보존 ${count(result.retentionDays)}일 · 조회 ${new Date(result.observedAt).toLocaleString('ko-KR')}. 재처리 전에 작가의 최신 저장·예약 상태와 해당 확인 번호를 함께 확인하세요.`, 'beta-support-meta');
    } catch (error) {
      if (!current(state, seq)) return; body.replaceChildren();
      const message = error?.code === 'BETA_OPERATIONS_NOT_READY' ? '운영 관측이 준비 중입니다. 문의 지원함은 계속 이용할 수 있습니다.' : '운영 기록을 불러오지 못했습니다. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.';
      const node = el(body, 'p', message, 'beta-support-note'); node.setAttribute('role', 'status');
    } finally { if (current(state, seq)) refresh.disabled = false; }
  }
  async function render(root, options = {}) {
    reset(root); root.replaceChildren();
    if (!actor()?.admin || (!can('OPERATIONS_READ') && !can('CASE_READ'))) { el(root, 'p', '베타 운영을 조회할 권한이 없습니다.'); return; }
    const state = { root, user: actor().userId, isCurrent: options.isCurrent || (() => true), seq: 0 };
    roots.set(root, state); el(root, 'h2', '베타 운영');
    state.observations = el(root, 'section', null, 'beta-operations-panel');
    const support = el(root, 'section', null, 'beta-operations-panel'); state.support = support;
    const supportCurrent = () => roots.get(root) === state && state.isCurrent() && actor()?.userId === state.user;
    await Promise.all([observations(state), can('CASE_READ') ? window.BetaSupport.render(support, { admin: true, isCurrent: supportCurrent }) : Promise.resolve(el(support, 'p', '문의 지원함은 처리함 조회 권한이 필요합니다.', 'beta-support-note'))]);
  }
  function reset(root) {
    for (const [key, state] of [...roots]) if (!root || root === key) { state.seq++; window.BetaSupport?.reset(state.support); key.replaceChildren(); roots.delete(key); }
  }
  window.AdminBetaOperations = Object.freeze({ render, reset });
})();
