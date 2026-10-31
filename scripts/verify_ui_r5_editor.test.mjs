import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const paths=['shared/manuscript-document.js','creator/draft-engine.js','creator/draft-diff.js',
  'creator/creator-readiness.js','creator/creator-editor.js','creator/creator-publications.js'];
const sources=await Promise.all(paths.map(path=>readFile(new URL('../public/js/'+path,import.meta.url),'utf8')));
const copy=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

// Parse actual shipped controls; missing IDs cannot silently become invented controls.
function fixture({publish=true,contentType='NOVEL',moderation='CLEAR',trashed=false}={}){
  const nodes=new Map(),radios=[],remotes=new Map(),heads=new Map(),calls=[],backups=[],documentEvents=new Map(),viewportEvents=new Map(),messages=[];
  let uuid=0,actor={userId:'user-a',author:{id:'101',status:'APPROVED'}},richDocument=null,pendingImages=false;
  const node=(tag='div',attrs=[])=>{
    const attributes=new Map(attrs.map(attr=>[attr.name,attr.value])),classes=new Set((attributes.get('class')||'').split(' ').filter(Boolean));
    return {tagName:tag.toUpperCase(),attributes,children:[],events:new Map(),value:attributes.get('value')||'',_text:'',
      hidden:attributes.has('hidden'),disabled:attributes.has('disabled'),checked:attributes.has('checked'),style:{setProperty(key,value){this[key]=value;}},
      classList:{add:(...items)=>items.forEach(value=>classes.add(value)),remove:(...items)=>items.forEach(value=>classes.delete(value)),
        contains:value=>classes.has(value),toggle:(value,force)=>{const selected=force??!classes.has(value);selected?classes.add(value):classes.delete(value);return selected;}},
      set textContent(value){this._text=String(value??'');this.children=[];},get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');},
      set innerHTML(value){this._html=value;},get innerHTML(){return this._html||'';},
      setAttribute(key,value){attributes.set(key,String(value));},getAttribute:key=>attributes.get(key)??null,removeAttribute:key=>attributes.delete(key),
      append(...children){this.children.push(...children);},appendChild(child){this.append(child);},replaceChildren(...children){this._text='';this.children=[...children];},
      addEventListener(name,callback){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(callback);},
      async emit(name,event={}){if(name==='click'&&this.disabled)return;for(const callback of this.events.get(name)||[])await callback(event);await this['on'+name]?.(event);},
      focus(){context.document.activeElement=this;},scrollIntoView(options){this.scrolled=options;},querySelectorAll:()=>[],querySelector:()=>null};
  };
  function convert(ast){
    if(!ast.tagName)return null;const element=node(ast.tagName,ast.attrs),id=element.getAttribute('id');
    if(id){assert(!nodes.has(id),'duplicate ID '+id);nodes.set(id,element);}
    if(element.getAttribute('name')==='publicationMode')radios.push(element);
    for(const child of ast.childNodes||[]){const next=convert(child);if(next)element.append(next);else if(child.nodeName==='#text')element._text+=child.value;}
    return element;
  }
  for(const ast of parse(html).childNodes)convert(ast);
  const get=id=>nodes.get(id)||null;
  const work=id=>({id:String(id),title:'실제 작품 '+id,description:'실제 소개',content_type:contentType,rating:'ALL',ai_usage_type:'NONE',
    moderation_state:moderation,trashed_at:trashed?'2026-10-30T00:00:00Z':null,publication_missing:[]});
  const store={save:async context=>heads.set(context.userId+':'+context.id+':'+context.branch,copy(context)),
    backup:async(context,snapshot,reason)=>backups.push({id:context.id,snapshot:copy(snapshot),reason}),
    heads:async(user,work)=>[...heads.values()].filter(row=>row.userId===user&&row.workId===work),history:async()=>[],legacy:async()=>[]};
  const context={URL,URLSearchParams,Blob,Date,console,crypto:{randomUUID:()=>`uuid-${++uuid}`},setTimeout:()=>++uuid,clearTimeout(){},
    history:{replaceState(){}},location:{pathname:'/creator/episodes',search:'',origin:'https://app.test'},navigator:{},confirm:()=>true,
    document:{readyState:'complete',hidden:false,activeElement:null,documentElement:node('html'),getElementById:get,createElement:node,
      createTextNode:text=>({textContent:text}),addEventListener(name,callback){if(!documentEvents.has(name))documentEvents.set(name,[]);documentEvents.get(name).push(callback);},
      querySelectorAll:selector=>selector.includes('publicationMode')?radios:[],
      querySelector:selector=>selector.includes('publicationMode')?radios.find(radio=>radio.value===(selector.includes('SCHEDULED')?'SCHEDULED':'NOW')):null},
    addEventListener(){},visualViewport:{height:320,addEventListener:(name,callback)=>viewportEvents.set(name,callback)},
    WEBNOVELS_CONFIG:{authorPublishEnabled:publish},DraftStore:store,
    CreatorRichEditor:{mount(){},snapshot:()=>richDocument?{contentDocument:copy(richDocument)}:{},assertValid(){},focus(){get('creatorRichBody')?.focus();}},
    CreatorWebtoon:{mount(){},reset(){},hasPending:()=>pendingImages},
    sessionStorage:{getItem:key=>sessionStorage.get(key)||null,setItem:(key,value)=>sessionStorage.set(key,value),removeItem:key=>sessionStorage.delete(key)},
    showToast:message=>messages.push(message),openModal:id=>{get(id).hidden=false;},closeModal:id=>{if(get(id))get(id).hidden=true;},
    switchCreatorTab(){},ReaderContent:{render(body,comment,snapshot){body.textContent=snapshot.content;body.snapshot=copy(snapshot);comment.textContent=snapshot.authorComment;}},
    WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{
      calls.push({path,options});
      if(path==='/api/v2/creator/works?after=0')return {works:['10','20'].map(work),nextCursor:null};
      if(path.startsWith('/api/v2/creator/works/'))return {work:work(path.split('/').at(-1)),episodes:[{id:'700',episode_number:9}]};
      const url=new URL(path,'https://app.test'),id=url.pathname.split('/').at(-1);
      if(url.pathname==='/api/v2/creator/drafts')return {drafts:[...remotes].map(([id,row])=>({id,title:row.title,lifecycle:row.lifecycle}))};
      if(url.pathname.startsWith('/api/v2/creator/drafts/')){
        if(options?.method==='PUT'){
          const data=JSON.parse(options.body),prior=remotes.get(id);
          if(data.expectedRevision!==(prior?.revision||'0'))throw Object.assign(Error('DRAFT_CONFLICT'),{code:'DRAFT_CONFLICT'});
          remotes.set(id,{...copy(data),revision:String(Number(prior?.revision||0)+1),lifecycle:prior?.lifecycle||'ACTIVE',episodeId:prior?.episodeId||null});
        }
        if(!remotes.has(id))throw Object.assign(Error('NOT_FOUND'),{status:404});return {draft:copy(remotes.get(id))};
      }
      if(path.includes('/suggest'))return {episodeNumber:12};
      if(path.includes('/publish/'))return {publication:{status:'PUBLISHED',episodeNumber:12,episodeId:'900'}};
      return {publications:[]};
    }}};
  const sessionStorage=new Map();context.window=context;vm.createContext(context);
  sources.forEach((source,index)=>vm.runInContext(source,context,{filename:fileURLToPath(new URL('../public/js/'+paths[index],import.meta.url))}));
  return {context,get,calls,heads,backups,remotes,messages,editor:context.CreatorDraftEditor,publications:context.CreatorPublications,
    setActor:value=>actor=value,setRich:value=>richDocument=value,setPendingImages:value=>pendingImages=value,
    async type(id,value){get(id).value=value;await get(id).emit('input');},
    async event(name,event){for(const callback of documentEvents.get(name)||[])await callback(event);await settle();},
    viewport:()=>viewportEvents.get('resize')?.()};
}

test('explicit preview with live publication enabled saves the exact current formatted draft without publication calls',async()=>{
  const f=fixture();assert(f.get('btnStudioPreview'),'shipped preview control');await f.editor.openWork('10');
  const document={version:1,paragraphs:[{align:'center',indent:0,runs:[{text:'첫 문단',bold:true,italic:true}]},{align:'right',indent:1,runs:[{text:'다음 문단',underline:true}]}]};
  assert(f.context.ManuscriptDocument.valid(document));f.setRich(document);await f.type('newEpTitle','저장본 제목');await f.type('newEpContent','첫 문단\n\n다음 문단');
  const before=f.editor.getFileContext();await f.get('btnStudioPreview').emit('click');
  const saved=f.remotes.get(before.id);assert(saved);assert.equal(saved.title,'저장본 제목');assert.equal(saved.content,'첫 문단\n\n다음 문단');assert.deepEqual(saved.contentDocument,document);
  assert.equal(f.get('publicationPreviewBody').textContent,saved.content);assert.deepEqual(f.get('publicationPreviewBody').snapshot.contentDocument,document);
  assert.equal(f.get('publicationControls').hidden,true);assert.equal(f.get('publicationListSection').hidden,true);assert.equal(f.get('publicationCommit').disabled,true);
  assert.equal(f.editor.getFileContext().id,before.id);assert.equal(f.editor.getFileContext().seq,before.seq);
  assert(f.calls.some(call=>call.options?.method==='PUT'));assert(!f.calls.some(call=>call.path.startsWith('/api/v2/creator/publications')));
  f.get('publicationRights').checked=true;await f.get('publicationCommit').onclick();
  assert(!f.calls.some(call=>call.path.includes('/publish/')),'preview cannot invoke publication even if its hidden commit handler is called');
});

test('published-edit UI offers review and disables outer scheduling while retaining the actual episode number',async()=>{
  const f=fixture();f.remotes.set('edit',{revision:'3',lifecycle:'ACTIVE',episodeId:'700',title:'수정 초안',content:'공개본 수정',authorComment:''});
  await f.editor.openWork('10','edit');const state=f.editor.getUiState();assert.equal(state.editingPublished,true);assert.equal(state.readOnly,false);
  assert.match(f.get('btnOpenPublication').textContent,/수정 검토 요청/);assert.equal(f.get('btnSchedulePublication').disabled,true);
  assert.match(f.get('studioDraftState').textContent,/공개본 수정/);const count=f.calls.length;await f.get('btnSchedulePublication').emit('click');assert.equal(f.calls.length,count);
  await f.get('btnOpenPublication').emit('click');assert.equal(f.get('publicationCommit').textContent,'수정 검토 요청');
  assert.match(f.get('publicationSummary').textContent,/9화/);assert.equal(f.context.document.querySelector('input[name="publicationMode"][value="SCHEDULED"]').disabled,true);
  assert(!f.calls.some(call=>call.path.includes('/publish/')));
});

for(const mode of ['archived','moderated','trashed'])test(`${mode} manuscripts keep save and publication controls read-only across editor reentry`,async()=>{
  const f=fixture({moderation:mode==='moderated'?'HELD':'CLEAR',trashed:mode==='trashed'});
  f.remotes.set('preserved',{revision:'4',lifecycle:mode==='archived'?'PUBLISHED':'ACTIVE',episodeId:mode==='archived'?'700':null,title:'보존 원고',content:'보존 내용',authorComment:''});
  await f.editor.openWork('10','preserved');await f.editor.enter();assert.equal(f.editor.getUiState().readOnly,true);
  for(const id of ['newEpTitle','newEpContent','newEpAuthorComment','btnSubmitNewEpisode','btnOpenPublication','btnSchedulePublication','btnStudioPreview'])assert.equal(f.get(id).disabled,true,id);
  const before=copy(f.remotes.get('preserved'));await f.get('btnSubmitNewEpisode').emit('click');await f.get('btnOpenPublication').emit('click');
  assert.deepEqual(f.remotes.get('preserved'),before);assert(!f.calls.some(call=>call.options?.method==='PUT'||call.path.includes('/publish/')));
  assert.equal(f.get('newEpContent').value,'보존 내용');assert([...f.heads.values()].some(row=>row.snapshot.content==='보존 내용'));
});

test('presentation identity comes from the actor-bound draft rather than a changed work selector',async()=>{
  const f=fixture({contentType:'WEBTOON'});await f.editor.openWork('10');f.get('newEpWorkSelect').value='20';
  const state=f.editor.getUiState();assert.equal(state.workId,'10');assert.equal(state.contentType,'WEBTOON');assert.match(f.get('studioCurrentWork').textContent,/실제 작품 10/);
  assert.equal(f.get('studioWorkKind').textContent,'웹툰');assert.match(f.get('newEpWorkSelect').innerHTML,/웹툰 · 실제 작품/);
  f.setActor({userId:'user-b',author:{id:'202',status:'APPROVED'}});const changed=f.editor.getUiState();assert.equal(changed.hasDraft,false);assert.equal(changed.workId,null);assert.equal(changed.readOnly,true);
  f.publications.refreshAvailability();assert.equal(f.get('btnOpenPublication').disabled,true);assert.equal(f.get('btnSchedulePublication').disabled,true);
});

test('focus mode and Escape keep pressed state, visible labels and rich editor viewport focus synchronized',async()=>{
  const f=fixture();await f.editor.openWork('10');await f.get('btnDraftFocus').emit('click');
  assert(f.get('creatorTab-new-ep').classList.contains('draft-focus'));assert.equal(f.get('btnDraftFocus').getAttribute('aria-pressed'),'true');assert.match(f.get('btnDraftFocus').textContent,/기본 화면/);
  f.viewport();assert.equal(f.context.document.documentElement.style['--draft-viewport'],'320px');assert.deepEqual(copy(f.get('creatorRichBody').scrolled),{block:'nearest'});
  await f.event('keydown',{key:'Escape'});assert(!f.get('creatorTab-new-ep').classList.contains('draft-focus'));
  assert.equal(f.get('btnDraftFocus').getAttribute('aria-pressed'),'false');assert.equal(f.get('btnDraftFocus').textContent,'집중 편집');
});

test('IME composition and image processing availability do not mutate the current draft or publish before ready',async()=>{
  const f=fixture();await f.editor.openWork('10');await f.type('newEpContent','한글');const id=f.editor.getFileContext().id;
  await f.get('newEpContent').emit('compositionstart');assert.equal(f.editor.getUiState().composing,true);
  assert.equal(f.get('btnSubmitNewEpisode').disabled,true);assert.equal(f.get('btnOpenPublication').disabled,true);assert.equal(f.get('btnStudioPreview').disabled,true);
  await f.get('newEpContent').emit('compositionend');assert.equal(f.get('btnSubmitNewEpisode').disabled,false);assert.equal(f.get('btnStudioPreview').disabled,false);
  f.setPendingImages(true);f.publications.refreshAvailability();assert.equal(f.get('btnStudioPreview').disabled,true);assert.equal(f.get('btnSchedulePublication').disabled,true);
  assert.equal(f.editor.getFileContext().id,id);assert(!f.calls.some(call=>call.path.includes('/publish/')));
});

test('a late same-account preview failure cannot replace a newer successful preview message or toast',async()=>{
  const f=fixture();await f.editor.openWork('10');await f.type('newEpTitle','이전 작품 원고');await f.type('newEpContent','이전 미리보기 본문');
  const original=f.context.WebNovelsAuth.api,oldWork=await original('/api/v2/creator/works/10'),gate=deferred();let hold=true;
  f.context.WebNovelsAuth.api=(path,options)=>path==='/api/v2/creator/works/10'&&hold?gate.promise:original(path,options);
  const oldPreview=f.get('btnStudioPreview').emit('click');await settle();
  await f.editor.openWork('20');await f.type('newEpTitle','새 작품 원고');await f.type('newEpContent','현재 미리보기 본문');
  await f.get('btnStudioPreview').emit('click');
  assert.match(f.get('publicationHeading').textContent,/실제 작품 20/);assert.equal(f.get('publicationPreviewBody').textContent,'현재 미리보기 본문');
  const message=f.get('publicationMessage').textContent,toasts=[...f.messages];
  assert.match(message,/미리보기/);hold=false;gate.resolve(oldWork);await oldPreview;
  assert.equal(f.get('publicationMessage').textContent,message);assert.deepEqual(f.messages,toasts);
  assert.match(f.get('publicationHeading').textContent,/실제 작품 20/);assert.equal(f.get('publicationPreviewBody').textContent,'현재 미리보기 본문');
  assert(!f.calls.some(call=>call.path.includes('/publish/')));
});
