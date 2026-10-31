import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {configure,schedulerUpload,downloadSource,assertRuntime,verifyChange,FLAG} from './configure_ui_r8_scheduler.mjs';
import {SCHEDULER,IMAGE_WORKER,TARGET_SUBDOMAIN} from './lib/free-beta-cloudflare.mjs';

const account='a'.repeat(32),privateValue='PRIVATE_FIXTURE_NOT_FOR_REPORTS';
const env={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'fixture-cloudflare-token-value',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ACCESS_TOKEN:'sbp_fixture'};
const plain=value=>({type:'plain_text',value});
const sourceCode='export default {scheduled(){return "ORIGINAL_PRIVATE_SOURCE";},fetch(){return new Response("Not found",{status:404});}};';
const initial=()=>({project:{id:'project',name:'webnovels',subdomain:TARGET_SUBDOMAIN,production_branch:'main',source:{type:'github',config:{owner:'jwmaxum',repo_name:'webnovels'}},deployment_configs:{production:{env_vars:{SUPABASE_URL:plain(env.SUPABASE_URL),[FLAG]:plain('true'),AUTHOR_IDENTITY_ENABLED:plain('false'),SECRET:{type:'secret_text'}}},preview:{env_vars:{UNCHANGED:plain('true')}}}},routes:[],workers:Object.fromEntries([IMAGE_WORKER,SCHEDULER].map(name=>[name,{exists:true,domains:[],subdomain:{enabled:false,previews_enabled:false},schedules:{schedules:name===SCHEDULER?[{cron:'* * * * *',created_on:'original'}]:[]},settings:{compatibility_date:'2026-10-22',compatibility_flags:['nodejs_compat'],observability:{enabled:true},logpush:false,limits:{cpu_ms:50},tags:['existing'],annotations:{'workers/message':'original','workers/triggered_by':'upload'},has_modules:true,has_assets:false,bindings:name===SCHEDULER?[
 {name:FLAG,type:'plain_text',text:'false'},{name:'SUPABASE_URL',type:'plain_text',text:env.SUPABASE_URL},{name:'WEBTOON_SERVICE_ENABLED',type:'plain_text',text:'true'},
 {name:'AUTHOR_IDENTITY_ENABLED',type:'plain_text',text:'false'},{name:'GROWTH_SERVICE_ENABLED',type:'plain_text',text:'false'},{name:'BETA_OPERATIONS_ENABLED',type:'plain_text',text:'true'},
 {name:'UNCHANGED',type:'plain_text',text:privateValue},{name:'SUPABASE_SECRET_KEY',type:'secret_text'},{name:'CRYPTO',type:'secret_key',algorithm:{name:'AES-GCM'},format:'raw'},
 {name:'KV',type:'kv_namespace',namespace_id:'existing-kv'},{name:'CONFIG',type:'json',json:{existing:true}}
 ]:[{name:'IMAGES',type:'images'}]}}]))});
function workspace(t){
 const scratch=path.resolve('scratch');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'ui-r8-scheduler-test-'));
 fs.writeFileSync(path.join(root,'.gitignore'),'scratch/\n');
 t.after(()=>{const real=fs.realpathSync(root);assert.equal(path.dirname(real),fs.realpathSync(scratch));fs.rmSync(real,{recursive:true,force:true});});return root;
}
async function multipart(code=sourceCode){const form=new FormData();form.set('worker.mjs',new Blob([code],{type:'application/javascript+module'}),'worker.mjs');form.set('binary.bin',new Blob([Buffer.from([0,255,13,10])],{type:'application/octet-stream'}),'binary.bin');return form;}
async function source(){const response=new Response(await multipart());return {bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type'),entrypoint:null};}
function textDelivery(code=sourceCode,{entrypoint='worker.mjs',type}={}){
 const boundary='a'.repeat(60),bytes=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="worker.mjs"\r\n'+(type?'Content-Type: '+type+'\r\n':'')+'\r\n'+code+'\r\n--'+boundary+'--\r\n');
 return new Response(bytes,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary,'cf-entrypoint':entrypoint}});
}
function transport(t,options={}){
 const root=workspace(t),state=structuredClone(options.before||initial()),calls=[];let inspection=0,scriptReads=0,dbReads=0;
 const fetchImpl=async(url,request={})=>{
  const u=new URL(url),method=request.method||'GET';calls.push({origin:u.origin,path:u.pathname,method});assert.equal(request.redirect,'error');
  if(u.origin==='https://api.supabase.com'){
   dbReads++;assert.equal(u.pathname,'/v1/projects/fixture/database/query/read-only');assert.equal(method,'POST');
   const query=JSON.parse(request.body).query;assert.match(query,/^select /);assert.match(query,/authoring-028/);assert.match(query,/hasPublicationHistory/);assert.match(query,/pg_get_functiondef/);
   assert.doesNotMatch(query,/\b(?:insert|update|delete|alter|create|drop|call)\b/i);
   return Response.json([{ready:options.ready!==false,pending:options.pending||dbReads===2&&options.pendingBeforeWrite?1:0,running:options.running||0,contract_fingerprint:dbReads===2&&options.contractDrift?'b'.repeat(32):'a'.repeat(32)}]);
  }
  assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(request.headers.Authorization,'Bearer '+env.CLOUDFLARE_API_TOKEN);
  const route=u.pathname.replace('/client/v4',''),ok=result=>Response.json({success:true,result});
  if(route==='/accounts/'+account+'/pages/projects'){inspection++;if(inspection===2&&options.configDrift)state.project.deployment_configs.production.env_vars.CONCURRENT=plain('true');return ok([state.project]);}
  if(route==='/accounts/'+account+'/pages/projects/webnovels')return ok(state.project);
  if(route==='/zones')return ok([]);
  if(route==='/accounts/'+account+'/workers/domains')return ok([]);
  const match=route.match(new RegExp('^/accounts/'+account+'/workers/scripts/([^/]+)(?:/(settings|subdomain|schedules))?$'));assert(match,'unexpected request');const [,name,suffix]=match,worker=state.workers[name];
  if(suffix){assert.equal(method,'GET');return ok(suffix==='settings'?worker.settings:worker[suffix]);}
  assert.equal(name,SCHEDULER);
  if(method==='GET'){
   scriptReads++;const code=scriptReads===2&&options.sourceDrift?'export default {scheduled(){return "drift";}};':sourceCode;
   if(options.textDelivery)return textDelivery(code);
   const form=await multipart(code);if(options.entrypointDrift||options.postEntrypointDrift)form.set('other.mjs',new Blob(['export const other=true;'],{type:'application/javascript+module'}),'other.mjs');
   return new Response(form,{headers:options.entrypointDrift||options.postEntrypointDrift?{'cf-entrypoint':scriptReads===(options.entrypointDrift?2:3)?'other.mjs':'worker.mjs'}:{}});
  }
  assert.equal(method,'PUT');const directories=fs.readdirSync(path.join(root,'scratch/launch/ui-r8-scheduler'));assert.equal(directories.length,1);
  for(const file of ['before.json','scheduler-before.bin','source-metadata.json'])assert(fs.existsSync(path.join(root,'scratch/launch/ui-r8-scheduler',directories[0],file)),'backup missing before mutation');
  const metadata=JSON.parse(await request.body.get('metadata').text());assert.equal(await request.body.get('worker.mjs').text(),sourceCode,'must upload downloaded source, not a local rebuild');
  if(!options.textDelivery)assert.deepEqual(Buffer.from(await request.body.get('binary.bin').arrayBuffer()),Buffer.from([0,255,13,10]));
  worker.settings.bindings=[...worker.settings.bindings.filter(item=>metadata.keep_bindings.includes(item.type)),...metadata.bindings];
  for(const key of ['compatibility_date','compatibility_flags','observability','logpush','limits','tags'])worker.settings[key]=structuredClone(metadata[key]);
  worker.settings.annotations={...metadata.annotations,'workers/triggered_by':'upload'};
  if(options.postBindingDrift)worker.settings.bindings.find(item=>item.name==='BETA_OPERATIONS_ENABLED').text='false';return ok({id:name});
 };
 return {root,state,calls,fetchImpl};
}

test('multipart upload preserves downloaded module/binary bytes and every unrelated setting/binding type',async()=>{
 const before=initial(),body=await schedulerUpload(await source(),before.workers[SCHEDULER].settings),metadata=JSON.parse(await body.get('metadata').text());
 assert.equal(await body.get('worker.mjs').text(),sourceCode);assert.deepEqual(Buffer.from(await body.get('binary.bin').arrayBuffer()),Buffer.from([0,255,13,10]));
 assert.deepEqual(metadata.keep_bindings,['secret_text','secret_key','kv_namespace','json']);assert.equal(metadata.bindings.find(item=>item.name===FLAG).text,'true');
 assert.equal(metadata.bindings.find(item=>item.name==='UNCHANGED').text,privateValue);assert(!metadata.bindings.some(item=>item.type!=='plain_text'));
 for(const key of ['compatibility_date','compatibility_flags','limits','observability','tags','logpush'])assert.deepEqual(metadata[key],before.workers[SCHEDULER].settings[key]);
 assert.deepEqual(metadata.annotations,{'workers/message':'original'});assert.deepEqual(before,initial());
});

test('authentic Cloudflare text-only module download preserves UTF-8 source and canonical digest across upload packaging',async()=>{
 const settings=initial().workers[SCHEDULER].settings,code=sourceCode+'\r\n// 한글 원본',original=await downloadSource(env,async()=>textDelivery(code),settings);
 const parsed=await new Response(original.bytes,{headers:{'Content-Type':original.contentType}}).formData();assert.equal(typeof parsed.get('worker.mjs'),'string');
 const upload=await schedulerUpload(original,settings);assert.equal(await upload.get('worker.mjs').text(),code);assert.equal(upload.get('worker.mjs').type,'application/javascript+module');
 const fileForm=new FormData();fileForm.set('worker.mjs',upload.get('worker.mjs'),'worker.mjs');
 const repackaged=await downloadSource(env,async()=>new Response(fileForm,{headers:{'cf-entrypoint':'worker.mjs'}}),settings);
 assert.equal(repackaged.digest,original.digest);assert.equal(repackaged.entrypoint,original.entrypoint);
 for(const [context,reply]of [[{...settings,has_modules:false},()=>textDelivery(code)],[settings,()=>textDelivery(code,{entrypoint:'other.mjs'})],[settings,()=>textDelivery(code,{type:'text/plain'})]])
  await assert.rejects(downloadSource(env,async()=>reply(),context),/SOURCE_TEXT_HEADERS_INVALID/);
});

test('captured provider framing works when optional has_modules is omitted, without relying on source syntax',async()=>{
 const settings=initial().workers[SCHEDULER].settings;delete settings.has_modules;
 const code='//'+ 'x'.repeat(2802)+'\n',download=await downloadSource(env,async()=>textDelivery(code),settings);
 assert.equal(download.bytes.length,2990);assert.equal(download.moduleWorker,undefined);
 const upload=await schedulerUpload(download,settings);assert.deepEqual(Buffer.from(await upload.get('worker.mjs').arrayBuffer()),Buffer.from(code));
 await assert.rejects(downloadSource(env,async()=>textDelivery(code),{...settings,has_modules:false}),/SOURCE_TEXT_HEADERS_INVALID/);
 await assert.rejects(downloadSource(env,async()=>textDelivery(code),{...settings,has_modules:'true'}),/SOURCE_TEXT_HEADERS_INVALID/);
});

test('authentic one-text-part provider delivery survives the full before/write/after configuration check',async t=>{
 const value=initial();delete value.workers[SCHEDULER].settings.has_modules;
 const api=transport(t,{textDelivery:true,before:value}),before=structuredClone(api.state),report=await configure({argv:['--apply'],env,fetchImpl:api.fetchImpl,workspaceRoot:api.root});
 assert.equal(report.applied,true);assert.equal(verifyChange(before,api.state,{url:env.SUPABASE_URL}),true);
 assert.equal(api.calls.filter(call=>call.method==='PUT').length,1);
});

test('default execution is read-only, reports readiness and redacts private values, source and credentials',async t=>{
 const api=transport(t),report=await configure({argv:[],env,fetchImpl:api.fetchImpl,workspaceRoot:api.root});
 assert.equal(report.applied,false);assert.equal(report.ready,true);assert.equal(report.publicationEnabled,false);assert.deepEqual(report.changedVariables,[FLAG]);
 assert(api.calls.every(call=>call.origin==='https://api.supabase.com'?call.method==='POST':call.method==='GET'));
 assert(!fs.existsSync(path.join(api.root,'scratch')));for(const value of [privateValue,env.CLOUDFLARE_API_TOKEN,env.SUPABASE_ACCESS_TOKEN,sourceCode])assert(!JSON.stringify(report).includes(value));
});

test('apply performs one Worker PUT after private backup and preserves Pages, source, Cron, routes and all other bindings',async t=>{
 const api=transport(t),before=structuredClone(api.state),report=await configure({argv:['--apply'],env,fetchImpl:api.fetchImpl,workspaceRoot:api.root});
 assert.equal(report.applied,true);assert.equal(report.publicationEnabled,true);assert.equal(verifyChange(before,api.state,{url:env.SUPABASE_URL}),true);
 assert.deepEqual(api.calls.filter(call=>call.method!=='GET'&&call.origin!=='https://api.supabase.com').map(call=>call.method),['PUT']);
 assert(!api.calls.some(call=>call.path.includes('/rest/v1/rpc/')));assert(!JSON.stringify(report).includes(privateValue));
 const backup=JSON.parse(fs.readFileSync(path.join(api.root,report.privateBackupDirectory,'before.json')));assert(!JSON.stringify(backup).includes(env.CLOUDFLARE_API_TOKEN));
 assert.equal(backup.workers[SCHEDULER].settings.bindings.find(item=>item.name==='SUPABASE_SECRET_KEY').text,undefined);
});

test('missing DB028 readiness, pending/running schedules and a new queue item prevent activation',async t=>{
 for(const options of [{ready:false},{pending:1},{running:1},{pendingBeforeWrite:true},{contractDrift:true}]){
  const api=transport(t,options);await assert.rejects(configure({argv:['--apply'],env,fetchImpl:api.fetchImpl,workspaceRoot:api.root}),/UI_R8_SCHEDULER_(?:DATABASE_028_REQUIRED|ACTIVE_QUEUE_MUST_BE_EMPTY|BEFORE_STATE_DRIFT)/);
  assert(!api.calls.some(call=>call.method==='PUT'));
 }
});

test('configuration, downloaded source or declared entrypoint drift immediately before write rejects the upload',async t=>{
 for(const options of [{configDrift:true},{sourceDrift:true},{entrypointDrift:true}]){
  const api=transport(t,options);await assert.rejects(configure({argv:['--apply'],env,fetchImpl:api.fetchImpl,workspaceRoot:api.root}),/BEFORE_STATE_DRIFT/);assert(!api.calls.some(call=>call.method==='PUT'));
 }
});

test('private target, existing Cron, matching database and unambiguous settings are required',()=>{
 for(const mutate of [s=>s.workers[SCHEDULER].subdomain.enabled=true,s=>s.workers[SCHEDULER].schedules={schedules:[]},s=>s.workers[SCHEDULER].settings.bindings.find(item=>item.name==='SUPABASE_URL').text='https://other.supabase.co',s=>s.workers[SCHEDULER].settings.bindings.find(item=>item.name===FLAG).type='secret_text',s=>s.workers[SCHEDULER].settings.bindings=s.workers[SCHEDULER].settings.bindings.filter(item=>item.name!=='SUPABASE_SECRET_KEY'),s=>s.workers[SCHEDULER].settings.bindings.find(item=>item.name==='SUPABASE_SECRET_KEY').type='plain_text',s=>s.workers[SCHEDULER].settings.unknown_new_option=true,s=>s.routes.push({script:SCHEDULER,pattern:'public.example/*'})]){
  const value=initial();mutate(value);assert.throws(()=>assertRuntime(value,{url:env.SUPABASE_URL}),/(?:UI_R8_SCHEDULER_|CLOUDFLARE_)/);
 }
});

test('ambiguous source modules or metadata fail closed instead of rebuilding or guessing',async()=>{
 for(const kind of ['metadata','two-main','wrong-name']){
  const form=await multipart();if(kind==='metadata')form.set('metadata','{}');if(kind==='two-main')form.set('second.mjs',new Blob(['export default {};'],{type:'application/javascript+module'}),'second.mjs');if(kind==='wrong-name')form.set('module',new Blob(['export default {};'],{type:'application/javascript+module'}),'different.mjs');
  const response=new Response(form);await assert.rejects(schedulerUpload({bytes:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get('content-type')},initial().workers[SCHEDULER].settings),/SOURCE_(?:PARTS|ENTRYPOINT)_AMBIGUOUS/);
 }
});

test('post-write unrelated drift is reported without an automatic rollback or extra mutation',async t=>{
 const api=transport(t,{postBindingDrift:true});await assert.rejects(configure({argv:['--apply'],env,fetchImpl:api.fetchImpl,workspaceRoot:api.root}),/UNRELATED_CONFIGURATION_CHANGED/);
 assert.equal(api.calls.filter(call=>call.method==='PUT').length,1);assert.equal(api.state.workers[SCHEDULER].settings.bindings.find(item=>item.name===FLAG).text,'true');
});

test('unchanged bytes with a changed post-write entrypoint are rejected without rollback',async t=>{
 const api=transport(t,{postEntrypointDrift:true});await assert.rejects(configure({argv:['--apply'],env,fetchImpl:api.fetchImpl,workspaceRoot:api.root}),/SOURCE_ENTRYPOINT_CHANGED_AFTER_WRITE/);
 assert.equal(api.calls.filter(call=>call.method==='PUT').length,1);
});
