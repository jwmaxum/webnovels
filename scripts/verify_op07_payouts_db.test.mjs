import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setup,sql,admin,reader,limited,otherReader,uuid} from './fixtures/op07-db.mjs';
let f,db;
before(async()=>{f=await setup();db=f.db;});after(async()=>db?.close());
beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
const error=(value,code,status=409)=>{assert.equal(value?.error,code,JSON.stringify(value));assert.equal(value.status,status);};
const summary=async()=> (await f.payouts('summary')).summary;
const total=async table=>Number((await db.query('select count(*) n from commerce.'+table)).rows[0].n);
const approve=payout=>f.transition('approve',payout);
async function unknown(amount=70){await f.prepared();const requested=(await f.requestPayout(amount)).payout;const approved=(await approve(requested)).payout;return (await f.transition('begin',approved)).payout;}

test('guarded migration preserves old rows, routines, schema and table ACL with disabled policy',async()=>{
 assert.match(sql,/webnovels\.author_payouts_test_apply_verified/);const state=await f.adminPayouts('state');assert.equal(state.policy.enabled,false);assert.equal(state.policy.authorBps,0);assert.equal(state.policy.deductionBps,0);assert.equal(state.revision,'0');assert.equal(await total('op07_earnings'),0);
 assert.deepEqual((await db.query("select (select nspacl::text from pg_namespace where nspname='commerce') schema_acl,(select relacl::text from pg_class where oid='commerce.legacy_sentinel'::regclass) table_acl,(select proacl::text from pg_proc where oid='commerce.legacy_marker()'::regprocedure) routine_acl,(select pg_get_functiondef('commerce.legacy_marker()'::regprocedure)) routine_definition")).rows[0],f.baselineCommerce);
 await db.exec('savepoint guard');await assert.rejects(db.exec(sql),/Reviewed OP-07/);await db.exec('rollback to savepoint guard;release savepoint guard');
});

test('explicit SET ROLE denies every private table/helper and exposes only service RPC',async()=>{
 const tables=(await db.query("select tablename from pg_tables where schemaname='commerce' and tablename like 'op07_%'")).rows;assert.equal(tables.length,10);
 for(const role of ['anon','authenticated','service_role']){
  for(const {tablename}of tables)for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'commerce.'+tablename,privilege])).rows[0].allowed,false);
  for(const {tablename}of tables){await db.exec('savepoint acl');await db.exec('set role '+role);await assert.rejects(db.query('select * from commerce.'+tablename),/permission denied/);await db.exec('rollback to savepoint acl;release savepoint acl');}
  for(const call of ['commerce.op07_summary()','commerce.op07_payee(1)','commerce.op07_source_ready(null)']){await db.exec('savepoint acl');await db.exec('set role '+role);await assert.rejects(db.query('select '+call),/permission denied/);await db.exec('rollback to savepoint acl;release savepoint acl');}
  await db.exec('savepoint acl');await db.exec('set role '+role);if(role==='service_role')assert.equal((await f.adminPayouts('state')).mode,'TEST');else await assert.rejects(f.adminPayouts('state'),/permission denied/);await db.exec('rollback to savepoint acl;release savepoint acl');
 }
 assert.equal(Number((await db.query("select count(*) n from pg_tables where schemaname='commerce' and tablename like 'op07_%' and not rowsecurity")).rows[0].n),0);
});

test('verified current actor, author ownership and SUPER_ADMIN are required on all reads and replay',async()=>{
 error(await f.payouts('summary',{},otherReader),'AUTHOR_REQUIRED',403);error(await f.payouts('admin-state',{},limited),'ADMIN_FORBIDDEN',403);
 await f.prepared();const body={amountKrw:10,policyVersion:(await f.payouts('summary')).policy.id,payeeRevision:'1',requestId:uuid()},first=await f.payouts('request',body);
 error(await f.payouts('request-detail',{payoutId:first.payout.id},reader),'PAYOUT_NOT_FOUND',404);
 await db.query("update public.authors set status='SUSPENDED' where id=$1",[f.author]);error(await f.payouts('request',body),'AUTHOR_REQUIRED',403);
 await db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);error(await f.adminPayouts('state'),'ADMIN_FORBIDDEN',403);
});

test('strict fields/ranges reject unknown actions, fake IDs and personal evidence references',async()=>{
 for(const [action,data]of [['summary',{authorId:'2'}],['request-detail',{payoutId:'not-id'}],['requests',{offset:100001}],['requests',{status:'EXECUTED'}],['requests',{status:2}]])error(await f.payouts(action,data),'INVALID_PAYOUT_REQUEST',400);
 for(const changes of [{authorBps:10001},{authorBps:-1},{deductionBps:1.5},{enabled:'true'},{reason:'<script>'},{reason:'a\nb'},{reason:'x'.repeat(301)},{unknown:true}])error(await f.payoutPolicy(changes),'INVALID_PAYOUT_REQUEST',400);
 error(await f.payee({testReference:'bank-real-account'}),'INVALID_PAYOUT_REQUEST',400);error(await f.adminPayouts('sources',{authorId:'9223372036854775808'}),'INVALID_PAYOUT_REQUEST',400);
});

test('policy CAS and idempotency freeze original policy and response without inventing taxes',async()=>{
 const requestId=uuid(),body={enabled:true,authorBps:7777,deductionBps:125,revision:'0',reason:'명시적 합성 분배 정책',requestId},first=await f.adminPayouts('policy',body);assert.equal(first.policy.authorBps,7777);assert.equal(first.policy.deductionBps,125);
 assert.equal((await f.adminPayouts('policy',body)).replayed,true);error(await f.adminPayouts('policy',{...body,authorBps:7000}),'IDEMPOTENCY_CONFLICT');error(await f.adminPayouts('policy',{...body,requestId:uuid()}),'REVISION_CONFLICT');
});

test('topup consumption yields exactly once immutable source-based earnings, not full cash receipt',async()=>{
 await f.payoutPolicy({authorBps:7777,deductionBps:125});const {allocationId}=await f.fundedConsumption();assert.equal((await f.sources()).items[0].sourceAmountKrw,100);
 const body={allocationId,policyVersion:(await f.adminPayouts('state')).policy.id,reason:'원금 배분과 확정 테스트',requestId:uuid()},result=await f.adminPayouts('confirm',body);assert.equal(result.earning.authorGrossKrw,77);assert.equal(result.earning.policyDeductionKrw,0);assert.equal(result.earning.netKrw,77);assert.equal(result.summary.confirmedKrw,77);
 assert.equal((await f.adminPayouts('confirm',body)).replayed,true);error(await f.confirm(allocationId),'SOURCE_ALREADY_CONFIRMED');assert.equal(await total('op07_earnings'),1);assert.equal((await f.sources()).items[0].eligible,false);
});

test('zero-net explicit policy freezes the source decision without adding available funds',async()=>{
 await f.payoutPolicy({authorBps:0});const {allocationId}=await f.fundedConsumption();const r=await f.confirm(allocationId);assert.equal(r.earning.netKrw,0);assert.equal(r.summary.availableKrw,0);await f.payoutPolicy({authorBps:10000});error(await f.confirm(allocationId),'SOURCE_ALREADY_CONFIRMED');
});

test('gift/opening/free/ad rights and legacy rows cannot become monetary earnings',async()=>{
 await f.payoutPolicy();await f.credit(500);await f.purchase((await f.quote(f.novel.episodes[2].id)).quote.id);assert.equal((await f.sources()).total,0);
 const allocation=(await db.query('select id from commerce.op05_allocations limit 1')).rows[0];error(await f.confirm(allocation.id),'SOURCE_NOT_PAYABLE');assert.equal((await summary()).confirmedKrw,0);
 await f.rewardPolicy({adEnabled:true});await f.grantAd(f.webtoon.episodes[2].id);assert.equal((await f.sources()).total,0);assert.equal((await summary()).availableKrw,0);
});

test('purchase author snapshot and confirmed work title are preserved without inferring current metadata',async()=>{
 await f.payoutPolicy();const c=await f.fundedConsumption(),r=await f.confirm(c.allocationId);assert.equal(r.earning.authorId,f.author);assert.equal(r.earning.netKrw,70);
 await db.query("update public.works set title='제목 수정 이후' where id=$1",[f.novel.id]);assert.equal((await f.adminPayouts('earnings',{})).items[0].workTitle,r.earning.workTitle);
 assert.match(sql,/p\.author_id,p\.work_id,w\.title/);
});

test('uncertain source cannot confirm and later source review dynamically holds funds',async()=>{
 await f.payoutPolicy();await f.payee();const c=await f.fundedConsumption();await db.query("update commerce.op05_orders set status='REVIEW' where id=$1",[c.order.id]);error(await f.confirm(c.allocationId),'SOURCE_NOT_PAYABLE');
 await db.query("update commerce.op05_orders set status='PAID' where id=$1",[c.order.id]);await f.confirm(c.allocationId);await db.query("update commerce.op05_orders set status='REFUND_UNKNOWN' where id=$1",[c.order.id]);assert.equal((await summary()).heldKrw,70);assert.equal((await summary()).availableKrw,0);error(await f.requestPayout(1),'INSUFFICIENT_SETTLEMENT_BALANCE');
});

test('normal unused topup refund preserves consumed monetary revenue and reader right',async()=>{
 const c=await f.prepared();const refund=await f.refund(c.order);assert.equal(refund.order.status,'REFUND_PENDING');assert.equal((await summary()).heldKrw,0);assert.equal((await f.bankRefund(refund.order)).order.status,'REFUNDED');assert.equal((await summary()).availableKrw,70);assert.equal((await f.quote(f.novel.episodes[2].id)).quote.access,'OWNED');
});

test('payee is separate TEST reference and monotonically revised with CAS and exact replay',async()=>{
 const requestId=uuid(),first=await f.payee({requestId,testReference:'TEST-fixture'});assert.equal(first.payee.revision,'1');assert.equal((await f.payee({revision:'0',requestId,testReference:'TEST-fixture'})).replayed,true);
 error(await f.payee({revision:'0'}),'REVISION_CONFLICT');const second=await f.payee({testReference:'TEST-fixture'});assert.equal(second.payee.revision,'2');assert.equal(second.payee.ready,true);
 assert.doesNotMatch(JSON.stringify(await f.adminPayouts('authors',{query:''})),/accountNumber|birthDate|envelope|identity|password/);
});

test('request reserves funds once; overdraw, changed terms, stale payee and foreign details fail',async()=>{
 await f.prepared();const state=await f.payouts('summary');error(await f.requestPayout(71),'INSUFFICIENT_SETTLEMENT_BALANCE');error(await f.requestPayout(1,{policyVersion:uuid()}),'PAYOUT_POLICY_CHANGED');error(await f.requestPayout(1,{payeeRevision:'0'}),'PAYEE_CHANGED');
 const requestId=uuid(),first=await f.requestPayout(50,{requestId});assert.equal(first.payout.status,'REQUESTED');assert.equal(first.summary.reservedKrw,50);assert.equal(first.summary.availableKrw,20);
 const replay=await f.requestPayout(50,{requestId});assert.equal(replay.replayed,true);assert.equal(replay.payout.id,first.payout.id);error(await f.requestPayout(51,{requestId}),'IDEMPOTENCY_CONFLICT');error(await f.requestPayout(21),'INSUFFICIENT_SETTLEMENT_BALANCE');assert.equal(state.summary.paidKrw,0);
});

test('approval is not payment and request approval cannot bypass revision or source hold',async()=>{
 const c=await f.prepared(),requested=(await f.requestPayout()).payout;error(await f.transition('approve',requested,{revision:'1'}),'REVISION_CONFLICT');const approved=(await approve(requested)).payout;assert.equal(approved.status,'APPROVED');assert.equal(approved.evidence,null);assert.equal((await summary()).paidKrw,0);assert.equal((await summary()).reservedKrw,70);
 await db.query("update commerce.op05_orders set status='UNKNOWN' where id=$1",[c.order.id]);error(await f.transition('begin',approved),'SETTLEMENT_HOLD');
});

test('predispatch payee changes require cancellation and new request',async()=>{
 await f.prepared();const requested=(await f.requestPayout()).payout;await f.payee();error(await approve(requested),'PAYEE_CHANGED');const cancelled=await f.payouts('cancel',{payoutId:requested.id,revision:requested.revision,reason:'새 지급 대상 재신청',requestId:uuid()});assert.equal(cancelled.summary.reservedKrw,0);assert.equal((await f.requestPayout()).payout.payeeRevision,'2');
});

test('UNKNOWN always retains reservation; cancel/reject/rebegin cannot retry dispatch',async()=>{
 const payout=await unknown();assert.equal(payout.status,'UNKNOWN');assert.equal((await summary()).reservedKrw,70);error(await f.transition('reject',payout),'PAYOUT_STATE_CONFLICT');error(await f.transition('begin',payout),'PAYOUT_STATE_CONFLICT');error(await f.payouts('cancel',{payoutId:payout.id,revision:payout.revision,reason:'미확정 취소 불가',requestId:uuid()}),'PAYOUT_STATE_CONFLICT');assert.equal((await summary()).availableKrw,0);
});

test('paid evidence requires frozen payee, exact amount, time, state and TEST-only reference',async()=>{
 const payout=await unknown();for(const change of [{testReference:'TEST-other'},{amountKrw:69},{paidAt:'2020-01-01T00:00:00Z'},{paidAt:'2099-01-01T00:00:00Z'}])error(await f.transition('paid',payout,f.evidence(payout,change)),'PAYOUT_PROOF_MISMATCH');
 error(await f.transition('paid',payout,f.evidence(payout,{reference:'real-bank-reference'})),'INVALID_PAYOUT_REQUEST',400);assert.equal(await total('op07_evidence'),0);assert.equal((await summary()).reservedKrw,70);
});

test('matching evidence creates one paid fact; replay cannot pay twice or regress terminal state',async()=>{
 const payout=await unknown(),proof=f.evidence(payout),requestId=uuid(),result=await f.transition('paid',payout,{...proof,requestId});assert.equal(result.payout.status,'PAID');assert.equal(result.payout.evidence.source,'LOCAL_SIMULATED');assert.equal(result.summary.paidKrw,70);assert.equal(result.summary.reservedKrw,0);
 assert.equal((await f.transition('paid',payout,{...proof,requestId})).replayed,true);error(await f.transition('fail',result.payout,{reference:'TEST-failure',testReference:payout.testReference}),'PAYOUT_STATE_CONFLICT');assert.equal(await total('op07_evidence'),1);
});

test('postdispatch source review, payee/author changes and debt cannot hide executed result',async()=>{
 const c=await f.prepared(),req=(await f.requestPayout()).payout,approved=(await approve(req)).payout,payout=(await f.transition('begin',approved)).payout;
 await f.payee({ready:false});await db.query("update public.authors set status='SUSPENDED' where id=$1",[f.author]);await db.query("update commerce.op05_orders set status='REVIEW' where id=$1",[c.order.id]);await f.adminPayouts('adjust',{earningId:c.earning.id,amountKrw:10,reason:'실행 이후 원천 감액',requestId:uuid()});
 const paid=await f.transition('paid',payout,f.evidence(payout));assert.equal(paid.payout.status,'PAID');assert.equal(paid.summary.paidKrw,70);assert.equal(paid.summary.debtKrw,10);assert.equal(paid.summary.availableKrw,0);
});

test('confirmed failure requires unique matching TEST evidence then releases reservation',async()=>{
 const payout=await unknown();error(await f.transition('fail',payout,{reference:'TEST-failed',testReference:'TEST-wrong'}),'PAYOUT_PROOF_MISMATCH');const result=await f.transition('fail',payout,{reference:'TEST-failed',testReference:payout.testReference});assert.equal(result.payout.status,'FAILED');assert.equal(result.payout.evidence.amountKrw,70);assert.equal(result.payout.evidence.source,'LOCAL_SIMULATED');assert.equal(result.summary.reservedKrw,0);assert.equal(result.summary.availableKrw,70);
});

test('one outcome reference cannot be used for a second payout',async()=>{
 const payout=await unknown(30),reference='TEST-global-reference';await f.transition('paid',payout,f.evidence(payout,{reference}));const requested=(await f.requestPayout(30)).payout,approved=(await approve(requested)).payout,second=(await f.transition('begin',approved)).payout;
 error(await f.transition('fail',second,{reference,testReference:second.testReference}),'PAYOUT_EVIDENCE_CONFLICT');assert.equal((await summary()).reservedKrw,30);
});

test('immutable bounded corrections retain original earning and expose debt after paid',async()=>{
 const c=await f.prepared(),req=(await f.requestPayout()).payout,payout=(await f.transition('begin',(await approve(req)).payout)).payout;await f.transition('paid',payout,f.evidence(payout));const body={earningId:c.earning.id,amountKrw:10,reason:'원거래 감액 조정 근거',requestId:uuid()},result=await f.adminPayouts('adjust',body);
 assert.equal(result.earning.netKrw,70);assert.equal(result.earning.adjustedKrw,10);assert.equal(result.earning.availableNetKrw,60);assert.equal(result.summary.debtKrw,10);assert.equal((await f.adminPayouts('adjust',body)).replayed,true);error(await f.adminPayouts('adjust',{...body,amountKrw:61,requestId:uuid()}),'ADJUSTMENT_EXCEEDS_EARNING');
});

test('adjustment before dispatch prevents spending reserved balance beyond current net',async()=>{
 const c=await f.prepared(),req=(await f.requestPayout()).payout;await f.adminPayouts('adjust',{earningId:c.earning.id,amountKrw:1,reason:'신청 후 원천 감액',requestId:uuid()});error(await approve(req),'SETTLEMENT_HOLD');assert.equal((await summary()).debtKrw,1);const cancelled=await f.payouts('cancel',{payoutId:req.id,revision:req.revision,reason:'감액 확인 후 재신청',requestId:uuid()});assert.equal(cancelled.summary.availableKrw,69);assert.equal(cancelled.summary.debtKrw,0);
});

test('disabled policy still permits cancellation, adjustment and UNKNOWN terminal evidence',async()=>{
 const payout=await unknown(30);const requested=(await f.requestPayout(20)).payout;await f.payoutPolicy({enabled:false});error(await approve(requested),'PAYOUT_POLICY_DISABLED');error(await f.requestPayout(1),'PAYOUT_POLICY_DISABLED');
 assert.equal((await f.payouts('cancel',{payoutId:requested.id,revision:requested.revision,reason:'비활성 상태 예약 해제',requestId:uuid()})).payout.status,'CANCELLED');assert.equal((await f.transition('paid',payout,f.evidence(payout))).payout.status,'PAID');
});

test('paged author inventory/source/earnings/request reads separate actor ownership and filter scope',async()=>{
 await f.prepared();await f.requestPayout(10);const inventory=await f.adminPayouts('authors',{query:''});assert.ok(inventory.items.some(row=>row.id===f.author));assert.equal(inventory.limit,50);assert.equal((await f.adminPayouts('earnings',{authorId:f.author})).items.length,1);assert.equal((await f.adminPayouts('earnings',{authorId:'2'})).items.length,0);assert.equal((await f.adminPayouts('sources',{authorId:'2'})).items.length,0);assert.equal((await f.payouts('requests',{},reader)).items.length,0);assert.equal((await f.payouts('earnings',{},reader)).items.length,0);
});

test('new write receipts are limited per actor while exact retries remain available',async()=>{
 let first;
 for(let i=0;i<60;i++){const state=await f.adminPayouts('state'),body={enabled:false,authorBps:0,deductionBps:0,revision:state.revision,reason:'신규 쓰기 제한 확인',requestId:uuid()};const result=await f.adminPayouts('policy',body);assert.equal(result.saved,true);if(i===0)first=body;}
 error(await f.payoutPolicy(),'RATE_LIMITED',429);assert.equal((await f.adminPayouts('policy',first)).replayed,true);assert.equal(await total('op07_receipts'),60);
});

test('business-rejected attempts consume a bounded counter while successful exact replay stays available',async()=>{
 const body={enabled:false,authorBps:0,deductionBps:0,revision:'0',reason:'비활성 TEST 분배 정책',requestId:uuid()};assert.equal((await f.adminPayouts('policy',body)).saved,true);
 for(let i=1;i<60;i++)error(await f.requestPayout(1),'PAYOUT_POLICY_DISABLED');error(await f.requestPayout(1),'RATE_LIMITED',429);assert.equal((await f.adminPayouts('policy',body)).replayed,true);
 const counter=(await db.query('select writes from commerce.op07_write_limits where actor_id=$1',[admin])).rows;assert.equal(counter.length,1);assert.equal(counter[0].writes,60);assert.equal(await total('op07_receipts'),1);
 const policyVersion=(await f.adminPayouts('state')).policy.id;error(await f.payouts('request',{amountKrw:1,policyVersion,payeeRevision:'0',requestId:uuid()},reader),'PAYOUT_POLICY_DISABLED');
 assert.equal((await db.query('select writes from commerce.op07_write_limits where actor_id=$1',[reader])).rows[0].writes,1);
 // Synthetic aging verifies reset without sleeping or changing the production clock.
 await db.query("update commerce.op07_write_limits set window_at=clock_timestamp()-interval '2 minutes' where actor_id=$1",[admin]);error(await f.requestPayout(1),'PAYOUT_POLICY_DISABLED');assert.equal((await db.query('select writes from commerce.op07_write_limits where actor_id=$1',[admin])).rows[0].writes,1);
});

test('financial snapshots/corrections/evidence/receipts are immutable even to owner SQL',async()=>{
 const c=await f.prepared();for(const table of ['op07_policies','op07_earnings','op07_receipts','op07_audit']){await db.exec('savepoint immutable');await assert.rejects(db.exec('delete from commerce.'+table),/OP07_IMMUTABLE/);await db.exec('rollback to savepoint immutable;release savepoint immutable');}
 assert.equal((await f.adminPayouts('earnings',{})).items[0].id,c.earning.id);
});

test('global balances sum author balances without paying one author debt from another author funds',async()=>{
 const c=await f.prepared(),requested=(await f.requestPayout()).payout,payout=(await f.transition('begin',(await approve(requested)).payout)).payout;await f.transition('paid',payout,f.evidence(payout));await f.adminPayouts('adjust',{earningId:c.earning.id,amountKrw:20,reason:'첫 작가 지급 후 감액',requestId:uuid()});
 const novel=await f.makeAuthorNovel(),other=await f.fundedConsumption({episodeId:novel.episodes[2].id,user:otherReader});assert.equal((await f.confirm(other.allocationId)).earning.authorId,'2');
 const first=await summary(),second=(await f.payouts('summary',{},reader)).summary,global=(await f.adminPayouts('state')).summary;assert.equal(first.debtKrw,20);assert.equal(second.availableKrw,70);assert.equal(global.debtKrw,20);assert.equal(global.availableKrw,70);assert.equal(global.netKrw,120);assert.equal(global.paidKrw,70);
});
