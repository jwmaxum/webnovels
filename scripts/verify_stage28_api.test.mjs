import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecureApi} from '../server/secure-api.mjs';
const uid='11111111-1111-4111-8111-111111111111';
const env={P0_API_ENABLED:'true',AUTHOR_WORKS_ENABLED:'true',AUTHOR_DRAFTS_ENABLED:'true',AUTHOR_FILES_ENABLED:'true',AUTHOR_RECOVERY_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
function setup({author=true,role=null,status='APPROVED',result={works:[],nextCursor:null},dbFailure=false}={}){
  const calls=[];
  const api=createSecureApi({fetchImpl:async(input,init)=>{
    const path=new URL(input).pathname;calls.push({path,body:init.body&&JSON.parse(init.body)});
    if(path==='/auth/v1/user')return Response.json({id:uid,email_confirmed_at:'2026-09-23'});
    if(path.endsWith('/p0_migration_status'))return Response.json([{phase:'locked'}]);
    if(path.endsWith('/authors'))return Response.json(author?[{id:1,status,auth_user_id:uid}]:[]);
    if(path.endsWith('/readers'))return Response.json([{id:1,status:'ACTIVE',auth_user_id:uid}]);
    if(path.endsWith('/admin_users'))return Response.json(role?[{id:1,role,is_active:true}]:[]);
    if(path.endsWith('/creator_draft_recovery'))return dbFailure?new Response('private upstream detail',{status:500}):Response.json(result);
    throw new Error('unexpected '+path);
  }});
  const request=(path='',{method='GET',body,origin='https://app.test',key,bindings=env}={})=>api(new Request('https://app.test/api/v2/creator/drafts'+path,{method,headers:{Authorization:'Bearer real.jwt.token',...(origin?{Origin:origin}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),bindings);
  return {calls,request};
}
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const body={expectedRevision:'2',episodeId:'9007199254740993',fileId:id,targetDigest:'a'.repeat(32),note:'원본과 수정본 설명',confirmed:true};
const path='/'+id+'/recovery?workId=9007199254740995';
test('recovery options and submit use verified actor and exact bigint strings in the existing draft route',async()=>{
 const s=setup({result:{request:{id,status:'PENDING'}}});assert.equal((await s.request(path)).status,200);
 assert.equal(s.calls.at(-1).body.p_action,'options');
 assert.equal((await s.request(path,{method:'POST',key,body})).status,200);
 const rpc=s.calls.at(-1);assert.ok(rpc.path.endsWith('/creator_draft_recovery'));assert.equal(rpc.body.p_user_id,uid);assert.equal(rpc.body.p_work_id,'9007199254740995');assert.equal(rpc.body.p_id,id);assert.equal(rpc.body.p_key,key);assert.deepEqual(rpc.body.p_data,body);
 assert.equal((await s.request(path+'&before=9007199254740993')).status,200);assert.equal(s.calls.at(-1).body.p_after,'9007199254740993');
});
test('recovery requires active verified author and existing flags, including files',async()=>{
 for(const options of [{author:false},{author:false,role:'SUPER_ADMIN'},{status:'SUSPENDED'}])assert.equal((await setup(options).request(path)).status,403);
 for(const flag of ['AUTHOR_FILES_ENABLED','AUTHOR_WORKS_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_RECOVERY_ENABLED'])assert.equal((await setup().request(path,{bindings:{...env,[flag]:'false'}})).status,503);
});
test('explicit confirmation, revisions and identifiers reject ambiguous types and injected ownership/publishing fields',async()=>{
 const s=setup();for(const field of ['author_id','userId','status','episode_id','fileSha256','content','rightsApproved'])assert.equal((await s.request(path,{method:'POST',key,body:{...body,[field]:'test'}})).status,400);
 for(const [field,values]of Object.entries({expectedRevision:['0',0,'9223372036854775808'],episodeId:[null,9007199254740992,'01','-1'],fileId:['100',null],targetDigest:['x'.repeat(32),null],confirmed:[false,'true'],note:[null,'x'.repeat(2001)]}))for(const value of values)assert.equal((await s.request(path,{method:'POST',key,body:{...body,[field]:value}})).status,400);
 assert.equal((await s.request('/'+id+'/recovery?workId=0')).status,400);assert.equal((await s.request(path+'&unknown=1')).status,400);
});
test('cross-origin/unkeyed writes, unsupported methods and submit pagination fail closed',async()=>{
 const s=setup();for(const origin of [null,'https://evil.test'])assert.equal((await s.request(path,{method:'POST',key,body,origin})).status,403);
 assert.equal((await s.request(path,{method:'POST',body})).status,400);assert.equal((await s.request(path+'&before=0',{method:'POST',key,body})).status,400);
 for(const method of ['PUT','DELETE'])assert.equal((await s.request(path,{method})).status,405);
});
test('ownership/target/version conflicts and RPC unavailability preserve errors without leaking upstream',async()=>{
 for(const [status,error]of [[404,'SOURCE_FILE_NOT_FOUND'],[409,'DRAFT_REVISION_CONFLICT'],[409,'RECOVERY_TARGET_CONFLICT'],[409,'REQUEST_CONFLICT']]){
 const r=await setup({result:{error,status}}).request(path,{method:'POST',key,body});assert.equal(r.status,status);assert.equal((await r.json()).error,error);}
 const r=await setup({dbFailure:true}).request(path);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('private upstream'));
});
