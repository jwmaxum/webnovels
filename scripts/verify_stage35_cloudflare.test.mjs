import test from 'node:test';import assert from 'node:assert/strict';
import {TARGET_SUBDOMAIN,IMAGE_WORKER,SCHEDULER,FREE_FLAGS,credentials,client,assertProject,assertActivation,
 inspectCloudflare,assertPrivateTargets,secretPlan,pagesPatch,uploadBody,deployWorker,workerBindings} from './lib/free-beta-cloudflare.mjs';
const accountId='a'.repeat(32),key='b'.repeat(64),token='test-token-not-a-real-credential';
const project=()=>({id:'project-fixture-id',name:'webnovels',subdomain:TARGET_SUBDOMAIN,production_branch:'main',source:{type:'github',config:{owner:'jwmaxum',repo_name:'webnovels'}},
 deployment_configs:{production:{env_vars:{UNCHANGED:{type:'secret_text'},PLAIN:{type:'plain_text',value:'preserve'}},
 services:{OTHER:{service:'unrelated'}},wrangler_config_hash:'config-hash'},preview:{env_vars:{PREVIEW:{type:'plain_text',value:'retain'}}}}});
const options={supabaseUrl:'https://example.supabase.co',supabaseSecret:'sb_secret_test_fixture',publishableKey:'sb_publishable_test_fixture'};

test('only canonical credentials and exact repository/project are accepted, API errors never echo payloads',async()=>{
 assert.throws(()=>credentials({API_Key:token,CLOUDFLARE_ACCOUNT_ID:accountId}),/CLOUDFLARE_API_TOKEN_REQUIRED/);
 assert.throws(()=>credentials({CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:'wrong'}),/CLOUDFLARE_ACCOUNT_ID_REQUIRED/);
 assert.deepEqual(credentials({CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId}),{token,accountId});
 assert.equal(assertProject(project()).name,'webnovels');
 for(const bad of [{...project(),subdomain:'other.pages.dev'},{...project(),production_branch:'develop'},
  {...project(),source:{type:'github',config:{owner:'other',repo_name:'webnovels'}}}])assert.throws(()=>assertProject(bad),/PROJECT_MISMATCH/);
 const api=client({CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:accountId},async(url,init)=>{
  assert.equal(new URL(url).origin,'https://api.cloudflare.com');assert.equal(init.headers.Authorization,'Bearer '+token);
  return Response.json({success:false,errors:[{message:'sensitive provider error'}]},{status:401});
 });
 await assert.rejects(api.request('/accounts/'+accountId+'/pages/projects/webnovels'),/CLOUDFLARE_HTTP_401/);
 await assert.rejects(api.request('https://evil.test'),/PATH_FORBIDDEN/);
});

test('infra patch leaves free signup/public flags untouched and preserves unrelated and preview state',()=>{
 const p=project(),before=structuredClone(p),secrets=secretPlan(p,{},()=>key);
 const patch=pagesPatch(p,secrets,{IMAGE_PROCESSOR:{service:IMAGE_WORKER,environment:'production'}},options);
 const values=patch.deployment_configs.production.env_vars;
 for(const flag of Object.keys(FREE_FLAGS))assert.equal(values[flag],undefined);
 assert.equal(values.AUTHOR_IDENTITY_ENABLED.value,'false');assert.equal(values.MONETIZATION_SANDBOX_ENABLED.value,'false');
 assert.equal(values.GROWTH_SERVICE_ENABLED.value,'false');assert.equal(values.PROVIDER_SETTINGS_SOURCE.value,'database');
 assert.equal(values.PROVIDER_SETTINGS_MASTER_KEY.type,'secret_text');assert.equal(values.IMAGE_PROCESSOR_SHARED_SECRET.type,'secret_text');
 assert.equal(values.UNCHANGED,undefined);assert.equal(values.PLAIN,undefined);assert.equal(patch.deployment_configs.preview,undefined);
 assert.equal(patch.deployment_configs.production.services.OTHER.service,'unrelated');assert.deepEqual(p,before);
 const activated=pagesPatch(p,secrets,{}, {...options,activate:true});
 for(const flag of Object.keys(FREE_FLAGS))assert.equal(activated.deployment_configs.production.env_vars[flag].value,'true');
 p.deployment_configs.production.env_vars.SUPABASE_URL={type:'plain_text',value:'https://other.supabase.co'};
 assert.throws(()=>pagesPatch(p,secrets,{},options),/DATABASE_TARGET_MISMATCH/);
});

test('stored master is never rotated implicitly; image shared secret requires recoverable private local copy',()=>{
 const p=project();p.deployment_configs.production.env_vars.PROVIDER_SETTINGS_MASTER_KEY={type:'secret_text'};
 p.deployment_configs.production.env_vars.PROVIDER_SETTINGS_KEY_VERSION={type:'plain_text',value:'v-existing'};
 p.deployment_configs.production.env_vars.IMAGE_PROCESSOR_SHARED_SECRET={type:'secret_text'};
 assert.throws(()=>secretPlan(p),/IMAGE_KEY_RECOVERY_REQUIRED/);
 const plan=secretPlan(p,{IMAGE_PROCESSOR_SHARED_SECRET:key},()=>{throw Error('must not regenerate');});
 assert.deepEqual(plan.created,{});assert.equal(plan.values.PROVIDER_SETTINGS_KEY_VERSION,'v-existing');
 const patch=pagesPatch(p,plan,{},options);assert.equal(patch.deployment_configs.production.env_vars.PROVIDER_SETTINGS_MASTER_KEY,undefined);
});

test('activation requires fresh applied SMTP/confirmation/redirect evidence for the exact database',()=>{
 const now=Date.now(),r={projectRef:'target',applied:true,configurationVerified:true,smtpReady:true,emailConfigReady:true,
  publicRedirectsReady:true,emailConfirmationRequired:true,signupDisabled:false,verifiedAt:new Date(now).toISOString()};
 assert.doesNotThrow(()=>assertActivation(r,'target',now));
 for(const key of ['applied','configurationVerified','smtpReady','emailConfigReady','publicRedirectsReady','emailConfirmationRequired'])
  assert.throws(()=>assertActivation({...r,[key]:false},'target',now),/AUTH_ACCEPTANCE_REQUIRED/);
 assert.throws(()=>assertActivation({...r,signupDisabled:true},'target',now),/AUTH_ACCEPTANCE_REQUIRED/);
 assert.throws(()=>assertActivation(r,'other',now),/AUTH_ACCEPTANCE_REQUIRED/);
 assert.throws(()=>assertActivation({...r,verifiedAt:new Date(now-86400001).toISOString()},'target',now),/AUTH_ACCEPTANCE_REQUIRED/);
});

test('first private deploy bootstraps harmless code, disables public previews before binding secrets and sends module multipart',async()=>{
 const calls=[],api={accountId,request:async(path,options={})=>{
  const entry={path,method:options.method||'GET'};
  if(options.body instanceof FormData) {
   entry.metadata=JSON.parse(await options.body.get('metadata').text());entry.code=await options.body.get('worker.mjs').text();
   assert.equal(options.body.get('worker.mjs').type,'application/javascript+module');
  }else entry.body=options.body;
  calls.push(entry);return {success:true,result:{enabled:false,previews_enabled:false}};
 }};
 const secrets={values:{IMAGE_PROCESSOR_SHARED_SECRET:key}},bindings=workerBindings(secrets,options);
 await deployWorker(api,IMAGE_WORKER,'export default {};',bindings.image,{exists:false});
 assert.equal(calls[0].method,'PUT');assert.equal(calls[0].metadata.bindings.length,0);assert.match(calls[0].code,/status:404/);
 assert.equal(calls[1].method,'POST');assert.deepEqual(calls[1].body,{enabled:false,previews_enabled:false});
 assert.equal(calls[3].metadata.bindings[0].type,'images');assert.equal(calls[3].metadata.bindings[1].text,key);
 assert.equal(bindings.scheduler.find(b=>b.name==='AUTHOR_PUBLISH_ENABLED').text,'false');
 assert.equal(workerBindings(secrets,{...options,activate:true}).scheduler.find(b=>b.name==='AUTHOR_PUBLISH_ENABLED').text,'true');
 assert.equal(bindings.scheduler.find(b=>b.name==='AUTHOR_IDENTITY_ENABLED').text,'false');
 assert.ok(uploadBody('export default {};',[]) instanceof FormData);
 await assert.rejects(deployWorker(api,'another-site','',[],{exists:false}),/WORKER_FORBIDDEN/);
});

test('inspection never writes, new absent Workers need no Zone permissions, existing routes are detected',async()=>{
 const calls=[],api={accountId,request:async(path,options={})=>{
  calls.push({path,options});assert.equal(options.method,undefined);
  if(path.includes('/pages/projects?')){
   assert.equal(path,'/accounts/'+accountId+'/pages/projects?page=1');
   return {result:[project(),{...project(),name:'unrelated',subdomain:'other.pages.dev'}],result_info:{total_pages:1}};
  }
  if(path.endsWith('/pages/projects/webnovels'))return {result:project()};
  if(path.endsWith('/settings'))return null;
  if(path.includes('/domains?'))return {result:[]};
  throw Error('unexpected call');
 }};
 const inspected=await inspectCloudflare(api);assert.equal(inspected.workers[IMAGE_WORKER].exists,false);assert.deepEqual(inspected.routes,[]);
 assert.equal(inspected.project.name,'webnovels');assert.equal(calls.some(c=>c.path.endsWith('/pages/projects/webnovels-db4')),false);
 assert.equal(calls.some(c=>c.path.startsWith('/zones')),false);assert.doesNotThrow(()=>assertPrivateTargets(inspected));
 assert.throws(()=>assertPrivateTargets({...inspected,routes:[{script:IMAGE_WORKER}]}),/PUBLIC_ROUTE_REVIEW_REQUIRED/);
 inspected.workers[IMAGE_WORKER].domains.push({hostname:'example.test'});assert.throws(()=>assertPrivateTargets(inspected),/PUBLIC_ROUTE_REVIEW_REQUIRED/);
});

test('Pages discovery uses the default page size and follows metadata to find a later target',async()=>{
 const pages=[],api={accountId,request:async(path)=>{
  if(path.includes('/pages/projects?')){
   const query=new URL('https://api.cloudflare.com'+path).searchParams;
   assert.equal(query.has('per_page'),false);const page=Number(query.get('page'));pages.push(page);
   return {result:page===1?[{...project(),name:'other',subdomain:'other.pages.dev'}]:[project()],result_info:{total_pages:2}};
  }
  if(path.endsWith('/pages/projects/webnovels'))return {result:project()};
  if(path.endsWith('/settings'))return null;
  if(path.includes('/domains?'))return {result:[]};
  throw Error('unexpected read');
 }};
 assert.equal((await inspectCloudflare(api)).project.name,'webnovels');assert.deepEqual(pages,[1,2]);
});
