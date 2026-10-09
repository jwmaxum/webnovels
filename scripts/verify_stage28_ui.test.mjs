import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';
const source=await readFile('public/js/creator/creator-recovery.js','utf8');
const id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',fileId='ffffffff-ffff-4fff-8fff-ffffffffffff';
const initial={draft:{id,workId:'10',revision:'2'},files:[{id:fileId,filename:'<script>원본.hwpx',sourceRevision:'1',sha256:'a'.repeat(64)}],episodes:[{id:'9007199254740993',number:1,title:'<img>회차',targetDigest:'b'.repeat(32)}],requests:[],nextCursor:null};
const result={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'PENDING',episodeNumber:1,revision:'2',sourceRevision:'1'};
function setup(){
 const elements=new Map(),jobs=new Map(),calls=[];let user='u',sequence=3,revision='2',currentId=id,prepareError=null,options=structuredClone(initial),handler=null,prepareHook=null;
 function element(){return {children:[],value:'',checked:false,hidden:false,disabled:false,textContent:'',append(...items){this.children.push(...items);},replaceChildren(){this.children=[];this.textContent='';}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const c={document:{readyState:'complete',getElementById:get,createElement:element},WEBNOVELS_CONFIG:{authorFilesEnabled:true,authorRecoveryEnabled:true},crypto:{randomUUID:()=>result.id},openModal(){},closeModal(){},
 DraftStore:{fileJobs:async(u,w)=>[...jobs.values()].filter(j=>j.userId===u&&j.workId===w),saveFileJob:async j=>{jobs.set(j.key,structuredClone(j));}},
 WebNovelsAuth:{getActor:()=>user?{userId:user,author:{id:1,status:'APPROVED'}}:null,api:async(path,init)=>{calls.push({path,init});if(handler)return handler(path,init);return init?.method==='POST'?{request:structuredClone(result)}:structuredClone(options);}},
 CreatorDraftEditor:{getFileContext:()=>({userId:user,workId:'10',id:currentId,seq:sequence}),preparePublication:async()=>{if(prepareHook)await prepareHook();if(prepareError)throw Error(prepareError);return {userId:user,workId:'10',id:currentId,seq:sequence,revision};}}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c,{filename:resolve('public/js/creator/creator-recovery.js')});
 return {c,get,jobs,calls,setUser:x=>user=x,edit:()=>sequence++,setDraft:x=>currentId=x,setRevision:x=>revision=x,setError:x=>prepareError=x,setOptions:x=>options=x,setHandler:x=>handler=x,setPrepare:x=>prepareHook=x};
}
const open=s=>s.c.CreatorRecovery.open('10',id),posts=s=>s.calls.filter(c=>c.init?.method==='POST');
test('stage29 author history and receipt display derived disposition/reason while preserving PENDING submission',async()=>{
 const s=setup();s.setOptions({...initial,requests:[{...result,review:{status:'HOLD',reason:'<script>권리 자료 보완'}}]});await open(s);assert.match(s.get('recoveryHistory').children[0].textContent,/자료 보완·보류/);assert.match(s.get('recoveryHistory').children[0].textContent,/<script>권리 자료 보완/);
 select(s);s.setHandler(()=>({request:{...result,review:{status:'READY_FOR_RESTORE_REVIEW',reason:'후속 검증 필요'}}}));await s.get('recoverySubmit').onclick();assert.match(s.get('recoveryResultText').textContent,/후속 복원 검증 준비/);assert.match(s.get('recoveryResultText').textContent,/아직 진행되지/);assert.equal([...s.jobs.values()][0].result.status,'PENDING');
});
test('disabled stage29 feedback is reported unavailable instead of asserting the request is still awaiting review',async()=>{
 const s=setup();s.setOptions({...initial,reviewAvailable:false,requests:[result]});await open(s);assert.match(s.get('recoveryHistory').children[0].textContent,/조회 미활성/);
 select(s);s.setHandler(()=>({request:result,reviewAvailable:false}));await s.get('recoverySubmit').onclick();assert.match(s.get('recoveryResultText').textContent,/조회 미활성/);
});
function select(s){s.get('recoveryFile').value=fileId;s.get('recoveryEpisode').value='9007199254740993';s.get('recoveryConfirmed').checked=true;s.get('recoveryNote').value='수정 설명';}
test('explicit source/episode choices and confirmation are required; user text stays text and result is pending, not published',async()=>{
 const s=setup();await open(s);assert.equal(s.get('recoveryFile').value,'');assert.equal(s.get('recoveryEpisode').value,'');assert.ok(s.get('recoveryFile').children[1].textContent.includes('<script>'));await s.get('recoverySubmit').onclick();assert.equal(posts(s).length,0);
 select(s);s.get('recoveryConfirmed').checked=false;await s.get('recoverySubmit').onclick();assert.equal(posts(s).length,0);s.get('recoveryConfirmed').checked=true;await s.get('recoverySubmit').onclick();
 assert.equal(posts(s).length,1);const body=JSON.parse(posts(s)[0].init.body);assert.equal(body.episodeId,'9007199254740993');assert.equal(body.expectedRevision,'2');assert.equal(body.fileId,fileId);assert.ok(!('content' in body));assert.match(s.get('recoveryResultText').textContent,/검토 대기/);assert.match(s.get('recoveryResultText').textContent,/아직 진행되지/);
});
test('lost responses retain exact key/payload before sending; reopening after edits retries the historical request',async()=>{
 const s=setup();s.jobs.set('original',{key:'original',userId:'u',workId:'10',kind:'import',bytes:new Uint8Array([1,2]),state:'COMMITTED'});await open(s);select(s);
 let fail=true;s.setHandler(async(path,init)=>{if(init?.method==="POST"){assert.ok([...s.jobs.values()].some(j=>j.state==='PENDING'&&j.body.expectedRevision==='2'));if(fail)throw Error('NETWORK');return {request:result};}return initial;});await s.get('recoverySubmit').onclick();const first=posts(s)[0];assert.equal([...s.jobs.values()].filter(j=>j.kind==='recovery')[0].state,'PENDING');
 s.edit();s.setRevision('3');s.c.CreatorRecovery.reset();await open(s);assert.equal(s.get('recoveryPending').hidden,false);fail=false;await s.get('recoveryRetry').onclick();assert.deepEqual(posts(s)[1].init,first.init);assert.equal([...s.jobs.values()].filter(j=>j.kind==='recovery')[0].state,'COMMITTED');assert.deepEqual(s.jobs.get('original').bytes,new Uint8Array([1,2]));
});
test('changed/IME/unsynchronized drafts fail preflight without recording a request',async()=>{
 const s=setup();await open(s);select(s);s.edit();await s.get('recoverySubmit').onclick();assert.equal(posts(s).length,0);assert.match(s.get('recoveryMessage').textContent,/원고가 변경/);
 for(const code of ['DRAFT_COMPOSING','PUBLISH_SAVE_REQUIRED','PUBLISH_REVISION_CONFLICT']){const x=setup();x.setError(code);await open(x);assert.equal(x.get('recoveryForm').hidden,true);assert.equal(posts(x).length,0);}
 const x=setup();await open(x);select(x);x.setRevision('3');await x.get('recoverySubmit').onclick();assert.equal(posts(x).length,0);assert.equal(x.jobs.size,0);
});
test('late options after account/reset/draft switches cannot populate old choices',async()=>{
 for(const change of [s=>s.setUser('B'),s=>s.c.CreatorRecovery.reset(),s=>s.setDraft('other')]){const s=setup();let complete;s.setHandler(()=>new Promise(r=>complete=r));const pending=open(s);await new Promise(setImmediate);change(s);complete(initial);await pending;assert.equal(s.get('recoveryFile').children.length,1);assert.equal(s.get('recoveryForm').hidden,true);}
});
test('late successful submit preserves receipt for original account while clearing other-account UI',async()=>{
 const s=setup();await open(s);select(s);let complete;s.setHandler(()=>new Promise(r=>complete=r));const pending=s.get('recoverySubmit').onclick();await new Promise(setImmediate);s.setUser('B');s.c.CreatorRecovery.reset();complete({request:result});await pending;
 assert.equal(s.get('recoveryResultText').textContent,'');const saved=[...s.jobs.values()][0];assert.equal(saved.userId,'u');assert.equal(saved.state,'COMMITTED');s.setHandler(null);await open(s);assert.equal(s.get('recoveryPending').hidden,true);
});
test('definitive conflicts preserve rejected evidence and require a fresh explicit review; upstream failure keeps pending',async()=>{
 for(const status of [409,503]){const s=setup();await open(s);select(s);s.setHandler(()=>{throw Object.assign(Error('RECOVERY_TARGET_CONFLICT'),{status});});await s.get('recoverySubmit').onclick();assert.equal([...s.jobs.values()][0].state,status===409?'REJECTED':'PENDING');assert.equal(posts(s).length,1);assert.equal(s.get('recoveryPending').hidden,status===409);}
});
test('double submit and selections during preflight cannot create two identities or change captured metadata',async()=>{
 const s=setup();await open(s);select(s);let complete;s.setPrepare(()=>new Promise(r=>complete=r));const pending=s.get('recoverySubmit').onclick();await new Promise(setImmediate);assert.equal(s.get('recoverySubmit').disabled,true);await s.get('recoverySubmit').onclick();s.get('recoveryNote').value='late edit';complete();await pending;assert.equal(posts(s).length,1);assert.equal(JSON.parse(posts(s)[0].init.body).note,'수정 설명');
});
test('additional episode pages preserve explicit choices and reject revision changes',async()=>{
 const s=setup();s.setOptions({...initial,nextCursor:'100'});await open(s);select(s);s.setHandler(()=>({...initial,episodes:[{id:'101',number:2,title:'다음',targetDigest:'c'.repeat(32)}],nextCursor:null}));await s.get('recoveryMore').onclick();assert.equal(s.get('recoveryEpisode').value,'9007199254740993');assert.equal(s.get('recoveryEpisode').children.length,3);assert.ok(s.calls.at(-1).path.includes('before=100'));assert.equal(s.get('recoveryMore').hidden,true);
 const x=setup();x.setOptions({...initial,nextCursor:'100'});await open(x);x.setHandler(()=>({...initial,draft:{...initial.draft,revision:'3'}}));await x.get('recoveryMore').onclick();assert.equal(x.get('recoveryEpisode').children.length,2);assert.match(x.get('recoveryMessage').textContent,/버전이 변경/);
});
test('disabled feature and invalid response cannot claim accepted review',async()=>{
 const s=setup();s.c.WEBNOVELS_CONFIG.authorFilesEnabled=false;await open(s);assert.equal(s.calls.length,0);
 const x=setup();await open(x);select(x);x.setHandler(()=>({request:{status:'PUBLISHED'}}));await x.get('recoverySubmit').onclick();assert.equal([...x.jobs.values()][0].state,'PENDING');assert.equal(x.get('recoveryResult').hidden,true);
});
test('an authorization failure after a lost committed response cannot retire its identity or permit a duplicate',async()=>{
 const s=setup();await open(s);select(s);s.setHandler(()=>{throw Error('NETWORK');});await s.get('recoverySubmit').onclick();const original=posts(s)[0].init;
 for(const status of [403,404]){s.setHandler(()=>{throw Object.assign(Error(status===403?'AUTHOR_REQUIRED':'WORK_NOT_FOUND'),{status});});await s.get('recoveryRetry').onclick();assert.equal([...s.jobs.values()][0].state,'PENDING');}
 s.c.CreatorRecovery.reset();await open(s);assert.equal(s.get('recoveryPending').hidden,false);s.setHandler(()=>({request:result}));await s.get('recoveryRetry').onclick();assert.equal(posts(s).length,4);for(const p of posts(s))assert.deepEqual(p.init,original);
});
