import {topupsTossRequest} from '../../server/providers/topups-toss.mjs';
import {operationsReadiness} from '../../server/operations-readiness.mjs';
const fields=['orderId','checkoutId','operationId','paymentKey','merchantId','amountKrw','operationCreatedAt','refundAmountKrw','expectedBalanceKrw'];
export async function probeTossTest({env={},order,fetchImpl=fetch}={}){
 const base={stage:'OP-08',kind:'READ_ONLY_PAYMENT_QUERY',checkedAt:new Date().toISOString(),providerCalled:false,liveReady:false,productionDatabaseWritten:false};
 // This CLI deliberately uses explicit TEST environment credentials, never saved LIVE settings.
 const config=operationsReadiness({env:{...env,PROVIDER_SETTINGS_SOURCE:'environment'}}).paymentConfiguration;
 if(config!=='CONFIGURED')return {...base,result:'BLOCKED',reason:'TEST_KEYS_'+config};
 if(!order)return {...base,result:'BLOCKED',reason:'TEST_PAYMENT_RECEIPT_REQUIRED'};
 if(typeof order!=='object'||Array.isArray(order)||Object.keys(order).some(k=>!fields.includes(k))||order.merchantId!==env.TOSS_TEST_MERCHANT_ID)return {...base,result:'BLOCKED',reason:'INVALID_TEST_RECEIPT'};
 let called=false;
 try{
  const receipt=await topupsTossRequest({operation:'query',order:{...order,providerMode:'PROVIDER_TEST',operation:'query'},secretKey:env.TOSS_TEST_SECRET_KEY},async(url,init)=>{called=true;return fetchImpl(url,init);});
  if(!['APPROVED','CANCELLED'].includes(receipt.state))return {...base,providerCalled:called,result:'UNCONFIRMED',reason:'PAYMENT_'+receipt.state};
  return {...base,providerCalled:called,result:'VERIFIED_QUERY',provenance:'PROVIDER_TEST',state:receipt.state,amountKrw:receipt.amountKrw,balanceKrw:receipt.balanceKrw,
   ...(receipt.approvedAt?{approvedAt:receipt.approvedAt}:{}),...(receipt.cancelledAt?{cancelledAt:receipt.cancelledAt}:{}),
   acceptance:'Query only; not checkout, refund execution, author payout, tax or live acceptance'};
 }catch(error){return {...base,providerCalled:called,result:'UNCONFIRMED',reason:['PAYMENT_RECEIPT_MISMATCH','PAYMENT_CONFIGURATION_REQUIRED','PAYMENT_OPERATION_EXPIRED'].includes(error.message)?error.message:'PAYMENT_RESULT_UNKNOWN'};}
}
