import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {topupsTossRequest,verifyTopupPayment} from '../server/providers/topups-toss.mjs';

const id=randomUUID(),operationId=randomUUID(),key='test_sk_synthetic_op05_only';
const base=()=>({orderId:id,checkoutId:'wn05-'+id,operationId,lease:randomUUID(),operationCreatedAt:new Date().toISOString(),operation:'confirm',providerMode:'PROVIDER_TEST',merchantId:'synthetic_mid',paymentKey:'synthetic_payment',amountKrw:10000,refundAmountKrw:7500,expectedBalanceKrw:2500,refundId:randomUUID(),reason:'남은 포인트 환불'});
const raw=(t,patch={})=>({orderId:t.checkoutId,paymentKey:t.paymentKey,mId:t.merchantId,currency:'KRW',totalAmount:t.amountKrw,balanceAmount:t.amountKrw,type:'NORMAL',method:'카드',status:'DONE',approvedAt:'2026-11-02T01:00:00Z',lastTransactionKey:'synthetic_approval',cancels:[],...patch});
const cancelled=(t,patch={})=>raw(t,{status:t.expectedBalanceKrw?'PARTIAL_CANCELED':'CANCELED',balanceAmount:t.expectedBalanceKrw,lastTransactionKey:'synthetic_cancel',cancels:[{transactionKey:'synthetic_cancel',cancelStatus:'DONE',cancelAmount:t.refundAmountKrw,canceledAt:'2026-11-02T02:00:00Z'}],...patch});

test('TEST native fetch uses exact server snapshot and stable operation-specific idempotency',async()=>{
  const t=base(),calls=[],fetcher=async(url,init)=>{calls.push({url,init});return Response.json(raw(t));};
  for(let i=0;i<2;i++)assert.equal((await topupsTossRequest({operation:'confirm',order:t,secretKey:key},fetcher)).state,'APPROVED');
  const q={...t,operation:'query'};await topupsTossRequest({operation:'query',order:q,secretKey:key},fetcher);
  assert.equal(calls[0].url,'https://api.tosspayments.com/v1/payments/confirm');
  assert.deepEqual(JSON.parse(calls[0].init.body),{paymentKey:t.paymentKey,orderId:t.checkoutId,amount:10000});
  assert.equal(calls[0].init.headers['Idempotency-Key'],'wn05-confirm-'+operationId);
  assert.equal(calls[0].init.headers['Idempotency-Key'],calls[1].init.headers['Idempotency-Key']);
  assert.equal(calls[2].init.method,'GET');assert.equal(calls[2].init.body,undefined);assert.equal(calls[2].init.headers['Idempotency-Key'],undefined);
  assert.equal(calls[0].init.redirect,'error');assert.ok(calls[0].init.signal instanceof AbortSignal);
  const c={...t,operation:'cancel',operationId:randomUUID()};const result=await topupsTossRequest({operation:'cancel',order:c,secretKey:key},async(url,init)=>{assert.equal(url,'https://api.tosspayments.com/v1/payments/'+t.paymentKey+'/cancel');assert.deepEqual(JSON.parse(init.body),{cancelReason:t.reason,cancelAmount:7500});assert.notEqual(init.headers['Idempotency-Key'],calls[0].init.headers['Idempotency-Key']);return Response.json(cancelled(c));});assert.equal(result.state,'CANCELLED');assert.equal(result.balanceKrw,2500);
});

test('partial-use and full refunds require one exact cancel transaction and remaining balance',()=>{
  for(const t of [base(),{...base(),refundAmountKrw:10000,expectedBalanceKrw:0}]){const result=verifyTopupPayment(cancelled(t),t);assert.equal(result.state,'CANCELLED');assert.equal(result.cancelAmountKrw,t.refundAmountKrw);}
  const t=base(),r=cancelled(t),c=r.cancels[0];
  for(const patch of [{balanceAmount:0},{status:'CANCELED'},{cancels:[{...c,cancelAmount:10000}]},{cancels:[{...c,cancelStatus:'PENDING'}]},{cancels:[{...c,transactionKey:'wrong'}]},{cancels:[{...c,canceledAt:'2026-11-01T00:00:00Z'}]}])assert.throws(()=>verifyTopupPayment({...r,...patch},t),/RECEIPT_MISMATCH/);
  assert.equal(verifyTopupPayment({...r,cancels:[c,c]},t).state,'REVIEW');
  assert.equal(verifyTopupPayment(r,{...t,refundAmountKrw:null}).state,'REVIEW');
  // DONE is only approval evidence; the DB must retain an existing refund hold.
  assert.equal(verifyTopupPayment(raw(t),{...t,operation:'query'}).state,'APPROVED');
});

test('merchant, type, amount, currency and approval references are all authoritative',()=>{
  const t=base();for(const patch of [{mId:'wrong'},{totalAmount:9999},{currency:'USD'},{type:'BILLING'},{method:'가상계좌'},{orderId:'other'},{paymentKey:'other'},{balanceAmount:9999},{approvedAt:null},{lastTransactionKey:''},{cancels:[{}]}])assert.throws(()=>verifyTopupPayment(raw(t,patch),t),/RECEIPT_MISMATCH/);
  for(const status of ['READY','IN_PROGRESS','ABORTED','EXPIRED'])assert.equal(verifyTopupPayment(raw(t,{status,approvedAt:null}),t).state,['READY','IN_PROGRESS'].includes(status)?'PENDING':'NOT_PAID');
});

test('timeouts, HTTP failures, invalid JSON and oversized responses are UNKNOWN; no guessed success',async()=>{
  const t=base();for(const fetcher of [async()=>{throw Error('timeout');},async()=>new Response('{}',{status:409}),async()=>new Response('{}',{status:400}),async()=>new Response('{}',{status:500}),async()=>new Response('bad'),async()=>new Response(' '.repeat(65537))])await assert.rejects(topupsTossRequest({operation:'confirm',order:t,secretKey:key},fetcher),/RESULT_UNKNOWN/);
});

test('LIVE, docs keys, invalid operation and 15-day-old mutation cannot reach provider',async()=>{
  const t=base(),never=()=>assert.fail('provider must not be called');
  for(const patch of [{providerMode:'LOCAL_SIMULATED'},{operationId:'bad'},{operationCreatedAt:new Date(Date.now()-15*86400_000).toISOString()},{operationCreatedAt:new Date(Date.now()+120000).toISOString()},{checkoutId:'wrong'},{amountKrw:1.1}])await assert.rejects(topupsTossRequest({operation:'confirm',order:{...t,...patch},secretKey:key},never));
  for(const secretKey of ['live_sk_synthetic','test_sk_docs_synthetic','bad'])await assert.rejects(topupsTossRequest({operation:'confirm',order:t,secretKey},never),/CONFIGURATION/);
  const oldQuery={...t,operation:'query',operationCreatedAt:'2020-01-01T00:00:00Z'};assert.equal((await topupsTossRequest({operation:'query',order:oldQuery,secretKey:key},async()=>Response.json(raw(t)))).state,'APPROVED');
  await assert.rejects(topupsTossRequest({operation:'cancel',order:{...t,operation:'cancel',refundAmountKrw:1,expectedBalanceKrw:0},secretKey:key},never),/REFUND_INVALID/);
});
