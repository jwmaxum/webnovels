const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES=new Set(['CONTENT_REVIEW','REPORT','COMMENT_REPORT','WORK_MODERATION']);
export async function stage9AppealApi({request,env,actor,db,readBody,fail}){
  if(env.ADMIN_OPERATIONS_ENABLED!=='true')fail(503,'ADMIN_OPERATIONS_NOT_ACTIVATED');
  const url=new URL(request.url),action=url.searchParams.get('action')||'eligible';
  if(!['eligible','my','submit'].includes(action)||[...url.searchParams.keys()].some(key=>key!=='action'))
    fail(400,'INVALID_ACTION');
  if(action==='submit'?request.method!=='POST':request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
  const who=await actor();
  if(!who.reader&&!who.author)fail(403,'ACCOUNT_REQUIRED');
  let data={};
  if(action==='submit'){
    if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
    data=await readBody(request);
    if(Object.keys(data).some(key=>!['source','sourceId','reason'].includes(key))||
      !SOURCES.has(data.source)||!UUID.test(data.sourceId||'')||
      typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500)
      fail(400,'INVALID_APPEAL');
  }
  const result=await db('rpc/stage9_appeal',{}, {method:'POST',body:{
    p_user:who.userId,p_action:action,p_data:data
  }});
  if(result?.error)fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
  return result;
}
