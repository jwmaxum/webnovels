import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {adminWorkflowApi} from '../server/admin-workflow-api.mjs';
import {creatorDraftApi} from '../server/creator-draft-api.mjs';
import {recoveryReviewEnabled} from '../server/recovery-review-policy.mjs';
import {onRequestGet} from '../functions/api/public-config.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user='11111111-1111-4111-8111-111111111111';
const flags=['P0_API_ENABLED','ADMIN_OPERATIONS_ENABLED','ADMIN_WORKFLOW_ENABLED','AUTHOR_WORKS_ENABLED','AUTHOR_DRAFTS_ENABLED','AUTHOR_FILES_ENABLED','AUTHOR_RECOVERY_ENABLED','ADMIN_RECOVERY_REVIEW_ENABLED'];
const env=Object.fromEntries(flags.map(k=>[k,'true']));
const payload={recoveryId:id,requestId:id,reason:'검토 자료 확인',contextDigest:'a'.repeat(32),kind:'manuscript'};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
function setup({action='recovery-source',data=payload,method='POST',origin='https://app.test',extra='',environment=env,result={accessId:id,content:'고정 제출본'},who={userId:user,admin:{is_active:true,role:'SUPER_ADMIN'}},fetchImpl}={}){
 const calls=[];return {calls,run:()=>adminWorkflowApi({request:new Request('https://app.test/api/v2/admin/workflow?action='+action+extra,{method,headers:{...(origin?{origin}:{}),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(data)}:{})}),
  env:environment,actor:async()=>who,readBody:r=>r.json(),fail,db:async(...args)=>{calls.push(args);return result;},fetchImpl,base:'https://fixture.supabase.co',serviceHeaders:{apikey:'fixture-private-key'}})};
}
test('runtime public flag defaults off and requires every prerequisite, without exposing private settings',async()=>{
 for(const off of [null,...flags]){const e=off?{...env,[off]:'false'}:env;assert.equal(recoveryReviewEnabled(e),!off);
  const body=await onRequestGet({env:{...e,NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'private-fixture'}}).text();
  assert.ok(body.includes('"adminRecoveryReviewEnabled":'+!off));assert.ok(!body.includes('private-fixture'));
 }
 assert.equal(recoveryReviewEnabled({}),false);await assert.rejects(setup({environment:{...env,ADMIN_RECOVERY_REVIEW_ENABLED:'false'}}).run(),e=>e.status===503);
});
test('strict fields, methods, IDs, same origin and verified actor are required before RPC dispatch',async()=>{
 for(const args of [{method:'GET'},{origin:null},{origin:'https://evil.test'},{extra:'&action=recovery-source'},{extra:'&workId=1'},
  {data:{...payload,userId:user}},{data:{...payload,recoveryId:'1'}},{data:{...payload,contextDigest:'x'}},{data:{...payload,reason:'x'}},{data:{...payload,kind:'current'}},
  {data:null},{who:{userId:user,admin:{role:'SUPER_ADMIN',is_active:false}}},{action:'recovery-bogus'}]){
  const s=setup(args);await assert.rejects(s.run());assert.equal(s.calls.length,0);
 }
 const s=setup();await s.run();assert.equal(s.calls[0][0],'rpc/stage29_admin_recovery');assert.equal(s.calls[0][2].body.p_user,user);assert.ok(!('p_work_id' in s.calls[0][2].body));
});
test('metadata queries and decisions validate exact bigint strings and propagate only safe RPC statuses',async()=>{
 for(const action of ['recovery-list','recovery-detail']){const s=setup({action,method:'GET',extra:action==='recovery-detail'?'&recoveryId='+id:'&offset=50'});await s.run();assert.equal(s.calls.length,1);}
 for(const extra of ['&offset=100001','&offset=-1','&offset=0&offset=1'])await assert.rejects(setup({action:'recovery-list',method:'GET',extra}).run());
 await assert.rejects(setup({action:'recovery-detail',method:'GET'}).run());
 const d={recoveryId:id,requestId:id,contextDigest:'a'.repeat(32),revision:'0',decision:'HOLD',evidence:'',accessId:null,rightsChecked:false,ratingChecked:false,aiChecked:false,reason:'자료 보완'};
 await setup({action:'recovery-decide',data:d}).run();
 for(const invalid of [{revision:0},{revision:'9223372036854775807'},{decision:'APPROVED'},{accessId:'1'},{aiChecked:'true'},{evidence:'x'.repeat(2001)}])await assert.rejects(setup({action:'recovery-decide',data:{...d,...invalid}}).run());
 for(const status of [400,403,404,409,500])await assert.rejects(setup({result:{error:'SAFE_ERROR',status}}).run(),e=>e.status===(status===500?503:status));
 for(const result of [null,[]])await assert.rejects(setup({result}).run(),e=>e.status===503);
});
test('original bytes are fetched only from frozen private storage, bounded and SHA checked before attachment',async()=>{
 const bytes=new TextEncoder().encode('원본 bytes'),sha=createHash('sha256').update(bytes).digest('hex'),result={accessId:id,file:{bucket:'authoring-originals',key:'owner/work/file.hwpx',sha256:sha,size:String(bytes.length)}};
 const calls=[],fetchImpl=async(url,options)=>{calls.push({url:String(url),options});return new Response(bytes);};
 const r=await setup({data:{...payload,kind:'original'},result,fetchImpl}).run();assert.ok(r instanceof Response);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-disposition'),/^attachment/);
 assert.equal(calls[0].url,'https://fixture.supabase.co/storage/v1/object/authenticated/authoring-originals/owner/work/file.hwpx');assert.equal(calls[0].options.redirect,'manual');
 for(const file of [{...result.file,bucket:'public'},{...result.file,key:'../secret'},{...result.file,sha256:'x'},{...result.file,size:'2097153'},{...result.file,size:'0'},null])await assert.rejects(setup({data:{...payload,kind:'original'},result:{...result,file},fetchImpl}).run(),e=>e.status===503);
 for(const wrong of [new Uint8Array(bytes.length),new Uint8Array(bytes.length+1),new Uint8Array(bytes.length-1)])await assert.rejects(setup({data:{...payload,kind:'original'},result,fetchImpl:async()=>new Response(wrong)}).run(),e=>e.code==='RECOVERY_FILE_CHECKSUM_MISMATCH');
 await assert.rejects(setup({data:{...payload,kind:'original'},result,fetchImpl:async()=>new Response(null,{status:404})}).run(),e=>e.code==='STORAGE_UNAVAILABLE');
 await assert.rejects(setup({data:{...payload,kind:'original'},result,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})}).run(),e=>e.code==='STORAGE_UNAVAILABLE');
});
test('author feedback is independently owner-authorized and cannot rewrite immutable submission result',async()=>{
 const result={request:{id,status:'PENDING'}},calls=[];
 const run=(environment=env,feedback={reviews:{[id]:{status:'HOLD',reason:'자료 보완'}}})=>creatorDraftApi({request:new Request('https://app.test/api/v2/creator/drafts/'+id+'/recovery?workId=10'),env:environment,actor:async()=>({userId:user,author:{id:'1',status:'APPROVED'}}),fail,
  db:async(table,q,args)=>{calls.push({table,args});return table==='rpc/creator_recovery_review_status'?feedback:structuredClone(result);}});
 const r=await run();assert.equal(r.request.status,'PENDING');assert.equal(r.request.review.status,'HOLD');assert.equal(calls[1].args.body.p_user,user);assert.equal(calls[1].args.body.p_work,'10');assert.equal(calls[1].args.body.p_request,id);assert.equal(r.reviewAvailable,true);
 calls.length=0;assert.equal((await run({...env,ADMIN_RECOVERY_REVIEW_ENABLED:'false'})).reviewAvailable,false);assert.equal(calls.length,1);
 await assert.rejects(run(env,{error:'DRAFT_NOT_FOUND',status:404}),e=>e.status===404);await assert.rejects(run(env,{}),e=>e.status===503);
 const requests=await creatorDraftApi({request:new Request('https://app.test/api/v2/creator/drafts/'+id+'/recovery?workId=10'),env,actor:async()=>({userId:user,author:{status:'APPROVED'}}),fail,db:async table=>table==='rpc/creator_recovery_review_status'?{reviews:{}}:{requests:[{id,status:'PENDING'}]}});assert.equal(requests.requests[0].review,null);
});
