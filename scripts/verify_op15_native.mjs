import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {snapshot} from './lib/native-recovery-snapshot.mjs';
import {setup,admin,operator,reviewer} from './fixtures/op15-db.mjs';
const cluster=await startNativeCluster(),open=new Set(),steps=[];let active,f;await mkdir('scratch/op15',{recursive:true});
const payoutOnly=process.argv.includes('--payout-only');
const connect=async name=>{const db=await cluster.connect(name);open.add(db);return db;},close=async db=>{open.delete(db);await db.close();};
const proxy={query:(...a)=>active.query(...a),exec:s=>active.exec(s),close:()=>close(active)};
const ops=async(db,action,data,user=operator)=>(await db.query('select public.op15_commerce_allocations($1,$2,$3) r',[user,action,JSON.stringify(data)])).rows[0].r;
async function race(name,first,second){const a=await connect(name),b=await connect(name);let pending;try{
 await a.exec('set role service_role;begin');await b.exec('set role service_role');const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;const one=await first(a);pending=second(b);pending.catch(()=>{});let blocked=false;const until=Date.now()+5000;
 while(Date.now()<until){if((await cluster.control.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert(blocked);await a.exec('commit');return [one,await pending];
 }finally{await a.exec('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await close(a);await close(b);}}
let counter=0;async function scenario(title,fn){if(payoutOnly&&!title.startsWith('concurrent author'))return;const name='op08_op15_'+(++counter);await cluster.control.query('create database "'+name+'" template op08_template');active=await connect(name);try{await fn(name);steps.push(title);}finally{await close(active);}}
try{
 await cluster.createDatabase('op08_template');active=await connect('op08_template');f=await setup({dbFactory:async()=>proxy});const d=await f.deposit(),o=await f.write('reader','order',{destinationHash:'d'.repeat(64)});await close(active);
 const propose=orderId=>({requestId:crypto.randomUUID(),kind:'CREDIT',orderId,sources:[{depositId:d.record.id,amount:10000}],reasonRef:'synthetic-review',reassignmentConfirmed:true,destinationHash:'d'.repeat(64)});
 await scenario('same bank source cannot fund concurrent orders',async name=>{
  const [a,b]=await race(name,c=>ops(c,'funding-propose',propose(d.order.id)),c=>ops(c,'funding-propose',propose(o.id)));assert(a.id);assert.equal(b.error,'OP15_SOURCE_RESERVED');
 });
 await scenario('allocation reservation prevents competing legacy deposit credit',async name=>{
  const [a,b]=await race(name,c=>ops(c,'funding-propose',propose(o.id)),async c=>(await c.query("select public.op13_commerce($1,'admin','confirm',$2) r",[reviewer,JSON.stringify({requestId:crypto.randomUUID(),depositId:d.record.id})])).rows[0].r);assert(a.id);assert.equal(b.error,'OP15_SOURCE_RESERVED');assert.equal((await f.call('reader','state')).balance,0);
 });
 await scenario('independent double approval credits once and atomically enqueues one notification',async name=>{
  const p=await f.allocate('funding-propose',propose(o.id)),data=()=>({requestId:crypto.randomUUID(),planId:p.id,approved:true,destinationHash:'d'.repeat(64)});
  const [a,b]=await race(name,c=>ops(c,'funding-review',data(),reviewer),c=>ops(c,'funding-review',data(),reviewer));assert(a.id);assert.equal(b.error,'OP15_PLAN_CHANGED');assert.equal((await f.call('reader','state')).balance,10000);assert.equal((await f.allocate('notification-list')).items.length,1);
 });
 await scenario('stale TEST retry cannot overwrite a later outcome',async name=>{
  const p=await f.allocate('funding-propose',propose(o.id));assert((await f.awrite('funding-review',{planId:p.id,approved:true,destinationHash:'d'.repeat(64)},reviewer)).id);const n=(await f.allocate('notification-list')).items[0];
  const data=outcome=>({requestId:crypto.randomUUID(),notificationId:n.id,expectedAttempt:0,outcome});const [a,b]=await race(name,c=>ops(c,'notification-test',data('TEST_RETRY')),c=>ops(c,'notification-test',data('TEST_READY')));assert(a.id);assert.equal(b.error,'OP15_PLAN_CHANGED');
 });
 await scenario('concurrent author requests reserve purchase earnings only once',async name=>{
  assert((await f.write('admin','confirm',{depositId:d.record.id},reviewer)).id);await f.policy(f.novel.id);const q=await f.call('reader','quote',{episodeId:f.novel.episodes[2].id});assert((await f.write('reader','purchase',{quoteId:q.id})).id);await f.bank();const state=await f.call('author','state');
  const request=async c=>(await c.query("select public.op13_commerce($1,'author','request',$2) r",[admin,JSON.stringify({requestId:crypto.randomUUID(),binding:state.binding})])).rows[0].r;
  // The first reservation consumes all available earnings; that guard precedes the pending-payout check.
  const [a,b]=await race(name,request,request);assert(a.id);assert.equal(b.error,'PAYOUT_NOT_READY');const rows=(await active.query('select amount from live_commerce.payout_sources')).rows;assert.equal(rows.length,1);assert.equal(rows[0].amount,70);
 });
 await scenario('full archive restores aggregate sources, immutable notifications and service-only ACLs',async name=>{
  const p=await f.allocate('funding-propose',propose(o.id));assert((await f.awrite('funding-review',{planId:p.id,approved:true,destinationHash:'d'.repeat(64)},reviewer)).id);
  const options={schemas:['public','auth','authoring','launch_recovery','commerce','live_commerce']},before=await snapshot(active,options),file=join(cluster.directory,'database.dump');await cluster.dump(name,file);await cluster.createDatabase('op08_restored');await cluster.restore('op08_restored',file);const restored=await connect('op08_restored');
  try{assert.deepEqual(await snapshot(restored,options),before);await restored.exec('set role authenticated');await assert.rejects(ops(restored,'funding-list',{}),e=>e.code==='42501');await restored.exec('reset role;set role service_role');assert.equal((await ops(restored,'funding-list',{})).plans[0].status,'CREDITED');await assert.rejects(restored.exec('select * from live_commerce.notification_outbox'),e=>e.code==='42501');}finally{await close(restored);}
 });
 const report={stage:'OP-15',result:'PASS',engine:cluster.version,steps,provenance:'NATIVE_POSTGRES_SYNTHETIC',productionTouched:false,realMoneyMovement:false,emailSent:false,hostedRestoreVerified:false};await writeFile('scratch/op15/'+(payoutOnly?'native-payout-report':'native-report')+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{for(const db of open)await db.close().catch(()=>{});await cluster.stop();}
