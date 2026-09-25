// Cloudflare-compatible Web API. No Express, SQLite, Node runtime, or client role trust.
import { creatorWorkApi } from './creator-work-api.mjs';
import { creatorDraftApi } from './creator-draft-api.mjs';
import { creatorFileApi } from './creator-file-api.mjs';
import { creatorPublicationApi } from './creator-publication-api.mjs';
import { stage8Api } from './stage8-api.mjs';
import { stage9Api } from './stage9-api.mjs';
import { stage9AppealApi } from './stage9-appeal-api.mjs';
import { accountApi } from './account-api.mjs';
const WORK_FIELDS = 'id,title,author,author_id,genre,tags,description,cover_image,view_count,like_count,created_at,status,is_top_recommended,is_popular_work,is_new_work,content_type,is_completed,rating,ai_usage_type,published_at';
const EPISODE_FIELDS = 'id,work_id,episode_number,title,is_free,is_ad_free,author_comment,status,scheduled_at,access_policy,view_count,created_at';
const READER_FIELDS = 'id,auth_user_id,username,nickname,status,is_adult_verified,adult_verified_at,points';
const AUTHOR_FIELDS = 'id,auth_user_id,username,pen_name,profile_image,bio,status';
const ADMIN_FIELDS = 'id,auth_user_id,username,nickname,role,permissions,is_active';
const PUBLIC_STATES = new Set(['PUBLISHED', 'ONGOING', 'PAUSED', 'COMPLETED']);
const SCHEMA_VERSION = 'p0-20260921';

class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new ApiError(status, code); };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const one = rows => Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
const equalId = (a, b) => a != null && b != null && String(a) === String(b);
const activeReader = reader => reader && reader.status === 'ACTIVE';
const activeAuthor = author => author && author.status === 'APPROVED';
const isPublished = (work, episode, now) => PUBLIC_STATES.has(work.status) && episode.status === 'PUBLISHED' &&
  (!episode.scheduled_at || (Number.isFinite(Date.parse(episode.scheduled_at)) && Date.parse(episode.scheduled_at) <= now));
const isAdult = work => ['AGE_19', 'ADULT', '19'].includes(work.rating) ||
  (Array.isArray(work.genre) ? work.genre : [work.genre]).some(g => ['성인', '19세 이상'].includes(g));

function validId(value) {
  if (!/^[1-9]\d{0,18}$/.test(String(value))) fail(400, 'INVALID_ID');
  return String(value);
}
function owns(actor, work) { return activeAuthor(actor?.author) && equalId(actor.author.id, work.author_id); }
async function readBody(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail(415, 'JSON_REQUIRED');
  if (Number(request.headers.get('content-length')) > 1_000_000) fail(413, 'BODY_TOO_LARGE');
  // Bound streamed requests too; Content-Length is untrusted and may be absent.
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'BODY_REQUIRED');
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  const merged = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(merged)); } catch { fail(400, 'INVALID_JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_JSON');
  return body;
}
export function createSecureApi({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  return async function handle(request, env) {
    const accountResponse = await accountApi(request, env, { fetchImpl });
    if (accountResponse) return accountResponse;
    const requestId = crypto.randomUUID();
    const reply = (data, status = 200) => {
      const response = json(data, status);
      response.headers.set('X-Request-ID', requestId);
      if (status === 429) response.headers.set('Retry-After', '60');
      return response;
    };
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/v2/')) return reply({ error: 'NOT_FOUND' }, 404);
      if (env.P0_API_ENABLED !== 'true') fail(503, 'SECURE_API_NOT_ACTIVATED');
      const base = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
      const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
      if (!base || !secret || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base)) fail(503, 'SERVER_CONFIGURATION_REQUIRED');
      if (!secret.startsWith('sb_secret_')) {
        // A publishable/anon key must never silently become the server key.
        try {
          if (JSON.parse(atob(secret.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'service_role') fail(503, 'SERVER_CONFIGURATION_REQUIRED');
        } catch { fail(503, 'SERVER_CONFIGURATION_REQUIRED'); }
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) fail(403, 'ORIGIN_FORBIDDEN');
      }
      const serviceHeaders = { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: 'Bearer ' + secret } : {}) };
      async function db(table, query, { method = 'GET', body } = {}) {
        const response = await fetchImpl(new URL('/rest/v1/' + table + '?' + new URLSearchParams(query), base), {
          method, headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) fail(response.status === 409 ? 409 : response.status === 403 ? 403 : 503, response.status === 409 ? 'CONFLICT' : response.status === 403 ? 'ACCOUNT_INACTIVE' : 'DATABASE_UNAVAILABLE');
        if (response.status === 204) return [];
        return response.json();
      }
      const version = one(await db('p0_migration_status', { select: 'version,phase', version: 'eq.' + SCHEMA_VERSION, limit: '1' }));
      if (version?.phase !== 'locked') fail(503, 'DATABASE_SECURITY_MIGRATION_REQUIRED');
      if (url.pathname === '/api/v2/health' && request.method === 'GET') return reply({ status: 'ok', securityVersion: SCHEMA_VERSION });

      let userPromise;
      async function authenticatedUser() {
        const auth = request.headers.get('authorization');
        if (!auth) fail(401, 'AUTH_REQUIRED');
        if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth)) fail(401, 'INVALID_SESSION');
        if (!userPromise) userPromise = (async () => {
          let response;
          try { response = await fetchImpl(new URL('/auth/v1/user', base), { headers: { apikey: secret, Authorization: auth }, signal: AbortSignal.timeout(8000) }); }
          catch { fail(503, 'AUTH_UNAVAILABLE'); }
          if (!response.ok) fail([401,403].includes(response.status) ? 401 : 503, [401,403].includes(response.status) ? 'INVALID_SESSION' : 'AUTH_UNAVAILABLE');
          const user = await response.json();
          if (!/^[0-9a-f-]{36}$/i.test(user.id || '') || user.is_anonymous || (user.banned_until && Date.parse(user.banned_until) > now())) fail(401, 'INVALID_SESSION');
          return user;
        })();
        return userPromise;
      }
      let actorPromise;
      async function actor(required = true) {
        const auth = request.headers.get('authorization');
        if (!auth) { if (required) fail(401, 'AUTH_REQUIRED'); return null; }
        if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth)) fail(401, 'INVALID_SESSION');
        if (!actorPromise) actorPromise = (async () => {
          const user = await authenticatedUser();
          if (!user.email_confirmed_at) fail(403, 'EMAIL_CONFIRMATION_REQUIRED');
          const filter = { auth_user_id: 'eq.' + user.id, limit: '2' };
          const [readers, authors, admins] = await Promise.all([
            db('readers', { ...filter, select: READER_FIELDS }), db('authors', { ...filter, select: AUTHOR_FIELDS }), db('admin_users', { ...filter, select: ADMIN_FIELDS })
          ]);
          if ([readers, authors, admins].some(rows => !Array.isArray(rows) || rows.length > 1)) fail(503, 'IDENTITY_MAPPING_INVALID');
          const result = { userId: user.id, reader: one(readers), author: one(authors), admin: one(admins) };
          if ((result.reader && !activeReader(result.reader)) || (result.author && !activeAuthor(result.author)) || (result.admin && result.admin.is_active !== true)) fail(403, 'ACCOUNT_INACTIVE');
          if (!result.reader && !result.author && !result.admin) fail(403, 'ACCOUNT_NOT_LINKED');
          return result;
        })();
        return actorPromise;
      }
      async function getWork(id) {
        const work = one(await db('works', { select: WORK_FIELDS, id: 'eq.' + validId(id), limit: '1' }));
        if (!work) fail(404, 'WORK_NOT_FOUND');
        return work;
      }
      async function getEpisode(id) {
        const episode = one(await db('episodes', { select: EPISODE_FIELDS, id: 'eq.' + validId(id), limit: '1' }));
        if (!episode) fail(404, 'EPISODE_NOT_FOUND');
        return episode;
      }
      const path = url.pathname;
      if (path === '/api/v2/catalog' || path === '/api/v2/reader/hub' ||
          path === '/api/v2/creator/operations') {
        return reply(await stage8Api({request,env,actor,db,readBody,fail}));
      }
      if (path === '/api/v2/admin/operations')
        return reply(await stage9Api({request,env,actor,db,readBody,fail}));
      if (path === '/api/v2/appeals')
        return reply(await stage9AppealApi({request,env,actor,db,readBody,fail}));
      if (path === '/api/v2/creator/publications' || path.startsWith('/api/v2/creator/publications/')) {
        return reply(await creatorPublicationApi({ request, env, actor, db, readBody, fail }));
      }
      if (path === '/api/v2/creator/files' || path.startsWith('/api/v2/creator/files/')) {
        const result = await creatorFileApi({ request, env, actor, db, fetchImpl, base, serviceHeaders, fail });
        if (result instanceof Response) { result.headers.set('X-Request-ID',requestId); return result; }
        return reply(result);
      }
      if (path === '/api/v2/creator/drafts' || path.startsWith('/api/v2/creator/drafts/')) {
        return reply(await creatorDraftApi({ request, env, actor, db, readBody, fail }));
      }
      if (path === '/api/v2/creator/works' || path.startsWith('/api/v2/creator/works/')) {
        return reply(await creatorWorkApi({ request, env, actor, db, readBody, fail }));
      }
      if (path === '/api/v2/auth/readiness' && request.method === 'GET') {
        if (env.AUTH_ONBOARDING_ENABLED !== 'true') fail(503, 'ONBOARDING_NOT_ACTIVATED');
        if (await db('rpc/authoring_signup_ready', {}) !== true) fail(503, 'ONBOARDING_NOT_ACTIVATED');
        return reply({ ready: true });
      }
      if (path === '/api/v2/onboarding' && request.method === 'POST') {
        if (env.AUTH_ONBOARDING_ENABLED !== 'true') fail(503, 'ONBOARDING_NOT_ACTIVATED');
        if (request.headers.get('origin') !== url.origin) fail(403, 'ORIGIN_REQUIRED');
        const user = await authenticatedUser();
        if (!user.email_confirmed_at || !user.email) fail(403, 'EMAIL_CONFIRMATION_REQUIRED');
        // Atomic DB counter persists across Pages isolates and commits even if profile creation fails.
        if (await db('rpc/consume_authoring_signup_attempt', {}, { method: 'POST', body: { p_user_id: user.id } }) !== true) fail(429, 'RATE_LIMITED');
        const body = await readBody(request);
        if (Object.keys(body).some(k => !['kind','displayName'].includes(k))) fail(400, 'FIELD_NOT_ALLOWED');
        if (!['reader','author'].includes(body.kind) || typeof body.displayName !== 'string' ||
          body.displayName.trim().length < 2 || body.displayName.trim().length > 40 || /[<>\x00-\x1f\x7f]/.test(body.displayName)) fail(400, 'INVALID_SIGNUP');
        const result = await db('rpc/complete_authoring_signup', {}, { method: 'POST', body: {
          p_user_id: user.id, p_kind: body.kind, p_display_name: body.displayName.trim()
        }});
        return reply({ ...result, actor: await actor() });
      }
      if (path === '/api/v2/me' && request.method === 'GET') return reply(await actor());
      // Superseded endpoints cannot bypass the versioned creator and administrator RPCs.
      if (path === '/api/v2/admin/readers' || path === '/api/v2/admin/config' ||
          path === '/api/v2/works' || /^\/api\/v2\/works\/\d+$/.test(path))
        fail(410, 'LEGACY_API_CLOSED');
      let match = path.match(/^\/api\/v2\/episodes\/(\d+)\/content$/);
      if (match && request.method === 'GET') {
        const who = await actor(false); const episode = await getEpisode(match[1]); const work = await getWork(episode.work_id);
        const editor = owns(who, work);
        if (!editor) {
          if (!isPublished(work, episode, now())) fail(404, 'EPISODE_NOT_FOUND');
          if (isAdult(work)) {
            if (!activeReader(who?.reader)) fail(403, 'ADULT_VERIFICATION_REQUIRED');
            // Legacy seeded/client-writable adult flags are not verification evidence.
            const verification = one(await db('p0_identity_verifications', {
              select: 'id', auth_user_id: 'eq.' + who.userId, adult_eligible: 'eq.true',
              provider_mode: 'eq.LIVE', revoked_at: 'is.null', verified_at: 'lte.' + new Date(now()).toISOString(),
              expires_at: 'gt.' + new Date(now()).toISOString(), limit: '1'
            }));
            if (!verification) fail(403, 'ADULT_VERIFICATION_REQUIRED');
          }
          const free = episode.is_free === true && episode.access_policy === 'FREE';
          if (!free) {
            if (!who) fail(401, 'AUTH_REQUIRED');
            const grant = one(await db('p0_episode_entitlements', { select: 'id', auth_user_id: 'eq.' + who.userId, episode_id: 'eq.' + episode.id, revoked_at: 'is.null', or: '(expires_at.is.null,expires_at.gt.' + new Date(now()).toISOString() + ')', limit: '1' }));
            if (!grant) fail(403, 'EPISODE_LOCKED');
          }
        }
        const content = one(await db('secure_episode_contents', { select: 'episode_id,content,image_urls', episode_id: 'eq.' + episode.id, limit: '1' }));
        if (!content) fail(404, 'CONTENT_NOT_FOUND');
        return reply({ success: true, episode: { ...episode, ...content } });
      }
      if (/^\/api\/v2\/episodes\/\d+$/.test(path))
        fail(410, 'LEGACY_API_CLOSED');
      if (/^\/api\/v2\/(payments|ads|adult-verification|points|support|settlements)(\/|$)/.test(path)) {
        await actor(); fail(503, 'PROVIDER_AND_LEDGER_NOT_READY');
      }
      return reply({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      return reply({ error: error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE', requestId }, error instanceof ApiError ? error.status : 503);
    }
  };
}

export const handleSecureApi = createSecureApi();
