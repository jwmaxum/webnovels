(function(root) {
  'use strict';
  let opening;
  function open() {
    if(!opening)opening=new Promise((resolve,reject)=>{
      const r=indexedDB.open('webnovels-creator-drafts',2);
      r.onupgradeneeded=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts',{keyPath:'key'});
        if(!db.objectStoreNames.contains('revisions')){const s=db.createObjectStore('revisions',{keyPath:'id',autoIncrement:true});s.createIndex('draftKey','draftKey');s.createIndex('createdAt','createdAt');}
        for(const name of ['draftHeads','draftBackups','draftImports'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'key'});
      };
      r.onerror=()=>{opening=null;reject(r.error);};r.onblocked=()=>{opening=null;reject(Error('다른 탭을 닫고 저장소를 다시 열어주세요. 기존 원고는 보존됩니다.'));};
      r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};
    });return opening;
  }
  async function transaction(name,mode,operation) {
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(name,mode);let result;
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('LOCAL_TRANSACTION_ABORTED'));tx.onerror=()=>{};
      try {const r=operation(tx.objectStore(name));r.onsuccess=()=>{result=r.result;};}catch(e){tx.abort();reject(e);}
    });
  }
  const all=name=>transaction(name,'readonly',s=>s.getAll());
  const put=(name,value)=>transaction(name,'readwrite',s=>s.put(value));
  const store={
    transaction,
    // Read the existing database without requesting an upgrade. Useful when the
    // v2 upgrade is blocked; never recreate/delete the legacy stores.
    exportLegacy:async(authorId,workId)=>new Promise((resolve,reject)=>{
      const request=indexedDB.open('webnovels-creator-drafts');
      request.onupgradeneeded=()=>request.transaction.abort();
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('LEGACY_DATABASE_BLOCKED'));
      request.onsuccess=()=>{
        const db=request.result,names=['drafts','revisions'].filter(n=>db.objectStoreNames.contains(n));
        if(!names.length){db.close();resolve({drafts:[],revisions:[]});return;}
        const result={drafts:[],revisions:[]},tx=db.transaction(names,'readonly'),prefix=String(authorId)+':'+workId+':';
        for(const name of names){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result.filter(x=>String(name==='drafts'?x.key:x.draftKey).startsWith(prefix));};}
        tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error);};
      };
    }),
    save:c=>put('draftHeads',{...c,key:c.userId+':'+c.id+':'+c.branch}),
    backup:(c,value,reason)=>put('draftBackups',{key:crypto.randomUUID(),userId:c.userId,workId:c.workId,id:c.id,snapshot:value,reason}),
    heads:async(userId,workId)=>(await all('draftHeads')).filter(x=>x.userId===userId&&x.workId===workId),
    history:async c=>(await all('draftBackups')).filter(x=>x.userId===c.userId&&x.id===c.id),
    legacy:async(authorId,workId)=>(await all('drafts')).filter(x=>x.key.startsWith(String(authorId)+':'+workId+':')),
    async importLegacy(userId,authorId,workId,row) {
      if(!row.key.startsWith(String(authorId)+':'+workId+':'))throw Error('OWNER_MISMATCH');
      const key=userId+':'+row.key;
      const prior=await transaction('draftImports','readonly',s=>s.get(key));if(prior)return prior;
      const c={key,userId,workId,id:crypto.randomUUID(),snapshot:{title:row.title||'',content:row.content||'',authorComment:row.authorComment||''}};
      // Keep legacy originals; add-only key arbitrates imports from simultaneous tabs.
      for(const old of (await all('revisions')).filter(x=>x.draftKey===row.key))await store.backup(c,old,'legacy-version');
      try {await transaction('draftImports','readwrite',s=>s.add(c));return c;}
      catch(e){const existing=await transaction('draftImports','readonly',s=>s.get(key));if(existing)return existing;throw e;}
    }
  };
  root.DraftStore=store;
})(globalThis);
