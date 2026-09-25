// Bounded account rollout with a separate, operator-enabled database readiness gate.
// Content, publication and signup continue through the existing P0 gates.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
export async function accountApi(request,env,{fetchImpl=fetch}={}) {
  const url=new URL(request.url),path=url.pathname;
  const me=path==='/api/v2/me'&&env.P0_API_ENABLED!=='true';
  if(!me&&!['/api/v2/accounts/health','/api/v2/admin/virtual-accounts'].includes(path))return null;
  const requestId=crypto.randomUUID();
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-ID':requestId}});
  try {
    if(env.ACCOUNT_API_DISABLED==='true')fail(503,'ACCOUNT_SERVICE_NOT_ACTIVATED');
    const base=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
    const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base||'')||!secret)fail(503,'SERVER_CONFIGURATION_REQUIRED');
    if(!secret.startsWith('sb_secret_')){
      try{if(JSON.parse(atob(secret.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role!=='service_role')fail(503,'SERVER_CONFIGURATION_REQUIRED');}
      catch{fail(503,'SERVER_CONFIGURATION_REQUIRED');}
    }
    const remote=async(route,options={})=>{
      let response;
      try {response=await fetchImpl(new URL(route,base),{...options,redirect:'error',signal:AbortSignal.timeout(12000),
        headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json',...options.headers}});}
      catch{fail(503,'AUTH_UNAVAILABLE');}
      return response;
    };
    const rpc=async(name,body={})=>{
      const response=await remote('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(body)});
      if(!response.ok)fail(503,'ACCOUNT_SERVICE_NOT_ACTIVATED');
      const data=await response.json();
      if(data?.error)fail([400,401,403,404,409,429,503].includes(data.status)?data.status:503,data.error);
      return data;
    };
    if(await rpc('launch_accounts_ready')!==true)fail(503,'ACCOUNT_SERVICE_NOT_ACTIVATED');
    if(path==='/api/v2/accounts/health'){
      if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
      return reply({status:'ok',scope:'accounts'});
    }
    const authorization=request.headers.get('authorization');
    if(!authorization)fail(401,'AUTH_REQUIRED');
    if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))fail(401,'INVALID_SESSION');
    const response=await remote('/auth/v1/user',{headers:{Authorization:authorization}});
    if(!response.ok)fail([401,403].includes(response.status)?401:503,[401,403].includes(response.status)?'INVALID_SESSION':'AUTH_UNAVAILABLE');
    const user=await response.json();
    if(!UUID.test(user.id||'')||user.is_anonymous||user.deleted_at||(user.banned_until&&Date.parse(user.banned_until)>Date.now()))fail(401,'INVALID_SESSION');
    if(!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
    const actor=await rpc('launch_account_actor',{p_user:user.id});
    if(me){
      if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
      return reply({...actor,accountServiceReady:true,accountServiceOnly:true});
    }
    if(!actor.admin?.is_active||actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');
    if([...url.searchParams.keys()].some(k=>k!=='action'))fail(400,'INVALID_QUERY');
    const action=url.searchParams.get('action')||'list';
    let data={};
    if(['list','audit'].includes(action)){
      if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
    }else{
      if(!['update','suspend','restore','delete','sync'].includes(action))fail(400,'INVALID_ACTION');
      if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
      if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
      if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED');
      const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_ACCOUNT_REQUEST');
      const chunks=[];let size=0;
      while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>12000){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(item.value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_ACCOUNT_REQUEST');}
      const fields=action==='update'?['kind','id','revision','reason','displayName','bio']:['kind','id','revision','reason'];
      if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!fields.includes(k))||
        !['author','reader'].includes(data.kind)||!(/^[1-9]\d{0,18}$/).test(data.id||'')||
        typeof data.id!=='string'||typeof data.revision!=='string'||!(/^[1-9]\d{0,18}$/).test(data.revision))fail(400,'INVALID_ACCOUNT_REQUEST');
      if(action!=='sync'&&(typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500))fail(400,'REASON_REQUIRED');
      if(action==='update'&&(typeof data.displayName!=='string'||data.displayName.trim().length<2||data.displayName.trim().length>40||
        /[<>\x00-\x1f\x7f]/.test(data.displayName)||typeof data.bio!=='string'||data.bio.length>2000))fail(400,'INVALID_PROFILE');
    }
    let result=await rpc('manage_virtual_account',{p_user:user.id,p_action:action,p_data:data});
    if(result.account?.authSyncPending){
      if(!UUID.test(result.authUserId||'')||typeof result.ban!=='boolean')fail(503,'AUTH_SYNC_REQUIRED');
      const sync=await remote('/auth/v1/admin/users/'+result.authUserId,{method:'PUT',body:JSON.stringify({ban_duration:result.ban?'876000h':'none'})});
      if(!sync.ok)return reply({error:'AUTH_SYNC_REQUIRED',requestId,account:result.account},503);
      result=await rpc('manage_virtual_account',{p_user:user.id,p_action:'sync-complete',p_data:{kind:data.kind,id:data.id,revision:result.account.revision}});
    }
    const {authUserId,ban,...safe}=result;
    return reply(safe);
  }catch(error){return reply({error:error.code||'ACCOUNT_SERVICE_UNAVAILABLE',requestId},error.status||503);}
}
