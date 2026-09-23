import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../public/js/creator/'+p,import.meta.url),'utf8');
const sources=await Promise.all(['draft-engine.js','draft-diff.js','creator-editor.js'].map(read));
function setup(){
  const elements=new Map(),listeners={},heads=new Map(),backups=[];let uuid=0,user={userId:'u',author:{id:1,status:'APPROVED'}};
  function element(){return {value:'',textContent:'',innerHTML:'',style:{},children:[],events:{},classList:{toggle(){},remove(){}},addEventListener(k,v){this.events[k]=v;},replaceChildren(){this.children=[];this.innerHTML='';this.textContent='';},append(x){this.children.push(x);},focus(){},scrollIntoView(){},click(){}};}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const context={URLSearchParams,Blob,URL,console,crypto:{randomUUID:()=>String(++uuid)},setTimeout:()=>++uuid,clearTimeout(){},location:{search:''},history:{replaceState(){}},
    document:{readyState:'complete',getElementById:get,createElement:element,addEventListener(k,v){listeners[k]=v;},documentElement:{style:{setProperty(){}}}},
    addEventListener(k,v){listeners[k]=v;},confirm:()=>true,showToast(){},closeModal(){},openModal(){},switchCreatorTab(){},
    WebNovelsAuth:{getActor:()=>user,api:async(path,options)=>{
      if(path.startsWith('/api/v2/creator/works'))return {works:['10','20'].map(id=>({id,title:'작품'+id,moderation_state:'CLEAR'})),nextCursor:null};
      if(options?.method==='PUT')return {draft:{revision:'1'}};
      if(path.match(/\/drafts\?/))return {drafts:[]};
      return {draft:{revision:'1',content:'server',lifecycle:'ACTIVE'}};
    }},DraftStore:{save:async c=>heads.set(c.id+':'+c.branch,JSON.parse(JSON.stringify(c))),backup:async(c,s)=>backups.push({userId:c.userId,snapshot:s}),
      heads:async(u,w)=>[...heads.values()].filter(c=>c.userId===u&&c.workId===w),history:async()=>[],legacy:async()=>[]}};
  context.window=context;vm.createContext(context);sources.forEach(s=>vm.runInContext(s,context));
  return {context,get,heads,backups,listeners,editor:context.CreatorDraftEditor,setUser:v=>user=v};
}
test('UI work selection captures old identity; fresh draft clears all fields; return restores current snapshot',async()=>{
  const s=setup();await s.editor.openWork('10');s.get('newEpContent').value='A 내용';s.get('newEpContent').events.input();s.get('newEpTitle').value='A 제목';s.get('newEpTitle').events.input();
  s.get('newEpWorkSelect').value='20';await s.get('newEpWorkSelect').events.change();assert.equal(s.get('newEpContent').value,'');s.get('newEpContent').value='B 내용';s.get('newEpContent').events.input();
  await s.editor.openWork('10');assert.equal(s.get('newEpContent').value,'A 내용');assert.equal(s.get('newEpTitle').value,'A 제목');
  assert.ok([...s.heads.values()].some(r=>r.workId==='20'&&r.snapshot.content==='B 내용'));
});
test('auth loss clears form and history; another account never sees previous local copies',async()=>{
  const s=setup();await s.editor.openWork('10');s.get('newEpContent').value='private A';s.get('newEpContent').events.input();await s.editor.beforeAccountChange();s.editor.onAuthLost();
  assert.equal(s.get('newEpContent').value,'');assert.equal(s.get('newEpContent').disabled,true);assert.equal(s.get('diffVersionList').children.length,0);
  s.setUser({userId:'B',author:{id:2,status:'APPROVED'}});await s.editor.openWork('10');assert.equal(s.get('newEpContent').value,'');assert.equal(s.get('draftCopies').children.length,0);
  assert.ok([...s.heads.values()].some(r=>r.userId==='u'&&r.snapshot.content==='private A'));
});
test('UI restore tools await backup and IME composition does not schedule synchronization',async()=>{
  const s=setup();await s.editor.openWork('10');s.get('newEpContent').value='text   ';s.get('newEpContent').events.input();
  s.get('newEpContent').events.compositionstart();await s.get('btnFormatClean').events.click();assert.equal(s.get('newEpContent').value,'text   ');
  s.get('newEpContent').events.compositionend();await s.get('btnFormatClean').events.click();assert.equal(s.get('newEpContent').value,'text');assert.equal(s.backups[0].snapshot.content,'text   ');
  await s.get('btnDraftUndo').events.click();assert.equal(s.get('newEpContent').value,'text   ');
});
