import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';

const uid='11111111-1111-4111-8111-111111111111',wid='9007199254740993',eid='9007199254740995',version='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const env={P0_API_ENABLED:'true',AUTHOR_WORKS_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
const toonEnv={...env,...Object.fromEntries(['WEBTOON_SERVICE_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_FILES_ENABLED','AUTHOR_PUBLISH_ENABLED','READER_SERVICE_ENABLED','READER_DISCOVERY_ENABLED'].map(key=>[key,'true']))};
const summary=(extra={})=>({id:eid,episode_number:1,title:'발행 제목',status:'PUBLISHED',member_read_count:'9007199254740997',published_at:'2026-11-01T01:00:00Z',has_head:true,scheduled_at:null,schedule_status:null,due_at:null,generation:null,...extra});
const episode=(extra={})=>({...summary(),workId:wid,versionId:version,contentType:'NOVEL',content:'실제 발행 본문',authorComment:'인사말',...extra});
function setup({result={workId:wid,contentType:'NOVEL',episodes:[summary()]},author=true,status='APPROVED',dbFailure=false}={}){
  const calls=[];
  const api=createSecureApi({fetchImpl:async(input,init)=>{
    const path=new URL(input).pathname;calls.push({path,body:init.body&&JSON.parse(init.body)});
    if(path==='/auth/v1/user')return Response.json({id:uid,email_confirmed_at:'2026-09-23'});
    if(path.endsWith('/p0_migration_status'))return Response.json([{phase:'locked'}]);
    if(path.endsWith('/authors'))return Response.json(author?[{id:1,status,auth_user_id:uid}]:[]);
    if(path.endsWith('/readers'))return Response.json([{id:1,status:'ACTIVE',auth_user_id:uid}]);
    if(path.endsWith('/admin_users'))return Response.json([]);
    if(path.endsWith('/creator_episode_workspace'))return dbFailure?new Response('private database error',{status:500}):Response.json(result);
    throw Error('unexpected '+path);
  }});
  const request=(suffix='',{method='GET',bindings=env}={})=>api(new Request('https://app.test/api/v2/creator/works/'+wid+'/episodes'+suffix,{method,headers:{Authorization:'Bearer real.jwt.token'}}),bindings);
  return {calls,request};
}

test('owner CMS list passes verified Auth UUID and exact bigint work ID, preserves count precision, whitelists response and disables caching',async()=>{
  const app=setup({result:{workId:wid,contentType:'NOVEL',episodes:[summary({private_account:'never serialize'})],secret:'never serialize'}});
  const response=await app.request();assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.episodes[0].member_read_count,'9007199254740997');assert.equal(value.episodes[0].id,eid);assert.equal(value.workId,wid);
  assert.deepEqual(app.calls.at(-1).body,{p_user:uid,p_work:wid,p_episode:null});assert.ok(!JSON.stringify(value).includes('never serialize'));
  assert.match(response.headers.get('Cache-Control'),/no-store/);
});

test('published novel read uses only the owner RPC and keeps canonical Word document without active draft or raw storage data',async()=>{
  const doc={version:1,paragraphs:[{align:'right',indent:0,runs:[{text:'실제 발행 본문',bold:true}]}]};
  const app=setup({result:{episode:episode({contentDocument:doc,raw_storage_path:'secret',source_draft_id:'private'})}});
  const response=await app.request('/'+eid);assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.episode.content,'실제 발행 본문');assert.deepEqual(value.episode.contentDocument,doc);assert.equal(value.episode.versionId,version);
  assert.deepEqual(app.calls.at(-1).body,{p_user:uid,p_work:wid,p_episode:eid});assert.ok(!JSON.stringify(value).includes('raw_storage'));
  assert.ok(!app.calls.some(call=>/creator_drafts|creator_publications|episode_contents/.test(call.path)));
});

test('webtoon snapshot exposes bounded owner panel identities and credits, never upstream image URLs or bucket names',async()=>{
  const panel={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',assetId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',width:800,height:1000,path:'private-bucket',url:'https://evil.test/asset'};
  const app=setup({result:{episode:episode({contentType:'WEBTOON',content:'',webtoon:{schemaVersion:1,panels:[panel],credits:{writer:'글',artist:'그림',original:'원작',email:'hidden'}}})}});
  const response=await app.request('/'+eid,{bindings:toonEnv});assert.equal(response.status,200);const result=await response.json();
  assert.deepEqual(result.episode.webtoon.panels,[{id:panel.id,assetId:panel.assetId,width:800,height:1000}]);
  assert.deepEqual(result.episode.webtoon.credits,{writer:'글',artist:'그림',original:'원작'});assert.ok(!/private-bucket|evil.test|email/.test(JSON.stringify(result)));
  assert.equal((await app.request('/'+eid)).status,503,'flag-off cannot expose images through an owner preview');
});

test('read API rejects unverified authors, mutation verbs, query owner spoofing, invalid IDs and malformed upstream data',async()=>{
  for(const options of [{author:false},{status:'SUSPENDED'}]){
    const app=setup(options);assert.equal((await app.request()).status,403);assert.ok(!app.calls.some(call=>call.path.endsWith('/creator_episode_workspace')));
  }
  const app=setup();for(const suffix of ['?author_id=2','?workId=20','?episodeId=100','/9223372036854775808','/0'])assert.equal((await app.request(suffix)).status,400);
  for(const method of ['POST','PATCH','DELETE'])assert.equal((await app.request('',{method})).status,405);
  for(const result of [{workId:'20',contentType:'NOVEL',episodes:[]},{workId:wid,contentType:'NOVEL',episodes:[summary({member_read_count:'NaN'})]},
    {episode:episode({id:'2'})},{episode:episode({workId:'20'})},{episode:episode({contentType:'WEBTOON',webtoon:{schemaVersion:1,panels:[{id:version,assetId:version,width:801,height:1}]}})}]){
    assert.equal((await setup({result}).request(result.episode?'/'+eid:'',{bindings:toonEnv})).status,503);
  }
});

test('missing publication, cross-owner and unavailable DB remain errors without a successful fake zero list',async()=>{
  for(const [error,status] of [['WORK_NOT_FOUND',404],['PUBLICATION_NOT_FOUND',404],['ACCOUNT_INACTIVE',403]]){
    const response=await setup({result:{error,status}}).request('/'+eid);assert.equal(response.status,status);assert.equal((await response.json()).error,error);
  }
  const response=await setup({dbFailure:true}).request();assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private database error'));
});
