import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../public/js/creator/draft-engine.js',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(code,context);const Engine=context.DraftEngine;
const clone=x=>JSON.parse(JSON.stringify(x)), deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(api=async(action,x)=>({draft:{revision:String(Number(x.data?.expectedRevision||0)+1),title:'server',content:'remote',lifecycle:'ACTIVE'}})){
  let id=0;const rows=new Map(),backups=[],store={save:async c=>rows.set(c.id+':'+c.branch,clone(c)),backup:async(c,s,reason)=>backups.push({id:c.id,snapshot:clone(s),reason})};
  const engine=new Engine({store,api,uuid:()=>String(++id)});return {engine,store,rows,backups};
}
test('A → B → A and immediate transition preserve identity and clear a fresh form',async()=>{
  const {engine:e,rows}=setup();const a=await e.open('u','A');e.edit({content:'A 원고'});const b=await e.open('u','B');assert.equal(b.snapshot.content,'');e.edit({content:'B 원고'});await e.open('u','A',a.id);
  assert.equal(e.current.snapshot.content,'A 원고');assert.equal(rows.get(b.id+':'+b.branch).snapshot.content,'B 원고');assert.equal(rows.get(a.id+':'+a.branch).workId,'A');
});
test('late save response acknowledges only sent snapshot, not subsequent typing or another work',async()=>{
  const pending=deferred(),{engine:e}=setup(()=>pending.promise);const a=await e.open('u','A');e.edit({content:'sent'});const sync=e.sync();await new Promise(r=>setImmediate(r));e.edit({content:'later'});const b=await e.open('u','B');e.edit({content:'B'});pending.resolve({draft:{revision:'1'}});await sync;
  assert.equal(a.serverSeq,1);assert.equal(a.seq,2);assert.equal(a.snapshot.content,'later');assert.equal(e.current,b);assert.equal(b.snapshot.content,'B');
});
test('reversed loads and session loss never revive stale UI/context',async()=>{
  const waits={A:deferred(),B:deferred()}, {engine:e}=setup((a,x)=>waits[x.workId].promise);
  const a=e.open('u','A','a'),b=e.open('u','B','b');waits.B.resolve({draft:{revision:'1',content:'B'}});await b;waits.A.resolve({draft:{revision:'1',content:'A'}});assert.equal(await a,null);assert.equal(e.current.workId,'B');
  const lost=deferred();e.api=()=>lost.promise;const loading=e.open('u','C','c');await new Promise(r=>setImmediate(r));e.detach();lost.resolve({draft:{revision:'1',content:'private'}});await loading;assert.equal(e.current,null);assert.equal(e.contexts.size,0);
  const moved=deferred();e.api=()=>moved.promise;const late=e.open('u','D','d');e.cancelLoads();moved.resolve({draft:{revision:'1',content:'stale navigation'}});assert.equal(await late,null);assert.equal(e.current,null);
});
test('quota/abort failures do not claim local success or allow restore to destroy current text',async()=>{
  const {engine:e,store}=setup();const a=await e.open('u','A');e.edit({content:'must keep'});store.save=async()=>{throw Error('QuotaExceededError');};await assert.rejects(e.flush());assert.ok(a.localSeq<a.seq);assert.equal(a.error,'LOCAL_SAVE_FAILED');
  store.backup=async()=>{throw Error('abort');};await assert.rejects(e.replace({content:'replacement'}));assert.equal(a.snapshot.content,'must keep');
});
test('unknown save response persists exact retry key and payload across newer edits',async()=>{
  const requests=[];let fail=true;const {engine:e,rows}=setup(async(a,x)=>{requests.push(clone(x));if(fail)throw Error('offline');return {draft:{revision:'1'}};});const c=await e.open('u','A');e.edit({content:'old'});await assert.rejects(e.sync());const persisted=[...rows.values()][0];assert.ok(persisted.pending.key);e.edit({content:'new'});fail=false;await e.sync();assert.deepEqual(requests[0].data,requests[1].data);assert.equal(requests[0].key,requests[1].key);assert.ok(c.serverSeq<c.seq);
});
test('two tab conflict preserves both copies and requires explicit resolution',async()=>{
  let remote={revision:'1',content:'first',lifecycle:'ACTIVE'};
  const api=async(a,x)=>{if(a==='get')return {draft:clone(remote)};if(x.data.expectedRevision!==remote.revision)throw Object.assign(Error('conflict'),{code:'DRAFT_CONFLICT'});remote={...x.data,revision:String(Number(remote.revision)+1)};return {draft:clone(remote)};};
  const one=setup(api),two=setup(api);await one.engine.open('u','A','d');await two.engine.open('u','A','d');one.engine.edit({content:'tab1'});two.engine.edit({content:'tab2'});await one.engine.sync();await assert.rejects(two.engine.sync());assert.equal(two.engine.current.snapshot.content,'tab2');assert.equal(two.engine.current.conflict.content,'tab1');await two.engine.resolve(false);assert.equal(two.engine.current.snapshot.content,'tab1');assert.ok(two.backups.some(b=>b.snapshot.content==='tab2'));
});
test('restore/undo back up first; cross-account recovery fails; backup race does not erase later typing',async()=>{
  const {engine:e,store,backups}=setup();const c=await e.open('A','work');e.edit({content:'before'});await e.replace({content:'restore'});assert.equal(backups[0].snapshot.content,'before');await e.replace(c.undo);assert.equal(c.snapshot.content,'before');await assert.rejects(e.recover({userId:'B',workId:'work',snapshot:{content:'private'}}));
  const p=deferred();store.backup=()=>p.promise;const replacing=e.replace({content:'stale'});e.edit({content:'fresh'});p.resolve();await assert.rejects(replacing);assert.equal(c.snapshot.content,'fresh');
});
test('published drafts are read-only and next draft has a new identity',async()=>{
  const {engine:e}=setup(async()=>({draft:{revision:'4',content:'published',lifecycle:'PUBLISHED'}}));const c=await e.open('u','A','old');assert.throws(()=>e.edit({content:'bad'}));await assert.rejects(e.replace({content:'bad'}));const next=await e.open('u','A');assert.notEqual(c.id,next.id);assert.equal(next.snapshot.content,'');
});
test('reload recovery retains unknown request and stale base without relying on device timestamps',async()=>{
  const first=setup(async()=>{throw Error('offline');});const a=await first.engine.open('u','A');first.engine.edit({content:'offline sent'});await assert.rejects(first.engine.sync());first.engine.edit({content:'offline later'});await first.engine.flush();const row=[...first.rows.values()][0];
  const requests=[],second=setup(async(action,args)=>{requests.push(args);return {draft:{revision:'1'}};});await second.engine.open('u','A',row.id,{localOnly:true});await second.engine.recover(row);await second.engine.sync();assert.equal(requests[0].key,row.pending.key);assert.equal(requests[0].data.content,'offline sent');assert.equal(second.engine.current.snapshot.content,'offline later');assert.ok(second.engine.current.serverSeq<second.engine.current.seq);
});
