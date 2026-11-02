import {payoutsTossTestRequest} from '../../server/providers/payouts-toss-test.mjs';
const fields=['operationId','refPayoutId','destination','amountKrw','operationCreatedAt','scheduleType','payoutDate','transactionDescription','providerPayoutId'];
export async function probePayoutTest({env={},order,fetchImpl=fetch}={}){
 const base={stage:'OP-09',kind:'READ_ONLY_PAYOUT_QUERY',providerCalled:false,ledgerWritten:false,liveReady:false};
 const secret=env.TOSS_PAYOUT_TEST_SECRET_KEY;
 if(!secret)return {...base,result:'BLOCKED',reason:'PAYOUT_TEST_KEY_MISSING'};
 if(typeof secret!=='string'||!/^test_(?:g)?sk_[A-Za-z0-9_-]{1,200}$/.test(secret)||secret.includes('_docs_'))return {...base,result:'BLOCKED',reason:'PAYOUT_TEST_KEY_INVALID'};
 if(!order)return {...base,result:'BLOCKED',reason:'PAYOUT_TEST_RECEIPT_REQUIRED'};
 if(typeof order!=='object'||Array.isArray(order)||Object.keys(order).some(k=>!fields.includes(k)))return {...base,result:'BLOCKED',reason:'PAYOUT_TEST_INPUT_INVALID'};
 let called=false;
 try{
  const r=await payoutsTossTestRequest({operation:'query',order:{...order,providerMode:'PROVIDER_TEST'},secretKey:secret},async(url,init)=>{called=true;return fetchImpl(url,init);});
  return {...base,providerCalled:called,result:r.state==='COMPLETED'?'VERIFIED_QUERY':'UNCONFIRMED',state:r.state,amountKrw:r.amountKrw,provenance:'PROVIDER_TEST',acceptance:'Query only; not identity, transfer execution, ledger or LIVE acceptance'};
 }catch(error){return {...base,providerCalled:called,result:'UNCONFIRMED',reason:['PAYOUT_TEST_RECEIPT_MISMATCH','PAYOUT_TEST_REQUEST_INVALID'].includes(error.message)?error.message:'PAYOUT_TEST_RESULT_UNKNOWN'};}
}
