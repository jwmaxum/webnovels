import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,admin,reader,reviewer,operator} from './fixtures/op13-db.mjs';
const buy=async(f,id)=>{const q=await f.call('reader','quote',{episodeId:id});return f.write('reader','purchase',{quoteId:q.id});};
test('OP13 real-source ledger: independent deposit, free first two, paid novel/webtoon, replay and revenue',async()=>{
 const f=await setup();try{
  assert.ok((await f.policy(f.novel.id)).id);assert.ok((await f.policy(f.webtoon.id)).id);
  const funding=await f.fund();assert.ok(funding.confirmed.id,JSON.stringify(funding));
  assert.equal((await f.call('reader','state')).balance,10000);
  assert.equal((await buy(f,f.novel.episodes[0].id)).charged,0);
  assert.equal((await f.call('reader','content',{episodeId:f.novel.episodes[2].id})).error,'EPISODE_LOCKED');
  assert.equal((await buy(f,f.novel.episodes[2].id)).charged,100);
  assert.equal((await buy(f,f.novel.episodes[2].id)).charged,0);
  assert.equal((await buy(f,f.webtoon.episodes[2].id)).charged,100);
  const content=await f.call('reader','content',{episodeId:f.webtoon.episodes[2].id});assert.equal(content.contentType,'WEBTOON');assert.equal(content.panels.length,1);
  assert.equal((await f.call('author','state')).available,140);
  await f.credit(5000);assert.equal((await f.call('reader','state')).balance,9800,'TEST credit excluded');
  const state=await f.call('reader','state');assert.equal(state.mode,'LIVE_MANUAL');assert.equal(state.orders.length,1);
 }finally{await f.db.close();}
});
test('OP13 payout manual completion is immutable and subsequent bank reversal creates debt',async()=>{
 const f=await setup();try{
  await f.policy(f.novel.id);const fund=await f.fund();await buy(f,f.novel.episodes[2].id);assert.equal((await f.bank()).saved,true);
  const state=await f.call('author','state');const payout=await f.write('author','request',{binding:state.binding});assert.equal(payout.gross,70);
  assert.ok((await f.write('admin','approve',{payoutId:payout.id,deduction:0,basisRef:'synthetic-tax-reviewed'},reviewer)).id);
  const complete={requestId:crypto.randomUUID(),payoutId:payout.id,net:70,bankRefHash:'f'.repeat(64),occurredAt:new Date().toISOString(),evidence:await f.evidence()};
  assert.equal((await f.call('admin','complete',complete,reviewer)).error,'PAYOUT_NOT_READY');
  assert.ok((await f.call('admin','complete',complete,operator)).id);
  assert.equal((await f.call('admin','complete',complete,operator)).replayed,true);
  assert.equal((await f.write('admin','cancel',{payoutId:payout.id})).error,'PAYOUT_NOT_READY');
  const correction=await f.write('admin','correction',{lotId:fund.confirmed.id,kind:'BANK_REVERSAL',amount:10000,bankRefHash:'e'.repeat(64),evidence:await f.evidence()});assert.ok(correction.id);
  assert.ok((await f.write('admin','confirm-correction',{correctionId:correction.id},reviewer)).id);
  assert.equal((await f.call('author','state')).available,-70);
  assert.equal((await f.call('reader','content',{episodeId:f.novel.episodes[2].id})).error,'EPISODE_LOCKED');
  await assert.rejects(f.db.exec('delete from live_commerce.payout_completions'),/immutable/);
 }finally{await f.db.close();}
});
test('OP13 ACL and input gates; no self-confirm, mismatch, duplicate bank ref or stale quote',async()=>{
 const f=await setup();try{
  await f.policy(f.novel.id);
  const o=await f.write('reader','order',{destinationHash:'d'.repeat(64)});
  const d={requestId:crypto.randomUUID(),orderId:o.id,destinationHash:'d'.repeat(64),amount:9999,bankRefHash:'a'.repeat(64),occurredAt:new Date().toISOString(),evidence:await f.evidence()};
  const dep=await f.call('admin','deposit',d);assert.ok(dep.id,JSON.stringify(dep));
  assert.equal((await f.write('admin','confirm',{depositId:dep.id})).error,'INDEPENDENT_REVIEW_REQUIRED');
  assert.equal((await f.write('admin','confirm',{depositId:dep.id},reviewer)).error,'AMOUNT_MISMATCH');
  assert.equal((await f.call('admin','deposit',{...d,requestId:crypto.randomUUID()})).error,'BANK_REFERENCE_USED');
  assert.equal((await f.call('admin','deposit',{...d,amount:10000})).error,'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.call('admin','list',{query:'',offset:0},reader)).error,'ADMIN_FORBIDDEN');
  const q=await f.call('reader','quote',{episodeId:f.novel.episodes[2].id});await f.replaceHead(f.novel.episodes[2]);
  assert.equal((await f.write('reader','purchase',{quoteId:q.id})).error,'PRICE_CHANGED');
  for(const role of ['anon','authenticated','service_role']){await f.db.exec('set role '+role);await assert.rejects(f.db.query('select * from live_commerce.orders'),e=>e.code==='42501');if(role!=='service_role')await assert.rejects(f.call('reader','state'),e=>e.code==='42501');else assert.equal((await f.call('reader','state')).balance,0);await f.db.exec('reset role');}
 }finally{await f.db.close();}
});
test('OP13 refund reservation, rejection, confirmation and expired document cleanup preserve accounting',async()=>{
 const f=await setup();try{
  await f.policy(f.novel.id);const fund=await f.fund();await buy(f,f.novel.episodes[2].id);
  const correction=async(kind,amount,ref)=>f.write('admin','correction',{lotId:fund.confirmed.id,kind,amount,bankRefHash:ref.repeat(64),evidence:await f.evidence()});
  const refund=await correction('REFUND',9900,'a');assert.ok(refund.id);assert.equal((await f.call('reader','state')).balance,0);
  assert.ok((await f.write('admin','reject-correction',{correctionId:refund.id},reviewer)).id);assert.equal((await f.call('reader','state')).balance,9900);
  const refund2=await correction('REFUND',9900,'b');assert.ok((await f.write('admin','confirm-correction',{correctionId:refund2.id},reviewer)).id);
  assert.equal((await f.call('reader','state')).balance,0);assert.equal((await f.call('author','state')).available,70);
  assert.equal((await f.write('admin','reject-correction',{correctionId:refund2.id},reviewer)).error,'CORRECTION_NOT_READY');
  const d=await f.evidence();await f.db.query("insert into live_commerce.documents values($1,$2,'REFUND',$3,$4,$5,$6,1,now()-interval '2 days',now()-interval '1 day',null)",[d.id,operator,JSON.stringify(d.envelope),d.digest,d.policyVersion,d.policyHash]);
  assert.equal((await f.call('admin','reveal',{documentId:d.id})).error,'DOCUMENT_UNAVAILABLE');
  assert.equal((await f.db.query('select public.op13_purge_documents() r')).rows[0].r.purged,1);
  assert.equal((await f.db.query('select envelope from live_commerce.documents where id=$1',[d.id])).rows[0].envelope,null);
  assert.equal((await f.db.query('select public.op13_purge_documents() r')).rows[0].r.purged,0);
 }finally{await f.db.close();}
});
test('OP13 changed bank blocks approved payout; independent cancellation releases reservation; revoked actor cannot replay',async()=>{
 const f=await setup();try{
  await f.policy(f.novel.id);await f.fund();await buy(f,f.novel.episodes[2].id);await f.bank();const state=await f.call('author','state');const p=await f.write('author','request',{binding:state.binding});
  assert.ok((await f.write('admin','approve',{payoutId:p.id,deduction:0,basisRef:'reviewed-synthetic'},reviewer)).id);
  await f.db.exec('update launch_recovery.author_payout_details set revision=revision+1 where author_id=1');
  const completion={requestId:crypto.randomUUID(),payoutId:p.id,net:70,bankRefHash:'f'.repeat(64),occurredAt:new Date().toISOString(),evidence:await f.evidence()};assert.equal((await f.call('admin','complete',completion)).error,'PAYOUT_NOT_READY');
  const cancel={requestId:crypto.randomUUID(),payoutId:p.id,notTransferredConfirmed:true,reasonRef:'bank-changed-no-transfer'};
  assert.equal((await f.call('admin','cancel',cancel,reviewer)).error,'INDEPENDENT_REVIEW_REQUIRED');assert.ok((await f.call('admin','cancel',cancel)).id);assert.equal((await f.call('author','state')).available,70);
  await f.db.query('update public.admin_users set is_active=false where auth_user_id=$1',[operator]);assert.equal((await f.call('admin','cancel',cancel)).error,'ACCOUNT_INACTIVE');
 }finally{await f.db.close();}
});
