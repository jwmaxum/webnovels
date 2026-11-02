import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chargingTestEnabled,topupsTestApi} from '../server/topups-test-api.mjs';
import {encryptProviderSettings} from '../server/provider-settings-crypto.mjs';

const uid=randomUUID(),other=randomUUID(),pid=randomUUID(),version=randomUUID(),oid=randomUUID(),rid=randomUUID();
const marker={mode:'TEST',provenance:'LOCAL_SIMULATED',providerMode:'LOCAL_SIMULATED'};
const env={POINTS_TEST_ENABLED:'true',POINTS_TEST_ENVIRONMENT:'TEST',POINTS_TEST_PROVENANCE:'LOCAL_SIMULATED',P0_API_ENABLED:'true',CHARGING_TEST_ENABLED:'true'};
const user={id:uid,email_confirmed_at:'2026-11-01T00:00:00Z'},reader={userId:uid,reader:{status:'ACTIVE'}},admin={userId:uid,admin:{is_active:true,role:'SUPER_ADMIN'}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const product=()=>({id:pid,versionId:version,title:'시험 충전',amountKrw:10000,points:12000,enabled:true,startsAt:'2026-11-01T00:00:00.000Z',endsAt:null,expiresMinutes:60});
const order=()=>({id:oid,checkoutId:'wn05-'+oid,userId:uid,productId:pid,productVersion:version,title:'시험 충전',method:'CARD',amountKrw:10000,points:12000,status:'CREATED',createdAt:'2026-11-02T00:00:00Z',expiresAt:'2026-11-02T01:00:00Z',credited:false,refundablePoints:0,refundAmountKrw:0,refund:null});
const page=items=>({...marker,items,offset:0,limit:50,total:items.length,hasMore:false,nextOffset:null});
const result=()=>({...marker,order:order()});
function fixture({action='products',isAdmin=false,body,query='',method,settings=env,who=isAdmin?admin:reader,session=user,response,rpcImpl,providerTransport,fetchImpl,headers={},request:custom}={}){
  const write=isAdmin||!['products','orders','order'].includes(action),verb=method??(write?'POST':'GET');
  const request=custom??new Request('https://site.test/api/v2/'+(isAdmin?'admin/':'')+'topups-test?action='+action+(query?'&'+query:''),{method:verb,headers:{origin:'https://site.test','content-type':'application/json',...headers},...(!['GET','HEAD'].includes(verb)?{body:typeof body==='string'?body:JSON.stringify(body??{})}:{})});
  const calls=[],rpc=async(name,payload)=>{calls.push({name,payload});if(rpcImpl&&payload.p_action==='order'&&action!=='order')return result();return rpcImpl?rpcImpl(name,payload):response??(isAdmin?{...marker,revision:'0',products:[]}:page([product()]));};
  return {calls,run:()=>topupsTestApi({request,user:session,actor:who,rpc,remote:()=>assert.fail('no remote call'),env:settings,fail,providerTransport,fetchImpl})};
}
async function reject(options,code,count=0){const f=fixture(options);await assert.rejects(f.run(),error=>!code||error.code===code);assert.equal(f.calls.length,count);return f;}
function claim(orderValue,data,patch={}){return {...marker,providerMode:data.providerMode,order:orderValue,transport:{orderId:oid,checkoutId:'wn05-'+oid,operationId:randomUUID(),lease:randomUUID(),operationCreatedAt:new Date().toISOString(),operation:'confirm',paymentKey:'synthetic_payment',amountKrw:10000,refundAmountKrw:7500,expectedBalanceKrw:2500,merchantId:data.merchantId,binding:data.binding,providerMode:data.providerMode,reason:'남은 포인트 환불',refundId:rid,...patch}};}
const approved=t=>({state:'APPROVED',amountKrw:t.amountKrw,merchantId:t.merchantId,paymentKey:t.paymentKey,approvedAt:'2026-11-02T00:05:00Z',transactionKey:'synthetic_approval',balanceKrw:10000});

test('all exact OP04 and charging gates are required; LIVE and FREE beta remain closed',()=>{
  assert.equal(chargingTestEnabled(env),true);assert.equal(chargingTestEnabled(),false);
  for(const k of Object.keys(env))for(const v of [undefined,true,false,'TRUE','LIVE'])assert.equal(chargingTestEnabled({...env,[k]:v}),false);
  for(const v of ['true',true])assert.equal(chargingTestEnabled({...env,FREE_BETA_ENABLED:v}),false);
  for(const provider of ['LIVE','PROVIDER_LIVE','unknown',true])assert.equal(chargingTestEnabled({...env,CHARGING_TEST_PROVIDER:provider}),false);
});
test('identity and administrative roles fail before RPC and financial access never inherits curator rights',async()=>{
  await reject({settings:{},session:null,who:null},'TOPUPS_TEST_NOT_ACTIVATED');
  for(const session of [null,{...user,is_anonymous:true},{...user,deleted_at:'2026-01-01'},{...user,banned_until:'bad'},{...user,banned_until:'2999-01-01T00:00:00Z'}])await reject({session},'INVALID_SESSION');
  await reject({session:{id:uid}},'EMAIL_CONFIRMATION_REQUIRED');await reject({who:{...reader,userId:other}},'INVALID_SESSION');await reject({who:{userId:uid,reader:{status:'BLOCKED'}}},'READER_REQUIRED');
  for(const who of [reader,{...admin,admin:{role:'ADMIN',is_active:true}},{...admin,admin:{role:'SUPER_ADMIN',is_active:false}}])await reject({isAdmin:true,action:'state',who},'ADMIN_FORBIDDEN');
});
test('strict methods, query duplicates, JSON, streamed bounds and server-only inputs reject',async()=>{
  for(const options of [{query:'offset=01'},{query:'offset=100001'},{query:'action=products'},{query:'offset=0&offset=50'},{query:'userId='+other},{action:'order',query:'orderId=bad'},{action:'unknown'},{method:'POST'}])await reject(options);
  const body={productId:pid,productVersion:version,method:'CARD',requestId:rid};
  for(const options of [{headers:{origin:'https://evil.test'}},{headers:{'content-type':'text/plain'}},{body:'{'},{body:' '.repeat(65537)},{body:{...body,merchantId:'injected'}},{body:{...body,points:999}},{body:{...body,requestId:[rid]}},{body:{...body,method:'LIVE'}}])await reject({action:'create',body,...options});
  const request=new Request('https://site.test/api/v2/topups-test?action=create',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:new Uint8Array([255])});await reject({request});
});
test('allowlisted DTOs remove provider keys, bindings, bank references and Auth IDs',async()=>{
  const f=fixture({action:'order',query:'orderId='+oid,response:{...result(),paymentKey:'PRIVATE_KEY',binding:'PRIVATE_BINDING',transport:undefined,order:{...order(),bankReference:'PRIVATE_BANK',paymentKey:'PRIVATE_KEY'}}});const value=await f.run();assert.equal(value.order.id,oid);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|userId|transport|paymentKey|binding|bankReference/);
  assert.equal(f.calls[0].payload.p_user,uid);
  await reject({action:'order',query:'orderId='+oid,response:{...result(),order:{...order(),userId:other}}},'TOPUPS_TEST_UNAVAILABLE',1);
  await reject({response:{...page([product()]),mode:'LIVE'}},'TOPUPS_TEST_UNAVAILABLE',1);
  await reject({response:{error:'PRIVATE_SECRET',status:409}},'TOPUPS_TEST_UNAVAILABLE',1);
  await reject({response:{error:'IDEMPOTENCY_CONFLICT',status:409}},'IDEMPOTENCY_CONFLICT',1);
  const financial=fixture({isAdmin:true,action:'orders',body:{status:'ALL',offset:0},response:page([{...order(),bankReference:'PRIVATE_BANK',binding:'PRIVATE_BINDING'}])});const projected=await financial.run();assert.equal(projected.items[0].userId,uid);assert.doesNotMatch(JSON.stringify(projected),/PRIVATE_|binding|bankReference/);
  await reject({isAdmin:true,action:'orders',body:{status:'ALL',offset:0},response:page([{...order(),userId:'bad'}])},'TOPUPS_TEST_UNAVAILABLE',1);
});
test('product and bank operations use strict snapshots with explicit administrator and request IDs',async()=>{
  const p={productId:null,title:'충전 상품',amountKrw:10000,points:12000,enabled:true,startsAt:'2026-11-01T00:00:00.000Z',endsAt:null,expiresMinutes:60,revision:'0',reason:'시험 상품 생성',requestId:rid};
  const f=fixture({isAdmin:true,action:'product',body:p,response:{...marker,revision:'1',products:[product()],saved:true,replayed:false}});assert.equal((await f.run()).saved,true);assert.deepEqual(f.calls[0].payload.p_data,p);assert.equal(f.calls[0].payload.p_action,'admin-product');
  for(const patch of [{amountKrw:0},{points:1.1},{revision:0},{startsAt:'2026-11-02'},{startsAt:null},{enabled:'true'},{extra:true}])await reject({isAdmin:true,action:'product',body:{...p,...patch}});
  const deposit={orderId:oid,bankReference:'synthetic-bank-transfer',amountKrw:10000,receivedAt:'2026-11-02T00:15:00.000Z',reason:'은행 입금 대조',requestId:rid};const b=fixture({isAdmin:true,action:'deposit',body:deposit,response:result()});await b.run();assert.deepEqual(b.calls[0].payload.p_data,deposit);
});
test('LOCAL_SIMULATED never manufactures card success and injection passes only normalized receipts',async()=>{
  const body={orderId:oid,paymentKey:'synthetic_payment',expectedAmountKrw:10000};
  await reject({action:'confirm',body,rpcImpl:async(n,p)=>claim(order(),p.p_data)},'PROVIDER_NOT_READY',1);
  let seen;const f=fixture({action:'confirm',body,providerTransport:async({order:t})=>{seen=t;return {...approved(t),raw:'PRIVATE_RAW'};},rpcImpl:async(n,p)=>n==='op05_apply'?{...result(),order:{...order(),credited:true,status:'PAID'}}:claim(order(),p.p_data)});
  const out=await f.run();assert.equal(out.order.status,'PAID');assert.equal(f.calls[2].name,'op05_apply');assert.equal(f.calls[2].payload.p_operation,seen.operationId);assert.equal(f.calls[2].payload.p_lease,seen.lease);assert.doesNotMatch(JSON.stringify(f.calls[2].payload),/PRIVATE_RAW/);assert.doesNotMatch(JSON.stringify(out),/synthetic_payment|binding/);
});
test('injected failures and malformed receipts finalize UNKNOWN or REVIEW without raw errors',async()=>{
  for(const [providerTransport,state]of [[async()=>{throw Error('PRIVATE_TIMEOUT');},'UNKNOWN'],[async()=>({state:'APPROVED',amountKrw:1}),'REVIEW'],[async()=>({state:'FORGED'}),'REVIEW']]){
    const f=fixture({action:'confirm',body:{orderId:oid,paymentKey:'synthetic_payment',expectedAmountKrw:10000},providerTransport,rpcImpl:async(n,p)=>n==='op05_apply'?{...result(),order:{...order(),status:'UNKNOWN'}}:claim(order(),p.p_data)});await f.run();assert.deepEqual(f.calls[2].payload.p_receipt,{state});
  }
});
test('changed binding and expired mutation never reach provider while old queries are read only',async()=>{
  for(const patch of [{binding:'wrong'},{merchantId:'wrong'},{providerMode:'PROVIDER_TEST'},{operationCreatedAt:'2020-01-01T00:00:00Z'}])await reject({action:'confirm',body:{orderId:oid,paymentKey:'synthetic_payment',expectedAmountKrw:10000},rpcImpl:async(n,p)=>claim(order(),p.p_data,patch),providerTransport:()=>assert.fail('blocked')},patch.operationCreatedAt?'OPERATION_EXPIRED':'PROVIDER_BINDING_MISMATCH',2);
  const f=fixture({action:'reconcile',body:{orderId:oid},providerTransport:async({order:t})=>approved(t),rpcImpl:async(n,p)=>n==='op05_apply'||p.p_action==='order'?result():claim(order(),p.p_data,{operation:'query',operationCreatedAt:'2020-01-01T00:00:00Z'})});await f.run();assert.equal(f.calls[2].payload.p_receipt.state,'APPROVED');
});
test('PROVIDER_TEST resolves reviewed encrypted settings and binds exact revision without exposing credentials',async()=>{
  const settings={...env,CHARGING_TEST_PROVIDER:'PROVIDER_TEST',PROVIDER_SETTINGS_SOURCE:'database',PROVIDER_SETTINGS_MASTER_KEY:'ab'.repeat(32),PROVIDER_SETTINGS_KEY_VERSION:'v1'},values={clientKey:'test_ck_synthetic_op05',secretKey:'test_sk_synthetic_op05',merchantId:'synthetic_mid'};
  const envelope=await encryptProviderSettings(values,{provider:'TOSS',mode:'TEST',env:settings});let transportValue;
  const f=fixture({action:'confirm',body:{orderId:oid,paymentKey:'synthetic_payment',expectedAmountKrw:10000},settings,fetchImpl:async(url,init)=>{assert.ok(url.startsWith('https://api.tosspayments.com/'));return Response.json({orderId:'wn05-'+oid,paymentKey:'synthetic_payment',mId:values.merchantId,currency:'KRW',type:'NORMAL',method:'카드',totalAmount:10000,balanceAmount:10000,status:'DONE',approvedAt:'2026-11-02T00:05:00Z',lastTransactionKey:'synthetic_approval',cancels:[]});},rpcImpl:async(n,p)=>{if(n==='provider_runtime_config')return {enabled:true,revision:'2',envelope};if(n==='op05_apply')return {...result(),providerMode:'PROVIDER_TEST',order:{...order(),status:'PAID',credited:true}};transportValue=claim(order(),p.p_data);return transportValue;}});
  const out=await f.run();assert.equal(out.order.status,'PAID');assert.match(transportValue.transport.binding,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(f.calls),/test_sk_synthetic_op05/);assert.doesNotMatch(JSON.stringify(out),/synthetic_mid|test_sk_|binding/);
});

test('BANK create and refund work without any card key and never call a provider',async()=>{
  const settings={...env,CHARGING_TEST_PROVIDER:'PROVIDER_TEST'},bank={...order(),method:'BANK'};
  const create=fixture({action:'create',settings,body:{productId:pid,productVersion:version,method:'BANK',requestId:rid},response:{...result(),order:bank},fetchImpl:()=>assert.fail('bank cannot call provider')});await create.run();assert.equal(create.calls.length,1);assert.equal(create.calls[0].payload.p_data.binding,undefined);
  // This test provides an explicit BANK preflight rather than the default CARD.
  const request=new Request('https://site.test/api/v2/topups-test?action=refund',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:JSON.stringify({orderId:oid,reason:'남은 충전금 환불',requestId:rid})});
  const calls=[];const value=await topupsTestApi({request,user,actor:reader,env:settings,fail,rpc:async(n,p)=>{calls.push(p);return {...result(),order:{...bank,status:p.p_action==='order'?'PAID':'REFUND_PENDING'}};},fetchImpl:()=>assert.fail('bank cannot call provider')});assert.equal(value.order.status,'REFUND_PENDING');assert.equal(calls[1].p_data.binding,undefined);
});

test('checkout freezes TEST binding through POST and returns only public checkout fields',async()=>{
  const settings={...env,CHARGING_TEST_PROVIDER:'PROVIDER_TEST',TOSS_TEST_SECRET_KEY:'test_sk_synthetic_checkout',TOSS_TEST_CLIENT_KEY:'test_ck_synthetic_checkout',TOSS_TEST_MERCHANT_ID:'synthetic_mid',CHARGING_TEST_BINDING_VERSION:'reviewed-v1'};
  const f=fixture({action:'checkout',body:{orderId:oid},settings,rpcImpl:async(n,p)=>({...result(),providerMode:'PROVIDER_TEST'})});
  const value=await f.run();assert.equal(value.checkout.orderId,'wn05-'+oid);assert.equal(value.checkout.customerKey,uid);assert.equal(value.checkout.amountKrw,10000);assert.equal(value.checkout.currency,'KRW');assert.equal(value.checkout.successUrl,'https://site.test/charging-test/return');assert.equal(value.checkout.failUrl,value.checkout.successUrl);assert.equal(value.checkout.clientKey,settings.TOSS_TEST_CLIENT_KEY);assert.match(f.calls[1].payload.p_data.binding,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(value),/secret|synthetic_mid|binding|paymentKey/);
  for(const [title,name]of [['가'.repeat(150),'가'.repeat(100)],['가'.repeat(99)+'😀'+'나'.repeat(20),'가'.repeat(99)]]){
    const longer=fixture({action:'checkout',body:{orderId:oid},settings,rpcImpl:async()=>({...result(),providerMode:'PROVIDER_TEST',order:{...order(),title}})}),checkout=(await longer.run()).checkout;
    assert.equal(checkout.orderName,name);assert(checkout.orderName.length<=100);assert.equal(checkout.amountKrw,10000);assert.equal(checkout.orderId,'wn05-'+oid);
  }
  for(const patch of [{CHARGING_TEST_PROVIDER:'LOCAL_SIMULATED'},{TOSS_TEST_CLIENT_KEY:undefined},{TOSS_TEST_CLIENT_KEY:'live_ck_synthetic'},{TOSS_TEST_CLIENT_KEY:'test_ck_docs_synthetic'}])await reject({action:'checkout',body:{orderId:oid},settings:{...settings,...patch},rpcImpl:async()=>result()},'PROVIDER_NOT_READY',1);
  await reject({action:'checkout',method:'GET',query:'orderId='+oid,settings},'METHOD_NOT_ALLOWED');
});

test('confirm requires the returned amount to match the immutable owned order before claim',async()=>{
  const body={orderId:oid,paymentKey:'synthetic_payment',expectedAmountKrw:9999};await reject({action:'confirm',body,rpcImpl:async()=>result()},'PRICE_CHANGED',1);
  await reject({action:'confirm',body:{orderId:oid,paymentKey:'synthetic_payment'},rpcImpl:async()=>result()},'INVALID_PAYMENT_REFERENCE');
});

test('real synthetic SQL bridge: approval replay, FIFO use, UNKNOWN refund, DONE query hold and stable cancel retry',async()=>{
  const {setup,reader:readerId,admin:adminId}=await import('./fixtures/op05-db.mjs');const f=await setup();
  try{
    const rpc=async(name,p)=>{
      if(name==='op05_topups')return (await f.db.query('select public.op05_topups($1,$2,$3) value',[p.p_user,p.p_action,JSON.stringify(p.p_data)])).rows[0].value;
      assert.equal(name,'op05_apply');return (await f.db.query('select public.op05_apply($1,$2,$3,$4) value',[p.p_order,p.p_operation,p.p_lease,JSON.stringify(p.p_receipt)])).rows[0].value;
    };
    let original,cancelAttempts=0;const cancelOperations=[];
    const providerTransport=async({operation,order:t})=>{
      if(operation==='confirm'){original={state:'APPROVED',amountKrw:t.amountKrw,merchantId:t.merchantId,paymentKey:t.paymentKey,approvedAt:new Date().toISOString(),transactionKey:'approval-'+randomUUID(),balanceKrw:t.amountKrw};return original;}
      if(operation==='query')return original;
      cancelOperations.push(t.operationId);if(cancelAttempts++===0)throw Error('synthetic lost cancellation response');
      return {...original,state:'CANCELLED',transactionKey:'cancel-'+randomUUID(),cancelledAt:new Date().toISOString(),cancelAmountKrw:t.refundAmountKrw,balanceKrw:t.expectedBalanceKrw};
    };
    const api=async(action,data={},isAdmin=false,settings=env)=>{
      const id=isAdmin?adminId:readerId,verb=!isAdmin&&['products','orders','order'].includes(action)?'GET':'POST';const params=new URLSearchParams({action,...(verb==='GET'?data:{})});
      const request=new Request('https://site.test/api/v2/'+(isAdmin?'admin/':'')+'topups-test?'+params,{method:verb,headers:{origin:'https://site.test','content-type':'application/json'},...(verb==='POST'?{body:JSON.stringify(data)}:{})});
      return topupsTestApi({request,user:{id,email_confirmed_at:'2026-11-01T00:00:00Z'},actor:{userId:id,...(isAdmin?{admin:{role:'SUPER_ADMIN',is_active:true}}:{reader:{status:'ACTIVE'}})},env:settings,fail,rpc,providerTransport,fetchImpl:()=>assert.fail('synthetic bridge cannot call network')});
    };
    const p=await f.makeProduct({amountKrw:700,points:1000});const created=await api('create',{productId:p.id,productVersion:p.versionId,method:'CARD',requestId:randomUUID()});
    const confirm={orderId:created.order.id,paymentKey:'pay-'+randomUUID(),expectedAmountKrw:700};assert.equal((await api('confirm',confirm)).order.status,'PAID');assert.equal((await api('confirm',confirm)).order.status,'PAID');assert.equal((await f.wallet()).totalPoints,1000);
    const q=await f.quote(f.novel.episodes[2].id);await f.purchase(q.quote.id);assert.equal((await f.wallet()).balancePoints,900);
    const refund=await api('refund',{orderId:created.order.id,reason:'잔여 포인트 환불 TEST',requestId:randomUUID()});assert.equal(refund.order.status,'REFUND_UNKNOWN');assert.equal(refund.order.refund.amountKrw,630);assert.equal((await f.wallet()).reservedPoints,900);
    const queried=await api('retry-refund',{orderId:created.order.id});assert.equal(queried.order.status,'REFUND_UNKNOWN');assert.equal((await f.wallet()).balancePoints,0);assert.equal((await f.wallet()).reservedPoints,900);
    const done=await api('retry-refund',{orderId:created.order.id});assert.equal(done.order.status,'REFUNDED');assert.equal(new Set(cancelOperations).size,1);assert.equal(cancelOperations.length,2);assert.equal((await f.wallet()).totalPoints,0);assert.equal((await f.wallet()).reservedPoints,0);
    assert.equal((await f.db.query("select count(*)::int n from commerce.op04_ledger where kind='TOPUP'")).rows[0].n,1);assert.equal((await f.db.query("select count(*)::int n from commerce.op04_ledger where kind='REFUND'")).rows[0].n,1);
    const pgEnv={...env,CHARGING_TEST_PROVIDER:'PROVIDER_TEST',TOSS_TEST_CLIENT_KEY:'test_ck_synthetic_checkout',TOSS_TEST_SECRET_KEY:'test_sk_synthetic_checkout',TOSS_TEST_MERCHANT_ID:'synthetic_mid',CHARGING_TEST_BINDING_VERSION:'reviewed-v1'};
    const second=await api('create',{productId:p.id,productVersion:p.versionId,method:'CARD',requestId:randomUUID()});const checkout=await api('checkout',{orderId:second.order.id},false,pgEnv);assert.equal(checkout.checkout.amountKrw,700);assert.deepEqual(await api('checkout',{orderId:second.order.id},false,pgEnv),checkout);
    await assert.rejects(api('checkout',{orderId:second.order.id},false,{...pgEnv,TOSS_TEST_SECRET_KEY:'test_sk_synthetic_rotated'}),{code:'PROVIDER_BINDING_CONFLICT'});
  }finally{await f.db.close();}
});
