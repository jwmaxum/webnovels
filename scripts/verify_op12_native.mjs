import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startNativeCluster} from './lib/op08-native-postgres.mjs';
import {snapshot} from './lib/native-recovery-snapshot.mjs';
import {setup,admin,owner} from './fixtures/op12-db.mjs';
import {confirmation} from './fixtures/op12-confirmation.mjs';
const cluster=await startNativeCluster(),open=new Set(),steps=[];let active,f;await mkdir('scratch/op12',{recursive:true});
const connect=async name=>{const db=await cluster.connect(name);open.add(db);return db;},close=async db=>{open.delete(db);await db.close();};
const proxy={query:(...a)=>active.query(...a),exec:s=>active.exec(s),close:()=>close(active)};
const call=async(db,action,data)=>(await db.query('select public.op12_settlement_readiness($1,$2,$3,true) r',[admin,action,JSON.stringify(data)])).rows[0].r;
async function race(name,first,second){const a=await connect(name),b=await connect(name);let pending;
 try{await a.exec('set role service_role;begin');await b.exec('set role service_role');const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid,one=await first(a);pending=second(b);pending.catch(()=>{});
  let blocked=false;const until=Date.now()+5000;while(Date.now()<until){if((await cluster.control.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert(blocked,'must actually wait across connections');await a.exec('commit');return [one,await pending];
 }finally{await a.exec('rollback').catch(()=>{});if(pending)await pending.catch(()=>{});await close(a);await close(b);}}
let counter=0;
async function scenario(title,fn){const name='op08_op12_'+(++counter);await cluster.control.query('create database "'+name+'" template op08_template');active=await connect(name);try{await fn(name);steps.push(title);}finally{await close(active);}}
try{
 await cluster.createDatabase('op08_template');active=await connect('op08_template');f=await setup({dbFactory:async()=>proxy});await f.seed();const proof=await confirmation(f),bank=(await active.query('select * from launch_recovery.author_payout_details where author_id=1')).rows[0];await close(active);
 const bankData={revision:String(bank.revision),bankName:'합성 변경 은행',holder:'합성 신청인',last4:'5678',envelope:bank.account_envelope,policyVersion:f.policy.version,policyHash:f.policy.hash,transferNoticeVersion:f.policy.transferNoticeVersion,transferNoticeHash:f.policy.transferNoticeHash};
 const change=async db=>(await db.query('select public.author_settlement_bank($1,$2) r',[owner,JSON.stringify(bankData)])).rows[0].r;
 await scenario('bank change before review rejects stale proof',async name=>{const [a,b]=await race(name,change,c=>call(c,'confirm',proof));assert(a.bank);assert.equal(b.error,'SETTLEMENT_CONFLICT');});
 await scenario('review before bank change preserves history and invalidates current readiness',async name=>{const [a,b]=await race(name,c=>call(c,'confirm',proof),change);assert(a.saved);assert(b.bank);const d=await f.call('detail',{authorId:'1'});assert.equal(d.facts.bankConfirmed,false);assert.equal(d.reviews.length,1);});
 await scenario('duplicate requests create one encrypted evidence and independent request cannot confirm twice',async name=>{const [a,b]=await race(name,c=>call(c,'confirm',proof),c=>call(c,'confirm',proof));assert(a.saved);assert.equal(b.replayed,true);assert.equal((await f.call('confirm',{...proof,requestId:crypto.randomUUID(),documentId:crypto.randomUUID()})).error,'BANK_ALREADY_CONFIRMED');assert.equal((await active.query('select count(*)::int n from launch_recovery.op12_documents')).rows[0].n,1);});
 await scenario('archive restore preserves private documents, ACLs, review revocations and snapshots',async()=>{
  await f.call('confirm',proof);await f.call('snapshot',{authorId:'1',binding:proof.binding,requestId:crypto.randomUUID(),period:new Date().toISOString().slice(0,7)});await f.call('revoke',{authorId:'1',binding:proof.binding,requestId:crypto.randomUUID(),reviewId:proof.requestId,reason:'INCORRECT_EVIDENCE'});
  const options={schemas:['public','auth','authoring','launch_recovery']},before=await snapshot(active,options),file=join(cluster.directory,'database.dump');await cluster.dump('op08_op12_4',file);await cluster.createDatabase('op08_restored');await cluster.restore('op08_restored',file);const restored=await connect('op08_restored');
  try{assert.deepEqual(await snapshot(restored,options),before);await restored.exec('set role authenticated');await assert.rejects(call(restored,'detail',{authorId:'1'}),e=>e.code==='42501');await restored.exec('reset role;set role service_role');assert.equal((await call(restored,'detail',{authorId:'1'})).facts.bankConfirmed,false);assert.equal((await call(restored,'confirm',proof)).replayed,true);}finally{await close(restored);}
 });
 const report={stage:'OP-12',result:'PASS',engine:cluster.version,steps,provenance:'NATIVE_POSTGRES_SYNTHETIC',productionTouched:false,realMoneyMovement:false,hostedRestoreVerified:false};await writeFile('scratch/op12/native-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{for(const db of open)await db.close().catch(()=>{});await cluster.stop();}
