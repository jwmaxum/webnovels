import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,users,rpc,consent,verified,read} from './fixtures/stage34-db.mjs';
import {enrollmentDocuments} from '../server/author-enrollment-policy.mjs';

test('LIVE fixture: same person may enroll distinct IDs and pen names; retries preserve independent ownership',async()=>{
 const db=await setup();try{
  await db.exec(await read('database/authoring/023_author_enrollment.sql'));
  for(const d of await enrollmentDocuments())assert.equal((await db.query('select hash from authoring.enrollment_documents where id=$1',[d.id])).rows[0].hash,d.hash);
  const a=await verified(db,users[0]),b=await verified(db,users[1]),c=await verified(db,users[2],'b'.repeat(64));
  for(const [i,id] of [a,b,c].entries()){
   const data={attemptId:id,displayName:'독립필명'+i};
   const [first,retry]=await Promise.all([rpc(db,users[i],'complete',data),rpc(db,users[i],'complete',{...data,displayName:'덮어쓰기금지'})]);
   assert.equal(first.completed,true);assert.equal(retry.completed,true);
   const actor=(await db.query('select launch_account_actor($1) a',[users[i]])).rows[0].a;
   assert.equal(actor.author.pen_name,data.displayName);assert.equal(actor.reader,null);assert.equal(actor.admin,null);
   assert.equal(JSON.stringify(actor).includes('person_id'),false);
  }
  assert.equal((await db.query('select count(*)::int n from authoring.verified_author_persons')).rows[0].n,2);
  const ids=(await db.query('select auth_user_id,person_id from authoring.author_identity_accounts order by auth_user_id')).rows;
  assert.equal(ids[0].person_id,ids[1].person_id);assert.notEqual(ids[0].person_id,ids[2].person_id);
  assert.equal((await rpc(db,users[1],'complete',{attemptId:a,displayName:'타인'})).error,'IDENTITY_ATTEMPT_INVALID');
  const work=(await db.query('select creator_works($1,$2,$3,$4,$5) r',[users[0],'create',null,{title:'내 작품'},crypto.randomUUID()])).rows[0].r.work;
  assert.ok(work);
  const denied=(await db.query('select creator_works($1,$2,$3) r',[users[1],'get',work.id])).rows[0].r;
  assert.ok(denied.error);assert.equal(denied.work,undefined);
  const updated=(await db.query('select creator_works($1,$2,$3,$4) r',[users[0],'update',work.id,
   {version:work.version,description:'소개',genre:['판타지'],rating:'ALL',ai_usage_type:'NONE'}])).rows[0].r;
  assert.ok(updated.work);
  const draft=crypto.randomUUID(),key=crypto.randomUUID();
  assert.ok((await db.query('select creator_drafts($1,$2,$3,$4,$5,$6) r',[users[0],'save',work.id,draft,
   {expectedRevision:'0',title:'첫 회차',content:'직접 창작한 본문',authorComment:''},crypto.randomUUID()])).rows[0].r.draft);
  const publication=(await db.query('select creator_publications($1,$2,$3,$4,$5,$6,$7) r',[users[0],'publish',work.id,draft,null,
   {revision:'1',episodeNumber:1,mode:'NOW',rightsConfirmed:true},key])).rows[0].r;
  assert.ok(publication.publication,JSON.stringify(publication));
  assert.equal((await db.query('select document_id from authoring.publication_rights_consents where work_id=$1 and request_key=$2',[work.id,key])).rows[0].document_id,'copyright-own');
  assert.equal((await db.query('select count(*)::int n from authors where auth_user_id=any($1::uuid[])',[users])).rows[0].n,3);
  await assert.rejects(db.query('update authoring.author_rights_consents set accepted_at=now()'),/immutable/i);
  await assert.rejects(db.query('select complete_authoring_signup($1,$2,$3)',[users[0],'author','우회']),/AUTHOR_IDENTITY_REQUIRED/);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   for(const table of ['enrollment_documents','enrollment_settings','author_identity_attempts','author_rights_consents','verified_author_persons','author_identity_accounts','publication_rights_consents'])
    await assert.rejects(db.query('select * from authoring.'+table),e=>e.code==='42501');
   await assert.rejects(db.query('select authoring.create_confirmed_profile($1,$2,$3)',[users[0],'author','우회']),e=>e.code==='42501');
   if(role!=='service_role')await assert.rejects(rpc(db,users[0],'status'),e=>e.code==='42501');
   else assert.equal((await rpc(db,users[0],'status')).completed,true);
   await db.exec('reset role');
  }
 }finally{await db.close();}
});

test('consent tampering, expiry, cancellation, test proof and changed configuration fail closed',async()=>{
 const db=await setup();try{
  const u=users[0];
  for(const patch of [{rightsAccepted:false},{privacyAccepted:false},{rightsAccepted:'true'},{rightsBasis:'OTHER'}])
   assert.equal((await rpc(db,u,'start',await consent(db,patch))).error,'AUTHOR_CONSENT_REQUIRED');
  for(const patch of [{documentHash:'f'.repeat(64)},{privacyVersion:'old'}])
   assert.equal((await rpc(db,u,'start',await consent(db,patch))).error,'AUTHOR_CONSENT_STALE');
  const fields=await consent(db),start=await rpc(db,u,'start',fields),attemptId=start.attempt.id;
  assert.equal((await rpc(db,u,'start',fields)).attempt.id,attemptId);
  assert.equal((await db.query('select count(*)::int n from authoring.author_rights_consents')).rows[0].n,1);
  assert.equal((await rpc(db,u,'complete',{attemptId,displayName:'필명'})).error,'AUTHOR_IDENTITY_REQUIRED');
  await rpc(db,u,'cancel',{attemptId});
  assert.equal((await rpc(db,u,'verify',{attemptId,fingerprint:'a'.repeat(64),verifiedAt:new Date().toISOString()})).error,'IDENTITY_ATTEMPT_INVALID');
  const expired=await verified(db,u);
  await db.query("update authoring.author_identity_attempts set expires_at=now()-interval '1 second' where id=$1",[expired]);
  assert.equal((await rpc(db,u,'complete',{attemptId:expired,displayName:'필명'})).error,'IDENTITY_ATTEMPT_EXPIRED');
  await db.exec("update authoring.enrollment_settings set mode='TEST'");
  const testId=await verified(db,u);
  assert.equal((await rpc(db,u,'complete',{attemptId:testId,displayName:'필명'})).error,'TEST_IDENTITY_NOT_ACCEPTED');
  await db.exec("update authoring.enrollment_settings set mode='LIVE'");
  assert.equal((await rpc(db,u,'complete',{attemptId:testId,displayName:'필명'})).error,'IDENTITY_CONFIGURATION_REQUIRED');
  assert.equal((await db.query('select count(*)::int n from authoring.author_identity_accounts')).rows[0].n,0);
  await db.exec("update authoring.enrollment_settings set enabled=false");
  assert.equal((await rpc(db,u,'start',await consent(db))).error,'AUTHOR_ENROLLMENT_NOT_READY');
  await db.exec("update authoring.author_identity_attempts set created_at=now()-interval '24 hours'");
  assert.equal((await db.query('select cleanup_author_enrollment() n')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int n from authoring.author_rights_consents')).rows[0].n,0);
 }finally{await db.close();}
});

test('existing authors retain profile and manuscripts; revoked Auth, invalid names, limits and erasure are enforced',async()=>{
 const db=await setup();try{
  const existing='22222222-2222-4222-8222-222222222222';
  await db.query('update auth.users set email=$2 where id=$1',[existing,'existing@example.test']);
  const before=(await db.query('select to_jsonb(a) a from authors a where auth_user_id=$1',[existing])).rows[0].a;
  const proof=await verified(db,existing);
  assert.equal((await rpc(db,existing,'complete',{attemptId:proof,displayName:'다른필명'})).created,false);
  assert.deepEqual((await db.query('select to_jsonb(a) a from authors a where auth_user_id=$1',[existing])).rows[0].a,before);
  assert.equal((await db.query('select count(*)::int n from works')).rows[0].n,2);
  for(const [change,undo] of [['email_confirmed_at=null','email_confirmed_at=now()'],['is_anonymous=true','is_anonymous=false'],["banned_until=now()+interval '1 day'",'banned_until=null'],['deleted_at=now()','deleted_at=null']]){
   await db.query(`update auth.users set ${change} where id=$1`,[users[0]]);
   assert.equal((await rpc(db,users[0],'start',await consent(db))).error,'INVALID_SESSION');
   await db.query(`update auth.users set ${undo} where id=$1`,[users[0]]);
  }
  const id=await verified(db,users[0]);
  await assert.rejects(rpc(db,users[0],'complete',{attemptId:id,displayName:'<bad>'}),e=>e.code==='22023');
  assert.equal((await rpc(db,users[0],'status')).completed,false);
  for(let i=0;i<4;i++)assert.ok((await rpc(db,users[0],'start',await consent(db))).attempt);
  assert.equal((await rpc(db,users[0],'start',await consent(db))).error,'RATE_LIMITED');
  await assert.rejects(db.query('select authoring.erase_author_enrollment($1)',[existing]),/Reviewed withdrawal/);
  await db.exec("set webnovels.author_erasure_verified='true'");
  await db.query("update authors set status='SUSPENDED' where auth_user_id=$1",[existing]);
  await db.query('select authoring.erase_author_enrollment($1)',[existing]);
  assert.equal((await db.query('select count(*)::int n from authoring.verified_author_persons')).rows[0].n,0);
 }finally{await db.close();}
});
