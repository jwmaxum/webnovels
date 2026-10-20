import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const paths=['core/ui-utils.js','creator/draft-engine.js','creator/draft-diff.js','creator/creator-readiness.js',
  'creator/creator-editor.js','creator/creator-publications.js','creator/creator.js']
  .map(p=>fileURLToPath(new URL('../public/js/'+p,import.meta.url)));
const sources=await Promise.all(paths.map(p=>readFile(p,'utf8')));
const clone=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

// Deliberately limited DOM adapter built from the shipped HTML, not invented IDs.
// This verifies wiring in Node; native browser/IndexedDB acceptance is separate.
function setup({publish=true,workspace=false}={}){
  const ids=new Map(),radios=[],heads=new Map(),backups=[],calls=[],storage=new Map(),remotes=new Map(),legacy=[];
  let uuid=0,actor={userId:'user-a',author:{id:'101',status:'APPROVED'},authorWorkspaceReady:workspace};
  const node=(tag='div',attrs=[])=>{
    const attributes=new Map(attrs.map(a=>[a.name,a.value])),classes=new Set((attributes.get('class')||'').split(' '));
    return {tagName:tag.toUpperCase(),attributes,children:[],events:{},style:{},value:attributes.get('value')||'',
      hidden:attributes.has('hidden'),disabled:attributes.has('disabled'),checked:attributes.has('checked'),_text:'',
      classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:c=>classes.has(c)?classes.delete(c):classes.add(c),contains:c=>classes.has(c)},
      set textContent(v){this._text=String(v);this.children=[];},get textContent(){return this._text+this.children.map(c=>c.textContent).join('');},
      setAttribute(k,v){attributes.set(k,v);},getAttribute:k=>attributes.get(k),
      append(...items){this.children.push(...items);},appendChild(item){this.append(item);},
      replaceChildren(...items){this._text='';this.children=items;},
      addEventListener(k,fn){(this.events[k]??=[]).push(fn);},
      async emit(k,event={}){for(const fn of this.events[k]||[])await fn(event);await this['on'+k]?.(event);},
      focus(){},scrollIntoView(){},querySelectorAll:()=>[],querySelector:()=>null};
  };
  function convert(ast){
    if(!ast.tagName)return null;
    const element=node(ast.tagName,ast.attrs);element.id=element.getAttribute('id');
    if(element.id){assert.equal(ids.has(element.id),false,`duplicate HTML ID ${element.id}`);ids.set(element.id,element);}
    if(element.getAttribute('name')==='publicationMode')radios.push(element);
    for(const child of ast.childNodes||[]){const next=convert(child);if(next)element.append(next);else if(child.nodeName==='#text')element._text+=child.value;}
    return element;
  }
  const ast=parse(html);for(const child of ast.childNodes)convert(child);
  const get=id=>ids.get(id)||null;
  const work=id=>({id,title:'작품 '+id,description:'소개',content_type:'NOVEL',rating:'ALL',ai_usage_type:'NONE',moderation_state:'CLEAR',publication_missing:[]});
  const fixture={localError:false,legacyError:false,listError:false,listGate:null,publicationListError:false};
  const store={
    save:async c=>heads.set(c.userId+':'+c.id+':'+c.branch,clone(c)),
    backup:async(c,snapshot,reason)=>backups.push({id:c.id,snapshot:clone(snapshot),reason}),
    heads:async(u,w)=>{if(fixture.localError)throw Error('IDB_BLOCKED');return [...heads.values()].filter(c=>c.userId===u&&c.workId===w);},
    history:async()=>[],legacy:async(a,w)=>{if(fixture.legacyError)throw Error('IDB_BLOCKED');return legacy.filter(r=>r.key.startsWith(a+':'+w+':'));},
    importLegacy:async(u,a,w,row)=>{assert.ok(row.key.startsWith(a+':'+w+':'));return {userId:u,workId:w,id:'imported',snapshot:clone(row)};}
  };
  const context={console,URLSearchParams,Blob,URL,Date,crypto:{randomUUID:()=>`uuid-${++uuid}`},setTimeout:()=>++uuid,clearTimeout(){},
    location:{pathname:'/creator/episodes',search:'',origin:'https://app.test'},history:{replaceState(){}},confirm:()=>true,
    document:{readyState:'complete',hidden:false,getElementById:get,createElement:node,addEventListener(){},
      querySelectorAll:selector=>selector.includes('publicationMode')?radios:[],
      querySelector:selector=>selector.includes('publicationMode')?radios.find(r=>r.value===(selector.includes('SCHEDULED')?'SCHEDULED':'NOW')):null},
    addEventListener(){},DraftStore:store,WEBNOVELS_CONFIG:{authorPublishEnabled:publish},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},navigator:{},
    ReaderContent:{render:(body,comment,snapshot)=>{body.textContent=snapshot.content;comment.textContent=snapshot.authorComment;}},
    WebNovelsAuth:{getActor:()=>actor,api:async(path,options)=>{
      calls.push({path,options});
      if(path==='/api/v2/creator/works?after=0')return {works:['10','20'].map(work),nextCursor:null};
      if(path.startsWith('/api/v2/creator/works/'))return {work:work(path.split('/').at(-1)),episodes:[]};
      const url=new URL(path,'https://app.test'),id=url.pathname.split('/').at(-1);
      if(url.pathname==='/api/v2/creator/drafts'){
        if(fixture.listGate)await fixture.listGate.promise;
        if(fixture.listError)throw Error('NETWORK');
        return {drafts:[...remotes].map(([id,r])=>({id,title:r.title,lifecycle:r.lifecycle}))};
      }
      if(url.pathname.startsWith('/api/v2/creator/drafts/')){
        if(options?.method==='PUT'){
          const data=JSON.parse(options.body),prior=remotes.get(id);
          if(data.expectedRevision!==(prior?.revision||'0'))throw Object.assign(Error('DRAFT_CONFLICT'),{code:'DRAFT_CONFLICT'});
          remotes.set(id,{...data,revision:String(Number(prior?.revision||0)+1),lifecycle:'ACTIVE',episodeId:null});
        }
        if(!remotes.has(id))throw Object.assign(Error('NOT_FOUND'),{status:404});
        return {draft:clone(remotes.get(id))};
      }
      if(path.includes('/suggest'))return {episodeNumber:1};
      if(path.includes('/publish/'))return {publication:{status:'PUBLISHED',episodeNumber:1,episodeId:'300'}};
      if(fixture.publicationListError)throw Error('PUBLICATION_UNAVAILABLE');
      return {publications:[]};
    }}
  };
  context.window=context;vm.createContext(context);sources.forEach((source,i)=>vm.runInContext(source,context,{filename:paths[i]}));
  const editor=context.CreatorDraftEditor;
  async function type(id,value){get(id).value=value;await get(id).emit('input');}
  const buttons=()=>get('draftCopies').children.flatMap(s=>s.children).filter(n=>n.tagName==='BUTTON');
  return {context,editor,get,heads,backups,calls,remotes,fixture,storage,legacy,store,buttons,type,setActor:a=>actor=a};
}

test('shipped form submits private save and publication button opens the real guarded modal with the saved revision',async()=>{
  const s=setup();await s.editor.openWork('10');await s.type('newEpTitle','첫 원고');await s.type('newEpContent','본문\n\n다음 문단');
  let prevented=false;
  const handler=s.get('formCreateEpisode').getAttribute('onsubmit');
  s.context.event={preventDefault(){prevented=true;}};
  await vm.runInContext(handler,s.context);assert.equal(prevented,true);
  assert.equal(s.remotes.get(s.editor.getFileContext().id).content,'본문\n\n다음 문단');
  assert.match(s.get('toastContainer').textContent,/비공개 원고를 서버에 저장했습니다. 버전 1/);
  await s.get('btnOpenPublication').emit('click');
  assert.equal(s.get('modalCreatorPublication').hidden,false);assert.equal(s.get('modalCreatorPublication').classList.contains('active'),true);
  assert.equal(s.get('publicationPreviewBody').textContent,'본문\n\n다음 문단');
  assert.match(s.get('publicationSummary').textContent,/서버 원고 버전 1/);
  assert.equal(s.get('publicationControls').hidden,false);
  s.get('publicationRights').checked=true;await s.get('publicationCommit').emit('click');
  assert.equal(s.calls.filter(c=>c.path.includes('/publish/')).length,1);assert.match(s.get('publicationResultText').textContent,/공개됐습니다/);
});

for(const config of [{publish:false},{workspace:true}])test(`restricted workspace still previews saved owner draft without publication requests ${JSON.stringify(config)}`,async()=>{
  const s=setup(config);await s.editor.openWork('10');await s.type('newEpTitle','비공개');await s.type('newEpContent','보존할 본문');
  s.storage.set('creator-publication:user-a:'+s.editor.getFileContext().id,'{"key":"old-request","data":{"revision":"1"}}');
  await s.get('btnOpenPublication').emit('click');
  assert.equal(s.get('btnOpenPublication').textContent,'원고 미리보기');assert.equal(s.get('modalCreatorPublication').hidden,false);
  assert.equal(s.get('publicationPreviewBody').textContent,'보존할 본문');assert.equal(s.get('publicationControls').hidden,true);
  assert.match(s.get('publicationChecklist').innerHTML,/게시 기능은 준비 중/);
  assert.match(s.get('creatorPublicationNotice').textContent,/공개 발행은 서비스 연결 준비 중/);
  await s.get('publicationCommit').emit('click');await s.get('publicationRetry').emit('click');
  assert.equal(s.calls.filter(c=>c.path.includes('/publications')).length,0);assert.equal(s.storage.size,1);
});

test('publication permission is checked again if capabilities change after preview',async()=>{
  const s=setup();await s.editor.openWork('10');await s.type('newEpContent','body');await s.get('btnOpenPublication').emit('click');
  s.context.WEBNOVELS_CONFIG.authorPublishEnabled=false;s.get('publicationRights').checked=true;await s.get('publicationCommit').emit('click');
  assert.equal(s.calls.filter(c=>c.path.includes('/publish/')).length,0);assert.match(s.get('publicationMessage').textContent,/활성화/);
});

test('publication list outage still previews saved draft and preserves pending publication without sending a new one',async()=>{
  const s=setup();await s.editor.openWork('10');await s.type('newEpTitle','제목');await s.type('newEpContent','저장할 본문');
  s.fixture.publicationListError=true;
  s.storage.set('creator-publication:user-a:'+s.editor.getFileContext().id,'{"key":"prior-request","data":{"revision":"1"}}');
  await s.get('btnOpenPublication').emit('click');assert.equal(s.get('publicationPreviewBody').textContent,'저장할 본문');
  assert.equal(s.get('publicationControls').hidden,true);assert.match(s.get('publicationMessage').textContent,/공개·예약 상태를 불러오지 못해/);
  await s.get('publicationCommit').emit('click');await s.get('publicationRetry').emit('click');
  assert.equal(s.calls.filter(c=>c.path.includes('/publish/')).length,0);assert.equal(s.storage.size,1);
});

test('copy sources show empty states and refresh when details is opened',async()=>{
  const s=setup();await s.get('draftCopyDetails').emit('toggle');await s.get('btnDraftRefresh').emit('click');
  assert.match(s.get('draftCopies').textContent,/작품을 선택/);
  await s.editor.openWork('10');assert.match(s.get('draftCopies').textContent,/서버 원고가 없습니다/);assert.match(s.get('draftCopies').textContent,/이전 편집기 원고가 없습니다/);
  s.remotes.set('server',{revision:'2',title:'저장된 원고',content:'body',authorComment:'',lifecycle:'ACTIVE'});
  s.get('draftCopyDetails').open=true;await s.get('draftCopyDetails').emit('toggle');await settle();
  assert.ok(s.buttons().some(b=>b.textContent.includes('서버 원고: 저장된 원고')));
});

test('IDB source errors do not block server list; server error does not block device and legacy copies',async()=>{
  const s=setup();await s.editor.openWork('10');s.fixture.localError=true;s.fixture.legacyError=true;
  s.remotes.set('server',{revision:'2',title:'서버 보존',content:'body',authorComment:'',lifecycle:'ACTIVE'});
  await s.get('btnDraftRefresh').emit('click');assert.ok(s.buttons().some(b=>b.textContent.includes('서버 보존')));
  assert.match(s.get('draftCopies').textContent,/목록을 불러오지 못했습니다/);
  s.fixture.localError=false;s.fixture.legacyError=false;s.fixture.listError=true;
  s.heads.set('copy',{userId:'user-a',workId:'10',id:'copy',branch:'other',revision:'0',lifecycle:'ACTIVE',seq:1,serverSeq:-1,snapshot:{title:'기기 보존',content:'local'}});
  s.legacy.push({key:'101:10:1',title:'이전 원고',content:'legacy'},{key:'202:10:1',title:'다른 작가',content:'secret'});
  await s.get('btnDraftRefresh').emit('click');assert.ok(s.buttons().some(b=>b.textContent.includes('기기 보존')));assert.ok(s.buttons().some(b=>b.textContent.includes('이전 원고')));
  assert.doesNotMatch(s.get('draftCopies').textContent,/다른 작가/);
});

test('reopening same server draft fetches new revision and preserves current device branch',async()=>{
  const s=setup();s.remotes.set('server',{revision:'1',title:'초기',content:'old',authorComment:'',lifecycle:'ACTIVE'});
  await s.editor.openWork('10','server');await s.type('newEpContent','local edits');
  s.remotes.set('server',{revision:'7',title:'서버 최신',content:'remote latest',authorComment:'',lifecycle:'ACTIVE'});
  const button=s.buttons().find(b=>b.textContent.startsWith('서버 원고:'));await button.emit('click');
  assert.equal(s.get('newEpContent').value,'remote latest');assert.equal(s.editor.getFileContext().id,'server');
  assert.match(s.get('draftIdentity').textContent,/서버 버전 7/);
  assert.ok([...s.heads.values()].some(r=>r.snapshot.content==='local edits'));assert.equal(s.calls.filter(c=>c.options?.method==='PUT').length,0);
  const copy=s.buttons().find(b=>b.textContent.startsWith('기기 사본 복구:'));await copy.emit('click');
  assert.equal(s.get('newEpContent').value,'local edits');assert.ok(s.backups.some(b=>b.snapshot.content==='remote latest'));
});

test('legacy import verifies owner and retains source; recovery creates a fresh mapped draft',async()=>{
  const s=setup();s.legacy.push({key:'101:10:1',title:'이전 원고',content:'보존된 이전 본문',authorComment:''});
  await s.editor.openWork('10');await s.type('newEpContent','현재 본문');
  await s.buttons().find(b=>b.textContent.startsWith('이전 편집기 원고 가져오기:')).emit('click');
  assert.equal(s.editor.getFileContext().id,'imported');assert.equal(s.get('newEpContent').value,'보존된 이전 본문');assert.equal(s.legacy.length,1);
  assert.ok(s.calls.some(c=>c.path==='/api/v2/creator/works/10'));assert.ok([...s.heads.values()].some(r=>r.snapshot.content==='현재 본문'));
});

test('late list response and retained old buttons cannot revive another account or work',async()=>{
  const s=setup();s.remotes.set('server',{revision:'1',title:'비밀 원고',content:'private',authorComment:'',lifecycle:'ACTIVE'});
  await s.editor.openWork('10');const oldButton=s.buttons()[0],held=gate();s.fixture.listGate=held;
  const refresh=s.get('btnDraftRefresh').emit('click');await settle();s.editor.onAuthLost();
  s.setActor({userId:'user-b',author:{id:'202',status:'APPROVED'}});held.resolve();await refresh;
  assert.equal(s.get('draftCopies').textContent,'');const before=s.calls.length;await oldButton.emit('click');assert.equal(s.calls.length,before);
});

test('preview modal guard refuses readers and author requests outside the studio',()=>{
  const s=setup({publish:false});s.setActor({userId:'reader',reader:{}});s.context.openModal('modalCreatorPublication');assert.equal(s.get('modalCreatorPublication').hidden,true);
  s.setActor({userId:'user-a',author:{status:'APPROVED'}});s.context.location.pathname='/';s.context.openModal('modalCreatorPublication');assert.equal(s.get('modalCreatorPublication').hidden,true);
});
