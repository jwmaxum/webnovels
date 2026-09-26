const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const number = s => typeof s === 'string' && /^(0|[1-9]\d{0,18})$/.test(s) && BigInt(s) <= 9223372036854775807n;
export async function creatorDraftApi({request,env,actor,db,readBody,fail,workspaceReady=false}) {
  if (!workspaceReady && (env.AUTHOR_DRAFTS_ENABLED !== 'true' || env.AUTHOR_WORKS_ENABLED !== 'true')) fail(503,'AUTHOR_DRAFTS_NOT_ACTIVATED');
  const who=await actor();
  if (who.author?.status !== 'APPROVED') fail(403,'AUTHOR_REQUIRED');
  const url=new URL(request.url), match=url.pathname.match(/^\/api\/v2\/creator\/drafts(?:\/([^/]+)(?:\/(history))?)?$/);
  if (!match || (match[1] && !uuid.test(match[1]))) fail(404,'NOT_FOUND');
  if ([...url.searchParams.keys()].some(k=>!['workId','before'].includes(k))) fail(400,'FIELD_NOT_ALLOWED');
  const work=url.searchParams.get('workId'), before=url.searchParams.get('before') || '0';
  if (!number(work) || work==='0' || !number(before)) fail(400,'INVALID_ID');
  let action=match[2]?'history':match[1]?'get':'list', data={},key=null;
  if (request.method==='PUT' && match[1] && !match[2]) {
    if (request.headers.get('origin')!==url.origin) fail(403,'ORIGIN_REQUIRED');
    action='save';data=await readBody(request);key=request.headers.get('Idempotency-Key');
    if (!uuid.test(key || '')) fail(400,'IDEMPOTENCY_KEY_REQUIRED');
    if (Object.keys(data).some(k=>!['expectedRevision','title','content','authorComment'].includes(k)) ||
      !number(data.expectedRevision) || ['title','content','authorComment'].some(k=>typeof data[k]!=='string') ||
      data.title.length>200 || data.content.length>200000 || data.authorComment.length>5000) fail(400,'INVALID_FIELD');
  } else if (request.method!=='GET') fail(405,'METHOD_NOT_ALLOWED');
  const result=await db('rpc/creator_drafts',{}, {method:'POST',body:{p_user_id:who.userId,p_action:action,p_work_id:work,p_id:match[1] || null,p_data:data,p_key:key,p_before:before}});
  if (result?.error) fail([400,403,404,409,503].includes(result.status)?result.status:503,result.error);
  if (!result || typeof result!=='object') fail(503,'DATABASE_UNAVAILABLE');
  return result;
}
