import test from 'node:test';
import assert from 'node:assert/strict';
import {adminWorkflowApi} from '../server/admin-workflow-api.mjs';
import {stage9Api} from '../server/stage9-api.mjs';
import {stage9AppealApi} from '../server/stage9-appeal-api.mjs';
import {adminConsoleApi} from '../server/admin-console-api.mjs';
import {stage16Catalog} from '../server/stage16-api.mjs';
import {createSecureApi} from '../server/secure-api.mjs';
const id='11111111-1111-4111-8111-111111111111';
const env={P0_API_ENABLED:'true',ADMIN_WORKFLOW_ENABLED:'true',ADMIN_OPERATIONS_ENABLED:'true'};
const actor={userId:id,admin:{id:'22222222-2222-4222-8222-222222222222',role:'SUPER_ADMIN',is_active:true}};
const fail=(status,code)=>{throw Object.assign(Error(code),{status,code});};
const payload={requestId:id,reason:'근거 확인',source:'CONTENT_REVIEW',caseId:id,revision:'0',targetVersion:'',assigneeId:null,priority:'HIGH',dueAt:null,evidence:'원본 확인',duplicateId:null};
async function invoke(action,{data,query='',settings=env,who=actor,method=data?'POST':'GET',origin='https://example.test',result={saved:true}}={}){
 const calls=[],request=new Request('https://example.test/api/v2/admin/workflow?action='+action+query,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const args={request,env:settings,actor:async()=>who,readBody:request=>request.json(),fail,db:async(path,query,options)=>{calls.push({path,body:options.body});return result;}};
 return {output:await adminWorkflowApi(args),calls,args};
}
test('workflow gates, method and authenticated actor are mandatory; client identity cannot override RPC actor',async()=>{
 for(const name of Object.keys(env))await assert.rejects(invoke('cases',{query:'&source=REPORT',settings:{...env,[name]:'false'}}),{status:503});
 await assert.rejects(invoke('cases',{query:'&source=REPORT',who:{userId:id}}),{status:403});
 await assert.rejects(invoke('cases',{query:'&source=REPORT',method:'POST'}),{status:405});
 const result=await invoke('case-update',{data:payload});assert.equal(result.calls[0].body.p_user,id);assert.equal(result.calls[0].path,'rpc/stage17_admin');
 await assert.rejects(invoke('case-update',{data:{...payload,userId:id}}),{status:400});
 const response=await createSecureApi()(new Request('https://example.test/api/v2/admin/workflow?action=cases&source=REPORT'),{});assert.equal(response.status,503);
});
test('workflow rejects duplicate query keys, cross-origin posts, malformed identifiers and unbounded fields',async()=>{
 for(const query of ['&source=REPORT&source=REPORT','&source=REPORT&actorId='+id,'&source=UNKNOWN','&source=REPORT&offset=100001'])await assert.rejects(invoke('cases',{query}),{status:400});
 await assert.rejects(invoke('case-update',{data:payload,origin:'https://evil.test'}),{status:403});
 for(const changes of [{requestId:'bad'},{revision:'9223372036854775808'},{assigneeId:'1'},{dueAt:'infinity'},{evidence:'x'},{evidence:'x'.repeat(2001)},{priority:'SUPER'},{duplicateId:'bad'},{reason:'x'},{reason:'x'.repeat(501)},{caseId:'1'}])
  await assert.rejects(invoke('case-update',{data:{...payload,...changes}}),{status:400},JSON.stringify(Object.keys(changes)));
 const incomplete={...payload};delete incomplete.priority;await assert.rejects(invoke('case-update',{data:incomplete}),{status:400});
 await assert.rejects(invoke('account-support',{query:'&kind=reader&accountId=1'}),{status:400});
 await assert.rejects(invoke('draft-read',{data:{requestId:id,reason:'초안 열람',source:'REPORT',caseId:id,draftId:id}}),{status:400});
});
test('all mutation payloads keep typed identifiers and service failures retain safe conflict codes',async()=>{
 const cases={
  'case-resolve':{source:'REPORT',caseId:id,revision:'1',decision:'REJECT'},
  'appeal-resolve':{appealId:id,decision:'ACCEPT'},'appeal-followup':{appealId:id,decision:'MAINTAIN',targetVersion:''},
  moderate:{workId:'9223372036854775807',version:'3',decision:'RESTRICT'},
  'account-moderate':{kind:'reader',accountId:id,expectedStatus:'ACTIVE',decision:'SUSPEND'},
  'curation-save':{placementId:id,revision:'0',workId:'10',slot:'HOME_SPOTLIGHT',position:8,startsAt:'2026-10-09T00:00:00Z',endsAt:'2026-10-10T00:00:00Z',enabled:true},
  'draft-read':{source:'CONTENT_REVIEW',caseId:id,draftId:id}
 };
 for(const [action,data] of Object.entries(cases)){const result=await invoke(action,{data:{requestId:id,reason:'명시한 사유',...data}});assert.equal(result.calls[0].body.p_action,action);}
 await assert.rejects(invoke('case-update',{data:payload,result:{status:409,error:'CASE_CONFLICT'}}),{status:409,code:'CASE_CONFLICT'});
 await assert.rejects(invoke('cases',{query:'&source=REPORT',result:null}),{status:503});
});
test('workflow activation closes every legacy mutation bypass but leaves role reauthentication console intact',async()=>{
 for(const action of ['case-resolve','appeal-resolve','moderate','curate','role-update','account-moderate']){
  const request=new Request('https://example.test/api/v2/admin/operations?action='+action,{method:'POST'});
  await assert.rejects(stage9Api({request,env,fail}),{code:'ADMIN_WORKFLOW_REQUIRED'});
 }
 const request=new Request('https://example.test/api/v2/admin/console?action=curation-update',{method:'POST'});
 await assert.rejects(adminConsoleApi({request,actor,env,fail}),{code:'ADMIN_WORKFLOW_REQUIRED'});
 const legacyRequest=new Request('https://example.test/api/v2/admin/console?action=curation-update',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({workId:'10',revision:'0',flags:{is_top_recommended:true,is_popular_work:false,is_new_work:false},reason:'편집 추천'})});
 const legacy=await adminConsoleApi({request:legacyRequest,actor,user:{id},env:{...env,P0_API_ENABLED:'false'},fail,rpc:async()=>({saved:true})});assert.equal(legacy.saved,true);
 const calls=[];
 const result=await stage9AppealApi({request:new Request('https://example.test/api/v2/appeals?action=my'),env,actor:async()=>({userId:id,author:{id:'7'}}),fail,
  db:async(path,q,{body})=>{calls.push({path,body});return {appeals:[]};}});
 assert.deepEqual(result.appeals,[]);assert.deepEqual(calls,[{path:'rpc/stage17_my_appeals',body:{p_user:id}}]);
});
test('scheduled public recommendation projection preserves real rankings and excludes private fields',async()=>{
 const work={id:'10',author_id:'7',status:'PUBLISHED',rating:'ALL',content_type:'NOVEL',ranking_readers:6,title:'편집 선정',content:'PRIVATE'};
 const ranking={periodDays:7,minSample:5,metric:'uniqueReaders',asOf:new Date().toISOString()};
 let placements=[{slot:'HOME_SPOTLIGHT',position:1,work}];
 const args={url:new URL('https://example.test/api/v2/catalog?action=home'),env:{...env,READER_DISCOVERY_ENABLED:'true',READER_SERVICE_ENABLED:'true',AUTHOR_PUBLISH_ENABLED:'true'},fail,
  db:async path=>path==='rpc/stage16_catalog'?{sections:{recommended:[work],popular:[work],new:[],completed:[]},ranking}:{placements}};
 const result=await stage16Catalog(args);assert.equal(result.sections.popular[0].ranking_readers,6);assert.equal(result.sections.recommended.length,0);
 assert.equal(result.sections.spotlight[0].title,'편집 선정');assert.equal(result.sections.spotlight[0].content,undefined);
 placements=[...placements,...placements];await assert.rejects(stage16Catalog(args),{code:'CURATION_UNAVAILABLE'});
 placements=[{slot:'HOME_SPOTLIGHT',position:1,work:{...work,status:'DRAFT'}}];await assert.rejects(stage16Catalog(args),{code:'CATALOG_UNAVAILABLE'});
});
