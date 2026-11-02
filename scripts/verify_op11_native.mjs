import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {snapshot} from './lib/native-recovery-snapshot.mjs';
import {setup,admin,uuid} from './fixtures/op11-db.mjs';
await mkdir('scratch/op11',{recursive:true});const cluster=await startNativeCluster();const open=new Set(),steps=[];let active,f;
const connect=async name=>{const db=await cluster.connect(name);open.add(db);return db;},close=async db=>{open.delete(db);await db.close();};
const proxy={query:(...a)=>active.query(...a),exec:s=>active.exec(s),close:()=>close(active)};
const flow=async(db,action,data)=>(await db.query('select public.op11_manual_payout($1,$2,$3,true) result',[admin,action,JSON.stringify(data)])).rows[0].result;
const provider=async(db,data)=>(await db.query("select public.op10_payout_admin($1,'prepare',$2) result",[admin,JSON.stringify(data)])).rows[0].result;
async function race(name,first,second){const a=await connect(name),b=await connect(name);let pending;
 try{await a.exec('set role service_role;begin');await b.exec('set role service_role');const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid,one=await first(a);pending=second(b);pending.catch(()=>{});
  let blocked=false;const until=Date.now()+5000;while(Date.now()<until){if((await cluster.control.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert(blocked,'actual connection must wait');await a.exec('commit');return [one,await pending];
 }finally{await a.exec('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await close(a);await close(b);}}
let counter=0;
async function scenario(title,fn){const name='op08_op11_'+(++counter);await cluster.control.query('create database "'+name+'" template op08_template');active=await connect(name);try{await fn(name);steps.push(title);}finally{await close(active);}}
try{
 await cluster.createDatabase('op08_template');active=await connect('op08_template');f=await setup({dbFactory:async()=>proxy});const payout=await f.approve(),cfg=await f.save();await close(active);
 const body=()=>({id:uuid(),sourceId:payout.id,configId:cfg.configId,destination:'synthetic-seller',scheduleType:'EXPRESS',payoutDate:null,transactionDescription:'TEST'});
 await scenario('manual-first excludes concurrent Toss selection',async name=>{const [a,b]=await race(name,c=>flow(c,'start',f.change(payout)),c=>provider(c,body()));assert.equal(a.workflow.status,'UNKNOWN');assert.equal(b.error,'SOURCE_NOT_READY');});
 await scenario('Toss-first excludes concurrent manual transfer selection',async name=>{const [a,b]=await race(name,c=>provider(c,body()),c=>flow(c,'start',f.change(payout)));assert(a.job);assert.equal(b.error,'PAYOUT_METHOD_CONFLICT');});
 await scenario('duplicate completion across connections applies once',async name=>{const w=(await f.start(payout)).workflow,proof=f.proof(w);const [a,b]=await race(name,c=>flow(c,'complete',proof),c=>flow(c,'complete',proof));assert.equal(a.workflow.status,'PAID');assert.equal(b.replayed,true);assert.equal((await f.payouts('summary')).summary.paidKrw,70);});
 await scenario('different requests cannot both finalize; archive preserves route/proof/roles',async name=>{
  const w=(await f.start(payout)).workflow,proof=f.proof(w);const [a,b]=await race(name,c=>flow(c,'complete',proof),c=>flow(c,'complete',{...proof,requestId:uuid()}));assert.equal(a.workflow.status,'PAID');assert.equal(b.error,'REVISION_CONFLICT');
  const before=await snapshot(active),file=join(cluster.directory,'database.dump');await cluster.dump(name,file);await cluster.createDatabase('op08_restored');await cluster.restore('op08_restored',file);const restored=await connect('op08_restored');
  try{assert.deepEqual(await snapshot(restored),before);await restored.exec('set role authenticated');await assert.rejects(flow(restored,'detail',{payoutId:payout.id}),e=>e.code==='42501');await restored.exec('reset role;set role service_role');assert.equal((await flow(restored,'complete',proof)).replayed,true);}finally{await close(restored);}
 });
 const report={stage:'OP-11',result:'PASS',engine:cluster.version,steps,provenance:'NATIVE_POSTGRES_SYNTHETIC',productionTouched:false,actualBankTransfer:false,hostedRestoreVerified:false};await writeFile('scratch/op11/native-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{for(const db of open)await db.close().catch(()=>{});await cluster.stop();}
