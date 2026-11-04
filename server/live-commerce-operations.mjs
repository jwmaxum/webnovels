import {z} from 'zod';
import {settlementKeyStatus} from './author-settlement-crypto.mjs';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),ref=z.string().trim().regex(/^[A-Za-z0-9_.:/-]{3,80}$/),password=z.string().min(1).max(256),requestId=z.uuidv4(),kind=z.enum(['DEPOSIT','CORRECTION']),month=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),offset=z.number().int().min(0).max(100000).default(0),count=z.string().regex(/^\d{1,20}$/),signed=z.string().regex(/^-?\d{1,20}$/);
const target={kind,targetId:uuid};
export const operationSchemas={
 exceptions:z.object({query:z.string().max(80).regex(/^[^<>\x00-\x1f\x7f]*$/),filter:z.enum(['ALL','MISMATCH','EXPIRED','OLD_INSTRUCTIONS','HELD','REVIEW_PENDING']),offset}),
 'case-open':z.object({requestId,password,...target,reasonRef:ref}),
 'case-resolve':z.object({requestId,password,caseId:uuid,reasonRef:ref}),
 reproof:z.object({requestId,password,...target,reasonRef:ref,documentId:uuid,image:z.object({mime:z.enum(['image/png','image/jpeg']),data:z.string().max(204800)}).strict(),policyHash:hash,policyVersion:ref,bankReference:ref,bankAccountId:ref,confirmed:z.literal(true)}),
 'review-reproof':z.object({requestId,password,proofId:uuid,approved:z.boolean()}),
 'month-preview':z.object({month}),
 'month-draft':z.object({requestId,password,month,expectedDigest:hash,previousId:uuid.nullable(),reasonRef:ref}),
 'month-approve':z.object({requestId,password,reportId:uuid,expectedDigest:hash}),
 'month-list':z.object({offset}),
 'month-detail':z.object({password,reportId:uuid}),
 'operations-readiness':z.object({})
};
export const operationReads=new Set(['exceptions','month-preview','month-list','operations-readiness']);
export const operationErrors=['OP14_TARGET_NOT_READY','OP14_EVIDENCE_MISMATCH','OP14_CASE_OPEN','OP14_REVIEW_PENDING','OP14_REPORT_CHANGED','OP14_REPORT_UNCHANGED','OP14_REPORT_TOO_LARGE'];
const eventTypes=z.enum(['DEPOSIT_RECORDED','POINTS_CREDITED','EPISODE_PURCHASED','REFUND_CONFIRMED','BANK_REVERSAL_CONFIRMED','REVENUE_REVERSED','PAYOUT_REQUESTED','PAYOUT_CANCELLED','PAYOUT_PAID','BANK_RETURNED']);
const data=z.object({fundingSources:z.array(z.object({depositId:uuid,amount:z.number().int().positive()})).max(20).optional(),exclusiveSources:z.array(z.object({purchaseId:uuid,amount:z.number().int().positive()})).max(10000).optional(),recoveries:z.array(z.object({purchaseId:uuid,debtPayoutId:uuid,debtPurchaseId:uuid,amount:z.number().int().positive()})).max(10000).optional(),orderId:uuid.optional(),occurredAt:z.string().optional(),depositId:uuid.nullable().optional(),authorId:count.optional(),episodeId:count.optional(),workId:count.optional(),policyId:uuid.optional(),contractRef:ref.optional(),shareBps:z.number().int().min(1).max(10000).optional(),allocations:z.array(z.object({lotId:uuid,points:z.number().int().positive()})).max(10000).optional(),lotId:uuid.optional(),purchaseId:uuid.optional(),correctionId:uuid.optional(),sourcePurchaseIds:z.array(uuid).max(10000).optional(),sourceScope:z.literal('CUMULATIVE_ELIGIBLE_PURCHASES_NOT_EXCLUSIVE_ALLOCATION').optional(),gross:z.number().int().nonnegative().optional(),deduction:z.number().int().nonnegative().optional(),net:z.number().int().nonnegative().optional(),basisRef:ref.optional()}).strict();
const snapshot=z.object({schemaVersion:z.literal(1),month,timezone:z.literal('Asia/Seoul'),basis:z.literal('RECORDED_AT'),events:z.array(z.object({type:eventTypes,id:uuid,recordedAt:z.string(),amount:signed,points:signed,revenue:signed,data}).strict()).max(10000),totals:z.array(z.object({type:eventTypes,count,amount:signed,points:signed,revenue:signed}).strict()).max(10),reviewIssues:z.array(z.object({kind:z.enum(['CASE','REPROOF','FUNDING']),id:uuid,targetId:uuid})).max(10000)}).strict();
const resultSchemas={
 exceptions:z.object({items:z.array(z.object({kind,id:uuid,orderId:uuid,userId:uuid,amount:z.number().int().positive(),documentId:uuid,reasons:z.array(z.enum(['MISMATCH','EXPIRED','OLD_INSTRUCTIONS','HELD','REVIEW_PENDING'])).max(5),createdAt:z.string(),cases:z.array(z.object({id:uuid,reasonRef:ref,createdAt:z.string(),actorId:uuid})).max(30),proofs:z.array(z.object({id:uuid,documentId:uuid,reasonRef:ref,actorId:uuid})).max(30)})).max(30),staleOrders:z.array(z.object({id:uuid,userId:uuid,createdAt:z.string()})).max(30)}),
 'month-preview':z.object({snapshot,digest:hash,previousId:uuid.nullable()}),
 'month-detail':z.object({id:uuid,digest:hash,previousId:uuid.nullable(),approved:z.boolean(),snapshot}),
 'month-list':z.object({reports:z.array(z.object({id:uuid,month,digest:hash,previousId:uuid.nullable(),actorId:uuid,approved:z.boolean(),createdAt:z.string()})).max(30)}),
 'operations-readiness':z.object({activeSuperAdmins:z.number().int().nonnegative(),openCases:count,pendingProofs:count,documentKeys:z.array(z.object({version:z.string().regex(/^v[1-9]\d{0,2}$/),count})).max(1000)})
};
export function projectOperation(result,action){
 const parsed=(resultSchemas[action]||z.object({id:uuid,replayed:z.boolean().optional()})).safeParse(result);
 if(result?.mode!=='LIVE_MANUAL'||result.source!=='BANK_RECONCILED'||!parsed.success)throw Object.assign(Error('LIVE_COMMERCE_UNAVAILABLE'),{code:'LIVE_COMMERCE_UNAVAILABLE',status:503});
 return {...parsed.data,mode:'LIVE_MANUAL',source:'BANK_RECONCILED'};
}
export function operationReadiness(env={}){
 const smtp=['BETA_SMTP_HOST','BETA_SMTP_PORT','BETA_SMTP_USER','BETA_SMTP_PASS','BETA_SMTP_ADMIN_EMAIL','BETA_SMTP_SENDER_NAME'];
 return {keys:settlementKeyStatus(env),smtp:{configurationPresent:smtp.every(k=>typeof env[k]==='string'&&env[k].trim().length>0),deliveryVerified:false,financialNotificationsConnected:false},
  hostedRestoreEvidencePresent:ref.safeParse(env.LIVE_COMMERCE_HOSTED_RESTORE_REF).success,bankAcceptanceEvidencePresent:ref.safeParse(env.LIVE_COMMERCE_BANK_ACCEPTANCE_REF).success,
  cleanupConfigured:env.LIVE_FINANCE_PROOF_CLEANUP_ENABLED==='true',realMoneyVerified:false};
}
