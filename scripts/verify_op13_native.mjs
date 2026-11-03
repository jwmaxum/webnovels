import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {snapshot} from './lib/native-recovery-snapshot.mjs';
import {setup,admin,reader,operator,reviewer} from './fixtures/op13-db.mjs';
const cluster=await startNativeCluster(),open=new Set(),steps=[];let active,f;await mkdir('scratch/op13',{recursive:true});
const connect=async name=>{const db=await cluster.connect(name);open.add(db);return db;},close=async db=>{open.delete(db);await db.close();};
const proxy={query:(...a)=>active.query(...a),exec:s=>active.exec(s),close:()=>close(active)};
const call=async(db,role,action,data,user=role==='reader'?reader:operator)=>(await db.query('select public.op13_commerce($1,$2,$3,$4) r',[user,role,action,JSON.stringify(data)])).rows[0].r;
async function race(name,first,second){const a=await connect(name),b=await connect(name);let pending;try{
 await a.exec('set role service_role;begin');await b.exec('set role service_role');const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;const one=await first(a);pending=second(b);pending.catch(()=>{});let blocked=false;const until=Date.now()+5000;
 while(Date.now()<until){if((await cluster.control.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert(blocked);await a.exec('commit');return [one,await pending];
 }finally{await a.exec('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await close(a);await close(b);}}
let counter=0;async function scenario(title,fn){const name='op08_op13_'+(++counter);await cluster.control.query('create database "'+name+'" template op08_template');active=await connect(name);try{await fn(name);steps.push(title);}finally{await close(active);}}
try{
 await cluster.createDatabase('op08_template');active=await connect('op08_template');f=await setup({dbFactory:async()=>proxy});await f.policy(f.novel.id);const funding=await f.fund();assert(funding.confirmed.id);const q=await f.call('reader','quote',{episodeId:f.novel.episodes[2].id});const proof=await f.evidence();await close(active);
 await scenario('two concurrent purchase requests debit the episode once',async name=>{const data={requestId:crypto.randomUUID(),quoteId:q.id};const [a,b]=await race(name,c=>call(c,'reader','purchase',data),c=>call(c,'reader','purchase',data));assert.equal(a.charged,100);assert.equal(b.replayed,true);assert.equal((await f.call('reader','state')).balance,9900);});
 await scenario('independent confirmations of the same bank transaction create one lot',async name=>{const o=await f.write('reader','order',{destinationHash:'d'.repeat(64)}),d=await f.write('admin','deposit',{orderId:o.id,destinationHash:'d'.repeat(64),amount:10000,bankRefHash:'a'.repeat(64),occurredAt:new Date().toISOString(),evidence:proof});assert(d.id);const [a,b]=await race(name,c=>call(c,'admin','confirm',{requestId:crypto.randomUUID(),depositId:d.id},reviewer),c=>call(c,'admin','confirm',{requestId:crypto.randomUUID(),depositId:d.id},reviewer));assert(a.id);assert.equal(b.error,'COMMERCE_CONFLICT');assert.equal((await f.call('reader','state')).balance,20000);});
 await scenario('refund reservation wins against purchase without overspending',async name=>{const [a,b]=await race(name,c=>call(c,'admin','correction',{requestId:crypto.randomUUID(),lotId:funding.confirmed.id,kind:'REFUND',amount:10000,bankRefHash:'b'.repeat(64),evidence:proof}),c=>call(c,'reader','purchase',{requestId:crypto.randomUUID(),quoteId:q.id}));assert(a.id);assert.equal(b.error,'INSUFFICIENT_POINTS');});
 await scenario('account change before payout approval rejects the bound old account',async name=>{
  await f.write('reader','purchase',{quoteId:q.id});assert.equal((await f.bank()).saved,true);const state=await f.call('author','state'),p=await f.write('author','request',{binding:state.binding}),data=await f.changedBankData();assert(p.id);
  const [a,b]=await race(name,async c=>(await c.query('select public.author_settlement_bank($1,$2) r',[admin,JSON.stringify(data)])).rows[0].r,c=>call(c,'admin','approve',{requestId:crypto.randomUUID(),payoutId:p.id,deduction:0,basisRef:'synthetic-review'},reviewer));assert(a.bank);assert.equal(b.error,'PAYOUT_NOT_READY');
 });
 await scenario('archive restore preserves paid-source lineage, receipts, encrypted evidence and ACLs',async name=>{
  const purchase=await f.write('reader','purchase',{quoteId:q.id});assert.equal(purchase.charged,100);const options={schemas:['public','auth','authoring','launch_recovery','commerce','live_commerce']},before=await snapshot(active,options),file=join(cluster.directory,'database.dump');await cluster.dump(name,file);await cluster.createDatabase('op08_restored');await cluster.restore('op08_restored',file);const restored=await connect('op08_restored');
  try{assert.deepEqual(await snapshot(restored,options),before);await restored.exec('set role authenticated');await assert.rejects(call(restored,'reader','state',{}),e=>e.code==='42501');await restored.exec('reset role;set role service_role');assert.equal((await call(restored,'reader','state',{})).balance,9900);await assert.rejects(restored.query('select * from live_commerce.documents'),e=>e.code==='42501');}finally{await close(restored);}
 });
 const report={stage:'OP-13',result:'PASS',engine:cluster.version,steps,provenance:'NATIVE_POSTGRES_SYNTHETIC',productionTouched:false,realMoneyMovement:false,hostedRestoreVerified:false};await writeFile('scratch/op13/native-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{for(const db of open)await db.close().catch(()=>{});await cluster.stop();}
