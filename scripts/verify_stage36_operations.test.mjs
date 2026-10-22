import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,reader,limited} from './fixtures/stage17-db.mjs';
import {observeOperation,operationArea,betaOperationsApi} from '../server/beta-operations.mjs';
import worker from '../scheduler/worker.mjs';
import {createSecureApi} from '../server/secure-api.mjs';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const env={BETA_OPERATIONS_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic'};
const req=(path='/creator/drafts/save',method='POST')=>new Request('https://example.test/api/v2'+path,{method,headers:{'X-Request-ID':'untrusted','Authorization':'Bearer private'},...(method==='POST'?{body:'private manuscript'}:{})});
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};

test('observation collects only fixed fields and cannot change response or block on deferred telemetry',async()=>{
 const calls=[],pending=[],id=crypto.randomUUID(),response=Response.json({error:'sensitive text'},{status:409,headers:{'X-Request-ID':id}});
 const request=req(),out=await observeOperation(request,env,async()=>response,{now:(()=>{let n=100;return ()=>n+=25;})(),
  context:{waitUntil:p=>pending.push(p)},fetchImpl:async(url,init)=>{calls.push({url:String(url),init});return new Response(null,{status:204});}});
 await Promise.all(pending);assert.equal(out,response);assert.equal(calls.length,1);
 assert.deepEqual(JSON.parse(calls[0].init.body),{p_request:id,p_area:'DRAFT',p_status:409,p_duration:25});
 assert.equal(calls[0].init.redirect,'manual');assert.ok(calls[0].init.signal);
 assert.equal(JSON.stringify(calls).includes('private manuscript'),false);assert.equal(JSON.stringify(calls).includes('sensitive text'),false);
 assert.equal((await observeOperation(request,env,async()=>response,{fetchImpl:async()=>{throw Error('network');}})),response);
 assert.deepEqual(await out.json(),{error:'sensitive text'});
});

test('classification is limited to enabled write areas; validation and login refusals are excluded',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return Response.json({});};
 for(const status of [400,401,403,404,429])await observeOperation(req(),env,async()=>new Response(null,{status}),{fetchImpl});
 await observeOperation(req(),{},async()=>Response.json({}),{fetchImpl});
 await observeOperation(req(),{...env,SUPABASE_URL:'https://other.test'},async()=>Response.json({}),{fetchImpl});
 await observeOperation(req(),{...env,SUPABASE_SECRET_KEY:'anon'},async()=>Response.json({}),{fetchImpl});
 assert.equal(calls,0);
 assert.equal(operationArea(req('/admin/support'),env),null);
 assert.equal(operationArea(req('/creator/drafts','GET'),env),null);
 assert.equal(operationArea(req('/creator/publications/publish'),env),null);
 const live={...env,P0_API_ENABLED:'true',AUTHOR_PUBLISH_ENABLED:'true',FREE_BETA_ENABLED:'true'};
 assert.equal(operationArea(req('/creator/publications/publish'),live),'PUBLICATION');
 assert.equal(operationArea(req('/creator/files/import'),live),'UPLOAD');
 assert.equal(operationArea(req('/creator/webtoon/upload/'+crypto.randomUUID()),live),'UPLOAD');
 assert.equal(operationArea(req('/onboarding/author/complete'),live),'ONBOARDING');
});

test('dashboard requires active matching administrator and observed operations permission',async()=>{
 const request=req('/admin/beta-operations','GET'),rpc=async()=>({summary:{observedRequests:3}}),user={id:admin};
 const actor={userId:admin,admin:{is_active:true,role:'SUB_ADMIN',permissions:['OPERATIONS_READ']}};
 assert.equal((await betaOperationsApi({request,env,actor,user,rpc,fail})).summary.observedRequests,3);
 for(const who of [{...actor,userId:reader},{...actor,admin:{...actor.admin,is_active:false}},{...actor,admin:{...actor.admin,permissions:[]}}])
  await assert.rejects(betaOperationsApi({request,env,actor:who,user,rpc,fail}),/ADMIN_FORBIDDEN/);
 await assert.rejects(betaOperationsApi({request,env:{},actor,user,rpc,fail}),/BETA_OPERATIONS_NOT_READY/);
 await assert.rejects(betaOperationsApi({request:req('/admin/beta-operations?x=1','GET'),env,actor,user,rpc,fail}),/INVALID_QUERY/);
});

test('support and operations route through account API even when public beta remains disabled',async()=>{
 const calls=[],actor={userId:admin,admin:{is_active:true,role:'SUPER_ADMIN'}};
 const api=createSecureApi({fetchImpl:async(url,init)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path==='/auth/v1/user')return Response.json({id:admin,email_confirmed_at:new Date().toISOString()});
  if(path.endsWith('/launch_accounts_ready'))return Response.json(true);
  if(path.endsWith('/launch_account_actor'))return Response.json(actor);
  if(path.endsWith('/beta_operations_dashboard'))return Response.json({summary:{observedRequests:0}});
  if(path.endsWith('/beta_support'))return Response.json({items:[]});
  throw Error('unexpected RPC');
 }});
 for(const path of ['/admin/beta-operations','/support','/admin/support']){
  const response=await api(new Request('https://example.test/api/v2'+path,{headers:{Authorization:'Bearer a.b.c'}}),env);
  assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.ok(calls.includes('/rest/v1/rpc/beta_support'));
});

test('private telemetry SQL enforces access, aggregation, sample bounds, retention and current queue counts',async()=>{
 const {db}=await setup();
 try{
  await db.exec(await read('database/authoring/015_webtoon.sql'));
  const sql=await read('database/authoring/027_beta_operations.sql');await db.exec(sql);await db.exec(sql);
  const rpc=async(name,args=[])=>(await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
  const record=(status=200,id=crypto.randomUUID())=>rpc('record_beta_operation',[id,'DRAFT',status,50]);
  const errorId=crypto.randomUUID();await record();await record(503,errorId);await record(409);await record(503,errorId);
  let result=await rpc('beta_operations_dashboard',[admin]);
  assert.deepEqual(result.summary,{observedRequests:3,failures:1,conflicts:1,averageDurationMs:50});
  assert.equal(result.lastSchedulerHeartbeat,null);assert.equal(result.recentErrors.length,2);
  assert.equal((await rpc('beta_operations_dashboard',[reader])).error,'ADMIN_FORBIDDEN');
  assert.equal((await rpc('beta_operations_dashboard',[limited])).error,'ADMIN_FORBIDDEN');
  await db.query("update admin_users set permissions='[\"OPERATIONS_READ\"]' where auth_user_id=$1",[limited]);
  assert.ok((await rpc('beta_operations_dashboard',[limited])).summary);
  await db.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[limited]);
  assert.equal((await rpc('beta_operations_dashboard',[limited])).error,'ADMIN_FORBIDDEN');
  assert.equal((await rpc('record_beta_operation',[crypto.randomUUID(),'PRIVATE_BODY',503,2])).error,'INVALID_OBSERVATION');
  assert.equal((await rpc('record_beta_operation',[crypto.randomUUID(),'DRAFT',401,2])).error,'INVALID_OBSERVATION');
  for(let i=0;i<102;i++)await record(503);
  assert.equal((await db.query('select count(*)::int n from authoring.beta_operation_errors')).rows[0].n,100);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);await assert.rejects(db.query('select * from authoring.beta_operation_errors'));
   if(role!=='service_role')await assert.rejects(record());else assert.equal((await record()).recorded,true);
   await db.exec('reset role');
  }
  await db.exec("update authoring.beta_operation_errors set created_at=now()-interval '8 days';update authoring.beta_operation_minutes set minute=now()-interval '8 days'");
  await rpc('maintain_beta_operations');result=await rpc('beta_operations_dashboard',[admin]);
  assert.equal(result.summary.observedRequests,0);assert.ok(result.lastSchedulerHeartbeat);assert.equal(result.recentErrors.length,0);
  assert.equal((await db.query('select count(*)::int n from authoring.beta_operation_minutes')).rows[0].n,0);
  assert.deepEqual(result.queue,{pendingSchedules:0,failedSchedules:0,failedWebtoonAssets:0});
 }finally{await db.close();}
});

test('closed-publication cron only prunes/heartbeats; publication failures remain visible without retrying',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({name:new URL(url).pathname.split('/').at(-1),body:JSON.parse(init.body)});return Response.json({failedOrRetrying:0});};
 try{
  await worker.scheduled({},env,{waitUntil(){}});assert.deepEqual(calls.map(c=>c.name),['maintain_beta_operations']);
  calls.length=0;
  globalThis.fetch=async(url,init)=>{const name=new URL(url).pathname.split('/').at(-1);calls.push({name,body:JSON.parse(init.body)});
   return Response.json({}, {status:name==='run_creator_schedules'?503:200});};
  await assert.rejects(worker.scheduled({},{...env,AUTHOR_PUBLISH_ENABLED:'true'},{waitUntil(){}}),/Scheduled job failed/);
  assert.equal(calls.filter(c=>c.name==='run_creator_schedules').length,1);
  assert.equal(calls.find(c=>c.name==='record_beta_operation').body.p_status,503);
 }finally{globalThis.fetch=original;}
});
