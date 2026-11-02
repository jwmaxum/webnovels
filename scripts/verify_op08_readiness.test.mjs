import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsReadiness} from '../server/operations-readiness.mjs';
import {probeTossTest} from './lib/op08-provider-probe.mjs';
import {providerSettingsApi} from '../server/provider-settings-api.mjs';
const env={TOSS_TEST_CLIENT_KEY:'test_ck_synthetic',TOSS_TEST_SECRET_KEY:'test_sk_synthetic',TOSS_TEST_MERCHANT_ID:'synthetic-mid'};
const order={orderId:'11111111-1111-4111-8111-111111111111',checkoutId:'wn05-11111111-1111-4111-8111-111111111111',operationId:'22222222-2222-4222-8222-222222222222',paymentKey:'synthetic-payment',merchantId:'synthetic-mid',amountKrw:10000,operationCreatedAt:new Date().toISOString()};
const payment={orderId:order.checkoutId,paymentKey:order.paymentKey,mId:order.merchantId,currency:'KRW',totalAmount:10000,balanceAmount:10000,type:'NORMAL',method:'카드',status:'DONE',approvedAt:'2026-11-02T00:00:00Z',lastTransactionKey:'synthetic-transaction',cancels:[]};
test('credentials are facts, never bank/identity/tax/payout or live acceptance',()=>{
 for(const config of [{},env,{...env,TOSS_TEST_SECRET_KEY:'live_sk_never_use'},{...env,TOSS_TEST_SECRET_KEY:'test_sk_docs_example'}]){
  const r=operationsReadiness({env:config});assert.equal(r.liveReady,false);assert.equal(r.activationAvailable,false);assert.equal(r.checks.find(x=>x.id==='bank-identity').status,'NOT_VERIFIED');assert.doesNotMatch(JSON.stringify(r),/test_ck_|test_sk_|live_sk_|synthetic-mid/);
 }
 assert.equal(operationsReadiness({env}).paymentConfiguration,'CONFIGURED');assert.equal(operationsReadiness().paymentConfiguration,'MISSING');
 assert.equal(operationsReadiness({env:{...env,TOSS_TEST_SECRET_KEY:'live_sk_rejected'}}).paymentConfiguration,'INVALID');
});
test('selected database source cannot fall back to environment keys or LIVE saved metadata',()=>{
 const selected={...env,PROVIDER_SETTINGS_SOURCE:'database'};
 assert.equal(operationsReadiness({env:selected,items:[{provider:'TOSS',mode:'LIVE',complete:true}]}).paymentConfiguration,'MISSING');
 const r=operationsReadiness({env:selected,items:[{provider:'TOSS',mode:'TEST',complete:true,enabled:true}]});assert.equal(r.paymentConfiguration,'CONFIGURED');assert.equal(r.liveReady,false);
});
test('readiness endpoint keeps existing administrator authorization and rejects mutations by other roles',async()=>{
 const fail=(status,code)=>{throw Object.assign(Error(code),{status});},request=new Request('https://site.test/api/v2/admin/providers');let calls=0;
 const rpc=async()=>{calls++;return {items:[]};};
 await assert.rejects(providerSettingsApi({request,user:{id:'x'},actor:{admin:{role:'SUB_ADMIN',is_active:true}},rpc,fail,env}),{message:'ADMIN_FORBIDDEN'});assert.equal(calls,0);
 const r=await providerSettingsApi({request,user:{id:'x'},actor:{admin:{role:'SUPER_ADMIN',is_active:true}},rpc,fail,env});assert.equal(r.readiness.liveReady,false);assert.equal(calls,1);
});
test('missing, LIVE, example keys and wrong merchant never call provider',async()=>{
 for(const config of [{},{...env,TOSS_TEST_SECRET_KEY:'live_sk_not_test'},{...env,TOSS_TEST_SECRET_KEY:'test_sk_docs_example'}]){
  const r=await probeTossTest({env:config,order,fetchImpl:()=>assert.fail('no provider request')});assert.equal(r.result,'BLOCKED');assert.equal(r.providerCalled,false);
 }
 assert.equal((await probeTossTest({env,order:{...order,merchantId:'another'},fetchImpl:()=>assert.fail()})).result,'BLOCKED');
 assert.equal((await probeTossTest({env,order:{...order,operation:'cancel'},fetchImpl:()=>assert.fail()})).result,'BLOCKED');
});
test('actual transport query uses fixed HTTPS GET and does not expose receipt identifiers',async()=>{
 const r=await probeTossTest({env,order,fetchImpl:async(url,init)=>{assert.equal(url,'https://api.tosspayments.com/v1/payments/synthetic-payment');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);return Response.json(payment);}});
 assert.equal(r.result,'VERIFIED_QUERY');assert.equal(r.liveReady,false);assert.equal(r.amountKrw,10000);assert.doesNotMatch(JSON.stringify(r),/synthetic-payment|synthetic-mid|synthetic-transaction|test_sk_/);
});
test('mismatched receipt and uncertain response cannot count as verified evidence',async()=>{
 for(const response of [()=>Response.json({...payment,totalAmount:9999}),()=>new Response('',{status:503}),()=>{throw Error('test_sk_private_transport_message');}]){
  const r=await probeTossTest({env,order,fetchImpl:response});assert.equal(r.result,'UNCONFIRMED');assert.equal(r.liveReady,false);assert.doesNotMatch(JSON.stringify(r),/private_transport_message/);
 }
});
