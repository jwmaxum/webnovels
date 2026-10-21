import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';
import {accountApi} from '../server/account-api.mjs';
const flags=Object.fromEntries(['NEW_SERIALS_ENABLED','P0_API_ENABLED','WEBTOON_SERVICE_ENABLED','AUTHOR_WORKS_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_FILES_ENABLED','AUTHOR_PUBLISH_ENABLED','READER_SERVICE_ENABLED','READER_DISCOVERY_ENABLED','AUTHOR_PUBLICATION_REVIEW_ENABLED','AUTHOR_RICH_TEXT_ENABLED'].map(k=>[k,'true']));
const env={...flags,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};

test('scoped runtime cannot fall back to old bodies when a public feature or DB gate is missing',async()=>{
 const calls=[];let ready=true;
 const api=createSecureApi({fetchImpl:async(input)=>{
  const p=new URL(input).pathname;calls.push(p);
  if(p.endsWith('new_serials_ready'))return Response.json(ready);
  if(p.endsWith('stage18_episode_content'))return Response.json({error:'EPISODE_NOT_FOUND',status:404});
  throw Error('Unexpected historical route');
 }});
 const req=()=>new Request('https://app.test/api/v2/episodes/100/content');
 for(const flag of Object.keys(flags).filter(k=>!['NEW_SERIALS_ENABLED','P0_API_ENABLED'].includes(k))){
  assert.equal((await api(req(),{...env,[flag]:'false'})).status,503);
 }
 assert.equal(calls.length,0);ready=false;assert.equal((await api(req(),env)).status,503);
 ready=true;assert.equal((await api(req(),env)).status,404);
 assert.deepEqual([...new Set(calls)],['/rest/v1/rpc/new_serials_ready','/rest/v1/rpc/stage18_episode_content']);
 const health=await api(new Request('https://app.test/api/v2/health'),env);assert.equal((await health.json()).securityVersion,'new-serials-20261021');
});

test('private me advertises typed registration only from the service capability and remains compatible with old DB',async()=>{
 let capability=true,failCapability=false;const id='11111111-1111-4111-8111-111111111111';
 const fetchImpl=async(input)=>{
  const p=new URL(input).pathname;
  if(p==='/auth/v1/user')return Response.json({id,email_confirmed_at:'2026-10-20'});
  if(p.endsWith('launch_accounts_ready')||p.endsWith('launch_author_workspace_ready'))return Response.json(true);
  if(p.endsWith('launch_account_actor'))return Response.json({userId:id,author:{id:'1',status:'APPROVED'}});
  if(p.endsWith('launch_work_registration_ready'))return failCapability?Response.json({error:'missing'},{status:404}):Response.json(capability);
  throw Error('Unexpected private route');
 };
 const req=()=>new Request('https://app.test/api/v2/me',{headers:{Authorization:'Bearer test.jwt.value'}});
 const privateEnv={...env,P0_API_ENABLED:'false'};
 assert.equal((await (await accountApi(req(),privateEnv,{fetchImpl})).json()).multiFormatWorksEnabled,true);
 capability=false;assert.equal((await (await accountApi(req(),privateEnv,{fetchImpl})).json()).multiFormatWorksEnabled,false);
 failCapability=true;const r=await accountApi(req(),privateEnv,{fetchImpl});assert.equal(r.status,200);assert.equal((await r.json()).multiFormatWorksEnabled,false);
});

test('full API keeps typed registration available while the public webtoon feature is disabled',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const api=createSecureApi({fetchImpl:async(input)=>{
  const p=new URL(input).pathname;
  if(p.endsWith('p0_migration_status'))return Response.json([{phase:'locked'}]);
  if(p==='/auth/v1/user')return Response.json({id,email_confirmed_at:'2026-10-20'});
  if(p.endsWith('/authors'))return Response.json([{id:'1',status:'APPROVED'}]);
  if(p.endsWith('/readers')||p.endsWith('/admin_users'))return Response.json([]);
  if(p.endsWith('launch_work_registration_ready'))return Response.json(true);
  throw Error('Unexpected request');
 }});
 const response=await api(new Request('https://app.test/api/v2/me',{headers:{Authorization:'Bearer test.jwt.value'}}),{...env,NEW_SERIALS_ENABLED:'false',WEBTOON_SERVICE_ENABLED:'false'});
 assert.equal(response.status,200);assert.equal((await response.json()).multiFormatWorksEnabled,true);
});
