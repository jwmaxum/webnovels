// Isolated LOCAL_SIMULATED points. This module cannot call payment providers or
// reuse legacy balances/entitlements. The RPC repeats account and ownership checks.
import '../public/js/shared/manuscript-document.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid=value=>typeof value==='string'&&UUID.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const decimal=(value,zero=false)=>typeof value==='string'&&(zero?/^(0|[1-9]\d{0,18})$/:/^[1-9]\d{0,18}$/).test(value)&&BigInt(value)<=9223372036854775807n;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const points=value=>integer(value,0,1_000_000),balance=value=>integer(value,0,Number.MAX_SAFE_INTEGER);
const text=(value,max,min=0)=>typeof value==='string'&&value.length<=max&&value.trim().length>=min&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)&&!/[\uD800-\uDFFF]/u.test(value);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const marker={mode:'TEST',provenance:'LOCAL_SIMULATED'};
const access=['MEMBER_FREE','OWNED','AD_REWARD','CAMPAIGN_FREE','LOCKED'];
const maxPanelBytes=8*1024*1024;
const reads={works:['offset'],episodes:['workId','offset'],wallet:[],content:['episodeId'],panel:['episodeId','versionId','panelId','format']};
const writes={quote:['episodeId'],purchase:['quoteId','requestId']};
const adminActions={state:[],search:['q','type','offset'],enroll:['workId','enabled','revision','reason','requestId'],policy:['scope','targetId','points','startsAt','revision','reason','requestId'],credit:['targetUserId','points','reason','requestId']};
const safeErrors=new Set(['AUTH_REQUIRED','INVALID_SESSION','EMAIL_CONFIRMATION_REQUIRED','READER_REQUIRED','ADMIN_FORBIDDEN','FINANCE_PERMISSION_REQUIRED','READER_NOT_FOUND','WORK_NOT_FOUND','TEST_WORK_NOT_FOUND','TEST_WORK_LIMIT','CONTENT_NOT_AVAILABLE','PANEL_NOT_FOUND','EPISODE_LOCKED','PRICE_CHANGED','PUBLICATION_CHANGED','QUOTE_EXPIRED','QUOTE_NOT_FOUND','REWARD_EXPIRED','INSUFFICIENT_POINTS','BALANCE_LIMIT','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','RATE_LIMITED','INVALID_POINTS_REQUEST','INVALID_TEST_REQUEST','REASON_REQUIRED','INVALID_REQUEST','INVALID_INPUT','POINTS_TEST_NOT_READY','POINTS_TEST_UNAVAILABLE']);

export const pointsTestEnabled=(env={})=>env.POINTS_TEST_ENABLED==='true'&&env.POINTS_TEST_ENVIRONMENT==='TEST'&&env.POINTS_TEST_PROVENANCE==='LOCAL_SIMULATED'&&env.P0_API_ENABLED==='true'&&env.FREE_BETA_ENABLED!=='true'&&env.FREE_BETA_ENABLED!==true;
// Pure content/storage validation only; no TEST wallet or entitlement is shared.
export {content as projectPointContent,panel as pointPanel};

async function readJson(request,fail){
  if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'ORIGIN_REQUIRED');
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');
  if(Number(request.headers.get('content-length'))>65536)fail(413,'BODY_TOO_LARGE');
  const stream=request.body?.getReader();if(!stream)fail(400,'BODY_REQUIRED');const chunks=[];let size=0;
  for(;;){const {done,value}=await stream.read();if(done)break;size+=value.byteLength;if(size>65536){await stream.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_POINTS_REQUEST');}
  if(!object(data))fail(400,'INVALID_POINTS_REQUEST');return data;
}
function marked(result,fail){if(!object(result)||result.mode!=='TEST'||result.provenance!=='LOCAL_SIMULATED')fail(503,'POINTS_TEST_UNAVAILABLE');}
function balances(result,fail){
  if(!balance(result.balancePoints))fail(503,'POINTS_TEST_UNAVAILABLE');
  const total=Object.hasOwn(result,'totalPoints'),reserved=Object.hasOwn(result,'reservedPoints');
  if(total!==reserved||total&&(!balance(result.totalPoints)||!balance(result.reservedPoints)||result.totalPoints!==result.balancePoints+result.reservedPoints))fail(503,'POINTS_TEST_UNAVAILABLE');
  return pick(result,['balancePoints',...(total?['totalPoints','reservedPoints']:[])]);
}
function rewardAccess(value,fail){
  if(!['AD_REWARD','CAMPAIGN_FREE'].includes(value.access)){
    if(value.rewardAccess!=null)fail(503,'POINTS_TEST_UNAVAILABLE');return {};
  }
  const grant=value.rewardAccess;
  if(!object(grant)||grant.kind!==value.access||!uuid(grant.grantId)||!timestamp(grant.expiresAt))fail(503,'POINTS_TEST_UNAVAILABLE');
  return {rewardAccess:pick(grant,['kind','grantId','expiresAt'])};
}
function work(value,fail,admin=false){
  if(!object(value)||!decimal(value.id)||!text(value.title,500)||!text(value.author,200)||!['NOVEL','WEBTOON'].includes(value.contentType)||admin&&typeof value.enabled!=='boolean')fail(503,'POINTS_TEST_UNAVAILABLE');
  return pick(value,['id','title','author','contentType',...(admin?['enabled']:[])]);
}
function episode(value,fail,workId){
  if(!object(value)||!decimal(value.id)||value.workId!==workId||!integer(value.episodeNumber,1,2147483647)||!text(value.title,500)||!uuid(value.versionId)||!uuid(value.priceVersion)||!access.includes(value.access)||!points(value.pricePoints))fail(503,'POINTS_TEST_UNAVAILABLE');
  return {...pick(value,['id','workId','episodeNumber','title','versionId','access','pricePoints','priceVersion']),...rewardAccess(value,fail)};
}
function page(result,data,fail,project){
  const offset=data.offset??0;
  if(!Array.isArray(result.items)||result.items.length>50||result.offset!==offset||result.limit!==50||!integer(result.total,0,2147483647)||typeof result.hasMore!=='boolean'||result.hasMore!==(result.total>offset+50)||result.nextOffset!==(result.hasMore?offset+50:null)||result.items.length!==Math.min(50,Math.max(0,result.total-offset)))fail(503,'POINTS_TEST_UNAVAILABLE');
  const items=result.items.map(project);if(new Set(items.map(row=>row.id)).size!==items.length)fail(503,'POINTS_TEST_UNAVAILABLE');
  return {...marker,items,...pick(result,['offset','limit','total','hasMore','nextOffset'])};
}
function state(result,fail){
  if(!decimal(result.revision,true)||!object(result.defaults)||result.defaults.freeEpisodes!==2||!points(result.defaults.pricePoints)||!Array.isArray(result.works)||result.works.length>1000||!Array.isArray(result.policies)||result.policies.length>100)fail(503,'POINTS_TEST_UNAVAILABLE');
  const works=result.works.map(row=>work(row,fail,true));if(new Set(works.map(row=>row.id)).size!==works.length)fail(503,'POINTS_TEST_UNAVAILABLE');
  const policies=result.policies.map(row=>{if(!object(row)||!uuid(row.id)||!['DEFAULT','WORK','EPISODE'].includes(row.scope)||(row.scope==='DEFAULT'?row.targetId!==null:!decimal(row.targetId))||!points(row.points)||!timestamp(row.startsAt)||!text(row.reason,500))fail(503,'POINTS_TEST_UNAVAILABLE');return pick(row,['id','scope','targetId','points','startsAt','reason']);});
  return {...marker,revision:result.revision,defaults:pick(result.defaults,['freeEpisodes','pricePoints']),works,policies,...(result.saved===true?{saved:true,replayed:result.replayed===true}:{})};
}
function content(result,data,fail){
  if(result.episodeId!==data.episodeId||!decimal(result.workId)||!uuid(result.versionId)||!['NOVEL','WEBTOON'].includes(result.contentType)||!text(result.title,500)||!Array.isArray(result.panels)||result.panels.length>300)fail(503,'POINTS_TEST_UNAVAILABLE');
  if(result.contentType==='NOVEL'){
    if(!text(result.content,200000)||result.panels.length||result.contentDocument!==null&&!globalThis.ManuscriptDocument.valid(result.contentDocument,result.content))fail(503,'POINTS_TEST_UNAVAILABLE');
  }else if(result.content!==null||result.contentDocument!==null||!result.panels.length)fail(503,'POINTS_TEST_UNAVAILABLE');
  const seen=new Set(),orders=new Set();const panels=result.panels.map(row=>{if(!object(row)||!uuid(row.id)||seen.has(row.id.toLowerCase())||!integer(row.order,0,299)||orders.has(row.order)||!integer(row.width,1,800)||!integer(row.height,1,4096)||!['webp','png'].includes(row.format))fail(503,'POINTS_TEST_UNAVAILABLE');seen.add(row.id.toLowerCase());orders.add(row.order);return pick(row,['id','order','width','height','format']);});
  return {...marker,...pick(result,['episodeId','workId','versionId','contentType','title','contentDocument','content']),panels};
}
async function panel(result,data,remote,fail){
  if(result.bucket!=='authoring-webtoons'||typeof result.path!=='string'||!/^webtoon\/[1-9]\d{0,18}\/[0-9a-f-]{36}\/[0-2]\/[a-f0-9]{64}\.(?:webp|png)$/.test(result.path)||!decimal(result.path.split('/')[1])||!uuid(result.path.split('/')[2])||!result.path.endsWith('.'+data.format)||result.mimeType!=='image/'+data.format||!(result.bytes===null||integer(result.bytes,1,maxPanelBytes)))fail(503,'POINTS_TEST_UNAVAILABLE');
  let response;try{response=await remote('/storage/v1/object/authenticated/'+result.bucket+'/'+result.path.split('/').map(encodeURIComponent).join('/'),{method:'GET'});}catch{fail(503,'POINTS_TEST_STORAGE_UNAVAILABLE');}
  if(!response?.ok||(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!==result.mimeType||!response.body)fail(503,'POINTS_TEST_STORAGE_UNAVAILABLE');
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||!integer(Number(length),1,maxPanelBytes))){await response.body.cancel();fail(503,'POINTS_TEST_STORAGE_UNAVAILABLE');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxPanelBytes){await reader.cancel();fail(503,'POINTS_TEST_STORAGE_UNAVAILABLE');}chunks.push(value);}}catch{fail(503,'POINTS_TEST_STORAGE_UNAVAILABLE');}finally{reader.releaseLock();}
  if(!size||result.bytes!==null&&size!==result.bytes)fail(503,'POINTS_TEST_STORAGE_UNAVAILABLE');
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  return new Response(bytes,{headers:{'Content-Type':result.mimeType,'Content-Length':String(size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
}

export async function pointsTestApi({request,user,actor,rpc,remote,fail,env={}}){
  if(!pointsTestEnabled(env))fail(503,'POINTS_TEST_NOT_ACTIVATED');
  const url=new URL(request.url),admin=url.pathname==='/api/v2/admin/points-test';
  if(!admin&&url.pathname!=='/api/v2/points-test')fail(404,'NOT_FOUND');
  if(!uuid(user?.id)||actor?.userId!==user.id||user.is_anonymous||user.deleted_at||user.banned_until&&(!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>Date.now()))fail(401,'INVALID_SESSION');
  if(!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
  if(admin){if(actor.admin?.is_active!==true||actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');}
  else if(actor.reader?.status!=='ACTIVE')fail(403,'READER_REQUIRED');
  const action=url.searchParams.get('action'),table=admin?adminActions:Object.hasOwn(writes,action)?writes:reads;
  if(!Object.hasOwn(table,action))fail(400,'INVALID_ACTION');
  const write=admin||Object.hasOwn(writes,action),allowed=table[action];
  if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
  if(url.searchParams.getAll('action').length!==1||[...url.searchParams.keys()].some(key=>key!=='action'&&(write||!allowed.includes(key))||url.searchParams.getAll(key).length!==1))fail(400,'INVALID_QUERY');
  let data=write?await readJson(request,fail):Object.fromEntries(allowed.filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)]));
  if(!keys(data,allowed))fail(400,'INVALID_POINTS_REQUEST');
  if(['works','episodes','search'].includes(action)){
    if(write)data.offset=data.offset??0;else{const raw=data.offset??'0';if(!/^(0|[1-9]\d{0,5})$/.test(raw))fail(400,'INVALID_QUERY');data.offset=Number(raw);}
    if(!integer(data.offset,0,100000))fail(400,'INVALID_QUERY');
  }
  if(action==='search'){data.q=data.q??'';data.type=data.type??'ALL';if(!text(data.q,100)||!['ALL','NOVEL','WEBTOON'].includes(data.type))fail(400,'INVALID_QUERY');data.q=data.q.trim();}
  for(const key of ['workId','episodeId'])if(allowed.includes(key)&&!decimal(data[key]))fail(400,'INVALID_ID');
  if(action==='panel'&&(!uuid(data.versionId)||!uuid(data.panelId)||!['webp','png'].includes(data.format)))fail(400,'INVALID_QUERY');
  if(action==='purchase'&&(!uuid(data.quoteId)||!uuid(data.requestId)))fail(400,'INVALID_POINTS_REQUEST');
  if(admin&&['enroll','policy','credit'].includes(action)){
    if(!uuid(data.requestId)||!text(data.reason,500,3))fail(400,'REASON_REQUIRED');
    if(action!=='credit'&&!decimal(data.revision,true))fail(400,'INVALID_POINTS_REQUEST');
    if(action==='enroll'&&typeof data.enabled!=='boolean')fail(400,'INVALID_POINTS_REQUEST');
    if(action==='policy'&&(!['DEFAULT','WORK','EPISODE'].includes(data.scope)||(data.scope==='DEFAULT'?data.targetId!==null:!decimal(data.targetId))||!points(data.points)||!timestamp(data.startsAt)))fail(400,'INVALID_POINTS_REQUEST');
    if(action==='credit'&&(!uuid(data.targetUserId)||!integer(data.points,1,1_000_000)))fail(400,'INVALID_POINTS_REQUEST');
  }
  let result;
  try{result=await rpc('op04_points_test',{p_user:user.id,p_action:admin?'admin-'+action:action,p_data:data});}
  catch(error){if([400,401,403,404,409,429,503].includes(error?.status)&&safeErrors.has(error?.code))throw error;fail(503,'POINTS_TEST_UNAVAILABLE');}
  if(result?.error){if(![400,401,403,404,409,429,503].includes(result.status)||!safeErrors.has(result.error))fail(503,'POINTS_TEST_UNAVAILABLE');fail(result.status,result.error);}
  marked(result,fail);
  if(admin&&['state','enroll','policy'].includes(action))return state(result,fail);
  if(action==='works'||action==='search')return page(result,data,fail,row=>work(row,fail));
  if(action==='episodes'){if(result.work?.id!==data.workId)fail(503,'POINTS_TEST_UNAVAILABLE');return {...page(result,data,fail,row=>episode(row,fail,data.workId)),work:work(result.work,fail)};}
  if(action==='wallet'){
    if(!balance(result.balancePoints)||!Array.isArray(result.ledger)||result.ledger.length>50)fail(503,'POINTS_TEST_UNAVAILABLE');
    const ledger=result.ledger.map(row=>{if(!object(row)||!uuid(row.id)||!['CREDIT','DEBIT','TOPUP','REFUND'].includes(row.kind)||!integer(row.deltaPoints,-1_000_000,1_000_000)||row.deltaPoints===0||(['CREDIT','TOPUP'].includes(row.kind))!==(row.deltaPoints>0)||!timestamp(row.createdAt))fail(503,'POINTS_TEST_UNAVAILABLE');return pick(row,['id','kind','deltaPoints','createdAt']);});
    return {...marker,...balances(result,fail),ledger};
  }
  if(action==='quote'){
    const q=result.quote;if(!object(q)||!uuid(q.id)||q.episodeId!==data.episodeId||!decimal(q.workId)||!uuid(q.versionId)||!uuid(q.priceVersion)||!points(q.pricePoints)||!access.includes(q.access)||!timestamp(q.expiresAt)||!balance(result.balancePoints))fail(503,'POINTS_TEST_UNAVAILABLE');
    return {...marker,quote:{...pick(q,['id','episodeId','workId','versionId','priceVersion','pricePoints','access','expiresAt']),...rewardAccess(q,fail)},...balances(result,fail)};
  }
  if(action==='purchase'){
    if(!decimal(result.episodeId)||!['MEMBER_FREE','OWNED','AD_REWARD','CAMPAIGN_FREE'].includes(result.access)||!points(result.chargedPoints)||!balance(result.balancePoints)||!(result.entitlementId===null||uuid(result.entitlementId))||typeof result.replayed!=='boolean'||result.chargedPoints>0&&(result.access!=='OWNED'||result.entitlementId===null)||['AD_REWARD','CAMPAIGN_FREE'].includes(result.access)&&(result.chargedPoints!==0||result.entitlementId!==null))fail(503,'POINTS_TEST_UNAVAILABLE');
    return {...marker,...pick(result,['episodeId','access','chargedPoints','entitlementId','replayed']),...balances(result,fail),...rewardAccess(result,fail)};
  }
  if(action==='credit'){
    if(result.targetUserId!==data.targetUserId||!balance(result.balancePoints)||result.creditedPoints!==data.points||typeof result.replayed!=='boolean')fail(503,'POINTS_TEST_UNAVAILABLE');return {...marker,...pick(result,['targetUserId','creditedPoints','replayed']),...balances(result,fail)};
  }
  if(action==='content')return content(result,data,fail);
  if(action==='panel')return panel(result,data,remote,fail);
  fail(400,'INVALID_ACTION');
}
