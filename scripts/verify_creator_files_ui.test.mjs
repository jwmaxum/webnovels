import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import * as fflate from 'fflate';
const code=await Promise.all(['file-codec.js','file-import-queue.js','creator-files.js'].map(p=>readFile('public/js/creator/'+p,'utf8')));
function setup(){
 const elements=new Map(),saved=new Map(),calls=[];let uid='u',id=0;
 function element(tag='div'){return {tag,children:[],value:'',textContent:'',disabled:false,checked:false,style:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];this.textContent='';},setAttribute(){},click(){calls.push({download:this.download});},getContext:()=>({clearRect(){},fillRect(){},drawImage(bitmap){calls.push({bitmap});}})};}
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const c={fflate,TextDecoder,TextEncoder,btoa,Blob,URL,Uint8Array,crypto:{randomUUID:()=>String(++id)},setTimeout(){},
  document:{readyState:'complete',getElementById:get,createElement:element,createTextNode:text=>({text})},openModal(){},closeModal(){},confirm:()=>true,
  DraftStore:{saveFileJob:async j=>saved.set(j.key,structuredClone(j)),fileJobs:async(u,w)=>[...saved.values()].filter(j=>j.userId===u&&j.workId===w)},
  WebNovelsAuth:{getActor:()=>uid?{userId:uid,author:{id:1}}:null,api:async(path,options)=>{calls.push({path,options});if(path.startsWith('/api/v2/creator/works/'))return {work:{id:'10',title:'작품',version:'1'}};if(path.includes('/import?'))return {draft:{id:'imported'}};return {files:[]};}},
  CreatorDraftEditor:{getFileContext:()=>({userId:uid,workId:'10',id:'d',seq:3}),replaceFromFile:async(s,e)=>calls.push({replace:s,expected:e})}};
 c.window=c;vm.createContext(c);code.forEach(s=>vm.runInContext(s,c));return {c,get,saved,calls,setUser:x=>uid=x};
}
const file=(name,content)=>({name,size:new TextEncoder().encode(content).length,arrayBuffer:async()=>new TextEncoder().encode(content).buffer});
test('files sort numerically, preview before upload, require confirmation and preserve request identities',async()=>{
 const s=setup();await s.c.CreatorFiles.open('10');await s.get('creatorFileInput').onchange({target:{files:[file('10.txt','열'),file('2.txt','둘')]}});
 assert.deepEqual([...s.saved.values()].map(j=>j.filename),['2.txt','10.txt']);assert.ok(!s.calls.some(c=>c.path?.includes('/import?')));
 await s.get('creatorImportRun').onclick();assert.ok(!s.calls.some(c=>c.path?.includes('/import?')));
 const rows=s.get('creatorImportList').children;for(const row of rows){const label=row.children.find(n=>n.tag==='label');const check=label.children[0];check.checked=true;await check.onchange();}
 await s.get('creatorImportRun').onclick();assert.equal(s.calls.filter(c=>c.path?.includes('/import?')).length,2);
 await s.get('creatorImportRun').onclick();assert.equal(s.calls.filter(c=>c.path?.includes('/import?')).length,2);
});
test('explicit current-draft replacement delegates to snapshot-checked backup path',async()=>{
 const s=setup();await s.c.CreatorFiles.open('10');await s.get('creatorFileInput').onchange({target:{files:[file('원고.txt','교체')]}});
 const row=s.get('creatorImportList').children[0],check=row.children.find(n=>n.tag==='label').children[0];check.checked=true;await check.onchange();
 await row.children.find(n=>n.tag==='button'&&n.textContent.includes('현재 원고 대체')).onclick();
 const call=s.calls.find(c=>c.replace);assert.equal(call.replace.content,'교체');assert.equal(call.expected.id,'d');assert.equal(call.expected.seq,3);
});
test('account reset clears filenames/text and persisted imports are scoped to the original account',async()=>{
 const s=setup();await s.c.CreatorFiles.open('10');await s.get('creatorFileInput').onchange({target:{files:[file('비밀.txt','본문')]}});
 s.c.CreatorFiles.reset();s.setUser('B');await s.c.CreatorFiles.open('10');assert.equal(s.get('creatorImportList').children.length,0);assert.equal([...s.saved.values()][0].userId,'u');
});
test('individual stored TXT uses owner export and clears download choices on account change',async()=>{
 const s=setup();await s.c.CreatorFiles.open('10');const api=s.c.WebNovelsAuth.api;
 s.c.WebNovelsAuth.api=async(path,options)=>path.includes('/export?')?{items:[{kind:'episode',number:2,title:'회차',content:'본문',state:'PUBLIC'}]}:api(path,options);
 await s.get('creatorExportList').onclick();const choice=s.get('creatorExportItems').children[0];assert.match(choice.textContent,/회차 2/);await choice.onclick();assert.equal(s.calls.filter(x=>x.download).length,1);
 s.setUser('B');await choice.onclick();assert.equal(s.calls.filter(x=>x.download).length,1);s.c.CreatorFiles.reset();assert.equal(s.get('creatorExportItems').children.length,0);
});
test('late cover decoding cannot replace the latest selection or survive account reset',async()=>{
 const s=setup();await s.c.CreatorFiles.open('10');const pending=[];s.c.CreatorFileImage={dimensions(){}};s.c.createImageBitmap=()=>new Promise(resolve=>pending.push(resolve));
 const one=s.get('creatorCoverInput').onchange({target:{files:[file('1.png','x')]}});await new Promise(setImmediate);
 const two=s.get('creatorCoverInput').onchange({target:{files:[file('2.png','x')]}});await new Promise(setImmediate);
 let closed=0;const older={width:600,height:900,close(){closed++;}},latest={width:600,height:900,close(){closed++;}};
 pending[1](latest);await two;pending[0](older);await one;assert.equal(s.calls.filter(x=>x.bitmap).length,1);assert.equal(s.calls.find(x=>x.bitmap).bitmap,latest);assert.equal(closed,1);s.c.CreatorFiles.reset();assert.equal(closed,2);
});
