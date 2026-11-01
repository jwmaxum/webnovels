import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const read=name=>readFile(new URL('../public/js/creator/'+name,import.meta.url),'utf8');
const sources=await Promise.all(['draft-engine.js','draft-diff.js','creator-editor.js'].map(read));
const clone=value=>JSON.parse(JSON.stringify(value));
const wait=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function setup({latest=null,rows=[],remote={},offline=false,listFailure=false,getFailure=null}={}){
  const nodes=new Map(),heads=new Map(),backups=[],events={},calls=[],messages=[];let sequence=0,actor={userId:'owner',author:{id:1,status:'APPROVED'}};
  function element(tag='div'){
    return {tagName:tag.toUpperCase(),value:'',textContent:'',innerHTML:'',children:[],events:{},style:{},hidden:false,open:false,
      classList:{toggle(){},add(){},remove(){},contains(){return false;}},setAttribute(){},focus(){},scrollIntoView(){},click(){return this.onclick?.();},
      addEventListener(name,handler){this.events[name]=handler;},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];this.textContent='';}};
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const context={URLSearchParams,URL,Blob,console,crypto:{randomUUID:()=>String(++sequence)},setTimeout:()=>++sequence,clearTimeout(){},location:{search:''},history:{replaceState(){}},
    document:{readyState:'complete',getElementById:get,createElement:element,addEventListener(name,handler){events[name]=handler;},documentElement:{style:{setProperty(){}}}},
    addEventListener(name,handler){events[name]=handler;},showToast:message=>messages.push(message),confirm:()=>true,closeModal(){},openModal(){},switchCreatorTab(){},
    WebNovelsAuth:{getActor:()=>actor,async api(path,options){
      calls.push({path,options});
      if(path.startsWith('/api/v2/creator/works'))return {works:['10','20'].map(id=>({id,title:'작품 '+id,moderation_state:'CLEAR'})),nextCursor:null};
      if(path.match(/\/drafts\?/)){if(listFailure)throw Error('offline list');return {drafts:clone(rows)};}
      if(getFailure)throw Object.assign(Error('access denied'),{status:getFailure});
      if(offline)throw Error('offline get');
      const id=path.match(/\/drafts\/([^?]+)/)?.[1];
      return {draft:clone(remote[id]||{id,revision:'1',title:'server '+id,content:'server body',lifecycle:'ACTIVE'})};
    }},DraftStore:{save:async head=>heads.set(head.id+':'+head.branch,clone(head)),backup:async(head,snapshot,reason)=>backups.push({id:head.id,snapshot:clone(snapshot),reason}),
      latest:async(user,work)=>{const value=typeof latest==='function'?await latest():latest;return value?.userId===user&&value.workId===work?clone(value):null;},
      heads:async(user,work)=>[...(latest?[typeof latest==='function'?null:latest]:[]),...heads.values()].filter(head=>head?.userId===user&&head.workId===work),history:async()=>[],legacy:async()=>[]}};
  context.window=context;vm.createContext(context);sources.forEach(source=>vm.runInContext(source,context));
  return {context,get,heads,backups,calls,messages,editor:context.CreatorDraftEditor,setActor:value=>{actor=value;}};
}
const device=(extra={})=>({userId:'owner',workId:'10',id:'local',branch:'preserved',revision:'2',lifecycle:'ACTIVE',snapshot:{title:'latest local',content:'not on server'},seq:3,serverSeq:2,pending:null,...extra});
const summary=(id,time,lifecycle='ACTIVE')=>({id,title:id,lifecycle,revision:'3',updatedAt:time});
const descendants=node=>[node,...node.children.flatMap(descendants)];

test('one current card combines storage; previous branches/server/legacy stay in collapsed recovery',async()=>{
  const s=setup({latest:device(),rows:[summary('other','2026-11-01T10:00:00Z'),'archived'].filter(row=>typeof row==='object')});
  await s.editor.openWork('10');const box=s.get('draftCopies');
  assert.equal(box.children.filter(node=>node.className==='draft-latest-card').length,1);
  assert.equal(box.children.filter(node=>node.className==='draft-recovery-history').length,1);
  const disclosure=box.children.find(node=>node.tagName==='DETAILS');assert.equal(disclosure.open,false,'stale dirty copies never auto-expand recovery');
  assert.ok(descendants(disclosure).some(node=>node.textContent.startsWith('기기 사본 복구:')));
  assert.ok(descendants(disclosure).some(node=>node.textContent.startsWith('서버 원고:')));
  assert.equal(s.get('newEpContent').value,'not on server');assert.equal(s.editor.getFileContext().id,'local');
  assert.equal(descendants(box).filter(node=>node.tagName==='BUTTON'&&!descendants(disclosure).includes(node)).length,0);
});

test('clean device pointer follows authoritative newer server manuscript, without comparing device clocks',async()=>{
  const s=setup({latest:device({seq:3,serverSeq:3}),rows:[summary('latest-server','2026-11-01T10:00:00.000002Z'),summary('local','2026-11-01T10:00:00.000001Z')],
    remote:{'latest-server':{revision:'3',title:'edited on another device',content:'authoritative latest',lifecycle:'ACTIVE'}}});
  await s.editor.openWork('10');assert.equal(s.editor.getFileContext().id,'latest-server');assert.equal(s.get('newEpContent').value,'authoritative latest');
  assert.equal(s.backups.length,0);
});

test('dirty pointer wins over another server draft; changed base exposes conflict and preserves both snapshots',async()=>{
  const s=setup({latest:device({pending:{key:'unknown-result',seq:2,data:{expectedRevision:'2',content:'submitted earlier'}}}),rows:[summary('different','2026-11-01T11:00:00Z')],
    remote:{local:{revision:'4',title:'remote title',content:'remote changed',lifecycle:'ACTIVE'}}});
  await s.editor.openWork('10');assert.equal(s.editor.getFileContext().id,'local');assert.equal(s.get('newEpContent').value,'not on server');
  assert.equal(s.get('draftConflict').hidden,false);assert.equal(s.editor.getUiState().conflict,true);
  assert.ok(s.backups.some(row=>row.reason==='resume-server'&&row.snapshot.content==='remote changed'));
  assert.ok([...s.heads.values()].some(row=>row.pending?.key==='unknown-result'&&row.revision==='2'));
  assert.equal(s.calls.some(call=>call.options?.method==='PUT'),false);
});

test('current same-work edit remains selected; fresh draft is explicit and switching works restores identity',async()=>{
  const s=setup();await s.editor.openWork('10',null,{fresh:true});const id=s.editor.getFileContext().id;
  s.get('newEpContent').value='typing';s.get('newEpContent').events.input();await s.editor.openWork('10');assert.equal(s.editor.getFileContext().id,id);
  await s.editor.openWork('20',null,{fresh:true});await s.editor.openWork('10');assert.equal(s.editor.getFileContext().id,id);assert.equal(s.get('newEpContent').value,'typing');
  await s.editor.openWork('10',null,{fresh:true});assert.notEqual(s.editor.getFileContext().id,id);assert.equal(s.get('newEpContent').value,'');
});

test('offline resume preserves exact pending payload and base; published remote never becomes editable',async()=>{
  const pending={key:'retry-unchanged',seq:2,data:{expectedRevision:'2',title:'before disconnect',content:'before disconnect'}};
  const s=setup({latest:device({pending}),offline:true});await s.editor.openWork('10');
  assert.equal(s.get('newEpContent').value,'not on server');const saved=[...s.heads.values()].find(row=>row.pending);
  assert.deepEqual(saved.pending.data,pending.data);assert.equal(saved.pending.key,pending.key);assert.equal(saved.revision,'2');
  const published=setup({latest:device(),remote:{local:{revision:'3',content:'immutable published',lifecycle:'PUBLISHED',hasPublicationHistory:true}}});
  await published.editor.openWork('10');assert.equal(published.get('newEpContent').value,'immutable published');assert.equal(published.get('newEpContent').disabled,true);
  assert.equal(published.editor.getUiState().editingPublished,true);assert.equal(published.backups.length,0);
});

test('actor change during latest read cannot reveal an old account or resume its draft',async()=>{
  const held=wait(),s=setup({latest:()=>held.promise});const opening=s.editor.openWork('10');
  await new Promise(resolve=>setImmediate(resolve));s.editor.onAuthLost();s.setActor({userId:'other',author:{id:2,status:'APPROVED'}});held.resolve(device());await opening;
  assert.equal(s.editor.getFileContext(),null);assert.equal(s.get('newEpContent').value,'');assert.equal(s.get('draftCopies').children.length,0);
});

test('authorization failures cannot use an existing device head as offline fallback, including a draft URL',async()=>{
  for(const status of [401,403]){
    const s=setup({latest:device(),getFailure:status});await s.editor.openWork('10');
    assert.equal(s.editor.getFileContext(),null);assert.equal(s.get('newEpContent').value,'');
    s.context.location.search='?work=10&draft=local';await s.editor.enter();
    assert.equal(s.editor.getFileContext(),null);assert.equal(s.get('newEpContent').value,'');
  }
});

test('returning to a clean inactive context refreshes the newer server revision instead of reusing stale memory',async()=>{
  const rows=[summary('shared','2026-11-01T10:00:00Z')],remote={shared:{revision:'1',title:'before',content:'before',lifecycle:'ACTIVE'}};
  const s=setup({rows,remote});await s.editor.openWork('10');await s.editor.openWork('20',null,{fresh:true});
  remote.shared={revision:'3',title:'updated elsewhere',content:'new remote revision',lifecycle:'ACTIVE'};
  await s.editor.openWork('10');assert.equal(s.editor.getFileContext().id,'shared');assert.equal(s.get('newEpContent').value,'new remote revision');
  assert.ok([...s.heads.values()].some(row=>row.snapshot.content==='before'),'previous clean branch remains recoverable');
});

test('old recovery action remains explicit, backups current first, and opens original draft identity',async()=>{
  const s=setup({latest:device(),remote:{local:{revision:'2',content:'server acknowledged',lifecycle:'ACTIVE'}},rows:[summary('old-server','2026-10-01T11:00:00Z')]});
  await s.editor.openWork('10');const previous=[...s.heads.values()].find(row=>row.snapshot.content==='not on server');
  s.heads.set('older:branch',{...device({id:'older',branch:'older-branch',snapshot:{title:'older backup',content:'old content'}})});
  await s.get('btnDraftRefresh').events.click();const recover=descendants(s.get('draftCopies')).find(node=>node.textContent==='기기 사본 복구: older backup · older');
  assert.ok(recover);assert.equal(s.editor.getFileContext().id,'local');await recover.onclick();
  assert.equal(s.editor.getFileContext().id,'older');assert.equal(s.get('newEpContent').value,'old content');
  assert.ok(s.heads.has(previous.id+':'+previous.branch),'previous current remains durably available');assert.ok(s.backups.some(row=>row.reason==='before-recovery'));
});
