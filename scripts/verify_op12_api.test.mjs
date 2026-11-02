import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,owner,admin,env} from './fixtures/op12-db.mjs';
import {settlementReadinessApi,projectReadiness} from '../server/settlement-readiness-api.mjs';
import {proofPolicy,proofPolicyReady} from '../server/settlement-readiness-policy.mjs';
import {accountApi} from '../server/account-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
import scheduler from '../scheduler/worker.mjs';
const image={mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='},origin='https://site.test';
test('policy and route are separately closed; public config exposes only boolean and private inputs cannot open payouts',async()=>{
 for(const change of [{BANK_PROOF_PRIVACY_REVIEWED:'false'},{BANK_PROOF_POLICY_VERSION:'draft-v1'},{BANK_PROOF_RETENTION_DAYS:'0'},{AUTHOR_SETTLEMENT_PRIVACY_REVIEWED:'false'}])assert.equal(proofPolicyReady({...env,...change}),false);
 const config=await onRequestGet({env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_test',...env}}).text();assert(config.includes('"settlementReadinessEnabled":true'));assert(!config.includes(env.AUTHOR_SETTLEMENT_ENCRYPTION_KEY));assert(!config.includes(env.BANK_PROOF_POLICY_TEXT));
 for(const role of ['admin','creator']){const r=await accountApi(new Request(origin+'/api/v2/'+role+'/settlement-readiness'),{}, {fetchImpl:()=>assert.fail('disabled')});assert.equal(r.status,503);}
});
test('API encrypts evidence, reauthenticates, audits reveal, and strips account IDs/private documents from author output',async()=>{
 const f=await setup();try{
  await f.seed();const policy=await proofPolicy(env),calls=[],sessions=[];let userId=admin,config=env;
  const rpc=async(name,args)=>{calls.push({name,args});if(name==='author_settlement_registration')return {ok:true};assert.equal(name,'op12_settlement_readiness');return f.call(args.p_action,args.p_data,args.p_user,args.p_admin);};
  const remote=async(path,options)=>{sessions.push(path);if(path.startsWith('/auth/v1/token'))return Response.json({user:{id:userId},access_token:'synthetic-session'});assert(path.includes('/logout?scope=local'));return new Response(null,{status:204});};
  const call=async(action,data={},adminRoute=true)=>settlementReadinessApi({request:new Request(origin+'/api/v2/'+(adminRoute?'admin':'creator')+'/settlement-readiness',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action,...data})}),env:config,actor:{userId,author:{id:'1',status:'APPROVED'},admin:{role:'SUPER_ADMIN',is_active:true}},user:{id:userId,email:'synthetic@example.test'},rpc,remote});
  const detail=await call('detail',{authorId:'1'});assert.equal(detail.facts.canPay,false);assert(!JSON.stringify(detail).includes('ownerUserId'));
  const body={authorId:'1',binding:detail.facts.binding,requestId:crypto.randomUUID(),documentId:crypto.randomUUID(),image,policyVersion:policy.version,policyHash:policy.hash,confirmed:true,password:'synthetic-password'};
  config={...env,BANK_PROOF_PRIVACY_REVIEWED:'false'};await assert.rejects(call('confirm',body),e=>e.code==='BANK_PROOF_POLICY_REQUIRED');config=env;
  assert.equal((await call('confirm',body)).saved,true);assert.equal((await call('confirm',body)).replayed,true);assert(sessions.some(p=>p.includes('/logout')));
  const encrypted=calls.find(c=>c.args.p_action==='confirm').args.p_data;assert(!JSON.stringify(encrypted).includes(image.data));assert(!JSON.stringify(encrypted).includes('synthetic-password'));assert(encrypted.envelope.ciphertext);
  assert.deepEqual((await call('reveal',{authorId:'1',reviewId:body.requestId,password:'synthetic-password'})).image,image);
  userId=owner;const author=await call('detail',{},false);assert.deepEqual(author.reviews,[]);assert.equal(author.facts.bankConfirmed,true);assert(!JSON.stringify(author).includes(image.data));
  await assert.rejects(call('confirm',body,false),e=>e.code==='ADMIN_FORBIDDEN');
 }finally{await f.db.close();}
});
test('strict requests reject oversized input, invalid origin, extra fields and forged account identity before RPC',async()=>{
 const base={env,actor:{userId:admin,admin:{role:'SUPER_ADMIN',is_active:true}},user:{id:admin},rpc:()=>assert.fail('must reject before RPC')};
 for(const [body,patch] of [[{action:'detail',authorId:'1',amountKrw:100},{}],[{action:'complete'},{}],['x'.repeat(220001),{}],[{action:'detail',authorId:'1'},{Origin:'https://evil.test'}],['bad',{}]])await assert.rejects(settlementReadinessApi({...base,request:new Request(origin+'/api/v2/admin/settlement-readiness',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...patch},body:typeof body==='string'?body:JSON.stringify(body)})}),e=>[400,403,413].includes(e.status));
 await assert.rejects(settlementReadinessApi({...base,actor:{...base.actor,userId:owner},request:new Request(origin+'/api/v2/admin/settlement-readiness')}),e=>e.code==='INVALID_SESSION');
 assert.throws(()=>projectReadiness({mode:'LIVE',canPay:true},{action:'detail',admin:true,authorId:'1'}),/UNAVAILABLE/);
});
test('proof cleanup runs independently after collection is disabled and has no HTTP trigger',async()=>{
 const prior=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return Response.json({purged:1});};
 try{await scheduler.scheduled({},{BANK_PROOF_CLEANUP_ENABLED:'true',SETTLEMENT_READINESS_ENABLED:'false',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic'},{waitUntil(){}});assert.equal(calls.length,1);assert(calls[0].url.endsWith('/op12_purge_documents'));assert.equal(calls[0].options.redirect,'manual');assert.equal((await scheduler.fetch()).status,404);}finally{globalThis.fetch=prior;}
});
