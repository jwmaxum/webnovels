import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,reader,reviewer,operator} from './fixtures/op14-db.mjs';
import {setup as setupPrevious} from './fixtures/op13-db.mjs';
import {readFile} from 'node:fs/promises';
test('OP14 upgrade preserves existing purchases, account binding and manual payout completion',async()=>{
 const f=await setupPrevious();try{
  await f.policy(f.novel.id);await f.fund();const q=await f.call('reader','quote',{episodeId:f.novel.episodes[2].id});await f.write('reader','purchase',{quoteId:q.id});await f.bank();const state=await f.call('author','state');const payout=await f.write('author','request',{binding:state.binding});assert(payout.id);
  assert((await f.write('admin','approve',{payoutId:payout.id,deduction:0,basisRef:'synthetic-tax'},reviewer)).id);
  const before=(await f.db.query('select id,points,revenue from live_commerce.purchases order by id')).rows;
  await f.db.exec("set webnovels.commerce_operations_apply_verified='true'");await f.db.exec(await readFile(new URL('../database/launch/027_commerce_operations.sql',import.meta.url),'utf8'));
  assert.deepEqual((await f.db.query('select id,points,revenue from live_commerce.purchases order by id')).rows,before);assert.equal((await f.call('reader','state')).balance,9900);
  assert.equal((await f.call('reader','content',{episodeId:f.novel.episodes[2].id})).contentType,'NOVEL');
  assert((await f.write('admin','complete',{payoutId:payout.id,net:70,occurredAt:new Date().toISOString(),bankRefHash:'f'.repeat(64),evidence:await f.evidence()})).id);
  assert.equal((await f.call('author','state')).payouts[0].status,'PAID');
 }finally{await f.db.close();}
});
test('OP14 expired original evidence can be re-proven without resurrection; refund reproof preserves balances',async()=>{
 const f=await setup();try{
  const order=await f.write('reader','order',{destinationHash:'d'.repeat(64)}),old=await f.evidence(),id=crypto.randomUUID();
  await f.db.query("insert into live_commerce.documents values($1,$2,'BANK_DEPOSIT',$3,$4,$5,$6,1,now()-interval '3 days',now()-interval '2 days',null)",[old.id,operator,JSON.stringify(old.envelope),old.digest,old.policyVersion,old.policyHash]);
  await f.db.query('insert into live_commerce.deposits values($1,$2,$3,10000,$4,$5,now(),now())',[id,order.id,'a'.repeat(64),old.id,operator]);
  assert.equal((await f.write('admin','confirm',{depositId:id},reviewer)).error,'DOCUMENT_UNAVAILABLE');
  assert.equal((await f.db.query('select public.op13_purge_documents() r')).rows[0].r.purged,1);
  const replacement=await f.evidence(),p=await f.opwrite('reproof',{kind:'DEPOSIT',targetId:id,reasonRef:'bank-copy-after-expiry',bankRefHash:'a'.repeat(64),evidence:replacement});assert(p.id);
  assert((await f.opwrite('review-reproof',{proofId:p.id,approved:true},reviewer)).id);
  const credit=await f.write('admin','confirm',{depositId:id},reviewer);assert(credit.id);
  assert.equal((await f.db.query('select envelope from live_commerce.documents where id=$1',[old.id])).rows[0].envelope,null);
  const corr=await f.write('admin','correction',{lotId:credit.id,kind:'REFUND',amount:10000,bankRefHash:'b'.repeat(64),evidence:await f.evidence()});assert(corr.id);
  const p2=await f.opwrite('reproof',{kind:'CORRECTION',targetId:corr.id,reasonRef:'clearer-refund-proof',bankRefHash:'b'.repeat(64),evidence:await f.evidence()});assert(p2.id);
  assert.equal((await f.write('admin','confirm-correction',{correctionId:corr.id},reviewer)).error,'OP14_CASE_OPEN');
  assert((await f.opwrite('review-reproof',{proofId:p2.id,approved:true},reviewer)).id);
  assert((await f.write('admin','confirm-correction',{correctionId:corr.id},reviewer)).id);assert.equal((await f.call('reader','state')).balance,0);
 }finally{await f.db.close();}
});
test('OP14 exceptions hold confirmation until independently resolved; mismatch stays uncredited',async()=>{
 const f=await setup();try{
  const d=await f.deposit();assert(d.record.id,JSON.stringify(d));
  const hold=await f.opwrite('case-open',{kind:'DEPOSIT',targetId:d.record.id,reasonRef:'wrong-order-review'});assert(hold.id,JSON.stringify(hold));
  assert.equal((await f.write('admin','confirm',{depositId:d.record.id},reviewer)).error,'OP14_CASE_OPEN');
  assert.equal((await f.opwrite('case-resolve',{caseId:hold.id,reasonRef:'bank-checked'})).error,'INDEPENDENT_REVIEW_REQUIRED');
  assert((await f.opwrite('case-resolve',{caseId:hold.id,reasonRef:'bank-checked'},reviewer)).id);
  assert((await f.write('admin','confirm',{depositId:d.record.id},reviewer)).id);
  const mismatch=await f.deposit(9000);const rows=await f.ops('exceptions',{query:'',filter:'MISMATCH',offset:0,destinationHash:'e'.repeat(64)});assert.equal(rows.items[0].id,mismatch.record.id);assert(rows.items[0].reasons.includes('OLD_INSTRUCTIONS'));
  const stale=await f.ops('exceptions',{query:'',filter:'OLD_INSTRUCTIONS',offset:0,destinationHash:'e'.repeat(64)});assert.equal(stale.staleOrders.length,1);assert.equal(stale.staleOrders[0].id,mismatch.order.id);
  assert.equal((await f.write('admin','confirm',{depositId:mismatch.record.id},reviewer)).error,'AMOUNT_MISMATCH');
  assert.equal((await f.call('reader','state')).balance,10000);
 }finally{await f.db.close();}
});
test('OP14 replacement proof preserves original evidence and dedupe, requires independent approval',async()=>{
 const f=await setup();try{
  const d=await f.deposit(),proof=await f.evidence();
  const data={kind:'DEPOSIT',targetId:d.record.id,reasonRef:'clearer-bank-copy',bankRefHash:d.bankRefHash,evidence:proof};
  assert.equal((await f.opwrite('reproof',{...data,bankRefHash:'f'.repeat(64)})).error,'OP14_EVIDENCE_MISMATCH');
  const p=await f.opwrite('reproof',data);assert(p.id,JSON.stringify(p));
  assert.equal((await f.write('admin','confirm',{depositId:d.record.id},reviewer)).error,'OP14_CASE_OPEN');
  assert.equal((await f.opwrite('review-reproof',{proofId:p.id,approved:true})).error,'INDEPENDENT_REVIEW_REQUIRED');
  assert((await f.opwrite('review-reproof',{proofId:p.id,approved:true},reviewer)).id);
  const context=await f.ops('proof-context',{kind:'DEPOSIT',targetId:d.record.id});assert.equal(context.documentId,proof.id);
  assert.equal((await f.db.query('select document_id from live_commerce.deposits where id=$1',[d.record.id])).rows[0].document_id,d.evidence.id);
  assert((await f.write('admin','confirm',{depositId:d.record.id},reviewer)).id);
  assert.equal((await f.opwrite('reproof',data)).error,'OP14_TARGET_NOT_READY');
 }finally{await f.db.close();}
});
test('OP14 monthly snapshots use KST, immutable membership, independent approval, and revision chain',async()=>{
 const f=await setup();try{
  const month='2020-01',preview=await f.ops('month-preview',{month});assert.equal(preview.snapshot.timezone,'Asia/Seoul');assert.equal(preview.snapshot.events.length,0);
  const draft=await f.opwrite('month-draft',{month,expectedDigest:preview.digest,previousId:null,reasonRef:'synthetic-close'});assert(draft.id,JSON.stringify(draft));
  assert.equal((await f.opwrite('month-approve',{reportId:draft.id,expectedDigest:preview.digest})).error,'INDEPENDENT_REVIEW_REQUIRED');
  assert((await f.opwrite('month-approve',{reportId:draft.id,expectedDigest:preview.digest},reviewer)).id);
  const frozen=await f.ops('month-detail',{reportId:draft.id});assert(frozen.approved);
  const orderId=crypto.randomUUID();await f.db.query("insert into live_commerce.orders(id,user_id,destination_hash,created_at) values($1,$2,repeat('d',64),'2019-12-31T14:00:00Z')",[orderId,reader]);
  const proof=await f.evidence();await f.db.query("select live_commerce.save_evidence($1,'BANK_DEPOSIT',$2)",[operator,JSON.stringify(proof)]);
  const depositId=crypto.randomUUID();await f.db.query("insert into live_commerce.deposits values($1,$2,repeat('a',64),10000,$3,$4,'2019-12-31T15:00:00Z','2019-12-31T15:00:00Z')",[depositId,orderId,proof.id,operator]);
  const next=await f.ops('month-preview',{month});assert.equal(next.snapshot.events.length,1);assert.equal(next.snapshot.totals[0].amount,'10000');assert.equal(next.previousId,draft.id);assert.deepEqual(await f.ops('month-detail',{reportId:draft.id}),frozen);
  const hold=await f.opwrite('case-open',{kind:'DEPOSIT',targetId:depositId,reasonRef:'late-entry-review'});assert(hold.id);
  const held=await f.ops('month-preview',{month});assert.equal(held.snapshot.reviewIssues.length,1);
  const blocked=await f.opwrite('month-draft',{month,expectedDigest:held.digest,previousId:draft.id,reasonRef:'late-entry-adjustment'});assert(blocked.id);
  assert.equal((await f.opwrite('month-approve',{reportId:blocked.id,expectedDigest:held.digest},reviewer)).error,'OP14_CASE_OPEN');
  assert((await f.opwrite('case-resolve',{caseId:hold.id,reasonRef:'checked-late-entry'},reviewer)).id);
  assert.equal((await f.opwrite('month-approve',{reportId:blocked.id,expectedDigest:held.digest},reviewer)).error,'OP14_REPORT_CHANGED');
  const final=await f.ops('month-preview',{month}),revision=await f.opwrite('month-draft',{month,expectedDigest:final.digest,previousId:draft.id,reasonRef:'reviewed-adjustment'});assert(revision.id);
  assert((await f.opwrite('month-approve',{reportId:revision.id,expectedDigest:final.digest},reviewer)).id);
  await assert.rejects(f.db.exec('delete from live_commerce.monthly_reports'),/immutable/);
 }finally{await f.db.close();}
});
test('OP14 service-only ACL and revoked actor cannot replay',async()=>{
 const f=await setup();try{
  assert.equal((await f.ops('operations-readiness')).activeSuperAdmins,3);
  for(const role of ['anon','authenticated','service_role']){await f.db.exec('set role '+role);await assert.rejects(f.db.exec('select * from live_commerce.monthly_reports'),e=>e.code==='42501');if(role!=='service_role')await assert.rejects(f.ops('operations-readiness'),e=>e.code==='42501');else assert((await f.ops('operations-readiness')).activeSuperAdmins);await f.db.exec('reset role');}
  const d=await f.deposit(),data={requestId:crypto.randomUUID(),kind:'DEPOSIT',targetId:d.record.id,reasonRef:'synthetic-hold'};assert((await f.ops('case-open',data)).id);
  await f.db.query('update public.admin_users set is_active=false where auth_user_id=$1',[operator]);assert.equal((await f.ops('case-open',data)).error,'ACCOUNT_INACTIVE');
 }finally{await f.db.close();}
});
