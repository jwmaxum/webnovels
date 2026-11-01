import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {encryptSettlement} from '../server/author-settlement-crypto.mjs';
import {settlementPolicy} from '../server/author-settlement-policy.mjs';
import {encryptAccount} from '../server/author-dashboard-api.mjs';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',limited='44444444-4444-4444-8444-444444444444';
const env={AUTHOR_SETTLEMENT_ENCRYPTION_KEY:'a'.repeat(64),AUTHOR_SETTLEMENT_KEY_VERSION:'v1',AUTHOR_SETTLEMENT_TRANSFER_NOTICE_VERSION:'approved-notice-v1',AUTHOR_SETTLEMENT_TRANSFER_NOTICE_TEXT:'Approved synthetic notice for local verification only. '.repeat(6)};
let db,policy,sql;
const query=async(text,args=[])=>(await db.query(text,args)).rows;
const call=async(action,data={},user=owner,authorId=null,key=null)=>(await query('select public.author_settlement_registration($1,$2,$3,$4,$5) result',[user,action,authorId,data,key]))[0].result;
before(async()=>{
 db=await PGlite.create();policy=await settlementPolicy(env);
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema authoring;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
  insert into auth.users(id,email) values('${owner}','owner@example.test'),('${other}','other@example.test'),('${admin}','admin@example.test'),('${limited}','limited@example.test');
  create table public.authors(id bigint primary key,auth_user_id uuid,username text,pen_name text,bio text,profile_image text,status text);
  insert into public.authors values(1,'${owner}','author1','First author','','','APPROVED'),(2,'${other}','author2','Other author','','','APPROVED');
  create table public.works(id bigint,author_id bigint);
  create table public.episodes(id bigint,work_id bigint);
  create table authoring.work_state(work_id bigint,author_id bigint,trashed_at timestamptz,updated_at timestamptz,visibility text);
  create table authoring.drafts(work_id bigint,author_id bigint,lifecycle text);
  create table public.author_earnings(id uuid,author_id bigint,work_id bigint,period_date date,author_revenue numeric,status text);
  create table public.author_settlement_accounts(author_id bigint,account_number_encrypted text);
  insert into public.author_settlement_accounts values(1,'legacy-preserved');
  create table public.readers(id bigint,auth_user_id uuid,username text,nickname text,status text,is_adult_verified boolean,adult_verified_at timestamptz,points integer);
  create table public.admin_users(id uuid,auth_user_id uuid,username text,nickname text,role text,is_active boolean,permissions text[]);
  insert into public.admin_users values('${admin}','${admin}','admin','Admin','SUPER_ADMIN',true,'{}'),('${limited}','${limited}','limited','Limited','SUB_ADMIN',true,array['AUTHOR_SETTLEMENT','SETTLEMENTS_READ']);
  create table authoring.migrations(version text primary key);`);
 await db.exec(await read('database/launch/004_virtual_accounts.sql'));
 await db.exec(`update launch_recovery.account_service set enabled=true;
  insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) values('author','1','${owner}','test','test',repeat('a',64)),('author','2','${other}','test','test',repeat('a',64));
  insert into launch_recovery.account_links(kind,profile_id,auth_user_id,evidence_ref,operator_ref,backup_sha256) values('admin','${admin}','${admin}','test','test',repeat('a',64)),('admin','${limited}','${limited}','test','test',repeat('a',64));
  insert into launch_recovery.virtual_accounts(kind,profile_id,auth_user_id,login_email) values('author','1','${owner}','owner@example.test'),('author','2','${other}','other@example.test');
  create function public.launch_author_workspace_ready() returns boolean language sql as $$select public.launch_accounts_ready()$$;
  set webnovels.dashboard_apply_verified='true';
  alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;
  set webnovels.settlement_apply_verified='true';`);
 await db.exec(await read('database/launch/009_author_dashboard.sql'));
 sql=await read('database/launch/016_author_settlement_registration.sql');await db.exec(sql);await db.exec(sql);
});
after(async()=>db?.close());
async function submit(revision='0',applicantType='INDIVIDUAL',user=owner,authorId='1',key=crypto.randomUUID()){
 const context={userId:user,authorId,revision:(BigInt(revision)+1n).toString()};
 const data={revision,applicantType,documentType:'RESIDENT_CARD',policyVersion:policy.version,policyHash:policy.hash,transferNoticeVersion:policy.transferNoticeVersion,transferNoticeHash:policy.transferNoticeHash,requestFingerprint:'a'.repeat(64),
  profileEnvelope:await encryptSettlement({legalName:'Synthetic applicant',address:'Synthetic address'},{...context,purpose:'profile'},env),
  identityEnvelope:await encryptSettlement({mime:'image/jpeg',data:'synthetic-redacted-document'},{...context,purpose:'identity-image'},env),
  businessEnvelope:applicantType==='INDIVIDUAL'?null:await encryptSettlement({mime:'image/jpeg',data:'synthetic-business-document'},{...context,purpose:'business-image'},env)};
 return {result:await call('submit',data,user,null,key),data,key};
}
test('explicit role ACLs deny browser RPCs, private helpers and direct service access while verified owners can submit',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(query('select * from launch_recovery.author_settlement_applications'),error=>error.code==='42501');
   await assert.rejects(query("select nextval('launch_recovery.author_settlement_bank_revision_seq')"),error=>error.code==='42501');
   await assert.rejects(query("select launch_recovery.settlement_envelope_valid('{}',1)"),error=>error.code==='42501');
   if(role==='service_role')assert.equal((await call('get')).application,null);
   else await assert.rejects(call('get'),error=>error.code==='42501');
  }finally{await db.exec('reset role');}
 }
 const created=await submit();assert.equal(created.result.application.status,'PENDING');assert.equal(created.result.application.revision,'1');
 assert.doesNotMatch(JSON.stringify(created.result),/Synthetic|ciphertext|Envelope/);
 assert.equal((await call('get',{},other)).application,null);
 assert.equal((await call('get',{},other,'1')).error,'AUTHOR_REQUIRED');
 assert.equal((await call('admin-list',{},limited)).error,'ADMIN_FORBIDDEN');
 const list=await call('admin-list',{},admin);assert.equal(list.total,1);assert.equal(list.applications[0].penName,'First author');
 const replay=await call('submit',created.data,owner,null,created.key);assert.deepEqual(replay,created.result);
 assert.equal((await call('submit',{...created.data,requestFingerprint:'b'.repeat(64)},owner,null,created.key)).error,'IDEMPOTENCY_CONFLICT');
 assert.equal((await call('submit',created.data,owner,null,crypto.randomUUID())).error,'SETTLEMENT_CONFLICT');
});
test('manual review requires super admin, exact revision and a live document; access is audited and images purged immediately',async()=>{
 assert.equal((await call('reveal',{revision:'1',reasonFingerprint:'a'.repeat(64)},limited,'1')).error,'ADMIN_FORBIDDEN');
 assert.equal((await call('reveal',{revision:'0',reasonFingerprint:'a'.repeat(64)},admin,'1')).error,'SETTLEMENT_CONFLICT');
 const before=Number((await query('select count(*) count from launch_recovery.author_settlement_audit'))[0].count);
 const shown=await call('reveal',{revision:'1',reasonFingerprint:'a'.repeat(64)},admin,'1');assert.ok(shown.encrypted.identityEnvelope);assert.equal(shown.application.revision,'1');
 assert.equal(Number((await query('select count(*) count from launch_recovery.author_settlement_audit'))[0].count),before+1);
 const key=crypto.randomUUID(),data={revision:'1',decision:'APPROVED',note:'Masked documents match entered details',requestFingerprint:'c'.repeat(64)};
 const reviewed=await call('review',data,admin,'1',key);assert.equal(reviewed.application.status,'APPROVED');assert.equal(reviewed.application.revision,'2');assert.equal(reviewed.application.documentAvailable,false);
 const stored=(await query('select profile_envelope,identity_envelope,business_envelope from launch_recovery.author_settlement_applications where author_id=1'))[0];assert.ok(stored.profile_envelope);assert.equal(stored.identity_envelope,null);assert.equal(stored.business_envelope,null);
 assert.deepEqual(await call('review',data,admin,'1',key),reviewed);
 assert.equal((await call('reveal',{revision:'2',reasonFingerprint:'a'.repeat(64)},admin,'1')).error,'SETTLEMENT_DOCUMENT_UNAVAILABLE');
 await assert.rejects(db.exec('delete from launch_recovery.author_settlement_audit'),/immutable/);
});
test('business applicants require encrypted business evidence, resubmission resets review, and withdrawal clears all PII',async()=>{
 const input=await submit('2','CORPORATION');assert.equal(input.result.application.status,'PENDING');assert.equal(input.result.application.revision,'3');assert.equal(input.result.application.reviewedAt,null);
 const invalid={...input.data,revision:'3',businessEnvelope:null};assert.equal((await call('submit',invalid,owner,null,crypto.randomUUID())).error,'INVALID_SETTLEMENT_DETAILS');
 const key=crypto.randomUUID(),data={revision:'3',requestFingerprint:'d'.repeat(64)};
 const withdrawn=await call('withdraw',data,owner,null,key);assert.equal(withdrawn.application.status,'WITHDRAWN');assert.equal(withdrawn.application.revision,'4');
 const stored=(await query('select profile_envelope,identity_envelope,business_envelope from launch_recovery.author_settlement_applications where author_id=1'))[0];assert.deepEqual(stored,{profile_envelope:null,identity_envelope:null,business_envelope:null});
 assert.deepEqual(await call('withdraw',data,owner,null,key),withdrawn);
 const audits=await query('select to_jsonb(a) body from launch_recovery.author_settlement_audit a');assert.doesNotMatch(JSON.stringify(audits),/Synthetic|ciphertext|address|legalName/);
});
test('bank save and consent audit commit together; owner-only deletion uses exact revision and safe replay without touching legacy data',async()=>{
 const input={revision:'0',bankName:'Synthetic bank',holder:'Synthetic holder',last4:'1234',envelope:await encryptAccount('000000001234','synthetic-key',owner+':1'),policyVersion:policy.version,policyHash:policy.hash,transferNoticeVersion:policy.transferNoticeVersion,transferNoticeHash:policy.transferNoticeHash};
 const save=async data=>(await query('select public.author_settlement_bank($1,$2) result',[owner,data]))[0].result;
 assert.equal((await save({...input,policyHash:'0'.repeat(64)})).error,'POLICY_CONFIRMATION_REQUIRED');
 assert.equal((await query('select count(*) count from launch_recovery.author_payout_details'))[0].count,0);
 const saved=await save(input);assert.ok(BigInt(saved.bank.revision)>0n);assert.equal(saved.bank.maskedNumber,'**** 1234');
 const consent=(await query("select action,policy_version,policy_hash,transfer_version,transfer_hash from launch_recovery.author_settlement_audit where action='BANK_REGISTER'"))[0];assert.equal(consent.policy_hash,policy.hash);assert.equal(consent.transfer_hash,policy.transferNoticeHash);
 const key=crypto.randomUUID(),data={revision:saved.bank.revision,requestFingerprint:'f'.repeat(64)};
 assert.equal((await call('bank-delete',data,other,'1',key)).error,'AUTHOR_REQUIRED');
 assert.equal((await call('bank-delete',{...data,revision:'0'},owner,null,key)).error,'SETTLEMENT_CONFLICT');
 const deleted=await call('bank-delete',data,owner,null,key);assert.deepEqual(deleted,{ok:true,bank:null});assert.deepEqual(await call('bank-delete',data,owner,null,key),deleted);
 assert.equal((await query('select count(*) count from launch_recovery.author_payout_details'))[0].count,0);
 assert.equal((await query('select account_number_encrypted from public.author_settlement_accounts where author_id=1'))[0].account_number_encrypted,'legacy-preserved');
 const registeredAgain=await save(input);assert.ok(BigInt(registeredAgain.bank.revision)>BigInt(saved.bank.revision));
 assert.equal((await save({...input,revision:saved.bank.revision})).error,'PROFILE_CONFLICT','a deleted bank revision cannot overwrite a newly registered bank');
 await db.exec(`begin;create function launch_recovery.synthetic_audit_failure() returns trigger language plpgsql as $$begin if new.action='BANK_REGISTER' then raise exception 'SYNTHETIC_AUDIT_FAIL';end if;return new;end$$;
  create trigger synthetic_bank_audit_failure before insert on launch_recovery.author_settlement_audit for each row execute function launch_recovery.synthetic_audit_failure();`);
 try{await assert.rejects(save({...input,revision:registeredAgain.bank.revision,bankName:'Must roll back'}),/SYNTHETIC_AUDIT_FAIL/);}finally{await db.exec('rollback');}
 assert.equal((await query('select bank_name from launch_recovery.author_payout_details where author_id=1'))[0].bank_name,'Synthetic bank','consent audit failure rolls back bank changes atomically');
});
test('expiry closes overdue pending requests on read and cleans reviewed profiles by 90 days without deleting authors',async()=>{
 const input=await submit('4');assert.equal(input.result.application.status,'PENDING');
 await db.exec("update launch_recovery.author_settlement_applications set expires_at=now()-interval '1 second' where author_id=1");
 assert.equal((await call('get')).application.status,'EXPIRED');
 const next=await submit('6','SOLE_PROPRIETOR');assert.equal(next.result.application.status,'PENDING');
 await call('review',{revision:'7',decision:'NEEDS_CHANGES',note:'Please provide clearer masked image',requestFingerprint:'e'.repeat(64)},admin,'1',crypto.randomUUID());
 await db.exec("update launch_recovery.author_settlement_applications set profile_expires_at=now()-interval '1 second' where author_id=1");
 const expired=(await query('select public.expire_author_settlement_registrations() result'))[0].result;assert.equal(expired.expired,1);
 assert.equal((await call('get')).application.status,'EXPIRED');assert.equal((await query('select count(*) count from authors'))[0].count,2);
 for(let i=0;i<5;i++)assert.equal((await call('attempt')).ok,true);assert.equal((await call('attempt')).error,'RATE_LIMITED');
 await db.exec("update authors set status='SUSPENDED' where id=1");assert.equal((await call('get')).error,'ACCOUNT_INACTIVE');
});
