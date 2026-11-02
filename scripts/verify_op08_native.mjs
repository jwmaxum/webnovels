import {snapshot} from './lib/native-recovery-snapshot.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {setup,admin,reader,uuid} from './fixtures/op07-db.mjs';

await mkdir('scratch/op08',{recursive:true});
await writeFile('scratch/op08/native-report.json',JSON.stringify({stage:'OP-08',result:'RUNNING',startedAt:new Date().toISOString()})+'\n');
const cluster=await startNativeCluster(),steps=[];let current;const opened=new Set();
const connect=async name=>{const db=await cluster.connect(name);opened.add(db);return db;};
const close=async db=>{opened.delete(db);await db.close();};
const proxy={query:(...args)=>current.query(...args),exec:sql=>current.exec(sql),close:()=>close(current)};
const rpc=async(db,action,data={},user=admin)=>(await db.query('select public.op07_payouts($1,$2,$3) result',[user,action,JSON.stringify(data)])).rows[0].result;
let counter=0,f;
async function scenario(name,fn){
 const database='op08_case_'+(++counter);await cluster.control.query('create database "'+database+'" template op08_template');current=await connect(database);
 let passed=false;
 try{await fn(database);steps.push({name,result:'PASS'});console.log('PASS: '+name);passed=true;}finally{await close(current);}
 // Only this generated database in our owned disposable cluster. Successful cases
 // need no retained DB files; the archive and evidence retain the restore case.
 if(passed)await cluster.control.query('drop database "'+database+'"');
}
async function race(database,first,second){
 const a=await connect(database),b=await connect(database);let pending;
 try{
  await a.exec('set role service_role;begin');await b.exec('set role service_role');
  const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid,one=await first(a);
  pending=second(b);pending.catch(()=>{});
  let blocked=false;const deadline=Date.now()+5000;
  while(Date.now()<deadline){if((await cluster.control.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert(blocked,'second native connection must actually wait for first transaction');
  await a.exec('commit');return [one,await pending];
 }finally{await a.exec('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await close(a);await close(b);}
}
const request=async(amount=50,id=uuid())=>{const s=await f.payouts('summary');return {amountKrw:amount,policyVersion:s.policy.id,payeeRevision:s.payee.revision,requestId:id};};
const change=(p,extra={})=>({payoutId:p.id,revision:p.revision,reason:'OP08 합성 경쟁 검증',requestId:uuid(),...extra});
async function pendingPayout(){await f.prepared();const r=(await f.requestPayout()).payout,a=(await f.transition('approve',r)).payout;return (await f.transition('begin',a)).payout;}

try{
 await cluster.createDatabase('op08_template');current=await connect('op08_template');f=await setup({dbFactory:async()=>proxy});await close(current);
 await scenario('same request replay across two native connections',async database=>{await f.prepared();const body=await request();const [a,b]=await race(database,c=>rpc(c,'request',body),c=>rpc(c,'request',body));assert(a.payout);assert.equal(b.payout.id,a.payout.id);assert.equal(b.replayed,true);assert.equal((await f.payouts('summary')).summary.reservedKrw,50);});
 await scenario('concurrent distinct requests cannot overdraw',async database=>{await f.prepared();const body=await request();const [a,b]=await race(database,c=>rpc(c,'request',body),c=>rpc(c,'request',{...body,requestId:uuid()}));assert(a.payout);assert.equal(b.error,'INSUFFICIENT_SETTLEMENT_BALANCE');assert.equal((await f.payouts('summary')).summary.availableKrw,20);});
 await scenario('approval and cancellation preserve revision ordering',async database=>{await f.prepared();const p=(await f.requestPayout()).payout;const [a,b]=await race(database,c=>rpc(c,'admin-approve',change(p)),c=>rpc(c,'cancel',change(p)));assert.equal(a.payout.status,'APPROVED');assert.equal(b.error,'REVISION_CONFLICT');});
 await scenario('payee change blocks previously approved dispatch',async database=>{await f.prepared();const p=(await f.transition('approve',(await f.requestPayout()).payout)).payout;
  const [a,b]=await race(database,c=>rpc(c,'admin-payee',{authorId:f.author,ready:true,testReference:'TEST-changed',revision:p.payeeRevision,reason:'OP08 지급 대상 변경',requestId:uuid()}),c=>rpc(c,'admin-begin',change(p)));assert(a.payee);assert.equal(b.error,'PAYEE_CHANGED');assert.equal((await f.payouts('summary')).summary.reservedKrw,70);});
 await scenario('deduction before approval prevents excess payout',async database=>{const prep=await f.prepared(),p=(await f.requestPayout()).payout;
  const [a,b]=await race(database,c=>rpc(c,'admin-adjust',{earningId:prep.earning.id,amountKrw:10,reason:'OP08 수익 감액 경쟁',requestId:uuid()}),c=>rpc(c,'admin-approve',change(p)));assert(a.earning);assert(b.error);assert.equal((await f.payouts('summary')).summary.debtKrw,10);});
 await scenario('success and failure evidence cannot both finalize',async database=>{const p=await pendingPayout(),proof=f.evidence(p),body=change(p,proof);
  const [a,b]=await race(database,c=>rpc(c,'admin-paid',body),c=>rpc(c,'admin-fail',change(p,{reference:proof.reference,testReference:p.testReference})));assert.equal(a.payout.status,'PAID');assert(b.error);assert.equal((await f.payouts('summary')).summary.paidKrw,70);});
 await scenario('refund reserves points before concurrent consumption',async database=>{
  const product=await f.makeProduct(),card=await f.card(product),q=await f.quote(f.novel.episodes[2].id);
  const [a,b]=await race(database,async c=>(await c.query('select public.op05_topups($1,$2,$3) result',[reader,'claim-refund',JSON.stringify({orderId:card.order.id,providerMode:'LOCAL_SIMULATED',merchantId:'LOCAL_SIMULATED',binding:'a'.repeat(64),reason:'OP08 환불 경쟁 검증',requestId:uuid()})])).rows[0].result,async c=>(await c.query('select public.op04_points_test($1,$2,$3) result',[reader,'purchase',JSON.stringify({quoteId:q.quote.id,requestId:uuid()})])).rows[0].result);
  assert(a.transport);assert.equal(b.error,'INSUFFICIENT_POINTS');});
 await scenario('connection loss rolls back evidence while UNKNOWN stays reserved',async database=>{const p=await pendingPayout(),body=change(p,f.evidence(p)),c=await connect(database);await c.exec('set role service_role;begin');const pid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;assert.equal((await rpc(c,'admin-paid',body)).payout.status,'PAID');await cluster.control.query('select pg_terminate_backend($1)',[pid]);await close(c);
  assert.equal((await f.payouts('request-detail',{payoutId:p.id})).payout.status,'UNKNOWN');assert.equal((await f.payouts('summary')).summary.reservedKrw,70);assert.equal((await rpc(current,'admin-paid',body)).payout.status,'PAID');assert.equal((await rpc(current,'admin-paid',body)).replayed,true);});
 await scenario('custom archive restores rows, ACL, RLS, routines, sequences and UNKNOWN replay',async database=>{
  const p=await pendingPayout(),body=change(p,f.evidence(p)),before=await snapshot(current),file=join(cluster.directory,'database.dump');await cluster.dump(database,file);await cluster.createDatabase('op08_restored');await cluster.restore('op08_restored',file);const restored=await connect('op08_restored');
  try{assert.deepEqual(await snapshot(restored),before);
   for(const role of ['anon','authenticated','service_role']){await restored.exec('set role '+role);await assert.rejects(restored.query('select * from commerce.op07_payouts'),e=>e.code==='42501');if(role!=='service_role')await assert.rejects(rpc(restored,'summary'),e=>e.code==='42501');await restored.exec('reset role');}
   await restored.exec('set role service_role');assert.equal((await rpc(restored,'summary')).summary.reservedKrw,70);assert.equal((await rpc(restored,'request-detail',{payoutId:p.id})).payout.status,'UNKNOWN');assert.equal((await rpc(restored,'admin-paid',body)).payout.status,'PAID');assert.equal((await rpc(restored,'admin-paid',body)).replayed,true);
   steps.push({name:'restored catalog inventory',result:'PASS',tables:before.tables.length,routines:before.routines.length,policies:before.policies.length,sequences:before.sequences.length,archiveSha256:createHash('sha256').update(await readFile(file)).digest('hex')});
  }finally{await close(restored);}
 });
 const report={stage:'OP-08',result:'PASS',checkedAt:new Date().toISOString(),engine:cluster.version,provenance:'NATIVE_POSTGRES_SYNTHETIC',steps,productionTouched:false,realProviderCalled:false,browser:'NOT_RUN',hostedRestoreVerified:false,storageBytesVerified:false,limitations:['Fresh database on the same disposable cluster; not a separate hosted fault domain','Synthetic roles are shared by source and target databases; not a managed Supabase Auth/Storage restore','No actual bank, tax, provider or real personal data evidence']};
 await writeFile('scratch/op08/native-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'PASS',steps:steps.length,report:'scratch/op08/native-report.json'}));
}catch(error){await writeFile('scratch/op08/native-failure.private.log',String(error.stack||error));await writeFile('scratch/op08/native-report.json',JSON.stringify({stage:'OP-08',result:'FAIL',checkedAt:new Date().toISOString(),steps})+'\n');throw error;
}finally{for(const db of opened)await db.close().catch(()=>{});await cluster.stop();}
