import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';

const source=await readFile(new URL('../public/js/creator/creator-publications.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const gate=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(options={}){
 const nodes=new Map(),calls=[],renders=[],destroys=[],validity=[],storage=new Map();let serial=0;
 let who={userId:'author-a',author:{id:'9007199254740993',status:'APPROVED'}};
 let draft={userId:'author-a',workId:'10',id:'11111111-2222-4333-8444-555555555555',revision:'3',seq:7,
  episodeId:options.review?'700':null,hasPublicationHistory:!!options.review,
  snapshot:{title:'저장한 원고',content:'서식이 있는 본문',authorComment:'작가의 말',
   ...(options.webtoon?{webtoon:{assetIds:['asset-a'],credits:{writer:'글 작가'}}}:{})}};
 let prepare=async()=>copy(draft);
 const element=(tag='div')=>({tagName:tag.toUpperCase(),hidden:false,disabled:false,value:'',children:[],_text:'',
  classList:{add(){},remove(){}},replaceChildren(...children){this.children=children;this._text='';},append(...children){this.children.push(...children);},
  set textContent(value){this._text=String(value);this.children=[];},get textContent(){return this._text+this.children.map(child=>child.textContent).join('');},
  set innerHTML(value){this.replaceChildren();this._text=String(value);},setAttribute(name,value){this[name]=String(value);},focus(){},scrollIntoView(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const radios=['NOW','SCHEDULED'].map(value=>Object.assign(element('input'),{value}));
 for(const radio of radios){let checked=radio.value==='NOW';Object.defineProperty(radio,'checked',{get:()=>checked,set:value=>{checked=!!value;if(checked)for(const other of radios)if(other!==radio)other.checked=false;}});}
 const c={URL,Date,console,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},
  document:{readyState:'complete',getElementById:get,createElement:element,querySelectorAll:()=>radios,
   querySelector:selector=>selector.includes(':checked')?radios.find(r=>r.checked):radios.find(r=>r.value===(selector.includes('SCHEDULED')?'SCHEDULED':'NOW')),addEventListener(){}},
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  WEBNOVELS_CONFIG:{authorPublishEnabled:options.publishEnabled!==false,webtoonServiceEnabled:true},
  openModal:id=>{get(id).hidden=false;},closeModal:id=>{get(id).hidden=true;},
  ReaderContent:{render(root,comment,snapshot){renders.push({type:'novel',snapshot:copy(snapshot)});if(options.renderError)throw Error('RENDER_UNAVAILABLE');root.textContent=snapshot.content;comment.textContent=snapshot.authorComment;}},
  ReaderWebtoon:{destroy(root){destroys.push(root);},formatCredits:()=> '글 작가: 글 작가'},
  CreatorWebtoon:{async renderPreview(root,context,valid){renders.push({type:'webtoon',snapshot:copy(context.snapshot)});if(options.renderError)throw Error('RENDER_UNAVAILABLE');if(options.renderGate)await options.renderGate.promise;const current=valid();validity.push(current);if(current)root.textContent='순서대로 표시한 웹툰';}},
  CreatorReadiness:{publicationItems:()=>[],render:()=>''},
  CreatorDraftEditor:{getFileContext:()=>copy(draft),preparePublication:()=>prepare(),getUiState:()=>({hasDraft:true,editingPublished:!!options.review}),markPublished:async()=>{},refreshPublicationState:async()=>{}},
  WebNovelsAuth:{getActor:()=>who,async api(path,request){calls.push({path,request});
   if(path.startsWith('/api/v2/creator/works/'))return {work:{id:'10',title:'내 작품',rating:'ALL',ai_usage_type:'NONE',publication_missing:[]},episodes:options.review?[{id:'700',episode_number:1}]:[]};
   if(path.includes('/suggest'))return {episodeNumber:2};
   if(path.includes('/publish/'))return {reviewRequired:true,changeId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
   if(path.startsWith('/api/v2/creator/publications'))return {publications:[]};
   throw Error('Unexpected fixture endpoint');
  }}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c,{filename:'creator-publications.js'});
 return {c,get,calls,renders,destroys,validity,radios,current:()=>copy(draft),setDraft:value=>{draft=value;},setPrepare:value=>{prepare=value;},setActor:value=>{who=value;},
  open:settings=>c.CreatorPublications.open('10',settings),async submit(){get('publicationRights').checked=true;await get('publicationCommit').onclick();}};
}

for(const webtoon of [false,true])for(const mode of ['NOW','SCHEDULED'])test(`${webtoon?'webtoon':'novel'} ${mode} opens compact publication without rendering saved contents`,async()=>{
 const f=fixture({webtoon,renderError:true});await f.open({mode});
 assert.equal(f.get('publicationPreview').hidden,true);
 assert.equal(f.get('publicationDraftPanel').hidden,false);assert.equal(f.get('publicationControls').hidden,false);
 assert.equal(f.get('publicationScheduleFields').hidden,mode!=='SCHEDULED');
 assert.equal(f.get('publicationCommit').textContent,mode==='SCHEDULED'?'예약 발행':'지금 발행');
 assert.deepEqual(f.renders,[]);assert.equal(f.calls.some(call=>call.path.includes('/publish/')),false);
});

for(const webtoon of [false,true])test(`${webtoon?'webtoon':'novel'} published edit keeps admin review and skips preview work`,async()=>{
 const f=fixture({webtoon,review:true,renderError:true});await f.open();
 assert.equal(f.get('publicationPreview').hidden,true);assert.deepEqual(f.renders,[]);
 assert.equal(f.get('publicationCommit').textContent,'수정 검토 요청');assert.equal(f.radios[1].disabled,true);
 await f.submit();const sent=f.calls.find(call=>call.path.includes('/publish/'));
 assert.equal(JSON.parse(sent.request.body).mode,'NOW');assert.match(f.get('publicationMessage').textContent,/승인 전까지 기존 공개본/);
});

for(const webtoon of [false,true])test(`${webtoon?'webtoon':'novel'} explicit editor preview still renders the saved checkpoint and cannot publish`,async()=>{
 const f=fixture({webtoon});await f.get('btnStudioPreview').onclick();
 assert.equal(f.get('publicationPreview').hidden,false);assert.equal(f.get('publicationControls').hidden,true);assert.equal(f.get('publicationListSection').hidden,true);
 assert.equal(f.renders.length,1);assert.equal(f.renders[0].type,webtoon?'webtoon':'novel');
 assert.equal(f.get('publicationPreviewBody').textContent,webtoon?'순서대로 표시한 웹툰':'서식이 있는 본문');
 await f.submit();assert.equal(f.calls.some(call=>call.path.includes('/publish/')),false);
});

test('service unavailable fallback remains an explicit saved preview',async()=>{
 const f=fixture({publishEnabled:false});await f.open();assert.equal(f.get('publicationPreview').hidden,false);
 assert.equal(f.get('publicationControls').hidden,true);assert.equal(f.renders.length,1);
 await f.submit();assert.equal(f.calls.some(call=>call.path.includes('/publish/')),false);
});

test('switching webtoon preview to compact publication releases image renderer and clears old contents',async()=>{
 const f=fixture({webtoon:true});await f.open({preview:true});assert.match(f.get('publicationPreviewBody').textContent,/웹툰/);
 const initial=f.destroys.length;await f.open();
 assert(f.destroys.length>initial);assert.equal(f.get('publicationPreview').hidden,true);
 assert.equal(f.get('publicationPreviewBody').textContent,'');assert.equal(f.get('publicationPreviewComment').textContent,'');assert.equal(f.renders.length,1);
 f.c.CreatorPublications.reset();assert.equal(f.get('publicationPreviewBody').textContent,'');
});

test('a delayed webtoon preview cannot paint over a newly opened compact publication',async()=>{
 const rendering=gate(),f=fixture({webtoon:true,renderGate:rendering});
 const opening=f.open({preview:true}),rejected=assert.rejects(opening,/SESSION_CHANGED/);await tick();assert.equal(f.renders.length,1);
 await f.open();const summary=f.get('publicationSummary').textContent;rendering.resolve();await rejected;
 assert.deepEqual(f.validity,[false]);assert.equal(f.get('publicationPreview').hidden,true);
 assert.equal(f.get('publicationPreviewBody').textContent,'');assert.equal(f.get('publicationSummary').textContent,summary);
});

test('a late checkpoint from an earlier preview cannot replace the current publication context',async()=>{
 const pending=gate(),f=fixture(),old=f.current();f.setPrepare(()=>pending.promise);
 const opening=f.open({preview:true}),rejected=assert.rejects(opening,/SESSION_CHANGED/);await tick();
 const current={...old,revision:'4',seq:8,snapshot:{...old.snapshot,title:'최신 저장 원고',content:'더 나중에 저장한 내용'}};
 f.setDraft(current);f.setPrepare(async()=>copy(current));await f.open();const summary=f.get('publicationSummary').textContent;
 pending.resolve(old);await rejected;assert.equal(f.get('publicationSummary').textContent,summary);assert.deepEqual(f.renders,[]);
 await f.submit();const sent=f.calls.find(call=>call.path.includes('/publish/'));assert.equal(JSON.parse(sent.request.body).revision,'4');
});

test('PC/mobile width controls stay absent from visible publication UI while compatibility IDs are retained',()=>{
 const document=parse(html),found=new Map();
 function walk(node,hidden=false){const concealed=hidden||(node.attrs||[]).some(attr=>attr.name==='hidden');const id=node.attrs?.find(attr=>attr.name==='id')?.value;if(id)found.set(id,{node,hidden:concealed});for(const child of node.childNodes||[])walk(child,concealed);}
 walk(document);for(const id of ['publicationDesktop','publicationMobile']){assert(found.has(id));assert.equal(found.get(id).hidden,true,id);}
 assert(found.get('publicationPreview').node.attrs.some(attr=>attr.name==='hidden'));
});
