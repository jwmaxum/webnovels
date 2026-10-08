import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const paths=['draft-engine.js','creator-readiness.js','creator-editor.js'].map(p=>fileURLToPath(new URL('../public/js/creator/'+p,import.meta.url)));
const sources=await Promise.all(paths.map(p=>readFile(p,'utf8')));
const settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function setup({put=async()=>{},getRemote=async x=>x}={}){
  let now=0,uuid=0,timerId=0,user={userId:'user-a',author:{id:'101',status:'APPROVED'}},active=0,maxActive=0,engine;
  const jobs=new Map(),elements=new Map(),listeners={},heads=new Map(),backups=[],writes=[],remotes=new Map(),receipts=new Map(),messages=[];
  const element=()=>({value:'',textContent:'',innerHTML:'',style:{},events:{},children:[],classList:{remove(){},toggle(){}},
    addEventListener(k,v){this.events[k]=v;},replaceChildren(){this.textContent='';this.innerHTML='';this.children=[];},append(x){this.children.push(x);},focus(){}});
  const el=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const context={URLSearchParams,Blob,URL,console,crypto:{randomUUID:()=>`id-${++uuid}`},Date:class extends Date{static now(){return now;}},
    setTimeout:(fn,ms)=>{jobs.set(++timerId,{fn,at:now+ms});return timerId;},clearTimeout:id=>jobs.delete(id),
    location:{search:''},history:{replaceState(){}},document:{readyState:'complete',hidden:false,getElementById:el,createElement:element,addEventListener:(k,v)=>listeners[k]=v},
    addEventListener:(k,v)=>listeners[k]=v,showToast:m=>messages.push(m),confirm:()=>true,closeModal(){},switchCreatorTab(){},
    WebNovelsAuth:{getActor:()=>user,api:async(path,options)=>{
      if(path.startsWith('/api/v2/creator/works'))return {works:['10','20'].map(id=>({id,title:'work',moderation_state:'CLEAR'})),nextCursor:null};
      if(path.match(/\/drafts\?/))return {drafts:[]};
      const id=path.match(/\/drafts\/([^?]+)/)?.[1];
      if(options?.method==='PUT'){
        const body=JSON.parse(options.body),key=options.headers['Idempotency-Key'];
        const call={at:now,path,body,key,userId:user.userId};writes.push(call);active++;maxActive=Math.max(active,maxActive);
        try{
          const prior=receipts.get(key);if(prior)assert.deepEqual(body,prior.body);
          const revision=prior?.draft.revision||String(Number(remotes.get(id)?.revision||0)+1);
          const draft=prior?.draft||{...body,revision,lifecycle:'ACTIVE',episodeId:null};
          // Receipt committed before a simulated lost response, just like an ambiguous network result.
          receipts.set(key,{body,draft});remotes.set(id,draft);
          await put(call,writes.length);return {draft};
        }finally{active--;}
      }
      return {draft:await getRemote(structuredClone(remotes.get(id)||{revision:'9',title:'remote',content:'remote',authorComment:'',lifecycle:'ACTIVE'}))};
    }},DraftStore:{save:async c=>heads.set(c.userId+':'+c.branch,structuredClone(c)),backup:async(c,s,reason)=>backups.push({id:c.id,snapshot:structuredClone(s),reason}),
      heads:async(u,w)=>[...heads.values()].filter(c=>c.userId===u&&c.workId===w),legacy:async()=>[]}};
  context.window=context;vm.createContext(context);vm.runInContext(sources[0],context,{filename:paths[0]});
  const Base=context.DraftEngine;context.DraftEngine=class extends Base{constructor(options){super(options);engine=this;}};
  sources.slice(1).forEach((source,index)=>vm.runInContext(source,context,{filename:paths[index+1]}));
  async function advance(ms){const target=now+ms;let iterations=0;await settle();while(true){
    const next=[...jobs.entries()].filter(([,j])=>j.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;
    assert.ok(++iterations<2000,'timer retry loop');now=next[1].at;jobs.delete(next[0]);next[1].fn();await settle();
  }now=target;await settle();}
  function type(value){el('newEpContent').value=value;el('newEpContent').events.input();}
  return {editor:context.CreatorDraftEditor,context,el,type,advance,writes,heads,backups,messages,listeners,
    get engine(){return engine;},get maxActive(){return maxActive;},setUser:value=>user=value};
}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('continuous typing saves at 30s deadlines; idle debounce still saves and clean drafts never repeat PUT',async()=>{
  const s=setup();await s.editor.openWork('10');
  for(let i=0;i<60;i++){s.type('text-'+i);await s.advance(1000);}
  assert.deepEqual(s.writes.map(x=>x.at),[30000,60000]);assert.equal(s.writes[0].body.content,'text-29');assert.equal(s.writes[1].body.content,'text-59');
  s.type('idle-final');await s.advance(2499);assert.equal(s.writes.length,2);await s.advance(1);assert.equal(s.writes[2].body.content,'idle-final');
  await s.advance(60000);assert.equal(s.writes.length,3);assert.equal(s.engine.current.serverSeq,s.engine.current.seq);
});
test('IME keeps original deadline; manual save, online and preview wait for final composition',async()=>{
  const s=setup();await s.editor.openWork('10');
  for(let i=0;i<28;i++){s.type('before-'+i);await s.advance(1000);}
  s.el('newEpContent').events.compositionstart();s.type('조합ㅈ');await s.advance(5000);
  await s.editor.save();await s.listeners.online();await assert.rejects(s.editor.preparePublication(),/DRAFT_COMPOSING/);assert.equal(s.writes.length,0);
  s.el('newEpContent').value='조합 완료';s.el('newEpContent').events.compositionend();await s.advance(0);
  assert.equal(s.writes.length,1);assert.equal(s.writes[0].body.content,'조합 완료');assert.equal(s.writes[0].at,33000);
});
test('slow sync stays serialized and only acknowledges its snapshot; overdue later edits save after it finishes',async()=>{
  const held=gate(),s=setup({put:async(_,n)=>{if(n===1)await held.promise;}});await s.editor.openWork('10');
  s.type('first');await s.advance(3000);
  for(let i=0;i<33;i++){s.type('later-'+i);await s.advance(1000);}
  assert.equal(s.writes.length,1);held.resolve();await settle();assert.ok(s.engine.current.serverSeq<s.engine.current.seq);
  await s.advance(0);assert.equal(s.writes.length,2);assert.equal(s.writes[1].body.content,'later-32');assert.equal(s.maxActive,1);
});
test('lost save response has no retry loop; later input first replays exact key/body then saves new seq',async()=>{
  const s=setup({put:async(_,n)=>{if(n===1)throw Error('NETWORK');}});await s.editor.openWork('10');s.type('first');await s.advance(2500);
  await s.advance(60000);assert.equal(s.writes.length,1);assert.ok(s.engine.current.pending);
  s.type('after-failure');await s.advance(5000);assert.equal(s.writes.length,3);
  assert.equal(s.writes[0].key,s.writes[1].key);assert.deepEqual(s.writes[0].body,s.writes[1].body);
  assert.notEqual(s.writes[2].key,s.writes[1].key);assert.equal(s.writes[2].body.content,'after-failure');assert.equal(s.writes[2].body.expectedRevision,'1');
});
test('revision conflict preserves local and remote snapshots and stops timers',async()=>{
  const s=setup({put:async()=>{throw Object.assign(Error('conflict'),{code:'DRAFT_CONFLICT'});}});await s.editor.openWork('10');s.type('local');await s.advance(2500);
  assert.ok(s.engine.current.conflict);assert.ok(s.backups.some(x=>x.reason==='conflict-server'));assert.equal([...s.heads.values()][0].snapshot.content,'local');
  s.type('local again');await s.advance(70000);assert.equal(s.writes.length,1);
  assert.equal([...s.heads.values()][0].snapshot.content,'local again');
});
test('work/account switches cancel old timers and reset unfinished IME without deleting local copies',async()=>{
  const s=setup();await s.editor.openWork('10');s.type('private-a');s.el('newEpContent').events.compositionstart();
  await s.editor.openWork('20');s.type('work-b');await s.advance(2500);assert.equal(s.writes.length,1);assert.match(s.writes[0].path,/workId=20/);
  s.type('private-b');s.el('newEpContent').events.compositionstart();await s.editor.beforeAccountChange();s.editor.onAuthLost();
  s.setUser({userId:'user-b',author:{id:'202',status:'APPROVED'}});await s.editor.openWork('10');s.type('new-account');await s.advance(40000);
  assert.equal(s.writes.length,2);assert.equal(s.writes[1].userId,'user-b');assert.ok([...s.heads.values()].some(c=>c.userId==='user-a'&&c.snapshot.content==='private-a'));
});
test('navigation suspends timers; returning resumes unsynced draft',async()=>{
  const s=setup();await s.editor.openWork('10');s.type('draft');await s.editor.checkpoint();await s.advance(60000);assert.equal(s.writes.length,0);
  await s.editor.enter();await s.advance(2500);assert.equal(s.writes[0].body.content,'draft');
});
test('remote preview comparison rejects typing and navigation that happen while GET is pending',async()=>{
  const held=gate();let delay=false;
  const s=setup({getRemote:async value=>{if(delay)await held.promise;return value;}});await s.editor.openWork('10');s.type('saved');await s.editor.save();
  delay=true;const preview=s.editor.preparePublication();await settle();s.type('new edit');held.resolve();await assert.rejects(preview,/PUBLISH_SAVE_REQUIRED/);
  const held2=gate(),other=setup({getRemote:async value=>{await held2.promise;return value;}});await other.editor.openWork('10');other.type('saved');await other.editor.save();
  const pending=other.editor.preparePublication();await settle();await other.editor.checkpoint();held2.resolve();await assert.rejects(pending,/PUBLISH_SAVE_REQUIRED/);
});
test('edits after publish request are backed up; next episode opens a new UUID and retains archived draft',async()=>{
  const s=setup();await s.editor.openWork('10');s.type('published');await s.editor.save();const expected={...s.editor.getFileContext()};
  s.type('later edits');await s.editor.markPublished(expected);assert.equal(s.el('newEpContent').disabled,true);
  assert.ok(s.backups.some(x=>x.reason==='after-publish-edits'&&x.snapshot.content==='later edits'));
  await s.editor.startNext('10');assert.notEqual(s.editor.getFileContext().id,expected.id);assert.equal(s.el('newEpContent').value,'');
  assert.ok([...s.heads.values()].some(x=>x.id===expected.id&&x.lifecycle==='PUBLISHED'&&x.snapshot.content==='later edits'));
  const copy=s.el('draftCopies').children.find(x=>x.textContent.startsWith('보관 사본을 새 원고로 복사'));
  await copy.onclick();assert.notEqual(s.editor.getFileContext().id,expected.id);assert.equal(s.engine.current.lifecycle,'ACTIVE');assert.equal(s.engine.current.revision,'0');assert.equal(s.el('newEpContent').value,'later edits');
  assert.ok([...s.heads.values()].some(x=>x.id===expected.id&&x.lifecycle==='PUBLISHED'));
});
test('backup failure after confirmed publication still persists latest archived head for download or fresh-copy recovery',async()=>{
  const s=setup();await s.editor.openWork('10');s.type('published');await s.editor.save();const expected=s.editor.getFileContext();s.type('last edit');
  s.context.DraftStore.backup=async()=>{throw Error('BACKUP_FAILED');};await assert.rejects(s.editor.markPublished(expected),/BACKUP_FAILED/);
  assert.ok([...s.heads.values()].some(x=>x.id===expected.id&&x.lifecycle==='PUBLISHED'&&x.snapshot.content==='last edit'));
});
test('composition starting during publication checkpoint cannot send a partial IME snapshot',async()=>{
  const s=setup(),held=gate();await s.editor.openWork('10');s.type('complete input');
  const save=s.context.DraftStore.save;let first=true;
  s.context.DraftStore.save=async c=>{if(first){first=false;await held.promise;}return save(c);};
  const preview=s.editor.preparePublication();await settle();s.el('newEpContent').events.compositionstart();s.type('조합ㅈ');
  held.resolve();await assert.rejects(preview,/DRAFT_COMPOSING/);assert.equal(s.writes.length,0);
  s.el('newEpContent').value='조합 완료';s.el('newEpContent').events.compositionend();await s.advance(2500);
  assert.equal(s.writes[0].body.content,'조합 완료');
});
test('cancelled publication restores server lifecycle without replacing local text or adopting another revision',async()=>{
  for(const changedElsewhere of [false,true]){
    const s=setup({getRemote:async value=>({...value,lifecycle:'ACTIVE',...(changedElsewhere?{revision:'9',content:'remote edit'}:{})})});
    await s.editor.openWork('10');s.type('published');await s.editor.save();const expected=s.editor.getFileContext();
    s.type('local followup');await s.editor.markPublished(expected);await s.editor.refreshPublicationState(expected);
    assert.equal(s.engine.current.lifecycle,'ACTIVE');assert.equal(s.el('newEpContent').disabled,false);assert.equal(s.el('newEpContent').value,'local followup');assert.equal(s.engine.current.revision,'1');
    if(changedElsewhere){assert.equal(s.engine.current.conflict.content,'remote edit');assert.ok(s.backups.some(x=>x.reason==='publication-state-server'));await s.advance(10000);assert.equal(s.writes.length,1);}
    else {await s.advance(2500);assert.equal(s.writes[1].body.content,'local followup');}
  }
});
