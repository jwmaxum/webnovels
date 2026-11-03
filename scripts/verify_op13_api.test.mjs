import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,admin,reader,reviewer,operator,env} from './fixtures/op13-db.mjs';
import {liveCommerceApi,projectCommerce} from '../server/live-commerce-api.mjs';
import {liveCommerceEnabled,liveCommercePolicy,depositInstructions} from '../server/live-commerce-policy.mjs';
import {accountApi} from '../server/account-api.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
import scheduler from '../scheduler/worker.mjs';
const origin='https://site.test',image={mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
test('OP13 flags, proof policy, public config and disabled routes fail closed',async()=>{
 assert(liveCommerceEnabled(env));for(const patch of [{LIVE_COMMERCE_GUARD_ENABLED:'false'},{FREE_BETA_ENABLED:'true'},{POINTS_TEST_ENABLED:'true'},{MONETIZATION_SANDBOX_ENABLED:'true'},{LIVE_COMMERCE_RELEASE_REVIEWED:'false'}])assert.equal(liveCommerceEnabled({...env,...patch}),false);
 for(const patch of [{LIVE_FINANCE_PRIVACY_REVIEWED:'false'},{LIVE_FINANCE_PROOF_POLICY_VERSION:'draft-v1'},{LIVE_FINANCE_PROOF_RETENTION_DAYS:'0'}])assert.equal((await liveCommercePolicy({...env,...patch})).enabled,false);
 for(const prefix of ['','admin/','creator/']){const r=await accountApi(new Request(origin+'/api/v2/'+prefix+'live-commerce'),{}, {fetchImpl:()=>assert.fail('closed')});assert.equal(r.status,503);}
 const config=await onRequestGet({env:{...env,NEXT_PUBLIC_SUPABASE_URL:'https://test.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_test'}}).text();assert(config.includes('"liveCommerceEnabled":true'));assert(!config.includes(env.AUTHOR_SETTLEMENT_ENCRYPTION_KEY));assert(!config.includes(env.LIVE_BANK_DEPOSIT_INSTRUCTIONS));
 assert.throws(()=>projectCommerce({mode:'TEST',source:'LOCAL_SIMULATED'},'reader','state'),e=>e.code==='LIVE_COMMERCE_UNAVAILABLE');
});
test('OP13 API encrypts bank proof, reauthenticates, verifies destination, projects content and audits reveal',async()=>{
 const f=await setup();try{
  await f.policy(f.novel.id);const calls=[],sessions=[],policy=await liveCommercePolicy(env),instructions=await depositInstructions(env);let current=reader;
  const rpc=async(name,args)=>{calls.push({name,args});if(name==='author_settlement_registration')return {ok:true};assert.equal(name,'op13_commerce');return f.call(args.p_role,args.p_action,args.p_data,args.p_user);};
  const remote=async(path)=>{sessions.push(path);return path.startsWith('/auth/v1/token')?Response.json({user:{id:current},access_token:'synthetic-session'}):new Response(null,{status:204});};
  const api=async(role,action,data={},extra={})=>{current=role==='reader'?reader:operator;return liveCommerceApi({env,request:new Request(origin+'/api/v2/'+(role==='admin'?'admin/':role==='author'?'creator/':'')+'live-commerce',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action,...data})}),actor:{userId:current,reader:{status:'ACTIVE'},admin:{role:'SUPER_ADMIN',is_active:true},author:{id:'1',status:'APPROVED'}},user:{id:current,email:'synthetic@example.test',email_confirmed_at:'2026-01-01'},rpc,remote,...extra});};
  const o=await api('reader','order',{requestId:crypto.randomUUID(),destinationHash:instructions.destinationHash});
  const d={requestId:crypto.randomUUID(),orderId:o.id,amount:10000,occurredAt:new Date().toISOString(),documentId:crypto.randomUUID(),image,policyHash:policy.hash,policyVersion:policy.version,bankReference:'synthetic-bank-ref',bankAccountId:env.LIVE_BANK_DESTINATION_ID,confirmed:true,password:'synthetic-password'};
  await assert.rejects(api('admin','deposit',{...d,bankAccountId:'wrong-account'}),e=>e.code==='BANK_INSTRUCTIONS_CHANGED');
  const dep=await api('admin','deposit',d);assert.ok(dep.id,JSON.stringify(dep));assert(!JSON.stringify(dep).includes(image.data));
  const raw=calls.find(c=>c.args?.p_action==='deposit').args.p_data;assert(!raw.password);assert(!raw.bankReference);assert(!raw.image);assert.notEqual(raw.evidence.envelope.ciphertext,image.data);assert.equal(raw.destinationHash,instructions.destinationHash);
  assert.equal((await api('admin','deposit',d)).replayed,true,'fresh IV does not break retry');
  const doc=await api('admin','reveal',{documentId:d.documentId,password:'synthetic-password'});assert.equal(doc.image.data,image.data);assert.equal(doc.bankReference,d.bankReference);assert(sessions.includes('/auth/v1/logout?scope=local'));
  assert.ok((await f.write('admin','confirm',{depositId:dep.id},reviewer)).id);
  const c=await api('reader','content',{episodeId:f.novel.episodes[0].id});assert.equal(c.mode,'LIVE_MANUAL');assert(!('provenance'in c));assert.equal(c.contentType,'NOVEL');
  await assert.rejects(api('reader','content',{episodeId:f.novel.episodes[2].id}),e=>e.code==='EPISODE_LOCKED');
  await assert.rejects(api('admin','deposit',{...d,amount:1}),e=>e.code==='IDEMPOTENCY_CONFLICT');
  const list=await api('admin','list',{query:'',offset:0});assert.equal(list.orders[0].lotId!=null,true);assert(!JSON.stringify(list).includes(image.data));
 }finally{await f.db.close();}
});
test('OP13 persistent guard blocks only registered episode routes even when purchasing disabled',async()=>{
 const conf={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic',LIVE_COMMERCE_GUARD_ENABLED:'true'};let registered=true,calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),data:JSON.parse(options.body)});return Response.json(registered);};
 for(const path of ['/api/v2/episodes/123/content','/api/v2/webtoon/images/123/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']){const r=await accountApi(new Request(origin+path),conf,{fetchImpl});assert.equal(r.status,409);assert.equal((await r.json()).error,'LIVE_COMMERCE_ROUTE_REQUIRED');}
 assert(calls.every(c=>c.url.includes('/rpc/op13_registered_episode')&&c.data.p_episode==='123'));
 const large=await accountApi(new Request(origin+'/api/v2/episodes/9000000000000000000/content'),conf,{fetchImpl});assert.equal(large.status,409);assert.equal(calls.at(-1).data.p_episode,'9000000000000000000');
 registered=false;assert.equal(await accountApi(new Request(origin+'/api/v2/episodes/123/content'),conf,{fetchImpl}),null);
 registered=null;assert.equal((await accountApi(new Request(origin+'/api/v2/episodes/123/content'),conf,{fetchImpl})).status,503);
});
test('OP13 input size, origin, field injection and revoked identity rejected before financial RPC',async()=>{
 const base={env,actor:{userId:reader,reader:{status:'ACTIVE'}},user:{id:reader,email_confirmed_at:'2026-01-01'},rpc:()=>assert.fail('no RPC')};
 for(const [body,headers,code]of [[{action:'order',userId:admin},{Origin:origin},'INVALID_COMMERCE_REQUEST'],[{action:'state'},{Origin:'https://evil.test'},'ORIGIN_REQUIRED'],[{action:'state',padding:'a'.repeat(220001)},{Origin:origin},'BODY_TOO_LARGE']])await assert.rejects(liveCommerceApi({...base,request:new Request(origin+'/api/v2/live-commerce',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})}),e=>e.code===code);
});
test('OP13 cleanup runs independently of live payment or collection flags',async()=>{
 const original=globalThis.fetch,calls=[];try{globalThis.fetch=async url=>{calls.push(String(url));return Response.json({purged:0});};await scheduler.scheduled({}, {LIVE_FINANCE_PROOF_CLEANUP_ENABLED:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic'}, {waitUntil:()=>{}});assert.equal(calls.length,1);assert(calls[0].includes('op13_purge_documents'));}finally{globalThis.fetch=original;}
});
