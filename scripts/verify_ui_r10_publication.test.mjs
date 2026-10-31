import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/creator/creator-publications.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const gate=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(options={}){
 const nodes=new Map(),calls=[],routes=[],closed=[],storage=new Map();let serial=0,prepares=0;
 let who={userId:'author-a',author:{id:'9007199254740993',status:'APPROVED'}};
 let draft={userId:'author-a',workId:options.workId||'10',id:'11111111-2222-4333-8444-555555555555',revision:'3',seq:7,
  episodeId:options.review?'700':null,hasPublicationHistory:!!options.review,
  snapshot:{title:'작성 중인 원고',content:'저장할 본문',authorComment:''}};
 let prepare=async()=>copy(draft);
 const element=(tag='div')=>({tagName:tag.toUpperCase(),hidden:false,disabled:false,value:'',children:[],_text:'',classList:{add(){},remove(){}},
  replaceChildren(...children){this.children=children;this._text='';},append(...children){this.children.push(...children);},
  set textContent(value){this._text=String(value);this.children=[];},get textContent(){return this._text+this.children.map(child=>child.textContent).join('');},
  set innerHTML(value){if(this===nodes.get('publicationSummary'))assert.fail('Summary must use inert text');this.replaceChildren();this._text=String(value);},
  setAttribute(name,value){this[name]=String(value);},focus(){},scrollIntoView(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const radios=['NOW','SCHEDULED'].map(value=>Object.assign(element('input'),{value}));
 for(const radio of radios){let checked=radio.value==='NOW';Object.defineProperty(radio,'checked',{get:()=>checked,set:value=>{checked=!!value;if(checked)for(const other of radios)if(other!==radio)other.checked=false;}});}
 const c={URL,Date,console,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},
  document:{readyState:'complete',getElementById:get,createElement:element,querySelectorAll:()=>radios,
   querySelector:selector=>selector.includes(':checked')?radios.find(r=>r.checked):radios.find(r=>r.value===(selector.includes('SCHEDULED')?'SCHEDULED':'NOW')),addEventListener(){}},
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  WEBNOVELS_CONFIG:{authorPublishEnabled:true,webtoonServiceEnabled:true},
  openModal:id=>{get(id).hidden=false;},closeModal:id=>{closed.push(id);get(id).hidden=true;},navigateTo:path=>routes.push(path),
  ReaderContent:{render(root,comment,value){root.textContent=value.content;comment.textContent=value.authorComment;}},ReaderWebtoon:{destroy(){}},
  CreatorReadiness:{publicationItems:()=>[],render:()=>''},
  CreatorDraftEditor:{getFileContext:()=>draft?copy(draft):null,preparePublication:async()=>{prepares++;return prepare();},
   getUiState:()=>({hasDraft:!!draft,readOnly:false,conflict:false,composing:false,pendingImages:false,editingPublished:!!options.review}),
   markPublished:async()=>{},refreshPublicationState:async()=>{}},
  WebNovelsAuth:{getActor:()=>who,api:async(path,request)=>{
   calls.push({path,request});
   if(path.startsWith('/api/v2/creator/works/'))return {work:{id:path.split('/').at(-1),title:'내 작품',rating:'ALL',ai_usage_type:'GENERATED',publication_missing:[],...copy(options.work||{})},episodes:options.review?[{id:'700',episode_number:1}]:[]};
   if(path.includes('/suggest'))return {episodeNumber:2};
   if(path.includes('/publish/'))return options.publishing?options.publishing.promise:{reviewRequired:true,changeId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
   if(path.startsWith('/api/v2/creator/publications'))return {publications:[]};
   throw Error('Unexpected fixture endpoint');
  }}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c,{filename:'creator-publications.js'});
 return {c,get,calls,routes,closed,prepares:()=>prepares,setPrepare:value=>{prepare=value;},
  current:()=>draft?copy(draft):null,setDraft:value=>{draft=value;},setActor:value=>{who=value;},
  async open(){await c.CreatorPublications.open(options.workId||'10');},
  async submit(){get('publicationRights').checked=true;await get('publicationCommit').onclick();}};
}

test('missing or unknown work metadata exposes settings action; server-confirmed complete work hides it',async()=>{
 for(const missing of [['소개','장르'],[],null]){
  const f=fixture({work:{publication_missing:missing}});await f.open();
  assert.equal(f.get('publicationWorkSettings').hidden,Array.isArray(missing)&&missing.length===0);
  assert.equal(typeof f.get('publicationWorkSettings').onclick,'function');
 }
});

test('settings transition awaits the saved draft checkpoint and preserves exact bigint work route',async()=>{
 const f=fixture({workId:'9007199254740999',work:{publication_missing:['소개']}});await f.open();
 const pending=gate(),saved=f.current();f.setPrepare(()=>pending.promise);const initial=f.prepares();
 const leaving=f.get('publicationWorkSettings').onclick();assert.equal(f.prepares(),initial+1);
 assert.deepEqual(f.routes,[]);assert.deepEqual(f.closed,[]);assert.equal(f.get('publicationWorkSettings').disabled,true);
 pending.resolve(saved);await leaving;
 assert.deepEqual(f.routes,['/creator/works/9007199254740999/settings']);assert.deepEqual(f.closed,['modalCreatorPublication']);
 assert.equal(f.current().snapshot.content,'저장할 본문');assert.equal(f.calls.some(call=>call.path.includes('/publish/')),false);
});

test('stale actor, revoked author, work/draft switch, cleared context and reset cannot start a saved settings transition',async()=>{
 for(const change of ['actor','role','work','draft','clear','reset']){
  const f=fixture({work:{publication_missing:['소개']}});await f.open();const handler=f.get('publicationWorkSettings').onclick;
  if(change==='actor')f.setActor({userId:'other-author',author:{id:'200',status:'APPROVED'}});
  if(change==='role')f.setActor({userId:'author-a',author:{id:'9007199254740993',status:'SUSPENDED'}});
  if(change==='work')f.setDraft({...f.current(),workId:'20'});
  if(change==='draft')f.setDraft({...f.current(),id:'22222222-2222-4333-8444-555555555555'});
  if(change==='clear')f.setDraft(null);
  if(change==='reset')f.c.CreatorPublications.reset();
  const initial=f.prepares(),closed=f.closed.length;await handler();
  assert.equal(f.prepares(),initial,change);assert.deepEqual(f.routes,[],change);assert.equal(f.closed.length,closed,change);
 }
});

test('late checkpoint completion after actor/role/work/draft/reset change never closes or navigates the old modal',async()=>{
 for(const change of ['actor','role','work','draft','clear','saved-owner','reset']){
  const f=fixture({work:{publication_missing:['소개']}});await f.open();const pending=gate(),saved=f.current();f.setPrepare(()=>pending.promise);
  const leaving=f.get('publicationWorkSettings').onclick();await tick();
  if(change==='actor')f.setActor({userId:'other-author',author:{id:'200',status:'APPROVED'}});
  if(change==='role')f.setActor({userId:'author-a',author:{id:'9007199254740993',status:'SUSPENDED'}});
  if(change==='work')f.setDraft({...f.current(),workId:'20'});
  if(change==='draft')f.setDraft({...f.current(),id:'22222222-2222-4333-8444-555555555555'});
  if(change==='clear')f.setDraft(null);
  if(change==='saved-owner')saved.userId='other-author';
  if(change==='reset')f.c.CreatorPublications.reset();
  const closed=f.closed.length;pending.resolve(saved);await leaving;
  assert.deepEqual(f.routes,[],change);assert.equal(f.closed.length,closed,change);
 }
});

test('offline or unavailable checkpoint keeps draft and modal available for retry',async()=>{
 for(const code of ['OFFLINE','DRAFT_CONFLICT','DRAFT_COMPOSING','WEBTOON_PROCESSING_PENDING']){
  const f=fixture({work:{publication_missing:['소개']}});await f.open();const original=f.current();
  f.setPrepare(async()=>{throw Object.assign(Error(code),{code});});await f.get('publicationWorkSettings').onclick();
  assert.deepEqual(f.current(),original);assert.deepEqual(f.routes,[]);assert.deepEqual(f.closed,[]);
  assert.equal(f.get('modalCreatorPublication').hidden,false);assert.equal(f.get('publicationWorkSettings').disabled,false);
  assert.match(f.get('publicationMessage').textContent,/이동하지 않았습니다/);
 }
});

test('new edits to the same draft during checkpoint save keep the modal until the latest seq is saved',async()=>{
 const f=fixture({work:{publication_missing:['소개']}});await f.open();const pending=gate(),saved=f.current();f.setPrepare(()=>pending.promise);
 const leaving=f.get('publicationWorkSettings').onclick();await tick();
 f.setDraft({...f.current(),seq:saved.seq+1,snapshot:{...saved.snapshot,content:'저장 중 추가한 최신 본문'}});
 pending.resolve(saved);await leaving;
 assert.deepEqual(f.routes,[]);assert.deepEqual(f.closed,[]);assert.equal(f.get('modalCreatorPublication').hidden,false);
 assert.equal(f.current().snapshot.content,'저장 중 추가한 최신 본문');assert.equal(f.get('publicationWorkSettings').disabled,false);
 f.setPrepare(async()=>f.current());await f.get('publicationWorkSettings').onclick();
 assert.deepEqual(f.routes,['/creator/works/10/settings']);
});

test('double settings click performs one checkpoint and prevents publication/open races during save',async()=>{
 const f=fixture({work:{publication_missing:['소개']}});await f.open();const pending=gate(),saved=f.current();f.setPrepare(()=>pending.promise);
 const initial=f.prepares(),handler=f.get('publicationWorkSettings').onclick,leaving=handler();await handler();await f.submit();
 await assert.rejects(f.c.CreatorPublications.open('20'),/PUBLICATION_IN_PROGRESS/);
 assert.equal(f.prepares(),initial+1);assert.equal(f.calls.some(call=>call.path.includes('/publish/')),false);
 assert.equal(f.get('btnOpenPublication').disabled,true);assert.equal(f.get('btnSchedulePublication').disabled,true);
 pending.resolve(saved);await leaving;assert.deepEqual(f.routes,['/creator/works/10/settings']);
});

test('an in-flight publication blocks saved settings callbacks and opening another work',async()=>{
 const publishing=gate(),f=fixture({publishing});await f.open();const handler=f.get('publicationWorkSettings').onclick;
 const submitted=f.submit();await tick();const initial=f.prepares();await handler();
 await assert.rejects(f.c.CreatorPublications.open('20'),/PUBLICATION_IN_PROGRESS/);
 assert.equal(f.prepares(),initial);assert.deepEqual(f.routes,[]);assert.deepEqual(f.closed,[]);
 publishing.resolve({reviewRequired:true,changeId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'});await submitted;
 assert.equal(f.calls.filter(call=>call.path.includes('/publish/')).length,1);
});

test('a newer opened work invalidates an earlier settings action without changing the new draft',async()=>{
 const f=fixture({work:{publication_missing:['소개']}});await f.open();const old=f.get('publicationWorkSettings').onclick;
 f.setDraft({...f.current(),workId:'20'});await f.c.CreatorPublications.open('20');const current=f.current();
 const initial=f.prepares();await old();assert.equal(f.prepares(),initial);assert.deepEqual(f.routes,[]);assert.deepEqual(f.current(),current);
});

test('publication summary localizes rating/AI enums and clearly distinguishes free publication from review',async()=>{
 const f=fixture();await f.open();assert.match(f.get('publicationSummary').textContent,/전체 이용가.*AI 생성 포함.*무료 발행/);
 assert.doesNotMatch(f.get('publicationSummary').textContent,/\bALL\b|\bGENERATED\b/);
 const review=fixture({review:true});await review.open();assert.match(review.get('publicationSummary').textContent,/공개본 수정.*승인 후 반영/);
});

test('unknown rating/AI enums receive actionable labels and never leak raw metadata codes',async()=>{
 const f=fixture({work:{rating:'UNRECOGNIZED_RATING',ai_usage_type:'UNRECOGNIZED_AI'}});await f.open();
 assert.match(f.get('publicationSummary').textContent,/이용등급 확인 필요.*AI 표기 확인 필요/);
 assert.doesNotMatch(f.get('publicationSummary').textContent,/UNRECOGNIZED/);
});

test('summary renders titles and missing metadata as inert text',async()=>{
 const hostile='<img src=x onerror=alert(1)>',f=fixture({work:{title:hostile,publication_missing:[hostile]}});await f.open();
 assert.match(f.get('publicationSummary').textContent,/<img src=x onerror=alert\(1\)>/);
 assert.deepEqual(f.get('publicationSummary').children,[]);
 assert.equal(f.calls.some(call=>call.path.includes('/admin/')),false);
});
