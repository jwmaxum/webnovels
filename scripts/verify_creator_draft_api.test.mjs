import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';
const uid='11111111-1111-4111-8111-111111111111';
const env={P0_API_ENABLED:'true',AUTHOR_WORKS_ENABLED:'true',AUTHOR_DRAFTS_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
function setup({author=true,role=null,status='APPROVED',result={works:[],nextCursor:null},dbFailure=false}={}){
  const calls=[];
  const api=createSecureApi({fetchImpl:async(input,init)=>{
    const path=new URL(input).pathname;calls.push({path,body:init.body&&JSON.parse(init.body)});
    if(path==='/auth/v1/user')return Response.json({id:uid,email_confirmed_at:'2026-09-23'});
    if(path.endsWith('/p0_migration_status'))return Response.json([{phase:'locked'}]);
    if(path.endsWith('/authors'))return Response.json(author?[{id:1,status,auth_user_id:uid}]:[]);
    if(path.endsWith('/readers'))return Response.json([{id:1,status:'ACTIVE',auth_user_id:uid}]);
    if(path.endsWith('/admin_users'))return Response.json(role?[{id:1,role,is_active:true}]:[]);
    if(path.endsWith('/creator_drafts'))return dbFailure?new Response('private upstream detail',{status:500}):Response.json(result);
    throw new Error('unexpected '+path);
  }});
  const request=(path='',{method='GET',body,origin='https://app.test',key,bindings=env}={})=>api(new Request('https://app.test/api/v2/creator/drafts'+path,{method,headers:{Authorization:'Bearer real.jwt.token',...(origin?{Origin:origin}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),bindings);
  return {calls,request};
}
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const body={expectedRevision:'0',title:'제목',content:'내용',authorComment:''};
test('draft feature and real-author gates fail closed',async()=>{
  for(const options of [{author:false},{author:false,role:'SUPER_ADMIN'},{status:'SUSPENDED'}])assert.equal((await setup(options).request('?workId=10')).status,403);
  for(const flag of ['AUTHOR_DRAFTS_ENABLED','AUTHOR_WORKS_ENABLED'])assert.equal((await setup().request('?workId=10',{bindings:{...env,[flag]:'false'}})).status,503);
});
test('request snapshot and verified identity only; bigint work ID is exact',async()=>{
  const s=setup({result:{draft:{id,revision:'1'}}});
  const r=await s.request('/'+id+'?workId=9007199254740993',{method:'PUT',key,body});assert.equal(r.status,200);
  const rpc=s.calls.at(-1).body;assert.equal(rpc.p_user_id,uid);assert.equal(rpc.p_work_id,'9007199254740993');assert.equal(rpc.p_key,key);assert.deepEqual(rpc.p_data,body);
  for(const field of ['author_id','work_id','episodeId','lifecycle','status','image_urls'])assert.equal((await s.request('/'+id+'?workId=10',{method:'PUT',key,body:{...body,[field]:2}})).status,400);
});
test('malformed versions, cross-origin writes and unsupported methods rejected',async()=>{
  const s=setup(),path='/'+id+'?workId=10';
  for(const expectedRevision of [0,'-1','9223372036854775808',null])assert.equal((await s.request(path,{method:'PUT',key,body:{...body,expectedRevision}})).status,400);
  for(const origin of [null,'https://evil.test'])assert.equal((await s.request(path,{method:'PUT',key,body,origin})).status,403);
  assert.equal((await s.request(path,{method:'PUT',body})).status,400);
  assert.equal((await s.request(path,{method:'DELETE'})).status,405);
  assert.equal((await s.request('?workId=10&author_id=2')).status,400);
});
test('conflict/read-only/network failures never report successful save or leak upstream details',async()=>{
  for(const code of ['DRAFT_CONFLICT','DRAFT_READ_ONLY','REQUEST_CONFLICT']){const r=await setup({result:{error:code,status:409}}).request('/'+id+'?workId=10',{method:'PUT',key,body});assert.equal(r.status,409);assert.equal((await r.json()).error,code);}
  const r=await setup({dbFailure:true}).request('?workId=10');assert.equal(r.status,503);assert.ok(!(await r.text()).includes('private upstream'));
});
