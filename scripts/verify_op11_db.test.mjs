import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setup,admin,reader,limited,uuid,sql} from './fixtures/op11-db.mjs';
let f,db;before(async()=>{f=await setup();db=f.db;});after(()=>db?.close());beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));
test('manual-first start/completion preserves reservations, immutable evidence and author privacy',async()=>{
 const p=await f.approve(),before=await f.flow('detail',{payoutId:p.id});assert.equal(before.workflow.method,'MANUAL');assert.equal(before.workflow.selected,false);
 const startBody=f.change(p),started=await f.flow('start',startBody);assert.equal(started.workflow.status,'UNKNOWN');assert.equal((await f.flow('start',startBody)).replayed,true);
 assert.equal((await f.payouts('summary')).summary.reservedKrw,70);
 const body=f.proof(started.workflow),done=await f.flow('complete',body);assert.equal(done.workflow.status,'PAID');assert.equal(done.workflow.proof.provenance,'MANUAL_ATTESTED_TEST');assert.equal((await f.flow('complete',body)).replayed,true);
 assert.equal((await f.flow('complete',{...body,documentReference:'TEST-different'})).error,'IDEMPOTENCY_CONFLICT');
 const summary=(await f.payouts('summary')).summary;assert.equal(summary.paidKrw,70);assert.equal(summary.reservedKrw,0);
 const author=(await f.flow('detail',{payoutId:p.id},admin,false)).workflow;assert.equal(author.proof.provenance,'MANUAL_ATTESTED_TEST');assert(!('documentReference' in author.proof));assert(!('transactionReference' in author.proof));assert.deepEqual(author.history,[]);
 assert.equal((await f.flow('detail',{payoutId:p.id},reader,false)).error,'PAYOUT_NOT_FOUND');
 await db.exec('savepoint frozen');await assert.rejects(db.exec("update commerce.op11_proofs set document_ref='TEST-changed'"),/IMMUTABLE/);await db.exec('rollback to frozen;release frozen');
});
test('proof mismatch rolls back receipt and cannot mark completion or release reservation',async()=>{
 const p=await f.approve(),w=(await f.start(p)).workflow,body=f.proof(w);
 for(const change of [{amountKrw:71},{testReference:'TEST-wrong'},{paidAt:'2000-01-01T00:00:00Z'},{paidAt:'2100-01-01T00:00:00Z'}])assert.equal((await f.flow('complete',{...body,...change,requestId:uuid()})).error,'PAYOUT_PROOF_MISMATCH');
 assert.equal((await db.query('select count(*)::int n from commerce.op11_proofs')).rows[0].n,0);assert.equal((await f.payouts('summary')).summary.reservedKrw,70);
 assert.equal((await f.flow('complete',body)).workflow.status,'PAID');
});
test('hold/note records private history without unreserving; verified failure explicitly terminates',async()=>{
 const w=(await f.start(await f.approve())).workflow;
 assert.equal((await f.flow('hold',f.change(w))).workflow.status,'UNKNOWN');assert.equal((await f.payouts('summary')).summary.reservedKrw,70);
 const proof=f.proof(w);delete proof.amountKrw;delete proof.paidAt;
 const failed=await f.flow('failure',proof);assert.equal(failed.workflow.status,'FAILED');assert.equal((await f.payouts('summary')).summary.reservedKrw,0);assert.equal((await f.payouts('summary')).summary.paidKrw,0);
 assert((await f.flow('note',f.change(failed.workflow))).workflow.history.some(e=>e.kind==='NOTE'));
});
test('choosing Toss prevents manual start, cancel, direct paid and duplicate routes; query remains separate',async()=>{
 const {job,source}=await f.prepare();assert(job);
 const w=(await f.flow('detail',{payoutId:source.id})).workflow;assert.equal(w.method,'TOSS_TEST');assert.equal(w.provider.state,'READY');assert.equal(w.provider.ledgerApplied,false);
 assert.equal((await f.start(source)).error,'PAYOUT_METHOD_CONFLICT');
 await db.exec('savepoint guard');await assert.rejects(f.transition('reject',source),/PAYOUT_METHOD_CONFLICT/);await db.exec('rollback to guard;release guard');
 const claim=await f.claim(job);assert(claim.claimed);assert.equal((await f.flow('detail',{payoutId:source.id})).workflow.provider.state,'UNKNOWN');
 assert.equal((await f.payouts('request-detail',{payoutId:source.id})).payout.status,'APPROVED');
});
test('manual selection prevents provider preparation and legacy bypass without matching proof',async()=>{
 const p=await f.approve();await db.exec('savepoint guard');await assert.rejects(f.transition('begin',p),/MANUAL_WORKFLOW_REQUIRED/);await db.exec('rollback to guard;release guard');
 const w=(await f.start(p)).workflow,cfg=await f.save();
 assert.equal((await f.adminCall('prepare',{id:uuid(),sourceId:p.id,configId:cfg.configId,destination:'synthetic',scheduleType:'EXPRESS',payoutDate:null,transactionDescription:'TEST'})).error,'SOURCE_NOT_READY');
 await db.exec('savepoint guard');await assert.rejects(f.transition('paid',{id:p.id,revision:w.revision},{...f.evidence({testReference:w.payeeReference,amountKrw:70})}),/MANUAL_PROOF_REQUIRED/);await db.exec('rollback to guard;release guard');
 assert.equal((await db.query('select count(*)::int n from commerce.op07_evidence')).rows[0].n,0);
});
test('current verified permissions, ownership, invalid fields and revocation are enforced before replay',async()=>{
 const p=await f.approve(),body=f.change(p);await f.flow('start',body);
 assert.equal((await f.flow('detail',{payoutId:p.id},limited)).error,'ADMIN_FORBIDDEN');assert.equal((await f.flow('note',f.change(p),admin,false)).error,'ADMIN_FORBIDDEN');
 for(const [action,data]of [['detail',{payoutId:p.id,extra:true}],['note',{...body,reason:'<script>'}],['note',{...body,revision:1}],['start',{...body,payoutId:'fake'}]])assert.equal((await f.flow(action,data)).error,'INVALID_PAYOUT_REQUEST');
 await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);assert.equal((await f.flow('start',body)).error,'ADMIN_FORBIDDEN');
});
test('same TEST bank transaction cannot finalize two requests; no partial proof survives conflict',async()=>{
 await f.prepared();const p1=(await f.transition('approve',(await f.requestPayout(30)).payout)).payout,p2=(await f.transition('approve',(await f.requestPayout(40)).payout)).payout;
 const w1=(await f.start(p1)).workflow,w2=(await f.start(p2)).workflow,b1=f.proof(w1);assert.equal((await f.flow('complete',b1)).workflow.status,'PAID');
 const b2={...f.proof(w2),reference:b1.reference};assert.equal((await f.flow('complete',b2)).error,'PAYOUT_EVIDENCE_CONFLICT');
 assert.equal((await f.flow('detail',{payoutId:p2.id})).workflow.status,'UNKNOWN');assert.equal((await f.payouts('summary')).summary.reservedKrw,40);
});
test('note limit does not prevent recording a confirmed payment',async()=>{
 const w=(await f.start(await f.approve())).workflow;
 await db.query("insert into commerce.op11_events(payout_id,actor_id,kind,note) select $1,$2,'NOTE','합성 검증 메모' from generate_series(1,200)",[w.payoutId,admin]);
 assert.equal((await f.flow('note',f.change(w))).error,'WORKFLOW_HISTORY_LIMIT');assert.equal((await f.flow('complete',f.proof(w))).workflow.status,'PAID');
});
test('all private tables/helpers deny direct roles; only service may execute public workflow RPC',async()=>{
 const tables=(await db.query("select tablename,rowsecurity from pg_tables where schemaname='commerce' and tablename like 'op11_%'")).rows;assert.equal(tables.length,5);
 for(const role of ['anon','authenticated','service_role']){
  for(const t of tables){assert(t.rowsecurity);for(const acl of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) yes',[role,'commerce.'+t.tablename,acl])).rows[0].yes,false);
   await db.exec('savepoint acl;set role '+role);await assert.rejects(db.query('select * from commerce.'+t.tablename),/permission denied/);await db.exec('rollback to acl;release acl');}
  await db.exec('savepoint acl;set role '+role);if(role==='service_role')assert.equal((await f.flow('detail',{payoutId:uuid()})).error,'PAYOUT_NOT_FOUND');else await assert.rejects(f.flow('detail',{payoutId:uuid()}),/permission denied/);await db.exec('rollback to acl;release acl');
 }
 await db.exec('savepoint guard');await assert.rejects(db.exec(sql),/Reviewed OP11/);await db.exec('rollback to guard;release guard');
});
