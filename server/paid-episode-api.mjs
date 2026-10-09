import {episodeTossRequest} from './providers/toss.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reads={quote:['episodeId'],order:['orderId'],orders:[],earnings:[],review:[],audit:['orderId']};
const writes={create:['episodeId','requestId','offerVersion','policyVersion','expectedAmountKrw'],
 confirm:['orderId','paymentKey'],reconcile:['orderId'],'admin-reconcile':['orderId'],refund:['orderId','reason']};
export const paidEpisodeSandboxEnabled=env=>env.P0_API_ENABLED==='true' &&
 env.MONETIZATION_SANDBOX_ENABLED==='true' && env.MONETIZATION_ENVIRONMENT==='TEST' &&
 ['LOCAL_SIMULATED','PROVIDER_TEST'].includes(env.MONETIZATION_EVIDENCE_SOURCE) &&
 /^test_(?:g)?sk_/.test(env.TOSS_TEST_SECRET_KEY||'') && !env.TOSS_TEST_SECRET_KEY.includes('_docs_') &&
 /^[A-Za-z0-9_-]{1,200}$/.test(env.TOSS_TEST_MERCHANT_ID||'');

export async function paidEpisodeApi({request,env,actor,db,readBody,fail,fetchImpl}) {
 // Even with a LIVE key/flag this module cannot open live commerce or existing settlement APIs.
 if(!paidEpisodeSandboxEnabled(env)) {await actor();fail(503,'PROVIDER_AND_LEDGER_NOT_READY');}
 const url=new URL(request.url),action=url.pathname.slice('/api/v2/payments/'.length);
 const write=Object.hasOwn(writes,action);
 if(!write&&!Object.hasOwn(reads,action))fail(404,'PAYMENT_ROUTE_NOT_FOUND');
 if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
 const allowed=write?[]:reads[action];
 for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)fail(400,'INVALID_QUERY');
 const who=await actor();
 const finance=['review','audit','admin-reconcile','refund'].includes(action);
 if(finance&&(!who.admin?.is_active||who.admin.role!=='SUPER_ADMIN'))fail(403,'FINANCE_PERMISSION_REQUIRED');
 if(action==='earnings') {if(who.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');}
 else if(!finance&&who.reader?.status!=='ACTIVE')fail(403,'READER_REQUIRED');
 let data={};
 if(write) {
  if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
  data=await readBody(request);
  if(JSON.stringify(data).length>4000 || Object.keys(data).some(key=>!writes[action].includes(key)) ||
   writes[action].some(key=>!(key in data)))fail(400,'INVALID_FIELD');
 } else for(const key of allowed) {const value=url.searchParams.get(key);if(value===null)fail(400,'INVALID_QUERY');data[key]=value;}
 if('episodeId' in data&&(typeof data.episodeId!=='string'||!/^[1-9]\d{0,17}$/.test(data.episodeId)))fail(400,'INVALID_ID');
 if('orderId' in data&&(typeof data.orderId!=='string'||!/^wn20-[0-9a-f-]{36}$/.test(data.orderId)))fail(400,'INVALID_ID');
 for(const key of ['requestId','offerVersion'])if(key in data&&!UUID.test(data[key]||''))fail(400,'INVALID_REQUEST_ID');
 if('policyVersion' in data&&(typeof data.policyVersion!=='string'||data.policyVersion.length<3||data.policyVersion.length>80))fail(400,'INVALID_FIELD');
 if('expectedAmountKrw' in data&&(!Number.isInteger(data.expectedAmountKrw)||data.expectedAmountKrw<1||data.expectedAmountKrw>1000000))fail(400,'INVALID_FIELD');
 if('paymentKey' in data&&(typeof data.paymentKey!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(data.paymentKey)))fail(400,'INVALID_PAYMENT_REFERENCE');
 if('reason' in data&&(typeof data.reason!=='string'||data.reason.trim().length<3||data.reason.length>200||/[\x00-\x1f\x7f]/.test(data.reason)))fail(400,'REFUND_REASON_REQUIRED');
 if(['quote','create'].includes(action))Object.assign(data,{merchantId:env.TOSS_TEST_MERCHANT_ID,provenance:env.MONETIZATION_EVIDENCE_SOURCE});
 const call=async(name,body)=>{
  const value=await db('rpc/'+name,{}, {method:'POST',body});
  if(value?.error)fail([400,401,403,404,409,429,503].includes(value.status)?value.status:503,value.error);
  if(!value||typeof value!=='object'||Array.isArray(value))fail(503,'PAYMENT_SERVICE_UNAVAILABLE');
  return value;
 };
 const actions={order:'get',orders:'list',confirm:'claim-confirm',reconcile:'claim-query',refund:'claim-refund','admin-reconcile':'admin-query'};
 const result=await call('stage20_payments',{p_user:who.userId,p_action:actions[action]||action,p_data:data});
 if(!result.transport)return result;
 const transport=result.transport;
 // Merchant/source configuration changes must not reroute an existing order to another store.
 if(transport.merchant_id!==env.TOSS_TEST_MERCHANT_ID||transport.mode!=='TEST')fail(503,'PAYMENT_CONFIGURATION_MISMATCH');
 let receipt;
 try {receipt=await episodeTossRequest({operation:transport.operation,order:transport,
  secretKey:env.TOSS_TEST_SECRET_KEY,reason:transport.reason},fetchImpl);}
 catch {receipt={state:'UNKNOWN'};}
 return call('stage20_apply_payment',{p_order:transport.id,p_lease:transport.lease,p_receipt:receipt});
}
