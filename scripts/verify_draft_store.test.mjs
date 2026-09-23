import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../public/js/creator/draft-store.js',import.meta.url),'utf8');
function setup(){
  let tx,request;const db={transaction(){request={};tx={objectStore:()=>({put:()=>request}),abort:()=>tx.onabort()};return tx;}};
  const context=vm.createContext({indexedDB:{open(){const r={result:db};queueMicrotask(()=>r.onsuccess());return r;}}});vm.runInContext(code,context);
  return {store:context.DraftStore,get tx(){return tx;},get request(){return request;}};
}
test('IDB request success alone never marks a durable save; transaction completion does',async()=>{
  const s=setup();let completed=false;const p=s.store.save({userId:'a',id:'d',branch:'b'}).then(()=>completed=true);await new Promise(r=>setImmediate(r));s.request.onsuccess();await Promise.resolve();assert.equal(completed,false);s.tx.oncomplete();await p;assert.equal(completed,true);
});
test('IDB transaction abort after successful request rejects saving',async()=>{
  const s=setup();const p=s.store.save({userId:'a',id:'d',branch:'b'});await new Promise(r=>setImmediate(r));s.request.onsuccess();s.tx.error=Error('QuotaExceededError');s.tx.onabort();await assert.rejects(p,/QuotaExceeded/);
});
test('long diff fallback contains inserted lines, not only deletions',async()=>{
  const c=vm.createContext({});vm.runInContext(await readFile(new URL('../public/js/creator/draft-diff.js',import.meta.url),'utf8'),c);const diff=c.draftLineDiff('a\n'.repeat(600),'b\n'.repeat(601));assert.ok(diff.some(d=>d.type==='ins'&&d.text==='b'));assert.ok(diff.some(d=>d.type==='del'&&d.text==='a'));
});
test('legacy imports keep source and versions, isolate known owner/work, and reuse a stable ID',async()=>{
  const tables=new Map(['drafts','revisions','draftHeads','draftBackups','draftImports'].map(k=>[k,new Map()]));let uuid=0;
  tables.get('drafts').set('1:10:1',{key:'1:10:1',title:'owned',content:'original'});
  tables.get('drafts').set('2:10:1',{key:'2:10:1',content:'other account'});
  tables.get('drafts').set('local-author:10:1',{key:'local-author:10:1',content:'unknown owner'});
  tables.get('revisions').set(1,{id:1,draftKey:'1:10:1',content:'older'});
  const db={objectStoreNames:{contains:n=>tables.has(n)},close(){},transaction(names){
    const tx={objectStore(name){const rows=tables.get(name);const run=fn=>{const r={};queueMicrotask(()=>{r.result=fn();r.onsuccess();queueMicrotask(()=>tx.oncomplete());});return r;};return {
      getAll:()=>run(()=>[...rows.values()]),get:key=>run(()=>rows.get(key)),put:value=>run(()=>rows.set(value.key,value)),add:value=>run(()=>{if(rows.has(value.key))throw Error('duplicate');rows.set(value.key,value);return value.key;})};},abort(){tx.onabort();}};return tx;
  }};
  const c=vm.createContext({crypto:{randomUUID:()=>String(++uuid)},indexedDB:{open(){const r={result:db};queueMicrotask(()=>r.onsuccess());return r;}}});vm.runInContext(code,c);
  const rows=await c.DraftStore.legacy(1,'10');assert.equal(rows.length,1);const imported=await c.DraftStore.importLegacy('verified-uid',1,'10',rows[0]);
  assert.equal((await c.DraftStore.importLegacy('verified-uid',1,'10',rows[0])).id,imported.id);
  assert.equal(tables.get('drafts').size,3);assert.equal(tables.get('draftBackups').size,1);assert.equal([...tables.get('draftBackups').values()][0].snapshot.content,'older');
  await assert.rejects(c.DraftStore.importLegacy('verified-uid',1,'20',rows[0]));
});
