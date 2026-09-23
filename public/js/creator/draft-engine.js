/* Snapshot-bound persistence. No DOM, timestamps, or local identity guesses. */
(function(root) {
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const snapshot=x=>({title:x.title||'',content:x.content||'',authorComment:x.authorComment||''});
  class DraftEngine {
    constructor({store,api,uuid,onChange=()=>{}}) { Object.assign(this,{store,api,uuid,onChange});this.current=null;this.epoch=0;this.contexts=new Map(); }
    emit(c) { if(this.current===c)this.onChange(c); }
    async open(userId,workId,id=null,{localOnly=false}={}) {
      const epoch=++this.epoch;
      if(this.current)await this.flush(this.current);
      id=id||this.uuid();
      const key=userId+':'+id;
      let c=this.contexts.get(key);
      if(c&&c.workId!==workId)throw Error('WORK_MISMATCH');
      if(!c) {
        let remote=null;
        if(arguments[2]&&!localOnly) remote=(await this.api('get',{workId,id,userId})).draft;
        c={userId,workId,id,branch:this.uuid(),snapshot:snapshot(remote||{}),seq:0,localSeq:-1,serverSeq:remote?0:-1,
          revision:remote?.revision||'0',lifecycle:remote?.lifecycle||'ACTIVE',pending:null,conflict:null,error:null};
        if(epoch!==this.epoch)return null;
        this.contexts.set(key,c);
      }
      if(epoch!==this.epoch)return null;
      if(this.current)await this.flush(this.current);
      if(epoch!==this.epoch)return null;
      await this.flush(c);
      if(epoch!==this.epoch)return null;
      this.current=c;this.emit(c);return c;
    }
    edit(value,c=this.current) { if(!c)return; if(c.lifecycle!=='ACTIVE')throw Error('DRAFT_READ_ONLY');c.snapshot=snapshot(value);c.seq++;this.emit(c); }
    async flush(c=this.current) {
      if(!c)return;
      // Serialize per branch; snapshot is captured before awaiting anything.
      const value=copy({...c,localSeq:c.seq,queue:undefined,syncing:undefined}),seq=c.seq;
      const run=async()=>{try {await this.store.save(value);c.localSeq=Math.max(c.localSeq,seq);c.error=null;this.emit(c);}
        catch(e){c.error='LOCAL_SAVE_FAILED';this.emit(c);throw e;}};
      c.queue=(c.queue||Promise.resolve()).catch(()=>{}).then(run);return c.queue;
    }
    async sync(c=this.current) {
      if(!c || c.conflict || c.lifecycle!=='ACTIVE')return;
      if(c.syncing)return c.syncing;
      c.syncing=this.performSync(c).finally(()=>{c.syncing=null;this.emit(c);});return c.syncing;
    }
    async performSync(c) {
      try {
        if(!c.pending && c.serverSeq===c.seq)return;
        if(!c.pending)c.pending={key:this.uuid(),seq:c.seq,data:{expectedRevision:c.revision,...copy(c.snapshot)}};
        await this.flush(c); // The retry key and exact payload must survive a reload.
        const pending=c.pending;
        const result=await this.api('save',{workId:c.workId,id:c.id,key:pending.key,data:pending.data,userId:c.userId});
        c.revision=result.draft.revision;c.serverSeq=pending.seq;c.pending=null;c.error=null;
        await this.flush(c); // Only the acknowledged snapshot is marked as server-saved.
      } catch(e) {
        c.error=e.code||e.message||'SERVER_SAVE_FAILED';
        if(e.code==='DRAFT_CONFLICT') {
          const remote=(await this.api('get',{workId:c.workId,id:c.id,userId:c.userId})).draft;
          await this.store.backup(c,remote,'conflict-server');c.conflict=remote;await this.flush(c);
        }
        this.emit(c);throw e;
      }
    }
    async replace(value,reason='restore') {
      const c=this.current;if(!c||c.lifecycle!=='ACTIVE')throw Error('DRAFT_READ_ONLY');
      const seq=c.seq;
      await this.store.backup(c,copy(c.snapshot),reason); // Abort transformation if backup fails.
      if(this.current!==c||c.seq!==seq)throw Error('EDIT_CHANGED_DURING_BACKUP');
      c.undo=copy(c.snapshot);this.edit(value,c);await this.flush(c);return c;
    }
    async resolve(keepLocal) {
      const c=this.current;if(!c?.conflict)return;
      const seq=c.seq;
      await this.store.backup(c,copy(c.snapshot),'conflict-local');
      await this.store.backup(c,c.conflict,'conflict-server');
      const remote=c.conflict;
      if(this.current!==c||c.seq!==seq)throw Error('EDIT_CHANGED_DURING_BACKUP');
      if(!keepLocal)this.edit(remote,c);
      c.revision=remote.revision;c.pending=null;c.conflict=null;
      if(!keepLocal)c.serverSeq=c.seq;
      await this.flush(c);if(keepLocal)await this.sync(c);this.emit(c);
    }
    async recover(record) {
      const c=this.current;if(!c||record.userId!==c.userId||record.workId!==c.workId)throw Error('OWNER_MISMATCH');
      if(c.syncing)throw Error('DRAFT_SYNC_IN_PROGRESS');
      // A recovery is an explicit new local edit, never timestamp-based arbitration.
      await this.replace(record.snapshot,'before-recovery');
      c.pending=null;
      if(record.id===c.id)c.revision=record.revision||'0';
      if(record.lifecycle==='PUBLISHED'||record.lifecycle==='TRASHED')c.lifecycle=record.lifecycle;
      if(record.id===c.id && record.pending) {
        c.pending=copy(record.pending);c.pending.seq=-1; // Replay unknown result without acknowledging recovered/later edits.
      }
      // Keep the recovered base revision. Reconnection must pass the server CAS;
      // offline recovery never assumes the latest remote revision is its own base.
      await this.flush(c);this.emit(c);
    }
    async checkpoint() { const c=this.current;if(c)await this.flush(c); }
    cancelLoads() { this.epoch++; }
    detach() {const c=this.current;this.epoch++;this.current=null;this.contexts.clear();return c;}
  }
  root.DraftEngine=DraftEngine;
})(globalThis);
