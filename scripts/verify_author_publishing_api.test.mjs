import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorDraftApi} from '../server/creator-draft-api.mjs';
import {publicationChangeApi} from '../server/publication-change-api.mjs';
import {creatorWorkApi} from '../server/creator-work-api.mjs';
const id='11111111-1111-4111-8111-111111111111';
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const actor=async()=>({userId:id,author:{status:'APPROVED'},admin:{is_active:true}});
const doc={version:1,paragraphs:[{align:'left',indent:0,runs:[{text:'본문',bold:true}]}]};
test('partial workspace denies legacy published mutations while new private works remain editable',async()=>{
 let count=1;const calls=[];
 const request=new Request('https://app.test/api/v2/creator/works/10',{method:'PATCH',headers:{Origin:'https://app.test'}});
 const ctx={request,actor,env:{},workspaceReady:true,readBody:async()=>({title:'새 제목',version:'1'}),fail,
 db:async(_path,_query,{body})=>{calls.push(body.p_action);return {work:{id:'10',visibility:'PRIVATE',episode_count:count}};}};
 await assert.rejects(creatorWorkApi(ctx),e=>e.code==='PUBLICATION_REVIEW_NOT_ACTIVATED');assert.deepEqual(calls,['get']);
 count=0;await creatorWorkApi(ctx);assert.deepEqual(calls,['get','get','update']);
});
test('formatted draft payload is gated, bounded and passed with exact actor, revision and idempotency key',async()=>{
 const data={title:'제목',content:'본문',authorComment:'',expectedRevision:'0',contentDocument:doc},calls=[];
 const request=new Request('https://app.test/api/v2/creator/drafts/'+id+'?workId=10',{method:'PUT',headers:{Origin:'https://app.test','Idempotency-Key':id}});
 const ctx={request,actor,fail,workspaceReady:true,readBody:async()=>data,db:async(...args)=>{calls.push(args);return {draft:{revision:'1'}};},env:{}};
 await assert.rejects(creatorDraftApi(ctx),e=>e.code==='INVALID_FIELD');assert.equal(calls.length,0);
 ctx.env.AUTHOR_RICH_TEXT_ENABLED='true';await creatorDraftApi(ctx);
 assert.deepEqual(calls[0][2].body.p_data,data);assert.equal(calls[0][2].body.p_user_id,id);assert.equal(calls[0][2].body.p_key,id);
 data.content='변경됨';await assert.rejects(creatorDraftApi(ctx),e=>e.code==='INVALID_CONTENT_DOCUMENT');assert.equal(calls.length,1);
});
test('review decisions require trusted active admin, origin and bounded reason',async()=>{
 const calls=[],data={changeId:id,decision:'APPROVE',reason:'검토 완료'};
 const base={env:{AUTHOR_PUBLICATION_REVIEW_ENABLED:'true'},actor,fail,readBody:async()=>data,db:async(...args)=>{calls.push(args);return {decision:'APPROVE'};}};
 await assert.rejects(publicationChangeApi({...base,request:new Request('https://app.test/api/v2/admin/workflow?action=publication-decision',{method:'POST'})}),e=>e.code==='ORIGIN_REQUIRED');
 const request=new Request('https://app.test/api/v2/admin/workflow?action=publication-decision',{method:'POST',headers:{Origin:'https://app.test'}});
 await assert.rejects(publicationChangeApi({...base,request,actor:async()=>({userId:id})}),e=>e.code==='ADMIN_REQUIRED');
 await publicationChangeApi({...base,request});assert.equal(calls[0][2].body.p_user,id);assert.deepEqual(calls[0][2].body.p_data,data);
 data.adminUserId=id;await assert.rejects(publicationChangeApi({...base,request}),e=>e.code==='INVALID_FIELD');assert.equal(calls.length,1);
});
test('review image fetch is authorized through RPC and cannot fetch arbitrary remote URLs',async()=>{
 let fetched=0;const request=new Request('https://app.test/api/v2/admin/workflow?action=publication-image&changeId='+id+'&side=after&panelId='+id);
 const base={request,env:{AUTHOR_PUBLICATION_REVIEW_ENABLED:'true'},actor,fail,base:'https://storage.test',serviceHeaders:{Authorization:'server-only'},fetchImpl:async()=>{fetched++;return new Response('png');}};
 await assert.rejects(publicationChangeApi({...base,db:async()=>({bucket:'authoring-webtoons',path:'https://evil.test',mime:'image/png'})}),e=>e.code==='STORAGE_UNAVAILABLE');assert.equal(fetched,0);
 const response=await publicationChangeApi({...base,db:async()=>({bucket:'authoring-webtoons',path:'webtoon/10/'+id+'/0/'+'a'.repeat(64)+'.png',mime:'image/png'})});
 assert.equal(fetched,1);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'image/png');
});
