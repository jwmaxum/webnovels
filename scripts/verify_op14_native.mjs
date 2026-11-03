import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {snapshot} from './lib/native-recovery-snapshot.mjs';
import {setup,reader,operator,reviewer} from './fixtures/op14-db.mjs';
const cluster=await startNativeCluster(),open=new Set(),steps=[];let active,f;await mkdir('scratch/op14',{recursive:true});
const connect=async name=>{const db=await cluster.connect(name);open.add(db);return db;},close=async db=>{open.delete(db);await db.close();};
const proxy={query:(...a)=>active.query(...a),exec:s=>active.exec(s),close:()=>close(active)};
const ops=async(db,action,data,user=operator)=>(await db.query('select public.op14_commerce_operations($1,$2,$3) r',[user,action,JSON.stringify(data)])).rows[0].r;
const commerce=async(db,action,data,user=reviewer)=>(await db.query("select public.op13_commerce($1,'admin',$2,$3) r",[user,action,JSON.stringify(data)])).rows[0].r;
async function race(name,first,second){const a=await connect(name),b=await connect(name);let pending;try{
 await a.exec('set role service_role;begin');await b.exec('set role service_role');const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;const one=await first(a);pending=second(b);pending.catch(()=>{});let blocked=false;const until=Date.now()+5000;
 while(Date.now()<until){if((await cluster.control.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert(blocked);await a.exec('commit');return [one,await pending];
 }finally{await a.exec('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await close(a);await close(b);}}
let counter=0;async function scenario(title,fn){const name='op08_op14_'+(++counter);await cluster.control.query('create database "'+name+'" template op08_template');active=await connect(name);try{await fn(name);steps.push(title);}finally{await close(active);}}
try{
 await cluster.createDatabase('op08_template');active=await connect('op08_template');f=await setup({dbFactory:async()=>proxy});const deposit=await f.deposit(),proof=await f.evidence();await close(active);
 await scenario('hold committed before deposit confirmation prevents credit',async name=>{
  const [a,b]=await race(name,c=>ops(c,'case-open',{requestId:crypto.randomUUID(),kind:'DEPOSIT',targetId:deposit.record.id,reasonRef:'synthetic-hold'}),c=>commerce(c,'confirm',{requestId:crypto.randomUUID(),depositId:deposit.record.id}));assert(a.id);assert.equal(b.error,'OP14_CASE_OPEN');assert.equal((await f.call('reader','state')).balance,0);
 });
 await scenario('concurrent reproof reviews approve once and preserve the original document',async name=>{
  const p=await f.opwrite('reproof',{kind:'DEPOSIT',targetId:deposit.record.id,reasonRef:'synthetic-copy',bankRefHash:deposit.bankRefHash,evidence:proof});assert(p.id);
  const [a,b]=await race(name,c=>ops(c,'review-reproof',{requestId:crypto.randomUUID(),proofId:p.id,approved:true},reviewer),c=>ops(c,'review-reproof',{requestId:crypto.randomUUID(),proofId:p.id,approved:true},reviewer));assert(a.id);assert.equal(b.error,'OP14_TARGET_NOT_READY');assert((await f.write('admin','confirm',{depositId:deposit.record.id},reviewer)).id);
 });
 await scenario('monthly approval serializes and cannot fork the approved revision chain',async name=>{
  const month='2020-01',preview=await f.ops('month-preview',{month});const d=await f.opwrite('month-draft',{month,expectedDigest:preview.digest,previousId:null,reasonRef:'synthetic-close'});assert(d.id);
  const [a,b]=await race(name,c=>ops(c,'month-approve',{requestId:crypto.randomUUID(),reportId:d.id,expectedDigest:preview.digest},reviewer),c=>ops(c,'month-approve',{requestId:crypto.randomUUID(),reportId:d.id,expectedDigest:preview.digest},reviewer));assert(a.id);assert.equal(b.error,'OP14_REPORT_CHANGED');assert.equal((await f.ops('month-list',{offset:0})).reports.filter(r=>r.approved).length,1);
 });
 await scenario('archive restores reconciliation, encrypted reproof, immutable monthly snapshots and ACLs',async name=>{
  const p=await f.opwrite('reproof',{kind:'DEPOSIT',targetId:deposit.record.id,reasonRef:'synthetic-copy',bankRefHash:deposit.bankRefHash,evidence:proof});assert(p.id);
  assert((await f.opwrite('review-reproof',{proofId:p.id,approved:true},reviewer)).id);
  const month='2020-01',preview=await f.ops('month-preview',{month}),d=await f.opwrite('month-draft',{month,expectedDigest:preview.digest,previousId:null,reasonRef:'synthetic-close'});assert((await f.opwrite('month-approve',{reportId:d.id,expectedDigest:preview.digest},reviewer)).id);
  const options={schemas:['public','auth','authoring','launch_recovery','commerce','live_commerce']},before=await snapshot(active,options),file=join(cluster.directory,'database.dump');await cluster.dump(name,file);await cluster.createDatabase('op08_restored');await cluster.restore('op08_restored',file);const restored=await connect('op08_restored');
  try{assert.deepEqual(await snapshot(restored,options),before);await restored.exec('set role authenticated');await assert.rejects(ops(restored,'month-list',{}),e=>e.code==='42501');await restored.exec('reset role;set role service_role');assert((await ops(restored,'month-detail',{reportId:d.id})).approved);await assert.rejects(restored.exec('select * from live_commerce.reproofs'),e=>e.code==='42501');}finally{await close(restored);}
 });
 const report={stage:'OP-14',result:'PASS',engine:cluster.version,steps,provenance:'NATIVE_POSTGRES_SYNTHETIC',productionTouched:false,realMoneyMovement:false,hostedRestoreVerified:false};await writeFile('scratch/op14/native-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{for(const db of open)await db.close().catch(()=>{});await cluster.stop();}
