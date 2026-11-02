import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {CompactEncrypt} from 'jose';
import {probePayoutTest} from './lib/op09-payout-probe.mjs';
import {payoutsTossTestRequest,encryptPayoutTestBody,decryptPayoutTestBody} from '../server/providers/payouts-toss-test.mjs';
const securityKey=randomBytes(32).toString('hex'),secretKey='test_sk_synthetic_op09';
const order={providerMode:'PROVIDER_TEST',operationId:crypto.randomUUID(),refPayoutId:'wn09-'+crypto.randomUUID(),destination:'synthetic-seller',amountKrw:10000,operationCreatedAt:new Date().toISOString(),scheduleType:'SCHEDULED',payoutDate:'2026-12-01',transactionDescription:'TEST정산'};
const payout={id:'synthetic-payout',refPayoutId:order.refPayoutId,destination:order.destination,scheduleType:order.scheduleType,payoutDate:order.payoutDate,amount:{currency:'KRW',value:10000},transactionDescription:order.transactionDescription,requestedAt:new Date().toISOString(),status:'REQUESTED',error:null};
const single=p=>({entityType:'payout',entityBody:p});
const list=p=>({entityType:'payout-list',entityBody:{items:[p]}});
const query=(p,changes={})=>payoutsTossTestRequest({operation:'query',order:{...order,providerPayoutId:payout.id,...changes},secretKey},async()=>Response.json(single(p)));

test('create uses authenticated JWE array, fixed host and stable operation idempotency',async()=>{
 const calls=[];
 for(let i=0;i<2;i++){
  const r=await payoutsTossTestRequest({operation:'create',order,secretKey,securityKey},async(url,init)=>{
   calls.push(init);assert.equal(url,'https://api.tosspayments.com/v2/payouts');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert(init.signal instanceof AbortSignal);
   assert.equal(init.headers['TossPayments-api-security-mode'],'ENCRYPTION');assert.equal(init.headers['Content-Type'],'text/plain');
   const plain=await decryptPayoutTestBody(init.body,securityKey);assert.deepEqual(plain,[{refPayoutId:order.refPayoutId,destination:order.destination,scheduleType:order.scheduleType,payoutDate:order.payoutDate,amount:payout.amount,transactionDescription:order.transactionDescription}]);
   const header=JSON.parse(Buffer.from(init.body.split('.')[0],'base64url'));assert.equal(header.alg,'dir');assert.equal(header.enc,'A256GCM');assert.match(header.iat,/\+00:00$/);assert.match(header.nonce,/^[a-f0-9-]{36}$/);
   return new Response(await encryptPayoutTestBody(list(payout),securityKey));
  });assert.equal(r.state,'PENDING');assert.equal(r.ledgerApplyAllowed,false);
 }
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.notEqual(calls[0].body,calls[1].body);
});
test('LIVE, document credentials, invalid destination, amounts and expired creates make no calls',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error();};
 for(const changes of [{secretKey:'live_sk_rejected'},{secretKey:'test_sk_docs_example'},{securityKey:'invalid'},
  {order:{...order,providerMode:'LIVE'}},{order:{...order,destination:'../escape'}},{order:{...order,amountKrw:1.5}},
  {order:{...order,operationCreatedAt:'2000-01-01T00:00:00Z'}},{order:{...order,providerPayoutId:payout.id}},
  {order:{...order,payoutDate:'2026-02-31'}},{order:{...order,transactionDescription:'too-long-description'}}])
  await assert.rejects(payoutsTossTestRequest({operation:'create',order,secretKey,securityKey,...changes},fetcher));
 assert.equal(calls,0);
});
test('query binds seller, payout, currency, value and schedule; completion never applies ledger',async()=>{
 assert.equal((await query({...payout,status:'COMPLETED'})).state,'COMPLETED');
 for(const changes of [{id:'different'},{destination:'other-seller'},{refPayoutId:'other-ref'},{amount:{currency:'USD',value:10000}},
  {amount:{currency:'KRW',value:9999}},{scheduleType:'EXPRESS'},{payoutDate:'2026-12-02'},{requestedAt:'invalid'},
  {transactionDescription:'다른적요'},{status:'COMPLETED',error:{code:'error'}}])await assert.rejects(query({...payout,...changes}),{message:'PAYOUT_TEST_RECEIPT_MISMATCH'});
 for(const status of ['FAILED','CANCELED','DELETED','REJECTED','NEW_UNKNOWN_STATUS']){const r=await query({...payout,status});assert.equal(r.state,'REVIEW');assert.equal(r.ledgerApplyAllowed,false);}
});
test('tampering, wrong algorithm, transport failure and oversize responses remain unknown without retry',async()=>{
 const encrypted=await encryptPayoutTestBody(list(payout),securityKey);
 await assert.rejects(decryptPayoutTestBody(encrypted.slice(0,-5)+'AAAAA',securityKey));
 await assert.rejects(decryptPayoutTestBody(encrypted,randomBytes(32).toString('hex')));
 const wrongAlg=await new CompactEncrypt(new TextEncoder().encode('{}')).setProtectedHeader({alg:'dir',enc:'A128GCM'}).encrypt(randomBytes(16));
 await assert.rejects(decryptPayoutTestBody(wrongAlg,securityKey));
 for(const reply of [()=>{throw Error('secret provider details');},()=>new Response('x'.repeat(65537)),()=>new Response('bad json'),()=>Response.json(single(payout),{status:500})]){
  let calls=0;await assert.rejects(payoutsTossTestRequest({operation:'query',order:{...order,providerPayoutId:payout.id},secretKey},async()=>{calls++;return reply();}),{message:'PAYOUT_TEST_RESULT_UNKNOWN'});assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(payoutsTossTestRequest({operation:'create',order,secretKey,securityKey},async()=>{
  calls++;return new Response(await encryptPayoutTestBody({error:{code:'synthetic',message:'private provider detail'}},securityKey),{status:400});
 }),{message:'PAYOUT_TEST_RESULT_UNKNOWN'});assert.equal(calls,1);
});
test('query URL encodes opaque provider id and malformed/create batch mismatches are rejected',async()=>{
 const id='opaque:payment+id';await payoutsTossTestRequest({operation:'query',order:{...order,providerPayoutId:id},secretKey},async(url,init)=>{assert.equal(url,'https://api.tosspayments.com/v2/payouts/'+encodeURIComponent(id));assert.equal(init.method,'GET');assert.equal(init.body,undefined);return Response.json(single({...payout,id}));});
 for(const raw of [single(payout),{entityType:'payout-list',entityBody:{items:[payout,payout]}},list({...payout,destination:'different'})])
  await assert.rejects(payoutsTossTestRequest({operation:'create',order,secretKey,securityKey},async()=>new Response(await encryptPayoutTestBody(raw,securityKey))),{message:'PAYOUT_TEST_RECEIPT_MISMATCH'});
});
test('read-only probe never uses PG keys or LIVE keys and only returns redacted observations',async()=>{
 let calls=0;const env={TOSS_PAYOUT_TEST_SECRET_KEY:secretKey};
 const input={...order,providerPayoutId:payout.id};delete input.providerMode;
 for(const config of [{},{TOSS_TEST_SECRET_KEY:secretKey},{TOSS_PAYOUT_TEST_SECRET_KEY:'live_sk_rejected'}]){
  const r=await probePayoutTest({env:config,order:input,fetchImpl:async()=>{calls++;}});assert.equal(r.result,'BLOCKED');
 }assert.equal(calls,0);
 const r=await probePayoutTest({env,order:input,fetchImpl:async(url,init)=>{calls++;assert.equal(init.method,'GET');return Response.json(single({...payout,status:'COMPLETED'}));}});
 assert.equal(r.result,'VERIFIED_QUERY');assert.equal(r.ledgerWritten,false);assert.equal(r.liveReady,false);
 const text=JSON.stringify(r);for(const value of [secretKey,order.destination,order.refPayoutId,payout.id])assert.equal(text.includes(value),false);
});
