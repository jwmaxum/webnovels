import {enrollmentDocuments} from './author-enrollment-policy.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
async function readBody(request){
 if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED');
 const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_REQUEST');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_REQUEST');}
 if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'INVALID_REQUEST');return data;
}
// Invoked before the PASS adapter, only under the explicit free-beta rollout flag.
export async function freeBetaEnrollmentApi(request,env,{fetchImpl=fetch,now=()=>Date.now()}={}){
 if(env.FREE_BETA_ENABLED!=='true')return null;
 const url=new URL(request.url),prefix='/api/v2/onboarding/author/';
 const readiness=url.pathname==='/api/v2/auth/readiness',readerSignup=url.pathname==='/api/v2/onboarding';
 if(!readiness&&!readerSignup&&!url.pathname.startsWith(prefix))return null;
 const action=readiness?'readiness':readerSignup?'reader':url.pathname.slice(prefix.length),requestId=crypto.randomUUID();
 const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'X-Request-ID':requestId,...(status===429?{'Retry-After':'60'}:{})}});
 try{
  if(!['readiness','policy','status','complete','reader'].includes(action))fail(404,'NOT_FOUND');
  if(request.method!==(['readiness','policy','status'].includes(action)?'GET':'POST'))fail(405,'METHOD_NOT_ALLOWED');
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
  const documents=(await enrollmentDocuments()).filter(d=>d.id!=='identity-privacy');
  if(env.AUTH_ONBOARDING_ENABLED!=='true'||env.ACCOUNT_API_DISABLED==='true'){
   if(action==='policy')return reply({enabled:false,mode:'FREE_BETA',identityVerified:false,documents});fail(503,'FREE_BETA_NOT_READY');
  }
  const base=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL,secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base||'')||!secret)fail(503,'SERVER_CONFIGURATION_REQUIRED');
  if(!secret.startsWith('sb_secret_')){try{if(JSON.parse(atob(secret.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role!=='service_role')fail(503,'SERVER_CONFIGURATION_REQUIRED');}catch{fail(503,'SERVER_CONFIGURATION_REQUIRED');}}
  const remote=async(path,options={})=>{
   let response;try{response=await fetchImpl(new URL(path,base),{...options,redirect:'manual',signal:AbortSignal.timeout(12000),
    headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json',...options.headers}});}catch{fail(503,'AUTH_UNAVAILABLE');}
   if(response.status>=300&&response.status<400)fail(503,'AUTH_UNAVAILABLE');return response;
  };
  const rpc=async(name,data={})=>{
   const response=await remote('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(data)});
   if(!response.ok)fail(response.status===409?409:503,response.status===409?'CONFLICT':'FREE_BETA_NOT_READY');
   let result;try{result=await response.json();}catch{fail(503,'FREE_BETA_NOT_READY');}
   if(result?.error)fail([400,401,403,404,409,429,503].includes(result.status)?result.status:503,
    /^[A-Z_]{1,80}$/.test(result.error)?result.error:'FREE_BETA_NOT_READY');return result;
  };
  const config=await rpc('free_beta_enrollment_config');
  const enabled=config?.enabled===true&&documents.every(d=>config.documents?.some(c=>c.id===d.id&&c.hash===d.hash&&c.version===d.version));
  if(action==='policy')return reply({enabled,mode:'FREE_BETA',identityVerified:false,documents});
  if(!enabled||await rpc('free_beta_enrollment_launch_ready')!==true)fail(503,'FREE_BETA_NOT_READY');
  if(action==='readiness')return reply({ready:true,mode:'FREE_BETA',authorIdentityRequired:false});
  const authorization=request.headers.get('authorization');if(!authorization)fail(401,'AUTH_REQUIRED');
  if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))fail(401,'INVALID_SESSION');
  const response=await remote('/auth/v1/user',{headers:{Authorization:authorization}});
  if(!response.ok)fail([401,403].includes(response.status)?401:503,[401,403].includes(response.status)?'INVALID_SESSION':'AUTH_UNAVAILABLE');
  const user=await response.json();
  if(!UUID.test(user?.id||'')||user.is_anonymous||user.deleted_at||(user.banned_until&&Date.parse(user.banned_until)>now()))fail(401,'INVALID_SESSION');
  if(!user.email||!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
  const call=(kind,data={})=>rpc('free_beta_enrollment',{p_user:user.id,p_action:kind,p_data:data});
  if(action==='status')return reply(await call('status'));
  const data=await readBody(request),fields=action==='reader'?['kind','displayName']:['displayName','rightsBasis','rightsAccepted','documentVersion','documentHash'];
  if(Object.keys(data).some(k=>!fields.includes(k)))fail(400,'FIELD_NOT_ALLOWED');
  if(action==='reader'&&data.kind!=='reader')fail(403,'AUTHOR_CONSENT_REQUIRED');
  if(typeof data.displayName!=='string'||data.displayName.trim().length<2||data.displayName.trim().length>40||/[<>\x00-\x1f\x7f]/.test(data.displayName))fail(400,'INVALID_SIGNUP');
  if(action==='complete'){
   if(data.rightsAccepted!==true||!['OWN','LICENSED'].includes(data.rightsBasis))fail(400,'AUTHOR_CONSENT_REQUIRED');
   const d=documents.find(d=>d.id===(data.rightsBasis==='OWN'?'copyright-own':'copyright-licensed'));
   if(data.documentVersion!==d.version||data.documentHash!==d.hash)fail(409,'AUTHOR_CONSENT_STALE');
  }
  if(await rpc('consume_authoring_signup_attempt',{p_user_id:user.id})!==true)fail(429,'RATE_LIMITED');
  const result=await call('complete',{...data,kind:action==='reader'?'reader':'author',displayName:data.displayName.trim()});
  return reply(action==='reader'?{...result,actor:await rpc('launch_account_actor',{p_user:user.id})}:result);
 }catch(e){return reply({error:e.code||'FREE_BETA_UNAVAILABLE',requestId},e.status||503);}
}
