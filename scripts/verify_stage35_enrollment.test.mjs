import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {setup as stage34,users,read} from './fixtures/stage34-db.mjs';
import {enrollmentDocuments} from '../server/author-enrollment-policy.mjs';
import {freeBetaEnrollmentApi} from '../server/free-beta-enrollment-api.mjs';
const files=['database/authoring/024_free_beta_enrollment.sql','database/launch/015_free_beta_accounts.sql'];
async function setup(){const db=await stage34();try{for(const f of files)await db.exec(await read(f));
 await db.exec('update authoring.enrollment_settings set enabled=false; update authoring.free_beta_settings set enabled=true');return db;
 }catch(e){await db.close();throw e;}}
const rpc=async(db,user,action,data={})=>(await db.query('select free_beta_enrollment($1,$2,$3) r',[user,action,data])).rows[0].r;
async function consent(extra={}){const d=(await enrollmentDocuments())[0];return {kind:'author',displayName:'무료작가',rightsBasis:'OWN',rightsAccepted:true,documentVersion:d.version,documentHash:d.hash,...extra};}
test('beta consent creates independent profiles with no PASS proofs, preserves names on retry and links first publication',async()=>{
 const db=await setup();try{
  for(const f of files)await db.exec(await read(f));
  for(let i=0;i<2;i++){
   const input=await consent({displayName:'별도필명'+i});
   assert.equal((await rpc(db,users[i],'complete',input)).completed,true);
   assert.equal((await rpc(db,users[i],'complete',{...input,displayName:'이름덮기금지'})).created,false);
   const actor=(await db.query('select launch_account_actor($1) a',[users[i]])).rows[0].a;
   assert.equal(actor.author.pen_name,input.displayName);assert.equal(actor.author.identity_verified,false);assert.equal(actor.admin,null);
  }
  assert.equal((await rpc(db,users[2],'complete',{kind:'reader',displayName:'새독자'})).created,true);
  const reader=(await db.query('select launch_account_actor($1) a',[users[2]])).rows[0].a;
  assert.equal(reader.reader.nickname,'새독자');assert.equal(reader.author,null);assert.equal(reader.admin,null);
  for(const table of ['author_identity_attempts','verified_author_persons','author_identity_accounts','author_rights_consents'])
   assert.equal((await db.query('select count(*)::int n from authoring.'+table)).rows[0].n,0);
  const work=(await db.query('select creator_works($1,$2,$3,$4,$5) r',[users[0],'create',null,{title:'무료 베타 작품'},crypto.randomUUID()])).rows[0].r.work;
  assert.ok(work);assert.ok((await db.query('select creator_works($1,$2,$3) r',[users[1],'get',work.id])).rows[0].r.error);
  await db.query('select creator_works($1,$2,$3,$4)',[users[0],'update',work.id,{version:work.version,description:'소개',genre:['판타지'],rating:'ALL',ai_usage_type:'NONE'}]);
  const draft=crypto.randomUUID(),key=crypto.randomUUID();
  await db.query('select creator_drafts($1,$2,$3,$4,$5,$6)',[users[0],'save',work.id,draft,{expectedRevision:'0',title:'무료 첫 회차',content:'본인이 창작한 원고입니다.',authorComment:''},crypto.randomUUID()]);
  const pub=(await db.query('select creator_publications($1,$2,$3,$4,$5,$6,$7) r',[users[0],'publish',work.id,draft,null,{revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true},key])).rows[0].r;
  assert.ok(pub.publication,JSON.stringify(pub));
  assert.equal((await db.query('select auth_user_id from authoring.free_beta_publication_consents where work_id=$1 and request_key=$2',[work.id,key])).rows[0].auth_user_id,users[0]);
  await assert.rejects(db.exec('update authoring.free_beta_accounts set enrolled_at=now()'),/immutable/i);
 }finally{await db.close();}
});
test('actual role grants, consent validation, banned/unconfirmed users, rollback and disabled configuration fail closed',async()=>{
 const db=await setup();try{
  for(const change of [{rightsAccepted:false},{rightsAccepted:'true'},{rightsBasis:'OTHER'}])assert.equal((await rpc(db,users[0],'complete',await consent(change))).error,'AUTHOR_CONSENT_REQUIRED');
  assert.equal((await rpc(db,users[0],'complete',await consent({documentVersion:'stale'}))).error,'AUTHOR_CONSENT_STALE');
  assert.equal((await rpc(db,users[0],'complete',await consent({personId:'fake'}))).error,'FIELD_NOT_ALLOWED');
  assert.equal((await rpc(db,users[0],'complete',await consent({displayName:'<x>'}))).error,'INVALID_SIGNUP');
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[users[0]]);
  assert.equal((await rpc(db,users[0],'complete',await consent())).error,'INVALID_SESSION');
  await db.query("update auth.users set email_confirmed_at=now(),banned_until=now()+interval '1 day' where id=$1",[users[0]]);
  assert.equal((await rpc(db,users[0],'complete',await consent())).error,'INVALID_SESSION');
  await db.query('update auth.users set banned_until=null where id=$1',[users[0]]);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   for(const table of ['free_beta_settings','free_beta_accounts','free_beta_publication_consents'])await assert.rejects(db.query('select * from authoring.'+table),e=>e.code==='42501');
   if(role==='service_role')assert.equal((await rpc(db,users[0],'complete',await consent())).completed,true);
   else await assert.rejects(rpc(db,users[0],'complete',await consent()),e=>e.code==='42501');
   await assert.rejects(db.query('select authoring.create_confirmed_profile($1,$2,$3)',[users[1],'author','우회']),e=>e.code==='42501');
   await db.exec('reset role');
  }
  await db.exec('update authoring.free_beta_settings set enabled=false');
  assert.equal((await rpc(db,users[1],'complete',await consent())).error,'FREE_BETA_NOT_READY');
  assert.equal((await db.query('select count(*)::int n from authoring.free_beta_accounts')).rows[0].n,1);
 }finally{await db.close();}
});
const origin='https://app.test';
const env={FREE_BETA_ENABLED:'true',AUTH_ONBOARDING_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
const request=(action,data,headers={})=>new Request(origin+(action==='reader'?'/api/v2/onboarding':'/api/v2/onboarding/author/'+action),{method:data===undefined?'GET':'POST',headers:{Origin:origin,Authorization:'Bearer fixture.jwt.value','Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
test('beta API uses confirmed upstream Auth, exact consent, caps body, and never calls PASS',async()=>{
 const db=await setup();let user=users[0],authPatch={},rate=true;
 const fetchImpl=async(input,options)=>{
  const url=new URL(input);assert.equal(url.hostname,'example.supabase.co');assert.equal(options.redirect,'manual');
  if(url.pathname==='/auth/v1/user')return Response.json({id:user,email:'fixture@example.test',email_confirmed_at:'2026-10-22',...authPatch});
  const name=url.pathname.split('/').pop(),d=JSON.parse(options.body||'{}');
  if(name==='consume_authoring_signup_attempt')return Response.json(rate);
  if(['free_beta_enrollment_config','free_beta_enrollment_launch_ready'].includes(name))return Response.json((await db.query('select public.'+name+'() r')).rows[0].r);
  if(name==='free_beta_enrollment')return Response.json(await rpc(db,d.p_user,d.p_action,d.p_data));
  if(name==='launch_account_actor')return Response.json((await db.query('select launch_account_actor($1) r',[d.p_user])).rows[0].r);
  throw Error('Unexpected route '+name);
 };
 const call=async(action,data,bindings=env,headers={})=>{const r=await freeBetaEnrollmentApi(request(action,data,headers),bindings,{fetchImpl});return {status:r.status,body:await r.json()};};
 try{
  assert.equal(await freeBetaEnrollmentApi(request('policy'),{}),null);
  assert.equal((await call('policy',undefined,{...env,AUTH_ONBOARDING_ENABLED:'false'})).body.enabled,false);
  const policy=(await call('policy')).body;assert.equal(policy.enabled,true);assert.equal(policy.identityVerified,false);assert.equal(policy.documents.length,2);
  assert.equal((await freeBetaEnrollmentApi(new Request(origin+'/api/v2/auth/readiness?kind=author'),env,{fetchImpl})).status,200);
  assert.equal((await call('status')).body.completed,false);
  const {kind,...input}=await consent();
  for(const [patch,expected] of [[{rightsAccepted:false},400],[{documentHash:'stale'},409],[{authorId:1},400],[{identityVerified:true},400],[{padding:'x'.repeat(9000)},413]])assert.equal((await call('complete',{...input,...patch})).status,expected);
  assert.equal((await call('complete',input,env,{Origin:'https://evil.test'})).status,403);
  assert.equal((await call('complete',input,env,{Authorization:''})).status,401);
  authPatch={email_confirmed_at:null};assert.equal((await call('complete',input)).status,403);authPatch={};
  rate=false;assert.equal((await call('complete',input)).status,429);rate=true;
  assert.equal((await call('complete',input)).body.identityVerified,false);
  assert.equal((await call('complete',input)).body.created,false);
  assert.equal((await call('start',input)).status,404);
  user=users[1];const reader=await call('reader',{kind:'reader',displayName:'독자입니다'});assert.equal(reader.status,200);assert.equal(reader.body.actor.author,null);
  assert.equal((await call('reader',{kind:'author',displayName:'우회작가'})).status,403);
 }finally{await db.close();}
});
test('beta UI has only rights consent, skips PASS SDK, and never sets verified state',async()=>{
 const elements=new Map(),calls=[];
 const root={dataset:{},set innerHTML(value){for(const m of value.matchAll(/data-enrollment="([^"]+)"/g))this.querySelector('[data-enrollment="'+m[1]+'"]');},querySelector(selector){const id=selector.match(/"([^"]+)"/)[1];if(!elements.has(id))elements.set(id,{checked:false,value:id==='basis'?'OWN':'',disabled:false,textContent:'',hidden:false});return elements.get(id);}};
 const documents=(await enrollmentDocuments()).filter(d=>d.id!=='identity-privacy');
 const context={crypto,AbortSignal,URLSearchParams,location:{search:''},fetch:async()=>Response.json({enabled:true,mode:'FREE_BETA',documents}),WebNovelsAuth:{message:e=>e.message,validate:async()=>({userId:'verified-session'}),api:async(path,options)=>{const action=path.split('/').pop(),body=options?.body?JSON.parse(options.body):null;calls.push({action,body});if(action==='status')return {completed:false};if(action==='complete')return {completed:true,identityVerified:false};assert.fail('No PASS invocation');}}};
 context.window=context;vm.createContext(context);vm.runInContext(await read('public/js/core/author-enrollment.js'),context);
 await context.AuthorEnrollment.mount(root);assert.equal(elements.get('identitySection').hidden,true);assert.equal(elements.get('rights').checked,false);
 assert.match(elements.get('intro').textContent,/본인확인 완료 표시를 부여하지/);
 await assert.rejects(context.AuthorEnrollment.complete('새필명'),/동의/);
 elements.get('rights').checked=true;await context.AuthorEnrollment.complete('새필명');
 assert.equal(root.dataset.verified,'false');assert.equal(calls[1].body.rightsAccepted,true);assert.equal('privacyAccepted' in calls[1].body,false);assert.equal('attemptId' in calls[1].body,false);
 context.AuthorEnrollment.reset();await assert.rejects(context.AuthorEnrollment.complete('다른계정'),/먼저/);
});
