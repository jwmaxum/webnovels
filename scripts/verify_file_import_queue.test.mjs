import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const c=vm.createContext({});vm.runInContext(await readFile('public/js/creator/file-import-queue.js','utf8'),c);
const make=i=>({key:'u:'+i,userId:'u',workId:'10',requestId:String(i),kind:'import',state:'READY',confirmed:true,payload:{title:String(i),content:'본문'}});
test('10-file partial failure and reload retry preserve keys/payload and never resend confirmed successes',async()=>{
 const stored=new Map(),calls=[],rows=Array.from({length:10},(_,i)=>make(i));let failing=true;
 const config={store:{saveFileJob:async j=>stored.set(j.key,structuredClone(j))},actor:()=>({userId:'u'}),api:async(a,x)=>{calls.push(structuredClone(x));if(failing&&x.key==='3')throw Error('timeout');return {draft:{id:x.key}};}};
 await new c.CreatorFileQueue(config).run(rows);assert.equal(rows.filter(r=>r.state==='COMMITTED').length,9);assert.equal(rows[3].state,'ERROR');
 failing=false;await new c.CreatorFileQueue(config).run([...stored.values()]);assert.equal(calls.length,11);assert.deepEqual(calls[3],calls[10]);
});
test('stop waits for in-flight result and preserves all unstarted files for resume',async()=>{
 const rows=[make(1),make(2)],calls=[];let queue;
 queue=new c.CreatorFileQueue({store:{saveFileJob:async()=>{}},actor:()=>({userId:'u'}),api:async(a,x)=>{calls.push(x);queue.stop();return {};}});
 await queue.run(rows);assert.equal(calls.length,1);assert.equal(rows[0].state,'COMMITTED');assert.equal(rows[1].state,'READY');
});
test('quota failure or account change prevents upload; unconfirmed previews are not submitted',async()=>{
 let uploads=0;const api=async()=>{uploads++;};
 const q=new c.CreatorFileQueue({store:{saveFileJob:async()=>{throw Error('quota');}},actor:()=>({userId:'u'}),api});await assert.rejects(q.run([make(1)]));assert.equal(uploads,0);
 const other=new c.CreatorFileQueue({store:{saveFileJob:async()=>{}},actor:()=>({userId:'B'}),api});await assert.rejects(other.run([make(2)]));
 const unconfirmed={...make(3),confirmed:false};await q.run([unconfirmed]);assert.equal(uploads,0);
});
test('uncertain request cancellation uses the same server key; committed items cannot be cancelled',async()=>{
 const calls=[],q=new c.CreatorFileQueue({store:{saveFileJob:async()=>{}},actor:()=>({userId:'u'}),api:async(a,x)=>calls.push({a,...x})});const row={...make(1),locked:true,state:'ERROR'};
 await q.cancel(row);assert.equal(calls[0].id,'1');assert.equal(row.state,'CANCELLED');await assert.rejects(q.cancel({...row,state:'COMMITTED'}));
});
