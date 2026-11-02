import {z} from 'zod';
import {manualPayoutWorkflowEnabled} from './author-payouts-test-api.mjs';
export {manualPayoutWorkflowEnabled};
const id=z.string().uuid(),revision=z.string().regex(/^(0|[1-9]\d{0,17})$/),text=z.string().trim().min(3).max(300).regex(/^[^<>\x00-\x1f\x7f]+$/u),reference=z.string().regex(/^TEST-[A-Za-z0-9_-]{1,72}$/);
const shared={payoutId:id,revision,requestId:z.string().uuid(),reason:text};
const proof={...shared,reference,documentReference:reference,testReference:reference};
const schema={detail:z.object({payoutId:id}).strict(),start:z.object(shared).strict(),note:z.object(shared).strict(),hold:z.object(shared).strict(),complete:z.object({...proof,amountKrw:z.number().int().positive().max(1e9),paidAt:z.iso.datetime()}).strict(),failure:z.object(proof).strict()};
const safeErrors=new Set(['ADMIN_FORBIDDEN','AUTHOR_REQUIRED','PAYOUT_NOT_FOUND','INVALID_PAYOUT_REQUEST','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','RATE_LIMITED','PAYOUT_METHOD_CONFLICT','PAYOUT_STATE_CONFLICT','WORKFLOW_HISTORY_LIMIT','TEST_REFERENCE_REQUIRED','PAYOUT_PROOF_MISMATCH','PAYOUT_EVIDENCE_CONFLICT','PAYOUT_POLICY_DISABLED','AUTHOR_NOT_PAYABLE','PAYEE_CHANGED','SETTLEMENT_HOLD']);
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]]));
export function projectManualWorkflow(result,{payoutId,admin}){
 const w=result?.workflow;
 if(result?.mode!=='TEST'||result.livePayouts!==false||w?.payoutId!==payoutId||!['MANUAL','TOSS_TEST','LEGACY_REVIEW'].includes(w.method)||!['REQUESTED','APPROVED','UNKNOWN','PAID','FAILED','REJECTED','CANCELLED'].includes(w.status)||typeof w.selected!=='boolean'||!revision.safeParse(w.revision).success||!Number.isSafeInteger(w.amountKrw)||w.amountKrw<1||!reference.safeParse(w.payeeReference).success)fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');
 const out=pick(w,['payoutId','method','selected','status','revision','amountKrw','payeeReference','startedAt','completedAt']);
 out.proof=null;out.provider=null;out.history=[];
 if(w.proof){if(w.proof.provenance!=='MANUAL_ATTESTED_TEST'||!['PAID','FAILED'].includes(w.proof.outcome)||w.proof.amountKrw!==w.amountKrw)fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');out.proof=pick(w.proof,['outcome','amountKrw','occurredAt','provenance',...(admin?['transactionReference','documentReference']:[])]);}
 if(w.provider){if(!['READY','UNKNOWN','PENDING','COMPLETED','REVIEW'].includes(w.provider.state)||w.provider.ledgerApplied!==false)fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');out.provider=pick(w.provider,['state','dispatchedAt','nextQueryAt','lastObservedAt','ledgerApplied']);}
 if(admin){if(!Array.isArray(w.history)||w.history.length>30)fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');out.history=w.history.map(h=>{if(!['START','ADOPT','COMPLETE','FAILURE','NOTE','HOLD'].includes(h.kind)||!text.safeParse(h.note).success)fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');return pick(h,['kind','note','createdAt']);});}
 return {mode:'TEST',livePayouts:false,workflow:out,...(typeof result.replayed==='boolean'?{replayed:result.replayed}:{})};
}
export async function manualPayoutWorkflowApi({request,user,actor,rpc,env}){
 if(!manualPayoutWorkflowEnabled(env))fail(503,'MANUAL_PAYOUT_WORKFLOW_NOT_ACTIVATED');
 const url=new URL(request.url),admin=url.pathname==='/api/v2/admin/payout-workflow';
 if(!id.safeParse(user?.id).success||actor?.userId!==user.id)fail(401,'INVALID_SESSION');
 if(admin){if(actor.admin?.role!=='SUPER_ADMIN'||actor.admin.is_active!==true)fail(403,'ADMIN_FORBIDDEN');}
 else if(actor.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');if(url.search)fail(400,'INVALID_QUERY');
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');
 if(request.headers.get('content-encoding')&&!['identity'].includes(request.headers.get('content-encoding')))fail(415,'UNSUPPORTED_ENCODING');
 const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_PAYOUT_REQUEST');const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}let parsed;
 try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_PAYOUT_REQUEST');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Object.hasOwn(schema,parsed.action))fail(400,'INVALID_ACTION');
 const {action,...data}=parsed;if(!admin&&action!=='detail')fail(403,'ADMIN_FORBIDDEN');
 const validated=schema[action].safeParse(data);if(!validated.success)fail(400,'INVALID_PAYOUT_REQUEST');
 let result;try{result=await rpc('op11_manual_payout',{p_user:user.id,p_action:action,p_data:validated.data,p_admin:admin});}
 catch(e){if(safeErrors.has(e?.code)&&[400,403,404,409,429].includes(e.status))throw e;fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');}
 if(result?.error){if(safeErrors.has(result.error)&&[400,403,404,409,429].includes(result.status))fail(result.status,result.error);fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');}
 if(action!=='detail'&&typeof result?.replayed!=='boolean')fail(503,'PAYOUT_WORKFLOW_UNAVAILABLE');
 return projectManualWorkflow(result,{payoutId:data.payoutId,admin});
}
