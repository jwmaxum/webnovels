// Independent disposable clusters; synthetic records and bytes only.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {snapshot} from './lib/native-recovery-snapshot.mjs';
import {setup,admin,uuid} from './fixtures/op07-db.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir('scratch/op09',{recursive:true});
const started=Date.now(),report={stage:'OP-09',result:'RUNNING',provenance:'INDEPENDENT_NATIVE_SYNTHETIC',productionTouched:false,hostedRestoreVerified:false,storageServiceVerified:false,steps:[]};
const save=()=>writeFile('scratch/op09/recovery-report.json',JSON.stringify(report,null,2)+'\n');await save();
let source,target,db,restored;
try{
 source=await startNativeCluster();report.engine=source.version;
 await source.createDatabase('op08_source');db=await source.connect('op08_source');const f=await setup({dbFactory:async()=>db});
 await f.prepared();const requested=(await f.requestPayout()).payout,approved=(await f.transition('approve',requested)).payout,pending=(await f.transition('begin',approved)).payout;
 assert.equal(pending.status,'UNKNOWN');
 await db.exec("insert into storage.objects(bucket_id,name) values('authoring-originals','op09/synthetic.txt'),('authoring-webtoons','op09/synthetic.bin')");
 const evidence={payoutId:pending.id,revision:pending.revision,reason:'OP09 independent synthetic restore',requestId:uuid(),...f.evidence(pending)};
 const before=await snapshot(db),roles=(await db.query("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname")).rows;
 const objects=(await db.query('select bucket_id,name from storage.objects order by bucket_id,name')).rows;
 await mkdir(join(source.directory,'objects'));const inventory=[];
 for(let i=0;i<objects.length;i++){
  // Invented fixture payload, never an export of the hosted Storage service.
  const content=Buffer.from('OP09 synthetic bytes '+i+' '+JSON.stringify(objects[i]));const file='object-'+i+'.bin';
  await writeFile(join(source.directory,'objects',file),content);inventory.push({...objects[i],file,bytes:content.length,sha256:hash(content)});
 }
 const archive=join(source.directory,'database.dump');await source.dump('op08_source',archive);const archiveHash=hash(await readFile(archive));
 await db.close();db=null;await source.stop();report.steps.push('SOURCE_STOPPED_BEFORE_RESTORE');
 const sourceDirectory=source.directory;source=null;
 target=await startNativeCluster();assert.notEqual(target.directory,sourceDirectory);
 // Recreate only the three known synthetic roles; never replay arbitrary global SQL.
 await target.control.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls');
 assert.deepEqual((await target.control.query("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname")).rows,roles);
 await copyFile(archive,join(target.directory,'database.dump'));assert.equal(hash(await readFile(join(target.directory,'database.dump'))),archiveHash);
 await target.createDatabase('op08_restored');await target.restore('op08_restored',join(target.directory,'database.dump'));restored=await target.connect('op08_restored');
 assert.deepEqual(await snapshot(restored),before);report.steps.push('ROWS_CATALOG_ACL_RLS_SEQUENCES_MATCH');
 await mkdir(join(target.directory,'objects'));
 for(const object of inventory){const dest=join(target.directory,'objects',object.file);await copyFile(join(sourceDirectory,'objects',object.file),dest);const b=await readFile(dest);assert.equal(b.length,object.bytes);assert.equal(hash(b),object.sha256);}
 assert.deepEqual((await restored.query('select bucket_id,name from storage.objects order by bucket_id,name')).rows,objects);report.steps.push('SYNTHETIC_OBJECT_BYTES_AND_METADATA_MATCH');
 const rpc=async(action,data={})=>(await restored.query('select public.op07_payouts($1,$2,$3) result',[admin,action,JSON.stringify(data)])).rows[0].result;
 for(const role of ['anon','authenticated','service_role']){
  await restored.exec('set role '+role);await assert.rejects(restored.query('select * from commerce.op07_payouts'),e=>e.code==='42501');
  if(role!=='service_role'){
   await assert.rejects(rpc('summary'),e=>e.code==='42501');
   assert.equal((await restored.query("select * from storage.objects where bucket_id in ('authoring-originals','authoring-webtoons')")).rows.length,0);
  }await restored.exec('reset role');
 }
 await restored.exec('set role service_role');assert.equal((await rpc('request-detail',{payoutId:pending.id})).payout.status,'UNKNOWN');assert.equal((await rpc('summary')).summary.reservedKrw,70);
 assert.equal((await rpc('admin-paid',evidence)).payout.status,'PAID');assert.equal((await rpc('admin-paid',evidence)).replayed,true);report.steps.push('ROLE_DENIAL_AND_UNKNOWN_IDEMPOTENT_RECONCILIATION');
 Object.assign(report,{result:'PASS',tables:before.tables.length,routines:before.routines.length,policies:before.policies.length,sequences:before.sequences.length,syntheticObjects:inventory.length,syntheticObjectBytes:inventory.reduce((n,o)=>n+o.bytes,0),archiveSha256:archiveHash,elapsedMs:Date.now()-started,
  limitations:['Two local clusters on the same PC; not a separate hosted fault domain','Synthetic Auth/Storage SQL and invented object bytes, not Supabase Auth service or Storage HTTP acceptance','Elapsed time is a synthetic drill, not production RPO/RTO']});
}catch(error){report.result='FAIL';await writeFile('scratch/op09/recovery-failure.private.log',String(error.stack||error));process.exitCode=1;
}finally{
 await db?.close().catch(()=>{});await restored?.close().catch(()=>{});
 for(const cluster of [source,target])if(cluster)try{await cluster.stop();}catch{report.result='FAIL';report.cleanupFailed=true;process.exitCode=1;}
 await save();console.log(JSON.stringify(report));
}
