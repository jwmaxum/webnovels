import {z} from 'zod';
import {reauthenticate,validateSettlementImage} from './author-settlement-api.mjs';
import {encryptSettlement,decryptSettlement,settlementFingerprint} from './author-settlement-crypto.mjs';
import {settlementReadinessEnabled,proofPolicy} from './settlement-readiness-policy.mjs';
export {settlementReadinessEnabled};
const id=z.string().uuid(),aid=z.string().regex(/^[1-9]\d{0,17}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),revision=z.string().regex(/^[1-9]\d{0,17}$/);
const base={authorId:aid,binding:hash,requestId:z.uuidv4()},password=z.string().min(1).max(256);
const schemas={list:z.object({query:z.string().max(80).regex(/^[^<>\x00-\x1f\x7f]*$/),offset:z.number().int().min(0).max(999999)}).strict(),detail:z.object({authorId:aid.optional()}).strict(),
 confirm:z.object({...base,password,documentId:id,image:z.object({mime:z.enum(['image/png','image/jpeg']),data:z.string().max(204800)}).strict(),policyVersion:z.string().max(80),policyHash:hash,confirmed:z.literal(true)}).strict(),
 revoke:z.object({...base,password,reviewId:id,reason:z.enum(['INCORRECT_EVIDENCE','AUTHOR_REQUEST','BANK_CHANGED','OTHER_REVIEW'])}).strict(),
 snapshot:z.object({...base,period:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)}).strict(),reveal:z.object({authorId:aid,reviewId:id,password}).strict()};
const factsSchema=z.object({authorId:aid,binding:hash,bankRevision:revision.nullable(),identityRevision:revision.nullable(),identityApproved:z.boolean(),bankRegistered:z.boolean(),bankConfirmed:z.boolean(),reviewId:id.nullable(),sourceStatus:z.literal('UNCONNECTED'),grossKrw:z.null(),deductionsKrw:z.null(),payableKrw:z.null(),canPay:z.literal(false),blockers:z.array(z.enum(['BANK_MISSING','IDENTITY_NOT_APPROVED','BANK_REVIEW_REQUIRED','LIVE_REVENUE_UNCONNECTED','PAYOUT_RELEASE_NOT_APPROVED'])).max(5)});
const bankSchema=z.object({bankName:z.string().max(60),holder:z.string().max(80),maskedNumber:z.string().regex(/^\*{4} \d{4}$/)}).nullable();
const errors=new Set(['ADMIN_FORBIDDEN','AUTHOR_REQUIRED','AUTHOR_NOT_FOUND','INVALID_READINESS_REQUEST','SETTLEMENT_CONFLICT','IDEMPOTENCY_CONFLICT','RATE_LIMITED','INDEPENDENT_REVIEW_REQUIRED','BANK_REVIEW_NOT_READY','BANK_ALREADY_CONFIRMED','BANK_DOCUMENT_UNAVAILABLE','SETTLEMENT_NOT_ACTIVATED']);
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
export function projectReadiness(result,{action,admin,authorId}){
 if(result?.mode!=='PREPARATION'||result.canPay!==false)fail(503,'SETTLEMENT_READINESS_UNAVAILABLE');
 try{
  if(action==='list'){const items=z.array(z.object({authorId:aid,penName:z.string().max(200),facts:factsSchema})).max(31).parse(result.items);if(items.some(x=>x.authorId!==x.facts.authorId))throw Error();return {mode:'PREPARATION',canPay:false,items};}
  if(action==='detail'){
   const facts=factsSchema.parse(result.facts);if(facts.authorId!==authorId)throw Error();
   const snapshots=z.array(z.object({id,period:z.string(),createdAt:z.string(),stale:z.boolean(),facts:factsSchema})).max(10).parse(result.snapshots);if(snapshots.some(s=>s.facts.authorId!==authorId))throw Error();
   const reviews=admin?z.array(z.object({id,createdAt:z.string(),revoked:z.boolean(),documentAvailable:z.boolean()})).max(10).parse(result.reviews):[];
   return {mode:'PREPARATION',canPay:false,facts,bank:bankSchema.parse(result.bank),snapshots,reviews};
  }
  if(result.saved!==true||typeof result.replayed!=='boolean')throw Error();return {mode:'PREPARATION',canPay:false,saved:true,replayed:result.replayed};
 }catch{fail(503,'SETTLEMENT_READINESS_UNAVAILABLE');}
}
export async function settlementReadinessApi({request,env,actor,user,rpc,remote}){
 if(!settlementReadinessEnabled(env))fail(503,'SETTLEMENT_READINESS_NOT_ACTIVATED');
 const url=new URL(request.url),admin=url.pathname==='/api/v2/admin/settlement-readiness';
 if(!id.safeParse(user?.id).success||actor?.userId!==user.id)fail(401,'INVALID_SESSION');
 if(admin){if(actor.admin?.role!=='SUPER_ADMIN'||actor.admin.is_active!==true)fail(403,'ADMIN_FORBIDDEN');}else if(actor.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');if(url.search)fail(400,'INVALID_QUERY');
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')fail(415,'UNSUPPORTED_ENCODING');
 const reader=request.body?.getReader();if(!reader)fail(400,'INVALID_READINESS_REQUEST');let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>220000){await reader.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}let body;
 try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_READINESS_REQUEST');}
 if(!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(schemas,body.action))fail(400,'INVALID_READINESS_REQUEST');
 const {action,...input}=body;if(!admin&&(action!=='detail'||Object.keys(input).length))fail(403,'ADMIN_FORBIDDEN');
 const parsed=schemas[action].safeParse(input);if(!parsed.success)fail(400,'INVALID_READINESS_REQUEST');const data=parsed.data;
 if(admin&&action!=='list'&&!data.authorId)fail(400,'INVALID_READINESS_REQUEST');
 const call=async(a,d)=>{let r;try{r=await rpc('op12_settlement_readiness',{p_user:user.id,p_action:a,p_data:d,p_admin:admin});}catch(e){if(errors.has(e?.code)&&[400,403,404,409,429,503].includes(e.status))throw e;fail(503,'SETTLEMENT_READINESS_UNAVAILABLE');}if(r?.error){if(errors.has(r.error)&&[400,403,404,409,429,503].includes(r.status))fail(r.status,r.error);fail(503,'SETTLEMENT_READINESS_UNAVAILABLE');}return r;};
 const policy=await proofPolicy(env);let payload={...data};delete payload.password;
 if(action==='confirm'){
  if(!policy.collectionEnabled)fail(503,'BANK_PROOF_POLICY_REQUIRED');
  if(data.policyVersion!==policy.version||data.policyHash!==policy.hash)fail(409,'BANK_PROOF_POLICY_CHANGED');
  let image;try{image=validateSettlementImage(data.image);}catch{fail(400,'INVALID_SETTLEMENT_IMAGE');}
  const details=await call('detail',{authorId:data.authorId});const projected=projectReadiness(details,{action:'detail',admin:true,authorId:data.authorId});
  if(projected.facts.binding!==data.binding)fail(409,'SETTLEMENT_CONFLICT');if(!id.safeParse(details.ownerUserId).success)fail(503,'SETTLEMENT_READINESS_UNAVAILABLE');
  if(details.ownerUserId===user.id)fail(403,'INDEPENDENT_REVIEW_REQUIRED');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)))),v=>v.toString(16).padStart(2,'0')).join('');
  const context={userId:details.ownerUserId,authorId:data.authorId,revision:projected.facts.bankRevision,purpose:'bank-review:'+data.documentId+':'+projected.facts.identityRevision};
  const envelope=await encryptSettlement(image,context,env);
  payload={authorId:data.authorId,binding:data.binding,requestId:data.requestId,documentId:data.documentId,envelope,digest,policyVersion:policy.version,policyHash:policy.hash,retentionDays:policy.retentionDays,fingerprint:await settlementFingerprint({userId:user.id,action,authorId:data.authorId,binding:data.binding,documentId:data.documentId,digest,policyHash:policy.hash},env)};
 }
 if(['confirm','revoke','reveal'].includes(action)){try{await reauthenticate({password:data.password,user,rpc,remote,admin:true,fail});}finally{data.password='';input.password='';body.password='';}}
 const result=await call(action,payload);
 if(action==='reveal'){
  const secured=result.encrypted;
  if(!secured||secured.authorId!==data.authorId||!id.safeParse(secured.userId).success||!id.safeParse(secured.id).success||!revision.safeParse(secured.bankRevision).success||!revision.safeParse(secured.identityRevision).success)fail(503,'BANK_DOCUMENT_UNAVAILABLE');
  let image;try{image=validateSettlementImage(await decryptSettlement(secured.envelope,{userId:secured.userId,authorId:secured.authorId,revision:secured.bankRevision,purpose:'bank-review:'+secured.id+':'+secured.identityRevision},env));const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)))),v=>v.toString(16).padStart(2,'0')).join('');if(digest!==secured.digest)throw Error();}catch{fail(503,'BANK_DOCUMENT_UNAVAILABLE');}
  return {image};
 }
 return {...projectReadiness(result,{action,admin,authorId:admin?data.authorId:String(actor.author.id)}),...(action==='detail'||action==='list'?{policy}:{} )};
}
