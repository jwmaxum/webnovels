// Server-authenticated operational inventory; monetary records are read-only.
const READS=new Set(['dashboard','works','episodes','accounts','cases','settlements','roles','audit']);
const PERMISSIONS=new Set(['OPERATIONS_READ','ACCOUNTS_READ','CONTENT_METADATA_READ','CASE_READ','CASE_RESOLVE',
  'CONTENT_REVIEW','COMMENT_REPORT','CONTENT_MODERATE','CURATION_WRITE','AUDIT_READ','ACCOUNT_MODERATE','SETTLEMENTS_READ']);
export async function adminConsoleApi({request,user,actor,remote,rpc,fail}) {
  if(!actor.admin?.is_active)fail(403,'ADMIN_FORBIDDEN');
  const url=new URL(request.url),action=url.searchParams.get('action')||'dashboard';
  let data={};
  if(READS.has(action)){
    if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
    const fields=['action','offset',...(['works','episodes','accounts'].includes(action)?['q']:[]),
      ...(action==='accounts'?['kind']:[]),...(action==='cases'?['source']:[])];
    if([...url.searchParams.keys()].some(k=>!fields.includes(k)||url.searchParams.getAll(k).length!==1))fail(400,'INVALID_QUERY');
    const offset=url.searchParams.get('offset')||'0',q=url.searchParams.get('q')||'';
    if(!/^\d{1,6}$/.test(offset)||Number(offset)>100000||q.length>100)fail(400,'INVALID_QUERY');
    data={offset:Number(offset),q};
    if(action==='accounts'){
      data.kind=url.searchParams.get('kind');if(!['author','reader'].includes(data.kind))fail(400,'INVALID_KIND');
    }
    if(action==='cases'){
      data.source=url.searchParams.get('source');if(!['CONTENT_REVIEW','REPORT'].includes(data.source))fail(400,'INVALID_CASE_SOURCE');
    }
  }else if(action==='role-update'){
    if(actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');
    if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
    if([...url.searchParams.keys()].some(k=>k!=='action')||url.searchParams.getAll('action').length!==1)fail(400,'INVALID_QUERY');
    if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
    if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED');
    const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_PERMISSIONS');
    let size=0;const parts=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();fail(413,'BODY_TOO_LARGE');}parts.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_PERMISSIONS');}
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['adminId','revision','permissions','reason','password'].includes(k))||
      !/^[0-9a-f-]{36}$/i.test(body.adminId||'')||!/^[0-9a-f]{32}$/.test(body.revision||'')||
      !Array.isArray(body.permissions)||body.permissions.length>PERMISSIONS.size||body.permissions.some(p=>!PERMISSIONS.has(p))||
      typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500)fail(400,'INVALID_PERMISSIONS');
    if(typeof body.password!=='string'||!body.password||body.password.length>1024||!user.email)fail(400,'ADMIN_REAUTH_REQUIRED');
    // Reauthenticate the current verified administrator, never a client-supplied email/UUID.
    const login=await remote('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:user.email,password:body.password})});
    if(!login.ok)fail(login.status===429?429:login.status>=500?503:403,
      login.status===429?'RATE_LIMITED':login.status>=500?'AUTH_UNAVAILABLE':'ADMIN_REAUTH_FAILED');
    const proof=await login.json();
    if(!proof.access_token)fail(503,'ADMIN_REAUTH_FAILED');
    const logout=await remote('/auth/v1/logout?scope=local',{method:'POST',headers:{Authorization:'Bearer '+proof.access_token}});
    if(!logout.ok||proof.user?.id!==user.id)fail(403,'ADMIN_REAUTH_FAILED');
    const {password,...safe}=body;data=safe;
  }else fail(400,'INVALID_ACTION');
  return rpc('launch_admin_console',{p_user:user.id,p_action:action,p_data:data});
}
