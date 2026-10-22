import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {configure,assertClosedRuntime,assertStage36Evidence,stage36PagesPatch,schedulerUpload,verifyStage36Change,databaseReady,scriptDigest} from './configure_stage36_cloudflare.mjs';
import {IMAGE_WORKER,SCHEDULER,TARGET_SUBDOMAIN} from './lib/free-beta-cloudflare.mjs';

const account='a'.repeat(32),secret='fixture-private-value-never-print',env={CLOUDFLARE_ACCOUNT_ID:account,
 CLOUDFLARE_API_TOKEN:'fixture-cloudflare-token-value',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ACCESS_TOKEN:'sbp_fixture'};
const plain=value=>({type:'plain_text',value});
const evidence=()=>({applied:true,productionApplied:true,projectRef:'fixture',native:{nativeArchiveVerified:true},
 rehearsal:{originalRowsMatch:true,flagsUnchanged:true,sourceDriftRejected:true,explicitGrants:true},
 productionState:{originalRowsMatch:true,flagsUnchanged:true,privateTableAcl:true,serviceOnlyRpcs:true}});
const snapshot=()=>({project:{id:'fixture-project',name:'webnovels',subdomain:TARGET_SUBDOMAIN,production_branch:'main',
 source:{type:'github',config:{owner:'jwmaxum',repo_name:'webnovels'}},deployment_configs:{production:{env_vars:{
 SUPABASE_URL:plain(env.SUPABASE_URL),FREE_BETA_ENABLED:plain('false'),AUTH_ONBOARDING_ENABLED:plain('false'),
 AUTHOR_IDENTITY_ENABLED:plain('false'),MONETIZATION_SANDBOX_ENABLED:plain('false'),SECRET:{type:'secret_text'},UNRELATED:plain(secret)},
 services:{IMAGE_PROCESSOR:{service:IMAGE_WORKER,environment:'production'}},wrangler_config_hash:'existing-hash',compatibility_flags:['nodejs_compat']},
 preview:{env_vars:{OTHER:plain('unchanged')}}}},routes:[],workers:Object.fromEntries([IMAGE_WORKER,SCHEDULER].map(name=>[name,{
 exists:true,domains:[],subdomain:{enabled:false,previews_enabled:false},schedules:{schedules:name===SCHEDULER?[{cron:'* * * * *',created_on:'retained',modified_on:'retained'}]:[]},
 settings:{compatibility_date:'2026-09-23',compatibility_flags:['nodejs_compat'],observability:{enabled:false},logpush:false,
 bindings:name===SCHEDULER?[{name:'SUPABASE_URL',type:'plain_text',text:env.SUPABASE_URL},
  {name:'SUPABASE_SECRET_KEY',type:'secret_text'}, {name:'KV',type:'kv_namespace',namespace_id:'existing-id'},
  {name:'AUTHOR_PUBLISH_ENABLED',type:'plain_text',text:'false'},{name:'AUTHOR_IDENTITY_ENABLED',type:'plain_text',text:'false'},
  {name:'WEBTOON_SERVICE_ENABLED',type:'plain_text',text:'true'},{name:'UNCHANGED',type:'plain_text',text:secret}]:[{name:'IMAGES',type:'images'}]}
 }]))});
function fixture(t){
 const scratch=path.resolve('scratch');fs.mkdirSync(scratch,{recursive:true});
 const root=fs.mkdtempSync(path.join(scratch,'stage36-cloudflare-test-'));
 t.after(()=>{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(scratch));fs.rmSync(resolved,{recursive:true,force:true});});
 fs.mkdirSync(path.join(root,'artifacts'));fs.mkdirSync(path.join(root,'scheduler'));
 fs.writeFileSync(path.join(root,'scheduler','worker.mjs'),'export default {async scheduled(){},async fetch(){return new Response("Not found",{status:404});}};');
 fs.writeFileSync(path.join(root,'artifacts','stage36-preparation.json'),JSON.stringify(evidence()));return root;
}
function transport(initial,{root,ready=true,onMutation=()=>{},changeOnSecondInspection=false,multipart=false,changeScriptOnSecondRead=false}={}){
 const state=structuredClone(initial),calls=[];let inspection=0,scriptReads=0;
 const fetchImpl=async(url,options={})=>{
  const u=new URL(url),method=options.method||'GET';calls.push({path:u.pathname,method});
  if(u.origin==='https://api.supabase.com'){
   assert.equal(u.pathname,'/v1/projects/fixture/database/query/read-only');assert.equal(method,'POST');
   const query=JSON.parse(options.body).query;assert.match(query,/^select /);assert.doesNotMatch(query,/\b(?:delete|update|insert|alter)\b/i);
   return Response.json([{ready}]);
  }
  assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(options.headers.Authorization,'Bearer '+env.CLOUDFLARE_API_TOKEN);
  const route=u.pathname.replace('/client/v4','');
  const success=result=>Response.json({success:true,result});
  if(route==='/accounts/'+account+'/pages/projects'&&method==='GET'){
   inspection++;if(changeOnSecondInspection&&inspection===2)state.project.deployment_configs.production.env_vars.CONCURRENT=plain('true');
   return success([state.project]);
  }
  if(route==='/accounts/'+account+'/pages/projects/webnovels'){
   if(method==='GET')return success(state.project);
   assert.equal(method,'PATCH');checkBackup();onMutation(route);
   const patch=JSON.parse(options.body);assert.deepEqual(Object.keys(patch.deployment_configs),['production']);
   assert.deepEqual(Object.keys(patch.deployment_configs.production.env_vars),['BETA_OPERATIONS_ENABLED']);
   Object.assign(state.project.deployment_configs.production.env_vars,patch.deployment_configs.production.env_vars);return success(state.project);
  }
  if(route==='/zones')return success([]);
  if(route==='/accounts/'+account+'/workers/domains')return success([]);
  const matched=route.match(new RegExp('^/accounts/'+account+'/workers/scripts/([^/]+)(?:/(settings|subdomain|schedules))?$'));
  assert.ok(matched,'unexpected Cloudflare endpoint');const [,name,suffix]=matched,worker=state.workers[name];assert.ok(worker);
  if(suffix){assert.equal(method,'GET');return success(suffix==='settings'?worker.settings:worker[suffix]);}
  assert.equal(name,SCHEDULER);
  if(method==='GET'){
   const code=++scriptReads===2&&changeScriptOnSecondRead?'export default {scheduled(){return "changed";}};':'export default {scheduled(){}};';
   if(multipart){const form=new FormData();form.set('worker.mjs',new Blob([code],{type:'application/javascript+module'}),'worker.mjs');return new Response(form);}
   return new Response(code,{headers:{'Content-Type':'application/javascript','ETag':'prior-version'}});
  }
  assert.equal(method,'PUT');checkBackup();onMutation(route);
  const metadata=JSON.parse(await options.body.get('metadata').text());
  assert.equal(await options.body.get('worker.mjs').text().then(s=>s.includes('Not found')),true);
  worker.settings.bindings=[...worker.settings.bindings.filter(b=>metadata.keep_bindings.includes(b.type)),...metadata.bindings];
  for(const key of ['compatibility_date','compatibility_flags','observability','logpush'])worker.settings[key]=metadata[key];
  return success({id:name});
 };
 function checkBackup(){if(!root)return;const base=path.join(root,'scratch','launch','cloudflare-stage36'),runs=fs.readdirSync(base);
  assert.equal(runs.length,1);for(const file of ['before.json','scheduler-before.bin','scheduler-before-metadata.json'])assert.equal(fs.existsSync(path.join(base,runs[0],file)),true);}
 return {state,calls,fetchImpl};
}

test('only operations flags are patched; compatibility, secret and other binding types are retained',async()=>{
 const before=snapshot(),patch=stage36PagesPatch(before.project),body=schedulerUpload('export default {};',before.workers[SCHEDULER].settings);
 assert.deepEqual(patch,{deployment_configs:{production:{env_vars:{BETA_OPERATIONS_ENABLED:plain('true')},wrangler_config_hash:'existing-hash'}}});
 const metadata=JSON.parse(await body.get('metadata').text());
 assert.deepEqual(metadata.keep_bindings,['secret_text','kv_namespace']);assert.equal(metadata.compatibility_date,'2026-09-23');
 assert.equal(metadata.bindings.find(b=>b.name==='AUTHOR_PUBLISH_ENABLED').text,'false');
 assert.equal(metadata.bindings.some(b=>b.type==='secret_text'),false);assert.equal(metadata.bindings.find(b=>b.name==='BETA_OPERATIONS_ENABLED').text,'true');
 assert.deepEqual(metadata.observability,{enabled:false});assert.deepEqual(before,snapshot());
});

test('public gates, unknown secret flag type and non-private workers abort rather than reconfigure',()=>{
 assert.doesNotThrow(()=>assertClosedRuntime(snapshot()));
 for(const name of ['FREE_BETA_ENABLED','P0_API_ENABLED','AUTH_ONBOARDING_ENABLED','AUTHOR_IDENTITY_ENABLED','MONETIZATION_SANDBOX_ENABLED']){
  const s=snapshot();s.project.deployment_configs.production.env_vars[name]=plain('true');assert.throws(()=>assertClosedRuntime(s),/ACTIVATION_REVIEW_REQUIRED/);
 }
 const published=snapshot();published.workers[SCHEDULER].settings.bindings.find(b=>b.name==='AUTHOR_PUBLISH_ENABLED').text='true';assert.throws(()=>assertClosedRuntime(published),/SCHEDULER_ACTIVATION/);
 const publicWorker=snapshot();publicWorker.workers[SCHEDULER].subdomain.enabled=true;assert.throws(()=>assertClosedRuntime(publicWorker),/PRIVATE_EXISTING/);
 const p=snapshot().project;p.deployment_configs.production.env_vars.BETA_OPERATIONS_ENABLED={type:'secret_text'};assert.throws(()=>stage36PagesPatch(p),/FLAG_TYPE/);
});

test('actual Cloudflare schedules envelope and legacy array are accepted; missing or malformed Cron fails closed',()=>{
 const actual=snapshot();assert.doesNotThrow(()=>assertClosedRuntime(actual));
 const legacy=snapshot();legacy.workers[SCHEDULER].schedules=legacy.workers[SCHEDULER].schedules.schedules;
 assert.doesNotThrow(()=>assertClosedRuntime(legacy));
 for(const schedules of [undefined,null,{},[],{schedules:[]},{schedules:{}},{schedules:[{}]},{schedules:[{cron:'invalid'}]}]){
  const invalid=snapshot();invalid.workers[SCHEDULER].schedules=schedules;assert.throws(()=>assertClosedRuntime(invalid),/EXISTING_CRON_REQUIRED/);
 }
});

test('verified applied evidence must match the exact database and live read-only readiness',async()=>{
 assert.throws(()=>assertStage36Evidence({applied:false,projectRef:'fixture'},'fixture'),/DATABASE_EVIDENCE/);
 assert.throws(()=>assertStage36Evidence({applied:true,projectRef:'other'},'fixture'),/DATABASE_EVIDENCE/);
 assert.throws(()=>assertStage36Evidence({applied:true,projectRef:'fixture'},'fixture'),/DATABASE_EVIDENCE/);
 for(const key of Object.keys(evidence().productionState)){const r=evidence();r.productionState[key]=false;assert.throws(()=>assertStage36Evidence(r,'fixture'),/DATABASE_EVIDENCE/);}
 for(const key of Object.keys(evidence().rehearsal)){const r=evidence();r.rehearsal[key]=false;assert.throws(()=>assertStage36Evidence(r,'fixture'),/DATABASE_EVIDENCE/);}
 assert.throws(()=>assertStage36Evidence({...evidence(),productionApplied:false},'fixture'),/DATABASE_EVIDENCE/);
 assert.throws(()=>assertStage36Evidence({...evidence(),native:{nativeArchiveVerified:false}},'fixture'),/DATABASE_EVIDENCE/);
 assert.doesNotThrow(()=>assertStage36Evidence(evidence(),'fixture'));
 const api=transport(snapshot(),{ready:false});await assert.rejects(databaseReady(env,api.fetchImpl),/DATABASE_NOT_READY/);
 assert.equal(api.calls.length,1);
});

test('dry run is read-only, does not require DB evidence and never prints unrelated values or secrets',async t=>{
 const root=fixture(t);fs.unlinkSync(path.join(root,'artifacts','stage36-preparation.json'));
 const api=transport(snapshot());const result=await configure({argv:[],env,workspaceRoot:root,fetchImpl:api.fetchImpl});
 assert.equal(result.applied,false);assert.equal(result.publicActivation,false);assert.equal(api.calls.every(c=>c.method==='GET'),true);
 const text=JSON.stringify(result);assert.equal(text.includes(secret),false);assert.equal(text.includes(env.CLOUDFLARE_API_TOKEN),false);
 assert.equal(text.includes(env.SUPABASE_ACCESS_TOKEN),false);assert.deepEqual(result.changedVariables,['BETA_OPERATIONS_ENABLED']);
 await assert.rejects(configure({argv:[],env:{API_Key:env.CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID:account},workspaceRoot:root,fetchImpl:api.fetchImpl}),/API_TOKEN_REQUIRED/);
});

test('apply backs up source/config before two narrow mutations and preserves routes, cron, flags and bindings',async t=>{
 const root=fixture(t),before=snapshot(),api=transport(before,{root,multipart:true});
 const result=await configure({argv:['--apply'],env,workspaceRoot:root,fetchImpl:api.fetchImpl});
 assert.equal(result.applied,true);assert.equal(result.databaseReady,true);assert.equal(result.publicActivation,false);
 assert.deepEqual(api.calls.filter(c=>['PUT','PATCH','DELETE'].includes(c.method)).map(c=>c.method),['PUT','PATCH']);
 assert.equal(verifyStage36Change(before,api.state),true);assert.equal(JSON.stringify(result).includes(secret),false);
});

test('missing evidence, unready DB and concurrent config changes prevent every Cloudflare write',async t=>{
 for(const mode of ['evidence','database','concurrent','source']){
  const root=fixture(t);if(mode==='evidence')fs.writeFileSync(path.join(root,'artifacts','stage36-preparation.json'),'{}');
  const api=transport(snapshot(),{root,ready:mode!=='database',changeOnSecondInspection:mode==='concurrent',multipart:true,changeScriptOnSecondRead:mode==='source'});
  await assert.rejects(configure({argv:['--apply'],env,workspaceRoot:root,fetchImpl:api.fetchImpl}),/CLOUDFLARE_(STAGE36_DATABASE_EVIDENCE_REQUIRED|DATABASE_NOT_READY|CONFIGURATION_CHANGED)/);
  assert.equal(api.calls.some(c=>['PUT','PATCH','DELETE'].includes(c.method)),false);
 }
});

test('multipart backup comparison ignores boundary/part order and detects module bytes or MIME changes',async()=>{
 async function digest({reverse=false,code='original',type='application/javascript+module'}={}){
  const form=new FormData(),parts=[['worker.mjs',code,type],['other.js','support','application/javascript+module']];
  for(const [name,text,mime] of reverse?parts.reverse():parts)form.set(name,new Blob([text],{type:mime}),name);
  const response=new Response(form);return scriptDigest({bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')});
 }
 assert.equal(await digest(),await digest({reverse:true}));assert.notEqual(await digest(),await digest({code:'modified'}));
 assert.notEqual(await digest(),await digest({type:'text/plain'}));
 await assert.rejects(scriptDigest({bytes:Buffer.from('invalid multipart'),contentType:'multipart/form-data; boundary=invalid'}),/MULTIPART_INVALID/);
});

test('post-verification detects unrelated Pages config, scheduler secrets, cron or runtime setting changes',()=>{
 const before=snapshot(),after=structuredClone(before);
 after.project.deployment_configs.production.env_vars.BETA_OPERATIONS_ENABLED=plain('true');
 after.workers[SCHEDULER].settings.bindings.push({name:'BETA_OPERATIONS_ENABLED',type:'plain_text',text:'true'});
 assert.equal(verifyStage36Change(before,after),true);
 after.project.deployment_configs.production.env_vars=Object.fromEntries(Object.entries(after.project.deployment_configs.production.env_vars).reverse());
 assert.equal(verifyStage36Change(before,after),true,'Cloudflare object key ordering is not a configuration change');
 for(const mutate of [s=>{s.project.deployment_configs.preview={};},s=>{s.workers[SCHEDULER].settings.bindings=s.workers[SCHEDULER].settings.bindings.filter(b=>b.name!=='SUPABASE_SECRET_KEY');},
  s=>{s.workers[SCHEDULER].schedules=[{cron:'0 0 * * *'}];},s=>{s.workers[SCHEDULER].settings.compatibility_date='2026-10-22';}]){
  const changed=structuredClone(after);mutate(changed);assert.throws(()=>verifyStage36Change(before,changed),/CLOUDFLARE_/);
 }
});
