import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';
const uid='11111111-1111-4111-8111-111111111111';
const env={P0_API_ENABLED:'true',AUTHOR_WORKS_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
function setup({author=true,role=null,status='APPROVED',result={works:[],nextCursor:null},dbFailure=false}={}){
  const calls=[];
  const api=createSecureApi({fetchImpl:async(input,init)=>{
    const path=new URL(input).pathname;calls.push({path,body:init.body&&JSON.parse(init.body)});
    if(path==='/auth/v1/user')return Response.json({id:uid,email_confirmed_at:'2026-09-23'});
    if(path.endsWith('/p0_migration_status'))return Response.json([{phase:'locked'}]);
    if(path.endsWith('/authors'))return Response.json(author?[{id:1,status,auth_user_id:uid}]:[]);
    if(path.endsWith('/readers'))return Response.json([{id:1,status:'ACTIVE',auth_user_id:uid}]);
    if(path.endsWith('/admin_users'))return Response.json(role?[{id:1,role,is_active:true}]:[]);
    if(path.endsWith('/creator_works'))return dbFailure?new Response('private upstream detail',{status:500}):Response.json(result);
    throw new Error('unexpected '+path);
  }});
  const request=(path='',{method='GET',body,origin='https://app.test',key,bindings=env}={})=>api(new Request('https://app.test/api/v2/creator/works'+path,{method,headers:{Authorization:'Bearer real.jwt.token',...(origin?{Origin:origin}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),bindings);
  return {calls,request};
}
test('author-only gate: reader and admin cannot use creator identity; inactive author blocked',async()=>{
  for(const options of [{author:false},{author:false,role:'SUPER_ADMIN'},{status:'SUSPENDED'}]){
    const s=setup(options);assert.equal((await s.request()).status,403);assert.ok(!s.calls.some(c=>c.path.endsWith('/creator_works')));
  }
  const s=setup();assert.equal((await s.request('',{bindings:{...env,AUTHOR_WORKS_ENABLED:'false'}})).status,503);
});
test('list/create use only verified UUID; tampered owner/filter and missing origin denied',async()=>{
  const s=setup();assert.equal((await s.request('?filter=trash&after=9007199254740993')).status,200);
  assert.equal(s.calls.at(-1).body.p_user_id,uid);assert.equal(s.calls.at(-1).body.p_after,'9007199254740993');
  for(const path of ['?author_id=2','?filter=bad','/9223372036854775808'])assert.equal((await s.request(path)).status,400);
  const valid={method:'POST',key:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',body:{title:'작품'}};
  assert.equal((await s.request('',valid)).status,200);assert.equal(s.calls.at(-1).body.p_action,'create');
  for(const change of [{key:null},{body:{title:'작품',author_id:2}},{body:{title:''}}])assert.equal((await s.request('',{...valid,...change})).status,400);
  for(const origin of [null,'https://evil.test'])assert.equal((await s.request('',{...valid,origin})).status,403);
});
test('only metadata/lifecycle allowlist; version mandatory; id kept as decimal string',async()=>{
  const s=setup();
  for(const field of ['author_id','moderation_state','is_top_recommended','cover_image','status','settlement_status']){
    assert.equal((await s.request('/10',{method:'PATCH',body:{version:'1',[field]:'bad'}})).status,400);
  }
  assert.equal((await s.request('/10',{method:'PATCH',body:{title:'new'}})).status,400);
  assert.equal((await s.request('/10',{method:'PATCH',body:{version:'1',visibility:'PUBLIC'}})).status,400);
  assert.equal((await s.request('/9007199254740993',{method:'PATCH',body:{version:'1',title:'new'}})).status,200);
  assert.equal(s.calls.at(-1).body.p_work_id,'9007199254740993');
  assert.equal((await s.request('/10/trash',{method:'POST',body:{version:'1'}})).status,200);
  assert.equal(s.calls.at(-1).body.p_action,'trash');
});
test('DB conflict/not-found/unavailability are errors, never empty successful lists',async()=>{
  for(const [code,status] of [['WORK_CONFLICT',409],['WORK_NOT_FOUND',404],['WORK_RESTRICTED',403]]){
    const s=setup({result:{error:code,status}});const response=await s.request('/10');assert.equal(response.status,status);assert.equal((await response.json()).error,code);assert.ok(response.headers.get('X-Request-ID'));
  }
  const response=await setup({dbFailure:true}).request();assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private upstream'));
});
