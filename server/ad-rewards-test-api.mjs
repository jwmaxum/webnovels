import {pointsTestEnabled} from './points-test-api.mjs';
import {internalTestRewardChannel,isVerifiedInternalTestProof} from './providers/internal-test-reward.mjs';
export {verifyInternalTestCallback} from './providers/internal-test-reward.mjs';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const decimal=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const text=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min&&!/[\x00-\x1f\x7f]/.test(v)&&!/[\uD800-\uDFFF]/u.test(v);
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const pick=(v,fields)=>Object.fromEntries(fields.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]));
const marker={mode:'TEST',provenance:'LOCAL_SIMULATED'},providers=['NONE','INTERNAL_TEST'],kinds=['AD_REWARD','CAMPAIGN_FREE'];
const access=['MEMBER_FREE','OWNED','AD_REWARD','CAMPAIGN_FREE','LOCKED'],statuses=['WAITING_EVIDENCE','CLOSED_PENDING','GRANTED','NO_FILL','REJECTED','EXPIRED'];
const fallback=Object.freeze({kind:'POINTS',chargePath:'/charging-test',amountKrw:10000,points:10000,defaultEpisodePoints:100});
const reads={options:['episodeId'],status:['sessionId']},writes={start:['episodeId','kind','consent','policyVersion','requestId'],close:['sessionId','requestId']};
const adminActions={state:[],policy:['revision','adEnabled','campaignEnabled','rewardHours','sessionMinutes','graceMinutes','dailyLimit','campaignTitle','campaignStartsAt','campaignEndsAt','reason','requestId'],sessions:['status','offset']};
const safeErrors=new Set(['AUTH_REQUIRED','INVALID_SESSION','EMAIL_CONFIRMATION_REQUIRED','ADMIN_FORBIDDEN','READER_REQUIRED','INVALID_REWARD_REQUEST','CONSENT_REQUIRED','SESSION_NOT_FOUND','CONTENT_NOT_AVAILABLE','TEST_WORK_NOT_FOUND','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','REWARD_EXPIRED','REWARD_BINDING_MISMATCH','REWARD_POLICY_CHANGED','REWARD_SESSION_PENDING','EVENT_CONFLICT','REWARD_EVIDENCE_EXPIRED','RATE_LIMITED','PROVIDER_NOT_READY','INVALID_REWARD_EVIDENCE','AD_REWARDS_TEST_NOT_READY','AD_REWARDS_TEST_UNAVAILABLE']);
export const adRewardsTestEnabled=(env={})=>pointsTestEnabled(env)&&env.AD_REWARDS_TEST_ENABLED==='true'&&env.AD_REWARDS_TEST_ENVIRONMENT==='TEST'&&providers.includes(env.AD_REWARDS_TEST_PROVIDER??'NONE');

async function body(request,fail){
 if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'ORIGIN_REQUIRED');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');
 if(Number(request.headers.get('content-length'))>16384)fail(413,'BODY_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)fail(400,'BODY_REQUIRED');const chunks=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_REWARD_REQUEST');}if(!object(value))fail(400,'INVALID_REWARD_REQUEST');return value;
}
function stamped(result,fail){if(!object(result)||result.mode!=='TEST'||result.provenance!=='LOCAL_SIMULATED'||!providers.includes(result.provider))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');return {...marker,provider:result.provider};}
function validPolicy(v){return object(v)&&uuid(v.id)&&typeof v.adEnabled==='boolean'&&typeof v.campaignEnabled==='boolean'&&integer(v.rewardHours,1,168)&&integer(v.sessionMinutes,1,30)&&integer(v.graceMinutes,0,60)&&integer(v.dailyLimit,1,100)&&text(v.campaignTitle,100)&&((v.campaignStartsAt===null&&v.campaignEndsAt===null)||(timestamp(v.campaignStartsAt)&&timestamp(v.campaignEndsAt)&&Date.parse(v.campaignEndsAt)>Date.parse(v.campaignStartsAt)))&&(!v.campaignEnabled||v.campaignTitle.trim().length>=3&&v.campaignStartsAt!==null);}
const policyFields=['id','adEnabled','campaignEnabled','rewardHours','sessionMinutes','graceMinutes','dailyLimit','campaignTitle','campaignStartsAt','campaignEndsAt'];
function policy(v,fail){if(!validPolicy(v))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');return pick(v,policyFields);}
function session(v,fail,{expectedId,episodeId,kind,owner,admin=false}={}){
 if(!object(v)||!uuid(v.id)||expectedId&&v.id!==expectedId||!decimal(v.episodeId)||episodeId&&v.episodeId!==episodeId||!kinds.includes(v.kind)||kind&&v.kind!==kind||!statuses.includes(v.status)||!timestamp(v.createdAt)||!timestamp(v.expiresAt)||!timestamp(v.acceptUntil)||Date.parse(v.expiresAt)<=Date.parse(v.createdAt)||Date.parse(v.acceptUntil)<Date.parse(v.expiresAt)||!(v.closedAt===null||timestamp(v.closedAt)&&Date.parse(v.closedAt)>=Date.parse(v.createdAt))||!integer(v.rewardHours,1,168)||!uuid(v.policyVersion)||(admin?!uuid(v.userId):v.userId!==undefined&&(!uuid(v.userId)||owner&&v.userId!==owner)))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
 let grant=null;if(v.grant!==null){const g=v.grant;if(!object(g)||!uuid(g.id)||g.kind!==v.kind||!timestamp(g.expiresAt)||Date.parse(g.expiresAt)<=Date.parse(v.createdAt))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');grant=pick(g,['id','kind','expiresAt']);}
 if((v.status==='GRANTED')!==(grant!==null))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
 return {...pick(v,['id','episodeId','kind','status','createdAt','expiresAt','acceptUntil','closedAt','rewardHours','policyVersion',...(admin?['userId']:[])]),grant};
}
function fallbackDto(v,fail){if(!object(v)||Object.entries(fallback).some(([key,value])=>v[key]!==value))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');return {...fallback};}
function project(result,data,fail,action,{owner,admin=false,providerReady=false}={}){
 const stamp=stamped(result,fail);
 if(['state','policy'].includes(action)){
  if(!revision(result.revision)||typeof result.providerReady!=='boolean')fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
  if(action==='policy'&&(result.saved!==true||typeof result.replayed!=='boolean'))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
  return {...stamp,revision:result.revision,policy:policy(result.policy,fail),providerReady,...(action==='policy'?{saved:result.saved===true,replayed:result.replayed===true}:{})};
 }
 if(action==='options'){
  if(result.episodeId!==data.episodeId||!access.includes(result.access)||!['UNAVAILABLE','INTERNAL_TEST','ALREADY_ACCESSIBLE'].includes(result.availability)||typeof result.adAvailable!=='boolean'||typeof result.campaignAvailable!=='boolean'||result.adAvailable&&(result.provider!=='INTERNAL_TEST'||result.availability!=='INTERNAL_TEST'||!providerReady)||result.access!=='LOCKED'&&(result.availability!=='ALREADY_ACCESSIBLE'||result.adAvailable||result.campaignAvailable)||result.availability==='ALREADY_ACCESSIBLE'&&result.access==='LOCKED')fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
  return {...stamp,...pick(result,['episodeId','access','availability','adAvailable','campaignAvailable']),policy:policy(result.policy,fail),fallback:fallbackDto(result.fallback,fail)};
 }
 if(action==='sessions'){
  const offset=data.offset??0;if(!Array.isArray(result.items)||result.items.length>50||result.offset!==offset||result.limit!==50||!integer(result.total,0,2147483647)||typeof result.hasMore!=='boolean'||result.hasMore!==(result.total>offset+50)||result.nextOffset!==(result.hasMore?offset+50:null)||result.items.length!==Math.min(50,Math.max(0,result.total-offset)))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
  const items=result.items.map(v=>session(v,fail,{admin:true}));if(new Set(items.map(v=>v.id)).size!==items.length)fail(503,'AD_REWARDS_TEST_UNAVAILABLE');return {...stamp,items,...pick(result,['offset','limit','total','hasMore','nextOffset'])};
 }
 if(action==='start'&&result.session===null){if(!['UNAVAILABLE','ALREADY_ACCESSIBLE'].includes(result.availability)||typeof result.replayed!=='boolean')fail(503,'AD_REWARDS_TEST_UNAVAILABLE');return {...stamp,availability:result.availability,session:null,fallback:fallbackDto(result.fallback,fail),replayed:result.replayed};}
 const value=session(result.session,fail,{expectedId:data.sessionId,episodeId:action==='start'?data.episodeId:undefined,kind:action==='start'?data.kind:undefined,owner});
 if(['start','close','callback'].includes(action)&&typeof result.replayed!=='boolean')fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
 if(action==='start'&&result.replayed!==true&&value.policyVersion!==data.policyVersion)fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
 const dto={...stamp,session:value,...(typeof result.replayed==='boolean'?{replayed:result.replayed}:{})};
 if(action==='start'&&value.kind==='AD_REWARD'){
  const c=result.challenge;if(!object(c)||c.protocol!=='OP06_INTERNAL_TEST_V1'||c.sessionId!==value.id||typeof c.nonce!=='string'||!/^[a-f0-9]{64}$/.test(c.nonce)||typeof c.channelId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(c.channelId)||c.policyVersion!==value.policyVersion)fail(503,'AD_REWARDS_TEST_UNAVAILABLE');
  dto.challenge=pick(c,['protocol','sessionId','nonce','channelId','policyVersion']);
 }
 return dto;
}
async function call(rpc,name,payload,fail){let result;try{result=await rpc(name,payload);}catch(error){if([400,401,403,404,409,429,503].includes(error?.status)&&safeErrors.has(error?.code))throw error;fail(503,'AD_REWARDS_TEST_UNAVAILABLE');}if(result?.error){if(![400,401,403,404,409,429,503].includes(result.status)||!safeErrors.has(result.error))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');fail(result.status,result.error);}if(!object(result))fail(503,'AD_REWARDS_TEST_UNAVAILABLE');return result;}

export async function adRewardsTestApi({request,user,actor,rpc,env={},fail}){
 if(!adRewardsTestEnabled(env))fail(503,'AD_REWARDS_TEST_NOT_ACTIVATED');
 const url=new URL(request.url),admin=url.pathname==='/api/v2/admin/ad-rewards-test';if(!admin&&url.pathname!=='/api/v2/ad-rewards-test')fail(404,'NOT_FOUND');
 if(!uuid(user?.id)||actor?.userId!==user.id||user.is_anonymous||user.deleted_at||user.banned_until&&(!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>Date.now()))fail(401,'INVALID_SESSION');
 if(!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
 if(admin){if(actor.admin?.is_active!==true||actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');}else if(actor.reader?.status!=='ACTIVE')fail(403,'READER_REQUIRED');
 const action=url.searchParams.get('action'),table=admin?adminActions:Object.hasOwn(writes,action)?writes:reads;if(!Object.hasOwn(table,action))fail(400,'INVALID_ACTION');
 const write=admin||Object.hasOwn(writes,action),allowed=table[action];if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
 if(url.searchParams.getAll('action').length!==1||[...url.searchParams.keys()].some(key=>key!=='action'&&(write||!allowed.includes(key))||url.searchParams.getAll(key).length!==1))fail(400,'INVALID_QUERY');
 const data=write?await body(request,fail):Object.fromEntries(allowed.filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)]));if(Object.keys(data).some(key=>!allowed.includes(key)))fail(400,'INVALID_REWARD_REQUEST');
 if(allowed.includes('episodeId')&&!decimal(data.episodeId)||allowed.includes('sessionId')&&!uuid(data.sessionId)||allowed.includes('requestId')&&!uuid(data.requestId))fail(400,'INVALID_REWARD_REQUEST');
 if(action==='start'){if(!kinds.includes(data.kind)||!uuid(data.policyVersion))fail(400,'INVALID_REWARD_REQUEST');if(data.consent!==true)fail(400,'CONSENT_REQUIRED');}
 if(action==='sessions'){data.offset=data.offset??0;data.status=data.status??'ALL';if(!integer(data.offset,0,100000)||!['ALL',...statuses].includes(data.status))fail(400,'INVALID_QUERY');}
 if(action==='policy'){
  if(!revision(data.revision)||!text(data.reason,500,3)||!validPolicy({...data,id:user.id}))fail(400,'INVALID_REWARD_REQUEST');
  for(const field of ['campaignStartsAt','campaignEndsAt'])if(data[field]!==null)data[field]=new Date(data[field]).toISOString();
 }
 const channel=await internalTestRewardChannel(env),payload={...data,...(['options','start'].includes(action)?channel:{})};
 const result=await call(rpc,'op06_rewards',{p_user:user.id,p_action:admin?'admin-'+action:action,p_data:payload},fail);
 return project(result,data,fail,action,{owner:user.id,admin,providerReady:channel.provider==='INTERNAL_TEST'});
}

export async function adRewardsTestCallback({proof,rpc,fail}){
 if(!isVerifiedInternalTestProof(proof))fail(403,'INVALID_TEST_SIGNATURE');
 const result=await call(rpc,'op06_apply_reward',{p_evidence:proof},fail);
 return project(result,{sessionId:proof.sessionId},fail,'callback');
}
