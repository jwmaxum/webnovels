import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,limited,reader} from './fixtures/stage17-db.mjs';
import {providerSettingsApi,resolveStoredProviderSettings} from '../server/provider-settings-api.mjs';
import {encryptProviderSettings,decryptProviderSettings} from '../server/provider-settings-crypto.mjs';
import {paidEpisodeApi} from '../server/paid-episode-api.mjs';
import {authorEnrollmentApi} from '../server/author-enrollment-api.mjs';
import {setup as paymentSetup,merchant} from './fixtures/stage20-db.mjs';
import {setup as identitySetup,users,consent} from './fixtures/stage34-db.mjs';
const env={PROVIDER_SETTINGS_MASTER_KEY:'ab'.repeat(32),PROVIDER_SETTINGS_KEY_VERSION:'v1'};
const values={clientKey:'test_ck_synthetic_key',secretKey:'test_sk_synthetic_secret',merchantId:'synthetic_mid'};
const sql=await readFile(new URL('../database/authoring/025_provider_settings.sql',import.meta.url),'utf8');
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};

test('provider envelope uses authenticated encryption bound to provider, mode and key version',async()=>{
 const args={provider:'TOSS',mode:'TEST',env};const a=await encryptProviderSettings(values,args),b=await encryptProviderSettings(values,args);
 assert.notEqual(a.iv,b.iv);assert.equal(JSON.stringify(a).includes(values.secretKey),false);
 assert.deepEqual(await decryptProviderSettings(a,args),values);
 for(const patch of [{mode:'LIVE'},{provider:'PASS'},{env:{...env,PROVIDER_SETTINGS_MASTER_KEY:'cd'.repeat(32)}},{env:{...env,PROVIDER_SETTINGS_KEY_VERSION:'v2'}}])
  await assert.rejects(decryptProviderSettings(a,{...args,...patch}),/PROVIDER_KEY_UNAVAILABLE/);
 await assert.rejects(decryptProviderSettings({...a,ciphertext:a.ciphertext.slice(0,-4)+'aaaa'},args),/PROVIDER_KEY_UNAVAILABLE/);
});

test('provider API stores only encrypted credentials, reauthenticates, rejects misuse and never activates',async()=>{
 const {db}=await setup();
 try{
  await db.exec(sql);await db.exec(sql);
  const rpc=async(name,p)=>{
   const r=name==='manage_provider_settings'?(await db.query('select public.manage_provider_settings($1,$2,$3) value',[p.p_user,p.p_action,p.p_data])).rows[0].value:
    (await db.query('select public.provider_runtime_config($1,$2) value',[p.p_provider,p.p_mode])).rows[0].value;
   if(r?.error)fail(r.status,r.error);return r;
  };
  let logins=0,logouts=0,proofId=admin;
  const remote=async(path,options)=>{
   if(path.startsWith('/auth/v1/token')){logins++;assert.equal(JSON.parse(options.body).email,'admin@example.test');return Response.json({access_token:'synthetic-session',user:{id:proofId}});}
   assert.equal(path,'/auth/v1/logout?scope=local');logouts++;return new Response(null,{status:204});
  };
  const context={user:{id:admin,email:'admin@example.test'},actor:{admin:{is_active:true,role:'SUPER_ADMIN'}},env,rpc,remote,fail};
  const call=(body,patch={},headers={})=>providerSettingsApi({...context,...patch,request:new Request('https://site.test/api/v2/admin/providers',{
   method:body?'POST':'GET',headers:{Origin:'https://site.test','Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})})});
  const body={provider:'TOSS',mode:'TEST',revision:'0',action:'save',values,password:'synthetic-password'};
  const list=await call();assert.equal(list.keyReady,true);assert.equal(list.activationAvailable,false);assert.equal(list.items.length,4);
  assert.equal((await call(undefined,{env:{}})).keyReady,false);
  for(const [method,contentType,raw,code] of [['PUT','application/json','{}','METHOD_NOT_ALLOWED'],
   ['POST','text/plain','{}','JSON_REQUIRED'],['POST','application/json','[','INVALID_PROVIDER_SETTINGS'],
   ['POST','application/json',JSON.stringify({...body,values:{secretKey:'a'.repeat(17000)}}),'BODY_TOO_LARGE']]){
   await assert.rejects(providerSettingsApi({...context,request:new Request('https://site.test/api/v2/admin/providers',{
    method,headers:{Origin:'https://site.test','Content-Type':contentType},body:raw})}),e=>e.code===code);
  }
  await assert.rejects(call(body,{actor:{admin:{role:'SUB_ADMIN',is_active:true}}}),e=>e.code==='ADMIN_FORBIDDEN');
  await assert.rejects(call(body,{}, {Origin:'https://evil.test'}),e=>e.code==='ORIGIN_REQUIRED');
  await assert.rejects(call(body,{env:{}}),e=>e.code==='PROVIDER_KEY_REQUIRED');
  await assert.rejects(call({...body,values:{...values,secretKey:'live_sk_wrong_environment'}}),e=>e.code==='INVALID_PROVIDER_SETTINGS');
  await assert.rejects(call({...body,values:{...values,enabled:'true'}}),e=>e.code==='INVALID_PROVIDER_SETTINGS');
  assert.equal(logins,0);
  proofId=reader;await assert.rejects(call(body),e=>e.code==='ADMIN_REAUTH_FAILED');proofId=admin;
  const saved=await call(body);assert.equal(saved.saved,true);assert.equal(saved.complete,true);assert.equal(saved.enabled,false);assert.equal(saved.revision,'1');
  assert.equal(logins,2);assert.equal(logouts,2);
  assert.equal(JSON.stringify(saved).includes(values.secretKey),false);
  const row=(await db.query("select * from authoring.provider_settings where provider='TOSS' and mode='TEST'")).rows[0];
  assert.equal(JSON.stringify(row).includes(values.secretKey),false);assert.deepEqual(await decryptProviderSettings(row.envelope,{provider:'TOSS',mode:'TEST',env}),values);
  const after=await call();assert.equal(JSON.stringify(after).includes('ciphertext'),false);assert.equal(JSON.stringify(after).includes(values.clientKey),false);
  await assert.rejects(call(body),e=>e.code==='CONFLICT');
  const rotated=await call({...body,revision:'1',values:{secretKey:'test_sk_rotated_secret'}});assert.equal(rotated.revision,'2');
  const rotatedRow=(await db.query("select envelope from authoring.provider_settings where provider='TOSS' and mode='TEST'")).rows[0];
  assert.deepEqual(await decryptProviderSettings(rotatedRow.envelope,{provider:'TOSS',mode:'TEST',env}),{...values,secretKey:'test_sk_rotated_secret'});
  const runtime={provider:'TOSS',mode:'TEST',env:{...env,PROVIDER_SETTINGS_SOURCE:'database'},rpc};
  await assert.rejects(resolveStoredProviderSettings(runtime),/PROVIDER_NOT_ACTIVATED/);
  await db.exec("update authoring.provider_settings set enabled=true,review_ref='synthetic acceptance only',reviewed_revision=revision where provider='TOSS' and mode='TEST'");
  assert.equal((await resolveStoredProviderSettings(runtime)).secretKey,'test_sk_rotated_secret');
  const cleared=await call({provider:'TOSS',mode:'TEST',revision:'2',action:'clear',password:'synthetic-password'});
  assert.equal(cleared.enabled,false);assert.equal(cleared.complete,false);assert.deepEqual(cleared.configuredFields,[]);
  await assert.rejects(resolveStoredProviderSettings(runtime),/PROVIDER_NOT_ACTIVATED/);
  await assert.rejects(call({...body,revision:'3'}),e=>e.code==='RATE_LIMITED');
  const audit=(await db.query('select * from authoring.provider_settings_audit')).rows;
  assert.equal(audit.length,3);assert.equal(JSON.stringify(audit).includes('secret'),false);
 }finally{await db.close();}
});

test('private settings require explicit service RPC grants and verified active super-admin',async()=>{
 const {db}=await setup();try{
  await db.exec(sql);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   await assert.rejects(db.query('select * from authoring.provider_settings'),/permission denied/);
   if(role!=='service_role')await assert.rejects(db.query('select public.manage_provider_settings($1,$2,$3)',[admin,'list',{}]),/permission denied/);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await db.query('select public.manage_provider_settings($1,$2,$3) value',[admin,'list',{}])).rows[0].value.items.length,4);
  for(const user of [limited,reader])assert.equal((await db.query('select public.manage_provider_settings($1,$2,$3) value',[user,'list',{}])).rows[0].value.error,'ADMIN_FORBIDDEN');
  assert.deepEqual((await db.query("select public.provider_runtime_config('PASS','LIVE') value")).rows[0].value,{enabled:false});
  await db.exec('reset role');await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);
  assert.equal((await db.query('select public.manage_provider_settings($1,$2,$3) value',[admin,'list',{}])).rows[0].value.error,'ADMIN_FORBIDDEN');
 }finally{await db.close();}
});

test('reviewed encrypted TEST settings feed the existing Toss adapter, while free beta blocks every provider call',async()=>{
 const f=await paymentSetup(),db=f.db;
 try{
  await db.exec(sql);const envelope=await encryptProviderSettings({...values,merchantId:merchant},{provider:'TOSS',mode:'TEST',env});
  await db.query("update authoring.provider_settings set envelope=$1,configured_fields='[\"clientKey\",\"secretKey\",\"merchantId\"]',complete=true,enabled=true,reviewed_revision=revision,review_ref='synthetic test only' where provider='TOSS' and mode='TEST'",[envelope]);
  const offer=await f.offer(),created=await f.create(offer.episode);
  const bindings={...env,PROVIDER_SETTINGS_SOURCE:'database',P0_API_ENABLED:'true',MONETIZATION_SANDBOX_ENABLED:'true',MONETIZATION_ENVIRONMENT:'TEST',MONETIZATION_EVIDENCE_SOURCE:'LOCAL_SIMULATED'};
  let providerCalls=0,runtimeCalls=0;
  const apiArgs={env:bindings,request:new Request('https://site.test/api/v2/payments/confirm',{method:'POST',headers:{Origin:'https://site.test'}}),
   actor:async()=>({userId:reader,reader:{status:'ACTIVE'}}),readBody:async()=>({orderId:created.order.id,paymentKey:'synthetic_payment'}),fail,
   db:async(route,query,options)=>{
    const b=options.body;
    if(route==='rpc/provider_runtime_config'){runtimeCalls++;return (await db.query('select public.provider_runtime_config($1,$2) value',[b.p_provider,b.p_mode])).rows[0].value;}
    if(route==='rpc/stage20_payments')return f.call(b.p_action,b.p_data,b.p_user);
    if(route==='rpc/stage20_apply_payment')return f.apply({id:b.p_order,lease:b.p_lease},b.p_receipt);
    assert.fail('Unexpected DB call');
   },fetchImpl:async(url,options)=>{
    providerCalls++;assert.equal(url,'https://api.tosspayments.com/v1/payments/confirm');assert.equal(options.headers.Authorization,'Basic '+btoa(values.secretKey+':'));
    const b=JSON.parse(options.body);return Response.json({orderId:b.orderId,paymentKey:b.paymentKey,mId:merchant,currency:'KRW',totalAmount:b.amount,
     balanceAmount:b.amount,type:'NORMAL',method:'카드',status:'DONE',approvedAt:new Date().toISOString(),lastTransactionKey:'synthetic_txn'});
   }};
  const paid=await paidEpisodeApi(apiArgs);assert.equal(paid.order.status,'PAID');assert.equal(providerCalls,1);assert.equal(runtimeCalls,1);
  await assert.rejects(paidEpisodeApi({...apiArgs,env:{...bindings,FREE_BETA_ENABLED:'true'}}),e=>e.code==='PROVIDER_AND_LEDGER_NOT_READY');
  assert.equal(providerCalls,1);assert.equal(runtimeCalls,1);
 }finally{await db.close();}
});

test('reviewed encrypted PASS settings feed the existing verification adapter without exposing secrets',async()=>{
 const db=await identitySetup();
 try{
  await db.exec(sql);
  const passValues={storeId:'store-fixture',channelKey:'channel-key-fixture',apiSecret:'synthetic-identity-secret',
   pgProvider:'DANAL',identifierType:'CI',hmacKey:'12'.repeat(32),keyVersion:'v1'};
  const envelope=await encryptProviderSettings(passValues,{provider:'PASS',mode:'LIVE',env});
  await db.query("update authoring.provider_settings set envelope=$1,complete=true,enabled=true,reviewed_revision=revision,review_ref='synthetic test only' where provider='PASS' and mode='LIVE'",[envelope]);
  await db.exec("update authoring.enrollment_settings set channel_key='channel-key-fixture'");
  let calls=0;
  const fetchImpl=async(input,options)=>{
   const url=new URL(input);
   if(url.hostname==='api.portone.io'){
    calls++;assert.equal(options.headers.Authorization,'PortOne '+passValues.apiSecret);
    return Response.json({id:url.pathname.split('/').pop(),status:'VERIFIED',channel:{key:passValues.channelKey,type:'LIVE',pgProvider:'DANAL'},
     verifiedAt:new Date().toISOString(),verifiedCustomer:{name:'합성 인증자',ci:'synthetic-ci-only'}});
   }
   if(url.pathname==='/auth/v1/user')return Response.json({id:users[0],email:'author@example.test',email_confirmed_at:'2026-10-21'});
   const name=url.pathname.split('/').pop(),b=JSON.parse(options.body||'{}');
   if(name==='provider_runtime_config')return Response.json((await db.query('select public.provider_runtime_config($1,$2) value',[b.p_provider,b.p_mode])).rows[0].value);
   if(['author_enrollment_config','author_enrollment_launch_ready'].includes(name))return Response.json((await db.query('select public.'+name+'() value')).rows[0].value);
   if(name==='consume_authoring_signup_attempt')return Response.json(true);
   if(name==='author_enrollment')return Response.json((await db.query('select public.author_enrollment($1,$2,$3) value',[b.p_user,b.p_action,b.p_data])).rows[0].value);
   assert.fail('Unexpected identity DB call');
  };
  const bindings={...env,PROVIDER_SETTINGS_SOURCE:'database',AUTHOR_IDENTITY_ENABLED:'true',AUTH_ONBOARDING_ENABLED:'true',AUTHOR_IDENTITY_MODE:'LIVE',
   SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
  const request=(action,data)=>new Request('https://site.test/api/v2/onboarding/author/'+action,{method:'POST',
   headers:{Authorization:'Bearer fixture.jwt.value',Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify(data)});
  const start=await authorEnrollmentApi(request('start',await consent(db)),bindings,{fetchImpl});assert.equal(start.status,200);
  const attemptId=(await start.json()).attempt.id;
  const proof=await authorEnrollmentApi(request('verify',{attemptId}),bindings,{fetchImpl});assert.equal(proof.status,200);assert.equal(calls,1);
  const result=await proof.json();assert.equal(result.attempt.status,'VERIFIED');assert.doesNotMatch(JSON.stringify(result),/synthetic-identity-secret|synthetic-ci-only|合成|합성 인증자/);
  const closed=await authorEnrollmentApi(request('verify',{attemptId}),{...bindings,FREE_BETA_ENABLED:'true'},{fetchImpl:async()=>assert.fail('Beta cannot read/call PASS')});
  assert.equal(closed.status,503);
 }finally{await db.close();}
});
