import test from 'node:test';
import assert from 'node:assert/strict';
import {authorEnrollmentApi} from '../server/author-enrollment-api.mjs';
import {createSecureApi} from '../server/secure-api.mjs';
import {verifyPortOneAuthor} from '../server/providers/portone-identity.mjs';
import {enrollmentDocuments} from '../server/author-enrollment-policy.mjs';
import {setup,users,consent} from './fixtures/stage34-db.mjs';
import scheduler from '../scheduler/worker.mjs';
const env={AUTHOR_IDENTITY_ENABLED:'true',AUTH_ONBOARDING_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',
 SUPABASE_SECRET_KEY:'sb_secret_fixture',PORTONE_STORE_ID:'store-fixture',AUTHOR_IDENTITY_CHANNEL_KEY:'channel-fixture',
 AUTHOR_IDENTITY_MODE:'LIVE',AUTHOR_IDENTITY_PG_PROVIDER:'DANAL',AUTHOR_IDENTITY_IDENTIFIER_TYPE:'CI',
 AUTHOR_IDENTITY_KEY_VERSION:'v1',AUTHOR_IDENTITY_HMAC_KEY:'12'.repeat(32),PORTONE_API_SECRET:'fixture-only'};
const origin='https://app.test';
const request=(action,data,headers={})=>new Request(origin+'/api/v2/onboarding/author/'+action,{method:data===undefined?'GET':'POST',
 headers:{Authorization:'Bearer fixture.jwt.value',Origin:origin,'Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
test('closed enrollment exposes draft policy only, never contacts DB/provider or accepts legacy author completion',async()=>{
 const fetchImpl=async()=>assert.fail('No upstream calls while disabled');
 const policy=await authorEnrollmentApi(request('policy'),{},{fetchImpl});
 assert.equal((await policy.json()).enabled,false);
 assert.equal((await authorEnrollmentApi(request('start',{}),{},{fetchImpl})).status,503);
 assert.equal((await authorEnrollmentApi(request('unknown'),{},{fetchImpl})).status,404);
 assert.equal((await authorEnrollmentApi(request('start'),{},{fetchImpl})).status,405);
 assert.equal((await authorEnrollmentApi(request('start',{}, {Origin:'https://evil.test'}),{},{fetchImpl})).status,403);
 assert.equal(await authorEnrollmentApi(new Request(origin+'/api/v2/me'),{},{fetchImpl}),null);
});

test('actual SQL through mocked HTTP: consent, verified proof, replay, same-person accounts, redaction and recovery',async()=>{
 const db=await setup();let user=users[0],providerCalls=0,providerFault=null,authFault=null;
 const calls=[];
 const fetchImpl=async(input,options)=>{
  const url=new URL(input);calls.push(url.pathname);
  if(url.hostname==='api.portone.io'){
   providerCalls++;assert.equal(options.redirect,'manual');assert.equal(url.searchParams.get('storeId'),'store-fixture');
   if(providerFault==='network')throw Error('private upstream payload');
   const id=url.pathname.split('/').pop();
   return Response.json({id,status:'VERIFIED',verifiedAt:new Date().toISOString(),channel:{key:'channel-fixture',type:providerFault==='test'?'TEST':'LIVE',pgProvider:'DANAL'},
    verifiedCustomer:{name:'동일한 이름',ci:providerFault==='missing'?undefined:'stable-person-private-identifier',phoneNumber:'private-phone'}});
  }
  if(url.pathname==='/auth/v1/user')return Response.json({id:user,email:'fixture@example.test',email_confirmed_at:'2026-10-21',...authFault});
  const name=url.pathname.split('/').pop(),data=JSON.parse(options.body||'{}');
  if(name==='author_enrollment_config'||name==='author_enrollment_launch_ready')return Response.json((await db.query('select public.'+name+'() r')).rows[0].r);
  if(name==='consume_authoring_signup_attempt')return Response.json(true);
  if(name==='author_enrollment')return Response.json((await db.query('select public.author_enrollment($1,$2,$3) r',[data.p_user,data.p_action,data.p_data])).rows[0].r);
  throw Error('Unexpected route');
 };
 const api=createSecureApi({fetchImpl});
 const call=async(action,data,bindings=env,headers={})=>{
  const response=await api(request(action,data,headers),bindings);return {status:response.status,body:await response.json()};
 };
 try{
  assert.equal((await call('policy')).body.enabled,true);
  assert.equal((await api(new Request(origin+'/api/v2/auth/readiness?kind=author'),env)).status,200);
  assert.equal((await call('status')).body.completed,false);
  for(const change of [{SUPABASE_SECRET_KEY:'invalid'},{AUTHOR_IDENTITY_CHANNEL_KEY:'other'},{AUTHOR_IDENTITY_HMAC_KEY:'short'}])
   assert.equal((await call('start',{}, {...env,...change})).status,503);
  assert.equal((await call('start',{},env,{Authorization:''})).status,401);
  authFault={email_confirmed_at:null};assert.equal((await call('start',{})).status,403);authFault=null;
  const fields=await consent(db);
  assert.equal((await call('start',{...fields,rightsAccepted:false})).status,400);
  assert.equal((await call('start',{...fields,documentHash:'0'.repeat(64)})).status,409);
  assert.equal((await call('start',{...fields,authorId:'1'})).status,400);
  assert.equal((await call('start',{...fields,padding:'x'.repeat(9000)})).status,413);
  const first=await call('start',fields);assert.equal(first.status,200);
  const attemptId=first.body.attempt.id;
  assert.equal(first.body.request.redirectUrl,origin+'/?auth=author-identity');
  assert.equal((await call('start',fields)).body.attempt.id,attemptId);
  assert.equal((await call('complete',{attemptId,displayName:'필명가'})).status,403);
  user=users[1];assert.equal((await call('verify',{attemptId})).status,404);assert.equal(providerCalls,0);user=users[0];
  for(const fault of ['test','missing','network']){providerFault=fault;const r=await call('verify',{attemptId});assert.equal(r.status,fault==='network'?503:409);assert.doesNotMatch(JSON.stringify(r),/private|stable-person/);}
  providerFault=null;
  assert.equal((await call('verify',{attemptId,fingerprint:'a'.repeat(64)})).status,400);
  const verified=await call('verify',{attemptId});assert.equal(verified.body.attempt.status,'VERIFIED');
  assert.doesNotMatch(JSON.stringify(verified),/fingerprint|auth_user_id|동일한 이름|private-phone|stable-person/);
  const beforeCalls=providerCalls;
  assert.equal((await call('verify',{attemptId})).status,200);assert.equal(providerCalls,beforeCalls);
  for(let i=0;i<2;i++)assert.equal((await call('complete',{attemptId,displayName:i?'재시도다른필명':'필명가'})).body.completed,true);
  assert.equal((await call('status')).body.completed,true);
  user=users[1];const second=(await call('start',await consent(db))).body.attempt.id;
  await call('verify',{attemptId:second});assert.equal((await call('complete',{attemptId:second,displayName:'필명나'})).body.completed,true);
  assert.equal((await db.query('select count(*)::int n from authoring.verified_author_persons')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from authoring.author_identity_accounts')).rows[0].n,2);
  assert.ok(!calls.some(p=>/p0_migration_status|adult-verification/.test(p)));
 }finally{await db.close();}
});

function proof(){const now=Date.parse('2026-10-21T00:05:00Z');return {
 actorId:users[0],storeId:'store',channelKey:'channel',mode:'LIVE',pgProvider:'INICIS_UNIFIED',identifierType:'CI',hmacKey:'12'.repeat(32),keyVersion:'v1',apiSecret:'fixture',now,
 attempt:{id:'ae_'+'1'.repeat(32),auth_user_id:users[0],status:'PENDING',purpose:'AUTHOR_ENROLLMENT',store_id:'store',channel_key:'channel',mode:'LIVE',pg_provider:'INICIS_UNIFIED',identifier_type:'CI',key_version:'v1',created_at:'2026-10-21T00:00:00Z',expires_at:'2026-10-21T00:10:00Z'}};}
function receipt(){return {status:'VERIFIED',id:proof().attempt.id,channel:{key:'channel',type:'LIVE',pgProvider:'INICIS_UNIFIED'},verifiedCustomer:{name:'동명이인',ci:'fixture-ci-person-a'},verifiedAt:'2026-10-21T00:04:00Z'};}
test('author adapter requires names and contracted stable identifiers; name equality never merges people',async()=>{
 const a=await verifyPortOneAuthor(proof(),async()=>Response.json(receipt()));
 const b=await verifyPortOneAuthor(proof(),async()=>Response.json({...receipt(),verifiedCustomer:{name:'동명이인',ci:'fixture-ci-person-b'}}));
 assert.notEqual(a.fingerprint,b.fingerprint);
 assert.deepEqual(Object.keys(a),['fingerprint','verifiedAt']);
 for(const mutate of [p=>{p.actorId=users[1];},p=>{p.attempt.purpose='ADULT';},p=>{p.hmacKey='short';},p=>{p.identifierType='DI';},p=>{p.attempt.expires_at='2026-10-21T00:01:00Z';}]){
  const p=proof();mutate(p);await assert.rejects(verifyPortOneAuthor(p,async()=>assert.fail('invalid proof must not call provider')));
 }
 for(const mutate of [r=>{r.verifiedCustomer.name='';},r=>{delete r.verifiedCustomer.ci;},r=>{r.channel.pgProvider='DANAL';},r=>{r.channel.key='other';},r=>{r.channel.type='TEST';},r=>{r.id='other';},r=>{r.status='FAILED';},r=>{r.verifiedAt='2026-10-20T00:00:00Z';}]){
  const r=receipt();mutate(r);await assert.rejects(verifyPortOneAuthor(proof(),async()=>Response.json(r)));
 }
 await assert.rejects(verifyPortOneAuthor(proof(),async()=>new Response('',{status:302,headers:{location:'https://other.test'}})));
 await assert.rejects(verifyPortOneAuthor(proof(),async()=>new Response('not json')));
});

test('identity cleanup can run without publication, has empty payload and exposes no HTTP control',async()=>{
 const previous=globalThis.fetch,calls=[];
 try{globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:JSON.parse(options.body)});return Response.json(0);};
  await scheduler.scheduled({}, {...env,SUPABASE_SECRET_KEY:'sb_secret_fixture'}, {waitUntil:()=>{}});
  assert.deepEqual(calls,[{path:'/rest/v1/rpc/cleanup_author_enrollment',body:{}}]);
  assert.equal((await scheduler.fetch()).status,404);
 }finally{globalThis.fetch=previous;}
});
