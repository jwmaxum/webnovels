import test from 'node:test';
import assert from 'node:assert/strict';
import {stage8Api} from '../server/stage8-api.mjs';

const who={userId:'22222222-2222-4222-8222-222222222222',
  reader:{status:'ACTIVE'},author:{status:'APPROVED'}};
const env={AUTHOR_PUBLISH_ENABLED:'true',READER_SERVICE_ENABLED:'true',AUTHOR_OPERATIONS_ENABLED:'true'};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
async function invoke(path,{method='GET',data,identity=who,settings=env,catalog={works:[],episodes:[]}}={}){
  const calls=[];
  const request=new Request('https://example.test'+path,{method,
    ...(data?{headers:{Origin:'https://example.test','Content-Type':'application/json'},
      body:JSON.stringify(data)}:{})});
  const result=await stage8Api({request,env:settings,actor:async()=>identity,
    db:async(route,query,options)=>{calls.push({route,options});return route==='rpc/stage8_catalog'?catalog:{ok:true};},
    readBody:async()=>data,fail});
  return {result,calls};
}
test('anonymous catalog uses only the service RPC and requires both rollout gates',async()=>{
  const {calls}=await invoke('/api/v2/catalog');
  assert.equal(calls[0].route,'rpc/stage8_catalog');
  await assert.rejects(invoke('/api/v2/catalog',{settings:{...env,READER_SERVICE_ENABLED:'false'}}),
    {code:'READER_SERVICE_NOT_ACTIVATED'});
});
test('public API excludes adult and unsupported works plus paid and future episode metadata',async()=>{
  const work={id:'10',status:'PUBLISHED',rating:'ALL',content_type:'NOVEL',genre:['판타지']};
  const episode={id:'100',work_id:'10',status:'PUBLISHED',is_free:true,access_policy:'FREE'};
  const {result}=await invoke('/api/v2/catalog',{catalog:{works:[work,
    {...work,id:'20',rating:'AGE_19'},{...work,id:'30',genre:['19세 이상']},
    {...work,id:'40',content_type:'WEBTOON'},{...work,id:'50',status:'DRAFT'}],
    episodes:[episode,{...episode,id:'101',is_free:false},{...episode,id:'102',access_policy:'PAID'},
      {...episode,id:'103',work_id:'20'},{...episode,id:'104',scheduled_at:'2999-01-01'},
      {...episode,id:'105',scheduled_at:'invalid'}]}});
  assert.deepEqual(result.works,[work]);assert.deepEqual(result.episodes,[episode]);
  await assert.rejects(invoke('/api/v2/catalog',{catalog:{works:[]}}),{code:'CATALOG_UNAVAILABLE'});
});
test('reader write sends the verified Auth UUID and fixed query IDs',async()=>{
  const {calls}=await invoke('/api/v2/reader/hub?action=progress&workId=10&episodeId=100',
    {method:'POST',data:{progress:80}});
  assert.equal(calls[0].route,'rpc/stage8_reader');
  assert.deepEqual(calls[0].options.body,{p_user:who.userId,p_action:'progress',
    p_data:{progress:80,workId:'10',episodeId:'100'}});
  await assert.rejects(invoke('/api/v2/reader/hub?action=progress&workId=10&episodeId=100',
    {method:'POST',data:{progress:101}}),{code:'INVALID_PROGRESS'});
  await assert.rejects(invoke('/api/v2/reader/hub?action=favorite&workId=10',
    {method:'POST',data:{enabled:true,authorId:'1'}}),{code:'INVALID_FIELD'});
  await assert.rejects(invoke('/api/v2/reader/hub?action=favorite&workId=9223372036854775808',
    {method:'POST',data:{enabled:true}}),{code:'INVALID_WORK_ID'});
  await assert.rejects(invoke('/api/v2/reader/hub?action=comment&workId=10&episodeId=100',
    {method:'POST',data:{content:'본문',userId:who.userId}}),{code:'FIELD_NOT_ALLOWED'});
});
test('profile change uses only the verified Auth UUID and nickname',async()=>{
  const {calls}=await invoke('/api/v2/reader/hub?action=profile',
    {method:'POST',data:{nickname:'새 필명'}});
  assert.equal(calls[0].route,'rpc/stage10_reader_profile');
  assert.deepEqual(calls[0].options.body,{p_user:who.userId,p_nickname:'새 필명'});
  await assert.rejects(invoke('/api/v2/reader/hub?action=profile&workId=10',
    {method:'POST',data:{nickname:'새 필명'}}),{code:'INVALID_QUERY'});
  await assert.rejects(invoke('/api/v2/reader/hub?action=profile',
    {method:'POST',data:{nickname:'새 필명',userId:who.userId}}),{code:'INVALID_NICKNAME'});
  await assert.rejects(invoke('/api/v2/reader/hub?action=profile',
    {method:'POST',data:{nickname:'새 필명'},identity:{...who,reader:{status:'SUSPENDED'}}}),
    {code:'READER_REQUIRED'});
});
test('public comment read is anonymous while author actions require owned profile at DB',async()=>{
  const {calls}=await invoke('/api/v2/reader/hub?action=comments&workId=10&episodeId=100',
    {identity:null});
  assert.equal(calls[0].route,'rpc/stage8_comments');
  const owner=await invoke('/api/v2/creator/operations?action=policy&workId=10');
  assert.equal(owner.calls[0].options.body.p_user,who.userId);
  await assert.rejects(invoke('/api/v2/creator/operations?action=hide&workId=10',
    {method:'POST',data:{commentId:'bad'}}),{code:'INVALID_COMMENT_ID'});
  await assert.rejects(invoke('/api/v2/creator/operations?action=policy&workId=10',
    {identity:{...who,author:null}}),{code:'AUTHOR_REQUIRED'});
});
