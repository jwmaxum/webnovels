// Cloudflare-compatible Web API. No Express, SQLite, Node runtime, or client role trust.
const WORK_FIELDS = 'id,title,author,author_id,genre,tags,description,cover_image,view_count,like_count,created_at,status,is_top_recommended,is_popular_work,is_new_work,content_type,is_completed,rating,ai_usage_type,published_at';
const EPISODE_FIELDS = 'id,work_id,episode_number,title,is_free,is_ad_free,author_comment,status,scheduled_at,access_policy,view_count,created_at';
const READER_FIELDS = 'id,auth_user_id,username,nickname,status,is_adult_verified,adult_verified_at,points';
const AUTHOR_FIELDS = 'id,auth_user_id,username,pen_name,profile_image,bio,status';
const ADMIN_FIELDS = 'id,auth_user_id,username,nickname,role,permissions,is_active';
const PUBLIC_STATES = new Set(['PUBLISHED', 'ONGOING', 'PAUSED', 'COMPLETED']);
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN']);
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
function allowedAdmin(actor, permission) {
  const a = actor?.admin;
  if (!a || a.is_active !== true || !ADMIN_ROLES.has(a.role)) return false;
  if (a.role === 'SUPER_ADMIN') return true;
  return Array.isArray(a.permissions) && a.permissions.includes(permission);
}
function owns(actor, work) { return activeAuthor(actor?.author) && equalId(actor.author.id, work.author_id); }
function authorizeContent(actor, work) {
  if (!allowedAdmin(actor, 'CONTENT_WRITE') && !owns(actor, work)) fail(403, 'CONTENT_FORBIDDEN');
}
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
function validatePatch(body, fields) {
  if (!Object.keys(body).length || Object.keys(body).some(k => !fields.includes(k))) fail(400, 'FIELD_NOT_ALLOWED');
  for (const key of ['title', 'description', 'author_comment', 'content', 'cover_image']) {
    if (key in body && (typeof body[key] !== 'string' || (key === 'title' && (!body[key].trim() || body[key].length > 200)))) fail(400, 'INVALID_FIELD');
  }
  if ('cover_image' in body && body.cover_image && !/^(https:\/\/|\/(?!\/))/.test(body.cover_image)) fail(400, 'INVALID_IMAGE_URL');
  for (const key of ['is_free', 'is_ad_free', 'is_top_recommended', 'is_popular_work', 'is_new_work', 'is_completed']) {
    if (key in body && typeof body[key] !== 'boolean') fail(400, 'INVALID_FIELD');
  }
  if ('image_urls' in body && (!Array.isArray(body.image_urls) || body.image_urls.length > 200 || body.image_urls.some(x => typeof x !== 'string' || !/^https:\/\//.test(x)))) fail(400, 'INVALID_IMAGE_URL');
  if ('genre' in body && (!Array.isArray(body.genre) || body.genre.some(x => typeof x !== 'string'))) fail(400, 'INVALID_FIELD');
  return body;
}

export function createSecureApi({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  return async function handle(request, env) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/v2/')) return json({ error: 'NOT_FOUND' }, 404);
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
        if (!response.ok) fail(response.status === 409 ? 409 : 503, response.status === 409 ? 'CONFLICT' : 'DATABASE_UNAVAILABLE');
        if (response.status === 204) return [];
        return response.json();
      }
      const version = one(await db('p0_migration_status', { select: 'version,phase', version: 'eq.' + SCHEMA_VERSION, limit: '1' }));
      if (version?.phase !== 'locked') fail(503, 'DATABASE_SECURITY_MIGRATION_REQUIRED');
      if (url.pathname === '/api/v2/health' && request.method === 'GET') return json({ status: 'ok', securityVersion: SCHEMA_VERSION });

      let actorPromise;
      async function actor(required = true) {
        const auth = request.headers.get('authorization');
        if (!auth) { if (required) fail(401, 'AUTH_REQUIRED'); return null; }
        if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth)) fail(401, 'INVALID_SESSION');
        if (!actorPromise) actorPromise = (async () => {
          const response = await fetchImpl(new URL('/auth/v1/user', base), { headers: { apikey: secret, Authorization: auth }, signal: AbortSignal.timeout(8000) });
          if (!response.ok) fail(response.status === 401 || response.status === 403 ? 401 : 503, response.status === 401 || response.status === 403 ? 'INVALID_SESSION' : 'AUTH_UNAVAILABLE');
          const user = await response.json();
          if (!/^[0-9a-f-]{36}$/i.test(user.id || '') || user.is_anonymous || (user.banned_until && Date.parse(user.banned_until) > now())) fail(401, 'INVALID_SESSION');
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
      if (path === '/api/v2/me' && request.method === 'GET') return json(await actor());
      if (path === '/api/v2/admin/readers' && request.method === 'GET') {
        if (!allowedAdmin(await actor(), 'USERS_READ')) fail(403, 'ADMIN_FORBIDDEN');
        return json({ readers: await db('readers', { select: 'id,username,nickname,status,is_adult_verified,points,created_at', order: 'id.asc', limit: '100' }) });
      }
      if (path === '/api/v2/admin/config' && request.method === 'GET') {
        if (!allowedAdmin(await actor(), 'CONFIG_READ')) fail(403, 'ADMIN_FORBIDDEN');
        // No provider secret values, even for administrators.
        return json({ config: one(await db('system_config', { select: 'id,service_name,maintenance_mode,minimum_settlement_amount,reward_ad_enabled', limit: '1' })) });
      }
      if (path === '/api/v2/works' && request.method === 'GET') {
        return json({ works: await db('works', { select: WORK_FIELDS, status: 'in.(PUBLISHED,ONGOING,PAUSED,COMPLETED)', order: 'id.asc', limit: '100' }) });
      }
      let match = path.match(/^\/api\/v2\/works\/(\d+)$/);
      if (match && request.method === 'PATCH') {
        const who = await actor(); const work = await getWork(match[1]); authorizeContent(who, work);
        const admin = allowedAdmin(who, 'CONTENT_WRITE');
        const fields = ['title', 'description', 'cover_image', 'genre'];
        if (admin) fields.push('status', 'is_top_recommended', 'is_popular_work', 'is_new_work', 'is_completed');
        const body = validatePatch(await readBody(request), fields);
        if ('status' in body && !['DRAFT', 'REVIEW_REQUESTED', ...PUBLIC_STATES, 'HIDDEN'].includes(body.status)) fail(400, 'INVALID_STATUS');
        const saved = one(await db('works', { id: 'eq.' + work.id, ...(!admin ? { author_id: 'eq.' + who.author.id } : {}), select: WORK_FIELDS }, { method: 'PATCH', body }));
        if (!saved) fail(409, 'WRITE_NOT_APPLIED');
        return json({ work: saved });
      }
      match = path.match(/^\/api\/v2\/episodes\/(\d+)\/content$/);
      if (match && request.method === 'GET') {
        const who = await actor(false); const episode = await getEpisode(match[1]); const work = await getWork(episode.work_id);
        const editor = allowedAdmin(who, 'CONTENT_WRITE') || owns(who, work);
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
        return json({ success: true, episode: { ...episode, ...content } });
      }
      match = path.match(/^\/api\/v2\/episodes\/(\d+)$/);
      if (match && request.method === 'PATCH') {
        const who = await actor(); const episode = await getEpisode(match[1]); const work = await getWork(episode.work_id); authorizeContent(who, work);
        const admin = allowedAdmin(who, 'CONTENT_WRITE');
        // Published body changes require admin review; an owner may edit only unpublished drafts.
        if (!admin && episode.status !== 'DRAFT') fail(403, 'DRAFT_ONLY');
        const body = validatePatch(await readBody(request), ['title', 'content', 'image_urls', 'author_comment', ...(admin ? ['status', 'is_free', 'is_ad_free', 'access_policy'] : [])]);
        if ('status' in body && !['DRAFT', 'PUBLISHED', 'HIDDEN', 'REVIEW_REQUESTED'].includes(body.status)) fail(400, 'INVALID_STATUS');
        if ('is_free' in body || 'access_policy' in body || 'is_ad_free' in body) {
          if (typeof body.is_free !== 'boolean' || !['FREE', 'REWARDED_AD', 'PAID'].includes(body.access_policy) || body.is_free !== (body.access_policy === 'FREE')) fail(400, 'INVALID_ACCESS_POLICY');
          body.is_ad_free = body.is_free;
        }
        // Migration trigger mirrors content into its protected table in the same DB transaction.
        const saved = one(await db('episodes', { id: 'eq.' + episode.id, work_id: 'eq.' + work.id, ...(!admin ? { status: 'eq.DRAFT' } : {}), select: EPISODE_FIELDS }, { method: 'PATCH', body }));
        if (!saved) fail(409, 'WRITE_NOT_APPLIED');
        return json({ episode: saved });
      }
      if (/^\/api\/v2\/(payments|ads|adult-verification|points|support|settlements)(\/|$)/.test(path)) {
        await actor(); fail(503, 'PROVIDER_AND_LEDGER_NOT_READY');
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      return json({ error: error instanceof ApiError ? error.code : 'SERVICE_UNAVAILABLE' }, error instanceof ApiError ? error.status : 503);
    }
  };
}

export const handleSecureApi = createSecureApi();
