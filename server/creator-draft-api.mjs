import {webtoonEnabled} from './webtoon-api.mjs';
import {recoveryReviewEnabled} from './recovery-review-policy.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const number = s => typeof s === 'string' && /^(0|[1-9]\d{0,18})$/.test(s) && BigInt(s) <= 9223372036854775807n;
export const recoveryEnabled = env => ['P0_API_ENABLED','AUTHOR_WORKS_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_FILES_ENABLED','AUTHOR_RECOVERY_ENABLED'].every(k=>env[k]==='true');
export async function creatorDraftApi({request,env,actor,db,readBody,fail,workspaceReady=false}) {
  if (!workspaceReady && (env.AUTHOR_DRAFTS_ENABLED !== 'true' || env.AUTHOR_WORKS_ENABLED !== 'true')) fail(503,'AUTHOR_DRAFTS_NOT_ACTIVATED');
  const who=await actor();
  if (who.author?.status !== 'APPROVED') fail(403,'AUTHOR_REQUIRED');
  const url=new URL(request.url), match=url.pathname.match(/^\/api\/v2\/creator\/drafts(?:\/([^/]+)(?:\/(history|recovery))?)?$/);
  if (!match || (match[1] && !uuid.test(match[1]))) fail(404,'NOT_FOUND');
  if ([...url.searchParams.keys()].some(k=>!['workId','before'].includes(k))) fail(400,'FIELD_NOT_ALLOWED');
  const work=url.searchParams.get('workId'), before=url.searchParams.get('before') || '0';
  if (!number(work) || work==='0' || !number(before)) fail(400,'INVALID_ID');
  if (match[2]==='recovery') {
    if (env.AUTHOR_FILES_ENABLED!=='true') fail(503,'AUTHOR_FILES_NOT_ACTIVATED');
    if (!recoveryEnabled(env)) fail(503,'AUTHOR_RECOVERY_NOT_ACTIVATED');
    let data={},key=null;
    if (request.method==='POST') {
      if (request.headers.get('origin')!==url.origin) fail(403,'ORIGIN_REQUIRED');
      key=request.headers.get('Idempotency-Key');
      if (!uuid.test(key || '')) fail(400,'IDEMPOTENCY_KEY_REQUIRED');
      data=await readBody(request);
      if (url.searchParams.has('before') || Object.keys(data).some(k=>!['expectedRevision','episodeId','fileId','targetDigest','note','confirmed'].includes(k)) ||
        !number(data.expectedRevision) || data.expectedRevision==='0' || !number(data.episodeId) || data.episodeId==='0' ||
        !uuid.test(data.fileId || '') || typeof data.targetDigest!=='string' || !/^[a-f0-9]{32}$/.test(data.targetDigest) ||
        typeof data.note!=='string' || data.note.length>2000 || data.confirmed!==true) fail(400,'INVALID_FIELD');
    } else if (request.method!=='GET') fail(405,'METHOD_NOT_ALLOWED');
    const result=await db('rpc/creator_draft_recovery',{}, {method:'POST',body:{p_user_id:who.userId,
      p_action:request.method==='POST'?'submit':'options',p_work_id:work,p_id:match[1],p_data:data,p_key:key,p_after:before}});
    if (result?.error) fail([400,403,404,409,503].includes(result.status)?result.status:503,result.error);
    if (!result || typeof result!=='object') fail(503,'DATABASE_UNAVAILABLE');
    if(recoveryReviewEnabled(env)) {
      const feedback=await db('rpc/creator_recovery_review_status',{}, {method:'POST',body:{p_user:who.userId,p_work:work,p_draft:match[1],p_request:result.request?.id||null}});
      if(feedback?.error)fail([403,404].includes(feedback.status)?feedback.status:503,feedback.error);
      if(!feedback?.reviews||typeof feedback.reviews!=='object'||Array.isArray(feedback.reviews))fail(503,'WORKFLOW_UNAVAILABLE');
      if(result.request)result.request={...result.request,review:feedback.reviews[result.request.id]||null};
      if(result.requests)result.requests=result.requests.map(r=>({...r,review:feedback.reviews[r.id]||null}));
      result.reviewAvailable=true;
    } else result.reviewAvailable=false;
    return result;
  }
  let action=match[2]?'history':match[1]?'get':'list', data={},key=null;
  if (request.method==='PUT' && match[1] && !match[2]) {
    if (request.headers.get('origin')!==url.origin) fail(403,'ORIGIN_REQUIRED');
    action='save';data=await readBody(request);key=request.headers.get('Idempotency-Key');
    if (!uuid.test(key || '')) fail(400,'IDEMPOTENCY_KEY_REQUIRED');
    if (Object.keys(data).some(k=>!['expectedRevision','title','content','authorComment',...(webtoonEnabled(env)?['webtoon']:[])].includes(k)) ||
      !number(data.expectedRevision) || ['title','content','authorComment'].some(k=>typeof data[k]!=='string') ||
      data.title.length>200 || data.content.length>200000 || data.authorComment.length>5000) fail(400,'INVALID_FIELD');
  } else if (request.method!=='GET') fail(405,'METHOD_NOT_ALLOWED');
  const result=await db('rpc/creator_drafts',{}, {method:'POST',body:{p_user_id:who.userId,p_action:action,p_work_id:work,p_id:match[1] || null,p_data:data,p_key:key,p_before:before}});
  if (result?.error) fail([400,403,404,409,503].includes(result.status)?result.status:503,result.error);
  if (!result || typeof result!=='object') fail(503,'DATABASE_UNAVAILABLE');
  return result;
}
