import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createSecureApi} from '../server/secure-api.mjs';
import {enrollmentDocuments} from '../server/author-enrollment-policy.mjs';
import {onRequestGet as publicConfig} from '../functions/api/public-config.js';
import {resetInventory,resetSql,clearedTables} from './lib/free-beta-reset.mjs';

const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const origin='https://site.test';
const base={FREE_BETA_ENABLED:'true',AUTH_ONBOARDING_ENABLED:'true',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
const token='Bearer fixture.jwt.signature';
const request=(path,data,headers={})=>new Request(origin+'/api/v2/'+path,{method:data===undefined?'GET':'POST',
 headers:{Authorization:token,Origin:origin,'Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
const verifiedUser={id:user,email:'synthetic@example.test',email_confirmed_at:'2026-10-22T00:00:00Z'};
const actor={userId:user,reader:null,author:{id:'9007199254740993',pen_name:'베타 작가',status:'APPROVED',identity_verified:false},admin:null};

test('secure router selects free-beta enrollment before enabled PASS and public rollout gates',async()=>{
 const documents=(await enrollmentDocuments()).filter(d=>d.id!=='identity-privacy'),calls=[];
 const api=createSecureApi({fetchImpl:async(input,options={})=>{
  const url=new URL(input),path=url.pathname;calls.push(path);assert.equal(url.hostname,'fixture.supabase.co');
  const data=options.body?JSON.parse(options.body):{};
  if(path==='/auth/v1/user')return Response.json(verifiedUser);
  if(path.endsWith('/free_beta_enrollment_config'))return Response.json({enabled:true,documents});
  if(path.endsWith('/free_beta_enrollment_launch_ready'))return Response.json(true);
  if(path.endsWith('/consume_authoring_signup_attempt')){assert.equal(data.p_user_id,user);return Response.json(true);}
  if(path.endsWith('/free_beta_enrollment')){
   assert.equal(data.p_user,user);assert.equal(data.p_action,'complete');assert.equal(data.p_data.kind,'author');
   assert.equal(data.p_data.rightsAccepted,true);return Response.json({completed:true,created:true,mode:'FREE_BETA',identityVerified:false});
  }
  assert.fail('Beta must not enter PASS, old signup, or public content gates: '+path);
 }});
 const env={...base,AUTHOR_IDENTITY_ENABLED:'true',AUTHOR_IDENTITY_MODE:'LIVE',PROVIDER_SETTINGS_SOURCE:'database',P0_API_ENABLED:'false'};
 const policy=await api(request('onboarding/author/policy'),env);assert.equal(policy.status,200);
 assert.equal((await policy.json()).mode,'FREE_BETA');
 const ready=await api(request('auth/readiness?kind=author'),env);assert.deepEqual(await ready.json(),{ready:true,mode:'FREE_BETA',authorIdentityRequired:false});
 const d=documents.find(d=>d.id==='copyright-own');
 const completed=await api(request('onboarding/author/complete',{displayName:'새 필명',rightsBasis:'OWN',rightsAccepted:true,documentVersion:d.version,documentHash:d.hash}),env);
 assert.equal(completed.status,200);assert.equal((await completed.json()).identityVerified,false);
 const before=calls.length;assert.equal((await api(request('onboarding/author/start',{}),env)).status,404);assert.equal(calls.length,before);
 assert.ok(!calls.some(p=>/provider_runtime_config|author_enrollment_config|complete_authoring_signup|p0_migration_status/.test(p)));
});

test('beta /me trusts only verified launch actor, preserves nonverified authors and rejects mismatched/inactive mappings',async()=>{
 let mapping=actor,auth=verifiedUser;const calls=[];
 const api=createSecureApi({fetchImpl:async(input,options={})=>{
  const path=new URL(input).pathname;calls.push(path);
  if(path.endsWith('/p0_migration_status'))return Response.json([{version:'p0-20260921',phase:'locked'}]);
  if(path==='/auth/v1/user')return Response.json({...auth,user_metadata:{role:'SUPER_ADMIN',author_id:'1',identity_verified:true}});
  if(path.endsWith('/launch_account_actor')){assert.equal(JSON.parse(options.body).p_user,user);return Response.json(mapping);}
  if(path.endsWith('/launch_work_registration_ready'))return Response.json(true);
  assert.fail('Raw profile tables and browser claims cannot establish a beta actor: '+path);
 }});
 const env={...base,P0_API_ENABLED:'true'};
 let response=await api(request('me'),env),body=await response.json();assert.equal(response.status,200);
 assert.equal(body.userId,user);assert.equal(body.author.id,actor.author.id);assert.equal(body.author.identity_verified,false);assert.equal(body.admin,null);assert.equal(body.multiFormatWorksEnabled,true);
 assert.equal(response.headers.get('cache-control'),'no-store');
 mapping={...actor,userId:other};response=await api(request('me'),env);assert.equal(response.status,503);assert.equal((await response.json()).error,'IDENTITY_MAPPING_INVALID');
 mapping={error:'ACCOUNT_INACTIVE',status:403};response=await api(request('me'),env);assert.equal(response.status,403);
 auth={...verifiedUser,email_confirmed_at:null};const before=calls.filter(p=>p.endsWith('/launch_account_actor')).length;
 assert.equal((await api(request('me'),env)).status,403);assert.equal(calls.filter(p=>p.endsWith('/launch_account_actor')).length,before);
 auth=verifiedUser;mapping={userId:user,reader:null,author:null,admin:{id:'admin-profile',role:'SUPER_ADMIN',is_active:true,permissions:[]}};
 body=await (await api(request('me'),env)).json();assert.equal(body.admin.role,'SUPER_ADMIN');assert.equal(body.author,null);assert.equal(body.multiFormatWorksEnabled,false);
});

test('provider settings route is reachable in account mode but grants access only to verified active super-admin',async()=>{
 let role='SUPER_ADMIN',active=true,auth=verifiedUser;const calls=[];
 const api=createSecureApi({fetchImpl:async(input,options={})=>{
  const path=new URL(input).pathname,data=options.body?JSON.parse(options.body):{};calls.push(path);
  if(path.endsWith('/launch_accounts_ready'))return Response.json(true);
  if(path==='/auth/v1/user')return Response.json({...auth,user_metadata:{role:'SUPER_ADMIN'}});
  if(path.endsWith('/launch_account_actor'))return Response.json({userId:user,reader:null,author:null,admin:{id:'admin-profile',role,is_active:active}});
  if(path.endsWith('/manage_provider_settings')){
   assert.equal(data.p_user,user);assert.equal(data.p_action,'list');return Response.json({items:[{provider:'TOSS',mode:'TEST',revision:'0',configuredFields:[],complete:false,enabled:false}]});
  }
  assert.fail('Provider metadata must not require the public content API or a provider call: '+path);
 }});
 const env={...base,P0_API_ENABLED:'false'};
 let response=await api(request('admin/providers'),env),body=await response.json();assert.equal(response.status,200);assert.equal(body.keyReady,false);assert.equal(body.activationAvailable,false);
 assert.doesNotMatch(JSON.stringify(body),/ciphertext|envelope|sb_secret_fixture/);
 let before=calls.filter(p=>p.endsWith('/manage_provider_settings')).length;
 for(const patch of [{role:'SUB_ADMIN',active:true},{role:'SUPER_ADMIN',active:false}]){role=patch.role;active=patch.active;assert.equal((await api(request('admin/providers'),env)).status,403);}
 assert.equal(calls.filter(p=>p.endsWith('/manage_provider_settings')).length,before);
 role='SUPER_ADMIN';active=true;
 assert.equal((await api(request('admin/providers',{}, {Origin:'https://other.test'}),env)).status,403);
 assert.equal((await api(request('admin/providers',{}),env)).status,503);
 assert.equal(calls.filter(p=>p.endsWith('/manage_provider_settings')).length,before);
 assert.equal((await api(request('admin/providers',undefined,{Authorization:''}),env)).status,401);
 auth={...verifiedUser,is_anonymous:true};assert.equal((await api(request('admin/providers'),env)).status,401);
});

test('public configuration exposes strict beta boolean and excludes every private provider binding',async()=>{
 const privateBindings={SUPABASE_SECRET_KEY:'private-service-value',PROVIDER_SETTINGS_MASTER_KEY:'private-wrapping-key',
  PROVIDER_SETTINGS_KEY_VERSION:'private-key-version',PORTONE_API_SECRET:'private-portone-secret',AUTHOR_IDENTITY_HMAC_KEY:'private-identity-key',
  TOSS_TEST_SECRET_KEY:'private-toss-secret',TOSS_SECRET_KEY:'private-live-secret'};
 for(const flag of ['true','false','TRUE',undefined]){
  const response=publicConfig({env:{...base,...privateBindings,FREE_BETA_ENABLED:flag,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const source=await response.text(),context={window:{}};vm.runInNewContext(source,context);
  assert.equal(context.window.WEBNOVELS_CONFIG.freeBetaEnabled,flag==='true');assert.equal(Object.isFrozen(context.window.WEBNOVELS_CONFIG),true);
  for(const [key,value] of Object.entries(privateBindings)){assert.ok(!source.includes(key));assert.ok(!source.includes(value));}
  assert.equal(context.window.WEBNOVELS_CONFIG.supabaseAnonKey,'sb_publishable_fixture');
 }
 const invalid=publicConfig({env:{...base,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_secret_not_a_public_key'}});assert.equal(invalid.status,503);assert.ok(!(await invalid.text()).includes('sb_secret_not_a_public_key'));
});

const preserved=['public.admin_users','public.audit_logs','public.system_config','authoring.enrollment_documents','authoring.enrollment_settings',
 'authoring.migrations','authoring.new_serial_service','authoring.retention_policy','authoring.identity_evidence','launch_recovery.account_links',
 'launch_recovery.account_service','launch_recovery.account_audit','launch_recovery.admin_permission_audit','launch_recovery.author_workspace_service'];
const auditor='33333333-3333-4333-8333-333333333333',approver='44444444-4444-4444-8444-444444444444';
function snapshot(){
 const tables=[...clearedTables,...preserved,'auth.users','auth.identities','storage.objects'].map(name=>{
  const [schema,table]=name.split('.');return {schema,name:table,rows:[]};});
 const result={tables};setRows(result,'public.admin_users',[{id:'admin-profile',auth_user_id:user,email:'admin@example.test',is_active:true,role:'SUPER_ADMIN'}]);
 setRows(result,'auth.users',[{id:user,email:'admin@example.test'},{id:other,email:'test-reader@example.test'},{id:auditor,email:'audit@example.test'},{id:approver,email:'approval@example.test'}]);
 setRows(result,'launch_recovery.account_audit',[{actor_id:auditor}]);setRows(result,'authoring.retention_policy',[{approved_by:approver}]);return result;
}
function setRows(s,name,rows){s.tables.find(t=>t.schema+'.'+t.name===name).rows=rows.map(r=>JSON.stringify(r));}
test('one-time reset inventory excludes administrator/Auth tables and retains administrative audit identities',()=>{
 const s=snapshot(),inventory=resetInventory(s);assert.equal(inventory.adminProfiles,1);
 assert.deepEqual(new Set(inventory.retainedAuthIds),new Set([user,auditor,approver]));assert.deepEqual(inventory.deleteAuthIds,[other]);
 assert.ok(inventory.clearedTables.every(t=>!t.startsWith('auth.')&&!preserved.includes(t)));
 assert.equal(new Set(inventory.clearedTables).size,inventory.clearedTables.length);
 const sql=resetSql(s);assert.match(sql,/continue identity restrict;/i);assert.doesNotMatch(sql,/\bcascade\b/i);
 assert.doesNotMatch(sql,/(?:truncate\s+table|delete\s+from|update)\s+(?:auth\.|public\.admin_users|public\.audit_logs)/i);
 assert.match(sql,/where kind<>'admin'/);assert.match(sql,/where profile_kind<>'admin'/);assert.match(sql,/BETA_RESET_PRECONDITION_FAILED/);
});
test('one-time reset refuses unknown/missing schemas, missing administrator evidence and nonempty Storage',()=>{
 const cases=[
  [s=>s.tables.push({schema:'public',name:'unreviewed_new_table',rows:[]}),/BETA_RESET_SCHEMA_REVIEW_REQUIRED/],
  [s=>s.tables.splice(s.tables.findIndex(t=>t.schema==='public'&&t.name==='works'),1),/BETA_RESET_SCHEMA_REVIEW_REQUIRED/],
  [s=>setRows(s,'public.admin_users',[]),/BETA_RESET_ACTIVE_ADMIN_REQUIRED/],
  [s=>setRows(s,'public.admin_users',[{auth_user_id:user,is_active:false,role:'SUPER_ADMIN'}]),/BETA_RESET_ACTIVE_ADMIN_REQUIRED/],
  [s=>setRows(s,'auth.users',[]),/BETA_RESET_ADMIN_AUTH_REQUIRED/],
  [s=>setRows(s,'storage.objects',[{id:'synthetic-object'}]),/BETA_RESET_STORAGE_REVIEW_REQUIRED/]
 ];
 for(const [change,error] of cases){const s=snapshot();change(s);assert.throws(()=>resetInventory(s),error);assert.throws(()=>resetSql(s),error);}
});
