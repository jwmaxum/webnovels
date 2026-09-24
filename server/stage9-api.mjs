// Stage 9 operational API. No creator manuscript or general table mutation is exposed here.
const READS=new Set(['dashboard','cases','appeals','accounts','roles','work-list','audit']);
const WRITES=new Set(['case-resolve','appeal-resolve','moderate','curate','role-update','account-moderate']);
const SOURCES=new Set(['CONTENT_REVIEW','REPORT','COMMENT_REPORT']);
const ROLE_PERMISSIONS=new Set(['OPERATIONS_READ','ACCOUNTS_READ','CONTENT_METADATA_READ',
  'CASE_READ','CASE_RESOLVE','CONTENT_REVIEW','COMMENT_REPORT','CONTENT_MODERATE',
  'CURATION_WRITE','AUDIT_READ','ACCOUNT_MODERATE']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL=/^[1-9]\d{0,18}$/;
const workId=value=>typeof value==='string' && DECIMAL.test(value) && BigInt(value)<=9223372036854775807n;
const fields=(data,names)=>Object.keys(data).every(key=>names.includes(key));

export async function stage9Api({request,env,actor,db,readBody,fail}){
  if(env.ADMIN_OPERATIONS_ENABLED!=='true')fail(503,'ADMIN_OPERATIONS_NOT_ACTIVATED');
  const url=new URL(request.url),action=url.searchParams.get('action')||'dashboard';
  if(!READS.has(action)&&!WRITES.has(action))fail(400,'INVALID_ACTION');
  if(action==='role-update'&&env.ADMIN_ROLE_CHANGES_ENABLED!=='true')fail(503,'ADMIN_ROLE_CHANGES_NOT_ACTIVATED');
  if(READS.has(action)?request.method!=='GET':request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
  const who=await actor();
  if(!who.admin?.is_active||!['SUPER_ADMIN','ADMIN','SUB_ADMIN'].includes(who.admin.role))
    fail(403,'ADMIN_REQUIRED');
  let data={};
  if(READS.has(action)){
    const allowed=action==='cases'?['action','source']:action==='accounts'?['action','kind']:['action'];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key)))fail(400,'INVALID_QUERY');
    if(action==='cases'){
      data.source=url.searchParams.get('source');
      if(!SOURCES.has(data.source))fail(400,'INVALID_CASE_SOURCE');
    }
    if(action==='accounts'){
      data.kind=url.searchParams.get('kind');
      if(!['reader','author'].includes(data.kind))fail(400,'INVALID_KIND');
    }
  }else{
    if([...url.searchParams.keys()].some(key=>key!=='action'))fail(400,'INVALID_QUERY');
    if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
    data=await readBody(request);
    if(typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500)
      fail(400,'REASON_REQUIRED');
    if(action==='account-moderate'){
      if(!fields(data,['kind','accountId','decision','reason'])||
        !['reader','author'].includes(data.kind)||
        !(data.kind==='reader'?UUID.test(data.accountId||''):workId(data.accountId))||
        !['SUSPEND','RESTORE'].includes(data.decision))fail(400,'INVALID_ACCOUNT');
    }else if(action==='role-update'){
      if(!fields(data,['adminId','permissions','reason'])||!UUID.test(data.adminId||'')||
        !Array.isArray(data.permissions)||data.permissions.length>20||
        data.permissions.some(value=>typeof value!=='string'||!ROLE_PERMISSIONS.has(value)))
        fail(400,'INVALID_PERMISSIONS');
    }else if(action==='appeal-resolve'){
      if(!fields(data,['appealId','decision','reason'])||!UUID.test(data.appealId||'')||
        !['ACCEPT','REJECT'].includes(data.decision))fail(400,'INVALID_APPEAL');
    }else if(action==='case-resolve'){
      if(!fields(data,['source','caseId','decision','reason'])||!SOURCES.has(data.source)||
        !UUID.test(data.caseId||'')||!['RESOLVE','REJECT'].includes(data.decision))
        fail(400,'INVALID_CASE');
    }else if(action==='moderate'){
      if(!fields(data,['workId','version','decision','reason'])||!workId(data.workId)||
        !workId(data.version)||!['RESTRICT','UNRESTRICT'].includes(data.decision))
        fail(400,'INVALID_MODERATION');
    }else if(!fields(data,['workId','version','flag','enabled','reason'])||
      !workId(data.workId)||!workId(data.version)||
      !['is_top_recommended','is_popular_work','is_new_work'].includes(data.flag)||
      typeof data.enabled!=='boolean')fail(400,'INVALID_CURATION');
  }
  const result=await db('rpc/stage9_admin',{}, {method:'POST',body:{
    p_user:who.userId,p_action:action,p_data:data
  }});
  if(result?.error)fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
  return result;
}
