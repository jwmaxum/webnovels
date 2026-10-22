// Technical observations only: never collect paths, bodies, user IDs, IPs or tokens.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function operationArea(request,env){
 const path=new URL(request.url).pathname;
 if(!['POST','PUT','PATCH','DELETE'].includes(request.method))return null;
 if(/^\/api\/v2\/creator\/drafts(?:\/|$)/.test(path)&&env.AUTHOR_WORKSPACE_DISABLED!=='true')return 'DRAFT';
 if(env.P0_API_ENABLED==='true'&&env.AUTHOR_PUBLISH_ENABLED==='true'){
  if(/^\/api\/v2\/creator\/.*(?:files|webtoon|assets|cover)(?:\/|$)/.test(path))return 'UPLOAD';
  if(/^\/api\/v2\/creator\/.*(?:publications|publish|schedules)(?:\/|$)/.test(path))return 'PUBLICATION';
 }
 if((env.FREE_BETA_ENABLED==='true'||env.AUTHOR_IDENTITY_ENABLED==='true')&&/^\/api\/v2\/onboarding(?:\/|$)/.test(path))return 'ONBOARDING';
 return null;
}
export async function observeOperation(request,env,next,{fetchImpl=fetch,now=Date.now,context}={}){
 const area=env.BETA_OPERATIONS_ENABLED==='true'?operationArea(request,env):null;
 const start=now(),response=await next();
 // Authentication/validation refusals are not service failures. Only completed writes,
 // revision conflicts and server failures are counted; this is not site-wide traffic.
 if(!area||!(response.ok||response.status===409||response.status>=500))return response;
 const base=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL,secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base||'')||!secret)return response;
 if(!secret.startsWith('sb_secret_')){
  try{if(JSON.parse(atob(secret.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role!=='service_role')return response;}catch{return response;}
 }
 const requestId=response.headers.get('X-Request-ID');
 const payload={p_request:UUID.test(requestId||'')?requestId:crypto.randomUUID(),p_area:area,
  p_status:response.status,p_duration:Math.max(0,Math.min(60000,Math.round(now()-start)))};
 const save=async()=>{
  try{const result=await fetchImpl(new URL('/rest/v1/rpc/record_beta_operation',base),{method:'POST',redirect:'manual',
   signal:AbortSignal.timeout(2000),headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json'},
   body:JSON.stringify(payload)});await result.body?.cancel();}catch{/* Observation loss must never undo a successful save. */}
 };
 const pending=save();if(context?.waitUntil)context.waitUntil(pending);else await pending;
 return response;
}
export async function betaOperationsApi({request,user,actor,rpc,fail,env}){
 if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
 if(new URL(request.url).search)fail(400,'INVALID_QUERY');
 if(actor.userId!==user.id||!actor.admin?.is_active||!(actor.admin.role==='SUPER_ADMIN'||actor.admin.permissions?.includes('OPERATIONS_READ')))fail(403,'ADMIN_FORBIDDEN');
 if(env.BETA_OPERATIONS_ENABLED!=='true')fail(503,'BETA_OPERATIONS_NOT_READY');
 const result=await rpc('beta_operations_dashboard',{p_user:user.id});
 return {...result,enabled:true};
}
