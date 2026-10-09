import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';
import {paidEpisodeApi,paidEpisodeSandboxEnabled} from '../server/paid-episode-api.mjs';
import {episodeTossRequest,verifyEpisodePayment} from '../server/providers/toss.mjs';
import {setup,reader,admin,limited,merchant,uuid} from './fixtures/stage20-db.mjs';
const env={P0_API_ENABLED:'true',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture',
 MONETIZATION_SANDBOX_ENABLED:'true',MONETIZATION_ENVIRONMENT:'TEST',MONETIZATION_EVIDENCE_SOURCE:'LOCAL_SIMULATED',
 TOSS_TEST_SECRET_KEY:'test_sk_fixture_private',TOSS_TEST_MERCHANT_ID:merchant};
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const raw=(t,changes={})=>({orderId:t.id,paymentKey:t.payment_key,mId:t.merchant_id,totalAmount:t.amount_krw,
 currency:'KRW',type:'NORMAL',method:'카드',balanceAmount:t.amount_krw,status:'DONE',
 approvedAt:new Date().toISOString(),lastTransactionKey:'tx_'+uuid(),...changes});
let f,db,calls=[],provider;
before(async()=>{f=await setup();db=f.db;});after(async()=>db?.close());beforeEach(async()=>{calls=[];await db.exec('delete from commerce.attempts');});
const handler=createSecureApi({fetchImpl:async(url,init={})=>{
 url=new URL(url);calls.push({url,init});
 if(url.origin==='https://api.tosspayments.com')return provider(url,init);
 const queried=url.searchParams.get('auth_user_id')?.slice(3);
 const actor=queried||(init.headers.Authorization==='Bearer '+token(admin)?admin:init.headers.Authorization==='Bearer '+token(limited)?limited:reader);
 if(url.pathname==='/auth/v1/user')return Response.json({id:actor,email_confirmed_at:'2026-01-01'});
 const table=url.pathname.split('/').pop(),body=init.body?JSON.parse(init.body):{};
 if(table==='p0_migration_status')return Response.json([{version:'p0-20260921',phase:'locked'}]);
 if(table==='readers')return Response.json(actor===reader?[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth_user_id:reader,status:'ACTIVE'}]:[]);
 if(table==='authors')return Response.json(actor===admin?[{id:1,auth_user_id:admin,status:'APPROVED'}]:actor===reader?[{id:2,auth_user_id:reader,status:'APPROVED'}]:[]);
 if(table==='admin_users')return Response.json(actor===admin?[{id:admin,auth_user_id:admin,is_active:true,role:'SUPER_ADMIN',permissions:[]}]:actor===limited?[{id:limited,is_active:true,role:'SUB_ADMIN',permissions:['CONTENT_REVIEW']}]:[]);
 if(table==='stage20_payments')return Response.json(await f.call(body.p_action,body.p_data,body.p_user));
 if(table==='stage20_apply_payment')return Response.json(await f.apply({id:body.p_order,lease:body.p_lease},body.p_receipt));
 throw new Error('Unexpected synthetic request: '+url.pathname);
}});
const token=user=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({sub:user})).toString('base64url')+'.signature';
const request=(path,{data,user=reader,overrides={},headers={}}={})=>handler(new Request('https://example.test/api/v2/payments/'+path,{
 method:data?'POST':'GET',headers:{Authorization:'Bearer '+token(user),...(data?{Origin:'https://example.test','Content-Type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),{...env,...overrides});
const prepare=async()=>{const p=await f.offer(),c=await f.create(p.episode);return {...p,...c};};
test('sandbox gates fail closed for default, LIVE, sample key and missing provenance; old settlement remains closed',async()=>{
 for(const patch of [{MONETIZATION_SANDBOX_ENABLED:'false'},{MONETIZATION_ENVIRONMENT:'LIVE'},
  {TOSS_TEST_SECRET_KEY:'live_sk_fixture'},{TOSS_TEST_SECRET_KEY:'test_sk_docs_example'},{TOSS_TEST_MERCHANT_ID:''},{MONETIZATION_EVIDENCE_SOURCE:''}]){
  assert.equal(paidEpisodeSandboxEnabled({...env,...patch}),false);assert.equal((await request('orders',{overrides:patch})).status,503);
 }
 const response=await handler(new Request('https://example.test/api/v2/settlements',{headers:{Authorization:'Bearer '+token(reader)}}),env);assert.equal(response.status,503);
 assert.ok(!calls.some(x=>x.url.origin==='https://api.tosspayments.com'));
});
test('public API gets server quote and reserves a snapshot without exposing transport/secrets',async()=>{
 const p=await f.offer();const q=await (await request('quote?episodeId='+p.episode)).json();assert.equal(q.quote.provenance,'LOCAL_SIMULATED');
 const response=await request('create',{data:{episodeId:p.episode,requestId:uuid(),offerVersion:q.quote.offerVersion,
  policyVersion:q.quote.policyVersion,expectedAmountKrw:q.quote.amountKrw}});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.order.status,'CREATED');
 assert.ok(!JSON.stringify(data).includes('payment_key'));assert.equal(data.transport,undefined);
 assert.equal((await request('orders')).status,200);assert.equal((await request('order?orderId='+data.order.id)).status,200);
});
test('HTTP approval plus response-loss query and refund preserve atomic SQL invariants end to end',async()=>{
 const p=await prepare(),key='payment_'+uuid();let approved;
 provider=async(url,init)=>{const o=JSON.parse(init.body);approved=raw({id:o.orderId,payment_key:o.paymentKey,merchant_id:merchant,amount_krw:o.amount});throw new Error('response lost after approval');};
 const first=await (await request('confirm',{data:{orderId:p.order.id,paymentKey:key}})).json();assert.equal(first.order.status,'UNKNOWN');
 assert.equal(first.transport,undefined);provider=async()=>Response.json(approved);
 const recovered=await (await request('reconcile',{data:{orderId:p.order.id}})).json();assert.equal(recovered.order.status,'PAID');
 assert.equal((await request('refund',{data:{orderId:p.order.id,reason:'전액 환불 요청'}})).status,403);
 provider=async(url,init)=>{
  assert.match(url.pathname,/cancel$/);assert.equal(JSON.parse(init.body).cancelAmount,p.order.amountKrw);
  const txn='refund_'+uuid();return Response.json({...approved,status:'CANCELED',balanceAmount:0,lastTransactionKey:txn,
   cancels:[{transactionKey:txn,cancelStatus:'DONE',cancelAmount:p.order.amountKrw,canceledAt:new Date().toISOString()}]});
 };
 const refunded=await (await request('refund',{user:admin,data:{orderId:p.order.id,reason:'전액 환불 요청'}})).json();assert.equal(refunded.order.status,'REFUNDED');
 assert.equal(refunded.order.sandboxEntitled,false);const earnings=await (await request('earnings',{user:admin})).json();assert.equal(earnings.payableKrw,0);
 assert.equal((await request('review',{user:admin})).status,200);assert.equal((await request('audit?orderId='+p.order.id,{user:admin})).status,200);
});
test('untrusted identity/receipts/prices and wrong origin never reach provider; administration is permission scoped',async()=>{
 const p=await prepare();
 for(const opts of [{data:{orderId:p.order.id,paymentKey:'p',success:true}},{data:{orderId:p.order.id,paymentKey:'p',authorId:'1'}},
  {data:{orderId:p.order.id,paymentKey:'p',amount:1}},{data:{orderId:p.order.id,paymentKey:'p'},headers:{Origin:'https://other.test'}}])
  assert.ok([400,403].includes((await request('confirm',opts)).status));
 assert.equal((await request('review',{user:limited})).status,403);
 assert.equal((await request('order?orderId='+p.order.id,{user:admin})).status,403);
 assert.equal((await request('webhook',{data:{status:'DONE'}})).status,404);
 assert.equal((await request('quote?episodeId='+p.episode+'&episodeId='+p.episode)).status,400);
 assert.equal((await request('confirm',{data:{orderId:'1',paymentKey:'p'}})).status,400);
 assert.equal((await request('refund',{user:admin,data:{orderId:p.order.id,reason:'x'}})).status,400);
 assert.ok(!calls.some(x=>x.url.origin==='https://api.tosspayments.com'));
});
test('RPC error codes and malformed responses fail closed; source/store changes cannot reroute reservations',async()=>{
 const request=new Request('https://example.test/api/v2/payments/orders');
 const args={request,env,actor:async()=>({userId:reader,reader:{status:'ACTIVE'}}),readBody:async()=>({}),fail};
 await assert.rejects(paidEpisodeApi({...args,db:async()=>({error:'RATE_LIMITED',status:429})}),{code:'RATE_LIMITED'});
 await assert.rejects(paidEpisodeApi({...args,db:async()=>null}),{code:'PAYMENT_SERVICE_UNAVAILABLE'});
 await assert.rejects(paidEpisodeApi({...args,db:async()=>({transport:{merchant_id:'wrong',mode:'TEST'}})}),{code:'PAYMENT_CONFIGURATION_MISMATCH'});
});
test('strict provider transport checks store/amount/type/status and stable operation-specific keys',async()=>{
 const p=await prepare(),r=await f.claim(p.order.id),t=r.transport,seen=[];
 const fetcher=async(url,init)=>{seen.push({url,init});return Response.json(raw(t));};
 await episodeTossRequest({operation:'confirm',order:t,secretKey:env.TOSS_TEST_SECRET_KEY},fetcher);
 await episodeTossRequest({operation:'confirm',order:t,secretKey:env.TOSS_TEST_SECRET_KEY},fetcher);
 await episodeTossRequest({operation:'query',order:t,secretKey:env.TOSS_TEST_SECRET_KEY},fetcher);
 await episodeTossRequest({operation:'cancel',order:t,secretKey:env.TOSS_TEST_SECRET_KEY,reason:'전액 환불 요청'},fetcher);
 assert.equal(seen[0].init.headers['Idempotency-Key'],seen[1].init.headers['Idempotency-Key']);
 assert.notEqual(seen[0].init.headers['Idempotency-Key'],seen[3].init.headers['Idempotency-Key']);
 assert.equal(seen[2].init.method,'GET');assert.equal(seen[2].init.body,undefined);
 for(const changes of [{mId:'wrong'},{currency:'USD'},{totalAmount:1},{orderId:'wrong'},{paymentKey:'wrong'},{method:'가상계좌'},{type:'BILLING'},
  {balanceAmount:1},{approvedAt:null},{lastTransactionKey:''}])assert.throws(()=>verifyEpisodePayment(raw(t,changes),t),/MISMATCH/);
 for(const patch of [{mode:'LIVE'},{amount_krw:1.1},{merchant_id:''},{currency:'USD'}])
  await assert.rejects(episodeTossRequest({operation:'query',order:{...t,...patch},secretKey:env.TOSS_TEST_SECRET_KEY},()=>assert.fail('transport forbidden')),/CONFIGURATION/);
});
test('timeouts/409/bad JSON remain unknown; full refund evidence differs from partial/unsupported evidence',async()=>{
 const p=await prepare(),r=await f.claim(p.order.id),t=r.transport;
 for(const fetcher of [async()=>{throw new Error('timeout');},async()=>new Response('{}',{status:409}),async()=>new Response('{}',{status:500}),async()=>new Response('bad json')])
  await assert.rejects(episodeTossRequest({operation:'query',order:t,secretKey:env.TOSS_TEST_SECRET_KEY},fetcher),/RESULT_UNKNOWN/);
 for(const state of ['READY','IN_PROGRESS','ABORTED','EXPIRED'])assert.equal(verifyEpisodePayment(raw(t,{status:state,approvedAt:null}),t).state,['READY','IN_PROGRESS'].includes(state)?'PENDING':'NOT_PAID');
 const txn='refund_'+uuid(),data=raw(t,{status:'CANCELED',balanceAmount:0,lastTransactionKey:txn});
 const cancel={transactionKey:txn,cancelStatus:'DONE',cancelAmount:t.amount_krw,canceledAt:new Date().toISOString()};
 assert.equal(verifyEpisodePayment({...data,cancels:[cancel]},t).state,'CANCELLED');
 for(const changes of [{cancelAmount:1},{cancelStatus:'PENDING'},{transactionKey:'different'},{canceledAt:'bad'}])
  assert.throws(()=>verifyEpisodePayment({...data,cancels:[{...cancel,...changes}]},t),/MISMATCH/);
 assert.equal(verifyEpisodePayment({...data,status:'PARTIAL_CANCELED',balanceAmount:10,cancels:[cancel]},t).state,'REVIEW');
 await assert.rejects(episodeTossRequest({operation:'cancel',order:t,secretKey:env.TOSS_TEST_SECRET_KEY,reason:''}),/REASON/);
 await assert.rejects(episodeTossRequest({operation:'invalid',order:t,secretKey:env.TOSS_TEST_SECRET_KEY}),/OPERATION/);
});
