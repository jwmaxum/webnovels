import {enrollmentDocuments} from './author-enrollment-policy.mjs';
import {verifyPortOneAuthor} from './providers/portone-identity.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT=/^ae_[a-f0-9]{32}$/;
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const safeAttempt=a=>a ? {id:a.id,status:a.status,expiresAt:a.expires_at,mode:a.mode} : null;
async function body(request) {
 if (!request.headers.get('content-type')?.includes('application/json')) fail(415,'JSON_REQUIRED');
 const reader=request.body?.getReader(); if(!reader) fail(400,'INVALID_REQUEST');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
  if(size>8192){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_REQUEST');}
 if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'INVALID_REQUEST');return data;
}
// Independent of public-content rollout. Only service RPCs touch the private enrollment schema.
export async function authorEnrollmentApi(request,env,{fetchImpl=fetch,now=()=>Date.now()}={}) {
 const url=new URL(request.url),prefix='/api/v2/onboarding/author/';
 const readiness=url.pathname==='/api/v2/auth/readiness'&&url.searchParams.get('kind')==='author';
 if(!readiness&&!url.pathname.startsWith(prefix))return null;
 const action=readiness?'readiness':url.pathname.slice(prefix.length),requestId=crypto.randomUUID();
 const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','X-Request-ID':requestId,...(status===429?{'Retry-After':'60'}:{})}});
 try {
  if(!['readiness','policy','status','start','verify','cancel','complete'].includes(action))fail(404,'NOT_FOUND');
  if(request.method!==(['readiness','policy','status'].includes(action)?'GET':'POST'))fail(405,'METHOD_NOT_ALLOWED');
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
  const documents=await enrollmentDocuments();
  const enabled=env.AUTHOR_IDENTITY_ENABLED==='true'&&env.AUTH_ONBOARDING_ENABLED==='true'&&env.ACCOUNT_API_DISABLED!=='true';
  if(!enabled){if(action==='policy')return reply({enabled:false,documents});fail(503,'AUTHOR_ENROLLMENT_NOT_READY');}
  const base=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL,secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(base||'')||!secret)fail(503,'SERVER_CONFIGURATION_REQUIRED');
  if(!secret.startsWith('sb_secret_')){try{if(JSON.parse(atob(secret.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role!=='service_role')fail(503,'SERVER_CONFIGURATION_REQUIRED');}catch{fail(503,'SERVER_CONFIGURATION_REQUIRED');}}
  const remote=async(path,options={})=>{
   let r;try{r=await fetchImpl(new URL(path,base),{...options,redirect:'manual',signal:AbortSignal.timeout(12000),
    headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json',...options.headers}});}catch{fail(503,'AUTH_UNAVAILABLE');}
   if(r.status>=300&&r.status<400)fail(503,'AUTH_UNAVAILABLE');return r;
  };
  const rpc=async(name,data={})=>{
   const r=await remote('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(data)});
   if(!r.ok)fail(r.status===409?409:503,r.status===409?'CONFLICT':'AUTHOR_ENROLLMENT_NOT_READY');
   let result;try{result=await r.json();}catch{fail(503,'AUTHOR_ENROLLMENT_NOT_READY');}
   if(result?.error)fail([400,401,403,404,409,429,503].includes(result.status)?result.status:503,
    /^[A-Z_]{1,80}$/.test(result.error)?result.error:'AUTHOR_ENROLLMENT_NOT_READY');return result;
  };
  const config=await rpc('author_enrollment_config');
  const matches=config?.enabled===true&&config.store_id===env.PORTONE_STORE_ID&&config.channel_key===env.AUTHOR_IDENTITY_CHANNEL_KEY&&
   config.mode===env.AUTHOR_IDENTITY_MODE&&config.pg_provider===env.AUTHOR_IDENTITY_PG_PROVIDER&&
   config.identifier_type===env.AUTHOR_IDENTITY_IDENTIFIER_TYPE&&config.key_version===env.AUTHOR_IDENTITY_KEY_VERSION&&
   ['LIVE','TEST'].includes(config.mode)&&['DANAL','INICIS_UNIFIED'].includes(config.pg_provider)&&
   ['CI','DI'].includes(config.identifier_type)&&!(config.pg_provider==='INICIS_UNIFIED'&&config.identifier_type!=='CI')&&
   !!env.PORTONE_API_SECRET&&/^[a-f0-9]{64}$/i.test(env.AUTHOR_IDENTITY_HMAC_KEY||'')&&
   documents.every(d=>config.documents?.some(c=>c.id===d.id&&c.version===d.version&&c.hash===d.hash));
  if(action==='policy')return reply({enabled:matches,mode:matches?config.mode:null,documents});
  if(!matches)fail(503,'AUTHOR_ENROLLMENT_NOT_READY');
  if(env.P0_API_ENABLED!=='true'&&await rpc('author_enrollment_launch_ready')!==true)fail(503,'AUTHOR_ENROLLMENT_NOT_READY');
  if(action==='readiness'){
   if(config.mode!=='LIVE')fail(503,'AUTHOR_ENROLLMENT_NOT_READY');return reply({ready:true,authorIdentityRequired:true});
  }
  const authorization=request.headers.get('authorization');
  if(!authorization)fail(401,'AUTH_REQUIRED');
  if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))fail(401,'INVALID_SESSION');
  const auth=await remote('/auth/v1/user',{headers:{Authorization:authorization}});
  if(!auth.ok)fail([401,403].includes(auth.status)?401:503,[401,403].includes(auth.status)?'INVALID_SESSION':'AUTH_UNAVAILABLE');
  const user=await auth.json();
  if(!UUID.test(user?.id||'')||user.is_anonymous||user.deleted_at||(user.banned_until&&Date.parse(user.banned_until)>now()))fail(401,'INVALID_SESSION');
  if(!user.email||!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
  const call=(kind,data={})=>rpc('author_enrollment',{p_user:user.id,p_action:kind,p_data:data});
  if(action==='status'){const r=await call('status');return reply({completed:r.completed,existingAuthor:r.existingAuthor,attempt:safeAttempt(r.attempt)});}
  const data=await body(request);
  const fields=action==='start'?['requestKey','rightsBasis','rightsAccepted','privacyAccepted','documentVersion','documentHash','privacyVersion','privacyHash']:
   action==='complete'?['attemptId','displayName']:['attemptId'];
  if(Object.keys(data).some(k=>!fields.includes(k)))fail(400,'FIELD_NOT_ALLOWED');
  if(action==='start'){
   if(!UUID.test(data.requestKey||'')||data.rightsAccepted!==true||data.privacyAccepted!==true||!['OWN','LICENSED'].includes(data.rightsBasis))fail(400,'AUTHOR_CONSENT_REQUIRED');
   const d=documents.find(d=>d.id===(data.rightsBasis==='OWN'?'copyright-own':'copyright-licensed')),p=documents.find(d=>d.id==='identity-privacy');
   if(data.documentVersion!==d.version||data.documentHash!==d.hash||data.privacyVersion!==p.version||data.privacyHash!==p.hash)fail(409,'AUTHOR_CONSENT_STALE');
  }else if(!ATTEMPT.test(data.attemptId||''))fail(400,'IDENTITY_ATTEMPT_INVALID');
  if(action==='complete'&&(typeof data.displayName!=='string'||data.displayName.trim().length<2||data.displayName.trim().length>40||/[<>\x00-\x1f\x7f]/.test(data.displayName)))fail(400,'INVALID_SIGNUP');
  if(await rpc('consume_authoring_signup_attempt',{p_user_id:user.id})!==true)fail(429,'RATE_LIMITED');
  if(action==='start'){
   const r=await call('start',data),a=r.attempt;
   return reply({attempt:safeAttempt(a),request:{storeId:a.store_id,channelKey:a.channel_key,identityVerificationId:a.id,
    redirectUrl:url.origin+'/?auth=author-identity',...(a.pg_provider==='INICIS_UNIFIED'?{bypass:{inicisUnified:{flgFixedUser:'N',directAgency:'PASS'}}}:{})}});
  }
  if(action==='verify'){
   const {attempt}=await call('get',{attemptId:data.attemptId});
   if(attempt.status==='CONSUMED'||attempt.status==='VERIFIED')return reply({completed:attempt.status==='CONSUMED',attempt:safeAttempt(attempt)});
   let proof;
   try{proof=await verifyPortOneAuthor({attempt,actorId:user.id,apiSecret:env.PORTONE_API_SECRET,
    storeId:config.store_id,channelKey:config.channel_key,mode:config.mode,pgProvider:config.pg_provider,
    identifierType:config.identifier_type,hmacKey:env.AUTHOR_IDENTITY_HMAC_KEY,keyVersion:config.key_version,now:now()},fetchImpl);}
   catch(e){const allowed=['IDENTITY_ATTEMPT_INVALID','IDENTITY_CONFIGURATION_REQUIRED','IDENTITY_NOT_VERIFIED','IDENTITY_TIMESTAMP_INVALID','AUTHOR_IDENTITY_ATTRIBUTES_REQUIRED'];
    fail(e.message==='IDENTITY_PROVIDER_UNAVAILABLE'?503:409,allowed.includes(e.message)?e.message:'IDENTITY_PROVIDER_UNAVAILABLE');}
   const r=await call('verify',{attemptId:data.attemptId,...proof});return reply({completed:!!r.completed,attempt:safeAttempt(r.attempt)});
  }
  if(action==='complete'){
   if(config.mode!=='LIVE')fail(403,'TEST_IDENTITY_NOT_ACCEPTED');
   const r=await call('complete',{...data,displayName:data.displayName.trim()});return reply({completed:r.completed,created:!!r.created});
  }
  return reply(await call('cancel',data));
 }catch(e){return reply({error:e.code||'AUTHOR_ENROLLMENT_UNAVAILABLE',requestId},e.status||503);}
}
