// Isolated TEST transport. Not wired to a route, worker, OP07 ledger or LIVE settings.
// The caller must durably freeze the request before create; uncertain results must
// be reconciled by query, never by generating a new operation/refPayoutId.
import {CompactEncrypt,compactDecrypt} from 'jose';

const fail=code=>{throw Error(code);};
const identifier=(v,max=64)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\s\x00-\x1f\x7f/\\?#]/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const day=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const secret=v=>typeof v==='string'&&/^test_(?:g)?sk_[A-Za-z0-9_-]{1,200}$/.test(v)&&!v.includes('_docs_');
const bytes=key=>{if(typeof key!=='string'||!(/^[a-f0-9]{64}$/i.test(key)))fail('PAYOUT_TEST_CONFIGURATION_REQUIRED');return Uint8Array.from(key.match(/../g),v=>parseInt(v,16));};
function validate(order,operation,now){
 if(!order||order.providerMode!=='PROVIDER_TEST'||!uuid(order.operationId)||!identifier(order.refPayoutId,50)||!identifier(order.destination)||!Number.isSafeInteger(order.amountKrw)||order.amountKrw<1||order.amountKrw>1_000_000||!date(order.operationCreatedAt)||Date.parse(order.operationCreatedAt)>now+60_000)fail('PAYOUT_TEST_REQUEST_INVALID');
 if(!['EXPRESS','SCHEDULED'].includes(order.scheduleType)||order.scheduleType==='SCHEDULED'&&!day(order.payoutDate)||order.scheduleType==='EXPRESS'&&order.payoutDate!=null)fail('PAYOUT_TEST_REQUEST_INVALID');
 if(typeof order.transactionDescription!=='string'||order.transactionDescription.trim().length<1||[...order.transactionDescription].length>7||/[\x00-\x1f\x7f]/.test(order.transactionDescription))fail('PAYOUT_TEST_REQUEST_INVALID');
 if(operation==='query'&&!identifier(order.providerPayoutId))fail('PAYOUT_TEST_REQUEST_INVALID');
 if(operation==='create'&&(order.providerPayoutId!=null||now-Date.parse(order.operationCreatedAt)>=15*86400_000))fail('PAYOUT_TEST_RECONCILIATION_REQUIRED');
}
export async function encryptPayoutTestBody(body,securityKey,now=Date.now()){
 const encoded=new TextEncoder().encode(JSON.stringify(body));if(encoded.byteLength>8192)fail('PAYOUT_TEST_REQUEST_INVALID');
 return new CompactEncrypt(encoded).setProtectedHeader({alg:'dir',enc:'A256GCM',iat:new Date(now).toISOString().replace(/\.\d{3}Z$/,'+00:00'),nonce:crypto.randomUUID()}).encrypt(bytes(securityKey));
}
export async function decryptPayoutTestBody(value,securityKey){
 try{
  if(typeof value!=='string'||value.length>65536)throw Error();
  const {plaintext}=await compactDecrypt(value,bytes(securityKey),{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));
 }catch{fail('PAYOUT_TEST_RESULT_UNKNOWN');}
}
export function verifyPayoutTestReceipt(raw,order,operation){
 const mismatch=()=>fail('PAYOUT_TEST_RECEIPT_MISMATCH');
 if(!raw||raw.error||raw.entityType!==(operation==='create'?'payout-list':'payout'))mismatch();
 if(operation==='create'&&(!Array.isArray(raw.entityBody?.items)||raw.entityBody.items.length!==1))mismatch();
 const p=operation==='create'?raw.entityBody.items[0]:raw.entityBody;
 if(!p||!identifier(p.id)||order.providerPayoutId&&p.id!==order.providerPayoutId||p.refPayoutId!==order.refPayoutId||p.destination!==order.destination||p.scheduleType!==order.scheduleType||order.scheduleType==='SCHEDULED'&&p.payoutDate!==order.payoutDate||p.amount?.currency!=='KRW'||p.amount.value!==order.amountKrw||p.transactionDescription!==order.transactionDescription||!date(p.requestedAt))mismatch();
 // A failure/cancellation observation is not permission to release reservations.
 const state=p.status==='COMPLETED'?'COMPLETED':['REQUESTED','IN_PROGRESS'].includes(p.status)?'PENDING':'REVIEW';
 if(state==='COMPLETED'&&p.error!=null)mismatch();
 return {provenance:'PROVIDER_TEST',state,providerPayoutId:p.id,refPayoutId:p.refPayoutId,destination:p.destination,amountKrw:order.amountKrw,currency:'KRW',requestedAt:p.requestedAt,ledgerApplyAllowed:false,liveReady:false};
}
async function readBounded(response){
 if(Number(response.headers?.get('content-length'))>65536)fail('PAYOUT_TEST_RESULT_UNKNOWN');
 const reader=response.body?.getReader();if(!reader)fail('PAYOUT_TEST_RESULT_UNKNOWN');let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();fail('PAYOUT_TEST_RESULT_UNKNOWN');}chunks.push(value);}}finally{reader.releaseLock();}
 const joined=new Uint8Array(size);let offset=0;for(const c of chunks){joined.set(c,offset);offset+=c.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(joined);
}
export async function payoutsTossTestRequest({operation,order,secretKey,securityKey,now=Date.now()},fetchImpl=fetch){
 if(!secret(secretKey))fail('PAYOUT_TEST_CONFIGURATION_REQUIRED');
 if(!['create','query'].includes(operation))fail('PAYOUT_TEST_OPERATION_INVALID');
 validate(order,operation,now);
 const headers={Authorization:'Basic '+btoa(secretKey+':')},options={method:operation==='create'?'POST':'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)};
 if(operation==='create'){
  bytes(securityKey);
  headers['Content-Type']='text/plain';headers['TossPayments-api-security-mode']='ENCRYPTION';headers['Idempotency-Key']='wn09-payout-'+order.operationId;
  options.body=await encryptPayoutTestBody([{refPayoutId:order.refPayoutId,destination:order.destination,scheduleType:order.scheduleType,...(order.scheduleType==='SCHEDULED'?{payoutDate:order.payoutDate}:{}),amount:{currency:'KRW',value:order.amountKrw},transactionDescription:order.transactionDescription}],securityKey,now);
 }
 let raw;
 try{
  const response=await fetchImpl('https://api.tosspayments.com/v2/payouts'+(operation==='query'?'/'+encodeURIComponent(order.providerPayoutId):''),options);
  const body=await readBounded(response);
  raw=operation==='create'?await decryptPayoutTestBody(body,securityKey):JSON.parse(body);
  if(!response.ok)fail('PAYOUT_TEST_RESULT_UNKNOWN');
 }catch{fail('PAYOUT_TEST_RESULT_UNKNOWN');}
 return verifyPayoutTestReceipt(raw,order,operation);
}
