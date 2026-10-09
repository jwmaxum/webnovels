import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {setup,sql,admin,reader,limited,otherReader} from './fixtures/stage20-db.mjs';
let f,db;
before(async()=>{f=await setup();db=f.db;});after(async()=>db?.close());
beforeEach(async()=>db.exec('delete from commerce.attempts'));
const count=async(table,id)=>(await db.query('select count(*) n from commerce.'+table+' where order_id=$1',[id])).rows[0].n;
test('repeatable additive migration keeps legacy bodies/rights, no LIVE policies or browser grants',async()=>{
 const before=(await db.query('select count(*) n from secure_episode_contents')).rows[0].n;
 await db.exec(sql);assert.equal((await db.query('select count(*) n from secure_episode_contents')).rows[0].n,before);
 assert.equal((await db.query('select count(*) n from p0_episode_entitlements')).rows[0].n,0);
 await assert.rejects(db.query("insert into commerce.policies(version,mode,provenance,merchant_id,fee_bps,author_bps,terms) values('live-v1','LIVE','PROVIDER_TEST','mid',0,0,'no live policy allowed')"));
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);await assert.rejects(db.query('select * from commerce.orders'));
  if(role!=='service_role')await assert.rejects(f.call('list'));
  else assert.equal((await f.call('list')).mode,'TEST');await db.exec('reset role');
 }
});
test('quotes show price/terms/period, reject stale price, client owner and hidden/adult/paid-free mismatch',async()=>{
 const {episode,w}=await f.offer({kind:'RENT',hours:24});const q=(await f.quote(episode)).quote;
 assert.equal(q.currency,'KRW');assert.equal(q.durationHours,24);assert.equal(q.liveContentAccess,false);assert.match(q.terms,/합성/);
 assert.equal((await f.create(episode,{expectedAmountKrw:1})).error,'QUOTE_CHANGED');
 assert.equal((await f.create(episode,{authorId:'2'})).error,'INVALID_FIELD');
 const stale=await f.create(episode,{expectedAmountKrw:1});await db.query('update commerce.offers set duration_hours=1 where episode_id=$1',[episode]);
 assert.equal((await f.call('create',{...stale.data,expectedAmountKrw:q.amountKrw})).error,'QUOTE_CHANGED');
 assert.notEqual((await f.quote(episode)).quote.offerVersion,q.offerVersion);
 for(const statement of ["update works set rating='AGE_19' where id=$1","update works set rating='ALL',status='DRAFT' where id=$1",
  "update works set status='PUBLISHED',genre=array['성인'] where id=$1"]){await db.query(statement,[w]);assert.equal((await f.quote(episode)).error,'OFFER_NOT_FOUND');}
 await db.query("update works set genre=array['판타지'] where id=$1",[w]);await db.query('update episodes set is_free=true where id=$1',[episode]);assert.equal((await f.quote(episode)).error,'OFFER_NOT_FOUND');
});
test('purchase idempotency and different requests prevent duplicate active purchases',async()=>{
 const {episode}=await f.offer(),first=await f.create(episode);
 assert.equal((await f.call('create',first.data)).order.id,first.order.id);
 assert.equal((await f.call('create',{...first.data,expectedAmountKrw:102})).error,'IDEMPOTENCY_CONFLICT');
 const results=await Promise.all([f.create(episode),f.create(episode)]);assert.ok(results.every(x=>x.error==='PURCHASE_PENDING'));
 assert.equal((await db.query('select count(*) n from commerce.orders where episode_id=$1',[episode])).rows[0].n,1);
 assert.equal((await f.call('get',{orderId:first.order.id},limited)).error,'READER_REQUIRED');
 assert.equal((await f.call('get',{orderId:first.order.id},otherReader)).error,'ORDER_NOT_FOUND');
 assert.equal((await f.call('list',{},otherReader)).orders.length,0);
 assert.equal((await f.claim(first.order.id,'claim-confirm',{paymentKey:'other'},otherReader)).error,'ORDER_NOT_FOUND');
});
test('unstarted orders expire without provider evidence and permit a fresh reservation',async()=>{
 const c=await f.create((await f.offer()).episode);
 await db.query("update commerce.orders set created_at=now()-interval '31 minutes' where id=$1",[c.order.id]);
 assert.equal((await f.claim(c.order.id)).error,'ORDER_EXPIRED');assert.equal(await count('ledger',c.order.id),0);
 const again=await f.create(c.order.episodeId);assert.ok(again.order);
 await db.query("update commerce.orders set created_at=now()-interval '31 minutes' where id=$1",[again.order.id]);
 assert.ok((await f.create(c.order.episodeId)).order);
 assert.equal((await f.call('get',{orderId:again.order.id})).order.status,'FAILED');
});
test('verified approval atomically records exact rounded allocation and one TEST entitlement',async()=>{
 const p=await f.paid();assert.equal(await count('ledger',p.order.id),1);assert.equal(await count('entitlements',p.order.id),1);
 const l=(await db.query('select * from commerce.ledger where order_id=$1',[p.order.id])).rows[0];
 assert.deepEqual([l.gross_krw,l.fee_krw,l.author_krw,l.platform_krw],[101,3,68,30]);
 assert.equal((await f.claim(p.order.id,'claim-confirm',{paymentKey:p.t.payment_key})).order.status,'PAID');
 assert.equal((await f.create(p.episode)).error,'ALREADY_PURCHASED');
 assert.equal((await f.apply(p.t,p.proof)).error,'PAYMENT_LEASE_STALE');
 for(const t of ['ledger','events','policies'])await assert.rejects(db.exec('delete from commerce.'+t),/immutable/);
 const a=await f.call('earnings',{},admin),b=await f.call('earnings',{},reader);
 assert.ok(a.confirmedTestKrw>=68);assert.equal(b.confirmedTestKrw,0);assert.equal(a.payableKrw,0);assert.equal(a.paidKrw,0);
 assert.equal(b.entries.length,0);assert.ok(a.entries.some(e=>e.orderId===p.order.id&&e.authorKrw===68));
 assert.ok(!JSON.stringify(a).includes(p.t.payment_key));
 assert.equal(a.orders[0].liveContentAccess,false);assert.equal((await db.query('select count(*) n from p0_episode_entitlements')).rows[0].n,0);
});
test('payment keys are globally unique in a merchant, identities and finance permissions rechecked',async()=>{
 const a=await f.paid(),b=await f.create((await f.offer()).episode);
 assert.equal((await f.claim(b.order.id,'claim-confirm',{paymentKey:a.t.payment_key})).error,'PAYMENT_KEY_CONFLICT');
 assert.equal((await f.call('review',{},reader)).error,'FINANCE_PERMISSION_REQUIRED');
 assert.equal((await f.claim(a.order.id,'claim-refund',{reason:'전액 취소'},reader)).error,'FINANCE_PERMISSION_REQUIRED');
 await db.query('update readers set status=$1 where auth_user_id=$2',['SUSPENDED',reader]);
 assert.equal((await f.call('get',{orderId:a.order.id})).error,'READER_REQUIRED');await db.query("update readers set status='ACTIVE' where auth_user_id=$1",[reader]);
});
test('unknown approval preserves pending purchase; only a server requery can recover it',async()=>{
 const c=await f.create((await f.offer()).episode),r=await f.claim(c.order.id);
 assert.equal((await f.claim(c.order.id,'claim-query')).error,'PAYMENT_PROCESSING');
 assert.equal((await f.apply(r.transport,{state:'UNKNOWN'})).order.status,'UNKNOWN');assert.equal(await count('ledger',c.order.id),0);
 assert.equal((await f.claim(c.order.id,'claim-confirm',{paymentKey:r.transport.payment_key})).error,'RECONCILIATION_REQUIRED');
 const query=await f.claim(c.order.id,'claim-query');assert.equal(query.transport.operation,'query');
 assert.equal((await f.apply(query.transport,f.receipt(query.transport))).order.status,'PAID');assert.equal(await count('ledger',c.order.id),1);
});
test('a provider transaction reference cannot credit two orders even with different payment keys',async()=>{
 const p=await f.paid(),c=await f.create((await f.offer()).episode),r=await f.claim(c.order.id);
 const forged={...f.receipt(r.transport),transactionKey:p.proof.transactionKey};
 assert.equal((await f.apply(r.transport,forged)).error,'INVALID_RECEIPT');
 assert.equal(await count('ledger',c.order.id),0);assert.equal(await count('entitlements',c.order.id),0);
 assert.equal((await f.call('get',{orderId:c.order.id})).order.status,'APPROVING');
});
test('receipt mismatch and expired worker cannot finalize or overwrite a newer observation',async()=>{
 const c=await f.create((await f.offer()).episode),r=await f.claim(c.order.id);
 for(const changes of [{amountKrw:1},{mode:'LIVE'},{merchantId:'wrong'},{currency:'USD'},{paymentKey:'wrong'},{approvedAt:'infinity'}])
  assert.equal((await f.apply(r.transport,{...f.receipt(r.transport),...changes})).error,'INVALID_RECEIPT');
 assert.equal(await count('ledger',c.order.id),0);await db.query("update commerce.orders set lease_until=now()-interval '1 second' where id=$1",[c.order.id]);
 const q=await f.claim(c.order.id,'claim-query');assert.equal((await f.apply(r.transport,f.receipt(r.transport))).error,'PAYMENT_LEASE_STALE');
 assert.equal((await f.apply(q.transport,f.receipt(q.transport))).order.status,'PAID');
});
test('DB finalization failure rolls back ledger and rights, then a new query repairs the same order',async()=>{
 const c=await f.create((await f.offer()).episode),r=await f.claim(c.order.id);
 await db.exec("create function commerce.fail_fixture() returns trigger language plpgsql as $$ begin raise exception 'simulated DB failure'; end $$; create trigger fail_fixture before insert on commerce.entitlements for each row execute function commerce.fail_fixture()");
 await assert.rejects(f.apply(r.transport,f.receipt(r.transport)),/simulated DB failure/);
 assert.equal(await count('ledger',c.order.id),0);assert.equal(await count('entitlements',c.order.id),0);
 assert.equal((await f.call('get',{orderId:c.order.id})).order.status,'APPROVING');
 await db.exec('drop trigger fail_fixture on commerce.entitlements; drop function commerce.fail_fixture()');
 await db.query("update commerce.orders set lease_until=now()-interval '1 second' where id=$1",[c.order.id]);const q=await f.claim(c.order.id,'claim-query');
 assert.equal((await f.apply(q.transport,f.receipt(q.transport))).order.status,'PAID');
});
test('unknown refund retains rights; verified cancellation reverses the original exact amounts once',async()=>{
 const p=await f.paid(),r=await f.claim(p.order.id,'claim-refund',{reason:'독자 전액 환불 요청'},admin);
 assert.equal((await f.apply(r.transport,{state:'UNKNOWN'})).order.status,'REFUND_UNKNOWN');
 assert.equal((await f.call('get',{orderId:p.order.id})).order.sandboxEntitled,true);
 const q=await f.claim(p.order.id,'admin-query',{},admin);
 const proof={...f.receipt(q.transport,'CANCELLED'),approvedAt:p.proof.approvedAt};
 assert.equal((await f.apply(q.transport,proof)).order.status,'REFUNDED');assert.equal(await count('ledger',p.order.id),2);
 const net=(await db.query('select sum(gross_krw) g,sum(author_krw) a from commerce.ledger where order_id=$1',[p.order.id])).rows[0];assert.deepEqual(net,{g:0,a:0});
 assert.equal((await f.call('get',{orderId:p.order.id})).order.sandboxEntitled,false);
 const audit=await f.call('audit',{orderId:p.order.id},admin);assert.equal(audit.entries.length,2);assert.ok(audit.entries.some(e=>e.originalId!==null));
 assert.equal((await f.claim(p.order.id,'admin-query',{},admin)).order.status,'REFUNDED');
 assert.equal((await f.apply(q.transport,{...proof,state:'APPROVED'})).error,'PAYMENT_LEASE_STALE');
});
test('refund before local approval is reconciled to zero; repurchase gets independent preserved history',async()=>{
 const c=await f.create((await f.offer()).episode),r=await f.claim(c.order.id);
 await f.apply(r.transport,{state:'UNKNOWN'});const q=await f.claim(c.order.id,'claim-query');
 assert.equal((await f.apply(q.transport,f.receipt(q.transport,'CANCELLED'))).order.status,'REFUNDED');
 assert.equal(await count('ledger',c.order.id),2);const again=await f.create(c.order.episodeId);assert.ok(again.order);
 const next=await f.claim(again.order.id);assert.equal((await f.apply(next.transport,f.receipt(next.transport))).order.status,'PAID');
 assert.equal((await f.call('get',{orderId:c.order.id})).order.sandboxEntitled,false);
 assert.equal((await f.call('get',{orderId:again.order.id})).order.sandboxEntitled,true);
});
test('rental deadline is based on approval; expiry allows another order without deleting the old grant',async()=>{
 const p=await f.paid({kind:'RENT',hours:24}),row=(await db.query('select * from commerce.entitlements where order_id=$1',[p.order.id])).rows[0];
 assert.equal(Date.parse(row.expires_at)-Date.parse(row.granted_at),24*3600000);
 await db.query("update commerce.entitlements set granted_at=now()-interval '2 days',expires_at=now()-interval '1 day' where order_id=$1",[p.order.id]);
 assert.equal((await f.call('get',{orderId:p.order.id})).order.sandboxEntitled,false);
 assert.ok((await f.create(p.episode)).order);assert.equal(await count('entitlements',p.order.id),1);
});
test('verified not-paid and partial/unsupported states never grant an entitlement; durable provider limit',async()=>{
 const c=await f.create((await f.offer()).episode),r=await f.claim(c.order.id);
 assert.equal((await f.apply(r.transport,{...f.receipt(r.transport),state:'NOT_PAID'})).order.status,'FAILED');assert.equal(await count('ledger',c.order.id),0);
 const p=await f.paid(),q=await f.claim(p.order.id,'claim-query');assert.equal((await f.apply(q.transport,{...f.receipt(q.transport),state:'REVIEW'})).order.status,'REVIEW');
 for(let i=0;i<10;i++){const query=await f.claim(p.order.id,'admin-query',{},admin);await f.apply(query.transport,{state:'UNKNOWN'});}
 assert.equal((await f.claim(p.order.id,'admin-query',{},admin)).error,'RATE_LIMITED');
 assert.equal((await f.call('audit',{orderId:p.order.id},admin)).events[0].action,'CREATE');
});
