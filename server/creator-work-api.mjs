const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal = (value, zero = false) => typeof value === 'string' && (zero ? /^(0|[1-9]\d{0,18})$/ : /^[1-9]\d{0,18}$/).test(value) && BigInt(value) <= 9223372036854775807n;
export async function creatorWorkApi({ request, env, actor, db, readBody, fail, workspaceReady = false }) {
  if (env.AUTHOR_WORKS_ENABLED !== 'true' && !workspaceReady) fail(503, 'AUTHOR_WORKS_NOT_ACTIVATED');
  const who = await actor();
  if (!who.author || who.author.status !== 'APPROVED') fail(403, 'AUTHOR_REQUIRED');
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v2\/creator\/works(?:\/([0-9]+)(?:\/(trash|restore))?)?$/);
  if (!match) fail(404, 'NOT_FOUND');
  const id = match[1] || null;
  if (id && !decimal(id)) fail(400, 'INVALID_ID');
  if ([...url.searchParams.keys()].some(k => !['filter','after'].includes(k))) fail(400, 'FIELD_NOT_ALLOWED');
  const filter = url.searchParams.get('filter') || 'all', after = url.searchParams.get('after') || '0';
  if (!['all','draft','public','trash'].includes(filter) || !decimal(after,true)) fail(400, 'INVALID_FILTER');
  let action, data = {}, key = null;
  if (request.method === 'GET' && !match[2]) action = id ? 'get' : 'list';
  else {
    if (request.headers.get('origin') !== url.origin) fail(403, 'ORIGIN_REQUIRED');
    if (request.method === 'POST' && !id) action = 'create';
    else if (request.method === 'PATCH' && id && !match[2]) action = 'update';
    else if (request.method === 'POST' && id && match[2]) action = match[2];
    else fail(405, 'METHOD_NOT_ALLOWED');
    data = await readBody(request);
    const allowed = action === 'create' ? ['title'] : action === 'update'
      ? ['title','description','genre','tags','rating','ai_usage_type','serial_state','visibility','version'] : ['version'];
    if (!Object.keys(data).length || Object.keys(data).some(k => !allowed.includes(k))) fail(400, 'FIELD_NOT_ALLOWED');
    if (action === 'create') {
      key = request.headers.get('Idempotency-Key');
      if (!UUID.test(key || '')) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
      if (!('title' in data)) fail(400, 'INVALID_FIELD');
    } else if (!decimal(data.version)) fail(400, 'VERSION_REQUIRED');
    if ('title' in data && (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length>200)) fail(400, 'INVALID_FIELD');
    if ('description' in data && (typeof data.description !== 'string' || data.description.length>5000)) fail(400, 'INVALID_FIELD');
    for (const name of ['genre','tags']) if (name in data && (!Array.isArray(data[name]) || data[name].length>10 || data[name].some(v => typeof v!=='string' || !v.trim() || v.trim().length>30))) fail(400, 'INVALID_FIELD');
    for (const [name,values] of Object.entries({ rating:['ALL','AGE_15','AGE_19'],ai_usage_type:['NONE','ASSISTED','GENERATED'],serial_state:['ONGOING','HIATUS','COMPLETED'],visibility:['PRIVATE'] })) {
      if (name in data && !values.includes(data[name])) fail(400, 'INVALID_FIELD');
    }
  }
  const result = await db('rpc/creator_works', {}, { method:'POST', body:{
    p_user_id:who.userId, p_action:action, p_work_id:id, p_data:data, p_key:key, p_filter:filter, p_after:after
  }});
  if (result?.error) fail([400,403,404,409,503].includes(result.status) ? result.status : 503, result.error);
  if (!result || typeof result !== 'object') fail(503, 'DATABASE_UNAVAILABLE');
  return result;
}
