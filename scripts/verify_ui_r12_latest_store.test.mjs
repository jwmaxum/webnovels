import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/js/creator/draft-store.js',import.meta.url),'utf8');
const copy=value=>value===undefined?undefined:structuredClone(value);
// Transactional IndexedDB double: pending writes commit together, or none do.
// This exercises the production upgrade/save/read callbacks without a browser.
function setup(){
  const tables=new Map(['drafts','revisions','draftHeads','draftBackups','draftImports','fileImports'].map(name=>[name,new Map()]));
  tables.get('drafts').set('1:10:1',{key:'1:10:1',content:'legacy original'});
  tables.get('draftBackups').set('saved-backup',{key:'saved-backup',snapshot:{content:'preserved backup'}});
  let version=3,failStore=null;
  const db={objectStoreNames:{contains:name=>tables.has(name)},createObjectStore(name){tables.set(name,new Map());},
    transaction(names,mode){
      const scope=Array.isArray(names)?names:[names],staged=new Map(scope.map(name=>[name,new Map([...tables.get(name)].map(([key,value])=>[key,copy(value)]))]));
      let pending=0,finished=false,commit;
      const tx={error:null,abort(){if(finished)return;finished=true;clearImmediate(commit);queueMicrotask(()=>tx.onabort?.());},objectStore(name){
        assert.ok(scope.includes(name));
        const run=operation=>{
          const request={};pending++;
          queueMicrotask(()=>{
            if(finished)return;
            try{request.result=operation();request.onsuccess?.();}
            catch(error){tx.error=error;tx.abort();return;}
            if(--pending===0)commit=setImmediate(()=>{
              if(finished)return;finished=true;
              if(mode==='readwrite')for(const [store,values] of staged)tables.set(store,values);
              tx.oncomplete?.();
            });
          });return request;
        };
        return {get:key=>run(()=>copy(staged.get(name).get(key))),getAll:()=>run(()=>[...staged.get(name).values()].map(copy)),
          put:value=>run(()=>{if(failStore===name){failStore=null;throw Error('QUOTA_'+name);}staged.get(name).set(value.key,copy(value));return value.key;})};
      }};return tx;
    }};
  const indexedDB={open(_name,next){const request={result:db};queueMicrotask(()=>{if(next>version){request.onupgradeneeded?.();version=next;}request.onsuccess?.();});return request;}};
  const context=vm.createContext({indexedDB,crypto:{randomUUID:()=>crypto.randomUUID()}});vm.runInContext(source,context);
  return {store:context.DraftStore,tables,get version(){return version;},fail:name=>{failStore=name;}};
}
const head=(id='one',extra={})=>({userId:'user',workId:'10',id,branch:id+'-branch',lifecycle:'ACTIVE',snapshot:{title:id,content:id+' text'},seq:1,serverSeq:0,...extra});

test('v3→v4 adds activity without removing legacy originals, branches or backups',async()=>{
  const s=setup();s.tables.get('draftHeads').set('user:prior:branch',{key:'user:prior:branch',content:'existing'});
  await s.store.save(head());
  assert.equal(s.version,4);assert.equal(s.tables.get('drafts').get('1:10:1').content,'legacy original');
  assert.equal(s.tables.get('draftHeads').get('user:prior:branch').content,'existing');
  assert.equal(s.tables.get('draftBackups').get('saved-backup').snapshot.content,'preserved backup');
  assert.equal((await s.store.latest('user','10')).id,'one');
});

test('atomic activity failure preserves the previous head and pointer; success waits for commit',async()=>{
  const s=setup();await s.store.save(head('old'));s.fail('draftActivity');
  await assert.rejects(s.store.save(head('new')),/QUOTA_draftActivity/);
  assert.equal(s.tables.get('draftHeads').has('user:new:new-branch'),false);
  assert.equal((await s.store.latest('user','10')).id,'old');
  let committed=false;const saving=s.store.save(head('new')).then(()=>{committed=true;});
  await Promise.resolve();assert.equal(committed,false);await saving;
  assert.equal((await s.store.latest('user','10')).id,'new');
});

test('late unchanged checkpoint/sync cannot promote an old branch; authored edit can',async()=>{
  const s=setup(),old=head('old');await s.store.save(old);await s.store.save(head('new',{seq:500,serverSeq:500}));
  await s.store.save({...old,serverSeq:1,revision:'9'});
  assert.equal((await s.store.latest('user','10')).id,'new');
  await s.store.save({...old,seq:2,snapshot:{content:'written after the new draft'}});
  assert.equal((await s.store.latest('user','10')).id,'old','branch-local progress, not the largest cross-branch seq');
});

test('blank opens do not replace last-written pointer; archived/published heads never resume as active',async()=>{
  const s=setup();await s.store.save(head('written'));await s.store.save(head('blank',{seq:0,serverSeq:-1,snapshot:{title:'',content:''}}));
  assert.equal((await s.store.latest('user','10')).id,'written');
  await s.store.save(head('written',{lifecycle:'PUBLISHED'}));assert.equal(await s.store.latest('user','10'),null);
  await s.store.save(head('written',{lifecycle:'TRASHED'}));assert.equal(await s.store.latest('user','10'),null);
  assert.equal(s.tables.get('draftHeads').size,2,'all original heads remain');
});

test('account/work pointer isolation rejects mismatched rows and preserves each account',async()=>{
  const s=setup();await s.store.save(head('A'));await s.store.save(head('B',{userId:'other'}));await s.store.save(head('C',{workId:'20'}));
  assert.equal((await s.store.latest('user','10')).id,'A');assert.equal((await s.store.latest('other','10')).id,'B');
  assert.equal((await s.store.latest('user','20')).id,'C');assert.equal(await s.store.latest('other','20'),null);
  s.tables.get('draftActivity').set('user:10',{key:'user:10',userId:'other',workId:'10',id:'B',branch:'B-branch'});
  assert.equal(await s.store.latest('user','10'),null);
});
