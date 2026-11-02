import {pointsTestEnabled} from './points-test-api.mjs';

export const settlementsTestEnabled=(env={})=>pointsTestEnabled(env)&&env.SETTLEMENTS_TEST_ENABLED==='true'&&env.SETTLEMENTS_TEST_ENVIRONMENT==='TEST';
export const manualPayoutWorkflowEnabled=(env={})=>settlementsTestEnabled(env)&&env.MANUAL_PAYOUT_WORKFLOW_ENABLED==='true';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const id=v=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const revision=v=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min&&!/[\x00-\x1f\x7f<>]/.test(v)&&!/[\uD800-\uDFFF]/u.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const reference=v=>typeof v==='string'&&/^TEST-[A-Za-z0-9_-]{1,72}$/.test(v);
const status=['REQUESTED','APPROVED','UNKNOWN','PAID','CANCELLED','REJECTED','FAILED'];
const authorReads={summary:[],earnings:['offset'],requests:['status','offset'],'request-detail':['payoutId']};
const authorWrites={request:['amountKrw','policyVersion','payeeRevision','requestId'],cancel:['payoutId','revision','reason','requestId']};
const adminActions={state:[],policy:['enabled','authorBps','deductionBps','revision','reason','requestId'],authors:['offset','query'],payee:['authorId','ready','testReference','revision','reason','requestId'],sources:['offset','authorId'],confirm:['allocationId','policyVersion','reason','requestId'],adjust:['earningId','amountKrw','reason','requestId'],requests:['status','offset','authorId'],detail:['payoutId'],approve:['payoutId','revision','reason','requestId'],reject:['payoutId','revision','reason','requestId'],begin:['payoutId','revision','reason','requestId'],fail:['payoutId','revision','reference','testReference','reason','requestId'],paid:['payoutId','revision','reference','testReference','amountKrw','paidAt','reason','requestId']};
adminActions.earnings=['offset','authorId'];

async function body(request,fail){
 if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'ORIGIN_REQUIRED');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');
 if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')fail(415,'UNSUPPORTED_ENCODING');
 if(Number(request.headers.get('content-length'))>8192)fail(413,'BODY_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)fail(400,'BODY_REQUIRED');let size=0;const chunks=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_PAYOUT_REQUEST');}
 if(!object(data))fail(400,'INVALID_PAYOUT_REQUEST');return data;
}

// Output schemas are intentionally independent from database rows. Never return
// arbitrary JSON, identity applications, banking ciphertext or provider evidence.
const pick=(v,fields)=>Object.fromEntries(fields.map(k=>[k,v[k]]));
const safeErrors=new Set(['AUTH_REQUIRED','INVALID_SESSION','EMAIL_CONFIRMATION_REQUIRED','ADMIN_FORBIDDEN','AUTHOR_REQUIRED','INVALID_PAYOUT_REQUEST','REASON_REQUIRED','TEST_REFERENCE_REQUIRED','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','RATE_LIMITED','SETTLEMENTS_TEST_NOT_READY','POLICY_CHANGED','POLICY_DISABLED','PAYEE_NOT_READY','PAYEE_CHANGED','SOURCE_NOT_ELIGIBLE','SOURCE_ALREADY_CONFIRMED','SOURCE_HELD','AUTHOR_NOT_ACTIVE','INSUFFICIENT_EARNINGS','PAYOUT_NOT_FOUND','EARNING_NOT_FOUND','INVALID_PAYOUT_STATE','EVIDENCE_CONFLICT','EVIDENCE_MISMATCH','ADJUSTMENT_EXCEEDS_EARNINGS','PAYOUT_HOLD']);
for(const code of ['PAYOUT_POLICY_CHANGED','PAYOUT_POLICY_DISABLED','SOURCE_NOT_PAYABLE','ADJUSTMENT_LIMIT','ADJUSTMENT_EXCEEDS_EARNING','INSUFFICIENT_SETTLEMENT_BALANCE','PAYOUT_STATE_CONFLICT','AUTHOR_NOT_PAYABLE','SETTLEMENT_HOLD','PAYOUT_PROOF_MISMATCH','PAYOUT_EVIDENCE_CONFLICT'])safeErrors.add(code);
const summaryFields=['confirmedKrw','deductedKrw','netKrw','paidKrw','reservedKrw','heldKrw','availableKrw','debtKrw'];
const money=v=>integer(v,0,Number.MAX_SAFE_INTEGER);
const dateOrNull=v=>v===null||timestamp(v);
function checked(ok,fail){if(!ok)fail(503,'SETTLEMENTS_TEST_UNAVAILABLE');}
function policy(v,fail){checked(object(v)&&uuid(v.id)&&typeof v.enabled==='boolean'&&integer(v.authorBps,0,10000)&&integer(v.deductionBps,0,10000),fail);return pick(v,['id','enabled','authorBps','deductionBps']);}
function summary(v,fail){checked(object(v)&&summaryFields.every(k=>money(v[k]))&&v.confirmedKrw-v.deductedKrw===v.netKrw,fail);return pick(v,summaryFields);}
function payee(v,fail){checked(object(v)&&revision(v.revision)&&typeof v.ready==='boolean'&&(v.testReference===null&&!v.ready||reference(v.testReference)),fail);return pick(v,['revision','ready','testReference']);}
function payout(v,ctx,fail){
 checked(object(v)&&uuid(v.id)&&id(v.authorId)&&(!ctx.authorId||v.authorId===ctx.authorId)&&text(v.authorName,200)&&integer(v.amountKrw,1,1000000000)&&status.includes(v.status)&&revision(v.revision)&&uuid(v.policyVersion)&&revision(v.payeeRevision)&&reference(v.testReference)&&timestamp(v.createdAt)&&['approvedAt','dispatchedAt','completedAt'].every(k=>dateOrNull(v[k])),fail);
 checked(!ctx.data.payoutId||v.id===ctx.data.payoutId,fail);
 checked(!ctx.data.authorId||v.authorId===ctx.data.authorId,fail);
 let evidence=null;
 if(v.evidence!==null){const e=v.evidence;checked(object(e)&&['PAID','FAILED'].includes(e.outcome)&&e.outcome===v.status&&reference(e.reference)&&e.testReference===v.testReference&&e.amountKrw===v.amountKrw&&timestamp(e.occurredAt)&&e.source==='LOCAL_SIMULATED',fail);evidence=pick(e,['outcome','reference','testReference','amountKrw','occurredAt','source']);}
 checked(['PAID','FAILED'].includes(v.status)?evidence!==null&&v.completedAt!==null&&v.dispatchedAt!==null:evidence===null,fail);
 checked(v.status!=='UNKNOWN'||v.dispatchedAt!==null,fail);
 return {...pick(v,['id','authorId','authorName','amountKrw','status','revision','policyVersion','payeeRevision','testReference','createdAt','approvedAt','dispatchedAt','completedAt']),evidence};
}
function earning(v,ctx,fail){
 checked(object(v)&&uuid(v.id)&&uuid(v.allocationId)&&id(v.authorId)&&(!ctx.authorId||v.authorId===ctx.authorId)&&id(v.workId)&&text(v.workTitle,500)&&['sourceAmountKrw','authorGrossKrw','policyDeductionKrw','netKrw','adjustedKrw','availableNetKrw'].every(k=>money(v[k]))&&v.authorGrossKrw<=v.sourceAmountKrw&&v.authorGrossKrw-v.policyDeductionKrw===v.netKrw&&v.netKrw-v.adjustedKrw===v.availableNetKrw&&typeof v.sourceHeld==='boolean'&&uuid(v.policyVersion)&&timestamp(v.createdAt)&&Array.isArray(v.adjustments)&&v.adjustments.length<=100,fail);
 const adjustments=v.adjustments.map(a=>{checked(object(a)&&uuid(a.id)&&integer(a.amountKrw,1,1000000000)&&text(a.reason,300,3)&&timestamp(a.createdAt),fail);return pick(a,['id','amountKrw','reason','createdAt']);});
 checked(!ctx.data.authorId||v.authorId===ctx.data.authorId,fail);
 return {...pick(v,['id','allocationId','authorId','workId','workTitle','sourceAmountKrw','authorGrossKrw','policyDeductionKrw','netKrw','adjustedKrw','availableNetKrw','sourceHeld','policyVersion','createdAt']),adjustments};
}
function project(v,ctx,fail){
 checked(object(v)&&v.mode==='TEST'&&v.provenance==='LOCAL_SIMULATED'&&v.currency==='KRW'&&v.livePayouts===false,fail);
 const out={mode:'TEST',provenance:'LOCAL_SIMULATED',currency:'KRW',livePayouts:false},a=ctx.action;
 if(ctx.admin&&['state','policy'].includes(a)){checked(revision(v.revision),fail);Object.assign(out,{revision:v.revision,policy:policy(v.policy,fail),summary:summary(v.summary,fail)});if(a==='policy'){checked(v.saved===true,fail);out.saved=true;}}
 else if(a==='summary'){
  checked(v.authorId===ctx.authorId&&object(v.eligibility)&&['canRequest','authorActive','accountReady','sourceHold'].every(k=>typeof v.eligibility[k]==='boolean'),fail);
  Object.assign(out,{authorId:v.authorId,policy:policy(v.policy,fail),payee:payee(v.payee,fail),summary:summary(v.summary,fail),eligibility:pick(v.eligibility,['canRequest','authorActive','accountReady','sourceHold'])});
 }else if(['earnings','requests','sources','authors'].includes(a)){
  checked(Array.isArray(v.items)&&v.items.length<=50&&v.offset===(ctx.data.offset??0)&&v.limit===50&&integer(v.total,0,2147483647)&&v.hasMore===(v.total>v.offset+50)&&v.nextOffset===(v.hasMore?v.offset+50:null)&&v.items.length===Math.min(50,Math.max(0,v.total-v.offset)),fail);
  const items=v.items.map(row=>{
   if(a==='requests')return payout(row,ctx,fail);if(a==='earnings')return earning(row,ctx,fail);
   if(a==='authors'){checked(object(row)&&id(row.id)&&text(row.penName,200)&&['APPROVED','PENDING','REJECTED','SUSPENDED','DELETED'].includes(row.status),fail);return {...pick(row,['id','penName','status']),payee:payee(row.payee,fail),summary:summary(row.summary,fail)};}
   checked(object(row)&&uuid(row.allocationId)&&uuid(row.purchaseId)&&id(row.authorId)&&(!ctx.data.authorId||row.authorId===ctx.data.authorId)&&id(row.workId)&&text(row.authorName,200)&&text(row.workTitle,500)&&integer(row.sourceAmountKrw,1,1000000000)&&integer(row.points,1,1000000)&&timestamp(row.createdAt)&&['CREATED','WAITING_DEPOSIT','APPROVING','UNKNOWN','PAID','REFUND_PENDING','REFUND_UNKNOWN','REFUNDED','REVIEW','EXPIRED'].includes(row.orderStatus)&&typeof row.eligible==='boolean'&&(row.earningId===null||uuid(row.earningId)),fail);
   return pick(row,['allocationId','purchaseId','authorId','authorName','workId','workTitle','sourceAmountKrw','points','createdAt','orderStatus','eligible','earningId']);
  });Object.assign(out,{items,...pick(v,['offset','limit','total','hasMore','nextOffset'])});
 }else if(a==='payee'){checked(v.authorId===ctx.data.authorId,fail);Object.assign(out,{authorId:v.authorId,payee:payee(v.payee,fail),summary:summary(v.summary,fail)});}
 else if(['confirm','adjust'].includes(a)){Object.assign(out,{earning:earning(v.earning,ctx,fail),summary:summary(v.summary,fail)});checked(a==='confirm'?v.earning.allocationId===ctx.data.allocationId:v.earning.id===ctx.data.earningId,fail);}
 else {out.payout=payout(v.payout,ctx,fail);if(!['detail','request-detail'].includes(a))out.summary=summary(v.summary,fail);if(a==='request')checked(v.payout.amountKrw===ctx.data.amountKrw,fail);}
 const mutating=ctx.admin?!['state','authors','sources','requests','earnings','detail'].includes(a):Object.hasOwn(authorWrites,a);
 if(mutating){
  checked(typeof v.replayed==='boolean',fail);out.replayed=v.replayed;
  const expected={request:'REQUESTED',cancel:'CANCELLED',approve:'APPROVED',reject:'REJECTED',begin:'UNKNOWN',paid:'PAID',fail:'FAILED'}[a];
  if(expected)checked(out.payout?.status===expected,fail);
  if(a==='request')checked(out.payout.policyVersion===ctx.data.policyVersion&&out.payout.payeeRevision===ctx.data.payeeRevision,fail);
  if(a==='payee')checked(out.payee.ready===ctx.data.ready&&out.payee.testReference===ctx.data.testReference,fail);
  if(a==='confirm')checked(out.earning.policyVersion===ctx.data.policyVersion,fail);
  if(['paid','fail'].includes(a))checked(out.payout.evidence.reference===ctx.data.reference&&out.payout.evidence.testReference===ctx.data.testReference,fail);
  if(a==='paid')checked(out.payout.amountKrw===ctx.data.amountKrw&&Date.parse(out.payout.evidence.occurredAt)===Date.parse(ctx.data.paidAt),fail);
 }return out;
}

export async function authorPayoutsTestApi({request,user,actor,rpc,env={},fail}){
 if(!settlementsTestEnabled(env))fail(503,'SETTLEMENTS_TEST_NOT_ACTIVATED');
 const url=new URL(request.url),admin=url.pathname==='/api/v2/admin/payouts-test';
 if(!admin&&url.pathname!=='/api/v2/creator/payouts-test')fail(404,'NOT_FOUND');
 if(!uuid(user?.id)||actor?.userId!==user.id||user.is_anonymous||user.deleted_at||user.banned_until&&(!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>Date.now()))fail(401,'INVALID_SESSION');
 if(!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
 if(admin){if(actor.admin?.role!=='SUPER_ADMIN'||actor.admin.is_active!==true)fail(403,'ADMIN_FORBIDDEN');}
 else if(actor.author?.status!=='APPROVED'||!id(String(actor.author.id)))fail(403,'AUTHOR_REQUIRED');
 const action=url.searchParams.get('action'),table=admin?adminActions:Object.hasOwn(authorWrites,action)?authorWrites:authorReads;
 if(!Object.hasOwn(table,action))fail(400,'INVALID_ACTION');const fields=table[action],write=admin||Object.hasOwn(authorWrites,action);
 if(request.method!==(write?'POST':'GET'))fail(405,'METHOD_NOT_ALLOWED');
 if(url.searchParams.getAll('action').length!==1||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1||k!=='action'&&(write||!fields.includes(k))))fail(400,'INVALID_QUERY');
 const data=write?await body(request,fail):Object.fromEntries([...url.searchParams].filter(([k])=>k!=='action'));
 if(Object.keys(data).some(k=>!fields.includes(k)))fail(400,'INVALID_PAYOUT_REQUEST');
 for(const k of ['payoutId','policyVersion','allocationId','earningId','requestId'])if(fields.includes(k)&&!uuid(data[k]))fail(400,'INVALID_PAYOUT_REQUEST');
 for(const k of ['revision','payeeRevision'])if(fields.includes(k)&&!revision(data[k]))fail(400,'INVALID_PAYOUT_REQUEST');
 if(fields.includes('authorId')&&(action==='payee'||data.authorId!==undefined)&&!id(data.authorId))fail(400,'INVALID_PAYOUT_REQUEST');
 if(fields.includes('amountKrw')&&!integer(data.amountKrw,1,1000000000))fail(400,'INVALID_PAYOUT_REQUEST');
 if(fields.includes('reason')&&!text(data.reason,300,3))fail(400,'REASON_REQUIRED');
 for(const k of ['reference','testReference'])if(fields.includes(k)&&!reference(data[k]))fail(400,'TEST_REFERENCE_REQUIRED');
 if(fields.includes('offset')){if(!write&&data.offset!==undefined){if(!/^(0|[1-9]\d{0,5})$/.test(data.offset))fail(400,'INVALID_QUERY');data.offset=Number(data.offset);}data.offset??=0;if(!integer(data.offset,0,100000))fail(400,'INVALID_QUERY');}
 if(fields.includes('status')){data.status??='ALL';if(!['ALL',...status].includes(data.status))fail(400,'INVALID_QUERY');}
 if(fields.includes('query')){data.query??='';if(!text(data.query,80))fail(400,'INVALID_QUERY');}
 if(action==='policy'&&(typeof data.enabled!=='boolean'||!integer(data.authorBps,0,10000)||!integer(data.deductionBps,0,10000)))fail(400,'INVALID_PAYOUT_REQUEST');
 if(action==='payee'&&typeof data.ready!=='boolean')fail(400,'INVALID_PAYOUT_REQUEST');
 if(action==='paid'){if(!timestamp(data.paidAt))fail(400,'INVALID_PAYOUT_REQUEST');data.paidAt=new Date(data.paidAt).toISOString();}
 let result;try{result=await rpc('op07_payouts',{p_user:user.id,p_action:admin?'admin-'+action:action,p_data:data});}
 catch(e){if([400,401,403,404,409,429,503].includes(e?.status)&&safeErrors.has(e?.code))throw e;fail(503,'SETTLEMENTS_TEST_UNAVAILABLE');}
 if(result?.error){if(!safeErrors.has(result.error)||![400,401,403,404,409,429,503].includes(result.status))fail(503,'SETTLEMENTS_TEST_UNAVAILABLE');fail(result.status,result.error);}
 return project(result,{action,admin,data,authorId:admin?undefined:String(actor.author.id)},fail);
}
