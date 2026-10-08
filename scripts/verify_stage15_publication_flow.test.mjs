import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const paths=['creator-readiness.js','creator-publications.js'].map(p=>fileURLToPath(new URL('../public/js/creator/'+p,import.meta.url)));
const sources=await Promise.all(paths.map(p=>readFile(p,'utf8')));
const node=()=>({hidden:false,disabled:false,checked:false,value:'',textContent:'',innerHTML:'',children:[],classList:{add(){},remove(){}},
  replaceChildren(){this.children=[];this.textContent='';},append(...items){this.children.push(...items);},setAttribute(){}});
function setup(){
  const nodes=new Map(),storage=new Map(),calls=[],marked=[],refreshed=[],next=[],radio={value:'NOW',checked:true};
  let actor={userId:'user-a',author:{id:'101',status:'APPROVED'}},lists=0,prepares=0;
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const draft={userId:'user-a',workId:'10',id:'draft-uuid',revision:'2',seq:3,snapshot:{title:'title',content:'body'}};
  const fixture={missing:[],rows:[],afterPublishListFailure:false,publishError:null,markError:false,publishStatus:'PUBLISHED'};
  const window={WEBNOVELS_CONFIG:{authorPublishEnabled:true},WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{
    calls.push({path,options});
    if(path.startsWith('/api/v2/creator/works/'))return {work:{id:'10',title:'work',publication_missing:fixture.missing,rating:'ALL',moderation_state:'CLEAR'},episodes:[]};
    if(path.includes('/suggest'))return {episodeNumber:1};
    if(path.includes('/cancel/'))return {publication:{status:'CANCELLED',draftId:draft.id,episodeNumber:1}};
    if(path.includes('/publish/')){if(fixture.publishError)throw fixture.publishError;return {publication:{status:fixture.publishStatus,episodeNumber:1,draftId:draft.id,revision:'2',dueAt:'2030-01-01T00:00:00Z',displayTimezone:'Asia/Seoul'}};}
    lists++;if(lists>1&&fixture.afterPublishListFailure)throw Error('NETWORK');return {publications:fixture.rows};
  }},CreatorDraftEditor:{getFileContext:()=>draft,preparePublication:async()=>{prepares++;return structuredClone(draft);},markPublished:async expected=>{marked.push(expected);if(fixture.markError)throw Error('LOCAL_SAVE_FAILED');},refreshPublicationState:async expected=>{refreshed.push(expected);if(fixture.refreshError)throw Error('LOCAL_SAVE_FAILED');},startNext:async id=>next.push(id)},
  ReaderContent:{render:(body,_,snapshot)=>body.textContent=snapshot.content},openModal(){},closeModal(){}};
  const context={window,document:{readyState:'complete',getElementById:get,createElement:node,querySelector:()=>radio,querySelectorAll:()=>[radio]},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=> 'publish-key'},Date,location:{origin:'https://app.test'},navigator:{}};
  sources.forEach((source,index)=>vm.runInNewContext(source,context,{filename:paths[index]}));
  const pending={key:'prior-key',data:{revision:'2',episodeNumber:1,mode:'NOW',rightsConfirmed:true}};
  return {window,get,storage,calls,marked,refreshed,next,draft,fixture,pending,setActor:value=>actor=value,get prepares(){return prepares;},key:'creator-publication:user-a:draft-uuid'};
}
test('incomplete first publication still previews; new publish needs metadata and explicit rights',async()=>{
  const s=setup();s.fixture.missing=['소개'];await s.window.CreatorPublications.open('10');assert.equal(s.get('publicationPreviewBody').textContent,'body');
  await s.get('publicationCommit').onclick();assert.match(s.get('publicationMessage').textContent,/권리/);
  s.get('publicationRights').checked=true;await s.get('publicationCommit').onclick();assert.equal(s.calls.filter(c=>c.path.includes('/publish/')).length,0);
  assert.match(s.get('publicationChecklist').innerHTML,/소개/);assert.match(s.get('publicationMessage').textContent,/작품 소개/);
});
test('reopened ambiguous publication retries exact prior payload even with later edits and incomplete checklist',async()=>{
  const s=setup();s.storage.set(s.key,JSON.stringify(s.pending));s.fixture.missing=['소개'];s.draft.snapshot.content='later';s.draft.revision='3';
  await s.window.CreatorPublications.open('10');assert.equal(s.prepares,0);assert.equal(s.get('publicationRetryPanel').hidden,false);assert.equal(s.get('publicationDraftPanel').hidden,true);
  await s.get('publicationRetry').onclick();const call=s.calls.find(c=>c.path.includes('/publish/'));
  assert.equal(call.options.headers['Idempotency-Key'],'prior-key');assert.deepEqual(JSON.parse(call.options.body),s.pending.data);assert.equal(s.marked[0].seq,-1);
  assert.equal(s.storage.size,0);assert.equal(s.get('publicationResult').hidden,false);await s.get('publicationNext').onclick();assert.deepEqual(s.next,['10']);
});
test('confirmed prior request shows result without requiring mutable active draft; reader links only for PUBLISHED',async()=>{
  const s=setup();s.storage.set(s.key,JSON.stringify(s.pending));s.fixture.rows=[{draftId:s.draft.id,revision:'2',episodeNumber:1,status:'SCHEDULED',dueAt:'2030-01-01T00:00:00Z',displayTimezone:'Asia/Seoul'}];
  await s.window.CreatorPublications.open('10');assert.equal(s.prepares,0);assert.equal(s.storage.size,0);assert.equal(s.get('publicationResult').hidden,false);
  assert.equal(s.get('publicationRead').hidden,true);assert.equal(s.get('publicationCopy').hidden,true);assert.equal(s.marked.length,1);
});
test('publishing confirmation survives local backup and catalog list failures, and cannot send duplicate publish',async()=>{
  const s=setup();s.fixture.afterPublishListFailure=true;s.fixture.markError=true;await s.window.CreatorPublications.open('10');s.get('publicationRights').checked=true;
  await s.get('publicationCommit').onclick();assert.equal(s.get('publicationResult').hidden,false);assert.match(s.get('publicationResultText').textContent,/공개됐습니다/);
  assert.match(s.get('publicationMessage').textContent,/기기 상태 저장에 실패/);assert.match(s.get('publicationMessage').textContent,/게시 결과는 확정/);
  await s.get('publicationCommit').onclick();assert.equal(s.calls.filter(c=>c.path.includes('/publish/')).length,1);
});
test('wrong work and inactive/limited actor cannot reconcile private pending request or publish',async()=>{
  const s=setup();s.storage.set(s.key,JSON.stringify(s.pending));s.draft.workId='20';await s.window.CreatorPublications.open('10');assert.equal(s.storage.size,1);assert.equal(s.prepares,0);assert.equal(s.get('publicationRetryPanel').hidden,true);
  const off=setup();off.window.WEBNOVELS_CONFIG.authorPublishEnabled=false;await assert.rejects(off.window.CreatorPublications.open('10'),/AUTHOR_PUBLISH_NOT_ACTIVATED/);assert.equal(off.calls.length,0);
  const limited=setup();limited.setActor({userId:'user-a',author:{id:'101',status:'APPROVED'},authorWorkspaceReady:true});await assert.rejects(limited.window.CreatorPublications.open('10'),/AUTHOR_PUBLISH_NOT_ACTIVATED/);assert.equal(limited.calls.length,0);
});
for(const mode of ['list','retry'])test(`cancelled request confirmed by ${mode} refreshes draft state and never reports it published`,async()=>{
  const s=setup();s.storage.set(s.key,JSON.stringify(s.pending));s.fixture.publishStatus='CANCELLED';
  if(mode==='list')s.fixture.rows=[{draftId:s.draft.id,revision:'2',episodeNumber:1,status:'CANCELLED'}];
  await s.window.CreatorPublications.open('10');if(mode==='retry')await s.get('publicationRetry').onclick();
  assert.equal(s.marked.length,0);assert.equal(s.refreshed.length,1);assert.equal(s.refreshed[0].id,s.draft.id);
  assert.equal(s.storage.size,0);assert.match(s.get('publicationResultText').textContent,/예약이 취소/);assert.doesNotMatch(s.get('publicationResultText').textContent,/공개됐습니다/);
  assert.equal(s.get('publicationRead').hidden,true);assert.equal(s.get('publicationCopy').hidden,true);
});
test('confirmed cancellation survives draft-state and list refresh failure',async()=>{
  const s=setup();s.fixture.rows=[{draftId:s.draft.id,episodeId:'300',revision:'2',episodeNumber:1,status:'SCHEDULED',generation:1,dueAt:'2030-01-01T00:00:00Z',displayTimezone:'Asia/Seoul'}];
  await s.window.CreatorPublications.open('10');s.fixture.refreshError=true;s.fixture.afterPublishListFailure=true;
  const cancel=s.get('publicationList').children[0].children.find(x=>x.textContent==='예약 취소');await cancel.onclick();
  assert.match(s.get('publicationMessage').textContent,/예약 취소가 확정/);assert.match(s.get('publicationMessage').textContent,/기기 원고 상태 확인에 실패/);assert.match(s.get('publicationMessage').textContent,/목록 갱신에 실패/);
  assert.equal(s.calls.filter(x=>x.path.includes('/cancel/')).length,1);
});
