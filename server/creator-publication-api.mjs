const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal = v => typeof v === 'string' && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;

export async function creatorPublicationApi({ request, env, actor, db, readBody, fail }) {
  if (env.AUTHOR_PUBLISH_ENABLED !== 'true' ||
      env.AUTHOR_WORKS_ENABLED !== 'true' || env.AUTHOR_DRAFTS_ENABLED !== 'true')
    fail(503, 'AUTHOR_PUBLISH_NOT_ACTIVATED');
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v2\/creator\/publications(?:\/(suggest|publish|edit|schedule|cancel)(?:\/([^/]+))?)?$/);
  if (!match) fail(404, 'NOT_FOUND');
  const action = match[1] || 'list', id = match[2] || null;
  const workId = url.searchParams.get('workId');
  if (!decimal(workId) || [...url.searchParams.keys()].some(k => k !== 'workId')) fail(400, 'INVALID_ID');
  if ((['publish','edit','schedule','cancel'].includes(action) && !id) ||
      (['list','suggest'].includes(action) && id)) fail(404, 'NOT_FOUND');
  if (action === 'publish' && !UUID.test(id)) fail(400, 'INVALID_DRAFT_ID');
  if (['edit','schedule','cancel'].includes(action) && !decimal(id)) fail(400, 'INVALID_EPISODE_ID');
  const who = await actor();
  if (who.author?.status !== 'APPROVED') fail(403, 'AUTHOR_REQUIRED');
  let data = {}, key = null, draftId = null, episodeId = null, op = action;
  if (['list','suggest'].includes(action)) {
    if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED');
  } else {
    if (request.method !== 'POST' || request.headers.get('origin') !== url.origin)
      fail(request.method !== 'POST' ? 405 : 403, request.method !== 'POST' ? 'METHOD_NOT_ALLOWED' : 'ORIGIN_REQUIRED');
    data = await readBody(request);
    if (action === 'publish') {
      draftId = id;
      key = request.headers.get('Idempotency-Key');
      if (!UUID.test(key || '')) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
      if (Object.keys(data).some(k => !['revision','episodeNumber','mode','dueAt','displayTimezone','rightsConfirmed'].includes(k)) ||
          !decimal(data.revision) || !/^[1-9]\d{0,8}$/.test(String(data.episodeNumber)) ||
          !['NOW','SCHEDULED'].includes(data.mode) || data.rightsConfirmed !== true)
        fail(400, 'INVALID_PUBLICATION');
      if (data.mode === 'SCHEDULED') {
        if (typeof data.dueAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(data.dueAt) ||
            !['Asia/Seoul','UTC'].includes(data.displayTimezone) || !Number.isFinite(Date.parse(data.dueAt)))
          fail(400, 'INVALID_SCHEDULE');
      } else if ('dueAt' in data || 'displayTimezone' in data) fail(400, 'INVALID_PUBLICATION');
    } else if (action === 'edit') {
      episodeId = id; op = 'begin-edit';
      key = request.headers.get('Idempotency-Key');
      if (!UUID.test(key || '') || Object.keys(data).some(k => k !== 'draftId') || !UUID.test(data.draftId || ''))
        fail(400, 'INVALID_EDIT_REQUEST');
      draftId = data.draftId;
    } else {
      episodeId = id; op = action === 'schedule' ? 'reschedule' : 'cancel';
      if (!Number.isInteger(data.generation) || data.generation < 1 || data.generation > 999999999)
        fail(400, 'INVALID_SCHEDULE_GENERATION');
      if (action === 'schedule') {
        if (Object.keys(data).some(k => !['generation','dueAt','displayTimezone'].includes(k)) ||
            typeof data.dueAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(data.dueAt) ||
            !Number.isFinite(Date.parse(data.dueAt)) || !['Asia/Seoul','UTC'].includes(data.displayTimezone))
          fail(400, 'INVALID_SCHEDULE');
      } else if (Object.keys(data).some(k => k !== 'generation')) fail(400, 'FIELD_NOT_ALLOWED');
    }
  }
  const result = await db('rpc/creator_publications', {}, { method: 'POST', body: {
    p_user_id: who.userId, p_action: op, p_work_id: workId,
    p_draft_id: draftId, p_episode_id: episodeId, p_data: data, p_key: key
  }});
  if (result?.error) fail([400,403,404,409,503].includes(result.status) ? result.status : 503, result.error);
  if (!result || typeof result !== 'object') fail(503, 'DATABASE_UNAVAILABLE');
  return result;
}
