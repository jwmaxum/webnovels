// Administrator workflow boundary. Identity and permissions are checked again inside the RPC.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decimal=(value,zero=false)=>typeof value==='string' && (zero?/^(0|[1-9]\d{0,18})$/:/^[1-9]\d{0,18}$/).test(value) && BigInt(value)<=9223372036854775807n;
const sources=['CONTENT_REVIEW','COMMENT_REPORT','REPORT'];
const reads={cases:['source','offset'],appeals:['offset'],assignees:['source'],accounts:['kind','offset'],
  'account-support':['kind','accountId'],'work-list':[],curation:[],preview:['at'],audit:['offset','target']};
const writes={
  'case-update':['source','caseId','revision','assigneeId','priority','dueAt','evidence','duplicateId','targetVersion'],
  'case-resolve':['source','caseId','revision','decision'],
  'appeal-resolve':['appealId','decision'],
  'appeal-followup':['appealId','decision','targetVersion'],
  moderate:['workId','version','decision'],
  'account-moderate':['kind','accountId','expectedStatus','decision'],
  'curation-save':['placementId','revision','workId','slot','position','startsAt','endsAt','enabled'],
  'draft-read':['source','caseId','draftId']
};
export const adminWorkflowEnabled=env=>env.P0_API_ENABLED==='true' && env.ADMIN_WORKFLOW_ENABLED==='true' && env.ADMIN_OPERATIONS_ENABLED==='true';
const timestamp=value=>typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
export async function adminWorkflowApi({request,env,actor,db,readBody,fail}) {
  if(!adminWorkflowEnabled(env))fail(503,'ADMIN_WORKFLOW_NOT_ACTIVATED');
  const url=new URL(request.url),action=url.searchParams.get('action'),write=Object.hasOwn(writes,action);
  if(!write&&!Object.hasOwn(reads,action))fail(400,'INVALID_ACTION');
  if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
  const allowed=['action',...(write?[]:reads[action])];
  for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)fail(400,'INVALID_QUERY');
  const who=await actor();
  if(!who.admin?.is_active||!['SUPER_ADMIN','ADMIN','SUB_ADMIN'].includes(who.admin.role))fail(403,'ADMIN_REQUIRED');
  let data={};
  if(write) {
    if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
    data=await readBody(request);
    if(JSON.stringify(data).length>16000||Object.keys(data).some(key=>!['requestId','reason',...writes[action]].includes(key)))fail(400,'INVALID_FIELD');
    if(!UUID.test(data.requestId||''))fail(400,'INVALID_REQUEST_ID');
    if(typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500)fail(400,'REASON_REQUIRED');
  } else for(const key of reads[action])if(url.searchParams.has(key))data[key]=url.searchParams.get(key);
  const invalid=()=>fail(400,'INVALID_FIELD');
  for(const key of ['caseId','appealId','draftId','placementId'])if(key in data&&!UUID.test(data[key]||''))invalid();
  for(const key of ['workId','version','revision'])if(key in data&&!decimal(data[key],key==='revision'))invalid();
  if('source' in data&&!sources.includes(data.source))invalid();
  if('offset' in data&&(!/^\d{1,6}$/.test(data.offset)||Number(data.offset)>100000))invalid();
  if('kind' in data&&!['reader','author'].includes(data.kind))invalid();
  if('accountId' in data&&!(data.kind==='reader'?UUID.test(data.accountId||''):decimal(data.accountId)))invalid();
  if('target' in data&&(data.target.length>100||/[\x00-\x1f]/.test(data.target)))invalid();
  if('at' in data&&!timestamp(data.at))invalid();
  if(write) {
    if(writes[action].some(key=>!(key in data)))invalid();
    if(action==='case-update' && (!['NORMAL','HIGH','URGENT'].includes(data.priority)||
      (data.assigneeId!==null&&!UUID.test(data.assigneeId||''))||
      (data.duplicateId!==null&&!UUID.test(data.duplicateId||''))||
      (data.dueAt!==null&&!timestamp(data.dueAt))||typeof data.evidence!=='string'||data.evidence.trim().length<3||data.evidence.length>2000))invalid();
    const decisions={'case-resolve':['RESOLVE','REJECT'],'appeal-resolve':['ACCEPT','REJECT'],
      'appeal-followup':['MAINTAIN','UNRESTRICT','UNBLOCK'],moderate:['RESTRICT','UNRESTRICT'],'account-moderate':['SUSPEND','RESTORE']};
    if(decisions[action]&&!decisions[action].includes(data.decision))invalid();
    if(['appeal-followup','case-update'].includes(action)&&(typeof data.targetVersion!=='string'||data.targetVersion.length>100))invalid();
    if(action==='account-moderate'&&!['ACTIVE','APPROVED','SUSPENDED'].includes(data.expectedStatus))invalid();
    if(action==='draft-read'&&data.source!=='CONTENT_REVIEW')invalid();
    if(action==='curation-save'&&(!['HOME_RECOMMENDED','HOME_SPOTLIGHT'].includes(data.slot)||
      !Number.isInteger(data.position)||data.position<1||data.position>8||typeof data.enabled!=='boolean'||
      !timestamp(data.startsAt)||!timestamp(data.endsAt)||Date.parse(data.endsAt)<=Date.parse(data.startsAt)))invalid();
  } else {
    if(['cases','assignees'].includes(action)&&!sources.includes(data.source))invalid();
    if(['accounts','account-support'].includes(action)&&!['reader','author'].includes(data.kind))invalid();
    if(action==='account-support'&&!data.accountId)invalid();
  }
  const result=await db('rpc/stage17_admin',{}, {method:'POST',body:{p_user:who.userId,p_action:action,p_data:data}});
  if(result?.error)fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
  if(!result||typeof result!=='object'||Array.isArray(result))fail(503,'WORKFLOW_UNAVAILABLE');
  return result;
}
