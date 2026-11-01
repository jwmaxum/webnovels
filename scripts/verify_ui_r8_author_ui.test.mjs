import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse,parseFragment} from 'parse5';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const html=await read('public/index.html'),paths=['shared/manuscript-document.js','creator/draft-engine.js','creator/draft-diff.js','creator/creator-readiness.js','creator/creator-editor.js','creator/creator-publications.js','creator/creator-operations.js'];
const sources=await Promise.all(paths.map(path=>read('public/js/'+path)));
const copy=value=>JSON.parse(JSON.stringify(value)),ticks=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const future='2030-01-01T00:00:00.000Z';
const button=(root,label)=>root.querySelectorAll('button').find(node=>node.textContent===label);
function fixture(type='NOVEL'){
 const nodes=new Map(),radios=[],remotes=new Map(),heads=new Map(),backups=[],calls=[],confirms=[],messages=[],storage=new Map();
 let context,serial=0,who={userId:'author-a',author:{id:'9007199254740993',status:'APPROVED'}};
 const behavior={confirm:true,cancelError:null,cancelGate:null,cancelOpenError:false,episodeGate:null};let rows=[],episodeRows=[];
 const walk=node=>[node,...node.children.flatMap(walk)];
 const unregister=node=>{for(const child of walk(node))if(child.id&&nodes.get(child.id)===child)nodes.delete(child.id);};
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs=new Map();this._text='';this.value='';this.hidden=false;this.disabled=false;this._checked=false;this.style={setProperty(key,value){this[key]=value;}};this.className='';this.events=new Map();this.dataset={};
   this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ');},toggle:(name,on)=>{const value=on??!this.classList.contains(name);value?this.classList.add(name):this.classList.remove(name);return value;}};
  }
  set checked(value){this._checked=!!value;if(value&&this.getAttribute('name')==='publicationMode')for(const radio of radios)if(radio!==this)radio._checked=false;}
  get checked(){return this._checked;}
  get childNodes(){return this.children;}
  setAttribute(key,value){value=String(value);this.attrs.set(key,value);if(key==='id'){this.id=value;nodes.set(value,this);}if(['name','type','href'].includes(key))this[key]=value;if(key==='class')this.className=value;if(key==='value')this.value=value;if(['hidden','disabled','checked'].includes(key))this[key]=true;}
  getAttribute(key){return this.attrs.get(key)??null;}
  removeAttribute(key){this.attrs.delete(key);}
  append(...children){for(const child of children){this.children.push(child);child.parentNode=this;}}
  appendChild(child){this.append(child);return child;}
  replaceChildren(...children){for(const child of this.children)unregister(child);this._text='';this.children=[];this.append(...children);}
  set textContent(value){this.replaceChildren();this._text=String(value??'');}
  get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
  set innerHTML(value){this.replaceChildren();for(const child of parseFragment(value).childNodes)this.append(convert(child));if(this.tagName==='SELECT')this.value=this.children.find(child=>child.tagName==='OPTION')?.value||'';}
  matches(selector){return selector.startsWith('#')?this.id===selector.slice(1):selector.startsWith('.')?this.classList.contains(selector.slice(1)):this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){return walk(this).slice(1).filter(node=>selector.split(',').some(part=>node.matches(part)));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(name,callback){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(callback);}
  async emit(name,event={}){if(name==='click'&&this.disabled)return;for(const fn of this.events.get(name)||[])await fn(event);await this['on'+name]?.(event);}
  focus(){context.document.activeElement=this;}
  scrollIntoView(){}
 }
 function convert(ast){const node=new Element(ast.tagName||'#text');for(const attr of ast.attrs||[])node.setAttribute(attr.name,attr.value);if(ast.nodeName==='#text')node._text=ast.value;for(const child of ast.childNodes||[])node.append(convert(child));if(node.getAttribute('name')==='publicationMode')radios.push(node);if(node.tagName==='SELECT')node.value=node.children.find(child=>child.tagName==='OPTION')?.value||'';return node;}
 for(const ast of parse(html).childNodes)convert(ast);const get=id=>nodes.get(id)||null;
 const work=()=>({id:'10',title:'공개 회차가 있는 작품',content_type:type,description:'작품 소개',genre:['로맨스'],rating:'ALL',ai_usage_type:'NONE',moderation_state:'CLEAR',trashed_at:null,publication_missing:[],hasPublicationHistory:true});
 const seed=(id,{history=false,episodeId='700',lifecycle='ACTIVE',title='미공개 원고',content='보존할 원고 내용'}={})=>{const value={revision:'3',lifecycle,episodeId,title,content:type==='WEBTOON'?'':content,authorComment:'작가의 말',...(type==='WEBTOON'?{webtoon:{schemaVersion:1,assetIds:['asset-a'],thumbnailAssetId:'asset-a',credits:{writer:'작가'}}}:{})};if(history!==undefined)value.hasPublicationHistory=history;remotes.set(id,value);return value;};
 context={URL,URLSearchParams,Blob,Date,console,crypto:{randomUUID:()=>`draft-${++serial}`},setTimeout:()=>++serial,clearTimeout(){},history:{replaceState(){}},location:{pathname:'/creator/episodes',origin:'https://app.test',search:''},navigator:{},
  document:{readyState:'complete',hidden:false,activeElement:null,documentElement:new Element('html'),getElementById:get,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),addEventListener(){},querySelectorAll:selector=>selector.includes('publicationMode')?radios:[],querySelector:selector=>selector.includes('publicationMode')?radios.find(radio=>selector.includes(':checked')?radio.checked:radio.value===(selector.includes('SCHEDULED')?'SCHEDULED':'NOW')):null},
  addEventListener(){},confirm:message=>{confirms.push(message);return behavior.confirm;},WEBNOVELS_CONFIG:{authorPublishEnabled:true,authorOperationsEnabled:true,webtoonServiceEnabled:true},
  DraftStore:{save:async c=>heads.set(c.userId+':'+c.id+':'+c.branch,copy(c)),backup:async(c,snapshot,reason)=>backups.push({id:c.id,snapshot:copy(snapshot),reason}),heads:async()=>[...heads.values()],history:async()=>[],legacy:async()=>[]},
  CreatorRichEditor:{mount(){},snapshot:()=>({}),assertValid(){},focus(){}},CreatorWebtoon:{mount(){},reset(){},empty:()=>({schemaVersion:1,assetIds:[],thumbnailAssetId:null,credits:{}}),hasPending:()=>false,renderPreview:async(root,c,valid)=>{if(valid())root.textContent='웹툰 '+c.snapshot.webtoon.assetIds.join(',');return ()=>{};}},
  ReaderContent:{render(body,comment,snapshot){body.textContent=snapshot.content;comment.textContent=snapshot.authorComment;}},ReaderWebtoon:{destroy(){}},
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},showToast:value=>messages.push(value),openModal:id=>{get(id).hidden=false;},closeModal:id=>{if(get(id))get(id).hidden=true;},switchCreatorTab(){},
  WebNovelsAuth:{getActor:()=>who,api:async(path,options)=>{
   const url=new URL(path,'https://app.test'),id=url.pathname.split('/').at(-1),data=options?.body?JSON.parse(options.body):null;calls.push({path,url,method:options?.method||'GET',data});
   if(url.pathname==='/api/v2/creator/works')return {works:[work()],nextCursor:null};
   if(/^\/api\/v2\/creator\/works\/\d+\/episodes$/.test(url.pathname))return behavior.episodeGate?behavior.episodeGate.promise:{episodes:copy(episodeRows)};
   if(url.pathname.startsWith('/api/v2/creator/works/'))return {work:work(),episodes:[{id:'700',episode_number:9,status:'DRAFT'},{id:'600',episode_number:1,status:'PUBLISHED'}]};
   if(url.pathname==='/api/v2/creator/drafts')return {drafts:[...remotes].map(([id,row])=>({id,title:row.title,lifecycle:row.lifecycle}))};
   if(url.pathname.startsWith('/api/v2/creator/drafts/')){
    if(behavior.cancelOpenError&&id==='reserved')throw Object.assign(Error('OFFLINE'),{status:503});
    if(options?.method==='PUT'){const prior=remotes.get(id);assert.equal(data.expectedRevision,prior?.revision||'0');remotes.set(id,{...prior,...copy(data),revision:String(Number(prior?.revision||0)+1),lifecycle:prior?.lifecycle||'ACTIVE',episodeId:prior?.episodeId||null,hasPublicationHistory:prior?.hasPublicationHistory??false});}
    if(!remotes.has(id))throw Object.assign(Error('NOT_FOUND'),{status:404});return {draft:copy(remotes.get(id))};
   }
   if(url.pathname.includes('/cancel/')){if(behavior.cancelError)throw behavior.cancelError;if(behavior.cancelGate)return behavior.cancelGate.promise;const row=rows.find(row=>row.episodeId===id);row.status='CANCELLED';row.generation++;remotes.get(row.draftId).lifecycle='ACTIVE';return {publication:copy(row)};}
   if(url.pathname.includes('/publish/')){const draft=remotes.get(id),publication={episodeId:draft.episodeId||'900',episodeNumber:data.episodeNumber,draftId:id,revision:data.revision,title:draft.title,status:data.mode==='SCHEDULED'?'SCHEDULED':'PUBLISHED',hasPublicationHistory:data.mode==='NOW',dueAt:data.dueAt,displayTimezone:data.displayTimezone};draft.lifecycle='PUBLISHED';draft.hasPublicationHistory=publication.hasPublicationHistory;draft.episodeId=publication.episodeId;rows=[publication];return {publication:copy(publication)};}
   if(url.pathname.endsWith('/suggest'))return {episodeNumber:10};
   if(url.pathname==='/api/v2/creator/publications')return {publications:copy(rows)};
   if(url.pathname==='/api/v2/creator/operations')return behavior.episodeGate?behavior.episodeGate.promise:{episodes:copy(episodeRows)};
   throw Error('Unexpected test endpoint '+url.pathname);
  }}};
 context.window=context;vm.createContext(context);sources.forEach((source,index)=>vm.runInContext(source,context,{filename:paths[index]}));
 return {c:context,get,calls,heads,backups,remotes,behavior,confirms,messages,seed,editor:context.CreatorDraftEditor,publications:context.CreatorPublications,createRoot:()=>new Element(),setActor:value=>who=value,setRows:value=>rows=value,setEpisodeRows:value=>episodeRows=value,
  async type(id,value){get(id).value=value;await get(id).emit('input');},scheduled(){seed('reserved',{history:false,lifecycle:'PUBLISHED',title:'예약한 원고'});const row={episodeId:'700',episodeNumber:9,draftId:'reserved',revision:'3',title:'예약한 원고',status:'SCHEDULED',generation:1,dueAt:future,displayTimezone:'Asia/Seoul',hasPublicationHistory:false};rows=[row];return row;}};
}

for(const type of ['NOVEL','WEBTOON'])test(`${type} reserved-but-never-public draft remains freely editable and directly scheduled on its same episode in an already-public work`,async()=>{
 const f=fixture(type);f.seed('active',{history:false});await f.editor.openWork('10','active');assert.equal(f.editor.getUiState().editingPublished,false);assert.equal(f.get('btnSchedulePublication').disabled,false);assert.equal(f.editor.getFileContext().hasPublicationHistory,false);
 await f.publications.open('10',{mode:'SCHEDULED'});assert.equal(f.get('publicationCommit').textContent,'예약 발행');assert.match(f.get('publicationSummary').textContent,/9화/);assert.equal(f.c.document.querySelector('input[name="publicationMode"][value="SCHEDULED"]').disabled,false);
 f.get('publicationRights').checked=true;f.get('publicationDueAt').value='2030-01-01T09:00';f.get('publicationTimezone').value='Asia/Seoul';await f.get('publicationCommit').onclick();
 const sent=f.calls.find(call=>call.url.pathname.includes('/publish/'));assert(sent);assert.deepEqual(Object.keys(sent.data).sort(),['displayTimezone','dueAt','episodeNumber','mode','revision','rightsConfirmed']);assert.equal(sent.data.episodeNumber,9);assert.equal(sent.data.mode,'SCHEDULED');assert.equal(f.get('newEpTitle').disabled,true);assert.match(f.get('studioDraftState').textContent,/예약·보관/);assert.equal(f.calls.some(call=>call.path.includes('/admin/')),false);
});

for(const history of [true,undefined])test(`${history===true?'published':'legacy unknown'} episode history keeps modification review and blocks scheduled modification`,async()=>{
 const f=fixture();f.seed('active',{history});if(history===undefined)delete f.remotes.get('active').hasPublicationHistory;await f.editor.openWork('10','active');assert.equal(f.editor.getUiState().editingPublished,true);assert.equal(f.get('btnSchedulePublication').disabled,true);await f.publications.open('10',{mode:'SCHEDULED'});assert.equal(f.get('publicationCommit').textContent,'수정 검토 요청');assert.equal(f.c.document.querySelector('input[name="publicationMode"][value="SCHEDULED"]').disabled,true);assert.match(f.get('publicationMessage').textContent,/승인 전까지 기존 공개본/);
});

test('editing a scheduled manuscript confirms cancellation, preserves another draft, and never republishes automatically',async()=>{
 const f=fixture();f.scheduled();f.seed('fresh',{episodeId:null,title:'작성 중인 다른 원고'});await f.editor.openWork('10','fresh');await f.type('newEpContent','현재 원고의 저장되지 않은 내용');await f.publications.open('10');
 await button(f.get('publicationList'),'예약 원고 수정').onclick();assert.match(f.confirms[0],/예약을 취소/);assert.match(f.confirms[0],/회차 번호는 보존/);assert.equal(f.editor.getFileContext().id,'reserved');assert.equal(f.editor.getFileContext().lifecycle,'ACTIVE');assert.equal(f.editor.getUiState().editingPublished,false);assert.equal(f.get('newEpTitle').value,'예약한 원고');assert.equal(f.get('newEpTitle').disabled,false);
 assert([...f.heads.values()].some(head=>head.id==='fresh'&&head.snapshot.content==='현재 원고의 저장되지 않은 내용'));assert.equal(f.calls.filter(call=>call.url.pathname.includes('/cancel/')).length,1);assert.equal(f.calls.some(call=>call.url.pathname.includes('/publish/')),false);
 await f.publications.open('10');await button(f.get('publicationList'),'취소한 원고 이어쓰기').onclick();assert.equal(f.calls.filter(call=>call.url.pathname.includes('/cancel/')).length,1);assert.equal(f.editor.getFileContext().id,'reserved');
});

test('declined cancellation or a failed cancel request keeps the selected draft and original reservation untouched',async()=>{
 for(const failure of ['decline','network']){
  const f=fixture();f.scheduled();f.seed('fresh',{episodeId:null});await f.editor.openWork('10','fresh');await f.publications.open('10');if(failure==='decline')f.behavior.confirm=false;else f.behavior.cancelError=Error('network');await button(f.get('publicationList'),'예약 원고 수정').onclick();
  assert.equal(f.editor.getFileContext().id,'fresh');assert.equal(f.remotes.get('reserved').lifecycle,'PUBLISHED');assert.equal(f.calls.filter(call=>call.url.pathname.includes('/cancel/')).length,failure==='decline'?0:1);assert.equal(f.calls.some(call=>call.url.pathname.includes('/publish/')),false);
 }
});

test('a confirmed cancellation reports the preserved manuscript when reopening fails instead of claiming republished success',async()=>{
 const f=fixture();f.scheduled();f.seed('fresh',{episodeId:null});await f.editor.openWork('10','fresh');await f.publications.open('10');f.behavior.cancelOpenError=true;await button(f.get('publicationList'),'예약 원고 수정').onclick();
 assert.match(f.get('publicationMessage').textContent,/예약 취소는 확정/);assert.match(f.get('publicationMessage').textContent,/원고와 회차 번호는 보존/);assert.equal(f.editor.getFileContext().id,'fresh');assert.equal(f.remotes.get('reserved').lifecycle,'ACTIVE');assert.equal(f.calls.some(call=>call.url.pathname.includes('/publish/')),false);
});

test('schedule row actions prevent duplicate dispatch and ignore stale account responses before opening or replacing a draft',async()=>{
 const f=fixture();f.scheduled();f.seed('fresh',{episodeId:null});await f.editor.openWork('10','fresh');await f.publications.open('10');const pending=gate();f.behavior.cancelGate=pending;const edit=button(f.get('publicationList'),'예약 원고 수정'),saving=edit.onclick();await ticks();await edit.onclick();assert.equal(f.calls.filter(call=>call.url.pathname.includes('/cancel/')).length,1);
 f.setActor({userId:'author-b',author:{id:'202',status:'APPROVED'}});f.publications.reset();pending.resolve({publication:{status:'CANCELLED'}});await saving;assert.equal(f.editor.getFileContext().id,'fresh');const count=f.calls.length;await edit.onclick();assert.equal(f.calls.length,count);
});

test('episode management focuses the selected reserved episode and old callbacks cannot act after a new view or account',async()=>{
 const f=fixture(),root=f.createRoot(),opens=[];f.setEpisodeRows([{id:'700',episode_number:9,title:'예약 9화',status:'DRAFT',schedule_status:'PENDING'}]);f.c.CreatorPublications.open=(...args)=>opens.push(copy(args));await f.c.CreatorOperations.episodes(root,'10');const action=button(root,'예약 원고·시각 관리');action.onclick();assert.deepEqual(opens,[['10',{focusEpisodeId:'700'}]]);
 await f.c.CreatorOperations.episodes(root,'10');action.onclick();assert.equal(opens.length,1);const latest=button(root,'예약 원고·시각 관리');f.setActor({userId:'another',author:{id:'999',status:'APPROVED'}});latest.onclick();assert.equal(opens.length,1);
});
