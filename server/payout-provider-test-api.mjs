import {encryptProviderSettings,decryptProviderSettings,providerKeyReady} from './provider-settings-crypto.mjs';
import {payoutsTossTestRequest,reconcilePayoutTest} from './providers/payouts-toss-test.mjs';

const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fields=['secretKey','securityKey','merchantId','webhookKeyBase64'];
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
export const payoutTestRuntimeEnabled=env=>env.PAYOUT_PROVIDER_TEST_ENABLED==='true'&&env.PAYOUT_PROVIDER_TEST_ENVIRONMENT==='TEST'&&uuid(env.PAYOUT_PROVIDER_TEST_CONFIG_ID);
export const payoutTestSettingsEnabled=env=>env.PAYOUT_PROVIDER_TEST_SETTINGS_ENABLED==='true';
export function validPayoutTestValues(v){
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===4&&Object.keys(v).every(k=>fields.includes(k))&&
 typeof v.secretKey==='string'&&/^test_(?:g)?sk_[A-Za-z0-9_-]{1,200}$/.test(v.secretKey)&&!v.secretKey.includes('_docs_')&&
 typeof v.securityKey==='string'&&/^[a-f0-9]{64}$/i.test(v.securityKey)&&typeof v.merchantId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v.merchantId)&&
 typeof v.webhookKeyBase64==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(v.webhookKeyBase64)&&btoa(atob(v.webhookKeyBase64))===v.webhookKeyBase64;
}
async function readBytes(request,max=16384){
 if(!request.headers.get('content-type')?.split(';')[0].trim().endsWith('/json'))fail(415,'JSON_REQUIRED');
 const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_PAYOUT_REQUEST');const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
const parse=bytes=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_PAYOUT_REQUEST');}};
const runtime=(rpc,action,data={})=>rpc('op10_payout_runtime',{p_action:action,p_data:data});
async function valuesFrom(row,env){
 let values;try{values=await decryptProviderSettings(row.envelope,{provider:'TOSS_PAYOUT',mode:'TEST',env});}catch{fail(503,'PROVIDER_KEY_UNAVAILABLE');}
 if(!validPayoutTestValues(values)||values.merchantId!==row.merchantId)fail(503,'PAYOUT_CONFIGURATION_REQUIRED');return values;
}
function jobDto(j){
 if(!j||!uuid(j.id))fail(503,'PAYOUT_RESULT_INVALID');
 return Object.fromEntries(['id','sourceId','authorId','amountKrw','configId','state','createdAt','dispatchedAt','providerPayoutId','refPayoutId','destination','scheduleType','payoutDate','transactionDescription'].map(k=>[k,j[k]]));
}
const safeResult=r=>({...(r.job?{job:jobDto(r.job)}:{}),...(Array.isArray(r.items)?{items:r.items.map(jobDto),total:r.total,offset:r.offset}:{}),...(Array.isArray(r.evidence)?{evidence:r.evidence.map(x=>({state:x.state,requestedAt:x.requestedAt||null}))}:{})});

// Lease serializes network observations. A create claim is permanently one-shot,
// even after process death; expiry permits queries, never a replacement transfer.
export async function processPayoutTest({id,operation='query',actorId,env,rpc,fetchImpl=fetch}){
 if(!payoutTestRuntimeEnabled(env)||!providerKeyReady(env))fail(503,'PAYOUT_TEST_NOT_ACTIVATED');
 if(!uuid(id)||!['create','query'].includes(operation))fail(400,'INVALID_PAYOUT_REQUEST');
 const claim=await runtime(rpc,operation==='create'?'claim-create':'claim-query',{id,...(operation==='create'?{actorId,reviewedConfigId:env.PAYOUT_PROVIDER_TEST_CONFIG_ID}:{})});
 if(!claim.claimed)return {claimed:false,reviewRequired:claim.reviewRequired===true};
 let observation={state:'UNKNOWN'};
 try{
  const values=await valuesFrom(claim,env),args={order:claim.job,...values};
  observation=operation==='create'?await payoutsTossTestRequest({...args,operation},fetchImpl):await reconcilePayoutTest(args,fetchImpl);
 }catch{/* Persist uncertainty without logging secrets, raw responses, or author details. */}
 const result=await runtime(rpc,'observe',{id,leaseId:claim.leaseId,observation});
 return {claimed:true,...safeResult(result)};
}
export async function reconcileDuePayoutTests({env,rpc,fetchImpl=fetch}){
 if(!payoutTestRuntimeEnabled(env)||env.PAYOUT_PROVIDER_TEST_RECONCILE_ENABLED!=='true')return {processed:0};
 const due=await runtime(rpc,'due');let processed=0,failed=0;
 for(const id of (due.items||[]).slice(0,5)){try{await processPayoutTest({id,env,rpc,fetchImpl});processed++;}catch{failed++;}}
 if(failed)fail(503,'PAYOUT_RECONCILIATION_INCOMPLETE');return {processed};
}

export async function payoutProviderTestApi({request,user,actor,remote,rpc,env,fetchImpl=fetch}){
 if(!payoutTestSettingsEnabled(env))fail(503,'PAYOUT_TEST_NOT_ACTIVATED');
 if(!actor.admin?.is_active||actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');
 const url=new URL(request.url);if(url.search)fail(400,'INVALID_QUERY');
 const call=(action,data={})=>rpc('op10_payout_admin',{p_user:user.id,p_action:action,p_data:data});
 if(request.method==='GET'){
  const state=await call('state');return {revision:state.revision,configId:state.configId,configured:state.configured,keyReady:providerKeyReady(env),runtimeEnabled:payoutTestRuntimeEnabled(env),reviewedConfigId:env.PAYOUT_PROVIDER_TEST_CONFIG_ID||null,liveReady:false,ledgerApplyAllowed:false};
 }
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 const d=parse(await readBytes(request));
 const allowed={save:['action','revision','values','password'],list:['action','offset'],detail:['action','id'],prepare:['action','id','sourceId','configId','destination','scheduleType','payoutDate','transactionDescription'],dispatch:['action','id'],reconcile:['action','id']};
 if(!d||!Object.hasOwn(allowed,d.action)||Array.isArray(d)||Object.keys(d).some(k=>!allowed[d.action].includes(k)))fail(400,'INVALID_PAYOUT_REQUEST');
 const {action,...data}=d;
 if(action==='save'){
  if(!providerKeyReady(env))fail(503,'PROVIDER_KEY_REQUIRED');
  if(!validPayoutTestValues(data.values)||typeof data.revision!=='string'||!/^(0|[1-9]\d{0,17})$/.test(data.revision))fail(400,'INVALID_PAYOUT_REQUEST');
  if(typeof data.password!=='string'||!data.password||data.password.length>1024||!user.email)fail(400,'ADMIN_REAUTH_REQUIRED');
  await call('attempt');
  const login=await remote('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:user.email,password:data.password})});data.password='';d.password='';
  if(!login.ok)fail(login.status===429?429:403,login.status===429?'RATE_LIMITED':'ADMIN_REAUTH_FAILED');
  const proof=await login.json();if(!proof.access_token)fail(403,'ADMIN_REAUTH_FAILED');
  const logout=await remote('/auth/v1/logout?scope=local',{method:'POST',headers:{Authorization:'Bearer '+proof.access_token}});
  if(!logout.ok||proof.user?.id!==user.id)fail(403,'ADMIN_REAUTH_FAILED');
  const envelope=await encryptProviderSettings(data.values,{provider:'TOSS_PAYOUT',mode:'TEST',env});
  const result=await call('save',{revision:data.revision,merchantId:data.values.merchantId,envelope});
  for(const field of fields)data.values[field]='';
  return {saved:result.saved,revision:result.revision,configId:result.configId,configured:result.configured,activationAvailable:false};
 }
 if(['dispatch','reconcile'].includes(action)){
  if(!payoutTestRuntimeEnabled(env))fail(503,'PAYOUT_TEST_NOT_ACTIVATED');
  await call('authorize',data);
  return processPayoutTest({id:data.id,operation:action==='dispatch'?'create':'query',actorId:user.id,env,rpc,fetchImpl});
 }
 return safeResult(await call(action,data));
}

// The operator supplies explicit HMAC key bytes as base64; do not infer the
// provider's text/hex key encoding from the unrelated JWE encryption contract.
export async function verifyPayoutWebhook(bytes,headers,keyBase64,now=Date.now()){
 const time=headers.get('tosspayments-webhook-transmission-time'),signatures=headers.get('tosspayments-webhook-signature');
 if(!time||time.length>64||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(time)||!Number.isFinite(Date.parse(time))||Math.abs(now-Date.parse(time))>300000||!signatures||signatures.length>2048||bytes.byteLength>16384)return false;
 try{
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(keyBase64),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const suffix=new TextEncoder().encode(':'+time),payload=new Uint8Array(bytes.length+suffix.length);payload.set(bytes);payload.set(suffix,bytes.length);
  const parts=signatures.split(',');if(parts.length>24)return false;
  for(const part of parts){const match=/^v1:([A-Za-z0-9+/]{43}=)$/.exec(part.trim());if(match&&await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0)),payload))return true;}
 }catch{return false;}return false;
}
export async function payoutProviderTestCallback({request,env,rpc}){
 if(!payoutTestRuntimeEnabled(env)||env.PAYOUT_PROVIDER_TEST_WEBHOOK_ENABLED!=='true')fail(503,'PAYOUT_TEST_NOT_ACTIVATED');
 const url=new URL(request.url),configId=url.searchParams.get('configId');
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
 if(!uuid(configId)||[...url.searchParams.keys()].length!==1)fail(400,'INVALID_QUERY');
 const bytes=await readBytes(request),row=await runtime(rpc,'config',{configId}),values=await valuesFrom(row,env);
 if(!await verifyPayoutWebhook(bytes,request.headers,values.webhookKeyBase64))fail(401,'INVALID_WEBHOOK_SIGNATURE');
 const body=parse(bytes),p=body?.entityBody;
 if(body?.eventType!=='payout.changed'||body.entityType!=='payout'||typeof body.eventId!=='string'||!/^[A-Za-z0-9_.:-]{1,64}$/.test(body.eventId)||!p||typeof p.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(p.id)||typeof p.refPayoutId!=='string'||!/^wn10-[a-f0-9-]{36}$/.test(p.refPayoutId))fail(400,'INVALID_PAYOUT_REQUEST');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const r=await runtime(rpc,'inbox',{configId,eventId:body.eventId,refPayoutId:p.refPayoutId,providerPayoutId:p.id,digest});
 return {accepted:r.accepted===true}; // A signed notification only queues GET reconciliation.
}
