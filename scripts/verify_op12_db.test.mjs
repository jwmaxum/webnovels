import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,owner,other,admin,limited} from './fixtures/op12-db.mjs';
import {confirmation} from './fixtures/op12-confirmation.mjs';
import {readFile} from 'node:fs/promises';
const uuid=()=>crypto.randomUUID();
test('legacy financial labels and injected LIVE/TEST fields never become payable; author search and ownership work',async()=>{
 const f=await setup();try{
  await f.seed();await f.db.exec("insert into public.author_earnings values(gen_random_uuid(),1,null,current_date,999999999,'PAID')");
  const d=await f.call('detail',{authorId:'1'});assert.equal(d.facts.identityApproved,true);assert.equal(d.facts.bankConfirmed,false);assert.equal(d.facts.payableKrw,null);assert.equal(d.canPay,false);
  for(const field of ['mode','provenance','amountKrw','sourceId'])assert.equal((await f.call('detail',{authorId:'1',[field]:'LIVE'})).error,'INVALID_READINESS_REQUEST');
  assert.equal((await f.call('complete',{authorId:'1'})).error,'INVALID_READINESS_REQUEST');
  assert.equal((await f.call('list',{query:'First',offset:0})).items.length,1);assert.equal((await f.call('list',{query:'absent',offset:0})).items.length,0);
  assert.equal((await f.call('detail',{authorId:'1'},other,false)).error,'INVALID_READINESS_REQUEST');assert.equal((await f.call('detail',{},other,false)).facts.authorId,'2');
  assert.equal((await f.call('list',{query:'',offset:0},limited)).error,'ADMIN_FORBIDDEN');
 }finally{await f.db.close();}
});
test('review is separate from identity; replay is once and bank changes invalidate confirmation and snapshot',async()=>{
 const f=await setup();try{
  await f.seed();const data=await confirmation(f),confirmed=await f.call('confirm',data);assert.equal(confirmed.saved,true,JSON.stringify(confirmed));assert.equal((await f.call('confirm',data)).replayed,true);
  assert.equal((await f.call('confirm',{...data,digest:'d'.repeat(64)})).error,'IDEMPOTENCY_CONFLICT');
  const d=await f.call('detail',{authorId:'1'});assert.equal(d.facts.bankConfirmed,true);assert.equal(d.canPay,false);
  const author=await f.call('detail',{},owner,false);assert.deepEqual(author.reviews,[]);assert(!JSON.stringify(author).includes('envelope'));
  const s={authorId:'1',binding:d.facts.binding,requestId:uuid(),period:new Date().toISOString().slice(0,7)};assert.equal((await f.call('snapshot',s)).saved,true);assert.equal((await f.call('snapshot',s)).replayed,true);
  assert.equal((await f.call('detail',{authorId:'1'})).snapshots[0].stale,false);
  assert((await f.bank(d.facts.bankRevision,'000000005678')).bank);
  const changed=await f.call('detail',{authorId:'1'});assert.equal(changed.facts.bankConfirmed,false);assert.equal(changed.snapshots[0].stale,true);
  assert.equal((await f.call('confirm',{...data,requestId:uuid(),documentId:uuid()})).error,'SETTLEMENT_CONFLICT');
  assert.equal((await f.db.query('select verification_status from launch_recovery.author_payout_details')).rows[0].verification_status,'PENDING');
  await assert.rejects(f.db.exec('delete from launch_recovery.op12_reviews'),/immutable/);
 }finally{await f.db.close();}
});
test('revocation preserves evidence; expiry prevents reads before bounded purge and purge is idempotent',async()=>{
 const f=await setup();try{
  await f.seed();const data=await confirmation(f);assert.equal((await f.call('confirm',data)).saved,true);
  assert((await f.call('reveal',{authorId:'1',reviewId:data.requestId})).encrypted);
  assert.equal((await f.call('revoke',{authorId:'1',binding:data.binding,requestId:uuid(),reviewId:data.requestId,reason:'INCORRECT_EVIDENCE'})).saved,true);
  assert.equal((await f.call('detail',{authorId:'1'})).facts.bankConfirmed,false);assert((await f.call('reveal',{authorId:'1',reviewId:data.requestId})).encrypted);
  const expired=uuid(),review=uuid();await f.db.query("insert into launch_recovery.op12_documents select $1,author_id,owner_id,bank_revision,identity_revision,envelope,digest,policy_version,policy_hash,1,now()-interval '2 days',now()-interval '1 day',null from launch_recovery.op12_documents limit 1",[expired]);
  await f.db.query('insert into launch_recovery.op12_reviews select $1,author_id,owner_id,bank_revision,identity_revision,binding,$2,reviewer_id,now() from launch_recovery.op12_reviews limit 1',[review,expired]);
  assert.equal((await f.call('reveal',{authorId:'1',reviewId:review})).error,'BANK_DOCUMENT_UNAVAILABLE');
  assert.equal((await f.db.query('select public.op12_purge_documents() r')).rows[0].r.purged,1);assert.equal((await f.db.query('select public.op12_purge_documents() r')).rows[0].r.purged,0);
  assert.equal((await f.db.query('select envelope from launch_recovery.op12_documents where id=$1',[expired])).rows[0].envelope,null);
 }finally{await f.db.close();}
});
test('self review, expired identity and current administrator privileges are checked',async()=>{
 const f=await setup();try{
  await f.seed();const data=await confirmation(f);
  await f.db.query("insert into public.admin_users values($1,$1,'owner-admin','Owner Admin','SUPER_ADMIN',true,'{}')",[owner]);
  await f.db.query("insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) values('admin',$1,$2,'synthetic','synthetic',repeat('a',64))",[owner,owner]);
  assert.equal((await f.call('confirm',data,owner)).error,'INDEPENDENT_REVIEW_REQUIRED');
  await f.db.exec("update launch_recovery.author_settlement_applications set profile_expires_at=now()-interval '1 second'");
  assert.equal((await f.call('confirm',await confirmation(f))).error,'BANK_REVIEW_NOT_READY');
  await f.db.query('update public.admin_users set is_active=false where auth_user_id=$1',[admin]);assert((await f.call('detail',{authorId:'1'})).error);
 }finally{await f.db.close();}
});
test('explicit private ACLs, RPC role checks, review gate and preservation of existing schema',async()=>{
 const f=await setup();try{
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);try{
    for(const t of ['documents','reviews','revocations','snapshots','audit','receipts','limits'])await assert.rejects(f.db.query('select * from launch_recovery.op12_'+t),e=>e.code==='42501');
    await assert.rejects(f.db.query('select launch_recovery.op12_facts(1)'),e=>e.code==='42501');
    if(role==='service_role')assert.equal((await f.call('detail',{authorId:'1'})).canPay,false);else await assert.rejects(f.call('detail',{authorId:'1'}),e=>e.code==='42501');
   }finally{await f.db.exec('reset role');}
  }
  assert.equal((await f.db.query('select account_number_encrypted from public.author_settlement_accounts where author_id=1')).rows[0].account_number_encrypted,'legacy-preserved');
  await assert.rejects(f.db.exec(await readFile('database/launch/025_settlement_readiness.sql','utf8')),/prerequisites/);
 }finally{await f.db.close();}
});
