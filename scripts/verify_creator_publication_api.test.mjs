import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorPublicationApi } from '../server/creator-publication-api.mjs';

const uid='11111111-1111-4111-8111-111111111111';
const draft='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env={AUTHOR_PUBLISH_ENABLED:'true',AUTHOR_WORKS_ENABLED:'true',AUTHOR_DRAFTS_ENABLED:'true'};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
function setup({denied=false}={}) {
  const calls=[];
  const db=async(_table,_query,{body})=>{
    calls.push(body);
    if(denied)return {error:'WORK_NOT_FOUND',status:404};
    return {publication:{episodeId:'100',status:'PUBLISHED'},publications:[],episodeNumber:4};
  };
  const run=(path,{method='GET',data=null,origin='https://app.test',who={userId:uid,author:{status:'APPROVED'}},bindings=env,requestKey=key}={})=>
    creatorPublicationApi({
      request:new Request('https://app.test/api/v2/creator/publications'+path+'?workId=10',{
        method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':requestKey},
        ...(data?{body:JSON.stringify(data)}:{})
      }),
      env:bindings,actor:async()=>who,db,readBody:r=>r.json(),fail
    });
  return {run,calls};
}
const payload={revision:'2',episodeNumber:4,mode:'NOW',rightsConfirmed:true};
test('publish forwards only an owner-authenticated immutable revision and request key',async()=>{
  const s=setup();
  const result=await s.run('/publish/'+draft,{method:'POST',data:payload});
  assert.equal(result.publication.status,'PUBLISHED');
  assert.deepEqual(s.calls[0],{
    p_user_id:uid,p_action:'publish',p_work_id:'10',p_draft_id:draft,
    p_episode_id:null,p_data:payload,p_key:key
  });
  await assert.rejects(setup({denied:true}).run('/publish/'+draft,{method:'POST',data:payload}),e=>e.status===404);
});
test('publish gate, origin, role and payload reject before the RPC',async()=>{
  const s=setup();
  await assert.rejects(s.run('/publish/'+draft,{method:'POST',data:payload,origin:'https://other.test'}),e=>e.status===403);
  await assert.rejects(s.run('/publish/'+draft,{method:'POST',data:{...payload,authorId:2}}),e=>e.status===400);
  await assert.rejects(s.run('/publish/'+draft,{method:'POST',data:{...payload,rightsConfirmed:false}}),e=>e.status===400);
  await assert.rejects(s.run('/publish/'+draft,{method:'POST',data:payload,who:{userId:uid,author:null}}),e=>e.status===403);
  await assert.rejects(s.run('/publish/'+draft,{method:'POST',data:payload,bindings:{...env,AUTHOR_PUBLISH_ENABLED:'false'}}),e=>e.status===503);
  assert.equal(s.calls.length,0);
});
test('schedule accepts explicit UTC, timezone and generation; unknown fields fail',async()=>{
  const s=setup();
  const scheduled={...payload,mode:'SCHEDULED',dueAt:'2026-10-01T01:00:00.000Z',displayTimezone:'Asia/Seoul'};
  await s.run('/publish/'+draft,{method:'POST',data:scheduled});
  await s.run('/schedule/100',{method:'POST',data:{generation:1,dueAt:scheduled.dueAt,displayTimezone:'Asia/Seoul'}});
  await s.run('/cancel/100',{method:'POST',data:{generation:2}});
  assert.deepEqual(s.calls.map(c=>c.p_action),['publish','reschedule','cancel']);
  await assert.rejects(s.run('/schedule/100',{method:'POST',data:{generation:1,dueAt:'tomorrow',displayTimezone:'Asia/Seoul'}}),e=>e.status===400);
  await assert.rejects(s.run('/cancel/100',{method:'POST',data:{generation:1,force:true}}),e=>e.status===400);
});
test('suggest, list and edit require the same author and exact work ID',async()=>{
  const s=setup();
  assert.equal((await s.run('/suggest')).episodeNumber,4);
  await s.run('');
  await s.run('/edit/100',{method:'POST',data:{draftId:draft}});
  assert.equal(s.calls.at(-1).p_episode_id,'100');
  await assert.rejects(s.run('/suggest',{who:{userId:uid,author:null}}),e=>e.status===403);
  await assert.rejects(s.run('/edit/100',{method:'POST',data:{draftId:draft,workId:'20'}}),e=>e.status===400);
});
