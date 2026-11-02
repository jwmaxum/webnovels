import {pointsTestEnabled} from './points-test-api.mjs';
import {resolveStoredProviderSettings} from './provider-settings-api.mjs';
import {topupsTossRequest} from './providers/topups-toss.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid=v=>typeof v==='string'&&UUID.test(v),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const text=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min&&!/[\x00-\x1f\x7f]/.test(v)&&!/[\uD800-\uDFFF]/u.test(v);
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const ref=v=>typeof v==='string'&&/^[A-Za-z0-9_=-]{1,200}$/.test(v);
const pick=(v,fields)=>Object.fromEntries(fields.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]));
const marker={mode:'TEST',provenance:'LOCAL_SIMULATED'},modes=['LOCAL_SIMULATED','PROVIDER_TEST'];
const statuses=['CREATED','WAITING_DEPOSIT','APPROVING','UNKNOWN','PAID','REFUND_PENDING','REFUND_UNKNOWN','REFUNDED','REVIEW','EXPIRED'];
const reads={products:['offset'],orders:['offset'],order:['orderId']};
const writes={create:['productId','productVersion','method','requestId'],checkout:['orderId'],confirm:['orderId','paymentKey','expectedAmountKrw'],reconcile:['orderId'],refund:['orderId','reason','requestId'],'retry-refund':['orderId']};
const adminActions={state:[],product:['productId','title','amountKrw','points','enabled','startsAt','endsAt','expiresMinutes','revision','reason','requestId'],orders:['status','offset'],deposit:['orderId','bankReference','amountKrw','receivedAt','reason','requestId'],reconcile:['orderId'],refund:['orderId','reason','requestId'],'retry-refund':['orderId'],'bank-refund':['orderId','bankReference','amountKrw','paidAt','reason','requestId']};
const safeErrors=new Set(['AUTH_REQUIRED','INVALID_SESSION','EMAIL_CONFIRMATION_REQUIRED','READER_REQUIRED','ADMIN_FORBIDDEN','FINANCE_PERMISSION_REQUIRED','READER_NOT_FOUND','INVALID_REQUEST','INVALID_INPUT','INVALID_TEST_REQUEST','INVALID_TOPUP_REQUEST','REASON_REQUIRED','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','RATE_LIMITED','PRODUCT_NOT_FOUND','PRODUCT_CHANGED','PRODUCT_UNAVAILABLE','ORDER_NOT_FOUND','ORDER_EXPIRED','ORDER_NOT_READY','ORDER_STATE_CONFLICT','PAYMENT_REFERENCE_CONFLICT','BANK_REFERENCE_CONFLICT','DEPOSIT_MISMATCH','REFUND_NOT_AVAILABLE','REFUND_NOT_READY','REFUND_AMOUNT_ZERO','REFUND_STATE_CONFLICT','INSUFFICIENT_POINTS','BALANCE_LIMIT','OPERATION_IN_PROGRESS','OPERATION_EXPIRED','PROVIDER_NOT_READY','PROVIDER_BINDING_MISMATCH','TOPUPS_TEST_UNAVAILABLE','TOPUPS_TEST_NOT_READY']);
for(const code of ['PRODUCT_VERSION_CONFLICT','BANK_REFERENCE_USED','REFUND_PROOF_MISMATCH','REFUND_ALREADY_EXISTS','NO_REFUNDABLE_POINTS','NO_REFUNDABLE_AMOUNT','PROVIDER_CONFIG_REQUIRED','PROVIDER_BINDING_CONFLICT','PAYMENT_KEY_CONFLICT','REFUND_NOT_FOUND','PAYMENT_NOT_STARTED','TRANSACTION_CONFLICT','STALE_PROVIDER_LEASE','ACTOR_REVOKED','INVALID_PROVIDER_RECEIPT'])safeErrors.add(code);
export const chargingTestEnabled=(env={})=>pointsTestEnabled(env)&&env.CHARGING_TEST_ENABLED==='true'&&modes.includes(env.CHARGING_TEST_PROVIDER??'LOCAL_SIMULATED');

async function body(request,fail){
  if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'ORIGIN_REQUIRED');
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');
  if(Number(request.headers.get('content-length'))>65536)fail(413,'BODY_TOO_LARGE');
  const stream=request.body?.getReader();if(!stream)fail(400,'BODY_REQUIRED');let size=0;const chunks=[];
  for(;;){const {done,value}=await stream.read();if(done)break;size+=value.byteLength;if(size>65536){await stream.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_TOPUP_REQUEST');}
  if(!object(result))fail(400,'INVALID_TOPUP_REQUEST');return result;
}
function product(v,fail){
  if(!object(v)||!uuid(v.id)||!uuid(v.versionId)||!text(v.title,200,1)||!integer(v.amountKrw,1,1_000_000)||!integer(v.points,1,1_000_000)||typeof v.enabled!=='boolean'||!timestamp(v.startsAt)||!(v.endsAt===null||timestamp(v.endsAt))||v.endsAt&&Date.parse(v.endsAt)<=Date.parse(v.startsAt)||!integer(v.expiresMinutes,5,1440))fail(503,'TOPUPS_TEST_UNAVAILABLE');
  return pick(v,['id','versionId','title','amountKrw','points','enabled','startsAt','endsAt','expiresMinutes']);
}
function order(v,fail,expectedId,owner){
  if(!object(v)||!uuid(v.id)||expectedId&&v.id!==expectedId||v.checkoutId!=='wn05-'+v.id||!owner&&!uuid(v.userId)||v.userId!==undefined&&(!uuid(v.userId)||owner&&v.userId!==owner)||!uuid(v.productId)||!uuid(v.productVersion)||!text(v.title,200,1)||!['BANK','CARD'].includes(v.method)||!integer(v.amountKrw,1,1_000_000)||!integer(v.points,1,1_000_000)||!statuses.includes(v.status)||!timestamp(v.createdAt)||!timestamp(v.expiresAt)||Date.parse(v.expiresAt)<=Date.parse(v.createdAt)||typeof v.credited!=='boolean'||!integer(v.refundablePoints,0,v.points)||!integer(v.refundAmountKrw,0,v.amountKrw)||v.refund!==null&&!object(v.refund))fail(503,'TOPUPS_TEST_UNAVAILABLE');
  let refund=null;if(v.refund){const r=v.refund;if(!uuid(r.id)||!['PENDING','REFUND_PENDING','REFUNDING','UNKNOWN','REFUND_UNKNOWN','REFUNDED','COMPLETED','REVIEW'].includes(r.status)||!integer(r.points,1,v.points)||!integer(r.amountKrw,1,v.amountKrw)||!timestamp(r.createdAt))fail(503,'TOPUPS_TEST_UNAVAILABLE');refund=pick(r,['id','status','points','amountKrw','createdAt']);}
  return {...pick(v,['id','checkoutId',...(owner?[]:['userId']),'productId','productVersion','title','method','amountKrw','points','status','createdAt','expiresAt','credited','refundablePoints','refundAmountKrw']),refund};
}
function dto(result,data,fail,action,owner){
  if(!object(result)||result.mode!=='TEST'||result.provenance!=='LOCAL_SIMULATED'||!modes.includes(result.providerMode))fail(503,'TOPUPS_TEST_UNAVAILABLE');
  const base={...marker,providerMode:result.providerMode};
  if(['state','product'].includes(action)){
    if(!revision(result.revision)||!Array.isArray(result.products)||result.products.length>100)fail(503,'TOPUPS_TEST_UNAVAILABLE');
    const products=result.products.map(v=>product(v,fail));if(new Set(products.map(v=>v.id)).size!==products.length)fail(503,'TOPUPS_TEST_UNAVAILABLE');
    return {...base,revision:result.revision,products,...(result.saved===true?{saved:true,replayed:result.replayed===true}:{})};
  }
  if(['products','orders'].includes(action)){
    const offset=data.offset??0;if(!Array.isArray(result.items)||result.items.length>50||result.offset!==offset||result.limit!==50||!integer(result.total,0,2147483647)||typeof result.hasMore!=='boolean'||result.hasMore!==(result.total>offset+50)||result.nextOffset!==(result.hasMore?offset+50:null)||result.items.length!==Math.min(50,Math.max(0,result.total-offset)))fail(503,'TOPUPS_TEST_UNAVAILABLE');
    const items=result.items.map(v=>action==='products'?product(v,fail):order(v,fail,undefined,owner));if(new Set(items.map(v=>v.id)).size!==items.length)fail(503,'TOPUPS_TEST_UNAVAILABLE');
    return {...base,items,...pick(result,['offset','limit','total','hasMore','nextOffset'])};
  }
  const projected=order(result.order,fail,data.orderId,owner);return {...base,order:projected,...(typeof result.replayed==='boolean'?{replayed:result.replayed}:{})};
}
async function configuration(env,rpc,fail){
  const providerMode=env.CHARGING_TEST_PROVIDER??'LOCAL_SIMULATED';if(!modes.includes(providerMode))fail(503,'PROVIDER_NOT_READY');
  let secretKey,clientKey,merchantId,version,keyVersion;
  if(providerMode==='PROVIDER_TEST'){
    if(env.PROVIDER_SETTINGS_SOURCE==='database'){
      let row;try{const values=await resolveStoredProviderSettings({provider:'TOSS',mode:'TEST',env,rpc:async(name,data)=>{row=await rpc(name,data);return row;}});secretKey=values.secretKey;clientKey=values.clientKey;merchantId=values.merchantId;version=String(row.revision);keyVersion=row.envelope.keyVersion;if(!revision(version)||!text(keyVersion,32,1))throw Error();}catch{fail(503,'PROVIDER_NOT_READY');}
    }else{secretKey=env.TOSS_TEST_SECRET_KEY;clientKey=env.TOSS_TEST_CLIENT_KEY;merchantId=env.TOSS_TEST_MERCHANT_ID;version=env.CHARGING_TEST_BINDING_VERSION;keyVersion='environment';}
    if(typeof secretKey!=='string'||!/^test_(?:g)?sk_[A-Za-z0-9_-]+$/.test(secretKey)||secretKey.includes('_docs_')||!ref(merchantId)||!text(version,80,1))fail(503,'PROVIDER_NOT_READY');
  }else{merchantId='LOCAL_SIMULATED';version='v1';keyVersion='local';secretKey='';}
  const encoded=new TextEncoder().encode(JSON.stringify(['webnovels-op05-binding-v1',providerMode,secretKey,merchantId,version,keyVersion]));
  const digest=await crypto.subtle.digest('SHA-256',encoded),binding=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  return {providerMode,secretKey,clientKey,merchantId,binding};
}
function transport(v,config,fail,orderId){
  if(!config||!object(v)||!uuid(v.orderId)||v.orderId!==orderId||v.checkoutId!=='wn05-'+v.orderId||!uuid(v.operationId)||!uuid(v.lease)||!['confirm','query','cancel'].includes(v.operation)||!ref(v.paymentKey)||!integer(v.amountKrw,1,1_000_000)||!timestamp(v.operationCreatedAt)||Date.parse(v.operationCreatedAt)>Date.now()+60_000||v.providerMode!==config.providerMode||v.merchantId!==config.merchantId||v.binding!==config.binding)fail(503,'PROVIDER_BINDING_MISMATCH');
  if(v.operation!=='query'&&Date.now()-Date.parse(v.operationCreatedAt)>=15*86400_000)fail(409,'OPERATION_EXPIRED');
  if(v.operation==='cancel'&&(!uuid(v.refundId)||!integer(v.refundAmountKrw,1,v.amountKrw)||v.expectedBalanceKrw!==v.amountKrw-v.refundAmountKrw||!text(v.reason,200,3)))fail(503,'TOPUPS_TEST_UNAVAILABLE');
  return v;
}
function receipt(v,t){
  if(!object(v)||!['APPROVED','PENDING','NOT_PAID','CANCELLED','UNKNOWN','REVIEW'].includes(v.state))return {state:'REVIEW'};
  if(['UNKNOWN','REVIEW'].includes(v.state))return {state:v.state};
  if(v.amountKrw!==t.amountKrw||v.merchantId!==t.merchantId||v.paymentKey!==t.paymentKey||!integer(v.balanceKrw,0,t.amountKrw))return {state:'REVIEW'};
  if(['APPROVED','CANCELLED'].includes(v.state)&&(!timestamp(v.approvedAt)||!ref(v.transactionKey)))return {state:'REVIEW'};
  if(v.state==='APPROVED'&&v.balanceKrw!==t.amountKrw)return {state:'REVIEW'};
  if(['PENDING','NOT_PAID'].includes(v.state)&&v.balanceKrw!==t.amountKrw)return {state:'REVIEW'};
  if(v.state==='CANCELLED'&&(!timestamp(v.cancelledAt)||Date.parse(v.cancelledAt)<Date.parse(v.approvedAt)||v.cancelAmountKrw!==t.refundAmountKrw||v.balanceKrw!==t.expectedBalanceKrw))return {state:'REVIEW'};
  return pick(v,['state','amountKrw','merchantId','paymentKey','approvedAt','transactionKey','cancelledAt','cancelAmountKrw','balanceKrw']);
}

export async function topupsTestApi({request,user,actor,rpc,remote,env={},fail,fetchImpl=fetch,providerTransport}){
  if(!chargingTestEnabled(env))fail(503,'TOPUPS_TEST_NOT_ACTIVATED');
  const url=new URL(request.url),admin=url.pathname==='/api/v2/admin/topups-test';if(!admin&&url.pathname!=='/api/v2/topups-test')fail(404,'NOT_FOUND');
  if(!uuid(user?.id)||actor?.userId!==user.id||user.is_anonymous||user.deleted_at||user.banned_until&&(!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>Date.now()))fail(401,'INVALID_SESSION');
  if(!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
  if(admin){if(actor.admin?.is_active!==true||actor.admin.role!=='SUPER_ADMIN')fail(403,'ADMIN_FORBIDDEN');}else if(actor.reader?.status!=='ACTIVE')fail(403,'READER_REQUIRED');
  const action=url.searchParams.get('action'),table=admin?adminActions:Object.hasOwn(writes,action)?writes:reads;if(!Object.hasOwn(table,action))fail(400,'INVALID_ACTION');
  const write=admin||Object.hasOwn(writes,action),allowed=table[action];if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
  if(url.searchParams.getAll('action').length!==1||[...url.searchParams.keys()].some(k=>k!=='action'&&(write||!allowed.includes(k))||url.searchParams.getAll(k).length!==1))fail(400,'INVALID_QUERY');
  const data=write?await body(request,fail):Object.fromEntries(allowed.filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]));
  if(Object.keys(data).some(k=>!allowed.includes(k)))fail(400,'INVALID_TOPUP_REQUEST');
  if(['products','orders'].includes(action)){const value=data.offset??(write?0:'0');if(write){if(!integer(value,0,100000))fail(400,'INVALID_QUERY');data.offset=value;}else{if(!/^(0|[1-9]\d{0,5})$/.test(value)||Number(value)>100000)fail(400,'INVALID_QUERY');data.offset=Number(value);}}
  if(admin&&action==='orders'){data.status=data.status??'ALL';if(!['ALL','REVIEW','UNKNOWN','REFUND_UNKNOWN','REFUND_PENDING','PAID','WAITING_DEPOSIT'].includes(data.status))fail(400,'INVALID_QUERY');}
  for(const k of ['orderId','requestId','productVersion'])if(allowed.includes(k)&&!uuid(data[k]))fail(400,'INVALID_TOPUP_REQUEST');
  if(allowed.includes('productId')&&!(admin&&action==='product'&&data.productId===null)&&!uuid(data.productId))fail(400,'INVALID_TOPUP_REQUEST');
  if(allowed.includes('reason')&&!text(data.reason,action==='refund'?200:500,3))fail(400,'REASON_REQUIRED');
  if(action==='create'&&!['BANK','CARD'].includes(data.method))fail(400,'INVALID_TOPUP_REQUEST');
  if(action==='confirm'&&(!ref(data.paymentKey)||!integer(data.expectedAmountKrw,1,1_000_000)))fail(400,'INVALID_PAYMENT_REFERENCE');
  if(admin&&action==='product'&&(!revision(data.revision)||!text(data.title,200,1)||!integer(data.amountKrw,1,1_000_000)||!integer(data.points,1,1_000_000)||typeof data.enabled!=='boolean'||!timestamp(data.startsAt)||!(data.endsAt===null||timestamp(data.endsAt))||data.endsAt&&Date.parse(data.endsAt)<=Date.parse(data.startsAt)||!integer(data.expiresMinutes,5,1440)))fail(400,'INVALID_TOPUP_REQUEST');
  if(admin&&['deposit','bank-refund'].includes(action)&&(!text(data.bankReference,200,3)||!integer(data.amountKrw,1,1_000_000)||!timestamp(data[action==='deposit'?'receivedAt':'paidAt'])))fail(400,'INVALID_TOPUP_REQUEST');
  for(const field of ['startsAt','endsAt','receivedAt','paidAt'])if(typeof data[field]==='string')data[field]=new Date(data[field]).toISOString();
  const call=async(name,payload)=>{let value;try{value=await rpc(name,payload);}catch(error){if([400,401,403,404,409,429,503].includes(error?.status)&&safeErrors.has(error?.code))throw error;fail(503,'TOPUPS_TEST_UNAVAILABLE');}if(value?.error){if(![400,401,403,404,409,429,503].includes(value.status)||!safeErrors.has(value.error))fail(503,'TOPUPS_TEST_UNAVAILABLE');fail(value.status,value.error);}if(!object(value))fail(503,'TOPUPS_TEST_UNAVAILABLE');return value;};
  let config=null;
  if(['confirm','checkout','reconcile','refund','retry-refund'].includes(action)){
    // BANK workflows must work without any PG key. Read the owned/current
    // order through the same checked RPC before resolving card credentials.
    const before=await call('op05_topups',{p_user:user.id,p_action:admin?'admin-order':'order',p_data:{orderId:data.orderId}});
    const snapshot=dto(before,data,fail,'order',admin?undefined:user.id);
    if(action==='confirm'&&snapshot.order.amountKrw!==data.expectedAmountKrw)fail(409,'PRICE_CHANGED');
    if(['checkout','confirm'].includes(action)&&snapshot.order.method!=='CARD')fail(409,'ORDER_NOT_READY');
    if(action==='checkout'&&snapshot.order.status!=='CREATED')fail(409,'ORDER_NOT_READY');
    if(snapshot.order.method==='CARD')config=await configuration(env,rpc,fail);
  }
  if(action==='checkout'){
    if(config?.providerMode!=='PROVIDER_TEST'||typeof config.clientKey!=='string'||!/^test_(?:g)?ck_[A-Za-z0-9_-]+$/.test(config.clientKey)||config.clientKey.includes('_docs_'))fail(503,'PROVIDER_NOT_READY');
    if(request.headers.has('origin')&&request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')fail(403,'ORIGIN_REQUIRED');
  }else if(config?.providerMode==='LOCAL_SIMULATED'&&typeof providerTransport!=='function')fail(503,'PROVIDER_NOT_READY');
  const claims={confirm:'claim-confirm',reconcile:'claim-query',refund:'claim-refund','retry-refund':'claim-refund-retry'};
  let dbAction=claims[action]??action;if(admin)dbAction='admin-'+dbAction;
  const payload={...data,...(config?pick(config,['providerMode','merchantId','binding']):{})};delete payload.expectedAmountKrw;
  let result=await call('op05_topups',{p_user:user.id,p_action:dbAction,p_data:payload});
  if(result.transport){
    // Validate the public snapshot before any external request, but do not expose
    // the private provider identifiers, binding, credentials or bank references.
    dto(result,data,fail,action,admin?undefined:user.id);
    const t=transport(result.transport,config,fail,data.orderId);let evidence;
    if(t.amountKrw!==result.order.amountKrw||action==='confirm'&&t.paymentKey!==data.paymentKey||action==='reconcile'&&t.operation!=='query')fail(503,'TOPUPS_TEST_UNAVAILABLE');
    if(t.providerMode==='LOCAL_SIMULATED'&&typeof providerTransport!=='function')fail(503,'PROVIDER_NOT_READY');
    try{evidence=await(t.providerMode==='LOCAL_SIMULATED'?providerTransport({operation:t.operation,order:{...t},reason:t.reason}):topupsTossRequest({operation:t.operation,order:t,secretKey:config.secretKey,reason:t.reason},fetchImpl));}catch(error){evidence={state:error?.message==='PAYMENT_RECEIPT_MISMATCH'?'REVIEW':'UNKNOWN'};}
    result=await call('op05_apply',{p_order:t.orderId,p_operation:t.operationId,p_lease:t.lease,p_receipt:receipt(evidence,t)});
  }
  const projected=dto(result,data,fail,action,admin?undefined:user.id);
  if(action==='checkout'){
    if(result.transport||projected.order.method!=='CARD'||projected.order.status!=='CREATED'||projected.providerMode!=='PROVIDER_TEST')fail(503,'TOPUPS_TEST_UNAVAILABLE');
    // The SDK display name is limited to 100 UTF-16 units without splitting a
    // surrogate pair. The immutable product title, amount and ID stay intact.
    const orderName=projected.order.title.slice(0,100).replace(/[\uD800-\uDBFF]$/,'');
    return {...marker,providerMode:'PROVIDER_TEST',checkout:{clientKey:config.clientKey,customerKey:user.id,orderId:projected.order.checkoutId,orderName,amountKrw:projected.order.amountKrw,currency:'KRW',successUrl:url.origin+'/charging-test/return',failUrl:url.origin+'/charging-test/return'}};
  }
  // Catalogs and unbound CARD orders have no financial provider evidence yet.
  // Public mode describes the configured TEST checkout path; every private
  // transport still has to match its immutable DB mode/MID/binding above.
  return {...projected,providerMode:env.CHARGING_TEST_PROVIDER??'LOCAL_SIMULATED'};
}
