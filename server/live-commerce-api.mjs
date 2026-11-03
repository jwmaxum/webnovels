import {z} from 'zod';
import {reauthenticate,validateSettlementImage} from './author-settlement-api.mjs';
import {encryptSettlement,decryptSettlement,settlementFingerprint} from './author-settlement-crypto.mjs';
import {liveCommerceEnabled,liveCommercePolicy,depositInstructions,sha256} from './live-commerce-policy.mjs';
import {projectPointContent,pointPanel} from './points-test-api.mjs';
import {operationSchemas,operationReads,operationErrors,projectOperation,operationReadiness} from './live-commerce-operations.mjs';
export {liveCommerceEnabled};
const uuid=z.string().uuid(),id=z.string().regex(/^[1-9]\d{0,17}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),requestId=z.uuidv4(),password=z.string().min(1).max(256),money=z.number().int().min(0).max(1000000000),ref=z.string().trim().regex(/^[A-Za-z0-9_.:/-]{3,80}$/),offset=z.number().int().min(0).max(100000).default(0);
const evidence={documentId:uuid,image:z.object({mime:z.enum(['image/png','image/jpeg']),data:z.string().max(204800)}).strict(),policyHash:hash,policyVersion:ref,bankReference:ref,bankAccountId:ref,confirmed:z.literal(true)};
const schemas={reader:{state:z.object({offset}),episodes:z.object({workId:id,offset}),order:z.object({requestId,destinationHash:hash}),quote:z.object({episodeId:id}),purchase:z.object({quoteId:uuid,requestId}),content:z.object({episodeId:id}),panel:z.object({episodeId:id,versionId:uuid,panelId:uuid,format:z.enum(['png','webp'])})},
 author:{state:z.object({}),request:z.object({requestId,binding:hash})},admin:{list:z.object({query:z.string().max(80).regex(/^[^<>\x00-\x1f\x7f]*$/),offset}),policy:z.object({requestId,password,workId:id,price:money.min(1).max(1000000),shareBps:z.number().int().min(1).max(10000),contractRef:ref,expectedPolicyId:uuid.nullable()}),deposit:z.object({requestId,password,orderId:uuid,amount:money.min(1),occurredAt:z.iso.datetime({offset:true}),...evidence}),confirm:z.object({requestId,password,depositId:uuid}),correction:z.object({requestId,password,lotId:uuid,kind:z.enum(['REFUND','BANK_REVERSAL']),amount:money.min(1).max(10000),...evidence}),'confirm-correction':z.object({requestId,password,correctionId:uuid}),'reject-correction':z.object({requestId,password,correctionId:uuid}),approve:z.object({requestId,password,payoutId:uuid,deduction:money,basisRef:ref}),complete:z.object({requestId,password,payoutId:uuid,net:money.min(1),occurredAt:z.iso.datetime({offset:true}),...evidence}),cancel:z.object({requestId,password,payoutId:uuid,notTransferredConfirmed:z.literal(true),reasonRef:ref}),reveal:z.object({password,documentId:uuid})}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
Object.assign(schemas.admin,operationSchemas);
const errors=new Set(['ACCOUNT_INACTIVE','INVALID_COMMERCE_REQUEST','ADMIN_FORBIDDEN','AUTHOR_REQUIRED','READER_REQUIRED','INVALID_SESSION','EMAIL_CONFIRMATION_REQUIRED','AUTH_REQUIRED','IDEMPOTENCY_CONFLICT','RATE_LIMITED','PAYOUT_NOT_READY','PAYOUT_PENDING','ORDER_NOT_READY','CORRECTION_NOT_READY','AMOUNT_MISMATCH','DOCUMENT_UNAVAILABLE','BANK_REFERENCE_USED','INDEPENDENT_REVIEW_REQUIRED','COMMERCE_CONFLICT','CONTENT_NOT_AVAILABLE','PRICE_CHANGED','INSUFFICIENT_POINTS','EPISODE_LOCKED']);
const payout=z.object({id:uuid,authorId:id,penName:z.string().nullable(),gross:money,deduction:money.nullable(),net:money.nullable(),approvedBy:uuid.nullable(),documentId:uuid.nullable(),status:z.enum(['REQUESTED','APPROVED','PAID','CANCELLED']),createdAt:z.string()});
const resultSchemas={list:z.object({orders:z.array(z.object({id:uuid,userId:uuid,amount:money,destinationHash:hash,lotId:uuid.nullable(),confirmed:z.boolean(),deposits:z.array(z.object({id:uuid,amount:money,documentId:uuid,recordedBy:uuid})).max(120)})).max(30),works:z.array(z.object({id,title:z.string(),author:z.string().nullable(),policyId:uuid.nullable(),price:money.nullable(),shareBps:money.nullable()})).max(30),payouts:z.array(payout).max(30),corrections:z.array(z.object({id:uuid,kind:z.enum(['REFUND','BANK_REVERSAL']),amount:money,documentId:uuid,recordedBy:uuid})).max(30)}),reader:z.object({balance:money,orders:z.array(z.object({id:uuid,amount:money,confirmed:z.boolean()})).max(30),lots:z.array(z.object({id:uuid,remaining:money})).max(30),works:z.array(z.object({id,title:z.string(),type:z.enum(['NOVEL','WEBTOON'])})).max(30)}),author:z.object({available:z.number().int().min(-1000000000).max(1000000000),binding:hash,bankConfirmed:z.boolean(),payouts:z.array(payout).max(30)}),episodes:z.object({episodes:z.array(z.object({id,number:z.number().int().positive(),title:z.string(),price:money,owned:z.boolean()})).max(30)}),quote:z.object({id:uuid,episodeId:id,price:money,expiresAt:z.string(),balance:money}),write:z.object({id:uuid,charged:money.optional(),balance:money.optional(),gross:money.optional(),amount:money.optional(),points:money.optional(),replayed:z.boolean().optional()})};
export function projectCommerce(result,role,action){
 if(role==='admin'&&Object.hasOwn(operationSchemas,action))return projectOperation(result,action);
 if(result?.mode!=='LIVE_MANUAL'||result.source!=='BANK_RECONCILED')fail(503,'LIVE_COMMERCE_UNAVAILABLE');
 const schema=action==='state'?resultSchemas[role]:resultSchemas[action]||resultSchemas.write,parsed=schema.safeParse(result);
 if(!parsed.success)fail(503,'LIVE_COMMERCE_UNAVAILABLE');
 if(role==='author')for(const p of parsed.data.payouts||[]){delete p.approvedBy;delete p.documentId;}
 return {...parsed.data,mode:'LIVE_MANUAL',source:'BANK_RECONCILED'};
}
export async function liveCommerceApi({request,env,actor,user,rpc,remote}){
 if(!liveCommerceEnabled(env))fail(503,'LIVE_COMMERCE_NOT_ACTIVATED');
 const url=new URL(request.url),role=url.pathname==='/api/v2/admin/live-commerce'?'admin':url.pathname==='/api/v2/creator/live-commerce'?'author':url.pathname==='/api/v2/live-commerce'?'reader':null;
 if(!role)fail(404,'NOT_FOUND');if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');if(url.search)fail(400,'INVALID_QUERY');
 if(actor?.userId!==user?.id||!uuid.safeParse(user?.id).success||user.is_anonymous||user.deleted_at||user.banned_until&&(!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>Date.now()))fail(401,'INVALID_SESSION');
 if(!user.email_confirmed_at)fail(403,'EMAIL_CONFIRMATION_REQUIRED');
 if(role==='admin'&&(actor.admin?.role!=='SUPER_ADMIN'||actor.admin.is_active!==true))fail(403,'ADMIN_FORBIDDEN');
 if(role==='reader'&&actor.reader?.status!=='ACTIVE')fail(403,'READER_REQUIRED');if(role==='author'&&actor.author?.status!=='APPROVED')fail(403,'AUTHOR_REQUIRED');
 if(request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_REQUIRED');if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail(415,'JSON_REQUIRED');if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')fail(415,'UNSUPPORTED_ENCODING');
 const stream=request.body?.getReader();if(!stream)fail(400,'INVALID_COMMERCE_REQUEST');const chunks=[];let length=0;try{for(;;){const {value,done}=await stream.read();if(done)break;length+=value.byteLength;if(length>220000){await stream.cancel();fail(413,'BODY_TOO_LARGE');}chunks.push(value);}}finally{stream.releaseLock();}
 const bytes=new Uint8Array(length);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_COMMERCE_REQUEST');}
 if(!body||!Object.hasOwn(schemas[role],body.action))fail(400,'INVALID_COMMERCE_REQUEST');const {action,...input}=body,parsed=schemas[role][action].strict().safeParse(input);if(!parsed.success)fail(400,'INVALID_COMMERCE_REQUEST');const data=parsed.data,payload={...data};delete payload.password;
 const policy=await liveCommercePolicy(env),instructions=await depositInstructions(env),operation=role==='admin'&&Object.hasOwn(operationSchemas,action);
 if(role==='admin'&&action!=='list'&&!operationReads.has(action)){try{await reauthenticate({password:data.password,user,rpc,remote,admin:true,fail});}finally{data.password='';body.password='';input.password='';}}
 if(action==='exceptions')payload.destinationHash=instructions?.destinationHash||'0'.repeat(64);
 if(action==='order'&&(!instructions||instructions.destinationHash!==data.destinationHash))fail(409,'BANK_INSTRUCTIONS_CHANGED');
 if(data.image){
  if(!policy.enabled)fail(503,'FINANCE_PROOF_POLICY_REQUIRED');if(policy.hash!==data.policyHash||policy.version!==data.policyVersion)fail(409,'FINANCE_PROOF_POLICY_CHANGED');
  let image;try{image=validateSettlementImage(data.image);}catch{fail(400,'INVALID_SETTLEMENT_IMAGE');}
  if(action==='deposit'&&data.bankAccountId!==env.LIVE_BANK_DESTINATION_ID)fail(409,'BANK_INSTRUCTIONS_CHANGED');
  if(action==='deposit'){if(!instructions)fail(409,'BANK_INSTRUCTIONS_CHANGED');payload.destinationHash=instructions.destinationHash;}
  let purpose=action==='deposit'?'BANK_DEPOSIT':action==='complete'?'MANUAL_EXTERNAL':data.kind;
  const digest=await sha256(Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)));
  payload.bankRefHash=await settlementFingerprint({account:data.bankAccountId,reference:data.bankReference},env);
  if(action==='reproof'){
   let target;try{target=await rpc('op14_commerce_operations',{p_user:user.id,p_action:'proof-context',p_data:{kind:data.kind,targetId:data.targetId}});}catch{fail(503,'LIVE_COMMERCE_UNAVAILABLE');}
   if(target?.mode!=='LIVE_MANUAL'||target.source!=='BANK_RECONCILED'||target.id!==data.targetId||target.kind!==data.kind||target.bankRefHash!==payload.bankRefHash||!['BANK_DEPOSIT','REFUND','BANK_REVERSAL'].includes(target.purpose))fail(409,'OP14_EVIDENCE_MISMATCH');
   purpose=target.purpose;
  }
  payload.evidence={id:data.documentId,digest,policyVersion:policy.version,policyHash:policy.hash,retentionDays:policy.days,envelope:await encryptSettlement({image,bankReference:data.bankReference,bankAccountId:data.bankAccountId},{userId:user.id,authorId:'0',revision:'1',purpose:'finance:'+purpose+':'+data.documentId},env)};
  for(const k of Object.keys(evidence))delete payload[k];
 }
 let result;try{result=await rpc(operation?'op14_commerce_operations':'op13_commerce',{p_user:user.id,...(operation?{}:{p_role:role}),p_action:action,p_data:payload});}catch(e){if((errors.has(e?.code)||operationErrors.includes(e?.code))&&[400,401,403,404,409,429,503].includes(e.status))throw e;fail(503,'LIVE_COMMERCE_UNAVAILABLE');}
 if(result?.error){const known=errors.has(result.error)||operationErrors.includes(result.error);fail(known&&[400,401,403,404,409,429,503].includes(result.status)?result.status:503,known?result.error:'LIVE_COMMERCE_UNAVAILABLE');}
 if(action==='reveal'){
  if(!uuid.safeParse(result?.documentId).success||result.documentId!==data.documentId||!uuid.safeParse(result.actorId).success||!['BANK_DEPOSIT','MANUAL_EXTERNAL','REFUND','BANK_REVERSAL'].includes(result.purpose))fail(503,'DOCUMENT_UNAVAILABLE');
  try{const value=await decryptSettlement(result.envelope,{userId:result.actorId,authorId:'0',revision:'1',purpose:'finance:'+result.purpose+':'+result.documentId},env),image=validateSettlementImage(value.image);if(await sha256(Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)))!==result.digest)throw Error();return {image,bankReference:ref.parse(value.bankReference),bankAccountId:ref.parse(value.bankAccountId)};}catch{fail(503,'DOCUMENT_UNAVAILABLE');}
 }
 if(result?.mode!=='LIVE_MANUAL'||result.source!=='BANK_RECONCILED')fail(503,'LIVE_COMMERCE_UNAVAILABLE');
 if(action==='content'){const {mode,provenance,...content}=projectPointContent(result,data,fail);return {...content,mode:'LIVE_MANUAL',source:'BANK_RECONCILED'};}
 if(action==='panel')return pointPanel(result,data,remote,fail);
 const projected=projectCommerce(result,role,action);
 if(action==='operations-readiness'){
  const configuration=operationReadiness(env);configuration.keys.missingReadVersions=projected.documentKeys.filter(k=>!configuration.keys.readVersions.includes(k.version)).map(k=>k.version);
  return {...projected,configuration};
 }
 return {...projected,...(role==='admin'&&action==='list'?{policy}:{}),...(role==='reader'&&['state','order'].includes(action)?{instructions}:{} )};
}
