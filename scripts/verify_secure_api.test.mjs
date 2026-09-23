import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecureApi } from '../server/secure-api.mjs';

const uid = '11111111-1111-4111-8111-111111111111';
const env = { P0_API_ENABLED: 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test_server_only' };
function setup(options = {}) {
  const calls = [];
  const work = { id: 1, author_id: 20, title: 'Stored DB work', status: 'PUBLISHED', rating: 'ALL', genre: ['판타지'] };
  const episode = { id: 3, work_id: 1, title: 'Stored episode', status: 'PUBLISHED', is_free: true, access_policy: 'FREE', scheduled_at: null };
  const reader = { id: 10, auth_user_id: uid, username: 'reader', status: 'ACTIVE', is_adult_verified: false };
  const tables = {
    p0_migration_status: [{ version: 'p0-20260921', phase: 'locked' }],
    readers: [reader], authors: [], admin_users: [], works: [work], episodes: [episode],
    secure_episode_contents: [{ episode_id: 3, content: 'Existing protected body', image_urls: [] }], p0_episode_entitlements: [],
    system_config: [{ id: 'default', service_name: 'WebNovels' }], p0_identity_verifications: []
  };
  Object.assign(tables, options.tables || {});
  const api = createSecureApi({ now: () => Date.parse('2026-09-21T00:00:00Z'), fetchImpl: async (input, init) => {
    const url = new URL(input); const table = url.pathname.split('/').pop();
    calls.push({ url, method: init.method || 'GET', body: init.body && JSON.parse(init.body), headers: init.headers });
    if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify(options.user || { id: uid, email_confirmed_at: '2026-09-20' }), { status: options.authStatus || 200 });
    assert.equal(init.headers.apikey, env.SUPABASE_SECRET_KEY);
    if (options.dbError && table === options.dbError) return new Response('upstream secret information', { status: 500 });
    if (table === 'consume_authoring_signup_attempt') return Response.json(!options.rateLimited);
    if (table === 'authoring_signup_ready') return Response.json(true);
    if (table === 'complete_authoring_signup') {
      const input = JSON.parse(init.body); tables.authors = [author()]; return Response.json({ created: true });
    }
    let rows = tables[table]; assert.ok(rows, 'Unexpected table access: ' + table);
    if (init.method === 'PATCH') {
      if (options.writeConflict) rows = [];
      else rows = rows.map(row => ({ ...row, ...JSON.parse(init.body) }));
    }
    const fields = url.searchParams.get('select')?.split(',');
    if (fields) rows = rows.map(row => Object.fromEntries(fields.filter(field => field in row).map(field => [field, row[field]])));
    return Response.json(rows);
  }});
  const request = (path, { token = 'header.payload.signature', method = 'GET', body, origin, bindings = env } = {}) => api(new Request('https://webnovels-db4.pages.dev/api/v2' + path, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), bindings);
  return { request, calls, tables, work, episode, reader };
}
const author = (id = 20) => ({ id, auth_user_id: uid, status: 'APPROVED', pen_name: 'author' });
const admin = (role = 'SUPER_ADMIN', permissions = []) => ({ id: 50, auth_user_id: uid, role, permissions, is_active: true });

test('missing activation or migration cannot open service-role API', async () => {
  const s = setup(); assert.equal((await s.request('/me', { bindings: { ...env, P0_API_ENABLED: 'false' } })).status, 503); assert.equal(s.calls.length, 0);
  s.tables.p0_migration_status[0].phase = 'expanded'; assert.equal((await s.request('/me')).status, 503);
});
test('publishable key cannot be used as server authority', async () => {
  const s = setup(); assert.equal((await s.request('/me', { bindings: { ...env, SUPABASE_SECRET_KEY: 'sb_publishable_bad' } })).status, 503); assert.equal(s.calls.length, 0);
});
test('fake/localStorage token and missing token rejected before private queries', async () => {
  for (const token of [null, 'admin-token-1', 'reader-1', 'author-1']) {
    const s = setup(); assert.equal((await s.request('/me', { token })).status, 401);
    assert.ok(s.calls.every(c => c.url.pathname.endsWith('p0_migration_status')));
  }
});
test('forged or expired JWT rejected by Supabase Auth', async () => {
  const s = setup({ authStatus: 401 }); assert.equal((await s.request('/me')).status, 401);
  assert.equal(s.calls.filter(c => c.url.pathname.startsWith('/rest/v1/readers')).length, 0);
});
test('valid Auth identity is mapped using UUID, not request parameters', async () => {
  const s = setup(); const r = await s.request('/me?user_id=other&role=SUPER_ADMIN'); assert.equal(r.status, 200);
  assert.equal((await r.json()).userId, uid);
  for (const c of s.calls.filter(c => ['readers', 'authors', 'admin_users'].includes(c.url.pathname.split('/').pop()))) assert.equal(c.url.searchParams.get('auth_user_id'), 'eq.' + uid);
});
test('unlinked, blocked and anonymous Auth accounts rejected', async () => {
  const unlinked = setup({ tables: { readers: [] } }); assert.equal((await unlinked.request('/me')).status, 403);
  const blocked = setup(); blocked.reader.status = 'SUSPENDED'; assert.equal((await blocked.request('/me')).status, 403);
  const anon = setup({ user: { id: uid, is_anonymous: true } }); assert.equal((await anon.request('/me')).status, 401);
});
test('duplicate mapping fails closed', async () => {
  const s = setup(); s.tables.readers.push({ ...s.reader, id: 11 }); assert.equal((await s.request('/me')).status, 503);
});
test('reader cannot list users or mutate content', async () => {
  const s = setup(); assert.equal((await s.request('/admin/readers')).status, 403);
  assert.equal((await s.request('/works/1', { method: 'PATCH', body: { title: 'changed' } })).status, 403);
  assert.equal(s.calls.filter(c => c.method === 'PATCH').length, 0);
});
test('another author cannot edit this work or its draft', async () => {
  const s = setup({ tables: { authors: [author(99)] } }); s.episode.status = 'DRAFT';
  assert.equal((await s.request('/works/1', { method: 'PATCH', body: { title: 'changed' } })).status, 403);
  assert.equal((await s.request('/episodes/3', { method: 'PATCH', body: { content: 'stolen' } })).status, 403);
});
test('owner may edit metadata, but cannot change owner, publish or inflate counts', async () => {
  const s = setup({ tables: { authors: [author()] } });
  assert.equal((await s.request('/works/1', { method: 'PATCH', body: { title: 'New title' } })).status, 200);
  assert.equal(s.calls.find(c => c.method === 'PATCH').url.searchParams.get('author_id'), 'eq.20');
  for (const body of [{ author_id: 99 }, { status: 'PUBLISHED' }, { view_count: 9999 }, { title: '' }]) assert.equal((await s.request('/works/1', { method: 'PATCH', body })).status, 400);
});
test('author cannot directly replace published body; draft writes mirror atomically', async () => {
  const s = setup({ tables: { authors: [author()] } });
  assert.equal((await s.request('/episodes/3', { method: 'PATCH', body: { content: 'edit' } })).status, 403);
  s.episode.status = 'DRAFT';
  assert.equal((await s.request('/episodes/3', { method: 'PATCH', body: { title: 'draft', content: 'edit' } })).status, 200);
  const writes = s.calls.filter(c => c.method === 'PATCH'); assert.equal(writes.length, 1); assert.equal(writes[0].url.searchParams.get('status'), 'eq.DRAFT');
});
test('revoked admin role and permission changes checked on each request', async () => {
  const a = admin('SUB_ADMIN', ['USERS_READ']); const s = setup({ tables: { admin_users: [a] } });
  assert.equal((await s.request('/admin/readers')).status, 200); a.permissions = [];
  assert.equal((await s.request('/admin/readers')).status, 403); a.is_active = false;
  assert.equal((await s.request('/me')).status, 403);
});
test('admin responses never select password or provider secret', async () => {
  const s = setup({ tables: { admin_users: [admin()] } });
  const r = await s.request('/admin/config'); assert.equal(r.status, 200); assert.ok(!(await r.text()).includes('secret'));
  await s.request('/admin/readers');
  assert.ok(s.calls.every(c => !/password|secret_key|site_key|\*/.test(c.url.searchParams.get('select') || '')));
});
test('free published episode body is fetched from protected table, not fake content', async () => {
  const s = setup(); const r = await s.request('/episodes/3/content', { token: null }); assert.equal(r.status, 200);
  assert.equal((await r.json()).episode.content, 'Existing protected body');
  assert.ok(s.calls.find(c => c.url.pathname.endsWith('secure_episode_contents')));
});
test('paid, conflicting-free, adult, hidden and future body access denied before body query', async () => {
  for (const mutate of [s => { s.episode.is_free = false; s.episode.access_policy = 'PAID'; }, s => { s.episode.access_policy = 'PAID'; }, s => { s.work.rating = 'AGE_19'; }, s => { s.work.status = 'DRAFT'; }, s => { s.episode.status = 'DRAFT'; }, s => { s.episode.scheduled_at = '2099-01-01'; }, s => { s.episode.scheduled_at = 'broken'; }]) {
    const s = setup(); mutate(s); const r = await s.request('/episodes/3/content', { token: null }); assert.ok([401,403,404].includes(r.status));
    assert.ok(!s.calls.find(c => c.url.pathname.endsWith('secure_episode_contents')));
  }
});
test('paid entitlement scoped to verified user and expiry/revocation', async () => {
  const s = setup(); s.episode.is_free = false; s.episode.access_policy = 'PAID';
  assert.equal((await s.request('/episodes/3/content')).status, 403);
  s.tables.p0_episode_entitlements = [{ id: 'grant' }];
  assert.equal((await s.request('/episodes/3/content')).status, 200);
  const query = s.calls.find(c => c.url.pathname.endsWith('p0_episode_entitlements')).url.searchParams;
  assert.equal(query.get('auth_user_id'), 'eq.' + uid); assert.equal(query.get('revoked_at'), 'is.null'); assert.match(query.get('or'), /expires_at.gt/);
});
test('adult verification cannot be supplied by client flags', async () => {
  const s = setup(); s.work.rating = 'AGE_19';
  assert.equal((await s.request('/episodes/3/content?isAdultVerified=true')).status, 403);
  s.reader.is_adult_verified = true; s.reader.adult_verified_at = '2026-01-01';
  assert.equal((await s.request('/episodes/3/content')).status, 403, 'Legacy adult flags are not provider evidence');
  s.tables.p0_identity_verifications = [{ id: 'verified-live-provider-record' }];
  assert.equal((await s.request('/episodes/3/content')).status, 200);
  const q = s.calls.find(c => c.url.pathname.endsWith('p0_identity_verifications')).url.searchParams;
  assert.equal(q.get('provider_mode'), 'eq.LIVE'); assert.equal(q.get('revoked_at'), 'is.null'); assert.match(q.get('expires_at'), /^gt\./);
});
test('admin must supply consistent free policy and valid types', async () => {
  const s = setup({ tables: { admin_users: [admin()] } });
  for (const body of [{ is_free: true, access_policy: 'PAID' }, { is_free: 'true', access_policy: 'FREE' }, { is_ad_free: true }, { image_urls: ['javascript:bad'] }]) assert.equal((await s.request('/episodes/3', { method: 'PATCH', body })).status, 400);
  assert.equal((await s.request('/episodes/3', { method: 'PATCH', body: { is_free: true, access_policy: 'FREE' } })).status, 200);
});
test('zero-row write is not reported as successful', async () => {
  const s = setup({ tables: { authors: [author()] }, writeConflict: true }); assert.equal((await s.request('/works/1', { method: 'PATCH', body: { title: 'Changed' } })).status, 409);
});
test('cross-origin mutation blocked and upstream errors redacted', async () => {
  const s = setup(); assert.equal((await s.request('/works/1', { method: 'PATCH', body: { title: 'bad' }, origin: 'https://attacker.example' })).status, 403);
  const broken = setup({ dbError: 'readers' }); const r = await broken.request('/me'); assert.equal(r.status, 503); assert.ok(!(await r.text()).includes('upstream secret'));
});
test('unintegrated money and identity endpoints never fake success', async () => {
  const s = setup(); for (const path of ['/payments/confirm','/ads/verify','/adult-verification/confirm','/settlements','/support']) assert.equal((await s.request(path, { method: 'POST', body: {} })).status, 503);
});

const onboardingEnv = { ...env, AUTH_ONBOARDING_ENABLED: 'true' };
const onboarding = { method:'POST', origin:'https://webnovels-db4.pages.dev', bindings:onboardingEnv, body:{kind:'author',displayName:'작가이름'} };
test('onboarding requires activation, exact Origin, confirmed Auth and distributed limiter', async () => {
  const s = setup({user:{id:uid,email:'new@example.test',email_confirmed_at:'2026-09-20'}});
  for (const [change,code] of [
    [{bindings:env},503], [{origin:undefined},403], [{origin:'https://evil.test'},403],

  ]) assert.equal((await s.request('/onboarding',{...onboarding,...change})).status,code);
  assert.equal(s.calls.filter(c=>c.url.pathname.includes('/rpc/')).length,0);
  const unconfirmed=setup({user:{id:uid,email:'new@example.test'}});
  assert.equal((await unconfirmed.request('/onboarding',onboarding)).status,403);
});
test('onboarding ignores no authority fields, retries with server identity and returns actor',async()=>{
  const s=setup({user:{id:uid,email:'new@example.test',email_confirmed_at:'2026-09-20'},tables:{readers:[]}});
  for(const extra of [{role:'SUPER_ADMIN'},{userId:'other'},{status:'APPROVED'},{email:'other@example.test'}]) {
    assert.equal((await s.request('/onboarding',{...onboarding,body:{...onboarding.body,...extra}})).status,400);
  }
  for(let i=0;i<2;i++) {
    const response=await s.request('/onboarding',onboarding);assert.equal(response.status,200);
    assert.ok(response.headers.get('X-Request-ID'));assert.equal((await response.json()).actor.author.id,20);
  }
  const writes=s.calls.filter(c=>c.url.pathname.endsWith('/complete_authoring_signup'));
  assert.equal(writes.length,2);assert.deepEqual(writes[0].body,{p_user_id:uid,p_kind:'author',p_display_name:'작가이름'});
});
test('upstream auth failure differs from expired session and includes safe request identifier',async()=>{
  const s=setup({authStatus:500});const response=await s.request('/me');assert.equal(response.status,503);
  const body=await response.json();assert.equal(body.error,'AUTH_UNAVAILABLE');assert.equal(body.requestId,response.headers.get('X-Request-ID'));
});

test('distributed onboarding counter rejects repeated attempts with retry hint',async()=>{
  const s=setup({rateLimited:true,user:{id:uid,email:'new@example.test',email_confirmed_at:'2026-09-20'}});
  const response=await s.request('/onboarding',onboarding);assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
  assert.ok(!s.calls.some(c=>c.url.pathname.endsWith('/complete_authoring_signup')));
});
test('creator cutover closes legacy owner write paths instead of bypassing work state/version',async()=>{
  const s=setup({tables:{authors:[author()]}});const bindings={...env,AUTHOR_WORKS_ENABLED:'true'};
  assert.equal((await s.request('/works/1',{method:'PATCH',body:{title:'legacy'},bindings})).status,409);
  s.episode.status='DRAFT';
  assert.equal((await s.request('/episodes/3',{method:'PATCH',body:{content:'legacy'},bindings})).status,503);
  assert.ok(!s.calls.some(c=>c.method==='PATCH'));
});
