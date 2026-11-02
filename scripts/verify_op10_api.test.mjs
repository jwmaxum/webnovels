import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createSecureApi} from '../server/secure-api.mjs';
import {setup,admin,reader,uuid} from './fixtures/op10-db.mjs';
import {env as baseEnv} from './fixtures/op07-api.mjs';
import {verifyPayoutWebhook,validPayoutTestValues,payoutTestRuntimeEnabled,processPayoutTest,reconcileDuePayoutTests} from '../server/payout-provider-test-api.mjs';
import {reconcilePayoutTest} from '../server/providers/payouts-toss-test.mjs';
const url='https://site.test/api/v2/admin/payout-provider-test';
test('disabled routes, including webhook, do not touch Auth, DB or provider',async()=>{
 const run=createSecureApi({fetchImpl:()=>assert.fail('no network')});
 for(const path of [url,'https://site.test/api/v2/payout-provider-test/callback?configId='+uuid()]){const response=await run(new Request(path),baseEnv);assert.equal(response.status,503);assert.equal((await response.json()).error,'PAYOUT_TEST_NOT_ACTIVATED');}
 assert.equal(payoutTestRuntimeEnabled({PAYOUT_PROVIDER_TEST_ENABLED:'true',PAYOUT_PROVIDER_TEST_ENVIRONMENT:'LIVE',PAYOUT_PROVIDER_TEST_CONFIG_ID:uuid()}),false);
 assert.equal((await reconcileDuePayoutTests({env:{},rpc:()=>assert.fail()})).processed,0);
 await assert.rejects(processPayoutTest({id:uuid(),env:{},rpc:()=>assert.fail()}),e=>e.code==='PAYOUT_TEST_NOT_ACTIVATED');
});
test('real gateway enforces Auth, origin, reauth and encrypted dedicated config; no secrets in DTO',async()=>{
 const f=await setup();let userId=admin,role='SUPER_ADMIN',loginUser=admin,calls=0;
 try{
  const run=createSecureApi({fetchImpl:async(target,init={})=>{calls++;const u=new URL(target),body=init.body?JSON.parse(init.body):{};assert.equal(u.origin,'https://synthetic.supabase.co');
   if(u.pathname==='/auth/v1/user')return Response.json({id:userId,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});
   if(u.pathname==='/auth/v1/token')return Response.json({user:{id:loginUser},access_token:'synthetic.reauth.token'});
   if(u.pathname==='/auth/v1/logout')return new Response(null,{status:204});
   if(u.pathname.endsWith('/launch_accounts_ready'))return Response.json(true);
   if(u.pathname.endsWith('/launch_account_actor'))return Response.json({userId,admin:{role,is_active:true}});
   if(u.pathname.endsWith('/op10_payout_admin'))return Response.json(await f.adminCall(body.p_action,body.p_data,body.p_user));
   if(u.pathname.endsWith('/op10_payout_runtime'))return Response.json(await f.runtime(body.p_action,body.p_data));
   assert.fail('unexpected network path');
  }});
  const env={...baseEnv,...f.env};
  async function call(data,headers={}){return run(new Request(url,{method:data?'POST':'GET',headers:{Authorization:'Bearer synthetic.jwt.token',Origin:'https://site.test','content-type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})}),env);}
  assert.equal((await call(undefined,{Authorization:''})).status,401);role='SUB_ADMIN';assert.equal((await call()).status,403);role='SUPER_ADMIN';
  assert.equal((await call({action:'list'},{Origin:'https://other.test'})).status,403);
  for(const data of [{action:'toString'},{action:'list',envelope:{}},{action:'save',revision:'0',values:{...f.values,secretKey:'live_sk_bad'},password:'synthetic'}])assert.equal((await call(data)).status,400);
  loginUser=reader;assert.equal((await call({action:'save',revision:'0',values:f.values,password:'synthetic'})).status,403);loginUser=admin;
  const save=await call({action:'save',revision:'0',values:f.values,password:'synthetic'});assert.equal(save.status,200);const saved=await save.json();assert.equal(saved.saved,true);assert.equal(saved.activationAvailable,false);
  for(const key of Object.values(f.values))assert(!JSON.stringify(saved).includes(key));
  const state=await (await call()).json();assert.equal(state.configId,saved.configId);assert.equal(state.runtimeEnabled,false);assert.equal(state.ledgerApplyAllowed,false);
  assert.equal((await call({action:'dispatch',id:uuid()})).status,503);
  const stored=await f.runtime('config',{configId:saved.configId});assert(stored.envelope.ciphertext);assert(!JSON.stringify(stored).includes(f.values.secretKey));
  assert.equal((await call({action:'save',revision:'0',values:f.values,password:'synthetic'})).status,409);assert(calls>0);
 }finally{await f.db.close();}
});
test('webhook raw bytes, multiple signatures, own freshness policy and tamper rejection',async()=>{
 const keyBytes=randomBytes(32),keyBase64=keyBytes.toString('base64'),now=Date.now(),time=new Date(now).toISOString(),bytes=Buffer.from('{ "eventId": "sample" }');
 const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,Buffer.concat([bytes,Buffer.from(':'+time)]))).toString('base64');
 const headers=new Headers({'tosspayments-webhook-transmission-time':time,'tosspayments-webhook-signature':'v1:'+randomBytes(32).toString('base64')+', v1:'+signature});
 assert(await verifyPayoutWebhook(bytes,headers,keyBase64,now));
 assert(!await verifyPayoutWebhook(Buffer.from('{"eventId":"sample"}'),headers,keyBase64,now));
 assert(!await verifyPayoutWebhook(bytes,headers,keyBase64,now+300001));
 assert(!await verifyPayoutWebhook(bytes,headers,randomBytes(32).toString('base64'),now));
 headers.set('tosspayments-webhook-signature','a'.repeat(2049));assert(!await verifyPayoutWebhook(bytes,headers,keyBase64,now));
});
test('bounded discovery does not retry create or accept partial/ambiguous/mismatched list',async()=>{
 const order={providerMode:'PROVIDER_TEST',operationId:uuid(),refPayoutId:'synthetic-ref',destination:'seller',amountKrw:100,operationCreatedAt:new Date().toISOString(),scheduleType:'EXPRESS',payoutDate:null,transactionDescription:'TEST'};
 const item={id:'payout',refPayoutId:order.refPayoutId,destination:order.destination,amount:{currency:'KRW',value:100},scheduleType:'EXPRESS',transactionDescription:'TEST',requestedAt:new Date().toISOString(),status:'COMPLETED'};
 for(const scenario of ['empty','partial','duplicate','mismatch','cursor','large','error']){
  let calls=0;await assert.rejects(reconcilePayoutTest({order,secretKey:'test_sk_synthetic'},async(_url,init)=>{calls++;assert.equal(init.method,'GET');assert(init.signal);assert.equal(init.redirect,'error');
   if(scenario==='large')return new Response('x'.repeat(65537));if(scenario==='error')return new Response('{}',{status:500});
   return Response.json({entityType:'payout-list',entityBody:{hasMore:['partial','cursor'].includes(scenario),nextCursor:scenario==='cursor'?'same':'page-'+calls,items:scenario==='empty'||scenario==='cursor'?[]:scenario==='duplicate'?[item,item]:scenario==='mismatch'?[{...item,destination:'wrong'}]:[item]}});
  }),/PAYOUT_TEST_/);assert(calls<=3);
 }
});
test('settings reject PG/LIVE, malformed JWE/HMAC keys and undeclared fields',()=>{
 const v={secretKey:'test_sk_synthetic',securityKey:'a'.repeat(64),merchantId:'synthetic',webhookKeyBase64:randomBytes(32).toString('base64')};assert(validPayoutTestValues(v));
 for(const change of [{secretKey:'live_sk_synthetic'},{secretKey:'test_sk_docs_example'},{securityKey:'bad'},{webhookKeyBase64:'hex-is-not-base64'},{extra:'field'},{merchantId:'bad id'}])assert(!validPayoutTestValues({...v,...change}));
});
