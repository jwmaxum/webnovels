import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup,admin,operator,reviewer,reader} from './fixtures/op15-db.mjs';
import {setup as prior} from './fixtures/op14-db.mjs';
import {projectOperation} from '../server/live-commerce-operations.mjs';
const hash='d'.repeat(64),month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date());
const propose=(f,orderId,sources,kind='CREDIT')=>f.awrite('funding-propose',{kind,orderId,sources,reasonRef:'synthetic-bank-review',destinationHash:hash,reassignmentConfirmed:true});
const approve=(f,planId,approved=true)=>f.awrite('funding-review',{planId,approved,destinationHash:hash},reviewer);
async function buy(f,work=f.novel,index=2){await f.policy(work.id);const q=await f.call('reader','quote',{episodeId:work.episodes[index].id});const p=await f.write('reader','purchase',{quoteId:q.id});assert(p.id,JSON.stringify(p));return p;}
test('OP15 combines partial sources once, reserves before approval, rejects direct confirmation and retains provenance',async()=>{
 const f=await setup();try{
  const a=await f.deposit(6000),b=await f.deposit(4000),p=await propose(f,a.order.id,[{depositId:a.record.id,amount:6000},{depositId:b.record.id,amount:4000}]);assert(p.id,JSON.stringify(p));
  assert.equal((await f.call('reader','state')).balance,0);
  assert((await f.ops('month-preview',{month})).snapshot.reviewIssues.some(x=>x.kind==='FUNDING'&&x.id===p.id));
  assert.equal((await propose(f,b.order.id,[{depositId:a.record.id,amount:6000},{depositId:b.record.id,amount:4000}])).error,'OP15_SOURCE_RESERVED');
  assert.equal((await f.awrite('funding-review',{planId:p.id,approved:true,destinationHash:hash})).error,'INDEPENDENT_REVIEW_REQUIRED');
  assert((await approve(f,p.id)).id);assert.equal((await f.call('reader','state')).balance,10000);assert.equal((await approve(f,p.id)).error,'OP15_PLAN_CHANGED');
  assert.equal((await f.ops('exceptions',{query:'',filter:'ALL',offset:0,destinationHash:hash})).items.length,0);
  assert.equal((await f.db.query('select count(*) n from live_commerce.deposits')).rows[0].n,2);
  const preview=await f.ops('month-preview',{month});projectOperation(preview,'month-preview');assert.equal(preview.snapshot.events.find(e=>e.type==='POINTS_CREDITED').data.fundingSources.length,2);
  const normal=await f.deposit(),pending=await propose(f,normal.order.id,[{depositId:normal.record.id,amount:10000}]);assert(pending.id);
  assert.equal((await f.write('admin','confirm',{depositId:normal.record.id},reviewer)).error,'OP15_SOURCE_RESERVED');
  assert((await approve(f,pending.id,false)).id);assert((await f.write('admin','confirm',{depositId:normal.record.id},reviewer)).id);
 }finally{await f.db.close();}
});
test('OP15 overpayment returns reserve residual funds, require approval and independent external evidence',async()=>{
 const f=await setup();try{
  const a=await f.deposit(12000),credit=await propose(f,a.order.id,[{depositId:a.record.id,amount:10000}]);assert((await approve(f,credit.id)).id);
  const p=await propose(f,a.order.id,[{depositId:a.record.id,amount:2000}],'RETURN');assert(p.id);
  assert.equal((await f.allocate('funding-list')).deposits.length,0);
  const req={planId:p.id,amount:2000,occurredAt:new Date().toISOString(),bankRefHash:'f'.repeat(64),evidence:await f.evidence()};
  assert.equal((await f.awrite('funding-return',req,admin)).error,'OP15_PLAN_CHANGED');assert((await approve(f,p.id)).id);
  assert.equal((await f.awrite('funding-return',{...req,occurredAt:new Date().toISOString()},reviewer)).error,'OP15_PLAN_CHANGED');
  const returned=await f.awrite('funding-return',{...req,occurredAt:new Date().toISOString()},admin);assert(returned.id,JSON.stringify(returned));
  assert.equal((await f.call('reader','state')).balance,10000);assert.equal((await f.allocate('funding-list')).plans.find(x=>x.id===p.id).status,'RETURNED');
  const order=await f.write('reader','order',{destinationHash:hash});assert.equal((await f.write('admin','deposit',{orderId:order.id,destinationHash:hash,amount:10000,bankRefHash:req.bankRefHash,occurredAt:new Date().toISOString(),evidence:await f.evidence()})).error,'COMMERCE_CONFLICT');
  const preview=await f.ops('month-preview',{month});projectOperation(preview,'month-preview');assert.equal(preview.snapshot.events.filter(e=>e.type==='BANK_RETURNED').length,1);
 }finally{await f.db.close();}
});
test('OP15 reassign requires explicit review; stale instructions, changed proof and pending cases block approval',async()=>{
 const f=await setup();try{
  const a=await f.deposit(),o=await f.write('reader','order',{destinationHash:hash}),payload={kind:'CREDIT',orderId:o.id,sources:[{depositId:a.record.id,amount:10000}],reasonRef:'wrong-order',destinationHash:hash,reassignmentConfirmed:false};
  assert.equal((await f.awrite('funding-propose',payload)).error,'OP15_REASSIGNMENT_REQUIRED');
  assert.equal((await f.awrite('funding-propose',{...payload,reassignmentConfirmed:true,destinationHash:'a'.repeat(64)})).error,'ORDER_NOT_READY');
  const p=await f.awrite('funding-propose',{...payload,reassignmentConfirmed:true});assert(p.id);
  const c=await f.opwrite('case-open',{kind:'DEPOSIT',targetId:a.record.id,reasonRef:'verify-source'});assert(c.id);
  assert.equal((await approve(f,p.id)).error,'DOCUMENT_UNAVAILABLE');assert((await approve(f,p.id,false)).id);
  assert.equal((await f.allocate('funding-list')).deposits[0].available,'10000');
 }finally{await f.db.close();}
});
test('OP15 payout reservations release on cancellation, stay consumed when paid, and recover revoked paid earnings',async()=>{
 const f=await setup();try{
  const first=await f.fund();await buy(f);await f.bank();let state=await f.call('author','state');let p=await f.write('author','request',{binding:state.binding});assert(p.id);
  let sources=await f.allocate('payout-sources',{payoutId:p.id});assert.equal(sources.sources.reduce((s,x)=>s+x.amount,0),70);
  assert((await f.write('admin','cancel',{payoutId:p.id,notTransferredConfirmed:true,reasonRef:'no-transfer'},reviewer)).id);
  p=await f.write('author','request',{binding:state.binding});assert(p.id);assert((await f.write('admin','approve',{payoutId:p.id,deduction:0,basisRef:'synthetic'},reviewer)).id);
  assert((await f.write('admin','complete',{payoutId:p.id,net:70,bankRefHash:'f'.repeat(64),occurredAt:new Date().toISOString(),evidence:await f.evidence()})).id);
  const correction=await f.write('admin','correction',{lotId:first.confirmed.id,kind:'BANK_REVERSAL',amount:10000,bankRefHash:'a'.repeat(64),evidence:await f.evidence()});assert(correction.id);
  assert((await f.write('admin','confirm-correction',{correctionId:correction.id},reviewer)).id);assert.equal((await f.call('author','state')).available,-70);
  const second=await f.fund();await f.write('admin','policy',{workId:f.novel.id,price:300,shareBps:7000,contractRef:'synthetic-new-price',expectedPolicyId:(await f.call('admin','list',{query:'',offset:0})).works.find(w=>w.id===f.novel.id).policyId});
  const q=await f.call('reader','quote',{episodeId:f.novel.episodes[2].id});assert((await f.write('reader','purchase',{quoteId:q.id})).id);
  state=await f.call('author','state');assert.equal(state.available,140);const next=await f.write('author','request',{binding:state.binding});assert(next.id,JSON.stringify(next));
  sources=await f.allocate('payout-sources',{payoutId:next.id});assert.equal(sources.sources[0].amount,140);assert.equal(sources.recoveries[0].amount,70);assert.equal(sources.recoveries[0].debtPayoutId,p.id);
  assert((await f.write('admin','approve',{payoutId:next.id,deduction:0,basisRef:'synthetic'},reviewer)).id);assert((await f.write('admin','complete',{payoutId:next.id,net:140,bankRefHash:'e'.repeat(64),occurredAt:new Date().toISOString(),evidence:await f.evidence()})).id);
  const again=await f.write('admin','correction',{lotId:second.confirmed.id,kind:'BANK_REVERSAL',amount:10000,bankRefHash:'b'.repeat(64),evidence:await f.evidence()});assert((await f.write('admin','confirm-correction',{correctionId:again.id},reviewer)).id);assert.equal((await f.call('author','state')).available,-210);
  await f.fund();assert((await f.write('admin','policy',{workId:f.novel.id,price:500,shareBps:7000,contractRef:'synthetic-third-price',expectedPolicyId:(await f.call('admin','list',{query:'',offset:0})).works.find(w=>w.id===f.novel.id).policyId})).id);
  const quote=await f.call('reader','quote',{episodeId:f.novel.episodes[2].id});assert((await f.write('reader','purchase',{quoteId:quote.id})).id);const third=await f.write('author','request',{binding:state.binding});assert(third.id,JSON.stringify(third));
  const recovered=await f.allocate('payout-sources',{payoutId:third.id});assert.equal(recovered.recoveries.reduce((n,x)=>n+x.amount,0),210);assert.equal(recovered.sources.reduce((n,x)=>n+x.amount,0),140);
 }finally{await f.db.close();}
});
test('OP15 refuses payout from revoked reserved sources and preserves legacy rows without inferred allocations',async()=>{
 const f=await prior();try{
  await f.fund();await buy(f);await f.bank();const st=await f.call('author','state'),p=await f.write('author','request',{binding:st.binding});assert(p.id);
  const before=(await f.db.query('select * from live_commerce.payouts')).rows;
  const preview=await f.ops('month-preview',{month:'2020-01'}),report=await f.opwrite('month-draft',{month:'2020-01',expectedDigest:preview.digest,previousId:null,reasonRef:'synthetic-close'});assert((await f.opwrite('month-approve',{reportId:report.id,expectedDigest:preview.digest},reviewer)).id);const frozen=await f.ops('month-detail',{reportId:report.id});
  await f.db.exec("set webnovels.commerce_allocations_apply_verified='true'");await f.db.exec(await readFile(new URL('../database/launch/028_commerce_allocations.sql',import.meta.url),'utf8'));
  assert.deepEqual((await f.db.query('select * from live_commerce.payouts')).rows,before);
  assert.deepEqual(await f.ops('month-detail',{reportId:report.id}),frozen);
  assert.equal((await f.write('admin','approve',{payoutId:p.id,deduction:0,basisRef:'synthetic'},reviewer)).error,'OP15_LEGACY_RECONCILIATION_REQUIRED');
 }finally{await f.db.close();}
});
test('OP15 rejects revoked reservations even after new earnings offset the overall balance',async()=>{
 const f=await setup();try{
  const funding=await f.fund();await buy(f);await f.bank();const state=await f.call('author','state'),p=await f.write('author','request',{binding:state.binding});assert(p.id);
  const correction=await f.write('admin','correction',{lotId:funding.confirmed.id,kind:'BANK_REVERSAL',amount:10000,bankRefHash:'a'.repeat(64),evidence:await f.evidence()});assert((await f.write('admin','confirm-correction',{correctionId:correction.id},reviewer)).id);
  await f.fund();const q=await f.call('reader','quote',{episodeId:f.novel.episodes[2].id});assert((await f.write('reader','purchase',{quoteId:q.id})).id);
  assert.equal((await f.call('author','state')).available,0);assert.equal((await f.write('admin','approve',{payoutId:p.id,deduction:0,basisRef:'synthetic'},reviewer)).error,'OP15_REVOKED_SOURCE');
  assert((await f.write('admin','cancel',{payoutId:p.id,notTransferredConfirmed:true,reasonRef:'revoked-reservation'},reviewer)).id);assert((await f.write('author','request',{binding:state.binding})).id);
 }finally{await f.db.close();}
});
test('OP15 rejected and malformed plans do not reserve money; current authorization precedes idempotent replay',async()=>{
 const f=await setup();try{
  const d=await f.deposit(),requestId=crypto.randomUUID(),payload={kind:'CREDIT',orderId:d.order.id,sources:[{depositId:d.record.id,amount:10000}],reasonRef:'synthetic',destinationHash:hash,reassignmentConfirmed:false,requestId};
  const duplicate=await f.awrite('funding-propose',{...payload,requestId:crypto.randomUUID(),sources:[{depositId:d.record.id,amount:5000},{depositId:d.record.id,amount:5000}]});assert.equal(duplicate.error,'COMMERCE_CONFLICT');assert.equal((await f.allocate('funding-list')).plans.length,0);
  assert((await f.awrite('funding-propose',payload)).id);assert((await f.awrite('funding-propose',payload)).replayed);
  assert.equal((await f.awrite('funding-propose',{...payload,reasonRef:'changed'})).error,'IDEMPOTENCY_CONFLICT');
  await f.db.query('update public.admin_users set is_active=false where auth_user_id=$1',[operator]);const replay=await f.awrite('funding-propose',payload);assert(replay.error);assert(!replay.replayed);
 }finally{await f.db.close();}
});
test('OP15 notification journal dedupes financial replay; TEST retry never marks external delivery',async()=>{
 const f=await setup();try{
  const d=await f.deposit(),req={depositId:d.record.id,requestId:crypto.randomUUID()};await f.write('admin','confirm',req,reviewer);assert((await f.write('admin','confirm',req,reviewer)).replayed);
  let queue=await f.allocate('notification-list');assert.equal(queue.items.length,1);assert.equal(queue.deliveryEnabled,false);assert.equal(queue.items[0].attempt,0);
  const id=queue.items[0].id;assert((await f.awrite('notification-test',{notificationId:id,expectedAttempt:0,outcome:'TEST_RETRY'})).id);
  assert.equal((await f.awrite('notification-test',{notificationId:id,expectedAttempt:0,outcome:'TEST_READY'})).error,'OP15_PLAN_CHANGED');
  assert((await f.awrite('notification-test',{notificationId:id,expectedAttempt:1,outcome:'TEST_READY'})).id);
  queue=await f.allocate('notification-list');assert.equal(queue.items[0].outcome,'TEST_READY');assert.equal(queue.deliveryEnabled,false);
  assert.equal((await f.awrite('notification-test',{notificationId:id,expectedAttempt:2,outcome:'TEST_RETRY'})).error,'OP15_PLAN_CHANGED');
  await f.db.exec('set role authenticated');await assert.rejects(f.allocate('notification-list'),/permission denied/);await f.db.exec('reset role;set role service_role');await assert.rejects(f.db.exec('select * from live_commerce.funding_sources'),/permission denied/);assert.equal((await f.allocate('notification-list',{},reader)).error,'ADMIN_FORBIDDEN');
 }finally{await f.db.close();}
});
