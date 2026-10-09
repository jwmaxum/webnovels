import {recoveryReviewEnabled} from './recovery-review-policy.mjs';
import {SECURITY_HEADERS} from './security-headers.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reads={'recovery-list':['offset'],'recovery-detail':['recoveryId']};
const writes={'recovery-source':['recoveryId','contextDigest','kind'],
 'recovery-decide':['recoveryId','contextDigest','revision','decision','evidence','accessId','rightsChecked','ratingChecked','aiChecked']};
export async function adminRecoveryApi({request,env,actor,db,readBody,fail,fetchImpl,base,serviceHeaders}){
 if(!recoveryReviewEnabled(env))fail(503,'ADMIN_RECOVERY_REVIEW_NOT_ACTIVATED');
 const url=new URL(request.url),action=url.searchParams.get('action'),write=Object.hasOwn(writes,action);
 if(!write&&!Object.hasOwn(reads,action))fail(400,'INVALID_ACTION');
 if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
 for(const key of url.searchParams.keys())if(!['action',...(write?[]:reads[action])].includes(key)||url.searchParams.getAll(key).length!==1)fail(400,'INVALID_QUERY');
 const who=await actor();if(!who.admin?.is_active||!['SUPER_ADMIN','ADMIN','SUB_ADMIN'].includes(who.admin.role))fail(403,'ADMIN_REQUIRED');
 let data={};
 if(write){
  if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');data=await readBody(request);
  if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>16000||Object.keys(data).some(k=>!['requestId','reason',...writes[action]].includes(k))||writes[action].some(k=>!(k in data)))fail(400,'INVALID_FIELD');
  if(!UUID.test(data.requestId||'')||typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>500||!/^[a-f0-9]{32}$/.test(data.contextDigest||''))fail(400,'INVALID_FIELD');
 }else for(const key of reads[action])if(url.searchParams.has(key))data[key]=url.searchParams.get(key);
 if(action!=='recovery-list'&&!UUID.test(data.recoveryId||''))fail(400,'INVALID_FIELD');
 if('offset' in data&&(!/^\d{1,6}$/.test(data.offset)||Number(data.offset)>100000))fail(400,'INVALID_FIELD');
 if(action==='recovery-source'&&!['manuscript','original'].includes(data.kind))fail(400,'INVALID_FIELD');
 if(action==='recovery-decide'&&(typeof data.revision!=='string'||!/^(0|[1-9]\d{0,18})$/.test(data.revision)||BigInt(data.revision)>9223372036854775806n||
  !['HOLD','REJECTED','READY_FOR_RESTORE_REVIEW'].includes(data.decision)||typeof data.evidence!=='string'||data.evidence.length>2000||
  (data.accessId!==null&&!UUID.test(data.accessId||''))||['rightsChecked','ratingChecked','aiChecked'].some(k=>typeof data[k]!=='boolean')))fail(400,'INVALID_FIELD');
 const result=await db('rpc/stage29_admin_recovery',{}, {method:'POST',body:{p_user:who.userId,p_action:action,p_data:data}});
 if(result?.error)fail([400,403,404,409].includes(result.status)?result.status:503,result.error);
 if(!result||typeof result!=='object'||Array.isArray(result))fail(503,'WORKFLOW_UNAVAILABLE');
 if(action!=='recovery-source'||data.kind!=='original')return result;
 // RPC authorizes only the request's frozen file. Fetch bounded private bytes, never a client path.
 const file=result.file,size=Number(file?.size);
 if(file?.bucket!=='authoring-originals'||typeof file.key!=='string'||file.key.split('/').some(s=>!s||s==='.'||s==='..'||/[\x00-\x1f\\]/.test(s))||
  !/^[a-f0-9]{64}$/.test(file.sha256||'')||!Number.isSafeInteger(size)||size<1||size>2*1024*1024)fail(503,'RECOVERY_FILE_UNAVAILABLE');
 const response=await fetchImpl(new URL('/storage/v1/object/authenticated/'+file.bucket+'/'+file.key.split('/').map(encodeURIComponent).join('/'),base),{
  headers:serviceHeaders,redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)fail(503,'STORAGE_UNAVAILABLE');
 const reader=response.body.getReader(),parts=[];let count=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>size||count>2*1024*1024){await reader.cancel();fail(409,'RECOVERY_FILE_CHECKSUM_MISMATCH');}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(count);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(count!==size||digest!==file.sha256)fail(409,'RECOVERY_FILE_CHECKSUM_MISMATCH');
 return new Response(bytes,{headers:{...SECURITY_HEADERS,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="recovery-original.bin"',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Recovery-Access-ID':result.accessId}});
}
