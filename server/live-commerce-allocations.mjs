import {z} from 'zod';
const uuid=z.string().uuid(),requestId=z.uuidv4(),password=z.string().min(1).max(256),money=z.number().int().min(1).max(1000000000),ref=z.string().trim().regex(/^[A-Za-z0-9_.:/-]{3,80}$/),offset=z.number().int().min(0).max(100000).default(0);
const source=z.object({depositId:uuid,amount:money}).strict();
export const allocationSchemas={
 'funding-list':z.object({offset}),
 'funding-propose':z.object({requestId,password,kind:z.enum(['CREDIT','RETURN']),orderId:uuid,sources:z.array(source).min(1).max(20).refine(a=>new Set(a.map(s=>s.depositId)).size===a.length),reasonRef:ref,reassignmentConfirmed:z.boolean()}),
 'funding-review':z.object({requestId,password,planId:uuid,approved:z.boolean()}),
 'funding-return':z.object({requestId,password,planId:uuid,amount:money,occurredAt:z.iso.datetime({offset:true}),documentId:uuid,image:z.object({mime:z.enum(['image/png','image/jpeg']),data:z.string().max(204800)}).strict(),policyHash:z.string().regex(/^[a-f0-9]{64}$/),policyVersion:ref,bankReference:ref,bankAccountId:ref,confirmed:z.literal(true)}),
 'payout-sources':z.object({payoutId:uuid}),
 'notification-list':z.object({offset}),
 'notification-test':z.object({requestId,password,notificationId:uuid,expectedAttempt:z.number().int().min(0).max(4),outcome:z.enum(['TEST_RETRY','TEST_READY'])})
};
export const allocationReads=new Set(['funding-list','payout-sources','notification-list']);
export const allocationErrors=['OP15_SOURCE_RESERVED','OP15_PLAN_CHANGED','OP15_REASSIGNMENT_REQUIRED','OP15_LEGACY_RECONCILIATION_REQUIRED','OP15_REVOKED_SOURCE'];
const results={
 'funding-list':z.object({deposits:z.array(z.object({id:uuid,orderId:uuid,amount:money,available:z.string().regex(/^\d{1,10}$/)})).max(30),plans:z.array(z.object({id:uuid,kind:z.enum(['CREDIT','RETURN']),orderId:uuid,amount:money,actorId:uuid,reasonRef:ref,createdAt:z.string(),status:z.enum(['PENDING','CREDITED','RETURN_APPROVED','RETURNED','REJECTED']),sources:z.array(source).max(20)})).max(30)}),
 'payout-sources':z.object({id:uuid,legacyReconciliationRequired:z.boolean(),sources:z.array(z.object({purchaseId:uuid,amount:money})).max(10000),recoveries:z.array(z.object({purchaseId:uuid,debtPayoutId:uuid,debtPurchaseId:uuid,amount:money})).max(10000)}),
 'notification-list':z.object({deliveryEnabled:z.literal(false),items:z.array(z.object({id:uuid,userId:uuid,eventType:z.enum(['POINTS_CREDITED','CORRECTION_CONFIRMED','PAYOUT_PAID','BANK_RETURNED']),targetId:uuid,createdAt:z.string(),attempt:z.number().int().min(0).max(5),outcome:z.enum(['NOT_SENT','TEST_RETRY','TEST_READY'])})).max(30)})
};
export function projectAllocation(result,action){
 const parsed=(results[action]||z.object({id:uuid,replayed:z.boolean().optional()})).safeParse(result);
 if(result?.mode!=='LIVE_MANUAL'||result.source!=='BANK_RECONCILED'||!parsed.success)throw Object.assign(Error('LIVE_COMMERCE_UNAVAILABLE'),{code:'LIVE_COMMERCE_UNAVAILABLE',status:503});
 return {...parsed.data,mode:'LIVE_MANUAL',source:'BANK_RECONCILED'};
}
