import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/js/core/beta-support.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../public/js/admin/admin-beta-operations.js', import.meta.url), 'utf8');
class Node {
  constructor(tag, document) { this.tag = tag; this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.attributes = {}; this.value = ''; this.disabled = false; this.hidden = false; this.checked = false; this._text = ''; this.parent = null; }
  set textContent(value) { this._text = String(value); this.children.forEach(n => { n.parent = null; }); this.children = []; }
  get textContent() { return this._text; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parent = this; } }
  replaceChildren(...nodes) { this.children.forEach(n => { n.parent = null; }); this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  get isConnected() { return this === this.document.body || !!this.parent?.isConnected; }
  matches(selector) { return selector === '[hidden]' ? this.hidden : selector.startsWith('#') ? this.id === selector.slice(1) : selector.startsWith('[') ? selector.slice(1, -1) in this.attributes : selector === this.tag; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(n => [...(selector.split(',').some(part => n.matches(part)) ? [n] : []), ...n.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return this === node || this.children.some(n => n.contains(node)); }
  focus() { this.document.activeElement = this; }
  set innerHTML(value) { assert.fail('Support must render plain text rather than HTML'); }
}
const caseId = '3d80dc4b-0aa0-4e41-8da2-bdd5acc2daf1';
const sample = (extra = {}) => ({ id: caseId, category: 'QUESTION', title: '작품 이용 문의', status: 'OPEN', revision: '1', createdAt: '2026-10-22T01:00:00Z', updatedAt: '2026-10-22T01:00:00Z', replyCount: 0, reopenCount: 0, ...extra });
const detail = (extra = {}) => ({ case: sample(extra), messages: [{ id: 'message1', kind: 'CREATED', authorKind: 'USER', message: '문의 내용입니다.', createdAt: '2026-10-22T01:00:00Z' }] });
const text = node => node.textContent + ' ' + node.children.map(text).join(' ');
const button = (root, value) => root.querySelectorAll('button').find(n => n.textContent === value);
const field = (root, name) => root.querySelectorAll('input,select,textarea').find(n => n.name === name);
const submit = form => form.onsubmit({ preventDefault() {} });
function setup({ admin = false, permissions = ['CASE_READ', 'CASE_RESOLVE', 'OPERATIONS_READ'], api } = {}) {
  const events = {}, document = { addEventListener: (name, fn) => { events[name] = fn; } };
  document.createElement = tag => new Node(tag, document); document.body = document.createElement('body'); document.activeElement = document.body;
  document.getElementById = id => document.body.querySelector('#' + id);
  const root = document.createElement('div'); document.body.append(root);
  let who = { userId: 'reader-auth-uuid', accountServiceOnly: true, accountServiceReady: true, ...(admin ? { admin: { role: 'SUB_ADMIN', permissions, is_active: true } } : {}) }, serial = 0;
  const calls = [];
  const context = { document, URLSearchParams, crypto: { randomUUID: () => `3d80dc4b-0aa0-4e41-8da2-${String(++serial).padStart(12, '0')}` }, WebNovelsAuth: { getActor: () => who, api: async (path, options) => {
    const call = { path, action: new URL('https://example.test' + path).searchParams.get('action'), payload: options ? JSON.parse(options.body) : undefined };
    calls.push(call); if (api) return api(call);
    if (call.action === 'list') return { items: [sample()], nextOffset: null };
    return detail();
  } }, WEBNOVELS_CONFIG: { publicBetaEnabled: false, adminOperationsEnabled: false } };
  context.window = context; vm.createContext(context); vm.runInContext(source, context); vm.runInContext(adminSource, context);
  return { root, calls, context, events, document, setActor(value) { who = value; }, render(options = {}) { return context.BetaSupport.render(root, { admin, ...options }); } };
}
async function createForm(s) { await s.render(); button(s.root, '새 문의').onclick(); return s.root.querySelector('form'); }
async function openDetail(s) { await s.render(); await button(s.root, '작품 이용 문의').onclick(); return s.root.querySelector('form'); }

test('account-only reader support works while public beta is closed; unsafe text is rendered as text', async () => {
  const s = setup({ api: call => call.action === 'list' ? { items: [sample({ title: '<img src=x onerror=alert(1)>' })], nextOffset: null } : detail() });
  await s.render(); assert.equal(s.calls[0].path, '/api/v2/support?action=list&offset=0');
  assert.match(text(s.root), /<img src=x onerror=alert\(1\)>/); assert.ok(button(s.root, '새 문의'));
  assert.equal(s.root.querySelectorAll('img').length, 0);
});

test('withdrawal requires explicit confirmation and sends only entered fields with an idempotency ID', async () => {
  const s = setup(); const form = await createForm(s);
  field(form, 'title').value = '탈퇴를 요청합니다'; field(form, 'message').value = '보존 범위를 먼저 안내해 주세요.';
  field(form, 'category').value = 'WITHDRAWAL'; field(form, 'category').onchange();
  await submit(form); assert.equal(s.calls.filter(c => c.payload).length, 0);
  assert.match(text(s.root), /계정이나 원고가 삭제되지 않으며/);
  field(form, 'withdrawalConfirmed').checked = true; await submit(form);
  const sent = s.calls.find(c => c.payload).payload;
  assert.deepEqual(Object.keys(sent).sort(), ['category', 'message', 'requestId', 'title', 'withdrawalConfirmed']);
  assert.equal(sent.withdrawalConfirmed, true); assert.match(sent.requestId, /^[a-f\d-]{36}$/);
  assert.match(text(s.root), /문의가 접수되었습니다/);
});

test('unknown response retries the same request ID; concurrent clicks send only once', async () => {
  let release, attempts = 0;
  const s = setup({ api: call => {
    if (call.action === 'list') return { items: [], nextOffset: null };
    if (++attempts === 1) return new Promise((resolve, reject) => { release = () => reject(new Error('network')); });
    return detail();
  } });
  const form = await createForm(s); field(form, 'title').value = '오류 제보입니다'; field(form, 'message').value = '이미지 업로드가 멈췄습니다.';
  const pending = submit(form); await submit(form); assert.equal(s.calls.filter(c => c.payload).length, 1);
  assert.ok(form.querySelectorAll('input,textarea,select,button').every(n => n.disabled));
  release(); await pending; await submit(form);
  const posts = s.calls.filter(c => c.payload); assert.equal(posts.length, 2); assert.equal(posts[0].payload.requestId, posts[1].payload.requestId);
  assert.match(text(s.root), /문의가 접수되었습니다/);
});

test('conflict prevents resubmission until reload and carries the unsent reply into the latest revision', async () => {
  let reads = 0;
  const s = setup({ api: call => {
    if (call.action === 'list') return { items: [sample()], nextOffset: null };
    if (call.action === 'detail') return detail({ revision: String(++reads) });
    throw Object.assign(new Error(), { code: 'CONFLICT' });
  } });
  const form = await openDetail(s); field(form, 'message').value = '추가 설명을 보냅니다'; await submit(form);
  assert.match(text(s.root), /입력한 내용은 유지/); assert.equal(button(form, '선택한 내용 보내기').disabled, true);
  await submit(form); assert.equal(s.calls.filter(c => c.payload).length, 1);
  await button(s.root, '최신 내용 불러오기').onclick();
  assert.equal(field(s.root, 'message').value, '추가 설명을 보냅니다'); assert.equal(button(s.root, '선택한 내용 보내기').disabled, false);
  await submit(s.root.querySelector('form')); assert.equal(s.calls.at(-1).payload.revision, '2');
});

test('late response after account change clears private DOM and cannot repaint it', async () => {
  let release;
  const s = setup({ api: call => call.action === 'list' ? { items: [sample()], nextOffset: null } : new Promise(resolve => { release = resolve; }) });
  await s.render(); const pending = button(s.root, '작품 이용 문의').onclick();
  s.setActor({ userId: 'another-user' }); release(detail()); await pending;
  assert.equal(s.root.children.length, 0);
});

test('reset blanks unsent fields, discards pending writes and blocks stale form submission', async () => {
  let release;
  const s = setup({ api: call => call.action === 'list' ? { items: [], nextOffset: null } : new Promise(resolve => { release = resolve; }) });
  const form = await createForm(s); field(form, 'title').value = '비공개 제목'; const message = field(form, 'message'); message.value = '비공개 문의 내용';
  const pending = submit(form); s.context.BetaSupport.reset(); assert.equal(message.value, '');
  release(detail()); await pending; await submit(form);
  assert.equal(s.root.children.length, 0); assert.equal(s.calls.filter(c => c.payload).length, 1);
});

test('view generation ignores late list responses after opening new inquiry', async () => {
  let release; const s = setup({ api: () => new Promise(resolve => { release = resolve; }) });
  const pending = s.render(); button(s.root, '새 문의').onclick(); field(s.root, 'title').value = '작성 중 제목';
  release({ items: [sample()], nextOffset: null }); await pending;
  assert.equal(field(s.root, 'title').value, '작성 중 제목'); assert.ok(s.root.querySelector('form'));
});

test('resolved inquiries can be reopened twice and cancellation does not offer deletion', async () => {
  for (const reopenCount of [0, 2]) {
    const s = setup({ api: call => call.action === 'list' ? { items: [sample()], nextOffset: null } : detail({ status: 'RESOLVED', category: 'WITHDRAWAL', reopenCount }) });
    await openDetail(s); assert.match(text(s.root), /실제 계정 삭제 완료를 뜻하지 않습니다/);
    if (reopenCount === 0) { assert.equal(field(s.root, 'action').value, 'reopen'); field(s.root, 'message').value = '재검토 사유입니다'; await submit(s.root.querySelector('form')); assert.equal(s.calls.at(-1).action, 'reopen'); }
    else assert.equal(s.root.querySelector('form'), null);
  }
});

test('admin read and write rights are independent; no requests without CASE_READ', async () => {
  const denied = setup({ admin: true, permissions: ['CASE_RESOLVE'] }); await denied.render(); assert.equal(denied.calls.length, 0);
  const readOnly = setup({ admin: true, permissions: ['CASE_READ'] }); await openDetail(readOnly);
  assert.equal(readOnly.root.querySelector('form'), null); assert.match(text(readOnly.root), /조회 권한만/);
  const admin = setup({ admin: true }); const form = await openDetail(admin);
  field(form, 'action').value = 'transition'; field(form, 'nextStatus').value = 'WAITING_USER'; field(form, 'message').value = '오류 확인 번호를 알려 주세요.';
  await submit(form); assert.equal(admin.calls.at(-1).path, '/api/v2/admin/support?action=transition');
  assert.equal(admin.calls.at(-1).payload.status, 'WAITING_USER'); assert.equal(admin.calls.at(-1).payload.revision, '1');
});

test('admin terminal transitions match the server contract', async () => {
  for (const status of ['RESOLVED', 'CLOSED', 'CANCELLED']) {
    const s = setup({ admin: true, api: call => call.action === 'list' ? { items: [sample()], nextOffset: null } : detail({ status }) });
    await openDetail(s);
    if (status === 'RESOLVED') { assert.deepEqual(field(s.root, 'nextStatus').children.map(n => n.value), ['CLOSED']); assert.equal(field(s.root, 'action').value, 'transition'); }
    else assert.equal(s.root.querySelector('form'), null);
  }
});

test('operations failure does not prevent support; metrics remain observed-only and read-only', async () => {
  const s = setup({ admin: true, api: call => {
    if (call.path === '/api/v2/admin/beta-operations') throw Object.assign(new Error(), { code: 'BETA_OPERATIONS_NOT_READY' });
    return { items: [sample()], nextOffset: null };
  } });
  await s.context.AdminBetaOperations.render(s.root); assert.match(text(s.root), /운영 관측이 준비 중/); assert.match(text(s.root), /작품 이용 문의/);
  const m = setup({ admin: true, permissions: ['OPERATIONS_READ'], api: () => ({ enabled: true, observedAt: '2026-10-22T01:00:00Z', retentionDays: 7, summary: { observedRequests: 20, failures: 2, conflicts: 1, averageDurationMs: 25 }, areas: [], recentErrors: [], queue: { pendingSchedules: 3, failedSchedules: 1, failedWebtoonAssets: 2 }, lastSchedulerHeartbeat: null }) });
  await m.context.AdminBetaOperations.render(m.root); assert.equal(m.calls.length, 1);
  assert.match(text(m.root), /사이트 전체 실패율을 뜻하지 않습니다/); assert.match(text(m.root), /예약 대기 3/); assert.ok(m.calls.every(c => !c.payload));
});

test('operations resets private support and ignores a late metrics response across tabs', async () => {
  let release, active = true;
  const s = setup({ admin: true, api: call => call.path === '/api/v2/admin/beta-operations' ? new Promise(resolve => { release = resolve; }) : { items: [sample()], nextOffset: null } });
  const pending = s.context.AdminBetaOperations.render(s.root, { isCurrent: () => active });
  active = false; s.context.AdminBetaOperations.reset(); release({ enabled: false }); await pending;
  assert.equal(s.root.children.length, 0);
});

test('modal restores focus, traps keyboard focus and clears private content on Escape', async () => {
  const s = setup(); const trigger = s.document.createElement('button'); s.document.body.append(trigger); trigger.focus();
  const modal = s.document.createElement('div'); modal.id = 'betaSupportModal'; modal.hidden = true;
  const close = s.document.createElement('button'); close.id = 'betaSupportClose';
  const content = s.document.createElement('div'); content.id = 'betaSupportContent'; modal.append(close, content); s.document.body.append(modal);
  await s.context.BetaSupport.open(); assert.equal(modal.hidden, false); assert.equal(s.document.activeElement, close);
  const last = modal.querySelectorAll('button').at(-1); last.focus(); let prevented = false;
  s.events.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(s.document.activeElement, close);
  s.events.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(modal.hidden, true); assert.equal(s.document.activeElement, trigger); assert.equal(content.children.length, 0);
});

test('HTML and lazy loader wire support to reader, author and administrator without changing author contracts', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const loader = await readFile(new URL('../public/js/core/role-modules.js', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../public/js/admin/admin-operations.js', import.meta.url), 'utf8');
  assert.equal((html.match(/data-beta-support-open/g) || []).length, 4);
  assert.match(html, /auth-session\.js\?v=136/);
  assert.match(html, /aria-modal="true" aria-labelledby="betaSupportTitle"/);
  assert.ok(html.indexOf('auth-session.js') < html.indexOf('beta-support.js'));
  assert.ok(loader.indexOf('admin-beta-operations.js') < loader.indexOf('admin-operations.js'));
  assert.match(admin, /\['beta-operations','베타 운영'/); assert.match(admin, /AdminBetaOperations\?\.reset/);
  assert.doesNotMatch(source, /localStorage|innerHTML|\/api\/v2\/author\//);
});
