(function(root){
 'use strict';
 const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
 class FileImportQueue {
  constructor({store,api,actor,uuid=()=>crypto.randomUUID(),onChange=()=>{}}){Object.assign(this,{store,api,actor,uuid,onChange});this.stopped=false;this.running=false;}
  check(job){if(this.actor()?.userId!==job.userId)throw Error('SESSION_CHANGED');}
  async persist(job){await this.store.saveFileJob(job);this.onChange(job);}
  async run(jobs){if(this.running)return;this.running=true;this.stopped=false;
   try{for(const job of jobs){if(this.stopped)break;if(['COMMITTED','CANCELLED'].includes(job.state)||!job.payload||!job.confirmed)continue;this.check(job);
    job.locked=true;job.state='SENDING';job.error=null;await this.persist(job);this.check(job);
    try{const result=await this.api(job.kind,{workId:job.workId,key:job.requestId,body:job.payload});job.result=result;job.state='COMMITTED';await this.persist(job);}
    catch(e){job.state=e.code==='IMPORT_CANCELLED'?'CANCELLED':'ERROR';job.error=e.code||e.message;await this.persist(job);if(this.actor()?.userId!==job.userId)break;}
   }}finally{this.running=false;}
  }
  async cancel(job){this.check(job);if(job.state==='COMMITTED')throw Error('ALREADY_COMMITTED');
   if(job.locked)await this.api('cancel',{workId:job.workId,id:job.requestId});
   job.state='CANCELLED';await this.persist(job);
  }
  stop(){this.stopped=true;}
 }
 root.CreatorFileQueue=FileImportQueue;root.creatorFileBase64=base64;
})(globalThis);
