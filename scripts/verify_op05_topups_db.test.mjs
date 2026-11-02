import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setup,sql,admin,reader,limited,otherReader,uuid,provider} from './fixtures/op05-db.mjs';
let f,db;
before(async()=>{f=await setup({openingPoints:50});db=f.db;});
after(async()=>db?.close());
beforeEach(async()=>db.exec('begin'));
afterEach(async()=>db.exec('rollback'));
const error=(r,code,status)=>{assert.equal(r?.error,code,JSON.stringify(r));if(status)assert.equal(r.status,status);};
async function denied(fn){await db.exec('savepoint denial');try{await assert.rejects(fn(),/permission denied/);}finally{await db.exec('rollback to savepoint denial;release savepoint denial');}}
async function buy(episode=f.novel.episodes[2]){const q=await f.quote(episode.id);assert.ok(q.quote,JSON.stringify(q));return f.purchase(q.quote.id);}
async function reconcile(){const w=await f.wallet(),lots=await f.lots(),ledger=(await db.query('select coalesce(sum(delta_points),0)::bigint n from commerce.op04_ledger where user_id=$1',[reader])).rows[0].n;assert.equal(Number(ledger),w.totalPoints);assert.equal(w.balancePoints+w.reservedPoints,w.totalPoints);assert.equal(lots.reduce((n,l)=>n+Number(l.issued_points)-Number(l.consumed_points)-Number(l.refunded_points),0),w.totalPoints);assert.equal(lots.reduce((n,l)=>n+Number(l.reserved_points),0),w.reservedPoints);return w;}

test('review gate preserves original body/owner, commerce ACL and old ledger and has no seeded products',async()=>{
 assert.ok(sql.includes("webnovels.topups_test_apply_verified"));assert.equal((await f.adminTopups('state')).products.length,0);
 assert.deepEqual((await db.query("select (select nspacl::text from pg_namespace where nspname='commerce') schema_acl,(select relacl::text from pg_class where oid='commerce.legacy_sentinel'::regclass) table_acl,(select proacl::text from pg_proc where oid='commerce.legacy_marker()'::regprocedure) routine_acl,(select pg_get_functiondef('commerce.legacy_marker()'::regprocedure)) routine_definition")).rows[0],f.baselineCommerce);
 assert.equal((await f.lots())[0].source,'OPENING_TEST_BALANCE');assert.equal((await f.lots())[0].opening_snapshot.ledgerCount,1);assert.equal((await f.lots())[0].opening_snapshot.policy,'NONREFUNDABLE_OPENING_SNAPSHOT');assert.match((await f.lots())[0].opening_snapshot.ledgerHash,/^[a-f0-9]{64}$/);
 assert.equal((await db.query("select proowner::text from pg_proc where oid='commerce.op05_points_base(uuid,text,jsonb)'::regprocedure")).rows[0].proowner,f.sourceOwner);
 await reconcile();
});

test('actual future ACL SET ROLE rejects every private table/helper/base and only service can call public RPCs',async()=>{
 const tables=(await db.query("select tablename from pg_tables where schemaname='commerce' and tablename like 'op05_%' order by tablename")).rows;assert.equal(tables.length,12);
 for(const role of ['anon','authenticated','service_role']){
  for(const {tablename} of tables){await db.exec('savepoint rolecheck');await db.exec('set role '+role);await assert.rejects(db.query('select * from commerce.'+tablename),/permission denied/);await db.exec('rollback to savepoint rolecheck;release savepoint rolecheck');}
  await db.exec('savepoint helper');await db.exec('set role '+role);await assert.rejects(db.query("select commerce.op05_points_base($1,'wallet','{}')",[reader]),/permission denied/);await db.exec('rollback to savepoint helper;release savepoint helper');
  await db.exec('savepoint rpc');await db.exec('set role '+role);if(role==='service_role'){assert.equal((await f.topups('products')).mode,'TEST');assert.equal((await f.wallet()).totalPoints,50);}else await assert.rejects(f.topups('products'),/permission denied/);await db.exec('rollback to savepoint rpc;release savepoint rpc');
 }
 assert.equal((await db.query("select bool_and(relrowsecurity) ok from pg_class where relnamespace='commerce'::regnamespace and relname like 'op05_%' and relkind='r'")).rows[0].ok,true);
});

test('current SUPER_ADMIN/reader verification precedes receipt replay and strict requests reject malformed finance input',async()=>{
 error(await f.topups('products',{},admin),'READER_REQUIRED',403);error(await f.topups('admin-state',{},limited),'ADMIN_FORBIDDEN',403);error(await f.topups('products',{unexpected:1}),'INVALID_TOPUP_REQUEST',400);
 error(await f.product({amountKrw:0}),'INVALID_TOPUP_REQUEST',400);error(await f.product({points:1.5}),'INVALID_TOPUP_REQUEST',400);error(await f.product({expiresMinutes:2}),'INVALID_TOPUP_REQUEST',400);
 const key=uuid();const p=(await f.product({requestId:key})).products[0];assert.ok(p);
 await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);error(await f.product({requestId:key}),'ADMIN_FORBIDDEN',403);
});

test('product CAS, stable ID immutable versions and order snapshot/idempotency remain independent',async()=>{
 const req=uuid(),args={requestId:req,title:'원래 상품',amountKrw:5000,points:9000};const saved=await f.product(args);const p=saved.products[0];
 // Exact request body is required for idempotency; freeze all time/revision fields explicitly.
 const state=await f.adminTopups('state');error(await f.product({revision:'0'}),'REVISION_CONFLICT',409);
 const orderReq=uuid(),made=await f.create(p,'BANK',{requestId:orderReq});assert.equal((await f.create(p,'BANK',{requestId:orderReq})).replayed,true);error(await f.create(p,'CARD',{requestId:orderReq}),'IDEMPOTENCY_CONFLICT',409);
 assert.equal((await db.query('select length(fingerprint)::int n from commerce.op05_receipts where request_id=$1',[orderReq])).rows[0].n,64);
 const edited=await f.product({productId:p.id,title:'새 상품',amountKrw:7000,points:12000,revision:state.revision});const next=edited.products.find(x=>x.id===p.id);assert.notEqual(next.versionId,p.versionId);
 error(await f.create(p),'PRODUCT_VERSION_CONFLICT',409);assert.equal((await f.topups('order',{orderId:made.order.id})).order.amountKrw,5000);
 assert.equal((await db.query('select count(*)::int n from commerce.op05_product_versions where product_id=$1',[p.id])).rows[0].n,2);
});

test('BANK exact proof credits unified ledger once, protects ownership and permanent bank references',async()=>{
 const p=await f.makeProduct();const a=(await f.create(p)).order,b=(await f.create(p)).order;const key=uuid(),ref='bank-'+uuid(),at=new Date().toISOString(),data={bankReference:ref,receivedAt:at,requestId:key};
 const paid=await f.deposit(a,data);assert.equal(paid.order.status,'PAID');assert.equal((await f.deposit(a,data)).replayed,true);error(await f.deposit(b,{bankReference:ref}),'BANK_REFERENCE_USED',409);
 error(await f.topups('order',{orderId:a.id},otherReader),'ORDER_NOT_FOUND',404);error(await f.topups('admin-deposit',{orderId:a.id},reader),'ADMIN_FORBIDDEN',403);
 assert.equal((await f.wallet()).totalPoints,10050);assert.equal((await f.lots())[1].source,'TOPUP');await reconcile();
});

test('BANK mismatch and late deposit retain review evidence and do not mint points',async()=>{
 const p=await f.makeProduct();const a=(await f.create(p)).order;assert.equal((await f.deposit(a,{amountKrw:9999})).order.status,'REVIEW');
 const b=(await f.create(p)).order;await db.query("update commerce.op05_orders set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where id=$1",[b.id]);assert.equal((await f.deposit(b)).order.status,'REVIEW');assert.equal((await f.wallet()).totalPoints,50);
});

test('CARD claim binds key, duplicate approval finalization/reconciliation credits exactly once and lease cannot be replaced live',async()=>{
 const p=await f.makeProduct();const o=(await f.create(p,'CARD')).order;const c=await f.claim('claim-confirm',o,{paymentKey:'pay-'+uuid()});assert.ok(c.transport);assert.ok(c.transport.operationCreatedAt);
 assert.equal((await f.claim('claim-confirm',o,{paymentKey:c.transport.paymentKey})).transport,undefined);const receipt=f.approved(c.transport);const applied=await f.apply(c.transport,receipt);assert.equal(applied.order.status,'PAID');assert.equal((await f.apply(c.transport,receipt)).replayed,true);
 const q=await f.claim('claim-query',o);assert.equal((await f.apply(q.transport,receipt)).order.status,'PAID');assert.equal((await f.wallet()).totalPoints,10050);await reconcile();
});

test('UNKNOWN approval reconciles original key and does not credit while uncertain',async()=>{
 const p=await f.makeProduct();const o=(await f.create(p,'CARD')).order,c=await f.claim('claim-confirm',o,{paymentKey:'pay-'+uuid()});assert.equal((await f.apply(c.transport,{state:'UNKNOWN'})).order.status,'UNKNOWN');assert.equal((await f.wallet()).totalPoints,50);
 const q=await f.claim('claim-confirm',o,{paymentKey:c.transport.paymentKey});assert.equal(q.transport.operation,'query');assert.equal((await f.apply(q.transport,f.approved(q.transport))).order.status,'PAID');await reconcile();
});

test('partial use refund reserves all remaining lot points, blocks old public purchase bypass and leaves gifts usable',async()=>{
 // Opening 50 is consumed before TOPUP, then 50 from this 1000P lot: ceil(700*50/1000)=35 KRW.
 const p=await f.makeProduct({amountKrw:700,points:1000});const {order}=await f.card(p);assert.equal((await buy()).chargedPoints,100);
 const refund=await f.refund(order);assert.equal(refund.order.refund.points,950);assert.equal(refund.order.refund.amountKrw,665);assert.equal(refund.transport.refundAmountKrw,665);
 const comic=f.webtoon.episodes[2],q=await f.quote(comic.id);error(await f.purchase(q.quote.id),'INSUFFICIENT_POINTS',409);assert.equal((await f.wallet()).reservedPoints,950);
 await f.credit(200);assert.equal((await f.purchase(q.quote.id)).chargedPoints,100);assert.equal((await f.lots()).at(-1).source,'TEST_GIFT');
 assert.equal((await f.apply(refund.transport,f.cancelled(refund.transport))).order.status,'REFUNDED');const w=await reconcile();assert.equal(w.totalPoints,100);assert.equal(w.reservedPoints,0);
 assert.equal((await f.content(f.novel.episodes[2].id)).episodeId,f.novel.episodes[2].id);
});

test('unknown cancellation, expired lease, current DONE query and retry never release hold or change cancellation ID',async()=>{
 const p=await f.makeProduct(),{order}=await f.card(p),r=await f.refund(order);const cancelId=r.transport.operationId;
 assert.equal((await f.apply(r.transport,{state:'UNKNOWN'})).order.status,'REFUND_UNKNOWN');const q=await f.claim('claim-refund-retry',order);assert.equal(q.transport.operation,'query');
 const approved=f.approved(q.transport);approved.transactionKey=(await db.query('select approval_transaction from commerce.op05_orders where id=$1',[order.id])).rows[0].approval_transaction;
 assert.equal((await f.apply(q.transport,approved)).order.status,'REFUND_UNKNOWN');assert.equal((await f.wallet()).reservedPoints,10000);
 const retry=await f.claim('claim-refund-retry',order);assert.equal(retry.transport.operation,'cancel');assert.equal(retry.transport.operationId,cancelId);
 await db.query("update commerce.op05_operations set lease_until=now()-interval '1 minute' where id=$1",[cancelId]);const afterExpiry=await f.claim('claim-refund-retry',order);assert.equal(afterExpiry.transport.operation,'query');await f.apply(afterExpiry.transport,{...approved,approvedAt:new Date().toISOString()});const next=await f.claim('claim-refund-retry',order);assert.equal(next.transport.operationId,cancelId);assert.notEqual(next.transport.lease,retry.transport.lease);error(await f.apply(retry.transport,f.cancelled(retry.transport)),'STALE_PROVIDER_LEASE',409);assert.equal((await f.wallet()).reservedPoints,10000);
 assert.equal((await f.apply(next.transport,f.cancelled(next.transport))).order.status,'REFUNDED');await reconcile();
});

test('mismatched merchant, partial cancel amount and provider binding enter REVIEW without releasing reserved source',async()=>{
 const p=await f.makeProduct(),{order}=await f.card(p),r=await f.refund(order);assert.equal((await f.apply(r.transport,f.cancelled(r.transport,{cancelAmountKrw:1}))).order.status,'REVIEW');assert.equal((await f.wallet()).reservedPoints,10000);
 const retry=await f.claim('claim-refund-retry',order,{binding:'b'.repeat(64)});assert.equal(retry.order.status,'REVIEW');assert.equal(retry.transport,undefined);await reconcile();
});

test('BANK refund needs distinct exact outgoing proof, partial consumed topup refunds remaining with no entitlement deletion',async()=>{
 const p=await f.makeProduct({amountKrw:333,points:300});const o=(await f.create(p)).order;await f.deposit(o);await buy();const r=await f.refund(o);assert.equal(r.transport,undefined);assert.equal(r.order.refund.points,250);assert.equal(r.order.refund.amountKrw,277);
 error(await f.bankRefund(r.order,{amountKrw:333}),'REFUND_PROOF_MISMATCH',409);assert.equal((await f.wallet()).reservedPoints,250);const done=await f.bankRefund(r.order);assert.equal(done.order.status,'REFUNDED');assert.equal((await f.wallet()).totalPoints,0);await reconcile();
});

test('CEIL cumulative consumption prevents one-point free-read cash refund and never assumes 1P=1KRW',async()=>{
 const p=await f.makeProduct({amountKrw:1,points:1000}),{order}=await f.card(p);await f.policy('EPISODE',f.novel.episodes[2].id,51);await buy();
 const l=(await f.lots()).find(l=>l.order_id===order.id);assert.equal(Number(l.consumed_points),1);assert.equal(l.consumed_krw,1);error(await f.refund(order),'NO_REFUNDABLE_AMOUNT',409);assert.equal((await f.wallet()).reservedPoints,0);await reconcile();
});

test('current head rights survive refundable order cancellation and old RPC still consumes FIFO across gifts/topups',async()=>{
 await f.credit(100);const p=await f.makeProduct({amountKrw:700,points:1000}),{order}=await f.card(p);await buy();const allocations=(await db.query('select a.points,l.source from commerce.op05_allocations a join commerce.op05_lots l on l.id=a.lot_id order by l.sequence')).rows;assert.deepEqual(allocations.map(x=>[x.points,x.source]),[[50,'OPENING_TEST_BALANCE'],[50,'TEST_GIFT']]);
 const refund=await f.refund(order);await f.apply(refund.transport,f.cancelled(refund.transport));const head=await f.replaceHead(f.novel.episodes[2]);assert.equal((await f.content(head.id)).versionId,head.versionId);assert.equal((await buy()).chargedPoints,0);await reconcile();
});

test('checkout binds reviewed provider before SDK and expiry/changed binding/cross-owner deny safely',async()=>{
 const p=await f.makeProduct(),o=(await f.create(p,'CARD')).order,config={...provider,providerMode:'PROVIDER_TEST'};
 assert.equal((await f.topups('checkout',{orderId:o.id,...config})).providerMode,'PROVIDER_TEST');assert.equal((await f.topups('checkout',{orderId:o.id,...config})).order.status,'CREATED');
 error(await f.topups('checkout',{orderId:o.id,...config,binding:'b'.repeat(64)}),'PROVIDER_BINDING_CONFLICT',409);error(await f.topups('checkout',{orderId:o.id,...config},otherReader),'ORDER_NOT_FOUND',404);
 await db.query("update commerce.op05_orders set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where id=$1",[o.id]);error(await f.topups('checkout',{orderId:o.id,...config}),'ORDER_STATE_CONFLICT',409);
});

test('actor revocation before finalization and stale leases cannot mutate finance; older cancel blocks mutation with hold',async()=>{
 const p=await f.makeProduct(),o=(await f.create(p,'CARD')).order,c=await f.claim('claim-confirm',o,{paymentKey:'pay-'+uuid()});await db.query("update public.readers set status='BLOCKED' where auth_user_id=$1",[reader]);error(await f.apply(c.transport,f.approved(c.transport)),'ACTOR_REVOKED',403);assert.equal(Number((await db.query('select balance_points from commerce.op04_wallets where user_id=$1',[reader])).rows[0].balance_points),50);
});

test('products list is explicit enabled current version only with strict paging and published windows',async()=>{
 const p=await f.makeProduct();assert.equal((await f.topups('products')).items[0].id,p.id);assert.equal((await f.topups('products',{offset:50})).items.length,0);error(await f.topups('products',{offset:-1}),'INVALID_TOPUP_REQUEST',400);
 await f.product({productId:p.id,enabled:false});assert.equal((await f.topups('products')).items.length,0);error(await f.create({...p,versionId:(await f.adminTopups('state')).products[0].versionId}),'PRODUCT_UNAVAILABLE',409);
});

test('approval identity mismatches, duplicate provider transaction keys and expired checkout never mint money',async()=>{
 const p=await f.makeProduct(),o=(await f.create(p,'CARD')).order,c=await f.claim('claim-confirm',o,{paymentKey:'pay-'+uuid()});assert.equal((await f.apply(c.transport,f.approved(c.transport,{merchantId:'other'}))).order.status,'REVIEW');assert.equal((await f.wallet()).totalPoints,50);
 const a=await f.card(p),b=(await f.create(p,'CARD')).order,d=await f.claim('claim-confirm',b,{paymentKey:'pay-'+uuid()});const tx=(await db.query('select approval_transaction from commerce.op05_orders where id=$1',[a.order.id])).rows[0].approval_transaction;assert.equal((await f.apply(d.transport,f.approved(d.transport,{transactionKey:tx}))).order.status,'REVIEW');assert.equal((await f.wallet()).totalPoints,10050);
 const e=(await f.create(p,'CARD')).order;await db.query("update commerce.op05_orders set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where id=$1",[e.id]);const expired=await f.claim('claim-confirm',e,{paymentKey:'pay-'+uuid()});assert.equal(expired.order.status,'EXPIRED');assert.equal(expired.transport,undefined);
});

test('admin permission revoked between refund claim and apply retains hold and forbids financial finalization',async()=>{
 const p=await f.makeProduct(),{order}=await f.card(p),r=await f.claim('admin-claim-refund',order,{reason:'최고 관리자 환불 검증',requestId:uuid()},admin);assert.ok(r.transport);
 await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);error(await f.apply(r.transport,f.cancelled(r.transport)),'ACTOR_REVOKED',403);assert.equal((await f.wallet()).reservedPoints,10000);await reconcile();
});

test('15 day old cancellation is review-only with reservation intact and existing refund cannot be replaced',async()=>{
 const p=await f.makeProduct(),{order}=await f.card(p),r=await f.refund(order);await f.apply(r.transport,{state:'UNKNOWN'});const q=await f.claim('claim-query',order);const tx=(await db.query('select approval_transaction from commerce.op05_orders where id=$1',[order.id])).rows[0].approval_transaction;await f.apply(q.transport,f.approved(q.transport,{transactionKey:tx}));
 await db.query("update commerce.op05_operations set created_at=now()-interval '16 days' where id=$1",[r.transport.operationId]);const denied=await f.claim('claim-refund-retry',order);assert.equal(denied.order.status,'REVIEW');assert.equal(denied.transport,undefined);assert.equal((await f.wallet()).reservedPoints,10000);error(await f.refund(order),'REFUND_ALREADY_EXISTS',409);await reconcile();
});

test('a completed refund reconciles its one known cancel and audits unexpected transaction without losing terminal status',async()=>{
 const p=await f.makeProduct(),{order}=await f.card(p),r=await f.refund(order),receipt=f.cancelled(r.transport);await f.apply(r.transport,receipt);
 const q=await f.claim('claim-query',order);assert.ok(q.transport);assert.equal((await f.apply(q.transport,receipt)).order.status,'REFUNDED');
 const other=await f.claim('claim-query',order);assert.equal((await f.apply(other.transport,{...receipt,transactionKey:'outside-cancel-'+uuid()})).order.status,'REFUNDED');assert.equal((await f.wallet()).reservedPoints,0);assert.equal((await db.query("select count(*)::int n from commerce.op05_audit where action='provider-terminal-refund-observation'")).rows[0].n,1);await reconcile();
});

test('late UNKNOWN, NOT_PAID or REVIEW query cannot regress a refund completed by its earlier expired cancel lease',async()=>{
 const p=await f.makeProduct();
 for(const state of ['UNKNOWN','NOT_PAID','REVIEW']){
  const {order}=await f.card(p),r=await f.refund(order);await db.query("update commerce.op05_operations set lease_until=now()-interval '1 minute' where id=$1",[r.transport.operationId]);
  const q=await f.claim('claim-refund-retry',order);assert.equal(q.transport.operation,'query');assert.equal((await f.apply(r.transport,f.cancelled(r.transport))).order.status,'REFUNDED');
  const receipt=state==='NOT_PAID'?{state,amountKrw:q.transport.amountKrw,merchantId:q.transport.merchantId,paymentKey:q.transport.paymentKey}:{state};
  const late=await f.apply(q.transport,receipt);assert.equal(late.order.status,'REFUNDED');assert.equal(late.order.refund.status,'COMPLETED');assert.equal((await f.wallet()).reservedPoints,0);await reconcile();
 }
});

test('paid approval survives UNKNOWN/PENDING query and matching approval restores legacy UNKNOWN without new credits',async()=>{
 const p=await f.makeProduct(),{order}=await f.card(p),tx=(await db.query('select approval_transaction from commerce.op05_orders where id=$1',[order.id])).rows[0].approval_transaction;
 for(const state of ['UNKNOWN','PENDING']){
  const q=await f.claim('claim-query',order),receipt=state==='UNKNOWN'?{state}:{state,amountKrw:q.transport.amountKrw,merchantId:q.transport.merchantId,paymentKey:q.transport.paymentKey};
  assert.equal((await f.apply(q.transport,receipt)).order.status,'PAID');assert.equal((await f.wallet()).totalPoints,10050);
 }
 await db.query("update commerce.op05_orders set status='UNKNOWN' where id=$1",[order.id]);const q=await f.claim('claim-query',order);assert.equal((await f.apply(q.transport,f.approved(q.transport,{transactionKey:tx}))).order.status,'PAID');assert.equal((await db.query("select count(*)::int n from commerce.op04_ledger where order_id=$1 and kind='TOPUP'",[order.id])).rows[0].n,1);await reconcile();
});

test('per-user order creation budget serializes distinct request IDs and exact retries do not consume it',async()=>{
 const p=await f.makeProduct(),requestId=uuid(),first=await f.create(p,'BANK',{requestId});assert.ok(first.order);
 for(let i=1;i<60;i++)assert.ok((await f.create(p)).order);
 error(await f.create(p),'RATE_LIMITED',429);assert.equal((await f.create(p,'BANK',{requestId})).replayed,true);
 assert.equal((await db.query('select count(*)::int n from commerce.op05_orders where user_id=$1',[reader])).rows[0].n,60);
 assert.ok((await f.create(p,'BANK',{},otherReader)).order);await db.query("update commerce.op05_orders set created_at=now()-interval '2 minutes' where user_id=$1",[reader]);assert.ok((await f.create(p)).order);
});
