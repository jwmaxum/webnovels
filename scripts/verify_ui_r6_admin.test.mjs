import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const sources=Object.fromEntries(await Promise.all(['admin-console','admin-workflow','admin-publication-changes'].map(async name=>[name,await readFile(new URL('../public/js/admin/'+name+'.js',import.meta.url),'utf8')])));
const id='11111111-1111-4111-8111-111111111111';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Node{
  constructor(tag='div'){this.tag=tag;this.children=[];this._text='';this.attributes={};this.dataset={};this.value='';this.disabled=false;}
  set textContent(value){this._text=String(value??'');this.children=[];}get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}
  set innerHTML(_){throw Error('Untrusted HTML is forbidden');}append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}setAttribute(key,value){this.attributes[key]=String(value);}
  querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(child=>[...(tags.includes(child.tag)?[child]:[]),...child.querySelectorAll(selector)]);}
}
const record={id,workId:'10',kind:'work',title:'실제 작품',action:'update',decision:null,createdAt:'2026-10-31T00:00:00Z'};
const change={arguments:{action:'update',data:{title:'변경 제목',version:'1'}},baseline:{work:{title:'현재 제목',description:'기존 소개',rating:'ALL',bank_info:'PRIVATE BANK'},state:{visibility:'PUBLIC',serial_state:'ONGOING',cover_file_id:null}},
  candidate:{after:{work:{title:'변경 제목',description:'변경 소개',rating:'AGE_15',bank_info:'PRIVATE BANK'},state:{visibility:'PUBLIC',serial_state:'COMPLETED'}},result:{privateField:'DO NOT DISPLAY'}}};
function setup({permissions=['CONTENT_REVIEW'],handler,superAdmin=false}={}){
  let who={userId:'admin-a',admin:{role:superAdmin?'SUPER_ADMIN':'SUB_ADMIN',is_active:true,permissions}},current=true;
  const root=new Node(),calls=[],destroyed=[],navigations=[],context={URLSearchParams,Date,crypto:webcrypto,
    document:{createElement:tag=>new Node(tag)},WEBNOVELS_CONFIG:{publicationChangeReviewEnabled:true,adminWorkflowEnabled:true,adminOperationsEnabled:true},
    WebNovelsAuth:{getActor:()=>who,api:async(url,options)=>{const action=new URL(url,'https://app.test').searchParams.get('action');calls.push({url,action,options});
      if(handler)return handler(action,options,calls.length);return action==='publication-changes'?{changes:[structuredClone(record)]}:action==='publication-change'?{change:structuredClone(change)}:{decision:'APPROVE'};}},
    ReaderContent:{render:(root,_comment,snapshot)=>{root.textContent=snapshot.content||'';}},ReaderWebtoon:{render(){},destroy:root=>destroyed.push(root)},AdminOperations:{navigate:page=>navigations.push(page)}};
  context.window=context;vm.createContext(context);for(const [name,source]of Object.entries(sources))vm.runInContext(source,context,{filename:name+'.js'});
  return {root,context,calls,destroyed,navigations,review:context.AdminPublicationChanges,console:context.AdminConsole,workflow:context.AdminWorkflow,
    valid:()=>current,setCurrent:value=>current=value,setActor:value=>who=value};
}
const button=(root,label)=>root.querySelectorAll('button').find(node=>node.textContent===label);

test('publication comparison uses supplied public/request fields and text without exposing arbitrary snapshot properties',async()=>{
  const unsafe=structuredClone(change);unsafe.baseline.work.title='<img onerror=1>';unsafe.candidate.after.work.title='constructor';
  const app=setup({handler:action=>action==='publication-changes'?{changes:[{...record,title:'<svg onload=1>'}]}:{change:unsafe}});
  await app.review.render(app.root,app.valid);await button(app.root,'변경 내용 확인').onclick();
  assert.match(app.root.textContent,/<img onerror=1>/);assert.match(app.root.textContent,/constructor/);assert.doesNotMatch(app.root.textContent,/function Object|PRIVATE BANK|DO NOT DISPLAY/);
  const rows=app.root.querySelectorAll('tr');assert(rows.some(row=>row.textContent.includes('작품명')&&row.textContent.includes('constructor')));
  assert(rows.some(row=>row.textContent.includes('연재 상태')&&row.textContent.includes('완결')));assert.equal(app.root.querySelectorAll('pre').length,0);
  assert(app.root.querySelectorAll('div').some(node=>node.attributes['aria-label']==='변경 요청 비교표'&&node.tabIndex===0));
  assert.deepEqual(app.calls.map(call=>call.action),['publication-changes','publication-change']);
});

test('review permission and reset/account changes prevent privileged reads or stale result presentation',async()=>{
  const denied=setup({permissions:['CASE_READ']});await denied.review.render(denied.root,denied.valid);assert.equal(denied.calls.length,0);assert.match(denied.root.textContent,/권한이 필요/);
  const pending=deferred(),app=setup({handler:()=>pending.promise});const loading=app.review.render(app.root,app.valid);
  app.review.reset();app.setActor({userId:'admin-b',admin:{role:'SUB_ADMIN',is_active:true,permissions:[]}});app.root.replaceChildren();
  await app.review.render(app.root,app.valid);pending.resolve({changes:[record]});await loading;
  assert.doesNotMatch(app.root.textContent,/실제 작품/);assert.match(app.root.textContent,/권한이 필요/);
});

test('lost review response retries the exact original decision/reason and updates the visible final state',async()=>{
  let attempts=0;const app=setup({handler:(action,options)=>{
    if(action==='publication-changes')return {changes:[structuredClone(record)]};if(action==='publication-change')return {change:structuredClone(change)};
    if(++attempts===1)throw Error('NETWORK_LOST');return {decision:JSON.parse(options.body).decision};
  }});await app.review.render(app.root,app.valid);await button(app.root,'변경 내용 확인').onclick();
  const reason=app.root.querySelectorAll('textarea')[0];reason.value='공개본과 요청 내용을 비교했습니다';await button(app.root,'승인하고 반영').onclick();
  assert.equal(reason.disabled,true);assert.equal(button(app.root,'반려·공개본 유지').disabled,true);reason.value='DOM 조작으로 바꾼 이유';
  await button(app.root,'승인하고 반영').onclick();const writes=app.calls.filter(call=>call.options);
  assert.equal(writes.length,2);assert.equal(writes[0].options.body,writes[1].options.body);assert.equal(JSON.parse(writes[0].options.body).reason,'공개본과 요청 내용을 비교했습니다');
  assert.match(app.root.textContent,/승인 완료/);assert.match(app.root.textContent,/승인한 변경을 반영/);assert.match(app.root.textContent,/검토 대기 0건/);
});

test('a stale detail or revoked review permission cannot show content or submit a decision',async()=>{
  const detail=deferred();const app=setup({handler:action=>action==='publication-changes'?{changes:[structuredClone(record)]}:detail.promise});
  await app.review.render(app.root,app.valid);const pending=button(app.root,'변경 내용 확인').onclick();app.setCurrent(false);app.review.reset();app.root.replaceChildren();
  detail.resolve({change:structuredClone(change)});await pending;assert.equal(app.root.children.length,0);
  const ready=setup();await ready.review.render(ready.root,ready.valid);await button(ready.root,'변경 내용 확인').onclick();ready.root.querySelectorAll('textarea')[0].value='검토 완료 사유';
  ready.setActor({userId:'admin-a',admin:{role:'SUB_ADMIN',is_active:true,permissions:[]}});await button(ready.root,'승인하고 반영').onclick();assert.equal(ready.calls.filter(call=>call.options).length,0);
});

test('distribution compares explicit requested values without inventing an unavailable prior distribution',async()=>{
  const item={...record,kind:'distribution'},value={...structuredClone(change),arguments:{action:'update',data:{mode:'NON_EXCLUSIVE',externalLinks:['https://www.munpia.com/novel/10']}}};
  const app=setup({handler:action=>action==='publication-changes'?{changes:[item]}:{change:value}});await app.review.render(app.root,app.valid);await button(app.root,'변경 내용 확인').onclick();
  assert.match(app.root.textContent,/요청 연재 형태: 비독점/);assert.match(app.root.textContent,/이전 연재 형태·링크가 포함되지 않습니다/);
  assert.equal(app.root.querySelectorAll('a').length,0,'request URLs are text, not unvalidated navigation');
});

test('review list failure has explicit retry and never appears as a successful empty queue',async()=>{
  let failed=true;const app=setup({handler:()=>{if(failed)throw Error('offline');return {changes:[]};}});await app.review.render(app.root,app.valid);
  assert.match(app.root.textContent,/불러오지 못했습니다/);assert.doesNotMatch(app.root.textContent,/검토할 요청이 없습니다/);failed=false;
  await button(app.root,'검토 목록 다시 불러오기').onclick();assert.match(app.root.textContent,/검토할 요청이 없습니다/);
});

test('dashboard puts actual pending counts and support entry before totals, without manufacturing unavailable counts',async()=>{
  const app=setup({superAdmin:true,handler:()=>({works:3,episodes:10,pendingReviews:7,pendingReports:2})});await app.console.render(app.root,'dashboard');
  const queue=app.root.children.find(node=>node.className==='cms-task-queue'),metrics=app.root.children.find(node=>node.className==='cms-metrics');
  assert(app.root.children.indexOf(queue)<app.root.children.indexOf(metrics));assert.match(queue.textContent,/기존 검수 대기 7건 · 신고 대기 2건/);
  assert.match(metrics.textContent,/확인 필요/);button(queue,'베타 운영 · 오류 및 문의 지원함').onclick();assert.equal(app.navigations[0],'beta-operations');
  assert.equal(app.root.attributes['aria-busy'],'false');
});

test('console/workflow busy states clear after errors and old actor responses never repopulate private rows',async()=>{
  const pending=deferred(),app=setup({superAdmin:true,handler:()=>pending.promise});const first=app.console.render(app.root,'works');assert.equal(app.root.attributes['aria-busy'],'true');
  app.setActor({userId:'admin-a',reader:{id:'reader-profile'}});pending.resolve({items:[{id:'10',title:'OLD PRIVATE ROW'}],total:1});await first;assert.doesNotMatch(app.root.textContent,/OLD PRIVATE ROW/);
  const failed=setup({handler:()=>{throw Error('offline');}});await failed.workflow.render(failed.root,'cases');assert.match(failed.root.textContent,/조회 실패/);assert.equal(failed.root.attributes['aria-busy'],'false');
  assert(button(failed.root,'다시 불러오기'));
});
